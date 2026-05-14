/**
 * @perry/ai — Base Provider
 *
 * Abstract interface that every AI provider must implement. This replaces
 * V4's switch statement in router.ts with proper polymorphism.
 */

import type { CompletionRequest, CompletionResponse, AIProvider, ThinkingLevel } from '@perry/core';

export abstract class BaseProvider {
  protected config: AIProvider;

  constructor(config: AIProvider) {
    this.config = config;
  }

  get id(): string { return this.config.id; }
  get name(): string { return this.config.name; }
  get model(): string { return this.config.model; }
  get tier(): string { return this.config.tier; }
  get available(): boolean { return this.config.available; }
  get providerConfig(): AIProvider { return this.config; }

  /**
   * Send a completion request and return the response.
   * Each provider handles its own error recovery and format quirks.
   */
  abstract complete(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * Check if this provider is currently reachable.
   * Called during initialization and periodic health checks.
   */
  abstract checkAvailability(): Promise<boolean>;

  /**
   * Apply reasoning effort configuration to the request.
   * Providers that don't support thinking can no-op.
   */
  protected applyThinking(request: CompletionRequest): { maxTokens: number; temperature?: number; thinkingBudget?: number } {
    const maxTokens = request.maxTokens ?? this.config.maxTokens;
    return { maxTokens, temperature: request.temperature ?? 0.7 };
  }
}
