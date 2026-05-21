/**
 * @perry/dashboard-api — Auth Middleware
 *
 * Bearer token authentication for all API endpoints.
 *
 * Resolution order at boot:
 *   1. SecretsService.getSync('perry_api_key')  ← encrypted vault (preferred)
 *   2. process.env.PERRY_API_KEY                ← fallback if vault is empty
 *   3. (neither) → auth disabled with loud warning
 *
 * The bootstrapFromEnv() pass in index.ts copies PERRY_API_KEY from env
 * into the vault on first boot, so subsequent boots find it in the vault
 * and ignore the env. Removing PERRY_API_KEY from .env after bootstrap
 * is the recommended flow.
 *
 * Rotation: PerryApiKey can be rotated via the dashboard Secrets panel.
 * After rotation the middleware needs to be re-created OR pick up the
 * new value via SecretsService.getSync() per request (we choose per-request
 * since it's a Map lookup — cheap, and means no restart on rotate).
 */

import type { Request, Response, NextFunction } from 'express';
import type { Logger, SecretsService } from '@perry/core';

export function createAuthMiddleware(log: Logger, secrets?: SecretsService): (req: Request, res: Response, next: NextFunction) => void {
  // Resolver re-reads on each request so rotation takes effect immediately.
  // SecretsService.getSync is a Map lookup (the vault is decrypted in
  // memory at boot), so this is cheap.
  const resolveKey = (): string | undefined => {
    return secrets?.getSync('perry_api_key') || process.env.PERRY_API_KEY;
  };

  if (!resolveKey()) {
    log.warn('⚠️ perry_api_key not set in vault or PERRY_API_KEY env — API authentication DISABLED. Set via dashboard Secrets panel or .env for production.');
    return (_req, _res, next) => next();
  }

  log.info('API authentication enabled (resolves per-request from SecretsService)');

  return (req: Request, res: Response, next: NextFunction) => {
    const fullPath = req.originalUrl.split('?')[0];

    // Skip auth for health check + status.
    if ((fullPath === '/api/system/status' || fullPath === '/api/system/health') && req.method === 'GET') {
      return next();
    }

    // Skip auth for inbound webhook receivers — they have their own signature check.
    if (fullPath.startsWith('/api/system/webhooks/')) {
      return next();
    }

    const apiKey = resolveKey();
    if (!apiKey) {
      // Defensive: someone deleted the key after boot. Reject rather than allow.
      res.status(401).json({ error: 'Unauthorized — server has no api key configured' });
      return;
    }

    // Skip auth for SSE streams — both /api/sse and /api/events.
    // EventSource can't send custom headers, so SSE routes accept a
    // `?token=` query param. Frontend appends it from localStorage.
    if (fullPath.startsWith('/api/sse') || fullPath.startsWith('/api/events')) {
      const token = req.query.token as string;
      if (token === apiKey) return next();
      res.status(401).json({ error: 'Unauthorized — invalid token' });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized — missing Bearer token' });
      return;
    }

    const token = authHeader.substring(7);
    if (token !== apiKey) {
      res.status(403).json({ error: 'Forbidden — invalid API key' });
      return;
    }

    next();
  };
}
