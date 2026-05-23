/**
 * Agent system routes.
 *
 * Exposes the registry + sessions + invocations to the dashboard. The
 * Fleet view reads from here. Direct invocation via POST /agents/:id/invoke
 * also useful for scripts / Telegram gateway / curl testing.
 */

import { Router } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { ProjectEngine, AGENT_REGISTRY, getAgent, listAgents, AgentRunner, DomainRegistry } from '@perry/projects';
import type { AIRouter } from '@perry/ai';
import type { EventBus, Logger, McpClientService } from '@perry/core';
import type { ChatMemoryService } from '../services/chat-memory-service.js';

export function setupAgentRoutes(opts: {
  aiRouter: AIRouter;
  projectEngine: ProjectEngine;
  mcpClient: McpClientService;
  eventBus: EventBus;
  log: Logger;
  chatMemory?: ChatMemoryService;
  domainRegistry?: DomainRegistry;
}) {
  const router = Router();
  const { aiRouter, projectEngine, mcpClient, eventBus, log, chatMemory, domainRegistry } = opts;
  const stateStore: any = projectEngine.getStateStore();

  // One shared AgentRunner. AgentRunner itself is stateless beyond the
  // services it holds, so a singleton is fine — invocations don't share
  // memory.
  const runner = new AgentRunner(aiRouter, stateStore, mcpClient, eventBus, log.child('agent-runner'));

  // ── Discovery ────────────────────────────────────────────────────────

  router.get('/agents/souls/mapping', (req, res) => {
    try {
      const raw = stateStore.getMeta('agent_souls');
      const mapping = raw ? JSON.parse(raw) : {};
      res.json({ mapping });
    } catch (err: any) {
      log.error('GET /agents/souls/mapping failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/agents/:id/soul', (req, res) => {
    try {
      const agentId = req.params.id;
      const { penSlug } = req.body || {};
      
      const raw = stateStore.getMeta('agent_souls');
      const mapping = raw ? JSON.parse(raw) : {};
      
      if (penSlug) {
        mapping[agentId] = penSlug;
      } else {
        delete mapping[agentId];
      }
      
      stateStore.setMeta('agent_souls', JSON.stringify(mapping));
      res.json({ ok: true, mapping });
    } catch (err: any) {
      log.error('POST /agents/:id/soul failed', { id: req.params.id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/agents', (req, res) => {
    const domain = (req.query.domain as string) || undefined;
    const agents = listAgents(domain as any);
    res.json({ agents });
  });

  router.get('/agents/:id', (req, res) => {
    const agent = getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'agent not registered', id: req.params.id });
    res.json({ agent });
  });

  router.get('/domains', (_req, res) => {
    // Derive from registry — domains exist if at least one agent uses them.
    const seen = new Set<string>();
    for (const a of Object.values(AGENT_REGISTRY)) seen.add(a.domain);
    res.json({
      domains: Array.from(seen).map(d => ({
        id: d,
        agentCount: listAgents(d as any).length,
      })),
    });
  });

  // ── Trajectory counts (drives "ready to train" badge on the fleet view) ──

  router.get('/agents/:id/trajectories/count', (req, res) => {
    const total = stateStore.countAgentTrajectories({ agentId: req.params.id });
    const success = stateStore.countAgentTrajectories({ agentId: req.params.id, outcome: 'success' });
    res.json({ agentId: req.params.id, total, success });
  });

  // Bulk trajectory summary — one row per registered agent. Drives the
  // Trajectories panel's "ready to train at N samples" gauges. Single
  // query saves the dashboard from N round-trips.
  router.get('/trajectories/summary', (_req, res) => {
    const allAgents = listAgents();
    const data = allAgents.map(a => {
      const total = stateStore.countAgentTrajectories({ agentId: a.id });
      const success = stateStore.countAgentTrajectories({ agentId: a.id, outcome: 'success' });
      const failed = stateStore.countAgentTrajectories({ agentId: a.id, outcome: 'failed' });
      const recent = stateStore.listAgentInvocations({ agentId: a.id, limit: 1 });
      const lastInvocation = recent[0];
      return {
        agentId: a.id,
        domain: a.domain,
        label: a.label,
        provider: a.modelBinding.provider,
        total,
        success,
        failed,
        lastInvocationAt: lastInvocation?.created_at,
        lastInvocationStatus: lastInvocation?.status,
      };
    });
    res.json({ trajectories: data });
  });

  // Recent invocations across all agents — drives the trajectory feed.
  router.get('/trajectories/recent', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 200);
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
    const invocations = stateStore.listAgentInvocations({ agentId, limit });
    res.json({ invocations });
  });

  // ── Invocation ───────────────────────────────────────────────────────

  router.post('/agents/:id/invoke', async (req, res) => {
    const agent = getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'agent not registered', id: req.params.id });

    const { input, sessionId: providedSessionId, projectId, penSlug } = req.body || {};
    if (typeof input !== 'string' || !input.trim()) {
      return res.status(400).json({ error: 'input is required and must be a non-empty string' });
    }

    // Ensure a session exists — create one if the caller didn't pass one.
    let sessionId = providedSessionId;
    if (!sessionId) {
      sessionId = stateStore.createAgentSession({
        domain: agent.domain,
        projectId,
        penSlug,
        title: `Direct invoke: ${agent.label}`,
      });
    }

    // Director-only: prepend chat-memory.md (per-session "soul") into the
    // system prompt so Perry remembers prior conversations. Only for meta.*
    // agents — other domains have their own context channels. Best-effort:
    // missing chat-memory file means we just invoke the agent unmodified.
    let effectiveAgent = agent;
    if (chatMemory && agent.domain === 'meta') {
      try {
        const memory = chatMemory.loadGlobal();
        if (memory && memory.trim().length > 50) {
          const prefix = [
            '## Persistent memory across past chat sessions',
            '',
            'Below is an auto-distilled summary of prior conversations with this user.',
            'Use it for continuity — recall topics, decisions, and open questions when ',
            'relevant. Do NOT echo it back verbatim; treat it the way a person would ',
            'treat their own memory of past talks.',
            '',
            memory.trim(),
            '',
            '## Current conversation',
            '',
          ].join('\n');
          effectiveAgent = { ...agent, systemPrompt: prefix + agent.systemPrompt };
        }
      } catch (err: any) {
        log.warn('chat-memory injection failed (continuing without)', { error: err.message });
      }
    }

    try {
      const invocation = await runner.invoke({
        agent: effectiveAgent,
        sessionId,
        input,
        penSlug,
      });
      res.json({ ok: true, invocation });
    } catch (e: any) {
      log.error('agent invoke failed', { agentId: req.params.id, error: e.message });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Agent sessions ───────────────────────────────────────────────────
  // Path NOTE: mounted under /agent-sessions (not /sessions) to avoid
  // collision with setupSessionsRoutes (which owns /api/sessions for FTS5
  // step-output search). That collision shadowed these routes silently
  // for a while — session-view requests resolved to the step-output
  // handler returning {found:false}, which silently broke LandingChat
  // hydration (sessionId stored fine, hydration always saw empty data).

  router.get('/agent-sessions', (req, res) => {
    const projectId = (req.query.projectId as string) || undefined;
    const domain = (req.query.domain as string) || undefined;
    const sessions = stateStore.listAgentSessions({ projectId, domain });
    res.json({ sessions });
  });

  router.get('/agent-sessions/:id', (req, res) => {
    const session = stateStore.getAgentSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found' });
    const invocations = stateStore.listAgentInvocations({ sessionId: req.params.id });
    res.json({ session, invocations });
  });

  router.post('/agent-sessions/:id/close', async (req, res) => {
    // Distill BEFORE we close so the session's final invocations land in
    // chat-memory. Don't fail the close if distill fails — closing is the
    // primary user intent here.
    if (chatMemory) {
      try {
        const r = await chatMemory.distillSession(req.params.id, { force: true });
        if (!r.distilled) log.info('close-time distill skipped', { sessionId: req.params.id, reason: r.reason });
      } catch (err: any) {
        log.warn('close-time distill threw (non-fatal)', { sessionId: req.params.id, error: err.message });
      }
    }
    const ok = stateStore.closeAgentSession(req.params.id);
    res.json({ ok });
  });

  // Manual distill — flush a session's chat into chat-memory.md on demand.
  // Useful for testing the distill loop or for the dashboard's "remember
  // this conversation now" button (future UI).
  router.post('/agent-sessions/:id/distill', async (req, res) => {
    if (!chatMemory) return res.status(503).json({ error: 'chat-memory service not configured' });
    try {
      const result = await chatMemory.distillSession(req.params.id, { force: true });
      res.json(result);
    } catch (err: any) {
      log.error('manual distill failed', { sessionId: req.params.id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // View the chat-memory file as-is. Lets the dashboard render the running
  // "soul" so the operator can verify what Perry remembers (and edit by hand
  // if a summary captured something wrong — edits persist).
  router.get('/chat-memory', (_req, res) => {
    if (!chatMemory) return res.status(503).json({ error: 'chat-memory service not configured' });
    res.json({ content: chatMemory.loadGlobal() || '' });
  });

  router.get('/agent-sessions/:id/invocations', (req, res) => {
    const invocations = stateStore.listAgentInvocations({ sessionId: req.params.id });
    res.json({ invocations });
  });

  // ── Invocations (direct lookup) ──────────────────────────────────────

  router.get('/invocations/:id', (req, res) => {
    const inv = stateStore.getAgentInvocation(req.params.id);
    if (!inv) return res.status(404).json({ error: 'invocation not found' });
    res.json({ invocation: inv });
  });

  router.get('/agents/:id/profile', async (req, res) => {
    try {
      const agentId = req.params.id;
      const workspaceDir = stateStore.getWorkspaceDir();
      const targetDir = join(workspaceDir, 'souls', 'agents', agentId);

      let soul: string | null = null;
      let lessons: string | null = null;
      let config: string | null = null;

      const soulPath = join(targetDir, 'SOUL.md');
      if (existsSync(soulPath)) {
        soul = await readFile(soulPath, 'utf-8');
      }

      const lessonsPath = join(targetDir, 'LESSONS.md');
      if (existsSync(lessonsPath)) {
        lessons = await readFile(lessonsPath, 'utf-8');
      }

      const configPath = join(targetDir, 'CONFIG.json');
      if (existsSync(configPath)) {
        config = await readFile(configPath, 'utf-8');
      }

      res.json({ soul, lessons, config });
    } catch (err: any) {
      log.error('GET /agents/:id/profile failed', { id: req.params.id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/agents/:id/profile', async (req, res) => {
    try {
      const agentId = req.params.id;
      const { soul, lessons, config } = req.body || {};
      const workspaceDir = stateStore.getWorkspaceDir();
      const targetDir = join(workspaceDir, 'souls', 'agents', agentId);

      await mkdir(targetDir, { recursive: true });

      if (typeof soul === 'string') {
        await writeFile(join(targetDir, 'SOUL.md'), soul, 'utf-8');
      }
      if (typeof lessons === 'string') {
        await writeFile(join(targetDir, 'LESSONS.md'), lessons, 'utf-8');
      }
      if (typeof config === 'string') {
        await writeFile(join(targetDir, 'CONFIG.json'), config, 'utf-8');
      }

      log.info('Updated agent profile', { id: agentId });
      res.json({ ok: true });
    } catch (err: any) {
      log.error('PUT /agents/:id/profile failed', { id: req.params.id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/agents/:id/refresh-profile', async (req, res) => {
    try {
      const agentId = req.params.id;
      const agent = getAgent(agentId);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not registered' });
      }

      const workspaceDir = stateStore.getWorkspaceDir();
      await generateAgentSoul(agent, workspaceDir, aiRouter, log);
      
      const targetDir = join(workspaceDir, 'souls', 'agents', agentId);
      const soul = await readFile(join(targetDir, 'SOUL.md'), 'utf-8');
      const lessons = await readFile(join(targetDir, 'LESSONS.md'), 'utf-8');
      const config = await readFile(join(targetDir, 'CONFIG.json'), 'utf-8');

      res.json({ ok: true, soul, lessons, config });
    } catch (err: any) {
      log.error('POST /agents/:id/refresh-profile failed', { id: req.params.id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/agents/telemetry-stats', (req, res) => {
    try {
      const allAgents = listAgents();
      const agentsCount = allAgents.length;
      
      let domainsCount = 0;
      if (domainRegistry) {
        domainsCount = domainRegistry.list().length;
      } else {
        const seen = new Set<string>();
        for (const a of Object.values(AGENT_REGISTRY)) seen.add(a.domain);
        domainsCount = seen.size;
      }

      let activeCount = 0;
      let doneCount = 0;

      const db = (stateStore as any).db;
      if (db) {
        const activeRow = db.prepare("SELECT COUNT(*) AS n FROM agent_invocations WHERE status = 'active'").get();
        activeCount = activeRow?.n || 0;
        const doneRow = db.prepare("SELECT COUNT(*) AS n FROM agent_invocations WHERE status IN ('completed', 'failed')").get();
        doneCount = doneRow?.n || 0;
      }

      res.json({
        agentsCount,
        domainsCount,
        activeCount,
        doneCount
      });
    } catch (err: any) {
      log.error('GET /agents/telemetry-stats failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

export async function generateAgentSoul(agent: any, workspaceDir: string, aiRouter: AIRouter, log: Logger) {
  const targetDir = join(workspaceDir, 'souls', 'agents', agent.id);
  await mkdir(targetDir, { recursive: true });

  const soulPath = join(targetDir, 'SOUL.md');
  const lessonsPath = join(targetDir, 'LESSONS.md');
  const configPath = join(targetDir, 'CONFIG.json');

  log.info(`Generating dedicated agent soul via Meta for ${agent.id}...`);

  const systemPromptContent = agent.systemPrompt || '';
  const prompt = [
    `You are the Meta-AI System Designer. Create a dedicated agent style persona, operational soul, and recommended model configuration for a specialized AI agent in our system.`,
    `Agent Details:`,
    `- ID: ${agent.id}`,
    `- Label: ${agent.label}`,
    `- Domain: ${agent.domain}`,
    `- Description: ${agent.description || 'No description provided'}`,
    `- Base System Prompt:`,
    `"""`,
    systemPromptContent,
    `"""`,
    ``,
    `Your task is to write three documents:`,
    `1. SOUL.md - Define their tone, style DNA, cognitive framework, and behavioral guidelines tailored to their specific task domain.`,
    `2. LESSONS.md - List 3-5 core principles, operational heuristics, and critical anti-patterns (what they must avoid doing).`,
    `3. CONFIG.json - Recommending:`,
    `   - "modelBinding": { "provider": "workers" | "writer" | "librarian" | "researcher", "model": string } (Choose appropriate provider. Creative writing, prose generation, and book-related agents should prioritize "writer" on the RTX 5090, or fall back to "workers" for more complex coordination. Complex engineering/auditing agents should use "workers", structured/factual tasks should use "librarian" on the 5070 Ti)`,
    `   - "parameters": { "temperature": number, "topP": number, "maxTokens": number } (Sampling parameters tailored for the agent's work type, e.g. low temp for audit/precision, higher temp for creative writing)`,
    ``,
    `Format your response EXACTLY like this (use these exact demarcators):`,
    `---SOUL.MD---`,
    `[Prose content for SOUL.md here. Use Markdown headers and bullet points. Focus on their specific role.]`,
    `---LESSONS.MD---`,
    `[Prose content for LESSONS.md here. Use Markdown headers and bullet points.]`,
    `---CONFIG.JSON---`,
    `{`,
    `  "modelBinding": {`,
    `    "provider": "workers",`,
    `    "model": "gemma3:27b"`,
    `  },`,
    `  "parameters": {`,
    `    "temperature": 0.2,`,
    `    "topP": 0.9,`,
    `    "maxTokens": 4096`,
    `  }`,
    `}`,
  ].join('\n');

  try {
    const res = await aiRouter.complete({
      provider: 'librarian',
      system: 'You are the Meta-AI System Designer.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = res.text || '';

    let soulContent = '';
    let lessonsContent = '';
    let configContent = '';

    const soulMatch = text.match(/---SOUL\.MD---([\s\S]*?)(---LESSONS\.MD---|---CONFIG\.JSON---|$$)/i);
    const lessonsMatch = text.match(/---LESSONS\.MD---([\s\S]*?)(---CONFIG\.JSON---|$$)/i);
    const configMatch = text.match(/---CONFIG\.JSON---([\s\S]*?)$/i);

    if (soulMatch) soulContent = soulMatch[1].trim();
    if (lessonsMatch) lessonsContent = lessonsMatch[1].trim();
    if (configMatch) configContent = configMatch[1].trim();

    if (!soulContent) {
      soulContent = [
        `# SOUL: ${agent.label}`,
        ``,
        `## Style DNA`,
        `- Tone: Expert, focused, direct.`,
        `- Approach: Analytical, precise, task-oriented.`,
        ``,
        `Generated from base agent description: ${agent.description}`,
      ].join('\n');
    }

    if (!lessonsContent) {
      lessonsContent = [
        `# LESSONS: ${agent.label}`,
        ``,
        `## Core Principles`,
        `1. Adhere strictly to the operational boundary of the ${agent.domain} domain.`,
        `2. Maintain consistent output formats.`,
      ].join('\n');
    }

    let finalConfigJson = {
      modelBinding: {
        provider: agent.modelBinding?.provider || 'workers',
        ...(agent.modelBinding?.model ? { model: agent.modelBinding.model } : {})
      },
      parameters: {
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 4096
      }
    };

    if (configContent) {
      try {
        const parsed = JSON.parse(configContent);
        if (parsed && typeof parsed === 'object') {
          if (parsed.modelBinding && typeof parsed.modelBinding === 'object') {
            finalConfigJson.modelBinding = { ...finalConfigJson.modelBinding, ...parsed.modelBinding };
          }
          if (parsed.parameters && typeof parsed.parameters === 'object') {
            finalConfigJson.parameters = { ...finalConfigJson.parameters, ...parsed.parameters };
          }
        }
      } catch (e: any) {
        log.warn(`Meta generated invalid CONFIG.json for ${agent.id}, falling back to defaults`, { error: e.message });
      }
    }

    await writeFile(soulPath, soulContent, 'utf-8');
    await writeFile(lessonsPath, lessonsContent, 'utf-8');
    await writeFile(configPath, JSON.stringify(finalConfigJson, null, 2), 'utf-8');
    log.info(`Successfully generated dedicated soul and config files for ${agent.id}`);
  } catch (err: any) {
    log.error(`Failed to generate dedicated soul for agent ${agent.id}`, { error: err.message });
    // Write quick fallback files so we don't keep failing
    const defaultSoul = [
      `# SOUL: ${agent.label}`,
      ``,
      `## Style DNA`,
      `- Tone: Professional, structured.`,
      `- Operational Guide: Standard agent behavior for ${agent.domain}.`,
    ].join('\n');
    const defaultLessons = [
      `# LESSONS: ${agent.label}`,
      ``,
      `## Core Principles`,
      `1. Focus on the core tasks of ${agent.label}.`,
    ].join('\n');
    const defaultConfig = {
      modelBinding: {
        provider: agent.modelBinding?.provider || 'workers',
        ...(agent.modelBinding?.model ? { model: agent.modelBinding.model } : {})
      },
      parameters: {
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 4096
      }
    };
    await writeFile(soulPath, defaultSoul, 'utf-8');
    await writeFile(lessonsPath, defaultLessons, 'utf-8');
    await writeFile(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
  }
}

