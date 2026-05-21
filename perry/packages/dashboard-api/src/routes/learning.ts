/**
 * @perry/dashboard-api — Learning Activity routes
 *
 * Surfaces what LearningCore has observed so the dashboard can render
 * "the system is actually gathering data" — visible even before any
 * skill is proposed. Per-source counters update in real time as
 * services/agents emit learning:* events.
 *
 *   GET /api/learning/state
 *     {
 *       sources: [{ source, observations, max_count, ready_to_fire,
 *                   threshold_min }, ...],
 *       entries: [...full LearningEntry list — limited],
 *       chat_memory: { sessions_distilled, file_chars, entries_in_file },
 *       pending_skills_total, pending_skills_by_service,
 *       installed_skills_by_service,
 *     }
 *
 * Dynamic in two ways:
 *   1. `sources` array surfaces whatever sources have actually emitted
 *      events — new domains (hacking, code, etc.) appear automatically
 *      with no UI changes.
 *   2. Skill counts walk the disk dirs, so promoted skills surface
 *      regardless of which service produced them.
 */

import { Router } from 'express';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Logger } from '@perry/core';
import type { StateStore } from '@perry/projects';
import type { LearningCore } from '../services/learning-core.js';

export function setupLearningRoutes(stateStore: StateStore, workspaceDir: string, log: Logger, learningCore?: LearningCore) {
  const router = Router();

  router.get('/state', (_req, res) => {
    try {
      // Per-source counters from LearningCore (primary data source).
      const snap = learningCore?.snapshot() ?? { entries: [], sources: [] };

      // Chat memory file stats (file-based, separate from event-driven LearningCore).
      let cmFileChars = 0;
      let cmEntries = 0;
      try {
        const cmPath = join(workspaceDir, 'chat-memory', 'global.md');
        if (existsSync(cmPath)) {
          const content = readFileSync(cmPath, 'utf-8');
          cmFileChars = content.length;
          cmEntries = (content.match(/^## /gm) || []).length;
        }
      } catch {}
      const cmDistilledKeys = stateStore.listMetaKeysByPrefix('chat_memory_last_distilled_', 200);

      // Skill artifacts on disk — installed (worker → .claude/commands, others → workspace).
      const countSkills = (root: string) => {
        const out: Record<string, number> = {};
        if (!existsSync(root)) return out;
        try {
          for (const ent of readdirSync(root, { withFileTypes: true })) {
            if (!ent.isDirectory()) continue;
            try { out[ent.name] = readdirSync(join(root, ent.name)).filter((f: string) => f.endsWith('.md')).length; } catch {}
          }
        } catch {}
        return out;
      };
      const pendingBySvc = countSkills(join(workspaceDir, 'skills-pending'));
      const installedBySvc = countSkills(join(workspaceDir, 'skills-installed'));
      let workerInstalled = 0;
      try { workerInstalled = readdirSync('/app/.claude/commands').filter((f: string) => f.endsWith('.md')).length; }
      catch {}
      installedBySvc.worker = (installedBySvc.worker || 0) + workerInstalled;

      const pendingTotal = Object.values(pendingBySvc).reduce((a, b) => a + b, 0);

      res.json({
        sources: snap.sources,
        // Trim entries to last 200 so a flood of observations doesn't bloat the payload.
        entries: snap.entries.slice(-200),
        chat_memory: {
          sessions_distilled: cmDistilledKeys.length,
          file_chars: cmFileChars,
          entries_in_file: cmEntries,
        },
        pending_skills_total: pendingTotal,
        pending_skills_by_service: pendingBySvc,
        installed_skills_by_service: installedBySvc,
      });
    } catch (err: any) {
      log.error('GET /learning/state failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
