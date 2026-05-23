/**
 * @perry/dashboard-api — Pen system / Soul management routes.
 */

import { Router } from 'express';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Logger } from '@perry/core';
import type { ProjectEngine } from '@perry/projects';

export function setupPensRoutes(projectEngine: ProjectEngine, workspaceDir: string, log: Logger) {
  const router = Router();
  const stateStore = projectEngine.getStateStore();
  const db = (stateStore as any).db;
  const pensDir = join(workspaceDir, 'pens');

  // GET /pens - List all pens
  router.get('/pens', (req, res) => {
    try {
      const pens = stateStore.getPenNames();
      res.json({ pens });
    } catch (err: any) {
      log.error('GET /pens failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // POST /pens - Create a new pen / soul
  router.post('/pens', async (req, res) => {
    try {
      const { slug, displayName, genreOrSeries, voiceTagline, baseModel } = req.body || {};
      if (!slug || typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: 'slug must be kebab-case' });
      }
      if (!displayName || typeof displayName !== 'string') {
        return res.status(400).json({ error: 'displayName is required' });
      }

      if (!db) {
        return res.status(503).json({ error: 'Database not available' });
      }

      // Check if pen already exists
      const existing = db.prepare('SELECT 1 FROM pen_names WHERE slug = ?').get(slug);
      if (existing) {
        return res.status(409).json({ error: `Pen "${slug}" already exists` });
      }

      // Insert into database
      const now = new Date().toISOString();
      const defaultData = JSON.stringify({ antiPatterns: [] });
      db.prepare(`
        INSERT INTO pen_names (slug, display_name, genre_or_series, voice_tagline, base_model, created_at, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(slug, displayName, genreOrSeries || null, voiceTagline || null, baseModel || 'workers', now, defaultData);

      // Create directories & initial SOUL.md / LESSONS.md files on disk
      const targetDir = join(pensDir, slug);
      await mkdir(targetDir, { recursive: true });

      const defaultSoul = [
        `# SOUL: ${displayName}`,
        ``,
        `## Style DNA`,
        `- Tone: Natural, engaging, human.`,
        `- Vocabulary: Precise, avoids clichés.`,
        `- Pacing: Measured, showing rather than telling.`,
        ``,
        `## Voice Tagline`,
        `_${voiceTagline || 'No tagline configured'}_`,
        ``,
      ].join('\n');

      const defaultLessons = [
        `# LESSONS: ${displayName}`,
        ``,
        `## Core Principles`,
        `1. Keep prose clean and grounded.`,
        `2. Avoid repetitive sentence structures.`,
        ``,
      ].join('\n');

      await writeFile(join(targetDir, 'SOUL.md'), defaultSoul, 'utf-8');
      await writeFile(join(targetDir, 'LESSONS.md'), defaultLessons, 'utf-8');

      log.info('Created new pen / soul', { slug, displayName });
      res.status(201).json({ ok: true, slug, displayName });
    } catch (err: any) {
      log.error('POST /pens failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // GET /pens/:slug/profile - Get profile (SOUL.md & LESSONS.md)
  router.get('/pens/:slug/profile', async (req, res) => {
    try {
      const { slug } = req.params;
      const targetDir = join(pensDir, slug);

      let soul: string | null = null;
      let lessons: string | null = null;

      const soulPath = join(targetDir, 'SOUL.md');
      if (existsSync(soulPath)) {
        soul = await readFile(soulPath, 'utf-8');
      }

      const lessonsPath = join(targetDir, 'LESSONS.md');
      if (existsSync(lessonsPath)) {
        lessons = await readFile(lessonsPath, 'utf-8');
      }

      res.json({ soul, lessons });
    } catch (err: any) {
      log.error('GET /pens/:slug/profile failed', { slug: req.params.slug, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /pens/:slug/profile - Update profile (SOUL.md and/or LESSONS.md)
  router.put('/pens/:slug/profile', async (req, res) => {
    try {
      const { slug } = req.params;
      const { soul, lessons } = req.body || {};
      const targetDir = join(pensDir, slug);

      await mkdir(targetDir, { recursive: true });

      if (typeof soul === 'string') {
        await writeFile(join(targetDir, 'SOUL.md'), soul, 'utf-8');
      }
      if (typeof lessons === 'string') {
        await writeFile(join(targetDir, 'LESSONS.md'), lessons, 'utf-8');
      }

      log.info('Updated pen profile', { slug });
      res.json({ ok: true });
    } catch (err: any) {
      log.error('PUT /pens/:slug/profile failed', { slug: req.params.slug, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // POST /pens/:slug/refresh-profile - Refresh/regenerate profile
  router.post('/pens/:slug/refresh-profile', async (req, res) => {
    try {
      const { slug } = req.params;
      const pen = stateStore.getPenName(slug);
      if (!pen) {
        return res.status(404).json({ error: 'Pen not found' });
      }

      const targetDir = join(pensDir, slug);
      await mkdir(targetDir, { recursive: true });

      // Refresh generates default templates if files don't exist
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
        await writeFile(soulPath, defaultSoul, 'utf-8');
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
        await writeFile(lessonsPath, defaultLessons, 'utf-8');
      }

      log.info('Refreshed/created default profile for pen', { slug });
      res.json({ ok: true });
    } catch (err: any) {
      log.error('POST /pens/:slug/refresh-profile failed', { slug: req.params.slug, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
