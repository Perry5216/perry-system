/**
 * @perry/dashboard-api — System Routes
 */

import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { AIRouter } from '@perry/ai';
import { ProjectEngine } from '@perry/projects';
import { Logger } from '@perry/core';

export function setupSystemRoutes(aiRouter: AIRouter, projectEngine: ProjectEngine, log: Logger) {
  const router = Router();

  router.get('/status', (req, res) => {
    const cacheStats = aiRouter.compressor.getCacheStats();
    const librarianProvider = aiRouter.getProvider('librarian');

    res.json({
      status: 'online',
      providers: aiRouter.getActiveProviders().map((p: any) => ({
        id: p.id,
        name: p.name,
        model: p.model,
      })),
      librarian: {
        available: aiRouter.compressor.isAvailable(),
        model: librarianProvider?.model || 'not configured',
        endpoint: librarianProvider?.providerConfig?.endpoint || 'N/A',
        cache: cacheStats,
      },
      directorModel: aiRouter.config.get<string>('ai.ollama.directorModel', 'qwen3.6:27b'),
      directorProvider: aiRouter.config.get<string>('ai.director.provider', 'ollama'),
    });
  });

  router.get('/templates', (req, res) => {
    res.json(projectEngine.listTemplates());
  });

  router.get('/style-dna', (req, res) => {
    // Try V2 structured JSON first
    const rawV2 = projectEngine.getStateStore().getMeta('style_dna_v2');
    if (rawV2) {
      try {
        const parsed = JSON.parse(rawV2);
        res.json({ content: JSON.stringify(parsed, null, 2), format: 'json' });
        return;
      } catch (e) {
        log.warn('Failed to parse style_dna_v2 JSON for dashboard', { error: e });
      }
    }

    // Fallback to legacy file
    const styleDnaPath = join(projectEngine.getWorkspaceDir(), '.config', 'style-dna.txt');
    if (existsSync(styleDnaPath)) {
      res.json({ content: readFileSync(styleDnaPath, 'utf-8'), format: 'text' });
    } else {
      res.json({ content: '', format: 'text' });
    }
  });

  router.put('/style-dna', (req, res) => {
    try {
      const isJson = req.body.format === 'json' || req.body.content.trim().startsWith('{');
      
      if (isJson) {
        // Validate and save to SQLite
        const parsed = JSON.parse(req.body.content);
        projectEngine.getStateStore().setMeta('style_dna_v2', JSON.stringify(parsed));
        res.json({ success: true, format: 'json' });
      } else {
        // Legacy file save
        const styleDnaPath = join(projectEngine.getWorkspaceDir(), '.config', 'style-dna.txt');
        const dir = dirname(styleDnaPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(styleDnaPath, req.body.content || '', 'utf-8');
        res.json({ success: true, format: 'text' });
      }
    } catch (error: any) {
      log.error('Failed to save Style DNA', { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  // Feature 7: Compression Stats
  router.get('/compression-stats', (req, res) => {
    res.json({
      librarianAvailable: aiRouter.compressor.isAvailable(),
      cache: aiRouter.compressor.getCacheStats(),
    });
  });

  // Feature 8: Garbage Collection (Purge Ghost Data)
  router.post('/purge-cache', async (req, res) => {
    try {
      const stats = await projectEngine.purgeGhostData();
      res.json({ success: true, stats });
    } catch (error: any) {
      log.error('Failed to purge cache', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Feature 9: Context Watcher Stats (GPU context fill levels)
  router.get('/context-stats', async (req, res) => {
    try {
      // Force a fresh poll before returning
      await aiRouter.contextWatcher.pollAll();
      const stats = aiRouter.contextWatcher.getStats();
      res.json(stats);
    } catch (error: any) {
      log.error('Failed to get context stats', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Feature 10: Health Check (Docker healthcheck + monitoring)
  router.get('/health', async (req, res) => {
    const checks: Record<string, { status: 'ok' | 'warn' | 'fail'; detail?: string }> = {};

    // Check Writer GPU
    try {
      const writerProvider = aiRouter.getProvider('ollama');
      if (writerProvider) {
        const reachable = await writerProvider.checkAvailability();
        checks.writer = reachable ? { status: 'ok' } : { status: 'fail', detail: 'unreachable' };
      } else {
        checks.writer = { status: 'warn', detail: 'not configured' };
      }
    } catch {
      checks.writer = { status: 'fail', detail: 'connection error' };
    }

    // Check Librarian GPU
    try {
      const libProvider = aiRouter.getProvider('librarian');
      if (libProvider) {
        const reachable = await libProvider.checkAvailability();
        checks.librarian = reachable ? { status: 'ok' } : { status: 'fail', detail: 'unreachable' };
      } else {
        checks.librarian = { status: 'warn', detail: 'not configured' };
      }
    } catch {
      checks.librarian = { status: 'fail', detail: 'connection error' };
    }

    // Check SQLite
    try {
      const projectCount = projectEngine.listProjects().length;
      checks.database = { status: 'ok', detail: `${projectCount} projects` };
    } catch {
      checks.database = { status: 'fail', detail: 'query failed' };
    }

    // Context Watcher
    const ctxStats = aiRouter.contextWatcher.getStats();
    checks.contextWatcher = {
      status: ctxStats.globalRisk === 'high' ? 'warn' : 'ok',
      detail: `${ctxStats.gpus.length} GPUs, risk: ${ctxStats.globalRisk}`,
    };

    // Overall status
    const allStatuses = Object.values(checks).map(c => c.status);
    const overall = allStatuses.includes('fail') ? 'unhealthy'
      : allStatuses.includes('warn') ? 'degraded'
      : 'healthy';

    const statusCode = overall === 'unhealthy' ? 503 : 200;

    res.status(statusCode).json({
      status: overall,
      uptime: Math.round(process.uptime()),
      memory: {
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  // Feature 11: GPU Model Swapping
  router.get('/models', async (req, res) => {
    try {
      const role = req.query.role as string;
      const ollamaEndpoint = role === 'librarian'
        ? (process.env.OLLAMA_LIBRARIAN_BASE_URL || aiRouter.config.get<string>('ai.ollama.librarianEndpoint', 'http://localhost:11435'))
        : aiRouter.config.get<string>('ai.ollama.endpoint', 'http://localhost:11434');

      const response = await fetch(`${ollamaEndpoint}/api/tags`);
      const data = await response.json() as any;
      res.json({ models: data.models?.map((m: any) => m.name) || [] });
    } catch (e: any) {
      log.error('Failed to fetch Ollama models', { error: e.message });
      res.json({ models: [] });
    }
  });

  router.post('/models/swap', async (req, res) => {
    try {
      const { role, model } = req.body;
      if (!role || !model) {
        return res.status(400).json({ error: 'Role and model are required' });
      }

      if (role === 'writer') {
        aiRouter.config.set('ai.ollama.model', model);
      } else if (role === 'librarian') {
        aiRouter.config.set('ai.ollama.librarianModel', model);
      } else if (role === 'director') {
        aiRouter.config.set('ai.ollama.directorModel', model);
      } else {
        return res.status(400).json({ error: 'Invalid role' });
      }

      // Preload model into VRAM so ContextWatcher detects it
      try {
        let endpoint = aiRouter.config.get<string>('ai.ollama.endpoint', 'http://localhost:11434');
        
        if (role === 'librarian') {
          endpoint = process.env.OLLAMA_LIBRARIAN_BASE_URL || aiRouter.config.get<string>('ai.ollama.librarianEndpoint', 'http://localhost:11435');
        } else if (role === 'director') {
          const directorProvider = aiRouter.config.get<string>('ai.director.provider', 'ollama');
          if (directorProvider === 'librarian') {
            endpoint = process.env.OLLAMA_LIBRARIAN_BASE_URL || aiRouter.config.get<string>('ai.ollama.librarianEndpoint', 'http://localhost:11435');
          }
        }

        await fetch(`${endpoint}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model, keep_alive: '5m' })
        });
      } catch (e: any) {
        log.warn('Failed to preload model into VRAM', { error: e.message });
      }

      // Reinitialize providers to pick up new models
      await aiRouter.initialize();
      
      // Update Context Watcher stats to immediately reflect new labels
      await aiRouter.contextWatcher.pollAll();
      
      res.json({ success: true });
    } catch (error: any) {
      log.error('Failed to swap model', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/director-provider', async (req, res) => {
    try {
      const { provider } = req.body; // 'ollama' or 'librarian'
      if (!provider) return res.status(400).json({ error: 'Provider is required' });
      aiRouter.config.set('ai.director.provider', provider);
      await aiRouter.initialize();
      res.json({ success: true });
    } catch (error: any) {
      log.error('Failed to swap director provider', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
