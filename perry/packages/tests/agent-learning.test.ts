/**
 * @perry/tests — Agent Learning & Curation Test Suite
 *
 * Verifies persistent goals commands with DAG breakdowns, subgoal updates,
 * LibrarianService interactive proposals, skill merging/synthesis, and performance telemetry.
 *
 * Run: node --import tsx packages/tests/agent-learning.test.ts
 */

import { rmSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { StateStore, DirectorAgent, CuratorService, AGENT_REGISTRY } from '../projects/src/index.js';

// Force meta.director to use librarian provider during tests instead of workers to run local LLM loop
if (AGENT_REGISTRY['meta.director']) {
  AGENT_REGISTRY['meta.director'].modelBinding.provider = 'librarian';
}

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
  const dir = mkdtempSync(join(systemTemp, 'perry-learning-test-'));
  mkdirSync(join(dir, 'abilities-installed'), { recursive: true });
  mkdirSync(join(dir, 'abilities-pending'), { recursive: true });
  mkdirSync(join(dir, 'abilities-archived'), { recursive: true });
  return dir;
}

// Mock elements for DirectorAgent
const mockMcpClient = {
  getTools: () => [],
  executeTool: async () => ({ content: [] }),
} as any;

const mockContextEngine = {} as any;

// A custom mock router that responds to complete() calls dynamically
class MockAIRouter {
  public judgeCalls = 0;
  public completeCalls = 0;
  public forceCompletion = false;

  selectProvider(role: string) {
    return { id: 'mock-provider-id' };
  }

  async complete(req: any) {
    this.completeCalls++;
    const system = req.system || '';
    
    // Subgoal DAG generation request
    if (system.includes('project planning AI')) {
      return {
        text: JSON.stringify({
          subgoals: [
            { id: 'sg-1', text: 'Analyze existing codebase', dependencies: [] },
            { id: 'sg-2', text: 'Implement backend changes', dependencies: ['sg-1'] },
            { id: 'sg-3', text: 'Run and verify tests', dependencies: ['sg-2'] }
          ]
        })
      };
    }
    
    // Goal evaluation request
    if (system.includes('goal completion evaluator')) {
      this.judgeCalls++;
      const done = this.forceCompletion || this.judgeCalls >= 2;
      return {
        text: JSON.stringify({
          done,
          reason: done ? 'Mock judge says goal is accomplished!' : 'Mock judge says not finished yet.',
          subgoalUpdates: [
            { id: 'sg-1', status: 'completed' },
            { id: 'sg-2', status: done ? 'completed' : 'in_progress' },
            { id: 'sg-3', status: done ? 'completed' : 'pending' }
          ]
        })
      };
    }
    
    // Skill Curation review request
    if (system.includes('ability database curator') && !system.includes('merge two overlapping procedural abilities')) {
      return {
        text: JSON.stringify({
          redundantAbilityNames: ['redundant']
        })
      };
    }
    
    // Skill merge synthesis request
    if (system.includes('ability database curator') && system.includes('merge two overlapping procedural abilities')) {
      return {
        text: JSON.stringify({
          description: 'Synthesized skill that merges A and B capabilities.',
          body: 'This is the body of the new merged skill.'
        })
      };
    }
    
    return { text: 'Turn execution step completed.' };
  }
}

console.log('\n─── 1. Persistent Goals & Subgoal DAGs Tests ───');

await test('DirectorAgent goal slash commands and state transitions with DAGs', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();

    // Inject mocks for SQLite-dependent methods to allow running tests without SQLite
    store.createAgentSession = (opts: any) => `sess-mock-1`;
    store.listAgentSessions = (opts: any) => [];
    store.createAgentInvocation = (opts: any) => `inv-mock-1`;
    store.updateAgentInvocation = (id: string, opts: any) => {};
    store.recordAgentTrajectory = (opts: any) => {};
    store.enqueueTasks = (queue: string, tasks: any[], penSlug?: string) => [];
    const chatHistory: any[] = [];
    store.saveChatMessage = (projectId: string, role: string, content: string) => {
      chatHistory.push({ role, content });
    };
    store.getChatHistory = (projectId: string) => chatHistory;

    // Create a mock project
    const projectId = 'test-proj-1';
    const project = {
      id: projectId,
      title: 'Learning test project',
      type: 'novel',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      context: { penNameSlug: 'test-pen' },
    } as any;
    store.save(project);

    const router = new MockAIRouter();
    const director = new DirectorAgent(router as any, store, mockMcpClient, mockContextEngine, mockLog);

    // Initial check
    const r1 = await director.chat(projectId, '/goal');
    assert(r1.includes('No active goal set'), 'should print no active goal message');

    // Start goal
    const r2 = await director.chat(projectId, '/goal Complete the test layout');
    assert(r2.includes('Starting goal: "Complete the test layout"'), 'should state that it is starting the goal');

    // Wait slightly to let the loop kick off and save meta
    await new Promise(resolve => setTimeout(resolve, 50));

    const goalStr = store.getMeta('project_goal:' + projectId);
    assert(!!goalStr, 'goal state should be saved in meta');
    const goal = JSON.parse(goalStr!);
    assertEqual(goal.text, 'Complete the test layout', 'goal text');
    assertEqual(goal.status, 'active', 'goal status');
    
    // Verify subgoal DAG was generated
    assert(Array.isArray(goal.subgoals), 'subgoals should be an array');
    assertEqual(goal.subgoals.length, 3, 'subgoal count');
    assertEqual(goal.subgoals[0].id, 'sg-1', 'first subgoal id');
    assertEqual(goal.subgoals[0].text, 'Analyze existing codebase', 'first subgoal text');
    assertEqual(goal.subgoals[1].dependencies[0], 'sg-1', 'dependency of sg-2 is sg-1');

    // Pause goal
    const r3 = await director.chat(projectId, '/goal pause');
    assertEqual(r3, 'Goal execution paused.', 'pause response');
    const goalPaused = JSON.parse(store.getMeta('project_goal:' + projectId)!);
    assertEqual(goalPaused.status, 'paused', 'paused status');

    // Add manual subgoal with dependencies
    const r4 = await director.chat(projectId, '/subgoal Task 4 dep:sg-2,sg-3');
    assert(r4.includes('Added subgoal: "Task 4" (sg-4) with dependencies [sg-2, sg-3]'), 'add subgoal with deps');

    const goalWithSub = JSON.parse(store.getMeta('project_goal:' + projectId)!);
    assertEqual(goalWithSub.subgoals.length, 4, 'subgoals count');
    assertEqual(goalWithSub.subgoals[3].text, 'Task 4', 'last subgoal text');
    assertEqual(goalWithSub.subgoals[3].dependencies.length, 2, 'last subgoal dependencies count');
    assertEqual(goalWithSub.subgoals[3].dependencies[0], 'sg-2', 'dependency 1');
    assertEqual(goalWithSub.subgoals[3].dependencies[1], 'sg-3', 'dependency 2');

    // Remove subgoal
    const r6 = await director.chat(projectId, '/subgoal remove sg-1');
    assert(r6.includes('Removed subgoal: "Analyze existing codebase" (sg-1)'), 'remove subgoal by id');
    const goalAfterRemove = JSON.parse(store.getMeta('project_goal:' + projectId)!);
    assertEqual(goalAfterRemove.subgoals.length, 3, 'subgoals count after remove');
    // sg-2 had dependency on sg-1, verify it was cleaned up
    assertEqual(goalAfterRemove.subgoals[0].dependencies.length, 0, 'dependency cleaned up on sg-2');

    // Clear subgoals
    const r7 = await director.chat(projectId, '/subgoal clear');
    assertEqual(r7, 'All subgoals cleared.', 'clear subgoals');
    const goalAfterClear = JSON.parse(store.getMeta('project_goal:' + projectId)!);
    assertEqual(goalAfterClear.subgoals.length, 0, 'subgoals count after clear');

    // Clear goal
    const r8 = await director.chat(projectId, '/goal clear');
    assertEqual(r8, 'Goal cleared.', 'clear goal');
    assertEqual(store.getMeta('project_goal:' + projectId), undefined, 'meta should be cleared');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

await test('Abort token loop preemption and message preemption logic', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();

    // Inject mocks for SQLite-dependent methods to allow running tests without SQLite
    store.createAgentSession = (opts: any) => `sess-mock-2`;
    store.listAgentSessions = (opts: any) => [];
    store.createAgentInvocation = (opts: any) => `inv-mock-2`;
    store.updateAgentInvocation = (id: string, opts: any) => {};
    store.recordAgentTrajectory = (opts: any) => {};
    store.enqueueTasks = (queue: string, tasks: any[], penSlug?: string) => [];
    const chatHistory: any[] = [];
    store.saveChatMessage = (projectId: string, role: string, content: string) => {
      chatHistory.push({ role, content });
    };
    store.getChatHistory = (projectId: string) => chatHistory;

    const projectId = 'test-proj-2';
    const project = {
      id: projectId,
      title: 'Learning test project 2',
      type: 'novel',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      context: { penNameSlug: 'test-pen' },
    } as any;
    store.save(project);

    const router = new MockAIRouter();
    const director = new DirectorAgent(router as any, store, mockMcpClient, mockContextEngine, mockLog);

    // Start goal
    await director.chat(projectId, '/goal Standby execution loop');
    
    // Check it's running
    assert((director as any).activeLoops.has(projectId), 'loop should be active');

    // Normal message sent by user should pause execution
    await director.chat(projectId, 'hello director');
    
    // The active loop should be cleared and the goal paused
    assert(!(director as any).activeLoops.has(projectId), 'loop should be aborted/deleted');
    
    const goalStr = store.getMeta('project_goal:' + projectId);
    assert(!!goalStr, 'goal state should exist');
    const goal = JSON.parse(goalStr!);
    assertEqual(goal.status, 'paused', 'goal status paused after normal message');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

console.log('\n─── 2. Interactive proposals & Curation Tests ───');

const sampleSkill = `---
name: sample-skill
description: "A description of sample-skill that is long enough"
service: scout
---
This is the skill body. It does something cool.
`;

await test('CuratorService proposals creation and human approval flow', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();
    
    // Mark initialized so we proceed directly to review/proposal generation
    store.setMeta('curator_initialized', '1');

    const router = new MockAIRouter() as any;
    const curator = new CuratorService(workspaceDir, store, router, mockLog);

    // Write two skills: "keep-me" and "redundant"
    const scoutDir = join(workspaceDir, 'abilities-installed', 'scout');
    mkdirSync(scoutDir, { recursive: true });

    writeFileSync(join(scoutDir, 'keep-me.md'), `---
name: keep-me
description: "A very nice keeper skill"
service: scout
status: installed
---
Keeper body.
`, 'utf-8');

    writeFileSync(join(scoutDir, 'redundant.md'), `---
name: redundant
description: "A redundant skill to archive"
service: scout
status: installed
---
Redundant body.
`, 'utf-8');

    // Run curator pass in live mode (dryRun: false)
    const passResult = await curator.runCuratorPass({ dryRun: false, runLlmReview: true });
    
    // In our live mode with proposals enabled, it creates a proposal instead of immediately archiving
    assertEqual(passResult.seeded.length, 1, 'should seed 1 proposal');
    assertEqual(passResult.seeded[0], 'scout/redundant (proposed)', 'proposed naming matches');
    
    // Active skill is still in abilities-installed
    assert(existsSync(join(scoutDir, 'redundant.md')), 'redundant skill should not be deleted yet');
    
    // Let's verify proposal was written to store
    const proposals = store.listCuratorProposals();
    assertEqual(proposals.length, 1, 'should have 1 proposal in database');
    assertEqual(proposals[0].ability_name, 'redundant', 'proposed skill name');
    assertEqual(proposals[0].action, 'archive', 'proposed action');
    assertEqual(proposals[0].status, 'pending', 'initial status');

    // Operator approves the proposal (triggers actual archive)
    const proposalId = proposals[0].id;
    await curator.applyProposal(proposalId);

    // Verify it is moved to abilities-archived and has status: archived
    assert(!existsSync(join(scoutDir, 'redundant.md')), 'removed from active after approval');
    const archivedPath = join(workspaceDir, 'abilities-archived', 'scout', 'redundant.md');
    assert(existsSync(archivedPath), 'exists in archived directory');
    
    const archivedContent = readFileSync(archivedPath, 'utf-8');
    assert(archivedContent.includes('status: archived'), 'updated status in archived file');

    // Verify proposal status in database updated to executed
    const updatedProps = store.listCuratorProposals();
    assertEqual(updatedProps[0].status, 'executed', 'proposal status executed');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

console.log('\n─── 3. Skill Merge/Synthesis Tests ───');

await test('CuratorService ability merge/synthesis process', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();

    const router = new MockAIRouter() as any;
    const curator = new CuratorService(workspaceDir, store, router, mockLog);

    const scoutDir = join(workspaceDir, 'abilities-installed', 'scout');
    mkdirSync(scoutDir, { recursive: true });
    
    const pathA = join(scoutDir, 'skillA.md');
    const pathB = join(scoutDir, 'skillB.md');
    
    writeFileSync(pathA, `---
name: skillA
description: "Skill A description"
service: scout
status: installed
---
Body A
`, 'utf-8');

    writeFileSync(pathB, `---
name: skillB
description: "Skill B description"
service: scout
status: installed
---
Body B
`, 'utf-8');

    // Run merge
    await curator.mergeAbilities('scout', 'skillA', 'skillB', 'mergedSkill');

    // Verify original files deleted
    assert(!existsSync(pathA), 'skillA file should be deleted');
    assert(!existsSync(pathB), 'skillB file should be deleted');

    // Verify merged file created
    const pathNew = join(scoutDir, 'mergedSkill.md');
    assert(existsSync(pathNew), 'merged file should be created');
    
    const mergedContent = readFileSync(pathNew, 'utf-8');
    assert(mergedContent.includes('name: mergedSkill'), 'merged name in frontmatter');
    assert(mergedContent.includes('description: Synthesized skill that merges A and B capabilities.'), 'merged description');
    assert(mergedContent.includes('This is the body of the new merged skill.'), 'merged body');

    // Verify backup was created
    const backups = await curator.listBackups();
    assertEqual(backups.length, 1, '1 backup should be created');
    assertEqual(backups[0].action, 'curator_merge', 'backup action matches');
    assertEqual(backups[0].abilities.length, 2, 'backup covers both merged skills');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

console.log('\n─── 4. Skill Performance Telemetry Tests ───');

await test('StateStore telemetry logging and aggregated stats queries', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new StateStore(workspaceDir, mockLog);
    await store.initialize();

    // Log some telemetry records
    store.logAbilityExecution('scout', 'search-patterns', true, 120);
    store.logAbilityExecution('scout', 'search-patterns', true, 80);
    store.logAbilityExecution('scout', 'search-patterns', false, 250, 'Timeout occurred');
    store.logAbilityExecution('scout', 'extract-data', true, 50);

    // List telemetry history
    const history = store.listAbilityTelemetry(50);
    assertEqual(history.length, 4, 'should return all 4 items');
    assertEqual(history[0].ability_name, 'extract-data', 'most recent first');
    assertEqual(history[0].success, 1, 'success representation');
    assertEqual(history[1].error, 'Timeout occurred', 'error saved');

    // Query success rate for search-patterns
    const statsPatterns = store.getAbilitySuccessRate('scout', 'search-patterns');
    assertEqual(statsPatterns.total, 3, 'total runs for search-patterns');
    assert(Math.abs(statsPatterns.successRate - 0.6666) < 0.01, `success rate should be 2/3, got ${statsPatterns.successRate}`);
    assertEqual(statsPatterns.avgDurationMs, 150, 'average duration (120+80+250)/3 = 150');

    // Query success rate for non-existent skill
    const statsNone = store.getAbilitySuccessRate('scout', 'unknown');
    assertEqual(statsNone.total, 0, 'zero runs for unknown');
    assertEqual(statsNone.successRate, 0, 'zero success rate');

  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════
// Results Summary
// ═══════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n✓ All tests passed successfully!');
  process.exit(0);
}
