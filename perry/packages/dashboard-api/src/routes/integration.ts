import { Router } from 'express';
import { ProjectEngine } from '@perry/projects';
import { Logger } from '@perry/core';
import { createApiKeyMiddleware } from '../middleware/api-key-auth.js';

export function setupIntegrationRoutes(engine: ProjectEngine, log: Logger) {
  const router = Router();
  
  // Protect all integration routes with the API Key middleware
  router.use(createApiKeyMiddleware(log));

  // GET /api/integration/projects/:id/context
  // Provides a highly compressed, LLM-friendly context dump of the project
  router.get('/projects/:id/context', (req, res) => {
    try {
      const project = engine.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Compile a compressed representation of the context
      const contextDump = {
        projectId: project.id,
        title: project.title,
        status: project.status,
        currentStep: project.steps.find(s => s.status === 'active' || s.status === 'pending')?.id,
        context: project.context,
        // Pull the most recent steps (e.g. the last 5 steps to give immediate context)
        recentProgress: project.steps
          .filter(s => s.status === 'completed')
          .slice(-5)
          .map(s => ({
            step: s.id,
            result: s.result,
          })),
      };

      log.info('External integration context request successful', { projectId: project.id, ip: req.ip });
      res.json(contextDump);
    } catch (err: any) {
      log.error('Failed to generate integration context', { error: err.message, projectId: req.params.id });
      res.status(500).json({ error: 'Internal server error while compiling context' });
    }
  });

  return router;
}
