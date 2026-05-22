/**
 * @perry/dashboard-api — Sessions browser routes
 *
 * Thin REST wrapper around StateStore.searchSteps + getStepResult so the
 * dashboard can offer agentic FTS5 session browsing.
 *
 *   GET /api/sessions/search?q=&limit=&projectId=
 *     Keyword (FTS5) search over completed step outputs.
 *     Returns ranked excerpts with hit highlights.
 *
 *   GET /api/sessions/:stepId
 *     Full content of one step. Used to expand a search hit.
 */

import { Router } from 'express';
import { StateStore } from '@perry/projects';
import { Logger } from '@perry/core';

export function setupSessionsRoutes(stateStore: StateStore, log: Logger) {
  const router = Router();

  router.get('/search', (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) {
        return res.status(400).json({ error: 'q (query) is required' });
      }
      const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
      const limit = req.query.limit ? Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 10)) : 10;

      const hits = stateStore.searchSteps({ query: q, projectId, limit });
      res.json({ query: q, projectId: projectId || null, count: hits.length, hits });
    } catch (err) {
      log.error('GET /sessions/search failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Path NOTE: `:stepId` uses a strict regex match so a future sibling route
  // declared above this one (or another keyword route added later) can't
  // accidentally get swallowed by the catch-all. Step IDs follow the
  // pattern `step-<digits>` everywhere in the codebase, so we constrain the
  // param to that shape. Any other word lands on Express's 404, which is
  // what we want — it signals "use a real step id" rather than silently
  // returning `{found:false}` for typo paths like `/sessions/dashboard`.
  router.get('/:stepId(step-[0-9]+)', (req, res) => {
    try {
      const stepId = req.params.stepId;
      const row = stateStore.getStepResult(stepId);
      if (!row) {
        return res.status(404).json({ found: false, stepId });
      }
      res.json({ found: true, ...row });
    } catch (err) {
      log.error('GET /sessions/:stepId failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
