/**
 * @perry/tests — Multi-Service Skills System Integration Test
 *
 * Verifies that:
 * 1. SkillEvaluator correctly evaluates trigger conditions (exact, wildcard, regex/substring).
 * 2. StandardLlmRunner dynamically applies retry_override when a matching failure is hit.
 * 3. scanLeaks filters out ignored leak tags based on matching audit skills.
 * 4. GarbageCollector dynamically computes tightened TTLs when GC skills match.
 *
 * Run: node --import tsx packages/tests/multi-service-skills.test.ts
 */

import { rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AbilityEvaluator, loadInstalledAbilities } from '../core/src/index.js';
import { scanLeaks } from '../projects/src/voice-screens.js';
import { GarbageCollector } from '../dashboard-api/src/services/garbage-collector.js';
import { StandardLlmRunner } from '../projects/src/runners/StandardLlmRunner.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];
const testPromises: Promise<void>[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  const p = (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      failed++;
      failures.push(`${name}: ${err.message}`);
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
      if (err.stack) {
        console.log(err.stack);
      }
    }
  })();
  testPromises.push(p);
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertEqual(actual: any, expected: any, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const mockLog = {
  info: () => {},
  warn: () => {},
  error: (msg: string, meta?: any) => { console.error(`ERROR: ${msg}`, meta); },
  debug: () => {},
  child: () => mockLog,
} as any;

function createTempWorkspace(): string {
  const systemTemp = tmpdir();
  const dir = mkdtempSync(join(systemTemp, 'perry-abilities-test-'));
  mkdirSync(join(dir, 'abilities-installed'), { recursive: true });
  mkdirSync(join(dir, 'abilities-pending'), { recursive: true });
  mkdirSync(join(dir, 'abilities-archived'), { recursive: true });
  return dir;
}

console.log('\n─── Multi-Service Abilities System Tests ───');

// ═══════════════════════════════════════════════════════════
// Test 1: SkillEvaluator trigger condition evaluation
// ═══════════════════════════════════════════════════════════

test('AbilityEvaluator evaluates exact, wildcard, and regex matches', () => {
  const abilities = [
    {
      name: 'exact-match',
      appliesWhen: { task_type: 'creative_writing', pen_slug: 'pen-1' },
      frontmatter: {},
    },
    {
      name: 'wildcard-match',
      appliesWhen: { task_type: '*', pen_slug: 'pen-1' },
      frontmatter: {},
    },
    {
      name: 'regex-match',
      appliesWhen: { error_fingerprint: 'Timeout.*occurred' },
      frontmatter: {},
    },
    {
      name: 'substring-match',
      appliesWhen: { error_fingerprint: 'Timeout' },
      frontmatter: {},
    },
    {
      name: 'no-match',
      appliesWhen: { task_type: 'scout' },
      frontmatter: {},
    }
  ] as any[];

  // 1. Matches exact and wildcard
  const matched1 = AbilityEvaluator.evaluate(abilities, { task_type: 'creative_writing', pen_slug: 'pen-1' });
  assertEqual(matched1.length, 2, 'matched count 1');
  assert(matched1.some(s => s.name === 'exact-match'), 'exact-match matches');
  assert(matched1.some(s => s.name === 'wildcard-match'), 'wildcard-match matches');

  // 2. Matches regex and substring
  const matched2 = AbilityEvaluator.evaluate(abilities, { error_fingerprint: 'A Timeout has occurred in the API' });
  assertEqual(matched2.length, 2, 'matched count 2');
  assert(matched2.some(s => s.name === 'regex-match'), 'regex-match matches');
  assert(matched2.some(s => s.name === 'substring-match'), 'substring-match matches');
});

// ═══════════════════════════════════════════════════════════
// Test 2: StandardLlmRunner retry override consumption
// ═══════════════════════════════════════════════════════════

test('StandardLlmRunner applies retry_override when a failure skill matches', async () => {
  const runner = new StandardLlmRunner();

  // Mock StepRunner context
  let completeCalls = 0;
  const mockStepRunner = {
    config: { maxRetries: 1, minResponseLength: 10 }, // default attempts: 1 + 2 = 3
    log: mockLog,
    shouldUseWorkersForResearch: () => false,
    eventBus: { emit: () => {} },
    mcpClient: { getTools: () => [] },
    costTracker: { recordCost: () => true },
    dedup: {
      deduplicateContent: (t: string) => t,
      deduplicateOutput: (t: string) => t,
    },
    sanitizer: {
      sanitize: (t: string) => t,
    },
    stateStore: {
      startStep: () => {},
      save: () => {},
      enqueueTasks: () => [],
      logAbilityExecution: () => {},
      recordTelemetry: () => {},
    },
    router: {
      config: {
        get: (key: string, def: any) => {
          if (key === 'ai.styleDna.enabled') return false;
          return def;
        }
      },
      resolveRoutingTarget: () => 'ollama',
      selectProvider: () => ({ id: 'mock-provider', name: 'Mock Provider' }),
      getOutputBudget: () => 1000,
      getRecommendedThinking: () => false,
      contextWatcher: {
        getCompressionMultiplier: () => 1.0,
        recordPromptTokens: () => {},
        getHallucinationWarning: () => null,
        getStats: () => ({ gpus: [] }),
        recordActualUsage: () => {},
      },
      complete: async () => {
        completeCalls++;
        throw new Error('API Timeout occurred');
      },
      getFallbackProvider: () => null,
    },
    promptBuilder: {
      build: async () => ({
        message: 'Mock prose content that is long enough to pass length checks.',
        budgetReport: { used: 100, remaining: 900, droppedSlots: [] }
      }),
    },
    directorAbilities: [
      {
        name: 'timeout-retry-booster',
        appliesWhen: { task_type: 'creative_writing', error_fingerprint: 'API Timeout occurred' },
        frontmatter: { retry_override: 5 },
      }
    ],
  } as any;

  const project = { id: 'p1', context: {}, steps: [{ id: 's1', status: 'pending', taskType: 'creative_writing', label: 'Chapter 1' }] } as any;
  const step = project.steps[0];

  try {
    await runner.execute(project, step, mockStepRunner);
  } catch (err: any) {
    // Assert that it completed exactly 5 attempts instead of the default 3
    assertEqual(completeCalls, 5, 'Overridden total completions attempted');
    assert(err.message.includes('failed after 5 attempts'), 'Correct failure error message');
  }
});

// ═══════════════════════════════════════════════════════════
// Test 3: scanLeaks ignore filter
// ═══════════════════════════════════════════════════════════

test('scanLeaks ignores leak tags based on matching audit abilities', () => {
  const text = 'A chill ran down her spine.';
  
  // Baseline check: should trigger spine_chill leak tag
  const baselineHits = scanLeaks(text);
  assertEqual(baselineHits.length, 1, 'baseline hits count');
  assertEqual(baselineHits[0].tag, 'spine_chill', 'baseline hit tag');

  // Set up temp workspace with an audit ability ignoring spine_chill
  const workspaceDir = createTempWorkspace();
  try {
    const auditAbilityDir = join(workspaceDir, 'abilities-installed', 'audit');
    mkdirSync(auditAbilityDir, { recursive: true });
    
    const abilityContent = `---
name: ignore-spine-chill
service: audit
applies_when:
  pen_slug: "detective-noir"
  leak_tag: "spine_chill"
action: ignore
---
Ignore spine chill clichés for detective-noir pen.
`;
    writeFileSync(join(auditAbilityDir, 'ignore-spine-chill.md'), abilityContent);

    // Run scanLeaks with workspace and matching pen slug -> should ignore tag
    const filteredHits = scanLeaks(text, workspaceDir, 'detective-noir');
    assertEqual(filteredHits.length, 0, 'filtered hits count');

    // Run scanLeaks with mismatching pen slug -> should NOT ignore tag
    const unmatchedHits = scanLeaks(text, workspaceDir, 'fantasy-epic');
    assertEqual(unmatchedHits.length, 1, 'unmatched hits count');
    assertEqual(unmatchedHits[0].tag, 'spine_chill', 'unmatched hit tag');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════
// Test 4: GarbageCollector TTL overrides
// ═══════════════════════════════════════════════════════════

test('GarbageCollector dynamically tightens TTLs based on GC abilities', () => {
  const gcAbilities = [
    {
      name: 'tighten-comfyui',
      appliesWhen: { dir_path: '/my/comfyui-output' },
      frontmatter: { suggested_ttl_action: 'tighten' },
    },
    {
      name: 'no-change',
      appliesWhen: { dir_path: '/my/scout-findings' },
      frontmatter: { suggested_ttl_action: 'ignore' },
    }
  ] as any[];

  const gc = new GarbageCollector({} as any);

  // 1. Matches and tightens comfyui output TTL by 4x
  const defaultTtl = 30 * 24 * 60 * 60 * 1000; // 30 days
  const comfyuiTtl = (gc as any).getTtl('/my/comfyui-output', defaultTtl, gcAbilities);
  assertEqual(comfyuiTtl, Math.floor(defaultTtl / 4), 'tightened comfyui TTL');

  // 2. Mismatch/No tighten -> remains default
  const scoutTtl = (gc as any).getTtl('/my/scout-findings', defaultTtl, gcAbilities);
  assertEqual(scoutTtl, defaultTtl, 'untouched scout TTL');
});

await Promise.all(testPromises);

console.log('\n═══════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n✓ All multi-service abilities tests passed successfully!');
  process.exit(0);
}
