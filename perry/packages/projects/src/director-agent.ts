/**
 * DirectorAgent — thin wrapper around AgentRunner for project chat.
 *
 * Originally held its own tool-loop; that loop has been generalised into
 * AgentRunner. DirectorAgent now exists to:
 *
 *   - Manage per-project chat history (saveChatMessage / getChatHistory)
 *   - Manage one open agent_session per project (created lazily, reused)
 *   - Look up the 'meta.director' agent definition from the registry and
 *     hand it to AgentRunner with the user's message + history
 *
 * The Director's `canDelegate: true` flag in the registry means
 * AgentRunner automatically adds the `invoke_agent` meta-tool, so the
 * Director can dispatch to other registered agents (code.reviewer,
 * code.implementer, etc.) without any special-casing here.
 */

import type { EventBus, Logger, McpClientService } from '@perry/core';
import type { AIRouter } from '@perry/ai';
import type { ContextEngine } from '@perry/rag';
import type { StateStore } from './state-store.js';
import { AgentRunner } from './agents/runner.js';
import { getAgent } from './agents/registry.js';

export interface Subgoal {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependencies: string[];
}

export interface GoalState {
  text: string;
  status: 'active' | 'paused' | 'completed';
  turnsUsed: number;
  subgoals: Subgoal[];
  lastJudgeReason?: string;
}

export function normalizeSubgoals(subgoals: any[]): Subgoal[] {
  if (!Array.isArray(subgoals)) return [];
  return subgoals.map((sg, index) => {
    if (typeof sg === 'string') {
      return {
        id: `sg-${index + 1}`,
        text: sg,
        status: 'pending',
        dependencies: []
      };
    }
    return {
      id: sg.id || `sg-${index + 1}`,
      text: sg.text || '',
      status: sg.status || 'pending',
      dependencies: Array.isArray(sg.dependencies) ? sg.dependencies : []
    };
  });
}

export function getNextSubgoalId(subgoals: Subgoal[]): string {
  let maxId = 0;
  for (const sg of subgoals) {
    const match = sg.id.match(/^sg-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxId) maxId = num;
    }
  }
  return `sg-${maxId + 1}`;
}

export class DirectorAgent {
  private runner: AgentRunner;
  private activeLoops = new Map<string, string>(); // projectId -> abortToken

  constructor(
    private router: AIRouter,
    private stateStore: StateStore,
    private mcpClient: McpClientService,
    private contextEngine: ContextEngine,
    private log: Logger,
    private eventBus?: EventBus,
  ) {
    // EventBus is optional for backwards-compatibility with existing callers.
    // If not provided, supply a no-op bus so AgentRunner doesn't crash on emit().
    const bus: EventBus = eventBus || ({ emit: () => {}, on: () => {}, off: () => {} } as any);
    this.runner = new AgentRunner(router, stateStore, mcpClient, bus, log.child('director-runner'));
  }

  async chat(projectId: string, message: string): Promise<string> {
    const project = this.stateStore.get(projectId);
    if (!project) throw new Error('Project not found');

    // Invalidate any active background execution loop for this project
    this.activeLoops.delete(projectId);

    const isCommand = message.startsWith('/goal') || message.startsWith('/subgoal');

    // If there is an active goal and this is NOT a goal command, pause it because the user is sending a new message
    if (!isCommand) {
      const goalStr = this.stateStore.getMeta('project_goal:' + projectId);
      if (goalStr) {
        try {
          const goal = JSON.parse(goalStr);
          if (goal.status === 'active') {
            goal.status = 'paused';
            this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(goal));
            this.stateStore.saveChatMessage(projectId, 'system', `[System: Goal execution paused by user message.]`);
          }
        } catch {}
      }
    }

    if (isCommand) {
      return this.handleGoalCommand(projectId, message);
    }

    // 1. Persist the user's message in the legacy chat history (UI reads from here).
    this.stateStore.saveChatMessage(projectId, 'user', message);

    // 2. Find or create an open session for this project. One session per
    //    project — all chat turns and their delegated sub-invocations roll
    //    under it. Future: support multiple parallel sessions per project.
    const existing = this.stateStore.listAgentSessions({ projectId, limit: 1 });
    const openSession = existing.find((s: any) => !s.closed_at);
    const sessionId = openSession?.id || this.stateStore.createAgentSession({
      domain: 'meta',
      projectId,
      penSlug: (project.context as any)?.penNameSlug,
      title: `Director chat: ${project.title}`,
    });

    // 3. Look up the Director's registry entry.
    const director = getAgent('meta.director');
    if (!director) throw new Error('meta.director not registered — check agents/registry.ts');

    // 4. Pre-render the system prompt with project context. AgentRunner does
    //    its own {{pen_slug}} substitution; we extend that prompt here to
    //    inject the project-specific framing (title, type, description).
    const projectFraming = [
      `You are currently managing the project: "${project.title}" (ID: ${project.id}, type: ${project.type}).`,
      `Description: ${project.description || '(none provided)'}`,
      '',
    ].join('\n');
    const projectAwareDirector = {
      ...director,
      systemPrompt: projectFraming + director.systemPrompt,
    };

    // 5. Build history from chat log.
    const history = this.stateStore.getChatHistory(projectId).map((h: any) => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }));
    // The user's just-saved message is in history now — pop it so it goes
    // through AgentRunner.invoke()'s `input` parameter instead.
    const last = history[history.length - 1];
    const seedHistory = (last && last.role === 'user' && last.content === message)
      ? history.slice(0, -1)
      : history;

    // 6. Invoke through AgentRunner. Persistence, tool loop, delegation,
    //    trajectory recording — all handled.
    let invocation;
    try {
      invocation = await this.runner.invoke({
        agent: projectAwareDirector,
        sessionId,
        input: message,
        penSlug: (project.context as any)?.penNameSlug,
        history: seedHistory,
      });
    } catch (e: any) {
      this.log.error('director invocation failed', { error: e.message, projectId });
      const fallback = "I'm sorry, I encountered an issue processing that request.";
      this.stateStore.saveChatMessage(projectId, 'assistant', fallback);
      return fallback;
    }

    const responseText = invocation.output || "I'm sorry, I encountered an issue processing that request.";

    // 7. Store the assistant's reply in legacy chat history so the UI sees it.
    this.stateStore.saveChatMessage(projectId, 'assistant', responseText);

    return responseText;
  }

  private async handleGoalCommand(projectId: string, message: string): Promise<string> {
    const parts = message.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1).join(' ').trim();

    if (cmd === '/goal') {
      if (!args) {
        const goalStr = this.stateStore.getMeta('project_goal:' + projectId);
        if (!goalStr) return "No active goal set. Use `/goal <text>` to start one.";
        try {
          const goal = JSON.parse(goalStr);
          goal.subgoals = normalizeSubgoals(goal.subgoals);
          const subgoalsStr = goal.subgoals.length > 0
            ? `\nSubgoals:\n${goal.subgoals.map((sg: Subgoal) => `  - ${sg.id}: ${sg.text} (status: ${sg.status}, deps: ${sg.dependencies.join(',') || 'none'})`).join('\n')}`
            : '';
          return `Current Goal: "${goal.text}"\nStatus: ${goal.status}\nTurns Used: ${goal.turnsUsed}/5${subgoalsStr}${goal.lastJudgeReason ? `\nLast Evaluation: ${goal.lastJudgeReason}` : ''}`;
        } catch {
          return "Failed to parse goal state.";
        }
      }

      if (args === 'pause') {
        const goalStr = this.stateStore.getMeta('project_goal:' + projectId);
        if (!goalStr) return "No goal set.";
        try {
          const goal = JSON.parse(goalStr);
          goal.status = 'paused';
          this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(goal));
          return "Goal execution paused.";
        } catch {
          return "Failed to update goal state.";
        }
      }

      if (args === 'resume') {
        const goalStr = this.stateStore.getMeta('project_goal:' + projectId);
        if (!goalStr) return "No goal set.";
        try {
          const goal = JSON.parse(goalStr);
          goal.status = 'active';
          this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(goal));
          
          const abortToken = Math.random().toString(36).substring(2);
          this.activeLoops.set(projectId, abortToken);
          this.runGoalLoop(projectId, abortToken).catch(err => {
            this.log.error('Goal loop failed', { projectId, error: err.message });
          });
          return "Goal execution resumed in background.";
        } catch {
          return "Failed to update goal state.";
        }
      }

      if (args === 'clear') {
        this.stateStore.removeMeta('project_goal:' + projectId);
        return "Goal cleared.";
      }

      // Start new goal with DAG generation
      const subgoals = await this.generateSubgoalDAG(args);
      const goal: GoalState = {
        text: args,
        status: 'active',
        turnsUsed: 0,
        subgoals,
      };
      this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(goal));

      const abortToken = Math.random().toString(36).substring(2);
      this.activeLoops.set(projectId, abortToken);
      this.runGoalLoop(projectId, abortToken).catch(err => {
        this.log.error('Goal loop failed', { projectId, error: err.message });
      });

      return `Starting goal: "${args}"`;
    }

    if (cmd === '/subgoal') {
      const goalStr = this.stateStore.getMeta('project_goal:' + projectId);
      if (!goalStr) return "No active goal set. Set a goal first using `/goal <text>`.";
      try {
        const goal = JSON.parse(goalStr);
        goal.subgoals = normalizeSubgoals(goal.subgoals);

        if (!args) {
          const subgoalsStr = goal.subgoals.length > 0
            ? `\nSubgoals:\n${goal.subgoals.map((sg: Subgoal) => `  - ${sg.id}: ${sg.text} (status: ${sg.status}, deps: ${sg.dependencies.join(',') || 'none'})`).join('\n')}`
            : '\nNo subgoals set.';
          return `Goal: "${goal.text}"${subgoalsStr}`;
        }

        if (args === 'clear') {
          goal.subgoals = [];
          this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(goal));
          return "All subgoals cleared.";
        }

        if (args.startsWith('remove ')) {
          const idOrIdx = args.replace('remove ', '').trim();
          const idx = parseInt(idOrIdx, 10);
          let removed: Subgoal | undefined;
          if (!isNaN(idx) && idx >= 1 && idx <= goal.subgoals.length) {
            removed = goal.subgoals.splice(idx - 1, 1)[0];
          } else {
            const foundIdx = goal.subgoals.findIndex((sg: Subgoal) => sg.id === idOrIdx);
            if (foundIdx !== -1) {
              removed = goal.subgoals.splice(foundIdx, 1)[0];
            }
          }
          if (!removed) {
            return `Subgoal not found: "${idOrIdx}"`;
          }
          for (const sg of goal.subgoals) {
            sg.dependencies = sg.dependencies.filter((dep: string) => dep !== removed!.id);
          }
          this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(goal));
          return `Removed subgoal: "${removed.text}" (${removed.id})`;
        }

        // Add subgoal with optional dependencies e.g. "My subgoal text dep:sg-1,sg-2"
        let text = args;
        let dependencies: string[] = [];
        const depMatch = args.match(/\s+dep:([a-zA-Z0-9\-_,]+)$/);
        if (depMatch) {
          dependencies = depMatch[1].split(',').map(d => d.trim()).filter(Boolean);
          text = args.substring(0, args.length - depMatch[0].length).trim();
        }

        const nextId = getNextSubgoalId(goal.subgoals);
        const newSubgoal: Subgoal = {
          id: nextId,
          text,
          status: 'pending',
          dependencies
        };
        goal.subgoals.push(newSubgoal);
        this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(goal));
        return `Added subgoal: "${text}" (${nextId})` + (dependencies.length > 0 ? ` with dependencies [${dependencies.join(', ')}]` : '');
      } catch {
        return "Failed to update subgoals.";
      }
    }

    return "Unknown command.";
  }

  private async generateSubgoalDAG(goalText: string): Promise<Subgoal[]> {
    const system = `You are a project planning AI.
Your job is to break down a main project goal into a Directed Acyclic Graph (DAG) of 3-7 subgoals.
Each subgoal must have a unique sequential ID: 'sg-1', 'sg-2', 'sg-3', etc.
Assign logical dependencies between subgoals using their IDs. For example, 'sg-2' might depend on ['sg-1'].
Ensure there are no circular dependencies.
The subgoals should cover all necessary steps, starting from setup/research to implementation and final testing/verification.

You MUST respond ONLY with a JSON object matching this schema:
{
  "subgoals": [
    {
      "id": "sg-1",
      "text": "Subgoal description",
      "dependencies": []
    },
    ...
  ]
}
Do not output any reasoning outside the JSON block.`;

    const userMessage = `Break down this project goal: "${goalText}"`;

    const formatSchema = {
      type: "object",
      properties: {
        subgoals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              text: { type: "string" },
              dependencies: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["id", "text", "dependencies"]
          }
        }
      },
      required: ["subgoals"]
    };

    try {
      const response = await this.router.complete({
        provider: this.router.selectProvider('planning').id,
        system,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 1024,
        temperature: 0.1,
        format: formatSchema
      });

      const text = response.text.trim();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        const clean = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
        parsed = JSON.parse(clean);
      }

      if (parsed && Array.isArray(parsed.subgoals)) {
        return parsed.subgoals.map((sg: any) => ({
          id: sg.id,
          text: sg.text,
          status: 'pending',
          dependencies: sg.dependencies || []
        }));
      }
    } catch (err: any) {
      this.log.error('Failed to generate subgoal DAG, using fallback', { error: err.message });
    }

    return [{
      id: 'sg-1',
      text: goalText,
      status: 'pending',
      dependencies: []
    }];
  }

  private async runGoalLoop(projectId: string, abortToken: string): Promise<void> {
    const maxTurns = 5;

    while (true) {
      if (this.activeLoops.get(projectId) !== abortToken) {
        this.log.info('Goal loop aborted: preempted or new message', { projectId });
        return;
      }

      const goalStr = this.stateStore.getMeta('project_goal:' + projectId);
      if (!goalStr) {
        this.log.info('Goal loop aborted: goal cleared', { projectId });
        return;
      }
      let goal: GoalState;
      try {
        goal = JSON.parse(goalStr);
        goal.subgoals = normalizeSubgoals(goal.subgoals);
      } catch {
        this.log.error('Goal loop aborted: failed to parse state', { projectId });
        return;
      }

      if (goal.status !== 'active') {
        this.log.info('Goal loop aborted: status is ' + goal.status, { projectId });
        return;
      }

      if (goal.turnsUsed >= maxTurns) {
        this.log.info('Goal loop stopped: reached maximum turns (' + maxTurns + ')', { projectId });
        this.stateStore.saveChatMessage(projectId, 'system', `Goal loop stopped: reached maximum turns (${maxTurns}).`);
        goal.status = 'paused';
        this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(goal));
        return;
      }

      goal.turnsUsed++;
      this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(goal));

      const subgoalsStr = goal.subgoals.length > 0
        ? `\nSubgoals:\n${goal.subgoals.map((sg) => `- ${sg.id}: ${sg.text} (status: ${sg.status}, deps: ${sg.dependencies.join(',') || 'none'})`).join('\n')}`
        : '';
      const loopPrompt = `[AUTONOMOUS LOOP - TURN ${goal.turnsUsed}/${maxTurns}]
Current Goal: "${goal.text}"${subgoalsStr}

You are executing autonomously to achieve this goal.
Evaluate what has been done so far and take the next logical step.
Use tools to implement code, run tests, or modify project files.
Do not ask for user input unless you are completely blocked and cannot proceed.
Proceed with the next step now.`;

      const project = this.stateStore.get(projectId);
      if (!project) return;
      const director = getAgent('meta.director');
      if (!director) return;

      const projectFraming = [
        `You are currently managing the project: "${project.title}" (ID: ${project.id}, type: ${project.type}).`,
        `Description: ${project.description || '(none provided)'}`,
        `ACTIVE GOAL: "${goal.text}"${subgoalsStr}`,
        `Status: Autonomous execution loop turn ${goal.turnsUsed} of ${maxTurns}.`,
        '',
      ].join('\n');

      const goalAwareDirector = {
        ...director,
        systemPrompt: projectFraming + director.systemPrompt,
      };

      const existing = this.stateStore.listAgentSessions({ projectId, limit: 1 });
      const openSession = existing.find((s: any) => !s.closed_at);
      const sessionId = openSession?.id || this.stateStore.createAgentSession({
        domain: 'meta',
        projectId,
        penSlug: (project.context as any)?.penNameSlug,
        title: `Goal loop: ${goal.text}`,
      });

      const history = this.stateStore.getChatHistory(projectId).map((h: any) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      }));

      this.log.info('Executing goal turn', { projectId, turn: goal.turnsUsed });
      this.stateStore.saveChatMessage(projectId, 'system', `[System: Starting turn ${goal.turnsUsed}/${maxTurns} for goal: "${goal.text}"]`);

      let invocation;
      try {
        invocation = await this.runner.invoke({
          agent: goalAwareDirector,
          sessionId,
          input: loopPrompt,
          penSlug: (project.context as any)?.penNameSlug,
          history,
        });
      } catch (err: any) {
        this.log.error('Goal turn invocation failed', { projectId, error: err.message });
        this.stateStore.saveChatMessage(projectId, 'system', `[System: Turn ${goal.turnsUsed} failed: ${err.message}]`);
        
        const currentGoalStr = this.stateStore.getMeta('project_goal:' + projectId);
        if (currentGoalStr) {
          try {
            const currentGoal = JSON.parse(currentGoalStr);
            currentGoal.status = 'paused';
            this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(currentGoal));
          } catch {}
        }
        return;
      }

      const responseText = invocation.output || '';
      this.stateStore.saveChatMessage(projectId, 'assistant', responseText);

      if (this.activeLoops.get(projectId) !== abortToken) {
        this.log.info('Goal loop aborted: preempted during runner execution', { projectId });
        return;
      }

      this.log.info('Running goal completion judge', { projectId });
      this.stateStore.saveChatMessage(projectId, 'system', `[System: Evaluating goal completion...]`);

      let judgeResult;
      try {
        judgeResult = await this.evaluateGoalCompletion(goal, responseText, history);
      } catch (err: any) {
        this.log.warn('Judge pass failed, continuing loop', { projectId, error: err.message });
        judgeResult = { done: false, reason: `Judge failed: ${err.message}`, subgoals: [] };
      }

      if (this.activeLoops.get(projectId) !== abortToken) {
        this.log.info('Goal loop aborted: preempted during judge execution', { projectId });
        return;
      }

      const freshGoalStr = this.stateStore.getMeta('project_goal:' + projectId);
      if (!freshGoalStr) return;
      try {
        const freshGoal = JSON.parse(freshGoalStr);
        freshGoal.subgoals = normalizeSubgoals(freshGoal.subgoals);
        freshGoal.lastJudgeReason = judgeResult.reason;

        // Apply subgoal updates from the judge
        if (Array.isArray(judgeResult.subgoals)) {
          for (const update of judgeResult.subgoals) {
            const sg = freshGoal.subgoals.find((s: Subgoal) => s.id === update.id);
            if (sg) {
              sg.status = update.status;
            }
          }
        }

        if (judgeResult.done) {
          freshGoal.status = 'completed';
          this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(freshGoal));
          this.stateStore.saveChatMessage(projectId, 'system', `[System: Goal completed! Reason: ${judgeResult.reason}]`);
          this.activeLoops.delete(projectId);
          return;
        } else {
          this.stateStore.setMeta('project_goal:' + projectId, JSON.stringify(freshGoal));
          this.stateStore.saveChatMessage(projectId, 'system', `[System: Goal not yet completed. Judge reason: ${judgeResult.reason}]`);
        }
      } catch {
        this.log.error('Goal loop aborted: failed to update judge results', { projectId });
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  private async evaluateGoalCompletion(
    goal: GoalState,
    latestOutput: string,
    history: any[]
  ): Promise<{ done: boolean; reason: string; subgoals: { id: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }[] }> {
    const system = `You are a critical project goal completion evaluator.
Your task is to judge whether the user's active goal has been fully accomplished, and to update the status of each subgoal.
Assess the goal, subgoals, and recent execution history.
Be strict: the goal is only done if all criteria are met and verified.
If it is done, explain why. If it is not done, explain what is missing.
For each subgoal, update its status ('pending' | 'in_progress' | 'completed' | 'failed') based on the execution history.
Only mark a subgoal as completed if its tasks have been fully completed and verified.
If a subgoal depends on other subgoals, ensure they are completed first, unless work has already been done on it.

You MUST respond ONLY with a JSON object matching this schema:
{
  "done": boolean,
  "reason": string,
  "subgoals": [
    { "id": "sg-1", "status": "completed" },
    ...
  ]
}
Do not output any reasoning outside the JSON block.`;

    const subgoalsStr = goal.subgoals.length > 0
      ? `Subgoals:\n${goal.subgoals.map((sg) => `- ${sg.id}: ${sg.text} (status: ${sg.status}, dependencies: [${sg.dependencies.join(', ')}])`).join('\n')}`
      : '';
    const userMessage = `Goal: "${goal.text}"
${subgoalsStr}

Latest turn output:
${latestOutput}

Analyze the latest actions. Is the goal accomplished? Please update the status of all subgoals accordingly.`;

    const formatSchema = {
      type: "object",
      properties: {
        done: { type: "boolean" },
        reason: { type: "string" },
        subgoals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed", "failed"] }
            },
            required: ["id", "status"]
          }
        }
      },
      required: ["done", "reason", "subgoals"]
    };

    const response = await this.router.complete({
      provider: this.router.selectProvider('goal_judge').id,
      system,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1024,
      temperature: 0.1,
      format: formatSchema
    });

    const text = response.text.trim();
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed.done === 'boolean' && typeof parsed.reason === 'string' && Array.isArray(parsed.subgoals)) {
        return parsed;
      }
    } catch {
      const clean = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
      try {
        const parsed = JSON.parse(clean);
        if (typeof parsed.done === 'boolean' && typeof parsed.reason === 'string' && Array.isArray(parsed.subgoals)) {
          return parsed;
        }
      } catch {}
    }
    throw new Error(`Failed to parse structured output from judge: ${text}`);
  }
}

