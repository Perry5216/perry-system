/**
 * Cross-template audit — runs health checks across all registered templates.
 * Run: node --import tsx packages/tests/template-audit.test.ts
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

// ── Load templates ──────────────────────────────────────────────────────────
import { TemplateRegistry } from '../projects/src/templates.js';

const registry = new TemplateRegistry();
const allTemplates = registry.list();

// Build a context fixture
const ctx = {};

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
    const steps = t.buildSteps(ctx, 'Test Project', 'A test.');
    const empty = steps.filter(s => !s.prompt || s.prompt.trim().length === 0);
    assert(empty.length === 0, `Steps with empty prompt: ${empty.map(s => s.label).join(', ')}`);
  });
}

// ── Test: No garbled encoding artifacts in step labels or prompts ───────────
suite('All Templates — No Encoding Artifacts in Labels');

for (const t of allTemplates) {
  test(`${t.name}: no garbled chars in step labels`, () => {
    const steps = t.buildSteps(ctx, 'Test Project', 'A test.');
    const garbled = steps.filter(s => ENCODING_ARTIFACTS.some(a => s.label.includes(a)));
    assert(garbled.length === 0, `Steps with encoding artifacts in label: ${garbled.map(s => `"${s.label}"`).join(', ')}`);
  });
}

// ── Test: No garbled encoding artifacts in prompts ──────────────────────────
suite('All Templates — No Encoding Artifacts in Prompts');

for (const t of allTemplates) {
  test(`${t.name}: no garbled chars in prompts`, () => {
    const steps = t.buildSteps(ctx, 'Test Project', 'A test.');
    const garbled = steps.filter(s => ENCODING_ARTIFACTS.some(a => s.prompt?.includes(a)));
    assert(garbled.length === 0, `Steps with encoding artifacts in prompt: ${garbled.map(s => `"${s.label}"`).join(', ')}`);
  });
}

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
