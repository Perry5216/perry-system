/**
 * @perry/ai — OpenAI-Compatible Provider
 *
 * Handles OpenAI, DeepSeek, and OpenRouter — all share the same
 * chat/completions API format with minor variations.
 */

import type { CompletionRequest, CompletionResponse } from '@perry/core';
import type { Vault } from '@perry/core';
import { BaseProvider } from './base.js';

export interface OpenAICompatibleConfig {
  vaultKey: string;     // e.g., 'openai_api_key', 'deepseek_api_key'
  supportsReasoning?: boolean;
  reasonerModel?: string; // e.g., 'deepseek-reasoner' for DeepSeek
}

export class OpenAICompatibleProvider extends BaseProvider {
  private vault: Vault;
  private extra: OpenAICompatibleConfig;

  constructor(config: any, vault: Vault, extra: OpenAICompatibleConfig) {
    super(config);
    this.vault = vault;
    this.extra = extra;
  }

  async checkAvailability(): Promise<boolean> {
    const key = await this.vault.get(this.extra.vaultKey);
    return !!key;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = await this.vault.get(this.extra.vaultKey);
    if (!apiKey) throw new Error(`API key "${this.extra.vaultKey}" not configured`);

    let effectiveModel = this.config.model;
    let reasoningEffort: string | null = null;

    if (request.thinking) {
      if (this.extra.reasonerModel) {
        // DeepSeek: swap to dedicated reasoner model
        effectiveModel = this.extra.reasonerModel;
      } else if (this.extra.supportsReasoning) {
        reasoningEffort = request.thinking;
      }
    }

    const body: Record<string, unknown> = {
      model: effectiveModel,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages,
      ],
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      temperature: request.temperature ?? 0.7,
    };

    if (reasoningEffort) {
      // OpenAI reasoning models use different params
      delete body.max_tokens;
      delete body.temperature;
      body.max_completion_tokens = request.maxTokens ?? this.config.maxTokens;
      body.reasoning_effort = reasoningEffort;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    // OpenRouter-specific headers
    if (this.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://perry.local';
      headers['X-Title'] = 'P.E.R.R.Y. System';
    }

    const response = await fetch(`${this.config.endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;

    if (data.error) {
      throw new Error(`${this.name} API error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const text = data.choices?.[0]?.message?.content || '';
    const usage = data.usage || {};

    return {
      text,
      tokensUsed: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      estimatedCost:
        ((usage.prompt_tokens || 0) / 1000) * this.config.costPer1kInput +
        ((usage.completion_tokens || 0) / 1000) * this.config.costPer1kOutput,
      provider: this.id,
    };
  }
}
