/**
 * @perry/projects — Step Runner
 *
 * Executes a single project step: builds the prompt, calls the AI,
 * saves the result, emits events. This is the atomic unit of work.
 *
 * The StepRunner doesn't know about templates or project types —
 * it just executes whatever step it's given.
 */

import type {
  Project, ProjectStep, CompletionRequest, CompletionResponse,
  EventBus, Logger, McpClientService
} from '@perry/core';
import { loadInstalledSkills } from '@perry/core';
import type { AIRouter } from '@perry/ai';
import { ComfyUIService, QwenTextRenderService } from '@perry/ai';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore
// import { createCanvas, loadImage } from 'canvas';
import { StateStore } from './state-store.js';
import { PromptBuilder } from './prompt-builder.js';
import { PovQualityGate } from './quality-gates/pov-gate.js';
import { ContinuityGate } from './quality-gates/continuity-gate.js';
import { RevisionGate } from './quality-gates/revision-gate.js';
import { DeduplicationService } from './services/deduplication.js';
import { ProseSanitizer } from './services/prose-sanitizer.js';
import { StyleDnaService } from './services/style-dna-service.js';
import { CostTracker } from './services/cost-tracker.js';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { generateCalibrationPassSteps } from './templates.js';
import { AutoLearningService } from './services/auto-learning-service.js';
import { NetworkClient, type NetworkPath } from './services/network-client.js';
import { getGateFor } from './services/quality-gates.js';

/**
 * Variable names that go into URL PATH segments (OpenLibrary subject slugs,
 * Reddit multi-sub joins like `sub1+sub2`) and therefore must NOT
 * be URL-encoded — encoding `+` to `%2B` would break Reddit's multi-sub URL,
 * and encoding underscores in subject slugs is unnecessary noise. Everything
 * else (queries, etc.) DOES get URL-encoded because it lands in `?q=…`.
 */
const PATH_SAFE_VARS = new Set(['subjectSlug', 'subjectSlugFallback', 'redditSubs', 'redditAuthorSubs']);

/**
 * JSON schemas for Concept Keywords output. Ollama 0.5+ structured outputs
 * enforce these via grammar-constrained sampling — the model literally
 * cannot finish until every `required` field is emitted. This is more
 * reliable than prompt-level "MANDATORY" instructions for gemma3:12b which
 * routinely drops fields when the description provides strong genre signal.
 *
 * Book-planning is 5 fields; KDP launch adds `redditAuthorSubs` (author-
 * community subs for keyword/category strategy research).
 */
// Canonical OpenLibrary subject slugs that reliably return populated
// /subjects/{slug}.json feeds. Constrained as an `enum` so the schema-
// enforced sampler can't invent made-up slugs like "last-synapse" (which
// returns 0 works). Covers the major genres + common subgenres a book-
// planning project will land in. The librarian picks the closest one;
// subjectSlugFallback should be a BROADER one from the same list.
const OL_SUBJECT_ENUM = [
  // Broad parents (always valid fallbacks)
  'fiction', 'non-fiction', 'history', 'biography', 'memoir',
  // SF/F
  'science_fiction', 'fantasy', 'cyberpunk', 'epic_fantasy', 'urban_fantasy', 'dark_fantasy',
  'space_opera', 'hard_science_fiction', 'dystopia', 'post-apocalyptic', 'steampunk',
  // Mystery / Thriller / Horror
  'mystery', 'thriller', 'horror', 'cozy_mystery', 'detective_and_mystery_stories',
  'crime', 'psychological_thriller', 'noir',
  // Romance
  'romance', 'paranormal_romance', 'contemporary_romance', 'historical_romance',
  // Literary / Mainstream
  'literary_fiction', 'contemporary_fiction', 'historical_fiction', 'classics',
  // Military / War
  'military_fiction', 'war_stories', 'war', 'military_history',
  // YA / Children
  'young_adult', 'childrens_fiction', 'middle_grade',
  // Non-fiction parents
  'self-help', 'business', 'philosophy', 'religion', 'science', 'travel', 'cooking', 'art',
];

const CONCEPT_KEYWORDS_SCHEMA_PLANNING = {
  type: 'object',
  required: ['subjectSlug', 'subjectSlugFallback', 'redditSubs', 'primaryQuery', 'altQueries'],
  properties: {
    subjectSlug:         { type: 'string', enum: OL_SUBJECT_ENUM },
    subjectSlugFallback: { type: 'string', enum: OL_SUBJECT_ENUM },
    redditSubs:          { type: 'string', minLength: 5, maxLength: 120 },
    primaryQuery:        { type: 'string', minLength: 5, maxLength: 120 },
    altQueries:          { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
  },
};

const CONCEPT_KEYWORDS_SCHEMA_KDP = {
  type: 'object',
  required: ['subjectSlug', 'subjectSlugFallback', 'redditSubs', 'redditAuthorSubs', 'primaryQuery', 'altQueries'],
  properties: {
    subjectSlug:         { type: 'string', enum: OL_SUBJECT_ENUM },
    subjectSlugFallback: { type: 'string', enum: OL_SUBJECT_ENUM },
    redditSubs:          { type: 'string', minLength: 5, maxLength: 120 },
    redditAuthorSubs:    { type: 'string', minLength: 5, maxLength: 120 },
    primaryQuery:        { type: 'string', minLength: 5, maxLength: 120 },
    altQueries:          { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
  },
};

// ════════════════════════════════════════════════════════════════════════
// JSON-then-render contract for multi-section network_research outputs.
//
// gemma3/qwen3-family models drift on multi-section markdown — they keep
// reverting to their training-data section names ("Notable Reader-Curated
// Lists" etc.) regardless of how explicitly the prompt asks for a different
// structure. The fix is to ask the model for STRICT JSON via Ollama's
// schema-enforced sampling, then render that JSON to a deterministic
// markdown structure server-side. The librarian can't drift if the only
// legal output is the JSON shape the schema describes.
//
// Each step that uses this pattern has:
//   * A schema (passed as `format` to Ollama)
//   * A short JSON-asking prompt (replaces the old multi-section instruction)
//   * A renderer function (post-processes the JSON response into markdown)
// ════════════════════════════════════════════════════════════════════════

const LIVE_COMP_TITLE_SCOUT_SCHEMA = {
  type: 'object',
  required: ['compTitles', 'genreTags', 'tropes'],
  properties: {
    compTitles: {
      type: 'array', minItems: 0, maxItems: 12,
      items: {
        type: 'object',
        required: ['title', 'author'],
        properties: {
          title:        { type: 'string' },
          author:       { type: 'string' },
          year:         { type: 'string' },           // string not number — handles "—" / "?"
          rating:       { type: 'string' },           // e.g. "4.21" or "—"
          ratingsCount: { type: 'string' },           // e.g. "184,250" or "—"
          asin:         { type: 'string' },           // 10-char ASIN or "—"
          sourceCitations: { type: 'array', items: { type: 'string' } }, // ["1","4","5"]
        },
      },
    },
    genreTags:   { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 15 },
    tropes:      { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 12 },
    mostDiscussed: {
      type: 'array', minItems: 0, maxItems: 10,
      items: {
        type: 'object',
        required: ['title'],
        properties: {
          title:       { type: 'string' },
          author:      { type: 'string' },
          threadTitle: { type: 'string' },
        },
      },
    },
  },
};

/**
 * Render Live Comp Title Scout JSON output into the markdown structure
 * downstream steps expect. Field-by-field defensive — missing/empty
 * sections become "(none extracted)" rather than failing the render.
 *
 * The renderer is the ONLY place markdown structure is defined. The model
 * can't drift on section names because it never emits markdown.
 */
function renderLiveCompTitleScout(json: any): string {
  const comps = Array.isArray(json?.compTitles) ? json.compTitles : [];
  const tags  = Array.isArray(json?.genreTags) ? json.genreTags : [];
  const trop  = Array.isArray(json?.tropes) ? json.tropes : [];
  const disc  = Array.isArray(json?.mostDiscussed) ? json.mostDiscussed : [];

  const compRows = comps.length === 0
    ? '| (none extracted) | — | — | — | — | — | — |'
    : comps.map((c: any) => {
        const cite = Array.isArray(c.sourceCitations) ? c.sourceCitations.map((s: string) => `[${s}]`).join('') : '—';
        // Defensive: librarian sometimes copies Goodreads GR-IDs ("gr:1234...")
        // into the ASIN field. Only accept true 10-char Amazon ASINs.
        const asin = typeof c.asin === 'string' && /^[A-Z0-9]{10}$/.test(c.asin.trim()) ? c.asin.trim() : '—';
        return `| ${(c.title || '—').replace(/\|/g, '\\|')} | ${(c.author || '—').replace(/\|/g, '\\|')} | ${c.year || '—'} | ${c.rating || '—'} | ${c.ratingsCount || '—'} | ${asin} | ${cite} |`;
      }).join('\n');

  return [
    `## Top Comp Titles Found`,
    ``,
    `| Title | Author | Year | Rating | Ratings | ASIN | Source |`,
    `|-------|--------|------|--------|---------|------|--------|`,
    compRows,
    ``,
    `## Common Genre Tags`,
    tags.length === 0 ? `* (none extracted)` : tags.map((t: string) => `* ${t}`).join('\n'),
    ``,
    `## Most-Discussed in Reader Communities`,
    disc.length === 0
      ? `* (none extracted)`
      : disc.map((d: any) => {
          const hasAuthor = d.author && d.author !== '—' && d.author !== '?';
          const inThread = d.threadTitle ? ` — in thread "${d.threadTitle}"` : '';
          return `* ${d.title}${hasAuthor ? ` by ${d.author}` : ''}${inThread}`;
        }).join('\n'),
    ``,
    `## Reader-Facing Tropes & Themes`,
    trop.length === 0 ? `* (none extracted)` : trop.map((t: string) => `* ${t}`).join('\n'),
  ].join('\n');
}

/** Sanitise an OpenLibrary subject slug: lowercase, replace whitespace + `-` with `_`,
 *  strip anything outside `[a-z0-9_]`. OL slugs follow this convention. */
function normaliseSubjectSlug(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Genre-keyword → canonical OL subject mapping. Models routinely drop
 * subjectSlug when emitting Concept Keywords JSON despite schema enforcement,
 * so we recover by scanning the primaryQuery for genre markers and mapping
 * to a real OL subject that will actually return books. Order matters — more
 * specific subgenres BEFORE their parents so "techno-noir" picks cyberpunk
 * before falling through to thriller.
 */
const KEYWORD_TO_SLUG: Array<[RegExp, string]> = [
  [/cyberpunk|techno-?noir|matrix|neural|cyber|AI thriller|digital afterlife|consciousness upload|virtual reality/i, 'cyberpunk'],
  [/space opera|interstellar|galactic empire/i, 'space_opera'],
  [/hard sci(-|ence )fi|first contact|terraform|orbital/i, 'hard_science_fiction'],
  [/epic fantasy|sword and sorcery|elf|dragon|wizard|magical realm/i, 'epic_fantasy'],
  [/urban fantasy|paranormal/i, 'urban_fantasy'],
  [/dark fantasy|grimdark/i, 'dark_fantasy'],
  [/dystopia|post.apocalyp|wasteland/i, 'dystopia'],
  [/steampunk/i, 'steampunk'],
  [/cozy mystery/i, 'cozy_mystery'],
  [/noir|hardboiled|detective|private investigator/i, 'noir'],
  [/psychological thriller/i, 'psychological_thriller'],
  [/horror|haunted|supernatural/i, 'horror'],
  [/paranormal romance/i, 'paranormal_romance'],
  [/historical romance|regency/i, 'historical_romance'],
  [/contemporary romance/i, 'contemporary_romance'],
  [/literary fiction|literary novel/i, 'literary_fiction'],
  [/historical fiction|historical novel/i, 'historical_fiction'],
  [/military|war|soldier|combat|marines|navy seal/i, 'military_fiction'],
  [/young adult|YA novel|teen/i, 'young_adult'],
  [/memoir|autobiograph/i, 'memoir'],
  [/biography/i, 'biography'],
  [/self.help/i, 'self-help'],
  [/business/i, 'business'],
  [/philosophy/i, 'philosophy'],
  // Broad genre fallbacks — only hit if no specific subgenre matched.
  [/sci(-|ence )fi|science fiction/i, 'science_fiction'],
  [/fantasy/i, 'fantasy'],
  [/thriller|suspense/i, 'thriller'],
  [/mystery/i, 'mystery'],
  [/romance/i, 'romance'],
];

/** Infer a canonical OL subject slug from a free-text primaryQuery. */
function inferSubjectSlug(query: string): string | '' {
  for (const [re, slug] of KEYWORD_TO_SLUG) {
    if (re.test(query)) return slug;
  }
  return '';
}

/** Subgenre → parent-genre fallback map. The /subjects/X.json endpoint is
 *  guaranteed to return SOMETHING for these broad parents, so they're a safe
 *  safety net when the specific subgenre slug returns 0 works. */
const SLUG_PARENT: Record<string, string> = {
  cyberpunk: 'science_fiction', space_opera: 'science_fiction', hard_science_fiction: 'science_fiction',
  epic_fantasy: 'fantasy', urban_fantasy: 'fantasy', dark_fantasy: 'fantasy',
  dystopia: 'science_fiction', steampunk: 'science_fiction',
  cozy_mystery: 'mystery', noir: 'mystery', psychological_thriller: 'thriller',
  paranormal_romance: 'romance', historical_romance: 'romance', contemporary_romance: 'romance',
  literary_fiction: 'fiction', historical_fiction: 'fiction',
  military_fiction: 'fiction', war_stories: 'fiction',
  young_adult: 'fiction',
};

function inferFallbackSlug(slug: string): string {
  return SLUG_PARENT[slug] || 'fiction';
}

/** Genre → reader-sub default mapping. Used when the model omits redditSubs. */
const SLUG_READER_SUBS: Record<string, string> = {
  cyberpunk: 'books+printSF+sciencefiction+cyberpunk',
  space_opera: 'books+printSF+sciencefiction+SciFiConcepts',
  hard_science_fiction: 'books+printSF+sciencefiction+HardSF',
  science_fiction: 'books+printSF+sciencefiction+Fantasy',
  epic_fantasy: 'books+Fantasy+epicfantasy+suggestmeabook',
  urban_fantasy: 'books+Fantasy+urbanfantasy+suggestmeabook',
  dark_fantasy: 'books+Fantasy+grimdark+suggestmeabook',
  fantasy: 'books+Fantasy+suggestmeabook',
  cozy_mystery: 'books+cozymystery+mystery+suggestmeabook',
  noir: 'books+suggestmeabook+mystery+crimewriters',
  mystery: 'books+mystery+suggestmeabook+booksuggestions',
  psychological_thriller: 'books+suggestmeabook+thrillers+booksuggestions',
  thriller: 'books+suggestmeabook+thrillers+booksuggestions',
  horror: 'books+horrorlit+horror+suggestmeabook',
  paranormal_romance: 'books+RomanceBooks+paranormalromance+suggestmeabook',
  romance: 'books+RomanceBooks+suggestmeabook+booksuggestions',
  military_fiction: 'books+MilitaryFiction+suggestmeabook+history',
  war_stories: 'books+MilitaryFiction+history+suggestmeabook',
  historical_fiction: 'books+historicalfiction+suggestmeabook',
  literary_fiction: 'books+literature+suggestmeabook+booksuggestions',
  young_adult: 'books+YAlit+suggestmeabook+YoungAdult',
  memoir: 'books+memoirs+nonfictionbooks+booksuggestions',
  biography: 'books+nonfictionbooks+biographies+booksuggestions',
};

function inferReaderSubs(slug: string): string {
  return SLUG_READER_SUBS[slug] || 'books+suggestmeabook+booksuggestions';
}

/** Sanitise a Reddit multi-sub list. Reddit sub names allow [A-Za-z0-9_] and
 *  are joined with `+` for multi-sub endpoints. Drop anything else; default
 *  to a safety-net sub if every input is invalid. */
function normaliseRedditSubs(s: string, safetyNet: string = 'books'): string {
  const cleaned = s.replace(/^r\//gi, '').split(/[+,\s]+/)
    .map(x => x.replace(/[^A-Za-z0-9_]/g, ''))
    .filter(x => x.length > 0 && x.length < 30);
  // Reddit's multi-sub URL returns an empty listing if every sub in the list
  // is invalid/404. Keeping a known-good sub first guarantees the endpoint
  // always returns SOMETHING relevant. Caller passes the right safety net for
  // the use-case: 'books' for reader subs, 'selfpublish' for author subs.
  if (!cleaned.includes(safetyNet)) cleaned.unshift(safetyNet);
  return cleaned.slice(0, 5).join('+');
}

/**
 * Scan a project's completed steps in REVERSE chronological order for one whose
 * result parses as JSON with a `primaryQuery` field. That's the contract for a
 * "Concept Keywords" preflight step that fed downstream network_research steps
 * with description-derived search phrases. Returns a flat map of placeholder
 * names → values, ready for template substitution.
 *
 * If no such step exists yet (e.g. on the FIRST run before the preflight has
 * fired), returns null and the URL templates pass through unchanged.
 */
function findConceptKeywords(project: { steps: Array<{ status: string; result?: string }> }): Record<string, string> | null {
  for (let i = project.steps.length - 1; i >= 0; i--) {
    const s = project.steps[i];
    if (s.status !== 'completed' || !s.result) continue;
    // Tolerant parse — strip markdown fences FIRST, then check shape. Order
    // matters: models routinely wrap JSON output in ```json fences, so
    // checking for a leading `{` before stripping silently skips every
    // fenced response.
    const cleaned = s.result.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    if (!cleaned.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed?.primaryQuery !== 'string') continue;
      const vars: Record<string, string> = { primaryQuery: parsed.primaryQuery };

      // OpenLibrary subject slug (PATH-safe, not encoded). Required for the new
      // /subjects/{slug}.json endpoint. Models are lazy with multi-field JSON
      // schemas — when subjectSlug is missing we infer from the primaryQuery
      // by keyword matching against canonical OL subjects. This guarantees
      // every downstream /subjects/X.json fetch hits a real subject feed.
      const rawSlug = typeof parsed.subjectSlug === 'string' ? parsed.subjectSlug : '';
      const slug = normaliseSubjectSlug(rawSlug);
      vars.subjectSlug = slug || inferSubjectSlug(parsed.primaryQuery) || 'fiction';

      // Fallback slug — broader parent subject if the specific one is empty.
      // Maps the inferred specific slug → its canonical broad parent.
      const rawFallback = typeof parsed.subjectSlugFallback === 'string' ? parsed.subjectSlugFallback : '';
      vars.subjectSlugFallback = normaliseSubjectSlug(rawFallback) || inferFallbackSlug(vars.subjectSlug) || 'fiction';

      // Derive a SPACED, URL-encodable version of the subject slug for sources
      // (Goodreads, others) that expect a search-query string rather than a
      // path component. Underscores → spaces; encodeURIComponent then handles
      // the spaces correctly via substituteTemplateVars (subjectQuery is NOT
      // in PATH_SAFE_VARS, so it goes through standard URL encoding).
      vars.subjectQuery = vars.subjectSlug.replace(/_/g, ' ');

      // Reddit reader sub list (PATH-safe, joined with +). Always includes r/books.
      // When missing, infer a sub list that matches the subjectSlug's genre.
      const rawSubs = typeof parsed.redditSubs === 'string' ? parsed.redditSubs : '';
      vars.redditSubs = normaliseRedditSubs(rawSubs || inferReaderSubs(vars.subjectSlug), 'books');

      // Reddit AUTHOR sub list (PATH-safe). Used by KDP/publishing templates
      // to pull writer-community wisdom (keyword research, category strategy,
      // AMS tactics) — distinct from `redditSubs` which is reader-side. Falls
      // back to a general selfpub safety net if the librarian doesn't emit it.
      const rawAuthorSubs = typeof parsed.redditAuthorSubs === 'string' ? parsed.redditAuthorSubs : '';
      vars.redditAuthorSubs = normaliseRedditSubs(rawAuthorSubs || 'selfpublish+KDP+writing', 'selfpublish');

      if (Array.isArray(parsed.altQueries)) {
        parsed.altQueries.forEach((q: unknown, idx: number) => {
          if (typeof q === 'string') vars[`altQuery${idx + 1}`] = q;
        });
      }
      return vars;
    } catch { /* not the JSON we want, keep scanning */ }
  }
  return null;
}

/**
 * Scan completed step results for top-N Amazon ASINs. ASINs are 10-character
 * alphanumeric IDs that consistently appear in network_research results from
 * the Amazon search digest (formatted as `[ASIN]`). We extract them
 * sequentially from the MOST RECENT completed steps (reverse chronological)
 * so the freshest comp-title data wins, deduplicated, capped at `max`.
 *
 * The result is merged into the placeholder vars map as `asin1`, `asin2`,
 * etc. — enabling URL templates like `/dp/{{asin1}}` to address each
 * separately.
 */
function findTopAsins(project: { steps: Array<{ status: string; result?: string }> }, max: number = 5): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (let i = project.steps.length - 1; i >= 0 && ordered.length < max; i--) {
    const s = project.steps[i];
    if (s.status !== 'completed' || !s.result) continue;
    // Match either bracketed `[B0XXX]` (from our Amazon digest format) or
    // bare 10-char ASIN tokens in table cells. Filter to plausible Amazon
    // shape: starts with 0/1/B/A and contains digits + uppercase letters.
    const re = /\b([A-Z0-9]{10})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s.result)) !== null) {
      const candidate = m[1];
      if (!/^(B0|[0-9])/.test(candidate)) continue;          // ISBN-10 starts digit, B-ASIN starts B0
      if (!/[A-Z]/.test(candidate) && !/^\d{10}$/.test(candidate)) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      ordered.push(candidate);
      if (ordered.length >= max) break;
    }
  }
  return ordered;
}

/** Substitute {{key}} placeholders. Path-safe vars (subjectSlug, redditSubs)
 *  are inserted RAW because they land in URL path segments where `+` and `_`
 *  must not be percent-encoded. Everything else goes through encodeURIComponent
 *  for safe `?q=…` insertion. Unknown keys are left untouched. */
function substituteTemplateVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, key) => {
    if (!(key in vars)) return match;
    return PATH_SAFE_VARS.has(key) ? vars[key] : encodeURIComponent(vars[key]);
  });
}

/** Raw (non-URL-encoded) {{key}} substitution for prompt bodies the librarian
 *  will read. URL-encoded percent escapes would just confuse the model. */
function substituteTemplateVarsRaw(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, key) => {
    if (key in vars) return vars[key];
    return match;
  });
}

/**
 * Pre-process Reddit search JSON into a clean, librarian-friendly Markdown
 * digest so the model spends its context on actual recommendations instead
 * of parsing the Listing wire format. Reddit's `search.json` and
 * `r/X/search.json` return a `Listing` with `data.children[].data` posts;
 * we surface the fields that matter for book scouting (subreddit, score,
 * title, selftext snippet, num_comments). All other text passes through.
 *
 * Returns null when the body isn't recognizable Reddit JSON, so the caller
 * can fall back to raw text.
 */
function maybeFormatRedditJson(url: string, body: string): string | null {
  if (!/reddit\.com\/.*\.json/i.test(url)) return null;
  let parsed: any;
  try { parsed = JSON.parse(body); } catch { return null; }
  const children = parsed?.data?.children;
  if (!Array.isArray(children)) return null;
  const posts = children
    .map((c: any) => c?.data)
    .filter((d: any) => d && (d.title || d.selftext))
    .slice(0, 25)
    .map((d: any, i: number) => {
      const subreddit = d.subreddit ? `r/${d.subreddit}` : '?';
      const score = typeof d.score === 'number' ? d.score : '?';
      const comments = typeof d.num_comments === 'number' ? d.num_comments : '?';
      const title = (d.title || '').replace(/\s+/g, ' ').trim();
      const body = (d.selftext || '').replace(/\s+/g, ' ').trim().slice(0, 600);
      return `${i + 1}. [${subreddit}] (${score}↑ ${comments}💬) "${title}"${body ? `\n   ${body}` : ''}`;
    });
  if (posts.length === 0) return null;
  return `Reddit thread digest (${posts.length} posts, top-by-score):\n\n${posts.join('\n\n')}`;
}

/**
 * Pre-process a Reddit comment-tree JSON into a clean, librarian-friendly
 * digest. Reddit's `/r/X/comments/{post-id}.json` returns a 2-element array:
 *   [0] = the post itself (single-item Listing)
 *   [1] = the comments tree (Listing of comments + nested replies)
 *
 * We surface the top-level comments by score, drop deleted/removed bodies,
 * and trim each to 500 chars. The post title gets prepended so the librarian
 * has context for the comments without needing to cross-reference.
 *
 * This is the GOLD signal for "what real readers say about books in this
 * niche" — much richer than post titles + selftext alone, which often just
 * pose the question without the answers.
 */
function formatRedditCommentTree(commentJson: string, opts: { postTitle: string; postScore?: number; subreddit?: string }): string | null {
  let parsed: any;
  try { parsed = JSON.parse(commentJson); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length < 2) return null;
  const commentChildren = parsed[1]?.data?.children;
  if (!Array.isArray(commentChildren)) return null;

  const comments = commentChildren
    .map((c: any) => c?.data)
    .filter((d: any) => d && typeof d.body === 'string' && d.body !== '[deleted]' && d.body !== '[removed]' && d.body.trim().length >= 10)
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10)
    .map((d: any, i: number) => {
      const score = typeof d.score === 'number' ? d.score : '?';
      const text = d.body.replace(/\s+/g, ' ').trim().slice(0, 500);
      return `   ${i + 1}. (${score}↑) ${text}`;
    });

  if (comments.length === 0) return null;
  const subPrefix = opts.subreddit ? `[r/${opts.subreddit}] ` : '';
  const scoreSuffix = typeof opts.postScore === 'number' ? ` (${opts.postScore}↑)` : '';
  return `Post: ${subPrefix}"${opts.postTitle}"${scoreSuffix}\n${comments.join('\n')}`;
}

/**
 * Given a Reddit listing JSON (top.json or search.json), fetch the comment
 * trees of the top N most-substantive posts and return a single digest of
 * "what readers actually said." Substantive = has a permalink + at least
 * `minComments` comments + score above zero.
 *
 * Fetches are done in PARALLEL via `direct` networkPath (no browser cost,
 * no rate limit — Reddit JSON allows ~60 req/min unauthenticated).
 * Returns null if the input isn't a recognizable listing or if no
 * substantive posts qualify.
 */
async function enrichRedditWithComments(
  listingJson: string,
  opts: { topN?: number; minComments?: number; fetchFn: (url: string) => Promise<{ text: string; ok: boolean }> },
): Promise<string | null> {
  let parsed: any;
  try { parsed = JSON.parse(listingJson); } catch { return null; }
  const children = parsed?.data?.children;
  if (!Array.isArray(children)) return null;

  const topN = opts.topN ?? 3;
  const minComments = opts.minComments ?? 5;

  const candidates = children
    .map((c: any) => c?.data)
    .filter((d: any) =>
      d && d.permalink && (d.num_comments ?? 0) >= minComments && (d.score ?? 0) > 0,
    )
    .sort((a: any, b: any) => (b.num_comments ?? 0) - (a.num_comments ?? 0))
    .slice(0, topN);

  if (candidates.length === 0) return null;

  const fetches = await Promise.all(candidates.map(async (post: any) => {
    const commentUrl = `https://www.reddit.com${post.permalink}.json?limit=20&depth=1&sort=top`;
    const fr = await opts.fetchFn(commentUrl);
    if (!fr.ok) return null;
    return formatRedditCommentTree(fr.text, {
      postTitle: post.title || '?',
      postScore: post.score,
      subreddit: post.subreddit,
    });
  }));

  const digests = fetches.filter((d): d is string => !!d);
  if (digests.length === 0) return null;
  return `Reader comment trees (top ${digests.length} posts from this listing):\n\n${digests.join('\n\n---\n\n')}`;
}

/**
 * Pre-process OpenLibrary JSON into a clean Markdown digest. Two endpoint
 * shapes are supported:
 *   - /subjects/{slug}.json  →  { name, work_count, works: [{title, authors:[{name}], first_publish_year, subject, ratings_average, ratings_count}] }
 *   - /search.json?q=…       →  { numFound, docs: [{title, author_name:[], first_publish_year, subject, ratings_count}] }
 *
 * Both get reduced to a one-line-per-book digest that the librarian can scan
 * without parsing JSON. Returns null for non-OL URLs so the caller falls back
 * to raw text.
 */
function maybeFormatOpenLibraryJson(url: string, body: string): string | null {
  if (!/openlibrary\.org\//i.test(url)) return null;
  let parsed: any;
  try { parsed = JSON.parse(body); } catch { return null; }

  // /subjects/{slug}.json shape
  if (Array.isArray(parsed?.works)) {
    const total = parsed.work_count ?? parsed.works.length;
    const lines = parsed.works.slice(0, 20).map((w: any, i: number) => {
      const title = (w.title || '?').replace(/\s+/g, ' ').trim();
      const authors = Array.isArray(w.authors) ? w.authors.map((a: any) => a?.name).filter(Boolean).join(', ') : '?';
      const year = w.first_publish_year ?? '?';
      const rating = typeof w.ratings_average === 'number' ? w.ratings_average.toFixed(2) : '—';
      const rc = w.ratings_count ?? '?';
      const subj = Array.isArray(w.subject) ? w.subject.slice(0, 5).join(' · ') : '';
      return `${i + 1}. "${title}" — ${authors} (${year}) | ★${rating} (${rc}) | ${subj}`;
    });
    return `OpenLibrary subject "${parsed.name || '?'}" digest (work_count=${total}, showing ${lines.length}):\n\n${lines.join('\n')}`;
  }

  // /search.json shape (handled in next branch)
  if (Array.isArray(parsed?.docs)) {
    const total = parsed.numFound ?? parsed.docs.length;
    const lines = parsed.docs.slice(0, 12).map((d: any, i: number) => {
      const title = (d.title || '?').replace(/\s+/g, ' ').trim();
      const authors = Array.isArray(d.author_name) ? d.author_name.join(', ') : '?';
      const year = d.first_publish_year ?? '?';
      const rc = d.ratings_count ?? '?';
      const subj = Array.isArray(d.subject) ? d.subject.slice(0, 5).join(' · ') : '';
      return `${i + 1}. "${title}" — ${authors} (${year}) | ratings=${rc} | ${subj}`;
    });
    return `OpenLibrary search digest (numFound=${total}, showing ${lines.length}):\n\n${lines.join('\n')}`;
  }

  return null;
}

/**
 * Pre-process a Goodreads search HTML page into a clean digest. Goodreads
 * has the richest reader-side metadata of any source we hit: real ratings,
 * ratings counts (often 6+ figure for popular books), and the "Want to
 * Read" shelf-count signal that Amazon and OpenLibrary don't expose.
 *
 * Each result row is a `<tr itemtype="http://schema.org/Book">` block.
 * We extract title, author, rating + count + year (from the `minirating`
 * span — "4.21 avg rating — 184,250 ratings — published 2002"), and the
 * Goodreads work-id path (`/book/show/12345.title-slug`) so downstream
 * steps can deep-link to specific books.
 *
 * Returns null for non-Goodreads URLs.
 */
function maybeFormatGoodreadsSearch(url: string, body: string): string | null {
  if (!/goodreads\.com\/search/i.test(url)) return null;
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
  const bookRe = /<tr[^>]*itemtype="http:\/\/schema\.org\/Book"[\s\S]+?<\/tr>/gi;
  const rows: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = bookRe.exec(body)) !== null && rows.length < 20) {
    const block = m[0];
    const titleMatch = block.match(/<a[^>]+class="bookTitle"[\s\S]*?<span[^>]+itemprop="name"[^>]*>([\s\S]{1,300}?)<\/span>/i);
    const title = titleMatch ? stripTags(titleMatch[1]).slice(0, 200) : '?';
    const authorMatch = block.match(/<a[^>]+class="authorName"[\s\S]*?<span[^>]+itemprop="name"[^>]*>([\s\S]{1,200}?)<\/span>/i);
    const author = authorMatch ? stripTags(authorMatch[1]).slice(0, 100) : '?';
    // Goodreads wraps the rating in nested spans:
    //   <span class="minirating">
    //     <span class="stars staticStars">...star pip spans...</span>
    //     3.94 avg rating — 9,240 ratings
    //   </span>
    //   —
    //   published
    //   1986
    // We can't rely on the immediate-content regex (it lands inside the
    // nested star span). Instead we scan the WHOLE result row for the
    // "N.NN avg rating — N,NNN ratings" / "published YYYY" patterns
    // directly — they're stable wherever the page restructures them.
    const ratingMatch  = block.match(/(\d\.\d{1,2})\s*avg\s*rating[\s\S]{1,120}?([0-9,]+)\s*ratings?/i);
    const ratingNum    = ratingMatch?.[1] || '—';
    const ratingsCount = ratingMatch?.[2]?.replace(/,/g, '') || '—';
    const year         = block.match(/published[\s\S]{0,60}?(\d{4})/i)?.[1] || '—';
    const linkMatch = block.match(/href="(\/book\/show\/[^"&]+)"/);
    const grId = linkMatch ? linkMatch[1].match(/^\/book\/show\/([^.]+)/)?.[1] || '—' : '—';
    rows.push(`| ${title.replace(/\|/g, '\\|')} | ${author.replace(/\|/g, '\\|')} | ${year} | ${ratingNum} | ${ratingsCount} | gr:${grId} |`);
  }
  if (rows.length === 0) return null;
  return [
    `Goodreads search digest (${rows.length} books — STRUCTURED, copy fields verbatim into compTitles):`,
    ``,
    `| Title | Author | Year | Rating | RatingsCount | GR-ID |`,
    `|-------|--------|------|--------|--------------|-------|`,
    ...rows,
  ].join('\n');
}

/**
 * Pre-process an Amazon search HTML page into a clean Markdown digest of
 * product blocks. Amazon ships ~1.2MB of HTML per search page, but the
 * useful signal is just the data-asin result cards: title, author, format,
 * price, rating, review count. We slice the HTML around each `data-asin=`
 * marker, strip tags from a window after it, and harvest the bits we want.
 *
 * Returns null for non-Amazon URLs so the caller can fall back to the
 * generic stripHtml path.
 *
 * This is regex-based on purpose: cheerio would be cleaner but adds a
 * runtime dep, and Amazon's markup is stable enough at the `data-asin`
 * grain that regex is sufficient for what we need.
 */
function maybeFormatAmazonSearch(url: string, body: string): string | null {
  if (!/amazon\.[a-z.]+\/s\?/i.test(url)) return null;
  // Amazon's search-result cards are <div> elements with BOTH `data-asin` and
  // `data-component-type="s-search-result"`, but attribute order varies. We
  // match each anchor independently and intersect the offsets so we only
  // count real result blocks (not the duplicate ASIN markers in inner <a>s).
  const resultBlockRe = /<div\s[^>]*data-component-type="s-search-result"[^>]*>/gi;
  const seen = new Set<string>();
  const hits: Array<{ asin: string; offset: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = resultBlockRe.exec(body)) !== null && hits.length < 25) {
    const blockOpen = m[0];
    const asinM = blockOpen.match(/data-asin="([A-Z0-9]{10})"/);
    if (!asinM) continue;
    if (seen.has(asinM[1])) continue;
    seen.add(asinM[1]);
    hits.push({ asin: asinM[1], offset: m.index });
  }
  if (hits.length === 0) return null;

  const stripTags = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  const items = hits.map(({ asin, offset }, i) => {
    // ~6KB window per card is enough to capture title + author + price + rating.
    const slice = body.slice(offset, offset + 6_000);
    // Title is in an h2 a span — pull the first one.
    const titleMatch = slice.match(/<h2[^>]*>[\s\S]{0,200}?<span[^>]*>([\s\S]{1,400}?)<\/span>/i);
    const title = titleMatch ? stripTags(titleMatch[1]) : '?';
    // Author appears as "by AUTHOR" near rwLabel "Author" or as `<a class="...">AUTHOR</a>`
    const authorMatch = slice.match(/<a class="a-size-base[^"]*"[^>]*>([\s\S]{1,150}?)<\/a>/i)
                     ?? slice.match(/by\s+(?:<span[^>]*>)?([A-Z][A-Za-z\.\-'\s]{2,80})/i);
    const author = authorMatch ? stripTags(authorMatch[1]) : '?';
    // Format (Kindle / Paperback / Hardcover) often appears as a label.
    const fmtMatch = slice.match(/>\s*(Kindle\s*(?:Edition|Unlimited)?|Paperback|Hardcover|Audible\s*Audiobook|MP3 CD)\s*</i);
    const format = fmtMatch ? fmtMatch[1].trim() : '?';
    // Price — Amazon's search-result cards use TWO common layouts:
    //   (a) `<span class="a-offscreen">$13.99</span>` (or "GBP13.51" on UK)
    //   (b) `<span class="a-price-whole">13</span><span class="a-price-fraction">99</span>`
    // We try the offscreen variant first (it includes the currency symbol so
    // we don't have to assume USD), then fall back to the split-span layout.
    const offMatch = slice.match(/<span class="a-offscreen">\s*((?:[£€$¥₹₽]|GBP|USD|EUR|CAD|AUD|JPY|INR)\s*[0-9]+[.,][0-9]{1,2})\s*<\/span>/i);
    let price: string;
    if (offMatch) {
      price = offMatch[1].trim();
    } else {
      const wholeMatch = slice.match(/class="a-price-whole">([0-9,]+)/);
      const fracMatch = slice.match(/class="a-price-fraction">([0-9]+)/);
      price = wholeMatch ? `$${wholeMatch[1]}${fracMatch ? '.' + fracMatch[1] : ''}` : '?';
    }
    // Rating + review count from aria labels.
    const ratingMatch = slice.match(/(\d\.\d)\s*out of 5 stars/i);
    const reviewsMatch = slice.match(/>\s*([0-9,]{1,12})\s*</);  // brittle but often correct for the rating-link
    const rating = ratingMatch ? ratingMatch[1] : '—';
    const reviews = reviewsMatch ? reviewsMatch[1].replace(/,/g, '') : '?';
    // Cover thumbnail URL — Amazon's `s-image` class is the result-card cover.
    // The URL has a fixed media-amazon CDN host and a size suffix; we keep the
    // raw URL so Cover Trends Scout can list it for the user. Amazon may put
    // the canonical URL in `src`, `data-src` (lazy-load), or `srcset` (retina);
    // we try all three so we don't miss thumbnails just because the page is
    // configured for lazy-loading.
    const imgUrlRe = /https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9._\-+]+\.(?:jpg|png|webp)/i;
    let coverUrl = '';
    const sImgMatch = slice.match(/<img[^>]+class="s-image"[^>]*>/i);
    if (sImgMatch) {
      const m = sImgMatch[0].match(imgUrlRe);
      if (m) coverUrl = m[0];
    }
    // Fallback: any /images/I/ URL inside the card's first 8KB.
    if (!coverUrl) {
      const broad = slice.match(imgUrlRe);
      if (broad) coverUrl = broad[0];
    }
    return `${i + 1}. [${asin}] "${title}" — ${author} | ${format} | ${price} | ★${rating} (${reviews} reviews)${coverUrl ? `\n   cover: ${coverUrl}` : ''}`;
  });
  return `Amazon search digest (${items.length} results parsed from page):\n\n${items.join('\n')}`;
}

/**
 * Pre-process an Amazon product page (/dp/{ASIN}) into a clean structured
 * digest. Amazon product HTML is ~1.5MB of nav/recommendations/scripts but
 * the data a KDP author actually needs is small:
 *   - Title, author, format, price
 *   - Rating + review count
 *   - **BSR + categories** (the holy grail — what this book is ranked in)
 *   - Description / blurb (for hook-pattern analysis)
 *   - **Customers Also Bought ASINs** (AMS targeting goldmine)
 *
 * Regex-based on purpose (no DOM parser) — Amazon's product page markup is
 * verbose but the field anchors (productTitle, bookDescription_feature_div,
 * Best Sellers Rank label) are stable enough to grep against. Best-effort:
 * missing fields render as "?" / "—" rather than failing the whole extract.
 */
function maybeFormatAmazonProduct(url: string, body: string): string | null {
  const asinFromUrl = url.match(/\/dp\/([A-Z0-9]{10})/i)?.[1];
  if (!asinFromUrl) return null;
  if (!/amazon\.[a-z.]+\/(?:.*\/)?dp\//i.test(url)) return null;

  const stripTags = (s: string) => s
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // ── Title ────────────────────────────────────────────────────────────
  const titleMatch = body.match(/<span\s+id="productTitle"[^>]*>([\s\S]{1,500}?)<\/span>/i);
  const title = titleMatch ? stripTags(titleMatch[1]).slice(0, 200) : '?';

  // ── Author ───────────────────────────────────────────────────────────
  // Amazon's book byline structure is consistent: a `<span class="author...">`
  // wrapper containing the contributor anchor, OR an `id="bylineInfo"` block.
  // The older `contributorNameID` class only appears on some genre pages now,
  // so we keep it as a fallback but lead with the byline span/id selectors
  // which match current markup.
  const authorMatch = body.match(/<span\s+class="author[^"]*"[\s\S]{1,400}?<a[^>]*>([^<]{1,80})<\/a>/i)
                  ?? body.match(/id="bylineInfo"[\s\S]{1,500}?<a[^>]*>([^<]{1,80})<\/a>/i)
                  ?? body.match(/<a[^>]+contributorNameID[^>]*>([^<]{1,80})<\/a>/i)
                  ?? body.match(/<a class="(?:contributorNameID|a-link-normal contributorNameID)"[^>]*>([\s\S]{1,200}?)<\/a>/i);
  const author = authorMatch ? stripTags(authorMatch[1]) : '?';

  // ── Format (Kindle / Paperback / Hardcover etc.) ─────────────────────
  const fmtMatch = body.match(/<span\s+class="slot-title"[\s\S]{1,200}?>([^<]{2,30})<\/span>/i)
                ?? body.match(/>(Kindle\s*(?:Edition|Unlimited|eBook)?|Paperback|Hardcover|Audible\s*(?:Audiobook|Original)?|Mass Market Paperback|Audio CD|Library Binding|Spiral-bound)\s*</i);
  const format = fmtMatch ? stripTags(fmtMatch[1]).trim() : '?';

  // ── Price ────────────────────────────────────────────────────────────
  // Amazon renders prices many different ways:
  //   - `a-offscreen` carries the canonical visible price as plain text
  //   - `a-price-whole` + `a-price-fraction` split the price across spans
  //   - Audible audiobooks show credits/subscription instead of $$
  //   - Kindle Unlimited titles can be borrowed instead of bought
  //   - Out-of-print / unavailable titles have no price at all
  // When no traditional $ price is found, fall through a chain of format-
  // specific labels so the KDP author sees "Audible Audiobook" instead of
  // a blank "?".
  // Amazon serves prices in the viewer's locale currency. UK IP → GBP, US IP
  // → USD, etc. We accept any standard currency prefix (symbol or 3-letter
  // code) so the extractor works regardless of where Perry's exit IP lands.
  // First `a-offscreen` is sometimes empty whitespace, so we iterate matches
  // and take the first one with actual digits.
  const offscreenRe = /<span class="a-offscreen">\s*([^<]+?)\s*<\/span>/g;
  let priceText = '';
  let offMatch: RegExpExecArray | null;
  while ((offMatch = offscreenRe.exec(body)) !== null) {
    const candidate = offMatch[1];
    if (/(?:[£€$¥₹₽]|GBP|USD|EUR|CAD|AUD|JPY|INR)\s*[0-9]+[.,][0-9]{1,2}/i.test(candidate)) {
      priceText = candidate;
      break;
    }
  }
  // Fallback: split price span (whole/fraction). Cover books that have no
  // canonical .a-offscreen rendering on the current page layout.
  const splitMatch = !priceText
    ? body.match(/class="a-price-whole">([0-9,]+)<\/span>(?:<[^>]+>)*<span class="a-price-fraction">([0-9]+)/i)
    : null;
  let price: string;
  if (priceText) {
    price = priceText;
  } else if (splitMatch) {
    price = `$${splitMatch[1]}.${splitMatch[2]}`;
  } else if (/Read for Free|Included with (?:Audible|Kindle\s*Unlimited)|"isKU":\s*true/i.test(body)) {
    price = 'Free with KU';
  } else if (/Audible Audiobook|audibleaudiobook|"format":\s*"Audible/i.test(body)) {
    price = 'Audible (credits)';
  } else if (/Kindle Unlimited/i.test(body)) {
    price = 'KU-eligible';
  } else if (/Currently unavailable|Out of Print|Temporarily out of stock/i.test(body)) {
    price = '(unavailable)';
  } else {
    price = '?';
  }

  // ── Rating + reviews ─────────────────────────────────────────────────
  const ratingMatch = body.match(/(\d\.\d)\s*out of 5 stars/i);
  const reviewsMatch = body.match(/id="acrCustomerReviewText"[^>]*>([0-9,]+)/i)
                   ?? body.match(/(\d[\d,]*)\s*(?:global\s*)?ratings?/i);
  const rating = ratingMatch ? ratingMatch[1] : '—';
  const reviews = reviewsMatch ? reviewsMatch[1] : '?';

  // ── BSR + categories ─────────────────────────────────────────────────
  // The "Best Sellers Rank" block lists ranks across multiple categories.
  // We capture ~2KB after the label and pull out every "#N in CATEGORY" pair.
  const bsrBlock = body.match(/Best Sellers Rank[\s\S]{0,3000}/i)?.[0] || '';
  const bsrStripped = stripTags(bsrBlock).slice(0, 1500);
  const rankRe = /#([\d,]+)\s+in\s+([\w &;,'\-()]+?)(?=\s*\(|\s*#|$)/g;
  const ranks: string[] = [];
  let rm: RegExpExecArray | null;
  while ((rm = rankRe.exec(bsrStripped)) !== null && ranks.length < 8) {
    const rank = rm[1].replace(/,/g, '');
    const cat = rm[2].trim().slice(0, 80);
    if (rank && cat) ranks.push(`#${rank} in ${cat}`);
  }

  // ── Description / Blurb ──────────────────────────────────────────────
  const descMatch = body.match(/<div\s+id="bookDescription_feature_div"[\s\S]*?<\/div>/i);
  const blurb = descMatch ? stripTags(descMatch[0]).slice(0, 2_000).trim() : '?';

  // ── Customers Also Bought ASINs ──────────────────────────────────────
  // Several carousel containers may exist. We scan the whole body for ASINs
  // appearing in /dp/ links AFTER the "Customers who" or "Customers also"
  // text anchor, skipping the focal book's own ASIN.
  const alsoBoughtRegion = body.match(/(?:Customers (?:who bought|also bought|also viewed)[\s\S]{0,80_000})/i)?.[0] || '';
  const alsoAsins: string[] = [];
  const dpRe = /\/dp\/([A-Z0-9]{10})/g;
  let dm: RegExpExecArray | null;
  while ((dm = dpRe.exec(alsoBoughtRegion)) !== null && alsoAsins.length < 12) {
    const a = dm[1];
    if (a === asinFromUrl) continue;
    if (!alsoAsins.includes(a)) alsoAsins.push(a);
  }

  return [
    `Amazon product deep dive — ASIN ${asinFromUrl}`,
    `Title: "${title}"`,
    `Author: ${author}`,
    `Format: ${format} | Price: ${price} | ★${rating} (${reviews} reviews)`,
    ``,
    `BSR + Categories:`,
    ranks.length > 0 ? ranks.map(r => `  ${r}`).join('\n') : '  (not extracted — manual lookup needed)',
    ``,
    `Description / Blurb:`,
    blurb || '(not extracted)',
    ``,
    `Customers Also Bought (top ${alsoAsins.length} ASINs):`,
    alsoAsins.length > 0 ? alsoAsins.join(', ') : '(no carousel detected)',
  ].join('\n');
}

export interface StepRunnerConfig {
  workspaceDir: string;
  maxRetries: number;
  minResponseLength: number;
}

export class StepRunner {
  private router: AIRouter;
  private stateStore: StateStore;
  private promptBuilder: PromptBuilder;
  private eventBus: EventBus;
  private log: Logger;
  private config: StepRunnerConfig;

  private mcpClient: McpClientService;

  // Consumer side of producer→librarian→consumer for director skills.
  // Skills landed at `workspace/skills-installed/director/` describe
  // remedies for recurring `(task_type, error_fingerprint)` failure
  // patterns. Loaded on a TTL so newly-promoted skills come into effect
  // without restart.
  private directorSkills: import('@perry/core').LoadedSkill[] = [];
  private directorSkillsLoadedAt = 0;
  private readonly DIRECTOR_SKILLS_TTL_MS = 60_000;

  // Extracted services
  private povGate: PovQualityGate;
  private continuityGate: ContinuityGate;
  private revisionGate: RevisionGate;
  private dedup: DeduplicationService;
  private sanitizer: ProseSanitizer;
  private styleDna: StyleDnaService;
  private autoLearning: AutoLearningService;
  /** Public accessor for MCP-facing routes. */
  public getAutoLearning(): AutoLearningService { return this.autoLearning; }
  private costTracker: CostTracker;

  constructor(
    router: AIRouter,
    stateStore: StateStore,
    promptBuilder: PromptBuilder,
    eventBus: EventBus,
    log: Logger,
    config: StepRunnerConfig,
    mcpClient: McpClientService,
  ) {
    this.router = router;
    this.stateStore = stateStore;
    this.promptBuilder = promptBuilder;
    this.eventBus = eventBus;
    this.log = log;
    this.config = config;
    this.mcpClient = mcpClient;

    // Initialize extracted services
    const styleDna = new StyleDnaService(stateStore, log.child('style-dna'), config.workspaceDir);
    this.styleDna = styleDna;
    this.autoLearning = new AutoLearningService(config.workspaceDir, styleDna, log.child('auto-learn'), stateStore);
    this.povGate = new PovQualityGate(log.child('pov-gate'), eventBus, stateStore, styleDna);
    this.continuityGate = new ContinuityGate(log.child('continuity-gate'), eventBus, stateStore, config.workspaceDir);
    this.revisionGate = new RevisionGate(log.child('revision-gate'), eventBus, stateStore);
    this.dedup = new DeduplicationService(log.child('dedup'), eventBus);
    this.sanitizer = new ProseSanitizer();
    this.costTracker = new CostTracker(
      { maxPerProject: 0, maxGlobal: 0 }, // Unlimited by default — configure via config
      log.child('cost'),
      eventBus,
    );

    // Director self-learning: emit standardised learning:* events for the
    // framework-wide LearningCore to aggregate + propose against. No
    // per-service SkillProposer wiring lives here anymore — pure event emit.
    this.attachDirectorLearningEmitter();

    // Consumer side — initial load of any promoted director skills.
    this.refreshDirectorSkills();
  }

  private refreshDirectorSkills(): void {
    try {
      this.directorSkills = loadInstalledSkills(this.config.workspaceDir, 'director');
      this.directorSkillsLoadedAt = Date.now();
      if (this.directorSkills.length > 0) {
        this.log.info('StepRunner loaded director skills', { count: this.directorSkills.length });
      }
    } catch (err: any) {
      this.log.warn('refreshDirectorSkills failed', { error: err.message });
      this.directorSkills = [];
    }
  }

  /**
   * Look up any installed director skill that matches the current step's
   * failure context. Returns the first matching skill, or null. Called from
   * the step retry/failure paths so a promoted skill can override defaults.
   */
  private findDirectorSkillForFailure(taskType: string, errorFingerprint: string): import('@perry/core').LoadedSkill | null {
    if (Date.now() - this.directorSkillsLoadedAt > this.DIRECTOR_SKILLS_TTL_MS) {
      this.refreshDirectorSkills();
    }
    for (const s of this.directorSkills) {
      const w = s.appliesWhen;
      if (!w) continue;
      const taskMatch = !w.task_type || w.task_type === '*' || w.task_type === taskType;
      const errMatch = !w.error_fingerprint || w.error_fingerprint === '*' || w.error_fingerprint === errorFingerprint;
      if (taskMatch && errMatch) {
        this.log.info('Director skill applied', { skill: s.name, task_type: taskType, error_fingerprint: errorFingerprint });
        this.eventBus.emit('learning:observation', {
          source: 'director',
          kind: 'skill-applied',
          fingerprint: `${s.name}::${taskType}::${errorFingerprint}`,
          value: 1,
          metadata: { skill: s.name, task_type: taskType, error_fingerprint: errorFingerprint },
        });
        return s;
      }
    }
    return null;
  }

  /**
   * Translate step lifecycle events into learning:* taxonomy events. This
   * replaces the previous bespoke producer code: LearningCore subscribes,
   * aggregates by (source, kind, fingerprint), and proposes skills when
   * thresholds cross. Same outcome, framework-shared bookkeeping.
   */
  private attachDirectorLearningEmitter(): void {
    this.eventBus.on('step:failed', (ev: any) => {
      try {
        const { projectId, stepId, error } = ev as { projectId: string; stepId: string; error: string };
        if (!error) return;
        // Must pass projectId — step IDs are NOT unique across projects
        // (composite PK is project_id + id). Bare lookup returns wrong taskType.
        const taskType = this.stateStore.findStepTaskType?.(projectId, stepId) ?? 'unknown';
        this.eventBus.emit('learning:failure', {
          source: 'director',
          kind: 'step-fail',
          fingerprint: `${taskType}::${error}`,
          error,
          metadata: { taskType, stepId, projectId },
        });
      } catch (err: any) {
        this.log.warn('director learning-emit failed', { error: err.message });
      }
    });

    this.eventBus.on('step:completed', (ev: any) => {
      try {
        const { projectId, stepId } = ev as { projectId: string; stepId: string; result: string };
        const taskType = this.stateStore.findStepTaskType?.(projectId, stepId) ?? 'unknown';
        this.eventBus.emit('learning:success', {
          source: 'director',
          kind: 'step-complete',
          fingerprint: taskType,
          metadata: { stepId, projectId },
        });
      } catch (err: any) {
        this.log.warn('director learning-emit (success) failed', { error: err.message });
      }
    });
  }

  /**
   * Cleans up any in-memory state for a project (e.g., budget carry-forward).
   */
  clearProjectState(projectId: string): void {
    this.promptBuilder.clearProjectBudget(projectId);
  }

  /**
   * Execute a single step. Returns the completion result.
   *
   * Pipeline:
   * 1. Mark step as active
   * 2. Select AI provider (tier routing)
   * 3. Build prompt (via PromptBuilder + BudgetManager + Librarian)
   * 4. Send to AI with retry logic
   * 5. Validate response (length, format)
   * 6. Save result to state store + disk
   * 7. Emit step:completed event
   */
  async execute(project: Project, step: ProjectStep): Promise<string> {
    this.log.info('Executing step', {
      project: project.title,
      step: step.label,
      taskType: step.taskType,
    });

    if (Date.now() - this.directorSkillsLoadedAt > this.DIRECTOR_SKILLS_TTL_MS) {
      this.refreshDirectorSkills();
    }
    const appliedSkills = this.directorSkills.filter(s => {
      const w = s.appliesWhen;
      if (!w) return false;
      return !w.task_type || w.task_type === '*' || w.task_type === step.taskType;
    });
    const startTime = Date.now();

    // 1. Mark step as active
    this.stateStore.startStep(project.id, step.id);
    this.eventBus.emit('step:started', { projectId: project.id, stepId: step.id });
    this.eventBus.emit('step:progress', {
      projectId: project.id,
      stepId: step.id,
      message: `Starting: ${step.label}`,
    });

    let result: string | null = null;
    try {
    let lastError: Error | null = null;

    // ── ComfyUI image generation (no LLM needed) ──────────────────────────────
    if (step.taskType === 'comfyui_generate') {
      this.log.info('Executing ComfyUI image generation step');
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: 'Connecting to ComfyUI...',
      });

      const comfyui = new ComfyUIService();

      // Check health first
      const healthy = await comfyui.isHealthy();
      if (!healthy) {
        const errMsg = 'ComfyUI is not reachable. Ensure the comfyui container is running and healthy.';
        this.stateStore.failStep(project.id, step.id, errMsg);
        this.eventBus.emit('step:failed', { projectId: project.id, stepId: step.id, error: errMsg });
        throw new Error(errMsg);
      }

      // Find the most recently completed step whose result looks like JSON
      const prevStep = [...project.steps]
        .reverse()
        .find(s => s.id !== step.id && s.status === 'completed' && s.result?.trim().startsWith('{'));

      let comfyParams: Record<string, any> = {};
      if (prevStep?.result) {
        try {
          // Strip markdown fences if the LLM wrapped its output
          const cleaned = prevStep.result
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```\s*$/i, '')
            .trim();
          comfyParams = JSON.parse(cleaned);
        } catch {
          this.log.warn('ComfyUI step: could not parse prior step JSON, using defaults');
        }
      }

      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: 'Clearing VRAM: Unloading LLMs...',
      });

      // --- VRAM FLUSH ---
      // Ollama might be holding a massive model (like Gemma 31B) on the GPU.
      // We must unload it to make room for FLUX.1-dev.
      await this.flushOllamaVram();
      // ------------------

      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: 'P.E.R.R.Y. System: I\'m loaded and ready for the director and painter... (Generating Artwork)',
      });

      const genResult = await comfyui.generateBookCover({
        positive_prompt: comfyParams.positive_prompt ?? `Professional book cover for "${project.title}", ${project.description?.slice(0, 200)}`,
        negative_prompt: comfyParams.negative_prompt ?? 'text, watermark, title, letters, blurry, low quality, deformed, ugly',
        backend:      comfyParams.backend      ?? 'flux',
        flux_unet:    comfyParams.flux_unet    ?? undefined,
        flux_clip_l:  comfyParams.flux_clip_l  ?? undefined,
        flux_clip_t5: comfyParams.flux_clip_t5 ?? undefined,
        flux_vae:     comfyParams.flux_vae     ?? undefined,
        checkpoint:   comfyParams.checkpoint   ?? undefined,
        layout:       comfyParams.layout       ?? 'cover',
        width:  comfyParams.dimensions?.width  ?? comfyParams.width  ?? 832,
        height: comfyParams.dimensions?.height ?? comfyParams.height ?? 1216,
        cfg_scale: comfyParams.cfg_scale ?? undefined,
        steps:     comfyParams.steps ?? comfyParams.recommended_steps ?? undefined,
        sampler:   comfyParams.sampler   ?? undefined,
        scheduler: comfyParams.scheduler ?? undefined,
        lora_name: comfyParams.lora_name ?? undefined,
        lora_strength: comfyParams.lora_strength ?? undefined,
        reference_image: comfyParams.reference_image ? join(this.config.workspaceDir, comfyParams.reference_image.replace(/^workspace\//, '')) : undefined,
        denoise: comfyParams.denoise ?? undefined,
        upscale_model: comfyParams.upscale_model ?? undefined,
      });

      if (!genResult.success || !genResult.imageBuffer) {
        const errMsg = genResult.error ?? 'ComfyUI generation failed with no error detail';
        this.stateStore.failStep(project.id, step.id, errMsg);
        this.eventBus.emit('step:failed', { projectId: project.id, stepId: step.id, error: errMsg });
        throw new Error(errMsg);
      }

      // Save the image to workspace/images/
      const { mkdir: mkdirAsync, writeFile: writeFileAsync } = await import('fs/promises');
      const imagesDir = join(this.config.workspaceDir, 'images');
      await mkdirAsync(imagesDir, { recursive: true });
      const outFilename = genResult.filename ?? `cover-${project.id}-${Date.now()}.png`;
      const outPath = join(imagesDir, outFilename);
      await writeFileAsync(outPath, genResult.imageBuffer);

      result = [
        `## Book Cover Generated ✓`,
        ``,
        `- **File**: \`${outPath}\``,
        `- **Filename**: ${outFilename}`,
        `- **ComfyUI prompt_id**: ${genResult.promptId ?? 'unknown'}`,
        `- **Dimensions**: ${comfyParams.dimensions?.width ?? 832}×${comfyParams.dimensions?.height ?? 1216}`,
        ``,
        `The cover image has been saved to the workspace images directory.`,
        `You can find it at: \`workspace/images/${outFilename}\``,
      ].join('\n');

      this.log.info('ComfyUI base artwork generated', { file: outPath });
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: `Base artwork saved: ${outFilename}`,
      });
    } else

    // ── Network Research (fetch URLs → librarian extracts structured data) ──
    //
    // Self-contained handler for `taskType: 'network_research'`. Bypasses the
    // long retry/segmentation pipeline since research steps are short. Reads
    // `step.networkRequests`, fetches all URLs in parallel via NetworkClient,
    // strips HTML, concatenates into a context block, then asks the librarian
    // model (gemma3:12b on the 5070 Ti) to extract the data the step's
    // `prompt` describes.
    //
    // Used by book-planning research steps so they consume live web data
    // instead of hallucinating from the writer model's training cutoff.
    if (step.taskType === 'network_research') {
      this.log.info('Executing network_research step', { label: step.label });
      this.eventBus.emit('step:progress', {
        projectId: project.id, stepId: step.id,
        message: 'Fetching network sources...',
      });

      let requests = step.networkRequests || [];
      if (requests.length === 0) {
        const errMsg = 'network_research step has no networkRequests configured';
        this.stateStore.failStep(project.id, step.id, errMsg);
        this.eventBus.emit('step:failed', { projectId: project.id, stepId: step.id, error: errMsg });
        throw new Error(errMsg);
      }

      // ── Concept-keyword substitution ───────────────────────────────────
      // If a prior step produced JSON like { primaryQuery, altQueries: [] },
      // substitute {{primaryQuery}}, {{altQuery1}}, etc. into each URL and
      // URL-encode the values. This lets templates use placeholder URLs and
      // have them resolved at run time from an upstream "Concept Keywords"
      // step's output, instead of being baked in at project creation time.
      const conceptVars = findConceptKeywords(project) ?? {};
      // Merge top-ASIN placeholders so URL templates like /dp/{{asin1}} can
      // address each comp ASIN extracted from prior step results. ASINs are
      // 10-char alphanumeric and URL-safe, so they ride the standard path
      // regardless of PATH_SAFE_VARS.
      const topAsins = findTopAsins(project, 5);
      topAsins.forEach((a, i) => { conceptVars[`asin${i + 1}`] = a; });
      let resolvedPrompt = step.prompt;
      if (Object.keys(conceptVars).length > 0) {
        this.log.info('network_research: vars resolved', { vars: Object.keys(conceptVars), asinCount: topAsins.length });
        requests = requests.map(req => ({
          ...req,
          url: substituteTemplateVars(req.url, conceptVars),
          label: req.label ? substituteTemplateVarsRaw(req.label, conceptVars) : req.label,
        }));
        // Drop any request whose URL still has unresolved `{{…}}` placeholders
        // (e.g. asin4 wasn't available because we only had 3 prior ASINs).
        // Fetching a literal `{{asin4}}` URL would just 404 noisily.
        const beforeFilter = requests.length;
        requests = requests.filter(req => !/\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/.test(req.url));
        if (requests.length < beforeFilter) {
          this.log.info('network_research: dropped requests with unresolved placeholders', {
            dropped: beforeFilter - requests.length, kept: requests.length,
          });
        }

        // Reddit needs EITHER OAuth (REDDIT_CLIENT_ID) OR a residential proxy
        // (REDDIT_PROXY → TorGuard tunnel). With neither, reddit.com returns
        // 500/403 to anonymous datacenter requests since June 2024 — skip to
        // avoid 30s timeouts and a misleading "FAILED: HTTP 500" in the report.
        // NetworkClient auto-routes Reddit via REDDIT_PROXY when set, so the
        // proxy path is fully transparent to the rest of this code.
        // Reddit needs EITHER OAuth (vault `reddit_client_id` or env REDDIT_CLIENT_ID)
        // OR a residential proxy (REDDIT_PROXY / REDDIT_PROXY_POOL). Vault check
        // first so post-bootstrap deployments don't need .env to keep this on.
        const hasRedditCreds =
          (this.router.config as any).vault?.has?.('reddit_client_id') ||
          !!process.env.REDDIT_CLIENT_ID;
        if (!hasRedditCreds && !process.env.REDDIT_PROXY && !process.env.REDDIT_PROXY_POOL) {
          const beforeReddit = requests.length;
          requests = requests.filter(req => !/(?:^|\.)reddit\.com\//i.test(req.url));
          if (requests.length < beforeReddit) {
            this.log.info('network_research: skipped Reddit sources (no REDDIT_CLIENT_ID or REDDIT_PROXY)', {
              dropped: beforeReddit - requests.length, kept: requests.length,
            });
          }
        }
        // Substitute placeholders in the step prompt too — templates may
        // include `{{primaryQuery}}` etc. in the prompt body (e.g. the
        // Keyword Reality Check candidate-row table), and we want the
        // librarian to see the resolved query strings, not literal braces.
        resolvedPrompt = substituteTemplateVarsRaw(step.prompt, conceptVars);
      }

      // Short-circuit if every source for this step was filtered out (typically
      // a Reddit-only step like Subgenre Trend Pulse when REDDIT_CLIENT_ID is
      // unset). Skipping the librarian call avoids a confusing "NO LIVE DATA:
      // 0/0 sources" report and gives downstream synthesis a clear "step
      // skipped" signal it can route around.
      if (requests.length === 0) {
        this.log.info('network_research step skipped: all sources filtered out', { label: step.label });
        result = [
          `## ⚠ STEP SKIPPED — no available sources`,
          ``,
          `Every source for this step was filtered out before fetch. The most`,
          `common cause is Reddit sources being skipped because neither`,
          `REDDIT_CLIENT_ID nor REDDIT_PROXY is set (Reddit blocks anonymous`,
          `datacenter IPs since June 2024). Set REDDIT_PROXY to a residential`,
          `tunnel (e.g. http://gluetun-torguard-uk:8888) or wire Reddit OAuth.`,
        ].join('\n');
        // Skip the model call entirely — `result` is set, step will close as completed with this output.
      } else {

      const fetches = await Promise.all(requests.map(async req => {
        const fr = await NetworkClient.fetch(req.url, {
          networkPath: (req.networkPath as NetworkPath) || 'direct',
          // 24h cache on network_research fetches. Reddit /top, OpenLibrary
          // subject feeds, Amazon search results, and Amazon product pages
          // are stable enough at the day-scale that re-fetching adds no
          // signal — but caching avoids ~80% of the Amazon rate-limit
          // pressure and makes re-runs of a project near-instant.
          cacheTtlMs: 24 * 60 * 60 * 1000,
        });
        // Reddit JSON gets reformatted into a Markdown digest of posts so the
        // Reddit JSON, OpenLibrary JSON, and Amazon search HTML each get
        // reformatted into a Markdown digest so the librarian sees clean
        // structured rows instead of raw wire format. Whichever formatter
        // matches first wins; falls through to raw / stripped on any other
        // URL or unparseable body. Amazon's formatter runs on HTML so it's
        // tried regardless of rawBody (the HTML wouldn't survive stripHtml
        // intact enough to extract ASIN/price blocks).
        let digest = fr.ok
          ? (maybeFormatRedditJson(req.url, fr.text)
              ?? maybeFormatOpenLibraryJson(req.url, fr.text)
              ?? maybeFormatAmazonSearch(req.url, fr.text)
              ?? maybeFormatAmazonProduct(req.url, fr.text)
              ?? maybeFormatGoodreadsSearch(req.url, fr.text))
          : null;
        // For book-planning research, ENRICH Reddit /top.json + /search.json
        // responses with the comment trees of the top posts. The post titles
        // alone are weak signal ("Books like X?"); the COMMENTS are where
        // readers actually describe what they liked/hated. Three extra fetches
        // per Reddit listing, parallelised via `direct` networkPath (Reddit
        // JSON doesn't need browser stealth + has generous rate limits).
        if (fr.ok && digest && (project.type as string) === 'book-planning' &&
            /reddit\.com\/r\/.*\/(?:top|search)\.json/i.test(req.url)) {
          const enrichment = await enrichRedditWithComments(fr.text, {
            topN: 3,
            minComments: 5,
            fetchFn: async (url: string) => {
              const r = await NetworkClient.fetch(url, {
                networkPath: 'direct',
                cacheTtlMs: 24 * 60 * 60 * 1000,
              });
              return { text: r.text, ok: r.ok };
            },
          });
          if (enrichment) {
            digest = `${digest}\n\n${enrichment}`;
            this.log.info('Reddit comment-tree enrichment applied', {
              label: step.label,
              url: req.url,
              addedChars: enrichment.length,
            });
          }
        }
        const rawProcessed = digest ?? (req.rawBody ? fr.text : NetworkClient.stripHtml(fr.text));
        const maxChars = req.maxChars ?? 20_000;
        const truncated = rawProcessed.length > maxChars ? rawProcessed.slice(0, maxChars) + '\n[... truncated ...]' : rawProcessed;
        return { req, fr, body: truncated };
      }));

      const successCount = fetches.filter(f => f.fr.ok).length;
      const bytesTotal = fetches.reduce((a, f) => a + f.body.length, 0);
      this.log.info('network_research fetches done', {
        requested: requests.length, success: successCount, bytesTotal,
      });
      this.eventBus.emit('step:progress', {
        projectId: project.id, stepId: step.id,
        message: `Fetched ${successCount}/${requests.length} sources, sending to librarian...`,
      });

      // Hallucination guard: if the total fetched payload is too small (e.g.
      // every source returned 0 bytes / a challenge page / an error body), the
      // model will fabricate plausible-looking output from its training data
      // and the downstream steps will consume that as "ground truth". Better
      // to fail loudly here so the user knows to fix the sources.
      const MIN_BYTES_FOR_MODEL = 500;
      if (bytesTotal < MIN_BYTES_FOR_MODEL) {
        this.log.warn('network_research: insufficient fetched data, refusing model call to avoid hallucination', { bytesTotal, threshold: MIN_BYTES_FOR_MODEL });
        result = [
          `## ⚠ NO LIVE DATA AVAILABLE`,
          ``,
          `All fetched sources returned empty bodies, error pages, or anti-bot challenges.`,
          `The librarian was NOT called — model output on empty input would be hallucinated.`,
          ``,
          `**Successful fetches:** ${successCount}/${requests.length}`,
          `**Total bytes received:** ${bytesTotal} (threshold ${MIN_BYTES_FOR_MODEL})`,
          ``,
          `### Sources attempted`,
          ...fetches.map((f, i) => {
            const label = f.req.label || f.req.url;
            const verdict = f.fr.ok ? `HTTP ${f.fr.status} (${f.body.length} chars after strip)` : `FAILED: HTTP ${f.fr.status}`;
            return `- ${label}: ${verdict}`;
          }),
          ``,
          `**Likely causes:**`,
          `- Status 500/403 on Reddit = anti-bot IP block (datacenter IPs blocked since 2024). Needs OAuth or proxy.`,
          `- Tiny response on OpenLibrary = query too niche; broaden the subject keywords.`,
          `- Tiny response on Amazon = the search term yielded <5 results page-1; broaden it.`,
          `- HTTP 200 with empty body on Goodreads = anti-bot challenge fired despite stealth.`,
        ].join('\n');
        this.log.info('network_research step short-circuited (empty data)', { label: step.label });
        // Skip the model call entirely — `result` is set, step will close as completed with this output.
      } else {

      const contextBlock = fetches.map((f, i) => {
        const label = f.req.label || f.req.url;
        const header = `=== SOURCE ${i + 1}: ${label} (${f.fr.networkPath}, HTTP ${f.fr.status}, ${f.body.length} chars) ===`;
        return f.fr.ok ? `${header}\n${f.body}` : `${header}\n[fetch failed: ${f.fr.text}]`;
      }).join('\n\n');

      // Route extraction:
      //   - Book-planning network_research → RESEARCHER (5090, qwen3.6:27b).
      //     The bigger model reliably emits all sections of the structured
      //     markdown the prompt asks for — gemma3-class librarians drop the
      //     Amazon ASIN section under load. Trades ~5s of model-swap cost
      //     against the writer LoRA for substantially better extraction.
      //   - All other network_research → LIBRARIAN (5070 Ti, qwen3:14b).
      //     Smaller, cheaper, no contention with the writer.
      const isBookPlanningResearch = (project.type as string) === 'book-planning';
      const useWorkersForResearch = this.shouldUseWorkersForResearch(project, step);

      const researcher = (isBookPlanningResearch && !useWorkersForResearch) ? this.router.getProvider('researcher') : null;
      const librarian = this.router.getProvider('librarian');
      const provider = researcher ?? librarian ?? this.router.selectProvider(step.taskType, project.preferredProvider);
      this.log.info('network_research provider selected', {
        provider: useWorkersForResearch ? 'workers' : provider.id,
        model: useWorkersForResearch ? '<external>' : provider.model,
        reason: useWorkersForResearch
          ? 'book-planning research → workers (Claude/Gemini via task_pool)'
          : (researcher ? 'book-planning research → researcher (5090, larger model)' : 'librarian (default for extraction)'),
      });

      // ── JSON-then-render path for steps with deterministic schemas ────
      // For steps the librarian has historically drifted on (multi-section
      // markdown with strong training-data priors), we replace the freeform
      // prompt with a short "emit JSON matching this schema" instruction,
      // use Ollama's grammar-constrained sampling to enforce the shape, and
      // render the JSON to markdown server-side. The model can't drift to
      // its "Notable Reader-Curated Lists" defaults if the only legal
      // output is the schema's exact shape.
      const isLiveCompTitleScout = step.label === 'Live Comp Title Scout' && (project.type as string) === 'book-planning';

      let userContent: string;
      let outputFormat: any = undefined;
      if (isLiveCompTitleScout) {
        userContent =
          `Extract comp-title data from the fetched sources below into a strict JSON object. The schema is enforced — your response MUST match exactly:\n\n` +
          `- compTitles: array of up to 12 books. Each: { title, author, year, rating, ratingsCount, asin, sourceCitations[] }. ALL string fields; use "—" when the source genuinely lacks that field. sourceCitations is an array of source numbers as strings, e.g. ["1","5"]. Every compTitle MUST have at least one sourceCitation.\n` +
          `- genreTags: array of up to 15 genre/subject tags appearing across sources. ONLY include tags that literally appear as text in the fetched sources.\n` +
          `- tropes: array of up to 12 reader-facing tropes / themes. Each trope MUST be a phrase or theme actually visible in a Reddit post title, selftext, or comment in the FETCHED SOURCES below. If Source 3 (Reddit) returned an error / anti-bot challenge / empty payload, return an EMPTY tropes array. Do NOT infer tropes from the book title, premise, or your own training data. Phrases the model invents (e.g. "circuit-rye", "server hum", "data-ghosts") are NOT valid tropes.\n` +
          `- mostDiscussed: array of up to 10 books mentioned BY NAME in Reddit comment threads. Each: { title, author?, threadTitle }. If Source 3 (Reddit) failed, return an EMPTY array. Do NOT include books mentioned only in your training data.\n\n` +
          `CRITICAL — populate rating + ratingsCount fields:\n` +
          `- The GOODREADS source (look for "Goodreads search digest" header) ships as a STRUCTURED MARKDOWN TABLE with explicit Rating + RatingsCount columns. Copy those values VERBATIM into the matching compTitle's rating + ratingsCount strings. This is the single highest-value data in this step.\n` +
          `- If the same title appears in both Goodreads and OpenLibrary, prefer the GOODREADS row (it has reader-side ratings; OL doesn't).\n` +
          `- Amazon search digest has ★rating (reviews) — also valid for the rating field if Goodreads doesn't have the book.\n` +
          `- ASIN comes from Amazon search source (the bracketed [B0XXXXX] / [10-digit] prefix on each row).\n\n` +
          `Pull from ALL FIVE sources. Do NOT invent titles or numbers — if a field is genuinely absent, use "—".\n\n` +
          `Title context (for relevance filtering): "${project.title}"\n\n` +
          `--- FETCHED SOURCES ---\n\n${contextBlock}`;
        outputFormat = LIVE_COMP_TITLE_SCOUT_SCHEMA;
      } else {
        userContent = `${resolvedPrompt}\n\n--- FETCHED SOURCES ---\n\n${contextBlock}`;
      }

      const networkResearchSystemPrompt = [
          'You are a careful data-extraction assistant working over scraped web sources (Reddit threads, OpenLibrary JSON, DuckDuckGo HTML, etc.).',
          '',
          'WHAT COUNTS AS A VALID EXTRACTION:',
          '- Book titles, author names, genre tags, tropes, and recommendations mentioned ANYWHERE in the data — in thread titles, post bodies (selftext), comments, JSON fields like "subject" or "name", or page text. Reddit and search results are conversational/messy; treat any clear mention as valid.',
          '- If a Reddit thread is titled "Books like Hyperion?" and the body mentions Endymion, both are valid extractions.',
          '- If OpenLibrary returns a `docs` array with title+author_name fields, those are first-class extractions.',
          '',
          'WHAT NOT TO DO:',
          '- NEVER fill in details from your training data alone. Every extracted item must trace to text actually present in the sources.',
          '- If a SPECIFIC field of an extracted item is missing (e.g. you found a title but no year), write "—" for just that field — do NOT skip the whole row.',
          '- If a section of the requested output has zero source evidence, output an empty list/table for that section. Do not fabricate.',
          '',
          'OUTPUT:',
          '- Match the user prompt\'s requested structure exactly.',
          '- Cite the source number in square brackets where useful, e.g. [1], [2].',
          '- Your job is to surface what\'s actually in the sources, not to be paranoid about every word.',
        ].join('\n');

      const response = useWorkersForResearch
        ? await this.runResearchAssistTask({
            project, step,
            systemPrompt: networkResearchSystemPrompt,
            userContent,
          })
        : await this.router.complete({
            provider: provider.id,
            system: networkResearchSystemPrompt,
            messages: [{ role: 'user', content: userContent }],
            maxTokens: this.router.getOutputBudget('research'),
            temperature: 0.2,
            penSlug: (project.context as any).penNameSlug,
            format: outputFormat,
          });

      // For JSON-mode steps, parse + render to markdown. For free-form
      // steps, the raw text IS the result.
      if (isLiveCompTitleScout) {
        const rawJson = response.text?.trim() || '{}';
        const cleaned = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        try {
          const parsed = JSON.parse(cleaned);
          result = renderLiveCompTitleScout(parsed);
          this.log.info('Live Comp Title Scout: JSON parsed + rendered', {
            compsCount: parsed?.compTitles?.length ?? 0,
            tagsCount: parsed?.genreTags?.length ?? 0,
          });
        } catch (err: any) {
          this.log.warn('Live Comp Title Scout: JSON parse failed, falling back to raw text', { error: err?.message });
          result = response.text || '(no content returned by extractor model)';
        }
      } else {
        result = response.text || '(no content returned by extractor model)';
      }

      // ── Auto-append: ASIN extraction from Amazon search digests ──────────
      // Models routinely DROP the "Amazon Top-Page-1 ASINs" section the
      // prompt asks for (Qwen3-family has strong markdown priors that win
      // over instructions). Without that section, findTopAsins finds 0
      // ASINs and the downstream Amazon Product Deep Dive short-circuits.
      // Server-side extraction guarantees ASINs flow regardless of the
      // librarian's section-header compliance — we scan the FETCHED
      // sources directly (the maybeFormatAmazonSearch digest format
      // contains `[ASIN]` markers per result card) and append a
      // deterministic ASIN footer to every network_research output that
      // had an Amazon search source.
      const asinsFromDigests = new Set<string>();
      for (const f of fetches) {
        if (!/amazon\.[a-z.]+\/s\?/i.test(f.req.url)) continue;
        const asinRe = /\[([A-Z0-9]{10})\]/g;
        let m: RegExpExecArray | null;
        while ((m = asinRe.exec(f.body)) !== null) {
          if (/^(B0|[0-9])/.test(m[1])) asinsFromDigests.add(m[1]);
        }
      }
      if (asinsFromDigests.size > 0) {
        result += `\n\n## Amazon Top-Page-1 ASINs (auto-extracted)\n${[...asinsFromDigests].join(', ')}`;
        this.log.info('network_research: auto-appended ASINs to result', {
          label: step.label, asinCount: asinsFromDigests.size,
        });
      }

      this.log.info('network_research step complete', { label: step.label, resultLen: result.length });
      }
      } // close: else (requests.length > 0)
    } else

    // ── Text Overlay (Back Cover Summary via Jimp) ──────────────────────────────────
    if (step.taskType === 'text_overlay') {
      this.log.info('Executing text overlay step for back cover summary');
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: 'Compositing summary text onto artwork...',
      });

      // Find the most recent comfyui_generate step
      const artStep = [...project.steps].reverse().find(s => s.taskType === 'comfyui_generate' && s.status === 'completed' && s.result);
      const fileMatch = artStep?.result?.match(/\*\*File\*\*:\s*`([^`]+)`/);
      const artworkPath = fileMatch?.[1];

      if (!artworkPath) {
        throw new Error('Could not find base artwork from FLUX generation step.');
      }

      // Find the back cover summary text
      const summaryStep = [...project.steps].reverse().find(s => s.taskType === 'creative_writing' && s.status === 'completed' && s.result);
      if (!summaryStep?.result) {
        throw new Error('Could not find generated back cover summary.');
      }
      
      const summaryText = summaryStep.result.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

      const { readFile: readFileAsync, writeFile: writeFileAsync, copyFile: copyFileAsync } = await import('fs/promises');
      const { createCanvas, loadImage } = require('canvas');
      
      // 1. EBOOK VARIANT (Raw Front Cover)
      const ebookPath = artworkPath.replace('.png', '-ebook-cover.png');
      await copyFileAsync(artworkPath, ebookPath);

      // 2. KDP PAPERBACK WRAP VARIANT
      const imgBuf = await readFileAsync(artworkPath);
      const img = await loadImage(imgBuf);
      
      const spineWidth = 200; // ~300 pages at 6x9
      const wrapWidth = (img.width * 2) + spineWidth;
      const wrapHeight = img.height;

      const canvas = createCanvas(wrapWidth, wrapHeight);
      const ctx = canvas.getContext('2d');
      
      // Front Cover (Right side)
      ctx.drawImage(img, img.width + spineWidth, 0);

      // Back Cover (Left side) - Mirrored, Darkened, Blurred
      ctx.save();
      ctx.translate(img.width, 0);
      ctx.scale(-1, 1);
      // ctx.filter = 'blur(15px) brightness(40%)'; // Unsupported in node-canvas
      ctx.globalAlpha = 0.4; // Simulates brightness darkening
      ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = 1.0;
      ctx.restore();

      // Spine (Center)
      ctx.fillStyle = '#151515';
      ctx.fillRect(img.width, 0, spineWidth, wrapHeight);

      // Spine Text
      ctx.save();
      ctx.translate(img.width + (spineWidth / 2), wrapHeight / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const spineText = `${project.title}        ${(project.context as any)?.penName || 'P.E.R.R.Y.'}`;
      ctx.fillText(spineText, 0, 0);
      ctx.restore();

      // Back Cover Summary Typography
      const margin = 100;
      const maxWidth = img.width - (margin * 2);
      
      ctx.fillStyle = '#ffffff';
      const fontSelection = (project.context as any)?.coverFont || 'Serif (Georgia)';
      const fontFamily = fontSelection.includes('Sans') ? '"Helvetica Neue", Helvetica, Arial, sans-serif' : '"Georgia", serif';
      ctx.font = `36px ${fontFamily}`;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.textAlign = 'left';
      
      const paragraphs = summaryText.split('\n').map(p => p.trim()).filter(p => p !== '');
      let y = margin + 80;
      
      for (const p of paragraphs) {
        const cleanP = p.replace(/\*\*/g, ''); // strip markdown bolding for canvas
        const words = cleanP.split(' ');
        let line = '';
        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + ' ';
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxWidth && n > 0) {
            ctx.fillText(line, margin, y);
            line = words[n] + ' ';
            y += 50; // line height
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line, margin, y);
        y += 80; // paragraph spacing
      }

      // 3. LOGO BRANDING (Neural Weaver)
      try {
        const logoPath = 'd:/n8n/perry/packages/ai/assets/imprint-logo.png';
        const logoBuf = await readFileAsync(logoPath);
        const logoImg = await loadImage(logoBuf);
        
        // Create a temporary canvas to tint the white logo
        const logoCanvas = createCanvas(logoImg.width, logoImg.height);
        const lctx = logoCanvas.getContext('2d');
        lctx.drawImage(logoImg, 0, 0);
        lctx.globalCompositeOperation = 'source-in';
        lctx.fillStyle = (project.context as any)?.brandColor || '#00d2ff';
        lctx.fillRect(0, 0, logoImg.width, logoImg.height);
        
        // Stamp on Spine (Bottom)
        const logoSize = 100;
        const logoX = img.width + (spineWidth / 2) - (logoSize / 2);
        const logoY = wrapHeight - logoSize - 80;
        ctx.drawImage(logoCanvas, logoX, logoY, logoSize, logoSize);
        
        // Stamp on Back Cover (Bottom Right)
        const bLogoSize = 80;
        const bLogoX = img.width - bLogoSize - 60;
        const bLogoY = wrapHeight - bLogoSize - 60;
        ctx.drawImage(logoCanvas, bLogoX, bLogoY, bLogoSize, bLogoSize);
        
      } catch (e: any) {
        this.log.warn('Could not load imprint logo, skipping branding', { error: e.message });
      }
      
      const wrapPath = artworkPath.replace('.png', '-paperback-wrap.png');
      const buffer = canvas.toBuffer('image/png');
      await writeFileAsync(wrapPath, buffer);

      result = [
        `## Book Cover Variants Complete ✓`,
        ``,
        `- **eBook Cover**: \`${ebookPath}\``,
        `- **KDP Paperback Wrap**: \`${wrapPath}\``,
        ``,
        `Both the eBook cover and full print wrap have been successfully generated!`
      ].join('\n');
      
      this.log.info('Cover variants generated', { ebook: ebookPath, wrap: wrapPath });
    } else

    // ── Qwen2.5-VL text rendering + marketing layout ───────────────────────────
    if (step.taskType === 'qwen_text_render') {
      this.log.info('Executing Qwen text rendering step');
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: 'Finding base artwork from FLUX generation step...',
      });

      // Find the most recent comfyui_generate step that has a result
      const artStep = [...project.steps]
        .reverse()
        .find(s => s.taskType === 'comfyui_generate' && s.status === 'completed' && s.result);

      // Parse the file path from that step's result markdown
      const fileMatch = artStep?.result?.match(/\*\*File\*\*:\s*`([^`]+)`/);
      const artworkPath = fileMatch?.[1];

      if (!artworkPath) {
        const errMsg = 'Qwen text render: could not find base artwork from FLUX generation step.';
        this.stateStore.failStep(project.id, step.id, errMsg);
        this.eventBus.emit('step:failed', { projectId: project.id, stepId: step.id, error: errMsg });
        throw new Error(errMsg);
      }

      // Also get the params JSON from the prompt engineering step for title/author/tagline
      const paramsStep = [...project.steps]
        .reverse()
        .find(s => s.taskType === 'creative_writing' && s.status === 'completed' && s.result?.trim().startsWith('{'));
      let coverMeta: Record<string, any> = {};
      if (paramsStep?.result) {
        try {
          const cleaned = paramsStep.result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
          coverMeta = JSON.parse(cleaned);
        } catch { /* use defaults */ }
      }

      const { readFile: readFileAsync, writeFile: writeFileAsync2, mkdir: mkdirAsync2 } = await import('fs/promises');
      const imageBuffer = await readFileAsync(artworkPath);

      const qwen = new QwenTextRenderService();
      const imagesDir2 = join(this.config.workspaceDir, 'images');
      await mkdirAsync2(imagesDir2, { recursive: true });

      const savedFiles: string[] = [];
      const layouts: Array<'cover' | 'banner' | 'square'> = ['cover'];
      const variants: string[] = coverMeta.marketing_variants ?? [];
      if (variants.includes('banner')) layouts.push('banner');
      if (variants.includes('square')) layouts.push('square');

      for (const layout of layouts) {
        this.eventBus.emit('step:progress', {
          projectId: project.id, stepId: step.id,
          message: `Qwen rendering: ${layout} layout...`,
        });

        // For non-cover layouts, regenerate artwork at the right dimensions first
        let srcBuffer: any = imageBuffer;
        if (layout !== 'cover') {
          this.eventBus.emit('step:progress', {
            projectId: project.id, stepId: step.id,
            message: `P.E.R.R.Y. System: I'm loaded and ready for the director and painter... (Generating ${layout} variant)`,
          });
          
          // --- VRAM FLUSH ---
          await this.flushOllamaVram();
          // ------------------

          const comfyui2 = new ComfyUIService();
          const variantGen = await comfyui2.generateBookCover({
            positive_prompt: coverMeta.positive_prompt ?? `Book cover art for "${project.title}"`,
            negative_prompt: coverMeta.negative_prompt ?? 'text, watermark, blurry',
            backend:      coverMeta.backend      ?? 'flux',
            flux_unet:    coverMeta.flux_unet    ?? undefined,
            flux_clip_l:  coverMeta.flux_clip_l  ?? undefined,
            flux_clip_t5: coverMeta.flux_clip_t5 ?? undefined,
            flux_vae:     coverMeta.flux_vae     ?? undefined,
            layout,
          });
          if (variantGen.success && variantGen.imageBuffer) {
            srcBuffer = variantGen.imageBuffer;
          }
        }

        const renderResult = await qwen.renderText({
          imageBuffer: srcBuffer,
          title:  coverMeta.title  ?? project.title,
          author: coverMeta.author ?? 'P.E.R.R.Y.',
          series:  coverMeta.series  ?? undefined,
          tagline: coverMeta.tagline ?? undefined,
          layout,
        });

        if (!renderResult.success || !renderResult.imageBuffer) {
          this.log.warn('Qwen text render failed for layout, saving raw artwork', { layout, error: renderResult.error });
          // Save raw artwork without text rather than failing entirely
          const rawName = `perry-${layout}-${project.id}-raw.png`;
          await writeFileAsync2(join(imagesDir2, rawName), srcBuffer);
          savedFiles.push(rawName);
        } else {
          const suffix = layout === 'cover' ? 'final' : layout;
          const outName = `perry-${suffix}-${project.id}.png`;
          await writeFileAsync2(join(imagesDir2, outName), renderResult.imageBuffer);
          savedFiles.push(outName);
          this.log.info('Text rendered successfully', { layout, file: outName });
        }
      }

      result = [
        `## Book Cover Production Complete ✓`,
        ``,
        `### Generated Files`,
        ...savedFiles.map(f => `- \`workspace/images/${f}\``),
        ``,
        `### Pipeline`,
        `- 🎨 **Artwork**: FLUX.1-dev via ComfyUI`,
        `- ✍️ **Text rendering**: Qwen2.5-VL placement analysis + Node canvas compositing`,
        `- 📐 **Layouts**: ${layouts.join(', ')}`,
        ``,
        `The KDP-ready cover is at \`workspace/images/perry-final-${project.id}.png\``,
      ].join('\n');

      this.eventBus.emit('step:progress', {
        projectId: project.id, stepId: step.id,
        message: `✓ All ${savedFiles.length} cover files generated`,
      });
    } else

    // Fast-path mechanical tasks (like compiling the manuscript)
    if (step.taskType === 'export') {
      this.log.info('Executing mechanical export task');
      let manuscript = `# ${project.title}\n\n`;
      
      // Order of chapters: Prologue -> Chapters -> Epilogue
      const exportSteps = project.steps.filter(s => s.taskType === 'creative_writing' && s.status === 'completed');
      
      const prologue = exportSteps.find(s => s.label === 'Prologue');
      if (prologue && prologue.result) {
        manuscript += `${prologue.result}\n\n* * *\n\n`;
      }
      
      const chapters = exportSteps.filter(s => s.chapterNumber !== undefined && s.chapterNumber > 0).sort((a, b) => a.chapterNumber! - b.chapterNumber!);
      // We need to pull the finalized chapters. If a chapter was segmented, its finalized form is in `draft_compile`.
      // Otherwise it's in `creative_writing`.
      const compiledChapters = project.steps.filter(s => s.taskType === 'draft_compile' && s.status === 'completed');

      // To handle both legacy non-segmented and new segmented projects:
      const processedChapters = new Set<number>();

      // Add compiled chapters
      for (const ch of compiledChapters) {
        if (ch.result && ch.chapterNumber) {
          if (ch.result.includes('P.E.R.R.Y. SYSTEM ALERT') || ch.result.includes('P.E.R.R.Y. System Alert') || ch.result.startsWith('BLOCKED')) {
            this.log.warn('Skipping corrupted compiled chapter in export', { stepId: ch.id });
            continue;
          }
          manuscript += `${ch.result}\n\n* * *\n\n`;
          processedChapters.add(ch.chapterNumber);
        }
      }

      // Add any non-segmented creative_writing chapters (legacy or 1-segment chapters)
      for (const ch of chapters) {
        if (ch.result && ch.chapterNumber && !processedChapters.has(ch.chapterNumber) && !ch.segmentIndex) {
          if (ch.result.includes('P.E.R.R.Y. SYSTEM ALERT') || ch.result.includes('P.E.R.R.Y. System Alert') || ch.result.startsWith('BLOCKED')) {
            this.log.warn('Skipping corrupted writing chapter in export', { stepId: ch.id });
            continue;
          }
          manuscript += `${ch.result}\n\n* * *\n\n`;
          processedChapters.add(ch.chapterNumber);
        }
      }
      
      const epilogue = exportSteps.find(s => s.label === 'Epilogue');
      if (epilogue && epilogue.result) {
        manuscript += `${epilogue.result}\n\n* * *\n\n`;
      }
      
      result = manuscript.trim();

      // Run ProseSanitizer on the final assembled manuscript.
      // FIX #15: Individual chapters are sanitized during draft_compile, but the export
      // step assembles them without a final clean pass. Any <think> tags, segment headers,
      // or LLM filler that survived individual sanitization will appear in the final export.
      result = this.sanitizer.sanitize(result);

      // Cross-chapter duplicate passage scan — runs once at compile time.
      // Detects sentences that appear verbatim in more than one chapter
      // and reports them as warnings before the manuscript is stored.
      this.dedup.scanForCrossChapterDuplicates(project, step, exportSteps);
    } else if (step.taskType === 'revision_compile') {
      this.log.info('Executing mechanical revision compile task', { chapter: step.chapterNumber });
      
      let compiledChapter = '';
      const segments = project.steps
        .filter(s => s.taskType === 'revision_execution' && s.chapterNumber === step.chapterNumber && s.status === 'completed' && s.result)
        .sort((a, b) => (a.segmentIndex || 0) - (b.segmentIndex || 0));

      for (const seg of segments) {
        if (!seg.result) continue;
        if (seg.result.includes('P.E.R.R.Y. SYSTEM ALERT') || seg.result.includes('P.E.R.R.Y. System Alert') || seg.result.startsWith('BLOCKED')) {
          this.log.warn('Skipping corrupted segment in revision compile', { stepId: seg.id });
          continue;
        }
        let text = this.sanitizer.stripSegmentHeaders(seg.result);
        text = this.sanitizer.sanitize(text);
        
        if (compiledChapter.length > 0) {
          const trimmedCompiled = compiledChapter.trimEnd();
          if (!trimmedCompiled.match(/[.!?:"'”]$/) && !trimmedCompiled.endsWith('⁂')) {
            compiledChapter = trimmedCompiled + ' ' + text + '\n\n';
          } else {
            compiledChapter = trimmedCompiled + '\n\n' + text + '\n\n';
          }
        } else {
          compiledChapter = `${text}\n\n`;
        }
      }
      
      result = compiledChapter.trim();
    } else if (step.taskType === 'draft_compile') {
      this.log.info('Executing mechanical draft compile task', { chapter: step.chapterNumber });
      
      let compiledChapter = '';
      const segments = project.steps
        .filter(s => s.taskType === 'creative_writing' && s.chapterNumber === step.chapterNumber && s.status === 'completed' && s.result)
        .sort((a, b) => (a.segmentIndex || 0) - (b.segmentIndex || 0));

      for (const seg of segments) {
        if (!seg.result) continue;
        if (seg.result.includes('P.E.R.R.Y. SYSTEM ALERT') || seg.result.includes('P.E.R.R.Y. System Alert') || seg.result.startsWith('BLOCKED')) {
          this.log.warn('Skipping corrupted segment in draft compile', { stepId: seg.id });
          continue;
        }
        let text = this.sanitizer.stripSegmentHeaders(seg.result);
        text = this.sanitizer.sanitize(text);

        if (compiledChapter.length > 0) {
          const trimmedCompiled = compiledChapter.trimEnd();
          if (!trimmedCompiled.match(/[.!?:"'”]$/) && !trimmedCompiled.endsWith('⁂')) {
            compiledChapter = trimmedCompiled + ' ' + text + '\n\n';
          } else {
            compiledChapter = trimmedCompiled + '\n\n' + text + '\n\n';
          }
        } else {
          compiledChapter = `${text}\n\n`;
        }
      }
      
      result = compiledChapter.trim();

      // ── Feature 3: POV Continuity Check ──────────────────────────────
      // For calibration compiles (2-segment scenes), detect if POV character
      // switched between Part 1 and Part 2 before the POV check runs.
      // Catches head-hopping BEFORE it wastes a POV check cycle.
      if ((project.type as string) === 'style-calibration' && segments.length === 2) {
        const part1 = segments[0]?.result || '';
        const part2 = segments[1]?.result || '';
        const povFracture = this.detectPovFracture(part1, part2);
        if (povFracture) {
          this.log.warn('POV FRACTURE detected at compile — character switched between Part 1 and Part 2', {
            chapter: step.chapterNumber,
            fracture: povFracture,
          });
          // Prepend a warning into the compiled result so the POV Check auditor sees it
          result = `[⚠️ AUTO-DETECTED POV FRACTURE: ${povFracture}. The POV character appears to have changed between Part 1 and Part 2. Grade this harshly on Deep POV.]

${result}`;
        }
      }


    } else {
      // 2. Select provider
      // Route specific calibration steps to the Librarian (gemma3:12b at temp 0.1)
      // instead of the writer model. Two cases need this:
      //  1. Cast Extraction — strict structured extraction. Magnum embellishes:
      //     picks 2-3 prominent Tier 1 POVs, demotes the rest, invents new names.
      //  2. POV Check (style-calibration) — strict grading. Magnum is also the
      //     writer here, so it rationalises its own filter words and gives itself
      //     PASS verdicts even when the prose contains "he stared" / "he felt".
      //     The librarian has no investment in the prose, so it grades honestly.
      const isCastExtraction = step.label === 'Cast Extraction' &&
        (project.type as string) === 'style-calibration' &&
        step.taskType === 'analysis';
      const isCalibrationPovCheck = step.taskType === 'pov_check' &&
        (project.type as string) === 'style-calibration';
      // Concept Keywords (book-planning preflight) — small JSON-emitting
      // extraction job. Routes to librarian both for deterministic output
      // and to dodge writer-GPU contention during LoRA training.
      const isConceptKeywords = (step.label === 'Concept Keywords' || step.label === 'KDP Concept Keywords') &&
        ((project.type as string) === 'book-planning' || (project.type as string) === 'amazon-kdp-launch');

      // Book-planning RESEARCH phase routes to the Researcher (5090 + qwen3.6:27b
      // by default) instead of the smaller librarian. The bigger model handles
      // multi-section markdown + JSON-schema adherence far better than gemma3
      // / qwen3:14b — exactly what the live-data scouts need for reliable
      // ASIN/BSR/blurb-hook extraction. The researcher shares the 5090 with
      // the writer LoRA; Ollama hot-swaps between them (~5s) when the project
      // transitions from research → premise/bible/writing.
      //
      // Concept Keywords still routes to researcher (it's part of the
      // research phase). KDP Concept Keywords stays on librarian (smaller
      // model, cheaper, less context contention with writer at launch time).
      const useWorkersForResearchBP = this.shouldUseWorkersForResearch(project, step);
      // Local-mode research routing scope: same as the workers predicate,
      // but ALSO covers all network_research steps (which need the
      // researcher provider's larger model). When workers mode is on,
      // the dispatch happens via shared helper; the predicate below
      // controls only the local-model fallback path.
      const isBookPlanningResearch = (project.type as string) === 'book-planning' &&
        (step.taskType === 'network_research' ||
         (step.label === 'Concept Keywords' && step.taskType === 'research') ||
         step.label === 'Market & Genre Analysis');
      const routeToResearcher = isBookPlanningResearch && !useWorkersForResearchBP;
      const researcherProvider = routeToResearcher ? this.router.getProvider('researcher') : null;

      const routeToLibrarian = !routeToResearcher && (isCastExtraction || isCalibrationPovCheck || isConceptKeywords);
      const librarianProvider = routeToLibrarian ? this.router.getProvider('librarian') : null;

      // ── Dynamic routing table (config-driven, model-agnostic) ──────────
      // The router maintains a taskType → target table merging defaults
      // with dashboard overrides. Hard-coded special-cases above
      // (researcher / librarian for specific labels) STILL win when they
      // match, so this is only consulted as a fallback.
      //
      //   target='writer'     → local ollama (the trained pen-name LoRA)
      //   target='librarian'  → 5070 Ti, qwen3:14b (small structured)
      //   target='researcher' → larger local research model
      //   target='workers'    → CLI subscription workers (Claude / Gemini
      //                         via research_assist task pool)
      //
      // When target='workers' and no special-case bound the step, the
      // execute path below diverts to runResearchAssistTask and skips the
      // local LLM tool loop entirely. Future model swaps (new writer LoRA,
      // larger librarian, etc.) only require changing the routing table —
      // no code changes here.
      const tableTarget = (researcherProvider || librarianProvider)
        ? null
        : this.router.resolveRoutingTarget(step.taskType);

      const provider = researcherProvider ?? librarianProvider ?? (() => {
        if (tableTarget === 'librarian' && this.router.getProvider('librarian')) return this.router.getProvider('librarian')!;
        if (tableTarget === 'researcher' && this.router.getProvider('researcher')) return this.router.getProvider('researcher')!;
        // For target='writer' or 'workers' we still need a provider object
        // for prompt-building budgets; workers branch overrides below.
        return this.router.selectProvider(step.taskType, project.preferredProvider);
      })();

      const routeToWorkers = !researcherProvider && !librarianProvider && tableTarget === 'workers';

      this.log.info('Provider selected', {
        provider: routeToWorkers ? 'workers' : provider.id,
        model: routeToWorkers ? '<external CLI>' : provider.model,
        routingTarget: tableTarget || (researcherProvider ? 'researcher' : 'librarian'),
        ...(isCastExtraction ? { reason: 'Cast Extraction routed to librarian for structured extraction' } : {}),
        ...(isCalibrationPovCheck ? { reason: 'Calibration POV check routed to librarian for unbiased grading' } : {}),
        ...(isConceptKeywords && !routeToResearcher ? { reason: 'Concept Keywords routed to librarian (KDP launch — cheaper, less writer contention)' } : {}),
        ...(routeToResearcher ? { reason: 'Book-planning research phase routed to researcher (5090, larger model)' } : {}),
        ...(routeToWorkers ? { reason: `Routing table sent ${step.taskType} → workers (offload from local GPU)` } : {}),
      });

      // 3. Build the system prompt
      let systemPrompt = this.buildSystemPrompt(project, step);
      // Qwen3-family models think by default. For schema-enforced
      // metadata-routing steps (Concept Keywords) the thinking phase
      // burns tokens and sometimes truncates the JSON output before all
      // required fields are emitted. `/no_think` is qwen3's documented
      // way to skip the thinking phase entirely — drops the call from
      // ~30s to ~5s and lets schema enforcement do its job.
      if (isConceptKeywords && (provider.id === 'researcher' || provider.id === 'librarian')) {
        systemPrompt = `/no_think\n\n${systemPrompt}`;
      }

      // 4. Build the user message (with budget management + compression)
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: `Building context (provider: ${routeToWorkers ? 'workers' : provider.name})...`,
      });

      // Get GPU pressure multiplier from the Context Watcher
      const compressionMultiplier = this.router.contextWatcher.getCompressionMultiplier();

      // For worker-routed steps, swap the provider config for a virtual
      // huge-context one. Claude / Gemini CLI workers natively handle 100k+
      // token contexts, so pre-compressing for the local writer's 32k
      // window is wasted librarian work. The virtual provider keeps the
      // same shape (model name, etc.) but exposes a 200k context window,
      // which tells the prompt-builder to include slots raw without
      // calling the librarian to summarize them.
      const buildProviderConfig = routeToWorkers
        ? { ...provider.providerConfig, contextWindow: 200_000, model: 'worker' }
        : provider.providerConfig;

      const { message, budgetReport } = await this.promptBuilder.build(
        project, step, buildProviderConfig, systemPrompt, compressionMultiplier,
        { skipCompression: routeToWorkers },
      );

      this.log.info('Budget report', {
        used: budgetReport.used,
        remaining: budgetReport.remaining,
        dropped: budgetReport.droppedSlots,
      });

      // ── Workers branch (routing table = 'workers') ──────────────────────
      // Dispatch to the CLI subscription workers (Claude / Gemini) via the
      // research_assist task pool, then short-circuit the local LLM tool
      // loop below by setting maxAttempts=0. Downstream finalize (strip
      // patterns, mojibake repair, polish trim, completeStep) still runs
      // on the worker's output. The async-quality-audit enqueue is auto-
      // skipped because it sits INSIDE the while-loop, and we never enter
      // the loop in this branch.
      if (routeToWorkers) {
        this.eventBus.emit('step:progress', {
          projectId: project.id, stepId: step.id,
          message: `Dispatching ${step.taskType} to external worker (Claude / Gemini)...`,
        });
        const wresp = await this.runResearchAssistTask({
          project, step,
          systemPrompt,
          userContent: message,
        });
        if (!wresp.text || wresp.text.trim().length === 0) {
          throw new Error(`Worker returned empty result for step "${step.label}"`);
        }
        // Set the outer-scope `result` directly; downstream finalize uses it.
        result = wresp.text;
        this.log.info('Step completed via workers', {
          step: step.label,
          taskType: step.taskType,
          length: result.length,
          wordCount: result.split(/\s+/).length,
        });
      }

      // 5. Send to AI with retry/continuation logic
      let currentMessage = message;
      let accumulatedText = '';
      let accumulatedTokens = 0;
      let accumulatedCost = 0;

      // Workers branch already set `result`; skip the local while-loop.
      const maxAttempts = routeToWorkers ? 0 : (this.config.maxRetries + 2);
      // Absolute iteration cap: prevents infinite loops when continuations and retries interact.
      // A step can accumulate up to maxContinuations (4) + maxAttempts iterations; cap hard at that sum.
      const MAX_TOTAL_ITERATIONS = maxAttempts + 4;
      let attempt = 1;
      let segmentCount = 1;
      let totalIterations = 0;

      while (attempt <= maxAttempts) {
        totalIterations++;
        if (totalIterations > MAX_TOTAL_ITERATIONS) {
          throw new Error(
            `[AUTO_RESET_REQUIRED] Step "${step.label}" exceeded absolute iteration cap (${MAX_TOTAL_ITERATIONS}). ` +
            `Possible infinite continuation loop. Auto-reset required.`
          );
        }
        try {
          this.eventBus.emit('step:progress', {
            projectId: project.id,
            stepId: step.id,
            message: segmentCount > 1 
              ? `Generating segment ${segmentCount}...`
              : `Generating (attempt ${attempt}/${maxAttempts})...`,
          });

          // Log exact prompt to SQLite telemetry before sending, for crash diagnostics
          this.stateStore.recordTelemetry(project.id, step.id, systemPrompt, currentMessage);

          // Reset accumulatedText for each NEW attempt (retry), but NOT during continuation passes.
          // Continuation is tracked by segmentCount > 1 — in that case we preserve accumulated text.
          if (segmentCount === 1) {
            accumulatedText = '';
          }

          const outputBudget = this.router.getOutputBudget(step.taskType);
          const thinking = this.router.getRecommendedThinking(step.taskType);

          const isCreativeStep = step.taskType === 'creative_writing' || step.taskType === 'revision_execution';

          // ── Temperature Staging ──────────────────────────────────────
          // Vary temperature by scene type instead of uniform 0.85.
          // This creates natural texture variation across chapters.
          let temperature = 0.7; // default for non-creative steps
          if (isCreativeStep) {
            temperature = this.getSceneTemperature(currentMessage, step);
          }
          // Cast Extraction needs deterministic extraction, not creative invention.
          // Pair with the librarian routing above so gemma3:12b reads the bible
          // verbatim and emits every Tier 1/2/3 entry without embellishing.
          if (step.label === 'Cast Extraction' && (project.type as string) === 'style-calibration') {
            temperature = 0.1;
          }
          // Calibration POV check also routes to librarian — use the same low
          // temperature to enforce strict, rule-following grading instead of
          // the writer's tendency to forgive its own prose.
          if (step.taskType === 'pov_check' && (project.type as string) === 'style-calibration') {
            temperature = 0.1;
          }
          // Concept Keywords preflight — JSON output, low temperature for
          // deterministic structured output.
          if (step.label === 'Concept Keywords' && (project.type as string) === 'book-planning') {
            temperature = 0.1;
          }

          // ── Context Watcher: Record estimated usage + inject hallucination guard ──
          const estimatedPromptTokens = Math.ceil((systemPrompt.length + currentMessage.length) / 3.0);
          // FIX #14: GPU label is now dynamic based on the selected provider, not hardcoded.
          // If planning/bible steps are ever routed to a different GPU, this tracks them correctly.
          const gpuLabel = provider.name || 'Writer (5090)';
          this.router.contextWatcher.recordPromptTokens(gpuLabel, estimatedPromptTokens);

          // FIX #9: getHallucinationWarning was being called with 2 args but only accepts 1.
          // This caused a silent runtime error (TS2554 was visible in tsc output) and the
          // guard NEVER fired. Now correctly called with 1 arg; creative-step scoping is
          // handled here at the call site instead of inside the method.
          const hallucinationWarning = this.router.contextWatcher.getHallucinationWarning(gpuLabel);
          let effectiveMessage = currentMessage;
          if (hallucinationWarning && isCreativeStep) {
            effectiveMessage = currentMessage + hallucinationWarning;
            this.log.warn('Hallucination guard injected — context near capacity', {
              percentFull: this.router.contextWatcher.getStats().gpus.find(g => g.label === gpuLabel)?.percentFull,
            });
          }

          // Negative-Pair Mining: prepend the upstream POV check verdict as a
          // DETERMINISTIC top-of-prompt block. The mining model was missing the
          // verdict line inside the compressed POV-check context slot and silently
          // skipping REVISE/REWRITE scenes. Now we parse the verdict in code from
          // the upstream pov_check step's result and stamp it at the top so it's
          // impossible to miss or paraphrase.
          if (step.label.includes('Negative-Pair Mining') && (project.type as string) === 'style-calibration') {
            const upstreamPov = project.steps.find(
              ps => ps.taskType === 'pov_check' &&
                    ps.chapterNumber === step.chapterNumber &&
                    ps.status === 'completed' &&
                    !!ps.result,
            );
            const verdictMatch = upstreamPov?.result?.match(/\*?\*?Verdict\*?\*?[:\s]+(PASS|REVISE|REWRITE)/i);
            const upstreamVerdict = verdictMatch?.[1]?.toUpperCase() || 'REVISE';
            const decision = upstreamVerdict === 'PASS'
              ? '- Verdict is **PASS**. Output exactly this line and stop: `No negative pairs to mine — verdict was PASS.`'
              : `- Verdict is **${upstreamVerdict}**. You MUST proceed with mining per the JSON contract below. Do NOT emit the skip line under any circumstances.`;
            const verdictBlock =
              `## UPSTREAM POV CHECK VERDICT (DETERMINISTIC — DO NOT RE-INTERPRET)\n\n` +
              `The Pass ${step.chapterNumber ? Math.floor(step.chapterNumber / 100) : '?'} POV check for this scene returned: **${upstreamVerdict}**\n\n` +
              `This value was parsed directly from the upstream POV Quality Gate step. It is authoritative.\n\n` +
              `DECISION:\n${decision}\n\n` +
              `${'─'.repeat(60)}\n\n`;
            effectiveMessage = verdictBlock + effectiveMessage;
            this.log.info('Negative-Pair Mining: deterministic verdict injected', {
              step: step.label,
              upstreamVerdict,
              chapterNumber: step.chapterNumber,
            });
          }

          // ── Dynamic Outline Structure Constraints ──
          if (['Chapter Outline', 'Chapter-by-Chapter Outline', 'Tension Blueprint', 'Scene-Level Breakdown'].includes(step.label)) {
            const targetChs = (project.context as any).targetChapters || 25;
            const structureConstraint =
              `\n\nCRITICAL ANTI-HALLUCINATION PROTOCOL:\n` +
              `You MUST strictly follow the exact structure of the project. You are required to generate data for exactly: ` +
              `${(project.context as any).includePrologue ? 'Prologue, ' : ''}Chapters 1 through ${targetChs}${(project.context as any).includeEpilogue ? ', and an Epilogue' : ''}.\n` +
              `Do NOT invent new chapters. Do NOT skip chapters. Do NOT merge the Epilogue into the final chapter.\n\n` +
              `MANDATORY FORMAT — every chapter MUST use this EXACT header (numeric digit, NOT a word):\n` +
              `## Chapter 1: [Title]\n` +
              `**POV:** [Character]\n` +
              `**Key Events:** [events]\n` +
              `...\n\n` +
              `## Chapter 2: [Title]\n...\n\n` +
              `Do NOT use tables, Roman numerals, or word-numbers ("Chapter One"). ` +
              `Use "## Chapter 1:", "## Chapter 2:", etc. exactly. ` +
              `Generate ALL ${targetChs} chapters in one continuous response.`;
            effectiveMessage += structureConstraint;
          }

          let currentMessages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; name?: string; tool_calls?: any[] }> = [
            { role: 'user', content: effectiveMessage }
          ];

          let response: CompletionResponse | null = null;
          let toolLoopActive = true;
          let safetyCounter = 0;

          const availableTools = this.mcpClient.getTools();

          const allowedToolTasks = ['planning', 'book_cover', 'research', 'outline'];
          // Librarian-bound steps run on gemma3:12b which doesn't expose tools;
          // also they're deliberate JSON-extraction jobs that shouldn't trigger tool dispatch.
          let useTools = allowedToolTasks.includes(step.taskType) && !routeToLibrarian && !routeToResearcher;

          // Workers-mode short-circuit: when the Researcher panel is set to
          // "Workers", skip the tool loop entirely and hand the prompt to
          // an external Claude/Gemini worker. runResearchAssistTask returns
          // a CompletionResponse directly so downstream code (POV checks,
          // sanitizers, etc.) doesn't need to know the source.
          if (useWorkersForResearchBP) {
            response = await this.runResearchAssistTask({
              project, step,
              systemPrompt,
              userContent: effectiveMessage,
            });
            toolLoopActive = false;
          }

          while (toolLoopActive && safetyCounter < 10) {
            safetyCounter++;
            try {
              response = await this.router.complete({
                provider: provider.id,
                system: systemPrompt,
                messages: currentMessages,
                maxTokens: outputBudget,
                temperature,
                thinking,
                repeatPenalty: isCreativeStep ? 1.15 : undefined,
                tools: (useTools && availableTools.length > 0) ? availableTools : undefined,
                // Phase 3: pen-aware writer model. Router swaps `model` for the
                // ollama provider when the pen has a current LoRA. We skip the
                // swap for librarian-bound steps so they actually hit gemma3:12b
                // and not the pen-aware writer (which doesn't support the tool
                // schema research-type steps would normally request).
                penSlug: (routeToLibrarian || routeToResearcher) ? undefined : (project.context as any).penNameSlug,
                // Concept Keywords emits a strict JSON schema. Token-level
                // `format: 'json'` only enforces validity (the model is free
                // to skip fields); passing a full JSON schema with `required`
                // forces the model to emit EXACTLY this shape. Two variants:
                // book-planning has 5 fields, KDP has 6 (adds redditAuthorSubs).
                format: isConceptKeywords
                  ? ((project.type as string) === 'amazon-kdp-launch'
                      ? CONCEPT_KEYWORDS_SCHEMA_KDP
                      : CONCEPT_KEYWORDS_SCHEMA_PLANNING)
                  : undefined,
              });
            } catch (err: any) {
              // Some Ollama models (Magnum/Gemma bases) reject tools with a
              // 400 "does not support tools" error. If we asked for tools and
              // hit that exact failure, drop tools and retry the same call
              // once — the step's prompt always works without tools (they're
              // optional augmentation, not required).
              const msg = String(err?.message || err);
              if (useTools && /does not support tools/i.test(msg)) {
                this.log.warn('Provider rejected tools; retrying without', { provider: provider.id, error: msg });
                useTools = false;
                continue;
              }
              throw err;
            }

            if (response.toolCalls && response.toolCalls.length > 0) {
              this.log.info(`AI requested ${response.toolCalls.length} tool calls`);
              
              // Append assistant message with tool calls
              currentMessages.push({
                role: 'assistant',
                content: response.text || '',
                tool_calls: response.toolCalls
              });

              // Execute all tools and append results
              for (const tc of response.toolCalls) {
                try {
                  const result = await this.mcpClient.executeTool(tc.function.name, JSON.parse(tc.function.arguments));
                  currentMessages.push({
                    role: 'tool',
                    name: tc.function.name,
                    content: JSON.stringify(result)
                  });
                } catch (err: any) {
                  this.log.warn(`Tool execution failed: ${tc.function.name}`, { error: err.message });
                  currentMessages.push({
                    role: 'tool',
                    name: tc.function.name,
                    content: `Error executing tool: ${err.message}`
                  });
                }
              }
            } else {
              // No tool calls, generation is complete
              toolLoopActive = false;
            }
          }

          if (!response) {
            throw new Error('No response generated by the AI router.');
          }

          // Feed actual token usage back to the Context Watcher
          if (response.promptTokens) {
            this.router.contextWatcher.recordActualUsage(
              'Writer (5090)',
              response.promptTokens,
              response.completionTokens || 0,
            );
          }

          // Add to our totals
          accumulatedCost += response.estimatedCost || 0;
          accumulatedTokens += response.tokensUsed || 0;

          // Budget enforcement — halt if cloud spend exceeds limits
          if (response.estimatedCost && response.estimatedCost > 0) {
            const withinBudget = this.costTracker.recordCost(project.id, response.estimatedCost);
            if (!withinBudget) {
              throw new Error(`Budget exceeded for project ${project.id}. Pipeline halted.`);
            }
          }
          
          // Append text with a spacing
          if (accumulatedText.length > 0 && response.text.trim().length > 0) {
            accumulatedText += '\n\n';
          }
          accumulatedText += response.text.trim();

          // FIX #7: Minimum response validation is now task-type aware.
          // A 50-char 'PASS' verdict is a valid pov_check response.
          // A 50-char response from a creative_writing step is a catastrophic failure.
          // For prose steps, enforce a minimum word count (not character count).
          if (isCreativeStep) {
            const wordCount = accumulatedText.split(/\s+/).filter(Boolean).length;
            const minWords = step.wordCountTarget ? Math.floor(step.wordCountTarget * 0.3) : 300;
            if (wordCount < minWords) {
              throw new Error(
                `Prose response too short (${wordCount} words). ` +
                `Minimum for this step: ${minWords} words. Retrying...`
              );
            }
          } else if (accumulatedText.length < this.config.minResponseLength) {
            // Negative-Pair Mining is designed to return a short skip message when
            // the upstream POV check verdict was PASS — the prompt explicitly tells
            // the model to emit `No negative pairs to mine — verdict was PASS.` and
            // stop. That's a successful no-op, not a too-short failure, so bypass
            // the length gate when we detect the contracted skip pattern.
            const isLegitShortAnswer =
              step.label.includes('Negative-Pair Mining') &&
              /no negative pairs to mine/i.test(accumulatedText);
            if (!isLegitShortAnswer) {
              throw new Error(
                `Response too short (${accumulatedText.length} chars). ` +
                `Minimum: ${this.config.minResponseLength}. Retrying...`
              );
            }
          }

          // ── Dynamic Segmentation removed to prevent infinite repetition loops ──

          // ── Duplicate Content Safety Check ──
          // Run before storing — detects if the AI re-generated content
          // that already exists in the accumulated text (continuation bug).
          if (isCreativeStep) {
            accumulatedText = this.dedup.deduplicateContent(accumulatedText, step.id, project.id);
          }

          // ── Smart Continuation System ──
          // Ollama stops when num_predict is exhausted (~8k tokens). If the output is
          // shorter than the target, feed the tail back in as an anchor and continue.
          if (isCreativeStep && step.wordCountTarget) {
            const wordCount = accumulatedText.split(/\s+/).filter(Boolean).length;
            const threshold = step.taskType === 'revision_execution' ? 0.70 : 0.90;
            const minWords = Math.floor(step.wordCountTarget * threshold);
            const maxWords = Math.floor(step.wordCountTarget * 1.20);
            const maxContinuations = 4;

            // Continuation policy:
            //   - Above maxWords (120% of target): hard cap, accept.
            //   - Below minWords (90% of target): trigger librarian
            //     continuation up to maxContinuations. Pipeline must hit the
            //     outline's word budget — short outputs miss outline beats.
            //   - The previous inline librarian auditor was the loop
            //     generator. With audit moved to async workers, continuation
            //     is safe to run without retry cascades.
            if (wordCount > maxWords) {
              this.log.warn('Chapter exceeded max word count cap — accepting result', {
                currentWords: wordCount, target: step.wordCountTarget, maxAllowed: maxWords,
              });
            } else if (wordCount < minWords && segmentCount <= maxContinuations) {
              // Output was truncated — build a continuation prompt using:
              // 1. A Librarian (5070 Ti) briefing summarising what's been written so far
              // 2. The last 200 words as a prose anchor for seamless continuation
              const words = accumulatedText.split(/\s+/);
              const tailWords = words.slice(-200).join(' ');
              const remaining = step.wordCountTarget - wordCount;

              this.log.info('Output truncated by num_predict — requesting Librarian briefing', {
                currentWords: wordCount, target: step.wordCountTarget, remaining, segmentCount,
              });
              this.eventBus.emit('step:progress', {
                projectId: project.id,
                stepId: step.id,
                message: `Output truncated (${wordCount}/${step.wordCountTarget} words). Librarian briefing continuation... (part ${segmentCount + 1})`,
              });

              // Ask the Librarian (gemma3:12b on 5070 Ti) to summarise the accumulated text
              // as a structured source of truth for the Writer's continuation prompt.
              let librarianBriefing = '';
              try {
                const briefingPrompt =
                  `You are a story continuity analyst. Read the following partial chapter draft and produce a concise structured briefing.\n\n` +
                  `DRAFT SO FAR (${wordCount} words):\n---\n${accumulatedText.slice(-4000)}\n---\n\n` +
                  `Produce ONLY this structured briefing (max 250 words):\n` +
                  `**Scene Location:** [where we are right now]\n` +
                  `**Characters Present:** [who is in the scene and their current state]\n` +
                  `**Events So Far:** [bullet list of what has happened, 3-5 points]\n` +
                  `**Unresolved Tension:** [what conflict or question is still open]\n` +
                  `**What Must Happen Next:** [what the continuation must cover to complete the chapter arc]\n` +
                  `**Prose Tail (last line):** [copy the exact last sentence of the draft above]`;

                // Route to the Librarian (gemma3:12b on 5070 Ti / ollama-embeddings container).
                // Falls back to main ollama if librarian is unavailable.
                const librarianProvider = this.router.getProvider('librarian') ? 'librarian' : 'ollama';
                const briefingResponse = await this.router.complete({
                  provider: librarianProvider,
                  system: 'You are a concise story continuity analyst. Output only the requested structured briefing. No preamble.',
                  messages: [{ role: 'user', content: briefingPrompt }],
                  maxTokens: 512,
                  temperature: 0.3,
                });
                librarianBriefing = briefingResponse.text.trim();
                this.log.info('Librarian continuation briefing received', {
                  briefingLength: librarianBriefing.length, segmentCount,
                });
              } catch (err: any) {
                this.log.warn('Librarian briefing failed — falling back to tail-only continuation', { error: err.message });
              }

              // Build continuation prompt with briefing + prose tail
              const briefingBlock = librarianBriefing
                ? `\n\n[CHAPTER STATE — from Librarian analysis]:\n${librarianBriefing}\n`
                : '';

              currentMessage = message +
                briefingBlock +
                `\n\n[CONTINUATION INSTRUCTION]: The previous generation stopped early. Continue the SAME prose seamlessly.\n` +
                `\n` +
                `⚠️ HARD CONSTRAINTS — read carefully:\n` +
                `1. Output PROSE ONLY. Do NOT write a synopsis, summary, outline, or "the next section…" lead-ins.\n` +
                `2. Do NOT echo the [CHAPTER STATE] briefing format above — that block is READ-ONLY reference for you, not a template to mirror.\n` +
                `3. Do NOT write "THE END", "the prologue ends on this note", or any meta-narration about the scene.\n` +
                `4. Do NOT include any "PROSE METRIC SNAPSHOT", word counts, sentence counts, or any auditor-style critique.\n` +
                `5. Continue EXACTLY from where the prose tail ends — same scene, same characters, same beat. Do NOT restart or re-introduce.\n` +
                `6. Do NOT repeat any text already written.\n` +
                `\n` +
                `[PROSE TAIL — your next sentence must follow directly from this]:\n---\n${tailWords}\n---\n` +
                `\n` +
                `Write approximately ${remaining} more words of continuous narrative prose to complete the segment.`;

              segmentCount++;
              attempt--; // Don't burn a retry slot on a continuation
              continue; // Re-enter the while loop without incrementing attempt
            } else if (wordCount < minWords) {
              this.log.warn('Segment below target after max continuations — accepting as-is', {
                currentWords: wordCount, target: step.wordCountTarget, segmentCount,
              });
            }
          } else if (step.wordCountTarget) {
            // Non-creative steps: just log if below target
            const wordCount = accumulatedText.split(/\s+/).length;
            const minWords = Math.floor(step.wordCountTarget * 0.70);
            if (wordCount < minWords) {
              this.log.info('Step below word count target — accepting result', {
                currentWords: wordCount, target: step.wordCountTarget,
              });
            }
          }

          // ── Outline Structure Validation ──
          // Standalone block — runs for outline steps regardless of wordCountTarget.
          if (['Chapter Outline', 'Chapter-by-Chapter Outline', 'Tension Blueprint', 'Scene-Level Breakdown'].includes(step.label)) {
            const missingChapters: number[] = [];
            const thinChapters: number[] = [];
            const targetCh = (project.context as any).targetChapters || 25;

            // Word-number fallback for models that ignore the format instruction
            const WORD_NUMS: Record<number, string> = {
              1:'One',2:'Two',3:'Three',4:'Four',5:'Five',6:'Six',7:'Seven',8:'Eight',9:'Nine',
              10:'Ten',11:'Eleven',12:'Twelve',13:'Thirteen',14:'Fourteen',15:'Fifteen',
              16:'Sixteen',17:'Seventeen',18:'Eighteen',19:'Nineteen',20:'Twenty',
              21:'Twenty-?One',22:'Twenty-?Two',23:'Twenty-?Three',24:'Twenty-?Four',
              25:'Twenty-?Five',26:'Twenty-?Six',27:'Twenty-?Seven',28:'Twenty-?Eight',
              29:'Twenty-?Nine',30:'Thirty',31:'Thirty-?One',32:'Thirty-?Two',
              33:'Thirty-?Three',34:'Thirty-?Four',35:'Thirty-?Five',36:'Thirty-?Six',
              37:'Thirty-?Seven',38:'Thirty-?Eight',39:'Thirty-?Nine',40:'Forty',
            };

            for (let i = 1; i <= targetCh; i++) {
              const wordNum = WORD_NUMS[i] || '';
              // Catches: ## Chapter 1, **Chapter 1**, Chapter 1, # Chapter 1,
              //          1. Title / 1: Title (start of line), Chapter One, ## Chapter One
              const chRegex = new RegExp(
                `(?:#+\\s*(?:Chapter\\s+)?0?${i}\\b` +
                `|\\*{1,2}Chapter\\s+0?${i}\\b` +
                `|^Chapter\\s+0?${i}\\b` +
                `|^0?${i}[.:]\\s` +
                (wordNum ? `|Chapter\\s+${wordNum}\\b` : '') +
                `)`,
                'im'
              );
              const chMatch = accumulatedText.match(chRegex);
              if (!chMatch) {
                missingChapters.push(i);
              } else {
                const chStart = accumulatedText.indexOf(chMatch[0]);
                const chSection = accumulatedText.substring(chStart, chStart + 500).replace(/\s+/g, ' ').trim();
                if (chSection.length < 100) {
                  thinChapters.push(i);
                }
              }
            }
            let missingEpi = false;
            if ((project.context as any).includeEpilogue && !accumulatedText.match(/Epilogue/i)) {
              missingEpi = true;
            }

            if (missingChapters.length > 0 || missingEpi) {
              // ── Outline Continuation System ──────────────────────────────────────
              // Distinguish between format failure (all chapters missing = model used wrong format)
              // and genuine truncation (some chapters missing = model ran out of tokens).
              const MAX_OUTLINE_CONTINUATIONS = 4;
              if (segmentCount <= MAX_OUTLINE_CONTINUATIONS) {
                const resumeFrom = missingChapters.length > 0 ? missingChapters[0] : targetCh + 1;
                const epilogueNote = missingEpi ? ` and then the Epilogue` : '';
                const isFormatFailure = resumeFrom === 1;

                this.log.info('Outline continuation triggered', {
                  resumeFrom, missingCount: missingChapters.length, segmentCount, isFormatFailure,
                });
                this.eventBus.emit('step:progress', {
                  projectId: project.id,
                  stepId: step.id,
                  message: isFormatFailure
                    ? `Outline format not recognised — retrying with strict enforcement... (attempt ${segmentCount + 1})`
                    : `Outline truncated at Ch${resumeFrom - 1}. Continuing from Ch${resumeFrom}... (segment ${segmentCount + 1})`,
                });

                const outlineTail = accumulatedText.split(/\n/).slice(-10).join('\n').trim();

                if (isFormatFailure) {
                  // Model used wrong format — restart with amplified instructions
                  currentMessage = message +
                    `\n\n[FORMAT ENFORCEMENT — Attempt ${segmentCount + 1}]:\n` +
                    `Your previous response did not use the required "## Chapter N:" header format. ` +
                    `The automated pipeline could not detect any chapters in your output. ` +
                    `You MUST restart the outline using EXACTLY this format for every chapter:\n` +
                    `## Chapter 1: [Title]\n**POV:** [name]\n**Key Events:** ...\n\n` +
                    `## Chapter 2: [Title]\n...\n\n` +
                    `Use NUMERIC digits (1, 2, 3 — NOT One, Two, Three). ` +
                    `Generate ALL ${targetCh} chapters now.`;
                  accumulatedText = ''; // Clear bad format so it isn't merged
                } else {
                  // Genuine truncation — inject continuation anchor
                  currentMessage = message +
                    `\n\n[OUTLINE CONTINUATION — Segment ${segmentCount + 1}]:\n` +
                    `You have already written the outline up to Chapter ${resumeFrom - 1}. ` +
                    `The text so far ends with:\n---\n${outlineTail}\n---\n\n` +
                    `Continue IMMEDIATELY from **## Chapter ${resumeFrom}** through **Chapter ${targetCh}**${epilogueNote}. ` +
                    `Use the same "## Chapter N: [Title]" format. ` +
                    `Do NOT repeat any chapters already written. Start with "## Chapter ${resumeFrom}:".`;
                }

                segmentCount++;
                attempt--; // Don't burn a retry slot
                continue;
              }

              // All continuation slots exhausted — burn a retry slot
              throw new Error(`Structural hallucination detected: Missing Chapter(s) ${missingChapters.join(', ')} ${missingEpi ? 'and Epilogue' : ''}. Retrying...`);
            }
            if (thinChapters.length > 0) {
              throw new Error(`Thin outline detected: Chapter(s) ${thinChapters.join(', ')} have placeholder content (<100 chars). Retrying...`);
            }
          }

          result = accumulatedText;
          this.log.info('AI response received and finalized', {
            tokens: accumulatedTokens,
            cost: accumulatedCost,
            provider: response.provider,
            length: result.length,
            wordCount: result.split(/\s+/).length,
          });

          // ── Quality audit handoff ──
          //
          // The old inline librarian-as-auditor was the main loop generator:
          // qwen3:14b would fail prose for word-count overruns even when the
          // critique itself said "well-paced and immersive", triggering a
          // full writer retry → continuation → re-audit → another fail.
          //
          // New flow: accept the writer's output immediately, enqueue an
          // ASYNC audit task to the worker pool. A Claude or Gemini worker
          // (much better prose judges than qwen3:14b) reviews offline. If
          // they flag a real issue, the existing pipeline_step_assist
          // mechanism handles the fix without blocking the pipeline.
          //
          // Net effect: pipeline never blocks on the auditor; quality review
          // becomes a worker-async concern that costs nothing while the
          // queue is empty.
          const AUDITABLE_TASKS = ['creative_writing', 'revision_execution'];
          if (AUDITABLE_TASKS.includes(step.taskType)) {
            try {
              // ── Post-write Style DNA lint ──
              // The LoRA writes without the ban lists in its prompt now,
              // but we still want to know if it slipped — feed any matches
              // into the audit payload so the worker can flag them as
              // stylistic_concern. Gated on the same global toggle as the
              // injection: when DNA is off, both the prompt-time scaffold
              // AND the post-write lint go silent.
              let dnaLint: any = null;
              const lintEnabled = this.router.config.get<boolean>('ai.styleDna.enabled', true);
              if (lintEnabled) {
                try {
                  const lintResult = this.styleDna.lintProse(result);
                  if (lintResult.totalMatches > 0) {
                    dnaLint = lintResult;
                    this.log.info('style DNA lint flagged matches', {
                      step: step.label,
                      totalMatches: lintResult.totalMatches,
                      filterWords: lintResult.filterWords.length,
                      phrases: lintResult.phrases.length,
                    });
                  }
                } catch (lintErr: any) {
                  this.log.warn('style DNA lint failed', { step: step.label, error: lintErr.message });
                }
              }

              this.stateStore.enqueueTasks('pipeline_step_assist', [{
                project_id: project.id,
                step_id: step.id,
                step_label: step.label,
                failure_reason: 'async_quality_audit',
                prior_attempt: result,
                project_title: project.title,
                project_description: project.description,
                prompt: step.prompt,
                ...(dnaLint ? { style_dna_lint: dnaLint } : {}),
              }], (project.context as any)?.penNameSlug);
              this.log.info('async quality audit enqueued for worker pool', {
                step: step.label,
                wordCount: result.split(/\s+/).length,
                dnaLintMatches: dnaLint?.totalMatches || 0,
              });
            } catch (e: any) {
              this.log.warn('failed to enqueue async audit', { step: step.label, error: e.message });
            }
          }

          break; // Success! Break out of the loop
        } catch (err: any) {
          lastError = err;
          this.log.warn(`Attempt ${attempt} failed`, { error: err.message });
          
          // If this was an auditor rejection, append the critique to the prompt for the next attempt
          if (err.message.startsWith('[AUDITOR REJECTION]:')) {
            const critique = err.message.replace('[AUDITOR REJECTION]:', '').trim();
            // Replace (not append) any prior rejection block to prevent prompt bloat
            // that pushes the message past the context window, stripping the model's bible/outline.
            currentMessage = currentMessage.replace(
              /\n\n\[SYSTEM ALERT: Your previous attempt was REJECTED[\s\S]*?(?=\n\n\[|$)/,
              ''
            );
            currentMessage += `\n\n[SYSTEM ALERT: Your previous attempt was REJECTED by the Quality Auditor. Reason:\n${critique}\n\nPlease redo the task and fix these issues.]`;
            segmentCount = 1; // Reset segment count for the fresh attempt
          }
          
          // On an actual failure (e.g. timeout), we retry the exact same currentMessage.
          if (attempt < maxAttempts) {
            // Try fallback provider on subsequent attempts
            const fallback = this.router.getFallbackProvider(provider.id);
            if (fallback) {
              this.log.info('Switching to fallback provider', { fallback: fallback.id });
            }
            // Exponential backoff: 2s → 4s → 8s → 16s (capped at 30s)
            // Prevents hammering Ollama when it's recovering from OOM
            const backoffMs = Math.min(30_000, 2000 * Math.pow(2, attempt - 1));
            this.log.info(`Retrying in ${backoffMs / 1000}s...`, { attempt, backoffMs });
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
          attempt++;
        }
      }

      if (!result) {
        const errorMsg = `Step failed after ${maxAttempts} attempts: ${lastError?.message}`;
        this.stateStore.failStep(project.id, step.id, errorMsg);
        this.eventBus.emit('step:failed', {
          projectId: project.id,
          stepId: step.id,
          error: errorMsg,
        });
        throw new Error(errorMsg);
      }
    }

    if (!result) {
      throw new Error('Step failed to produce a result.');
    }

    // ── Mechanical Formatting Overrides ──
    if (step.label === 'Stat System Definition') {
      result = this.forceRelationshipMatrixFormat(result);
    }

    // Sanitize prose results BEFORE storing — otherwise step.result in SQLite carries
    // the raw model output (self-critique callouts, hallucinated XML tags, etc), and every
    // downstream consumer (Part 2's "STORY SO FAR" injection, full-scene mining) re-reads
    // the contaminated version. Sanitizer is idempotent; saveStepToDisk runs it again.
    if (step.taskType === 'creative_writing' || step.taskType === 'revision_execution') {
      result = this.sanitizer.sanitize(this.dedup.deduplicateOutput(result));

      // ── Meta-prose contamination strip ──
      //
      // The writer occasionally hallucinates auditor output, synopsis
      // markers, or "THE END" tails because the librarian-briefing
      // continuation prompt looks structurally like a report. Strip the
      // recognised patterns so they don't ship to the manuscript file.
      const STRIP_PATTERNS: Array<{ re: RegExp; label: string }> = [
        // Metric snapshot blocks the writer copied from auditor training
        { re: /---+\s*PROSE METRIC SNAPSHOT\s*---+[\s\S]*?(?=\n\n[A-Z]|\n*$)/gi, label: 'metric_snapshot' },
        // Explicit chapter/prologue closing markers
        { re: /^\s*THE\s+END\s*\.?\s*$/gim, label: 'the_end_marker' },
        // Meta-narration about the chapter itself
        { re: /^.*?\bthe (?:prologue|chapter|epilogue) ends? (?:here|on)\b.*$/gim, label: 'meta_ends_marker' },
        // Synopsis-mode lead-ins ("The prologue opens on…", "The next section…")
        { re: /^\s*The\s+(?:prologue|chapter|epilogue|next\s+section|third\s+(?:part|section)|final\s+section)\s+(?:opens|begins|starts|focuses|shifts|brings|introduces|closes)\b[^.\n]*\.\s*/gim, label: 'synopsis_lead' },
        // Audit-shaped scoring fields if the writer echoes the auditor template
        { re: /^\s*\*{0,2}(?:Deep\s+POV|Pacing|Hook)\s+Score\*{0,2}\s*:\s*\d+(?:\s*\/\s*10)?\s*$/gim, label: 'audit_score_field' },
        { re: /^\s*\*{0,2}(?:POV\s+Character|Outline\s+Match|Verdict|Revision\s+Success|Filter\s+Words(?:\s+Found)?|Show\s+vs\s+Tell|Trope\s+Warnings?|AI-isms?\s+Found|Plot\s+Threads?\s+Stalled|Issues)\*{0,2}\s*:[^\n]*$/gim, label: 'audit_field_line' },
        // Retry / total-rewrite markers if they leak from the prompt path
        { re: /\[POV-RETRY:\s*\d+\][^\n]*\n?/gi, label: 'pov_retry_marker' },
        { re: /\[TOTAL-REWRITES:\s*\d+\][^\n]*\n?/gi, label: 'total_rewrites_marker' },
        // Critic / analysis headers that match the saveStepToDisk audit format
        { re: /^#+\s*🔍\s*Critic\s+Analysis\s*$/gim, label: 'critic_header' },
        { re: /^#+\s*📝\s*Generated\s+Prose\s*$/gim, label: 'generated_prose_header' },
        { re: /^#+\s*📖\s*Compiled\s+Scene\s*$/gim, label: 'compiled_scene_header' },
        // Auditor's CRITICAL REWRITE INSTRUCTIONS block (multi-line)
        { re: /\bCRITICAL REWRITE INSTRUCTIONS[\s\S]*?(?=\n\n[A-Z]|\n*$)/gi, label: 'rewrite_instructions_block' },
        // Healing block hint if the writer copies it back
        { re: /###\s*YOUR PREVIOUS DRAFT \(NEEDS HEALING\)[\s\S]*?---\s*\n/gi, label: 'healing_block_echo' },
        // Lone metric-correction headers ("⚠️ PROSE METRICS — ..." style)
        { re: /^\s*⚠️?\s*PROSE METRICS[^\n]*$/gim, label: 'prose_metrics_header' },
        // Writer's reporting-on-itself preamble ("The prologue draft is complete at 1730 words. Here is the full text:")
        { re: /^\s*The\s+(?:prologue|chapter|epilogue|draft|scene)\s+(?:draft\s+)?is\s+(?:complete|finished|ready)[\s\S]*?(?:Here\s+(?:is|are)\s+the\s+(?:full\s+)?(?:text|prose|chapter|scene)\s*:?\s*)?\n+/gim, label: 'writer_preamble' },
        // Audit-block bleeds when the writer echoes the review template
        // (this happened when a template prompt-mismatch sent the audit
        // prompt to a creative_writing step). Strips the whole Part 1 +
        // Part 2 review block. Defensive belt-and-braces — the root cause
        // is fixed in engine.refreshPendingPrompts.
        { re: /^#{0,3}\s*PART\s+(?:ONE|TWO|1|2|I|II)\s*[—–-]\s*(?:NARRATIVE\s+AUDIT|QUALITY\s+AUDIT|LIVE\s+TRACKING\s+UPDATE)[\s\S]*?(?=\n\n[A-Z][a-z]|\n*$)/gim, label: 'review_block_bleed' },
        // Score Breakdown / Repetition Audit headers
        { re: /^(?:Score\s+Breakdown|Repetition\s+Audit|Em\s+Dash\s+Count|Tropes?\s+Deployed|Show\s+vs\s+Tell\s+Violations?|Plot\s+Threads?\s+Advanced)\s*:[^\n]*\n?/gim, label: 'audit_subheader' },
        // NARRATIVE DIRECTIVES block (writer echoing live-tracking template)
        { re: /^[A-Z]\.\s+(?:Character\s+Stats|Faction\s+Reputation\s+Update|Foreshadowing\s+Ledger|Subplot\s+Tracker|Tension\s+Check|Relationship\s+Dynamics|NARRATIVE\s+DIRECTIVES)[\s\S]*?(?=\n\n[A-Z]\.\s+[A-Z]|\n\n[A-Z][a-z]{2,}|\n*$)/gim, label: 'live_tracking_section' },
        // Section G — NARRATIVE DIRECTIVES FOR Chapter N
        { re: /^G\.\s+NARRATIVE\s+DIRECTIVES\s+FOR\s+Chapter\s+\d+[\s\S]*?(?=\n\n[A-Z]|\n*$)/gim, label: 'narrative_directives_block' },
        // Prompt-instruction echoes ("NEVER use placeholder names like…")
        { re: /^NEVER\s+use\s+placeholder\s+names?\s+like[\s\S]*?\n\n/gim, label: 'prompt_instruction_echo' },
      ];
      for (const { re, label } of STRIP_PATTERNS) {
        const before = result.length;
        result = result.replace(re, '').trim();
        const removed = before - result.length;
        if (removed > 0) {
          this.log.info('meta-prose contamination stripped', {
            stepId: step.id, label: step.label, pattern: label, chars: removed,
          });
        }
      }

      // ── Mojibake repair (Windows-1252 → UTF-8 misdecode) ──
      // These tokens are the canonical signatures: ÔÇö (em-dash), ÔÇô (en-dash),
      // ÔÇ£/ÔÇØ (curly quotes), ÔÇÖ (right single quote), Õ (apostrophe).
      const MOJIBAKE: Array<[RegExp, string]> = [
        [/ÔÇö/g, '—'],
        [/ÔÇô/g, '–'],
        [/ÔÇ£/g, '"'],
        [/ÔÇØ/g, '"'],
        [/ÔÇÖ/g, '’'], // right single quote
        [/ÔÇÿ/g, '‘'], // left single quote
        [/ÔÇª/g, '…'],
        // Lone Õ in mid-word position is almost always a corrupted apostrophe
        [/(?<=[A-Za-z])Õ(?=[a-z])/g, '’'],
      ];
      for (const [re, rep] of MOJIBAKE) {
        result = result.replace(re, rep);
      }

      // ── Inline Chapter Polish: hard-cap RUNAWAY word-count overruns ──
      //
      // Originally tight (target+200, >10% overrun) which clipped legitimate
      // v7 prose where the model was building toward a beat. The strip
      // patterns above already remove the synopsis-second-scene bug at root,
      // so this trim is now a LAST-RESORT safety net for truly runaway
      // outputs. Threshold widened to target+1000 / >25% overrun so a
      // 1500-word target tolerates ~3100 words (~2x) before any cut —
      // preserves v7's pacing on legitimately long-tail outputs.
      const target = (step as any).wordCountTarget as number | undefined;
      if (typeof target === 'number' && target > 0) {
        const hardCeil = target + 1000;
        const words = result.split(/\s+/);
        const overrunPct = ((words.length - hardCeil) / hardCeil) * 100;
        if (words.length > hardCeil && overrunPct > 25) {
          // Find the paragraph break (\n\n) closest to but not exceeding
          // hardCeil words. Walking by paragraphs keeps the cut at a clean
          // narrative seam rather than mid-sentence.
          const paragraphs = result.split(/\n\s*\n/);
          let running = 0;
          let cutAt = paragraphs.length;
          for (let i = 0; i < paragraphs.length; i++) {
            const pWords = paragraphs[i].split(/\s+/).length;
            if (running + pWords > hardCeil) { cutAt = i; break; }
            running += pWords;
          }
          if (cutAt < paragraphs.length && cutAt > 0) {
            const trimmed = paragraphs.slice(0, cutAt).join('\n\n').trim();
            this.log.info('chapter polish: trimmed overrun', {
              stepId: step.id,
              label: step.label,
              targetWords: target,
              originalWords: words.length,
              trimmedWords: trimmed.split(/\s+/).length,
              paragraphsCut: paragraphs.length - cutAt,
            });
            result = trimmed;
          }
        }
      }
    }

    // 6. Save result
    this.stateStore.completeStep(project.id, step.id, result);

    // 6a. Run output-quality gate (advisory — doesn't block, but enqueues a
    // Claude assist task if the local model produced garbage). Worker picks
    // up via /perry-worker; on report_task the result gets replaced in-place.
    try {
      const gate = getGateFor(step);
      if (gate) {
        const failure = gate(result, step, project);
        if (failure) {
          this.log.warn('quality gate failed — enqueueing Claude assist task', {
            project: project.id, step: step.id, label: step.label, failure,
          });
          this.stateStore.enqueueTasks('pipeline_step_assist', [{
            project_id: project.id,
            step_id: step.id,
            step_label: step.label,
            failure_reason: failure,
            prior_attempt: result,
            project_title: project.title,
            project_description: project.description,
            prompt: step.prompt,
          }], (project.context as any)?.penNameSlug);
        }
      }
    } catch (e: any) {
      this.log.warn('quality gate threw', { project: project.id, step: step.id, error: e.message });
    }

    // Save to disk as markdown
    await this.saveStepToDisk(project, step, result);

    // ── Living bibles: append stat_update results to a per-project diff log ──
    // Each stat_update represents "what changed since the last chapter" —
    // character growth, setting evolution, faction shifts. We append the
    // result verbatim to meta['living_diffs_{projectId}'] so the prompt-
    // builder can inject recent diffs into future chapter prompts (the
    // bibles become "living" — they accumulate evolution across chapters).
    // Cap at last 30 diffs so the meta payload stays bounded.
    if ((step.taskType === 'stat_update' || step.label?.includes(' — Review')) && result && result.length > 100) {
      try {
        const key = `living_diffs_${project.id}`;
        const existingRaw = this.stateStore.getMeta(key);
        const existing: any[] = existingRaw ? (() => { try { return JSON.parse(existingRaw); } catch { return []; } })() : [];
        existing.push({
          chapter: step.chapterNumber ?? null,
          label: step.label,
          stepId: step.id,
          recordedAt: new Date().toISOString(),
          content: result,
        });
        // Cap to most-recent 30 diffs to bound the meta payload.
        const capped = existing.slice(-30);
        this.stateStore.setMeta(key, JSON.stringify(capped));
        this.log.info('Living bible diff recorded', {
          step: step.label, chapter: step.chapterNumber, totalDiffs: capped.length,
        });
      } catch (e: any) {
        this.log.warn('Failed to record living bible diff', { step: step.label, error: e.message });
      }
    }

    // 7. Emit completion event (ContextEngine will auto-index via EventBus)
    this.eventBus.emit('step:completed', {
      projectId: project.id,
      stepId: step.id,
      result,
    });

    this.eventBus.emit('step:progress', {
      projectId: project.id,
      stepId: step.id,
      message: `Completed: ${step.label}`,
    });

    // 8. Quality Gates — auto-rewrite chapters that fail checks
    if (step.taskType === 'pov_check') {
      result = await this.povGate.apply(project, step, result);
      // Re-save to disk so the user sees the automated prose metrics appended
      await this.saveStepToDisk(project, step, result);
      // ── Feature 1: Score Time-Series Tracking ───────────────────────────
      // Extract scores from the POV check and append to scores.csv
      if ((project.type as string) === 'style-calibration') {
        this.autoLearning.recordPovScores(project.id, step.label, result).catch(err =>
          this.log.warn('Score tracking failed (non-fatal)', { error: (err as Error).message })
        );

        // ── Auto-source 3: Full Scene Injection (PASS or high-scoring REVISE) ──
        // Mine scenes with PASS verdict or REVISE + Deep POV ≥ 8 as positive training examples.
        const verdictMatch = result.match(/Verdict(?:[\s:*]+)(PASS|REVISE|REWRITE)/i);
        const deepPovMatch = result.match(/Deep POV(?: Score)?(?:[\s:*]+)(\d+)/i);
        const verdict = verdictMatch?.[1]?.toUpperCase() || 'UNKNOWN';
        const deepPovScore = deepPovMatch ? parseInt(deepPovMatch[1]) : 0;

        // ── Auto-source 4: Paragraph-level voice anchor promotion ──
        // Runs on EVERY compiled scene regardless of overall POV verdict.
        // A REWRITE scene can still contain voice-strong paragraphs worth
        // keeping as positive anchors. The scorer (in auto-learning-service)
        // filters to score-7+ paragraphs only.
        const compiledStep = project.steps.find(
          s => s.taskType === 'draft_compile' &&
               s.chapterNumber === step.chapterNumber &&
               s.status === 'completed' && s.result
        );
        if (compiledStep?.result) {
          this.autoLearning.promoteParagraphsToAnchors(project.id, compiledStep.result).catch(err =>
            this.log.warn('Paragraph anchor promotion failed (non-fatal)', { error: (err as Error).message })
          );
        }

        if (verdict === 'PASS' || (verdict === 'REVISE' && deepPovScore >= 8)) {
          const sceneTypeMatch = step.label.match(/\b(Action|Dialogue|Introspection|Setting|Confrontation|Discovery|Quiet|Group)\b/i);
          const sceneType = sceneTypeMatch ? sceneTypeMatch[1].toLowerCase() : 'scene';
          if (compiledStep?.result) {
            this.autoLearning.minePassedScene(project.id, sceneType, compiledStep.result, verdict, deepPovScore).catch(err =>
              this.log.warn('Full scene mining failed (non-fatal)', { error: (err as Error).message })
            );
          }
        }
      }
    }

    if (step.taskType === 'continuity_check') {
      await this.continuityGate.apply(project, step, result);
    }
    if (step.taskType === 'revision_audit') {
      await this.revisionGate.apply(project, step, result);
    }

    // 9. Auto-apply Style Calibration directives
    // Extract style directives from EVERY Calibration Summary pass.
    // This allows the model to self-heal and update its DNA infinitely across
    // multiple passes without waiting for the final pass.
    if ((project.type as string) === 'style-calibration' && step.taskType === 'analysis' && step.label.includes('Summary')) {
      let positive: string[] = [];
      let negative: string[] = [];
      
      const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (Array.isArray(parsed)) {
            // Legacy format fallback
            negative = parsed;
          } else {
            // New structured format
            positive = parsed.positive || [];
            negative = parsed.negative || [];
          }
        } catch (e) {
          this.log.warn('Failed to parse JSON directives from calibration summary', { error: (e as any).message });
        }
      }
      
      // Fallback to legacy extraction if JSON missing/failed
      if (positive.length === 0 && negative.length === 0) {
        const lines = result.split('\n');
        const directives = lines
          .filter(l => l.match(/^[-*]\s+(?:DO|AVOID)/i))
          .map(l => l.replace(/^[-*]\s*/, '').trim());
        
        positive = directives.filter(d => d.startsWith('DO:'));
        negative = directives.filter(d => d.startsWith('AVOID:'));
      }
      
      if (positive.length > 0 || negative.length > 0) {
        this.styleDna.applyDirectivesToGlobal(positive, negative, true); // OVERWRITE with compressed DNA
        this.log.info('Calibration pass completed — auto-compressed global DNA', { 
          positiveCount: positive.length, 
          negativeCount: negative.length 
        });
      } else {
        this.log.warn('Calibration pass completed but no DO/AVOID directives found in output', { step: step.label });
      }

      // ── Auto-Learning Pipeline ──────────────────────────────────────────
      // After DNA compression: export JSONL training data and (every 5 passes)
      // regenerate the perry-writer Modelfile with the latest learned corrections.
      const passMatch = step.label.match(/^Pass (\d+):/);
      const completedPass = passMatch ? parseInt(passMatch[1]) : 0;
      // Fire-and-forget — non-fatal, runs in background without blocking next step
      this.autoLearning.onPassComplete(completedPass, project.id).catch(err =>
        this.log.warn('Auto-learning background task failed', { error: (err as Error).message })
      );

      // Check if Infinite Calibration is enabled
      if ((project.context as any).isInfiniteCalibration) {
        // Extract the current pass number
        const match = step.label.match(/^Pass (\d+):/);
        if (match) {
          const currentPass = parseInt(match[1]);
          const nextPass = currentPass + 1;
          const nextIdx = project.steps.length + 1; // Avoid duplicate IDs
          
          this.log.info('Infinite Calibration Loop active. Generating next pass...', { nextPass });
          
          // Re-fetch project to ensure we have the most up to date context if it was updated
          const freshProject = this.stateStore.get(project.id) || project;
          
          // Inject the newly compressed DNA into the prompt for the NEXT summary pass
          const currentDna = {
            positive: this.styleDna.getGlobalRules().positiveDirectives || [],
            negative: this.styleDna.getGlobalRules().tropeWarnings || []
          };
          const totalChapters = (freshProject.context as any).targetChapters || 25;
          // Rebuild the shared context block with anti-patterns — same logic as buildSteps.
          // Do NOT pass freshProject.description here — that is just the user's synopsis, not the
          // calibration anti-pattern block that the writer model needs injected every pass.
          // Mirror buildSteps' sharedContext: keep the POV character lock + stat band lock blocks
          // (per-pass prompts reference Cast Roster entry #N and a specific stat band — without
          // these lock sections the writer model gets contradictory instructions).
          const infiniteSharedContext = [
            `## NOVEL CONTEXT`,
            `Title: "${freshProject.title}"`,
            `Note: "${freshProject.title}" is the project codename — NOT a character. POV characters come ONLY from the Cast Roster injected separately as "Cast Roster (POV Character Lock)". If you cannot see a Cast Roster in your context, STOP and emit a single line: "ERROR: Cast Roster missing from context."`,
            ...(freshProject.description ? [``, `## PROJECT DESCRIPTION`, freshProject.description] : []),
            ``,
            `## WORLD & CHARACTER CONTEXT (from Book Bible)`,
            `MANDATORY: You MUST consult the 'Character Bible', 'Faction Bible', and 'World Building' documents in your context.`,
            `Use the exact character traits, faction allegiances, and sensory rules defined there.`,
            ``,
            `## YOUR TASK`,
            `Write a single scene of manuscript-quality prose in the locked POV character's voice and stat band.`,
            `Output ONLY the scene prose. Do not annotate, summarise, grade, or comment on your own work. No callouts, no verdicts, no notes.`,
            `## POV CHARACTER LOCK (CRITICAL)`,
            `Each pass of this calibration is LOCKED to ONE POV character — DO NOT switch characters mid-pass.`,
            `The Cast Roster (inherited from the Cast Extraction step) lists the POV characters in order.`,
            `Use the character at the position equal to this pass number (Pass 1 → entry #1, Pass 5 → entry #5,`,
            `cycling back to entry #1 after the last entry). The pass-specific prompt below tells you which entry to use.`,
            ``,
            `## STAT BAND LOCK (CRITICAL)`,
            `Each pass is also locked to one stat band that governs the POV character's prose register:`,
            `- **Peak (81-100)**: calm, analytical, measured sentences. The character is at their best.`,
            `- **Stable (51-80)**: baseline behaviour. Default voice — the character as you'd describe them normally.`,
            `- **Stressed (21-50)**: paranoid asides, shorter sentences, misreading social cues, somatic tension.`,
            `- **Critical (1-20)**: fragmented internal monologue, hallucinated sensory details, unreliable narration, sentences break mid-thought.`,
            `Look up the POV character's specific stat-threshold definitions in the inherited Character Bible / Stat System Definition.`,
            `Write the entire scene in the assigned band — sentence rhythm, perception, and decision-making all reflect that band.`,
            ``,
            ``,
            `## ANTI-PATTERNS — DO NOT USE THESE`,
            `1. "In the blink of an eye" for action transitions`,
            `2. "The weight of the world" clichés in introspective moments`,
            `3. Overusing "Quantum" as a noun (e.g., "a quantum of dread")`,
            `4. "Ghostly" or "Soulless" to describe digital entities`,
            `5. "Heartbeats of the Drift" as a metaphor`,
            `6. "The storm of emotions" in character reactions`,
            `7. Filter words: felt, noticed, saw, heard, realized, wondered, thought`,
            `8. Repetitive dialogue tags (hissed, growled, snapped, exclaimed, etc.)`,
            `9. "The Drift whispered" as passive agency`,
            `10. "Data streams flowed like rivers" for technical descriptions`,
            `11. AI-isms and cliché words: "a testament to", "tapestry", "symphony", "palpable", "delve", "echoed", "cacophony", "labyrinth"`,
            `12. Overdramatic physical reactions: "a shiver ran down his spine", "his blood ran cold", "heart hammered in his chest", "let out a breath he didn't know he was holding"`,
            `13. Grandiose metaphorical filler: "a delicate dance", "beacon of hope", "silent guardian", "symphony of destruction"`,
            ``,
            `## STRICT NEGATIVE CONSTRAINTS (MANDATORY)`,
            `1. NEVER use "Negative Telling" — never describe what a character *didn't* do or feel (e.g., "he didn't flinch"). Only describe concrete actions they *did* take.`,
            `2. NO "Analytical Summaries" — DO NOT explain the "meaning" or "purpose" of any action or setting. Only state the raw sensory facts and let the reader infer the stakes.`,
            `3. AVOID "Syntactic Monotony" — DO NOT start consecutive sentences with the same pronoun or noun (e.g., "He", "The"). Vary sentence openings using prepositional phrases, gerunds, or action beats.`,
          ].join('\n');
          const nextSteps = generateCalibrationPassSteps(nextPass, nextIdx, freshProject.title, infiniteSharedContext, false, currentDna, totalChapters);
          
          freshProject.steps.push(...nextSteps);
          this.stateStore.save(freshProject);
        }
      }
    }
      if (step.taskType === 'manuscript_cleanup') {
        await this.continuityGate.applyManuscriptCleanup(project, step, result);
      }
      // Revision Brief (Pass H) — parse verdict and act
      if (step.taskType === 'revision_check' && step.label.includes('Revision Brief')) {
        await this.revisionGate.apply(project, step, result);
      }

      const duration = Date.now() - startTime;
      for (const skill of appliedSkills) {
        this.stateStore.logSkillExecution('director', skill.name, true, duration);
      }

      return result!;
    } catch (err: any) {
      const duration = Date.now() - startTime;
      for (const skill of appliedSkills) {
        this.stateStore.logSkillExecution('director', skill.name, false, duration, err.message || String(err));
      }
      throw err;
    }
  }

  /**
   * Execute all pending steps in a project sequentially.
   */
  async executeAll(project: Project): Promise<void> {
    let step = this.stateStore.getNextPendingStep(project.id);
    while (step) {
      // Re-fetch project to get latest state
      const current = this.stateStore.get(project.id);
      if (!current || current.status === 'paused') break;

      // Automatically wait if training is active on the GPU to prevent OOM.
      // Exempt every step that we know will route to the librarian (5070 Ti),
      // not the writer (5090) the trainer is hogging.
      //
      // NOTE: book-planning's research-phase steps route to the RESEARCHER
      // (5090) which DOES share the GPU with the writer + trainer. Those
      // steps therefore are NOT exempt — they must wait for the training
      // flag like any writer-bound step. We carve them out from the
      // librarian-bound set explicitly.
      const trainingFlagPath = path.join(this.config.workspaceDir, 'training', 'TRAINING_IN_PROGRESS.flag');
      const isResearcherBound = (current.type as string) === 'book-planning' &&
        (step.taskType === 'network_research' ||
         (step.label === 'Concept Keywords' && step.taskType === 'research') ||
         step.label === 'Market & Genre Analysis');

      // Researcher actual location depends on dashboard config:
      //   - mode='workers' → external Claude/Gemini, no local GPU at all
      //   - endpoint=librarian (5070 Ti) → parallel with librarian, NOT
      //     on the writer GPU, so safe to run during training
      //   - endpoint=writer (5090) → shares writer GPU, must wait
      const researcherModeNow = this.router.config.get<string>('ai.ollama.researcherMode', 'local');
      const researcherEndpointNow = this.router.config.get<string>('ai.ollama.researcherEndpoint', '');
      const librarianEndpointGuess = process.env.OLLAMA_LIBRARIAN_BASE_URL || 'http://ollama-embeddings:11434';
      const researcherOffWriterGpu = isResearcherBound && (
        researcherModeNow === 'workers' ||
        researcherEndpointNow === librarianEndpointGuess
      );

      const librarianBound =
        !isResearcherBound && (
          step.taskType === 'network_research' ||
          (step.label === 'KDP Concept Keywords' && (current.type as string) === 'amazon-kdp-launch') ||
          (step.label === 'Cast Extraction' && (current.type as string) === 'style-calibration' && step.taskType === 'analysis') ||
          (step.taskType === 'pov_check' && (current.type as string) === 'style-calibration')
        );
      const stepRunsOnWriterGpu = !librarianBound && !researcherOffWriterGpu;
      let waitingLogged = false;
      while (stepRunsOnWriterGpu && fs.existsSync(trainingFlagPath)) {
        if (!waitingLogged) {
          this.log.info('Pipeline paused automatically: LoRA training is in progress on the writer GPU.', { project: current.title, step: step.label });
          waitingLogged = true;
        }
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds before checking again
      }
      if (waitingLogged) {
        this.log.info('Pipeline resumed: LoRA training complete. Reloading configuration...', { project: current.title });
        // this.config.load();
      }

      try {
        await this.execute(current, step);
      } catch (err: any) {
        // Check for auto-recoverable errors
        if (err.message && err.message.startsWith('[AUTO_RESET_REQUIRED]')) {
          const s = current.steps.find(x => x.id === step!.id);
          if (s) {
            s.autoResetCount = (s.autoResetCount || 0) + 1;
            if (s.autoResetCount <= 3) {
              this.log.warn('Auto-recovering from infinite continuation loop (Resetting Step)', { 
                project: project.title, 
                step: step.label,
                autoResetCount: s.autoResetCount
              });
              s.status = 'pending';
              s.result = undefined;
              s.error = undefined;
              s.startedAt = undefined;
              s.completedAt = undefined;
              this.stateStore.save(current);
              
              // Emit event to update dashboard
              this.eventBus.emit('step:failed', {
                projectId: project.id,
                stepId: step.id,
                error: `Auto-resetting step (Attempt ${s.autoResetCount}/3) due to loop.`,
              });

              // Re-fetch next pending step (which should be the same step we just reset)
              step = this.stateStore.getNextPendingStep(project.id);
              continue;
            } else {
              this.log.error('Step exceeded maximum auto-resets. Halting pipeline.', { project: project.title, step: step.label });
              // Modify error message for final failure
              err.message = 'Step permanently failed after 3 auto-resets due to infinite continuation loops.';
            }
          }
        }

        // Step failed — project is already set to 'paused' by failStep.
        // Emit the pause event so the SSE/dashboard updates immediately.
        this.eventBus.emit('project:paused', { projectId: project.id });
        this.log.warn('Pipeline halted due to step failure', {
          project: project.title,
          step: step.label,
          error: err.message,
        });
        return;
      }
      step = this.stateStore.getNextPendingStep(project.id);
    }
  }

  // Quality gates, Style DNA, dedup, cleanup extracted to:
  //   quality-gates/{pov,continuity,revision}-gate.ts
  //   services/{deduplication,prose-sanitizer}.ts


  /**
   * Detect if the POV character changed between Part 1 and Part 2 of a compiled scene.
   * Uses a name-frequency heuristic. Returns a description of the fracture or null.
   */
  private detectPovFracture(part1: string, part2: string): string | null {
    if (!part1 || !part2) return null;
    const extractDominantName = (text: string): [string, number] | null => {
      const counts = new Map<string, number>();
      // Match capitalised words preceded by a lowercase char (not sentence starters)
      const matches = text.match(/(?<=[a-z,;!?"'] )[A-Z][a-z]{2,15}/g) || [];
      const skip = new Set(['The','His','Her','She','He','They','But','And','For','With','Its']);
      for (const name of matches) {
        if (!skip.has(name)) counts.set(name, (counts.get(name) || 0) + 1);
      }
      if (counts.size === 0) return null;
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return top[1] > 2 ? top : null;
    };
    const d1 = extractDominantName(part1);
    const d2 = extractDominantName(part2);
    if (!d1 || !d2) return null;
    if (d1[0] !== d2[0]) {
      return `Part 1 centres on "${d1[0]}" (${d1[1]}x), Part 2 shifts to "${d2[0]}" (${d2[1]}x)`;
    }
    return null;
  }

  /** Detect the POV character for a chapter step from the outline */
  private detectPovCharacter(project: Project, step: ProjectStep): string | undefined {
    if (!step.chapterNumber) return undefined;

    let outlineResult: string | undefined;
    if (project.parentId) {
      const parent = this.stateStore.get(project.parentId);
      const outlineStep = parent?.steps.find(s => s.label.includes('Outline') && s.phase === 'outline');
      outlineResult = outlineStep?.result;
    }
    if (!outlineResult) {
      const outlineStep = project.steps.find(s => s.label.includes('Outline') && s.phase === 'outline');
      outlineResult = outlineStep?.result;
    }
    if (!outlineResult) return undefined;

    const chapterSection = outlineResult.match(
      new RegExp(`Chapter\\s+${step.chapterNumber}\\b[\\s\\S]*?(?=Chapter\\s+${step.chapterNumber + 1}\\b|$)`, 'i')
    );
    if (!chapterSection) return undefined;

    const povMatch = chapterSection[0].match(/POV(?:\s+Character)?[:\s]+([^\n(]+)/i);
    if (povMatch) return povMatch[1].trim();

    return undefined;
  }

  private buildSystemPrompt(project: Project, step: ProjectStep): string {
    // BUG FIX N2: Analytical steps get a completely different system identity.
    // Previously all steps received writer-mode instructions ("Output ONLY raw story prose",
    // "NEVER summarize", prose rhythm rules) even for pov_check/analysis steps.
    // The model was then asked to grade in the user message — fighting the system prompt.
    //
    // 'research' is also analytical — Market Analysis should not receive prose style instructions.
    const analyticalTypes = ['pov_check', 'stat_update', 'continuity_check', 'revision_audit', 'analysis', 'research'];

    // 'outline' and 'voice_profile' are planning/architect tasks — they need structured data output,
    // NOT the Writer persona ("Output ONLY raw story prose"). Adding them to planningTypes
    // prevents the model from entering creative writing mode for outline and voice steps.
    const planningTypes = ['book_bible', 'outline', 'voice_profile'];

    if (analyticalTypes.includes(step.taskType)) {
      let prompt = `You are the P.E.R.R.Y. Analytical Engine — a strict literary critic and quality auditing system.\n\n`;
      prompt += `You are working on: "${project.title}"\n`;
      prompt += `Current task: ${step.label}\n\n`;
      prompt += `ROLE: You are NOT a creative writer. You are an auditor and grader.\n`;
      prompt += `OUTPUT FORMAT: Return ONLY the structured evaluation format specified in your task prompt.\n`;
      prompt += `CRITICAL: Do NOT write story content. Do NOT continue the narrative. Do NOT output prose. Grade, analyse, and report only.\n`;
      prompt += `CRITICAL: Do NOT summarise the plot or characters. Evaluate the PROSE TECHNIQUE against the criteria given.\n`;
      return prompt;
    }

    if (planningTypes.includes(step.taskType)) {
      let prompt = `You are the P.E.R.R.Y. System — an expert fiction plotting and world-building architect.\n\n`;
      prompt += `You are working on: "${project.title}"\n`;
      prompt += `Current task: ${step.label}\n\n`;
      prompt += `ROLE: You are an architect of fiction. Your job is to structure, track, and define the narrative elements.\n`;
      prompt += `INSTRUCTIONS: Complete the ENTIRE task in full. Do not skip sections, do not summarize unless explicitly asked, and do not use placeholders.\n`;
      // FIX #11: Replaced negative constraints with positive framing.
      // "Do not write story prose" is a negative constraint — consistent with the positive-framing
      // philosophy applied throughout the pipeline. State what to DO, not what not to do.
      prompt += `FORMATTING: Begin your response immediately with the first section heading. Output structured data only — tables, definitions, and lists. No preamble, no narrative prose.\n`;
      return prompt;
    }

    let prompt = `You are the P.E.R.R.Y. System (Predictive Engine for Rapid Revision & Yield), an expert fiction writing AI assistant.\n\n`;
    prompt += `You are working on: "${project.title}"\n`;
    prompt += `Current task: ${step.label}\n\n`;

    if (step.taskType === 'creative_writing' && step.wordCountTarget) {
      prompt += `TARGET WORD COUNT: ${step.wordCountTarget} words.\n`;
      prompt += `Write the COMPLETE chapter. Do not summarize, truncate, or use placeholders.\n\n`;
    }

    if ((project.context as any).isSeries && (project.context as any).seriesTotalBooks && (project.context as any).seriesCurrentBook) {
      const cur = (project.context as any).seriesCurrentBook;
      const total = (project.context as any).seriesTotalBooks;
      prompt += `SERIES: Book ${cur}/${total}. `;
      if (cur === 1) {
        prompt += `First book — plant hooks, leave the series conflict unresolved. Wrap only this book's plot.\n\n`;
      } else if (cur === total) {
        prompt += `Final book — resolve all series-level arcs and conflicts.\n\n`;
      } else {
        prompt += `Middle book — advance the series plot; resolve only this book's arc.\n\n`;
      }
    }

    // Output-format directive — kept here because it's writer-voice-specific
    // (raw prose, no commentary). The general "complete the task" directive
    // that used to live here is now in the prompt-builder's Anti-Laziness
    // slot, applied uniformly to all non-analytical steps. Em-dash + word
    // repetition + dialogue rules also moved to prompt-builder's Prose Style
    // Controls slot (the previous rule here conflicted with that one — em
    // dashes ≤2 per 400w vs the slot's stricter ≤1 per 500w).
    prompt += `CRITICAL FORMATTING INSTRUCTION: Output ONLY the raw story prose. Do NOT output any conversational filler, introductory remarks, or revision notes (e.g. "Here is the revised chapter..."). Do NOT explain what you changed. Just output the story.\n`;

    // ── Style DNA Seed Injection ──────────────────────────────────────────────
    // Inject the compact DNA seed into the system prompt for creative writing
    // and revision execution steps. This replaces the old approach of dumping
    // the full 4,000+ token DNA blob into the user message.
    //
    // `disableStyleDna: true` on project.context is the "uncontaminated baseline"
    // mode — used during the first calibration pass for a new pen, so the prose
    // reflects what the base model *naturally* does for the pen's genre/voice
    // without any learned directives or golden examples biasing it. Pen anti-
    // patterns + voice tagline still inject (those are user-curated identity,
    // not learned feedback).
    //
    // ROUTING-TARGET GUARD: when the step routes to the writer (the trained
    // pen-name LoRA, e.g. perry-a-perry:v7), the LoRA already encodes every
    // ban / show-vs-tell / golden example from its training data. Injecting
    // them again wastes tokens, and negative instructions ("NEVER use X")
    // sometimes anchor fine-tuned models TOWARD the banned text. DNA now
    // only injects when the step is NOT writer-routed — e.g. revision
    // passes that fall back to a base model, or non-LoRA experiments.
    // Post-write lint still flags violations from v7 (see audit enqueue).
    const dnaDisabled = (project.context as any)?.disableStyleDna === true;
    // Global on/off switch — dashboard toggle. Default ON so existing users
    // keep their scaffolding while the LoRA matures; flip OFF once v7 (or
    // any future trained writer) is good enough that the scaffolding hurts
    // more than it helps. When false, ALL DNA injection AND post-write
    // lint are skipped regardless of routing target.
    const dnaGloballyEnabled = this.router.config.get<boolean>('ai.styleDna.enabled', true);
    const routingTarget = this.router.resolveRoutingTarget(step.taskType);
    const skipDnaForWriter = routingTarget === 'writer';
    if (step.taskType === 'creative_writing' || step.taskType === 'revision_execution') {
      const povCharacter = this.detectPovCharacter(project, step);

      // ── Curated DNA injections — SKIPPED for writer-routed steps ──
      // The trained pen-name LoRA already encodes filter bans, show-vs-tell
      // examples, and AI-cliché patterns from its training data. Re-injecting
      // them as negative instructions is redundant at best, anchoring at
      // worst. Post-write lint (see audit enqueue) still flags violations
      // for the dashboard. Non-writer fallback paths (base models, etc.)
      // still get the full DNA scaffolding.
      if (dnaGloballyEnabled && !dnaDisabled && !skipDnaForWriter) {
        const seed = this.styleDna.compileSeed(project.id, step.chapterNumber || 0, povCharacter);
        if (seed) prompt += `\n${seed}\n`;

        // Concrete before/after pairs are more effective than abstract rules.
        const stepLabel = step.label.toLowerCase();
        const sceneType: 'action' | 'dialogue' | 'introspection' | 'general' =
          stepLabel.includes('action') ? 'action' :
          stepLabel.includes('dialogue') ? 'dialogue' :
          stepLabel.includes('introspection') ? 'introspection' : 'general';
        const goldenExamples = this.styleDna.compileGoldenExamples(sceneType, 5);
        if (goldenExamples) prompt += `\n${goldenExamples}\n`;

        // Prose rhythm + anti-AI clichés are ALSO baked into the v7 training
        // data — only inject for non-writer fallbacks. Same constraints as
        // the prior multi-sentence form, ~40% shorter wording.
        prompt += `\n## PROSE RHYTHM\n`;
        prompt += `Mix sentence lengths aggressively: a 15-word sentence, then a 3-word fragment, then a 30-word compound. `;
        prompt += `Never 3+ consecutive sentences at similar length. ≥1 intentional fragment per page. One-word paragraphs for emphasis.\n`;

        prompt += `\n## ANTI-AI CLICHES\n`;
        prompt += `- No "Rule of Three" lists ("He was a ghost. He was a glitch. He was a variable.")\n`;
        prompt += `- No repetitive dialogue tags ("said", "replied") — use action beats\n`;
        prompt += `- No nominalisations: "fluid" not "fluidness"; "synchronize" not "synchronization"\n`;
        prompt += `- No formulaic fragments ("He gasped. A wet sound."; "She smiled. A sad expression.")\n`;
        prompt += `- No cliché similes ("heart hammering like a trapped bird", "eyes like pools")\n`;
        prompt += `- Never use "transcend"\n`;
      }

      // ── Cognitive lens — ALWAYS fires (per-POV, not DNA) ──
      // POV-character context is project-specific; the LoRA can't bake in
      // which character is narrating this particular scene.
      if (povCharacter) {
        prompt += `\n## COGNITIVE LENS (${povCharacter.toUpperCase()})\n`;
        prompt += `Write ONLY what ${povCharacter} would perceive, notice, and misinterpret.\n`;
        prompt += `- Use vocabulary and metaphors drawn from their background and expertise\n`;
        prompt += `- Have them MISS things outside their knowledge domain\n`;
        prompt += `- Include 1-2 moments where they misjudge, misremember, or have a blind spot\n`;
        prompt += `- Their internal monologue should have imperfect grammar — fragments, trailing thoughts, self-corrections\n`;
        prompt += `- Do NOT make every character equally articulate in dialogue. Match their education and emotional state.\n`;
      }
    }

    return prompt;
  }

  /**
   * Get the temperature for a creative writing step based on scene type signals.
   * Different scene types benefit from different randomness levels:
   *   - Dialogue: 0.92-0.98 (high creativity for natural speech)
   *   - Emotional/introspective: 0.88-0.92 (rich internal voice)
   *   - Action/combat: 0.72-0.78 (tight, precise prose)
   *   - Exposition/worldbuilding: 0.75-0.80 (factual consistency)
   *   - Default creative: 0.82-0.88 (balanced)
   *
   * A small jitter (±0.03) is added so no two chapters have identical texture.
   */
  private getSceneTemperature(promptContent: string, step: ProjectStep): number {
    const lower = promptContent.toLowerCase();
    const jitter = (Math.random() - 0.5) * 0.06; // ±0.03

    // Prologue/Epilogue tend to be more atmospheric
    if (step.chapterNumber === 0 || step.label.includes('Epilogue')) {
      return Math.min(1.0, Math.max(0.7, 0.90 + jitter));
    }

    // Detect scene type from outline content or prompt keywords
    // Expanded keyword sets to catch natural outline phrasing variations
    const dialogueSignals = ['dialogue', 'conversation', 'argues', 'confronts', 'discusses', 'reveals to',
      'argument', 'debate', 'interrogat', 'negotiate', 'plea', 'confides', 'whispers', 'shouts',
      'phone call', 'meeting', 'interview', 'confront'];
    const actionSignals = ['fight', 'battle', 'chase', 'escape', 'combat', 'explosion', 'attack', 'ambush',
      'pursuit', 'siege', 'shootout', 'brawl', 'duel', 'assault', 'raid', 'standoff', 'flee',
      'infiltrat', 'heist', 'break-in', 'car crash', 'collapse'];
    const emotionalSignals = ['grief', 'loss', 'revelation', 'betrayal', 'confession', 'emotional', 'mourns',
      'heartbreak', 'reunion', 'forgive', 'breakdown', 'crying', 'trauma', 'funeral', 'goodbye',
      'intimate', 'vulnerable', 'regret', 'shame', 'guilt'];
    const expositionSignals = ['discovers', 'explains', 'world-building', 'exposition', 'lore', 'politics',
      'research', 'briefing', 'debrief', 'history', 'backstory', 'flashback', 'investigation',
      'intel', 'data', 'report', 'map', 'archives', 'council'];

    const hasDialogue = dialogueSignals.some(s => lower.includes(s));
    const hasAction = actionSignals.some(s => lower.includes(s));
    const hasEmotion = emotionalSignals.some(s => lower.includes(s));
    const hasExposition = expositionSignals.some(s => lower.includes(s));

    // Priority: action (tight) > dialogue (loose) > emotion (rich) > exposition (precise)
    if (hasAction && !hasDialogue) {
      return Math.min(1.0, Math.max(0.7, 0.75 + jitter));
    }
    if (hasDialogue) {
      return Math.min(1.0, Math.max(0.7, 0.95 + jitter));
    }
    if (hasEmotion) {
      return Math.min(1.0, Math.max(0.7, 0.90 + jitter));
    }
    if (hasExposition) {
      return Math.min(1.0, Math.max(0.7, 0.78 + jitter));
    }

    // Default creative temperature with jitter
    return Math.min(1.0, Math.max(0.7, 0.85 + jitter));
  }

  /**
   * Unload all Ollama models from GPU VRAM to free memory for
   * image generation (ComfyUI/FLUX) or text rendering (Qwen).
   */
  public async flushOllamaVram(): Promise<void> {
    try {
      const ollamaUrls = [
        process.env.OLLAMA_BASE_URL ?? 'http://ollama:11434',
        process.env.OLLAMA_LIBRARIAN_BASE_URL ?? 'http://ollama-embeddings:11434',
      ];

      for (const url of ollamaUrls) {
        const psRes = await fetch(`${url}/api/ps`).catch(() => null);
        if (psRes && psRes.ok) {
          const psData = await psRes.json() as { models: Array<{ name: string }> };
          for (const m of psData.models) {
            await fetch(`${url}/api/generate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: m.name, keep_alive: 0 }),
            }).catch(() => null);
            this.log.info('Unloaded Ollama model to free VRAM', { url, model: m.name });
          }
        }
      }
    } catch (err) {
      this.log.warn('Failed to clear Ollama VRAM', { error: String(err) });
    }
  }

  /**
   * Forces the Section B "Relationship Dynamics Matrix" to be exactly 6 columns,
   * automatically splitting the "Pair" column if the LLM hallucinated a 5-column layout.
   */
  private forceRelationshipMatrixFormat(markdown: string): string {
    const lines = markdown.split('\n');
    let inSectionB = false;
    let outLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/^##\s*B\.\s*Relationship/i) || line.match(/^##\s*\*\*B\.\s*Relationship/i)) {
        inSectionB = true;
        outLines.push(line);
        continue;
      }
      
      // Stop processing Section B when we hit Section C
      if (inSectionB && (line.match(/^##\s*C\./i) || line.match(/^##\s*\*\*C\./i))) {
        inSectionB = false;
        outLines.push(line);
        continue;
      }

      if (inSectionB && line.trim().startsWith('|')) {
        const cells = line.split('|').map(c => c.trim());
        // Remove empty first and last cells from split
        if (cells[0] === '') cells.shift();
        if (cells[cells.length - 1] === '') cells.pop();

        if (cells.length === 5) { // Hallucinated Pair format!
          // Header row
          if (cells[0].toLowerCase().includes('pair')) {
            outLines.push(`| First Character | Second Character | ${cells.slice(1).join(' | ')} |`);
          } 
          // Divider row
          else if (cells[0].includes('---')) {
            outLines.push(`|---|---|${cells.slice(1).map(() => '---').join('|')}|`);
          } 
          // Data row
          else {
            const pairRaw = cells[0];
            // Split by ↔, <->, -, "and", "vs"
            let splitPair = [pairRaw, '?'];
            if (pairRaw.includes('↔')) splitPair = pairRaw.split('↔');
            else if (pairRaw.includes('<->')) splitPair = pairRaw.split('<->');
            else if (pairRaw.includes(' and ')) splitPair = pairRaw.split(' and ');
            else if (pairRaw.includes(' vs ')) splitPair = pairRaw.split(' vs ');
            else if (pairRaw.includes(' - ')) splitPair = pairRaw.split(' - ');
            else if (pairRaw.includes('-')) splitPair = pairRaw.split('-');
            
            // Remove markdown bolding if present
            const charA = (splitPair[0]?.trim() || pairRaw).replace(/\*\*/g, '');
            const charB = (splitPair[1]?.trim() || '?').replace(/\*\*/g, '');

            outLines.push(`| ${charA} | ${charB} | ${cells.slice(1).join(' | ')} |`);
          }
        } else {
          // Already 6 columns (or completely broken), just pass through
          outLines.push(line);
        }
      } else {
        outLines.push(line);
      }
    }

    return outLines.join('\n');
  }

  /**
   * Single source of truth for "should this step be routed to an external
   * worker for research-phase synthesis?" Replaces two near-identical
   * predicates in the dispatch sites that disagreed on edge cases (one
   * checked `project.type === 'book-planning'` only, the other added
   * label-specific conditions).
   *
   * Returns true when:
   *   - dashboard's Researcher panel is set to "Workers", AND
   *   - the step is in the book-planning research phase
   *     (taskType='network_research', or taskType='research' on the
   *     two named synthesis steps).
   */
  private shouldUseWorkersForResearch(project: Project, step: ProjectStep): boolean {
    if ((project.type as string) !== 'book-planning') return false;
    const isResearchStep =
      step.taskType === 'network_research' ||
      (step.taskType === 'research' && (step.label === 'Concept Keywords' || step.label === 'Market & Genre Analysis'));
    if (!isResearchStep) return false;
    const mode = this.router.config.get<string>('ai.ollama.researcherMode', 'local');
    return mode === 'workers';
  }

  /**
   * Generic worker-task fallback. Enqueues a `research_assist` task into
   * task_pool (the worker doc handles this task type as "follow the system
   * prompt verbatim"), polls until the worker reports done/failed, and
   * returns the result shaped like an LLM completion.
   *
   * Originally built for the Researcher panel's "Workers" mode but now
   * handles ANY task type the dynamic routing table sends to 'workers' —
   * outline, book_bible, character_bible, story_architecture, etc.
   * The task-pool side is type-agnostic; the worker doc routes by content,
   * not by task name, so reusing `research_assist` is safer than creating
   * a new task type that the worker doc doesn't recognise.
   */
  private async runResearchAssistTask(opts: {
    project: Project;
    step: ProjectStep;
    systemPrompt: string;
    userContent: string;
    timeoutMs?: number;
  }): Promise<CompletionResponse> {
    const { project, step, systemPrompt, userContent } = opts;
    const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
    const payload = {
      project_id: project.id,
      step_id: step.id,
      step_label: step.label,
      step_task_type: step.taskType,
      pen_slug: (project.context as any).penNameSlug || null,
      system_prompt: systemPrompt,
      user_content: userContent,
      max_tokens: this.router.getOutputBudget('research'),
      temperature: 0.2,
    };
    const ids = this.stateStore.enqueueTasks('research_assist', [payload], (project.context as any).penNameSlug);
    const taskId = ids[0];
    if (!taskId) throw new Error('research_assist enqueue failed (no task id returned)');

    this.log.info('research_assist task enqueued — waiting for worker', { taskId, stepId: step.id, stepLabel: step.label });
    this.eventBus.emit('step:progress', {
      projectId: project.id, stepId: step.id,
      message: `Waiting for external worker to claim research_assist task ${taskId}...`,
    });

    const deadline = Date.now() + timeoutMs;
    const pollMs = 3_000;
    let lastStatus = 'open';
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollMs));
      const row = (this.stateStore as any).db
        .prepare('SELECT status, result, error, claimed_by FROM task_pool WHERE id = ?')
        .get(taskId) as any;
      if (!row) throw new Error(`research_assist task ${taskId} vanished from task_pool`);
      if (row.status !== lastStatus) {
        lastStatus = row.status;
        this.eventBus.emit('step:progress', {
          projectId: project.id, stepId: step.id,
          message: `research_assist task ${taskId}: ${row.status}${row.claimed_by ? ` (worker=${row.claimed_by})` : ''}`,
        });
      }
      if (row.status === 'done') {
        // Worker results land double-JSON-encoded in task_pool.result:
        //   stored:   "{\"project_id\":\"…\",\"step_id\":\"…\",\"result\":\"…\"}"
        //   1st parse → string `{"project_id":"…","step_id":"…","result":"…"}`
        //   2nd parse → { project_id, step_id, result } object
        // The previous single-parse left `parsed` as a STRING, so
        // `parsed.result` was `undefined` and step-runner falsely concluded
        // the worker had returned an empty result — even when it hadn't.
        let parsed: any = {};
        try {
          parsed = row.result ? JSON.parse(row.result) : {};
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        } catch { parsed = { result: row.result }; }
        const text = (parsed && typeof parsed === 'object' && (parsed.result || parsed.output || parsed.text)) || '';
        if (!text) throw new Error(`research_assist task ${taskId} returned empty result`);
        this.log.info('research_assist task complete', { taskId, resultLen: String(text).length });
        return {
          text: String(text),
          tokensUsed: 0,
          promptTokens: 0,
          completionTokens: 0,
          estimatedCost: 0,
          provider: 'workers',
        };
      }
      if (row.status === 'failed') {
        throw new Error(`research_assist task ${taskId} failed: ${row.error || 'unknown'}`);
      }
    }
    // Orphan-recovery: a worker may report done in the few seconds between our
    // last poll and the deadline check. Re-read once before declaring failure
    // so we don't waste a complete result.
    const finalRow = (this.stateStore as any).db
      .prepare('SELECT status, result, error FROM task_pool WHERE id = ?')
      .get(taskId) as any;
    if (finalRow?.status === 'done' && finalRow.result) {
      let parsed: any = {};
      try {
        parsed = JSON.parse(finalRow.result);
        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      } catch { parsed = { result: finalRow.result }; }
      const text = (parsed && typeof parsed === 'object' && (parsed.result || parsed.output || parsed.text)) || '';
      if (text) {
        this.log.warn('research_assist task completed after deadline — recovering orphan result', { taskId, resultLen: String(text).length });
        return { text: String(text), tokensUsed: 0, promptTokens: 0, completionTokens: 0, estimatedCost: 0, provider: 'workers' };
      }
    }
    throw new Error(`research_assist task ${taskId} timed out after ${Math.round(timeoutMs / 1000)}s (no worker reported done)`);
  }

  private async saveStepToDisk(project: Project, step: ProjectStep, result: string): Promise<void> {
    const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60);
    const baseDir = join(this.config.workspaceDir, 'projects', `${project.id}-${slug}`);
    
    // Strict isolation into subdirectories based on phase/taskType
    let subDir = 'analysis';
    if (step.phase === 'writing' || step.taskType === 'creative_writing') subDir = 'manuscript';
    else if (step.taskType === 'export') subDir = 'exports';
    else if (step.phase === 'revision' || step.taskType.includes('revision')) subDir = 'revisions';
    else if (step.phase === 'planning') subDir = 'planning';
    
    const dir = join(baseDir, subDir);
    await mkdir(dir, { recursive: true });

    // Sanitize prose output for creative writing and revision execution steps
    const isProseStep = step.taskType === 'creative_writing' || step.taskType === 'revision_execution';
    const dedupedResult = isProseStep ? this.dedup.deduplicateOutput(result) : result;
    const cleanResult = isProseStep ? this.sanitizer.sanitize(dedupedResult) : dedupedResult;

    const filename = `${step.id}-${step.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50)}.md`;

    // Format content based on step type for clear visual distinction
    let content: string;
    const isCalibration = (project.type as string) === 'style-calibration';

    if (step.taskType === 'creative_writing' || step.taskType === 'revision_execution') {
      // ── Prose Output ──
      // Chapter files are READ as the manuscript itself — emit JUST the
      // chapter title and the prose. No "Generated Prose" subheader, no
      // horizontal rule, no model/date metadata blockquote. When the user
      // (or the export pipeline) concatenates chapter files, the result is
      // a clean book from start to finish. POV audit / model metadata
      // lives in separate review files, not in the prose.
      content = isCalibration
        ? cleanResult                                  // calibration: pure prose
        : `# ${step.label}\n\n${cleanResult}\n`;       // book: title + prose only
    } else if (step.taskType === 'pov_check') {
      // ── Critic / Analysis Output ──
      content = [
        `# ${step.label}`,
        ``,
        `> **Type:** POV Quality Audit | **Evaluated:** ${new Date().toISOString().split('T')[0]}`,
        ``,
        `---`,
        ``,
        `## 🔍 Critic Analysis`,
        ``,
        cleanResult,
      ].join('\n');
    } else if (step.taskType === 'draft_compile') {
      // ── Compiled Chapter ──
      // Same rule as creative_writing — chapter files are manuscript.
      // Title + prose only; metadata lives in audit / review files.
      content = `# ${step.label}\n\n${cleanResult}\n`;
    } else if (step.taskType === 'analysis' && isCalibration) {
      // ── Calibration Summary ──
      content = [
        `# ${step.label}`,
        ``,
        `> **Type:** Calibration Summary | **Pass:** ${new Date().toISOString().split('T')[0]}`,
        ``,
        `---`,
        ``,
        `## 📊 Improvement Directives`,
        ``,
        cleanResult,
      ].join('\n');
    } else {
      // ── Default ──
      content = `# ${step.label}\n\n${cleanResult}`;
    }

    await writeFile(join(dir, filename), content, 'utf-8');
  }
}

