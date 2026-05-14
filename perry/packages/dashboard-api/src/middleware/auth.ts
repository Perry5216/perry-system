/**
 * @perry/dashboard-api — Auth Middleware
 *
 * Bearer token authentication for all API endpoints.
 * The token is stored in the vault under the key 'api.masterKey'.
 * If PERRY_API_KEY env var is set, it's used directly.
 * If neither is configured, auth is disabled with a warning.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Logger } from '@perry/core';

export function createAuthMiddleware(log: Logger): (req: Request, res: Response, next: NextFunction) => void {
  const apiKey = process.env.PERRY_API_KEY;

  if (!apiKey) {
    log.warn('⚠️ PERRY_API_KEY not set — API authentication DISABLED. Set this in .env for production.');
    return (_req, _res, next) => next(); // No-op passthrough
  }

  log.info('API authentication enabled');

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for health check
    if (req.path === '/api/system/status' && req.method === 'GET') {
      return next();
    }

    // Skip auth for SSE streams (they carry the token in query param)
    if (req.path.startsWith('/api/sse')) {
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
