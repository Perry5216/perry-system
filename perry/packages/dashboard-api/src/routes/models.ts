/**
 * Model management routes — pull/remove Ollama models, query state per
 * endpoint, suggest models for new installs.
 *
 * Wraps the Ollama HTTP API directly (no docker exec). Perry already
 * talks to ollama + ollama-embeddings over HTTP; reusing those channels.
 *
 * Endpoints:
 *   GET    /models?endpoint=...      Per-endpoint model list with sizes
 *   POST   /models/pull              Pull a model (streams SSE progress)
 *   DELETE /models                   Delete a model (body: {endpoint, name})
 *   GET    /models/show              Show modelfile for a model
 *   GET    /models/suggestions       Curated list of recommended models
 *
 * Per the shareability goal, this is the path a new user takes to get
 * started — they install Perry, open the Models tab, click "Pull
 * recommended models for my hardware" → Perry does the work.
 */

import { Router } from 'express';
import type { Logger } from '@perry/core';
import type { AIRouter } from '@perry/ai';

interface OllamaEndpoint {
  id: 'writer' | 'librarian';
  label: string;
  url: string;
}

export function setupModelsRoutes(aiRouter: AIRouter, log: Logger) {
  const router = Router();

  // The two Ollama endpoints Perry knows about. Future: pull from config.
  const endpoints = (): OllamaEndpoint[] => {
    const writer = process.env.OLLAMA_BASE_URL
      || aiRouter.config.get<string>('ai.ollama.endpoint', 'http://ollama:11434');
    const librarian = process.env.OLLAMA_LIBRARIAN_BASE_URL
      || aiRouter.config.get<string>('ai.ollama.librarianEndpoint', 'http://ollama-embeddings:11434');
    return [
      { id: 'writer', label: 'Writer (5090)', url: writer },
      { id: 'librarian', label: 'Librarian (5070 Ti)', url: librarian },
    ];
  };

  // ── List models per endpoint ───────────────────────────────────────
  router.get('/models', async (req, res) => {
    const filter = (req.query.endpoint as string) || null;
    const eps = endpoints().filter(e => !filter || e.id === filter);
    const out: any[] = [];
    for (const ep of eps) {
      try {
        const r = await fetch(`${ep.url}/api/tags`);
        const data: any = await r.json();
        const models = (data.models || []).map((m: any) => ({
          name: m.name,
          size: m.size,
          modified_at: m.modified_at,
          digest: (m.digest || '').slice(0, 12),
          parameter_size: m.details?.parameter_size,
          quant: m.details?.quantization_level,
          family: m.details?.family,
        }));
        out.push({ endpoint: ep.id, label: ep.label, url: ep.url, ok: true, models });
      } catch (e: any) {
        out.push({ endpoint: ep.id, label: ep.label, url: ep.url, ok: false, error: e.message, models: [] });
      }
    }
    res.json({ endpoints: out });
  });

  // ── Pull a model (streamed progress via SSE) ───────────────────────
  // POST /models/pull?token=<API_KEY>   body: { endpoint, name }
  // (token in query because EventSource can't send headers, and we want
  // to stream the pull progress back to the dashboard.)
  router.post('/models/pull', async (req, res) => {
    const { endpoint, name } = req.body || {};
    if (!endpoint || !name) {
      return res.status(400).json({ error: 'endpoint and name are required' });
    }
    const ep = endpoints().find(e => e.id === endpoint);
    if (!ep) return res.status(400).json({ error: `unknown endpoint: ${endpoint}` });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    log.info('pulling model', { endpoint, name, url: ep.url });

    try {
      const r = await fetch(`${ep.url}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, stream: true }),
      });
      if (!r.ok || !r.body) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: `pull failed: HTTP ${r.status}` })}\n\n`);
        res.end();
        return;
      }
      // Stream Ollama's NDJSON progress lines through to the client.
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            res.write(`event: progress\ndata: ${JSON.stringify(parsed)}\n\n`);
            if (parsed.status === 'success') {
              res.write(`event: complete\ndata: ${JSON.stringify({ name, endpoint })}\n\n`);
            }
          } catch { /* skip unparseable line */ }
        }
      }
      res.end();
    } catch (e: any) {
      log.error('pull failed', { name, endpoint, error: e.message });
      try { res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`); } catch { /* ignore */ }
      res.end();
    }
  });

  // ── Delete a model ─────────────────────────────────────────────────
  router.delete('/models', async (req, res) => {
    const { endpoint, name } = req.body || {};
    if (!endpoint || !name) {
      return res.status(400).json({ error: 'endpoint and name are required' });
    }
    const ep = endpoints().find(e => e.id === endpoint);
    if (!ep) return res.status(400).json({ error: `unknown endpoint: ${endpoint}` });

    try {
      const r = await fetch(`${ep.url}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ ok: false, error: txt });
      }
      log.info('model deleted', { endpoint, name });
      res.json({ ok: true, endpoint, name });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Show modelfile ─────────────────────────────────────────────────
  router.get('/models/show', async (req, res) => {
    const endpoint = req.query.endpoint as string;
    const name = req.query.name as string;
    if (!endpoint || !name) return res.status(400).json({ error: 'endpoint and name required' });
    const ep = endpoints().find(e => e.id === endpoint);
    if (!ep) return res.status(400).json({ error: `unknown endpoint: ${endpoint}` });

    try {
      const r = await fetch(`${ep.url}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        return res.status(r.status).json({ ok: false, error: await r.text() });
      }
      const data: any = await r.json();
      res.json({ ok: true, ...data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Curated suggestions ────────────────────────────────────────────
  // Hand-picked models that fit Perry's roles. Aimed at the first-run
  // experience — a new user clicks "pull recommended" and gets a working
  // local stack with no decisions required.
  router.get('/models/suggestions', (_req, res) => {
    res.json({
      suggestions: [
        // Researchers — book-planning research synthesis
        { name: 'qwen3.6:27b', role: 'researcher', endpoint: 'librarian',
          size_gb: 17, description: 'Default researcher. Strong markdown synthesis. Fits on 24GB+ GPU.' },
        // Librarians — fast generalist chat / extraction / Director
        { name: 'qwen3:14b', role: 'librarian', endpoint: 'librarian',
          size_gb: 9, description: 'Default librarian + Director backend. Fast, good at tool calling.' },
        { name: 'gemma3:12b', role: 'librarian', endpoint: 'librarian',
          size_gb: 8, description: 'Alternative librarian. Google\'s model; good for English-only.' },
        // Writers — book voice (this is the slot a pen-specific LoRA replaces)
        { name: 'hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M', role: 'writer', endpoint: 'writer',
          size_gb: 23, description: 'Default writer base. Pen-specific LoRAs train on top.' },
        // Future: vision-capable model for image-input agents
        { name: 'qwen2.5vl:7b', role: 'vision', endpoint: 'librarian',
          size_gb: 6, description: 'For image-input agents (cover review, screenshot reading).' },
        // Future: code-specific model for code domain
        { name: 'qwen2.5-coder:7b', role: 'code', endpoint: 'librarian',
          size_gb: 5, description: 'Local code model. Optional — code agents use Claude/Gemini workers by default.' },
      ],
    });
  });

  return router;
}
