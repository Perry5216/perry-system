#!/usr/bin/env node
/**
 * harvest-voice-paragraphs-v2.cjs
 *
 * Genre-aware voice harvester. Improvements over v1:
 *   • Larger AI-trap blacklist (LLM-isms beyond the basic anti-pattern set)
 *   • Generic-atmosphere word penalty (ethereal, transcendent, ineffable, etc.)
 *   • Bigger concrete sci-fi/cyberpunk lexicon
 *   • Distinctive-imagery bonus (unexpected verb-noun pairs, em-dash breaks)
 *   • Multi-project support (defaults to all style-calibration projects)
 *   • Top 50 surfaced
 *
 * Goal: surface paragraphs that EXEMPLIFY a unique cyberpunk voice AND don't
 * fall into recognisable AI-text traps.
 */

const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('/app/workspace/.config/projects.db', { readonly: true });
const PROJECT_FILTER = process.argv[2] || null; // omit to scan all style-calibration projects

// ─── REJECTION GATES (hard filters) ────────────────────────────────────────
const FILTER_WORDS_REGEX = /\b(?:[Hh]e|[Ss]he|[Tt]hey|[A-Z][a-z]{2,}(?:'s|s')?)\s+(?:felt|noticed|realized|wondered|remembered|saw|heard|looked|stared|imagined|assumed|decided|thought|knew|seemed|watched|observed|witnessed|spotted|scanned|sensed)\b/;
const FIRST_PERSON = /\b(my|I|me|mine|myself)\b/;
const ANTI_PATTERNS = [
  /\b(?:a\s+)?(?:chill|shiver|tremor|shudder)\s+(?:ran|raced|crept|crawled|slithered|snaked)\s+(?:up|down)\s+(?:his|her|their|[A-Z][a-z]+'s)\s+spine/i,
  /\bheart\s+(?:hammered|pounded|raced|thumped|thudded|pounding|hammering|drumming)\b/i,
  /\bblood\s+ran\s+cold/i,
  /\b(?:tendrils|fingers|claws|talons)\s+of\s+(?:fear|dread|panic|terror|cold|ice|despair|doubt)/i,
  /\bbreath\s+caught\s+in\s+(?:his|her|their|[A-Z][a-z]+'s)\s+throat/i,
  /\badrenaline\s+(?:jolted|surged|coursed|flooded|spiked|pumped|rushed|crashed|pulsed|burned|raced|tore|ripped)\b/i,
  /\b(?:racing|pounding|hammering|thudding)\s+pulse\b/i,
  /\bpalpable\s+(?:tension|fear|silence|dread|menace|rage)/i,
  /\bdelve\s+(?:deeper|into)\b/i,
  /\b(?:cacophony|labyrinth|tapestry|symphony)\s+of\b/i,
  /\bin\s+the\s+blink\s+of\s+an\s+eye/i,
];

// ─── AI-TRAP BLACKLIST (penalty, not hard reject) ──────────────────────────
const AI_TRAPS = [
  /\b(?:a|the)\s+testament\s+to\b/i,
  /\bin\s+many\s+ways\b/i,
  /\bnavigating\s+the\s+(?:complexities|challenges)/i,
  /\ba\s+(?:profound|deep)\s+sense\s+of\b/i,
  /\bspeaks\s+to\s+the\b/i,
  /\bthe\s+very\s+(?:essence|fabric|core)\s+of\b/i,
  /\ba\s+(?:delicate|fine|careful)\s+dance\b/i,
  /\bthe\s+(?:gravity|weight)\s+of\s+(?:the\s+)?(?:moment|situation|world|her|his)/i,
  /\bintricate\s+web\b/i,
  /\ba\s+beacon\s+of\b/i,
  /\bthe\s+heart\s+of\s+(?:the\s+)?(?:matter|issue)/i,
  /\bfrom\s+the\s+depths\s+of\b/i,
  /\ba\s+window\s+into\b/i,
  /\bthe\s+dance\s+between\b/i,
  /\bset\s+the\s+stage\s+for\b/i,
  /\bencapsulat(?:es|ed|ing)\b/i,
  /\boverwhelming\s+(?:sense|feeling)/i,
  /\bunderscores?\s+the\b/i,
  /\ba\s+stark\s+reminder\b/i,
  /\bcarves?\s+a\s+path\b/i,
  /\b(?:ineffable|transcendent|ethereal|otherworldly|mystical|primordial)\b/i,
  /\bancient\s+and\s+primal\b/i,
  /\beyes?\s+(?:like|flashed|burned|smoldered|glowed)\s+with\b/i,
  /\b(?:fierce|cold|hot)\s+(?:determination|resolve|fury|anger)/i,
  /\bvoice\s+(?:like|laced\s+with|tinged\s+with)\b/i,
  /\bwhispered\s+(?:promises|threats|sweet)/i,
  /^(?:Indeed|Moreover|Furthermore|Ultimately|Nevertheless|Meanwhile),/m,
  /\b(?:remarkably|tremendously|fundamentally|profoundly|undeniably|incredibly|noticeably|notably)\s+\w+/i,
];

// ─── CONCRETE / GENRE LEXICON (positive scoring) ──────────────────────────
const CONCRETE_NOUNS = new Set([
  // hardware
  'chip','capacitor','resistor','ribbon','cable','motherboard','register','kernel','packet','payload','daemon','lockfile','syslog','manifest',
  // body+tech
  'implant','jack','lace','ports','biometric','augment','prosthetic','cybernetic','retinas','vertebrae','synapse',
  // surfaces/objects
  'door','window','wall','floor','chair','table','hand','eye','finger','screen','panel','stylus','console','server','terminal','avatar',
  'street','room','corridor','elevator','lobby','monitor','cable','wire','edge','surface','key','button','lock','crack','stain','smear',
  'drop','crumb','grain','thread','shard','chip','spark','plate','rivet','girder','beam','strut','glass','frame','rim',
  // sensory/atmosphere
  'hum','click','hiss','crackle','whir','drone','whine','squeal','pop','ping','beep','tick',
  'coffee','stale','ozone','metallic','copper','sour','rust','dust','smudge','oil','smoke',
  // network/code-ish
  'ping','latency','bandwidth','firewall','gateway','port','socket','byte','pixel','static','glitch','signal','protocol','breach','node','encrypt','decrypt','fragment',
  // genre-specific
  'drift','sever','constellate','reaper','holographic','datastream','null-sector','holo','substrate',
  'capacitor','relay','scanner','holo','HUD','sub-routine','daemon','exploit','vulnerability','signature','build',
]);

const SCIFI_VOCAB_RE = /\b(?:avatar|substrate|server|circuit|firewall|protocol|breach|node|byte|pixel|static|glitch|encrypt|decrypt|terminal|interface|cyber|drift|sever|constellate|reaper|holographic|stylus|datastream|architecture|null-sector|holo|fragment|biometric|neural|synthetic|quantum|HUD|exploit|daemon|kernel|payload|register|implant|prosthetic|cybernetic|render|parse|polygon|grid|node|gateway)\b/i;

const SENSORY_HOOKS = /\b(?:smelled\s+of|smelled\s+like|smelt\s+(?:of|like)|tasted\s+(?:of|like|metallic|copper|sour|sweet|bitter)|air\s+(?:thick|heavy|stale|sterile|hummed|tasted|tang(?:y|ed))|walls\s+of|floor\s+(?:rough|cold|hummed|vibrated)|the\s+(?:hum|drone|whine|click|hiss|crackle|squeal)\s+of)/i;

const RECYCLED_PHYSICAL = /\b(?:[A-Z][a-z]+'s\s+|her\s+|his\s+|their\s+)?(fists?|hands?|jaw|stomach|skin|chest|throat|eyes|fingers?|pulse|breath|knuckles|shoulders|spine|nails)\s+(clenched|trembled|trembling|prickled|dropped|tightened|raced|caught|shook|shaking|stiffened|tensed|sagged|coiled|twitched|curled|hardened|softened|dug|digging|drummed)\b/i;

// ─── DISTINCTIVE-IMAGERY HEURISTICS ────────────────────────────────────────
// Unexpected verb on inanimate technical subject — signature of strong voice
const INANIMATE_AGENCY = /\b(?:screen|terminal|console|server|code|data|monitor|cable|circuit|signal|firewall|substrate|avatar|kernel|daemon|stream|module|render|pixel|polygon)\s+(?:breathed|stuttered|whispered|sighed|hesitated|relented|argued|conceded|bled|wept|cried|sang|murmured|coughed|gagged|paused|blinked|winked|smiled|grinned|laughed|wept)/i;

// "X like Y" simile pattern with concrete Y (not abstract emotion)
const SIMILE_RE = /\blike\s+(?:a|an|the)?\s*([a-z]+(?:\s+[a-z]+)?)\b/gi;
const ABSTRACT_SIMILE_OBJECTS = new Set(['ghost','shadow','dream','memory','feeling','thought','whisper','prayer','wound','scar','promise','reminder','dance','symphony','tapestry']);

// Em-dash use (signature of rhythm-conscious prose)
const EM_DASH = /—|--/;

// ─── HELPERS ───────────────────────────────────────────────────────────────
function fastReject(text) {
  if (!text || text.length < 40) return 'too_short';
  if (FIRST_PERSON.test(text)) return 'first_person_pov';
  const fwMatch = text.match(FILTER_WORDS_REGEX);
  if (fwMatch) return `filter_word:${fwMatch[0]}`;
  for (const re of ANTI_PATTERNS) {
    const m = text.match(re);
    if (m) return `anti_pattern:${m[0].slice(0,40)}`;
  }
  return null;
}

function countConcreteNouns(text) {
  const words = text.toLowerCase().match(/\b[a-z][a-z'-]+\b/g) || [];
  let hits = 0;
  for (const w of words) if (CONCRETE_NOUNS.has(w)) hits++;
  return { hits, total: words.length };
}

function scoreVoice(text) {
  let score = 0;
  const reasons = [];
  const penalties = [];

  // Rhythm
  const sentences = text.split(/[.!?]+\s+/).filter(s => s.trim().length > 3);
  if (sentences.length >= 3) {
    const lengths = sentences.map(s => s.split(/\s+/).length);
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((acc, l) => acc + (l - mean) ** 2, 0) / lengths.length;
    if (variance > 12) { score += 2; reasons.push('strong_rhythm'); }
    else if (variance > 6) { score += 1; reasons.push('rhythm'); }
    if (lengths.some(l => l < 5)) { score += 1; reasons.push('fragment'); }
  }

  // Concrete density
  const { hits, total } = countConcreteNouns(text);
  if (total > 0) {
    const ratio = hits / total;
    if (ratio > 0.10) { score += 3; reasons.push(`density(${hits}/${total})`); }
    else if (ratio > 0.06) { score += 2; reasons.push(`concrete(${hits}/${total})`); }
    else if (ratio > 0.04) { score += 1; reasons.push(`concrete-lite(${hits}/${total})`); }
  }

  // Sensory hooks
  if (SENSORY_HOOKS.test(text)) { score += 2; reasons.push('sensory_hook'); }

  // Sci-fi grounded
  if (SCIFI_VOCAB_RE.test(text)) { score += 1; reasons.push('scifi_vocab'); }

  // No recycled physical actions
  if (!RECYCLED_PHYSICAL.test(text)) { score += 1; reasons.push('no_recycled'); }

  // Distinctive imagery: inanimate agency
  if (INANIMATE_AGENCY.test(text)) { score += 2; reasons.push('inanimate_agency'); }

  // Em-dash use (rhythm signature)
  if (EM_DASH.test(text)) { score += 1; reasons.push('em_dash'); }

  // Simile concrete-vs-abstract
  const similes = [...(text.matchAll(SIMILE_RE) || [])];
  for (const s of similes) {
    const obj = (s[1] || '').toLowerCase().split(/\s+/)[0];
    if (ABSTRACT_SIMILE_OBJECTS.has(obj)) {
      penalties.push(`abstract_simile:like_${obj}`); score -= 1;
    } else if (obj.length > 3) {
      // concrete simile object — small bonus
      score += 0; // don't double-count concrete bonus
    }
  }

  // AI traps — strong penalty per match
  for (const re of AI_TRAPS) {
    const m = text.match(re);
    if (m) { penalties.push(`ai_trap:${m[0].slice(0,40)}`); score -= 2; }
  }

  return { score: Math.max(-5, score), reasons, penalties };
}

// ─── COLLECT ───────────────────────────────────────────────────────────────
const projects = db.prepare(`SELECT id FROM projects WHERE data LIKE '%style-calibration%' OR data LIKE '%styleCalibration%'`).all();
const projectIds = projects.map(r => r.id);
console.log(`\nDiscovered style-calibration projects: ${projectIds.join(', ') || '(none)'}\n`);

const targetIds = PROJECT_FILTER ? [PROJECT_FILTER] : projectIds;
const compiledScenes = db.prepare(`
  SELECT project_id, id, label, chapter_number, result
  FROM steps
  WHERE project_id IN (${targetIds.map(() => '?').join(',')})
    AND task_type='draft_compile' AND status='completed' AND result IS NOT NULL
`).all(...targetIds);

console.log(`Pulled ${compiledScenes.length} completed compiled scenes across ${targetIds.length} project(s).`);

function cleanScene(text) {
  return text
    .replace(/<\/?response>/gi, '')
    .replace(/\[CONTENT WARNING[\s\S]*?\][\s\S]*?(?=\n\n|$)/g, '')
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

const allParas = [];
for (const s of compiledScenes) {
  const cleaned = cleanScene(s.result || '');
  const paras = cleaned.split(/\n\s*\n+/).map(p => p.trim()).filter(p => p.length >= 80);
  for (let i = 0; i < paras.length; i++) {
    allParas.push({
      projectId: s.project_id,
      stepId: s.id,
      label: s.label,
      chapter: s.chapter_number,
      paraIdx: i,
      text: paras[i],
    });
  }
}
console.log(`Paragraphs (≥80 chars): ${allParas.length}\n`);

const passed = [];
const rejectReasons = {};
for (const p of allParas) {
  const reject = fastReject(p.text);
  if (reject) {
    const key = reject.split(':')[0];
    rejectReasons[key] = (rejectReasons[key] || 0) + 1;
    continue;
  }
  // Skip pure-dialogue paragraphs
  const quoteChars = (p.text.match(/"[^"]*"|'[^']*'/g) || []).join('').length;
  if (quoteChars / p.text.length > 0.7) continue;
  const { score, reasons, penalties } = scoreVoice(p.text);
  passed.push({ ...p, score, reasons, penalties, words: p.text.split(/\s+/).length });
}
passed.sort((a, b) => b.score - a.score);

console.log(`Paragraphs passing fast scan: ${passed.length}`);
console.log('Rejection reasons:');
for (const [k, v] of Object.entries(rejectReasons).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

const dist = {};
for (const p of passed) dist[p.score] = (dist[p.score] || 0) + 1;
console.log('\nScore distribution:');
for (let i = 15; i >= -5; i--) if (dist[i]) console.log(`  score ${i}: ${dist[i]}`);

const TOP_N = Math.min(50, passed.length);
console.log(`\n── Top ${TOP_N} (with AI-trap penalties applied) ──`);
for (let i = 0; i < TOP_N; i++) {
  const p = passed[i];
  console.log('\n' + '─'.repeat(72));
  console.log(`#${i + 1}  ${p.projectId} ${p.label}  (chap ${p.chapter}, ¶${p.paraIdx})  score=${p.score}  words=${p.words}`);
  console.log(`    + ${p.reasons.join(', ')}`);
  if (p.penalties.length) console.log(`    - ${p.penalties.join(', ')}`);
  console.log();
  console.log(p.text.length > 700 ? p.text.slice(0, 700) + '...' : p.text);
}

const outputPath = '/app/workspace/training/pen-a-perry/voice_paragraphs_v2.jsonl';
fs.writeFileSync(outputPath, passed.map(p => JSON.stringify({
  project_id: p.projectId, step_id: p.stepId, label: p.label,
  chapter: p.chapter, paraIdx: p.paraIdx, score: p.score, words: p.words,
  reasons: p.reasons, penalties: p.penalties, text: p.text,
})).join('\n') + '\n');
console.log('\n' + '═'.repeat(72));
console.log(`Wrote ${passed.length} ranked paragraphs to:`);
console.log(`  ${outputPath}`);
db.close();
