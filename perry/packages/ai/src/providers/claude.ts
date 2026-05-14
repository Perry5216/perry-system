/**
 * @perry/ai — Anthropic Claude Provider
 *
 * Supports Claude Sonnet/Opus with extended thinking.
 */

import type { CompletionRequest, CompletionResponse } from '@perry/core';
import type { Vault } from '@perry/core';
import { BaseProvider } from './base.js';

export class ClaudeProvider extends BaseProvider {
  private vault: Vault;

  constructor(config: any, vault: Vault) {
    super(config);
    this.vault = vault;
  }

  async checkAvailability(): Promise<boolean> {
    const key = await this.vault.get('anthropic_api_key');
    return !!key;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = await this.vault.get('anthropic_api_key');
    if (!apiKey) throw new Error('Anthropic API key not configured');

    const thinkingMap: Record<string, number> = { low: 1024, medium: 4096, high: 16384 };
    const thinkingBudget = request.thinking
      ? thinkingMap[request.thinking] ?? null
      : null;

    const maxTokens = request.maxTokens ?? this.config.maxTokens;
    const effectiveMaxTokens = thinkingBudget
      ? Math.max(maxTokens, thinkingBudget + 2048)
      : maxTokens;

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: effectiveMaxTokens,
      system: request.system,
      messages: request.messages,
    };

    if (thinkingBudget) {
      body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
      body.temperature = 1; // Anthropic requires temperature=1 with thinking
    } else if (typeof request.temperature === 'number') {
      body.temperature = request.temperature;
    }

    const response = await fetch(`${this.config.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;
    if (data.error) {
      throw new Error(`Claude API error: ${data.error.message || 'Unknown error'}`);
    }

    // When thinking is enabled, extract only text blocks (not thinking blocks)
    const blocks = Array.isArray(data.content) ? data.content : [];
    const text = blocks
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('') || '';

    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;

    return {
      text,
      tokensUsed: inputTokens + outputTokens,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      estimatedCost:
        (inputTokens / 1000) * this.config.costPer1kInput +
        (outputTokens / 1000) * this.config.costPer1kOutput,
      provider: this.id,
    };
  }
}
