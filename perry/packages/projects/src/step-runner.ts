/**
 * @perry/projects — Step Runner
 *
 * Executes a single project step: builds the prompt, calls the AI,
 * saves the result, emits events. This is the atomic unit of work.
 *
 * The StepRunner delegates the actual execution to domain-specific
 * strategies using the Strategy Pattern.
 */

import type {
  Project, ProjectStep, CompletionRequest, CompletionResponse,
  EventBus, Logger, McpClientService
} from '@perry/core';
import { loadInstalledAbilities, AbilityEvaluator } from '@perry/core';
import type { AIRouter } from '@perry/ai';
import { ComfyUIService, QwenTextRenderService } from '@perry/ai';
import * as fs from 'fs';
import * as path from 'path';
import { StateStore } from './state-store.js';
import { PromptBuilder } from './prompt-builder.js';
import { PovQualityGate } from './quality-gates/pov-gate.js';
import { ContinuityGate } from './quality-gates/continuity-gate.js';
import { RevisionGate } from './quality-gates/revision-gate.js';
import { DeduplicationService } from './services/deduplication.js';
import { ProseSanitizer } from './services/prose-sanitizer.js';
import { StyleDnaService } from './services/style-dna-service.js';
import { CostTracker } from './services/cost-tracker.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { AutoLearningService } from './services/auto-learning-service.js';

import type { StepRunnerStrategy } from './runners/BaseRunner.js';
import { BookCoverRunner } from './runners/BookCoverRunner.js';
import { ResearchRunner } from './runners/ResearchRunner.js';
import { CompileRunner } from './runners/CompileRunner.js';
import { StandardLlmRunner } from './runners/StandardLlmRunner.js';
import { AgentRunner } from './agents/runner.js';
import { getAgent } from './agents/registry.js';
import { execSync } from 'child_process';

function parseResilientJson(raw: string): { approved: boolean; failureLogs?: string } {
  const trimmed = raw.trim();
  
  // Try direct parsing first
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    // ignore
  }

  // Extract from markdown code blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {
      // ignore
    }
  }

  // Try to find the first '{' and last '}'
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = trimmed.substring(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {
      // try cleaning candidate
      const cleaned = candidate
        .replace(/,\s*}/g, '}') // remove trailing commas before closing brackets
        .replace(/,\s*]/g, ']') // remove trailing commas before closing braces
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":') // enforce double quotes on keys
        .replace(/'/g, '"'); // replace single quotes with double quotes
      try {
        return JSON.parse(cleaned);
      } catch (e2) {
        // ignore
      }
    }
  }

  // Fallback to regex-based extraction
  const approvedMatch = trimmed.match(/"approved"\s*:\s*(true|false)/i);
  const logsMatch = trimmed.match(/"failureLogs"\s*:\s*"([\s\S]*?)"/i);

  if (approvedMatch) {
    return {
      approved: approvedMatch[1].toLowerCase() === 'true',
      failureLogs: logsMatch ? logsMatch[1] : undefined,
    };
  }

  throw new Error(`Could not parse JSON output from evaluator: "${raw}"`);
}

function getGitHead(workspaceDir: string): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: workspaceDir, stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function rollbackToCommit(commitHash: string, workspaceDir: string, log?: any) {
  try {
    execSync(`git reset --hard ${commitHash}`, { cwd: workspaceDir, stdio: 'pipe' });
    execSync('git clean -fd', { cwd: workspaceDir, stdio: 'pipe' });
    if (log) {
      log.info('Git rollback successful', { commitHash });
    }
  } catch (err: any) {
    if (log) {
      log.warn('Git rollback failed', { commitHash, error: err.message });
    }
  }
}

export interface StepRunnerConfig {
  workspaceDir: string;
  maxRetries: number;
  minResponseLength: number;
}

export class StepRunner {
  public router: AIRouter;
  public stateStore: StateStore;
  public promptBuilder: PromptBuilder;
  public eventBus: EventBus;
  public log: Logger;
  public config: StepRunnerConfig;
  public mcpClient: McpClientService;

  // Consumer side of producer→curator→consumer for director abilities.
  public directorAbilities: import('@perry/core').LoadedAbility[] = [];
  public directorAbilitiesLoadedAt = 0;
  public readonly DIRECTOR_ABILITIES_TTL_MS = 60_000;

  // Extracted services
  public povGate: PovQualityGate;
  public continuityGate: ContinuityGate;
  public revisionGate: RevisionGate;
  public dedup: DeduplicationService;
  public sanitizer: ProseSanitizer;
  public styleDna: StyleDnaService;
  public autoLearning: AutoLearningService;
  public costTracker: CostTracker;

  private strategies: StepRunnerStrategy[] = [];

  /** Public accessor for MCP-facing routes. */
  public getAutoLearning(): AutoLearningService { return this.autoLearning; }

  constructor(
    router: AIRouter,
    stateStore: StateStore,
    promptBuilder: PromptBuilder,
    eventBus: EventBus,
    log: Logger,
    config: StepRunnerConfig,
    mcpClient: McpClientService,
  ) {
    this.router = router;
    this.stateStore = stateStore;
    this.promptBuilder = promptBuilder;
    this.eventBus = eventBus;
    this.log = log;
    this.config = config;
    this.mcpClient = mcpClient;

    // Initialize extracted services
    const styleDna = new StyleDnaService(stateStore, log.child('style-dna'), config.workspaceDir);
    this.styleDna = styleDna;
    this.autoLearning = new AutoLearningService(config.workspaceDir, styleDna, log.child('auto-learn'), stateStore);
    this.povGate = new PovQualityGate(log.child('pov-gate'), eventBus, stateStore, styleDna);
    this.continuityGate = new ContinuityGate(log.child('continuity-gate'), eventBus, stateStore, config.workspaceDir);
    this.revisionGate = new RevisionGate(log.child('revision-gate'), eventBus, stateStore);
    this.dedup = new DeduplicationService(log.child('dedup'), eventBus);
    this.sanitizer = new ProseSanitizer();
    this.costTracker = new CostTracker(
      { maxPerProject: 0, maxGlobal: 0 },
      log.child('cost'),
      eventBus,
    );

    // Initialize strategies
    this.strategies = [
      new BookCoverRunner(),
      new ResearchRunner(),
      new CompileRunner(),
      new StandardLlmRunner(), // Default fallback strategy
    ];

    // Director self-learning event bindings
    this.attachDirectorLearningEmitter();

    // Initial load of promoted director abilities
    this.refreshDirectorAbilities();
  }

  public refreshDirectorAbilities(): void {
    try {
      this.directorAbilities = loadInstalledAbilities(this.config.workspaceDir, 'director');
      this.directorAbilitiesLoadedAt = Date.now();
      if (this.directorAbilities.length > 0) {
        this.log.info('StepRunner loaded director abilities', { count: this.directorAbilities.length });
      }
    } catch (err: any) {
      this.log.warn('refreshDirectorAbilities failed', { error: err.message });
      this.directorAbilities = [];
    }
  }

  /**
   * Look up any installed director ability that matches the current step's
   * failure context.
   */
  public findDirectorAbilityForFailure(taskType: string, errorFingerprint: string): import('@perry/core').LoadedAbility | null {
    if (Date.now() - this.directorAbilitiesLoadedAt > this.DIRECTOR_ABILITIES_TTL_MS) {
      this.refreshDirectorAbilities();
    }
    for (const s of this.directorAbilities) {
      const w = s.appliesWhen;
      if (!w) continue;
      const taskMatch = !w.task_type || w.task_type === '*' || w.task_type === taskType;
      const errMatch = !w.error_fingerprint || w.error_fingerprint === '*' || w.error_fingerprint === errorFingerprint;
      if (taskMatch && errMatch) {
        this.log.info('Director ability applied', { ability: s.name, task_type: taskType, error_fingerprint: errorFingerprint });
        this.eventBus.emit('learning:observation', {
          source: 'director',
          kind: 'ability-applied',
          fingerprint: `${s.name}::${taskType}::${errorFingerprint}`,
          value: 1,
          metadata: { ability: s.name, task_type: taskType, error_fingerprint: errorFingerprint },
        });
        return s;
      }
    }
    return null;
  }

  private attachDirectorLearningEmitter(): void {
    this.eventBus.on('step:failed', (ev: any) => {
      try {
        const { projectId, stepId, error } = ev as { projectId: string; stepId: string; error: string };
        if (!error) return;
        const taskType = this.stateStore.findStepTaskType?.(projectId, stepId) ?? 'unknown';
        this.eventBus.emit('learning:failure', {
          source: 'director',
          kind: 'step-fail',
          fingerprint: `${taskType}::${error}`,
          error,
          metadata: { taskType, stepId, projectId },
        });
      } catch (err: any) {
        this.log.warn('director learning-emit failed', { error: err.message });
      }
    });

    this.eventBus.on('step:completed', (ev: any) => {
      try {
        const { projectId, stepId } = ev as { projectId: string; stepId: string; result: string };
        const taskType = this.stateStore.findStepTaskType?.(projectId, stepId) ?? 'unknown';
        this.eventBus.emit('learning:success', {
          source: 'director',
          kind: 'step-complete',
          fingerprint: taskType,
          metadata: { stepId, projectId },
        });
      } catch (err: any) {
        this.log.warn('director learning-emit (success) failed', { error: err.message });
      }
    });
  }

  /** Cleans up any in-memory state for a project (e.g., budget carry-forward). */
  public clearProjectState(projectId: string): void {
    this.promptBuilder.clearProjectBudget(projectId);
  }

  /**
   * Execute a single step. Finds and delegates to the appropriate runner strategy.
   */
  /**
   * Execute a single step. Finds and delegates to the appropriate runner strategy.
   * Runs the double-loop Worker-Evaluator validation pattern.
   */
  async execute(project: Project, step: ProjectStep): Promise<string> {
    if (Date.now() - this.directorAbilitiesLoadedAt > this.DIRECTOR_ABILITIES_TTL_MS) {
      this.refreshDirectorAbilities();
    }

    // 1. Mark step as active
    this.stateStore.startStep(project.id, step.id);
    this.eventBus.emit('step:started', { projectId: project.id, stepId: step.id });
    this.eventBus.emit('step:progress', {
      projectId: project.id,
      stepId: step.id,
      message: `Starting: ${step.label}`,
    });

    // Ensure step has a ticket. If not, generate a default ticket wrapper.
    if (!step.ticket) {
      const gitHead = getGitHead(this.config.workspaceDir);
      step.ticket = {
        order: {
          category: step.taskType || 'generic',
          objective: step.prompt,
        },
        proof: {
          baselineState: gitHead || 'No output generated yet',
          currentIteration: 0,
        },
        boundary: {
          inScope: [step.label],
          outOfScope: [],
          rules: ['Ensure the output addresses the prompt objective precisely.'],
        },
        budget: {
          maxIterations: 3,
          tokenLimit: 20000,
        },
        fallback: {
          strategy: 'escalate',
          escalationTarget: 'meta.director',
        },
      };
    } else {
      if (step.ticket.proof.currentIteration === undefined) {
        step.ticket.proof.currentIteration = 0;
      }
      if (!step.ticket.proof.baselineState || step.ticket.proof.baselineState === 'No output generated yet') {
        const gitHead = getGitHead(this.config.workspaceDir);
        if (gitHead) {
          step.ticket.proof.baselineState = gitHead;
        }
      }
    }

    let attempts = step.ticket.proof.currentIteration || 0;
    const maxIterations = step.ticket.budget.maxIterations || 3;
    let approved = false;
    let result = '';

    // Step-level token & cost tracking wrapper for router.complete
    const originalComplete = this.router.complete.bind(this.router);
    let stepCost = 0;
    let stepTokens = 0;

    this.router.complete = async (req: any) => {
      const res = await originalComplete(req);
      if (res) {
        stepCost += res.estimatedCost || 0;
        stepTokens += res.tokensUsed || (res.promptTokens + res.completionTokens) || 0;
      }
      return res;
    };

    try {
      while (attempts < maxIterations && !approved) {
        attempts++;
        step.ticket.proof.currentIteration = attempts;
        this.stateStore.save(project);

        this.eventBus.emit('step:progress', {
          projectId: project.id,
          stepId: step.id,
          message: `Worker Loop - Iteration ${attempts}/${maxIterations}`,
        });

        // Delegate to strategy
        let strategyExecuted = false;
        for (const strategy of this.strategies) {
          if (strategy.canHandle(step)) {
            if (attempts > 1) {
              this.stateStore.startStep(project.id, step.id);
            }
            result = await strategy.execute(project, step, this);
            strategyExecuted = true;
            break;
          }
        }

        if (!strategyExecuted) {
          throw new Error(`No execution strategy found for step: ${step.label} (taskType: ${step.taskType})`);
        }

        // Active cost & token budget checks
        if (step.ticket.budget.tokenLimit && stepTokens > step.ticket.budget.tokenLimit) {
          this.eventBus.emit('step:progress', {
            projectId: project.id,
            stepId: step.id,
            message: `Evaluator Loop - Token budget exceeded (${stepTokens} > ${step.ticket.budget.tokenLimit}). Halting loop.`,
          });
          break;
        }

        if (step.ticket.budget.costLimitUsd && stepCost > step.ticket.budget.costLimitUsd) {
          this.eventBus.emit('step:progress', {
            projectId: project.id,
            stepId: step.id,
            message: `Evaluator Loop - Cost budget exceeded ($${stepCost.toFixed(4)} > $${step.ticket.budget.costLimitUsd}). Halting loop.`,
          });
          break;
        }

        // Check validation
        this.eventBus.emit('step:progress', {
          projectId: project.id,
          stepId: step.id,
          message: `Evaluator Loop - Running meta.evaluator (Iteration ${attempts}/${maxIterations})...`,
        });

        const evalAgent = getAgent('meta.evaluator');
        if (!evalAgent) {
          throw new Error(`meta.evaluator agent definition not found in registry`);
        }

        const agentRunner = new AgentRunner(
          this.router,
          this.stateStore,
          this.mcpClient,
          this.eventBus,
          this.log.child('meta-evaluator')
        );

        const evalSessionId = this.stateStore.createAgentSession({
          domain: 'meta',
          projectId: project.id,
          title: `Evaluation: ${step.label} (Iteration ${attempts})`
        });

        const rulesBlock = step.ticket.boundary.rules.map((r, i) => `  ${i + 1}. ${r}`).join('\n');
        const inScopeBlock = step.ticket.boundary.inScope.map(item => `  - ${item}`).join('\n');
        const outOfScopeBlock = step.ticket.boundary.outOfScope.map(item => `  - ${item}`).join('\n');

        const evalInput = [
          `### TICKET DETAILS`,
          `Category: ${step.ticket.order.category}`,
          `Objective: ${step.ticket.order.objective}`,
          `Baseline State: ${step.ticket.proof.baselineState}`,
          `Boundary In-Scope:\n${inScopeBlock}`,
          `Boundary Out-of-Scope:\n${outOfScopeBlock}`,
          `Rules:\n${rulesBlock}`,
          ``,
          `### WORKER DRAFT OUTPUT`,
          `---`,
          result,
          `---`,
          ``,
          `Please evaluate the worker draft output against the active ticket instructions.`,
          `You must strictly verify the boundary rules and objective constraints.`,
          `Return a valid JSON object indicating approval status and failure logs if rejected.`
        ].join('\n');

        const evalInvocation = await agentRunner.invoke({
          agent: evalAgent,
          sessionId: evalSessionId,
          input: evalInput,
          penSlug: (project.context as any).penNameSlug || undefined,
        });

        let failureLogs = 'Invalid evaluator response formatting.';
        try {
          const parsed = parseResilientJson(evalInvocation.output || '');
          approved = !!parsed.approved;
          failureLogs = parsed.failureLogs || 'Rejected without specific logs.';
        } catch (err: any) {
          approved = false;
          failureLogs = `Failed to parse evaluator JSON response: ${err.message}. Output was: ${evalInvocation.output}`;
        }

        if (approved) {
          this.eventBus.emit('step:progress', {
            projectId: project.id,
            stepId: step.id,
            message: `Evaluator Loop - Approved on iteration ${attempts}!`,
          });
        } else {
          this.log.warn('Evaluator Loop - Rejected draft', {
            projectId: project.id,
            stepId: step.id,
            iteration: attempts,
            failureLogs,
          });
          this.eventBus.emit('step:progress', {
            projectId: project.id,
            stepId: step.id,
            message: `Evaluator Loop - Rejected draft on iteration ${attempts}. Reason: ${failureLogs}`,
          });

          // Update the failure logs in ticket proof metadata
          step.ticket.proof.failureLogs = (step.ticket.proof.failureLogs ? step.ticket.proof.failureLogs + '\n' : '') +
            `[Iteration ${attempts} Failure]: ${failureLogs}`;

          // Save updated project to state store
          this.stateStore.save(project);
        }
      }
    } finally {
      // Always restore original router complete function
      this.router.complete = originalComplete;
    }

    if (!approved) {
      const fallbackStrategy = step.ticket.fallback.strategy || 'escalate';
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: `Evaluator Loop - Budget depleted. Executing fallback strategy: ${fallbackStrategy}`,
      });

      if (fallbackStrategy === 'switch-provider') {
        const fallbackHistory = step.ticket.proof.failureLogs || '';
        const switchCount = (fallbackHistory.match(/\[Fallback\]: Switched provider/g) || []).length;
        if (switchCount < 2) {
          const oldProvider = project.preferredProvider || 'ollama';
          const newProvider = oldProvider === 'workers' ? 'ollama' : 'workers';
          project.preferredProvider = newProvider;

          this.eventBus.emit('step:progress', {
            projectId: project.id,
            stepId: step.id,
            message: `Fallback: Switched provider from "${oldProvider}" to "${newProvider}". Resetting iteration budget.`,
          });

          // Reset iteration count and log action in failureLogs
          step.ticket.proof.currentIteration = 0;
          step.ticket.proof.failureLogs = (step.ticket.proof.failureLogs ? step.ticket.proof.failureLogs + '\n' : '') +
            `[Fallback]: Switched provider to ${newProvider} and retrying.`;

          this.stateStore.save(project);

          // Re-execute
          return await this.execute(project, step);
        } else {
          this.log.error('Provider switching failed: maximum switch retries exceeded', { projectId: project.id, stepId: step.id });
          throw new Error(`Worker-Evaluator Loop failed after switching provider twice. Escalating. Last failure: ${step.ticket.proof.failureLogs}`);
        }
      }

      if (fallbackStrategy === 'default-rollback') {
        const baseline = step.ticket.proof.baselineState;
        if (baseline && baseline.length === 40 && /^[a-f0-9]+$/i.test(baseline)) {
          this.eventBus.emit('step:progress', {
            projectId: project.id,
            stepId: step.id,
            message: `Fallback: Rolling back workspace repository to baseline state commit ${baseline.substring(0, 7)}...`,
          });
          rollbackToCommit(baseline, this.config.workspaceDir, this.log);
        } else {
          this.eventBus.emit('step:progress', {
            projectId: project.id,
            stepId: step.id,
            message: `Fallback: Rollback failed. No valid git commit hash baseline state recorded (got: "${baseline}").`,
          });
        }
        throw new Error(`Worker-Evaluator Loop failed after ${maxIterations} attempts. Rolled back changes. Last failure: ${step.ticket.proof.failureLogs}`);
      }

      // Default: escalate
      throw new Error(`Worker-Evaluator Loop failed after ${maxIterations} attempts. Escalating to ${step.ticket.fallback.escalationTarget || 'meta.director'}. Last failure: ${step.ticket.proof.failureLogs}`);
    }

    return result;
  }

  /**
   * Execute all pending steps in a project sequentially.
   */
  async executeAll(project: Project): Promise<void> {
    let step = this.stateStore.getNextPendingStep(project.id);
    while (step) {
      // Re-fetch project to get latest state
      const current = this.stateStore.get(project.id);
      if (!current || current.status === 'paused') break;

      const trainingFlagPath = path.join(this.config.workspaceDir, 'training', 'TRAINING_IN_PROGRESS.flag');
      const isResearcherBound = (current.type as string) === 'book-planning' &&
        (step.taskType === 'network_research' ||
         (step.label === 'Concept Keywords' && step.taskType === 'research') ||
         step.label === 'Market & Genre Analysis');

      const researcherModeNow = this.router.config.get<string>('ai.ollama.researcherMode', 'local');
      const researcherEndpointNow = this.router.config.get<string>('ai.ollama.researcherEndpoint', '');
      const curatorEndpointGuess = process.env.OLLAMA_CURATOR_BASE_URL || 'http://ollama-embeddings:11434';
      const researcherOffWriterGpu = isResearcherBound && (
        researcherModeNow === 'workers' ||
        researcherEndpointNow === curatorEndpointGuess
      );

      const curatorBound =
        !isResearcherBound && (
          step.taskType === 'network_research' ||
          (step.label === 'KDP Concept Keywords' && (current.type as string) === 'amazon-kdp-launch') ||
          (step.label === 'Cast Extraction' && (current.type as string) === 'style-calibration' && step.taskType === 'analysis') ||
          (step.taskType === 'pov_check' && (current.type as string) === 'style-calibration')
        );
      const stepRunsOnWriterGpu = !curatorBound && !researcherOffWriterGpu;
      let waitingLogged = false;
      while (stepRunsOnWriterGpu && fs.existsSync(trainingFlagPath)) {
        if (!waitingLogged) {
          this.log.info('Pipeline paused automatically: LoRA training is in progress on the writer GPU.', { project: current.title, step: step.label });
          waitingLogged = true;
        }
        await new Promise(resolve => setTimeout(resolve, 30000));
      }

      try {
        await this.execute(current, step);
      } catch (err: any) {
        if (err.message && err.message.startsWith('[AUTO_RESET_REQUIRED]')) {
          const s = current.steps.find(x => x.id === step!.id);
          if (s) {
            s.autoResetCount = (s.autoResetCount || 0) + 1;
            if (s.autoResetCount <= 3) {
              this.log.warn('Auto-recovering from infinite continuation loop (Resetting Step)', { 
                project: project.title, 
                step: step.label,
                autoResetCount: s.autoResetCount
              });
              s.status = 'pending';
              s.result = undefined;
              s.error = undefined;
              s.startedAt = undefined;
              s.completedAt = undefined;
              this.stateStore.save(current);
              
              this.eventBus.emit('step:failed', {
                projectId: project.id,
                stepId: step.id,
                error: `Auto-resetting step (Attempt ${s.autoResetCount}/3) due to loop.`,
              });

              step = this.stateStore.getNextPendingStep(project.id);
              continue;
            } else {
              this.log.error('Step exceeded maximum auto-resets. Halting pipeline.', { project: project.title, step: step.label });
              err.message = 'Step permanently failed after 3 auto-resets due to infinite continuation loops.';
            }
          }
        }

        this.eventBus.emit('project:paused', { projectId: project.id });
        this.log.warn('Pipeline halted due to step failure', {
          project: project.title,
          step: step.label,
          error: err.message,
        });
        return;
      }
      step = this.stateStore.getNextPendingStep(project.id);
    }
  }

  /** Unload all Ollama models from GPU VRAM. */
  public async flushOllamaVram(): Promise<void> {
    try {
      const ollamaUrls = [
        process.env.OLLAMA_BASE_URL ?? this.router.config.get<string>('ai.ollama.endpoint', 'http://localhost:11434'),
        process.env.OLLAMA_CURATOR_BASE_URL ?? this.router.config.get<string>('ai.ollama.curatorEndpoint', 'http://localhost:11435'),
      ];

      for (const url of ollamaUrls) {
        const psRes = await fetch(`${url}/api/ps`).catch(() => null);
        if (psRes && psRes.ok) {
          const psData = await psRes.json() as { models: Array<{ name: string }> };
          for (const m of psData.models) {
            await fetch(`${url}/api/generate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: m.name, keep_alive: 0 }),
            }).catch(() => null);
            this.log.info('Unloaded Ollama model to free VRAM', { url, model: m.name });
          }
        }
      }
    } catch (err) {
      this.log.warn('Failed to clear Ollama VRAM', { error: String(err) });
    }
  }

  public async runResearchAssistTask(opts: {
    project: Project;
    step: ProjectStep;
    systemPrompt: string;
    userContent: string;
    timeoutMs?: number;
  }): Promise<CompletionResponse> {
    const { project, step, systemPrompt, userContent } = opts;
    let timeoutMs = opts.timeoutMs ?? 30 * 60_000;

    try {
      const matched = AbilityEvaluator.evaluate(this.directorAbilities, {
        task_type: step.taskType,
      });
      for (const ability of matched) {
        if (ability.frontmatter.timeout_override !== undefined) {
          const parsedTimeout = parseInt(ability.frontmatter.timeout_override, 10);
          if (!isNaN(parsedTimeout)) {
            this.log.info('Applying director ability timeout override', {
              ability: ability.name,
              oldTimeoutMs: timeoutMs,
              newTimeoutMs: parsedTimeout,
            });
            timeoutMs = parsedTimeout;
            break;
          }
        }
      }
    } catch (abilityErr: any) {
      this.log.warn('Failed to evaluate director abilities for timeout override', { error: abilityErr.message });
    }
    const payload = {
      project_id: project.id,
      step_id: step.id,
      step_label: step.label,
      step_task_type: step.taskType,
      pen_slug: (project.context as any).penNameSlug || null,
      system_prompt: systemPrompt,
      user_content: userContent,
      max_tokens: this.router.getOutputBudget('research'),
      temperature: 0.2,
    };
    const ids = this.stateStore.enqueueTasks('research_assist', [payload], (project.context as any).penNameSlug);
    const taskId = ids[0];
    if (!taskId) throw new Error('research_assist enqueue failed (no task id returned)');

    this.log.info('research_assist task enqueued — waiting for worker', { taskId, stepId: step.id, stepLabel: step.label });
    this.eventBus.emit('step:progress', {
      projectId: project.id, stepId: step.id,
      message: `Waiting for external worker to claim research_assist task ${taskId}...`,
    });

    const deadline = Date.now() + timeoutMs;
    const pollMs = 3_000;
    let lastStatus = 'open';
    const stmt = (this.stateStore as any).db
      .prepare('SELECT status, result, error, claimed_by FROM task_pool WHERE id = ?');
    const finalStmt = (this.stateStore as any).db
      .prepare('SELECT status, result, error FROM task_pool WHERE id = ?');
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollMs));
      const row = stmt.get(taskId) as any;
      if (!row) throw new Error(`research_assist task ${taskId} vanished from task_pool`);
      if (row.status !== lastStatus) {
        lastStatus = row.status;
        this.eventBus.emit('step:progress', {
          projectId: project.id, stepId: step.id,
          message: `research_assist task ${taskId}: ${row.status}${row.claimed_by ? ` (worker=${row.claimed_by})` : ''}`,
        });
      }
      if (row.status === 'done') {
        let parsed: any = {};
        try {
          parsed = row.result ? JSON.parse(row.result) : {};
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        } catch { parsed = { result: row.result }; }
        const text = (parsed && typeof parsed === 'object' && (parsed.result || parsed.output || parsed.text)) || '';
        if (!text) throw new Error(`research_assist task ${taskId} returned empty result`);
        this.log.info('research_assist task complete', { taskId, resultLen: String(text).length });
        return {
          text: String(text),
          tokensUsed: 0,
          promptTokens: 0,
          completionTokens: 0,
          estimatedCost: 0,
          provider: 'workers',
        };
      }
      if (row.status === 'failed') {
        throw new Error(`research_assist task ${taskId} failed: ${row.error || 'unknown'}`);
      }
    }
    const finalRow = finalStmt.get(taskId) as any;
    if (finalRow?.status === 'done' && finalRow.result) {
      let parsed: any = {};
      try {
        parsed = JSON.parse(finalRow.result);
        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      } catch { parsed = { result: finalRow.result }; }
      const text = (parsed && typeof parsed === 'object' && (parsed.result || parsed.output || parsed.text)) || '';
      if (text) {
        this.log.warn('research_assist task completed after deadline — recovering orphan result', { taskId, resultLen: String(text).length });
        return { text: String(text), tokensUsed: 0, promptTokens: 0, completionTokens: 0, estimatedCost: 0, provider: 'workers' };
      }
    }
    throw new Error(`research_assist task ${taskId} timed out after ${Math.round(timeoutMs / 1000)}s (no worker reported done)`);
  }

  public async saveStepToDisk(project: Project, step: ProjectStep, result: string): Promise<void> {
    const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60);
    const baseDir = join(this.config.workspaceDir, 'projects', `${project.id}-${slug}`);
    
    let subDir = 'analysis';
    if (step.phase === 'writing' || step.taskType === 'creative_writing') subDir = 'manuscript';
    else if (step.taskType === 'export') subDir = 'exports';
    else if (step.phase === 'revision' || step.taskType.includes('revision')) subDir = 'revisions';
    else if (step.phase === 'planning') subDir = 'planning';
    
    const dir = join(baseDir, subDir);
    await mkdir(dir, { recursive: true });

    const isProseStep = step.taskType === 'creative_writing' || step.taskType === 'revision_execution';
    const dedupedResult = isProseStep ? this.dedup.deduplicateOutput(result) : result;
    const cleanResult = isProseStep ? this.sanitizer.sanitize(dedupedResult) : dedupedResult;

    const filename = `${step.id}-${step.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50)}.md`;

    let content: string;
    const isCalibration = (project.type as string) === 'style-calibration';

    if (step.taskType === 'creative_writing' || step.taskType === 'revision_execution') {
      content = isCalibration
        ? cleanResult
        : `# ${step.label}\n\n${cleanResult}\n`;
    } else if (step.taskType === 'pov_check') {
      content = [
        `# ${step.label}`,
        ``,
        `> **Type:** POV Quality Audit | **Evaluated:** ${new Date().toISOString().split('T')[0]}`,
        ``,
        `---`,
        ``,
        `## 🔍 Critic Analysis`,
        ``,
        cleanResult,
      ].join('\n');
    } else if (step.taskType === 'draft_compile') {
      content = `# ${step.label}\n\n${cleanResult}\n`;
    } else if (step.taskType === 'analysis' && isCalibration) {
      content = [
        `# ${step.label}`,
        ``,
        `> **Type:** Calibration Summary | **Pass:** ${new Date().toISOString().split('T')[0]}`,
        ``,
        `---`,
        ``,
        `## 📊 Improvement Directives`,
        ``,
        cleanResult,
      ].join('\n');
    } else {
      content = `# ${step.label}\n\n${cleanResult}`;
    }

    await writeFile(join(dir, filename), content, 'utf-8');
  }

  public forceRelationshipMatrixFormat(markdown: string): string {
    const lines = markdown.split('\n');
    let inSectionB = false;
    let outLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/^##\s*B\.\s*Relationship/i) || line.match(/^##\s*\*\*B\.\s*Relationship/i)) {
        inSectionB = true;
        outLines.push(line);
        continue;
      }
      
      if (inSectionB && (line.match(/^##\s*C\./i) || line.match(/^##\s*\*\*C\./i))) {
        inSectionB = false;
        outLines.push(line);
        continue;
      }

      if (inSectionB && line.trim().startsWith('|')) {
        const cells = line.split('|').map(c => c.trim());
        if (cells[0] === '') cells.shift();
        if (cells[cells.length - 1] === '') cells.pop();

        if (cells.length === 5) {
          if (cells[0].toLowerCase().includes('pair')) {
            outLines.push(`| First Character | Second Character | ${cells.slice(1).join(' | ')} |`);
          } 
          else if (cells[0].includes('---')) {
            outLines.push(`|---|---|${cells.slice(1).map(() => '---').join('|')}|`);
          } 
          else {
            const pairRaw = cells[0];
            let splitPair = [pairRaw, '?'];
            if (pairRaw.includes('↔')) splitPair = pairRaw.split('↔');
            else if (pairRaw.includes('<->')) splitPair = pairRaw.split('<->');
            else if (pairRaw.includes(' and ')) splitPair = pairRaw.split(' and ');
            else if (pairRaw.includes(' vs ')) splitPair = pairRaw.split(' vs ');
            else if (pairRaw.includes(' - ')) splitPair = pairRaw.split(' - ');
            else if (pairRaw.includes('-')) splitPair = pairRaw.split('-');
            
            const charA = (splitPair[0]?.trim() || pairRaw).replace(/\*\*/g, '');
            const charB = (splitPair[1]?.trim() || '?').replace(/\*\*/g, '');

            outLines.push(`| ${charA} | ${charB} | ${cells.slice(1).join(' | ')} |`);
          }
        } else {
          outLines.push(line);
        }
      } else {
        outLines.push(line);
      }
    }

    return outLines.join('\n');
  }

  public shouldUseWorkersForResearch(project: Project, step: ProjectStep): boolean {
    if ((project.type as string) !== 'book-planning') return false;
    const isResearchStep =
      step.taskType === 'network_research' ||
      (step.taskType === 'research' && (step.label === 'Concept Keywords' || step.label === 'Market & Genre Analysis'));
    if (!isResearchStep) return false;
    const mode = this.router.config.get<string>('ai.ollama.researcherMode', 'local');
    return mode === 'workers';
  }
}
