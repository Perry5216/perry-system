import type { Project, ProjectStep, CompletionResponse } from '@perry/core';
import { NetworkClient, type NetworkPath } from '../services/network-client.js';
import { join } from 'path';
import type { StepRunnerStrategy } from './BaseRunner.js';
import type { StepRunner } from '../step-runner.js';
import { DomainRegistry } from '../services/domain-registry.js';

function resolveDomainBinding(baseModel: string): { provider: string; model?: string } {
  const parts = baseModel.split('/');
  let provider = parts[0];
  let model = parts.slice(1).join('/');
  
  const PROVIDER_ID_ALIAS: Record<string, string> = {
    writer: 'ollama',
  };
  if (PROVIDER_ID_ALIAS[provider]) {
    provider = PROVIDER_ID_ALIAS[provider];
  }
  return { provider, model: model || undefined };
}

const PATH_SAFE_VARS = new Set(['subjectSlug', 'subjectSlugFallback', 'redditSubs', 'redditAuthorSubs']);

const OL_SUBJECT_ENUM = [
  'fiction', 'non-fiction', 'history', 'biography', 'memoir',
  'science_fiction', 'fantasy', 'cyberpunk', 'epic_fantasy', 'urban_fantasy', 'dark_fantasy',
  'space_opera', 'hard_science_fiction', 'dystopia', 'post-apocalyptic', 'steampunk',
  'mystery', 'thriller', 'horror', 'cozy_mystery', 'detective_and_mystery_stories',
  'crime', 'psychological_thriller', 'noir',
  'romance', 'paranormal_romance', 'contemporary_romance', 'historical_romance',
  'literary_fiction', 'contemporary_fiction', 'historical_fiction', 'classics',
  'military_fiction', 'war_stories', 'war', 'military_history',
  'young_adult', 'childrens_fiction', 'middle_grade',
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
          year:         { type: 'string' },
          rating:       { type: 'string' },
          ratingsCount: { type: 'string' },
          asin:         { type: 'string' },
          sourceCitations: { type: 'array', items: { type: 'string' } },
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

function renderLiveCompTitleScout(json: any): string {
  const comps = Array.isArray(json?.compTitles) ? json.compTitles : [];
  const tags  = Array.isArray(json?.genreTags) ? json.genreTags : [];
  const trop  = Array.isArray(json?.tropes) ? json.tropes : [];
  const disc  = Array.isArray(json?.mostDiscussed) ? json.mostDiscussed : [];

  const compRows = comps.length === 0
    ? '| (none extracted) | — | — | — | — | — | — |'
    : comps.map((c: any) => {
        const cite = Array.isArray(c.sourceCitations) ? c.sourceCitations.map((s: string) => `[${s}]`).join('') : '—';
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

function normaliseSubjectSlug(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

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
  [/sci(-|ence )fi|science fiction/i, 'science_fiction'],
  [/fantasy/i, 'fantasy'],
  [/thriller|suspense/i, 'thriller'],
  [/mystery/i, 'mystery'],
  [/romance/i, 'romance'],
];

function inferSubjectSlug(query: string): string | '' {
  for (const [re, slug] of KEYWORD_TO_SLUG) {
    if (re.test(query)) return slug;
  }
  return '';
}

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

function normaliseRedditSubs(s: string, safetyNet: string = 'books'): string {
  const cleaned = s.replace(/^r\//gi, '').split(/[+,\s]+/)
    .map(x => x.replace(/[^A-Za-z0-9_]/g, ''))
    .filter(x => x.length > 0 && x.length < 30);
  if (!cleaned.includes(safetyNet)) cleaned.unshift(safetyNet);
  return cleaned.slice(0, 5).join('+');
}

function findConceptKeywords(project: { steps: Array<{ status: string; result?: string }> }): Record<string, string> | null {
  for (let i = project.steps.length - 1; i >= 0; i--) {
    const s = project.steps[i];
    if (s.status !== 'completed' || !s.result) continue;
    const cleaned = s.result.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    if (!cleaned.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed?.primaryQuery !== 'string') continue;
      const vars: Record<string, string> = { primaryQuery: parsed.primaryQuery };

      const rawSlug = typeof parsed.subjectSlug === 'string' ? parsed.subjectSlug : '';
      const slug = normaliseSubjectSlug(rawSlug);
      vars.subjectSlug = slug || inferSubjectSlug(parsed.primaryQuery) || 'fiction';

      const rawFallback = typeof parsed.subjectSlugFallback === 'string' ? parsed.subjectSlugFallback : '';
      vars.subjectSlugFallback = normaliseSubjectSlug(rawFallback) || inferFallbackSlug(vars.subjectSlug) || 'fiction';

      vars.subjectQuery = vars.subjectSlug.replace(/_/g, ' ');

      const rawSubs = typeof parsed.redditSubs === 'string' ? parsed.redditSubs : '';
      vars.redditSubs = normaliseRedditSubs(rawSubs || inferReaderSubs(vars.subjectSlug), 'books');

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

function findTopAsins(project: { steps: Array<{ status: string; result?: string }> }, max: number = 5): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (let i = project.steps.length - 1; i >= 0 && ordered.length < max; i--) {
    const s = project.steps[i];
    if (s.status !== 'completed' || !s.result) continue;
    const re = /\b([A-Z0-9]{10})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s.result)) !== null) {
      const candidate = m[1];
      if (!/^(B0|[0-9])/.test(candidate)) continue;
      if (!/[A-Z]/.test(candidate) && !/^\d{10}$/.test(candidate)) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      ordered.push(candidate);
      if (ordered.length >= max) break;
    }
  }
  return ordered;
}

function substituteTemplateVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, key) => {
    if (!(key in vars)) return match;
    return PATH_SAFE_VARS.has(key) ? vars[key] : encodeURIComponent(vars[key]);
  });
}

function substituteTemplateVarsRaw(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, key) => {
    if (key in vars) return vars[key];
    return match;
  });
}

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

function maybeFormatOpenLibraryJson(url: string, body: string): string | null {
  if (!/openlibrary\.org\//i.test(url)) return null;
  let parsed: any;
  try { parsed = JSON.parse(body); } catch { return null; }

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

function maybeFormatAmazonSearch(url: string, body: string): string | null {
  if (!/amazon\.[a-z.]+\/s\?/i.test(url)) return null;
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
    const slice = body.slice(offset, offset + 6_000);
    const titleMatch = slice.match(/<h2[^>]*>[\s\S]{0,200}?<span[^>]*>([\s\S]{1,400}?)<\/span>/i);
    const title = titleMatch ? stripTags(titleMatch[1]) : '?';
    const authorMatch = slice.match(/<a class="a-size-base[^"]*"[^>]*>([\s\S]{1,150}?)<\/a>/i)
                     ?? slice.match(/by\s+(?:<span[^>]*>)?([A-Z][A-Za-z\.\-'\s]{2,80})/i);
    const author = authorMatch ? stripTags(authorMatch[1]) : '?';
    const fmtMatch = slice.match(/>\s*(Kindle\s*(?:Edition|Unlimited)?|Paperback|Hardcover|Audible\s*Audiobook|MP3 CD)\s*</i);
    const format = fmtMatch ? fmtMatch[1].trim() : '?';
    const offMatch = slice.match(/<span class="a-offscreen">\s*((?:[£€$¥₹₽]|GBP|USD|EUR|CAD|AUD|JPY|INR)\s*[0-9]+[.,][0-9]{1,2})\s*<\/span>/i);
    let price: string;
    if (offMatch) {
      price = offMatch[1].trim();
    } else {
      const wholeMatch = slice.match(/class="a-price-whole">([0-9,]+)/);
      const fracMatch = slice.match(/class="a-price-fraction">([0-9]+)/);
      price = wholeMatch ? `$${wholeMatch[1]}${fracMatch ? '.' + fracMatch[1] : ''}` : '?';
    }
    const ratingMatch = slice.match(/(\d\.\d)\s*out of 5 stars/i);
    const reviewsMatch = slice.match(/>\s*([0-9,]{1,12})\s*</);
    const rating = ratingMatch ? ratingMatch[1] : '—';
    const reviews = reviewsMatch ? reviewsMatch[1].replace(/,/g, '') : '?';
    const imgUrlRe = /https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9._\-+]+\.(?:jpg|png|webp)/i;
    let coverUrl = '';
    const sImgMatch = slice.match(/<img[^>]+class="s-image"[^>]*>/i);
    if (sImgMatch) {
      const m = sImgMatch[0].match(imgUrlRe);
      if (m) coverUrl = m[0];
    }
    if (!coverUrl) {
      const broad = slice.match(imgUrlRe);
      if (broad) coverUrl = broad[0];
    }
    return `${i + 1}. [${asin}] "${title}" — ${author} | ${format} | ${price} | ★${rating} (${reviews} reviews)${coverUrl ? `\n   cover: ${coverUrl}` : ''}`;
  });
  return `Amazon search digest (${items.length} results parsed from page):\n\n${items.join('\n')}`;
}

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

  const titleMatch = body.match(/<span\s+id="productTitle"[^>]*>([\s\S]{1,500}?)<\/span>/i);
  const title = titleMatch ? stripTags(titleMatch[1]).slice(0, 200) : '?';

  const authorMatch = body.match(/<span\s+class="author[^"]*"[\s\S]{1,400}?<a[^>]*>([^<]{1,80})<\/a>/i)
                  ?? body.match(/id="bylineInfo"[\s\S]{1,500}?<a[^>]*>([^<]{1,80})<\/a>/i)
                  ?? body.match(/<a[^+]+contributorNameID[^>]*>([^<]{1,80})<\/a>/i)
                  ?? body.match(/<a class="(?:contributorNameID|a-link-normal contributorNameID)"[^>]*>([\s\S]{1,200}?)<\/a>/i);
  const author = authorMatch ? stripTags(authorMatch[1]) : '?';

  const fmtMatch = body.match(/<span\s+class="slot-title"[\s\S]{1,200}?>([^<]{2,30})<\/span>/i)
                ?? body.match(/>(Kindle\s*(?:Edition|Unlimited|eBook)?|Paperback|Hardcover|Audible\s*(?:Audiobook|Original)?|Mass Market Paperback|Audio CD|Library Binding|Spiral-bound)\s*</i);
  const format = fmtMatch ? stripTags(fmtMatch[1]).trim() : '?';

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

  const ratingMatch = body.match(/(\d\.\d)\s*out of 5 stars/i);
  const reviewsMatch = body.match(/id="acrCustomerReviewText"[^>]*>([0-9,]+)/i)
                   ?? body.match(/(\d[\d,]*)\s*(?:global\s*)?ratings?/i);
  const rating = ratingMatch ? ratingMatch[1] : '—';
  const reviews = reviewsMatch ? reviewsMatch[1] : '?';

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

  const descMatch = body.match(/<div\s+id="bookDescription_feature_div"[\s\S]*?<\/div>/i);
  const blurb = descMatch ? stripTags(descMatch[0]).slice(0, 2_000).trim() : '?';

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

export class ResearchRunner implements StepRunnerStrategy {
  canHandle(step: ProjectStep): boolean {
    return step.taskType === 'network_research';
  }

  async execute(project: Project, step: ProjectStep, runner: StepRunner): Promise<string> {
    try {
      runner.log.info('Executing network_research step', { label: step.label });
      runner.eventBus.emit('step:progress', {
        projectId: project.id, stepId: step.id,
        message: 'Fetching network sources...',
      });

      let requests = step.networkRequests || [];
      if (requests.length === 0) {
        throw new Error('network_research step has no networkRequests configured');
      }

      const conceptVars = findConceptKeywords(project) ?? {};
      const topAsins = findTopAsins(project, 5);
      topAsins.forEach((a, i) => { conceptVars[`asin${i + 1}`] = a; });
      let resolvedPrompt = step.prompt;
      if (Object.keys(conceptVars).length > 0) {
        runner.log.info('network_research: vars resolved', { vars: Object.keys(conceptVars), asinCount: topAsins.length });
        requests = requests.map(req => ({
          ...req,
          url: substituteTemplateVars(req.url, conceptVars),
          label: req.label ? substituteTemplateVarsRaw(req.label, conceptVars) : req.label,
        }));
        const beforeFilter = requests.length;
        requests = requests.filter(req => !/\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/.test(req.url));
        if (requests.length < beforeFilter) {
          runner.log.info('network_research: dropped requests with unresolved placeholders', {
            dropped: beforeFilter - requests.length, kept: requests.length,
          });
        }

        const hasRedditCreds =
          (runner.router.config as any).vault?.has?.('reddit_client_id') ||
          !!process.env.REDDIT_CLIENT_ID;
        if (!hasRedditCreds && !process.env.REDDIT_PROXY && !process.env.REDDIT_PROXY_POOL) {
          const beforeReddit = requests.length;
          requests = requests.filter(req => !/(?:^|\.)reddit\.com\//i.test(req.url));
          if (requests.length < beforeReddit) {
            runner.log.info('network_research: skipped Reddit sources (no REDDIT_CLIENT_ID or REDDIT_PROXY)', {
              dropped: beforeReddit - requests.length, kept: requests.length,
            });
          }
        }
        resolvedPrompt = substituteTemplateVarsRaw(step.prompt, conceptVars);
      }

      let result = '';

      if (requests.length === 0) {
        runner.log.info('network_research step skipped: all sources filtered out', { label: step.label });
        result = [
          `## ⚠ STEP SKIPPED — no available sources`,
          ``,
          `Every source for this step was filtered out before fetch. The most`,
          `common cause is Reddit sources being skipped because neither`,
          `REDDIT_CLIENT_ID nor REDDIT_PROXY is set (Reddit blocks anonymous`,
          `datacenter IPs since June 2024). Set REDDIT_PROXY to a residential`,
          `tunnel (e.g. http://gluetun-torguard-uk:8888) or wire Reddit OAuth.`,
        ].join('\n');
      } else {
        const fetches = await Promise.all(requests.map(async req => {
          const fr = await NetworkClient.fetch(req.url, {
            networkPath: (req.networkPath as NetworkPath) || 'direct',
            cacheTtlMs: 24 * 60 * 60 * 1000,
          });
          let digest = fr.ok
            ? (maybeFormatRedditJson(req.url, fr.text)
                ?? maybeFormatOpenLibraryJson(req.url, fr.text)
                ?? maybeFormatAmazonSearch(req.url, fr.text)
                ?? maybeFormatAmazonProduct(req.url, fr.text)
                ?? maybeFormatGoodreadsSearch(req.url, fr.text))
            : null;
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
              runner.log.info('Reddit comment-tree enrichment applied', {
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
        runner.log.info('network_research fetches done', {
          requested: requests.length, success: successCount, bytesTotal,
        });
        runner.eventBus.emit('step:progress', {
          projectId: project.id, stepId: step.id,
          message: `Fetched ${successCount}/${requests.length} sources, sending to librarian...`,
        });

        const MIN_BYTES_FOR_MODEL = 500;
        if (bytesTotal < MIN_BYTES_FOR_MODEL) {
          runner.log.warn('network_research: insufficient fetched data, refusing model call to avoid hallucination', { bytesTotal, threshold: MIN_BYTES_FOR_MODEL });
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
          runner.log.info('network_research step short-circuited (empty data)', { label: step.label });
        } else {
          const contextBlock = fetches.map((f, i) => {
            const label = f.req.label || f.req.url;
            const header = `=== SOURCE ${i + 1}: ${label} (${f.fr.networkPath}, HTTP ${f.fr.status}, ${f.body.length} chars) ===`;
            return f.fr.ok ? `${header}\n${f.body}` : `${header}\n[fetch failed: ${f.fr.text}]`;
          }).join('\n\n');

          const isBookPlanningResearch = (project.type as string) === 'book-planning';

          // Load Domain Override if specified
          const registry = runner.config.workspaceDir ? new DomainRegistry({ workspaceDir: runner.config.workspaceDir, log: runner.log }) : null;
          const domainDef = (registry && project.workType) ? registry.get(project.workType) : null;
          const resolvedDomain = domainDef?.baseModel ? resolveDomainBinding(domainDef.baseModel) : null;

          const useWorkersForResearch = (resolvedDomain && resolvedDomain.provider === 'workers') || runner.shouldUseWorkersForResearch(project, step);

          const researcher = (isBookPlanningResearch && !useWorkersForResearch) ? runner.router.getProvider('researcher') : null;
          const librarian = runner.router.getProvider('librarian');
          const provider = researcher ?? librarian ?? (() => {
            if (resolvedDomain) {
              if (resolvedDomain.provider === 'workers') {
                return { id: 'workers', name: 'External Workers', providerConfig: {} } as any;
              }
              const p = runner.router.getProvider(resolvedDomain.provider);
              if (p) {
                if (resolvedDomain.model) {
                  return { ...p, model: resolvedDomain.model };
                }
                return p;
              }
            }
            return runner.router.selectProvider(step.taskType, project.preferredProvider);
          })();

          runner.log.info('network_research provider selected', {
            provider: useWorkersForResearch ? 'workers' : provider.id,
            model: useWorkersForResearch ? '<external>' : provider.model,
            reason: useWorkersForResearch
              ? 'book-planning research → workers (Claude/Gemini via task_pool)'
              : (researcher ? 'book-planning research → researcher (5090, larger model)' : 'librarian (default for extraction)'),
          });

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

          const domainParams = domainDef?.modelParameters || {};
          const finalTemperature = domainParams.temperature ?? 0.2;
          const finalMaxTokens = domainParams.maxTokens ?? runner.router.getOutputBudget('research');
          const finalRepeatPenalty = domainParams.repeatPenalty;
          const finalTopP = domainParams.topP;
          const finalTopK = domainParams.topK;

          const response = useWorkersForResearch
            ? await runner.runResearchAssistTask({
                project, step,
                systemPrompt: networkResearchSystemPrompt,
                userContent,
              })
            : await runner.router.complete({
                provider: provider.id,
                system: networkResearchSystemPrompt,
                messages: [{ role: 'user', content: userContent }],
                maxTokens: finalMaxTokens,
                temperature: finalTemperature,
                repeatPenalty: finalRepeatPenalty,
                topP: finalTopP,
                topK: finalTopK,
                penSlug: (project.context as any).penNameSlug,
                format: outputFormat,
              });

          if (isLiveCompTitleScout) {
            const rawJson = response.text?.trim() || '{}';
            const cleaned = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
            try {
              const parsed = JSON.parse(cleaned);
              result = renderLiveCompTitleScout(parsed);
              runner.log.info('Live Comp Title Scout: JSON parsed + rendered', {
                compsCount: parsed?.compTitles?.length ?? 0,
                tagsCount: parsed?.genreTags?.length ?? 0,
              });
            } catch (err: any) {
              runner.log.warn('Live Comp Title Scout: JSON parse failed, falling back to raw text', { error: err?.message });
              result = response.text || '(no content returned by extractor model)';
            }
          } else {
            result = response.text || '(no content returned by extractor model)';
          }

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
            runner.log.info('network_research: auto-appended ASINs to result', {
              label: step.label, asinCount: asinsFromDigests.size,
            });
          }

          runner.log.info('network_research step complete', { label: step.label, resultLen: result.length });
        }
      }

      runner.stateStore.completeStep(project.id, step.id, result);
      await runner.saveStepToDisk(project, step, result);
      runner.eventBus.emit('step:completed', { projectId: project.id, stepId: step.id, result });
      runner.eventBus.emit('step:progress', { projectId: project.id, stepId: step.id, message: `Completed: ${step.label}` });

      return result;
    } catch (err: any) {
      runner.stateStore.failStep(project.id, step.id, err.message);
      runner.eventBus.emit('step:failed', { projectId: project.id, stepId: step.id, error: err.message });
      throw err;
    }
  }
}
