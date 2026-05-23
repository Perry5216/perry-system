/**
 * @perry/dashboard-api — Domains routes
 *
 * CRUD over `workspace/domains/` for the Domains wizard and assessment.
 *
 *   GET    /api/domains           list all
 *   GET    /api/domains/:id       fetch one
 *   POST   /api/domains           create
 *   PATCH  /api/domains/:id       update
 *   DELETE /api/domains/:id       delete (only non-builtin)
 *   POST   /api/domains/assess-playbook   run background assessment of needed skills
 *   POST   /api/domains/install-skill     install a custom skill direct to disk
 */

import { Router } from 'express';
import type { Logger, EventBus, McpClientService } from '@perry/core';
import { DomainRegistry, AgentRunner, getAgent } from '@perry/projects';
import type { AIRouter } from '@perry/ai';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

function parseFrontmatter(raw: string): { name?: string; description?: string; service?: string; proposedAt?: string; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  const m = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { body: normalized };
  const block = m[1];
  const body = m[2];
  const out: any = { body };
  for (const line of block.split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (kv) {
      const key = kv[1];
      let val = kv[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  }
  return out;
}

async function listMarkdownSkills(dir: string, defaultService = 'worker'): Promise<any[]> {
  if (!existsSync(dir)) return [];
  const out: any[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const sub = await listMarkdownSkills(join(dir, ent.name), ent.name);
        out.push(...sub);
      } else if (ent.isFile() && ent.name.endsWith('.md')) {
        try {
          const raw = await readFile(join(dir, ent.name), 'utf-8');
          const fm = parseFrontmatter(raw);
          out.push({
            name: fm.name || ent.name.replace(/\.md$/, ''),
            description: fm.description || '(no description)',
            service: fm.service || defaultService,
          });
        } catch {
          out.push({ name: ent.name, description: '(unreadable)', service: defaultService });
        }
      }
    }
  } catch {}
  return out;
}

function extractJson(text: string): any {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonStr = match ? match[1] : text;
  try {
    return JSON.parse(jsonStr.trim());
  } catch (err: any) {
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      try {
        return JSON.parse(text.slice(startIdx, endIdx + 1).trim());
      } catch {}
    }
    throw new Error(`Failed to parse AI output as JSON: ${err.message}. Raw text: ${text}`);
  }
}

async function resolveModelBinding(
  baseModel: string | undefined,
  aiRouter: AIRouter,
  log: Logger
): Promise<{ provider: string; model?: string }> {
  const model = baseModel || 'workers';
  if (model === 'workers') {
    return { provider: 'workers' };
  }

  const PRESET_WRITER = ['qwen3.6:27b', 'gemma3:27b', 'hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M'];
  const PRESET_LIBRARIAN = ['qwen3:14b', 'gemma3:12b'];

  if (PRESET_WRITER.includes(model)) {
    return { provider: 'writer', model };
  }
  if (PRESET_LIBRARIAN.includes(model)) {
    return { provider: 'librarian', model };
  }

  // Otherwise, check custom models dynamically by querying endpoints
  const writerUrl = process.env.OLLAMA_BASE_URL
    || aiRouter.config.get<string>('ai.ollama.endpoint', 'http://ollama:11434');
  const librarianUrl = process.env.OLLAMA_LIBRARIAN_BASE_URL
    || aiRouter.config.get<string>('ai.ollama.librarianEndpoint', 'http://ollama-embeddings:11434');

  const checkEndpoint = async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(`${url}/api/tags`);
      if (res.ok) {
        const data = (await res.json()) as any;
        const models = data.models || [];
        return models.some((m: any) => m.name === model || m.name.split(':')[0] === model.split(':')[0]);
      }
    } catch {}
    return false;
  };

  if (await checkEndpoint(writerUrl)) {
    log.info(`Custom model ${model} found on writer endpoint`);
    return { provider: 'writer', model };
  }
  if (await checkEndpoint(librarianUrl)) {
    log.info(`Custom model ${model} found on librarian endpoint`);
    return { provider: 'librarian', model };
  }

  log.warn(`Custom model ${model} not found on either endpoint, defaulting to writer`);
  return { provider: 'writer', model };
}


export function setupDomainsRoutes(opts: {
  registry: DomainRegistry;
  log: Logger;
  aiRouter: AIRouter;
  projectEngine: any;
  mcpClient: McpClientService;
  eventBus: EventBus;
  workspaceDir: string;
}) {
  const { registry, log, aiRouter, projectEngine, mcpClient, eventBus, workspaceDir } = opts;
  const stateStore = projectEngine.getStateStore();
  const router = Router();
  const runner = new AgentRunner(aiRouter, stateStore, mcpClient, eventBus, log.child('agent-runner'));

  const installedDirs = [
    '/app/.claude/commands',
    join(workspaceDir, 'skills-installed'),
  ];

  router.get('/', (_req, res) => {
    try { res.json({ domains: registry.list() }); }
    catch (err: any) { log.error('GET /domains failed', { error: err.message }); res.status(500).json({ error: err.message }); }
  });

  router.get('/mcp-servers', (_req, res) => {
    try {
      res.json({ ok: true, servers: mcpClient.getConnectedServers() });
    } catch (err: any) {
      log.error('GET /domains/mcp-servers failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
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

  // Playbook assessment
  router.post('/assess-playbook', async (req, res) => {
    try {
      const { label, description, baseModel } = req.body || {};
      if (typeof label !== 'string' || !label.trim()) {
        return res.status(400).json({ error: 'label is required and must be a non-empty string' });
      }
      if (typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({ error: 'description is required and must be a non-empty string' });
      }

      // Gather installed skills
      const installed: any[] = [];
      const seen = new Set<string>();
      for (const dir of installedDirs) {
        const items = await listMarkdownSkills(dir);
        for (const i of items) {
          const key = `${i.service}::${i.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          installed.push(i);
        }
      }

      const agentId = 'meta.playbook-analyst';
      const agent = getAgent(agentId);
      if (!agent) {
        return res.status(500).json({ error: `Agent ${agentId} is not registered in the system` });
      }

      const skillsFormatted = installed
        .map(s => `- Name: ${s.name}\n  Service: ${s.service}\n  Description: ${s.description}`)
        .join('\n\n');

      const userInput = [
        `We are defining a new or updating an existing Domain Identity:`,
        `Label: ${label}`,
        `Description: ${description}`,
        ``,
        `Below is the list of existing installed skills in the system:`,
        skillsFormatted || '(none)',
        ``,
        `Analyze the domain label and description. Select which of the existing skills (if any) are highly relevant to this domain and why.`,
        `Also, recommend any new custom skills that should be created specifically for this domain, providing a kebab-case name, short description, and draft markdown body for each.`,
      ].join('\n');

      // Create a session for tracking
      const sessionId = stateStore.createAgentSession({
        domain: 'meta',
        title: `Playbook Assessment: ${label}`,
      });

      // Set fire requested keys to trigger coordinator daemon to spawn worker immediately
      const nowTs = new Date().toISOString();
      stateStore.setMeta('assist_fire_requested_at_anthropic', nowTs);
      stateStore.setMeta('assist_fire_requested_at_antigrav', nowTs);
      stateStore.setMeta('assist_fire_requested_at_codex', nowTs);

      log.info('Starting playbook assessment background worker invocation', { label, sessionId, baseModel });

      // Resolve the override from baseModel parameter
      const modelBindingOverride = await resolveModelBinding(baseModel, aiRouter, log);

      // Run runner.invoke asynchronously in the background
      runner.invoke({
        agent,
        sessionId,
        input: userInput,
        modelBindingOverride,
      }).catch(err => {
        log.error('Background playbook assessment failed', { sessionId, error: err.message });
      });

      res.json({ ok: true, sessionId });
    } catch (err: any) {
      log.error('POST /assess-playbook failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Playbook assessment status polling
  router.get('/assess-playbook/status/:sessionId', (req, res) => {
    try {
      const { sessionId } = req.params;
      const invocations = stateStore.listAgentInvocations({ sessionId });
      if (!invocations || invocations.length === 0) {
        return res.json({ status: 'pending' });
      }

      // Invocations are sorted DESC by created_at, get the latest
      const invocation = invocations[0];
      const status = invocation.status;

      if (status === 'completed') {
        try {
          const parsedResult = extractJson(invocation.output || '');
          return res.json({ status, result: parsedResult });
        } catch (err: any) {
          log.error('Failed to parse playbook assessment result JSON', { error: err.message, output: invocation.output });
          return res.json({ status: 'failed', error: `Failed to parse result JSON: ${err.message}` });
        }
      } else if (status === 'failed') {
        return res.json({ status, error: invocation.error || 'Unknown error' });
      } else {
        return res.json({ status });
      }
    } catch (err: any) {
      log.error('GET /assess-playbook/status failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Evolve domain workType to Template using Guided Setup Wizard
  router.post('/evolve-worktype-to-template', async (req, res) => {
    try {
      const { workType, name, description, pipelineGoal, workersMode } = req.body || {};
      if (!workType || !name || !pipelineGoal) {
        return res.status(400).json({ error: 'workType, name, and pipelineGoal are required' });
      }

      const systemPrompt = [
        `You are the Perry Template Generator. Your job is to analyze a user's request for a custom pipeline/template and output a strictly structured JSON definition of the pipeline steps.`,
        ``,
        `For each step, you must determine the appropriate taskType and prompt to run.`,
        `Perry has the following task types and routing target systems:`,
        `1. 'comfyui_generate', 'text_overlay', 'qwen_text_render': Smartly assigned if the user requests image generation, book cover creation, visual design, or typography overlay. These route directly to ComfyUI (Local GPU).`,
        `2. 'creative_writing', 'revision_execution': Smartly assigned for creative narrative drafting or prose revisions. These route to the local Writer GPU (Magnum/Gemma LoRA).`,
        `3. 'analysis', 'outline', 'book_bible', 'character_bible', 'story_architecture', 'planning', 'research': Smartly assigned for outline generation, logical planning, character bibles, data extraction, or network research. These route to high-capacity external workers (Claude, Gemini) or the local Librarian/Researcher model based on settings.`,
        ``,
        `Smart Worker Assignment Rules:`,
        `- If workersMode is 'smart': Perry will dynamically route steps to the best provider.`,
        `  - Image/cover/graphic steps -> set taskType to 'comfyui_generate'`,
        `  - Creative prose writing steps -> set taskType to 'creative_writing'`,
        `  - Logical outlining / planning steps -> set taskType to 'outline' or 'planning'`,
        `  - Analysis / check steps -> set taskType to 'analysis' or 'pov_check'`,
        `- If workersMode is 'gpu': Perry forces all text generation steps to use local GPU (such as 'creative_writing' or 'analysis'), and image/cover steps to 'comfyui_generate'.`,
        `- If workersMode is 'subscription': Perry forces all text steps to route to subscription CLIs (using task types like 'planning' or 'outline' or 'research').`,
        ``,
        `Output MUST be a valid JSON object matching the CustomPipelineDef schema:`,
        `{`,
        `  "id": "kebab-case-unique-id-prefixed-with-custom",`,
        `  "name": "Template Display Name",`,
        `  "description": "Short template description",`,
        `  "workType": "the target work type (e.g. books, code, dnd, email, hacking)",`,
        `  "steps": [`,
        `    {`,
        `      "label": "Step Name",`,
        `      "phase": "planning | writing | revision | marketing",`,
        `      "taskType": "comfyui_generate | creative_writing | outline | planning | analysis | pov_check | research",`,
        `      "prompt": "Highly detailed system prompt instructing the AI on exactly what to do for this step. Include instructions on using inputs from previous steps."`,
        `    }`,
        `  ]`,
        `}`,
        ``,
        `Ensure the output is ONLY a valid JSON object. Do not wrap it in markdown code blocks.`,
      ].join('\n');

      const userPrompt = [
        `Generate a template for the workType "${workType}" named "${name}".`,
        `Description: ${description || ''}`,
        `Goal/Requirements: ${pipelineGoal}`,
        `Worker Mode: ${workersMode || 'smart'}`,
      ].join('\n');

      log.info('Invoking AI Router to evolve workType to template', { workType, name, workersMode });

      const aiResponse = await aiRouter.complete({
        provider: 'gemini',
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 4096,
        temperature: 0.2
      });

      const generatedJson = extractJson(aiResponse.text);
      if (!generatedJson || !generatedJson.steps || !Array.isArray(generatedJson.steps)) {
        throw new Error('AI failed to return a valid template structure with steps');
      }

      const configPath = join(workspaceDir, '.config', 'custom_pipelines.json');
      let pipelines: any[] = [];
      if (existsSync(configPath)) {
        try {
          const raw = await readFile(configPath, 'utf8');
          pipelines = JSON.parse(raw);
        } catch (e) {
          log.error('Failed to parse custom_pipelines.json', { error: e instanceof Error ? e.message : String(e) });
        }
      }

      const kebabName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const templateType = `custom-${kebabName}`;
      
      const newPipeline = {
        id: templateType,
        name: generatedJson.name || name,
        description: generatedJson.description || description || `Generated template based on work type: ${workType}`,
        workType,
        steps: generatedJson.steps.map((s: any) => ({
          label: s.label,
          phase: s.phase || 'planning',
          taskType: s.taskType || 'general',
          prompt: s.prompt || '',
        }))
      };

      pipelines = pipelines.filter((p: any) => p.id !== templateType);
      pipelines.push(newPipeline);

      const configDir = join(configPath, '..');
      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true });
      }
      await writeFile(configPath, JSON.stringify(pipelines, null, 2), 'utf8');

      // Register skill playbooks
      const skillName = `template-builder-${kebabName}`;
      const skillDir = join(workspaceDir, 'skills-installed', workType);
      if (!existsSync(skillDir)) {
        await mkdir(skillDir, { recursive: true });
      }
      const skillPath = join(skillDir, `${skillName}.md`);
      const now = new Date().toISOString();
      const skillContent = `---
name: ${skillName}
service: ${workType}
description: Skill dedicated to generating and maintaining the custom template ${templateType} (${name}).
proposed_at: ${now}
promoted_at: ${now}
proposed_by: template-evolution
status: installed
applies_when:
  kind: template-builder
  fingerprint: ${templateType}
---

# Template Builder Skill: ${name}

This skill belongs to the domain ${workType} and is dedicated to generating and running templates for this domain.
When this skill is activated:
- Utilize the structure and prompt strategies defined in the ${name} template.
- Refine steps, parameters, and prompts to align with domain guidelines.
- Self-improve the template over time based on execution observations.
`;
      await writeFile(skillPath, skillContent, 'utf-8');

      const domain = registry.get(workType);
      if (domain) {
        const defaultSkills = domain.defaultSkills || [];
        const skillExists = defaultSkills.some(s => s.service === workType && s.name === skillName);
        if (!skillExists) {
          const updatedSkills = [...defaultSkills, { service: workType, name: skillName }];
          registry.update(workType, { defaultSkills: updatedSkills });
          log.info(`Assigned skill ${workType}/${skillName} to domain ${workType}`);
        }
      }

      res.json({
        success: true,
        templateType,
        templateName: newPipeline.name,
        domainId: workType,
        skillName
      });
    } catch (err: any) {
      log.error('Failed to evolve workType to template', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Intelligent template generator evaluating project + workType + web search
  router.post('/intelligent-evolve-project', async (req, res) => {
    try {
      const { projectId, workType, name, description, workersMode, enableSearch } = req.body || {};
      if (!projectId || !workType) {
        return res.status(400).json({ error: 'projectId and workType are required' });
      }

      const project = stateStore.get(projectId);
      if (!project) {
        return res.status(404).json({ error: `Project ${projectId} not found` });
      }

      // Evaluate the project context
      const projectTitle = project.title;
      const projectDesc = project.description;
      const projectStepsText = project.steps.map((s: any) => {
        let resultExcerpt = '';
        if (s.result) {
          resultExcerpt = s.result.length > 500 ? s.result.slice(0, 500) + '...' : s.result;
        }
        return `- Step: ${s.label}\n  Phase: ${s.phase}\n  TaskType: ${s.taskType}\n  Prompt: ${s.prompt}\n  Status: ${s.status}${resultExcerpt ? `\n  Output Sample: ${resultExcerpt}` : ''}`;
      }).join('\n\n');

      // Run web search context
      let searchContext = '';
      if (enableSearch !== false) {
        const tavilyKey = process.env.TAVILY_API_KEY;
        const exaKey = process.env.EXA_API_KEY;
        const fcKey = process.env.FIRECRAWL_API_KEY;
        const backend = tavilyKey ? 'tavily' : exaKey ? 'exa' : fcKey ? 'firecrawl' : '';

        if (backend) {
          try {
            const query = `${workType} template pipeline steps ${projectTitle} structure guidelines`;
            log.info(`Running intelligent web search via ${backend} for template evolution`, { query });
            let searchResults: SearchResult[] = [];
            if (backend === 'tavily' && tavilyKey) {
              searchResults = await searchTavily(query, 5, tavilyKey, log);
            } else if (backend === 'exa' && exaKey) {
              searchResults = await searchExa(query, 5, exaKey, log);
            } else if (backend === 'firecrawl' && fcKey) {
              searchResults = await searchFirecrawl(query, 5, fcKey, log);
            }

            if (searchResults && searchResults.length > 0) {
              searchContext = searchResults.map(r => `Source: ${r.title} (${r.url})\nContent: ${r.snippet}`).join('\n\n');
            }
          } catch (searchErr: any) {
            log.warn('Web search failed during intelligent template evolution, proceeding without search results', { error: searchErr.message });
          }
        } else {
          log.info('No web search API keys configured, skipping search phase.');
        }
      }

      const systemPrompt = [
        `You are the Perry Intelligent Template Generator. Your job is to analyze a project's existing structure, steps, and output samples, combine them with web search context showing domain best-practices, and generate a highly custom template tailored to that project and work type.`,
        ``,
        `For each step of the new template, you must determine the appropriate taskType and prompt to run.`,
        `Perry has the following task types and routing target systems:`,
        `1. 'comfyui_generate', 'text_overlay', 'qwen_text_render': Smartly assigned if the step involves image generation, card/visual design, map layout, or cover creation. These route directly to ComfyUI (Local GPU).`,
        `2. 'creative_writing', 'revision_execution': Smartly assigned for creative narrative writing, prose generation, or dialogue polishing. These route to the local Writer GPU.`,
        `3. 'analysis', 'outline', 'book_bible', 'character_bible', 'story_architecture', 'planning', 'research': Smartly assigned for outlines, rule definitions, planning, fact extraction, or research. These route to high-capacity external workers (Claude, Gemini) or local Librarian/Researcher.`,
        ``,
        `Smart Worker Assignment Rules:`,
        `- If workersMode is 'smart': Perry will dynamically route steps to the best provider.`,
        `  - Image/graphic/visual design steps -> set taskType to 'comfyui_generate'`,
        `  - Creative writing / prose steps -> set taskType to 'creative_writing'`,
        `  - Outlining/planning/rule-writing steps -> set taskType to 'outline' or 'planning'`,
        `  - Analysis / quality checks -> set taskType to 'analysis' or 'pov_check'`,
        `- If workersMode is 'gpu': Perry forces all text generation steps to use local GPU (such as 'creative_writing' or 'analysis'), and image steps to 'comfyui_generate'.`,
        `- If workersMode is 'subscription': Perry forces all text steps to route to subscription CLIs (using task types like 'planning' or 'outline' or 'research').`,
        ``,
        `Output MUST be a valid JSON object matching the CustomPipelineDef schema:`,
        `{`,
        `  "id": "kebab-case-unique-id-prefixed-with-custom",`,
        `  "name": "Template Display Name",`,
        `  "description": "Short template description",`,
        `  "workType": "${workType}",`,
        `  "steps": [`,
        `    {`,
        `      "label": "Step Name",`,
        `      "phase": "planning | writing | revision | marketing",`,
        `      "taskType": "comfyui_generate | creative_writing | outline | planning | analysis | pov_check | research",`,
        `      "prompt": "Highly detailed system prompt instructing the AI on exactly what to do for this step. Include instructions on using inputs from previous steps."`,
        `    }`,
        `  ]`,
        `}`,
        ``,
        `Ensure the output is ONLY a valid JSON object. Do not wrap it in markdown code blocks.`,
      ].join('\n');

      const userPrompt = [
        `Evaluate the following project and generate a reusable custom template under the "${workType}" domain.`,
        ``,
        `--- Target Project Evaluation ---`,
        `Title: ${projectTitle}`,
        `Description: ${projectDesc}`,
        `Existing Steps and Output Samples:`,
        projectStepsText,
        ``,
        `--- Web Search Domain Context ---`,
        searchContext || 'No search results available.',
        ``,
        `--- Requirements ---`,
        `Template Name: ${name || projectTitle + ' Template'}`,
        `Template Description: ${description || 'Custom template evolved from ' + projectTitle}`,
        `Worker Mode: ${workersMode || 'smart'}`,
        `Work Type: ${workType}`,
      ].join('\n');

      log.info('Invoking AI Router to intelligently evolve project to template', { projectId, workType, name, workersMode });

      const aiResponse = await aiRouter.complete({
        provider: 'gemini',
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 4096,
        temperature: 0.2
      });

      const generatedJson = extractJson(aiResponse.text);
      if (!generatedJson || !generatedJson.steps || !Array.isArray(generatedJson.steps)) {
        throw new Error('AI failed to return a valid template structure with steps');
      }

      const configPath = join(workspaceDir, '.config', 'custom_pipelines.json');
      let pipelines: any[] = [];
      if (existsSync(configPath)) {
        try {
          const raw = await readFile(configPath, 'utf8');
          pipelines = JSON.parse(raw);
        } catch (e) {
          log.error('Failed to parse custom_pipelines.json', { error: e instanceof Error ? e.message : String(e) });
        }
      }

      const templateName = generatedJson.name || name || `${projectTitle} Template`;
      const kebabName = templateName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const templateType = `custom-${kebabName}`;

      const newPipeline = {
        id: templateType,
        name: templateName,
        description: generatedJson.description || description || `Generated template evolved from project: ${projectTitle}`,
        workType,
        steps: generatedJson.steps.map((s: any) => ({
          label: s.label,
          phase: s.phase || 'planning',
          taskType: s.taskType || 'general',
          prompt: s.prompt || '',
        }))
      };

      pipelines = pipelines.filter((p: any) => p.id !== templateType);
      pipelines.push(newPipeline);

      const configDir = join(configPath, '..');
      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true });
      }
      await writeFile(configPath, JSON.stringify(pipelines, null, 2), 'utf8');

      // Register skill playbooks
      const skillName = `template-builder-${kebabName}`;
      const skillDir = join(workspaceDir, 'skills-installed', workType);
      if (!existsSync(skillDir)) {
        await mkdir(skillDir, { recursive: true });
      }
      const skillPath = join(skillDir, `${skillName}.md`);
      const now = new Date().toISOString();
      const skillContent = `---
name: ${skillName}
service: ${workType}
description: Skill dedicated to generating and maintaining the custom template ${templateType} (${templateName}).
proposed_at: ${now}
promoted_at: ${now}
proposed_by: template-evolution
status: installed
applies_when:
  kind: template-builder
  fingerprint: ${templateType}
---

# Template Builder Skill: ${templateName}

This skill belongs to the domain ${workType} and is dedicated to generating and running templates for this domain.
When this skill is activated:
- Utilize the structure and prompt strategies defined in the ${templateName} template.
- Refine steps, parameters, and prompts to align with domain guidelines.
- Self-improve the template over time based on execution observations.
`;
      await writeFile(skillPath, skillContent, 'utf-8');

      const domain = registry.get(workType);
      if (domain) {
        const defaultSkills = domain.defaultSkills || [];
        const skillExists = defaultSkills.some(s => s.service === workType && s.name === skillName);
        if (!skillExists) {
          const updatedSkills = [...defaultSkills, { service: workType, name: skillName }];
          registry.update(workType, { defaultSkills: updatedSkills });
          log.info(`Assigned skill ${workType}/${skillName} to domain ${workType}`);
        }
      }

      res.json({
        success: true,
        templateType,
        templateName: newPipeline.name,
        domainId: workType,
        skillName
      });
    } catch (err: any) {
      log.error('Failed to intelligently evolve project to template', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Install custom skill
  router.post('/install-skill', async (req, res) => {
    try {
      const { name, description, service, body } = req.body || {};
      if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{2,39}$/.test(name)) {
        return res.status(400).json({ error: 'name must be kebab-case, 3-40 chars' });
      }
      if (typeof description !== 'string' || description.length < 10 || description.length > 200) {
        return res.status(400).json({ error: 'description must be 10-200 chars' });
      }
      if (typeof service !== 'string' || !/^[a-z][a-z0-9-]{1,20}$/.test(service)) {
        return res.status(400).json({ error: 'service must be kebab-case, 2-20 chars' });
      }
      if (typeof body !== 'string' || body.length < 10) {
        return res.status(400).json({ error: 'body must be at least 10 chars' });
      }

      const dstDir = service === 'worker'
        ? '/app/.claude/commands'
        : join(workspaceDir, 'skills-installed', service);
      
      if (!existsSync(dstDir)) {
        await mkdir(dstDir, { recursive: true });
      }
      const dst = join(dstDir, `${name}.md`);
      if (existsSync(dst)) {
        return res.status(409).json({ error: `skill "${name}" already exists for service "${service}"` });
      }

      const now = new Date().toISOString();
      const content = [
        `---`,
        `name: ${name}`,
        `service: ${service}`,
        `description: ${description}`,
        `created_at: ${now}`,
        `promoted_at: ${now}`,
        `proposed_by: operator`,
        `status: installed`,
        `---`,
        ``,
        body.trim(),
        ``,
      ].join('\n');

      await writeFile(dst, content, 'utf-8');
      log.info('skill created for domain wizard', { name, service, path: dst });
      res.status(201).json({ created: true, name, service, path: dst });
    } catch (err: any) {
      log.error('POST /install-skill failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  source?: string;
}

async function searchTavily(q: string, limit: number, apiKey: string, log: any): Promise<SearchResult[]> {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query: q, max_results: limit, search_depth: 'basic' }),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data: any = await r.json();
  return (data.results || []).map((x: any) => ({
    title: x.title || '',
    url: x.url || '',
    snippet: x.content || x.snippet || '',
    score: x.score,
    source: 'tavily',
  }));
}

async function searchExa(q: string, limit: number, apiKey: string, log: any): Promise<SearchResult[]> {
  const r = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query: q, num_results: limit }),
  });
  if (!r.ok) throw new Error(`Exa ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data: any = await r.json();
  return (data.results || []).map((x: any) => ({
    title: x.title || '',
    url: x.url || '',
    snippet: x.text || x.snippet || '',
    score: x.score,
    source: 'exa',
  }));
}

async function searchFirecrawl(q: string, limit: number, apiKey: string, log: any): Promise<SearchResult[]> {
  const r = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ query: q, limit }),
  });
  if (!r.ok) throw new Error(`Firecrawl ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data: any = await r.json();
  return (data.data || data.results || []).map((x: any) => ({
    title: x.title || x.metadata?.title || '',
    url: x.url || '',
    snippet: x.description || x.markdown?.slice(0, 200) || '',
    source: 'firecrawl',
  }));
}
