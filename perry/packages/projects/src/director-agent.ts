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
 * Director can dispatch to other registered agents (books.critic,
 * code.implementer, etc.) without any special-casing here.
 */

import type { EventBus, Logger, McpClientService } from '@perry/core';
import type { AIRouter } from '@perry/ai';
import type { ContextEngine } from '@perry/rag';
import type { StateStore } from './state-store.js';
import { AgentRunner } from './agents/runner.js';
import { getAgent } from './agents/registry.js';

export class DirectorAgent {
  private runner: AgentRunner;

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
      penSlug: project.context?.penNameSlug,
      title: `Director chat: ${project.title}`,
    });

    // 3. Look up the Director's registry entry.
    const director = getAgent('meta.director');
    if (!director) throw new Error('meta.director not registered — check agents/registry.ts');

    // 4. Pre-render the system prompt with project context. AgentRunner does
    //    its own {{pen_slug}} substitution; we extend that prompt here to
    //    inject the project-specific framing (title, type, description).
    const projectFraming = [
      `You are currently managing the project: "${project.title}" (type: ${project.type}).`,
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
        penSlug: project.context?.penNameSlug,
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
}
