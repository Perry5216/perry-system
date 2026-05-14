/**
 * @perry/dashboard-api — Server Configuration
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { ProjectEngine } from '@perry/projects';
import { AIRouter } from '@perry/ai';
import { EventBus, Logger } from '@perry/core';
import { setupProjectRoutes } from './routes/projects.js';
import { setupSystemRoutes } from './routes/system.js';
import { setupExportRoutes } from './routes/export.js';
import { setupCoverRoutes } from './routes/cover.js';
import { setupIntegrationRoutes } from './routes/integration.js';
import { createAuthMiddleware } from './middleware/auth.js';

export function createServer(
  projectEngine: ProjectEngine,
  aiRouter: AIRouter,
  eventBus: EventBus,
  log: Logger,
  workspaceDir: string,
) {
  const app = express();

  // CORS — allow dashboard origin (configurable via env)
  const allowedOrigins = (process.env.PERRY_CORS_ORIGINS || 'http://localhost:5173,http://localhost:4000').split(',');
  app.use(cors({
    origin: allowedOrigins,
    credentials: true,
  }));
  app.use(express.json({ limit: '50mb' }));

  // Auth middleware — runs before all API routes
  app.use('/api', createAuthMiddleware(log.child('auth')));

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
    const events: Array<keyof import('@perry/core').EventMap> = ['step:started', 'step:progress', 'step:completed', 'step:failed', 'project:paused'];
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
  app.use('/api/system', setupSystemRoutes(aiRouter, projectEngine, log));
  app.use('/api/export', setupExportRoutes(log));
  app.use('/api/cover', setupCoverRoutes(workspaceDir, log.child('cover')));
  app.use('/api/integration', setupIntegrationRoutes(projectEngine, log.child('integration')));

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
