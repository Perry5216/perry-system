/**
 * @perry/projects — Project Engine
 *
 * Top-level orchestrator for project lifecycle. Thin wrapper over
 * StateStore, TemplateRegistry, and StepRunner.
 */

import {
  Project, ProjectType, ProjectContext, EventBus, Logger, McpClientService
} from '@perry/core';
import type { AIRouter } from '@perry/ai';
import type { ContextEngine } from '@perry/rag';
import { StateStore } from './state-store.js';
import { StepRunner } from './step-runner.js';
import { PromptBuilder } from './prompt-builder.js';
import { TemplateRegistry } from './templates.js';
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
  private director: DirectorAgent;

  // Per-project execution lock: tracks which projects have an active loop
  // and provides a drain promise so resume can wait for the old loop to exit.
  private executingProjects = new Map<string, {
    resolve: () => void;
    promise: Promise<void>;
  }>();

  constructor(
    stateStore: StateStore,
    router: AIRouter,
    contextEngine: ContextEngine,
    eventBus: EventBus,
    log: Logger,
    config: ProjectEngineConfig,
  ) {
    this.stateStore = stateStore;
    this.templates = new TemplateRegistry();
    this.promptTemplates = new PromptTemplateService(config.workspaceDir, log.child('templates'));
    this.eventBus = eventBus;
    this.log = log;
    this.workspaceDir = config.workspaceDir;
    this.contextEngine = contextEngine;

    // Load custom pipeline skeletons
    const customPipelineService = new CustomPipelineService(config.workspaceDir, log.child('pipelines'));
    for (const tpl of customPipelineService.getTemplates()) {
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

    const mcpClient = new McpClientService(config.config, log.child('mcp'));
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
      log.child('director')
    );

    // Recover orphaned "active" steps left behind by a container restart
    this.recoverOrphanedSteps();

    // Run Garbage Collection asynchronously on boot
    setTimeout(() => {
      this.purgeGhostData().catch(err => {
        this.log.error('Garbage Collector failed on boot', { error: err.message });
      });
    }, 5000); // Give the system 5 seconds to settle before sweeping
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
          targetChapters: sourceProject.context.targetChapters,
          targetWordsPerChapter: sourceProject.context.targetWordsPerChapter,
          includePrologue: sourceProject.context.includePrologue,
          includeEpilogue: sourceProject.context.includeEpilogue,
        };

        // Style Calibration uses targetChapters as "number of passes" —
        // a completely different meaning from the parent's chapter count.
        // Never inherit it; always use the user's explicit input.
        if (input.type === 'style-calibration') {
          delete inheritedContext.targetChapters;
        }

        // For revision templates, also inherit per-chapter word counts
        const isRevisionTemplate = input.type === 'deep-revision' || input.type === 'revision-execution';
        if (isRevisionTemplate) {
          const chapterWordCounts: Record<number, number> = {};
          for (const step of sourceProject.steps) {
            if (step.taskType === 'creative_writing' && step.chapterNumber !== undefined && step.result) {
              chapterWordCounts[step.chapterNumber] = step.result.trim().split(/\s+/).length;
            }
          }
          inheritedContext.chapterWordCounts = chapterWordCounts;
        }

        this.log.info('Inherited context from parent project', {
          sourceProjectId: sourceProject.id,
          sourceTitle: sourceProject.title,
          targetChapters: inheritedContext.targetChapters,
          targetWordsPerChapter: inheritedContext.targetWordsPerChapter,
        });

        // Style Calibration: auto-populate description from parent book bible.
        // IMPORTANT: stateStore.get() returns steps with result=placeholder string.
        // Real content is in: (1) steps table in SQLite, (2) markdown files on disk.
        // We use the steps table first, disk files as fallback.
        if (input.type === 'style-calibration' && !input.description) {
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

    const context: ProjectContext = {
      targetChapters: 25,
      targetWordsPerChapter: 3000,
      hasParent: !!input.parentId,
      ...input.context,      // explicit user values (often defaults from UI)
      ...inheritedContext,   // parent values MUST override defaults + UI defaults
    };

    let steps = template.buildSteps(context, input.title, input.description);
    
    // Apply dynamic prompt overrides
    steps = this.promptTemplates.applyOverrides(input.type, steps);

    const project: Project = {
      id,
      parentId: input.parentId,
      type: input.type,
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
    
    // Feature 7: Payload Compression
    // Strip heavy text fields for the list view to prevent network/memory hangs
    // especially for large 100k+ word manuscripts. The UI only needs metadata.
    // The actual text is now safely mirrored to the workspace filesystem.
    return all.map(p => {
      const lightweight = { ...p };
      lightweight.steps = p.steps.map(s => ({
        ...s,
        prompt: '[Prompt hidden for performance]',
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
        fs.rmSync(f, { force: true });
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
  private recoverOrphanedSteps(): void {
    const projects = this.stateStore.list();
    let recovered = 0;

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
      }
    }

    if (recovered > 0) {
      this.log.info('Orphan recovery complete', { stepsRecovered: recovered });
    }
  }

  // ── Execution ───────────────────────────────────────────

  /**
   * Execute the next pending step in a project.
   */
  async executeNextStep(projectId: string): Promise<string | null> {
    // 🔒 Per-project lock: wait for any in-flight execution to fully drain 🔒
    const existingLock = this.executingProjects.get(projectId);
    if (existingLock) {
      this.log.info('Waiting for previous execution loop to drain before single step', { projectId });
      await existingLock.promise;
    }

    const project = this.stateStore.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const step = this.stateStore.getNextPendingStep(projectId);
    if (!step) {
      this.log.info('No pending steps', { projectId });
      return null;
    }

    // Create a new lock for this execution
    let lockResolve!: () => void;
    const lockPromise = new Promise<void>(r => { lockResolve = r; });
    this.executingProjects.set(projectId, { resolve: lockResolve, promise: lockPromise });

    try {
      return await this.stepRunner.execute(project, step);
    } finally {
      this.executingProjects.delete(projectId);
      lockResolve();
    }
  }

  /**
   * Execute all remaining steps in a project sequentially.
   */
  async executeAll(projectId: string): Promise<void> {
    const project = this.stateStore.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    // ── Per-project lock: wait for any in-flight execution to fully drain ──
    const existingLock = this.executingProjects.get(projectId);
    if (existingLock) {
      this.log.info('Waiting for previous execution loop to drain', { projectId });
      await existingLock.promise;
    }

    // Re-check project state after drain — it may have completed or errored
    const latest = this.stateStore.get(projectId);
    if (!latest) throw new Error(`Project not found after drain: ${projectId}`);

    // Create a new lock for this execution
    let lockResolve!: () => void;
    const lockPromise = new Promise<void>(r => { lockResolve = r; });
    this.executingProjects.set(projectId, { resolve: lockResolve, promise: lockPromise });

    // Transition project to active
    latest.status = 'active';
    this.stateStore.save(latest);

    try {
      this.eventBus.emit('project:started', { projectId });
      await this.stepRunner.executeAll(latest);

      const final = this.stateStore.get(projectId);
      if (final?.status === 'completed') {
        this.eventBus.emit('project:completed', { projectId });
      }
    } finally {
      // Release the lock so future executions can proceed
      this.executingProjects.delete(projectId);
      lockResolve();
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

  // ── Templates ───────────────────────────────────────────

  listTemplates(): Array<{ type: string; name: string; description: string }> {
    return this.templates.list().map(t => ({
      type: t.type,
      name: t.name,
      description: t.description,
    }));
  }

  // ── Accessors ───────────────────────────────────────────

  getStateStore(): StateStore {
    return this.stateStore;
  }

  getWorkspaceDir(): string {
    return this.workspaceDir;
  }
}
