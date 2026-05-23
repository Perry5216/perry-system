import { StateStore, StepRunner } from '../projects/src/index.js';
import { rmSync, mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
  error: () => {},
  debug: () => {},
  child: () => mockLog,
} as any;

function createTempWorkspace(): string {
  const systemTemp = tmpdir();
  const dir = mkdtempSync(join(systemTemp, 'perry-smoke-test-'));
  mkdirSync(join(dir, 'skills-installed'), { recursive: true });
  return dir;
}

const mockEventBus = {
  emit: () => {},
  on: () => {},
} as any;

const mockMcpClient = {
  getTools: () => [],
  executeTool: () => ({}),
} as any;

console.log('\n─── Worker-Evaluator Loop Smoke Test ───');

await test('Worker-Evaluator double-loop validation success', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();

    // Mock SQLite methods on store
    store.createAgentSession = () => `sess-eval-mock`;
    store.createAgentInvocation = () => `inv-eval-mock`;
    store.updateAgentInvocation = () => {};
    store.recordAgentTrajectory = () => {};
    store.getMeta = () => null;
    store.enqueueTasks = () => ['task-123'];

    // Mock the DB preparation & response for polling task_pool
    store.db = {
      prepare: (sql: string) => {
        return {
          get: (id: string) => {
            return {
              status: 'done',
              result: JSON.stringify({ approved: true }),
            };
          },
        };
      },
    } as any;

    // Mock router
    let completeCalls = 0;
    const mockRouter = {
      config: {
        get: (key: string, def: any) => def,
      },
      resolveRoutingTarget: () => 'writer',
      selectProvider: () => ({ id: 'writer', name: 'Writer', providerConfig: {} }),
      getFallbackProvider: () => null,
      contextWatcher: {
        getCompressionMultiplier: () => 1.0,
        recordPromptTokens: () => {},
        recordActualUsage: () => {},
        getHallucinationWarning: () => null,
      },
      getOutputBudget: () => 4096,
      getRecommendedThinking: () => 'low',
      complete: async (req: any) => {
        completeCalls++;
        return {
          text: 'Worker draft output content.',
          tokensUsed: 20,
          promptTokens: 20,
          completionTokens: 20,
          estimatedCost: 0,
          provider: 'writer',
        };
      },
    } as any;

    const mockPromptBuilder = {
      build: async () => ({
        message: 'Built prompt',
        budgetReport: { used: 0, remaining: 10000, slots: [], droppedSlots: [], compressionApplied: false },
      }),
    } as any;

    const runner = new StepRunner(
      mockRouter,
      store,
      mockPromptBuilder,
      mockEventBus,
      mockLog,
      { workspaceDir, maxRetries: 3, minResponseLength: 1 },
      mockMcpClient
    );

    const step = {
      id: 'step-1',
      label: 'Write Introduction',
      taskType: 'analysis',
      prompt: 'Write a beautiful intro.',
      status: 'pending',
      ticket: {
        order: { category: 'analysis', objective: 'Write a beautiful intro.' },
        proof: { baselineState: 'None' },
        boundary: { inScope: ['Intro'], outOfScope: [], rules: ['Rule 1'] },
        budget: { maxIterations: 3, tokenLimit: 10000 },
        fallback: { strategy: 'escalate', escalationTarget: 'meta.director' },
      },
    } as any;

    const project = {
      id: 'proj-1',
      title: 'Smoke Test Project',
      status: 'active',
      steps: [step],
      context: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any;

    // Save project with step to the store initially
    store.save(project);

    const result = await runner.execute(project, step);
    assertEqual(result, 'Worker draft output content.', 'Final output');
    // Worker complete = 1 call (Evaluator uses dispatchToWorkers which returns from db task_pool mock)
    assertEqual(completeCalls, 1, 'Total LLM completions');
    
    const updatedProj = store.get(project.id);
    const updatedStep = updatedProj?.steps.find(s => s.id === step.id);
    assertEqual(updatedStep?.status, 'completed', 'Step final status');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

await test('Worker-Evaluator retry and fallback escalation', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();

    // Mock SQLite methods on store
    store.createAgentSession = () => `sess-eval-mock`;
    store.createAgentInvocation = () => `inv-eval-mock`;
    store.updateAgentInvocation = () => {};
    store.recordAgentTrajectory = () => {};
    store.getMeta = () => null;
    store.enqueueTasks = () => ['task-123'];

    // Mock the DB preparation & response for polling task_pool (fails validation)
    store.db = {
      prepare: (sql: string) => {
        return {
          get: (id: string) => {
            return {
              status: 'done',
              result: JSON.stringify({ approved: false, failureLogs: 'Incorrect style.' }),
            };
          },
        };
      },
    } as any;

    // Mock router
    let completeCalls = 0;
    const mockRouter = {
      config: {
        get: (key: string, def: any) => def,
      },
      resolveRoutingTarget: () => 'writer',
      selectProvider: () => ({ id: 'writer', name: 'Writer', providerConfig: {} }),
      getFallbackProvider: () => null,
      contextWatcher: {
        getCompressionMultiplier: () => 1.0,
        recordPromptTokens: () => {},
        recordActualUsage: () => {},
        getHallucinationWarning: () => null,
      },
      getOutputBudget: () => 4096,
      getRecommendedThinking: () => 'low',
      complete: async (req: any) => {
        completeCalls++;
        return {
          text: 'Incorrect draft.',
          tokensUsed: 20,
          promptTokens: 20,
          completionTokens: 20,
          estimatedCost: 0,
          provider: 'writer',
        };
      },
    } as any;

    const mockPromptBuilder = {
      build: async () => ({
        message: 'Built prompt',
        budgetReport: { used: 0, remaining: 10000, slots: [], droppedSlots: [], compressionApplied: false },
      }),
    } as any;

    const runner = new StepRunner(
      mockRouter,
      store,
      mockPromptBuilder,
      mockEventBus,
      mockLog,
      { workspaceDir, maxRetries: 3, minResponseLength: 1 },
      mockMcpClient
    );

    const step = {
      id: 'step-1',
      label: 'Write Introduction',
      taskType: 'analysis',
      prompt: 'Write a beautiful intro.',
      status: 'pending',
      ticket: {
        order: { category: 'analysis', objective: 'Write a beautiful intro.' },
        proof: { baselineState: 'None' },
        boundary: { inScope: ['Intro'], outOfScope: [], rules: ['Rule 1'] },
        budget: { maxIterations: 3, tokenLimit: 10000 },
        fallback: { strategy: 'escalate', escalationTarget: 'meta.director' },
      },
    } as any;

    const project = {
      id: 'proj-1',
      title: 'Smoke Test Project',
      status: 'active',
      steps: [step],
      context: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any;

    // Save project with step to the store initially
    store.save(project);

    let threwError = false;
    try {
      await runner.execute(project, step);
    } catch (err: any) {
      threwError = true;
      assert(err.message.includes('Worker-Evaluator Loop failed after 3 attempts'), 'Error message match');
      assert(err.message.includes('Escalating to meta.director'), 'Escalation target message');
    }
    assert(threwError, 'Should throw fallback escalation error');
    // 3 iterations * 1 worker call = 3 calls
    assertEqual(completeCalls, 3, 'Total LLM completions on fallback');

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
  console.log('\n✓ All smoke tests passed successfully!');
  process.exit(0);
}
