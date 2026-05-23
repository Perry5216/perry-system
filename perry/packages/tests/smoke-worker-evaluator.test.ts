import { StateStore, StepRunner } from '../projects/src/index.js';
import { rmSync } from 'fs';
import { mockLog, createTempWorkspace, mockEventBus, mockMcpClient, mockStateStoreDb } from './test-helpers.js';

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

console.log('\n─── Worker-Evaluator Loop Smoke Test ───');

await test('Worker-Evaluator validation success with resilient JSON parsing', async () => {
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

    // Mock the DB preparation & response for polling task_pool (with Markdown ticks + trailing comma JSON)
    mockStateStoreDb(store, () => ({
      status: 'done',
      result: '```json\n{\n  "approved": true,\n}\n```',
    }));

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

    store.save(project);

    const result = await runner.execute(project, step);
    assertEqual(result, 'Worker draft output content.', 'Final output');
    
    const updatedProj = store.get(project.id);
    const updatedStep = updatedProj?.steps.find(s => s.id === step.id);
    assertEqual(updatedStep?.status, 'completed', 'Step final status');
    assertEqual(updatedStep?.ticket?.proof.currentIteration, 1, 'Final iteration count');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

await test('Worker-Evaluator state persistence across attempts', async () => {
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

    // Mock evaluator to reject first attempt, but approve on second
    let evalCalls = 0;
    mockStateStoreDb(store, () => {
      evalCalls++;
      return {
        status: 'done',
        result: JSON.stringify({ approved: evalCalls > 1 }),
      };
    });

    // Mock router
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
        return {
          text: 'Worker content.',
          tokensUsed: 10,
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
      label: 'Persisted Step',
      taskType: 'analysis',
      prompt: 'Retry intro.',
      status: 'pending',
      ticket: {
        order: { category: 'analysis', objective: 'Retry intro.' },
        proof: { baselineState: 'None', currentIteration: 0 },
        boundary: { inScope: [], outOfScope: [], rules: [] },
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

    store.save(project);

    await runner.execute(project, step);

    const updatedProj = store.get(project.id);
    const updatedStep = updatedProj?.steps.find(s => s.id === step.id);
    assertEqual(updatedStep?.status, 'completed', 'Step final status');
    assertEqual(updatedStep?.ticket?.proof.currentIteration, 2, 'Iterations required');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

await test('Worker-Evaluator step-level token budget enforcement', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();

    store.createAgentSession = () => `sess-eval-mock`;
    store.createAgentInvocation = () => `inv-eval-mock`;
    store.updateAgentInvocation = () => {};
    store.recordAgentTrajectory = () => {};
    store.getMeta = () => null;
    store.enqueueTasks = () => ['task-123'];

    // Mock evaluator to always reject (if we get there)
    mockStateStoreDb(store, () => ({
      status: 'done',
      result: JSON.stringify({ approved: false, failureLogs: 'Fails.' }),
    }));

    // Mock router to return a massive token usage
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
        return {
          text: 'Too long.',
          tokensUsed: 5000,
          promptTokens: 2500,
          completionTokens: 2500,
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
      label: 'Budget Step',
      taskType: 'analysis',
      prompt: 'Short intro.',
      status: 'pending',
      ticket: {
        order: { category: 'analysis', objective: 'Short intro.' },
        proof: { baselineState: 'None' },
        boundary: { inScope: [], outOfScope: [], rules: [] },
        budget: { maxIterations: 3, tokenLimit: 1000 }, // Budget is only 1000 tokens!
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

    store.save(project);

    let threwError = false;
    try {
      await runner.execute(project, step);
    } catch (err: any) {
      threwError = true;
      assert(err.message.includes('Worker-Evaluator Loop failed after'), 'Error message type');
    }
    assert(threwError, 'Should abort early due to token limit');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

await test('Worker-Evaluator fallback strategy - switch provider', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();

    store.createAgentSession = () => `sess-eval-mock`;
    store.createAgentInvocation = () => `inv-eval-mock`;
    store.updateAgentInvocation = () => {};
    store.recordAgentTrajectory = () => {};
    store.getMeta = () => null;
    store.enqueueTasks = () => ['task-123'];

    // Mock evaluator to always reject
    mockStateStoreDb(store, () => ({
      status: 'done',
      result: JSON.stringify({ approved: false, failureLogs: 'Formatting error.' }),
    }));

    // Mock router
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
        return {
          text: 'Failing worker.',
          tokensUsed: 10,
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
      label: 'Switch Provider Step',
      taskType: 'analysis',
      prompt: 'Toggle.',
      status: 'pending',
      ticket: {
        order: { category: 'analysis', objective: 'Toggle.' },
        proof: { baselineState: 'None' },
        boundary: { inScope: [], outOfScope: [], rules: [] },
        budget: { maxIterations: 2, tokenLimit: 10000 },
        fallback: { strategy: 'switch-provider', escalationTarget: 'meta.director' },
      },
    } as any;

    const project = {
      id: 'proj-1',
      title: 'Smoke Test Project',
      status: 'active',
      preferredProvider: 'ollama',
      steps: [step],
      context: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any;

    store.save(project);

    let threwError = false;
    try {
      await runner.execute(project, step);
    } catch (err: any) {
      threwError = true;
      assert(err.message.includes('Worker-Evaluator Loop failed after switching provider twice'), 'Error after 2 switches');
    }
    assert(threwError, 'Should fail after exhausting switcher budget');

    const updatedProj = store.get(project.id);
    assertEqual(updatedProj?.preferredProvider, 'ollama', 'Switched preferred provider back to ollama');

    const updatedStep = updatedProj?.steps.find(s => s.id === step.id);
    const logs = updatedStep?.ticket?.proof.failureLogs || '';
    assert(logs.includes('[Fallback]: Switched provider to workers'), 'Logged first switch');
    assert(logs.includes('[Fallback]: Switched provider to ollama'), 'Logged second switch');

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
