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
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { body: raw };
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
