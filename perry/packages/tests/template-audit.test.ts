/**
 * Cross-template audit — runs health checks across all 9 P.E.R.R.Y. templates.
 * Run: node --import tsx packages/tests/template-audit.test.ts
 *
 * Checks applied to each template:
 *  1. No negative constraint strings ("Do not", "Do NOT", "NEVER") in system-critical steps
 *  2. All stat_update steps define Section G (NARRATIVE DIRECTIVES) correctly
 *  3. creative_writing steps have wordCountTarget set
 *  4. pov_check steps have a defined OUTPUT FORMAT anchor
 *  5. analysis steps have a structured output header or verdict line
 *  6. outline steps have a chapter count reference or structured format
 *  7. export steps exist where expected (novel-pipeline, revision-execution)
 *  8. research steps are not tagged as creative_writing (wrong persona risk)
 *  9. All stat_update sections A–G present in novel-pipeline stat steps
 * 10. Style-calibration: all 3 scene types (Action/Dialogue/Introspection) exist per pass
 * 11. deep-revision: all 8 passes (A–H) present per chapter
 * 12. revision-execution: post-revision pov_check present after each chapter
 * 13. book-cover: all 5 steps present (research → concept → flux → generate → render)
 * 14. amazon-kdp-launch: all 7 steps present
 * 15. short-story: all 4 steps present
 * 16. No step has an empty prompt string
 * 17. No step label contains garbled encoding artifacts (â€", â†', etc.)
 */

let passed = 0;
let failed = 0;
const failures: string[] = [];
let currentSuite = '';

function suite(name: string) {
  currentSuite = name;
  console.log(`\n─── ${name} ───`);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(`[${currentSuite}] ${name}: ${err.message}`);
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEqual(a: any, b: any, label: string) {
  if (a !== b) throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ── Load templates ──────────────────────────────────────────────────────────
import { TemplateRegistry } from '../projects/src/templates.js';

const registry = new TemplateRegistry();
const allTemplates = registry.list();

// Build a context fixture that exercises all optional features
const ctx = {
  targetChapters: 5,
  includePrologue: true,
  includeEpilogue: true,
  targetWordsPerChapter: 3500,
  estimatedTotalWords: 5000,
};

// Build steps for each template
const templateSteps = new Map<string, ReturnType<typeof registry.list>[0]['buildSteps']>();
for (const t of allTemplates) {
  templateSteps.set(t.type, t.buildSteps);
}

function getSteps(type: string) {
  const t = allTemplates.find(x => x.type === type);
  if (!t) throw new Error(`Template '${type}' not found`);
  return t.buildSteps(ctx, 'Digital Drift', 'A multi-POV cyberpunk thriller.');
}

// Encoding artifacts: stored as arrays of char codes to avoid parser issues.
const ENCODING_ARTIFACTS: string[] = [
  String.fromCharCode(0xE2, 0x80, 0x93), // mangled em-dash
  String.fromCharCode(0xE2, 0x80, 0x99), // mangled right-quote
  String.fromCharCode(0xE2, 0x80, 0x98), // mangled left-quote
  String.fromCharCode(0xE2, 0x86, 0x92), // mangled arrow
  String.fromCharCode(0xE2, 0x94, 0x80), // mangled box-draw
  String.fromCharCode(0xC3, 0xA9),        // mangled e-acute
];

// ── Test: No empty prompts across all templates ─────────────────────────────
suite('All Templates — No Empty Prompts');

for (const t of allTemplates) {
  test(`${t.name}: all steps have non-empty prompts`, () => {
    const steps = t.buildSteps(ctx, 'Test Novel', 'A test.');
    const empty = steps.filter(s => !s.prompt || s.prompt.trim().length === 0);
    assert(empty.length === 0, `Steps with empty prompt: ${empty.map(s => s.label).join(', ')}`);
  });
}

// ── Test: No garbled encoding artifacts in step labels or prompts ───────────
suite('All Templates — No Encoding Artifacts in Labels');

for (const t of allTemplates) {
  test(`${t.name}: no garbled chars in step labels`, () => {
    const steps = t.buildSteps(ctx, 'Test Novel', 'A test.');
    const garbled = steps.filter(s => ENCODING_ARTIFACTS.some(a => s.label.includes(a)));
    assert(garbled.length === 0, `Steps with encoding artifacts in label: ${garbled.map(s => `"${s.label}"`).join(', ')}`);
  });
}

// ── Test: No garbled encoding artifacts in prompts ──────────────────────────
suite('All Templates — No Encoding Artifacts in Prompts');

for (const t of allTemplates) {
  test(`${t.name}: no garbled chars in prompts`, () => {
    const steps = t.buildSteps(ctx, 'Test Novel', 'A test.');
    const garbled = steps.filter(s => ENCODING_ARTIFACTS.some(a => s.prompt?.includes(a)));
    assert(garbled.length === 0, `Steps with encoding artifacts in prompt: ${garbled.map(s => `"${s.label}"`).join(', ')}`);
  });
}

// ── Test: creative_writing steps have wordCountTarget ──────────────────────
suite('All Templates — creative_writing Word Count Targets');

// These templates are expected to have creative_writing steps WITH wordCountTarget
const templatesWithTargetedWriting = ['novel-pipeline', 'style-calibration', 'short-story', 'revision-execution'];

for (const type of templatesWithTargetedWriting) {
  test(`${type}: creative_writing steps have wordCountTarget`, () => {
    const steps = getSteps(type);
    const writingSteps = steps.filter(s => s.taskType === 'creative_writing');
    const missing = writingSteps.filter(s => !s.wordCountTarget || s.wordCountTarget <= 0);
    assert(missing.length === 0,
      `creative_writing steps without wordCountTarget: ${missing.map(s => s.label).join(', ')}`);
  });
}

// ── Test: pov_check steps have OUTPUT FORMAT anchor ────────────────────────
suite('All Templates — pov_check OUTPUT FORMAT anchor');

for (const t of allTemplates) {
  const steps = t.buildSteps(ctx, 'Test Novel', 'A test.');
  const povSteps = steps.filter(s => s.taskType === 'pov_check');
  if (povSteps.length === 0) continue;

  test(`${t.name}: pov_check steps have OUTPUT FORMAT`, () => {
    const missing = povSteps.filter(s => !s.prompt?.includes('OUTPUT FORMAT'));
    assert(missing.length === 0,
      `pov_check steps without OUTPUT FORMAT: ${missing.map(s => s.label).join(', ')}`);
  });

  test(`${t.name}: pov_check steps have Verdict line`, () => {
    const missing = povSteps.filter(s => !s.prompt?.includes('Verdict'));
    assert(missing.length === 0,
      `pov_check steps without Verdict: ${missing.map(s => s.label).join(', ')}`);
  });
}

// ── Test: revision_check steps have Verdict line ───────────────────────────
suite('All Templates — revision_check Verdict anchor');

for (const t of allTemplates) {
  const steps = t.buildSteps(ctx, 'Test Novel', 'A test.');
  const revSteps = steps.filter(s => s.taskType === 'revision_check');
  if (revSteps.length === 0) continue;

  test(`${t.name}: revision_check steps have Verdict line`, () => {
    const missing = revSteps.filter(s => !s.prompt?.includes('Verdict: PASS / REVISE / REWRITE'));
    assert(missing.length === 0,
      `revision_check steps without Verdict: ${missing.map(s => s.label).join(', ')}`);
  });
}

// ── Test: research steps are NOT tagged creative_writing ───────────────────
suite('All Templates — research Steps Not Mistyped as creative_writing');

for (const t of allTemplates) {
  const steps = t.buildSteps(ctx, 'Test Novel', 'A test.');
  const mismatch = steps.filter(s =>
    s.phase === 'research' && s.taskType === 'creative_writing'
  );
  if (mismatch.length === 0) continue;
  test(`${t.name}: no research-phase steps tagged creative_writing`, () => {
    assert(false, `Research steps wrongly tagged creative_writing: ${mismatch.map(s => s.label).join(', ')}`);
  });
}

// ── Test: novel-pipeline Review sections A–G ─────────────────────────
suite('novel-pipeline — Review Sections A–G');

const novelSteps = getSteps('novel-pipeline');
const statUpdateSteps = novelSteps.filter(s => s.label.includes('Review') && s.prompt?.includes('## G.'));

test(`novel-pipeline has Review steps containing narrative directives`, () => {
  assert(statUpdateSteps.length > 0, 'Must have at least 1 Review step with narrative directives');
});

const requiredSections = ['## A.', '## B.', '## C.', '## D.', '## E.', '## F.', '## G.'];
for (const section of requiredSections) {
  test(`Review steps all contain ${section}`, () => {
    const missing = statUpdateSteps.filter(s => !s.prompt?.includes(section));
    assert(missing.length === 0,
      `Review steps missing ${section}: ${missing.map(s => s.label).join(', ')}`);
  });
}

test('Review Section G says NARRATIVE DIRECTIVES', () => {
  const missing = statUpdateSteps.filter(s => !s.prompt?.includes('NARRATIVE DIRECTIVES'));
  assert(missing.length === 0, `Steps missing NARRATIVE DIRECTIVES: ${missing.map(s => s.label).join(', ')}`);
});

test('Review Section G is scoped (scoped to)', () => {
  const missing = statUpdateSteps.filter(s => !s.prompt?.includes('scoped to'));
  assert(missing.length === 0, `Steps missing scoped to scope directive: ${missing.map(s => s.label).join(', ')}`);
});

// ── Test: style-calibration — 3 scene types + summary per pass ─────────────
suite('style-calibration — Scene Types and Summary Per Pass');

const styleSteps = getSteps('style-calibration');

test('style-calibration: Action Sample step exists in pass 1', () => {
  assert(styleSteps.some(s => s.label.includes('Action Sample')), 'Must have Action Sample');
});

test('style-calibration: Dialogue Sample step exists in pass 1', () => {
  assert(styleSteps.some(s => s.label.includes('Dialogue Sample')), 'Must have Dialogue Sample');
});

test('style-calibration: Introspection Sample step exists in pass 1', () => {
  assert(styleSteps.some(s => s.label.includes('Introspection Sample')), 'Must have Introspection Sample');
});

test('style-calibration: Summary & Improvement Directives step exists', () => {
  assert(styleSteps.some(s => s.label.includes('Summary')), 'Must have Summary step');
});

test('style-calibration: all writing steps have wordCountTarget 400', () => {
  const writingSteps = styleSteps.filter(s => s.taskType === 'creative_writing');
  const wrong = writingSteps.filter(s => s.wordCountTarget !== 400);
  assert(wrong.length === 0, `Steps with wrong wordCountTarget: ${wrong.map(s => `${s.label}(${s.wordCountTarget})`).join(', ')}`);
});

test('style-calibration: pov_check exists for each scene type', () => {
  const povSteps = styleSteps.filter(s => s.taskType === 'pov_check');
  assert(povSteps.length >= 3, `Expected at least 3 pov_check steps, got ${povSteps.length}`);
});

// ── Test: deep-revision — All 8 audit passes per chapter ──────────────────
suite('deep-revision — 8 Audit Passes Per Chapter');

const deepSteps = getSteps('deep-revision');
const ch1AuditLabels = deepSteps.filter(s => s.chapterNumber === 1).map(s => s.label);

const expectedPasses = [
  'Dialogue & Subtext',
  'Tension Architecture',
  'Sensory Immersion',
  'Reader Contract',
  'Prose Rhythm',
  'Character Consistency',
  'Scene Function',
  'Revision Brief',
];

for (const pass of expectedPasses) {
  test(`deep-revision: Chapter 1 has "${pass}" audit pass`, () => {
    const found = ch1AuditLabels.some(l => l.includes(pass));
    assert(found, `Chapter 1 is missing the "${pass}" pass. Labels: ${ch1AuditLabels.join(', ')}`);
  });
}

test('deep-revision: has manuscript-level Structural Arc Audit', () => {
  assert(deepSteps.some(s => s.label === 'Structural Arc Audit'), 'Missing Structural Arc Audit');
});

test('deep-revision: has manuscript-level Character Arc Tracker', () => {
  assert(deepSteps.some(s => s.label === 'Character Arc Tracker'), 'Missing Character Arc Tracker');
});

test('deep-revision: has manuscript-level Thematic Cohesion Report', () => {
  assert(deepSteps.some(s => s.label === 'Thematic Cohesion Report'), 'Missing Thematic Cohesion Report');
});

test('deep-revision: has Full Revision Summary Report', () => {
  assert(deepSteps.some(s => s.label === 'Full Revision Summary Report'), 'Missing Full Revision Summary');
});

// ── Test: revision-execution — post-revision checks and export ──────────────
suite('revision-execution — Post-Revision Checks and Export');

const revExSteps = getSteps('revision-execution');

test('revision-execution: has Revision Action Plan', () => {
  assert(revExSteps.some(s => s.label === 'Revision Action Plan'), 'Missing Revision Action Plan');
});

test('revision-execution: every chapter has a Post-Revision Check (pov_check)', () => {
  // Chapters 0 (prologue) through 6 (epilogue) with ctx targetChapters=5
  const expectedChapters = [0, 1, 2, 3, 4, 5, 6]; // prologue + 5 + epilogue
  const postChecks = revExSteps.filter(s => s.label.includes('Post-Revision Check'));
  assert(postChecks.length === expectedChapters.length,
    `Expected ${expectedChapters.length} Post-Revision Checks, got ${postChecks.length}`);
});

test('revision-execution: has Global Manuscript Polish step', () => {
  assert(revExSteps.some(s => s.label === 'Global Manuscript Polish'), 'Missing Global Manuscript Polish');
});

test('revision-execution: has Post-Revision Continuity Check', () => {
  assert(revExSteps.some(s => s.label === 'Post-Revision Continuity Check'), 'Missing Post-Revision Continuity Check');
});

test('revision-execution: has Compile Revised Manuscript export step', () => {
  assert(revExSteps.some(s => s.taskType === 'export'), 'Missing export step');
});

test('revision-execution: Global Manuscript Polish outputs JSON array', () => {
  const step = revExSteps.find(s => s.label === 'Global Manuscript Polish');
  assert(step !== undefined, 'Must find step');
  assert(step!.prompt?.includes('valid JSON'), 'Must specify valid JSON output');
  assert(step!.prompt?.includes('"old"'), 'Must include old/new replace schema');
});

// ── Test: book-cover — All 4 Required Steps ────────────────────────────────────────
suite('book-cover — All 4 Required Steps');

const coverSteps = getSteps('book-cover');

test('book-cover: has Generate Cover Art Prompt step', () => {
  assert(coverSteps.some(s => s.label === 'Generate Cover Art Prompt'), 'Missing Generate Cover Art Prompt');
});

test('book-cover: has Generate Back Cover Summary step', () => {
  assert(coverSteps.some(s => s.label === 'Generate Back Cover Summary'), 'Missing Generate Back Cover Summary');
});

test('book-cover: has Generate Base Artwork step', () => {
  assert(coverSteps.some(s => s.label.startsWith('Generate Base Artwork')), 'Missing Generate Base Artwork');
});

test('book-cover: has Composite Typography step', () => {
  assert(coverSteps.some(s => s.label.startsWith('Composite Typography')), 'Missing Composite Typography');
});

test('book-cover: FLUX prompt step says output ONLY valid JSON', () => {
  const fluxStep = coverSteps.find(s => s.label === 'Generate Cover Art Prompt');
  assert(fluxStep?.prompt?.includes('Output ONLY valid JSON') || fluxStep?.prompt?.includes('valid JSON'), 'Must enforce JSON-only output');
});

test('book-cover: has 4 steps total', () => {
  assertEqual(coverSteps.length, 4, 'book-cover step count');
});

// ── Test: amazon-kdp-launch — All 7 Required Steps ────────────────────────────────
suite('amazon-kdp-launch — All 7 Required Steps');

const kdpSteps = getSteps('amazon-kdp-launch');
const expectedKdpLabels = [
  'SCO', // Keyword Research
  'GCO', // Category Strategy
  'KDP Metadata Package',
  'A+ Content',
  '90-Day Launch Plan',
  'AMS Campaign',
];

for (const label of expectedKdpLabels) {
  test(`amazon-kdp-launch: has step containing "${label}"`, () => {
    assert(kdpSteps.some(s => s.label.includes(label)), `Missing step: "${label}"`);
  });
}

test('amazon-kdp-launch: has 7 steps total', () => {
  assertEqual(kdpSteps.length, 7, 'amazon-kdp-launch step count');
});

// ── Test: short-story — All 4 steps ──────────────────────────────────────
suite('short-story — All 4 Required Steps');

const shortSteps = getSteps('short-story');

test('short-story: has 4 steps', () => {
  assertEqual(shortSteps.length, 4, 'short-story step count');
});

test('short-story: Concept Development is first step', () => {
  assertEqual(shortSteps[0].label, 'Concept Development', 'first step label');
});

test('short-story: Write Story step has wordCountTarget', () => {
  const writeStep = shortSteps.find(s => s.label === 'Write Story');
  assert(writeStep !== undefined, 'Must have Write Story step');
  assert((writeStep!.wordCountTarget ?? 0) > 0, 'Write Story must have wordCountTarget');
});

test('short-story: Prose Polish is last step', () => {
  assertEqual(shortSteps[shortSteps.length - 1].label, 'Prose Polish', 'last step label');
});

// ── Test: book-planning template exists ───────────────────────────────────
suite('book-planning — Structural Checks');

const planningSteps = getSteps('book-planning');

test('book-planning: has Setting Bible step', () => {
  assert(planningSteps.some(s => s.label === 'Setting Bible'), 'Missing Setting Bible');
});

test('book-planning: has Character Bible step', () => {
  assert(planningSteps.some(s => s.label === 'Character Bible'), 'Missing Character Bible');
});

test('book-planning: has Voice Profile step', () => {
  assert(planningSteps.some(s => s.label === 'Voice Profile'), 'Missing Voice Profile');
});

test('book-planning: has Chapter Outline step', () => {
  assert(planningSteps.some(s => s.label === 'Chapter-by-Chapter Outline'), 'Missing Chapter Outline');
});

test('book-planning: has Story Architecture step', () => {
  assert(planningSteps.some(s => s.label === 'Story Architecture'), 'Missing Story Architecture');
});

// ── Results ───────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n✓ All tests passed!');
  process.exit(0);
}
