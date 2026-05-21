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
import { listTrajectorySkills, listTrajectorySources } from '@perry/core';
import type { StateStore } from '@perry/projects';
import type { LearningCore } from '../services/learning-core.js';
import type { SkillEvolution } from '../services/skill-evolution.js';

export function setupLearningRoutes(stateStore: StateStore, workspaceDir: string, log: Logger, learningCore?: LearningCore, skillEvolution?: SkillEvolution) {
  const router = Router();

  // SkillEvolution — scoring, evolution timeline, suggestions, transfer.
  router.get('/scores', (_req, res) => {
    try { res.json({ scores: skillEvolution?.getAllScores() || [] }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/evolution', (req, res) => {
    try {
      const limit = req.query.limit ? Math.min(500, Math.max(1, parseInt(String(req.query.limit), 10) || 100)) : 100;
      const since = req.query.since ? String(req.query.since) : undefined;
      res.json({ events: skillEvolution?.getEvolutionLog({ limit, since }) || [] });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/suggested-skills', (req, res) => {
    try {
      const source = req.query.source ? String(req.query.source) : undefined;
      const limit = req.query.limit ? Math.min(50, parseInt(String(req.query.limit), 10) || 10) : 10;
      const installable = skillEvolution?.getInstallableSuggestions({ source, limit }) || [];
      const transfer = skillEvolution?.getTransferCandidates({ limit }) || [];
      res.json({ installable, transfer });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/auto-promote/run', async (_req, res) => {
    try {
      const result = await skillEvolution?.runAutoPromotionPass() || { scanned: 0, promoted: 0 };
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Trajectory export — dump agent_trajectories as JSONL for offline analysis
  // / RL training. Filterable by since-timestamp and project. Streams the
  // table directly without loading everything in memory.
  router.get('/trajectories/export', (req, res) => {
    try {
      const since = req.query.since ? String(req.query.since) : null;
      const projectId = req.query.project ? String(req.query.project) : null;
      const rows = stateStore.exportTrajectories({ since: since || undefined, projectId: projectId || undefined, limit: 10_000 });
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', `attachment; filename="perry-trajectories-${new Date().toISOString().slice(0,10)}.jsonl"`);
      for (const row of rows) {
        res.write(JSON.stringify(row) + '\n');
      }
      res.end();
    } catch (err: any) {
      log.error('GET /learning/trajectories/export failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

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

  router.get('/trajectory-skills', (req, res) => {
    try {
      const sourceFilter = req.query.source ? String(req.query.source) : null;
      const sources = listTrajectorySources(workspaceDir);
      const result: Record<string, any> = { sources: [] as any[], total: 0 };
      const targets = sourceFilter ? [sourceFilter] : sources;
      for (const src of targets) {
        const files = listTrajectorySkills(workspaceDir, src);
        result.sources.push({
          source: src,
          count: files.length,
          // Cap files returned to last 50 by mtime to keep payload sane.
          recent: files.slice(0, 50),
        });
        result.total += files.length;
      }
      // Optionally include full content of a specific file (?source=X&file=Y)
      if (sourceFilter && req.query.file) {
        const safeFile = String(req.query.file).replace(/[^a-zA-Z0-9_.\-]/g, '');
        if (safeFile) {
          const filePath = join(workspaceDir, 'trajectory-skills', sourceFilter, safeFile);
          try { result.content = readFileSync(filePath, 'utf-8'); } catch {}
        }
      }
      res.json(result);
    } catch (err: any) {
      log.error('GET /learning/trajectory-skills failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/verified-patterns', (_req, res) => {
    try {
      const snap = learningCore?.verifiedPatternsSnapshot() ?? {};
      // Per-source summary + content. Frontend can render counts inline or
      // expand the raw markdown content for a specific source.
      const sources = Object.values(snap).map(s => ({
        source: s.source,
        entryCount: s.entryCount,
        chars: s.chars,
      }));
      const totalEntries = sources.reduce((a, s) => a + s.entryCount, 0);
      res.json({
        total_entries: totalEntries,
        sources,
        // Full content keyed by source — small files, fine to ship inline.
        content: Object.fromEntries(Object.entries(snap).map(([k, v]) => [k, v.content])),
      });
    } catch (err: any) {
      log.error('GET /learning/verified-patterns failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
