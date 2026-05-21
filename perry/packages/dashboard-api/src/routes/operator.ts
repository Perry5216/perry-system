/**
 * @perry/dashboard-api — Operator (user model) routes
 *
 *   GET    /api/operator           → profile + preferences + observation count
 *   PUT    /api/operator           → hand-edit profile/preferences
 *   POST   /api/operator/observe   → manual observation injection
 *   POST   /api/operator/distill   → trigger distillation pass
 */

import { Router } from 'express';
import type { Logger } from '@perry/core';
import type { OperatorProfileService } from '../services/operator-profile-service.js';
import type { AIRouter } from '@perry/ai';

export function setupOperatorRoutes(operatorProfile: OperatorProfileService, aiRouter: AIRouter, log: Logger) {
  const router = Router();

  router.get('/', (_req, res) => {
    try { res.json(operatorProfile.getProfile()); }
    catch (err: any) { log.error('GET /operator failed', { error: err.message }); res.status(500).json({ error: err.message }); }
  });

  router.put('/', (req, res) => {
    try {
      const { profile, preferences } = req.body || {};
      operatorProfile.setProfile(profile, preferences);
      res.json(operatorProfile.getProfile());
    } catch (err: any) {
      log.error('PUT /operator failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/observe', (req, res) => {
    try {
      const { detail } = req.body || {};
      if (typeof detail !== 'string' || detail.length === 0) {
        return res.status(400).json({ error: 'detail (string) required' });
      }
      operatorProfile.recordManual(detail);
      res.status(201).json({ recorded: true });
    } catch (err: any) {
      log.error('POST /operator/observe failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/distill', async (_req, res) => {
    try {
      const result = await operatorProfile.distill(async (prompt: string) => {
        // Use the librarian model for compression — same model as ChatMemoryService.
        const compressor = (aiRouter as any).compressor;
        if (!compressor) throw new Error('AIRouter has no compressor configured');
        try {
          const r = await compressor.compress({ text: prompt, mode: 'context_briefing' });
          return r?.compressed || '';
        } catch { return ''; }
      });
      res.json(result);
    } catch (err: any) {
      log.error('POST /operator/distill failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
