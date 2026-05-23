/**
 * @perry/projects — Project Engine
 *
 * Top-level orchestrator for project lifecycle. Thin wrapper over
 * StateStore, TemplateRegistry, and StepRunner.
 */

import {
  Project, ProjectType, ProjectContext, EventBus, Logger, McpClientService, projectTypeDomain
} from '@perry/core';
import type { AIRouter } from '@perry/ai';
import type { ContextEngine } from '@perry/rag';
import { StateStore } from './state-store.js';
import { StepRunner } from './step-runner.js';
import { PromptBuilder } from './prompt-builder.js';
import { TemplateRegistry } from './templates.js';
import { resolveCalibrationAntiPatterns } from './data/calibration-anti-patterns.js';
import { PromptTemplateService } from './services/prompt-template-service.js';
import { CustomPipelineService } from './services/custom-pipeline-service.js';
import { DirectorAgent } from './director-agent.js';
import * as fs from 'fs';
import * as path from 'path';

import type { ConfigService } from '@perry/core';

export interface ProjectEngineConfig {
  workspaceDir: string;
  maxRetries: number;
  minResponseLength: number;
  config: ConfigService;
  enableMaintenance?: boolean;
}

export class ProjectEngine {
  private stateStore: StateStore;
  private templates: TemplateRegistry;
  private promptTemplates: PromptTemplateService;
  private stepRunner: StepRunner;
  private eventBus: EventBus;
  private log: Logger;
  private workspaceDir: string;
  private contextEngine: ContextEngine;
  private mcpClient: McpClientService;
  private promptBuilder!: PromptBuilder;
  private customPipelineService: CustomPipelineService;

  /** Expose AutoLearningService for MCP-facing routes (pair injection, manual export). */
  public getAutoLearning() { return this.stepRunner.getAutoLearning(); }
  /** Expose the shared event bus (agent routes use it for invocation events). */
  public getEventBus(): EventBus { return this.eventBus; }
  /** Expose the shared MCP client (agent routes use it to feed AgentRunner). */
  public getMcpClient(): McpClientService { return this.mcpClient; }
  public getPromptBuilder(): PromptBuilder { return this.promptBuilder; }
  private config: ProjectEngineConfig;
  private director: DirectorAgent;

  // Per-project execution lock: tracks which projects have an active loop
  // and provides a drain promise so resume can wait for the old loop to exit.
  private executingProjects = new Map<string, {
    resolve: () => void;
    promise: Promise<void>;
  }>();

  // Asynchronous Flow Control: global semaphore for GPU lock and execution queue
  private activeGpuTasks = 0;
  private gpuWaiters: Array<() => void> = [];
  private executionQueue: string[] = [];
  private queueWorkerActive = false;

  private async acquireGlobalLock(waitLog: string): Promise<() => void> {
    const limit = this.config.config.get<number>('gpu.concurrencyLimit', 1);

    if (this.activeGpuTasks < limit) {
      this.activeGpuTasks++;
      return () => this.releaseGlobalLock();
    }

    return new Promise<() => void>(resolve => {
      this.log.info(`${waitLog} (Current active: ${this.activeGpuTasks}/${limit}, Queue length: ${this.gpuWaiters.length})`);
      this.gpuWaiters.push(() => {
        resolve(() => this.releaseGlobalLock());
      });
    });
  }

  private releaseGlobalLock(): void {
    this.activeGpuTasks = Math.max(0, this.activeGpuTasks - 1);
    this.processGpuQueue();
  }

  public processGpuQueue(): void {
    const limit = this.config.config.get<number>('gpu.concurrencyLimit', 1);
    while (this.gpuWaiters.length > 0 && this.activeGpuTasks < limit) {
      this.activeGpuTasks++;
      const nextWaiter = this.gpuWaiters.shift();
      if (nextWaiter) {
        nextWaiter();
      }
    }
  }

  constructor(
    stateStore: StateStore,
    router: AIRouter,
    contextEngine: ContextEngine,
    eventBus: EventBus,
    log: Logger,
    config: ProjectEngineConfig,
  ) {
    this.config = config;
    this.stateStore = stateStore;
    this.templates = new TemplateRegistry();
    this.promptTemplates = new PromptTemplateService(config.workspaceDir, log.child('templates'));
    this.eventBus = eventBus;
    this.log = log;
    this.workspaceDir = config.workspaceDir;
    this.contextEngine = contextEngine;

    // Load custom pipeline skeletons
    this.customPipelineService = new CustomPipelineService(config.workspaceDir, log.child('pipelines'));
    for (const tpl of this.customPipelineService.getTemplates()) {
      this.templates.register(tpl);
    }

    const promptBuilder = new PromptBuilder(
      config.workspaceDir,
      contextEngine,
      stateStore,
      router.compressor,
      config.config,
      log.child('prompt'),
    );
    this.promptBuilder = promptBuilder;

    const mcpClient = new McpClientService(config.config, log.child('mcp'));
    this.mcpClient = mcpClient;
    // We don't await initialize() here because constructors cannot be async.
    // It connects asynchronously in the background.
    mcpClient.initialize().catch(err => log.error('Failed to initialize MCP Client', { error: err.message }));

    this.stepRunner = new StepRunner(
      router,
      stateStore,
      promptBuilder,
      eventBus,
      log.child('runner'),
      {
        workspaceDir: config.workspaceDir,
        maxRetries: config.maxRetries,
        minResponseLength: config.minResponseLength,
      },
      mcpClient
    );

    this.director = new DirectorAgent(
      router,
      stateStore,
      mcpClient,
      contextEngine,
      log.child('director'),
      eventBus,
    );

    // Recover orphaned "active" steps and run GC only if maintenance is enabled
    if (config.enableMaintenance) {
      const recoveredIds = this.recoverOrphanedSteps();

      // Auto-resume recovered projects
      if (recoveredIds && recoveredIds.length > 0) {
        this.log.info('Auto-resuming recovered projects on boot', { count: recoveredIds.length, ids: recoveredIds });
        for (const id of recoveredIds) {
          this.enqueueProject(id);
        }
      }

      // Run Garbage Collection asynchronously on boot
      setTimeout(() => {
        this.purgeGhostData().catch(err => {
          this.log.error('Garbage Collector failed on boot', { error: err.message });
        });
      }, 5000); // Give the system 5 seconds to settle before sweeping
    }

    // ── Project Auto-Chain ──────────────────────────────────────────────
    // When a parent project completes, automatically start any child project
    // whose type makes it a natural downstream step. Today: book-planning
    // completion auto-starts its style-calibration child. Lets users press
    // "play" on the planning project once and walk away while the training
    // data pipeline fills out.
    this.eventBus.on('project:completed', async (payload: any) => {
      try {
        const parentId = payload?.projectId;
        if (!parentId) return;
        const parent = this.stateStore.get(parentId);
        if (!parent || (parent.type as string) !== 'book-planning') return;

        const children = this.stateStore.list().filter(
          p => p.parentId === parentId &&
               (p.type as string) === 'style-calibration' &&
               p.status !== 'completed' &&
               p.status !== 'active',
        );
        if (children.length === 0) return;

        for (const child of children) {
          this.log.info('Auto-chain: starting downstream calibration project', {
            parent: parent.title,
            child: child.title,
            childId: child.id,
          });
          // Fire-and-forget — don't block the event emission. Errors are logged
          // by executeProject's own catch path.
          this.executeAll(child.id).catch(err => {
            this.log.warn('Auto-chain: downstream project failed to start', {
              child: child.title,
              error: err.message,
            });
          });
        }
      } catch (err: any) {
        this.log.warn('Auto-chain handler threw', { error: err.message });
      }
    });

    this.seedPresetsIfEmpty();
  }

  async chatWithDirector(projectId: string, message: string): Promise<string> {
    return this.director.chat(projectId, message);
  }

  clearDirectorChat(projectId: string): void {
    this.stateStore.clearChatHistory(projectId);
  }

  // ── Project CRUD ────────────────────────────────────────

  get promptTemplateService(): PromptTemplateService {
    return this.promptTemplates;
  }

  createProject(input: {
    type: ProjectType;
    title: string;
    description: string;
    parentId?: string;
    context?: Partial<ProjectContext>;
    preferredProvider?: string;
  }): Project {
    this.refreshCustomTemplates();
    const template = this.templates.get(input.type);
    if (!template) {
      throw new Error(`Unknown template type: ${input.type}. Available: ${this.templates.list().map(t => t.type).join(', ')}`);
    }

    const id = `project-${this.stateStore.getNextId()}`;
    const now = new Date().toISOString();

    // For child projects, inherit context from the parent project chain
    // so the user doesn't have to manually re-enter chapters/words/prologue/epilogue.
    let inheritedContext: Partial<ProjectContext> = {};
    if (input.parentId) {
      // Walk up the parent chain to find the root project
      let sourceProject = this.stateStore.get(input.parentId);
      while (sourceProject?.parentId) {
        const grandparent = this.stateStore.get(sourceProject.parentId);
        if (grandparent) sourceProject = grandparent;
        else break;
      }
      if (sourceProject) {
        // Always inherit core structure settings
        inheritedContext = {
          targetChapters: (sourceProject.context as any).targetChapters,
          targetWordsPerChapter: (sourceProject.context as any).targetWordsPerChapter,
          includePrologue: (sourceProject.context as any).includePrologue,
          includeEpilogue: (sourceProject.context as any).includeEpilogue,
        } as any;

        // Style Calibration uses targetChapters as "number of passes" —
        // a completely different meaning from the parent's chapter count.
        // Never inherit it; always use the user's explicit input.
        if ((input.type as string) === 'style-calibration') {
          delete (inheritedContext as any).targetChapters;
        }

        // For revision templates, also inherit per-chapter word counts
        const isRevisionTemplate = (input.type as string) === 'deep-revision' || (input.type as string) === 'revision-execution';
        if (isRevisionTemplate) {
          const chapterWordCounts: Record<number, number> = {};
          for (const step of sourceProject.steps) {
            if (step.taskType === 'creative_writing' && step.chapterNumber !== undefined && step.result) {
              chapterWordCounts[step.chapterNumber] = step.result.trim().split(/\s+/).length;
            }
          }
          (inheritedContext as any).chapterWordCounts = chapterWordCounts;
        }

        this.log.info('Inherited context from parent project', {
          sourceProjectId: sourceProject.id,
          sourceTitle: sourceProject.title,
          targetChapters: (inheritedContext as any).targetChapters,
          targetWordsPerChapter: (inheritedContext as any).targetWordsPerChapter,
        });

        // Style Calibration: auto-populate description from parent book bible.
        // IMPORTANT: stateStore.get() returns steps with result=placeholder string.
        // Real content is in: (1) steps table in SQLite, (2) markdown files on disk.
        // We use the steps table first, disk files as fallback.
        if ((input.type as string) === 'style-calibration' && !input.description) {
          try {
            const bibleLabels = ['character', 'world', 'faction'];
            const bibleSteps = sourceProject!.steps.filter(
              s => s.status === 'completed' &&
                   ['bible', 'premise'].includes(s.phase || '') &&
                   bibleLabels.some(kw => s.label.toLowerCase().includes(kw))
            );

            const selected = bibleSteps.slice(0, 2);
            const parts: string[] = [];

            for (const step of selected) {
              let content = '';

              // 1. Try the SQLite steps table (stores full content)
              const db = (this.stateStore as any).db;
              if (db) {
                const row = db.prepare(
                  'SELECT result FROM steps WHERE project_id = ? AND id = ?'
                ).get(sourceProject!.id, step.id) as any;
                if (row?.result && !row.result.startsWith('[Content written')) {
                  content = row.result;
                }
              }

              // 2. Fallback: read from disk markdown file
              if (!content) {
                const projectsDir = path.join(this.workspaceDir, 'projects');
                const entries = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
                const parentDir = entries.find(e => e.startsWith(sourceProject!.id + '-'));
                if (parentDir) {
                  // Try both root and analysis subdirectory
                  const slug = step.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                  const candidates = [
                    path.join(projectsDir, parentDir, 'analysis', `${step.id}-${slug}.md`),
                    path.join(projectsDir, parentDir, `${step.id}-${slug}.md`),
                  ];
                  // Also scan for any file matching the step id prefix
                  const analysisDir = path.join(projectsDir, parentDir, 'analysis');
                  if (fs.existsSync(analysisDir)) {
                    const files = fs.readdirSync(analysisDir);
                    const match = files.find(f => f.startsWith(step.id + '-') || f.includes(slug));
                    if (match) candidates.unshift(path.join(analysisDir, match));
                  }
                  for (const candidate of candidates) {
                    if (fs.existsSync(candidate)) {
                      content = fs.readFileSync(candidate, 'utf-8');
                      break;
                    }
                  }
                }
              }

              if (content) {
                parts.push(`## ${step.label}\n${content.slice(0, 700)}`);
              }
            }

            if (parts.length > 0) {
              input.description = parts.join('\n\n').slice(0, 1500);
              this.log.info('Style calibration: auto-populated description from parent bible', {
                parentId: sourceProject!.id,
                steps: selected.map(s => s.label),
                descLength: input.description.length,
              });
            }
          } catch (err) {
            this.log.warn('Style calibration: failed to auto-populate description from parent bible', {
              error: (err as Error).message,
            });
          }
        }
      }
    }

    // Read scene-by-scene default from meta so the toggle in the dashboard
    // affects newly-created projects without requiring a project-form field.
    const sceneByScene = (() => {
      try {
        const raw = this.stateStore.getMeta('pipeline.sceneByScene.enabled');
        return raw === 'true';
      } catch { return false; }
    })();

    const context: ProjectContext = {
      targetChapters: 25,
      targetWordsPerChapter: 3000,
      hasParent: !!input.parentId,
      sceneByScene,
      ...input.context,      // explicit user values (often defaults from UI)
      ...inheritedContext,   // parent values MUST override defaults + UI defaults
    } as any;

    // Resolve calibration anti-patterns (universal + pen-specific) once, here,
    // so styleCalibration's buildSteps sees a pre-merged list rather than
    // hardcoding a Digital-Drift-flavoured one for every pen.
    if ((input.type as string) === 'style-calibration') {
      const merged = resolveCalibrationAntiPatterns(this.stateStore, (context as any).penNameSlug);
      context.config = { ...(context.config || {}), calibrationAntiPatterns: merged };
    }

    let steps = template.buildSteps(context, input.title, input.description);
    
    // Apply dynamic prompt overrides
    steps = this.promptTemplates.applyOverrides(input.type, steps);

    const project: Project = {
      id,
      parentId: input.parentId,
      type: input.type,
      workType: template.workType,
      title: input.title,
      description: input.description,
      status: 'pending',
      progress: 0,
      steps,
      context,
      preferredProvider: input.preferredProvider,
      createdAt: now,
      updatedAt: now,
    };

    this.stateStore.save(project);
    this.eventBus.emit('project:created', { project });
    this.log.info('Project created', { id, type: input.type, title: input.title, steps: steps.length });

    return project;
  }

  getProject(id: string): Project | undefined {
    return this.stateStore.get(id);
  }

  /**
   * Re-resolve prompts for `pending` steps from the current template registry.
   * Mutates in-memory only; does NOT persist (the next save() will, but only
   * the new step.prompt — `prompt_override` is left untouched). Skips steps
   * with a non-empty `promptOverride` so POV-gate retry context survives.
   *
   * Without this, a project created when templates.ts had bug X stays
   * permanently broken after we fix bug X. Called at the top of every
   * execution path so template fixes propagate to existing projects.
   */
  private refreshPendingPrompts(project: Project): void {
    this.refreshCustomTemplates();
    const template = this.templates.get(project.type);
    if (!template) return;
    try {
      const fresh = template.buildSteps(project.context, project.title, project.description);
      this.promptTemplates.applyOverrides(project.type, fresh);

      // Match prompts by identity tuple (taskType + label + chapterNumber +
      // segmentIndex), NOT by step.id. The id is just an auto-incrementing
      // index — when a template adds/removes/merges steps between versions,
      // ids shift but task identities don't. Matching by id after a template
      // change would assign the wrong prompt (e.g. a chapter-write step
      // getting the chapter-review prompt because indices renumbered after
      // a step merge). When the identity tuple can't find a match we leave
      // the existing prompt alone — better stale prose than wrong prose.
      const keyFor = (s: any) =>
        `${s.taskType}|${s.label}|${s.chapterNumber ?? ''}|${s.segmentIndex ?? ''}`;
      const freshByKey = new Map(fresh.map(s => [keyFor(s), s.prompt]));

      let updated = 0;
      let unmatched = 0;
      for (const step of project.steps) {
        if (step.status !== 'pending') continue;
        if (step.promptOverride) {
          // Override wins; ensure the active `prompt` field reflects it.
          if (step.prompt !== step.promptOverride) step.prompt = step.promptOverride;
          continue;
        }
        const newer = freshByKey.get(keyFor(step));
        if (newer === undefined) {
          // No identity match in the current template. Leave existing prompt.
          unmatched++;
          continue;
        }
        if (newer !== step.prompt) {
          step.prompt = newer;
          updated++;
        }
      }
      if (updated > 0 || unmatched > 0) {
        this.log.info('Refreshed pending step prompts from current template', {
          projectId: project.id, type: project.type, updated, unmatched,
        });
      }
    } catch (e: any) {
      this.log.warn('Failed to refresh pending prompts', { projectId: project.id, error: e.message });
    }
  }

  /**
   * Dry-run sibling of refreshPendingPrompts: counts pending steps whose
   * stored prompt diverges from the current template, across all projects.
   * Returns per-project counts so the GC stage / dashboard can surface
   * how many projects need a refresh. Skips active/completed/failed steps
   * and skips steps with a promptOverride (those win over the template).
   */
  countStalePendingPrompts(): { totalProjects: number; staleProjects: number; staleSteps: number; perProject: Array<{ projectId: string; type: string; stale: number }> } {
    this.refreshCustomTemplates();
    const all = this.stateStore.list();
    const perProject: Array<{ projectId: string; type: string; stale: number }> = [];
    let staleSteps = 0;
    let staleProjects = 0;
    for (const project of all) {
      const template = this.templates.get(project.type);
      if (!template) continue;
      try {
        const fresh = template.buildSteps(project.context, project.title, project.description);
        this.promptTemplates.applyOverrides(project.type, fresh);
        // Match by identity tuple (same rule as refreshPendingPrompts).
        const keyFor = (s: any) =>
          `${s.taskType}|${s.label}|${s.chapterNumber ?? ''}|${s.segmentIndex ?? ''}`;
        const freshByKey = new Map(fresh.map(s => [keyFor(s), s.prompt]));
        let stale = 0;
        for (const step of project.steps) {
          if (step.status !== 'pending') continue;
          if (step.promptOverride) continue;
          const newer = freshByKey.get(keyFor(step));
          if (newer && newer !== step.prompt) stale++;
        }
        if (stale > 0) {
          perProject.push({ projectId: project.id, type: project.type, stale });
          staleSteps += stale;
          staleProjects++;
        }
      } catch {
        // Bad template build (e.g. missing context field) — skip silently;
        // refreshPendingPrompts logs the same failure with details if reached.
      }
    }
    return { totalProjects: all.length, staleProjects, staleSteps, perProject };
  }

  updateStepResult(projectId: string, stepId: string, result: string): boolean {
    const project = this.stateStore.get(projectId);
    if (!project) return false;
    const step = project.steps.find(s => s.id === stepId);
    if (!step) return false;

    // Update SQLite state (and archive old result)
    this.stateStore.completeStep(projectId, stepId, result);

    // Overwrite physical file so ContextEngine reads the human-edited version
    try {
      const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60);
      const baseDir = path.join(this.workspaceDir, 'projects', `${project.id}-${slug}`);
      
      let subDir = 'analysis';
      if (step.phase === 'writing' || step.taskType === 'creative_writing') subDir = 'manuscript';
      else if (step.taskType === 'export') subDir = 'exports';
      else if (step.phase === 'revision' || step.taskType?.includes('revision')) subDir = 'revisions';
      else if (step.phase === 'planning') subDir = 'planning';
      
      const dir = path.join(baseDir, subDir);
      if (fs.existsSync(dir)) {
        const filename = `${step.id}-${step.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50)}.md`;
        const filepath = path.join(dir, filename);
        const content = `# ${step.label}\n\n${result}`;
        fs.writeFileSync(filepath, content, 'utf-8');
        this.log.info('Overwrote step file on disk with manual edit', { filepath });
      }
    } catch (err: any) {
      this.log.warn('Failed to overwrite step file after manual edit', { error: err.message, projectId, stepId });
    }

    return true;
  }

  listProjects(status?: string): Project[] {
    const all = this.stateStore.list(status);

    // Strip heavy text fields for the list view to prevent network/memory
    // hangs on 100k+ word manuscripts. The UI only needs metadata; full
    // prompt/result are fetched via /projects/:id when a project is opened.
    // The result placeholder is intentionally a marker string — the IO
    // inspector at dashboard/App.tsx detects it to fetch from disk.
    // Also stamp the project's domain so the dashboard can filter by it
    // (Fleet view groups projects under their domain station).
    return all.map(p => {
      const lightweight = { ...p } as any;
      lightweight.domain = projectTypeDomain(p.type);
      lightweight.steps = p.steps.map(s => ({
        ...s,
        prompt: '',
        result: s.result ? '[Content written to disk. Check workspace/projects/ directory]' : undefined,
      }));
      return lightweight;
    });
  }

  deleteProject(id: string): boolean {
    const project = this.stateStore.get(id);
    if (!project) return false;

    const deleted = this.stateStore.delete(id);
    if (deleted) {
      this.stepRunner.clearProjectState(id);
      this.eventBus.emit('project:deleted', { projectId: id });
      this.log.info('Project deleted', { id });
      
      // Cleanup physical files — fire-and-forget so deleteProject returns immediately
      const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60);

      try {
        const contextFile = path.join(this.workspaceDir, 'context', `${id}.json`);
        const exportsDir = path.join(this.workspaceDir, 'exports');
        
        // 1. Delete project markdown directory and legacy .json files
        const projectsDir = path.join(this.workspaceDir, 'projects');
        if (fs.existsSync(projectsDir)) {
          const files = fs.readdirSync(projectsDir);
          for (const file of files) {
            // Match project-12.json, project-12-title, or exactly project-12
            if (file === `${id}.json` || file.startsWith(`${id}-`) || file === id) {
              const fullPath = path.join(projectsDir, file);
              fs.rmSync(fullPath, { recursive: true, force: true });
            }
          }
        }
        
        // 2. Delete context engine cache
        if (fs.existsSync(contextFile)) {
          fs.rmSync(contextFile, { force: true });
        }

        // 3. Delete related exports
        if (fs.existsSync(exportsDir)) {
          const files = fs.readdirSync(exportsDir);
          for (const file of files) {
            if (file.startsWith(`${id}-`)) {
              fs.rmSync(path.join(exportsDir, file), { force: true });
            }
          }
        }

        // 4. Delete related images (covers, renders)
        const imagesDir = path.join(this.workspaceDir, 'images');
        if (fs.existsSync(imagesDir)) {
          const files = fs.readdirSync(imagesDir);
          for (const file of files) {
            if (file.includes(id)) {
              fs.rmSync(path.join(imagesDir, file), { force: true });
            }
          }
        }
      } catch (err: any) {
        this.log.error('Failed to cleanup project files', { id, error: err.message });
      }
    }
    return deleted;
  }

  // ── Garbage Collection ──────────────────────────────────
  
  /**
   * Purge Ghost Data (Garbage Collector)
   * Scans the workspace directories and removes any artifacts (context files,
   * markdown directories, exports) that do not belong to an active project.
   */
  async purgeGhostData(): Promise<{
    purgedContexts: number; purgedDirs: number; purgedExports: number;
    purgedRagRecords: number; purgedSqliteRows: number; purgedTelemetry: number;
    purgedImages: number; purgedLegacyFiles: number; purgedLogs: number;
    fixedParentRefs: number;
  }> {
    // Guard: don't run GC while a pipeline is actively executing
    if (this.executingProjects.size > 0) {
      this.log.info('GC skipped — pipeline execution in progress');
      return {
        purgedContexts: 0, purgedDirs: 0, purgedExports: 0, purgedRagRecords: 0,
        purgedSqliteRows: 0, purgedTelemetry: 0, purgedImages: 0,
        purgedLegacyFiles: 0, purgedLogs: 0, fixedParentRefs: 0,
      };
    }

    // Static imports used directly — no dynamic import() needed
    
    // Get canonical list of active project IDs
    const activeProjects = this.stateStore.list();
    const activeIds = new Set(activeProjects.map(p => p.id));

    let purgedContexts = 0;
    let purgedDirs = 0;
    let purgedExports = 0;
    let purgedRagRecords = 0;
    let purgedImages = 0;
    let purgedLegacyFiles = 0;
    let purgedLogs = 0;
    let fixedParentRefs = 0;

    // 1. Sweep Context Directory
    const contextDir = path.join(this.workspaceDir, 'context');
    if (fs.existsSync(contextDir)) {
      const files = fs.readdirSync(contextDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const fileId = file.replace('.json', '');
        if (!activeIds.has(fileId)) {
          fs.rmSync(path.join(contextDir, file), { force: true });
          purgedContexts++;
        }
      }
    }

    // 2. Sweep Projects Directory (Markdown, Images, and legacy JSONs)
    const projectsDir = path.join(this.workspaceDir, 'projects');
    if (fs.existsSync(projectsDir)) {
      const items = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const item of items) {
        const match = item.name.match(/^(project-\d+)/);
        if (!match) continue;
        
        const projectId = match[1];
        if (!activeIds.has(projectId)) {
          fs.rmSync(path.join(projectsDir, item.name), { recursive: true, force: true });
          purgedDirs++;
        }
      }
    }

    // 3. Sweep Exports Directory (fixed regex — id is already 'project-N')
    const exportsDir = path.join(this.workspaceDir, 'exports');
    if (fs.existsSync(exportsDir)) {
      const files = fs.readdirSync(exportsDir);
      for (const file of files) {
        const match = file.match(/^(project-\d+)/);
        if (match && !activeIds.has(match[1])) {
          fs.rmSync(path.join(exportsDir, file), { force: true });
          purgedExports++;
        }
      }
    }

    // 4. Sweep Images Directory (covers, renders keyed by project ID)
    const imagesDir = path.join(this.workspaceDir, 'images');
    if (fs.existsSync(imagesDir)) {
      const files = fs.readdirSync(imagesDir);
      for (const file of files) {
        const match = file.match(/(project-\d+)/);
        if (match && !activeIds.has(match[1])) {
          fs.rmSync(path.join(imagesDir, file), { force: true });
          purgedImages++;
        }
      }
    }

    // 5. Sweep RAG Memory Store (SQLite)
    if (this.contextEngine && typeof this.contextEngine.purgeGhostData === 'function') {
      purgedRagRecords = this.contextEngine.purgeGhostData(activeIds);
    }

    // 6. Sweep SQLite Orphans (Steps, Telemetry, History)
    let purgedSqliteRows = 0;
    if (typeof this.stateStore.purgeGhostSqliteData === 'function') {
      purgedSqliteRows = this.stateStore.purgeGhostSqliteData();
    }

    // 7. Purge old telemetry (keep 14 days)
    let purgedTelemetry = 0;
    if (typeof this.stateStore.purgeTelemetry === 'function') {
      purgedTelemetry = this.stateStore.purgeTelemetry(14);
    }

    // 8. Prune activity/audit logs older than 7 days
    const logRetentionMs = 7 * 24 * 60 * 60 * 1000;
    const logCutoff = Date.now() - logRetentionMs;
    for (const logDir of ['.activity', '.audit']) {
      const dir = path.join(this.workspaceDir, logDir);
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        // Log files are named like 2026-05-01.jsonl
        const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          const fileDate = new Date(dateMatch[1]).getTime();
          if (fileDate < logCutoff) {
            fs.rmSync(path.join(dir, file), { force: true });
            purgedLogs++;
          }
        }
      }
    }

    // 9. Delete orphaned memory-search.db (legacy, no longer referenced in code)
    const memorySearchDb = path.join(this.workspaceDir, 'memory', 'memory-search.db');
    if (fs.existsSync(memorySearchDb)) {
      this.log.info('Deleting orphaned memory-search.db');
      for (const suffix of ['', '-shm', '-wal']) {
        const f = memorySearchDb + suffix;
        if (fs.existsSync(f)) {
          fs.rmSync(f, { force: true });
          purgedLegacyFiles++;
        }
      }
    }

    // 10. Delete legacy/superseded files
    const configDir = path.join(this.workspaceDir, '.config');
    const legacyFiles = [
      path.join(configDir, 'projects.json'),       // superseded by SQLite
      path.join(configDir, 'style-dna.txt'),        // superseded by style_dna_v2 in meta table
      path.join(configDir, 'projects-state.json'),  // stale, empty data
      path.join(configDir, 'telemetry.db'),          // empty, 0 tables
      path.join(configDir, 'idle-tasks.json'),       // not referenced in code
      path.join(this.workspaceDir, 'state.db'),      // empty, 0 tables
      path.join(this.workspaceDir, 'memory', 'state.db'), // empty, 0 tables
    ];
    for (const f of legacyFiles) {
      if (fs.existsSync(f)) {
        fs.rmSync(f, { force: true, recursive: true });
        purgedLegacyFiles++;
        this.log.info('Deleted legacy file', { path: f });
      }
    }

    // 11. Fix broken parent references (parentId pointing to deleted projects)
    for (const project of activeProjects) {
      if (project.parentId && !activeIds.has(project.parentId)) {
        this.log.warn('Fixing broken parent reference', {
          projectId: project.id,
          brokenParentId: project.parentId,
        });
        project.parentId = undefined;
        this.stateStore.save(project);
        fixedParentRefs++;
      }
    }

    // 12. VACUUM database to reclaim freed space
    if (typeof this.stateStore.vacuum === 'function') {
      this.stateStore.vacuum();
    }

    const totalPurged = purgedContexts + purgedDirs + purgedExports + purgedRagRecords +
      purgedSqliteRows + purgedTelemetry + purgedImages + purgedLegacyFiles + purgedLogs + fixedParentRefs;

    if (totalPurged > 0) {
      this.log.info('Garbage Collector complete', {
        purgedContexts, purgedDirs, purgedExports, purgedRagRecords,
        purgedSqliteRows, purgedTelemetry, purgedImages,
        purgedLegacyFiles, purgedLogs, fixedParentRefs,
      });
    } else {
      this.log.info('Garbage Collector complete — workspace is clean');
    }

    return {
      purgedContexts, purgedDirs, purgedExports, purgedRagRecords,
      purgedSqliteRows, purgedTelemetry, purgedImages,
      purgedLegacyFiles, purgedLogs, fixedParentRefs,
    };
  }
  // ── Orphan Recovery ─────────────────────────────────────

  /**
   * On startup, any steps that are still "active" were interrupted by a
   * container restart. Reset them back to "pending" so the pipeline can
   * pick them up on the next execution.
   */
  private recoverOrphanedSteps(): string[] {
    const projects = this.stateStore.list();
    let recovered = 0;
    const recoveredIds: string[] = [];

    for (const project of projects) {
      // Bug 6 fix: never re-queue steps on a project the user deliberately
      // paused or that has already completed. Only recover genuinely
      // interrupted active runs.
      if (project.status === 'paused' || project.status === 'completed') {
        continue;
      }

      let dirty = false;
      for (const step of project.steps) {
        if (step.status === 'active') {
          this.log.warn('Recovering orphaned active step', {
            project: project.title,
            step: step.label,
            startedAt: step.startedAt,
          });
          step.status = 'pending';
          step.startedAt = undefined;
          dirty = true;
          recovered++;
        }
      }
      if (dirty) {
        // If the project was "active" but no steps are running, set it to pending
        if (project.status === 'active') {
          project.status = 'pending';
        }
        this.stateStore.save(project);
        recoveredIds.push(project.id);
      }
    }

    if (recovered > 0) {
      this.log.info('Orphan recovery complete', { stepsRecovered: recovered });
    }
    return recoveredIds;
  }

  // ── Execution ───────────────────────────────────────────

  /**
   * Execute the next pending step in a project.
   */
  /**
   * Atomically acquire the per-project execution lock. Loops until the slot is
   * free, then claims it in the same JS tick (no await between `get` and `set`
   * — Node's single-threaded run-to-completion guarantees atomicity within a
   * tick). Returns a release function callers must invoke in `finally`.
   *
   * Fixes the TOCTOU race in the old check-then-set pattern where two
   * concurrent callers could both see `existingLock === undefined`, both
   * `set` their own lock, and the first's `finally { delete }` would erase
   * the second's lock entry — leaving the second running without protection.
   */
  private async acquireExecutionLock(projectId: string, waitLog: string): Promise<() => void> {
    let warned = false;
    while (true) {
      const existing = this.executingProjects.get(projectId);
      if (!existing) {
        let resolver!: () => void;
        const promise = new Promise<void>(r => { resolver = r; });
        // get + set in the same tick — no await between them. Safe.
        this.executingProjects.set(projectId, { resolve: resolver, promise });
        return () => {
          this.executingProjects.delete(projectId);
          resolver();
        };
      }
      if (!warned) { this.log.info(waitLog, { projectId }); warned = true; }
      await existing.promise;
      // Loop back: another caller might have grabbed it before us.
    }
  }

  async executeNextStep(projectId: string): Promise<string | null> {
    const releaseGlobal = await this.acquireGlobalLock(`Waiting for global GPU slot before executing single step for ${projectId}`);
    const releaseProject = await this.acquireExecutionLock(projectId, 'Waiting for previous execution loop to drain before single step');

    try {
      const project = this.stateStore.get(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      this.refreshPendingPrompts(project);
      this.stateStore.save(project);

      const step = this.stateStore.getNextPendingStep(projectId);
      if (!step) {
        this.log.info('No pending steps', { projectId });
        return null;
      }

      return await this.stepRunner.execute(project, step);
    } finally {
      releaseProject();
      releaseGlobal();
    }
  }

  /**
   * Enqueue a project for sequential execution.
   */
  enqueueProject(projectId: string): void {
    const project = this.stateStore.get(projectId);
    if (!project) return;

    if (this.executionQueue.includes(projectId)) {
      this.log.info('Project already queued for execution', { projectId });
      return;
    }

    // Transition project to active immediately so the UI reflects it
    if (project.status !== 'active') {
      project.status = 'active';
      this.stateStore.save(project);
      this.eventBus.emit('project:started', { projectId });
    }

    this.executionQueue.push(projectId);
    this.log.info('Project enqueued for sequential execution', { projectId, queueLength: this.executionQueue.length });

    this.startQueueWorker();
  }

  private async startQueueWorker(): Promise<void> {
    if (this.queueWorkerActive) return;
    this.queueWorkerActive = true;

    try {
      while (this.executionQueue.length > 0) {
        const nextId = this.executionQueue[0];

        const project = this.stateStore.get(nextId);
        if (!project || project.status === 'paused' || project.status === 'completed') {
          this.executionQueue.shift();
          continue;
        }

        this.log.info('Queue worker: starting execution of project', { projectId: nextId });

        try {
          await this.executeAllInternal(nextId);
        } catch (err: any) {
          this.log.error('Queue worker: execution failed for project', { projectId: nextId, error: err.message });
        } finally {
          this.executionQueue.shift();
        }
      }
    } finally {
      this.queueWorkerActive = false;
    }
  }

  /**
   * Execute all remaining steps in a project sequentially (via queue).
   */
  async executeAll(projectId: string): Promise<void> {
    if (!this.stateStore.get(projectId)) throw new Error(`Project not found: ${projectId}`);
    this.enqueueProject(projectId);
  }

  /**
   * Internal execution of all remaining steps (acquires global serialization lock).
   */
  private async executeAllInternal(projectId: string): Promise<void> {
    const releaseGlobal = await this.acquireGlobalLock(`Waiting for global GPU slot before executing project ${projectId}`);
    const releaseProject = await this.acquireExecutionLock(projectId, 'Waiting for previous execution loop to drain');

    try {
      const latest = this.stateStore.get(projectId);
      if (!latest) throw new Error(`Project not found after drain: ${projectId}`);
      this.refreshPendingPrompts(latest);

      // Transition project to active
      latest.status = 'active';
      this.stateStore.save(latest);

      this.eventBus.emit('project:started', { projectId });
      await this.stepRunner.executeAll(latest);

      const final = this.stateStore.get(projectId);
      if (final?.status === 'completed') {
        this.eventBus.emit('project:completed', { projectId });
      }
    } finally {
      releaseProject();
      releaseGlobal();
    }
  }

  /**
   * Pause a running project.
   */
  pauseProject(projectId: string): boolean {
    const project = this.stateStore.get(projectId);
    if (!project) return false;
    project.status = 'paused';
    this.stateStore.save(project);
    this.eventBus.emit('project:paused', { projectId });
    
    // Flush VRAM when project is paused
    this.stepRunner.flushOllamaVram().catch(err => {
      this.log.warn('Failed to flush Ollama VRAM on pause', { error: String(err) });
    });

    return true;
  }

  /**
   * Reset a single step back to pending so it can be re-executed.
   * Feature 4: Chapter Re-Roll — allows selective regeneration.
   */
  resetStep(projectId: string, stepId: string): boolean {
    const project = this.stateStore.get(projectId);
    if (!project) return false;
    const step = project.steps.find(s => s.id === stepId);
    if (!step) return false;

    const doReset = (s: typeof step) => {
      s.status = 'pending';
      s.result = undefined;
      s.error = undefined;
      s.startedAt = undefined;
      s.completedAt = undefined;
    };

    doReset(step);

    // Auto-reset the compile step for the chapter if a segment is rewritten
    if ((step.taskType === 'creative_writing' || step.taskType === 'revision_execution') && step.chapterNumber !== undefined) {
      const compileStep = project.steps.find(s => s.chapterNumber === step.chapterNumber && s.taskType === 'draft_compile');
      if (compileStep && (compileStep.status === 'completed' || compileStep.status === 'failed')) {
        doReset(compileStep);
        this.log.info('Auto-reset compile step due to segment rewrite', { projectId, stepId: compileStep.id });
      }
    }

    // Recalculate progress
    const completed = project.steps.filter(s => s.status === 'completed').length;
    project.progress = Math.round((completed / project.steps.length) * 100);
    // Fix 6: use 'paused' not 'pending' — the project has work to do but no
    // runner is active. 'pending' was confusing because nothing auto-starts it.
    if (project.status === 'completed') project.status = 'paused';
    this.stateStore.save(project);
    this.log.info('Step reset for re-roll', { projectId, stepId, label: step.label });
    return true;
  }

  /**
   * Reset multiple steps back to pending for batch re-execution.
   */
  resetSteps(projectId: string, stepIds: string[]): boolean {
    const project = this.stateStore.get(projectId);
    if (!project) return false;
    
    let modified = false;

    const doReset = (s: any) => {
      s.status = 'pending';
      s.result = undefined;
      s.error = undefined;
      s.startedAt = undefined;
      s.completedAt = undefined;
      modified = true;
    };

    for (const stepId of stepIds) {
      const step = project.steps.find(s => s.id === stepId);
      if (step && (step.status === 'completed' || step.status === 'failed')) {
        doReset(step);

        // Auto-reset the compile step for the chapter if a segment is rewritten
        if ((step.taskType === 'creative_writing' || step.taskType === 'revision_execution') && step.chapterNumber !== undefined) {
          const compileStep = project.steps.find(s => s.chapterNumber === step.chapterNumber && s.taskType === 'draft_compile');
          if (compileStep && (compileStep.status === 'completed' || compileStep.status === 'failed')) {
            doReset(compileStep);
          }
        }
      }
    }
    
    if (!modified) return false;

    // Recalculate progress
    const completed = project.steps.filter(s => s.status === 'completed').length;
    project.progress = Math.round((completed / project.steps.length) * 100);
    if (project.status === 'completed') project.status = 'paused';
    
    this.stateStore.save(project);
    this.log.info('Batch steps reset for re-roll', { projectId, count: stepIds.length });
    return true;
  }

  refreshCustomTemplates(): void {
    if (this.customPipelineService) {
      for (const tpl of this.customPipelineService.getTemplates()) {
        this.templates.register(tpl);
      }
    }
  }

  listTemplates(): Array<{ type: string; name: string; description: string; workType: string }> {
    this.refreshCustomTemplates();
    return this.templates.list().map(t => ({
      type: t.type,
      name: t.name,
      description: t.description,
      workType: t.workType,
    }));
  }

  // ── Accessors ───────────────────────────────────────────

  getStateStore(): StateStore {
    return this.stateStore;
  }

  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  private seedPresetsIfEmpty(): void {
    try {
      const existing = this.stateStore.list();
      const hasPresets = existing.some(p => p.title.includes('Shattered Realm') || p.title.includes('The Last Synapse'));
      if (hasPresets) {
        return;
      }

      this.log.info('Seeding preset parent-child projects across domains...');

      // 1. Books Domain presets
      const bookParent = this.createProject({
        type: 'book-planning',
        title: 'Novel: The Last Synapse',
        description: 'A cyberpunk mystery novel about a detective investigating the murder of a digital consciousness. Set in Neo-Tokyo, 2188.',
        context: { targetChapters: 12, targetWordsPerChapter: 2500 }
      });

      this.createProject({
        type: 'style-calibration',
        title: 'Style Calibration: Cyberpunk Noir',
        description: 'Calibrate the prose style for Novel: The Last Synapse. The goal is to establish a hardboiled cyberpunk tone with dense noir textures and low contraction rate.',
        parentId: bookParent.id,
        context: { targetChapters: 5, targetWordsPerChapter: 2000, penNameSlug: 'cyber-noir-detective' }
      });

      // 2. D&D Domain presets
      const dndParent = this.createProject({
        type: 'dnd-campaign-planning',
        title: 'Epic Campaign: The Shattered Realm',
        description: 'Plan a high-fantasy campaign centered around a collapsing elemental realm. The players must find the core anchors before the sky-isles fall into the abyss.'
      });

      this.createProject({
        type: 'dnd-session-prep',
        title: 'Session 1: The Whispering Caves',
        description: 'The party starts at an outpost on the edge of the elemental rift. They find a map leading to the Whispering Caves where an elemental anchor is rumored to be.',
        parentId: dndParent.id
      });

      // 3. Meta / Admin Domain presets
      const metaParent = this.createProject({
        type: 'system-evolution',
        title: 'Workspace Observation & Tuning',
        description: 'Observe agent interactions across domains, detect optimization areas, and auto-apply refined skills.'
      });

      this.createProject({
        type: 'template-generator',
        title: 'Automated Pipeline Synthesis',
        description: 'Extract templates and configure playbooks based on successful project runs.',
        parentId: metaParent.id
      });

      this.log.info('Successfully seeded preset projects.');
    } catch (err: any) {
      this.log.error('Failed to seed preset projects', { error: err.message });
    }
  }
}
