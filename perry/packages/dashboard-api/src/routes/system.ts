/**
 * @perry/dashboard-api — System Routes
 */

import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { AIRouter } from '@perry/ai';
import { ProjectEngine, scanLeaks } from '@perry/projects';
import { Logger, SecretsService } from '@perry/core';
import type { GarbageCollector } from '../services/garbage-collector.js';

export function setupSystemRoutes(aiRouter: AIRouter, projectEngine: ProjectEngine, log: Logger, gc: GarbageCollector, secrets: SecretsService, ragService?: import('@perry/rag').RagService) {
  const router = Router();

  // ── Garbage collector control + status ────────────────────────────────
  // GET  /gc/status — last summary (what the dashboard fleet view reads)
  // POST /gc/run    — fire an immediate sweep (admin / dashboard button)
  router.get('/gc/status', (_req, res) => {
    const summary = gc.getLastSummary();
    const store: any = projectEngine.getStateStore();
    res.json({
      lastSummary: summary,
      lastRunAt: store.getMeta('gc_last_run_at') || null,
    });
  });
  router.post('/gc/run', async (_req, res) => {
    try {
      const summary = await gc.sweep('manual');
      res.json({ ok: true, summary });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /storage — per-dir size + RAG corpus snapshot + last sweep.
  // Backs the Analytics → Storage section in the dashboard.
  router.get('/storage', (_req, res) => {
    try {
      const snapshot = gc.getStorageSnapshot();
      res.json(snapshot);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/status', (req, res) => {
    const cacheStats = aiRouter.compressor.getCacheStats();
    const librarianProvider = aiRouter.getProvider('librarian');

    res.json({
      status: 'online',
      providers: aiRouter.getActiveProviders().map((p: any) => ({
        id: p.id,
        name: p.name,
        model: p.model,
      })),
      librarian: {
        available: aiRouter.compressor.isAvailable(),
        model: librarianProvider?.model || 'not configured',
        endpoint: librarianProvider?.providerConfig?.endpoint || 'N/A',
        cache: cacheStats,
      },
      directorModel: aiRouter.config.get<string>('ai.ollama.directorModel', 'qwen3.6:27b'),
      directorProvider: aiRouter.config.get<string>('ai.director.provider', 'ollama'),
    });
  });

  router.get('/templates', (req, res) => {
    res.json(projectEngine.listTemplates());
  });

  router.get('/style-dna', (req, res) => {
    // Try V2 structured JSON first
    const rawV2 = projectEngine.getStateStore().getMeta('style_dna_v2');
    if (rawV2) {
      try {
        const parsed = JSON.parse(rawV2);
        res.json({ content: JSON.stringify(parsed, null, 2), format: 'json' });
        return;
      } catch (e) {
        log.warn('Failed to parse style_dna_v2 JSON for dashboard', { error: e });
      }
    }

    // Fallback to legacy file
    const styleDnaPath = join(projectEngine.getWorkspaceDir(), '.config', 'style-dna.txt');
    if (existsSync(styleDnaPath)) {
      res.json({ content: readFileSync(styleDnaPath, 'utf-8'), format: 'text' });
    } else {
      res.json({ content: '', format: 'text' });
    }
  });

  router.put('/style-dna', (req, res) => {
    try {
      const isJson = req.body.format === 'json' || req.body.content.trim().startsWith('{');

      if (isJson) {
        // Validate and save to SQLite
        const parsed = JSON.parse(req.body.content);
        projectEngine.getStateStore().setMeta('style_dna_v2', JSON.stringify(parsed));
        res.json({ success: true, format: 'json' });
      } else {
        // Legacy file save
        const styleDnaPath = join(projectEngine.getWorkspaceDir(), '.config', 'style-dna.txt');
        const dir = dirname(styleDnaPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(styleDnaPath, req.body.content || '', 'utf-8');
        res.json({ success: true, format: 'text' });
      }
    } catch (error: any) {
      log.error('Failed to save Style DNA', { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  // Feature 7: Compression Stats
  router.get('/compression-stats', (req, res) => {
    res.json({
      librarianAvailable: aiRouter.compressor.isAvailable(),
      cache: aiRouter.compressor.getCacheStats(),
    });
  });

  // Feature 8: Garbage Collection (Purge Ghost Data)
  router.post('/purge-cache', async (req, res) => {
    try {
      const stats = await projectEngine.purgeGhostData();
      res.json({ success: true, stats });
    } catch (error: any) {
      log.error('Failed to purge cache', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Feature 9: Context Watcher Stats (GPU context fill levels)
  router.get('/context-stats', async (req, res) => {
    try {
      // Force a fresh poll before returning
      await aiRouter.contextWatcher.pollAll();
      const stats = aiRouter.contextWatcher.getStats();
      res.json(stats);
    } catch (error: any) {
      log.error('Failed to get context stats', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // Feature 10: Health Check (Docker healthcheck + monitoring)
  router.get('/health', async (req, res) => {
    const checks: Record<string, { status: 'ok' | 'warn' | 'fail'; detail?: string }> = {};

    // Check Writer GPU
    try {
      const writerProvider = aiRouter.getProvider('ollama');
      if (writerProvider) {
        const reachable = await writerProvider.checkAvailability();
        checks.writer = reachable ? { status: 'ok' } : { status: 'fail', detail: 'unreachable' };
      } else {
        checks.writer = { status: 'warn', detail: 'not configured' };
      }
    } catch {
      checks.writer = { status: 'fail', detail: 'connection error' };
    }

    // Check Librarian GPU
    try {
      const libProvider = aiRouter.getProvider('librarian');
      if (libProvider) {
        const reachable = await libProvider.checkAvailability();
        checks.librarian = reachable ? { status: 'ok' } : { status: 'fail', detail: 'unreachable' };
      } else {
        checks.librarian = { status: 'warn', detail: 'not configured' };
      }
    } catch {
      checks.librarian = { status: 'fail', detail: 'connection error' };
    }

    // Check SQLite
    try {
      const projectCount = projectEngine.listProjects().length;
      checks.database = { status: 'ok', detail: `${projectCount} projects` };
    } catch {
      checks.database = { status: 'fail', detail: 'query failed' };
    }

    // Context Watcher
    const ctxStats = aiRouter.contextWatcher.getStats();
    checks.contextWatcher = {
      status: ctxStats.globalRisk === 'high' ? 'warn' : 'ok',
      detail: `${ctxStats.gpus.length} GPUs, risk: ${ctxStats.globalRisk}`,
    };

    // Overall status
    const allStatuses = Object.values(checks).map(c => c.status);
    const overall = allStatuses.includes('fail') ? 'unhealthy'
      : allStatuses.includes('warn') ? 'degraded'
        : 'healthy';

    const statusCode = overall === 'unhealthy' ? 503 : 200;

    res.status(statusCode).json({
      status: overall,
      uptime: Math.round(process.uptime()),
      memory: {
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  // Worker target — declares "stop when we've gathered N clean pairs for
  // this pen." WorkerCoordinator polls these endpoints to decide whether
  // to POST a spawn request to perry-worker (running `claude -p /perry-worker`)
  // and when to archive the open queue.
  //
  // Storage: meta key `worker_target_{slug}` holds JSON
  // `{target, slug, startedAt}`. The coordinator also writes `worker_daemon_hb_{slug}`
  // every poll so the UI can show whether it's alive.
  const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/app/workspace';
  const targetKey = (slug: string) => `worker_target_${slug}`;
  const heartbeatKey = (slug: string) => `worker_daemon_hb_${slug}`;

  function injectedLineCount(slug: string): number {
    const path = join(WORKSPACE_DIR, 'training', `pen-${slug}`, 'claude_injected.jsonl');
    if (!existsSync(path)) return 0;
    try {
      const buf = readFileSync(path, 'utf-8');
      let n = 0;
      for (const line of buf.split('\n')) if (line.trim()) n++;
      return n;
    } catch { return 0; }
  }

  function progressFor(slug: string) {
    const stateStore: any = projectEngine.getStateStore();
    const db = stateStore.db;
    const counts: Record<string, number> = { open: 0, claimed: 0, done: 0, failed: 0, archived: 0 };
    if (db) {
      const rows: Array<{ status: string; n: number }> = db.prepare(
        `SELECT status, COUNT(*) AS n FROM task_pool WHERE pen_slug = ? GROUP BY status`,
      ).all(slug) as any;
      for (const r of rows) counts[r.status] = r.n;
    }
    const injected = injectedLineCount(slug);
    const cutoff = new Date(Date.now() - 120_000).toISOString();
    const active = db?.prepare(
      `SELECT COUNT(DISTINCT claimed_by) AS n
       FROM task_pool
       WHERE claimed_by IS NOT NULL AND claimed_at >= ? AND pen_slug = ?`,
    ).get(cutoff, slug)?.n || 0;
    return {
      injected, doneInPool: counts.done, currentPairs: injected + counts.done,
      counts, activeWorkers: active
    };
  }

  function readTarget(slug: string): { target: number; startedAt: string; agent?: string; maxWorkers?: number } | null {
    const raw = projectEngine.getStateStore().getMeta(targetKey(slug));
    if (!raw) return null;
    try {
      const j = JSON.parse(raw);
      if (typeof j.target === 'number' && j.target > 0) return j;
    } catch { /* fall through */ }
    return null;
  }

  function readHeartbeat(slug: string): { at: string; ageSeconds: number } | null {
    const at = projectEngine.getStateStore().getMeta(heartbeatKey(slug));
    if (!at) return null;
    const ageMs = Date.now() - Date.parse(at);
    return { at, ageSeconds: Math.round(ageMs / 1000) };
  }

  // GET /api/system/worker-target?slug=a-perry
  // Returns current target + live progress + daemon heartbeat. Used by the
  // dashboard panel to render the progress bar and "daemon online" indicator.
  router.get('/worker-target', (req, res) => {
    const slug = String(req.query.slug || 'a-perry');
    const target = readTarget(slug);
    const progress = progressFor(slug);
    const hb = readHeartbeat(slug);
    res.json({
      slug,
      target: target?.target ?? null,
      agent: target?.agent ?? 'claude',
      maxWorkers: target?.maxWorkers ?? null,
      startedAt: target?.startedAt ?? null,
      ...progress,
      daemon: hb ? {
        lastHeartbeatAt: hb.at,
        secondsSinceHeartbeat: hb.ageSeconds,
        alive: hb.ageSeconds < 30, // poll-interval is 10s; 30s grace for jitter
      } : null,
    });
  });

  // POST /api/system/worker-target  { slug, target }
  // Sets/updates the target. Idempotent — setting the same target again is a no-op.
  router.post('/worker-target', (req, res) => {
    const { slug, target, agent, maxWorkers } = req.body || {};
    if (typeof slug !== 'string' || !slug.trim()) {
      return res.status(400).json({ error: 'slug (string) is required' });
    }
    const t = Number(target);
    if (!Number.isFinite(t) || t <= 0) {
      return res.status(400).json({ error: 'target must be a positive number' });
    }
    const payload = { target: Math.floor(t), slug, agent: agent || 'claude', maxWorkers: Number(maxWorkers) || null, startedAt: new Date().toISOString() };
    projectEngine.getStateStore().setMeta(targetKey(slug), JSON.stringify(payload));
    res.json({ ok: true, ...payload });
  });

  // DELETE /api/system/worker-target?slug=a-perry
  // Cancels the target. Daemon will idle and stop firing workers; in-flight
  // workers continue until their natural exit. Does NOT archive open tasks.
  // Hard-deletes the meta row (previously wrote empty string + relied on
  // readers to treat '' as "no target" — cleaner to remove the row outright).
  router.delete('/worker-target', (req, res) => {
    const slug = String(req.query.slug || 'a-perry');
    projectEngine.getStateStore().removeMeta(targetKey(slug));
    res.json({ ok: true, slug });
  });

  // POST /api/system/worker-target/heartbeat  { slug }
  // Daemon pings this on each poll so the UI can show "daemon online."
  router.post('/worker-target/heartbeat', (req, res) => {
    const { slug } = req.body || {};
    if (typeof slug !== 'string' || !slug.trim()) {
      return res.status(400).json({ error: 'slug required' });
    }
    projectEngine.getStateStore().setMeta(heartbeatKey(slug), new Date().toISOString());
    res.json({ ok: true });
  });

  // GET /api/system/pool-audit?slug=a-perry&file=claude_injected|training_data|both
  // Runs scanLeaks() over every pair's `good` text in the pen's training
  // pool and reports the breakdown. Same regex bank as Phase B post-train
  // audit and the worker-drain gate, so the three views agree on what
  // counts as a "leak."
  //
  // For each file (claude_injected.jsonl, training_data.jsonl) returns:
  //   total       — number of pairs scanned
  //   clean       — pairs with zero hits
  //   leaked      — pairs with ≥1 hit
  //   tagCounts   — { filter_word: N, named_emotion: N, ... }
  //   topExamples — first 5 leaked pairs with prose excerpt + matches
  //
  // Cheap enough to run synchronously even on 10k-pair files (regex over
  // text-only fields, no model calls).
  router.get('/pool-audit', async (req, res) => {
    const slug = String(req.query.slug || 'a-perry');
    const which = String(req.query.file || 'both'); // both | claude_injected | training_data
    const penDir = join(WORKSPACE_DIR, 'training', `pen-${slug}`);

    // training_data.jsonl rows carry pen tag at metadata.pen; claude_injected.jsonl
    // is inherently per-pen by directory, so untaggedPen only makes sense for
    // training_data. The audit reports it as 0 for files that don't carry the tag.
    function auditFile(filename: string, goodFieldExtractor: (line: any) => string, supportsPenTag = false) {
      const path = join(penDir, filename);
      if (!existsSync(path)) {
        return {
          file: filename, exists: false, total: 0, clean: 0, leaked: 0,
          untaggedPen: 0, tagCounts: {}, topExamples: []
        };
      }
      const buf = readFileSync(path, 'utf-8');
      let total = 0, clean = 0, leaked = 0, untaggedPen = 0;
      const tagCounts: Record<string, number> = {};
      const topExamples: Array<{ index: number; tags: string[]; matches: string[]; excerpt: string }> = [];
      let idx = 0;
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        let obj: any;
        try { obj = JSON.parse(line); } catch { continue; }
        const good = (goodFieldExtractor(obj) || '').trim();
        if (!good) { idx++; continue; }
        total++;
        if (supportsPenTag) {
          const pen = obj?.metadata?.pen;
          if (typeof pen !== 'string' || !pen.trim()) untaggedPen++;
        }
        const hits = scanLeaks(good);
        if (hits.length === 0) {
          clean++;
        } else {
          leaked++;
          for (const h of hits) tagCounts[h.tag] = (tagCounts[h.tag] || 0) + h.matches.length;
          if (topExamples.length < 5) {
            topExamples.push({
              index: idx,
              tags: hits.map(h => h.tag),
              matches: hits.flatMap(h => h.matches).slice(0, 8),
              excerpt: good.length > 220 ? good.slice(0, 220) + '…' : good,
            });
          }
        }
        idx++;
      }
      return { file: filename, exists: true, total, clean, leaked, untaggedPen, tagCounts, topExamples };
    }

    const reports: any[] = [];
    if (which === 'both' || which === 'claude_injected') {
      reports.push(auditFile('claude_injected.jsonl', (o) => o.good));
    }
    if (which === 'both' || which === 'training_data') {
      // training_data.jsonl uses the conversations[2].content as the good
      // assistant prose. Skip lines that don't match the expected shape.
      reports.push(auditFile('training_data.jsonl', (o) =>
        o?.conversations?.[2]?.content || '', true));
    }

    // ── Manifest coverage (per-category deficit/surplus) ────────────────────
    // Reads pair_manifest_<slug>.json from /workspace/.config/ and buckets
    // training_data.jsonl pairs into categories. Mirrors the Python
    // _audit_manifest.py logic so dashboard ↔ daemon ↔ Python audit agree.
    // Returns null if no manifest is configured for this pen.
    function buildManifestCoverage(slug: string) {
      const manifestPath = join(WORKSPACE_DIR, '.config', `pair_manifest_${slug}.json`);
      const trainingPath = join(WORKSPACE_DIR, 'training', `pen-${slug}`, 'training_data.jsonl');
      if (!existsSync(manifestPath) || !existsSync(trainingPath)) return null;

      let manifest: any;
      try { manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')); }
      catch { return null; }
      const cats: any[] = manifest.categories || [];
      if (cats.length === 0) return null;

      const buckets: Record<string, number> = {};
      let unmatched = 0, total = 0;

      function matchCategory(src: string, cat: string, asstWords: number): string | null {
        for (const c of cats) {
          const m = c.match || {};
          if (Array.isArray(m.source_in) && !m.source_in.includes(src)) continue;
          if (typeof m.category_prefix === 'string' && !cat.startsWith(m.category_prefix)) continue;
          if (Array.isArray(m.asst_words)) {
            const [lo, hi] = m.asst_words;
            if (asstWords < lo || asstWords > hi) continue;
          }
          return c.id;
        }
        return null;
      }

      for (const line of readFileSync(trainingPath, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        let pair: any;
        try { pair = JSON.parse(line); } catch { continue; }
        total++;
        const asst = pair?.conversations?.[2]?.content || '';
        const wc = (asst.match(/\b\w+\b/g) || []).length;
        const meta = pair.metadata || {};
        const cid = matchCategory(meta.source || '', meta.category || '', wc);
        if (cid) buckets[cid] = (buckets[cid] || 0) + 1;
        else unmatched++;
      }

      const mustSatisfy: Set<string> = new Set((manifest.train_gate?.must_satisfy as string[]) || []);
      let blocked = false;
      const categories = cats.map(c => {
        const current = buckets[c.id] || 0;
        const target = c.target || 0;
        const op = c.op || 'preserve';
        let deficit = 0, surplus = 0, status: string;
        if (op === 'preserve') {
          status = current >= target ? 'OK' : 'LOW';
          deficit = Math.max(0, target - current);
        } else if (op === 'cap') {
          status = current > target ? 'OVER' : 'OK';
          surplus = Math.max(0, current - target);
        } else if (op === 'farm' || op === 'farm_and_refine') {
          if (current >= target) {
            status = op === 'farm_and_refine' ? 'REFINING' : 'FILLED';
          } else {
            status = 'FARM';
            deficit = target - current;
            if (mustSatisfy.has(c.id)) blocked = true;
          }
        } else {
          status = '?';
        }
        return {
          id: c.id,
          label: c.label || c.id,
          op,
          target,
          current,
          deficit,
          surplus,
          status,
          mustSatisfy: mustSatisfy.has(c.id),
        };
      });

      const minTotal = manifest.train_gate?.min_total_pairs || 0;
      const totalMatched = Object.values(buckets).reduce((a, b) => a + b, 0);
      const ready = !blocked && totalMatched >= minTotal;

      return {
        version: manifest.version,
        ready,
        blocked,
        totalMatched,
        unmatched,
        minTotal,
        categories,
      };
    }

    const manifest = buildManifestCoverage(slug);

    // ── Queue sync to manifest ──────────────────────────────────────────────
    // For categories at-or-over target (OK / REFINING), kill any open or claimed
    // tasks of the matching farm_task — they're wasted work since eviction-by-
    // better will discard their output anyway. For categories with deficit,
    // shell out to _fill_manifest.py to enqueue replacement tasks.
    // Net effect: pressing "Audit pool" reconciles the queue to the manifest.
    interface QueueSync {
      archived: Record<string, number>;
      enqueued?: number;
      enqueueError?: string;
    }
    const queueSync: QueueSync = { archived: {} };
    if (manifest && manifest.categories.length > 0) {
      const stateStore: any = projectEngine.getStateStore();
      const db = stateStore.db;
      if (db) {
        let needsTopup = false;
        for (const cat of manifest.categories) {
          const c: any = cat;
          if (c.op === 'farm_and_refine' || c.op === 'farm') {
            // farm_task isn't in the audit response payload — read from manifest file
          }
        }
        // Reload manifest to get farm_task values (audit response doesn't carry them)
        const manifestPath = join(WORKSPACE_DIR, '.config', `pair_manifest_${slug}.json`);
        let manifestRaw: any = null;
        try { manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf-8')); }
        catch { /* ignore */ }
        if (manifestRaw) {
          // Build the set of farm_task types that ARE needed right now (have deficit).
          const neededTypes = new Set<string>();
          for (const cat of manifest.categories) {
            const c: any = cat;
            const def = (manifestRaw.categories || []).find((x: any) => x.id === c.id);
            const farmTask = def?.farm_task;
            if (!farmTask) continue;
            const isFarmable = c.op === 'farm_and_refine' || c.op === 'farm';
            if (isFarmable && c.deficit > 0) {
              neededTypes.add(farmTask);
              needsTopup = true;
            }
          }
          // Archive EVERY open/claimed task whose type isn't on the needed list.
          // Catches both at-target REFINING categories AND any orphan task types
          // (e.g. degrade_pair, synthesize_pair, audit_paragraph leftovers).
          const allPending = db.prepare(
            `SELECT type, COUNT(*) AS n FROM task_pool
             WHERE pen_slug = ? AND status IN ('open', 'claimed')
             GROUP BY type`
          ).all(slug) as Array<{ type: string; n: number }>;
          for (const row of allPending) {
            if (!neededTypes.has(row.type)) {
              const res = db.prepare(
                `UPDATE task_pool SET status='archived'
                 WHERE pen_slug = ? AND type = ? AND status IN ('open', 'claimed')`
              ).run(slug, row.type) as any;
              if (res.changes > 0) {
                queueSync.archived[row.type] = (queueSync.archived[row.type] || 0) + res.changes;
              }
            }
          }
        }
        // If anything has a real deficit, shell out to _fill_manifest.py
        if (needsTopup) {
          try {
            const { spawn } = await import('child_process');
            const out = await new Promise<string>((resolve, reject) => {
              const child = spawn('docker', ['exec', 'perry-trainer', 'python3',
                '/workspace/.config/_fill_manifest.py', slug, '--no-refine']);
              let buf = '';
              child.stdout.on('data', (d) => { buf += d.toString(); });
              child.stderr.on('data', (d) => { buf += d.toString(); });
              child.on('close', () => resolve(buf));
              child.on('error', reject);
              setTimeout(() => { try { child.kill(); } catch {} ; resolve(buf); }, 60_000);
            });
            const m = out.match(/Enqueued:\s+(\d+)/);
            if (m) queueSync.enqueued = parseInt(m[1], 10);
          } catch (e) {
            queueSync.enqueueError = (e as Error).message;
          }
        }
      }
    }

    // ── Voice-match verification ────────────────────────────────────────────
    // Beyond leak-scanning (catches obvious anti-patterns), this scores each
    // training_data.jsonl pair on z-distance from the pen's voice corpus.
    // Catches subtle stylistic drift (e.g. Antigravity-flavored prose vs
    // Claude-flavored vs A.Perry-flavored) that the leak filter misses.
    function buildVoiceMatch(slug: string) {
      const penDir = join(WORKSPACE_DIR, 'training', `pen-${slug}`);
      const voiceCorpus = join(penDir, 'voice_paragraphs_v2.jsonl');
      const trainingPath = join(penDir, 'training_data.jsonl');
      if (!existsSync(voiceCorpus) || !existsSync(trainingPath)) return null;

      const LY_ALLOW = new Set(['only', 'family', 'holy', 'ugly', 'early', 'likely', 'fully', 'really']);
      function scoreText(text: string) {
        const wc = Math.max((text.match(/\b\w+\b/g) || []).length, 1);
        const sentences = text.split(/[.!?]+\s+/).filter(s => s.trim());
        const sentLens = (sentences.length ? sentences : [text]).map(s => (s.match(/\b\w+\b/g) || []).length);
        const meanS = sentLens.reduce((a, b) => a + b, 0) / sentLens.length;
        const stdS = sentLens.length > 1
          ? Math.sqrt(sentLens.reduce((a, b) => a + (b - meanS) ** 2, 0) / sentLens.length)
          : 0;
        const lyMatches = (text.match(/\b\w+ly\b/gi) || []).filter(w => !LY_ALLOW.has(w.toLowerCase()));
        const adv = (lyMatches.length / wc) * 100;
        const contrCount = (text.match(/\b\w+'(s|t|re|ll|ve|d|m)\b/gi) || []).length;
        const contr = (contrCount / wc) * 100;
        return [meanS, stdS, adv, contr];
      }

      // Build fingerprint from voice corpus
      const samples: number[][] = [[], [], [], []];
      for (const line of readFileSync(voiceCorpus, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        let p: any;
        try { p = JSON.parse(line); } catch { continue; }
        const text = (p.text || p.paragraph || '').trim();
        if (text.length < 30) continue;
        const v = scoreText(text);
        for (let i = 0; i < 4; i++) samples[i].push(v[i]);
      }
      if (samples[0].length === 0) return null;
      const mean = samples.map(s => s.reduce((a, b) => a + b, 0) / s.length);
      const std = samples.map((s, i) => {
        if (s.length < 2) return 1e-6;
        const m = mean[i];
        return Math.max(Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length), 1e-6);
      });

      // First-person check (narration only)
      const stripDialogue = (t: string) => t.replace(/"[^"]*"/g, '').replace(/[“][^”]*[”]/g, '');
      const firstPersonRe = /\b(?:I|me|my|mine|myself)\b/;

      // Per-source tiering
      interface SourceBucket {
        total: number; pass: number; soft: number; hard: number;
        distances: number[]; leakCount: number;
      }
      const buckets: Record<string, SourceBucket> = {};
      // Composite z-distance summed across 4 dims. Real prose has natural
      // variation — each dim typically lands 0.5-1σ off the corpus mean, so
      // composite of 2-5σ is normal. Tier boundaries calibrated against
      // existing claude-injected baseline (mean composite ~2.3σ).
      const STRICT = 4.0;   // SOFT_FAIL above this — noticeable drift (~1σ/dim)
      const LENIENT = 7.0;  // HARD_FAIL above this — significant drift (~1.75σ/dim)

      for (const line of readFileSync(trainingPath, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        let pair: any;
        try { pair = JSON.parse(line); } catch { continue; }
        const good = (pair?.conversations?.[2]?.content || '').trim();
        if (!good) continue;
        const source = pair?.metadata?.source || 'unknown';
        // Bucket by source family (strip slug suffix for grouping)
        const bucket = source.replace(/_a-perry$/, '').replace(/_[a-z]-[a-z]+$/, '');
        if (!buckets[bucket]) {
          buckets[bucket] = { total: 0, pass: 0, soft: 0, hard: 0, distances: [], leakCount: 0 };
        }
        const b = buckets[bucket];
        b.total++;

        const narration = stripDialogue(good);
        const hits = scanLeaks(good);
        const fpLeak = firstPersonRe.test(narration);
        const hasLeak = hits.length > 0 || fpLeak;
        if (hasLeak) b.leakCount++;

        const v = scoreText(good);
        const composite = v.reduce((s, val, i) => s + Math.abs((val - mean[i]) / std[i]), 0);
        b.distances.push(composite);

        if (hasLeak || composite > LENIENT) b.hard++;
        else if (composite > STRICT) b.soft++;
        else b.pass++;
      }

      const summary = Object.entries(buckets).map(([source, b]) => ({
        source,
        total: b.total,
        pass: b.pass,
        soft: b.soft,
        hard: b.hard,
        leaks: b.leakCount,
        meanDistance: b.distances.length
          ? Number((b.distances.reduce((a, c) => a + c, 0) / b.distances.length).toFixed(2))
          : 0,
        passPct: b.total ? Math.round((b.pass / b.total) * 100) : 0,
      })).sort((a, b) => b.total - a.total);

      const overall = summary.reduce((acc, s) => ({
        total: acc.total + s.total,
        pass: acc.pass + s.pass,
        soft: acc.soft + s.soft,
        hard: acc.hard + s.hard,
        leaks: acc.leaks + s.leaks,
      }), { total: 0, pass: 0, soft: 0, hard: 0, leaks: 0 });

      return {
        strict: STRICT,
        lenient: LENIENT,
        fingerprintN: samples[0].length,
        overall,
        bySource: summary,
      };
    }

    const voiceMatch = buildVoiceMatch(slug);

    res.json({ slug, runAt: new Date().toISOString(), reports, manifest, voiceMatch, queueSync });
  });

  // POST /api/system/pool-tag  { slug, penSlug }
  // Backfill `metadata.pen = penSlug` on every training_data.jsonl row that
  // lacks a pen tag. The original is moved to {file}.bak-pretag-{ts} first.
  // Idempotent — a second run with the same penSlug touches 0 rows. Only
  // operates on training_data.jsonl (claude_injected.jsonl is inherently
  // per-pen via its directory and has no metadata block).
  router.post('/pool-tag', (req, res) => {
    const { slug, penSlug } = req.body || {};
    if (typeof slug !== 'string' || !slug.trim()) {
      return res.status(400).json({ error: 'slug required' });
    }
    if (typeof penSlug !== 'string' || !penSlug.trim()) {
      return res.status(400).json({ error: 'penSlug required' });
    }
    const penDir = join(WORKSPACE_DIR, 'training', `pen-${slug}`);
    const path = join(penDir, 'training_data.jsonl');
    if (!existsSync(path)) {
      return res.status(404).json({ error: 'training_data.jsonl not found for pen', slug });
    }

    const buf = readFileSync(path, 'utf-8');
    const out: string[] = [];
    let total = 0, tagged = 0, alreadyTagged = 0;
    for (const line of buf.split('\n')) {
      if (!line.trim()) continue;
      total++;
      let obj: any;
      try { obj = JSON.parse(line); } catch {
        // Malformed lines pass through untouched.
        out.push(line);
        continue;
      }
      const meta = obj.metadata = obj.metadata || {};
      if (typeof meta.pen === 'string' && meta.pen.trim()) {
        alreadyTagged++;
      } else {
        meta.pen = penSlug;
        tagged++;
      }
      out.push(JSON.stringify(obj));
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${path}.bak-pretag-${stamp}`;
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, out.join('\n') + (out.length > 0 ? '\n' : ''), 'utf-8');
    renameSync(path, backupPath);
    renameSync(tmpPath, path);

    res.json({ slug, penSlug, runAt: new Date().toISOString(), total, tagged, alreadyTagged, backupPath });
  });

  // ─── Inbound webhook receiver ────────────────────────────────────────────
  //
  // POST /api/system/webhooks/:source
  //
  // Accepts an arbitrary JSON payload from an external service (typically an
  // n8n flow on the user's Cloudflare Tunnel). Validates a shared-secret
  // header, stores the last N events in memory for dashboard inspection, and
  // returns 200 quickly so the caller doesn't time out.
  //
  // Does NOT trigger any Perry actions automatically — it's a catalog, not a
  // command bus. Wire specific handlers per `:source` later once you know
  // what events you actually want acted on.
  //
  // Auth: requires `X-Webhook-Secret` header matching env PERRY_WEBHOOK_SECRET.
  // If the env is unset, ALL inbound webhooks are rejected with 503 (fail-safe
  // — we'd rather drop events than accept unauthenticated payloads).
  const WEBHOOK_HISTORY_MAX = 50;
  const webhookHistory: Array<{
    source: string;
    receivedAt: string;
    headers: Record<string, string>;
    payload: unknown;
  }> = [];

  router.post('/webhooks/:source', (req, res) => {
    // Vault-first (post-bootstrap), .env fallback (pre-bootstrap / shareability)
    const expected = secrets.getSync('perry_webhook_secret') || process.env.PERRY_WEBHOOK_SECRET;
    if (!expected) {
      return res.status(503).json({ error: 'perry_webhook_secret not set — inbound webhooks disabled (set via Secrets panel or PERRY_WEBHOOK_SECRET env)' });
    }
    const provided = req.header('X-Webhook-Secret');
    if (!provided || provided !== expected) {
      log.warn('Webhook rejected — bad/missing secret', { source: req.params.source });
      return res.status(401).json({ error: 'invalid or missing X-Webhook-Secret' });
    }

    const source = (req.params.source || 'unknown').slice(0, 64);
    const entry = {
      source,
      receivedAt: new Date().toISOString(),
      headers: {
        'user-agent': req.header('User-Agent') || '',
        'content-type': req.header('Content-Type') || '',
      },
      payload: req.body ?? null,
    };
    webhookHistory.push(entry);
    if (webhookHistory.length > WEBHOOK_HISTORY_MAX) {
      webhookHistory.splice(0, webhookHistory.length - WEBHOOK_HISTORY_MAX);
    }
    log.info('Inbound webhook received', { source, payloadKeys: typeof req.body === 'object' && req.body ? Object.keys(req.body).slice(0, 10) : [] });
    res.json({ ok: true, source, receivedAt: entry.receivedAt });
  });

  // GET /api/system/webhook-history — last N inbound webhooks, newest first
  router.get('/webhook-history', (_req, res) => {
    res.json({
      count: webhookHistory.length,
      max: WEBHOOK_HISTORY_MAX,
      entries: [...webhookHistory].reverse(),
    });
  });

  // ─── NetworkClient surface ───────────────────────────────────────────────
  //
  // Thin HTTP wrappers around @perry/projects' NetworkClient so the dashboard
  // and any external caller can use the same network paths (direct, gluetun-*)
  // that book-planning research steps + future scouts use internally.

  // GET /api/system/network-paths — health of every named network path
  router.get('/network-paths', async (_req, res) => {
    try {
      const { NetworkClient } = await import('@perry/projects');
      const paths = await NetworkClient.availablePaths();
      res.json({ paths });
    } catch (err: any) {
      log.warn('network-paths failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/system/fetch  { url, networkPath?, method?, headers?, body?, timeoutMs? }
  // One-shot fetch through a chosen network path. Returns the response text
  // (truncated to 100KB) + metadata. Useful for ad-hoc URL probes from the
  // dashboard without standing up a worker.
  router.post('/fetch', async (req, res) => {
    const { url, networkPath, method, headers, body: reqBody, timeoutMs, userAgent } = req.body || {};
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'url (http/https) required' });
    }
    try {
      const { NetworkClient } = await import('@perry/projects');
      const result = await NetworkClient.fetch(url, {
        networkPath, method, headers, body: reqBody, timeoutMs, userAgent,
      });
      // Cap response text so a 10MB scrape doesn't blow the JSON response.
      // Caller can override via maxResponseChars. Default 500KB — Amazon
      // search pages are ~1.2MB but the useful data block ends well before
      // that, and the librarian gets a stripped/digested view anyway.
      const MAX = Number(req.body?.maxResponseChars) || 500_000;
      const text = result.text.length > MAX ? result.text.slice(0, MAX) + '\n[...truncated...]' : result.text;
      res.json({ ...result, text, truncated: result.text.length > MAX });
    } catch (err: any) {
      log.warn('fetch route failed', { url, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/system/start-calibration  { slug, targetPairs? }
  // Cold-start a pen's training pool: enqueues a balanced batch of
  // synthesize_pair tasks across the full (scene × stat × anti-pattern)
  // cartesian. The active worker pool drains them; results flow through the
  // existing claude_injected → training_data export pipeline. Use this when
  // a new pen-name is created so the swarm can bootstrap a pool quickly
  // (vs hand-curating one pair at a time or waiting on slow GPU mining).
  router.post('/start-calibration', (req, res) => {
    const { slug, targetPairs } = req.body || {};
    if (typeof slug !== 'string' || !slug.trim()) {
      return res.status(400).json({ error: 'slug required' });
    }
    const target = typeof targetPairs === 'number' && Number.isFinite(targetPairs) ? targetPairs : 600;
    try {
      const summary = projectEngine.getAutoLearning().startCalibration(slug.trim(), target);
      res.json(summary);
    } catch (err: any) {
      log.warn('start-calibration failed', { slug, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/system/pool-scrub  { slug, file, keepVoiceSoft, keepVoiceHard }
  //   file: 'claude_injected' | 'training_data' | 'both' (default 'both')
  //   keepVoiceSoft: bool (default false — drops soft voice-match fails)
  //   keepVoiceHard: bool (default false — drops hard voice-match fails)
  //
  // Rewrites the chosen jsonl file(s), keeping only pairs that pass:
  //   1. scanLeaks (filter verbs / named emotions / clichés / anti-patterns)
  //   2. First-person leak (narration only, dialogue stripped)
  //   3. Voice fingerprint tier (soft/hard) — drops by default; opt out per option
  //
  // The original is moved to {file}.bak-{timestamp} before the new version is
  // written. Destructive: callers should confirm. Idempotent.
  router.post('/pool-scrub', async (req, res) => {
    const { slug, file, keepVoiceSoft, keepVoiceHard, refillAfter } = req.body || {};
    if (typeof slug !== 'string' || !slug.trim()) {
      return res.status(400).json({ error: 'slug required' });
    }
    const which = typeof file === 'string' ? file : 'both';
    if (!['both', 'claude_injected', 'training_data'].includes(which)) {
      return res.status(400).json({ error: `file must be 'both', 'claude_injected', or 'training_data' (got ${file})` });
    }
    const dropSoft = !keepVoiceSoft;
    const dropHard = !keepVoiceHard;
    // Default ON: after scrub creates a manifest deficit, immediately enqueue
    // replacement tasks via _fill_manifest.py. Pass `refillAfter: false` to skip.
    const doRefill = refillAfter !== false;
    const penDir = join(WORKSPACE_DIR, 'training', `pen-${slug}`);

    // Build the pen's voice fingerprint once per request. If the corpus is
    // missing, voice-tier filtering is skipped (leak filter still runs).
    const LY_ALLOW = new Set(['only', 'family', 'holy', 'ugly', 'early', 'likely', 'fully', 'really']);
    function scoreText(text: string): number[] {
      const wc = Math.max((text.match(/\b\w+\b/g) || []).length, 1);
      const sentences = text.split(/[.!?]+\s+/).filter(s => s.trim());
      const sentLens = (sentences.length ? sentences : [text]).map(s => (s.match(/\b\w+\b/g) || []).length);
      const meanS = sentLens.reduce((a, b) => a + b, 0) / sentLens.length;
      const stdS = sentLens.length > 1
        ? Math.sqrt(sentLens.reduce((a, b) => a + (b - meanS) ** 2, 0) / sentLens.length)
        : 0;
      const ly = (text.match(/\b\w+ly\b/gi) || []).filter(w => !LY_ALLOW.has(w.toLowerCase()));
      const adv = (ly.length / wc) * 100;
      const contr = ((text.match(/\b\w+'(s|t|re|ll|ve|d|m)\b/gi) || []).length / wc) * 100;
      return [meanS, stdS, adv, contr];
    }

    let fingerprintMean: number[] | null = null;
    let fingerprintStd: number[] | null = null;
    const corpusPath = join(penDir, 'voice_paragraphs_v2.jsonl');
    if (existsSync(corpusPath)) {
      const samples: number[][] = [[], [], [], []];
      for (const line of readFileSync(corpusPath, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        let p: any;
        try { p = JSON.parse(line); } catch { continue; }
        const text = (p.text || p.paragraph || '').trim();
        if (text.length < 30) continue;
        const v = scoreText(text);
        for (let i = 0; i < 4; i++) samples[i].push(v[i]);
      }
      if (samples[0].length > 0) {
        fingerprintMean = samples.map(s => s.reduce((a, b) => a + b, 0) / s.length);
        fingerprintStd = samples.map((s, i) => {
          if (s.length < 2) return 1e-6;
          const m = fingerprintMean![i];
          return Math.max(Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length), 1e-6);
        });
      }
    }
    const STRICT = 4.0, LENIENT = 7.0;
    const stripDialogue = (t: string) => t.replace(/"[^"]*"/g, '').replace(/[“][^”]*[”]/g, '');
    const firstPersonRe = /\b(?:I|me|my|mine|myself)\b/;

    function scrubFile(filename: string, goodFieldExtractor: (line: any) => string) {
      const path = join(penDir, filename);
      if (!existsSync(path)) {
        return { file: filename, exists: false, before: 0, kept: 0, removed: 0,
                 removedByReason: {}, backupPath: null, removedTags: {} };
      }
      const buf = readFileSync(path, 'utf-8');
      const kept: string[] = [];
      const removedTags: Record<string, number> = {};
      const removedByReason: Record<string, number> = { leak: 0, first_person: 0, voice_soft: 0, voice_hard: 0 };
      let before = 0, removed = 0;
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        before++;
        let obj: any;
        try { obj = JSON.parse(line); } catch {
          kept.push(line);
          continue;
        }
        const good = (goodFieldExtractor(obj) || '').trim();
        if (!good) {
          kept.push(line);
          continue;
        }
        // 1. Hard regex leaks (existing logic)
        const hits = scanLeaks(good);
        if (hits.length > 0) {
          removed++;
          removedByReason.leak++;
          for (const h of hits) removedTags[h.tag] = (removedTags[h.tag] || 0) + h.matches.length;
          continue;
        }
        // 2. First-person narration leak
        if (firstPersonRe.test(stripDialogue(good))) {
          removed++;
          removedByReason.first_person++;
          removedTags['first_person'] = (removedTags['first_person'] || 0) + 1;
          continue;
        }
        // 3. Voice fingerprint tier (only if corpus available)
        if (fingerprintMean && fingerprintStd) {
          const v = scoreText(good);
          const composite = v.reduce((s, val, i) => s + Math.abs((val - fingerprintMean![i]) / fingerprintStd![i]), 0);
          if (composite > LENIENT) {
            if (dropHard) {
              removed++;
              removedByReason.voice_hard++;
              removedTags['voice_hard'] = (removedTags['voice_hard'] || 0) + 1;
              continue;
            }
          } else if (composite > STRICT) {
            if (dropSoft) {
              removed++;
              removedByReason.voice_soft++;
              removedTags['voice_soft'] = (removedTags['voice_soft'] || 0) + 1;
              continue;
            }
          }
        }
        kept.push(line);
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${path}.bak-${stamp}`;
      const tmpPath = `${path}.tmp`;
      writeFileSync(tmpPath, kept.join('\n') + (kept.length > 0 ? '\n' : ''), 'utf-8');
      renameSync(path, backupPath);
      renameSync(tmpPath, path);
      return { file: filename, exists: true, before, kept: kept.length, removed,
               removedByReason, backupPath, removedTags };
    }

    const results: any[] = [];
    if (which === 'both' || which === 'claude_injected') {
      results.push(scrubFile('claude_injected.jsonl', (o) => o.good));
    }
    if (which === 'both' || which === 'training_data') {
      results.push(scrubFile('training_data.jsonl', (o) =>
        o?.conversations?.[2]?.content || ''));
    }

    // Reactive refill: shell out to _fill_manifest.py inside the perry-trainer
    // container. Only do it if at least one pair was removed (no point otherwise).
    let refill: { triggered: boolean; enqueued?: number; error?: string } = { triggered: false };
    const totalRemoved = results.reduce((s, r) => s + (r.removed || 0), 0);
    if (doRefill && totalRemoved > 0) {
      refill.triggered = true;
      try {
        const { spawn } = await import('child_process');
        const out = await new Promise<string>((resolve, reject) => {
          const child = spawn('docker', ['exec', 'perry-trainer', 'python3',
            '/workspace/.config/_fill_manifest.py', slug]);
          let buf = '';
          child.stdout.on('data', (d) => { buf += d.toString(); });
          child.stderr.on('data', (d) => { buf += d.toString(); });
          child.on('close', () => resolve(buf));
          child.on('error', reject);
          setTimeout(() => { try { child.kill(); } catch {} ; resolve(buf); }, 60_000);
        });
        const m = out.match(/Enqueued:\s+(\d+)/);
        if (m) refill.enqueued = parseInt(m[1], 10);
      } catch (e) {
        refill.error = (e as Error).message;
      }
    }

    res.json({
      slug, runAt: new Date().toISOString(), results,
      thresholds: { strict: STRICT, lenient: LENIENT },
      dropSoft, dropHard,
      fingerprintAvailable: fingerprintMean !== null,
      refill,
    });
  });

  // Workers — live status of /perry-worker chats draining the task_pool.
  // A worker is considered "active" if it claimed something within the last
  // 120 s; that's a couple of degrade_pair cycles. queue depth comes from the
  // same task_pool by status. Polled by the dashboard every few seconds.
  router.get('/workers', (req, res) => {
    try {
      const stateStore: any = projectEngine.getStateStore();
      const cutoff = new Date(Date.now() - 120_000).toISOString();
      const activeRows = stateStore.db?.prepare(
        `SELECT claimed_by, MAX(claimed_at) AS last_claim, COUNT(*) AS claims_recent
         FROM task_pool
         WHERE claimed_by IS NOT NULL AND claimed_at >= ?
         GROUP BY claimed_by
         ORDER BY last_claim DESC`
      ).all(cutoff) || [];
      const totalActive = activeRows.length;
      const depth = stateStore.queueDepth ? stateStore.queueDepth() : { open: 0, claimed: 0, done: 0, failed: 0 };
      res.json({
        active: totalActive,
        workers: activeRows.map((r: any) => ({
          id: r.claimed_by,
          lastClaim: r.last_claim,
          recentClaims: r.claims_recent,
        })),
        depth,
        cutoffSeconds: 120,
      });
    } catch (e: any) {
      log.warn('workers endpoint failed', { error: e.message });
      res.json({ active: 0, workers: [], depth: {}, cutoffSeconds: 120 });
    }
  });

  // Helper — resolve the two relevant endpoints once per request.
  const librarianEndpointOrig = () => process.env.OLLAMA_LIBRARIAN_BASE_URL
    || aiRouter.config.get<string>('ai.ollama.librarianEndpoint', 'http://localhost:11435');
  const writerEndpoint = () => process.env.OLLAMA_BASE_URL
    || aiRouter.config.get<string>('ai.ollama.endpoint', 'http://localhost:11434');

  // GPU Power — release the 5070 Ti by:
  //   1. Unloading all models on ollama-embeddings (keep_alive: 0)
  //   2. Rerouting the librarian provider to the writer's Ollama endpoint
  //      so future librarian calls land on the 5090 (which hot-swaps).
  // Reversible via /gpu/librarian/restore.
  router.post('/gpu/librarian/unload', async (req, res) => {
    const libEndpoint = librarianEndpointOrig();
    const writerEp = writerEndpoint();
    try {
      const psResp = await fetch(`${libEndpoint}/api/ps`);
      if (!psResp.ok) throw new Error(`ps failed: ${psResp.status}`);
      const psData = await psResp.json() as any;
      const loaded = (psData.models || []) as Array<{ name: string }>;
      const unloaded: string[] = [];
      for (const m of loaded) {
        const r = await fetch(`${libEndpoint}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m.name, prompt: '', keep_alive: 0, stream: false }),
        });
        if (r.ok) unloaded.push(m.name);
      }
      // Reroute librarian provider to the writer endpoint so audits still work.
      // Ollama on the 5090 will hot-swap models on demand if memory is tight.
      const routing = aiRouter.setLibrarianEndpointOverride(writerEp);
      log.info('Librarian GPU released + rerouted to writer', { unloaded, routing });
      res.json({
        ok: true,
        unloaded,
        count: unloaded.length,
        rerouted: routing.routed,
        librarianEndpoint: routing.current,
      });
    } catch (e: any) {
      log.warn('Librarian unload failed', { error: e.message });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Restore — put the librarian provider back on its original 5070 Ti
  // endpoint. Models will cold-load on the next request.
  router.post('/gpu/librarian/restore', async (req, res) => {
    const routing = aiRouter.setLibrarianEndpointOverride(null);
    log.info('Librarian routing restored to 5070 Ti', { routing });
    res.json({ ok: true, rerouted: routing.routed, librarianEndpoint: routing.current });
  });

  // ─── Claude assist-worker controls ────────────────────────────────────
  // When a book-planning step fails its quality gate, the step-runner queues
  // a `pipeline_step_assist` task. Workers (Claude via /perry-worker) claim,
  // process, and report back; the MCP report_task handler auto-injects the
  // new result into the step. WorkerCoordinator (inside perry) polls these
  // endpoints each cycle to decide:
  //   - mode='auto' + tasks open → POST spawn to perry-worker (rate-limited)
  //   - fire_requested_at recent → POST spawn to perry-worker (one-shot manual)

  // Per-agent meta keys — two agents, two completely independent panels.
  // The task queue (pipeline_step_assist) is shared — whichever agent's
  // mode/fire-flag fires first races to claim. Pending count is therefore
  // the same for both; everything else is per-agent.
  const VALID_AGENTS = ['claude', 'antigrav'] as const;
  type AssistAgent = typeof VALID_AGENTS[number];
  const isAgent = (a: any): a is AssistAgent => VALID_AGENTS.includes(a);
  const modeKey   = (a: AssistAgent) => `assist_worker_mode_${a}`;
  const fireKey   = (a: AssistAgent) => `assist_fire_requested_at_${a}`;
  const lastKey   = (a: AssistAgent) => `assist_last_fired_at_${a}`;
  const heartKey  = (a: AssistAgent) => `assist_daemon_hb_${a}`;
  const configKey = (a: AssistAgent) => `assist_worker_config_${a}`;

  // Per-agent CLI flags configured from the dashboard. Coordinator includes
  // these in each spawn payload; perry-worker's listener builds the actual
  // command line from them. Defaults match the prior hardcoded values.
  const DEFAULT_CONFIG: Record<AssistAgent, { yolo: boolean; model: string }> = {
    claude:   { yolo: true,  model: 'auto' },       // claude doesn't expose model via CLI; yolo = --dangerously-skip-permissions
    antigrav: { yolo: true,  model: 'gemini-2.5-flash' },
  };
  const readConfig = (store: any, a: AssistAgent) => {
    try {
      const raw = store.getMeta(configKey(a));
      if (raw) return { ...DEFAULT_CONFIG[a], ...JSON.parse(raw) };
    } catch (e: any) {
      log.warn('assist worker config meta parse failed — falling back to defaults', { agent: a, error: e.message });
    }
    return { ...DEFAULT_CONFIG[a] };
  };

  const agentSlice = (store: any, a: AssistAgent) => {
    const mode = store.getMeta(modeKey(a)) || 'manual';
    const fireRequestedAt = store.getMeta(fireKey(a)) || null;
    const lastFiredAt = store.getMeta(lastKey(a)) || null;
    const hb = store.getMeta(heartKey(a)) || null;
    const daemonAgeSec = hb ? (Date.now() - new Date(hb).getTime()) / 1000 : null;
    const daemonAlive = daemonAgeSec != null && daemonAgeSec < 60;
    const config = readConfig(store, a);
    return { mode, fireRequestedAt, lastFiredAt, daemonHeartbeatAt: hb, daemonAgeSec, daemonAlive, config };
  };

  // GET — returns shared task counts + per-agent panel state in one shot.
  router.get('/assist-status', (req, res) => {
    const store: any = projectEngine.getStateStore();
    try {
      // Count ALL worker-claimable open tasks, not just pipeline_step_assist.
      // Workers (/perry-worker) handle any task type the queue holds.
      const pending = store.db.prepare(
        "SELECT COUNT(*) AS n FROM task_pool WHERE status='open'"
      ).get().n as number;
      const claimed = store.db.prepare(
        "SELECT COUNT(*) AS n FROM task_pool WHERE status='claimed'"
      ).get().n as number;
      res.json({
        pending, claimed,
        claude:   agentSlice(store, 'claude'),
        antigrav: agentSlice(store, 'antigrav'),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST — set auto-loop toggle for ONE agent. body: { agent, mode }
  router.post('/assist-mode', (req, res) => {
    const { agent, mode } = req.body || {};
    if (!isAgent(agent)) return res.status(400).json({ error: "agent must be 'claude' or 'antigrav'" });
    if (mode !== 'auto' && mode !== 'manual') return res.status(400).json({ error: "mode must be 'auto' or 'manual'" });
    projectEngine.getStateStore().setMeta(modeKey(agent), mode);
    log.info('Assist worker mode set', { agent, mode });
    res.json({ ok: true, agent, mode });
  });

  // POST — one-shot manual fire request for ONE agent. body: { agent }
  router.post('/fire-assist-worker', (req, res) => {
    const { agent } = req.body || {};
    if (!isAgent(agent)) return res.status(400).json({ error: "agent must be 'claude' or 'antigrav'" });
    const now = new Date().toISOString();
    projectEngine.getStateStore().setMeta(fireKey(agent), now);
    log.info('Assist worker fire requested (manual)', { agent, at: now });
    res.json({ ok: true, agent, fireRequestedAt: now });
  });

  // POST — daemon ACK: stamps last-fired + clears the one-shot flag.
  // body: { agent }
  router.post('/assist-fired', (req, res) => {
    const { agent } = req.body || {};
    if (!isAgent(agent)) return res.status(400).json({ error: "agent must be 'claude' or 'antigrav'" });
    const now = new Date().toISOString();
    const store: any = projectEngine.getStateStore();
    store.setMeta(lastKey(agent), now);
    store.db.prepare("DELETE FROM meta WHERE key=?").run(fireKey(agent));
    res.json({ ok: true, agent, lastFiredAt: now });
  });

  // POST — update per-agent CLI config (yolo flag, model). Body:
  //   { agent: 'claude'|'antigrav', yolo?: boolean, model?: string }
  // Only the provided fields are updated; rest stay as before.
  router.post('/assist-config', (req, res) => {
    const { agent, ...patch } = req.body || {};
    if (!isAgent(agent)) return res.status(400).json({ error: "agent must be 'claude' or 'antigrav'" });
    const store: any = projectEngine.getStateStore();
    const current = readConfig(store, agent);
    const updated: any = { ...current };
    if (typeof patch.yolo === 'boolean') updated.yolo = patch.yolo;
    if (typeof patch.model === 'string') updated.model = patch.model;
    store.setMeta(configKey(agent), JSON.stringify(updated));
    log.info('Assist worker config updated', { agent, config: updated });
    res.json({ ok: true, agent, config: updated });
  });

  // POST — daemon heartbeat. body: { agent }
  router.post('/assist-heartbeat', (req, res) => {
    const { agent } = req.body || {};
    if (!isAgent(agent)) return res.status(400).json({ error: "agent must be 'claude' or 'antigrav'" });
    projectEngine.getStateStore().setMeta(heartKey(agent), new Date().toISOString());
    res.json({ ok: true });
  });

  // ── Mode-toggle endpoint (kept for direct API callers / legacy clients) ───
  // Dashboard click → flag written here. WorkerCoordinator consumes the
  // `daemon_control_{agent}` meta key each tick and flips the matching
  // `assist_worker_mode_{agent}` between 'auto' and 'manual'. The dashboard
  // UI does this directly via the mode-toggle checkbox now; this endpoint
  // stays for scripted callers.
  const controlKey = (a: AssistAgent) => `daemon_control_${a}`;       // 'start' | 'stop' (one-shot)
  const stopRequestKey = (a: AssistAgent) => `daemon_stop_requested_${a}`;  // set when stop fired; daemons check this

  router.post('/daemon-control', (req, res) => {
    const { agent, action } = req.body || {};
    if (!isAgent(agent)) return res.status(400).json({ error: "agent must be 'claude' or 'antigrav'" });
    if (action !== 'start' && action !== 'stop') return res.status(400).json({ error: "action must be 'start' or 'stop'" });
    const store: any = projectEngine.getStateStore();
    const now = new Date().toISOString();
    store.setMeta(controlKey(agent), JSON.stringify({ action, at: now }));
    if (action === 'stop') store.setMeta(stopRequestKey(agent), now);
    log.info('Daemon control requested', { agent, action });
    res.json({ ok: true, agent, action, at: now });
  });

  // GET — what the bootstrap watcher polls. Returns any pending start/stop
  // requests for either agent that are <60s old.
  router.get('/daemon-control-pending', (req, res) => {
    const store: any = projectEngine.getStateStore();
    const out: any = {};
    for (const a of VALID_AGENTS) {
      const raw = store.getMeta(controlKey(a));
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const age = (Date.now() - new Date(parsed.at).getTime()) / 1000;
        if (age < 60) out[a] = { ...parsed, ageSec: age };
      } catch (e: any) {
        log.warn('daemon-control meta parse failed', { agent: a, error: e.message });
      }
    }
    res.json(out);
  });

  // POST — bootstrap acknowledges a request (clears the control flag).
  // body: { agent, action }
  router.post('/daemon-control-ack', (req, res) => {
    const { agent } = req.body || {};
    if (!isAgent(agent)) return res.status(400).json({ error: "agent must be 'claude' or 'antigrav'" });
    const store: any = projectEngine.getStateStore();
    store.db.prepare("DELETE FROM meta WHERE key=?").run(controlKey(agent));
    res.json({ ok: true, agent });
  });

  // GET — daemons poll this each cycle. Returns true if a stop was requested
  // for this agent within the last 5min (gives daemons time to react).
  router.get('/daemon-stop-check', (req, res) => {
    const agent = req.query.agent as string;
    if (!isAgent(agent)) return res.status(400).json({ error: "agent must be 'claude' or 'antigrav'" });
    const raw = projectEngine.getStateStore().getMeta(stopRequestKey(agent));
    if (!raw) return res.json({ shouldStop: false });
    const age = (Date.now() - new Date(raw).getTime()) / 1000;
    res.json({ shouldStop: age < 300, requestedAt: raw, ageSec: age });
  });

  // POST — daemon acks the stop (so it doesn't fire again on next start).
  router.post('/daemon-stop-ack', (req, res) => {
    const { agent } = req.body || {};
    if (!isAgent(agent)) return res.status(400).json({ error: "agent must be 'claude' or 'antigrav'" });
    const store: any = projectEngine.getStateStore();
    store.db.prepare("DELETE FROM meta WHERE key=?").run(stopRequestKey(agent));
    res.json({ ok: true, agent });
  });

  // Researcher endpoint helpers — mirror the librarian pattern. Researcher
  // can live on the writer GPU (5090, swap-with-writer) OR the librarian GPU
  // (5070 Ti, parallel with librarian). Stored in config; reinitialize picks up.
  const researcherEndpointCurrent = () => process.env.OLLAMA_RESEARCHER_BASE_URL
    || aiRouter.config.get<string>('ai.ollama.researcherEndpoint', '')
    || writerEndpoint();

  // Researcher mode — 'local' (default) or 'workers'. When 'workers', the
  // engine enqueues research_assist tasks for Claude/Gemini instead of calling
  // the local researcher model. Stored separately from endpoint so toggling
  // back to local preserves the user's GPU choice.
  const researcherMode = () => aiRouter.config.get<string>('ai.ollama.researcherMode', 'local');

  // GET — what's loaded on the researcher's current endpoint + which GPU it's on.
  router.get('/gpu/researcher/status', async (req, res) => {
    const ep = researcherEndpointCurrent();
    const onLibrarianGpu = ep === librarianEndpointOrig();
    const mode = researcherMode();
    if (mode === 'workers') {
      return res.json({
        loadedCount: 0, models: [], currentEndpoint: ep,
        gpu: 'Workers', onLibrarianGpu, mode,
      });
    }
    try {
      const r = await fetch(`${ep}/api/ps`);
      const data = await r.json() as any;
      const loaded = (data.models || []) as Array<{ name: string; size_vram?: number }>;
      res.json({
        loadedCount: loaded.length,
        models: loaded.map(m => ({ name: m.name, vramBytes: m.size_vram || 0 })),
        currentEndpoint: ep,
        gpu: onLibrarianGpu ? '5070 Ti' : '5090',
        onLibrarianGpu, mode,
      });
    } catch (e: any) {
      res.json({ loadedCount: 0, models: [], currentEndpoint: ep,
                 gpu: onLibrarianGpu ? '5070 Ti' : '5090', onLibrarianGpu, mode, error: e.message });
    }
  });

  // POST — switch which GPU/queue the researcher uses.
  // Body: { target: 'writer' | 'librarian' | 'workers' }
  router.post('/gpu/researcher/endpoint', async (req, res) => {
    const { target } = req.body || {};
    if (target !== 'writer' && target !== 'librarian' && target !== 'workers') {
      return res.status(400).json({ error: "target must be 'writer', 'librarian', or 'workers'" });
    }
    if (target === 'workers') {
      aiRouter.config.set('ai.ollama.researcherMode', 'workers');
      log.info('Researcher mode switched', { target, mode: 'workers' });
      return res.json({ ok: true, target, mode: 'workers' });
    }
    // local mode — pick endpoint and reset mode flag
    const newEp = target === 'librarian' ? librarianEndpointOrig() : writerEndpoint();
    aiRouter.config.set('ai.ollama.researcherEndpoint', newEp);
    aiRouter.config.set('ai.ollama.researcherMode', 'local');
    await aiRouter.initialize();
    log.info('Researcher endpoint switched', { target, endpoint: newEp, mode: 'local' });
    res.json({ ok: true, target, currentEndpoint: newEp, mode: 'local' });
  });

  // GPU status — what's currently loaded on whichever endpoint the librarian
  // is pointed at, plus whether the routing override is active.
  router.get('/gpu/librarian/status', async (req, res) => {
    const isRouted = aiRouter.isLibrarianRoutedToWriter();
    const libProvider: any = aiRouter.getProvider('librarian');
    const currentEndpoint = libProvider?.providerConfig?.endpoint || librarianEndpointOrig();
    try {
      const r = await fetch(`${currentEndpoint}/api/ps`);
      const data = await r.json() as any;
      const loaded = (data.models || []) as Array<{ name: string; size_vram?: number }>;
      res.json({
        loadedCount: loaded.length,
        models: loaded.map(m => ({ name: m.name, vramBytes: m.size_vram || 0 })),
        rerouted: isRouted,
        currentEndpoint,
      });
    } catch (e: any) {
      res.json({ loadedCount: 0, models: [], rerouted: isRouted, currentEndpoint, error: e.message });
    }
  });

  // Feature 11: GPU Model Swapping
  router.get('/models', async (req, res) => {
    try {
      const role = req.query.role as string;
      const ollamaEndpoint = role === 'librarian'
        ? (process.env.OLLAMA_LIBRARIAN_BASE_URL || aiRouter.config.get<string>('ai.ollama.librarianEndpoint', 'http://localhost:11435'))
        : role === 'researcher'
          ? researcherEndpointCurrent()
          : aiRouter.config.get<string>('ai.ollama.endpoint', 'http://localhost:11434');

      const response = await fetch(`${ollamaEndpoint}/api/tags`);
      const data = await response.json() as any;
      res.json({ models: data.models?.map((m: any) => m.name) || [] });
    } catch (e: any) {
      log.error('Failed to fetch Ollama models', { error: e.message });
      res.json({ models: [] });
    }
  });

  router.post('/models/swap', async (req, res) => {
    try {
      const { role, model } = req.body;
      if (!role || !model) {
        return res.status(400).json({ error: 'Role and model are required' });
      }

      if (role === 'writer') {
        aiRouter.config.set('ai.ollama.model', model);
      } else if (role === 'librarian') {
        aiRouter.config.set('ai.ollama.librarianModel', model);
      } else if (role === 'researcher') {
        aiRouter.config.set('ai.ollama.researcherModel', model);
      } else if (role === 'director') {
        aiRouter.config.set('ai.ollama.directorModel', model);
      } else {
        return res.status(400).json({ error: 'Invalid role' });
      }

      // Preload model into VRAM so ContextWatcher detects it
      try {
        let endpoint = aiRouter.config.get<string>('ai.ollama.endpoint', 'http://localhost:11434');

        if (role === 'librarian') {
          endpoint = process.env.OLLAMA_LIBRARIAN_BASE_URL || aiRouter.config.get<string>('ai.ollama.librarianEndpoint', 'http://localhost:11435');
        } else if (role === 'researcher') {
          endpoint = researcherEndpointCurrent();
        } else if (role === 'director') {
          const directorProvider = aiRouter.config.get<string>('ai.director.provider', 'ollama');
          if (directorProvider === 'librarian') {
            endpoint = process.env.OLLAMA_LIBRARIAN_BASE_URL || aiRouter.config.get<string>('ai.ollama.librarianEndpoint', 'http://localhost:11435');
          }
        }

        await fetch(`${endpoint}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model, keep_alive: '5m' })
        });
      } catch (e: any) {
        log.warn('Failed to preload model into VRAM', { error: e.message });
      }

      // Reinitialize providers to pick up new models
      await aiRouter.initialize();

      // Update Context Watcher stats to immediately reflect new labels
      await aiRouter.contextWatcher.pollAll();

      res.json({ success: true });
    } catch (error: any) {
      log.error('Failed to swap model', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/director-provider', async (req, res) => {
    try {
      const { provider } = req.body; // 'ollama' or 'librarian'
      if (!provider) return res.status(400).json({ error: 'Provider is required' });
      aiRouter.config.set('ai.director.provider', provider);
      await aiRouter.initialize();
      res.json({ success: true });
    } catch (error: any) {
      log.error('Failed to swap director provider', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // ── Living bible diffs (per-project accumulated stat-update history) ──
  // Read-only view onto meta['living_diffs_{projectId}']. The dashboard
  // can render a timeline of how characters/world evolved chapter-by-chapter.
  router.get('/living-diffs/:projectId', (req, res) => {
    try {
      const projectId = req.params.projectId;
      const raw = projectEngine.getStateStore().getMeta(`living_diffs_${projectId}`);
      let diffs: any[] = [];
      if (raw) { try { diffs = JSON.parse(raw); } catch { diffs = []; } }
      res.json({ ok: true, diffs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── RAG: vector retrieval + drift ────────────────────────────────────
  // Powered by nomic-embed-text on the 5070 Ti + the chunks table.
  router.get('/rag/stats/:projectId', (req, res) => {
    try {
      if (!ragService) return res.status(503).json({ error: 'RAG service not initialized' });
      const projectId = req.params.projectId;
      const s = ragService.stats(projectId);
      res.json({ ok: true, projectId, total: s.total, byKind: s.byKind });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  router.post('/rag/search', async (req, res) => {
    try {
      if (!ragService) return res.status(503).json({ error: 'RAG service not initialized' });
      const { projectId, query, kinds, topK, minScore, global } = req.body || {};
      if (typeof query !== 'string' || !query.trim()) return res.status(400).json({ error: 'query (string) required' });
      const hits = global
        ? await ragService.retrieveGlobal({ query, kinds, topK, minScore })
        : await ragService.retrieve({ projectId, query, kinds, topK, minScore });
      res.json({ ok: true, hits });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  router.post('/rag/drift', async (req, res) => {
    try {
      if (!ragService) return res.status(503).json({ error: 'RAG service not initialized' });
      const { projectId, text, centroidKind, centroidProjectId } = req.body || {};
      if (typeof text !== 'string' || text.trim().length < 80) return res.status(400).json({ error: 'text (>=80 chars) required' });
      const out = await ragService.driftScore({
        projectId, text,
        centroidKind: centroidKind || 'voice_anchor',
        centroidProjectId,
      });
      res.json({ ok: true, drift: out });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  router.get('/rag/drift/:projectId', (req, res) => {
    try {
      const projectId = req.params.projectId;
      const project = projectEngine.getStateStore().get(projectId);
      if (!project) return res.status(404).json({ error: 'project not found' });
      const scores: Array<any> = [];
      for (const step of project.steps) {
        const raw = projectEngine.getStateStore().getMeta(`drift_${step.id}`);
        if (raw) {
          try { scores.push(JSON.parse(raw)); } catch { /* skip */ }
        }
      }
      // Sort by chapter ascending (null first), then by recordedAt.
      scores.sort((a, b) => (a.chapter ?? -1) - (b.chapter ?? -1));
      res.json({ ok: true, projectId, scores });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Voice anchors per pen ─────────────────────────────────────────────
  // Reads meta['voice_anchors_{slug}'] (curated + user-submitted samples)
  // used by prompt-builder to inject voice anchors into the first scene of
  // a book when there's no prior chapter to draw from.
  router.get('/voice-anchors/:slug', (req, res) => {
    try {
      const slug = req.params.slug;
      const raw = projectEngine.getStateStore().getMeta(`voice_anchors_${slug}`);
      let anchors: any[] = [];
      if (raw) {
        try { anchors = JSON.parse(raw); } catch { anchors = []; }
      }
      res.json({ ok: true, anchors });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  // POST a paste — add directly to meta as a user_submitted anchor AND
  // enqueue a voice_anchor_score task so a worker grades it asynchronously.
  // The prompt-builder picks it up immediately (we trust user submissions);
  // the worker's score lands in the .jsonl files for the next training pass.
  // Semantic dedup: embed the paste and refuse if cosine > 0.92 with an
  // existing anchor (configurable via ?force=true). Keeps the pool clean.
  router.post('/voice-anchors/:slug/submit', async (req, res) => {
    try {
      const slug = req.params.slug;
      const { text } = (req.body || {}) as { text?: string };
      const force = req.query.force === 'true';
      if (typeof text !== 'string' || text.trim().length < 40) {
        return res.status(400).json({ error: 'text must be at least 40 characters' });
      }
      const prose = text.trim();
      const wordCount = prose.split(/\s+/).length;
      const tier = wordCount <= 30 ? 'sentence' : wordCount <= 200 ? 'paragraph' : 'scene_segment';
      const id = `anchor-${slug}-user-${Date.now().toString(36)}`;
      const store = projectEngine.getStateStore();
      const existingRaw = store.getMeta(`voice_anchors_${slug}`);
      const existing: any[] = existingRaw ? (() => { try { return JSON.parse(existingRaw); } catch { return []; } })() : [];

      // ── Semantic dedup ──
      // Embed the paste, score against existing anchors, refuse near-duplicates.
      // Skipped when force=true, when embedding service is unreachable, or when
      // there are no existing anchors to compare against.
      if (!force && existing.length > 0) {
        try {
          if (await aiRouter.embeddings.isAvailable()) {
            const candidates = existing
              .filter((a: any) => a?.id && (a?.prose || a?.text))
              .map((a: any) => ({ id: a.id, text: (a.prose || a.text || '').slice(0, 4000) }));
            if (candidates.length > 0) {
              const ranked = await aiRouter.embeddings.similarityAgainst(prose, candidates);
              const top = ranked[0];
              const DUP_THRESHOLD = 0.92;
              if (top && top.score >= DUP_THRESHOLD) {
                return res.status(409).json({
                  error: 'near-duplicate of existing anchor',
                  similarityScore: top.score,
                  threshold: DUP_THRESHOLD,
                  duplicateOf: top.id,
                  hint: 'Submit again with ?force=true to add anyway.',
                });
              }
            }
          }
        } catch (e: any) {
          log.warn('semantic dedup skipped (embedding error)', { error: e.message });
        }
      }

      const newAnchor = {
        id,
        slug,
        tier,
        sourceAttribution: 'user-submitted via dashboard',
        sourceType: 'user_submitted',
        prose,
        wordCount,
        weight: 3.0,
        createdAt: new Date().toISOString(),
        active: true,
      };
      existing.push(newAnchor);
      store.setMeta(`voice_anchors_${slug}`, JSON.stringify(existing));
      // Best-effort scoring — log but don't fail if enqueue blows up.
      try {
        store.enqueueTasks('voice_anchor_score', [{
          candidate_id: id,
          candidate_text: prose,
          pen_slug: slug,
        }], slug);
      } catch (e: any) {
        log.warn('voice_anchor_score enqueue failed (anchor still added to meta)', { error: e.message });
      }
      res.json({ ok: true, anchor: newAnchor, totalAnchors: existing.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  router.delete('/voice-anchors/:slug/:id', (req, res) => {
    try {
      const { slug, id } = req.params;
      const store = projectEngine.getStateStore();
      const existingRaw = store.getMeta(`voice_anchors_${slug}`);
      if (!existingRaw) return res.json({ ok: true, removed: 0 });
      let existing: any[] = [];
      try { existing = JSON.parse(existingRaw); } catch { existing = []; }
      const before = existing.length;
      const filtered = existing.filter(a => a?.id !== id);
      store.setMeta(`voice_anchors_${slug}`, JSON.stringify(filtered));
      res.json({ ok: true, removed: before - filtered.length, totalAnchors: filtered.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Project audit verdicts (bulk) ─────────────────────────────────────
  // Returns a map of stepId → { audit, povVerdict } for every step in the
  // project that has a recorded verdict. Used by the dashboard to render
  // verdict badges without N+1 fetches.
  router.get('/audit/project/:projectId', (req, res) => {
    try {
      const projectId = req.params.projectId;
      const project = projectEngine.getStateStore().get(projectId);
      if (!project) return res.status(404).json({ error: 'project not found' });
      const verdicts: Record<string, { audit?: any; povVerdict?: any }> = {};
      const parse = (raw: string | null | undefined) => {
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return { raw }; }
      };
      for (const step of project.steps) {
        const audit = parse(projectEngine.getStateStore().getMeta(`step_audit_${step.id}`));
        const pov = parse(projectEngine.getStateStore().getMeta(`pov_verdict_${step.id}`));
        if (audit || pov) {
          verdicts[step.id] = {
            ...(audit ? { audit } : {}),
            ...(pov ? { povVerdict: pov } : {}),
          };
        }
      }
      res.json({ ok: true, verdicts });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Step audit verdicts (async quality audit + POV verdict) ───────────
  // Workers store advisory verdicts at meta['step_audit_{step_id}'] and
  // (when POVGate is in advisory mode) meta['pov_verdict_{step_id}'].
  // Returns both so the dashboard can render a single badge per step.
  router.get('/audit/step/:stepId', (req, res) => {
    try {
      const stepId = req.params.stepId;
      const auditRaw = projectEngine.getStateStore().getMeta(`step_audit_${stepId}`);
      const povRaw   = projectEngine.getStateStore().getMeta(`pov_verdict_${stepId}`);
      const parse = (raw: string | null | undefined) => {
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return { raw }; }
      };
      res.json({
        ok: true,
        audit: parse(auditRaw),
        povVerdict: parse(povRaw),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Scene-by-scene chapter writes toggle ──────────────────────────────
  // When enabled, new projects' chapter steps are split at ~1200 words
  // per segment instead of 3000, so the writer produces scene-sized chunks
  // that match the v7 LoRA's training shape. Existing projects unaffected
  // (the divisor is captured at project-create time).
  router.get('/pipeline/scene-by-scene', (_req, res) => {
    try {
      const raw = projectEngine.getStateStore().getMeta('pipeline.sceneByScene.enabled');
      const enabled = raw === 'true';
      res.json({ ok: true, enabled });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  router.put('/pipeline/scene-by-scene', (req, res) => {
    try {
      const { enabled } = (req.body || {}) as { enabled?: boolean };
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      projectEngine.getStateStore().setMeta('pipeline.sceneByScene.enabled', String(enabled));
      log.info('Scene-by-scene mode updated', { enabled });
      res.json({ ok: true, enabled });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── POV gate blocking/advisory toggle ─────────────────────────────────
  // When blocking=true (default), POVGate resets+retries chapters scoring
  // below 8. When false, it logs the verdict and moves on — same shape as
  // the async-quality-audit guard. Use advisory once the writer LoRA is
  // good enough that the rewrite loop hurts more than it helps.
  router.get('/quality/pov-gate-blocking', (_req, res) => {
    try {
      const raw = projectEngine.getStateStore().getMeta('quality.povGate.blocking');
      const blocking = raw == null ? true : raw !== 'false';
      res.json({ ok: true, blocking });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  router.put('/quality/pov-gate-blocking', (req, res) => {
    try {
      const { blocking } = (req.body || {}) as { blocking?: boolean };
      if (typeof blocking !== 'boolean') {
        return res.status(400).json({ error: 'blocking must be a boolean' });
      }
      projectEngine.getStateStore().setMeta('quality.povGate.blocking', String(blocking));
      log.info('POV gate mode updated', { blocking });
      res.json({ ok: true, blocking });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Style DNA global enable/disable toggle ────────────────────────────
  // The trained pen-name LoRA encodes most of what DNA was scaffolding —
  // bans, show-vs-tell, anti-AI-clichés. Toggle DNA OFF when the LoRA is
  // mature enough to write without the scaffold (and OFF kills both the
  // prompt-time injection AND the post-write lint). Toggle ON while a new
  // pen-name's training data is still being curated.
  router.get('/style-dna/enabled', (_req, res) => {
    try {
      const enabled = aiRouter.config.get<boolean>('ai.styleDna.enabled', true);
      res.json({ ok: true, enabled });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  router.put('/style-dna/enabled', (req, res) => {
    try {
      const { enabled } = (req.body || {}) as { enabled?: boolean };
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      aiRouter.config.set('ai.styleDna.enabled', enabled);
      log.info('Style DNA toggle updated', { enabled });
      res.json({ ok: true, enabled });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Dynamic step routing table ────────────────────────────────────────
  // GET returns the effective table (defaults merged with overrides) plus
  // raw overrides so a UI can show "default vs custom" per row.
  // PUT replaces the override map. Empty object resets to defaults.
  router.get('/routing/steps', (_req, res) => {
    try {
      const effective = aiRouter.getRoutingTable();
      const overrides = aiRouter.config.get<any>('ai.routing.taskTypes', null) || {};
      const validTargets = ['writer', 'librarian', 'researcher', 'workers'];
      res.json({ ok: true, effective, overrides, validTargets });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  router.put('/routing/steps', (req, res) => {
    try {
      const { overrides } = (req.body || {}) as { overrides?: Record<string, string> };
      const validTargets = new Set(['writer', 'librarian', 'researcher', 'workers']);
      if (overrides && typeof overrides === 'object') {
        for (const [k, v] of Object.entries(overrides)) {
          if (typeof v !== 'string' || !validTargets.has(v)) {
            return res.status(400).json({ error: `Invalid target "${v}" for taskType "${k}". Must be one of ${[...validTargets].join(', ')}` });
          }
        }
        aiRouter.config.set('ai.routing.taskTypes', overrides);
      } else {
        // Empty / null body resets to defaults
        aiRouter.config.set('ai.routing.taskTypes', {});
      }
      log.info('Step routing overrides updated', { overrides });
      res.json({ ok: true, effective: aiRouter.getRoutingTable() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
