/**
 * @perry/dashboard-api — Project Routes
 */

import { Router } from 'express';
import { join } from 'path';
import { ProjectEngine, DomainRegistry } from '@perry/projects';
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

  router.post('/:id/generate-template', async (req, res) => {
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });

    try {
      const workspaceDir = engine.getStateStore().getWorkspaceDir();
      const domainRegistry = new DomainRegistry({ workspaceDir, log });
      
      const { projectTypeDomain } = await import('@perry/core');
      const domainId = projectTypeDomain(project.type);
      
      const kebabName = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const templateType = `custom-${kebabName}`;
      
      const newPipeline = {
        id: templateType,
        name: `${project.title} (Generated)`,
        description: project.description || `Generated template based on project: ${project.title}`,
        workType: project.workType || 'books',
        steps: project.steps.map(s => ({
          label: s.label,
          phase: s.phase,
          taskType: s.taskType,
          prompt: s.promptOverride || s.prompt,
        }))
      };

      const configPath = join(workspaceDir, '.config', 'custom_pipelines.json');
      let pipelines: any[] = [];
      const fs = await import('fs');
      if (fs.existsSync(configPath)) {
        try {
          pipelines = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {
          log.error('Failed to parse custom_pipelines.json', { error: e instanceof Error ? e.message : String(e) });
        }
      }
      
      pipelines = pipelines.filter((p: any) => p.id !== templateType);
      pipelines.push(newPipeline);
      
      const configDir = join(configPath, '..');
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(configPath, JSON.stringify(pipelines, null, 2), 'utf8');

      const skillName = `template-builder-${kebabName}`;
      const skillDir = join(workspaceDir, 'skills-installed', domainId);
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }
      const skillPath = join(skillDir, `${skillName}.md`);
      const now = new Date().toISOString();
      const skillContent = `---
name: ${skillName}
service: ${domainId}
description: Skill dedicated to generating and maintaining the custom template ${templateType} (${project.title}).
proposed_at: ${now}
promoted_at: ${now}
proposed_by: template-evolution
status: installed
applies_when:
  kind: template-builder
  fingerprint: ${templateType}
---

# Template Builder Skill: ${project.title}

This skill belongs to the domain ${domainId} and is dedicated to generating and running templates for this domain.
When this skill is activated:
- Utilize the structure and prompt strategies defined in the ${project.title} template.
- Refine steps, parameters, and prompts to align with domain guidelines.
- Self-improve the template over time based on execution observations.
`;
      fs.writeFileSync(skillPath, skillContent, 'utf8');

      const domain = domainRegistry.get(domainId);
      if (domain) {
        const defaultSkills = domain.defaultSkills || [];
        const skillExists = defaultSkills.some(s => s.service === domainId && s.name === skillName);
        if (!skillExists) {
          const updatedSkills = [...defaultSkills, { service: domainId, name: skillName }];
          domainRegistry.update(domainId, { defaultSkills: updatedSkills });
          log.info(`Assigned skill ${domainId}/${skillName} to domain ${domainId}`);
        }
      }

      res.json({
        success: true,
        templateType,
        templateName: newPipeline.name,
        domainId,
        skillName
      });
    } catch (err: any) {
      log.error('Failed to generate template from project', { projectId: req.params.id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
