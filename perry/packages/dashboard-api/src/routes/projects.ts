/**
 * @perry/dashboard-api — Project Routes
 */

import { Router } from 'express';
import { ProjectEngine } from '@perry/projects';
import { Logger } from '@perry/core';

export function setupProjectRoutes(engine: ProjectEngine, log: Logger) {
  const router = Router();

  router.get('/', (req, res) => {
    const status = req.query.status as string | undefined;
    res.json(engine.listProjects(status));
  });

  router.post('/', (req, res) => {
    try {
      const project = engine.createProject(req.body);
      res.status(201).json(project);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/:id', (req, res) => {
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json(project);
  });

  router.delete('/:id', (req, res) => {
    const deleted = engine.deleteProject(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  });

  router.post('/:id/execute', async (req, res) => {
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });

    // Start execution in background — the engine handles per-project locking
    // internally (waits for any in-flight execution to drain before starting).
    engine.executeAll(req.params.id).catch((err: any) => {
      log.error('Project execution failed', { projectId: req.params.id, error: err.message });
    });

    res.json({ message: 'Execution started' });
  });

  router.post('/:id/execute-step', async (req, res) => {
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });

    // Start single step execution in background
    engine.executeNextStep(req.params.id).catch((err: any) => {
      log.error('Step execution failed', { projectId: req.params.id, error: err.message });
    });

    res.json({ message: 'Step execution started' });
  });

  router.post('/:id/pause', (req, res) => {
    const paused = engine.pauseProject(req.params.id);
    if (!paused) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Project paused' });
  });

  // Feature 4: Chapter Re-Roll
  router.post('/:id/reset-step/:stepId', (req, res) => {
    const success = engine.resetStep(req.params.id, req.params.stepId);
    if (!success) return res.status(404).json({ error: 'Project or step not found' });
    res.json({ message: 'Step reset to pending' });
  });

  // Feature: Batch Re-Roll
  router.post('/:id/reset-steps', (req, res) => {
    const { stepIds } = req.body;
    if (!stepIds || !Array.isArray(stepIds)) {
      return res.status(400).json({ error: 'Invalid stepIds array' });
    }
    const success = engine.resetSteps(req.params.id, stepIds);
    if (!success) return res.status(404).json({ error: 'Project or steps not found' });
    res.json({ message: 'Steps reset to pending' });
  });

  // Feature: Update step result manually
  router.put('/:id/steps/:stepId/result', (req, res) => {
    const { result } = req.body;
    if (typeof result !== 'string') {
      return res.status(400).json({ error: 'Invalid result string' });
    }
    const success = engine.updateStepResult(req.params.id, req.params.stepId, result);
    if (!success) return res.status(404).json({ error: 'Project or step not found' });
    res.json({ message: 'Step result updated' });
  });

  // Feature: Step I/O Inspector (n8n-style input/output view)
  router.get('/:id/steps/:stepId/io', (req, res) => {
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    const step = project.steps.find(s => s.id === req.params.stepId);
    if (!step) return res.status(404).json({ error: 'Step not found' });
    
    // Get the full input (prompts) from telemetry
    const stateStore = engine.getStateStore();
    const telemetry = stateStore.getTelemetry(project.id, step.id);
    
    // Build the response
    const io: any = {
      stepId: step.id,
      label: step.label,
      taskType: step.taskType,
      status: step.status,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      // Input: the prompts sent to the AI
      input: telemetry ? {
        systemPrompt: telemetry.systemPrompt,
        userPrompt: telemetry.userPrompt,
        sentAt: telemetry.createdAt,
      } : null,
      // Output: the AI response / generated content
      output: step.result || null,
      error: step.error || null,
    };

    res.json(io);
  });

  // Goals API
  router.get('/:id/goal', (req, res) => {
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    const goalStr = engine.getStateStore().getMeta('project_goal:' + req.params.id);
    if (goalStr) {
      try {
        const goal = JSON.parse(goalStr);
        return res.json(goal);
      } catch {}
    }
    res.json({ text: '', status: 'paused', turnsUsed: 0, subgoals: [] });
  });

  // Director Chat API
  router.get('/:id/chat', (req, res) => {
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    const history = engine.getStateStore().getChatHistory(req.params.id);
    res.json(history);
  });

  router.post('/:id/chat', async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid message' });
    }
    try {
      const response = await engine.chatWithDirector(req.params.id, message);
      res.json({ response });
    } catch (err: any) {
      log.error('Director chat failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id/chat', (req, res) => {
    try {
      engine.clearDirectorChat(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      log.error('Failed to clear director chat', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
