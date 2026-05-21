/**
 * Agent system routes.
 *
 * Exposes the registry + sessions + invocations to the dashboard. The
 * Fleet view reads from here. Direct invocation via POST /agents/:id/invoke
 * also useful for scripts / Telegram gateway / curl testing.
 */

import { Router } from 'express';
import { ProjectEngine, AGENT_REGISTRY, getAgent, listAgents, AgentRunner } from '@perry/projects';
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
}) {
  const router = Router();
  const { aiRouter, projectEngine, mcpClient, eventBus, log, chatMemory } = opts;
  const stateStore: any = projectEngine.getStateStore();

  // One shared AgentRunner. AgentRunner itself is stateless beyond the
  // services it holds, so a singleton is fine — invocations don't share
  // memory.
  const runner = new AgentRunner(aiRouter, stateStore, mcpClient, eventBus, log.child('agent-runner'));

  // ── Discovery ────────────────────────────────────────────────────────

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

  return router;
}
