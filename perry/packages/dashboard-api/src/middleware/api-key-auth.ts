import { Request, Response, NextFunction } from 'express';
import { Logger } from '@perry/core';

export function createApiKeyMiddleware(log: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = process.env.PERRY_EXTERNAL_API_KEY;
    
    // If no API key is configured, block external access for security
    if (!apiKey) {
      log.warn('External access attempted, but PERRY_EXTERNAL_API_KEY is not set');
      return res.status(503).json({ error: 'External API integration is disabled. Set PERRY_EXTERNAL_API_KEY in your .env file.' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header. Use Bearer token format.' });
    }

    const token = authHeader.split(' ')[1];
    if (token !== apiKey) {
      log.warn('Unauthorized external access attempt', { ip: req.ip });
      return res.status(403).json({ error: 'Invalid API key' });
    }

    next();
  };
}
