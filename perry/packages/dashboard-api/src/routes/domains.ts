/**
 * @perry/dashboard-api — Domains routes
 *
 * CRUD over `workspace/domains/` for the Domains panel. Built-in "books"
 * domain is auto-seeded; user-created domains can be added/edited/deleted.
 *
 *   GET    /api/domains           list all
 *   GET    /api/domains/:id       fetch one
 *   POST   /api/domains           create
 *   PATCH  /api/domains/:id       update
 *   DELETE /api/domains/:id       delete (only non-builtin)
 */

import { Router } from 'express';
import type { Logger } from '@perry/core';
import type { DomainRegistry } from '@perry/projects';

export function setupDomainsRoutes(registry: DomainRegistry, log: Logger) {
  const router = Router();

  router.get('/', (_req, res) => {
    try { res.json({ domains: registry.list() }); }
    catch (err: any) { log.error('GET /domains failed', { error: err.message }); res.status(500).json({ error: err.message }); }
  });

  router.get('/:id', (req, res) => {
    const d = registry.get(req.params.id);
    if (!d) return res.status(404).json({ error: 'not found' });
    res.json(d);
  });

  router.post('/', (req, res) => {
    const result = registry.create(req.body);
    if ('error' in result) return res.status(400).json(result);
    res.status(201).json(result);
  });

  router.patch('/:id', (req, res) => {
    const result = registry.update(req.params.id, req.body);
    if ('error' in result) {
      const code = result.error.includes('not found') ? 404 : 400;
      return res.status(code).json(result);
    }
    res.json(result);
  });

  router.delete('/:id', (req, res) => {
    const result = registry.delete(req.params.id);
    if ('error' in result) {
      const code = result.error.includes('not found') ? 404 : 400;
      return res.status(code).json(result);
    }
    res.status(204).send();
  });

  return router;
}
