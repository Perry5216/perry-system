/**
 * @perry/dashboard-api — Server Configuration
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { ProjectEngine, StateStore, AuditService, PenProfileService, DomainRegistry } from '@perry/projects';
import { AIRouter } from '@perry/ai';
import { EventBus, Logger, SecretsService } from '@perry/core';
import type { RagService, MemoryStore } from '@perry/rag';
import { setupProjectRoutes } from './routes/projects.js';
import { setupSystemRoutes } from './routes/system.js';
import { setupExportRoutes } from './routes/export.js';
import { setupCoverRoutes } from './routes/cover.js';
import { setupIntegrationRoutes } from './routes/integration.js';
import { setupPensRoutes } from './routes/pens.js';
import { setupAgentRoutes } from './routes/agents.js';
import { setupSecretsRoutes } from './routes/secrets.js';
import { setupModelsRoutes } from './routes/models.js';
import { setupSessionsRoutes } from './routes/sessions.js';
import { setupSkillsRoutes } from './routes/skills.js';
import { setupAnalyticsRoutes } from './routes/analytics.js';
import { setupLearningRoutes } from './routes/learning.js';
import { setupDomainsRoutes } from './routes/domains.js';
import { setupOperatorRoutes } from './routes/operator.js';
import { setupCronRoutes } from './routes/cron.js';
import { setupOpenAICompatRoutes } from './routes/openai-compat.js';
import { setupSearchRoutes } from './routes/search.js';
import { setupVoiceRoutes } from './routes/voice.js';
import { setupPluginsRoutes } from './routes/plugins.js';
import { createAuthMiddleware } from './middleware/auth.js';
import type { GarbageCollector } from './services/garbage-collector.js';
import type { GatewayManager } from './services/gateway-manager.js';

export function createServer(
  projectEngine: ProjectEngine,
  aiRouter: AIRouter,
  eventBus: EventBus,
  log: Logger,
  workspaceDir: string,
  stateStore: StateStore,
  gc: GarbageCollector,
  secrets: SecretsService,
  gateways: GatewayManager,
  ragService?: RagService,
  memoryStore?: MemoryStore,
  chatMemory?: import('./services/chat-memory-service.js').ChatMemoryService,
  learningCore?: import('./services/learning-core.js').LearningCore,
  skillEvolution?: import('./services/skill-evolution.js').SkillEvolution,
  operatorProfile?: import('./services/operator-profile-service.js').OperatorProfileService,
  cronService?: import('./services/cron-service.js').CronService,
  pluginManager?: import('./services/plugin-manager.js').PluginManager,
) {
  const app = express();

  // CORS — allow dashboard origin (configurable via env)
  const allowedOrigins = (process.env.PERRY_CORS_ORIGINS || 'http://localhost:5173,http://localhost:4000').split(',');
  app.use(cors({
    origin: allowedOrigins,
    credentials: true,
  }));
  app.use(express.json({ limit: '50mb' }));

  // Auth middleware — runs before all API routes (and /v1 OpenAI-compat)
  app.use('/api', createAuthMiddleware(log.child('auth'), secrets));
  app.use('/v1', createAuthMiddleware(log.child('auth-v1'), secrets));

  // SSE endpoint for realtime events
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    const onEvent = (event: string, payload: any) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch { /* client disconnected */ }
    };

    // Wire up events — store references for cleanup
    const listeners: Array<{ event: string; handler: (...args: any[]) => void }> = [];
    const events: Array<keyof import('@perry/core').EventMap> = [
      'step:started', 'step:progress', 'step:completed', 'step:failed', 'project:paused',
      // Agent system events drive Fleet v2 activity trails + bottom feed.
      'agent:invocation:started', 'agent:invocation:completed', 'agent:invocation:failed',
    ];
    for (const evt of events) {
      const handler = (p: any) => onEvent(evt, p);
      eventBus.on(evt, handler);
      listeners.push({ event: evt, handler });
    }

    // Heartbeat every 30s to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 30_000);

    // Push context stats every 2s to the dashboard
    const ctxStatsPush = setInterval(() => {
      try {
        const stats = aiRouter.contextWatcher.getStats();
        res.write(`event: context:stats\ndata: ${JSON.stringify(stats)}\n\n`);
      } catch { clearInterval(ctxStatsPush); }
    }, 2_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(ctxStatsPush);
      // Clean up all listeners to prevent memory leak
      for (const { event, handler } of listeners) {
        eventBus.off(event as any, handler);
      }
    });
  });

  app.use('/api/projects', setupProjectRoutes(projectEngine, log));
  app.use('/api/system', setupSystemRoutes(aiRouter, projectEngine, log, gc, secrets, ragService));
  app.use('/api/export', setupExportRoutes(log));
  app.use('/api/cover', setupCoverRoutes(workspaceDir, log.child('cover'), ragService));
  app.use('/api/integration', setupIntegrationRoutes(projectEngine, log.child('integration')));
  // PenProfileService writes per-pen SOUL.md + LESSONS.md after audits and
  // on GC sweeps. PromptBuilder reads those files via late-binding so it can
  // skip re-rendering pen anti-patterns from raw data on every chapter call.
  const penProfileService = new PenProfileService(stateStore, workspaceDir, log.child('pen-profile'));
  try { projectEngine.getPromptBuilder().setPenProfileService(penProfileService); }
  catch (e: any) { log.warn('failed to inject PenProfileService into PromptBuilder', { error: e.message }); }
  const auditService = new AuditService(stateStore, workspaceDir, log.child('audit'), ragService, penProfileService, eventBus);
  app.use('/api/pens', setupPensRoutes(stateStore, log.child('pens'), workspaceDir, projectEngine.getAutoLearning(), auditService, penProfileService));
  // Sessions browser — FTS5 keyword search over completed step outputs.
  app.use('/api/sessions', setupSessionsRoutes(stateStore, log.child('sessions')));
  // Skills librarian — list installed + pending, promote, reject.
  app.use('/api/skills', setupSkillsRoutes(log.child('skills'), workspaceDir, stateStore, aiRouter));
  // Analytics — step volume, success rate, prompt sizes, audit health,
  // and learning-corpus snapshot (chunk counts by kind).
  app.use('/api/analytics', setupAnalyticsRoutes(stateStore, log.child('analytics'), memoryStore));
  // Surface per-producer learning telemetry counters so the dashboard can
  // show "the system is actually observing" before the first skill fires.
  app.use('/api/learning', setupLearningRoutes(stateStore, workspaceDir, log.child('learning'), learningCore, skillEvolution));
  // Domain registry — define new task verticals (code-review, security-research,
  // etc.) and configure which dashboard panels each surfaces. The "books"
  // built-in is auto-seeded on first boot.
  const domainRegistry = new DomainRegistry({ workspaceDir, log: log.child('domains') });
  app.use('/api/domains', setupDomainsRoutes(domainRegistry, log.child('domains')));
  // Operator profile (User Modeling) — builds a dialectic model of the human
  // driving Perry across sessions. Updated on every project create / skill
  // curate / chat / step edit event; distillable via librarian.
  if (operatorProfile) {
    app.use('/api/operator', setupOperatorRoutes(operatorProfile, aiRouter, log.child('operator')));
  }
  // Cron — scheduled task runner. Jobs live as JSON files in workspace/cron/.
  // Minute-aligned ticks; supports execute-project / execute-step / emit-event
  // actions for now.
  if (cronService) {
    app.use('/api/cron', setupCronRoutes(cronService, log.child('cron')));
  }
  // Generic web search — env-keyed backends (Tavily / Exa / Firecrawl).
  // Domain-agnostic; lets any task pull general web context, not just the
  // book scout's hardcoded sources.
  app.use('/api/search', setupSearchRoutes(log.child('search')));
  // OpenAI-compatible API — turn Perry into a model that any external chat
  // app (ChatBox, LibreChat, NextChat, Open WebUI, custom scripts) can call
  // via the standard /v1/chat/completions endpoint.
  app.use('/v1', setupOpenAICompatRoutes(projectEngine, aiRouter, log.child('openai-compat')));
  // Voice — TTS (edge-tts) + STT (faster-whisper) via the perry-voice sidecar.
  // Sidecar is opt-in (docker compose up -d perry-voice); routes return 503
  // with a clear hint if it isn't running.
  app.use('/api/voice', setupVoiceRoutes(log.child('voice')));
  // Plugins — operator-installed JS files at workspace/plugins/. Plugin
  // routes mount under /api/plugin/{name}/ via the PluginManager's router.
  if (pluginManager) {
    app.use('/api/plugins', setupPluginsRoutes(pluginManager, log.child('plugins')));
    app.use('/api/plugin', pluginManager.router);
  }

  // Agent system routes — registry, sessions, invocations. Mounted at /api
  // so internal paths /agents/*, /sessions/*, /invocations/*, /domains coexist
  // cleanly under one router.
  app.use('/api', setupAgentRoutes({
    aiRouter,
    projectEngine,
    mcpClient: projectEngine.getMcpClient(),
    eventBus,
    log: log.child('agents'),
    chatMemory,
  }));

  // Secrets vault management — /api/secrets, /api/secrets-audit.
  app.use('/api', setupSecretsRoutes(secrets, log.child('secrets')));

  // Model management — /api/models, /api/models/pull, /api/models/show,
  // /api/models/suggestions. Wraps Ollama HTTP API directly.
  app.use('/api', setupModelsRoutes(aiRouter, log.child('models')));

  // Messaging-gateway status + admin (restart on credential change).
  app.get('/api/gateways', (_req, res) => {
    res.json({ gateways: gateways.statuses() });
  });
  app.post('/api/gateways/:platform/restart', async (req, res) => {
    try {
      await gateways.restart(req.params.platform);
      res.json({ ok: true, platform: req.params.platform });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // WhatsApp pairing QR — first connection only; returns 404 once paired.
  // Embed in dashboard as: <img src="/api/gateways/whatsapp/qr" />
  app.get('/api/gateways/whatsapp/qr', (_req, res) => {
    const wa = gateways.getWhatsAppGateway?.();
    if (!wa) return res.status(503).json({ error: 'whatsapp gateway not instantiated' });
    const dataUrl = wa.getQRDataUrl();
    if (!dataUrl) return res.status(404).json({ error: 'no QR available — gateway paired or not started' });
    // dataUrl is "data:image/png;base64,...". Decode and stream PNG bytes.
    const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!m) return res.status(500).json({ error: 'malformed QR data url' });
    const buf = Buffer.from(m[2], 'base64');
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  });

  // Send a WhatsApp message programmatically — used by external scripts /
  // plugins to push notifications. Body: { jid: "447700900000@s.whatsapp.net", text: "..." }
  app.post('/api/gateways/whatsapp/send', async (req, res) => {
    const wa = gateways.getWhatsAppGateway?.();
    if (!wa) return res.status(503).json({ error: 'whatsapp gateway not instantiated' });
    const { jid, text } = req.body || {};
    if (typeof jid !== 'string' || typeof text !== 'string') {
      return res.status(400).json({ error: 'jid (string) and text (string) required' });
    }
    const result = await wa.sendMessage(jid, text);
    if (!result.ok) return res.status(500).json(result);
    res.json(result);
  });

  // Serve Dashboard UI in production
  if (process.env.NODE_ENV === 'production') {
    const dashboardDist = path.join(process.cwd(), 'packages', 'dashboard', 'dist');
    app.use(express.static(dashboardDist));
    app.get('*', (req, res) => {
      res.sendFile(path.join(dashboardDist, 'index.html'));
    });
  }

  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    log.error('API Error', { error: err.message, path: req.path });
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  });

  return app;
}
