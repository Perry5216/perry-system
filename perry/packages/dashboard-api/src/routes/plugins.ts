/**
 * @perry/dashboard-api — Plugin management routes.
 *
 *   GET    /api/plugins              → list loaded plugins
 *   POST   /api/plugins/reload       → re-scan workspace/plugins/
 *   DELETE /api/plugins/:name        → unload a single plugin
 *
 * Plugin-defined routes are mounted separately under `/api/plugin/{name}/...`
 * by the PluginManager router.
 */

import { Router } from 'express';
import type { Logger } from '@perry/core';
import type { PluginManager } from '../services/plugin-manager.js';

export function setupPluginsRoutes(pm: PluginManager, log: Logger) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ plugins: pm.list() });
  });

  router.post('/reload', async (_req, res) => {
    try {
      const r = await pm.reload();
      res.json({ ok: true, ...r, activeAfter: pm.list().length });
    } catch (err: any) {
      log.error('POST /plugins/reload failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:name', async (req, res) => {
    try {
      const ok = await pm.unload(req.params.name);
      if (!ok) return res.status(404).json({ error: 'not found' });
      res.status(204).send();
    } catch (err: any) {
      log.error('DELETE /plugins/:name failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
