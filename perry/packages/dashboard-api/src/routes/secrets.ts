/**
 * Secrets routes — central API for managing encrypted credentials.
 *
 * Backed by SecretsService which wraps Vault (AES-256-GCM + scrypt KDF).
 *
 * Endpoints:
 *   GET    /secrets                  → metadata only (NEVER values)
 *   POST   /secrets/:name            → set value
 *   POST   /secrets/:name/rotate     → rotate with optional grace period
 *   DELETE /secrets/:name            → remove
 *   GET    /secrets/:name/reveal     → audited one-time read (returns value)
 *   GET    /secrets/audit            → recent activity (optional ?name= filter)
 *
 * All routes are auth-gated by the main middleware. Reveal additionally
 * writes an audit row tagged `reveal` so the user can see which secret
 * was viewed and when.
 */

import { Router } from 'express';
import type { Logger, SecretsService } from '@perry/core';

export function setupSecretsRoutes(secrets: SecretsService, log: Logger) {
  const router = Router();

  router.get('/secrets', (_req, res) => {
    res.json({ secrets: secrets.list() });
  });

  router.post('/secrets/:name', async (req, res) => {
    const name = sanitizeSecretName(req.params.name);
    if (!name) return res.status(400).json({ error: 'invalid secret name (use [a-z_][a-z0-9_]*)' });
    const { value } = req.body || {};
    if (typeof value !== 'string' || !value.length) {
      return res.status(400).json({ error: 'body.value required (non-empty string)' });
    }
    try {
      await secrets.set(name, value, 'dashboard');
      res.json({ ok: true, name });
    } catch (e: any) {
      log.error('secret set failed', { name, error: e.message });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/secrets/:name/rotate', async (req, res) => {
    const name = sanitizeSecretName(req.params.name);
    if (!name) return res.status(400).json({ error: 'invalid secret name' });
    const { value, graceMs } = req.body || {};
    if (typeof value !== 'string' || !value.length) {
      return res.status(400).json({ error: 'body.value required' });
    }
    const grace = typeof graceMs === 'number' ? graceMs : 0;
    try {
      await secrets.rotate(name, value, grace, 'dashboard');
      res.json({ ok: true, name, graceMs: grace });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.delete('/secrets/:name', async (req, res) => {
    const name = sanitizeSecretName(req.params.name);
    if (!name) return res.status(400).json({ error: 'invalid secret name' });
    try {
      const existed = await secrets.delete(name, 'dashboard');
      res.json({ ok: true, name, existed });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/secrets/:name/reveal', async (req, res) => {
    const name = sanitizeSecretName(req.params.name);
    if (!name) return res.status(400).json({ error: 'invalid secret name' });
    try {
      const value = await secrets.reveal(name, 'dashboard');
      if (value === undefined) return res.status(404).json({ error: 'secret not set' });
      res.json({ ok: true, name, value });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/secrets-audit', (req, res) => {
    const name = typeof req.query.name === 'string' ? sanitizeSecretName(req.query.name) : undefined;
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 500);
    res.json({ audit: secrets.audit_recent({ name: name || undefined, limit }) });
  });

  return router;
}

/** Restrict secret names to safe identifier syntax — prevents path
 *  traversal in dashboard URLs and keeps the audit log readable. */
function sanitizeSecretName(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(clean)) return null;
  if (clean.length > 64) return null;
  return clean;
}
