/**
 * Per-step output quality gates.
 *
 * Runs after a step's result lands. Returns null if the result passes; returns
 * a short failure tag if it doesn't. A failure tag triggers an auto-enqueue of
 * a `pipeline_step_assist` task so a stronger model (Claude via /perry-worker
 * or Antigravity) can re-do the step with the same prompt + project context.
 *
 * Gates are intentionally tight + step-specific. The cost of a false-positive
 * (extra Claude assist invocation) is much lower than a false-negative
 * (garbage propagating through the pipeline → bad bible/outline).
 */

import { Project, ProjectStep } from '@perry/core';

export type QualityGate = (result: string, step: ProjectStep, project: Project) => string | null;

/**
 * Concept Keywords (step-1 of book-planning): parse JSON, verify each field
 * isn't one of the lazy defaults a weak model defaults to ("art",
 * "art history museum", "r/books"), and that the slug/subs match the
 * project's stated genre when one is obviously SF / fantasy / horror.
 */
const conceptKeywordsGate: QualityGate = (result, _step, project) => {
  let j: any;
  try { j = JSON.parse(result); } catch { return 'json-parse-fail'; }

  const lazySlugs = new Set(['art', 'fiction', 'books', 'novel', 'reading', 'literature']);
  const lazyQueries = ['art history museum', 'best books', 'fiction novel', 'good book', 'popular books'];

  if (!j.subjectSlug || lazySlugs.has(String(j.subjectSlug).toLowerCase())) return 'subjectSlug-default';
  if (!j.redditSubs || /^r\/(art|books)$/i.test(String(j.redditSubs).trim())) return 'redditSubs-default';
  if (!j.primaryQuery || lazyQueries.includes(String(j.primaryQuery).toLowerCase())) return 'primaryQuery-default';
  if (Array.isArray(j.altQueries) && j.altQueries.length > 1) {
    const distinct = new Set(j.altQueries.map((q: string) => String(q).toLowerCase().trim()));
    if (distinct.size < 2) return 'altQueries-all-identical';
  }

  // Genre-mismatch heuristic — only fires when premise is unambiguous.
  const desc = (project.description || '').toLowerCase();
  const slugAndSubs = (String(j.subjectSlug) + ' ' + String(j.redditSubs || '')).toLowerCase();
  const isSf = /\b(sci\W?fi|science\s+fiction|generation\s+ship|cyberpunk|space\s+opera|alien|android|biopunk|transhuman)\b/.test(desc);
  if (isSf && !/(science_fiction|scifi|cyberpunk|space|hard_fiction|printsf)/.test(slugAndSubs)) {
    return 'slug-doesnt-match-sf-premise';
  }
  const isFantasy = /\b(fantasy|magic\s+system|elves?|dragons?|wizards?|epic\s+fantasy)\b/.test(desc);
  if (isFantasy && !/(fantasy|epic_fantasy|swords)/.test(slugAndSubs)) {
    return 'slug-doesnt-match-fantasy-premise';
  }

  return null;
};

/**
 * Map from step id (or step label slug) to its gate. Unmapped steps pass
 * through ungated — gates are opt-in per step, not blanket.
 */
const GATES: Record<string, QualityGate> = {
  'step-1': conceptKeywordsGate,
  // future: step-2 comp-titles JSON-table validity, step-7 market-analysis bullet-density check, etc.
};

export function getGateFor(step: ProjectStep): QualityGate | null {
  return GATES[step.id] || null;
}
