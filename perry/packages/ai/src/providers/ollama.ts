/**
 * @perry/ai — Ollama Provider
 *
 * Local LLM inference via Ollama. Includes dynamic context window sizing
 * to prevent OOM on models with limited VRAM (the fix for V4's biggest
 * operational failure).
 */

import type { CompletionRequest, CompletionResponse } from '@perry/core';
import { ContextBudgetManager } from '@perry/core';
import { BaseProvider } from './base.js';

export class OllamaProvider extends BaseProvider {
  async checkAvailability(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch (err: any) {
      console.warn(`[OllamaProvider] checkAvailability failed for ${this.config.endpoint}:`, err.message);
      return false;
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const messages = [
      { role: 'system', content: request.system },
      ...request.messages,
    ];

    // ── Dynamic context window sizing ──
    // Estimate prompt tokens to avoid allocating a full context window
    // when it's not needed. Over-allocating causes VRAM exhaustion on
    // models like Gemma 31B on RTX 5090.
    // Estimate prompt tokens conservatively (3.0 chars/token for Gemma/Llama models)
    const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedPromptTokens = Math.ceil(promptChars / 3.0);

    const budgetManager = new ContextBudgetManager();
    const limits = budgetManager.getProviderLimits(this.config);
    const safeTotal = Math.min(this.config.contextWindow || 32768, limits.contextWindow);
    
    const requestedPredict = Math.min(
      request.maxTokens ?? this.config.safeOutputTokens ?? limits.safeOutput,
      limits.safeOutput
    );

    // Always allocate the full context window so Ollama never hits an artificial
    // ceiling and returns an empty response. The 5090 has the VRAM to handle it.
    // numPredict is still capped so the model doesn't run away generating tokens.
    const headroom = 512;
    const numPredict = Math.max(
      2048,
      Math.min(requestedPredict, safeTotal - estimatedPromptTokens - headroom)
    );

    // Always use the full safeTotal as num_ctx — never shrink it dynamically.
    // Dynamic shrinking caused empty responses when real token usage slightly
    // exceeded the estimate (e.g. model thinking tokens weren't accounted for).
    const numCtx = safeTotal;

    let response: Response;
    try {
      // Disable thinking for creative writing — Gemma 4 thinking mode causes
      // infinite reasoning loops on continuation prompts, burning tokens without
      // outputting any prose. Only enable thinking for analytical tasks that
      // explicitly request it via request.thinking.
      const enableThinking = !!request.thinking;

      const requestBody: any = {
        model: request.model || this.config.model,
        messages,
        stream: true,
        think: enableThinking,
        // keep_alive: extend the model's idle timeout to 15 min so successive
        // chapter writes don't pay a 30s cold-load penalty each time. Default
        // is 5 min; we bump it because a chapter generates in 1-3 min and the
        // pipeline often pauses 5-10 min between steps for compression/audit.
        keep_alive: (this.config as any).keepAlive ?? '15m',
        options: {
          temperature:    request.temperature   ?? (this.config as any).temperature   ?? 1.0,
          top_p:          request.topP          ?? (this.config as any).topP          ?? 0.95,
          top_k:          request.topK          ?? (this.config as any).topK          ?? 64,
          num_predict:    numPredict,
          num_ctx:        numCtx,
          repeat_penalty: request.repeatPenalty ?? (this.config as any).repeatPenalty ?? 1.05,
          repeat_last_n:  512,
        },
      };

      if (request.tools && request.tools.length > 0) {
        requestBody.tools = request.tools;
      }

      // Ollama structured outputs. `format: 'json'` enforces JSON validity
      // only; passing a JSON schema object enforces full shape (Ollama 0.5+).
      // We pass either through verbatim — the Ollama server validates the
      // emitted tokens against the schema and only completes when the
      // structure is satisfied. This is the reliable way to get gemma3:12b
      // to emit all required fields in metadata-routing steps.
      if (request.format) {
        requestBody.format = request.format;
        console.log('[Ollama] format passed:', JSON.stringify({
          model: requestBody.model,
          formatType: typeof request.format,
          required: typeof request.format === 'object' ? (request.format as any).required : undefined,
        }));
      }

      // Connection-level retry with backoff. Ollama's model hot-swap (writer ↔
      // researcher on shared 5090 endpoint) can briefly drop in-flight TCP
      // connections — undici reports those as "fetch failed". A short retry
      // recovers the call instead of falling all the way back to the librarian
      // (which is conservative and won't cross-reference Goodreads ratings).
      // We only retry network errors and 503/504 — 4xx errors are surfaced
      // immediately because they won't get better on retry.
      const RETRY_DELAYS_MS = [2_000, 5_000]; // 3 attempts total
      let lastErr: any = null;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
          response = await fetch(`${this.config.endpoint}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(600000), // 10 min hard timeout
            body: JSON.stringify(requestBody),
          });
          if (response.status === 503 || response.status === 504) {
            lastErr = new Error(`Ollama transient ${response.status}`);
            // fall through to retry below
          } else {
            lastErr = null;
            break;
          }
        } catch (err: any) {
          lastErr = err;
        }
        if (attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt];
          console.warn(`[OllamaProvider] connection attempt ${attempt + 1} failed (${lastErr?.message || lastErr}); retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
      if (lastErr) {
        throw lastErr;
      }
    } catch (err: any) {
      throw new Error(
        `Ollama unreachable at ${this.config.endpoint}: ${err?.message || err}. Is "ollama serve" running?`
      );
    }

    if (!response!.ok) {
      const body = await response!.text().catch(() => '');
      if (response!.status === 404 || body.toLowerCase().includes('not found')) {
        throw new Error(`Ollama model "${this.config.model}" not installed. Run: ollama pull ${this.config.model}`);
      }
      throw new Error(`Ollama error ${response!.status}: ${body.substring(0, 300)}`);
    }

    // ── Stream response ──
    let text = '';
    let buffer = '';
    let promptTokens = 0;
    let evalTokens = 0;
    let finishReason: string | undefined;
    let toolCalls: any[] | undefined = undefined;
    const decoder = new TextDecoder('utf-8');

    if (!response!.body) throw new Error('Empty response body from Ollama');

    // @ts-ignore - ReadableStream is async iterable in Node 22+
    for await (const chunk of response!.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newlineIndex: number;
      let isDone = false;

      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        const data = JSON.parse(line);
        if (data.error) throw new Error(data.error);
        if (data.message) {
          // Log the first few chunks to see what's happening
          if (evalTokens < 5) console.log('[OLLAMA STREAM DEBUG]', JSON.stringify(data));
        }
        
        // gemma4 (thinking model) streams reasoning in `message.thinking`
        // and the final answer in `message.content`. We want content only.
        if (data.message?.content) text += data.message.content;
        
        // Accumulate tool calls if present (usually sent in the final chunk or alongside content)
        if (data.message?.tool_calls) {
          toolCalls = data.message.tool_calls;
        }

        if (data.done) {
          promptTokens = data.prompt_eval_count || 0;
          evalTokens = data.eval_count || 0;
          finishReason = data.done_reason;
          // Ollama sometimes sends tool_calls in the final `message` object if non-streaming or in the `done` chunk
          if (data.message?.tool_calls) toolCalls = data.message.tool_calls;
          isDone = true;
          console.log('[OLLAMA DONE DEBUG]', JSON.stringify(data));
          break;
        }
      }
      if (isDone) break;
    }

    if (!text && (!toolCalls || toolCalls.length === 0)) {
      console.log('[OLLAMA EMPTY DEBUG] Accumulated text and tool calls were empty. Eval tokens:', evalTokens);
      throw new Error(
        `Ollama returned an empty response. Context window may have been exceeded ` +
        `for model "${this.config.model}" (num_ctx=${numCtx}, prompt_est=${estimatedPromptTokens}).`
      );
    }

    return {
      text,
      tokensUsed: promptTokens + evalTokens,
      promptTokens,
      completionTokens: evalTokens,
      estimatedCost: 0,
      provider: this.id,
      finishReason,
      toolCalls,
    };
  }
}
