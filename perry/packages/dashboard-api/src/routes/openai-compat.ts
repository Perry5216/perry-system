/**
 * @perry/dashboard-api — OpenAI-compatible API endpoint.
 *
 * Turns Perry into a first-class "model" that any OpenAI-compatible client
 * (ChatBox, LibreChat, NextChat, LobeChat, Open WebUI, custom scripts) can
 * talk to. The endpoint accepts standard `/v1/chat/completions` requests and
 * proxies them through Perry's director agent.
 *
 * Implementation: NON-STREAMING for now. Each request:
 *   1. Extract messages[] from OpenAI-shaped request
 *   2. Build a director-agent invocation with the last user message
 *   3. Wait for completion
 *   4. Return OpenAI-shaped response with the director's reply
 *
 * Auth: same Bearer scheme as the rest of /api routes — clients pass
 * `Authorization: Bearer <PERRY_API_KEY>`. Tools that expect `OPENAI_API_KEY`
 * use it the same way.
 *
 *   POST /v1/chat/completions
 *   GET  /v1/models           → returns Perry as a single model
 */

import { Router } from 'express';
import type { Logger } from '@perry/core';
import type { ProjectEngine } from '@perry/projects';
import type { AIRouter } from '@perry/ai';

export function setupOpenAICompatRoutes(projectEngine: ProjectEngine, aiRouter: AIRouter, log: Logger) {
  const router = Router();

  // OpenAI client expects /v1/models to return what's available.
  router.get('/models', (_req, res) => {
    res.json({
      object: 'list',
      data: [
        {
          id: 'perry-director',
          object: 'model',
          created: 1715000000,
          owned_by: 'perry',
        },
      ],
    });
  });

  router.post('/chat/completions', async (req, res) => {
    const startedAt = Date.now();
    try {
      const body = req.body || {};
      const messages: Array<{ role: string; content: string }> = body.messages || [];
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: { message: 'messages[] required', type: 'invalid_request_error' } });
      }
      const last = messages[messages.length - 1];
      const userMessage = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
      const requestedStream = body.stream === true;

      // Direct AIRouter call — bypass project scoping for external chat clients.
      // Pass the full messages[] history so multi-turn conversations work.
      let assistantText = '';
      try {
        const systemPrompt = messages.find(m => m.role === 'system')?.content || 'You are Perry, a self-hosted multi-agent AI platform speaking to an external client via the OpenAI-compatible API.';
        // Normalise role names + drop the system message from the array (it's
        // passed separately as `system`).
        const chatMessages = messages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: (m.role === 'user' || m.role === 'assistant' || m.role === 'tool') ? m.role : 'user',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          })) as any[];
        const out = await aiRouter.complete({
          provider: 'ollama',
          system: systemPrompt,
          messages: chatMessages,
          maxTokens: body.max_tokens || 512,
          temperature: body.temperature ?? 0.7,
        } as any);
        assistantText = (out as any)?.content || (out as any)?.text || (out as any)?.message?.content || JSON.stringify(out);
      } catch (err: any) {
        log.warn('openai-compat AIRouter call failed', { error: err.message });
        assistantText = `(perry error: ${err.message})`;
      }

      const completion = {
        id: `chatcmpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model || 'perry-director',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: assistantText },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: Math.ceil(userMessage.length / 4),  // rough estimate
          completion_tokens: Math.ceil(assistantText.length / 4),
          total_tokens: Math.ceil((userMessage.length + assistantText.length) / 4),
        },
      };

      if (requestedStream) {
        // Minimal streaming emulation: ship the whole response as one SSE chunk
        // followed by [DONE]. Real OpenAI streaming sends token-by-token; we
        // skip that for the MVP because Perry's chatWithDirector is non-stream.
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const chunk = {
          id: completion.id,
          object: 'chat.completion.chunk',
          created: completion.created,
          model: completion.model,
          choices: [{ index: 0, delta: { role: 'assistant', content: assistantText }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        const done = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
        res.write(`data: ${JSON.stringify(done)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.json(completion);
      }
      log.info('openai-compat /chat/completions completed', { durationMs: Date.now() - startedAt, model: completion.model });
    } catch (err: any) {
      log.error('openai-compat /chat/completions failed', { error: err.message });
      res.status(500).json({ error: { message: err.message, type: 'server_error' } });
    }
  });

  return router;
}
