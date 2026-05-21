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
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { body: raw };
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

export function setupSkillsRoutes(log: Logger, workspaceDir: string) {
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
      const fm = parseFrontmatter(raw);
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
      let promoted = raw.replace(/status:\s*pending/, 'status: installed');
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
      await unlink(resolved.path);
      log.info('pending skill rejected', { filename, service: resolved.service });
      res.json({ deleted: true, filename, service: resolved.service });
    } catch (err) {
      log.error('DELETE /skills/pending/:filename failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
