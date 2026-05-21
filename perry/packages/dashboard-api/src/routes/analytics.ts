/**
 * @perry/dashboard-api — Analytics routes
 *
 * Thin wrapper over StateStore.getAnalyticsSummary so the dashboard's
 * Analytics panel can render the snapshot in one round-trip.
 *
 *   GET /api/analytics/summary?days=30
 *     Returns aggregated metrics over the requested time window.
 *     Default 30 days, max 365.
 */

import { Router } from 'express';
import { StateStore } from '@perry/projects';
import { Logger } from '@perry/core';
import type { RagService, MemoryStore } from '@perry/rag';

export function setupAnalyticsRoutes(stateStore: StateStore, log: Logger, memoryStore?: MemoryStore) {
  const router = Router();

  router.get('/summary', (req, res) => {
    try {
      const days = req.query.days ? parseInt(String(req.query.days), 10) : 30;
      const summary = stateStore.getAnalyticsSummary({ days });
      // Learning-corpus snapshot — chunk counts by kind, grouped into
      // `learning_*` (verified-success), `bible_*` (reference), and other.
      const learningCorpus: Array<{ kind: string; count: number }> = [];
      const referenceCorpus: Array<{ kind: string; count: number }> = [];
      const otherCorpus: Array<{ kind: string; count: number }> = [];
      if (memoryStore) {
        try {
          for (const row of memoryStore.countChunksByKind()) {
            if (row.kind.startsWith('learning_')) learningCorpus.push(row);
            else if (row.kind.startsWith('bible_')) referenceCorpus.push(row);
            else otherCorpus.push(row);
          }
        } catch (e: any) {
          log.warn('countChunksByKind failed', { error: e.message });
        }
      }
      res.json({ ...summary, learningCorpus, referenceCorpus, otherCorpus });
    } catch (err) {
      log.error('GET /analytics/summary failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
