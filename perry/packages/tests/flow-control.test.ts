/**
 * @perry/tests — Asynchronous Flow Control Integration Test
 *
 * Verifies that ProjectEngine:
 * 1. Serializes multiple concurrent project executions sequentially (concurrency = 1).
 * 2. Recovers interrupted "active" steps and enqueues them on boot (maintenance mode).
 *
 * Run: node --import tsx packages/tests/flow-control.test.ts
 */

import { rmSync, mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { StateStore, ProjectEngine } from '../projects/src/index.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
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
  const dir = mkdtempSync(join(systemTemp, 'perry-flow-test-'));
  mkdirSync(join(dir, 'skills-installed'), { recursive: true });
  mkdirSync(join(dir, 'skills-pending'), { recursive: true });
  mkdirSync(join(dir, 'skills-archived'), { recursive: true });
  return dir;
}

const mockRouter = {
  config: {
    get: (key: string, def: any) => def,
  },
  compressor: {},
} as any;

const mockContextEngine = {} as any;

const mockEventBus = {
  emit: () => {},
  on: () => {},
} as any;

const mockConfigService = {
  get: (path: string, defaultValue?: any) => {
    if (path === 'ai.mcpServers') return {};
    return defaultValue;
  },
  set: () => {},
  getAll: () => ({})
} as any;

console.log('\n─── Asynchronous Flow Control Integration Tests ───');

await test('Serialization: Concurrent executeAll calls are run sequentially', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();

    // Mock SQLite-dependent session/invocation tracking to avoid bindings/missing-db errors
    store.createAgentSession = () => `sess-mock`;
    store.listAgentSessions = () => [];
    store.createAgentInvocation = () => `inv-mock`;
    store.updateAgentInvocation = () => {};
    store.recordAgentTrajectory = () => {};
    store.enqueueTasks = () => [];

    // Create 3 projects, each with one step
    const p1 = {
      id: 'p-1',
      title: 'Project 1',
      type: 'novel',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [{ id: 'step-1', label: 'Step 1', taskType: 'creative_writing', status: 'pending' }],
      context: {},
    } as any;
    const p2 = {
      id: 'p-2',
      title: 'Project 2',
      type: 'novel',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [{ id: 'step-2', label: 'Step 2', taskType: 'creative_writing', status: 'pending' }],
      context: {},
    } as any;
    const p3 = {
      id: 'p-3',
      title: 'Project 3',
      type: 'novel',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [{ id: 'step-3', label: 'Step 3', taskType: 'creative_writing', status: 'pending' }],
      context: {},
    } as any;

    store.save(p1);
    store.save(p2);
    store.save(p3);

    const engine = new ProjectEngine(
      store,
      mockRouter,
      mockContextEngine,
      mockEventBus,
      mockLog,
      {
        workspaceDir,
        maxRetries: 3,
        minResponseLength: 10,
        config: mockConfigService,
        enableMaintenance: false, // skip auto-resume in this test
      }
    );

    let activeCount = 0;
    let maxConcurrent = 0;
    const order: { id: string; event: 'start' | 'end' }[] = [];

    // Mock stepRunner.executeAll to record concurrency and execution order
    (engine as any).stepRunner = {
      executeAll: async (project: any) => {
        activeCount++;
        if (activeCount > maxConcurrent) {
          maxConcurrent = activeCount;
        }
        order.push({ id: project.id, event: 'start' });

        // Simulate async GPU work taking some time
        await new Promise(resolve => setTimeout(resolve, 50));

        order.push({ id: project.id, event: 'end' });
        activeCount--;

        // Complete the step and project to finish the execution loop
        project.status = 'completed';
        project.steps[0].status = 'completed';
        store.save(project);
      },
      clearProjectState: () => {},
    };

    // Trigger executeAll concurrently
    await Promise.all([
      engine.executeAll('p-1'),
      engine.executeAll('p-2'),
      engine.executeAll('p-3'),
    ]);

    // Give queue worker time to drain all enqueued projects
    await new Promise(resolve => setTimeout(resolve, 300));

    // Assert that the maximum concurrent executions was exactly 1 (serialized)
    assertEqual(maxConcurrent, 1, 'Max concurrent executions');

    // Assert that each project starts and finishes before the next one starts
    assertEqual(order.length, 6, 'Total events in execution trace');
    assertEqual(order[0].id, 'p-1', 'First start project');
    assertEqual(order[0].event, 'start', 'First event start');
    assertEqual(order[1].id, 'p-1', 'First end project');
    assertEqual(order[1].event, 'end', 'First event end');

    assertEqual(order[2].id, 'p-2', 'Second start project');
    assertEqual(order[2].event, 'start', 'Second event start');
    assertEqual(order[3].id, 'p-2', 'Second end project');
    assertEqual(order[3].event, 'end', 'Second event end');

    assertEqual(order[4].id, 'p-3', 'Third start project');
    assertEqual(order[4].event, 'start', 'Third event start');
    assertEqual(order[5].id, 'p-3', 'Third end project');
    assertEqual(order[5].event, 'end', 'Third event end');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

await test('Boot Recovery: Orphaned steps are recovered and enqueued automatically', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();

    store.createAgentSession = () => `sess-mock`;
    store.listAgentSessions = () => [];
    store.createAgentInvocation = () => `inv-mock`;
    store.updateAgentInvocation = () => {};
    store.recordAgentTrajectory = () => {};
    store.enqueueTasks = () => [];

    // Create a project in "active" status with a step that is "active" (simulating a crash/restart)
    const pCrash = {
      id: 'p-crash',
      title: 'Crashed Project',
      type: 'novel',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [{ id: 'step-crash', label: 'Crashed Step', taskType: 'creative_writing', status: 'active', startedAt: new Date().toISOString() }],
      context: {},
    } as any;

    store.save(pCrash);

    // Assert dirty state before engine starts
    const initialProj = store.get('p-crash')!;
    assertEqual(initialProj.status, 'active', 'Initial project status');
    assertEqual(initialProj.steps[0].status, 'active', 'Initial step status');

    let executeCalledWithId: string | null = null;

    const engine = new ProjectEngine(
      store,
      mockRouter,
      mockContextEngine,
      mockEventBus,
      mockLog,
      {
        workspaceDir,
        maxRetries: 3,
        minResponseLength: 10,
        config: mockConfigService,
        enableMaintenance: true, // This triggers recoverOrphanedSteps() on boot!
      }
    );

    // Mock stepRunner immediately after construction to capture the auto-resume trigger
    (engine as any).stepRunner = {
      executeAll: async (project: any) => {
        executeCalledWithId = project.id;
        // Complete the step and project
        project.status = 'completed';
        project.steps[0].status = 'completed';
        store.save(project);
      },
      clearProjectState: () => {},
    };

    // Wait for the queue worker to process the resumed project
    await new Promise(resolve => setTimeout(resolve, 100));

    // Assert that the orphaned step/project statuses were reset to pending
    const recoveredProj = store.get('p-crash')!;
    assert(recoveredProj.steps[0].status !== 'active', 'Step status should not remain active');
    assertEqual(recoveredProj.steps[0].startedAt, undefined, 'startedAt should be cleared');

    // Assert that the engine automatically enqueued and executed the project
    assertEqual(executeCalledWithId, 'p-crash', 'Auto-resumed project execution');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

await test('Concurrency: Concurrency limit > 1 allows parallel executeNextStep operations', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();

    store.createAgentSession = () => `sess-mock`;
    store.listAgentSessions = () => [];
    store.createAgentInvocation = () => `inv-mock`;
    store.updateAgentInvocation = () => {};
    store.recordAgentTrajectory = () => {};
    store.enqueueTasks = () => [];

    const p1 = {
      id: 'p-1',
      title: 'Project 1',
      type: 'novel',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [{ id: 'step-1', label: 'Step 1', taskType: 'creative_writing', status: 'pending' }],
      context: {},
    } as any;
    const p2 = {
      id: 'p-2',
      title: 'Project 2',
      type: 'novel',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [{ id: 'step-2', label: 'Step 2', taskType: 'creative_writing', status: 'pending' }],
      context: {},
    } as any;

    store.save(p1);
    store.save(p2);

    const configMap = new Map<string, any>();
    configMap.set('gpu.concurrencyLimit', 2);
    const customConfigService = {
      get: (path: string, defaultValue?: any) => {
        if (configMap.has(path)) return configMap.get(path);
        if (path === 'ai.mcpServers') return {};
        return defaultValue;
      },
      set: (path: string, val: any) => { configMap.set(path, val); },
      getAll: () => ({})
    } as any;

    const engine = new ProjectEngine(
      store,
      mockRouter,
      mockContextEngine,
      mockEventBus,
      mockLog,
      {
        workspaceDir,
        maxRetries: 3,
        minResponseLength: 10,
        config: customConfigService,
        enableMaintenance: false,
      }
    );

    let activeCount = 0;
    let maxConcurrent = 0;
    const order: { id: string; event: 'start' | 'end' }[] = [];

    (engine as any).stepRunner = {
      execute: async (project: any, step: any) => {
        activeCount++;
        if (activeCount > maxConcurrent) {
          maxConcurrent = activeCount;
        }
        order.push({ id: project.id, event: 'start' });
        await new Promise(resolve => setTimeout(resolve, 80));
        order.push({ id: project.id, event: 'end' });
        activeCount--;

        project.status = 'completed';
        project.steps[0].status = 'completed';
        store.save(project);
        return 'mock-result';
      },
      clearProjectState: () => {},
    };

    // Trigger executeNextStep concurrently (since concurrency limit is 2, they should run in parallel)
    const run1 = engine.executeNextStep('p-1');
    const run2 = engine.executeNextStep('p-2');

    await Promise.all([run1, run2]);

    // Assert concurrency reached 2
    assertEqual(maxConcurrent, 2, 'Max concurrent executions with limit = 2');

    // Confirm both were running in parallel (both started before either ended)
    assert(order[0].event === 'start' && order[1].event === 'start', 'Both projects started in parallel');
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

console.log('\n═══════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n✓ All flow control tests passed successfully!');
  process.exit(0);
}
