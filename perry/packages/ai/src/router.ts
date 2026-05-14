/**
 * @perry/ai — AI Router
 *
 * Smart routing across LLM providers with tier-based selection,
 * budget awareness, and automatic fallback.
 *
 * Key differences from V4:
 *   - Providers are separate classes (not switch cases)
 *   - contextWindow and safeOutputTokens are first-class properties
 *   - No global anti-laziness injection (moved to prompt builder where it belongs)
 */

import type { AIProvider, CompletionRequest, CompletionResponse, TaskTier, ThinkingLevel } from '@perry/core';
import type { ConfigService, Vault, Logger } from '@perry/core';
import { BaseProvider } from './providers/base.js';
import { OllamaProvider } from './providers/ollama.js';
import { GeminiProvider } from './providers/gemini.js';
import { ContextCompressor } from './context-compressor.js';
import { ContextWatcher } from './context-watcher.js';
import { ClaudeProvider } from './providers/claude.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.js';

// ═══════════════════════════════════════════════════════════
// Task Classification
// ═══════════════════════════════════════════════════════════

const TASK_TIERS: Record<string, TaskTier> = {
  general:           'free',
  research:          'free',
  analysis:          'free',
  stat_update:       'free',
  pov_check:         'free',
  continuity_check:  'free',
  export:            'free',
  creative_writing:  'mid',
  revision:          'mid',
  style_analysis:    'mid',
  marketing:         'free',
  outline:           'mid',
  book_bible:        'mid',
  consistency:       'mid',
  revision_check:   'free',
  voice_profile:     'mid',
  final_edit:        'premium',
  book_cover:        'libre',
  planning:          'libre',
};

const TIER_ROUTING: Record<TaskTier, string[]> = {
  free:    ['ollama', 'gemini', 'deepseek', 'openrouter', 'openai', 'claude'],
  mid:     ['ollama', 'gemini', 'deepseek', 'openrouter', 'claude', 'openai'],
  premium: ['claude', 'openai', 'openrouter', 'gemini', 'deepseek', 'ollama'],
  libre:   ['librarian', 'ollama', 'gemini', 'deepseek', 'openrouter', 'claude'],
};

const TASK_REASONING: Record<string, ThinkingLevel> = {
  consistency: 'high',
  final_edit:  'high',
  revision:    'medium',
};

const TASK_OUTPUT_BUDGET: Record<string, number> = {
  outline:           32768, // 39-chapter outlines need ~14k tokens — 8192 was always too small
  book_bible:        16384,
  creative_writing:  8192,
  revision:          8192,
  analysis:          4096,
  stat_update:       1024,
  pov_check:         512,
  continuity_check:  4096,
  export:            2048,
  consistency:       8192,
  revision_check:    4096,
  voice_profile:     8192,
  final_edit:        8192,
  research:          8192,
  general:           4096,
};

// ═══════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════

export class AIRouter {
  private providers = new Map<string, BaseProvider>();
  public readonly config: ConfigService;
  private vault: Vault;
  private log: Logger;
  public readonly compressor: ContextCompressor;
  public readonly contextWatcher: ContextWatcher;
  private globalPreferredProvider: string | null = null;

  constructor(config: ConfigService, vault: Vault, log: Logger) {
    this.config = config;
    this.vault = vault;
    this.log = log;
    this.compressor = new ContextCompressor(log.child('librarian'));
    this.contextWatcher = new ContextWatcher(log.child('ctx-watch'));
    this.compressor.setWatcher(this.contextWatcher);
  }

  /**
   * Initialize all configured providers. Each provider checks its own
   * availability independently.
   */
  async initialize(): Promise<void> {
    this.providers.clear();
    this.contextWatcher.clearGpus();

    // ── Ollama (FREE - Local) ──
    const ollamaEndpoint = this.config.get<string>('ai.ollama.endpoint', 'http://localhost:11434');
    const ollamaModel = this.config.get<string>('ai.ollama.model', 'gemma3:27b');
    const ollamaContextWindow = this.config.get<number>('ai.ollama.contextWindow', 65536);
    const ollamaTemperature   = this.config.get<number>('ai.ollama.temperature', 0.85);
    const ollamaTopP          = this.config.get<number>('ai.ollama.topP', 0.9);
    const ollamaTopK          = this.config.get<number>('ai.ollama.topK', 64);
    const ollamaRepeatPenalty = this.config.get<number>('ai.ollama.repeatPenalty', 1.12);

    const ollama = new OllamaProvider({
      id: 'ollama',
      name: 'Ollama',
      model: ollamaModel,
      tier: 'free',
      available: false,
      endpoint: ollamaEndpoint,
      maxTokens: 16384,
      contextWindow: ollamaContextWindow,
      safeOutputTokens: 16384,
      costPer1kInput: 0,
      costPer1kOutput: 0,
      // Writing-optimised sampling params (Gemma 4 recommended)
      temperature:   ollamaTemperature,
      topP:          ollamaTopP,
      topK:          ollamaTopK,
      repeatPenalty: ollamaRepeatPenalty,
    } as any);

    if (await ollama.checkAvailability()) {
      this.providers.set('ollama', ollama);
      this.log.info('Writer GPU initialized (Ollama primary)', { model: ollamaModel, endpoint: ollamaEndpoint });
      // Register Writer GPU for context watching
      this.contextWatcher.addGpu('Writer (5090)', ollamaEndpoint, 'writer', ollamaContextWindow);
    } else {
      this.log.warn('Writer GPU failed to initialize', { model: ollamaModel, endpoint: ollamaEndpoint });
    }

    // ── Ollama Secondary = "The Librarian" (5070 Ti) ──
    const librarianEndpoint    = process.env.OLLAMA_LIBRARIAN_BASE_URL || this.config.get<string>('ai.ollama.librarianEndpoint', 'http://localhost:11435');
    const librarianModel       = this.config.get<string>('ai.ollama.librarianModel', 'gemma3:12b');
    const librarianCtx         = this.config.get<number>('ai.ollama.librarianContextWindow', 131072);
    const librarianTemperature = this.config.get<number>('ai.ollama.librarianTemperature', 0.1);
    const librarianTopP        = this.config.get<number>('ai.ollama.librarianTopP', 0.9);
    const librarianTopK        = this.config.get<number>('ai.ollama.librarianTopK', 40);
    const librarianRepeat      = this.config.get<number>('ai.ollama.librarianRepeatPenalty', 1.0);

    const librarian = new OllamaProvider({
      id: 'librarian',
      name: 'Librarian (5070 Ti)',
      model: librarianModel,
      tier: 'free',
      available: false,
      endpoint: librarianEndpoint,
      maxTokens: 8192,
      contextWindow: librarianCtx,
      safeOutputTokens: 8192,
      costPer1kInput: 0,
      costPer1kOutput: 0,
      // Factual extraction params — low temp, deterministic
      temperature:   librarianTemperature,
      topP:          librarianTopP,
      topK:          librarianTopK,
      repeatPenalty: librarianRepeat,
    } as any);

    if (await librarian.checkAvailability()) {
      this.providers.set('librarian', librarian);
      this.compressor.setLibrarian(librarian);
      this.log.info('Librarian GPU initialized (Ollama secondary)', {
        model: librarianModel,
        endpoint: librarianEndpoint,
        contextWindow: librarianCtx,
        temperature: librarianTemperature,
      });
      // Register Librarian GPU for context watching
      this.contextWatcher.addGpu('Librarian (5070 Ti)', librarianEndpoint, 'librarian', librarianCtx);
    } else {
      this.log.warn('Librarian GPU not available — context compression disabled', {
        endpoint: librarianEndpoint,
      });
    }

    // Start context watcher polling after all GPUs are registered
    this.contextWatcher.startPolling(2_000);

    // ── Google Gemini (FREE tier) ──
    if (this.vault.has('gemini_api_key')) {
      const geminiModel = this.config.get<string>('ai.gemini.model', 'gemini-2.5-flash');
      const gemini = new GeminiProvider({
        id: 'gemini',
        name: 'Google Gemini',
        model: geminiModel,
        tier: 'free',
        available: true,
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        maxTokens: 65536,
        contextWindow: 1048576,
        safeOutputTokens: 65536,
        costPer1kInput: 0,
        costPer1kOutput: 0,
      }, this.vault);
      this.providers.set('gemini', gemini);
      this.log.info('Gemini initialized', { model: geminiModel });
    }

    // ── DeepSeek (CHEAP) ──
    if (this.vault.has('deepseek_api_key')) {
      const deepseek = new OpenAICompatibleProvider({
        id: 'deepseek',
        name: 'DeepSeek',
        model: this.config.get<string>('ai.deepseek.model', 'deepseek-chat'),
        tier: 'cheap',
        available: true,
        endpoint: 'https://api.deepseek.com/v1',
        maxTokens: 8192,
        contextWindow: 65536,
        safeOutputTokens: 8192,
        costPer1kInput: 0.00014,
        costPer1kOutput: 0.00028,
      }, this.vault, {
        vaultKey: 'deepseek_api_key',
        reasonerModel: 'deepseek-reasoner',
      });
      this.providers.set('deepseek', deepseek);
      this.log.info('DeepSeek initialized');
    }

    // ── Anthropic Claude (PAID) ──
    if (this.vault.has('anthropic_api_key')) {
      const claudeModel = this.config.get<string>('ai.claude.model', 'claude-sonnet-4-5-20250929');
      const claude = new ClaudeProvider({
        id: 'claude',
        name: 'Anthropic Claude',
        model: claudeModel,
        tier: 'paid',
        available: true,
        endpoint: 'https://api.anthropic.com/v1',
        maxTokens: 16384,
        contextWindow: 200000,
        safeOutputTokens: 16384,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
      }, this.vault);
      this.providers.set('claude', claude);
      this.log.info('Claude initialized', { model: claudeModel });
    }

    // ── OpenAI GPT (PAID) ──
    if (this.vault.has('openai_api_key')) {
      const openaiModel = this.config.get<string>('ai.openai.model', 'gpt-4o');
      const openai = new OpenAICompatibleProvider({
        id: 'openai',
        name: 'OpenAI GPT',
        model: openaiModel,
        tier: 'paid',
        available: true,
        endpoint: 'https://api.openai.com/v1',
        maxTokens: 16384,
        contextWindow: 128000,
        safeOutputTokens: 16384,
        costPer1kInput: 0.0025,
        costPer1kOutput: 0.01,
      }, this.vault, {
        vaultKey: 'openai_api_key',
        supportsReasoning: /^(o[1-9]|gpt-5)/i.test(openaiModel),
      });
      this.providers.set('openai', openai);
      this.log.info('OpenAI initialized', { model: openaiModel });
    }

    // ── OpenRouter (FLEXIBLE) ──
    if (this.vault.has('openrouter_api_key')) {
      const orModel = this.config.get<string>('ai.openrouter.model', 'anthropic/claude-sonnet-4-5');
      const openrouter = new OpenAICompatibleProvider({
        id: 'openrouter',
        name: 'OpenRouter',
        model: orModel,
        tier: 'cheap',
        available: true,
        endpoint: 'https://openrouter.ai/api/v1',
        maxTokens: 16384,
        contextWindow: 200000,
        safeOutputTokens: 16384,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
      }, this.vault, {
        vaultKey: 'openrouter_api_key',
        supportsReasoning: true,
      });
      this.providers.set('openrouter', openrouter);
      this.log.info('OpenRouter initialized', { model: orModel });
    }

    this.log.info(`AI Router ready with ${this.providers.size} provider(s)`);
  }

  /** Re-initialize providers (e.g., after adding a new API key). */
  async reinitialize(): Promise<string[]> {
    await this.initialize();
    return Array.from(this.providers.keys());
  }

  /**
   * Select the best provider for a task type using tiered routing.
   * Priority: per-project override → global preference → tier routing.
   */
  selectProvider(taskType: string, preferredId?: string): BaseProvider {
    // Resolve effective preference: per-project > global
    const effectivePref = preferredId || this.globalPreferredProvider;

    if (effectivePref) {
      const pref = this.providers.get(effectivePref);
      if (pref) {
        this.log.debug('Using preferred provider', { provider: effectivePref });
        return pref;
      }
      this.log.warn('Preferred provider not available', { provider: effectivePref });
    }

    const tier = TASK_TIERS[taskType] || TASK_TIERS.general;
    const preference = TIER_ROUTING[tier];

    for (const providerId of preference) {
      const provider = this.providers.get(providerId);
      if (provider) return provider;
    }

    // Absolute fallback
    const any = Array.from(this.providers.values())[0];
    if (!any) {
      throw new Error('No AI providers available. Configure Ollama (free) or add an API key.');
    }
    return any;
  }

  /** Get fallback provider if primary fails. */
  getFallbackProvider(currentId: string): BaseProvider | null {
    for (const [id, provider] of this.providers) {
      if (id !== currentId) return provider;
    }
    return null;
  }

  /**
   * Complete a request, with automatic fallback on failure.
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const provider = this.providers.get(request.provider);
    if (!provider) throw new Error(`Provider "${request.provider}" not found`);

    try {
      return await provider.complete(request);
    } catch (err: any) {
      this.log.warn(`Primary provider failed`, { provider: request.provider, error: err.message });

      const fallback = this.getFallbackProvider(request.provider);
      if (fallback) {
        this.log.info(`Falling back to ${fallback.id}`);
        return await fallback.complete({ ...request, provider: fallback.id });
      }
      throw err;
    }
  }

  /** Get the recommended thinking level for a task type. */
  getRecommendedThinking(taskType: string): ThinkingLevel | undefined {
    return TASK_REASONING[taskType];
  }

  /** Get the output token budget for a task type. */
  getOutputBudget(taskType: string): number {
    return TASK_OUTPUT_BUDGET[taskType] || 4096;
  }

  /** Set or clear the global preferred provider. */
  setGlobalPreferredProvider(id: string | null): void {
    this.globalPreferredProvider = id;
  }

  getGlobalPreferredProvider(): string | null {
    return this.globalPreferredProvider;
  }

  /** List all active providers. */
  getActiveProviders(): AIProvider[] {
    return Array.from(this.providers.values()).map(p => p.providerConfig);
  }

  /** Get a specific provider by ID. */
  getProvider(id: string): BaseProvider | undefined {
    return this.providers.get(id);
  }
}
