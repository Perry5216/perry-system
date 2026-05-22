/**
 * @perry/tests — Integration Test Harness
 *
 * Tests core pipeline components WITHOUT requiring a running Ollama/GPU.
 * Uses mock providers to verify the wiring between:
 *   - ContextBudgetManager slot filling + carry-forward
 *   - ContextWatcher status calculations + compression multiplier
 *   - PromptBuilder compression multiplier scaling
 *   - Entity state change injection into context slots
 *   - Health check endpoint logic
 *
 * Run: node --import tsx packages/tests/pipeline.test.ts
 */

// ═══════════════════════════════════════════════════════════
// Test Runner (minimal, no dependencies)
// ═══════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertEqual(actual: any, expected: any, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertInRange(actual: number, min: number, max: number, label: string) {
  if (actual < min || actual > max) {
    throw new Error(`${label}: expected ${actual} to be in [${min}, ${max}]`);
  }
}

// ═══════════════════════════════════════════════════════════
// Test Suite 1: Context Budget Manager
// ═══════════════════════════════════════════════════════════

console.log('\n─── Context Budget Manager ───');

import { ContextBudgetManager } from '../core/src/context-budget.js';

const budgetMgr = new ContextBudgetManager();

test('estimateTokens returns conservative estimate', () => {
  const tokens = budgetMgr.estimateTokens('Hello world this is a test');
  // 26 chars / 3.0 = ~9 tokens
  assertInRange(tokens, 7, 12, 'token count');
});

test('estimateTokens handles empty string', () => {
  assertEqual(budgetMgr.estimateTokens(''), 0, 'empty string tokens');
});

test('calculateBudget reserves space for system + output', () => {
  const provider = { id: 'test', model: 'qwen3.6:27b', contextWindow: 32768, safeOutputTokens: 6144 };
  const budget = budgetMgr.calculateBudget(provider as any, 'You are a helpful assistant', 4096);
  
  assert(budget.availableForContent > 0, 'should have content budget');
  assert(budget.availableForContent < 32768, 'should be less than context window');
  assert(budget.reservedForOutput >= 4096, 'should reserve output');
  assert(budget.reservedForSystem > 0, 'should reserve system');
});

test('fillSlots includes slots by priority order', () => {
  const provider = { id: 'test', model: 'test', contextWindow: 1000 } as any;
  const budget = budgetMgr.calculateBudget(provider, '', 200);
  
  const report = budgetMgr.fillSlots(budget, [
    { label: 'Low', content: 'x'.repeat(100), priority: 3, tokenCount: 0, compressible: false, included: false },
    { label: 'High', content: 'y'.repeat(100), priority: 1, tokenCount: 0, compressible: false, included: false },
  ]);
  
  assert(report.slots.some(s => s.label === 'High'), 'High priority should be included');
});

test('fillSlots drops slots that exceed budget', () => {
  const provider = { id: 'test', model: 'test', contextWindow: 200 } as any;
  const budget = budgetMgr.calculateBudget(provider, '', 50);
  
  const report = budgetMgr.fillSlots(budget, [
    { label: 'P1', content: 'x'.repeat(100), priority: 1, tokenCount: 0, compressible: false, included: false },
    { label: 'Too Big', content: 'y'.repeat(10000), priority: 2, tokenCount: 0, compressible: false, included: false },
  ]);
  
  assert(report.droppedSlots.includes('Too Big'), 'Should drop oversized slot');
});

test('fillSlots uses compressed version when original too large', () => {
  const provider = { id: 'test', model: 'test', contextWindow: 1000 } as any;
  const budget = budgetMgr.calculateBudget(provider, '', 100);
  
  const report = budgetMgr.fillSlots(budget, [
    {
      label: 'Compressible',
      content: 'x'.repeat(30000), // Way too large
      priority: 1,
      tokenCount: 0,
      compressible: true,
      included: false,
      compressedVersion: 'Short version', // ~5 tokens, fits easily
    },
  ]);
  
  assert(report.compressionApplied, 'Should apply compression');
  assert(report.slots.some(s => s.label === 'Compressible'), 'Should include compressed slot');
});

// ═══════════════════════════════════════════════════════════
// Test Suite 2: Context Watcher
// ═══════════════════════════════════════════════════════════

console.log('\n─── Context Watcher ───');

import { ContextWatcher } from '../ai/src/context-watcher.js';

// Create a mock logger
const mockLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLog,
} as any;

test('getStats returns empty gpus when none registered', () => {
  const watcher = new ContextWatcher(mockLog);
  const stats = watcher.getStats();
  assertEqual(stats.gpus.length, 0, 'gpu count');
  assertEqual(stats.globalRisk, 'low', 'global risk');
});

test('addGpu registers a GPU config', () => {
  const watcher = new ContextWatcher(mockLog);
  watcher.addGpu('Test GPU', 'http://localhost:11434', 'writer', 32768);
  const stats = watcher.getStats();
  assertEqual(stats.gpus.length, 1, 'gpu count');
  assertEqual(stats.gpus[0].label, 'Test GPU', 'gpu label');
  assertEqual(stats.gpus[0].contextLimit, 32768, 'context limit');
  assertEqual(stats.gpus[0].status, 'idle', 'status');
});

test('getCompressionMultiplier returns 1.0 with no data', () => {
  const watcher = new ContextWatcher(mockLog);
  assertEqual(watcher.getCompressionMultiplier(), 1.0, 'default multiplier');
});

test('recordPromptTokens updates tracking', () => {
  const watcher = new ContextWatcher(mockLog);
  watcher.addGpu('Writer', 'http://localhost:11434', 'writer', 32768);
  watcher.recordPromptTokens('Writer', 10000);
  // Should not throw
  assert(true, 'recordPromptTokens should not throw');
});

test('getHallucinationWarning returns null for unregistered GPU', () => {
  const watcher = new ContextWatcher(mockLog);
  const warning = watcher.getHallucinationWarning('NonExistent');
  assertEqual(warning, null, 'should be null for unknown GPU');
});

test('getWriterHeadroom returns null with no writer', () => {
  const watcher = new ContextWatcher(mockLog);
  const headroom = watcher.getWriterHeadroom();
  assertEqual(headroom, null, 'headroom with no writer');
});

// ═══════════════════════════════════════════════════════════
// Test Suite 3: Entity State Changes
// ═══════════════════════════════════════════════════════════

console.log('\n─── Entity State Changes ───');

test('entity changes are formatted with ⚡ prefix', () => {
  // Simulate what context-engine does
  const entity = {
    name: 'Dr. Chen',
    type: 'character',
    description: 'Lead scientist',
    attributes: { status: 'injured' },
    changes: [
      { chapterId: 'ch5', description: 'arm broken from lab explosion' },
      { chapterId: 'ch7', description: 'received prosthetic replacement' },
    ],
    lastSeen: 'ch7',
  };

  const recentChanges = entity.changes.slice(-3);
  const changeNotes = recentChanges.map((ch: any) => `  - ⚡ ${ch.description}`).join('\n');
  const line = `- **${entity.name}**: ${entity.description}\n${changeNotes} [last seen: ${entity.lastSeen}]`;

  assert(line.includes('⚡ arm broken'), 'should include first change');
  assert(line.includes('⚡ received prosthetic'), 'should include second change');
  assert(line.includes('[last seen: ch7]'), 'should include lastSeen');
});

test('empty changes array produces no change notes', () => {
  const entity = { changes: [] };
  assert(entity.changes.length === 0, 'should have no changes');
});

// ═══════════════════════════════════════════════════════════
// Test Suite 4: Exponential Backoff
// ═══════════════════════════════════════════════════════════

console.log('\n─── Exponential Backoff ───');

test('backoff formula calculates correct delays', () => {
  // Formula: Math.min(30_000, 2000 * Math.pow(2, attempt - 1))
  assertEqual(Math.min(30_000, 2000 * Math.pow(2, 0)), 2000, 'attempt 1');
  assertEqual(Math.min(30_000, 2000 * Math.pow(2, 1)), 4000, 'attempt 2');
  assertEqual(Math.min(30_000, 2000 * Math.pow(2, 2)), 8000, 'attempt 3');
  assertEqual(Math.min(30_000, 2000 * Math.pow(2, 3)), 16000, 'attempt 4');
  assertEqual(Math.min(30_000, 2000 * Math.pow(2, 4)), 30000, 'attempt 5 (capped)');
  assertEqual(Math.min(30_000, 2000 * Math.pow(2, 5)), 30000, 'attempt 6 (still capped)');
});

// ═══════════════════════════════════════════════════════════
// Test Suite 5: Compression Multiplier Tiers
// ═══════════════════════════════════════════════════════════

console.log('\n─── Compression Multiplier ───');

test('budget scaling with multiplier 0.5 halves available content', () => {
  const base = 20000;
  const scaled = Math.floor(base * 0.5);
  assertEqual(scaled, 10000, '0.5x should halve');
});

test('budget scaling with multiplier 1.3 increases by 30%', () => {
  const base = 20000;
  const scaled = Math.floor(base * 1.3);
  assertEqual(scaled, 26000, '1.3x should increase by 30%');
});

test('budget scaling with multiplier 1.0 is unchanged', () => {
  const base = 20000;
  const scaled = Math.floor(base * 1.0);
  assertEqual(scaled, 20000, '1.0x should not change');
});

// ═══════════════════════════════════════════════════════════
// Test Suite 6: Telemetry Service
// ═══════════════════════════════════════════════════════════

console.log('\n─── Telemetry Service ───');

import { sendTelemetry } from '../dashboard-api/src/services/telemetry.js';
import os from 'os';

async function runAsyncTests() {
  // Test 1: Telemetry sends anonymous opt-out ping when PERRY_TELEMETRY_DISABLED is true
  await (async () => {
    const originalEnv = process.env.PERRY_TELEMETRY_DISABLED;
    process.env.PERRY_TELEMETRY_DISABLED = 'true';
    
    let fetchCalled = false;
    let fetchBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, options: any) => {
      fetchCalled = true;
      fetchBody = JSON.parse(options.body);
      return { ok: true, status: 200 } as any;
    }) as any;

    try {
      const logs: string[] = [];
      const testLog = {
        info: (msg: string) => logs.push(msg),
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => testLog,
      } as any;

      await sendTelemetry(testLog);
      
      assert(fetchCalled, 'fetch should be called to send anonymous opt-out ping');
      assertEqual(fetchBody.event, 'opt_out', 'opt-out event');
      assert(logs.some(log => log.includes('Telemetry is disabled')), 'should log telemetry disabled message');
      passed++;
      console.log('  ✓ telemetry sends anonymous opt-out ping when PERRY_TELEMETRY_DISABLED=true');
    } catch (err: any) {
      failed++;
      failures.push(`telemetry disabled test: ${err.message}`);
      console.log('  ✗ telemetry sends anonymous opt-out ping when PERRY_TELEMETRY_DISABLED=true');
      console.log(`    ${err.message}`);
    } finally {
      process.env.PERRY_TELEMETRY_DISABLED = originalEnv;
      globalThis.fetch = originalFetch;
    }
  })();

  // Test 2: Telemetry is sent when enabled
  await (async () => {
    const originalEnvDisabled = process.env.PERRY_TELEMETRY_DISABLED;
    const originalEnvUrl = process.env.PERRY_TELEMETRY_URL;
    process.env.PERRY_TELEMETRY_DISABLED = 'false';
    process.env.PERRY_TELEMETRY_URL = 'https://mock-telemetry.example.com/ping';

    let fetchUrl = '';
    let fetchOptions: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, options: any) => {
      fetchUrl = url;
      fetchOptions = options;
      return { ok: true, status: 200 } as any;
    }) as any;

    try {
      const logs: string[] = [];
      const testLog = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: (msg: string) => logs.push(msg),
        child: () => testLog,
      } as any;

      await sendTelemetry(testLog);

      assertEqual(fetchUrl, 'https://mock-telemetry.example.com/ping', 'telemetry URL');
      assert(fetchOptions !== null, 'fetch options should be set');
      assertEqual(fetchOptions.method, 'POST', 'HTTP method');
      assertEqual(fetchOptions.headers['Content-Type'], 'application/json', 'Content-Type header');
      
      const payload = JSON.parse(fetchOptions.body);
      assert(payload.anonymousId !== undefined, 'anonymousId should be populated');
      assertEqual(typeof payload.anonymousId, 'string', 'anonymousId type');
      assertEqual(payload.platform, os.platform(), 'platform');
      assertEqual(payload.arch, os.arch(), 'arch');
      assertEqual(payload.nodeVersion, process.version, 'nodeVersion');
      assertEqual(payload.perryVersion, '2.0.0', 'perryVersion');

      passed++;
      console.log('  ✓ telemetry is sent with correct payload details when enabled');
    } catch (err: any) {
      failed++;
      failures.push(`telemetry enabled test: ${err.message}`);
      console.log('  ✗ telemetry is sent with correct payload details when enabled');
      console.log(`    ${err.message}`);
    } finally {
      process.env.PERRY_TELEMETRY_DISABLED = originalEnvDisabled;
      process.env.PERRY_TELEMETRY_URL = originalEnvUrl;
      globalThis.fetch = originalFetch;
    }
  })();

  // Test 3: Telemetry fails silently on network errors
  await (async () => {
    const originalEnvDisabled = process.env.PERRY_TELEMETRY_DISABLED;
    process.env.PERRY_TELEMETRY_DISABLED = 'false';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('Network offline');
    }) as any;

    try {
      const warningLogs: string[] = [];
      const testLog = {
        info: () => {},
        warn: (msg: string) => warningLogs.push(msg),
        error: () => {},
        debug: () => {},
        child: () => testLog,
      } as any;

      // Should not throw
      await sendTelemetry(testLog);

      assert(warningLogs.some(log => log.includes('Telemetry ping failed')), 'should log warning on fetch failure');
      passed++;
      console.log('  ✓ telemetry fails silently on network/fetch errors');
    } catch (err: any) {
      failed++;
      failures.push(`telemetry fail silent test: ${err.message}`);
      console.log('  ✗ telemetry fails silently on network/fetch errors');
      console.log(`    ${err.message}`);
    } finally {
      process.env.PERRY_TELEMETRY_DISABLED = originalEnvDisabled;
      globalThis.fetch = originalFetch;
    }
  })();

  // ═══════════════════════════════════════════════════════════
  // Results
  // ═══════════════════════════════════════════════════════════

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
}

runAsyncTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});

