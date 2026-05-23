/**
 * @perry/dashboard-api — Skills (slash commands) management routes
 *
 * Surfaces the two skill directories so the dashboard can implement an
 * approve/reject queue for worker-proposed skills:
 *
 *   /app/.claude/commands/        ← live skills (mounted RO from .claude/commands/)
 *   /app/workspace/skills-pending ← worker-proposed skills awaiting review
 *
 *   GET    /api/skills                        → { installed, pending }
 *   POST   /api/skills/promote                → { filename } moves pending → installed
 *   DELETE /api/skills/pending/:filename      → discards a pending skill
 *
 * NOTE on filesystem: the perry container mounts ./.claude as READ-ONLY,
 * so "promote" writes the new skill to /app/workspace/skills-installed/
 * AND leaves the pending file in place. Operators move the file to the
 * real .claude/commands/ dir on the host. We log the host-side path so
 * the dashboard can show a one-liner shell command.
 */

import { Router } from 'express';
import { Logger } from '@perry/core';
import { readdir, readFile, unlink, mkdir, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { StateStore, LibrarianService, SkillOptimizerService } from '@perry/projects';
import { AIRouter } from '@perry/ai';


interface SkillSummary {
  filename: string;
  name: string;
  description: string;
  service: string;
  proposedAt?: string;
  bodyLength: number;
}

function parseFrontmatter(raw: string): { name?: string; description?: string; service?: string; proposedAt?: string; body: string } {
  // Minimal YAML frontmatter parser — `name: foo`, `description: bar`, etc.
  // No nested keys, no arrays. Anything we don't recognise stays in the body.
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
}

/**
 * Walks a skill dir. If the dir contains subdirectories (per-service layout
 * for skills proposed via propose_skill({service:'scout',…})), recurse one
 * level. Returns flattened SkillSummary list with `service` tagged from the
 * subdir name (or from frontmatter — frontmatter wins).
 */
async function listMarkdownSkills(dir: string, defaultService = 'worker'): Promise<SkillSummary[]> {
  if (!existsSync(dir)) return [];
  const out: SkillSummary[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        // Per-service subdir — recurse one level with the subdir as service tag.
        const sub = await listMarkdownSkills(join(dir, ent.name), ent.name);
        out.push(...sub);
      } else if (ent.isFile() && ent.name.endsWith('.md')) {
        try {
          const raw = await readFile(join(dir, ent.name), 'utf-8');
          const fm = parseFrontmatter(raw);
          out.push({
            filename: ent.name,
            name: fm.name || ent.name.replace(/\.md$/, ''),
            description: fm.description || '(no description)',
            service: fm.service || defaultService,
            proposedAt: fm.proposedAt,
            bodyLength: fm.body.length,
          });
        } catch {
          out.push({ filename: ent.name, name: ent.name, description: '(unreadable)', service: defaultService, bodyLength: 0 });
        }
      }
    }
  } catch { /* dir disappeared mid-walk, ignore */ }
  return out;
}

export function setupSkillsRoutes(log: Logger, workspaceDir: string, stateStore: StateStore, aiRouter: AIRouter) {
  const router = Router();

  // In the container, .claude/commands is mounted RO at /app/.claude/commands.
  // skills-pending lives under workspace (writable). skills-installed is our
  // own writable mirror — operators promote from skills-pending to here,
  // then move on the host to the real .claude/commands/ directory.
  const installedDirs = [
    '/app/.claude/commands',
    join(workspaceDir, 'skills-installed'),
  ];
  const pendingDir = join(workspaceDir, 'skills-pending');

  // Resolve a pending skill filename to its actual on-disk path, regardless of
  // whether it sits at the top level (legacy worker-only layout) or inside a
  // per-service subdir (new layout). Filename alone stays the API key; the
  // service subdir is an implementation detail.
  async function resolvePendingPath(filename: string): Promise<{ path: string; service: string } | null> {
    if (!existsSync(pendingDir)) return null;
    const top = join(pendingDir, filename);
    if (existsSync(top)) return { path: top, service: 'worker' };
    try {
      for (const ent of await readdir(pendingDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const candidate = join(pendingDir, ent.name, filename);
        if (existsSync(candidate)) return { path: candidate, service: ent.name };
      }
    } catch {}
    return null;
  }

  router.get('/', async (req, res) => {
    try {
      const serviceFilter = typeof req.query.service === 'string' ? req.query.service : null;
      const installed: SkillSummary[] = [];
      const seen = new Set<string>();
      for (const dir of installedDirs) {
        const items = await listMarkdownSkills(dir);
        for (const i of items) {
          const key = `${i.service}::${i.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          installed.push(i);
        }
      }
      const pending = await listMarkdownSkills(pendingDir);
      const filt = (xs: SkillSummary[]) => serviceFilter ? xs.filter(x => x.service === serviceFilter) : xs;
      // Service counts surface in the dashboard tab as filter chips so the
      // user knows e.g. "scout: 3 pending, audit: 0 pending" at a glance.
      const allServices = new Set<string>();
      for (const i of installed) allServices.add(i.service);
      for (const p of pending) allServices.add(p.service);
      const services = Array.from(allServices).sort().map(s => ({
        service: s,
        installed: installed.filter(i => i.service === s).length,
        pending: pending.filter(p => p.service === s).length,
      }));
      res.json({ installed: filt(installed), pending: filt(pending), services });
    } catch (err) {
      log.error('GET /skills failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/pending/:filename/raw', async (req, res) => {
    try {
      const filename = req.params.filename;
      if (filename.includes('/') || filename.includes('..')) {
        return res.status(400).json({ error: 'invalid filename' });
      }
      const resolved = await resolvePendingPath(filename);
      if (!resolved) {
        return res.status(404).json({ error: 'not found' });
      }
      const raw = await readFile(resolved.path, 'utf-8');
      res.json({ filename, raw, service: resolved.service });
    } catch (err) {
      log.error('GET /skills/pending/:filename/raw failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/promote', async (req, res) => {
    try {
      const filename = String(req.body?.filename || '');
      if (!filename || filename.includes('/') || filename.includes('..')) {
        return res.status(400).json({ error: 'filename required (no path traversal)' });
      }
      const resolved = await resolvePendingPath(filename);
      if (!resolved) {
        return res.status(404).json({ error: 'pending skill not found' });
      }
      const raw = await readFile(resolved.path, 'utf-8');
      const normalized = raw.replace(/\r\n/g, '\n');
      const fm = parseFrontmatter(normalized);
      if (!fm.name) {
        return res.status(400).json({ error: 'skill is missing the `name` frontmatter field' });
      }
      const service = fm.service || resolved.service;
      // Worker skills go into .claude/commands/ (CLI-visible slash commands).
      // Non-worker skills (scout, audit, director, etc.) go into
      // workspace/skills-installed/{service}/ — each service's SkillLoader
      // watches its own subdir.
      const isWorker = service === 'worker';
      const dstDir = isWorker
        ? '/app/.claude/commands'
        : join(workspaceDir, 'skills-installed', service);
      if (!existsSync(dstDir)) await mkdir(dstDir, { recursive: true });
      const dst = join(dstDir, `${fm.name}.md`);
      let promoted = normalized.replace(/status:\s*pending/, 'status: installed');
      if (!/promoted_at:/.test(promoted)) {
        promoted = promoted.replace(/^---\n/, `---\npromoted_at: ${new Date().toISOString()}\n`);
      }
      await writeFile(dst, promoted, 'utf-8');
      await unlink(resolved.path);
      log.info('skill promoted', { name: fm.name, service, from: resolved.path, to: dst });
      res.json({
        promoted: true,
        name: fm.name,
        service,
        from: resolved.path,
        to: dst,
        note: isWorker
          ? 'Worker skill is now active — Claude/Gemini workers will see it on their next spawn.'
          : `${service} skill is now active — its consumer service will pick it up on the next reload tick (or immediate fs-watch if wired).`,
      });
    } catch (err) {
      log.error('POST /skills/promote failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Create a new skill directly (bypasses propose → curate flow). Lands the
  // skill straight into the installed dir for its service. Used by the
  // dashboard's "Add custom skill" form so operators can hand-author skills
  // without going through the worker propose_skill MCP tool.
  //
  // Body: { name, description, service, body, appliesWhen? }
  router.post('/', async (req, res) => {
    try {
      const { name, description, service, body, appliesWhen } = req.body || {};
      if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{2,39}$/.test(name)) {
        return res.status(400).json({ error: 'name must be kebab-case, 3-40 chars' });
      }
      if (typeof description !== 'string' || description.length < 10 || description.length > 200) {
        return res.status(400).json({ error: 'description must be 10-200 chars' });
      }
      if (typeof service !== 'string' || !/^[a-z][a-z0-9-]{1,20}$/.test(service)) {
        return res.status(400).json({ error: 'service must be kebab-case, 2-20 chars (e.g. worker, audit, director, scout, gc, prompt-builder, or a custom domain name)' });
      }
      if (typeof body !== 'string' || body.length < 50) {
        return res.status(400).json({ error: 'body must be at least 50 chars' });
      }

      const dstDir = service === 'worker'
        ? '/app/.claude/commands'
        : join(workspaceDir, 'skills-installed', service);
      if (!existsSync(dstDir)) await mkdir(dstDir, { recursive: true });
      const dst = join(dstDir, `${name}.md`);
      if (existsSync(dst)) {
        return res.status(409).json({ error: `skill "${name}" already exists for service "${service}"` });
      }

      let appliesBlock = '';
      if (appliesWhen && typeof appliesWhen === 'object' && Object.keys(appliesWhen).length > 0) {
        const lines = ['applies_when:'];
        for (const [k, v] of Object.entries(appliesWhen)) {
          lines.push(`  ${k}: ${JSON.stringify(v)}`);
        }
        appliesBlock = lines.join('\n') + '\n';
      }
      const now = new Date().toISOString();
      const content =
        `---\nname: ${name}\nservice: ${service}\ndescription: ${description}\ncreated_at: ${now}\npromoted_at: ${now}\nproposed_by: operator\nstatus: installed\n${appliesBlock}---\n\n` +
        body.trim() + '\n';

      await writeFile(dst, content, 'utf-8');
      log.info('skill created by operator', { name, service, path: dst });
      res.status(201).json({ created: true, name, service, path: dst });
    } catch (err) {
      log.error('POST /skills failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Delete an installed skill. Service is required so we can resolve the
  // right subdir. Worker skills live in /app/.claude/commands.
  router.delete('/installed/:service/:name', async (req, res) => {
    try {
      const { service, name } = req.params;
      if (!/^[a-z][a-z0-9-]{1,20}$/.test(service) || !/^[a-z][a-z0-9-]{2,39}$/.test(name)) {
        return res.status(400).json({ error: 'invalid service or name' });
      }
      const isPinned = stateStore.getMeta(`librarian_pin:${service}:${name}`) === '1';
      if (isPinned) {
        return res.status(400).json({ error: `Cannot delete pinned skill ${service}/${name}` });
      }
      const candidates = service === 'worker'
        ? ['/app/.claude/commands']
        : [join(workspaceDir, 'skills-installed', service)];
      let deleted = false;
      for (const dir of candidates) {
        const path = join(dir, `${name}.md`);
        if (existsSync(path)) {
          await unlink(path);
          deleted = true;
          log.info('installed skill deleted', { name, service, path });
          break;
        }
      }
      if (!deleted) return res.status(404).json({ error: `skill ${service}/${name} not found` });
      res.json({ deleted: true, name, service });
    } catch (err) {
      log.error('DELETE /skills/installed failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/pending/:filename', async (req, res) => {
    try {
      const filename = req.params.filename;
      if (filename.includes('/') || filename.includes('..')) {
        return res.status(400).json({ error: 'invalid filename' });
      }
      const resolved = await resolvePendingPath(filename);
      if (!resolved) {
        return res.status(404).json({ error: 'not found' });
      }
      const raw = await readFile(resolved.path, 'utf-8');
      const fm = parseFrontmatter(raw);
      const name = fm.name || filename.replace(/\.md$/, '');
      const service = fm.service || resolved.service;
      const isPinned = stateStore.getMeta(`librarian_pin:${service}:${name}`) === '1';
      if (isPinned) {
        return res.status(400).json({ error: `Cannot delete pinned skill ${service}/${name}` });
      }
      await unlink(resolved.path);
      log.info('pending skill rejected', { filename, service: resolved.service });
      res.json({ deleted: true, filename, service: resolved.service });
    } catch (err) {
      log.error('DELETE /skills/pending/:filename failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/pin', async (req, res) => {
    try {
      const { service, name } = req.body || {};
      if (!service || !name) {
        return res.status(400).json({ error: 'service and name are required' });
      }
      stateStore.setMeta(`librarian_pin:${service}:${name}`, '1');
      res.json({ pinned: true, service, name });
    } catch (err: any) {
      log.error('POST /skills/pin failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/unpin', async (req, res) => {
    try {
      const { service, name } = req.body || {};
      if (!service || !name) {
        return res.status(400).json({ error: 'service and name are required' });
      }
      stateStore.removeMeta(`librarian_pin:${service}:${name}`);
      res.json({ unpinned: true, service, name });
    } catch (err: any) {
      log.error('POST /skills/unpin failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/pins', async (req, res) => {
    try {
      const keys = stateStore.listMetaKeysByPrefix('librarian_pin:');
      const pins = keys.map(k => {
        const match = k.match(/^librarian_pin:([^:]+):(.+)$/);
        return match ? { service: match[1], name: match[2] } : null;
      }).filter(p => p !== null);
      res.json({ pins });
    } catch (err: any) {
      log.error('GET /skills/pins failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/librarian-pass', async (req, res) => {
    try {
      const { dryRun, runLlmReview } = req.body || {};
      const librarian = new LibrarianService(workspaceDir, stateStore, aiRouter, log);
      const result = await librarian.runLibrarianPass({ dryRun, runLlmReview });
      res.json(result);
    } catch (err: any) {
      log.error('POST /skills/librarian-pass failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/backups', async (req, res) => {
    try {
      const librarian = new LibrarianService(workspaceDir, stateStore, aiRouter, log);
      const backups = await librarian.listBackups();
      res.json({ backups });
    } catch (err: any) {
      log.error('GET /skills/backups failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/rollback', async (req, res) => {
    try {
      const { timestamp } = req.body || {};
      if (!timestamp) {
        return res.status(400).json({ error: 'timestamp is required' });
      }
      const librarian = new LibrarianService(workspaceDir, stateStore, aiRouter, log);
      const result = await librarian.rollback(timestamp);
      res.json(result);
    } catch (err: any) {
      log.error('POST /skills/rollback failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Librarian Proposals API
  router.get('/proposals', async (req, res) => {
    try {
      const proposals = stateStore.listLibrarianProposals();
      res.json({ proposals });
    } catch (err: any) {
      log.error('GET /skills/proposals failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/proposals/:id/approve', async (req, res) => {
    try {
      const librarian = new LibrarianService(workspaceDir, stateStore, aiRouter, log);
      await librarian.applyProposal(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      log.error('POST /skills/proposals/:id/approve failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/proposals/:id/reject', async (req, res) => {
    try {
      stateStore.updateLibrarianProposalStatus(req.params.id, 'rejected');
      res.json({ success: true });
    } catch (err: any) {
      log.error('POST /skills/proposals/:id/reject failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/merge', async (req, res) => {
    try {
      const { service, skillA, skillB, newSkillName } = req.body || {};
      if (!service || !skillA || !skillB || !newSkillName) {
        return res.status(400).json({ error: 'service, skillA, skillB, and newSkillName are required' });
      }
      const librarian = new LibrarianService(workspaceDir, stateStore, aiRouter, log);
      await librarian.mergeSkills(service, skillA, skillB, newSkillName);
      res.json({ success: true });
    } catch (err: any) {
      log.error('POST /skills/merge failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Telemetry API
  router.get('/telemetry', async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const history = stateStore.listSkillTelemetry(limit);
      
      const allTelemetry = stateStore.listSkillTelemetry(1000);
      const statsMap = new Map<string, { service: string; name: string; total: number; successful: number; totalDuration: number }>();
      
      for (const item of allTelemetry) {
        const key = `${item.service}:${item.skill_name}`;
        let stat = statsMap.get(key);
        if (!stat) {
          stat = {
            service: item.service,
            name: item.skill_name,
            total: 0,
            successful: 0,
            totalDuration: 0
          };
          statsMap.set(key, stat);
        }
        stat.total += 1;
        if (item.success === 1) {
          stat.successful += 1;
        }
        stat.totalDuration += item.duration_ms;
      }
      
      const stats = Array.from(statsMap.values()).map(s => ({
        service: s.service,
        name: s.name,
        total: s.total,
        successRate: s.total > 0 ? s.successful / s.total : 0,
        avgDurationMs: s.total > 0 ? s.totalDuration / s.total : 0
      }));

      res.json({ history, stats });
    } catch (err: any) {
      log.error('GET /skills/telemetry failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/optimize', async (req, res) => {
    try {
      const { service, name } = req.body || {};
      if (!service || !name) {
        return res.status(400).json({ error: 'service and name are required' });
      }
      const optimizer = new SkillOptimizerService(workspaceDir, stateStore, aiRouter, log);
      const result = await optimizer.runOptimization(service, name);
      res.json(result);
    } catch (err: any) {
      log.error('POST /skills/optimize failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
