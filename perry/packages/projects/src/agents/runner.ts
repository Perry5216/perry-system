/**
 * AgentRunner — generic execution engine for registered agents.
 *
 * Takes any AgentDefinition + input, runs the standard tool-loop
 * (model call → tool execution → loop until no tool calls), persists
 * the invocation + trajectory, and returns the result. Used by:
 *
 *   - DirectorAgent.chat()      (dispatch path)
 *   - step-runner (future)      (when migrating taskType handlers)
 *   - /api/agents/:id/invoke    (direct API access)
 *   - invoke_agent tool         (delegation chains — parent agent calls child)
 *
 * Persistence model: every invocation creates a row in agent_invocations
 * (status pending → running → completed|failed). On success, a derived
 * row lands in agent_trajectories — the corpus that feeds future LoRA
 * training. Outcome and quality_score start as 'success' / null; later
 * curation (manual or Claude-as-judge) refines them.
 *
 * The runner deliberately doesn't know about MCP compression, worker
 * classes, or any specific model. Those concerns are factored out:
 *   - Model resolution: agent.modelBinding (+ byPen override)
 *   - Tool surface: agent.toolACL (+ MCP compressor when wired)
 *   - Worker class: agent.modelBinding.provider (writer/librarian/etc)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { AgentDefinition, AgentInvocation, EventBus, Logger, McpClientService } from '@perry/core';
import { compressTools } from '@perry/core';
import type { AIRouter } from '@perry/ai';
import type { StateStore } from '../state-store.js';
import { listDelegatableAgents, getAgent } from './registry.js';
import { DomainRegistry } from '../services/domain-registry.js';

type ChatMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: any[];
};

/**
 * Extra tools layered on top of the MCP tool catalog for a specific
 * invocation. Used by gateways to inject context-scoped capabilities
 * (e.g. Discord mod tools that only the Discord gateway provides).
 * Not visible to other invocation paths (HTTP POST /api/agents/:id/invoke,
 * step-runner, Telegram gateway).
 */
export interface ExtraTool {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any) => Promise<any>;
}

export class AgentRunner {
  constructor(
    private router: AIRouter,
    private stateStore: StateStore,
    private mcpClient: McpClientService,
    private eventBus: EventBus,
    private log: Logger,
  ) {}

  /**
   * Run a single agent invocation. Persists everything, emits events,
   * returns the completed invocation. Throws on failure (after recording
   * the failed row).
   */
  async invoke(opts: {
    agent: AgentDefinition;
    sessionId: string;
    input: string;
    parentInvocationId?: string;
    penSlug?: string;
    /** Optional message history to seed (Director chat carries this). */
    history?: ChatMessage[];
    /** Per-invocation extra tools (gateway-scoped capabilities). NOT shared
     *  across other invocations of the same agent. */
    extraTools?: ExtraTool[];
    modelBindingOverride?: { provider: string; model?: string };
  }): Promise<AgentInvocation> {
    const { agent, sessionId, input, parentInvocationId, penSlug, modelBindingOverride } = opts;

    // Resolve the active pen slug (soul) for this agent
    let activePenSlug = penSlug;
    try {
      const rawMapping = this.stateStore.getMeta('agent_souls');
      if (rawMapping) {
        const mapping = JSON.parse(rawMapping);
        if (mapping[agent.id]) {
          activePenSlug = mapping[agent.id];
        }
      }
    } catch (err: any) {
      this.log.warn('Failed to parse agent_souls meta', { error: err.message });
    }

    // 1. Create the invocation row up front so even crashes leave a record.
    const invocationId = this.stateStore.createAgentInvocation({
      sessionId, agentId: agent.id, domain: agent.domain,
      input, parentInvocationId,
    });
    this.eventBus.emit('agent:invocation:started', { invocationId, agentId: agent.id, sessionId });
    this.stateStore.updateAgentInvocation(invocationId, { status: 'running' });
    const startedAt = Date.now();

    try {
      // 2. Resolve which model + provider this invocation uses.
      const binding = this.resolveBinding(agent, activePenSlug, modelBindingOverride);
      this.log.info('agent invocation starting', {
        invocationId, agentId: agent.id, domain: agent.domain,
        provider: binding.provider, model: binding.model || '<default>',
      });

      // 3. Render the system prompt (lightweight {{var}} substitution).
      let systemPrompt = this.renderPrompt(agent.systemPrompt, { penSlug: activePenSlug });
      if (agent.domain === 'books' && activePenSlug) {
        try {
          const workspaceDir = this.stateStore.getWorkspaceDir();
          const targetDir = join(workspaceDir, 'pens', activePenSlug);
          
          const soulPath = join(targetDir, 'SOUL.md');
          if (existsSync(soulPath)) {
            systemPrompt += `\n\n## Pen Identity (${activePenSlug})\n` + readFileSync(soulPath, 'utf-8');
          }
          const lessonsPath = join(targetDir, 'LESSONS.md');
          if (existsSync(lessonsPath)) {
            systemPrompt += `\n\n## Pen Lessons (${activePenSlug})\n` + readFileSync(lessonsPath, 'utf-8');
          }
        } catch (err: any) {
          this.log.warn('Failed to load pen profile files for runner', { penSlug: activePenSlug, error: err.message });
        }
      } else if (agent.domain !== 'books') {
        try {
          const workspaceDir = this.stateStore.getWorkspaceDir();
          const targetDir = join(workspaceDir, 'souls', 'agents', agent.id);
          
          const soulPath = join(targetDir, 'SOUL.md');
          if (existsSync(soulPath)) {
            systemPrompt += `\n\n## Agent Persona Soul (${agent.id})\n` + readFileSync(soulPath, 'utf-8');
          }
          const lessonsPath = join(targetDir, 'LESSONS.md');
          if (existsSync(lessonsPath)) {
            systemPrompt += `\n\n## Agent Lessons (${agent.id})\n` + readFileSync(lessonsPath, 'utf-8');
          }
        } catch (err: any) {
          this.log.warn('Failed to load agent soul files for runner', { agentId: agent.id, error: err.message });
        }
      }

      // 4. Build the chat sequence: optional history + user input.
      const messages: ChatMessage[] = [];
      if (opts.history) messages.push(...opts.history);
      messages.push({ role: 'user', content: input });

      // Retrieve allowed MCP servers for the agent's domain
      let allowedMcpServers: string[] | undefined;
      if (agent.domain) {
        try {
          const registry = new DomainRegistry({
            workspaceDir: this.stateStore.getWorkspaceDir(),
            log: this.log,
          });
          const domainDef = registry.get(agent.domain);
          if (domainDef && domainDef.allowedMcpServers) {
            allowedMcpServers = domainDef.allowedMcpServers;
          }
        } catch (err: any) {
          this.log.warn('Failed to load domain allowedMcpServers', { domain: agent.domain, error: err.message });
        }
      }

      // 5. Determine the agent's tool surface (ACL + compression + delegation
      //    + per-invocation extras from the gateway, if any).
      const { tools, fullSchemas } = this.resolveTools(agent, opts.extraTools, allowedMcpServers);
      const extraToolMap = new Map<string, ExtraTool>();
      for (const t of (opts.extraTools || [])) extraToolMap.set(t.name, t);

      // 6a. Workers-routing short-circuit. When the agent's modelBinding
      // provider is 'workers', we skip the local-LLM tool loop entirely
      // and dispatch the invocation to a Claude/Gemini CLI worker via
      // task_pool. The worker handles tool calls using its OWN native
      // tool surface (Read, Edit, Bash, etc. for Claude Code; Gemini's
      // equivalents), then reports back a final text result.
      //
      // Workers have access to perry's MCP tools (claim_task, report_task,
      // get_anti_patterns, etc.) but NOT to the dynamic per-agent tool
      // list that AgentRunner builds. The agent's system_prompt + the
      // user input is all the context the worker gets.
      if (binding.provider === 'workers') {
        const text = await this.dispatchToWorkers({
          agent,
          systemPrompt,
          userInput: input,
          history: opts.history,
          penSlug: activePenSlug,
          invocationId,
        });
        this.stateStore.updateAgentInvocation(invocationId, {
          status: 'completed',
          model: 'workers',
          workerClass: 'workers',
          output: text,
        });
        try {
          this.stateStore.recordAgentTrajectory({
            invocationId, agentId: agent.id, domain: agent.domain, penSlug: activePenSlug,
            workerClass: 'workers',
            model: 'workers',
            messages: [...(opts.history || []), { role: 'user', content: input }, { role: 'assistant', content: text }],
            outcome: 'success',
          });
        } catch (e: any) { this.log.warn('trajectory record failed', { error: e.message }); }
        this.eventBus.emit('agent:invocation:completed', {
          invocationId, agentId: agent.id, sessionId,
          durationMs: Date.now() - startedAt,
        });
        return {
          id: invocationId, sessionId, parentInvocationId,
          agentId: agent.id, domain: agent.domain, status: 'completed',
          model: 'workers', input, output: text, toolCalls: [],
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      }

      // 6. Tool loop. Capped by safetyCounter AND wall-clock timeout.
      let response: any = null;
      const toolCallsLog: any[] = [];
      const deadline = Date.now() + (agent.timeoutMs || 5 * 60_000);
      let safetyCounter = 0;
      const MAX_TOOL_TURNS = 6;
      // Same-tool-same-error counter: if the model calls the same tool
      // and gets the same error 3 times in a row, force-exit. Prevents
      // the model from looping forever on a tool that just won't work.
      let repeatErrorTool: string | null = null;
      let repeatErrorCount = 0;

      while (safetyCounter < MAX_TOOL_TURNS) {
        safetyCounter++;
        if (Date.now() > deadline) {
          throw new Error(`Agent ${agent.id} exceeded ${agent.timeoutMs}ms wall-clock timeout`);
        }

        // Load custom parameters from CONFIG.json if it exists
        let configParams: any = {};
        try {
          const { existsSync, readFileSync } = require('fs');
          const { join } = require('path');
          const configPath = join(this.stateStore.getWorkspaceDir(), 'souls', 'agents', agent.id, 'CONFIG.json');
          if (existsSync(configPath)) {
            const configJson = JSON.parse(readFileSync(configPath, 'utf-8'));
            if (configJson && configJson.parameters) {
              configParams = configJson.parameters;
            }
          }
        } catch {}

        response = await this.router.complete({
          provider: binding.provider,
          ...(binding.model ? { model: binding.model } : {}),
          system: systemPrompt,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          maxTokens: configParams.maxTokens || 4_096,
          temperature: typeof configParams.temperature === 'number' ? configParams.temperature : 0.7,
          ...(typeof configParams.topP === 'number' ? { topP: configParams.topP } : {}),
          ...(typeof configParams.topK === 'number' ? { topK: configParams.topK } : {}),
          ...(typeof configParams.repeatPenalty === 'number' ? { repeatPenalty: configParams.repeatPenalty } : {}),
          ...(agent.outputFormat === 'json' ? { format: agent.jsonSchema || 'json' } : {}),
        });

        if (response.toolCalls && response.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: response.text || '',
            tool_calls: response.toolCalls,
          });
          for (const tc of response.toolCalls) {
            const name = tc.function?.name;
            if (!name) continue;
            // Ollama returns tool_call arguments as an OBJECT in newer
            // builds, but the OpenAI-compatible spec says STRING. Handle
            // both — JSON.parse on a non-string throws (and used to
            // silently produce {} which made the model loop on broken
            // calls).
            let args: any = {};
            const rawArgs = tc.function.arguments;
            if (rawArgs && typeof rawArgs === 'object') {
              args = rawArgs;
            } else if (typeof rawArgs === 'string') {
              try { args = JSON.parse(rawArgs || '{}'); } catch { /* keep {} */ }
            }

            let toolResult: any;
            try {
              if (name === 'fetch_url' && binding.provider !== 'workers') {
                toolResult = await this.handleScoutBotSearch(args);
              } else if (name === 'invoke_agent') {
                toolResult = await this.handleDelegation({
                  parentAgent: agent,
                  parentInvocationId: invocationId,
                  sessionId,
                  penSlug,
                  args,
                });
              } else if (extraToolMap.has(name)) {
                // In-process gateway-scoped tool (e.g. Discord mod actions).
                toolResult = await extraToolMap.get(name)!.execute(args);
              } else if (name === 'get_tool_schema') {
                // Compressor injected this meta-tool for high/max compression
                // levels. Returns the full schema from the cached map so the
                // model can decide how to call the actual tool.
                const requestedName = (args as any).name;
                const schema = fullSchemas.get(requestedName);
                toolResult = schema
                  ? schema
                  : { error: `unknown tool: ${requestedName}`, available: Array.from(fullSchemas.keys()) };
              } else {
                const toolServer = this.mcpClient.getToolServer(name);
                if (allowedMcpServers && toolServer && !allowedMcpServers.includes(toolServer)) {
                  throw new Error(`Tool "${name}" belongs to MCP server "${toolServer}" which is not allowed in domain "${agent.domain}".`);
                }
                toolResult = await this.mcpClient.executeTool(name, args);
              }
              toolCallsLog.push({ name, arguments: args, result: toolResult });
            } catch (e: any) {
              toolResult = `Error: ${e.message}`;
              toolCallsLog.push({ name, arguments: args, error: e.message });
            }

            messages.push({
              role: 'tool',
              name,
              content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            });

            // Loop-protection: if the model keeps calling the same tool
            // and getting errors, bail out and let it write a final
            // response instead of churning.
            const resultIsError = toolResult && typeof toolResult === 'object' && toolResult.error;
            if (resultIsError && repeatErrorTool === name) {
              repeatErrorCount++;
              if (repeatErrorCount >= 3) {
                this.log.warn('aborting tool loop — same tool failing repeatedly', { agentId: agent.id, tool: name });
                messages.push({
                  role: 'tool', name,
                  content: 'AGENT_RUNNER_NOTE: This tool has failed 3 times with similar errors. Stop calling it. Reply to the user explaining what went wrong instead.',
                });
                safetyCounter = MAX_TOOL_TURNS; // force exit on next loop check
              }
            } else if (resultIsError) {
              repeatErrorTool = name;
              repeatErrorCount = 1;
            } else {
              repeatErrorTool = null;
              repeatErrorCount = 0;
            }
          }
          continue;
        }
        // No tool calls — model produced its final answer.
        break;
      }

      const finalText = response?.text || '';

      // 7. Persist completion + trajectory.
      this.stateStore.updateAgentInvocation(invocationId, {
        status: 'completed',
        model: binding.model || response?.model,
        output: finalText,
        toolCalls: toolCallsLog,
        promptTokens: response?.promptTokens,
        completionTokens: response?.completionTokens,
        costUsd: response?.cost,
      });
      try {
        this.stateStore.recordAgentTrajectory({
          invocationId, agentId: agent.id, domain: agent.domain, penSlug,
          model: binding.model || response?.model || 'unknown',
          messages, toolCalls: toolCallsLog,
          outcome: 'success',
        });
      } catch (e: any) {
        // Trajectory recording is best-effort — don't fail the invocation if it fails.
        this.log.warn('trajectory record failed', { invocationId, error: e.message });
      }

      this.eventBus.emit('agent:invocation:completed', {
        invocationId, agentId: agent.id, sessionId,
        durationMs: Date.now() - startedAt,
      });

      return {
        id: invocationId,
        sessionId,
        parentInvocationId,
        agentId: agent.id,
        domain: agent.domain,
        status: 'completed',
        model: binding.model || response?.model,
        input,
        output: finalText,
        toolCalls: toolCallsLog,
        promptTokens: response?.promptTokens,
        completionTokens: response?.completionTokens,
        costUsd: response?.cost,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    } catch (e: any) {
      this.stateStore.updateAgentInvocation(invocationId, { status: 'failed', error: e.message });
      this.eventBus.emit('agent:invocation:failed', { invocationId, agentId: agent.id, sessionId, error: e.message });
      this.log.error('agent invocation failed', { invocationId, agentId: agent.id, error: e.message });
      throw e;
    }
  }

  // ── Internals ───────────────────────────────────────────────────────

  private resolveBinding(
    agent: AgentDefinition,
    penSlug?: string,
    modelBindingOverride?: { provider: string; model?: string }
  ): { provider: string; model?: string } {
    if (modelBindingOverride) {
      const base = agent.modelBinding;
      const resolved = {
        provider: modelBindingOverride.provider,
        model: modelBindingOverride.model ?? base.model,
      };

      const ALLOWED = new Set(['writer', 'librarian', 'researcher', 'perry-agent', 'workers']);
      if (!ALLOWED.has(resolved.provider)) {
        throw new Error(
          `Agent ${agent.id} attempted to route to forbidden provider '${resolved.provider}' via override. ` +
          `Perry is configured for subscription-only mode — only local models or CLI worker ` +
          `subscriptions are allowed. Allowed providers: ${[...ALLOWED].join(', ')}.`
        );
      }

      const PROVIDER_ID_ALIAS: Record<string, string> = {
        writer: 'ollama',
      };
      if (PROVIDER_ID_ALIAS[resolved.provider]) {
        resolved.provider = PROVIDER_ID_ALIAS[resolved.provider];
      }
      return resolved;
    }

    // 2. Check if there is a meta-assigned CONFIG.json on disk for this agent
    try {
      const { existsSync, readFileSync } = require('fs');
      const { join } = require('path');
      const configPath = join(this.stateStore.getWorkspaceDir(), 'souls', 'agents', agent.id, 'CONFIG.json');
      if (existsSync(configPath)) {
        const configJson = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (configJson && configJson.modelBinding) {
          const resolved = {
            provider: configJson.modelBinding.provider || agent.modelBinding.provider,
            model: configJson.modelBinding.model ?? agent.modelBinding.model,
          };
          const ALLOWED = new Set(['writer', 'librarian', 'researcher', 'perry-agent', 'workers']);
          if (ALLOWED.has(resolved.provider)) {
            const PROVIDER_ID_ALIAS: Record<string, string> = {
              writer: 'ollama',
            };
            if (PROVIDER_ID_ALIAS[resolved.provider]) {
              resolved.provider = PROVIDER_ID_ALIAS[resolved.provider];
            }
            return resolved;
          }
        }
      }
    } catch {}

    if (agent.id === 'meta.wife-responder') {
      const wifeModeEnabled = this.router.vault.getSync('whatsapp_wife_mode_enabled') !== 'false';
      if (wifeModeEnabled) {
        const target = this.router.resolveRoutingTarget('wife_mode');
        if (target === 'librarian') {
          return {
            provider: 'librarian',
            model: 'hf.co/Ttimofeyka/MistralRP-Noromaid-NSFW-Mistral-7B-GGUF:latest',
          };
        }
        return {
          provider: target,
        };
      }
    }

    const base = agent.modelBinding;
    let resolved: { provider: string; model?: string };
    if (penSlug && base.byPen && base.byPen[penSlug]) {
      const override = base.byPen[penSlug];
      resolved = {
        provider: override.provider || base.provider,
        model: override.model ?? base.model,
      };
    } else {
      resolved = { provider: base.provider, model: base.model };
    }
    // Belt-and-suspenders enforcement of subscription-only mode. The
    // AgentDefinition type already restricts the enum, but hand-edits to
    // the registry (or a future bug that drifts byPen typing) could slip
    // a metered provider through. This guard catches it at runtime so the
    // user never gets a surprise per-token bill from an agent invocation.
    const ALLOWED = new Set(['writer', 'librarian', 'researcher', 'perry-agent', 'workers']);
    if (!ALLOWED.has(resolved.provider)) {
      throw new Error(
        `Agent ${agent.id} attempted to route to forbidden provider '${resolved.provider}'. ` +
        `Perry is configured for subscription-only mode — only local models or CLI worker ` +
        `subscriptions are allowed. Allowed providers: ${[...ALLOWED].join(', ')}.`
      );
    }
    // Translate registry-level provider names to AIRouter's internal IDs.
    // The registry uses semantic names ('writer', 'librarian', …) for
    // clarity; the router was originally built with 'ollama' as the writer
    // provider's id. This shim keeps both worlds consistent without
    // forcing a router-wide rename.
    const PROVIDER_ID_ALIAS: Record<string, string> = {
      writer: 'ollama',
      // librarian, researcher, perry-agent already match between registry
      // and router. 'workers' is special-cased separately (handled by the
      // research_assist path, not router.complete).
    };
    if (PROVIDER_ID_ALIAS[resolved.provider]) {
      resolved.provider = PROVIDER_ID_ALIAS[resolved.provider];
    }
    return resolved;
  }

  private async handleScoutBotSearch(args: any): Promise<any> {
    const { url } = args;
    if (typeof url !== 'string') {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'url parameter must be a string' }) }] };
    }

    this.log.info('Intercepted fetch_url tool call, routing to scout bot', { url });

    let query: string | null = null;
    try {
      const urlObj = new URL(url);
      for (const param of ['q', 'query', 'p', 'wd']) {
        if (urlObj.searchParams.has(param)) {
          query = urlObj.searchParams.get(param);
          break;
        }
      }
    } catch (err) {
      const match = url.match(/[?&]q=([^&]+)/);
      if (match) {
        query = decodeURIComponent(match[1].replace(/\+/g, ' '));
      }
    }

    let cmdArgs: string[];
    if (query) {
      cmdArgs = ['search', query];
    } else {
      cmdArgs = ['thread', url];
    }

    const scriptPath = '/app/workspace/scout/reddit-scraper.cjs';
    const cmdStr = `node ${scriptPath} ${cmdArgs.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ')}`;

    this.log.info('Running scout bot command', { cmdStr });

    const execPromise = promisify(exec);
    try {
      const { stdout, stderr } = await execPromise(cmdStr, { maxBuffer: 10 * 1024 * 1024 });
      if (stderr && stderr.includes('ERROR:')) {
        this.log.warn('Scout bot reported error in stderr', { stderr });
      }

      let parsedOutput: any;
      try {
        parsedOutput = JSON.parse(stdout.trim());
      } catch (e) {
        parsedOutput = { rawStdout: stdout };
      }

      const text = JSON.stringify(parsedOutput, null, 2);
      const payload = {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        text,
        truncated: false,
        htmlStripped: true,
      };

      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    } catch (error: any) {
      this.log.error('Failed to run scout bot', { error: error.message });
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Scout bot execution failed: ${error.message}` }) }] };
    }
  }

  private renderPrompt(template: string, vars: { penSlug?: string }): string {
    // Minimal {{var}} substitution. Extend as we add real variables.
    return template
      .replace(/\{\{pen_slug\}\}/g, vars.penSlug || 'a-perry')
      .replace(/\{\{pen_name\}\}/g, vars.penSlug || 'a-perry');
  }

  private resolveTools(agent: AgentDefinition, extras?: ExtraTool[], allowedMcpServers?: string[]): { tools: any[]; fullSchemas: Map<string, any> } {
    const all = this.mcpClient.getTools(allowedMcpServers);

    // Compressor handles ACL filtering + per-level transformation + optional
    // get_tool_schema injection. Per-agent compression level lives in the
    // registry (see agent.compression).
    const compressed = compressTools(all as any, agent.compression, agent.toolACL);

    let toolList = compressed.tools;

    // Layer in per-invocation extras (Discord mod tools, etc.). These ride
    // the SAME ACL pass: skipped if toolACL is a non-null array that doesn't
    // include them. Director (toolACL: null) gets everything. Code agents
    // also have null ACL so theoretically they could see these too — that's
    // fine because gateways only inject them when the invocation entrypoint
    // is the gateway itself. HTTP / step-runner paths pass no extras.
    if (extras && extras.length > 0) {
      const allowExtras = agent.toolACL === null || agent.toolACL === undefined;
      if (allowExtras) {
        for (const ex of extras) {
          toolList.push({
            type: 'function',
            function: { name: ex.name, description: ex.description, parameters: ex.parameters },
          });
          compressed.fullSchemas.set(ex.name, { name: ex.name, description: ex.description, inputSchema: ex.parameters });
        }
      }
    }

    // Append the invoke_agent meta-tool when the agent is allowed to
    // delegate. AgentRunner intercepts this name in the tool loop.
    if (agent.canDelegate) {
      const delegatable = listDelegatableAgents(agent.id);
      if (delegatable.length > 0) {
        toolList = [
          ...toolList,
          {
            type: 'function',
            function: {
              name: 'invoke_agent',
              description: 'Delegate a sub-task to another registered agent. Use when the user asks for work that fits a specialised agent (e.g. critiquing prose, reviewing code, drafting an email).',
              parameters: {
                type: 'object',
                properties: {
                  agent_id: {
                    type: 'string',
                    enum: delegatable.map(a => a.id),
                    description: 'Which agent to delegate to. Available: ' +
                      delegatable.map(a => `${a.id} (${a.description.split('.')[0]})`).join('; '),
                  },
                  input: {
                    type: 'string',
                    description: 'The task description to hand to the delegated agent.',
                  },
                },
                required: ['agent_id', 'input'],
              },
            },
          },
        ];
      }
    }

    this.log.debug('tool surface compressed', {
      agentId: agent.id,
      compression: agent.compression,
      toolCount: toolList.length,
      estimatedTokens: compressed.estimatedTokens,
    });

    return { tools: toolList, fullSchemas: compressed.fullSchemas };
  }

  /**
   * Dispatch an agent invocation to the CLI worker pool. Enqueues a task
   * with type 'agent_invocation' (the workers' slash command handles this
   * type), then polls task_pool until the worker reports done/failed or
   * the agent's wall-clock timeout fires.
   *
   * Coordinator auto-spawns Claude/Gemini CLI workers when there are
   * pending tasks AND the agent's auto-loop is on. Manual fire from the
   * dashboard works too.
   */
  private async dispatchToWorkers(opts: {
    agent: AgentDefinition;
    systemPrompt: string;
    userInput: string;
    history?: ChatMessage[];
    penSlug?: string;
    invocationId: string;
  }): Promise<string> {
    const payload = {
      task_kind: 'agent_invocation',
      agent_id: opts.agent.id,
      domain: opts.agent.domain,
      pen_slug: opts.penSlug || null,
      system_prompt: opts.systemPrompt,
      user_input: opts.userInput,
      history: opts.history || [],
      parent_invocation_id: opts.invocationId,
      // step_id + project_id kept null — this is a free-form agent
      // invocation, not tied to a step. The MCP report_task handler's
      // auto-inject path checks for both before completing a step, so
      // it won't accidentally complete anything.
    };
    const ids = this.stateStore.enqueueTasks('agent_invocation', [payload], opts.penSlug);
    const taskId = ids[0];
    if (!taskId) throw new Error('agent_invocation enqueue failed');

    this.log.info('agent_invocation enqueued — waiting for worker', {
      agentId: opts.agent.id, taskId,
    });
    this.eventBus.emit('agent:invocation:started', { invocationId: opts.invocationId, agentId: opts.agent.id, sessionId: '' });

    // Poll task_pool. Status transitions: open → claimed → done|failed.
    const timeoutMs = opts.agent.timeoutMs || 5 * 60_000;
    const deadline = Date.now() + timeoutMs;
    const pollMs = 3_000;
    let lastStatus = 'open';
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollMs));
      const row = (this.stateStore as any).db
        .prepare('SELECT status, result, error, claimed_by FROM task_pool WHERE id = ?')
        .get(taskId) as any;
      if (!row) throw new Error(`agent_invocation task ${taskId} vanished`);
      if (row.status !== lastStatus) {
        lastStatus = row.status;
        this.log.info('agent_invocation status', { taskId, status: row.status, worker: row.claimed_by });
      }
      if (row.status === 'done') {
        let parsed: any = {};
        try { parsed = row.result ? JSON.parse(row.result) : {}; }
        catch { parsed = { result: row.result }; }
        let text = parsed.result || parsed.output || parsed.text || (typeof parsed === 'string' ? parsed : '');
        if (!text && row.result) {
          text = row.result;
        }
        if (!text) throw new Error(`agent_invocation ${taskId} reported done but empty result`);
        return String(text);
      }
      if (row.status === 'failed') {
        throw new Error(`agent_invocation ${taskId} failed: ${row.error || 'unknown'}`);
      }
    }
    throw new Error(`agent_invocation ${taskId} timed out after ${Math.round(timeoutMs / 1000)}s — no worker reported back`);
  }

  private async handleDelegation(opts: {
    parentAgent: AgentDefinition;
    parentInvocationId: string;
    sessionId: string;
    penSlug?: string;
    args: { agent_id?: string; input?: string };
  }): Promise<any> {
    const childId = opts.args.agent_id;
    const childInput = opts.args.input;
    if (!childId || !childInput) {
      return { error: 'invoke_agent requires agent_id and input' };
    }
    const child = getAgent(childId);
    if (!child) return { error: `unknown agent: ${childId}` };
    // Recurse — same AgentRunner instance, fresh invocation row.
    const sub = await this.invoke({
      agent: child,
      sessionId: opts.sessionId,
      input: childInput,
      parentInvocationId: opts.parentInvocationId,
      penSlug: opts.penSlug,
    });
    return {
      delegated_to: childId,
      sub_invocation_id: sub.id,
      output: sub.output,
    };
  }
}
