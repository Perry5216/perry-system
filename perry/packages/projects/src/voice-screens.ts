/**
 * voice-screens — shared regex bank for filter-word / named-emotion /
 * anti-pattern detection. Used by:
 *
 *   - AuditService.scoreResponse       (Phase B post-training audit)
 *   - auto-learning-service.fastQualityScan (pre-train pair gate)
 *   - auto-learning-service.drainWorkerResults (worker synth gate)
 *
 * Why "bare verb" not "pronoun + verb": the v3 LoRA shipped a leak —
 *   "...shake her until she moved faster, thought clearer."
 * The previous FILTER_WORDS_RE required a subject (He/She/Name) immediately
 * before the verb, so the elided participle slipped through every gate.
 * Going bare catches the elision at the cost of slightly more aggressive
 * narration filtering — by design. The pen system prompt promises NEVER to
 * use these verbs, so any narration occurrence is a contract violation.
 *
 * stripDialogue() is applied before screening so quoted speech ("I thought
 * I knew you") doesn't trigger.
 */

export const stripDialogue = (text: string): string =>
  text.replace(/"[^"]*"/g, '').replace(/[“][^”]*[”]/g, '');

// Bare filter-verb pattern. Any of these in narration (post-stripDialogue)
// fires. The verbs are exactly the system-prompt denylist; "felt/thought/
// noticed/realized/saw/looked at/stared/remembered/imagined" + neighbours
// the prior loose regex was already gating.
export const FILTER_VERBS_RE =
  /\b(?:felt|noticed|realized|wondered|remembered|thought|knew|seemed|imagined|observed|witnessed|sensed|saw|heard|stared|watched|spotted|scanned)\b/gi;

// First-person POV leak. Third-person Deep POV only.
export const FIRST_PERSON_RE = /\b(?:my|I|me|mine|myself)\b/g;

// Named-emotion nouns — labelled internal states. The pen must SHOW via
// somatic markers, never name. Match both standalone usage ("dread settled
// in") and prepositional variants ("with dread") captured by the bare form.
export const NAMED_EMOTIONS_RE =
  /\b(?:fear|anger|sadness|joy|happiness|anxiety|frustration|sorrow|dread|panic|terror|embarrassment|shame|guilt|grief|disgust|despair|fury|rage|jealousy|envy|relief|regret|hope|hatred|melancholy|anguish)\b/gi;

// Multi-word emotion-noun phrases that the original fastQualityScan caught.
// Kept as substring matches because lower-case .includes is cheaper than
// regex iteration here.
export const EMOTION_PHRASES = [
  'a wave of', 'a surge of', 'a pang of', 'a rush of', 'a flicker of',
  'desperation', 'with panic', 'with fear', 'with anger', 'with grief',
  'with relief', 'with terror', 'with dread',
] as const;

// First-tier cliché / anti-pattern regexes. Each {tag, re} pair maps cleanly
// to the audit report's priorityTags surface.
export const ANTI_PATTERN_RULES: Array<{ tag: string; re: RegExp }> = [
  { tag: 'spine_chill',          re: /\b(?:a\s+)?(?:chill|shiver|tremor)\s+(?:ran|raced|crept|crawled|slithered|snaked)\s+(?:up|down)\s+(?:his|her|their|[A-Z][a-z]+'s)\s+spine/gi },
  { tag: 'heart_pounded_chest',  re: /\bheart\s+(?:hammered|pounded|raced|thumped|thudded)\s+(?:in|against)\s+(?:his|her|their|[A-Z][a-z]+'s)\s+(?:chest|ribs)/gi },
  { tag: 'heart_cliche_vb',      re: /\bheart\s+(?:raced|pounded|hammered|thumped|thudded|pounding|hammering|thudding|drumming|pounds|races|hammers|thumps)\b/gi },
  { tag: 'blood_ran_cold',       re: /\bblood\s+ran\s+cold/gi },
  { tag: 'breath_didnt_know',    re: /\blet\s+out\s+a\s+breath\s+(?:he|she|they)\s+didn'?t\s+know/gi },
  { tag: 'tendrils_of_emotion',  re: /\b(?:tendrils|fingers|claws|talons)\s+of\s+(?:fear|dread|panic|terror|cold|ice|despair|doubt)/gi },
  { tag: 'breath_caught_throat', re: /\bbreath\s+caught\s+in\s+(?:his|her|their|[A-Z][a-z]+'s)\s+throat/gi },
  { tag: 'adrenaline_llm',       re: /\badrenaline\s+(?:jolted|surged|coursed|flooded|spiked|pumped|rushed|crashed|pulsed|burned|raced|pounded|hammered|tore|ripped)\b/gi },
  { tag: 'pulse_cliche',         re: /\bpulse\s+(?:raced|pounded|hammered|thumped|thudded|pounding|hammering)\b/gi },
  { tag: 'icy_tendrils',         re: /\bicy\s+(?:tendrils|fingers|claws|grip)/gi },
  { tag: 'blink_of_an_eye',      re: /\bin\s+the\s+blink\s+of\s+an\s+eye/gi },
  { tag: 'weight_of_world',      re: /\bweight\s+of\s+the\s+world/gi },
  { tag: 'storm_of_emotions',    re: /\b(?:storm|wave|surge)\s+of\s+emotions?/gi },
  { tag: 'testament_to',         re: /\b(?:a\s+)?testament\s+to\b/gi },
  { tag: 'orchestra_cliche',     re: /\b(?:cacophony|labyrinth|tapestry|symphony)\s+of\b/gi },
  { tag: 'palpable_emotion',     re: /\bpalpable\s+(?:tension|fear|silence|dread|menace|rage)/gi },
  { tag: 'delve_deeper',         re: /\bdelve\s+(?:deeper|into)\b/gi },
  { tag: 'skin_prickled',        re: /\bskin\s+(?:prickled|prickling|crawled|crawling)\b/gi },
  { tag: 'fingers_trembled',     re: /\bfingers\s+(?:trembled|trembling|shook|shaking)\b/gi },
  { tag: 'hands_trembled',       re: /\bhands?\s+(?:trembled|trembling|shook|shaking)\b/gi },
  { tag: 'stomach_twisted',      re: /\bstomach\s+(?:twisted|clenched|dropped|knotted)\b/gi },
  { tag: 'chest_tightened',      re: /\bchest\s+(?:tightened|constricted|seized)\b/gi },
  { tag: 'knuckles_white',       re: /\bknuckles?\s+(?:white|whitened)/gi },
  { tag: 'eyes_narrowed',        re: /\beyes\s+narrow(?:ed)?(?:\s+to\s+slits)?\b/gi },
  { tag: 'eyes_flashed',         re: /\beyes\s+flash(?:ed)?\b/gi },
  { tag: 'eyes_widened',         re: /\beyes\s+widen(?:ed)?\b/gi },
  { tag: 'eyes_wild',            re: /\beyes\s+wild\b/gi },
  { tag: 'teeth_bared',          re: /\bteeth\s+bared\b/gi },
  { tag: 'lips_twisted',         re: /\blips\s+twisted\s+into\b/gi },
  { tag: 'smile_played_lips',    re: /\bsmile\s+played\s+(?:at|on)\b/gi },
  { tag: 'cold_smile',           re: /\bcold\s+smile\b/gi },
  { tag: 'slammed_fist',         re: /\bslammed\s+(?:his|her|their)\s+fist/gi },
  { tag: 'nails_dug_palms',      re: /\bnails\s+(?:dug|digging)\s+into\s+(?:his|her|their|the)\s+palms/gi },
  { tag: 'swallowed_hard',       re: /\bswallowed\s+hard\b/gi },
  { tag: 'snarled_tag',          re: /\b(snarled|hissed|growled|spat|intoned|breathed)\b(?=,?\s*['"])/gi },
  { tag: 'mind_raced',           re: /\b(?:mind|thoughts)\s+raced\b/gi },
  { tag: 'decision_tree_mind',   re: /\bdecision\s+tree\b/gi },
];

// Present-tense narration verbs outside dialogue — heuristic only, false-
// positives are tolerated as `tense_slip` flags.
export const TENSE_SLIP_RE =
  /(?:^|[.!?]\s+)(?:[A-Z][a-z]+\s+)(ducks|runs|walks|stands|steps|looks|turns|opens|closes|reaches|pulls|pushes|grabs|throws|catches|leaps|jumps|sees|hears|feels|thinks|knows|notices)\b/g;

export interface LeakHit {
  tag: string;
  matches: string[];
}

/**
 * Strict screen. Returns ALL hits across all categories (filter words,
 * named emotions, first-person, anti-patterns, tense slips). Empty array
 * means clean.
 *
 * Used by both the Phase B audit (scoreResponse) and the worker-drain
 * gate (drainWorkerResults). For early-exit pre-train pair scanning, use
 * `firstFailure()` instead.
 */
export function scanLeaks(text: string): LeakHit[] {
  const narration = stripDialogue(text);
  const found = new Map<string, string[]>();
  const add = (tag: string, m: string) => {
    const arr = found.get(tag) || [];
    arr.push(m);
    found.set(tag, arr);
  };

  // Bare filter verbs (narration only — dialogue stripped)
  for (const m of narration.matchAll(FILTER_VERBS_RE)) add('filter_word', m[0]);

  // First-person POV leak (narration only)
  for (const m of narration.matchAll(FIRST_PERSON_RE)) add('first_person_leak', m[0]);

  // Named emotions (narration only — characters can SAY "I'm afraid")
  for (const m of narration.matchAll(NAMED_EMOTIONS_RE)) add('named_emotion', m[0]);

  // Multi-word emotion phrases (case-insensitive substring)
  const lower = narration.toLowerCase();
  for (const phrase of EMOTION_PHRASES) {
    let idx = 0;
    while ((idx = lower.indexOf(phrase, idx)) !== -1) {
      add('emotion_phrase', phrase);
      idx += phrase.length;
    }
  }

  // Anti-patterns (full text — these are bad anywhere including dialogue)
  for (const { tag, re } of ANTI_PATTERN_RULES) {
    for (const m of text.matchAll(re)) add(tag, m[0]);
  }

  // Tense slips (narration only)
  for (const m of narration.matchAll(TENSE_SLIP_RE)) add('tense_slip', m[0]);

  return Array.from(found.entries()).map(([tag, matches]) => ({ tag, matches }));
}

/**
 * Early-exit screen — returns the first reason string or null. Cheaper than
 * scanLeaks for the pre-train pair gate where we only need to know whether
 * to reject. Format matches the legacy `fastQualityScan` return shape so
 * the existing rejection-reason telemetry continues to work.
 */
export function firstFailure(text: string): string | null {
  const narration = stripDialogue(text);

  const fw = narration.match(FILTER_VERBS_RE);
  if (fw) return `filter_word:${fw[0].toLowerCase()}`;

  const fp = narration.match(FIRST_PERSON_RE);
  if (fp) return `first_person_pov`;

  const ne = narration.match(NAMED_EMOTIONS_RE);
  if (ne) return `named_emotion:${ne[0].toLowerCase()}`;

  const lower = narration.toLowerCase();
  for (const phrase of EMOTION_PHRASES) {
    if (lower.includes(phrase)) return `emotion_phrase:${phrase}`;
  }

  for (const { tag, re } of ANTI_PATTERN_RULES) {
    const m = text.match(re);
    if (m) return `anti_pattern:${tag}:"${m[0]}"`;
  }

  return null;
}
