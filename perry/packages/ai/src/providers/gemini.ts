/**
 * @perry/ai — Google Gemini Provider
 *
 * Supports Gemini 2.5 Flash/Pro with thinking budget configuration.
 */

import type { CompletionRequest, CompletionResponse } from '@perry/core';
import type { Vault } from '@perry/core';
import { BaseProvider } from './base.js';

export class GeminiProvider extends BaseProvider {
  private vault: Vault;

  constructor(config: any, vault: Vault) {
    super(config);
    this.vault = vault;
  }

  async checkAvailability(): Promise<boolean> {
    const key = await this.vault.get('gemini_api_key');
    return !!key;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = await this.vault.get('gemini_api_key');
    if (!apiKey) throw new Error('Gemini API key not configured');

    // Thinking budget for Gemini 2.5 models
    const thinkingMap: Record<string, number> = { low: 1024, medium: 4096, high: 16384 };
    const thinkingBudget = request.thinking
      ? thinkingMap[request.thinking] ?? null
      : null;

    const generationConfig: Record<string, unknown> = {
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: request.maxTokens ?? this.config.maxTokens,
    };

    if (thinkingBudget) {
      generationConfig.thinkingConfig = {
        thinkingBudget,
        includeThoughts: false,
      };
    }

    const response = await fetch(
      `${this.config.endpoint}/models/${this.config.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: request.messages.map((m: { role: string; content: string }) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig,
        }),
      }
    );

    const data = await response.json() as any;

    if (data.error) {
      throw new Error(`Gemini API error: ${data.error.message || 'Unknown error'}`);
    }

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';

    if (!text || text.trim().length === 0) {
      const finishReason = candidate?.finishReason || data.promptFeedback?.blockReason;
      if (finishReason && finishReason !== 'STOP') {
        throw new Error(
          `Gemini blocked the response (reason: ${finishReason}). ` +
          `Try rephrasing or switch to Claude/DeepSeek for creative writing.`
        );
      }
      throw new Error('Gemini returned an empty response.');
    }

    const usage = data.usageMetadata;
    const promptTokens = usage?.promptTokenCount || 0;
    const completionTokens = usage?.candidatesTokenCount || 0;

    return {
      text,
      tokensUsed: promptTokens + completionTokens,
      promptTokens,
      completionTokens,
      estimatedCost: 0, // Free tier
      provider: this.id,
    };
  }
}
