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
import { listTrajectoryAbilities, listTrajectorySources } from '@perry/core';
import type { StateStore } from '@perry/projects';
import type { AIRouter } from '@perry/ai';
import type { LearningCore } from '../services/learning-core.js';
import type { AbilityEvolution } from '../services/ability-evolution.js';

export function setupLearningRoutes(stateStore: StateStore, workspaceDir: string, log: Logger, aiRouter: AIRouter, learningCore?: LearningCore, abilityEvolution?: AbilityEvolution) {
  const router = Router();

  // AbilityEvolution — scoring, evolution timeline, suggestions, transfer.
  router.get('/scores', (_req, res) => {
    try { res.json({ scores: abilityEvolution?.getAllScores() || [] }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/evolution', (req, res) => {
    try {
      const limit = req.query.limit ? Math.min(500, Math.max(1, parseInt(String(req.query.limit), 10) || 100)) : 100;
      const since = req.query.since ? String(req.query.since) : undefined;
      res.json({ events: abilityEvolution?.getEvolutionLog({ limit, since }) || [] });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get('/suggested-abilities', (req, res) => {
    try {
      const source = req.query.source ? String(req.query.source) : undefined;
      const limit = req.query.limit ? Math.min(50, parseInt(String(req.query.limit), 10) || 10) : 10;
      const installable = abilityEvolution?.getInstallableSuggestions({ source, limit }) || [];
      const transfer = abilityEvolution?.getTransferCandidates({ limit }) || [];
      res.json({ installable, transfer });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post('/auto-evaluate', async (req, res) => {
    try {
      let promotedAbilitiesCount = 0;
      
      // 1. Promote all pending abilities from abilities-pending
      const pendingDir = join(workspaceDir, 'abilities-pending');
      if (existsSync(pendingDir)) {
        const parseFM = (raw: string) => {
          const normalized = raw.replace(/\r\n/g, '\n');
          const m = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
          if (!m) return { body: normalized };
          const block = m[1];
          const body = m[2];
          const out: any = { body };
          for (const line of block.split('\n')) {
            const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
            if (kv) {
              const key = kv[1];
              let val = kv[2].trim();
              if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
              }
              out[key] = val;
            }
          }
          return out;
        };

        const walkAndPromote = async (dir: string, defaultService = 'worker') => {
          const fsPromises = await import('fs/promises');
          const { readdir, readFile, writeFile, unlink, mkdir } = fsPromises;
          const entries = await readdir(dir, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.isDirectory()) {
              await walkAndPromote(join(dir, ent.name), ent.name);
            } else if (ent.isFile() && ent.name.endsWith('.md')) {
              try {
                const filePath = join(dir, ent.name);
                const raw = await readFile(filePath, 'utf-8');
                const normalized = raw.replace(/\r\n/g, '\n');
                const fm = parseFM(normalized);
                if (fm.name) {
                  const service = fm.service || defaultService;
                  const isWorker = service === 'worker';
                  const dstDir = isWorker
                    ? '/app/.claude/commands'
                    : join(workspaceDir, 'abilities-installed', service);
                  
                  if (!existsSync(dstDir)) await mkdir(dstDir, { recursive: true });
                  const dst = join(dstDir, `${fm.name}.md`);
                  
                  let promoted = normalized.replace(/status:\s*pending/, 'status: installed');
                  if (!/promoted_at:/.test(promoted)) {
                    promoted = promoted.replace(/^---\n/, `---\npromoted_at: ${new Date().toISOString()}\n`);
                  }
                  await writeFile(dst, promoted, 'utf-8');
                  await unlink(filePath);
                  promotedAbilitiesCount++;
                  
                  // Log evolution event
                  abilityEvolution?.recordEvolutionEvent({
                    ts: new Date().toISOString(),
                    kind: 'ability-promoted',
                    service,
                    name: fm.name,
                    metadata: { autoAligned: true }
                  });
                }
              } catch (err: any) {
                log.error(`Auto-evaluate failed to promote pending ability: ${ent.name}`, { error: err.message });
              }
            }
          }
        };
        await walkAndPromote(pendingDir);
      }

      // 2. Run auto-promotion pass on verified patterns
      const promoResult = await abilityEvolution?.runAutoPromotionPass() || { scanned: 0, promoted: 0 };

      // 3. Sync and initialize all Pens/Souls on disk
      const pens = stateStore.getPenNames();
      const pensDir = join(workspaceDir, 'pens');
      const fsPromises = await import('fs/promises');
      for (const pen of pens) {
        const targetDir = join(pensDir, pen.slug);
        if (!existsSync(targetDir)) {
          await fsPromises.mkdir(targetDir, { recursive: true });
        }
        const soulPath = join(targetDir, 'SOUL.md');
        if (!existsSync(soulPath)) {
          const defaultSoul = [
            `# SOUL: ${pen.displayName}`,
            ``,
            `## Style DNA`,
            `- Tone: Natural, engaging, human.`,
            `- Vocabulary: Precise, avoids clichés.`,
            `- Pacing: Measured, showing rather than telling.`,
            ``,
            `## Voice Tagline`,
            `_${pen.voiceTagline || 'No tagline configured'}_`,
            ``,
          ].join('\n');
          await fsPromises.writeFile(soulPath, defaultSoul, 'utf-8');
        }
        const lessonsPath = join(targetDir, 'LESSONS.md');
        if (!existsSync(lessonsPath)) {
          const defaultLessons = [
            `# LESSONS: ${pen.displayName}`,
            ``,
            `## Core Principles`,
            `1. Keep prose clean and grounded.`,
            `2. Avoid repetitive sentence structures.`,
            ``,
          ].join('\n');
          await fsPromises.writeFile(lessonsPath, defaultLessons, 'utf-8');
        }
      }

      // 4. Match and auto-assign souls (Pens) ONLY to 'books' agents.
      // For non-books agents, send off to Meta to auto-evaluate and write up a dedicated soul if missing.
      const mapping: Record<string, string> = {};
      try {
        const raw = stateStore.getMeta('agent_souls');
        if (raw) Object.assign(mapping, JSON.parse(raw));
      } catch {}

      const penSlugs = pens.map(p => p.slug);
      const defaultPen = penSlugs.includes('a-perry') ? 'a-perry' : (penSlugs[0] || '');
      
      const { AGENT_REGISTRY } = await import('@perry/projects');
      const { generateAgentSoul } = await import('./agents.js');
      let autoGeneratedCount = 0;

      for (const agent of Object.values(AGENT_REGISTRY)) {
        if (agent.domain === 'books') {
          // Assign a pen slug if not already assigned
          if (!mapping[agent.id] && penSlugs.length > 0) {
            const match = penSlugs.find(slug => 
              slug.toLowerCase().includes(agent.domain.toLowerCase()) || 
              agent.domain.toLowerCase().includes(slug.toLowerCase())
            );
            mapping[agent.id] = match || defaultPen;
          }
          
          // Generate CONFIG.json if missing for books domain agents
          const targetDir = join(workspaceDir, 'souls', 'agents', agent.id);
          const configPath = join(targetDir, 'CONFIG.json');
          if (!existsSync(configPath)) {
            await generateAgentSoul(agent, workspaceDir, aiRouter, log);
            autoGeneratedCount++;
          }
        } else {
          // Non-books agent: delete from mapping so it does NOT map to a pen name!
          delete mapping[agent.id];
          
          // Send off to Meta if it doesn't have a dedicated soul file
          const targetDir = join(workspaceDir, 'souls', 'agents', agent.id);
          const soulPath = join(targetDir, 'SOUL.md');
          if (!existsSync(soulPath)) {
            await generateAgentSoul(agent, workspaceDir, aiRouter, log);
            autoGeneratedCount++;
          }
        }
      }
      stateStore.setMeta('agent_souls', JSON.stringify(mapping));

      // Log a general evolution event for workspace auto-alignment
      abilityEvolution?.recordEvolutionEvent({
        ts: new Date().toISOString(),
        kind: 'ability-promoted',
        metadata: {
          message: `Workspace auto-aligned: promoted ${promotedAbilitiesCount} pending abilities, auto-promoted ${promoResult.promoted} verified patterns, and generated dedicated souls for ${autoGeneratedCount} agents.`
        }
      });

      res.json({
        success: true,
        promotedPendingAbilities: promotedAbilitiesCount,
        autoPromotedPatterns: promoResult.promoted,
        scannedPatterns: promoResult.scanned,
        initializedPens: pens.length,
        assignedSouls: mapping,
        autoGeneratedSoulsCount: autoGeneratedCount,
      });
    } catch (err: any) {
      log.error('POST /learning/auto-evaluate failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/auto-promote/run', async (_req, res) => {
    try {
      const result = await abilityEvolution?.runAutoPromotionPass() || { scanned: 0, promoted: 0 };
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

      // Ability artifacts on disk — installed (worker → .claude/commands, others → workspace).
      const countAbilities = (root: string) => {
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
      const pendingBySvc = countAbilities(join(workspaceDir, 'abilities-pending'));
      const installedBySvc = countAbilities(join(workspaceDir, 'abilities-installed'));
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
        pending_abilities_total: pendingTotal,
        pending_abilities_by_service: pendingBySvc,
        installed_abilities_by_service: installedBySvc,
      });
    } catch (err: any) {
      log.error('GET /learning/state failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/trajectory-abilities', (req, res) => {
    try {
      const sourceFilter = req.query.source ? String(req.query.source) : null;
      const sources = listTrajectorySources(workspaceDir);
      const result: Record<string, any> = { sources: [] as any[], total: 0 };
      const targets = sourceFilter ? [sourceFilter] : sources;
      for (const src of targets) {
        const files = listTrajectoryAbilities(workspaceDir, src);
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
          const filePath = join(workspaceDir, 'trajectory-abilities', sourceFilter, safeFile);
          try { result.content = readFileSync(filePath, 'utf-8'); } catch {}
        }
      }
      res.json(result);
    } catch (err: any) {
      log.error('GET /learning/trajectory-abilities failed', { error: err.message });
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
