/**
 * @perry/dashboard-api — Entry Point
 */

import { ConfigService, EventBus, Logger, Vault, SecretsService } from '@perry/core';
import { AIRouter } from '@perry/ai';
import { MemoryStore, ContextEngine, EntityIndexer, RagService } from '@perry/rag';
import { ProjectEngine, StateStore, resolvePenAwareWriterModel, NetworkClient, scanLeaks } from '@perry/projects';
import { createServer } from './server.js';
import { join } from 'path';

async function bootstrap() {
  const log = new Logger('system', 'debug');
  log.info('Starting P.E.R.R.Y. System...');

  // Paths
  const WORKSPACE = process.env.PERRY_WORKSPACE || join(process.cwd(), 'workspace');
  const CONFIG_DIR = process.env.PERRY_CONFIG || join(process.cwd(), 'config');

  // 1. Core Services
  const config = new ConfigService(CONFIG_DIR);
  config.load();

  const vault = new Vault(join(CONFIG_DIR, '.vault'));
  vault.load();

  // SecretsService wraps Vault and adds audit + rotation + bootstrap-from-env.
  // The DB handle is attached after state-store initialises so audit rows
  // can land in `secrets_audit`. Until then audit is a no-op (vault still works).
  const secrets = new SecretsService(vault, log.child('secrets'));

  const eventBus = new EventBus();

  // 2. State store — needs to be ready before AI Router so the writer model
  //    can be resolved from pen_name_records (Phase 0 pen-aware writer swap).
  const stateStore = new StateStore(WORKSPACE, log.child('state'));
  await stateStore.initialize();

  // Attach DB to SecretsService so audit log writes work.
  secrets.setDb((stateStore as any).db);

  // Bootstrap-from-env: copy any KNOWN_SECRETS that exist in .env but not
  // yet in the vault. Warns about secrets still present in .env (should
  // be removed after migration). Logs missing required secrets.
  await secrets.bootstrapFromEnv().catch(err => {
    log.error('SecretsService bootstrap failed', { error: err.message });
  });

  // Give NetworkClient access to SecretsService so URLs containing
  // `{{secret_name}}` placeholders resolve to encrypted values at fetch
  // time. Without this, the placeholder would fall through to
  // process.env (legacy behavior) — works but defeats the point.
  NetworkClient.setSecrets(secrets);

  // 3. AI Router (with pen-aware writer model resolved from state-store)
  const aiRouter = new AIRouter(config, vault, log.child('ai'));
  const penAwareModel = resolvePenAwareWriterModel(stateStore, { log: log.child('ai') });
  if (penAwareModel) aiRouter.setWriterModelOverride(penAwareModel);
  // Phase 3: per-request pen-aware resolver. CompletionRequest.penSlug, when
  // present, swaps the writer model for the ollama provider on that request.
  aiRouter.setPenModelResolver((slug) =>
    resolvePenAwareWriterModel(stateStore, { preferredSlug: slug }),
  );
  await aiRouter.initialize();

  // 4. RAG
  const memoryStore = new MemoryStore(WORKSPACE, log.child('memory'));
  await memoryStore.initialize();

  const contextEngine = new ContextEngine(WORKSPACE, memoryStore, log.child('context'));
  contextEngine.registerEvents(eventBus);

  // 4b. Entity Indexer — auto-extracts entities using the Librarian GPU
  const entityIndexer = new EntityIndexer(aiRouter.compressor, contextEngine, log.child('entity-indexer'));
  entityIndexer.registerEvents(eventBus);

  // 4c. RAG service — vector retrieval + drift detection backed by
  //     nomic-embed-text on the 5070 Ti. Wraps MemoryStore's chunks
  //     table + AIRouter.embeddings.
  const ragService = new RagService(memoryStore, aiRouter.embeddings, log.child('rag'));
  // Inject into the prompt-builder so chapter-write steps can retrieve
  // relevant bible chunks instead of dumping the whole bible.
  // (Must run after projectEngine is constructed — moved below.)

  // 4d. Auto-indexer + drift detection — listens for step:completed and
  //     chunks/embeds outputs that benefit from semantic retrieval:
  //     bibles (split into sections for chapter-time retrieval), outlines,
  //     completed chapter prose. Drift scoring runs post-prose and stores
  //     the verdict at meta[`drift_${stepId}`] for dashboard surfacing.
  const LABEL_TO_KIND: Record<string, string> = {
    'character bible':  'bible_character',
    'setting bible':    'bible_setting',
    'story architecture': 'bible_architecture',
    'stat system definition': 'bible_stats',
    'chapter outline':  'outline',
    'book bible':       'bible_world',
    'premise design':   'bible_premise',
  };
  const RAG_LOG = log.child('rag-auto');
  eventBus.on('step:completed', async (payload: any) => {
    try {
      const { projectId, stepId, result } = payload;
      if (!projectId || !stepId || !result || typeof result !== 'string' || result.length < 200) return;
      const project = stateStore.get(projectId);
      if (!project) return;
      const step = project.steps.find(s => s.id === stepId);
      if (!step) return;

      const isProse = step.taskType === 'creative_writing' || step.taskType === 'revision_execution' || step.taskType === 'draft_compile';
      const labelKey = (step.label || '').toLowerCase();
      const bibleKind = Object.entries(LABEL_TO_KIND).find(([prefix]) => labelKey.includes(prefix))?.[1];

      // 1. Prose (chapters / prologue / epilogue) → index for semantic recall
      if (isProse) {
        await ragService.indexText({
          projectId,
          sourceRef: stepId,
          kind: 'chapter',
          text: result,
          replace: true,
          metadata: {
            label: step.label,
            chapterNumber: step.chapterNumber ?? null,
            taskType: step.taskType,
          },
        });

        // Verified-success learning index. Only chapters that pass the
        // voice-screen leak check go into learning_chapter — future
        // generations that pull from this corpus are imitating CLEAN
        // prose, not the full history (which contains failed drafts,
        // anti-pattern outputs, voice drifts). Same scanLeaks() used
        // by the post-LoRA audit so the bar is consistent.
        await ragService.indexIfVerified({
          projectId,
          sourceRef: stepId,
          kind: 'chapter',
          text: result,
          replace: true,
          metadata: {
            label: step.label,
            chapterNumber: step.chapterNumber ?? null,
            taskType: step.taskType,
          },
          gate: () => {
            const leaks = scanLeaks(result);
            if (leaks.length === 0) {
              return { verified: true, reason: 'scanLeaks: 0 hits' };
            }
            const tags = leaks.map(l => l.tag).slice(0, 5).join(',');
            return { verified: false, reason: `scanLeaks: ${leaks.length} hit(s) — ${tags}` };
          },
        });

        // Drift scoring vs the pen-name voice-anchor centroid.
        try {
          const penSlug = (project.context as any)?.penNameSlug;
          if (penSlug) {
            const drift = await ragService.driftScore({
              projectId,
              text: result.slice(0, 8000),   // sample top of chapter — enough for voice signal
              centroidKind: 'voice_anchor',
              centroidProjectId: `pen:${penSlug}`,   // centroid stored under a virtual pen-wide project id
            });
            if (drift && drift.score !== null) {
              stateStore.setMeta(`drift_${stepId}`, JSON.stringify({
                score: drift.score,
                centroidProjectId: drift.centroidProjectId,
                recordedAt: new Date().toISOString(),
                chapter: step.chapterNumber ?? null,
                label: step.label,
              }));
              RAG_LOG.info('drift score recorded', {
                step: step.label, score: drift.score.toFixed(3),
              });
            }
          }
        } catch (e: any) {
          RAG_LOG.warn('drift score failed (non-fatal)', { step: step.label, error: e.message });
        }
        return;
      }

      // 2. Bibles / outline / architecture → index per-section so chapter
      //    prompts can pull only relevant slices.
      if (bibleKind) {
        await ragService.indexText({
          projectId, sourceRef: stepId, kind: bibleKind, text: result, replace: true,
          metadata: { label: step.label, taskType: step.taskType },
        });
      } else if (
        // Visibility into the silent-drop case the audit flagged: planning-
        // phase outputs that didn't match LABEL_TO_KIND. If a new step label
        // gets added in templates.ts without a matching entry here, the
        // chunk index never gets populated for that source, and chapter
        // prompts that retrieve from it silently get nothing. Log so the
        // mismatch is discoverable instead of silently failing.
        ['planning', 'bible', 'outline'].includes(step.phase) &&
        ['book_bible', 'outline', 'planning'].includes(step.taskType) &&
        result.length > 1000
      ) {
        RAG_LOG.info('planning step completed but no LABEL_TO_KIND match — chunk index not populated', {
          label: step.label,
          taskType: step.taskType,
          phase: step.phase,
          hint: 'add a substring entry to LABEL_TO_KIND in dashboard-api/src/index.ts to enable RAG retrieval for this step',
        });
      }
    } catch (err: any) {
      RAG_LOG.warn('auto-index failed', { error: err.message });
    }
  });

  // ── Writer model warm-keeper ──
  // Fires a tiny no-op chat every 12 minutes against the writer Ollama so the
  // model stays loaded across long idle periods. The keep_alive=15m on real
  // calls handles active pipeline runs; this is the safety net for when the
  // user steps away. Cheap: ~50ms per ping, single-token generation.
  const WARM_INTERVAL_MS = 12 * 60_000;
  let warmKeeperActive = true;
  const warmKeeperTick = async () => {
    if (!warmKeeperActive) return;
    try {
      const ollamaEndpoint = aiRouter.config.get<string>('ai.ollama.endpoint', 'http://ollama:11434');
      const writerModel = aiRouter.config.get<string>('ai.ollama.model', '');
      if (!writerModel) return;   // no writer configured — nothing to keep warm
      await fetch(`${ollamaEndpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: writerModel,
          messages: [{ role: 'user', content: ' ' }],
          stream: false,
          keep_alive: '15m',
          options: { num_predict: 1, temperature: 0 },
        }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => { /* warm-keep is best-effort; ignore */ });
    } catch { /* swallow */ }
  };
  setTimeout(() => void warmKeeperTick(), 30_000);
  setInterval(() => void warmKeeperTick(), WARM_INTERVAL_MS);

  // ── Pen-wide voice-anchor centroid sync ──
  // Mirrors voice_anchors_{slug} entries into the chunks table under the
  // virtual project id `pen:{slug}`. Runs on boot + every 5 minutes. The
  // drift centroid is computed from these chunks. Cheap because anchors
  // change rarely and the embed cache hides most of the cost.
  const syncAnchorCentroid = async () => {
    try {
      if (!(await aiRouter.embeddings.isAvailable())) return;
      const rows = (stateStore as any).db
        .prepare("SELECT key, value FROM meta WHERE key LIKE 'voice_anchors_%'").all() as Array<{ key: string; value: string }>;
      for (const row of rows) {
        const slug = row.key.replace(/^voice_anchors_/, '');
        if (!slug) continue;
        let anchors: any[] = [];
        try { anchors = JSON.parse(row.value); } catch { continue; }
        const projectId = `pen:${slug}`;
        for (const a of anchors) {
          if (!a?.id || a.active === false) continue;
          const text = a.prose || a.text;
          if (!text || text.length < 80) continue;
          await ragService.indexText({
            projectId,
            sourceRef: a.id,
            kind: 'voice_anchor',
            text,
            replace: false,   // anchors are stable — skip if already chunked
            metadata: { tier: a.tier, sourceType: a.sourceType },
          });
        }
      }
    } catch (e: any) {
      RAG_LOG.warn('voice anchor centroid sync failed', { error: e.message });
    }
  };
  // Defer first sync by 8s so the rest of the boot path doesn't race embedding readiness.
  setTimeout(() => void syncAnchorCentroid(), 8_000);
  setInterval(() => void syncAnchorCentroid(), 5 * 60_000);

  const projectEngine = new ProjectEngine(
    stateStore,
    aiRouter,
    contextEngine,
    eventBus,
    log.child('engine'),
    {
      workspaceDir: WORKSPACE,
      maxRetries: 3,
      minResponseLength: 100,
      config: config,
    },
  );
  // Now that projectEngine is built, late-bind RagService into the prompt-builder.
  try { projectEngine.getPromptBuilder().setRagService(ragService); }
  catch (e: any) { log.warn('failed to inject RagService into PromptBuilder', { error: e.message }); }
  // Same for the EventBus so prompt-builder can emit learning:* events.
  try { projectEngine.getPromptBuilder().setEventBus(eventBus); }
  catch (e: any) { log.warn('failed to inject EventBus into PromptBuilder', { error: e.message }); }

  // Cross-process bridge: drains worker_done_* meta breadcrumbs written by
  // mcp-server's report_task handler and indexes them as learning_worker_task.
  // Closes the self-learning loop for worker outputs that don't go through
  // the dashboard-api's own step:completed handler.
  const { LearningBridge } = await import('./services/learning-bridge.js');
  const learningBridge = new LearningBridge(stateStore, ragService, log.child('learning-bridge'));
  learningBridge.start();

  // 5. Long-running services (constructed before server so routes can access).
  // Worker coordinator owns all assist-worker spawn decisions and POSTs
  // them to perry-worker over HTTP. GC sweeps stale state every 6h.
  const { WorkerCoordinator } = await import('./services/worker-coordinator.js');
  const coordinator = new WorkerCoordinator(projectEngine);

  // Chat memory ("soul") — distills closed/idle LandingChat sessions through
  // the Librarian into workspace/chat-memory/global.md, which the director
  // agent loads at the start of every new chat. Closes the cross-session
  // learning loop for the dashboard chat.
  const { ChatMemoryService } = await import('./services/chat-memory-service.js');
  const chatMemory = new ChatMemoryService(WORKSPACE, stateStore, aiRouter, log.child('chat-memory'));

  // ── Framework-wide self-learning core ─────────────────────────────────
  // LearningCore is the single brain that subscribes to all learning:*
  // events emitted by any service or agent, tracks recurrence by
  // (source, kind, fingerprint), and proposes skills when thresholds
  // cross. Replaces the per-service producer wiring previously scattered
  // through 5 files. New domains (hacking, code, etc.) get learning for
  // free — just emit a learning:* event from anywhere in the domain.
  //
  // AgentLearningBridge translates already-existing agent:invocation:*
  // events into learning:* events so EVERY registered agent gets the
  // loop automatically, no wiring per agent.
  const { SkillProposer } = await import('@perry/core');
  const learningSkillProposer = new SkillProposer({ workspaceDir: WORKSPACE, log: log.child('learning-skills') });
  const { LearningCore } = await import('./services/learning-core.js');
  const learningCore = new LearningCore(eventBus, stateStore, learningSkillProposer, log.child('learning-core'));
  const { AgentLearningBridge } = await import('./services/agent-learning-bridge.js');
  new AgentLearningBridge(eventBus, log.child('agent-learning-bridge'));

  const { GarbageCollector } = await import('./services/garbage-collector.js');
  const gc = new GarbageCollector(projectEngine, memoryStore, chatMemory, eventBus);

  // 6. Messaging gateways (Telegram + Discord). Each gateway checks the
  // vault for its bot token; if absent it stays dormant. Boots even when
  // no gateways are configured — manager.statuses() reports the disabled
  // state for the dashboard's gateway tab.
  const { GatewayManager } = await import('./services/gateway-manager.js');
  const gateways = new GatewayManager({
    aiRouter,
    stateStore: stateStore as any,
    mcpClient: projectEngine.getMcpClient(),
    eventBus,
    secrets,
    log: log.child('gateway'),
  });

  // 7. Server (routes get access to the services they need)
  const app = createServer(projectEngine, aiRouter, eventBus, log.child('api'), WORKSPACE, stateStore, gc, secrets, gateways, ragService, memoryStore, chatMemory, learningCore);

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    log.info(`Dashboard API running on http://localhost:${PORT}`);
    log.info(`Workspace: ${WORKSPACE}`);
  });

  // 8. Start long-running services after the server is listening so any
  // boot-pass effects don't race route setup.
  coordinator.start();
  gc.start();
  void gateways.start();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutdown requested — waiting for in-flight steps (max 60s)...');

    // Wait up to 60 seconds for any active steps to complete
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const activeProjects = projectEngine.listProjects('active');
      if (activeProjects.length === 0) break;
      log.info(`Waiting for ${activeProjects.length} active project(s)...`);
      await new Promise(r => setTimeout(r, 3000));
    }

    log.info('Closing databases...');
    stateStore.close();
    memoryStore.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch(err => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
