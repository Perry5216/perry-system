/**
 * @perry/projects — Template Registry
 *
 * Defines all project types and their step sequences. Each template
 * is a pure data structure — no logic, no side effects.
 *
 * Templates are the DNA of the pipeline. They specify:
 *   - What steps to run
 *   - In what order
 *   - What task type each step uses (for provider routing)
 *   - What prompt to send
 */

import type { ProjectStep, ProjectType, ProjectContext, ProjectTemplate } from '@perry/core';
import { UNIVERSAL_CALIBRATION_ANTI_PATTERNS } from '../../data/calibration-anti-patterns.js';

function step(
  index: number,
  label: string,
  phase: string,
  taskType: string,
  prompt: string,
  opts?: {
    wordCountTarget?: number;
    chapterNumber?: number;
    segmentIndex?: number;
    totalSegments?: number;
    networkRequests?: ProjectStep['networkRequests'];
  },
): ProjectStep {
  // Limit to tasks that legitimately risk hitting the 8k token limit to prevent LLM hallucinating the footer
  const segmentableTypes = ['creative_writing', 'revision_execution'];

  return {
    id: `step-${index}`,
    label,
    phase,
    taskType,
    prompt,
    status: 'pending',
    wordCountTarget: opts?.wordCountTarget,
    chapterNumber: opts?.chapterNumber,
    segmentIndex: opts?.segmentIndex,
    totalSegments: opts?.totalSegments,
    networkRequests: opts?.networkRequests,
  };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Templates
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const bookPlanning: ProjectTemplate = {
  type: 'book-planning',
  workType: 'books',
  name: 'Book Planning',
  description: 'Live comp scout → market analysis → premise → character bible → chapter outline',
  buildSteps: (ctx, title, description) => {
    // Build search URLs from CONCEPT KEYWORDS pulled out of the description,
    // not from the (possibly fictional) title. A title like "The Last Synapse"
    // returns zero useful Reddit/OpenLibrary signal because no book by that
    // name exists yet — what we actually want is the GENRE and HOOK words
    // that real comp titles share with this idea.
    //
    // Goodreads is intentionally NOT used here: their Cloudflare anti-bot
    // returns HTTP 202 empty bodies for server-side curl regardless of UA or
    // exit IP. Would need Playwright/Chromium to bypass. Reddit's book-
    // recommendation subs + OpenLibrary's structured search produce richer
    // signal anyway when fed actual concept words.
    const STOP_WORDS = new Set([
      'the','a','an','and','or','of','in','to','for','with','on','at','by','from','as','is','are','was',
      'were','be','been','have','has','had','that','this','it','its','their','they','them','about',
      'into','then','than','but','also','when','where','what','who','how','why','will','can','would',
      'could','should','may','might','must','some','any','one','two','more','most','very','just',
    ]);
    function extractKeywords(text: string, n: number): string[] {
      const freq = new Map<string, number>();
      for (const raw of (text || '').toLowerCase().replace(/[^a-z0-9\s\-]/g, ' ').split(/\s+/)) {
        const w = raw.trim();
        if (w.length < 4 || STOP_WORDS.has(w)) continue;
        freq.set(w, (freq.get(w) || 0) + 1);
      }
      return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
    }
    // Top concept keywords from the description (genre, hook, mechanics words).
    // Falls back to title words if the description is empty or generic.
    const descKeywords = extractKeywords(description || '', 8);
    const conceptWords = descKeywords.length >= 3
      ? descKeywords
      : extractKeywords(`${title} ${description}`, 8);
    // URL templates use {{subjectSlug}} / {{subjectSlugFallback}} / {{redditSubs}}
    // / {{primaryQuery}} / {{altQueryN}} placeholders that the step-runner
    // substitutes at run time from the upstream "Concept Keywords" step's JSON
    // output. Path-safe vars (slugs, sub lists) are inserted RAW; query vars
    // get URL-encoded automatically — see PATH_SAFE_VARS in step-runner.
    //
    // Strategy: we use REAL APIs that return structured data for the actual
    // genre, not full-text search that returns whatever Reddit's relevance
    // ranker decides is closest:
    //   - OpenLibrary /subjects/{slug}.json → canonical books for a genre
    //     (Altered Carbon for cyberpunk, Slaughterhouse-Five for military_fiction…)
    //   - Reddit /r/{subs}/top.json?t=year → top discussions in genre-relevant
    //     subs (currently top "best sci-fi novel" threads, etc.)
    //   - OpenLibrary /search.json?q=KEYWORD → numFound + first 10 docs;
    //     used to PROBE whether a candidate keyword actually surfaces books.
    void conceptWords; void STOP_WORDS; void extractKeywords; // legacy fallback helpers, kept for visibility

    // ── Step 2 — Comp Title Scout sources ─────────────────────────────────
    // Primary slug + broader fallback: fetch both so we always have data,
    // even if the librarian's primary subject pick has 0 OpenLibrary works.
    const olSubjectPrimaryUrl   = `https://openlibrary.org/subjects/{{subjectSlug}}.json?limit=20`;
    const olSubjectFallbackUrl  = `https://openlibrary.org/subjects/{{subjectSlugFallback}}.json?limit=15`;
    const redditTopYearUrl      = `https://www.reddit.com/r/{{redditSubs}}/top.json?t=year&limit=20`;

    // Google Books — richer per-volume metadata than OL. The URL uses the
    // `{{google_books_api_key}}` placeholder which NetworkClient resolves
    // at fetch time from SecretsService. This keeps the key OUT of logs,
    // OUT of stored network requests, and OUT of cache keys. Source 6 is
    // silently omitted at runtime if the secret isn't set.
    //
    // (Previously the key was inlined into the URL string at template-
    // build time — meaning the literal key shipped in every step's stored
    // networkRequests JSON, plus showed up in any log that printed the URL.
    // That's a worst-practice leak surface. Fixed 2026-05-19.)
    const gbSubjectUrl = `https://www.googleapis.com/books/v1/volumes?q=subject:{{subjectSlug}}&maxResults=15&printType=books&orderBy=relevance&key={{google_books_api_key}}`;
    // Phase 0.5: keep the source list flag based on env presence (we don't
    // have SecretsService access at template-build time). The runtime
    // resolver in NetworkClient drops the request if the key resolves
    // empty, so this is just an optimisation to skip the network round-trip.
    const gbKey = process.env.GOOGLE_BOOKS_API_KEY || '';

    // ── Step 3 — Subgenre Trend Pulse sources ──────────────────────────────
    // /top with shorter time windows captures what readers are talking about
    // RIGHT NOW, not perennial classics. Month + week gives recency layering.
    const redditTopMonthUrl     = `https://www.reddit.com/r/{{redditSubs}}/top.json?t=month&limit=25`;
    const redditTopWeekUrl      = `https://www.reddit.com/r/{{redditSubs}}/top.json?t=week&limit=15`;

    // ── Step 4 — Keyword Reality Check sources ─────────────────────────────
    // For each candidate phrasing, hit OpenLibrary's full-text search and
    // surface numFound + first 10 docs. Score is now a clean integer
    // (numFound) instead of librarian's subjective "1-5 relevance" guess.
    const olProbeUrl = (q: string) => `https://openlibrary.org/search.json?q=${q}&limit=10&fields=title,author_name,first_publish_year,subject,ratings_count`;
    const probe1Url = olProbeUrl('{{primaryQuery}}');
    const probe2Url = olProbeUrl('{{altQuery1}}');
    const probe3Url = olProbeUrl('{{altQuery2}}');

    return [
    // ── Concept Keywords (preflight): one tiny librarian call BEFORE the
    // three live data scouts. Produces strict JSON with genre-specific
    // search phrases derived from the book's description. The downstream
    // network_research steps use {{primaryQuery}} / {{altQueryN}}
    // placeholders in their URLs which the step-runner substitutes from
    // this step's JSON output at run time. Avoids the "title-only" search
    // failure where new/imaginary book titles have no Reddit/OpenLibrary
    // signal — instead we search by actual genre + concept words.
    step(1, 'Concept Keywords', 'research', 'research',
      `Read the book description below CAREFULLY. You are deriving search routing for live book-research scouts. Every output field must reflect the description's actual genre — NOT examples in this prompt, NOT defaults.\n\n` +
      `===== BOOK DESCRIPTION =====\n` +
      `Title: "${title}"\n\n` +
      `Description: ${description}\n` +
      `===== END BOOK DESCRIPTION =====\n\n` +
      `Output ONLY a single JSON object — no prose, no markdown fences. ALL FIVE FIELDS ARE MANDATORY:\n\n` +
      `{\n` +
      `  "subjectSlug": "OpenLibrary subject slug for this book's subgenre. Lowercase + underscores. Examples (pick closest or similar): cyberpunk, epic_fantasy, military_fiction, war_stories, memoir, biography, historical_fiction, romance, cozy_mystery, thriller, horror, literary_fiction, young_adult, science_fiction.",\n` +
      `  "subjectSlugFallback": "BROADER PARENT subject slug for fallback. Examples: science_fiction, fiction, non-fiction, fantasy.",\n` +
      `  "redditSubs": "3-5 READER-side book-discussion subreddits, joined with + (no spaces, no r/ prefix). MUST start with 'books'. Examples: 'books+printSF+Fantasy+suggestmeabook' for sf/fantasy; 'books+RomanceBooks+suggestmeabook' for romance; 'books+MilitaryFiction+history' for war stories.",\n` +
      `  "primaryQuery": "5-7 word reader-search phrase for finding books like this one. Use SUBGENRE name + 1-2 specific concept words from the description.",\n` +
      `  "altQueries": [\n` +
      `    "3-5 word alt phrasing #1 — different angle on same subgenre",\n` +
      `    "3-5 word alt phrasing #2 — emphasizes a different concept",\n` +
      `    "3-5 word alt phrasing #3 — broader parent-genre fallback"\n` +
      `  ]\n` +
      `}\n\n` +
      `Self-check: does subjectSlug match the description's actual genre? Does redditSubs start with 'books'? Are all five fields present? Fix any 'no' before responding.\n\n` +
      `CRITICAL: Output valid JSON only. No comments inside. No text outside the braces. No markdown fences.`),

    // ── Research phase: three live data scouts feeding Market Analysis ────
    // Each runs the librarian (gemma3:12b on the 5070 Ti) over fetched HTML
    // to extract structured findings. URLs contain {{primaryQuery}} /
    // {{altQueryN}} placeholders resolved from step 1's JSON at run time.
    step(2, 'Live Comp Title Scout', 'research', 'network_research',
      `Extract canonical comp-title data for "${title}" from the five structured sources below. ALL sources are genre-targeted by the upstream Concept Keywords step, so they should contain books in this title's actual space.\n\n` +
      `- Source 1: OpenLibrary canonical subject feed for the primary subgenre. Each entry in the JSON's "works" array is a CONFIRMED book in this subgenre (not a search result — these are subject-tagged works).\n` +
      `- Source 2: OpenLibrary canonical subject feed for the BROADER parent subject. Use only when Source 1 has <5 entries.\n` +
      `- Source 3: Reddit /top.json for the year, across genre-relevant book subs. Each post is a top-discussed thread — recommendation threads, "best of" lists, reader reactions. AUTO-ENRICHED with reader comments from the top 3 posts (look for "Reader comment trees" section at the bottom).\n` +
      `- Source 4: Amazon search results (stealth-headless browser) for the primary query. Each result block is pre-extracted into \`[ASIN] "title" — author | format | price | ★rating (reviews)\` with a cover URL.\n` +
      `- Source 5: Goodreads search results (stealth-headless browser) — the RICHEST reader-side data: real ratings_count (often 100k+ for popular books) + "average rating" + Goodreads work-id (the gr: link). This is the gold standard for "what readers actually love in this niche."\n` +
      (gbKey ? `- Source 6: Google Books API for subject:{{subjectSlug}} — JSON list of volumes with full description, categories array, publisher, page count, ISBN. Use to fill missing metadata gaps in Sources 1-5 and to surface books OL doesn't tag with the subject slug.\n\n` : `\n`) +
      `Return EXACTLY this Markdown structure:\n\n` +
      `## Top Comp Titles Found\n` +
      `| Title | Author | Year | Rating | ASIN | Source |\n` +
      `|-------|--------|------|--------|------|--------|\n` +
      `| ... | ... | ... | ... | (from Source 4 if present) | [1], [2], [3], or [4] |\n\n` +
      `Up to 12 entries actually present in the sources. Prefer Source 1 entries when present (they're subject-confirmed); cross-reference against Source 4 to attach ASINs. Pull rating from OL "ratings_average" or Amazon "★rating" if present, else "—". Do NOT invent titles. If sources contain zero relevant entries, output an empty table.\n\n` +
      `## Common Genre Tags\n` +
      `Bulleted list of subject tags from the "subject" arrays in Source 1 and Source 2, deduplicated.\n\n` +
      `## Most-Discussed in Reader Communities\n` +
      `Bulleted list of book titles mentioned BY NAME in Source 3 (Reddit top threads). Include the thread title in parens for traceability.\n\n` +
      `## Reader-Facing Tropes & Themes\n` +
      `Bulleted list of recurring tropes/themes mentioned in Source 3 post titles or selftext. If Source 3 doesn't surface tropes, output an empty list.\n\n` +
      `## Amazon Top-Page-1 ASINs\n` +
      `Comma-separated list of ASINs from Source 4, in the order they appeared. These feed the downstream Amazon Product Deep Dive step — keep this section even if the rest is sparse.`,
      {
        networkRequests: [
          { url: olSubjectPrimaryUrl,  label: 'OpenLibrary /subjects/{{subjectSlug}}.json',         networkPath: 'direct', maxChars: 30_000, rawBody: true },
          { url: olSubjectFallbackUrl, label: 'OpenLibrary /subjects/{{subjectSlugFallback}}.json', networkPath: 'direct', maxChars: 20_000, rawBody: true },
          { url: redditTopYearUrl,     label: 'Reddit /r/{{redditSubs}}/top.json?t=year (+ comment trees)', networkPath: 'direct', maxChars: 45_000, rawBody: true },
          { url: `https://www.amazon.com/s?k={{subjectQuery}}&i=stripbooks`, label: 'Amazon search: "{{subjectQuery}}" (broad subject — narrow phrasings yield <5 results on Amazon)', networkPath: 'browser', maxChars: 22_000, rawBody: false },
          { url: `https://www.goodreads.com/search?q={{subjectQuery}}&search_type=books`, label: 'Goodreads search: "{{subjectQuery}}" (broad subject search — narrower queries return 0 results on GR)', networkPath: 'browser', maxChars: 20_000, rawBody: false },
          ...(gbKey ? [{ url: gbSubjectUrl, label: 'Google Books subject:{{subjectSlug}}', networkPath: 'direct' as const, maxChars: 25_000, rawBody: true }] : []),
        ],
      }),

    step(3, 'Subgenre Trend Pulse', 'research', 'network_research',
      `Extract CURRENT (not perennial) reader-discussion signal from the Reddit /top sources below. These are the highest-upvoted posts of the last MONTH and WEEK in genre-relevant book subs — i.e. what readers are actively talking about right now.\n\n` +
      `Both sources are pre-filtered to subreddits relevant to "${title}"'s genre. Treat every post title and selftext snippet as valid signal — readers asking for recs, complaining about tropes, gushing about new releases.\n\n` +
      `Return EXACTLY this Markdown structure. Each section may be empty (output a single "—" bullet) if the sources don't surface that signal — do not invent.\n\n` +
      `## What Readers Are Excited About (last month)\n` +
      `Bulleted list of specific books, authors, or tropes generating positive buzz. One line per item, citing the source post in brackets.\n\n` +
      `## What Readers Are Complaining About\n` +
      `Bulleted list of gripes — tired tropes, predictable structures, voice missteps. These are anti-targets for the book we're planning.\n\n` +
      `## Frequently Recommended Comp Titles\n` +
      `Book titles mentioned in "what should I read", "books like X", "recommend me Y" threads. Each line: \`Title (Author) — [thread title]\`. Up to 12.\n\n` +
      `## Discussion Themes\n` +
      `Recurring topics / hooks readers are coming BACK to (e.g., "morally complex MCs", "no romance subplots", "darker than the cover suggests"). Bullets.\n\n` +
      `## Subreddit-Level Signal\n` +
      `Which of the fetched subs gave the most material, and what tone dominates there (literary / commercial / pulp / niche).`,
      {
        networkRequests: [
          { url: redditTopMonthUrl, label: 'Reddit /r/{{redditSubs}}/top.json?t=month', networkPath: 'direct', maxChars: 40_000, rawBody: true },
          { url: redditTopWeekUrl,  label: 'Reddit /r/{{redditSubs}}/top.json?t=week',  networkPath: 'direct', maxChars: 30_000, rawBody: true },
        ],
      }),

    step(4, 'Keyword Reality Check', 'research', 'network_research',
      `Validate that three SPECIFIC candidate keyword phrasings actually surface real books for "${title}". Each source is an OpenLibrary full-text search for ONE of the candidates — the JSON has a "numFound" integer (total books matching) and a "docs" array (first 10 matches with title + author + subjects + ratings_count).\n\n` +
      `===== THE THREE CANDIDATES (verbatim, in order) =====\n` +
      `Candidate 1: "{{primaryQuery}}"   → Source 1\n` +
      `Candidate 2: "{{altQuery1}}"      → Source 2\n` +
      `Candidate 3: "{{altQuery2}}"      → Source 3\n` +
      `===== END CANDIDATES =====\n\n` +
      `DO NOT invent new candidates. Score the three above and ONLY the three above, using the numFound integer and docs content from each source.\n\n` +
      `Return EXACTLY this Markdown structure:\n\n` +
      `## Candidate Keywords Tested\n` +
      `| Candidate | numFound | On-genre hits in top 10 | Verdict |\n` +
      `|-----------|----------|-------------------------|---------|\n` +
      `| (verbatim Candidate 1) | (integer from Source 1's numFound) | (count of top-10 docs whose title or subjects look on-genre for this book) | (Strong / Moderate / Weak / Dead — see scoring below) |\n` +
      `| (verbatim Candidate 2) | (integer) | (count) | (verdict) |\n` +
      `| (verbatim Candidate 3) | (integer) | (count) | (verdict) |\n\n` +
      `Scoring: Strong = numFound ≥ 50 AND ≥5 on-genre hits in top 10. Moderate = numFound 10-49 OR 2-4 on-genre hits. Weak = numFound 1-9 with mostly off-genre hits. Dead = numFound = 0.\n\n` +
      `## Confirmed Comp Titles From Probes\n` +
      `Bulleted list of book titles that appear in the top-10 docs of ANY source AND look on-genre for this book. Format: \`Title — Author (year)\`. Up to 12. Do NOT include titles from outside the fetched sources.\n\n` +
      `## Stronger Keyword Phrasings (Suggested)\n` +
      `Up to 7 alternative keyword phrasings derived from RECURRING subjects/title fragments seen across the top-10 docs in the sources above. Each should be a phrasing real readers might use. If results are too weak to derive anything, output a single \`—\` bullet.\n\n` +
      `## Subject Tags Seen\n` +
      `Up to 10 most-frequent values from the "subject" arrays across all three sources, deduplicated. These feed KDP categories + Amazon backend keywords later.`,
      {
        networkRequests: [
          { url: probe1Url, label: 'OpenLibrary probe: "{{primaryQuery}}"', networkPath: 'direct', maxChars: 25_000, rawBody: true },
          { url: probe2Url, label: 'OpenLibrary probe: "{{altQuery1}}"',    networkPath: 'direct', maxChars: 25_000, rawBody: true },
          { url: probe3Url, label: 'OpenLibrary probe: "{{altQuery2}}"',    networkPath: 'direct', maxChars: 25_000, rawBody: true },
        ],
      }),

    // ── Amazon Product Deep Dive ────────────────────────────────────────
    // The Live Comp Title Scout above exposes top-page-1 ASINs from Amazon.
    // Here we drill INTO those ASINs — fetch each product page through the
    // stealth browser and extract BSR ladder, full blurb, "Customers Also
    // Bought" carousel. This is the data that shapes the WRITING itself:
    // recurring blurb hook patterns become Chapter 1 hook material, recurring
    // blurb keywords become diction targets, BSR ranks tell the writer what
    // tier of polish/length the niche rewards. (KDP Launch inherits this via
    // parent project so it isn't redundantly re-fetched at upload time.)
    step(5, 'Amazon Product Deep Dive', 'research', 'network_research',
      `Drill into the top comp ASINs surfaced by Live Comp Title Scout. Each source below is one comp ASIN's product page, pre-extracted into a digest of: title/author/format/price/rating + BSR & categories + full blurb + Customers-Also-Bought ASINs.\n\n` +
      `If a source returned partial data (BSR or Also-Bought may be missing if Amazon served the page in a stripped layout), say so explicitly — do NOT invent BSR numbers or fabricate Also-Bought lists.\n\n` +
      `Deliver:\n\n` +
      `1. **Per-ASIN profile table** — one row per source. Columns: ASIN | Title | Author | Format | Price | ★Rating (reviews) | Top-Category BSR | Notes.\n\n` +
      `2. **Category-rank intelligence** — for each unique category that appears in ANY source's BSR list, count how many comps rank in it and the rank range. This is the closest signal you'll get to "where in the Amazon taxonomy do comps actually compete?".\n\n` +
      `3. **AMS ASIN-targeting payload** — merge ALL "Customers Also Bought" ASINs across sources, deduplicate, rank by frequency. Comma-separated, cap at 50. KDP Launch (downstream project) will use this directly.\n\n` +
      `4. **Blurb hook patterns** — read the descriptions from each source. Extract recurring opening-sentence patterns, recurring stakes-language, recurring tone signals. 5-8 patterns max, each with a one-line example pulled VERBATIM from the source blurbs. THIS IS THE MOST WRITING-RELEVANT OUTPUT — Chapter 1 should land in this aesthetic.\n\n` +
      `5. **Recurring blurb keywords** — frequency analysis of meaningful nouns/verbs/adjectives across all blurbs (ignore stop words). DEDUPLICATED — each lemma appears at MOST once. Top 20 by count. These are the de-facto diction targets the niche rewards.\n\n` +
      `6. **Pricing reality** — median + range of the comp prices. Flag if the spread is wide (mass-market vs premium) so the user can position.\n\n` +
      `Cite every extraction to its source number [1]-[5].`,
      {
        networkRequests: [
          { url: `https://www.amazon.com/dp/{{asin1}}`, label: 'Amazon product page: {{asin1}}', networkPath: 'browser', maxChars: 20_000, rawBody: false },
          { url: `https://www.amazon.com/dp/{{asin2}}`, label: 'Amazon product page: {{asin2}}', networkPath: 'browser', maxChars: 20_000, rawBody: false },
          { url: `https://www.amazon.com/dp/{{asin3}}`, label: 'Amazon product page: {{asin3}}', networkPath: 'browser', maxChars: 20_000, rawBody: false },
          { url: `https://www.amazon.com/dp/{{asin4}}`, label: 'Amazon product page: {{asin4}}', networkPath: 'browser', maxChars: 20_000, rawBody: false },
          { url: `https://www.amazon.com/dp/{{asin5}}`, label: 'Amazon product page: {{asin5}}', networkPath: 'browser', maxChars: 20_000, rawBody: false },
        ],
      }),

    // ── Cover Trends Scout ──────────────────────────────────────────────
    // Lists 20 current-page-1 cover URLs + extracts visual/typography
    // patterns from the search-card text. The cover URLs feed the
    // downstream cover-gen step (ComfyUI) and also nudge the WRITING
    // itself toward scene-level visual language consistent with the niche.
    step(6, 'Cover Trends Scout', 'research', 'network_research',
      `Build a current cover-design reference set for "${title}". Source 1 is the Amazon search page for the primary query — each result card has a thumbnail image URL.\n\n` +
      `Extract:\n\n` +
      `1. **Cover thumbnail URLs** — every \`cover: https://m.media-amazon.com/images/I/…\` line in the Source 1 digest is one entry. Output them ALL (the digest caps at 25). Format as a bulleted list, one URL per line, paired with the title + ASIN that appears on the preceding line of the digest. If a result-card row has no \`cover:\` line, skip that ASIN — do NOT fabricate URLs.\n\n` +
      `2. **Filename / URL-pattern observations** — Amazon image URLs sometimes encode metadata (edition year, size suffix). Note any patterns you see.\n\n` +
      `3. **Title-typography reference** — from the result-card text alone, what title-line patterns do top sellers use? Long subtitle? Author name above title? Series number in the title?\n\n` +
      `4. **Cover-set summary for ComfyUI** — one short paragraph: derive ComfyUI prompt-style cues for cover generation from the genre. Be specific: palette words (e.g. neon, iridescent, deep blues, metallic), mood words (contemplative, enigmatic, advanced), era words (cyberpunk, near future, 22nd century). Also note any scene-level visual cues that should bleed into the WRITING (e.g. "covers lean urban-night → write the city after dark").\n\n` +
      `Cite the source as [1].`,
      {
        networkRequests: [
          { url: `https://www.amazon.com/s?k={{subjectQuery}}&i=stripbooks`, label: 'Amazon search: "{{subjectQuery}}" (broad subject — for cover thumbnails)', networkPath: 'browser', maxChars: 25_000, rawBody: false },
        ],
      }),

    step(7, 'Market & Genre Analysis', 'research', 'research',
      `Synthesize the market positioning for: "${title}"\n\nDescription: ${description}\n\n` +
      `You have FIVE preceding research outputs to draw on. Use them as ground truth — do NOT invent comp titles, trends, or keywords you cannot trace back to one of these sources:\n\n` +
      `- **Live Comp Title Scout** — canonical comp titles from OpenLibrary subject feeds + Reddit reader threads + Amazon page-1 ASINs/prices/ratings\n` +
      `- **Subgenre Trend Pulse** — Reddit /top monthly+weekly: what readers are excited about, complaining about, recommending right now\n` +
      `- **Keyword Reality Check** — OpenLibrary numFound probes validating which candidate keyword phrasings actually surface real books\n` +
      `- **Amazon Product Deep Dive** — BSR ladder + recurring blurb hook patterns + recurring blurb keywords + pricing reality from 5 deep-dived comp ASINs\n` +
      `- **Cover Trends Scout** — current page-1 thumbnail URLs + visual/typography reference for ComfyUI cover gen\n\n` +
      `Produce:\n` +
      `1. **Genre classification** (primary + 2 secondary, anchored to OL subject tags from Comp Title Scout + the categories where comps actually rank from Product Deep Dive)\n` +
      `2. **Comparable titles** (3-5, with ASINs where available, cited from Comp Title Scout AND Product Deep Dive)\n` +
      `3. **Target audience** (with the reader-tone signal from Subgenre Trend Pulse)\n` +
      `4. **Market trends** (3-5, drawn from Trend Pulse's "What Readers Are Excited About")\n` +
      `5. **Reader expectations & must-haves** (cross-reference Trend Pulse praise + Product Deep Dive blurb hook patterns — these are what successful comps PROMISE on the cover)\n` +
      `6. **Anti-patterns to avoid** (cross-reference Trend Pulse complaint list — concrete tropes/structures readers are tired of)\n` +
      `7. **Working keyword set** (top 5-7 phrasings, cross-referenced between Keyword Reality Check "Stronger Keyword Phrasings" AND Product Deep Dive "Recurring blurb keywords")\n` +
      `8. **Voice/diction targets** (top 8-10 lemmas from Product Deep Dive's Recurring blurb keywords — these are the WORDS the writing should naturally use to ride the niche)\n` +
      `9. **Chapter 1 hook framing** (1-2 sentences derived from Product Deep Dive's Blurb hook patterns — the structural template the opening should mirror)\n` +
      `10. **Cover/visual direction** (palette + composition + era cues from Cover Trends Scout, structured as a ComfyUI prompt seed)\n` +
      `11. **BSR competitive read** (the rank range comps occupy in their primary category, derived from Product Deep Dive's Category-rank intelligence — this tells the writer what tier they're realistically aiming for)\n\n` +
      `Be specific and concise. Cite source by step LABEL in brackets (e.g. "[Product Deep Dive]", "[Trend Pulse]"). Anything you can't cite, drop.`),
    step(8, 'Develop Premise', 'premise', 'outline',
      `Based on the market analysis, develop a compelling premise for "${title}".\n\n` +
      `Include: core concept, central conflict, thematic statement, unique hook, ` +
      `stakes (personal/public/philosophical), and a one-paragraph elevator pitch.`),
    step(9, 'Setting Bible', 'bible', 'book_bible',
      `Based on the Premise for "${title}", produce the **Setting Bible** — a single document combining the factions AND the broader world they inhabit. Part 1 (factions) is the authoritative source for the Character Bible's faction assignments; Part 2 (world) anchors every chapter's environmental detail.\n\n` +
      `# PART 1 — FACTIONS\n` +
      `Define every major faction, organisation, or power group. For EACH faction include:\n` +
      `- **Name & Alias**: official name + how they're known colloquially\n` +
      `- **Core Ideology**: what they believe and why (1-2 sentences)\n` +
      `- **Goal**: what they are actively working toward in this book\n` +
      `- **Resources & Power**: what gives them leverage (military, tech, information, numbers, territory)\n` +
      `- **Territory/Domain**: where they operate (physical locations, digital spaces, etc.)\n` +
      `- **Internal Culture**: hierarchy style (rigid military / democratic / cult-like / anarchic), recruitment, rituals\n` +
      `- **Public Perception**: how outsiders see them (feared? respected? unknown?)\n` +
      `- **Weakness/Vulnerability**: what could bring them down\n` +
      `- **Key Tension**: the internal disagreement or schism that threatens them from within\n\n` +
      `## INTER-FACTION RELATIONSHIPS (MANDATORY)\n` +
      `Create a relationship matrix showing how every faction relates to every other faction:\n` +
      `- Alliance / Rivalry / Cold War / Open Conflict / Mutual Ignorance / Exploitation\n` +
      `- One sentence explaining WHY they have this relationship\n\n` +
      `## FACTION ARCS\n` +
      `For each faction, describe their trajectory across this book:\n` +
      `- Where do they START (status quo)?\n` +
      `- What DISRUPTS them?\n` +
      `- Where do they END (transformed, destroyed, ascendant, fractured)?\n\n` +
      `# PART 2 — WORLD\n` +
      `Build the world/setting that contains these factions:\n` +
      `- **Physical setting(s)**: every primary location with distinguishing sensory details\n` +
      `- **Time period & history**: when the story takes place, what precedes it that the reader needs to know\n` +
      `- **Social structures**: how power flows OUTSIDE the named factions (class, caste, currency, status markers)\n` +
      `- **Rules & systems**: technology, magic, physics — what works, what doesn't, what costs what\n` +
      `- **Atmosphere & mood**: the sensory register the prose should hit (oppressive / sterile / liminal / chaotic / etc.)\n` +
      `- **Cultural details**: food, language, ritual, art — three details per faction territory that aren't already in Part 1\n` +
      `- **How the setting creates conflict**: name the friction points where geography or rules force characters to clash\n\n` +
      `# DOWNSTREAM USE\n` +
      `The Character Bible reads Part 1 to assign characters to factions. The Story Architecture reads both parts. Every chapter prompt RAG-retrieves the slices relevant to the current scene — write each section as a self-contained block so the retriever can pull it cleanly.\n\n`),
    step(10, 'Character Bible', 'bible', 'book_bible',
      `Based on the Setting Bible (Part 1 — Factions), create detailed character profiles for "${title}".

` +
      `## CAST REQUIREMENTS (Multi-POV)
` +
      `### Tier 1 — POV Characters (5-7 characters, FULL profiles)
` +
      `These are the characters who will narrate chapters. Each needs: full name, role, faction, ` +
      `physical description (specific and visual), personality traits, detailed backstory, ` +
      `motivation (what they WANT vs what they NEED), character arc (beginning → end state), ` +
      `key relationships to OTHER POV characters, internal conflict, and voice/speech patterns.
` +
      `CRITICAL: Every major faction MUST have at least one POV character. ` +
      `POV characters should have CONFLICTING goals so chapters create natural tension.

` +
      `### Tier 2 — Key Supporting Cast (8-12 characters, INTERACTION profiles)
` +
      `These characters appear repeatedly but don't narrate. Each needs: name, role, faction, ` +
      `brief appearance, personality in 2-3 words, their relationship to 2+ POV characters, ` +
      `what they want, and how they complicate the plot. Include lieutenants, rivals, mentors, ` +
      `love interests, and betrayers.

` +
      `### Tier 3 — Named Minor Characters (4-6 characters, FUNCTION profiles)
` +
      `Characters who appear in 1-3 scenes with a specific function: informants, gatekeepers, ` +
      `victims, witnesses. Each needs: name, faction, function, and one memorable trait.

` +
      `## DIALOGUE FINGERPRINT (MANDATORY for Tier 1 and Tier 2)
` +
      `For each character you MUST also define:
` +
      `- **Contraction rate**: high ("can't", "won't", "I'm") / medium / low (formal speech)
` +
      `- **Reading level**: grade school / high school / academic / streetwise
` +
      `- **Verbal tics**: 2-3 pet phrases, filler words, or habitual expressions unique to them
` +
      `- **Sentence style**: fragments / run-ons / measured / clipped military / rambling
` +
      `- **Interruption style**: interrupts others / gets interrupted / neither / both
` +
      `- **Cognitive bias**: what do they notice first? What do they misread or ignore?

` +
      `## FORBIDDEN NAMES (MANDATORY)
` +
      `The following names are BANNED — they are overused AI defaults that immediately signal machine authorship. ` +
      `Do NOT use any of these names or close variants for any character:
` +
      `Chen, Sarah Chen, Elara, Lyra, Jasper, Lena, Zara, Zane, Niko, Lila, Mira, Leo
` +
      `Choose distinctive, era-appropriate names that feel authored, not generated.`),
    step(11, 'Voice Profile', 'bible', 'voice_profile',
      `Based on the Market & Genre Analysis, Setting Bible, and Character Bible for "${title}", ` +
      `generate a comprehensive Voice Profile that will govern the prose style of the entire novel.\n\n` +
      `## GENRE VOICE\n` +
      `- What narrative voice does this genre demand? (Conversational? Literary? Hardboiled? Lyrical?)\n` +
      `- What POV tense (past/present) best serves this story?\n` +
      `- What sentence rhythm defines the genre's best sellers? (Short punchy? Long flowing? Mixed?)\n\n` +
      `## PROSE TARGETS (provide specific numbers)\n` +
      `- Target average sentence length: [X] words\n` +
      `- Sentence length range: [min]-[max] words (std dev should be high for natural variation)\n` +
      `- Target dialogue-to-narrative ratio: [X]% dialogue\n` +
      `- Contraction rate in narrative: [X]% (higher = more casual)\n` +
      `- Adverb density target: below [X]%\n` +
      `- Paragraph length range: [X]-[Y] sentences\n\n` +
      `## VOICE SAMPLES\n` +
      `Write 3 SHORT sample passages (100-150 words each) that demonstrate the EXACT ` +
      `voice this novel should use. These samples will be injected into every chapter prompt ` +
      `as the style reference. Each sample should demonstrate:\n` +
      `1. A dialogue-heavy scene showing character voice differentiation\n` +
      `2. An action/tension scene showing pacing through sentence length variation\n` +
      `3. An introspective moment showing deep POV internal monologue\n\n` +
      `## ANTI-PATTERNS\n` +
      `List 10-15 specific prose patterns that would make this novel sound AI-generated:\n` +
      `- Overused transitional phrases to avoid\n` +
      `- Sentence structures that create monotony\n` +
      `- Emotional telling patterns specific to this genre\n` +
      `- Description clichés common in AI output for this genre\n\n` +
      `The output of this step will be used as the primary style guide for every chapter.\n\n`),
    step(12, 'Influence Map', 'bible', 'voice_profile',
      `Based on the Voice Profile for "${title}", create an Influence Map that anchors this pen name's style to 2-3 real-world author influences.\n\n` +
      `## PRIMARY INFLUENCES (2-3 authors)\n` +
      `For EACH influence, define:\n` +
      `- **Author Name**: The real author whose work this pen name echoes\n` +
      `- **What We Borrow**: 2-3 SPECIFIC techniques (not vague praise). Example: "McCarthy's lack of quotation marks" or "Gibson's brand-names-as-worldbuilding"\n` +
      `- **What We Reject**: 1-2 aspects of this author's style we deliberately avoid\n` +
      `- **Signature Technique**: The ONE habit from this author that becomes a core part of our pen name's DNA\n\n` +
      `## COMPOSITE VOICE STATEMENT\n` +
      `Write a single sentence that captures the fusion: "Writes like [Author A]'s [technique] meets [Author B]'s [technique], filtered through [unique twist]."\n\n` +
      `## INFLUENCE BOUNDARIES\n` +
      `List 3-5 authors this pen name must NEVER sound like, and why. These are the "anti-influences."\n\n`),
    step(13, 'Vocabulary Fingerprint', 'bible', 'voice_profile',
      `Based on the Voice Profile and Influence Map for "${title}", create a Vocabulary Fingerprint that defines this pen name's unique word-level identity.\n\n` +
      `## SIGNATURE WORDS (15-20 words)\n` +
      `Words this author gravitates toward unconsciously. Include:\n` +
      `- 5-7 sensory/texture words (e.g., "ceramic", "filament", "torque", "ratchet")\n` +
      `- 3-4 emotional/state words (e.g., "hollow", "taut", "static")\n` +
      `- 3-4 action verbs (e.g., "slot", "rack", "seal", "shunt")\n` +
      `- 2-3 transition/rhythm words (e.g., "somewhere", "nothing", "still")\n\n` +
      `## BANNED WORDS (15-20 words)\n` +
      `Words this author would NEVER use:\n` +
      `- 5-7 overused AI words (e.g., "delve", "tapestry", "vibrant", "nuanced", "testament")\n` +
      `- 5-7 purple prose markers (e.g., "beautiful", "stunning", "breathtaking", "magnificent")\n` +
      `- 3-5 genre cliches specific to this book's genre\n\n` +
      `## METAPHOR FAMILY\n` +
      `Define the metaphor domain this author draws from:\n` +
      `- **Primary metaphor source**: (mechanical? biological? geological? architectural? nautical?)\n` +
      `- **Secondary metaphor source**: (weather? music? combat? cooking?)\n` +
      `- **FORBIDDEN metaphor sources**: (dance? tapestry? symphony? painting?)\n` +
      `- Provide 5 example metaphors this author would use and 5 they would never use.\n\n`),
    step(14, 'Structural Habits', 'bible', 'voice_profile',
      `Based on the Voice Profile for "${title}", define the Structural Habits that make this pen name's chapter architecture distinctive.\n\n` +
      `## CHAPTER OPENINGS\n` +
      `How does this author start chapters? Pick ONE dominant pattern:\n` +
      `- Cold open mid-action (no establishing shot)\n` +
      `- Sensory anchor (one specific detail that grounds the scene)\n` +
      `- Dialogue hook (first line is spoken)\n` +
      `- Time/place stamp (clinical, factual)\n` +
      `- Internal thought (deep POV from sentence one)\n` +
      `Explain WHY this pattern fits the genre and provide 2 example opening lines.\n\n` +
      `## CHAPTER ENDINGS\n` +
      `How does this author close chapters? Pick ONE dominant pattern:\n` +
      `- Cliffhanger (mid-action cut)\n` +
      `- Revelation (new information that reframes everything)\n` +
      `- Emotional resonance (quiet moment that lingers)\n` +
      `- Mirror (echoes the opening image/line)\n` +
      `- Decision point (character commits to an irreversible choice)\n\n` +
      `## SCENE TRANSITIONS\n` +
      `- Does this author use section breaks (***) within chapters? How often?\n` +
      `- How are time skips handled? (Hard cut? Transitional sentence? White space?)\n` +
      `- How are location changes handled within a chapter?\n\n` +
      `## PACING ARCHITECTURE\n` +
      `- Scene-to-sequel ratio: what % of each chapter is active scene vs reflective sequel?\n` +
      `- Does this author front-load action or build slowly?\n` +
      `- How long is the average scene before a transition? (1 page? 3 pages? 5 pages?)\n` +
      `- How does this author handle exposition? (Woven into action? Dialogue? Brief narrative asides?)\n\n`),
    step(15, 'Dialogue Fingerprint', 'bible', 'voice_profile',
      `Based on the Character Bible and Voice Profile for "${title}", create a Dialogue Fingerprint that defines how conversation WORKS under this pen name.\n\n` +
      `## ATTRIBUTION STYLE\n` +
      `- Tag frequency: What % of dialogue lines get a tag? (every line? every 3rd? only when ambiguous?)\n` +
      `- Preferred tag word: "said" only? Mixed ("said/asked/whispered")? Action beats instead of tags?\n` +
      `- Adverb-modified tags: NEVER ("said quietly") or RARELY? Give the exact policy.\n` +
      `- Action beat style: before dialogue, after dialogue, or interrupting mid-sentence?\n\n` +
      `## CONVERSATION DYNAMICS\n` +
      `- Do characters interrupt each other? How often?\n` +
      `- Maximum unbroken speech: how many sentences can a character speak before an action beat or interruption?\n` +
      `- How is subtext handled? (Characters say the opposite of what they mean? Silence? Deflection?)\n` +
      `- How is exposition delivered in dialogue? (Characters explaining things they both know is FORBIDDEN)\n\n` +
      `## DIALOGUE RHYTHM SAMPLES\n` +
      `Write 2 short dialogue exchanges (5-8 lines each) that demonstrate:\n` +
      `1. A tense confrontation showing how characters talk PAST each other\n` +
      `2. An intimate/quiet exchange showing how vulnerability sounds in this pen name's voice\n\n` +
      `## DIALOGUE ANTI-PATTERNS\n` +
      `List 5 dialogue mistakes this pen name must NEVER make:\n` +
      `- Example: "As you know, Bob..." exposition dumps\n` +
      `- Example: Characters narrating their own emotions in speech\n` +
      `- Example: Every character sounding the same regardless of background\n\n`),
    step(16, 'Thematic Obsessions', 'bible', 'voice_profile',
      `Based on the Premise and Character Bible for "${title}", define the Thematic Obsessions that will recur across this pen name's entire body of work.\n\n` +
      `## CORE THEMES (2-3 themes)\n` +
      `For EACH theme:\n` +
      `- **Theme Statement**: A single sentence capturing the question this pen name keeps asking (e.g., "Does loyalty require self-destruction?")\n` +
      `- **How It Manifests**: How does this theme appear in THIS book? Which characters embody it?\n` +
      `- **The Pen Name's Position**: Does this author believe in redemption? Justice? Nihilism? What worldview bleeds through?\n` +
      `- **Recurring Motif**: A physical object, image, or action that symbolises this theme (e.g., locked doors, broken mirrors, empty chairs)\n\n` +
      `## THE SIGNATURE MOMENT\n` +
      `Every author has a type of scene they write better than anything else. Define this pen name's signature moment:\n` +
      `- What kind of scene does this author LIVE for? (The betrayal reveal? The quiet after violence? The impossible choice?)\n` +
      `- Write a 100-word sample of this moment at its best.\n\n` +
      `## READER RELATIONSHIP\n` +
      `- How much does this author trust the reader? (Heavy foreshadowing or subtle? Explain mechanics or let readers figure it out?)\n` +
      `- Does this author prioritise intellectual engagement or emotional gut-punch?\n` +
      `- What should the reader feel when they close the book? (Devastated? Hopeful? Unsettled? Satisfied?)\n\n`),
    // World Building merged into Setting Bible (Part 2 above). Step 17
    // slot is reserved so downstream indices don't shift mid-version.
    step(18, 'Subplots & Faction Arcs', 'outline', 'outline',
      `Map out the interconnecting subplots, B-Stories, and C-Stories for "${title}".\n\n` +
      `Ensure every major character from the Character Bible has a defined arc that is not wasted. ` +
      `Using the Setting Bible's inter-faction relationships and faction arcs (Part 1), ` +
      `outline how their individual goals intersect, collide, or align over the course of the book.\n\n`),
    step(19, 'Chapter-by-Chapter Outline', 'outline', 'outline',
      `Create a detailed chapter-by-chapter outline for "${title}".\n\n` +
      `Target: ${ctx.includePrologue ? 'Prologue, ' : ''}${ctx.targetChapters || 25} chapters${ctx.includeEpilogue ? ', Epilogue' : ''} at ~${ctx.targetWordsPerChapter || 3000} words each.\n\n` +
      `For EACH section (including Prologue/Epilogue if applicable) include: chapter number/title, POV character, ` +
      `opening situation, key events, emotional arc, chapter-ending hook, ` +
      `and which plot threads advance.\n\n` +
      `CRITICAL: Ensure a balanced rotation of POV characters to build tension. Track the geography and timeline explicitly so characters do not teleport. Braiding: clearly indicate how each chapter advances the B-Stories and C-Stories established in the Subplots step.\n\n` +
      `MANDATORY FORMAT — each chapter MUST use this EXACT header structure (use numeric digits, NOT word numbers):\n` +
      `## Chapter 1: [Title]\n` +
      `**POV:** [Character Name]\n` +
      `**Opening:** [situation]\n` +
      `**Key Events:** [events]\n` +
      `**Emotional Arc:** [arc]\n` +
      `**Hook:** [hook]\n` +
      `**Plot Threads:** [threads]\n\n` +
      `Do NOT use word-numbers (e.g. "Chapter One"). Do NOT use tables. Do NOT use Roman numerals. ` +
      `Use "## Chapter 1:", "## Chapter 2:", etc. exactly. The downstream pipeline depends on this.\n\n` +
      `Generate ALL ${ctx.targetChapters || 25} chapters in one continuous response. If you run out of space, continue from where you stopped — do not restart.`),
    // Tension Blueprint + Foreshadowing & Payoff Map + Scene-Level Breakdown
    // collapsed into a single Story Architecture step that produces all three
    // sections (A/B/C) in one document. Downstream prompts read Section C
    // (scene breakdown) as the chapter script and reference Sections A & B
    // for tension / seed context. Mirror of the novel-pipeline merge so the
    // parent (book-planning) and child (novel-pipeline) projects share a
    // consistent step graph and the parent's Story Architecture can be
    // inherited verbatim by the child.
    step(20, 'Story Architecture', 'outline', 'outline',
      `Based on the Chapter-by-Chapter Outline for "${title}", produce the **Story Architecture** — a single document combining the Tension Blueprint, Foreshadowing & Payoff Map, AND the per-scene breakdown that drives every chapter prompt.\n\n` +
      `# SECTION A — TENSION BLUEPRINT\n` +
      `For each chapter, assign:\n` +
      `- **Tension Target** (1-10 scale): How tense should this chapter FEEL to the reader?\n` +
      `- **Beat Type**: What structural beat does this chapter occupy? (Inciting Incident, Rising Action, Midpoint Reversal, Dark Night, Climax, Aftermath, Breathing Room, etc.)\n` +
      `- **Energy**: Rising / Falling / Peak / Decompression / Plateau\n` +
      `- **Pacing Note**: Should this chapter move FAST (short scenes, action, dialogue) or SLOW (introspection, atmosphere, world-building)?\n\n` +
      `Then identify:\n` +
      `- The 3-Act structure mapped to specific chapter ranges\n` +
      `- Any tension valleys (3+ consecutive chapters below 5/10) — these MUST be fixed\n` +
      `- Any missing beats (no midpoint? no all-is-lost moment?)\n` +
      `- The peak tension chapter (should be in the final 20% of the book)\n\n` +
      `Output as a Markdown table with columns: Chapter | Tension (1-10) | Beat Type | Energy | Pacing Note\n\n` +
      `# SECTION B — FORESHADOWING & PAYOFF MAP\n` +
      `Map EVERY setup/payoff pair. For each seed:\n` +
      `- **Seed ID**: F-01, F-02, etc.\n` +
      `- **Plant Chapter**: Which chapter plants the seed?\n` +
      `- **Plant Description**: What exactly is the setup?\n` +
      `- **Payoff Chapter**: Which chapter pays it off?\n` +
      `- **Payoff Description**: How does the payoff land?\n` +
      `- **Type**: Chekhov's Gun / Character Revelation / Plot Twist / Thematic Echo / Red Herring\n\n` +
      `Requirements:\n` +
      `- Minimum 15-20 foreshadowing seeds across the novel\n` +
      `- Every major plot twist in the outline MUST have at least 2 seeds planted earlier\n` +
      `- At least 2-3 Red Herrings to keep the reader guessing\n` +
      `- No payoff chapter should be more than 10 chapters from its plant\n` +
      `- Cross-reference with the Subplots step: every B/C-story thread should have setup-payoff tracking\n\n` +
      `Output as a Markdown table with columns: Seed ID | Plant Ch | Plant Description | Payoff Ch | Payoff Description | Type\n\n` +
      `# SECTION C — SCENE-LEVEL BREAKDOWN\n` +
      `For EACH chapter (use a clear "## Chapter N — <Title>" header per chapter so downstream prompts can extract), break it into 2-4 distinct scenes. For each scene:\n` +
      `- **Scene Number & Name**: e.g., "Scene 1: The Briefing"\n` +
      `- **Word Budget**: must sum to the chapter target of ~${ctx.targetWordsPerChapter || 3000}\n` +
      `- **Entry Point**: in medias res / time skip / continuation\n` +
      `- **Scene Goal**: plot advancement / character revelation / tension escalation\n` +
      `- **Exit Point**: scene break / cliffhanger / emotional beat / transition\n` +
      `- **Foreshadowing**: which Section-B seeds are planted or paid off (by Seed ID)\n` +
      `- **Tension**: relative to the chapter's Section-A target\n\n` +
      `CRITICAL RULES for Section C:\n` +
      `- Every scene must accomplish at least 2 of: advance plot, reveal character, build world, escalate tension, explore theme\n` +
      `- No scene exists purely for transition (walking, travelling, arriving)\n` +
      `- Chapter 1 MUST include an Opening Hook Strategy: hook type (in medias res / mystery question / character voice / sensory immersion), first-line concept, mystery question planted in the first 500 words\n` +
      `- The Prologue (if applicable) must specify its genre signal and thematic question\n\n` +
      `This combined document is the single source of truth for every chapter write step. The downstream prompts read Section C as the scene script and reference Sections A & B for tension/seed context.`),
    ];
  },
};


const novelPipeline: ProjectTemplate = {
  type: 'novel-pipeline',
  workType: 'books',
  name: 'Novel Pipeline',
  description: 'Full pipeline: planning → writing → first revision pass',
  buildSteps: (ctx, title, description) => {
    const chapters = ctx.targetChapters || 25;
    const wordsPerChapter = ctx.targetWordsPerChapter || 3000;
    const steps: ProjectStep[] = [];
    let idx = 1;

    // Planning phase (skip if inheriting from a parent)
    if (!ctx.hasParent) {
      steps.push(step(idx++, 'Market & Genre Analysis', 'research', 'research',
        `Analyze the market positioning for: "${title}"\n\n${description}\n\n` +
        `Provide genre classification, 3-5 comparable titles, target audience, ` +
        `3-5 market trends, and relevant tropes. Be concise.`));
      steps.push(step(idx++, 'Develop Premise', 'premise', 'outline',
        `Develop a compelling premise for "${title}" based on the market analysis.\n\n` +
        `Include: core concept, central conflict, thematic statement, unique hook, ` +
        `stakes, and elevator pitch.`));
      steps.push(step(idx++, 'Setting Bible', 'bible', 'book_bible',
        `Based on the Premise for "${title}", produce a single combined Setting Bible covering BOTH the world AND the major factions. ` +
        `This document is the authoritative reference for every chapter prompt — produce it once, in full.\n\n` +
        `## PART 1 — WORLD\n` +
        `Physical settings, time period, social structures, technology/magic/political rules, atmosphere, sensory culture (food/clothing/dialect cues), economy, geography. Be specific and concrete; the writer cites this verbatim.\n\n` +
        `## PART 2 — FACTIONS\n` +
        `For EACH major faction, organisation, or power group, define:\n` +
        `- Name & Alias\n` +
        `- Core Ideology\n` +
        `- Goal\n` +
        `- Resources & Power\n` +
        `- Territory/Domain (must be locatable on the world from Part 1)\n` +
        `- Internal Culture (hierarchy style)\n` +
        `- Public Perception\n` +
        `- Weakness/Vulnerability\n` +
        `- Key Internal Tension\n\n` +
        `### INTER-FACTION RELATIONSHIPS (MANDATORY)\n` +
        `Relationship matrix: Alliance / Rivalry / Cold War / Open Conflict / Mutual Ignorance / Exploitation. One sentence per pair explaining WHY.\n\n` +
        `### FACTION ARCS\n` +
        `For each faction: Where they START → What DISRUPTS them → Where they END.\n\n` +
        `This document feeds the Character Bible step (cast assignment to factions) and the Stat System Definition (faction reputation tracker).`));
      steps.push(step(idx++, 'Character Bible', 'bible', 'book_bible',
        `Based on the Setting Bible (factions section), create detailed character profiles for "${title}".

` +
        `## CAST REQUIREMENTS (Multi-POV)
` +
        `### Tier 1 — POV Characters (5-7 characters, FULL profiles)
` +
        `Characters who narrate chapters. Each needs: name, role, faction, physical description, ` +
        `personality, detailed backstory, motivation (WANT vs NEED), arc (beginning → end), ` +
        `relationships to other POV characters, internal conflict, and voice.
` +
        `Every major faction MUST have at least one POV character. POV characters should have CONFLICTING goals.

` +
        `### Tier 2 — Key Supporting Cast (8-12 characters, INTERACTION profiles)
` +
        `Recurring non-POV characters. Each needs: name, role, faction, appearance, personality, ` +
        `relationships to 2+ POV characters, what they want, how they complicate the plot.

` +
        `### Tier 3 — Named Minor Characters (4-6 characters, FUNCTION profiles)
` +
        `Characters in 1-3 scenes. Each needs: name, faction, function, one memorable trait.

` +
        `## DIALOGUE FINGERPRINT (MANDATORY for Tier 1 and Tier 2)
` +
        `For each character define: contraction rate (high/medium/low), reading level, ` +
        `2-3 verbal tics/pet phrases, sentence style (fragments/run-ons/measured/clipped), ` +
        `interruption style, and cognitive bias (what they notice first, what they misread).

` +
        `## FORBIDDEN NAMES (MANDATORY)
` +
        `The following names are BANNED — they are overused AI defaults that immediately signal machine authorship. ` +
        `Do NOT use any of these names or close variants for any character:
` +
        `Chen, Sarah Chen, Elara, Lyra, Jasper, Lena, Zara, Zane, Niko, Lila, Mira, Leo
` +
        `Choose distinctive, era-appropriate names that feel authored, not generated.`));
      steps.push(step(idx++, 'Voice Profile', 'bible', 'voice_profile',
        `Based on the Market & Genre Analysis and Character Bible for "${title}", ` +
        `generate a comprehensive Voice Profile for the novel's prose style.\n\n` +
        `Include:\n` +
        `1. GENRE VOICE — narrative voice, POV tense, sentence rhythm\n` +
        `2. PROSE TARGETS — avg sentence length, sentence range, dialogue ratio, contraction rate, adverb density target\n` +
        `3. VOICE SAMPLES — write 3 sample passages (100-150 words each) demonstrating the exact voice: ` +
        `a dialogue scene, an action scene, and an introspective moment\n` +
        `4. ANTI-PATTERNS — 10-15 specific prose patterns to avoid that would make the novel sound AI-generated\n\n` +
        `This output will be injected into every chapter prompt as the primary style reference.\n\n`));
      // World Building merged into Setting Bible (above).
      steps.push(step(idx++, 'Subplots & Faction Arcs', 'outline', 'outline',
        `Map out the interconnecting subplots, B-Stories, and C-Stories for "${title}". ` +
        `Ensure every major character has a defined arc that is not wasted. ` +
        `Outline how their individual faction goals intersect over the course of the book.\n\n`));
      steps.push(step(idx++, 'Chapter Outline', 'outline', 'outline',
        `Create a chapter-by-chapter outline for "${title}".\n` +
        `Target: ${ctx.includePrologue ? 'Prologue, ' : ''}${chapters} chapters${ctx.includeEpilogue ? ', Epilogue' : ''} × ${wordsPerChapter} words.\n` +
        `For EACH section (including Prologue/Epilogue if applicable): title, POV, opening, key events, emotional arc, ending hook.\n` +
        `CRITICAL: Rotate POVs to build tension, explicitly track geography/timelines, and weave in the established subplots.\n\n`));
      steps.push(step(idx++, 'Scene-Level Breakdown', 'outline', 'outline',
        `Based on the Chapter Outline for "${title}", produce the **Story Architecture** — a single document combining the Tension Blueprint, Foreshadowing & Payoff Map, AND the per-scene breakdown that drives every chapter prompt.\n\n` +
        `Produce these three sections in order:\n\n` +
        `## SECTION A — TENSION BLUEPRINT\n` +
        `For each chapter assign:\n` +
        `- Tension Target (1-10): How tense should it feel?\n` +
        `- Beat Type: Inciting Incident / Rising Action / Midpoint / Dark Night / Climax / Aftermath / Breathing Room\n` +
        `- Energy: Rising / Falling / Peak / Decompression / Plateau\n` +
        `- Pacing Note: FAST (action, dialogue) or SLOW (introspection, atmosphere)\n\n` +
        `Flag: tension valleys (3+ chapters below 5/10), missing structural beats, and whether the peak is in the final 20%.\n` +
        `Output as a Markdown table: Chapter | Tension (1-10) | Beat Type | Energy | Pacing Note\n\n` +
        `## SECTION B — FORESHADOWING & PAYOFF MAP\n` +
        `Map every setup/payoff pair.\n` +
        `Requirements:\n` +
        `- Minimum 15-20 seeds\n` +
        `- Every major twist needs 2+ seeds planted earlier\n` +
        `- 2-3 Red Herrings\n` +
        `- No payoff more than 10 chapters from its plant\n` +
        `Output as a Markdown table: Seed ID (F-01 etc.) | Plant Ch | Plant Description | Payoff Ch | Payoff Description | Type (Chekhov's Gun / Character Revelation / Plot Twist / Thematic Echo / Red Herring)\n\n` +
        `## SECTION C — SCENE-LEVEL BREAKDOWN (the primary writing blueprint)\n` +
        `For EACH chapter (use a clear "## Chapter N — <Title>" header per chapter so downstream prompts can extract):\n` +
        `Break into 2-4 scenes with: Scene Name, Word Budget (sum to ~${wordsPerChapter}), Entry Point, Scene Goal (must accomplish 2+ of: advance plot, reveal character, build world, escalate tension, explore theme), Exit Point, Foreshadowing seed IDs planted/paid off from Section B, Tension relative to Section A target.\n\n` +
        `MANDATORY RULES:\n` +
        `- The POV character for each scene MUST exactly match the POV character assigned to that chapter in the Chapter Outline. Do NOT change or contradict the Chapter Outline's POV.\n` +
        `- Chapter 1 must include Opening Hook Strategy: hook type, first-line concept, mystery question in first 500 words.\n` +
        `- No purely transitional scenes (walking, arriving, eating).\n\n` +
        `This combined document is the single source of truth for every chapter write step. The downstream prompts read Section C as the scene script and reference Sections A & B for tension/seed context.`));
    }

    // MANDATORY SYSTEM SETUP (Runs regardless of parent inheritance)
    steps.push(step(idx++, 'Stat System Definition', 'bible', 'book_bible',
      `Based on the Character Bible, Setting Bible, and Story Architecture (foreshadowing section) for "${title}", define the Live Tracking System.\n\n` +
      `Your task is to generate exactly 5 sections (A, B, C, D, E) containing markdown tables.\n\n` +
      `## A. Character Stats (4-6 numerical stats, scale 1-100)\n` +
      `Define the stats, what they represent, and starting values for each major character.\n` +
      `Examples: Sanity, Processing Power, Faction Influence, Wealth, Morality, Trust Level, etc.\n` +
      `OUTPUT FORMAT (Must be a Markdown Table):\n` +
      `| Character | Stat Name | Starting Value (1-100) | Description |\n\n` +
      `### Narrative Thresholds (CRITICAL)\n` +
      `For EVERY stat defined above, you MUST provide the following format so the AI knows HOW to write the character at their current stat level:\n` +
      `**[Stat Name] Thresholds:**\n` +
      `- **81-100 (Peak)**: How does this character act/think/speak when this stat is maxed? (e.g., Sanity 95 = calm, analytical, long measured sentences)\n` +
      `- **51-80 (Stable)**: Normal behaviour baseline\n` +
      `- **21-50 (Stressed)**: How does prose shift? (e.g., Sanity 35 = paranoid asides, shorter sentences, misreading social cues)\n` +
      `- **1-20 (Critical)**: What breaks? (e.g., Sanity 12 = fragmented internal monologue, hallucinated sensory details, unreliable narration)\n\n` +
      `## B. Relationship Dynamics Matrix\n` +
      `For each major character that interacts significantly with another major character, define their relationship.\n` +
      `OUTPUT FORMAT (Must be an exact 6-column Markdown Table. You MUST separate the characters into two columns):\n` +
      `| First Character | Second Character | Starting Dynamic | Intensity (1-10) | Trajectory (end-of-book goal) | Pressure Point |\n` +
      `|---|---|---|---|---|---|\n` +
      `| Kael | Juno | Uneasy Alliance | 6 | Eventual trust | Faction loyalties |\n\n` +
      `Dynamic types: trust / rivalry / mentor-student / uneasy alliance / romantic tension / dependency / antagonism / loyalty\n\n` +
      `## C. Faction Reputation Tracker\n` +
      `For each major character, define their STARTING REPUTATION with each faction (1-10 scale):\n` +
      `- **1-2 (Hostile)**: Kill/capture on sight. Faction members will be aggressive, deceptive, or flee.\n` +
      `- **3-4 (Distrusted)**: Suspicion, surveillance, denied access. Dialogue will be guarded, evasive.\n` +
      `- **5-6 (Neutral)**: No strong feeling. Transactional interactions only.\n` +
      `- **7-8 (Respected)**: Welcome, cooperative. Will share information and resources.\n` +
      `- **9-10 (Revered)**: Loyalty, deference. Members may sacrifice for this character.\n` +
      `Output: Character | Faction | Starting Reputation (1-10) | Label | Reason\n` +
      `These reputation levels will be injected into writing prompts so faction NPCs react appropriately.\n\n` +
      `## D. Foreshadowing Ledger\n` +
      `Create a Markdown table tracking the Foreshadowing & Payoff Map based on the context.\n` +
      `OUTPUT FORMAT: | Seed ID | Plant Description | Payoff Description |\n` +
      `CRITICAL INSTRUCTION: You must include every single seed. Do not drop any.\n\n` +
      `## E. Subplot Progress Tracker\n` +
      `Create a Markdown table listing every subplot from the context.\n` +
      `OUTPUT FORMAT: | Subplot Name | Status | Notes |\n` +
      `CRITICAL INSTRUCTION: Do NOT leave any subplots out. You must list them all.\n\n` +
      `The per-chapter Live Stat Update will track all five sections (A-E) and generate NARRATIVE DIRECTIVES — specific prose instructions for the next chapter based on current stat levels and faction reputation.\n\n`));

    if (ctx.includePrologue) {
      const actualWords = 1500; // Prologues are capped at 1500 to prevent structural looping and scene padding
      // Raise the split threshold — the smart continuation system handles word count
      // overflow within a single step via Ollama API continuation. Splitting into parts
      // causes pacing problems (each part becomes a mini-arc). Only split if the chapter
      // genuinely exceeds what a single coherent generation can cover (~3000 words).
      // Scene-by-scene mode (opt-in via the System panel toggle) slices the
      // chapter at ~1200 words per segment so v7 writes scene-sized prose
      // instead of 3000-word monoliths. Off → original 3000-word division.
      const sceneDivisor = (ctx as any).sceneByScene ? 1200 : 3000;
      const segments = Math.max(1, Math.ceil(actualWords / sceneDivisor));
      const wordsPerSegment = Math.floor(actualWords / segments);

      for (let s = 1; s <= segments; s++) {
        const segName = segments > 1 ? `Prologue — Part ${s}` : 'Prologue';
        const isFirstSeg = s === 1;
        const isLastSeg = s === segments;
        const continuationBlock = !isFirstSeg
          ? `CONTINUATION RULES (MANDATORY):\n` +
            `- You MUST continue the narrative EXACTLY where Part ${s - 1} left off.\n` +
            `- The Preceding Text context shows you the last 250 words of Part ${s - 1}. Pick up mid-scene, mid-paragraph if necessary.\n` +
            `- Do NOT restart the prologue. Do NOT re-introduce characters or settings already established.\n` +
            `- Do NOT repeat any prose from previous parts.\n\n`
          : '';
        steps.push(step(idx++, segName, 'writing', 'creative_writing',
          (isFirstSeg
            ? `Write the Prologue for "${title}" based on the premise and world building.\n\n`
            : `CONTINUE writing the Prologue for "${title}". This is Part ${s} of ${segments}.\n\n` + continuationBlock) +
          `Requirements:\n` +
          `- Target word count: ${wordsPerSegment} words. ABSOLUTE HARD LIMIT: Do NOT exceed ${wordsPerSegment + 100} words.\n` +
          `- BUDGET RULE (CRITICAL): You must FILL the ${wordsPerSegment}-word budget WITHIN A SINGLE SCENE. ` +
          `Pace the scene generously — give descriptions room to breathe, develop dialogue exchanges fully, ` +
          `expand internal observations, layer sensory detail. Do NOT rush the scene to a close — let it unfold.\n` +
          `- STOP RULE (CRITICAL): Once you reach the target word count, finish the current paragraph and STOP. ` +
          `Do NOT begin a SECOND scene. Do NOT introduce a new setting/POV/time-skip just to fill space. ` +
          `One scene, fully expressed, that hits the word target. The next chapter handles what comes next.\n` +
          (segments > 1 ? `- You are writing Part ${s} of ${segments}. Write fully immersive prose for THIS segment only.\n` : '') +
          (isFirstSeg
            ? `- SINGLE ARC MANDATE: Write ONE complete dramatic scene with a clear opening, rising tension, and a closing hook. Do NOT start a second scene or second dramatic cycle once you have landed on the hook beat.\n`
            : '') +
          `- Set the tone, establish the world, and plant ONE central mystery or unresolved tension.\n` +
          `- ANTI-LOOP RULE (CRITICAL): Do NOT restart the emotional or dramatic arc mid-way through. If you have already shown a character making a difficult choice, reaching a realisation, or receiving a revelation, DO NOT then show them receiving another revelation or making another difficult choice. One arc. One landing. Stop.\n` +
          `- NO EXPOSITION CHARACTERS: Do NOT introduce a mysterious figure, stranger, or disembodied voice whose only function is to deliver plot information to the POV character (e.g. "Find the MacGuffin", "The real enemy is X"). All world information must emerge from the POV character's own actions, observations, and decisions.\n` +
          `- Write complete, immersive prose — not summary.\n` +
          `- SCENE DIVERSITY: Include at least TWO of: dialogue exchange, action/movement, environmental description, internal monologue. Do NOT write an entire prologue as unbroken interior monologue.\n` +
          `- PUNCTUATION: Em dashes (—) are PROHIBITED except for sharp interruptions. Maximum 1 per 500 words. Two em dashes in the same sentence is a HARD FAILURE.\n` +
          (isLastSeg
            ? `- End on a specific, concrete image or action that functions as a hook — NOT a summary statement or thematic declaration. The reader should feel the ground shift, not be told it shifted.\n\n`
            : `- End mid-flow so the next part can continue seamlessly.\n\n`),
          { wordCountTarget: wordsPerSegment, chapterNumber: 0, segmentIndex: s, totalSegments: segments }));
      }

      if (segments > 1) {
        steps.push(step(idx++, 'Prologue — Compile Draft', 'writing', 'draft_compile',
          `Mechanical compilation of all drafted segments for the Prologue.`,
          { chapterNumber: 0, totalSegments: segments }));
      }

      steps.push(step(idx++, `Prologue — Review`, 'analysis', 'pov_check',
        `Perform a complete narrative quality review AND live tracking update for the Prologue of "${title}". ` +
        `Produce a single structured document with TWO parts. Part 1 is the scored quality audit (parsed automatically — keep the field names exactly as shown). Part 2 is the live-tracking update used to scope Chapter 1's prompt.\n\n` +
        `# PART 1 — QUALITY AUDIT (scored)\n` +
        `Analyse POV (POV character, outline match, deep POV consistency), pacing & plot advancement, plot thread tracking, prologue hook, prose quality (Show vs Tell, filter words), trope execution, AI-isms (rule of three, repetitive dialogue tags, formulaic fragments, cliché similes, nominalization, present participle overuse, adjective stacking).\n\n` +
        `OUTPUT FORMAT for Part 1 (field labels MUST match exactly — automated downstream parsing depends on it):\n` +
        `- **POV Character**: [name]\n` +
        `- **Outline Match**: YES/NO\n` +
        `- **Deep POV Score**: [1-10]\n` +
        `- **Pacing Score**: [1-10]\n` +
        `- **Hook Score**: [1-10]\n` +
        `- **Plot Threads Advanced**: [list]\n` +
        `- **Plot Threads Stalled**: [list or "None"]\n` +
        `- **Tropes Deployed**: [list or "None"]\n` +
        `- **Trope Warnings**: [list or "None"]\n` +
        `- **Filter Words Found**: [list or "None"]\n` +
        `- **Show vs Tell Violations**: [list or "None"]\n` +
        `- **AI-Isms Found**: [list or "None"]\n` +
        `- **Repetition Audit**: [list or "None"]\n` +
        `- **Em Dash Count**: [count]\n` +
        `- **Issues**: [POV breaks / head-hopping / other]\n` +
        `- **Verdict**: PASS / REVISE / REWRITE\n\n` +
        `# PART 2 — LIVE TRACKING UPDATE\n` +
        `## A. Character Stats — all major characters involved in the Prologue\n` +
        `| Character | Stat | Old | New | Justification |\n\n` +
        `## B. Faction Reputation Update — only factions involved\n` +
        `| Character | Faction | Old Rep | New Rep | Label | Trigger Event |\n` +
        `⚠️ Flag any reputation crossing a threshold boundary.\n\n` +
        `## C. Foreshadowing Ledger — seeds PLANTED or PAID OFF\n` +
        `| Seed ID | Status | Notes |\n\n` +
        `## D. Subplot Tracker\n` +
        `| Subplot | Status (ADVANCED / DORMANT) | Notes |\n\n` +
        `## E. Tension Check vs Story Architecture target\n` +
        `| Target | Actual | Beat Type Match | Notes |\n\n` +
        `## F. Relationship Dynamics — only pairs who interacted\n` +
        `| Pair | Dynamic | Intensity Change | Key Moment |\n\n` +
        `## G. NARRATIVE DIRECTIVES (scoped to Chapter 1 ONLY)\n` +
        `For the Chapter 1 POV character:\n` +
        `- Stat levels + threshold band (Peak / Stable / Stressed / Critical)\n` +
        `- How internal monologue should sound\n` +
        `- Relationship tensions with other characters in Chapter 1\n` +
        `- Flag any stat near a threshold boundary\n\n` +
        `For each SUPPORTING character appearing in Chapter 1: stat summary + emotional posture + how they behave toward the POV character.`,
        { chapterNumber: 0 }));
    }

    // Writing phase — one step per chapter
    for (let ch = 1; ch <= chapters; ch++) {
      const actualWords = ctx.chapterWordCounts?.[ch] || wordsPerChapter;
      // Raise the split threshold — the smart continuation system handles word count
      // overflow via Ollama continuation API. Splitting into parts causes pacing problems.
      // Only split if the chapter genuinely exceeds ~3000 words.
      // Scene-by-scene mode (opt-in via the System panel toggle) slices the
      // chapter at ~1200 words per segment so v7 writes scene-sized prose
      // instead of 3000-word monoliths. Off → original 3000-word division.
      const sceneDivisor = (ctx as any).sceneByScene ? 1200 : 3000;
      const segments = Math.max(1, Math.ceil(actualWords / sceneDivisor));
      const wordsPerSegment = Math.floor(actualWords / segments);

      for (let s = 1; s <= segments; s++) {
        const segName = segments > 1 ? `Chapter ${ch} — Part ${s}` : `Chapter ${ch}`;
        const isFirstSeg = s === 1;
        const isLastSeg = s === segments;
        const continuationBlock = !isFirstSeg
          ? `CONTINUATION RULES (MANDATORY):\n` +
            `- You MUST continue the narrative EXACTLY where Part ${s - 1} left off.\n` +
            `- The Preceding Text context shows you the last 250 words of Part ${s - 1}. Pick up mid-scene, mid-paragraph if necessary.\n` +
            `- Do NOT restart the chapter. Do NOT re-introduce characters or settings already established in earlier parts.\n` +
            `- Do NOT repeat any prose from previous parts.\n\n`
          : '';
        // Calculate which scenes belong to this segment (approximate split)
        const sceneGuide = segments > 1
          ? `- SCENE SCOPE: Consult the Scene-Level Breakdown for Chapter ${ch}. You are covering approximately scenes ${Math.ceil((s - 1) * (4 / segments)) + 1}-${Math.ceil(s * (4 / segments))} of the chapter's outline.\n`
          : '';
        steps.push(step(idx++, segName, 'writing', 'creative_writing',
          (isFirstSeg
            ? `Write the beginning of Chapter ${ch} of "${title}" based on the Scene-Level Breakdown.\n\n`
            : `CONTINUE writing Chapter ${ch} of "${title}". This is Part ${s} of ${segments}.\n\n` + continuationBlock) +
          `Requirements:\n` +
          `- Follow the outline and scene budget exactly.\n` +
          `- Target word count: ${wordsPerSegment} words. HARD LIMIT: Do NOT exceed ${wordsPerSegment + 200} words.\n` +
          `- BUDGET RULE (CRITICAL): You must FILL the ${wordsPerSegment}-word budget by EXPANDING the scenes ` +
          `in the outline — pace generously, develop dialogue fully, layer sensory detail, expand internal ` +
          `observations. Do NOT compress or summarise; the outline beats need to be FULLY DRAMATISED.\n` +
          `- STOP RULE (CRITICAL): Once you reach the target word count, finish the current paragraph and STOP. ` +
          `Do NOT begin a NEW scene outside the chapter's outline scope. ` +
          `Do NOT introduce a new POV/setting/time-skip just to fill space.\n` +
          (segments > 1 ? (() => {
            if (isFirstSeg) {
              return `- ARC ROLE (Part ${s} of ${segments}): ESTABLISHMENT. Introduce the scene, ground the reader in the POV character's environment and mindset. Build tension SLOWLY — do NOT resolve anything. End on rising action, not a resolution.\n`;
            } else if (isLastSeg) {
              return `- ARC ROLE (Part ${s} of ${segments}): CLIMAX & HOOK. This is where the chapter's primary tension peaks. Give the climax SPACE — do not rush it. The resolution should feel earned, not compressed. End on a hook that propels the reader into the next chapter.\n`;
            } else {
              return `- ARC ROLE (Part ${s} of ${segments}): ESCALATION. Deepen the conflict, raise the stakes, introduce complications. Do NOT resolve the primary tension — that is reserved for Part ${segments}. End on a rising beat, not a conclusion.\n`;
            }
          })() : 
            `- PACE AND BREATHE: Do not rush through the outline beats. Expand the moment. Give interactions space to breathe. Use environmental storytelling to anchor the reader. When something important happens, SLOW DOWN the narrative time.\n` +
            `- SHOW, DON'T TELL: Do not summarize emotions or plot points. Root every realization in physical sensations, micro-expressions, and specific, concrete actions.\n` +
            `- SENSORY RICHNESS: Every scene must ground the reader in at least three senses (sight, sound, smell, texture, temperature). Avoid generic descriptions; use specific, evocative details that reflect the POV character's unique worldview.\n`
          ) +
          sceneGuide +
          `- Write complete, immersive prose.\n` +
          (isLastSeg ? `- End with a compelling chapter hook.\n` : `- Do NOT resolve the chapter's central conflict. End mid-flow so Part ${s + 1} can continue seamlessly.\n`) +
          `- Stay consistent with the character bible and world building.\n` +
          `- USE DEEP POV: The narrative voice, descriptions, and internal monologue must deeply reflect the current POV character's specific biases, background, and faction allegiance.\n` +
          `- SCENE DIVERSITY: Vary the narrative mode. Include at least TWO of: dialogue exchange, action/movement, environmental description, internal monologue. Do NOT write an entire segment as a single unbroken interior monologue.\n` +
          `- ANTI-FILLER MANDATE: Do NOT pad the chapter with endless internal monologue, brooding, or mundane transitions (e.g., walking down hallways). If you need to hit the word count target, expand the DIALOGUE, deepen the CONFLICT, and show ACTION. Make events happen. Every single paragraph must advance the plot, tension, or a relationship.\n` +
          `- PUNCTUATION: Em dashes (—) are PROHIBITED except for sharp interruptions. Maximum 1 per 500 words. Use commas, semicolons, colons, or period breaks instead. Two em dashes in the same sentence is a HARD FAILURE.\n\n`,

          { wordCountTarget: wordsPerSegment, chapterNumber: ch, segmentIndex: s, totalSegments: segments }));
      }

      if (segments > 1) {
        steps.push(step(idx++, `Chapter ${ch} — Compile Draft`, 'writing', 'draft_compile',
          `Mechanical compilation of all drafted segments for Chapter ${ch}.`,
          { chapterNumber: ch, totalSegments: segments }));
      }

      // ── Composite Chapter Review ──
      // Replaces the previous POV Check + Live Stat Update pair with a
      // single librarian call producing BOTH the scored quality fields
      // (still parsed by POVGate from the same regex anchors) AND the
      // narrative-directive output the next chapter prompt consumes.
      // Halves the per-chapter analysis time and matches the merged
      // Setting Bible / Story Architecture pattern.
      steps.push(step(idx++, `Chapter ${ch} — Review`, 'analysis', 'pov_check',
        `Perform a complete narrative quality review AND live tracking update for Chapter ${ch} of "${title}". ` +
        `Produce a single structured document with TWO parts. Part 1 is the scored quality audit (parsed automatically — keep the field names exactly as shown). Part 2 is the live-tracking update used to scope the next chapter's prompt.\n\n` +
        `# PART 1 — QUALITY AUDIT (scored)\n` +
        `Analyse:\n` +
        `1. **POV** — POV character, does it match the Chapter Outline, is the deep POV consistent (every description/thought/observation reflects only what this character would notice).\n` +
        `2. **Pacing & plot advancement** — does the chapter spend its words wisely, does the plot actually move, are events happening or just thinking/walking/observing.\n` +
        `3. **Plot thread tracking** — which outline threads advanced, which B/C stories were woven in, which threads that SHOULD have moved were ignored.\n` +
        `4. **Chapter hook** — genuine cliffhanger/revelation/tension point, or fizzle?\n` +
        `5. **Prose quality** — Show vs Tell violations, filter words (felt/saw/noticed/realized/seemed/wondered/watched/heard/knew/thought/decided) quoted.\n` +
        `6. **Trope execution** — which Market & Genre Analysis tropes are deployed/subverted, which are executed as cliché without a fresh angle.\n` +
        `7. **AI-isms** — Rule of Three patterns, repetitive dialogue attribution, formulaic fragments, cliché similes, nominalization, present participle overuse, adjective stacking.\n\n` +
        `OUTPUT FORMAT for Part 1 (the field labels MUST match exactly — automated downstream parsing depends on it):\n` +
        `- **POV Character**: [name]\n` +
        `- **Outline Match**: YES/NO\n` +
        `- **Deep POV Score**: [1-10]\n` +
        `- **Pacing Score**: [1-10] (10 = every scene earns its word count, 1 = nothing happens)\n` +
        `- **Hook Score**: [1-10] (10 = unputdownable cliffhanger, 1 = flat ending)\n` +
        `- **Plot Threads Advanced**: [list]\n` +
        `- **Plot Threads Stalled**: [list or "None"]\n` +
        `- **Tropes Deployed**: [list or "None"]\n` +
        `- **Trope Warnings**: [list or "None"]\n` +
        `- **Filter Words Found**: [list exact sentences or "None"]\n` +
        `- **Show vs Tell Violations**: [list or "None"]\n` +
        `- **AI-Isms Found**: [list or "None"]\n` +
        `- **Repetition Audit**: [list any phrase/image/motif appearing 3+ times with count; CRITICAL if 5+; or "None"]\n` +
        `- **Em Dash Count**: [total count; flag EXCESSIVE if >6 per 1000 words]\n` +
        `- **Issues**: [POV breaks / head-hopping / other problems]\n` +
        `- **Verdict**: PASS / REVISE / REWRITE\n\n` +
        `# PART 2 — LIVE TRACKING UPDATE\n` +
        `## A. Character Stats (ONLY characters who appeared in Chapter ${ch})\n` +
        `Update stats for characters who appeared, were referenced in dialogue, or whose situation changed off-screen. Skip anyone who didn't appear.\n` +
        `| Character | Stat | Old | New | Justification |\n\n` +
        `## B. Faction Reputation Update (ONLY factions involved in Chapter ${ch})\n` +
        `Where a character's actions shifted a faction's view of them. Flag threshold-crossings (e.g. Neutral→Distrusted).\n` +
        `| Character | Faction | Old Rep | New Rep | Label | Trigger Event |\n\n` +
        `## C. Foreshadowing Ledger\n` +
        `Cross-reference the Story Architecture foreshadowing section. Mark PLANTED / PAID OFF / ⚠️ MISSED PLANT / ⚠️ MISSED PAYOFF.\n` +
        `| Seed ID | Expected Action | Actual Status | Notes |\n\n` +
        `## D. Subplot Tracker\n` +
        `Which subplots ADVANCED vs DORMANT. Flag dormant 3+ consecutive chapters as AT RISK.\n` +
        `| Subplot | Status | Consecutive Dormant Count | Notes |\n\n` +
        `## E. Tension Check\n` +
        `Actual chapter tension vs Story Architecture tension target.\n` +
        `| Target Tension | Actual Tension | Beat Type Match | Notes |\n\n` +
        `## F. Relationship Dynamics (ONLY pairs who interacted in Chapter ${ch})\n` +
        `| Pair | Dynamic | Intensity Change | Key Moment |\n\n` +
        `## G. NARRATIVE DIRECTIVES (scoped to Chapter ${ch + 1} ONLY)\n` +
        `Consult the Chapter Outline for who appears in Chapter ${ch + 1}. Generate directives ONLY for those characters.\n` +
        `For the NEXT CHAPTER'S POV character:\n` +
        `- Current stat levels + threshold band (Peak / Stable / Stressed / Critical)\n` +
        `- How their internal monologue should sound at these levels\n` +
        `- Relationship tensions with other characters in that chapter\n` +
        `- Flag any stat near a threshold boundary\n\n` +
        `For each SUPPORTING character appearing in Chapter ${ch + 1}:\n` +
        `- One-line stat summary + current emotional posture\n` +
        `- How they should behave toward the POV character\n\n` +
        `IMPORTANT: If a character last appeared 3+ chapters ago, add a "Last seen" note.\n` +
        `Example: "Marcus (POV) — Sanity: 35/Stressed. Paranoid undertone. Shorter sentences. Misreads Sarah's concern as suspicion."\n` +
        `Example: "Sarah (supporting, last seen Ch ${ch - 2}) — Trust toward Marcus dropped to 4/10 after the lab incident. Guarded and evasive."`,
        { chapterNumber: ch }));

      // Continuity Check every 10 chapters — bumped from 5 to halve the
      // librarian overhead. Per-chapter POV Check + Live Stat Update already
      // catch the most common drift; the long-range check is for cross-arc
      // contradictions that don't show up until further apart.
      if (ch % 10 === 0 && ch < chapters) {
        steps.push(step(idx++, `Continuity Check (Ch 1-${ch})`, 'analysis', 'continuity_check',
          `Review the narrative of "${title}" from the Prologue through Chapter ${ch} for internal contradictions.\n\n` +
          `Check for:\n` +
          `- Characters in two places at once\n` +
          `- Timeline impossibilities\n` +
          `- Attribute contradictions (appearance, age, weapon, etc.)\n` +
          `- Dropped plot threads that were set up but never advanced\n` +
          `- Name/spelling inconsistencies\n` +
          `- Faction allegiance contradictions\n` +
          `- References to characters, locations, or concepts that do NOT exist in the project Bible/Outline\n` +
          `- Information revealed too early (the reader should not know information that hasn't been established or suggested yet)\n` +
          `- CRITICAL: ONLY evaluate the text from Prologue through Chapter ${ch}. Do NOT hallucinate contradictions involving future chapters that have not been written yet.\n\n` +
          `OUTPUT FORMAT (you MUST follow this exactly):\n` +
          `If NO issues found, respond with EXACTLY: "No continuity issues detected through Chapter ${ch}." and NOTHING ELSE.\n\n` +
          `If issues ARE found, use this format for EACH issue, and DO NOT include the "No continuity issues" phrase anywhere in your response:\n` +
          `### [Issue Number]. [Short Title]\n` +
          `**Contradiction:** [Describe the contradiction]\n` +
          `**Affected Chapters:** Chapter [N], Chapter [M] (list ALL affected chapter numbers explicitly)\n` +
          `**Suggested Fix:** [Describe the fix]\n`,
          { chapterNumber: ch }));
      }
    }

    if (ctx.includeEpilogue) {
      const actualWords = wordsPerChapter;
      // Scene-by-scene mode (opt-in via the System panel toggle) slices the
      // chapter at ~1200 words per segment so v7 writes scene-sized prose
      // instead of 3000-word monoliths. Off → original 3000-word division.
      const sceneDivisor = (ctx as any).sceneByScene ? 1200 : 3000;
      const segments = Math.max(1, Math.ceil(actualWords / sceneDivisor));
      const wordsPerSegment = Math.floor(actualWords / segments);

      for (let s = 1; s <= segments; s++) {
        const segName = segments > 1 ? `Epilogue — Part ${s}` : 'Epilogue';
        const isFirstSeg = s === 1;
        const isLastSeg = s === segments;
        const continuationBlock = !isFirstSeg
          ? `CONTINUATION RULES (MANDATORY):\n` +
            `- You MUST continue the narrative EXACTLY where Part ${s - 1} left off.\n` +
            `- The Preceding Text context shows you the last 250 words of Part ${s - 1}. Pick up mid-scene, mid-paragraph if necessary.\n` +
            `- Do NOT restart the epilogue. Do NOT re-introduce characters or settings already established.\n` +
            `- Do NOT repeat any prose from previous parts.\n\n`
          : '';
        steps.push(step(idx++, segName, 'writing', 'creative_writing',
          (isFirstSeg
            ? `Write the beginning of the Epilogue for "${title}" based on the outline and previous chapters.\n\n`
            : `CONTINUE writing the Epilogue for "${title}". This is Part ${s} of ${segments}.\n\n` + continuationBlock) +
          `Requirements:\n` +
          `- Target word count: ${wordsPerSegment} words. HARD LIMIT: Do NOT exceed ${wordsPerSegment + 200} words.\n` +
          (segments > 1 ? `- You are writing Part ${s} of ${segments}. Write fully immersive prose for THIS segment only.\n` : '') +
          (isFirstSeg ? `- Begin resolving lingering tension.\n` : '') +
          (isLastSeg ? `- Establish the new status quo (or set up a sequel).\n` : '') +
          `- Write complete prose, not summary\n` +
          `- Stay consistent with the character bible and world building\n` +
          `- SCENE DIVERSITY: Vary the narrative mode. Include at least TWO of: dialogue exchange, action/movement, environmental description, internal monologue.\n` +
          `- PUNCTUATION: Em dashes (—) are PROHIBITED except for sharp interruptions. Maximum 1 per 500 words. Use commas, semicolons, colons, or period breaks instead. Two em dashes in the same sentence is a HARD FAILURE.\n` +
          (!isLastSeg ? `- End mid-flow so the next part can continue seamlessly.\n\n` : '\n\n'),
          { wordCountTarget: wordsPerSegment, chapterNumber: chapters + 1, segmentIndex: s, totalSegments: segments }));
      }

      if (segments > 1) {
        steps.push(step(idx++, 'Epilogue — Compile Draft', 'writing', 'draft_compile',
          `Mechanical compilation of all drafted segments for the Epilogue.`,
          { chapterNumber: chapters + 1, totalSegments: segments }));
      }

      steps.push(step(idx++, `Epilogue — Review`, 'analysis', 'pov_check',
        `Perform a complete narrative quality review AND final-state tracking reconciliation for the Epilogue of "${title}". ` +
        `Produce a single structured document with TWO parts. Part 1 is the scored quality audit (parsed automatically — keep the field names exactly as shown). Part 2 is the final book-level reconciliation.\n\n` +
        `# PART 1 — QUALITY AUDIT (scored)\n` +
        `Analyse POV, pacing, plot thread tracking, hook (epilogue landing or sequel setup), prose quality (Show vs Tell, filter words), trope execution, AI-isms.\n\n` +
        `OUTPUT FORMAT for Part 1 (field labels MUST match exactly):\n` +
        `- **POV Character**: [name]\n` +
        `- **Outline Match**: YES/NO\n` +
        `- **Deep POV Score**: [1-10]\n` +
        `- **Pacing Score**: [1-10]\n` +
        `- **Hook Score**: [1-10]\n` +
        `- **Plot Threads Advanced**: [list]\n` +
        `- **Plot Threads Stalled**: [list or "None"]\n` +
        `- **Tropes Deployed**: [list or "None"]\n` +
        `- **Trope Warnings**: [list or "None"]\n` +
        `- **Filter Words Found**: [list or "None"]\n` +
        `- **Show vs Tell Violations**: [list or "None"]\n` +
        `- **AI-Isms Found**: [list or "None"]\n` +
        `- **Repetition Audit**: [list or "None"]\n` +
        `- **Em Dash Count**: [count]\n` +
        `- **Issues**: [POV breaks / other]\n` +
        `- **Verdict**: PASS / REVISE / REWRITE\n\n` +
        `# PART 2 — FINAL BOOK-LEVEL RECONCILIATION\n` +
        `## A. Character Stats (final values)\n` +
        `| Character | Stat | Old | New | Justification |\n\n` +
        `## B. Faction Reputation (final standings)\n` +
        `| Character | Faction | Start Rep | Final Rep | Label | Arc Summary |\n\n` +
        `## C. Foreshadowing Ledger (final reconciliation) — flag ⚠️ UNPAID if a seed should have resolved\n` +
        `| Seed ID | Status (PAID OFF / UNPAID / DELIBERATE OPEN) | Notes |\n\n` +
        `## D. Subplot Tracker (final reconciliation)\n` +
        `| Subplot | Final Status (RESOLVED / OPEN / DELIBERATE OPEN) | Notes |\n\n` +
        `## E. Relationship Dynamics (final state)\n` +
        `| Pair | Final Dynamic | Final Intensity | Arc Summary |\n\n` +
        `## F. Book-Level Verdict\n` +
        `One-paragraph assessment: did the Epilogue land the themes, resolve the arcs that needed resolving, and set up the next book in the series` +
        `${ctx.includePrologue ? ' (mirroring or answering the Prologue\'s thematic question)' : ''}?`,
        { chapterNumber: chapters + 1 }));
    }
    return steps;
  }
};

// ── Pen-author calibration constants ────────────────────────────────
// Stat band rotates per pass so a multi-pass run covers all four registers
// the Live Stat system tracks. The model reads the inherited Stat System
// Definition for the locked POV character to know what each band's prose
// rhythm and decision-making should look like.
const STAT_BANDS = [
  { name: 'Peak',     range: '81-100', shortDesc: 'calm, analytical, measured long sentences, character at their best' },
  { name: 'Stable',   range: '51-80',  shortDesc: 'baseline behaviour, default voice as defined in the Character Bible' },
  { name: 'Stressed', range: '21-50',  shortDesc: 'paranoid asides, shorter sentences, misreads social cues, somatic tension' },
  { name: 'Critical', range: '1-20',   shortDesc: 'fragmented internal monologue, hallucinated detail, unreliable narration' },
] as const;

interface CalibrationSceneType {
  slot: number;          // chapterNumber offset within a pass: 100*pass + slot
  name: string;          // full display name
  shortName: string;     // 1-word label for step IDs
  describe: (chapterAnchor: string, chapterNum: number, statBand: string) => string;
  part1Rules: string[];
  part2SelfAudit: string[];
  part2Rules: string[];
  auditFocus: string;
}

const CALIBRATION_SCENE_TYPES: CalibrationSceneType[] = [
  {
    slot: 1, name: 'Action & Pacing', shortName: 'Action',
    describe: (anchor, chN, band) =>
      `Anchor this scene to ${anchor}. Consult Chapter ${chN} of the inherited Chapter Outline if present, otherwise improvise a key physical confrontation that fits the novel's premise. ` +
      `Write the ACTION version: peak physical event in this chapter. POV character is in ${band} state — perception, reaction speed, and decision quality all reflect that.`,
    part1Rules: [
      'Open IN MEDIAS RES — action already happening on word 1',
      'SHORT sentences (5-12 words) at peak action beats',
      'Every action has a physical CONSEQUENCE (cause → effect chain)',
      'At least TWO non-visual sensory details (smell, pain, sound, texture)',
      'Zero filter words: no felt, noticed, saw, heard, realized, looked, stared',
      'Zero named emotions: show state through somatic markers only',
      'End mid-scene — do NOT resolve the action',
    ],
    part2SelfAudit: [
      'Sentences starting with "He/She looked/noticed/felt/thought/stared/remembered"',
      'Named emotion nouns ("desperation", "panic", "relief", "fear")',
      'Internal state attributed to a NON-POV character',
    ],
    part2Rules: [
      'Continue seamlessly from Part 1',
      'End on a beat that FORCES a concrete decision',
      'ZERO filter words — every beat externally observable or somatic',
    ],
    auditFocus: 'filter words, pacing flatness, sensory absence, consequence-free action, AI-isms',
  },
  {
    slot: 2, name: 'Dialogue & Subtext', shortName: 'Dialogue',
    describe: (anchor, chN, band) =>
      `Anchor this scene to ${anchor}. Use Chapter ${chN}'s relationship tension if available. ` +
      `Write a DIALOGUE scene between the locked POV character and one supporting character (from the Cast Roster) with directly conflicting goals. POV character is in ${band} state — their listening, deflection, and word choice reflect that.`,
    part1Rules: [
      'Characters must NOT say what they actually mean — pure subtext and deflection',
      'Use "said" or action beats ONLY — zero exotic tags (hissed, growled, snapped)',
      'Voices must be differentiable without tags',
      'End mid-exchange — do NOT resolve the conflict',
    ],
    part2SelfAudit: [
      'Specific emotion attributed to the NON-POV character ("she was angry that…")',
      'Dialogue stating the subtext explicitly instead of implying it',
      '"he/she felt/noticed/thought" filter sentences',
    ],
    part2Rules: [
      'Embed at least ONE piece of world/faction info via natural conversation — no info-dumps',
      'End on unresolved tension — the real fight is never named',
    ],
    auditFocus: 'on-the-nose dialogue, identical voices, repetitive tags, info-dumping, unearned subtext',
  },
  {
    slot: 3, name: 'Introspection & Deep POV', shortName: 'Introspection',
    describe: (anchor, chN, band) =>
      `Anchor this scene to ${anchor}. Use Chapter ${chN}'s key decision or emotional beat. ` +
      `Write the INTROSPECTIVE aftermath — the locked POV character processing the event in private. POV character is in ${band} state — thought rhythm, focal length, and self-awareness reflect that.`,
    part1Rules: [
      'ZERO thought verbs: no "realized", "wondered", "thought", "felt", "noticed"',
      'Character\'s biases must bleed into every description — the world looks different through them',
      'Use physical sensation as the anchor for emotion (clenched jaw, not "felt angry")',
      'End mid-introspection — do NOT resolve',
    ],
    part2SelfAudit: [
      'Words: felt, thought, realized, wondered, noticed, remembered, imagined',
      'Named emotion as noun/adjective ("a wave of grief", "sudden panic")',
      'Summary statements ("He had failed.", "It was over.")',
    ],
    part2Rules: [
      'Include one memory/past-event intrusion that recontextualises the present',
      'Sentence rhythm must slow and lengthen vs the Action sample',
      'End on a concrete physical action or sensory detail — do NOT summarize theme',
    ],
    auditFocus: 'thought verbs, told emotions, floating-head syndrome, filter words',
  },
  {
    slot: 4, name: 'Setting & World-Building', shortName: 'Setting',
    describe: (anchor, chN, band) =>
      `Anchor this scene to ${anchor}. Use Chapter ${chN}'s primary location if available, otherwise improvise a setting consistent with the inherited Setting Bible (Part 2 — World). ` +
      `Write the SETTING/EXPOSITION introduction — locked POV character entering this space for the first time. POV character is in ${band} state — what they notice and prioritise reflects that.`,
    part1Rules: [
      'NO "tour guide" descriptions: do not pause to explain what the room looks like',
      'Reveal scale and atmosphere through movement + tactile interaction',
      'NO historical info-dumps unless the character actively uncovers them',
      'End mid-scene before they find what they\'re looking for',
    ],
    part2SelfAudit: [
      '"It was..." + adjective constructions ("It was a dark room")',
      'Paragraphs describing architecture without the character moving through it',
      'Clichés like "sprawling labyrinth", "testament to", "stark contrast"',
    ],
    part2Rules: [
      'Introduce a piece of technology or faction artifact without explaining how it works — only how it affects the character',
      'End with the character finally discovering the focal point of the room',
    ],
    auditFocus: 'info-dumping, tour-guide descriptions, "It was" constructions, lack of physical grounding',
  },
  // ── NEW: Confrontation ─────────────────────────────────────────────
  {
    slot: 5, name: 'Confrontation & Verbal Sparring', shortName: 'Confrontation',
    describe: (anchor, chN, band) =>
      `Anchor this scene to ${anchor}. Use Chapter ${chN}'s primary antagonist or rival relationship. ` +
      `Write a CONFRONTATION — a verbal-and-physical showdown between the locked POV character and someone who actively blocks their goal. POV character is in ${band} state — their verbal aggression, restraint, or breakdown reflects that. Physical tension, room geography, and prop use carry equal weight to dialogue.`,
    part1Rules: [
      'Conflicting goals must be SPECIFIC, not generic ("she wants the recording / he wants her gone")',
      'BLOCKING tactics on both sides: denial, deflection, threat, false agreement',
      'NON-verbal weight: silence, withdrawal, prop manipulation, proxemics',
      'NO "explaining what they really mean" — keep it indirect',
      'End at the moment one side gains the upper hand (not the resolution)',
    ],
    part2SelfAudit: [
      'Either party stating the conflict directly ("I am angry because…")',
      'Generic "shouted/yelled/snapped" tag overuse',
      'Either party giving up too easily — no real resistance',
      'Emotional reactions narrated rather than embodied',
    ],
    part2Rules: [
      'Power shifts: the upper hand must change at least once before the end',
      'A specific prop or environmental detail becomes weaponised (literally or metaphorically)',
      'End with one side ACCEPTING (not winning) the confrontation — a tactical retreat or a forced concession',
    ],
    auditFocus: 'on-the-nose conflict statements, lopsided exchanges, missing power shifts, AI-cliché conflict tropes',
  },
  // ── NEW: Discovery & Revelation ─────────────────────────────────────
  {
    slot: 6, name: 'Discovery & Revelation', shortName: 'Discovery',
    describe: (anchor, chN, band) =>
      `Anchor this scene to ${anchor}. Use Chapter ${chN}'s key revelation or information beat. ` +
      `Write a DISCOVERY scene — the locked POV character uncovers a critical piece of information (an artefact, a hidden communication, a fact about another character). POV character is in ${band} state — their interpretation of the discovery, the conclusions they jump to, and what they MISS reflect that. The reader must understand the discovery's significance WITHOUT exposition.`,
    part1Rules: [
      'No expository "as you know" framing',
      'The discovery should be PHYSICAL — an object, a sound, a written/displayed message — not pure dialogue',
      'POV character\'s interpretation should reveal their bias (Stressed = paranoid reading; Peak = clear logical chain)',
      'No "and then she realized" thought verbs — let the realization happen via action',
      'End mid-discovery before the full meaning lands',
    ],
    part2SelfAudit: [
      '"Suddenly she understood/realized/knew" formulations',
      'POV character explaining the discovery directly to the reader',
      'Convenient-information thoughts like "this changes everything"',
      'Information appearing too cleanly without earned struggle',
    ],
    part2Rules: [
      'Show what the character GETS WRONG about the discovery — bias-driven misinterpretation',
      'Tie the discovery to a prior plant from the inherited Foreshadowing Map if any is available in context',
      'End with the character committing to a course of action that may be flawed',
    ],
    auditFocus: 'expository dumps, thought-verb realizations, missing character bias, unfair info-flow to the reader',
  },
  // ── NEW: Quiet & Intimate ───────────────────────────────────────────
  {
    slot: 7, name: 'Quiet & Intimate', shortName: 'Quiet',
    describe: (_anchor, _chN, band) =>
      `Write a QUIET / INTIMATE scene — the locked POV character in a still moment after upheaval, with one other character (or alone). State is ${band}: in Peak this is contemplative clarity; in Stable, ordinary intimacy; in Stressed, vulnerable confession; in Critical, dissociation or breakdown. NO plot advancement — this scene exists for emotional resonance and voice depth.`,
    part1Rules: [
      'NO plot beats — pure character work',
      'Mostly internal/sensory; dialogue is sparse and weighted',
      'Tactile and small-detail focus (a chipped mug, a crease in fabric, a coffee ring)',
      'Time should feel slowed — longer sentences, fewer breaks',
      'End on a small physical action that carries weight',
    ],
    part2SelfAudit: [
      'Resolution of past trauma in a single line (too easy)',
      'Dialogue that explicitly names feelings',
      'Sudden plot interruption that breaks the stillness',
      'Heart-pounding / breath-catching / chest-tightening cliché reactions',
    ],
    part2Rules: [
      'One small physical exchange that carries the emotional truth (a hand on a sleeve, a passed object, a held look)',
      'Memory bleed: a present detail triggers a past one without comment',
      'End with the character CHOOSING NOT to say something',
    ],
    auditFocus: 'over-resolution, named emotions, sentimentality, AI-cliché intimate gestures, voice drift toward narrator-poetic',
  },
  // ── NEW: Group Dynamics ─────────────────────────────────────────────
  {
    slot: 8, name: 'Group Dynamics', shortName: 'Group',
    describe: (anchor, chN, band) =>
      `Anchor this scene to ${anchor}. Use Chapter ${chN}'s ensemble cast if available. ` +
      `Write a GROUP DYNAMICS scene with THREE OR MORE characters present — the locked POV character plus at least two others from the Cast Roster. POV character is in ${band} state — their ability to track multiple speakers, alliances, and undercurrents reflects that. The reader should feel three distinct voices, three distinct agendas, and the POV character's reading of who is aligned with whom (which may be wrong).`,
    part1Rules: [
      'THREE OR MORE characters speak/act on stage',
      'Each non-POV character must say at least one thing that BETRAYS their agenda',
      'Use action beats and physical proxemics (who stands by whom) to signal alliance',
      'POV character may MISREAD the alliances — that bias is the point',
      'End mid-discussion before consensus or rupture',
    ],
    part2SelfAudit: [
      'The group collapses to a two-speaker dialogue with the third silent',
      'All characters sounding the same',
      'POV character omnisciently knowing others\' inner agendas',
      'Round-robin dialogue where each character speaks in strict turn',
    ],
    part2Rules: [
      'Cross-talk: two characters speak past each other while a third interrupts',
      'An alliance shifts visibly through proxemics (someone moves, someone steps back)',
      'End with a decision made WITHOUT clear consensus — someone is being overruled',
    ],
    auditFocus: 'collapsing the group to a pair, identical voices, missing proxemic signals, omniscient POV slips',
  },
];

export function generateCalibrationPassSteps(
  pass: number,
  idx: number,
  title: string,
  sharedContext: string,
  isFinalPass: boolean,
  currentDna?: { positive: string[], negative: string[] },
  totalChapters: number = 25
): ProjectStep[] {
  const steps: ProjectStep[] = [];
  const povCheckFormat = `## 1. POV Analysis\n` +
    `- Which character's POV was actually used in this chapter?\n` +
    `- Does it match the POV character specified in the Chapter Outline?\n` +
    `- Is the Deep POV consistent — does every description, internal thought, and observation reflect ONLY what this character would notice/know?\n\n` +
    `## 2. Pacing & Plot Advancement\n` +
    `- Does the chapter spend its word count wisely, or is it padded with filler?\n` +
    `- Does the plot ACTUALLY advance, or is it all internal monologue and world-building?\n` +
    `- Are events happening, or is the character just thinking/walking/observing?\n\n` +
    `## 3. Plot Thread Tracking\n` +
    `- Which plot threads from the Chapter Outline were advanced in this chapter?\n` +
    `- Which B-story or C-story threads were woven in?\n` +
    `- Were any threads that SHOULD have been addressed (in this chapter) completely ignored?\n\n` +
    `## 4. Chapter Hook\n` +
    `- Does the chapter end on a genuine cliffhanger, revelation, or tension point?\n` +
    `- Would a reader feel compelled to turn the page, or does it fizzle?\n\n` +
    `## 5. Prose Quality\n` +
    `- Identify any "Show vs Tell" violations where the text TELLS the reader about emotions instead of SHOWING them through action, dialogue, or sensation.\n` +
    `- List any filter words found (felt, saw, noticed, realized, seemed, wondered, watched, heard, knew, thought, decided). Quote the exact sentence for each.\n\n` +
    `## 6. Trope Execution\n` +
    `- Which genre tropes identified in the Market & Genre Analysis are being actively deployed or subverted in this chapter?\n` +
    `- Are any tropes being executed too literally (cliché) rather than with a fresh twist?\n` +
    `- Are expected reader payoffs from established tropes being set up or delivered?\n\n` +
    `## 7. AI-Ism Check\n` +
    `- Identify any "Rule of Three" (Tricolon) patterns (e.g., "He was X. He was Y. He was Z.").\n` +
    `- Identify repetitive or explicit dialogue attribution (flag if every line has "said/replied" instead of action beats).\n` +
    `- Identify formulaic fragments for effect ("He gasped. A wet sound.").\n` +
    `- Identify cliché similes ("heart hammering like a trapped bird").\n` +
    `- Identify Nominalization (excessive use of -tion, -ment, -ness words instead of active verbs).\n` +
    `- Identify Present Participle overuse (starting multiple sentences with -ing clauses).\n` +
    `- Identify Adjective Stacking (e.g., "the dark, oppressive, shimmering room").\n` +
    `- Identify Structural AI-Isms like numbered lists, bullet points, <AWAITING PROSE> tags, or meta-commentary in the prose (These MUST trigger a REWRITE).\n\n` +
    `HARD SCORING RULES (NON-NEGOTIABLE — these override your subjective judgment):\n` +
    `1. If the prose contains ANY filter-word phrase (case-insensitive substring match): "she thought", "she felt", "she noticed", "she realized", "she wondered", "she remembered", "she saw", "she heard", "she looked", "she stared", "she imagined", "he thought", "he felt", "he noticed", "he realized", "he wondered", "he remembered", "he saw", "he heard", "he looked", "he stared", "he imagined", "they thought", "they felt", "they noticed", "they realized" — **Deep POV Score MUST be ≤ 6 and Verdict MUST be REVISE**. These are NOT "fine as introspection"; they are exactly what the calibration must eliminate.\n` +
    `2. If the POV Character you identified is NOT verbatim from the Cast Roster (POV Character Lock) injected in context — **Deep POV Score MUST be 0 and Verdict MUST be REWRITE**. Do not "imply" a POV character; quote the exact name from the roster.\n` +
    `3. This is a style-calibration project. Calibration scenes have no chapter outline. Output **Outline Match: N/A** — do not invent threads, tropes, or beats from a non-existent outline.\n` +
    `4. The Plot Threads / Tropes sections must contain "N/A (calibration scene)" — calibration scenes do not advance plot threads.\n\n` +
    `OUTPUT FORMAT (you MUST follow this exactly — begin output IMMEDIATELY with the first bullet, end IMMEDIATELY after Verdict, ZERO preamble, ZERO closing pleasantries):\n` +
    `- **POV Character**: [exact name from Cast Roster, or "NOT IN ROSTER: <invented name>"]\n` +
    `- **Outline Match**: N/A\n` +
    `- **Deep POV Score**: [1-10, with Rule 1 applied]\n` +
    `- **Pacing Score**: [1-10] (10 = every scene earns its word count, 1 = nothing happens)\n` +
    `- **Hook Score**: [1-10] (10 = unputdownable cliffhanger, 1 = flat ending)\n` +
    `- **Plot Threads Advanced**: N/A (calibration scene)\n` +
    `- **Plot Threads Stalled**: N/A (calibration scene)\n` +
    `- **Tropes Deployed**: N/A (calibration scene)\n` +
    `- **Trope Warnings**: N/A (calibration scene)\n` +
    `- **Filter Words Found**: [list exact sentences containing filter words, or "None"]\n` +
    `- **Show vs Tell Violations**: [list passages that tell emotions, or "None"]\n` +
    `- **AI-Isms Found**: [list any Rule of Three, repetitive dialogue tags, formulaic fragments, or cliché similes, or "None"]\n` +
    `- **Repetition Audit**: [list any phrase, image, or motif that appears 3+ times in the chapter. Quote the repeated phrase and count. Flag as CRITICAL if 5+. Or "None"]\n` +
    `- **Em Dash Count**: [total count of em dashes (—) in the chapter. Flag as EXCESSIVE if more than 6 per 1000 words]\n` +
    `- **Issues**: [list any POV breaks, head-hopping, or other problems]\n- **Verdict**: PASS / REVISE / REWRITE`;

  // Build prior-pass directive reference for passes 2+
  const priorPassRef = (pass > 1
    ? `\n\n## DIRECTIVES FROM PASS ${pass - 1}\nThe Pass ${pass - 1} Summary step identified specific issues. ` +
      `Your primary goal this pass is to FIX THOSE ISSUES. ` +
      `The summary's improvement directives are available in your context — treat them as mandatory constraints.\n`
    : '') + `\n\n## STRICT PROSE RULES\n- NEVER use ellipses (..., ..) or trailing thoughts. End sentences with hard periods.\n- NEVER use double-dashes (--) or triple-dashes (---). Use proper em-dashes (—) sparingly — maximum 2 per 400 words. These artifacts are lazy and strictly forbidden.\n- NEVER vary sentence rhythm monotonously. Deliberately mix very short sentences (3–6 words) with longer ones (20+ words).\n- OUTPUT ONLY PROSE. Do NOT append any annotations, metadata, notes, or bracket comments like [Narrator voice:], [Technique:], [POV Anchor], [Word count], or any [square bracket] commentary. The output must be raw manuscript prose and nothing else.\n`;
    // Original definition bypassed

  // ── Per-pass POV + Stat lock ─────────────────────────────────────────────────────────────
  // POV character: pass N → entry #N in the Cast Roster (the model handles wraparound by
  // reading the roster length). Stat band: rotates Peak → Stable → Stressed → Critical
  // every 4 passes so a 4+-pass run covers all four registers per character.
  const statBand = STAT_BANDS[(pass - 1) % STAT_BANDS.length];
  const povPosition = pass;

  // ── Chapter-Anchored Scene Rotation ──────────────────────────────────────────────────────
  // Each pass also maps to a specific chapter from the project outline so scenario content
  // varies across passes.
  const chapterNum = ((pass - 1) % totalChapters) + 1;
  const chapterAnchor = `CHAPTER ${chapterNum} OF THE PROJECT OUTLINE`;

  // ── Pass Lock Block — injected into every writing prompt ─────────────────────────────────
  const passLock =
    `\n\n## THIS PASS — LOCKED CHARACTER + STATE\n` +
    `- **POV character**: entry #${povPosition} in the Cast Roster (cycle to #1 after the last entry).\n` +
    `- **Stat band**: ${statBand.name} (${statBand.range}) — ${statBand.shortDesc}.\n` +
    `- Look up the locked POV character's specific stat-threshold definitions in the inherited Character Bible / Stat System Definition to know exactly how they sound in this band.\n` +
    `- DO NOT switch POV characters mid-scene. DO NOT drift out of the stat band's register.`;

  // ── Per-Scene Loop: Part 1 → Part 2 → Compile → POV Check → Negative-Pair Mining ──
  for (const scene of CALIBRATION_SCENE_TYPES) {
    const chapterNumForScene = 100 * pass + scene.slot;
    const sceneSeed = scene.describe(chapterAnchor, chapterNum, statBand.name);

    // Part 1
    steps.push(step(idx++, `Pass ${pass}: ${scene.shortName} Sample — Part 1`, 'writing', 'creative_writing',
      `${sharedContext}${priorPassRef}${passLock}\n\n## SCENE TYPE: ${scene.name.toUpperCase()}\n` +
      `Write the FIRST 400 words of a ${scene.name} scene.\n\n` +
      `## SCENARIO FOR THIS PASS\n${sceneSeed}\n\n` +
      `## REQUIREMENTS\n${scene.part1Rules.map(r => `- ${r}`).join('\n')}\n- Word count target: exactly 400 words\n\n` +
      `Begin your output immediately with the first word of the scene's prose. No headings, no anchor lists, no plan, no commentary.`,
      { chapterNumber: chapterNumForScene, wordCountTarget: 400 }
    ));

    // Part 2
    steps.push(step(idx++, `Pass ${pass}: ${scene.shortName} Sample — Part 2`, 'writing', 'creative_writing',
      `${sharedContext}${priorPassRef}${passLock}\n\n## SCENE TYPE: ${scene.name.toUpperCase()} (Continuation)\n` +
      `Continue the ${scene.shortName} scene from Part 1. The preceding 400 words are in your context.\n` +
      `Scenario reminder: ${sceneSeed}\n\n` +
      `## REQUIREMENTS\n${scene.part2Rules.map(r => `- ${r}`).join('\n')}\n- Continue in the same ${statBand.name} register\n- Word count target: exactly 400 words\n\n` +
      `Begin your output immediately with the next sentence after Part 1's last sentence. No headings, no recap, no audit notes — just the continuation prose.`,
      { chapterNumber: chapterNumForScene, wordCountTarget: 400 }
    ));

    // Compile
    steps.push(step(idx++, `Pass ${pass}: ${scene.shortName} Sample — Compile`, 'writing', 'draft_compile',
      `Mechanical compilation: combine Pass ${pass} ${scene.shortName} Sample Part 1 and Part 2 into a single seamless document. Output only the merged prose — no headers, no commentary.`,
      { chapterNumber: chapterNumForScene, totalSegments: 2 }
    ));

    // POV Check
    steps.push(step(idx++, `Pass ${pass}: ${scene.shortName} Sample — POV Check`, 'analysis', 'pov_check',
      `Perform a rigorous narrative quality analysis of the compiled ${scene.shortName} Sample from Pass ${pass}.\n` +
      `Confirm the POV character is the locked entry #${povPosition} from the Cast Roster, and confirm the prose reflects the ${statBand.name} stat band (${statBand.shortDesc}).\n` +
      `Be merciless on: ${scene.auditFocus}.\n\n` +
      povCheckFormat,
      { chapterNumber: chapterNumForScene }
    ));

    // Negative-Pair Mining (skips itself if verdict was PASS)
    steps.push(step(idx++, `Pass ${pass}: ${scene.shortName} Sample — Negative-Pair Mining`, 'analysis', 'analysis',
      `Mine NEGATIVE TRAINING PAIRS from the ${scene.shortName} Sample of Pass ${pass}.\n\n` +
      `Your context contains: (a) the compiled scene prose, (b) the POV check verdict and findings.\n\n` +
      `## STEP 1 — READ THE VERDICT LINE\n\n` +
      `Find the line in the POV check output that starts with "- **Verdict**:" or "**Verdict**:". ` +
      `Read the single word that follows. It will be exactly one of: PASS, REVISE, or REWRITE.\n\n` +
      `If you cannot find such a line, treat the verdict as REVISE (default to mining — never default to skipping).\n\n` +
      `## STEP 2 — DECIDE\n\n` +
      `**ONLY if the verdict word you read is exactly PASS** (uppercase, three letters, nothing else), ` +
      `output this single line and stop:\n` +
      `\`No negative pairs to mine — verdict was PASS.\`\n\n` +
      `If the verdict was **REVISE** or **REWRITE** — or if you couldn't find a verdict — proceed to STEP 3 ` +
      `and emit the JSON. DO NOT skip. Mining REVISE/REWRITE scenes is the entire purpose of this step; ` +
      `skipping them silently corrupts the training pool.\n\n` +
      `## STEP 3 — MINE PAIRS (REVISE/REWRITE path)\n\n` +
      `Identify the 2-3 worst passages flagged by the POV check ` +
      `(filter words, told emotions, dialogue-tag overuse, AI-isms, stat-band drift, POV slips, etc.). For each, produce a paired example showing ` +
      `the BAD original and a GOOD rewrite that obeys the pen's voice rules AND stays in the ${statBand.name} stat band.\n\n` +
      `OUTPUT FORMAT — output ONLY this JSON, nothing else:\n` +
      `\`\`\`json\n{\n` +
      `  "scene_type": "${scene.shortName}",\n` +
      `  "pass": ${pass},\n` +
      `  "stat_band": "${statBand.name}",\n` +
      `  "pov_position": ${povPosition},\n` +
      `  "verdict_read": "REVISE or REWRITE (the word you found in the POV check)",\n` +
      `  "pairs": [\n` +
      `    {\n` +
      `      "issue": "short label, e.g. 'filter_word', 'told_emotion', 'on_the_nose_dialogue', 'stat_band_drift', 'pov_slip'",\n` +
      `      "bad": "the exact passage from the original scene (5-30 words, VERBATIM)",\n` +
      `      "good": "a rewrite that obeys the pen's voice rules and the ${statBand.name} register (similar length)",\n` +
      `      "why": "1-sentence explanation of what the rewrite does differently"\n` +
      `    }\n` +
      `  ]\n` +
      `}\n\`\`\`\n\n` +
      `CRITICAL RULES:\n` +
      `- The "bad" field MUST be VERBATIM from the original scene prose — do not paraphrase. Downstream auto-mining depends on exact-match.\n` +
      `- 2-3 pairs is enough — quality over quantity. Do NOT pad.\n` +
      `- Only mine passages the POV check explicitly flagged.\n` +
      `- The "good" rewrite MUST stay in the ${statBand.name} stat band — do not silently upgrade the character's state.\n\n` +
      `## JSON ESCAPING — READ CAREFULLY\n` +
      `The "bad" and "good" fields are JSON strings, so any double-quote (") inside them WILL break parsing and lose the pair.\n` +
      `If the original prose contains a dialogue line like \`"I have a chip on my shoulder," Kaelen said\`, you MUST handle the internal quotes one of two ways:\n` +
      `  (a) RECOMMENDED — Replace inner double-quotes with single quotes: \`"bad": "'I have a chip on my shoulder,' Kaelen said"\`\n` +
      `  (b) Escape every inner double-quote with a backslash: \`"bad": "\\"I have a chip on my shoulder,\\" Kaelen said"\`\n` +
      `Do NOT leave bare inner quotes — that's invalid JSON and the pair is discarded.\n` +
      `If the original passage uses curly/smart quotes (" or "), normalise to straight quotes (") before putting them in the JSON.`,
      { chapterNumber: chapterNumForScene }
    ));
  }

  // ── Pass Summary & Directive Generator ──────────────────────────────
  const sceneRefList = CALIBRATION_SCENE_TYPES.map(s => `${s.shortName} (chapter ref ${100 * pass + s.slot})`).join(', ');
  steps.push(step(idx++, `Pass ${pass}: Summary & Improvement Directives`, 'analysis', 'analysis',
    `You have just reviewed EIGHT POV Quality Gate reports and EIGHT Negative-Pair Mining outputs from Pass ${pass} of the Style Calibration run for "${title}".\n\n` +
    `Pass ${pass} ran the locked POV character (Cast Roster entry #${povPosition}) through the **${statBand.name}** stat band (${statBand.range}), across these scene types: ${sceneRefList}.\n\n` +
    `## Your Task\n\n` +
    `1. **Aggregate Scores** — Create a summary table for all 8 scenes:\n` +
    `   | Scene | Deep POV | Pacing | Hook | Stat-Band Fidelity | Verdict |\n` +
    `   |-------|----------|--------|------|--------------------|---------|\n\n` +
    `2. **Cross-Scene Pattern Analysis** — Identify issues that appeared in 3 or more scenes ` +
    `(e.g., "filter word 'felt' appeared in five scenes", "stat-band drift toward Stable in Action and Confrontation"). ` +
    `These are SYSTEMIC habits the LoRA needs to unlearn.\n\n` +
    `3. **Ranked Issue List** — List all issues across all 8 scenes, ranked by severity (most damaging first). Quote at least one example per issue.\n\n` +
    `4. **Negative-Pair Roll-Up** — Across the 8 Negative-Pair Mining outputs, identify the 3-5 issue categories that produced the most pairs. ` +
    `These are the highest-value training targets.\n\n` +
    `5. **POV Character Voice Notes** — Looking ONLY at scenes that scored PASS, characterise the locked POV character's voice in 2-3 sentences ` +
    `(rhythm, vocabulary, sensory bias, register at ${statBand.name} band). This becomes a reference for future passes using the same character.\n\n` +
    `6. **Pass ${pass + 1} Improvement Directives** — Write ${!isFinalPass ? `exactly 5` : `a final set of`} ` +
    `specific, actionable directives for the ${!isFinalPass ? `next pass` : `writing team`}. ` +
    `Format each as a direct instruction:\n` +
    `   - "DO: [positive behaviour to adopt or keep doing if they scored well (9/10)]"\n` +
    `   - "AVOID: [specific pattern identified in the POV checks]"\n\n` +
    `7. **Overall Assessment** — Rate the model's current prose quality on a scale of 1–10 for this pass, ` +
    `with a one-paragraph verdict on readiness for full-length manuscript generation as a pen-author for this voice.\n\n` +
    `8. **DNA Compression & JSON Export** — MANDATORY. This JSON block feeds the automated LoRA training pipeline. ` +
    `You MUST output a raw JSON object at the VERY BOTTOM of your response, even if no new violations were found. ` +
    `Review the existing Global Style Directives (if provided) and merge them with your new findings from Pass ${pass}. ` +
    `Eliminate redundant rules, discard rules the model has completely mastered, keep rules still needed. ` +
    `Output EXACTLY 5 "positive" (DO) and 5 "negative" (AVOID) rules — no more, no fewer. ` +
    `Each rule must be a single, concrete, actionable instruction referencing a specific technique or violation pattern.\n` +
    `Output ONLY the JSON enclosed in \`\`\`json blocks — no prose after it:\n` +
    `\`\`\`json\n{\n  "positive": [\n    "DO: Use concrete physical reactions for internal conflict"\n  ],\n  "negative": [\n    "AVOID: The 'X but Y' binary contrast structure"\n  ]\n}\n\`\`\`\n\n` +
    (currentDna ? `## EXISTING GLOBAL STYLE DNA (To be compressed & merged)\n**Positive Directives:**\n${currentDna.positive.map(d => `- ${d}`).join('\n')}\n**Negative Directives:**\n${currentDna.negative.map(d => `- ${d}`).join('\n')}\n\n` : '') +
    (!isFinalPass
      ? `These directives will be automatically injected into Pass ${pass + 1} writing prompts.`
      : `This is the final pass. Provide a definitive readiness verdict for the pen-author LoRA.`),
    { chapterNumber: 100 * pass + 99 }
  ));

  return steps;
}

const styleCalibration: ProjectTemplate = {
  type: 'style-calibration',
  workType: 'books',
  name: 'Style Calibration (Adversarial Setup)',
  description: 'Adversarial pen-author training grounds. Extracts the POV cast from Book Planning, then runs N passes. Each pass locks to one POV character + one stat band (Peak/Stable/Stressed/Critical) and generates 8 scene types (Action, Dialogue, Introspection, Setting, Confrontation, Discovery, Quiet, Group). Each scene is graded by a POV Quality Gate; failed scenes generate negative training pairs (bad→good). The "Target Chapters" setting determines the number of passes.',
  buildSteps: (ctx, title, description) => {
    const steps: ProjectStep[] = [];
    let idx = 1;
    const passes = ctx.targetChapters || 1;

    // ── Cast Extraction (runs once, before any pass) ──
    // Parses the inherited Character Bible into a JSON roster of Tier 1 POV
    // characters. Subsequent passes use this roster to lock each pass to a
    // single POV character (rotating). Without a parent project, falls back
    // to a generic 4-slot roster so calibration still functions standalone.
    steps.push(step(idx++, 'Cast Extraction', 'analysis', 'analysis',
      `Extract the full character roster for the calibration run of "${title}".\n\n` +
      `Your inherited context contains the Character Bible. Read it and extract THREE tiers of characters: ` +
      `Tier 1 POV narrators, Tier 2 supporting cast, and Tier 3 minor / background figures. ` +
      `The bible lists characters explicitly under these tiers — copy them out, do not re-rank them.\n\n` +
      `Begin your output immediately with the opening { of the JSON object. ` +
      `No preamble, no markdown fences, no closing pleasantries — those break downstream parsing.\n\n` +
      `{\n` +
      `  "povCharacters": [\n` +
      `    {"name": "exact character name", "faction": "their faction (verbatim from the bible)", "voice": "1-2 word voice descriptor (e.g. 'clinical', 'hardboiled', 'lyrical')", "role": "one-line role description"}\n` +
      `  ],\n` +
      `  "supportingCast": [\n` +
      `    {"name": "exact character name", "faction": "their faction (verbatim)", "role": "one-line role description", "relationships": "1-2 key relationships to POV characters (e.g. 'mentor to Silas, antagonist of Kaelen')"}\n` +
      `  ],\n` +
      `  "minorCast": [\n` +
      `    {"name": "exact character name", "faction": "their faction (verbatim)", "role": "1-line note on where/how they appear"}\n` +
      `  ]\n` +
      `}\n\n` +
      `CRITICAL RULES — TIER 1 POV (the narrators):\n` +
      `- List EVERY Tier 1 POV character defined in the Character Bible (typically 5-7). Do NOT pick a subset — dropping a distinctive voice (a fragmented AI, a hardboiled smuggler, a timid archivist) directly costs the calibration model prose-range diversity.\n` +
      `- Floor: 3, ceiling: 7. Below 3, fill from Tier 2 supporting characters who could plausibly narrate. Above 7, keep only the most voice-distinct.\n` +
      `- Use the EXACT names from the Character Bible. Do NOT invent.\n` +
      `- Faction MUST match the Character Bible exactly — do not infer faction from a character's relationships or role. Open the bible entry, read the faction line, copy it.\n\n` +
      `CRITICAL RULES — TIER 2 SUPPORTING (named non-POV characters with arcs or recurring scenes):\n` +
      `- Include every Tier 2 character the bible names. These are the people the POV characters TALK TO, FIGHT, or NEGOTIATE WITH.\n` +
      `- For each, note one or two key relationships using POV character names from Tier 1 above — this lets the writer model wire dialogue and confrontation scenes correctly.\n` +
      `- Typically 4-12 entries depending on the bible.\n\n` +
      `CRITICAL RULES — TIER 3 MINOR (named background figures and faction agents):\n` +
      `- Brief entries — name, faction, and a one-line role note (e.g. "Apexion Reaper unit", "Archive courier", "Third Rail fence").\n` +
      `- Skip true walk-ons (unnamed soldiers, crowds). Only named recurring figures.\n` +
      `- Typically 4-10 entries.\n\n` +
      `If running standalone (no Character Bible), synthesise 4-5 Tier 1 POVs from the project description with genre-fitting names + factions, and leave Tier 2/3 as empty arrays.\n\n` +
      `Order of Tier 1 matters: each calibration pass is locked to one POV entry by position (Pass 1 → povCharacters[0], Pass 2 → povCharacters[1], etc., cycling back to entry #1 after the last). Tier 2 and Tier 3 order does not affect locking — they're reference material for the writer.`));

    // Shared context block — injected into every writing prompt so the model
    // knows exactly which characters, voice targets, and anti-patterns to use.
    const sharedContext = [
      `## NOVEL CONTEXT`,
      `Title: "${title}"`,
      `Note: "${title}" is the project codename — NOT a character. POV characters come ONLY from the Cast Roster injected separately as "Cast Roster (POV Character Lock)". If you cannot see a Cast Roster in your context, STOP and emit a single line: "ERROR: Cast Roster missing from context."`,
      ...(description ? [``, `## PROJECT DESCRIPTION`, description] : []),
      ``,
      `## WORLD & CHARACTER CONTEXT (from Book Bible)`,
      `MANDATORY: You MUST consult the 'Character Bible' and 'Setting Bible' documents in your context. The Setting Bible contains Part 1 (Factions) and Part 2 (World) in a single document.`,
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
      // Universal + pen-specific anti-patterns are merged upstream by the
      // engine before buildSteps runs. ctx.config.calibrationAntiPatterns
      // holds the resolved list; fall back to UNIVERSAL_CALIBRATION_ANTI_PATTERNS
      // for legacy callers that haven't been upgraded yet.
      ...(((ctx.config as any)?.calibrationAntiPatterns as string[] | undefined)
        ?? UNIVERSAL_CALIBRATION_ANTI_PATTERNS
      ).map((rule, i) => `${i + 1}. ${rule}`),
      ``,
      `## STRICT NEGATIVE CONSTRAINTS (MANDATORY)`,
      `1. NEVER use "Negative Telling" — never describe what a character *didn't* do or feel (e.g., "he didn't flinch"). Only describe concrete actions they *did* take.`,
      `2. NO "Analytical Summaries" — DO NOT explain the "meaning" or "purpose" of any action or setting. Only state the raw sensory facts and let the reader infer the stakes.`,
      `3. AVOID "Syntactic Monotony" — DO NOT start consecutive sentences with the same pronoun or noun (e.g., "He", "The"). Vary sentence openings using prepositional phrases, gerunds, or action beats.`
    ].join('\n');

    if (ctx.isInfiniteCalibration) {
      // For infinite loops, only generate Pass 1 upfront.
      // totalChapters defaults to targetChapters (used for the chapter-anchor rotation).
      const totalChapters = ctx.targetChapters || 25;
      const passSteps = generateCalibrationPassSteps(1, idx, title, sharedContext, false, undefined, totalChapters);
      steps.push(...passSteps);
    } else {
      const totalChapters = passes; // finite mode: rotate across the configured pass count
      for (let pass = 1; pass <= passes; pass++) {
        const passSteps = generateCalibrationPassSteps(pass, idx, title, sharedContext, pass === passes, undefined, totalChapters);
        steps.push(...passSteps);
        idx += passSteps.length;
      }
    }

    return steps;
  }
};


const deepRevision: ProjectTemplate = {
  type: 'deep-revision',
  workType: 'books',
  name: 'Deep Revision',
  description: '8-pass specialist editorial pipeline: structure → arcs → theme → per-chapter craft audits → rewrite gate',
  buildSteps: (ctx, title, description) => {
    const chapters = ctx.targetChapters || 25;
    const steps: ProjectStep[] = [];
    let idx = 1;

    // ── Manuscript-Level Passes (run once across the whole book) ──────────

    steps.push(step(idx++, 'Structural Arc Audit', 'analysis', 'analysis',
      `Perform a structural arc audit of the entire manuscript for "${title}".

## Task
Map the manuscript against the 3-Act structure and Save the Cat beat sheet:
- Act 1 (Setup): chapters covering theme stated, catalyst, debate, break into Act 2
- Act 2A (Fun & Games): chapters covering B-story, midpoint promise of the premise
- Act 2B (Bad Guys Close In): chapters covering dark night of the soul, all-is-lost moment
- Act 3 (Finale): chapters covering finale, final image

For each chapter (1-${chapters}), assign:
- Which structural beat it occupies (or "connective tissue" if none)
- Tension level on a 1-10 scale
- Whether the chapter ends on a rising or falling tension beat

Then flag:
- Any act that is structurally bloated (>40% of the book)
- Any act that is compressed (too fast, no breathing room)
- Missing beats (e.g. no clear midpoint, no all-is-lost moment)
- Tension valleys where 3+ consecutive chapters are below 5/10 tension

Output a tension curve table and a structural health verdict.`));

    steps.push(step(idx++, 'Character Arc Tracker', 'analysis', 'analysis',
      `Track every major POV character's arc across the entire manuscript of "${title}".

For each POV character:
1. State their emotional/moral position at the START of Chapter 1
2. State their position at the END of the final chapter
3. Map the key turning points chapter by chapter (where their worldview shifted)
4. Identify any arc stall zones (3+ consecutive chapters with no arc movement)
5. Flag if the arc completes too early (character resolved before the final act)
6. Flag if the arc never resolves (open wound with no closure or intentional sequel setup)

Cross-reference with the Live Stat tracking data — do the stat changes match the claimed arc positions?

Output a per-character arc table and flag all stall/completion issues.`));

    steps.push(step(idx++, 'Thematic Cohesion Report', 'analysis', 'analysis',
      `Identify and audit the thematic cohesion of "${title}".

1. State the 2-3 core themes you can identify from the manuscript
2. For each chapter (1-${chapters}), rate: ACTIVE (theme explored), PASSIVE (theme present), SILENT (theme absent), CONTRADICTED (chapter undercuts the theme)
3. Flag any SILENT or CONTRADICTED chapters
4. Verify the Prologue establishes the thematic question
5. Verify the Epilogue answers or consciously leaves open the thematic question
6. Identify the thematic statement (one sentence) the book is making

Flag any chapters that feel thematically disconnected from the rest of the manuscript.`));

    // ── Per-Chapter Passes ─────────────────────────────────────────────────
    // Each pass is a specialist audit targeting a craft dimension the POV
    // checker does NOT cover. All passes inject the corresponding POV check
    // result as context so findings build on each other rather than repeat.

    const startCh = ctx.includePrologue ? 0 : 1;
    const endCh = ctx.includeEpilogue ? chapters + 1 : chapters;

    for (let ch = startCh; ch <= endCh; ch++) {
      const chName = ch === 0 ? 'Prologue' : ch > chapters ? 'Epilogue' : `Chapter ${ch}`;
      const povRef = `\n\n---\n\n## POV Check Reference\nThe POV Quality Gate has already run on this chapter. Its findings (filter words, show/tell violations, pacing score, hook score, plot threads stalled) are available in your context. Use them to avoid duplicating findings and to identify PATTERNS across multiple checks.`;

      // Pass A — Dialogue & Subtext
      steps.push(step(idx++, `${chName} — Dialogue & Subtext`, 'analysis', 'revision_check',
        `Perform a Dialogue & Subtext audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **On-the-nose dialogue**: Flag any exchange where characters say exactly what they mean with no subtext. Quote the specific lines.
2. **Missed subtext opportunities**: Identify 2-3 scenes where the characters are talking AROUND a real issue but the subtext is underdeveloped.
3. **Dialogue tags**: Count non-said tags (hissed, growled, snapped, exclaimed, etc.). Flag if more than 3 are used.
4. **Distinct voice test**: Pick 3 characters who speak in this chapter. Could you identify their lines without the speaker tag? Flag if their voices are indistinguishable.
5. **Information delivery**: Is any exposition being delivered through unnatural dialogue ("As you know, Bob..." syndrome)? Quote the instances.
6. **Silence and action**: Are there moments where a character's silence or physical action does the emotional work instead of words? Note them as strengths.

Output findings with quoted line examples for each issue. Rate dialogue quality 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass B — Tension Architecture
      steps.push(step(idx++, `${chName} — Tension Architecture`, 'analysis', 'revision_check',
        `Perform a Tension Architecture audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **Tension map**: Break the chapter into 3-5 scenes/sections. Rate the tension 1-10 at the START and END of each section. Draw the tension arc.
2. **Tension valleys**: Are there sections where the reader could safely put the book down (tension ≤4 for more than 500 words)? Flag them.
3. **Cost of conflict**: When the protagonist faces a problem in this chapter, is there a genuine cost to solving it (something lost, a price paid)? Flag any conflict resolved too easily or without consequence.
4. **Hook audit**: Does the chapter's final hook actually CHANGE the story state (new information revealed, threat escalated, relationship shifted)? Or does it end on an emotion without a state change?
5. **False peaks**: Are there moments that feel like they're building to something but deflate without payoff?
6. **Entry/exit discipline**: Does the chapter begin at the last possible moment (in medias res, or immediately at the point of tension)? Does it end at the first moment it can (no cool-down scene after the climax of the chapter)?

Output tension arc table. Flag all valleys and false peaks with chapter position. Rate tension architecture 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass C — Sensory Immersion
      steps.push(step(idx++, `${chName} — Sensory Immersion`, 'analysis', 'revision_check',
        `Perform a Sensory Immersion audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **Sense audit**: Scan the chapter for use of all 5 senses. For each sense, note: STRONG (vivid, specific detail), PRESENT (mentioned but generic), ABSENT (not used at all).
   - Visual, Sound, Smell, Touch/Texture, Taste
2. **Dominant sense bias**: Is the chapter entirely visual/dialogue? Flag if 3+ consecutive pages have no sound, smell, or tactile grounding.
3. **Floating head syndrome**: Is the POV character physically present in the scene — do we feel their body, their physical discomfort, their environment through their skin? Or are they a disembodied perspective watching events?
4. **Specificity test**: Pick 5 descriptive phrases. Are they specific and unique to this world/setting, or could they appear in any generic thriller/sci-fi? Flag generic ones.
5. **Atmosphere anchoring**: Is there at least one establishing sensory beat per scene that grounds the reader in where and when they are?

Output sense audit table. Flag floating-head passages with page/paragraph reference. Rate sensory immersion 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass D — Reader Contract
      steps.push(step(idx++, `${chName} — Reader Contract`, 'analysis', 'revision_check',
        `Perform a Reader Contract audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **Hook delivery**: Does this chapter deliver on the promise made by the PREVIOUS chapter's hook? If the previous chapter ended on a threat/revelation/cliffhanger, does this chapter address it immediately or delay frustratingly?
2. **Unanswered question pile-up**: List every open question raised in this chapter that wasn't answered. Cross-reference with previous chapters — are any of these questions being raised for the 2nd or 3rd time without progress?
3. **Fair mystery test**: Is any information withheld from the READER that the POV character actually knows? This is an unfair mystery — the reader is being cheated. Flag specific instances.
4. **Setup/payoff audit**: Does this chapter plant any seeds (foreshadowing, Chekhov's guns) that will pay off later? Does it pay off anything planted in earlier chapters? Note both.
5. **Reader expectations**: Based on genre conventions established in the Market Analysis, what will the reader expect at this point in the story? Is the chapter meeting, exceeding, or betraying those expectations?

Output findings with chapter references. Flag unfair mystery instances specifically. Rate reader contract integrity 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass E — Prose Rhythm & Voice
      steps.push(step(idx++, `${chName} — Prose Rhythm & Voice`, 'analysis', 'revision_check',
        `Perform a Prose Rhythm & Voice audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **Sentence length variation**: Sample 3 paragraphs. What is the average sentence length? Are sentences monotonously similar in length? Flag if 5+ consecutive sentences are within 2 words of each other.
2. **Purple prose**: Flag any descriptions that are overwritten — where the prose calls attention to itself at the expense of pacing. Quote the worst 2-3 examples.
3. **Crutch phrases**: Identify any words or phrases that appear 3+ times in this chapter that also appeared in previous chapters. These are the author's verbal tics that accumulate into a pattern across the manuscript.
4. **Paragraph rhythm**: Are paragraph breaks being used for emphasis and breath, or are there walls of text that should be broken? Flag paragraphs over 150 words.
5. **Voice consistency**: Is the narrative voice consistent with the POV character's background, education, and emotional state in this chapter? A street-hardened character shouldn't narrate like a poet. A scientist shouldn't miss obvious logical connections. Flag any voice breaks.
6. **Opening line test**: Quote the chapter's first line. Is it a hook? Does it establish voice immediately?
7. **PEN VOICE DRIFT (mandatory)**: Your context contains the VOICE ANCHORS — verbatim excerpts of the target pen's signature prose. Compare this chapter against those anchors on:
   - **Sentence rhythm**: fragment-to-flow variance — does the chapter match the anchors, or run monotone?
   - **Verb texture**: are verbs as physical and varied, or generic?
   - **Concrete density**: are sensory details landing at the anchors' rate?
   - **Signature markers**: em-dash interruptions, scifi vocab, somatic markers used at the pen's frequency?
   Flag chapters that read like generic Deep POV instead of THIS pen's voice. Score voice-anchor match 1-10. If < 7, name the specific gap.

Output findings with quoted examples. Flag crutch phrases with count across the manuscript. Rate prose rhythm 1-10 AND voice-anchor match 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass F — Character Consistency
      steps.push(step(idx++, `${chName} — Character Consistency`, 'analysis', 'revision_check',
        `Perform a Character Consistency micro-audit of ${chName} of "${title}".${povRef}

## Audit Criteria

1. **Decision consistency**: Does every decision the POV character makes in this chapter follow logically from their established personality, background, and motivation? Flag any moment where they act out of character for plot convenience.
2. **Knowledge boundary**: Does the POV character reference or act on information they shouldn't have at this point in the story? Flag any knowledge leaks (information the character learned later, or that they simply shouldn't know).
3. **Physical continuity**: Do character descriptions match previous chapters — clothing, injuries, items carried, physical condition? Flag any contradictions.
4. **Emotional continuity**: Is the character's emotional state at the START of this chapter consistent with where they were at the END of the previous chapter? Flag jarring emotional resets.
5. **Supporting character behaviour**: Do supporting characters in this chapter behave consistently with their established personalities, allegiances, and knowledge? Flag anyone who acts as a plot puppet rather than a person.
6. **Voice in dialogue**: Does each character's spoken dialogue reflect their established speech patterns and vocabulary? A character who spoke formally in Chapter 1 shouldn't suddenly be casual in Chapter 10 without reason.

Output findings with specific examples quoted from the text. Rate character consistency 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass G — Scene Function
      steps.push(step(idx++, `${chName} — Scene Function`, 'analysis', 'revision_check',
        `Perform a Scene Function audit of ${chName} of "${title}".${povRef}

## Scene Function Rule
Every scene must accomplish at least 2 of these 5 jobs simultaneously:
1. Advance the plot (something changes in the story world)
2. Reveal character (we learn something new or deeper about a character)
3. Establish/deepen world (setting, rules, atmosphere work is done)
4. Create/escalate tension (stakes increase)
5. Deliver theme (the central theme is explored or dramatised)

## Audit Criteria

1. **Scene inventory**: Break the chapter into distinct scenes. For each scene, list which of the 5 jobs it accomplishes.
2. **Single-job scenes**: Flag any scene that only accomplishes 1 job. These are candidates for cutting or merging.
3. **Connective tissue scenes**: Flag purely transitional scenes (character travelling, eating, waking up, arriving somewhere) that accomplish no jobs. These are almost always cuttable.
4. **Scene entrances**: For each scene, does it begin at the last possible moment (conflict or tension already in play) or does it include unnecessary setup/approach?
5. **Scene exits**: Does each scene end at the earliest possible moment after its purpose is served, or does it drag with aftermath?
6. **Cut recommendations**: Based on the above, list any scenes that could be cut or merged with a neighbouring scene without losing story value.

Output scene inventory table. List specific cut/merge recommendations. Rate scene economy 1-10.
Verdict: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));

      // Pass H — Rewrite Brief (the action gate)
      steps.push(step(idx++, `${chName} — Revision Brief`, 'analysis', 'revision_check',
        `Synthesise all revision audit findings for ${chName} of "${title}" into a prioritised Rewrite Brief.

You have access in your context to:
- The original chapter text
- The POV Quality Gate findings (filter words, show/tell, pacing, hook scores)
- Passes A through G (dialogue, tension, sensory, reader contract, prose rhythm, character consistency, scene function)

## Your Task

1. **Top 3 Critical Issues**: The 3 findings across ALL passes that would most improve this chapter if fixed. Be specific — quote the problem, describe the fix.
2. **Line-Level Rewrites**: Provide 3-5 specific line-level rewrites for the worst prose offenders.
   CRITICAL RULE: The ORIGINAL text MUST be a 100% VERBATIM string (5-15 words max) copied directly from the source text. Do NOT paraphrase or reconstruct from memory. If it is not exactly verbatim, the automated patcher will fail. Format as:
   - ORIGINAL: [exact verbatim quoted text]
   - REVISED: [your improved version]
   - REASON: [why this is better]
3. **Structural Recommendation**: If the chapter has a scene that should be cut or merged, specify exactly which scene and where its essential content should be relocated.
4. **Final Verdict**:
   - PASS — Minor polish only, no structural work needed. Chapter is fundamentally sound.
   - REVISE — Targeted fixes to specific passages. No scene restructuring required.
   - REWRITE — Structural issues or pervasive craft problems that require a full regeneration with corrective instructions.

OUTPUT FORMAT (you MUST follow this exactly):
**${chName} Revision Brief**
**Critical Issues:**
1. [Issue 1]
2. [Issue 2]
3. [Issue 3]
**Line Rewrites:**
- ORIGINAL: [text] | REVISED: [text] | REASON: [reason]
**Structural Recommendation:** [or "None required"]
Verdict: PASS / REVISE / REWRITE
**Verdict Justification:** [1-2 sentences]`,
        { chapterNumber: ch }));
    }

    // ── Final Revision Summary ─────────────────────────────────────────────

    steps.push(step(idx++, 'Full Revision Summary Report', 'analysis', 'analysis',
      `Compile a complete revision summary report for "${title}" based on all audit passes.

Include:
1. **Manuscript Health Scorecard**: Average scores across all chapters for each pass (Dialogue, Tension, Sensory, Reader Contract, Prose Rhythm, Character Consistency, Scene Function)
2. **Chapter Tier List**: Rank all chapters into 3 tiers: Strong (minimal revision needed), Moderate (targeted revision), Weak (full rewrite recommended)
3. **Cross-Manuscript Patterns**: Identify craft issues that appear in 5+ chapters (systematic problems vs isolated ones)
4. **Crutch Word Master List**: Compile the crutch words/phrases flagged across all Prose Rhythm passes
5. **Priority Action Plan**: Ordered list of the 10 highest-impact changes across the whole manuscript
6. **Estimated Revision Scope**: Given the verdicts, what % of the manuscript needs PASS / REVISE / REWRITE treatment?`));

    return steps;
  },
};


const bookProduction: ProjectTemplate = {
  type: 'book-production',
  workType: 'books',
  name: 'Book Production & Formatting',
  description: 'Final formatting pipeline: polish → metadata → ToC → front/back matter → blurb → spec → export',
  buildSteps: (_ctx, title, description) => {
    const steps: ProjectStep[] = [];
    let idx = 1;

    // Manuscript inheritance is wired in prompt-builder.ts via
    // getManuscriptAuditSlots — Final Prose Polish (taskType='final_edit') now
    // receives every completed creative_writing/draft_compile chapter from the
    // parent project as context. Pen voice anchors + anti-patterns also inject.
    steps.push(step(idx++, 'Final Prose Polish', 'revision', 'final_edit',
      `Perform a final prose polish on the completed manuscript for "${title}".\n\n` +
      `Your context contains every chapter from the parent project plus this pen's voice anchors and anti-patterns.\n\n` +
      `Polish targets:\n` +
      `- Eliminate adverb overuse, passive voice, and crutch phrases\n` +
      `- Tighten dialogue tags (said/asked only where needed)\n` +
      `- Remove accidental repetition of words/phrases within paragraphs\n` +
      `- Smooth scene transitions and chapter hand-offs\n` +
      `- Verify chapter opening hooks and closing beats\n` +
      `- Match the pen's voice anchors on rhythm and density\n` +
      `- Drop anything that matches the pen's anti-pattern list\n\n` +
      `Output the polished manuscript chapter-by-chapter with all corrections applied inline. Preserve chapter numbering and titles.`));

    steps.push(step(idx++, 'Table of Contents', 'writing', 'creative_writing',
      `Generate a Table of Contents for "${title}" using the parent project's chapter list.\n\n` +
      `Format requirements:\n` +
      `- One line per chapter: \`Chapter N — <Title>\` (en-dash, not hyphen)\n` +
      `- Include Prologue and Epilogue if they exist on the parent project\n` +
      `- Use the chapter titles from the parent's Chapter Outline if present, otherwise just \`Chapter N\`\n` +
      `- Output as a Markdown list so the EPUB exporter can map each entry to its anchor\n\n` +
      `Also output a flat JSON array \`[{"label": "...", "chapterNumber": N}]\` after the human-readable list — the exporter consumes this to wire up navigation.`));

    steps.push(step(idx++, 'KDP Metadata', 'writing', 'creative_writing',
      `Produce the Amazon KDP metadata payload for "${title}".\n\n` +
      `Description: ${description}\n\n` +
      `Output as YAML for the publishing route to consume:\n` +
      `\`\`\`yaml\n` +
      `title: <verbatim title>\n` +
      `subtitle: <one-line subtitle if any, else empty>\n` +
      `series_name: <if part of a series, else empty>\n` +
      `series_number: <integer if applicable, else null>\n` +
      `bisac_categories:\n` +
      `  - <primary BISAC code + label, e.g. FIC028000 Fiction / Science Fiction / Hard SF>\n` +
      `  - <secondary>\n` +
      `  - <tertiary>\n` +
      `keywords:\n` +
      `  - <7 high-traffic Amazon search phrases, each 2-5 words>\n` +
      `target_audience: <adult / new adult / YA / etc.>\n` +
      `content_rating: <none / sex / violence / profanity / etc.>\n` +
      `\`\`\``));

    steps.push(step(idx++, 'Front & Back Matter Generation', 'writing', 'creative_writing',
      `Generate all front and back matter for "${title}".\n\n` +
      `Create:\n` +
      `1. **Copyright page** — standard fiction copyright notice, current year\n` +
      `2. **Dedication** — brief, evocative (1-3 lines)\n` +
      `3. **Epigraph** — if appropriate for the genre, a relevant quote\n` +
      `4. **Author bio** — 150-word third-person bio suitable for Amazon and back cover\n` +
      `5. **"Also By" list** — placeholder for series/other titles\n` +
      `6. **Newsletter CTA** — reader-facing call to action for email list\n` +
      `7. **Acknowledgements** — template the author can fill in\n\n` +
      `Format each section with clear markdown headers so the exporter can lift them cleanly.`));

    steps.push(step(idx++, 'KDP Blurb Generation', 'writing', 'creative_writing',
      `Write a compelling Amazon KDP book description (blurb) for "${title}".\n\n` +
      `Description: ${description}\n\n` +
      `Requirements:\n` +
      `- Hook line (bold, 1-2 sentences that stop the scroll)\n` +
      `- Setup paragraph (establish world, protagonist, stakes)\n` +
      `- Escalation paragraph (complications, impossible choice)\n` +
      `- Tagline/closer (one punchy final line)\n` +
      `- Total length: 1800-2200 characters (KDP sweet spot)\n` +
      `- Use ONLY KDP-allowed HTML: <b>, <i>, <p>, <br>, <ul>, <li>\n` +
      `- Include 3 variants: emotional hook version, mystery/question version, action version\n\n` +
      `Also generate a 400-character "About the book" preview for Amazon search.`));

    steps.push(step(idx++, 'Interior Formatting Spec', 'writing', 'creative_writing',
      `Generate a complete interior formatting specification for "${title}".\n\n` +
      `Include:\n` +
      `- Trim size recommendation for the genre (5×8, 5.5×8.5, or 6×9)\n` +
      `- Font family and size (body, chapter headers, scene breaks)\n` +
      `- Margin specifications (KDP-compliant for page count)\n` +
      `- Chapter opening style (drop cap, extra spacing, ornament)\n` +
      `- Scene break marker style (* * * or ornamental)\n` +
      `- Headers/footers (running headers with title/author)\n` +
      `- First-line indent vs block paragraphs\n\n` +
      `Output as a structured specification the DOCX/EPUB exporter can consume.`));

    // Final step — produces the manifest the dashboard-api export route reads
    // to assemble DOCX/EPUB. Mirrors the pattern in Revision Execution's
    // Compile Revised Manuscript so the existing export endpoint handles both.
    steps.push(step(idx++, 'Compile Production Manifest', 'export', 'export',
      `Compile every artefact produced by this Book Production project for "${title}" into the export manifest.\n\n` +
      `List in order:\n` +
      `1. Polished manuscript (from Final Prose Polish)\n` +
      `2. Table of Contents (from Table of Contents step)\n` +
      `3. KDP Metadata (from KDP Metadata step)\n` +
      `4. Front & Back Matter (from Front & Back Matter Generation)\n` +
      `5. KDP Blurb (all three variants from KDP Blurb Generation)\n` +
      `6. Interior Formatting Spec (from Interior Formatting Spec)\n\n` +
      `Output ONLY a Markdown header for each section pointing at the source step's label so the export route can assemble the deliverable. Do NOT regenerate any content here — just the manifest.\n\n` +
      `Format:\n` +
      `## Polished Manuscript — from "Final Prose Polish"\n` +
      `## Table of Contents — from "Table of Contents"\n` +
      `[…]`));

    return steps;
  },
};

const amazonKdpLaunch: ProjectTemplate = {
  type: 'amazon-kdp-launch',
  workType: 'books',
  name: 'Amazon KDP Launch',
  description: 'Full KDP launch: live keyword + comp + category scouts → metadata → 90-day plan',
  buildSteps: (_ctx, title, description) => {
    const steps: ProjectStep[] = [];
    let idx = 1;

    // ── KDP Concept Keywords (preflight): produces routing JSON used by all
    // downstream live-data scouts. Mirrors book-planning's preflight but adds
    // `redditAuthorSubs` — the KDP/selfpublish/eroticauthors sub mix — so the
    // strategy steps can pull author-community wisdom on keywords, categories,
    // and pricing. Reader subs (redditSubs) still feed comp-title and trend
    // signal. All path-safe vars resolved by step-runner at run time.
    //
    // The librarian (gemma3:12b) is honest about Amazon-specific data here:
    // BSR, ASINs, Also-Bought lists are NOT fetchable server-side. We use
    // OpenLibrary as canonical comp source (ratings_count as popularity proxy)
    // and Reddit author subs as keyword/category strategy source.
    steps.push(step(idx++, 'KDP Concept Keywords', 'research', 'research',
      `Read the book description below CAREFULLY. You are deriving search routing for live KDP-launch scouts. Every output field must reflect the description's actual genre and the KDP launch goal — NOT examples in this prompt, NOT defaults.\n\n` +
      `===== BOOK DESCRIPTION =====\n` +
      `Title: "${title}"\n\n` +
      `Description: ${description}\n` +
      `===== END BOOK DESCRIPTION =====\n\n` +
      `Output ONLY a single JSON object — no prose, no markdown fences. ALL SIX FIELDS ARE MANDATORY:\n\n` +
      `{\n` +
      `  "subjectSlug": "OpenLibrary subject slug for this book's subgenre. Lowercase + underscores. Examples (pick closest or similar): cyberpunk, epic_fantasy, military_fiction, war_stories, memoir, biography, historical_fiction, romance, cozy_mystery, thriller, horror, literary_fiction, young_adult, science_fiction.",\n` +
      `  "subjectSlugFallback": "BROADER PARENT subject slug for fallback. Examples: science_fiction, fiction, non-fiction, fantasy.",\n` +
      `  "redditSubs": "3-5 READER-side book-discussion subreddits, joined with + (no spaces, no r/ prefix). MUST start with 'books'. Examples: 'books+printSF+Fantasy+suggestmeabook' for sf/fantasy; 'books+RomanceBooks+suggestmeabook' for romance; 'books+MilitaryFiction+history' for war stories.",\n` +
      `  "redditAuthorSubs": "3-5 AUTHOR/PUBLISHING subreddits where indie authors discuss keywords, categories, pricing, AMS. MUST start with 'selfpublish'. Examples: 'selfpublish+KDP+writing' (general); 'selfpublish+eroticauthors+KDP' (romance/erotica); 'selfpublish+writing+writerchat' (literary). Subs MUST actually exist.",\n` +
      `  "primaryQuery": "5-7 word reader-search phrase real readers would type when looking for books like this one. Use SUBGENRE name + 1-2 specific concept words from the description.",\n` +
      `  "altQueries": [\n` +
      `    "3-5 word alt phrasing #1 — different angle on same subgenre",\n` +
      `    "3-5 word alt phrasing #2 — emphasizes a different concept",\n` +
      `    "3-5 word alt phrasing #3 — broader parent-genre fallback"\n` +
      `  ]\n` +
      `}\n\n` +
      `Self-check: does subjectSlug match the description's actual genre? Does redditSubs start with 'books'? Does redditAuthorSubs start with 'selfpublish'? Are all six fields present? Fix any 'no' before responding.\n\n` +
      `CRITICAL: Output valid JSON only. No comments inside. No text outside the braces. No markdown fences.`));

    // ── Live-data scouts ──
    // Each KDP strategy step now consumes a real fetched payload from the
    // network (OpenLibrary canonical books, Reddit author + reader subs)
    // alongside its existing strategic prompt. The librarian uses these as
    // ground truth and is told explicitly what's NOT available (BSR/ASIN)
    // so it doesn't hallucinate Amazon-specific numbers.

    // ── SCO: Search Content Optimization (live keyword research) ──
    steps.push(step(idx++, 'SCO — Keyword Research', 'research', 'network_research',
      `Generate Amazon KDP keyword research for "${title}" using the live sources below as ground truth.\n\n` +
      `Available sources:\n` +
      `- Source 1: OpenLibrary search probe for primaryQuery — numFound + top docs\n` +
      `- Source 2: OpenLibrary search probe for altQuery1 — numFound + top docs\n` +
      `- Source 3: OpenLibrary search probe for altQuery2 — numFound + top docs\n` +
      `- Source 4: Reddit /r/{{redditAuthorSubs}}/top.json?t=year — KDP author keyword + category strategy threads\n` +
      `- Source 5: Reddit /r/{{redditSubs}}/top.json?t=year — reader-side genre discussions\n` +
      `- Source 6: AMAZON SEARCH (live, via stealth-headless browser) for primaryQuery — top page-1 ASINs with title/author/price/rating from amazon.com\n` +
      `- Source 7: AMAZON SEARCH for altQuery1\n` +
      `- Source 8: AMAZON SEARCH for altQuery2\n\n` +
      `Sources 6-8 are the REAL Amazon results a reader would see for each query — use them as the gold standard for "does this keyword surface relevant books on Amazon?" The Amazon digest is pre-extracted into a numbered list of \`[ASIN] "title" — author | format | price | ★rating (reviews)\`. If a candidate keyword's Amazon page is missing or empty (anti-bot fallback), say so explicitly and rely on OpenLibrary signal.\n\n` +
      `Deliver:\n` +
      `1. **7 KDP backend keywords** (the actual slot fills). Each 2-4 words, derived from candidates that surface relevant on-genre results on the Amazon pages (Sources 6-8) AND show numFound ≥ 10 in OL OR appear repeatedly in Source 4-5 threads. Avoid single generic words. Format as a numbered list with one-line justification each + the source citations.\n\n` +
      `2. **20 long-tail keyword phrases** for AMS Sponsored Products manual targeting. Pull from: Amazon title fragments in Sources 6-8, OL probe doc titles, phrases authors recommend in Source 4, phrases readers use in Source 5. Each cited to its source.\n\n` +
      `3. **Title/Subtitle optimization**: current title is "${title}". Suggest one subtitle that incorporates the strongest keyword you found above. Keep total ≤80 chars.\n\n` +
      `4. **Backend keyword strategy** (max 250 chars total across all 7 slots): which keywords go in title/subtitle vs backend, anti-stuffing notes.\n\n` +
      `5. **Top comp ASINs from Amazon search** — bulleted list of ASINs from Sources 6-8 that the AUTHOR should manually verify on amazon.com (for AMS ASIN-targeting and Also-Bought cross-reference). 10-15 entries.\n\n` +
      `Cite every keyword recommendation to its source — [1], [2], [3] for OL probes, [4] for author subs, [5] for reader subs, [6], [7], [8] for Amazon pages. If a recommendation isn't traceable to a source, drop it.`,
      {
        networkRequests: [
          { url: `https://openlibrary.org/search.json?q={{primaryQuery}}&limit=10&fields=title,author_name,first_publish_year,subject,ratings_count`, label: 'OL probe: "{{primaryQuery}}"', networkPath: 'direct', maxChars: 25_000, rawBody: true },
          { url: `https://openlibrary.org/search.json?q={{altQuery1}}&limit=10&fields=title,author_name,first_publish_year,subject,ratings_count`, label: 'OL probe: "{{altQuery1}}"', networkPath: 'direct', maxChars: 25_000, rawBody: true },
          { url: `https://openlibrary.org/search.json?q={{altQuery2}}&limit=10&fields=title,author_name,first_publish_year,subject,ratings_count`, label: 'OL probe: "{{altQuery2}}"', networkPath: 'direct', maxChars: 25_000, rawBody: true },
          { url: `https://www.reddit.com/r/{{redditAuthorSubs}}/top.json?t=year&limit=20`, label: 'Reddit author subs /r/{{redditAuthorSubs}}/top.json?t=year', networkPath: 'direct', maxChars: 35_000, rawBody: true },
          { url: `https://www.reddit.com/r/{{redditSubs}}/top.json?t=year&limit=15`, label: 'Reddit reader subs /r/{{redditSubs}}/top.json?t=year', networkPath: 'direct', maxChars: 30_000, rawBody: true },
          { url: `https://www.amazon.com/s?k={{primaryQuery}}&i=stripbooks`, label: 'Amazon search: "{{primaryQuery}}"', networkPath: 'browser', maxChars: 18_000, rawBody: false },
          { url: `https://www.amazon.com/s?k={{altQuery1}}&i=stripbooks`,    label: 'Amazon search: "{{altQuery1}}"',    networkPath: 'browser', maxChars: 18_000, rawBody: false },
          { url: `https://www.amazon.com/s?k={{altQuery2}}&i=stripbooks`,    label: 'Amazon search: "{{altQuery2}}"',    networkPath: 'browser', maxChars: 18_000, rawBody: false },
        ],
      }));

    // (Comp Title Analysis lives in the PARENT book-planning project — it
    // produces a richer table there with ASIN cross-references. KDP Launch
    // inherits that output via the prompt-builder's `research`-phase
    // inheritance, so we don't re-fetch the same OL/Reddit/Amazon-search
    // sources at upload time. If you want to refresh the comp picture
    // months after planning, re-run that step on the parent project — KDP
    // Launch will then see the updated data on its next run.)

    // ── GCO: Genre Category Optimization (live category strategy) ──
    steps.push(step(idx++, 'GCO — Category Strategy', 'research', 'network_research',
      `Recommend Amazon KDP categories for "${title}" using the live sources below.\n\n` +
      `Available sources:\n` +
      `- Source 1: OpenLibrary /subjects/{{subjectSlug}}.json — every "subject" tag on canonical books in this subgenre. Maps roughly to BISAC categories Amazon also uses.\n` +
      `- Source 2: OpenLibrary /subjects/{{subjectSlugFallback}}.json — broader parent subjects for ladder targeting.\n` +
      `- Source 3: Reddit /r/{{redditAuthorSubs}}/top.json?t=year — KDP authors discussing category strategy, niche-finding, request-via-Author-Central tactics.\n\n` +
      `What is NOT available: live BSR per category, daily-sales-to-rank estimates. Do NOT fabricate those numbers. The librarian's own training knowledge of Amazon's category tree IS available — use it for the formal path strings.\n\n` +
      `Deliver:\n` +
      `1. **Primary 2 KDP categories** (selectable at upload). Format: full Amazon path (e.g., "Kindle Store > Kindle eBooks > Science Fiction & Fantasy > Science Fiction > Cyberpunk"). Choose categories backed by recurring subject tags in Source 1+2. One sentence per category citing the supporting tags.\n\n` +
      `2. **Up to 10 extended-category requests** (via Author Central). Same format. Each cited to the subject tag(s) in Source 1+2 that justify it, sorted by perceived niche-opportunity (smaller niches first — based on Source 3 author wisdom about "easy #1 categories").\n\n` +
      `3. **BISAC fallbacks** (3-5 codes/labels matching the recommended categories — drawn from your training knowledge, not the sources). These are for the BISAC dropdown on KDP, not Amazon browse.\n\n` +
      `4. **Hot-New-Release strategy** (one paragraph): which categories give the longest "Hot New Release" visibility based on Source 3 author discussion patterns. Cite the threads that informed this.\n\n` +
      `5. **Manual verification required**: list the categories the author should personally cross-check on Amazon's category tree (since we couldn't fetch it server-side).`,
      {
        networkRequests: [
          { url: `https://openlibrary.org/subjects/{{subjectSlug}}.json?limit=20`,           label: 'OL /subjects/{{subjectSlug}}.json',         networkPath: 'direct', maxChars: 35_000, rawBody: true },
          { url: `https://openlibrary.org/subjects/{{subjectSlugFallback}}.json?limit=15`,   label: 'OL /subjects/{{subjectSlugFallback}}.json', networkPath: 'direct', maxChars: 25_000, rawBody: true },
          { url: `https://www.reddit.com/r/{{redditAuthorSubs}}/top.json?t=year&limit=25`,   label: 'Reddit author subs top.json?t=year',        networkPath: 'direct', maxChars: 40_000, rawBody: true },
        ],
      }));

    // (Comp-Cluster Network, Amazon Product Deep Dive, and Cover Trends
    // Scout live in the PARENT book-planning project. Their outputs flow
    // here via `research`-phase inheritance — the KDP synthesis steps
    // reference them as `[Inherited] <step label>` slots in their prompts.
    // This avoids duplicate ~5-min Amazon scrapes at upload time.)

    // ── Metadata & Blurb ──
    steps.push(step(idx++, 'KDP Metadata Package', 'writing', 'creative_writing',
      `Generate the complete KDP metadata package for "${title}". Consume the upstream research as ground truth. The inputs come from TWO places:\n` +
      `\n` +
      `**This project (KDP Launch — refreshed at upload time):**\n` +
      `- SCO Keyword Research — 7 backend keywords + long-tails (THIS template, refreshed against current Amazon)\n` +
      `- GCO Category Strategy — primary + extended categories\n` +
      `\n` +
      `**Parent project (Book Planning — done months ago):**\n` +
      `- [Inherited] Amazon Product Deep Dive — blurb hook patterns + recurring blurb keywords + pricing reality + BSR ladder\n` +
      `- [Inherited] Cover Trends Scout — cover URLs + visual direction (informs A+ content, not metadata directly, but pricing tier signal can cross-check)\n` +
      `- [Inherited] Live Comp Title Scout — comp titles with ratings\n` +
      `- [Inherited] Market & Genre Analysis — synthesized comp + audience + working keyword set\n` +
      `\n` +
      `Produce:\n\n` +
      `1. **Book title + subtitle** (use SCO Keyword Research's recommendation; ≤80 chars total)\n` +
      `2. **Series info** (if applicable)\n` +
      `3. **Book description** (KDP HTML blurb, 1800-2200 chars, using only allowed tags). MUST follow at least 2 of the hook patterns identified by [Inherited] Amazon Product Deep Dive and incorporate at least 4 of the recurring blurb keywords from its frequency analysis.\n` +
      `4. **7 KDP backend keywords** (verbatim from SCO Keyword Research — no creative substitution)\n` +
      `5. **2 primary categories** (verbatim from GCO Category Strategy)\n` +
      `6. **Pricing strategy**: launch price, steady-state price, promo price — anchored to [Inherited] Amazon Product Deep Dive's pricing reality (median + range), NOT a default $2.99 guess\n` +
      `7. **Age/grade range** (if applicable, derived from comp profile in [Inherited] Live Comp Title Scout)\n` +
      `8. **KDP Select enrollment recommendation** (yes/no with reasoning grounded in the niche signal)\n\n` +
      `Format as a ready-to-paste KDP upload checklist. Cite each decision — use \`[SCO Keyword]\`, \`[GCO Category]\`, \`[Inherited Product Deep Dive]\`, etc.`));

    steps.push(step(idx++, 'A+ Content / Brand Story', 'writing', 'marketing',
      `Create Amazon A+ Content (Enhanced Brand Content) for "${title}".\n\n` +
      `Design 5 A+ content modules:\n` +
      `1. **Hero image banner** — concept description and headline text\n` +
      `2. **Author spotlight** — bio with pull quote\n` +
      `3. **Book features** — 3 key selling points with icons\n` +
      `4. **Series timeline** — if part of a series, visual progression\n` +
      `5. **Comparison table** — "If you liked X, you'll love Y"\n\n` +
      `For each module, provide the exact text content and image descriptions ` +
      `that can be generated via ComfyUI or sourced from stock.`));

    // ── 90-Day Launch Plan ──
    steps.push(step(idx++, '90-Day Launch Plan', 'outline', 'outline',
      `Create a detailed 90-day launch plan for "${title}" on Amazon KDP.\n\n` +
      `Timeline structure:\n\n` +
      `**Pre-Launch (Day -60 to -1):**\n` +
      `- ARC team assembly and distribution schedule\n` +
      `- Pre-order setup timing and pricing\n` +
      `- Social media content calendar\n` +
      `- Email list warm-up sequence\n` +
      `- BookBub/newsletter promo submissions\n\n` +
      `**Launch Week (Day 0-7):**\n` +
      `- Hour-by-hour launch day checklist\n` +
      `- AMS Sponsored Products campaign setup (keywords from SCO)\n` +
      `- Price pulse strategy (launch price → steady state)\n` +
      `- Review solicitation sequence\n` +
      `- Social proof amplification\n\n` +
      `**Post-Launch (Day 8-90):**\n` +
      `- AMS campaign optimization schedule (7/14/30/60 day reviews)\n` +
      `- Category ranking maintenance tactics\n` +
      `- BookBub Featured Deal application (when eligible)\n` +
      `- Cross-promotion with comp authors\n` +
      `- Read-through optimization for series\n\n` +
      `Include specific AMS bid recommendations and daily budget caps.`));

    steps.push(step(idx++, 'AMS Campaign Blueprints', 'writing', 'marketing',
      `Generate 3 ready-to-launch AMS (Amazon Marketing Services) campaign blueprints for "${title}". Use upstream data verbatim — keywords from SCO Keyword Research, ASINs from [Inherited] Amazon Product Deep Dive's Also-Bought payload.\n\n` +
      `**Campaign 1 — Sponsored Products (Automatic):**\n` +
      `- Targeting type: auto (close + loose match + substitutes + complements)\n` +
      `- Daily budget recommendation (suggest $5-15 based on the niche's competitiveness inferred from review counts in [Inherited] Product Deep Dive)\n` +
      `- Default bid (anchor to category-average from [Inherited] Product Deep Dive's data; flag as conservative starter)\n` +
      `- Negative keyword list — terms surfaced in SCO Keyword Research that are clearly cross-category (e.g., RPG/manga if your book is prose) that you want to BLOCK from auto-targeting\n\n` +
      `**Campaign 2 — Sponsored Products (Manual Keywords):**\n` +
      `- All 7 backend + 20 long-tail keywords from SCO Keyword Research as broad + phrase + exact match (so up to 81 targets)\n` +
      `- Bid amounts per keyword tier (broad lowest, exact highest; recommend a starter ladder like $0.20 / $0.35 / $0.55)\n` +
      `- Daily budget\n` +
      `- Negative keywords (same as Campaign 1)\n\n` +
      `**Campaign 3 — Sponsored Products (ASIN Targeting):**\n` +
      `- ALL ASINs from step 6's "AMS ASIN-targeting payload" (paste as comma-separated)\n` +
      `- Bid amounts per ASIN tier (top-5 most-frequent ASINs from step 6 get higher bids than singles)\n` +
      `- Category targeting additions (the categories from step 4)\n` +
      `- Daily budget\n\n` +
      `Include a 30-day optimization checklist: which metrics to watch (ACOS, impressions, CTR), when to kill underperformers (>40% ACOS at day 14), when to scale winners (>25% ROI at day 7). Cite every recommendation to its source step.`));

    return steps;
  },
};

const shortStory: ProjectTemplate = {
  type: 'short-story',
  workType: 'books',
  name: 'Short Story',
  description: 'Single short story: concept → outline → write → polish',
  buildSteps: (ctx, title, description) => [
    step(1, 'Concept Development', 'premise', 'outline',
      `Develop a compelling concept for the short story "${title}".\n\n` +
      `Description: ${description}\n\n` +
      `Include: core premise, protagonist, central conflict, thematic statement, ` +
      `intended emotional impact, and estimated word count (target: ${ctx.estimatedTotalWords || 5000} words).`),
    step(2, 'Story Outline', 'outline', 'outline',
      `Create a beat-by-beat outline for "${title}".\n\n` +
      `Structure: opening hook → rising action (3-4 beats) → climax → ` +
      `denouement → final image/line.\n` +
      `Target: ${ctx.estimatedTotalWords || 5000} words total.`),
    step(3, 'Write Story', 'writing', 'creative_writing',
      `Write the complete short story "${title}" based on the outline.\n\n` +
      `Write the ENTIRE story in full prose. Target: ${ctx.estimatedTotalWords || 5000} words.\n` +
      `Focus on: strong opening hook, tight pacing, vivid sensory detail, ` +
      `and a satisfying ending that resonates.`,
      { wordCountTarget: ctx.estimatedTotalWords || 5000 }),
    step(4, 'Prose Polish', 'revision', 'final_edit',
      `Polish the complete draft of "${title}".\n\n` +
      `Focus on: eliminating weak verbs, tightening dialogue, ` +
      `strengthening the opening and closing lines, and ensuring ` +
      `every scene earns its word count.`),
  ],
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Revision Execution Template
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const revisionExecution: ProjectTemplate = {
  type: 'revision-execution',
  workType: 'books',
  name: 'Revision Execution',
  description: 'Acts on Deep Revision findings: reads Pass H briefs from a parent Deep Revision project and rewrites/patches/polishes each chapter according to its verdict',
  buildSteps: (ctx, title, description) => {
    const chapters = ctx.targetChapters || 25;
    const wordsPerChapter = ctx.targetWordsPerChapter || 3500;
    const steps: ProjectStep[] = [];
    let idx = 1;

    // ── Step 1: Synthesise all Deep Revision findings into an action plan ──
    steps.push(step(idx++, 'Revision Action Plan', 'analysis', 'analysis',
      `You are the Revision Director for "${title}".\n\n` +
      `Your context contains the completed Deep Revision findings from the parent project:\n` +
      `- The Full Revision Summary Report (scorecard, tier list, crutch words, priority actions)\n` +
      `- The Revision Brief (Pass H) for every chapter\n\n` +
      `## Your Task\n\n` +
      `Synthesize all findings into a concrete, prioritised Revision Action Plan.\n\n` +
      `For EACH chapter (${ctx.includePrologue ? 'Prologue, ' : ''}1–${chapters}${ctx.includeEpilogue ? ', Epilogue' : ''}), output:\n` +
      `- **Verdict**: REWRITE / REVISE / PASS (taken directly from Pass H)\n` +
      `- **Priority**: HIGH / MEDIUM / LOW (based on overall manuscript impact)\n` +
      `- **Top Issue**: The single most important thing to fix (1 sentence)\n` +
      `- **Action**: What exactly will be done\n\n` +
      `Then output:\n` +
      `- **Execution Order**: Which chapters to tackle first (highest impact, not chapter order)\n` +
      `- **Manuscript-Wide Fixes**: Issues spanning multiple chapters (crutch words, voice breaks, dialogue tics)\n` +
      `- **Risk Flags**: Chapters where a rewrite might destabilise continuity with adjacent chapters\n\n` +
      `Format the chapter table as:\n` +
      `| Chapter | Verdict | Priority | Top Issue | Action |\n` +
      `|---------|---------|----------|-----------|--------|`));

    // ── Per-chapter execution steps ────────────────────────────────────────
    const startCh = ctx.includePrologue ? 0 : 1;
    const endCh = ctx.includeEpilogue ? chapters + 1 : chapters;

    for (let ch = startCh; ch <= endCh; ch++) {
      const chName = ch === 0 ? 'Prologue' : ch > chapters ? 'Epilogue' : `Chapter ${ch}`;

      const actualWords = ctx.chapterWordCounts?.[ch] || wordsPerChapter;
      // Target around 1000-1200 words per segment to prevent LLM truncation,
      // but don't segment very short chapters.
      const segments = Math.max(1, Math.ceil(actualWords / 1200));
      const wordsPerSegment = Math.floor(actualWords / segments);

      for (let s = 1; s <= segments; s++) {
        const segName = segments > 1 ? `${chName} — Revise Part ${s}` : `${chName} — Execute Revision`;
        
        steps.push(step(idx++, segName, 'revision', 'revision_execution',
          `Execute the revision verdict for ${chName} (Part ${s} of ${segments}) of "${title}".\n\n` +
          `Your context contains:\n` +
          `- The Revision Action Plan (which verdict applies to this chapter)\n` +
          `- The specific Segment ${s} of the original ${chName} prose (from parent project)\n` +
          `- The Pass H Revision Brief for ${chName} (critical issues, line rewrites, structural recommendation)\n` +
          `- All specialist audit findings A–G\n` +
          `- The POV check findings for ${chName}\n\n` +
          `## Execution Rules\n\n` +
          `FIRST, check the Revision Action Plan to find the Verdict (REWRITE, REVISE, or PASS) for ${chName}. YOU MUST ONLY EXECUTE THE RULES FOR THAT SPECIFIC VERDICT.\n\n` +
          `If the Verdict is REWRITE:\n` +
          `Write a complete fresh version of this segment from scratch. Target word count: ${wordsPerSegment} words minimum. Address ALL critical issues listed in the Revision Brief applicable to this segment. Maintain continuity with preceding parts.\n\n` +
          `If the Verdict is REVISE:\n` +
          `Apply targeted fixes only. Apply the ORIGINAL → REVISED line rewrites from the Revision Brief, and fix the specific passages flagged in the audits. Output the FULL revised segment text with all patches applied inline.\n\n` +
          `If the Verdict is PASS:\n` +
          `Output the ORIGINAL Part ${s} segment text VERBATIM. Zero changes. Do not add, remove, paraphrase, or "improve" anything. Copy the text as-is so the compile step has all segments. This is a fast path — do not call any rewrite logic.\n\n` +
          `CRITICAL INSTRUCTION: You are ONLY revising Part ${s} of ${segments}. Do not attempt to summarize the rest of the chapter. Just revise the segment provided to you.`,
          { wordCountTarget: wordsPerSegment, chapterNumber: ch, segmentIndex: s, totalSegments: segments }));
      }

      if (segments > 1) {
        steps.push(step(idx++, `${chName} — Compile Revisions`, 'revision', 'revision_compile',
          `Mechanical compilation of all revised segments for ${chName}.`,
          { chapterNumber: ch, totalSegments: segments }));
      }

      // Post-revision POV check — verify no new issues were introduced
      steps.push(step(idx++, `${chName} — Post-Revision Check`, 'analysis', 'pov_check',
        `Verify the revised ${chName} of "${title}" meets quality standards.\n\n` +
        `This is a POST-REVISION check. The chapter has just been rewritten or patched.\n` +
        `Evaluate only what is in front of you now — do NOT compare to the original.\n\n` +
        `OUTPUT FORMAT (follow exactly):\n` +
        `- **POV Character**: [name]\n` +
        `- **Deep POV Score**: [1-10]\n` +
        `- **Pacing Score**: [1-10]\n` +
        `- **Hook Score**: [1-10]\n` +
        `- **Revision Success**: YES / NO / PARTIAL\n` +
        `- **New Issues Introduced**: [list any NEW problems the revision created, or "None"]\n` +
        `- **Filter Words Found**: [list exact sentences, or "None"]\n` +
        `- **Show vs Tell Violations**: [list passages, or "None"]\n` +
        `- **AI-Isms Found**: [list any Rule of Three, explicit dialogue tags, nominalization, adjective stacking, or participles, or "None"]\n- **Verdict**: PASS / REVISE / REWRITE`,
        { chapterNumber: ch }));
    }

    // ── Global manuscript-wide fixes ──────────────────────────────────────
    steps.push(step(idx++, 'Global Manuscript Polish', 'revision', 'manuscript_cleanup',
      `Apply global manuscript-wide fixes for "${title}" identified in the Revision Action Plan.\n\n` +
      `Your context contains:\n` +
      `- The Revision Action Plan (the "Manuscript-Wide Fixes" section)\n` +
      `- The Full Revision Summary's Crutch Word Master List\n\n` +
      `Generate a JSON array of find-and-replace operations to eliminate:\n` +
      `1. Every crutch word/phrase from the master list\n` +
      `2. Repetitive sentence openers identified across multiple chapters\n` +
      `3. Dialogue tics that appear too frequently\n\n` +
      `Output ONLY valid JSON — no markdown wrapping:\n` +
      `[{"old": "exact text to find", "new": "improved replacement"}]`));

    // ── Post-revision continuity check ────────────────────────────────────
    steps.push(step(idx++, 'Post-Revision Continuity Check', 'analysis', 'continuity_check',
      `Perform a continuity check across all revised chapters of "${title}".\n\n` +
      `Focus on NEW contradictions introduced by the revision rewrites — especially chapters\n` +
      `flagged as Risk Chapters in the Revision Action Plan.\n\n` +
      `Check for:\n` +
      `- New contradictions introduced by rewrites\n` +
      `- Timeline integrity across revised chapters\n` +
      `- Character attribute consistency after rewrites\n` +
      `- Plot threads dropped during the rewrite process\n\n` +
      `OUTPUT FORMAT:\n` +
      `If NO issues: "Post-revision continuity check passed. No new contradictions introduced."\n` +
      `If issues found:\n` +
      `### [Issue Number]. [Short Title]\n` +
      `**Contradiction:** [Describe]\n` +
      `**Affected Chapters:** Chapter [N], Chapter [M]\n` +
      `**Suggested Fix:** [Describe the fix]`));

    // ── Final compile ──────────────────────────────────────────────────────
    steps.push(step(idx++, 'Compile Revised Manuscript', 'export', 'export',
      `Compile all revised chapters of "${title}" into the final manuscript.\n\n` +
      `Include all chapters in order: ` +
      `${ctx.includePrologue ? 'Prologue, ' : ''}Chapters 1–${chapters}${ctx.includeEpilogue ? ', Epilogue' : ''}.`));

    return steps;
  },
};

const bookCover: ProjectTemplate = {
  type: 'book-cover',
  workType: 'books',
  name: 'Book Cover Design',
  description: 'AI-generated book wrap using FLUX Bookcover LoRA and back-cover text overlay.',
  buildSteps: (ctx, title, description) => {
    const steps: ProjectStep[] = [];
    let idx = 1;
    const variants = ctx.coverVariants || 1;

    steps.push(step(idx++, 'Generate Cover Art Prompt', 'writing', 'book_cover',
      `Generate the final production-ready FLUX.1-dev workflow parameters for a book cover for "${title}".\n\n` +
      `We are using the BOOKCOVER-REDMOND-FLUXKLEIN LoRA, which EXCELS at rendering perfect typography.\n` +
      `Description: ${description}\n\n` +
      `Output a JSON object with these EXACT fields (FLUX.1-dev specific):\n` +
      `{\n` +
      `  "positive_prompt": "detailed cinematic art prompt including EXACT text like: The title \\"${title}\\" is written in bold cinematic typography at the top. The author name \\"By ${ctx.penName || '[Author Name]'}\\" is at the bottom.",\n` +
      `  "negative_prompt": "watermark, blurry, deformed, ugly",\n` +
      `  "backend": "flux",\n` +
      `  "flux_unet": "flux1-dev.safetensors",\n` +
      `  "flux_clip_l": "clip_l.safetensors",\n` +
      `  "flux_clip_t5": "t5xxl_fp16.safetensors",\n` +
      `  "flux_vae": "ae.safetensors",\n` +
      `  "lora_name": "bookcover-redmond-fluxklein.safetensors",\n` +
      `  "lora_strength": 1.0,\n` +
      `  "reference_image": "workspace/images/book1.png", // OPTIONAL: Only if this is a series and you want to match Book 1's style\n` +
      `  "denoise": 0.65, // OPTIONAL: 0.65 for style transfer, omit if no reference image\n` +
      `  "upscale_model": "4x-UltraSharp.pth", // OPTIONAL: Drop this model in ComfyUI/models/upscale_models/ for 4K crispness\n` +
      `  "cfg_scale": 3.5,\n` +
      `  "steps": 28,\n` +
      `  "sampler": "euler",\n` +
      `  "scheduler": "simple",\n` +
      `  "layout": "cover"\n` +
      `}\n\n` +
      `CRITICAL: Output ONLY valid JSON — no markdown, no commentary.`));

    steps.push(step(idx++, 'Generate Back Cover Summary', 'writing', 'book_cover',
      `Write a compelling 150-word back cover blurb for "${title}".\n\n` +
      `Description: ${description}\n\n` +
      `Make it punchy, high stakes, and end with a hook. Output ONLY the summary paragraphs.`,
      { wordCountTarget: 150 }));

    for (let i = 1; i <= variants; i++) {
      const vLabel = variants > 1 ? ` (Variant ${i})` : '';
      steps.push(step(idx++, `Generate Base Artwork${vLabel}`, 'writing', 'comfyui_generate',
        `Submit the FLUX.1-dev parameters from Step 1 to the local ComfyUI instance ` +
        `and generate the base artwork using the LoRA.\n\n` +
        `This step is handled automatically. No LLM output is required.`));

      steps.push(step(idx++, `Composite Typography${vLabel}`, 'writing', 'text_overlay',
        `Composite the generated back cover summary from Step 2 onto the base artwork from Step ${idx - 2}.\n\n` +
        `This step is handled automatically by the text_overlay engine. No LLM output is required.`));
    }

    return steps;
  },
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Registry
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•


export const bookTemplates: ProjectTemplate[] = [
  bookPlanning,
  novelPipeline,
  styleCalibration,
  deepRevision,
  bookProduction,
  amazonKdpLaunch,
  shortStory,
  revisionExecution,
  bookCover
];
