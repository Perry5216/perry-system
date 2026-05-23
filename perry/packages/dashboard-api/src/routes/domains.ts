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

      if (typeof (projectEngine as any).refreshCustomTemplates === 'function') {
        (projectEngine as any).refreshCustomTemplates();
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
      const { projectId, workType, name, description, workersMode, enableSearch, evolutionTarget } = req.body || {};
      if (!workType) {
        return res.status(400).json({ error: 'workType is required' });
      }

      eventBus.emit('intelligent-evolve:log', {
        message: `Starting intelligent template evolution for work type: "${workType}"...`,
        timestamp: new Date().toISOString()
      });

      let projectTitle = '';
      let projectDesc = '';
      let projectStepsText = '';

      if (projectId) {
        eventBus.emit('intelligent-evolve:log', {
          message: `Reading context from target project ID: ${projectId}...`,
          timestamp: new Date().toISOString()
        });
        const project = stateStore.get(projectId);
        if (project) {
          projectTitle = project.title;
          projectDesc = project.description;
          projectStepsText = project.steps.map((s: any) => {
            let resultExcerpt = '';
            if (s.result) {
              resultExcerpt = s.result.length > 500 ? s.result.slice(0, 500) + '...' : s.result;
            }
            return `- Step: ${s.label}\n  Phase: ${s.phase}\n  TaskType: ${s.taskType}\n  Prompt: ${s.prompt}\n  Status: ${s.status}${resultExcerpt ? `\n  Output Sample: ${resultExcerpt}` : ''}`;
          }).join('\n\n');
        }
      }

      if (!projectTitle) {
        projectTitle = workType.toUpperCase() === 'DND' ? 'D&D Campaign Builder' : `${workType.charAt(0).toUpperCase() + workType.slice(1)} Pipeline`;
        projectDesc = `Standard intelligent pipeline for ${workType} domain tasks.`;
        projectStepsText = `No existing project context was provided. Generate a complete, end-to-end best-practice template for the "${workType}" domain from scratch.`;
      }

      // Early resolve target provider
      let targetProvider = 'gemini';
      let selectedTarget = evolutionTarget || 'workers';

      if (selectedTarget === 'gpu') {
        if (aiRouter.getProvider('ollama')) {
          targetProvider = 'ollama';
        } else if (aiRouter.getProvider('librarian')) {
          targetProvider = 'librarian';
        } else {
          log.warn('GPU target requested but local GPU providers are not initialized. Falling back to workers.');
          selectedTarget = 'workers';
        }
      }

      if (selectedTarget === 'workers') {
        if (aiRouter.getProvider('gemini')) {
          targetProvider = 'gemini';
        } else if (aiRouter.getProvider('claude')) {
          targetProvider = 'claude';
        } else if (aiRouter.getProvider('deepseek')) {
          targetProvider = 'deepseek';
        } else if (aiRouter.getProvider('openai')) {
          targetProvider = 'openai';
        } else if (aiRouter.getProvider('openrouter')) {
          targetProvider = 'openrouter';
        } else {
          // Absolute fallback
          const active = aiRouter.getActiveProviders();
          if (active.length > 0) {
            targetProvider = active[0].id;
          } else {
            throw new Error('No active AI providers were found. Please configure Ollama or add an API key to the vault.');
          }
        }
      }

      eventBus.emit('intelligent-evolve:log', {
        message: `Resolved evolution provider: "${targetProvider}" on "${selectedTarget}" target.`,
        timestamp: new Date().toISOString()
      });

      // Checking existing skills in the domain
      eventBus.emit('intelligent-evolve:log', {
        message: `Checking existing skill playbooks in domain: "${workType}"...`,
        timestamp: new Date().toISOString()
      });
      const skillDir = join(workspaceDir, 'skills-installed', workType);
      const existingSkills = await listMarkdownSkills(skillDir, workType);
      const skillsContextText = existingSkills.length > 0 
        ? existingSkills.map(s => `- Skill Name: ${s.name}\n  Description: ${s.description}`).join('\n\n')
        : 'No custom skills are currently installed for this domain.';
      eventBus.emit('intelligent-evolve:log', {
        message: `Found ${existingSkills.length} existing skill(s) in domain: "${workType}".`,
        timestamp: new Date().toISOString()
      });

      // Phase 1: Self-Questioning
      eventBus.emit('intelligent-evolve:log', {
        message: `Formulating research questions for domain "${workType}"...`,
        timestamp: new Date().toISOString()
      });

      const questioningSystemPrompt = [
        `You are the Perry Self-Questioning Coordinator. Given a target domain work type (e.g., 'code', 'dnd', 'books'), generate a list of exactly 5 or 6 specific, deep research questions to query the web.`,
        `Your questions should focus on:`,
        `1. Fundamental definition and purpose of this work type (e.g. 'What is code?', 'What is the purpose of code?').`,
        `2. Industry-standard best practices and common anti-patterns/bad practices.`,
        `3. Specifically how local LLMs (Ollama) perform with this task, their strengths, limitations, and restrictions.`,
        `4. Whether this work type benefits from pipelines, structured steps, templates, or guiding prompts.`,
        `5. Critical validation: Ask "Is this worktype fit for purpose?" to check if the LLM automation matches the objectives.`,
        ``,
        `If the work type is 'code', you MUST include questions equivalent or close to:`,
        `- "What is code?"`,
        `- "What is the purpose of code?"`,
        `- "What are good practices of code?"`,
        `- "What are bad practices of code?"`,
        `- "What makes Ollama good with code?"`,
        `- "What restrictions does Ollama need for coding?"`,
        `- "Do code generation tasks need pipelines or guidings?"`,
        `- "Is this worktype fit for purpose?"`,
        ``,
        `Output must be a valid JSON array of strings:`,
        `["question 1", "question 2", ...]`,
        `Do not wrap in markdown block, return only the JSON.`
      ].join('\n');

      let questions: string[] = [];
      try {
        const questioningResponse = await aiRouter.complete({
          provider: targetProvider,
          system: questioningSystemPrompt,
          messages: [{ role: 'user', content: `Generate the research questions for work type: "${workType}".` }],
          maxTokens: 1000,
          temperature: 0.2
        });
        questions = extractJson(questioningResponse.text);
      } catch (qErr) {
        log.warn('Failed to generate dynamic research questions, falling back to static questions', { error: qErr instanceof Error ? qErr.message : String(qErr) });
      }

      // Ensure fallback questions if extraction failed or is empty
      if (!Array.isArray(questions) || questions.length === 0) {
        if (workType.toLowerCase() === 'code') {
          questions = [
            "What is code?",
            "What is the purpose of code?",
            "What are good practices of code?",
            "What are bad practices of code?",
            "What makes Ollama good with code?",
            "What restrictions does Ollama need for coding?",
            "Do code generation tasks need pipelines or guidings?",
            "Is this worktype fit for purpose?"
          ];
        } else if (workType.toLowerCase() === 'dnd') {
          questions = [
            "What is D&D campaign planning?",
            "What is the purpose of session prep?",
            "What are good practices for campaign architecture?",
            "What are bad practices in session design?",
            "What makes Ollama good for creative writing?",
            "What guidelines does D&D dungeon master planning need?",
            "Is this worktype fit for purpose?"
          ];
        } else {
          questions = [
            `What is ${workType}?`,
            `What is the purpose of ${workType}?`,
            `What are good practices of ${workType}?`,
            `What are bad practices of ${workType}?`,
            `What guidelines or pipelines does ${workType} template generation need?`,
            "Is this worktype fit for purpose?"
          ];
        }
      }

      // Log generated questions
      for (const q of questions) {
        eventBus.emit('intelligent-evolve:log', {
          message: `Formulated self-question: "${q}"`,
          timestamp: new Date().toISOString()
        });
      }

      // Phase 2: Web Scraping and Brainstorming
      let searchContext = '';
      const tavilyKey = process.env.TAVILY_API_KEY;
      const exaKey = process.env.EXA_API_KEY;
      const fcKey = process.env.FIRECRAWL_API_KEY;
      const backend = (enableSearch !== false) ? (tavilyKey ? 'tavily' : exaKey ? 'exa' : fcKey ? 'firecrawl' : '') : '';

      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        if (backend) {
          eventBus.emit('intelligent-evolve:log', {
            message: `[${i + 1}/${questions.length}] Scraping web via ${backend} for: "${question}"...`,
            timestamp: new Date().toISOString()
          });
          try {
            let searchResults: SearchResult[] = [];
            if (backend === 'tavily' && tavilyKey) {
              searchResults = await searchTavily(question, 3, tavilyKey, log);
            } else if (backend === 'exa' && exaKey) {
              searchResults = await searchExa(question, 3, exaKey, log);
            } else if (backend === 'firecrawl' && fcKey) {
              searchResults = await searchFirecrawl(question, 3, fcKey, log);
            }

            if (searchResults && searchResults.length > 0) {
              const snippets = searchResults.map(r => `Source: ${r.title} (${r.url})\nContent: ${r.snippet}`).join('\n\n');
              searchContext += `### Research Topic: ${question}\n\n${snippets}\n\n`;
              eventBus.emit('intelligent-evolve:log', {
                message: `[${i + 1}/${questions.length}] Scraped web results successfully.`,
                timestamp: new Date().toISOString()
              });
            } else {
              eventBus.emit('intelligent-evolve:log', {
                message: `[${i + 1}/${questions.length}] No web search results. Brainstorming internally...`,
                timestamp: new Date().toISOString()
              });
              throw new Error('No search results');
            }
          } catch (scrapeErr: any) {
            // Fallback to internal LLM answer for this question
            try {
              const answerResponse = await aiRouter.complete({
                provider: targetProvider,
                system: "You are an expert systems design analyst. Answer the following research question briefly in 2-3 sentences to help construct template guidelines.",
                messages: [{ role: 'user', content: question }],
                maxTokens: 500,
                temperature: 0.3
              });
              searchContext += `### Research Topic: ${question}\n\nInternal Model Answer: ${answerResponse.text}\n\n`;
              eventBus.emit('intelligent-evolve:log', {
                message: `[${i + 1}/${questions.length}] Internal brainstorming complete.`,
                timestamp: new Date().toISOString()
              });
            } catch (innerErr) {
              log.error('Internal brainstorming failed', { question, error: innerErr });
            }
          }
        } else {
          eventBus.emit('intelligent-evolve:log', {
            message: `[${i + 1}/${questions.length}] Search disabled. Brainstorming internally for: "${question}"...`,
            timestamp: new Date().toISOString()
          });
          try {
            const answerResponse = await aiRouter.complete({
              provider: targetProvider,
              system: "You are an expert systems design analyst. Answer the following research question briefly in 2-3 sentences to help construct template guidelines.",
              messages: [{ role: 'user', content: question }],
              maxTokens: 500,
              temperature: 0.3
            });
            searchContext += `### Research Topic: ${question}\n\nInternal Model Answer: ${answerResponse.text}\n\n`;
            eventBus.emit('intelligent-evolve:log', {
              message: `[${i + 1}/${questions.length}] Internal brainstorming complete.`,
              timestamp: new Date().toISOString()
            });
          } catch (innerErr) {
            log.error('Internal brainstorming failed', { question, error: innerErr });
          }
        }
      }

      // Phase 3: Synthesis & Design
      eventBus.emit('intelligent-evolve:log', {
        message: 'Synthesizing template suite, custom playbooks, and worker recommendations...',
        timestamp: new Date().toISOString()
      });

      const systemPrompt = [
        `You are the Perry Intelligent Template Generator. Your job is to analyze the requested domain work type, combine it with web search context showing best-practices and industry guidelines, check existing domain skills, and generate a suite of 2 to 4 custom templates tailored to that work type.`,
        ``,
        `For example:`,
        `- If workType is 'code', generate a suite of specialized templates like:`,
        `  1. 'Code Design & Architecture' (for outlining, flowcharts, planning)`,
        `  2. 'Code Implementation' (for writing code files, unit tests)`,
        `  3. 'Code Review & Refactoring' (for audits, debugging, refactoring)`,
        `- If workType is 'dnd', generate a suite like:`,
        `  1. 'D&D Campaign Planning' (planning world, lore, main quests)`,
        `  2. 'D&D NPC Generation' (building NPCs, background, stats)`,
        `  3. 'D&D Encounter Design' (designing combat/social encounters, maps)`,
        `- If workType is anything else, generate 2-4 distinct, logical, specialized template pipelines corresponding to different stages or aspects of that domain.`,
        ``,
        `For each step of each template, you must determine the appropriate taskType and prompt to run.`,
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
        `Skill Playbook Gap Analysis:`,
        `Analyze the existing skills in the domain:`,
        `${skillsContextText}`,
        ``,
        `Determine if additional custom skills/playbooks should be created to help the AI perform specific steps in these templates successfully. If so, define them in the 'recommendedNewSkills' list.`,
        ``,
        `Compute Worker Resource Recommendations:`,
        `Evaluate the complexity of this pipeline template suite. Does it require more parallel workers, or special routing to run efficiently? Recommend worker allocations in 'workerResourceRecommendations'.`,
        ``,
        `Output MUST be a valid JSON object matching this schema:`,
        `{`,
        `  "templates": [`,
        `    {`,
        `      "id": "kebab-case-unique-id-prefixed-with-custom",`,
        `      "name": "Template Display Name (e.g. Code Implementation)",`,
        `      "description": "Short template description",`,
        `      "steps": [`,
        `        {`,
        `          "label": "Step Name",`,
        `          "phase": "planning | writing | revision | marketing",`,
        `          "taskType": "comfyui_generate | creative_writing | outline | planning | analysis | pov_check | research",`,
        `          "prompt": "Highly detailed system prompt instructing the AI on exactly what to do for this step. Include instructions on using inputs from previous steps."`,
        `        }`,
        `      ]`,
        `    }`,
        `  ],`,
        `  "recommendedNewSkills": [`,
        `    {`,
        `      "name": "skill-name-kebab-case",`,
        `      "description": "Short description of the skill and why it's needed",`,
        `      "body": "Complete Markdown skill playbook contents, including frontmatter block at the top containing name, service: \${workType}, and description, followed by detailed instructions."`,
        `    }`,
        `  ],`,
        `  "workerResourceRecommendations": {`,
        `    "suggestedWorkerCount": number,`,
        `    "reason": "Detailed explanation of why this count/hardware configuration is recommended."`,
        `  }`,
        `}`,
        ``,
        `Ensure the output is ONLY a valid JSON object. Do not wrap it in markdown code blocks.`,
      ].join('\n');

      const userPrompt = [
        `Generate a reusable custom template suite under the "${workType}" domain.`,
        ``,
        `--- Target Domain Context ---`,
        `Title: \${projectTitle}`,
        `Description: \${projectDesc}`,
        `Context: \${projectStepsText}`,
        ``,
        `--- Research/Brainstorming Answers ---`,
        searchContext || 'No context available.',
        ``,
        `--- Requirements ---`,
        `Template Base Name: \${name || projectTitle}`,
        `Template Description: \${description || 'Intelligent template suite for ' + workType}`,
        `Worker Mode: \${workersMode || 'smart'}`,
        `Work Type: \${workType}`,
      ].join('\n');

      log.info('Invoking AI Router to intelligently evolve workType to templates suite', { workType, name, workersMode, targetProvider });

      const aiResponse = await aiRouter.complete({
        provider: targetProvider,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 4096,
        temperature: 0.2
      });

      eventBus.emit('intelligent-evolve:log', {
        message: 'Synthesized raw response. Parsing template JSON structure...',
        timestamp: new Date().toISOString()
      });

      const generatedJson = extractJson(aiResponse.text);
      if (!generatedJson) {
        throw new Error('AI failed to return a valid JSON structure');
      }

      const templatesList = Array.isArray(generatedJson.templates) ? generatedJson.templates : [];
      // Fallback if AI generated steps at root instead of templates array
      if (templatesList.length === 0 && generatedJson.steps && Array.isArray(generatedJson.steps)) {
        templatesList.push({
          id: generatedJson.id || `custom-\${(generatedJson.name || name || \`\${projectTitle} Template\`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
          name: generatedJson.name || name || `\${projectTitle} Template`,
          description: generatedJson.description || description || `Generated template evolved from workType: \${workType}`,
          steps: generatedJson.steps
        });
      }

      if (templatesList.length === 0) {
        throw new Error('No template structures found in the AI response.');
      }

      eventBus.emit('intelligent-evolve:log', {
        message: `Parsed template suite successfully. Found \${templatesList.length} template(s).`,
        timestamp: new Date().toISOString()
      });

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

      const processedTemplates: any[] = [];

      for (const t of templatesList) {
        const tName = t.name || `\${projectTitle} Template`;
        const kebabName = tName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        let templateType = t.id || `custom-\${kebabName}`;
        if (!templateType.startsWith('custom-')) {
          templateType = `custom-\${templateType}`;
        }

        const newPipeline = {
          id: templateType,
          name: tName,
          description: t.description || `Generated template evolved from workType: \${workType}`,
          workType,
          steps: (t.steps || []).map((s: any) => ({
            label: s.label,
            phase: s.phase || 'planning',
            taskType: s.taskType || 'general',
            prompt: s.prompt || '',
          }))
        };

        // Filter out existing one with same ID
        pipelines = pipelines.filter((p: any) => p.id !== templateType);
        pipelines.push(newPipeline);
        processedTemplates.push(newPipeline);

        // Register primary skill playbook for this template
        eventBus.emit('intelligent-evolve:log', {
          message: `Creating skill playbook for template "\${tName}": "template-builder-\${kebabName}.md"...`,
          timestamp: new Date().toISOString()
        });

        const skillName = `template-builder-\${kebabName}`;
        const skillPath = join(skillDir, `\${skillName}.md`);
        const now = new Date().toISOString();
        const skillContent = `---
name: \${skillName}
service: \${workType}
description: Skill dedicated to generating and maintaining the custom template \${templateType} (\${tName}).
proposed_at: \${now}
promoted_at: \${now}
proposed_by: template-evolution
status: installed
applies_when:
  kind: template-builder
  fingerprint: \${templateType}
---

# Template Builder Skill: \${tName}

This skill belongs to the domain \${workType} and is dedicated to generating and running templates for this domain.
When this skill is activated:
- Utilize the structure and prompt strategies defined in the \${tName} template.
- Refine steps, parameters, and prompts to align with domain guidelines.
- Self-improve the template over time based on execution observations.
`;
        await writeFile(skillPath, skillContent, 'utf-8');

        // Assign skill to domain default skills
        const domain = registry.get(workType);
        if (domain) {
          const defaultSkills = domain.defaultSkills || [];
          const skillExists = defaultSkills.some(s => s.service === workType && s.name === skillName);
          if (!skillExists) {
            const updatedSkills = [...defaultSkills, { service: workType, name: skillName }];
            registry.update(workType, { defaultSkills: updatedSkills });
            log.info(`Assigned skill \${workType}/\${skillName} to domain \${workType}`);
          }
        }

        eventBus.emit('intelligent-evolve:log', {
          message: `Registered template builder skill: "\${skillName}"`,
          timestamp: new Date().toISOString()
        });
      }

      // Save all updated pipelines back to custom_pipelines.json
      const configDir = join(configPath, '..');
      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true });
      }
      await writeFile(configPath, JSON.stringify(pipelines, null, 2), 'utf8');

      eventBus.emit('intelligent-evolve:log', {
        message: `Saved all templates to custom_pipelines.json`,
        timestamp: new Date().toISOString()
      });

      // Process recommended skills
      if (generatedJson.recommendedNewSkills && Array.isArray(generatedJson.recommendedNewSkills)) {
        for (const skill of generatedJson.recommendedNewSkills) {
          if (!skill.name || !skill.body) continue;
          
          eventBus.emit('intelligent-evolve:log', {
            message: `Synthesizing missing skill playbook: "\${skill.name}"...`,
            timestamp: new Date().toISOString()
          });
          
          const skPath = join(workspaceDir, 'skills-installed', workType, `\${skill.name}.md`);
          // Write skill body
          await writeFile(skPath, skill.body.trim(), 'utf-8');
          
          // Assign to domain default skills
          const domain = registry.get(workType);
          if (domain) {
            const defaultSkills = domain.defaultSkills || [];
            const skillExists = defaultSkills.some(s => s.service === workType && s.name === skill.name);
            if (!skillExists) {
              const updatedSkills = [...defaultSkills, { service: workType, name: skill.name }];
              registry.update(workType, { defaultSkills: updatedSkills });
              log.info(`Assigned new custom skill \${workType}/\${skill.name} to domain \${workType}`);
            }
          }
          
          eventBus.emit('intelligent-evolve:log', {
            message: `Registered new custom skill playbook: "\${skill.name}"`,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Log worker resource recommendations
      if (generatedJson.workerResourceRecommendations) {
        const { suggestedWorkerCount, reason } = generatedJson.workerResourceRecommendations;
        eventBus.emit('intelligent-evolve:log', {
          message: `[WORKER ALLOCATION RECOMMENDATION] Suggest assigning \${suggestedWorkerCount || 2} concurrent workers. Reason: \${reason || 'Based on template step analysis.'}`,
          timestamp: new Date().toISOString()
        });
      }

      // Refresh custom template cache
      eventBus.emit('intelligent-evolve:log', {
        message: 'Refreshing template cache in Perry Engine...',
        timestamp: new Date().toISOString()
      });
      if (typeof (opts.projectEngine as any).refreshCustomTemplates === 'function') {
        (opts.projectEngine as any).refreshCustomTemplates();
      }

      eventBus.emit('intelligent-evolve:log', {
        message: `Successfully completed intelligent evolution!`,
        timestamp: new Date().toISOString()
      });

      // Backwards compatible response parameters (first template in list)
      const primaryTemplate = processedTemplates[0];
      const primarySkillName = `template-builder-\${primaryTemplate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;

      res.json({
        success: true,
        templateType: primaryTemplate.id,
        templateName: primaryTemplate.name,
        domainId: workType,
        skillName: primarySkillName,
        templates: processedTemplates.map(pt => ({
          templateType: pt.id,
          templateName: pt.name
        }))
      });
    } catch (err: any) {
      log.error('Failed to intelligently evolve project to template', { error: err.message });
      eventBus.emit('intelligent-evolve:log', {
        message: `ERROR: \${err.message}`,
        timestamp: new Date().toISOString()
      });
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
