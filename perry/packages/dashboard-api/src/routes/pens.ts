/**
 * @perry/dashboard-api — Pen-name + LoRA management routes
 *
 * - GET /pens                       → list all pens with their LoRA versions
 * - GET /pens/:slug                 → single pen + versions
 * - POST /pens/:slug/promote/:version → mark a LoRA as the active writer
 *
 * Promotion takes effect immediately: pen-name-resolver reads
 * pen_names.current_lora_version on every writer request.
 */

import { Router } from 'express';
import { StateStore, AutoLearningService, AuditService, WebhookEmitter, PenProfileService } from '@perry/projects';
import { Logger } from '@perry/core';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export function setupPensRoutes(
  stateStore: StateStore,
  log: Logger,
  workspaceDir: string,
  autoLearning?: AutoLearningService,
  auditService?: AuditService,
  penProfileService?: PenProfileService,
) {
  const router = Router();

  const trainingDir = (slug: string) => join(workspaceDir, 'training', `pen-${slug}`);

  function tailLines(path: string, limit: number): string[] {
    if (!existsSync(path)) return [];
    try {
      const text = readFileSync(path, 'utf-8');
      const lines = text.split('\n').filter(l => l.trim());
      return lines.slice(-Math.max(1, Math.min(limit, 500)));
    } catch (err) {
      log.warn('tail read failed', { path, error: (err as Error).message });
      return [];
    }
  }

  router.get('/', (_req, res) => {
    try {
      const pens = stateStore.getPenNames().map(p => ({
        slug: p.slug,
        displayName: p.displayName,
        genreOrSeries: p.genreOrSeries,
        voiceTagline: p.voiceTagline,
        baseModel: p.baseModel,
        currentLoraVersion: p.currentLoraVersion,
        loraVersions: stateStore.getLoraVersions(p.slug).map(v => ({
          version: v.version,
          ollamaTag: v.ollamaTag,
          currentlyRegisteredAs: v.currentlyRegisteredAs,
          trainingPairs: v.trainingPairs,
          trainingSteps: v.trainingSteps,
          epochs: v.epochs,
          finalLoss: v.finalLoss,
          loraRank: v.loraRank,
          trainedAt: v.trainedAt,
          promoted: v.promoted,
          isCurrent: v.version === p.currentLoraVersion,
        })),
        antiPatterns: Array.isArray(p.raw?.antiPatterns) ? p.raw.antiPatterns : [],
      }));
      res.json({ pens });
    } catch (err) {
      log.error('GET /pens failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/:slug', (req, res) => {
    try {
      const pen = stateStore.getPenName(req.params.slug);
      if (!pen) return res.status(404).json({ error: 'pen not found' });
      res.json({
        slug: pen.slug,
        displayName: pen.displayName,
        genreOrSeries: pen.genreOrSeries,
        voiceTagline: pen.voiceTagline,
        baseModel: pen.baseModel,
        currentLoraVersion: pen.currentLoraVersion,
        loraVersions: stateStore.getLoraVersions(pen.slug),
        antiPatterns: Array.isArray(pen.raw?.antiPatterns) ? pen.raw.antiPatterns : [],
      });
    } catch (err) {
      log.error('GET /pens/:slug failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── MCP-targeted endpoints (read-only inspection + write helpers) ─────
  //
  // These let an external assistant (Claude via MCP) see recent mined and
  // rejected pairs, inject curated pairs, trigger an export, and update the
  // pen's anti-pattern list — without going through the live calibration
  // pipeline.

  router.get('/:slug/mined', (req, res) => {
    const slug = req.params.slug;
    const limit = parseInt((req.query.limit as string) || '20', 10);
    const lines = tailLines(join(trainingDir(slug), 'mined_pairs.jsonl'), limit);
    const records = lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    res.json({ slug, count: records.length, records });
  });

  router.get('/:slug/rejected', (req, res) => {
    const slug = req.params.slug;
    const limit = parseInt((req.query.limit as string) || '20', 10);
    const lines = tailLines(join(trainingDir(slug), 'rejected_pairs.log'), limit);
    res.json({ slug, count: lines.length, lines });
  });

  router.post('/:slug/inject-pair', async (req, res) => {
    try {
      if (!autoLearning) return res.status(503).json({ error: 'auto-learning service unavailable' });
      const slug = req.params.slug;
      const { bad, good, category } = req.body || {};
      if (typeof bad !== 'string' || typeof good !== 'string' || !bad.trim() || !good.trim()) {
        return res.status(400).json({ error: 'bad and good must be non-empty strings' });
      }
      const cat = typeof category === 'string' && category.trim() ? category.trim() : 'claude_injected';
      const result = await autoLearning.appendClaudeInjectedPairForPen(slug, bad.trim(), good.trim(), cat);
      log.info('Claude pair injected', { slug, category: cat, totalLines: result.totalLines });
      res.json({ slug, category: cat, ...result });
    } catch (err) {
      log.error('inject-pair failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/:slug/export', async (req, res) => {
    try {
      if (!autoLearning) return res.status(503).json({ error: 'auto-learning service unavailable' });
      const slug = req.params.slug;
      const verifiedCount = await autoLearning.exportForPen(slug);
      res.json({ slug, verifiedPairs: verifiedCount });
    } catch (err) {
      log.error('export failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.put('/:slug/anti-patterns', (req, res) => {
    try {
      const slug = req.params.slug;
      const { patterns } = req.body || {};
      if (!Array.isArray(patterns) || !patterns.every(p => typeof p === 'string')) {
        return res.status(400).json({ error: 'patterns must be a string array' });
      }
      const ok = stateStore.updatePenAntiPatterns(slug, patterns);
      if (!ok) return res.status(404).json({ error: `pen ${slug} not found` });
      res.json({ slug, count: patterns.length });
    } catch (err) {
      log.error('set anti-patterns failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * Phase B — Post-training audit.
   * Runs the audit prompt set through the freshly-trained LoRA, scores every
   * response, writes audit-v{N}.md + audit-v{N}.jsonl, updates priorityTags,
   * and (if the calibration project had promoteOnComplete=true and the audit
   * passes) auto-promotes the LoRA.
   * Slow: returns once the full audit is done (12 prompts × ~30s each ≈ 6 min).
   */
  router.post('/:slug/audit/:version', async (req, res) => {
    try {
      if (!auditService) return res.status(503).json({ error: 'audit service unavailable' });
      const slug = req.params.slug;
      const version = parseInt(req.params.version, 10);
      if (!Number.isFinite(version) || version <= 0) {
        return res.status(400).json({ error: 'version must be a positive integer' });
      }
      let report;
      try {
        report = await auditService.audit(slug, version);
      } catch (innerErr) {
        const msg = (innerErr as Error).message;
        if (msg.includes('not found') || msg.includes('not registered')) {
          return res.status(404).json({ error: msg });
        }
        throw innerErr;
      }
      res.json({
        slug, version,
        passed: report.passed,
        totalFailures: report.totalFailures,
        topFailureTags: report.topFailureTags.slice(0, 10),
        promoted: report.promoted,
        promotionReason: report.promotionReason,
        reportPath: `/workspace/training/pen-${slug}/audit-v${version}.md`,
      });
    } catch (err) {
      log.error('audit failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Manually edit SOUL.md and/or LESSONS.md from the dashboard. Either body
  // is optional — pass only the file you're changing. Audit-time regen will
  // still overwrite these on the next pass; this is for operators who want
  // to tune voice or correct an audit lesson without waiting for an audit.
  router.put('/:slug/profile', async (req, res) => {
    try {
      if (!penProfileService) {
        return res.status(503).json({ error: 'pen-profile service not available' });
      }
      const slug = req.params.slug;
      const { soul, lessons } = req.body || {};
      if (typeof soul !== 'string' && typeof lessons !== 'string') {
        return res.status(400).json({ error: 'at least one of { soul, lessons } must be a string' });
      }
      if (typeof soul === 'string' && soul.length > 20_000) {
        return res.status(400).json({ error: 'soul.md exceeds 20KB; trim before saving' });
      }
      if (typeof lessons === 'string' && lessons.length > 20_000) {
        return res.status(400).json({ error: 'lessons.md exceeds 20KB; trim before saving' });
      }
      const result = await penProfileService.writeManual(slug, { soul, lessons });
      if (!result) {
        return res.status(404).json({ error: `pen ${slug} not found` });
      }
      res.json({
        slug: result.slug,
        soulBytes: result.soulBytes,
        lessonsBytes: result.lessonsBytes,
        note: 'Saved. Next audit on this pen will regenerate these files — your manual edits will be overwritten then.',
      });
    } catch (err) {
      log.error('PUT /pens/:slug/profile failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Read SOUL.md + LESSONS.md content for one pen. Returns null fields when
  // the files don't exist yet (new pen, never audited).
  router.get('/:slug/profile', async (req, res) => {
    try {
      if (!penProfileService) {
        return res.status(503).json({ error: 'pen-profile service not available' });
      }
      const slug = req.params.slug;
      const profile = await penProfileService.load(slug);
      const paths = penProfileService.paths(slug);
      res.json({
        slug,
        soul: profile.soul,
        lessons: profile.lessons,
        soulPath: paths.soul,
        lessonsPath: paths.lessons,
        exists: { soul: !!profile.soul, lessons: !!profile.lessons },
      });
    } catch (err) {
      log.error('GET /pens/:slug/profile failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Regenerate SOUL.md + LESSONS.md for one pen. PromptBuilder reads these
  // files on every chapter call; refresh after curating anti-patterns,
  // adjusting voice principles, or any pen-data change you want the
  // writer to pick up immediately. Audits auto-call this on completion.
  router.post('/:slug/refresh-profile', async (req, res) => {
    try {
      if (!penProfileService) {
        return res.status(503).json({ error: 'pen-profile service not available' });
      }
      const slug = req.params.slug;
      const result = await penProfileService.generate(slug);
      if (!result) {
        return res.status(404).json({ error: `pen ${slug} not found` });
      }
      res.json({
        slug: result.slug,
        soulPath: result.soulPath,
        lessonsPath: result.lessonsPath,
        soulBytes: result.soulBytes,
        lessonsBytes: result.lessonsBytes,
      });
    } catch (err) {
      log.error('POST /pens/:slug/refresh-profile failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/:slug/promote/:version', (req, res) => {
    try {
      const slug = req.params.slug;
      const version = parseInt(req.params.version, 10);
      if (!Number.isFinite(version) || version <= 0) {
        return res.status(400).json({ error: 'version must be a positive integer' });
      }
      const ok = stateStore.promoteLoraVersion(slug, version);
      if (!ok) {
        return res.status(404).json({ error: `no LoRA version ${version} for pen ${slug}` });
      }
      const updated = stateStore.getPenName(slug);
      log.info('LoRA promoted', { slug, version, currentlyRegisteredAs: updated?.currentLoraVersion });
      WebhookEmitter.emit('lora.promoted', {
        pen: slug,
        promotedVersion: version,
        currentLoraVersion: updated?.currentLoraVersion ?? null,
      });
      res.json({
        slug,
        promotedVersion: version,
        currentLoraVersion: updated?.currentLoraVersion,
      });
    } catch (err) {
      log.error('POST /pens/:slug/promote/:version failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
