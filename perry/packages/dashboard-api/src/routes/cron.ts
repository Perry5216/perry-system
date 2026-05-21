/**
 * @perry/dashboard-api — Cron routes
 *
 *   GET    /api/cron           → list jobs
 *   POST   /api/cron           → create or update a job
 *   DELETE /api/cron/:name     → delete a job
 *   POST   /api/cron/:name/fire → manual trigger
 *   POST   /api/cron/reload    → re-read workspace/cron/*.json from disk
 */

import { Router } from 'express';
import type { Logger } from '@perry/core';
import type { CronService } from '../services/cron-service.js';

export function setupCronRoutes(cron: CronService, log: Logger) {
  const router = Router();

  router.get('/', (_req, res) => {
    try { res.json({ jobs: cron.list() }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/', (req, res) => {
    try {
      const result = cron.upsert(req.body);
      if ('error' in result) return res.status(400).json(result);
      res.status(201).json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/:name', (req, res) => {
    try {
      const result = cron.delete(req.params.name);
      if ('error' in result) return res.status(404).json(result);
      res.status(204).send();
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/:name/fire', async (req, res) => {
    try {
      const result = await cron.fireManual(req.params.name);
      res.json({ ok: true, result });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/reload', (_req, res) => {
    try { cron.reload(); res.json({ ok: true, count: cron.list().length }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  return router;
}
