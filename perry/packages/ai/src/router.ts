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
import { EmbeddingService } from './embedding-service.js';

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
  goal_judge:        'libre',
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

// ═══════════════════════════════════════════════════════════
// Step routing targets
// ═══════════════════════════════════════════════════════════
//
// Every pipeline step ends up on exactly ONE of these:
//   - 'writer'     → local Ollama on the user's main GPU (the trained
//                    pen-name LoRA, e.g. perry-a-perry:v7). Prose-only.
//   - 'librarian'  → small structured-job model on the 5070 Ti
//                    (qwen3:14b by default). POV checks, stat updates,
//                    extractions, summaries.
//   - 'researcher' → larger local research model (5070 Ti or 5090
//                    depending on endpoint config). Long-form research
//                    synthesis with web sources.
//   - 'workers'    → CLI subscription workers (Claude / Gemini) via the
//                    research_assist task pool. Cost zero against the
//                    Anthropic/Google API and free the local GPUs.
//
// The defaults below encode the user's stated preference:
//   - Writing stays on writer (preserves the v7 LoRA voice).
//   - Small structured jobs stay on librarian (cheap, fast on 5070 Ti).
//   - Everything that's planning / outlining / analysis / non-prose
//     structure goes to workers (Claude/Gemini do this better than the
//     local writer LoRA and don't contend with writer GPU time).
//
// CONFIG OVERRIDE: dashboard writes `ai.routing.taskTypes` as a JSON
// object that MERGES on top of these defaults. To repoint `outline`
// from workers back to writer, set ai.routing.taskTypes={"outline":"writer"}.
// Future model additions (e.g. a 70B writer running on a second box) only
// need a new provider + a routing-table entry — no code changes.
export type RoutingTarget = 'writer' | 'librarian' | 'researcher' | 'workers';

export const STEP_ROUTING_DEFAULTS: Record<string, RoutingTarget> = {
  // Prose generation — MUST stay on the trained pen-name LoRA.
  creative_writing:    'writer',
  revision_execution:  'writer',
  final_edit:          'writer',
  manuscript_cleanup:  'writer',
  draft_compile:       'writer',

  // Small structured jobs — librarian (5070 Ti, qwen3:14b).
  pov_check:           'librarian',
  continuity_check:    'librarian',
  stat_update:         'librarian',
  voice_profile:       'librarian',
  revision_check:      'librarian',
  goal_judge:          'librarian',

  // Planning / structure / analysis — off to workers (Claude / Gemini).
  outline:             'workers',
  book_bible:          'workers',
  character_bible:     'workers',
  setting_bible:       'workers',
  story_architecture:  'workers',
  premise:             'workers',
  consistency:         'workers',
  style_analysis:      'workers',
  analysis:            'workers',
  planning:            'workers',
  marketing:           'workers',
  book_cover:          'workers',
  research:            'workers',
  network_research:    'workers',

  // Default fallback for unknown task types.
  general:             'workers',
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
  /** Embedding service for semantic similarity. Wired during initialize().
   *  Always present so callers don't have to null-check — when the underlying
   *  endpoint is unreachable, embed() throws and callers handle gracefully. */
  public embeddings!: EmbeddingService;
  private globalPreferredProvider: string | null = null;
  private writerModelOverride: string | null = null;
  private penModelResolver: ((penSlug: string) => string | null) | null = null;

  constructor(config: ConfigService, vault: Vault, log: Logger) {
    this.config = config;
    this.vault = vault;
    this.log = log;
    this.compressor = new ContextCompressor(log.child('librarian'));
    this.contextWatcher = new ContextWatcher(log.child('ctx-watch'));
    this.compressor.setWatcher(this.contextWatcher);
    // EmbeddingService is created in initialize() once env+config are
    // resolved. Previously instantiated here too with a hardcoded
    // endpoint, which silently took effect if any code grabbed
    // router.embeddings before initialize() ran.
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
    // Writer model: prefer the pen-aware override (set by entrypoints from
    // pen_name_records.loraVersions[currentLoraVersion].currentlyRegisteredAs),
    // fall back to the user-configured default. Lets a freshly trained LoRA
    // become active without manual user.json edits.
    const configuredModel = this.config.get<string>('ai.ollama.model', 'qwen3.6:27b');
    const ollamaModel = this.writerModelOverride ?? configuredModel;
    if (this.writerModelOverride && this.writerModelOverride !== configuredModel) {
      this.log.info('Writer model overridden by pen-aware resolver', {
        configured: configuredModel,
        active: this.writerModelOverride,
      });
    }
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
    const librarianModel       = process.env.OLLAMA_LIBRARIAN_MODEL || this.config.get<string>('ai.ollama.librarianModel', 'gemma3:12b');
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

    // ── Ollama Tertiary = "The Researcher" (configurable endpoint) ──
    // Book-planning research phase (Concept Keywords + 5 live-data scouts + Market &
    // Genre Analysis) routes here. Endpoint is independently configurable so the
    // researcher can live on EITHER ollama (5090, hot-swap with writer) OR
    // ollama-embeddings (5070 Ti, runs alongside librarian). Defaults to the
    // writer endpoint for backward-compat with the original "swap with writer"
    // design, but `ai.ollama.researcherEndpoint` (or OLLAMA_RESEARCHER_BASE_URL)
    // overrides to put researcher on the librarian GPU instead.
    //
    // Tradeoff:
    //   writer endpoint (5090)            → fastest model, swap latency on
    //                                       transitions to/from writer
    //   librarian endpoint (5070 Ti)      → no writer-swap cost, runs in parallel
    //                                       with librarian, slower model class
    const researcherEndpoint    = process.env.OLLAMA_RESEARCHER_BASE_URL
      || this.config.get<string>('ai.ollama.researcherEndpoint', '')
      || process.env.OLLAMA_BASE_URL
      || this.config.get<string>('ai.ollama.endpoint', 'http://localhost:11434');
    const researcherModel       = process.env.OLLAMA_RESEARCHER_MODEL || this.config.get<string>('ai.ollama.researcherModel', 'qwen3.6:27b');
    const researcherCtx         = this.config.get<number>('ai.ollama.researcherContextWindow', 65_536);
    const researcherTemperature = this.config.get<number>('ai.ollama.researcherTemperature', 0.2);
    const researcherTopP        = this.config.get<number>('ai.ollama.researcherTopP', 0.9);
    const researcherTopK        = this.config.get<number>('ai.ollama.researcherTopK', 40);

    const researcher = new OllamaProvider({
      id: 'researcher',
      name: 'Researcher (5090, swap w/ writer)',
      model: researcherModel,
      tier: 'free',
      available: false,
      endpoint: researcherEndpoint,
      maxTokens: 16_384,
      contextWindow: researcherCtx,
      safeOutputTokens: 16_384,
      costPer1kInput: 0,
      costPer1kOutput: 0,
      // Extraction-friendly sampling: low temp, deterministic but not zero
      temperature:   researcherTemperature,
      topP:          researcherTopP,
      topK:          researcherTopK,
      repeatPenalty: 1.0,
    } as any);

    if (await researcher.checkAvailability()) {
      this.providers.set('researcher', researcher);
      this.log.info('Researcher initialized (Ollama on 5090, swap w/ writer)', {
        model: researcherModel,
        endpoint: researcherEndpoint,
        contextWindow: researcherCtx,
      });
    } else {
      this.log.warn('Researcher not available — book-planning research will fall back to librarian', {
        model: researcherModel,
        endpoint: researcherEndpoint,
      });
    }

    // ── Ollama Quaternary = "Perry-Agent" (locally-trained tool-using LoRA) ──
    // Slot for the future home-trained agent LoRA(s). Defaults to the
    // librarian endpoint (5070 Ti) since the trainer will produce small
    // 7-8B LoRAs that fit alongside librarian. Model name resolves from
    // env or config; if the model isn't pulled yet, the provider stays
    // unregistered (agents fall back to their other modelBindings).
    //
    // Multi-domain plan: each domain may eventually get its own LoRA
    // (perry-code-agent, perry-email-agent, perry-research-agent). The
    // AgentRunner picks which model to ask for based on the invocation's
    // domain/agent; this provider is just the routing target.
    const perryAgentEndpoint = process.env.OLLAMA_PERRY_AGENT_BASE_URL
      || this.config.get<string>('ai.ollama.perryAgentEndpoint', '')
      || librarianEndpoint;
    const perryAgentModel = process.env.OLLAMA_PERRY_AGENT_MODEL
      || this.config.get<string>('ai.ollama.perryAgentModel', '');

    if (perryAgentModel) {
      const perryAgent = new OllamaProvider({
        id: 'perry-agent',
        name: 'Perry-Agent (locally-trained)',
        model: perryAgentModel,
        tier: 'free',
        available: false,
        endpoint: perryAgentEndpoint,
        maxTokens: 8_192,
        contextWindow: this.config.get<number>('ai.ollama.perryAgentContextWindow', 32_768),
        safeOutputTokens: 8_192,
        costPer1kInput: 0,
        costPer1kOutput: 0,
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        repeatPenalty: 1.0,
      } as any);
      if (await perryAgent.checkAvailability()) {
        this.providers.set('perry-agent', perryAgent);
        this.log.info('Perry-Agent initialized (locally-trained LoRA)', {
          model: perryAgentModel,
          endpoint: perryAgentEndpoint,
        });
      } else {
        this.log.info('Perry-Agent model configured but not yet pulled into Ollama — agents using `perry-agent` will fall back to their other bindings.', {
          model: perryAgentModel,
        });
      }
    } else {
      this.log.info('Perry-Agent slot empty (no model configured). Set OLLAMA_PERRY_AGENT_MODEL to enable.');
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

    // ── Embedding service ──
    // Reuse the librarian's endpoint (same Ollama instance hosts the small
    // embed model). Override via env / config for non-default deployments.
    const embedEndpoint = process.env.OLLAMA_EMBED_BASE_URL
      || this.config.get<string>('ai.ollama.embedEndpoint', '')
      || process.env.OLLAMA_LIBRARIAN_BASE_URL
      || this.config.get<string>('ai.ollama.librarianEndpoint', 'http://ollama-embeddings:11434');
    const embedModel = this.config.get<string>('ai.ollama.embedModel', 'nomic-embed-text');
    this.embeddings = new EmbeddingService({
      endpoint: embedEndpoint,
      model: embedModel,
      cacheTtlMinutes: this.config.get<number>('ai.embeddings.cacheTtlMinutes', 30),
    }, this.log.child('embeddings'));
    try {
      const ok = await this.embeddings.isAvailable();
      this.log.info('Embedding service initialized', { endpoint: embedEndpoint, model: embedModel, reachable: ok });
    } catch (e: any) {
      this.log.warn('Embedding service initialized but availability check failed', { endpoint: embedEndpoint, error: e.message });
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

  /** Get fallback provider if primary fails.
   *
   * Role-aware: extraction roles (researcher, librarian) prefer each other on
   * fallback — never `ollama` (writer), because the writer is the pen-aware
   * fictioning LoRA and will hallucinate plausible-looking data when fed a
   * JSON-schema extraction prompt. The writer (ollama) falls back to the
   * librarian for the same reason in reverse.
   */
  getFallbackProvider(currentId: string): BaseProvider | null {
    const preference: Record<string, string[]> = {
      researcher: ['librarian', 'ollama'],
      librarian:  ['researcher', 'ollama'],
      ollama:     ['librarian', 'researcher'],
    };
    const preferred = preference[currentId];
    if (preferred) {
      for (const id of preferred) {
        const p = this.providers.get(id);
        if (p) return p;
      }
    }
    // Non-ollama providers (claude/gemini/etc.) or unknown IDs fall through
    // to Map-order — first available != current.
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

    // Phase 3: per-request pen-aware writer model override. When the caller
    // supplies penSlug and the configured resolver returns a model, we swap
    // request.model for the ollama provider. Other providers (claude, gemini,
    // etc.) ignore pen-slug because they don't run pen-specific LoRAs.
    const effectiveRequest = this.applyPenAwareModel(request);

    // Build the ordered list of fallback providers to try
    const triedIds = new Set<string>([effectiveRequest.provider]);
    const fallbacks: BaseProvider[] = [];

    // 1. Role-aware local preferences
    const preference: Record<string, string[]> = {
      researcher: ['librarian', 'ollama'],
      librarian:  ['researcher', 'ollama'],
      ollama:     ['librarian', 'researcher'],
    };
    const preferred = preference[effectiveRequest.provider];
    if (preferred) {
      for (const id of preferred) {
        if (!triedIds.has(id)) {
          const p = this.providers.get(id);
          if (p) {
            fallbacks.push(p);
            triedIds.add(id);
          }
        }
      }
    }

    // 2. Add Gemini, Claude, DeepSeek, OpenAI, OpenRouter if they are initialized/available
    const apiOrder = ['gemini', 'claude', 'deepseek', 'openai', 'openrouter'];
    for (const id of apiOrder) {
      if (!triedIds.has(id)) {
        const p = this.providers.get(id);
        if (p) {
          fallbacks.push(p);
          triedIds.add(id);
        }
      }
    }

    // 3. Add any remaining active providers
    for (const [id, p] of this.providers) {
      if (!triedIds.has(id)) {
        fallbacks.push(p);
        triedIds.add(id);
      }
    }

    try {
      return await provider.complete(effectiveRequest);
    } catch (err: any) {
      this.log.warn(`Primary provider failed, attempting fallbacks`, {
        provider: effectiveRequest.provider,
        error: err.message,
        availableFallbacks: fallbacks.map(f => f.id)
      });

      let lastError = err;
      for (const fallback of fallbacks) {
        try {
          this.log.info(`Attempting fallback to ${fallback.id}`, { model: fallback.model });
          // Ensure we update the provider and model for the fallback
          return await fallback.complete({
            ...effectiveRequest,
            provider: fallback.id,
            model: fallback.model
          });
        } catch (fallbackErr: any) {
          this.log.warn(`Fallback to ${fallback.id} failed`, { error: fallbackErr.message });
          lastError = fallbackErr;
        }
      }
      throw lastError;
    }
  }

  private applyPenAwareModel(request: CompletionRequest): CompletionRequest {
    if (!request.penSlug || !this.penModelResolver) return request;
    if (request.provider !== 'ollama') return request;
    let resolved: string | null;
    try {
      resolved = this.penModelResolver(request.penSlug);
    } catch (err: any) {
      this.log.warn('Pen-aware resolver threw', { penSlug: request.penSlug, error: err.message });
      return request;
    }
    if (!resolved || resolved === request.model) return request;
    this.log.debug('Pen-aware writer model applied', { penSlug: request.penSlug, model: resolved });
    return { ...request, model: resolved };
  }

  /** Get the recommended thinking level for a task type. */
  getRecommendedThinking(taskType: string): ThinkingLevel | undefined {
    return TASK_REASONING[taskType];
  }

  /** Get the output token budget for a task type. */
  getOutputBudget(taskType: string): number {
    return TASK_OUTPUT_BUDGET[taskType] || 4096;
  }

  /**
   * Set or clear the pen-aware writer model override. Call this BEFORE
   * `initialize()` to pick a model resolved from pen_name_records instead
   * of the user.json default. Passing null restores config-driven behavior.
   */
  setWriterModelOverride(model: string | null): void {
    this.writerModelOverride = model;
  }

  /**
   * Register a pen-aware resolver callback. When a CompletionRequest carries
   * `penSlug`, the router calls this with that slug and uses the returned
   * model tag for the ollama provider. Pass null to disable per-request
   * pen-aware resolution. The resolver is expected to be fast (typically a
   * single typed-table lookup against the state store).
   */
  setPenModelResolver(fn: ((penSlug: string) => string | null) | null): void {
    this.penModelResolver = fn;
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

  /**
   * Resolve the routing target for a given task type.
   *
   * Reads `ai.routing.taskTypes` config (a JSON object of taskType →
   * RoutingTarget) and MERGES it on top of STEP_ROUTING_DEFAULTS so
   * overrides are surgical — a user can repoint one task type without
   * losing the rest of the table.
   *
   * The `requirements` arg lets the caller declare what the step NEEDS
   * (tools, minimum context window). If the matched target doesn't meet
   * those requirements, the resolver upgrades to one that does:
   *   - Needs tools but target is 'writer' (Ollama Magnum) → 'workers'
   *   - Needs large context (>50k) but target is 'librarian' (32k) → 'workers'
   *
   * Capability-aware routing means future model swaps (a new writer LoRA
   * with tool support, a 1M-token local model) only need a capability
   * config update — no code changes here. Each provider's capabilities
   * live in `ai.providers.{id}.capabilities` (see `getProviderCapabilities`).
   *
   * Returns 'writer' for unknown types if nothing matches (safe default:
   * fall through to the local writer rather than block on a worker that
   * might not exist).
   */
  resolveRoutingTarget(taskType: string, requirements?: { needsTools?: boolean; minContextWindow?: number }): RoutingTarget {
    let overrides: Record<string, RoutingTarget> = {};
    try {
      const raw = this.config.get<any>('ai.routing.taskTypes', null);
      if (raw && typeof raw === 'object') overrides = raw as Record<string, RoutingTarget>;
    } catch { /* ignore — fall back to defaults */ }
    const merged: Record<string, RoutingTarget> = { ...STEP_ROUTING_DEFAULTS, ...overrides };
    let target = (merged[taskType] || 'writer') as RoutingTarget;

    if (requirements) {
      const caps = this.getProviderCapabilities(target);
      // Upgrade if the chosen target doesn't meet the bar.
      if (requirements.needsTools && !caps.supportsTools) {
        target = 'workers';
      } else if (requirements.minContextWindow && caps.contextWindow < requirements.minContextWindow) {
        // workers always meet large-context requirements (Claude/Gemini have 200k+)
        target = caps.contextWindow >= requirements.minContextWindow ? target : 'workers';
      }
    }

    return target;
  }

  /**
   * Per-target capability snapshot. Reads optional overrides from
   * `ai.providers.{id}.capabilities` so deployments can declare what their
   * specific model supports without touching code.
   */
  getProviderCapabilities(target: RoutingTarget): { supportsTools: boolean; contextWindow: number } {
    // Hardcoded defaults — sane fallbacks when no config override is present.
    const DEFAULTS: Record<RoutingTarget, { supportsTools: boolean; contextWindow: number }> = {
      writer:     { supportsTools: false, contextWindow: 32_000 },   // Magnum 32B + LoRA — no tool support
      librarian:  { supportsTools: false, contextWindow: 131_000 },  // qwen3:14b
      researcher: { supportsTools: false, contextWindow: 65_000 },   // qwen3.6:27b
      workers:    { supportsTools: true,  contextWindow: 200_000 },  // Claude 200k, Gemini 1M
    };
    let overrides: any = {};
    try { overrides = this.config.get<any>(`ai.providers.${target}.capabilities`, null) || {}; }
    catch { /* ignore */ }
    return { ...DEFAULTS[target], ...overrides };
  }

  /** Read the full effective routing table (defaults merged with overrides). */
  getRoutingTable(): Record<string, RoutingTarget> {
    let overrides: Record<string, RoutingTarget> = {};
    try {
      const raw = this.config.get<any>('ai.routing.taskTypes', null);
      if (raw && typeof raw === 'object') overrides = raw as Record<string, RoutingTarget>;
    } catch { /* ignore */ }
    return { ...STEP_ROUTING_DEFAULTS, ...overrides };
  }

  // ── Librarian-to-Writer routing override ─────────────────────────────
  // When the GPU monitor "Free 5070 Ti" toggle is on, librarian completions
  // get redirected to the writer's Ollama endpoint so audit / POV-check
  // calls still resolve (ollama hot-swaps models on demand). Reverting
  // restores the original 5070 Ti endpoint.
  private librarianOriginalEndpoint: string | null = null;

  isLibrarianRoutedToWriter(): boolean {
    return this.librarianOriginalEndpoint !== null;
  }

  /**
   * Reroute the librarian provider to a different Ollama endpoint (usually
   * the writer's 5090). Pass null to restore the original endpoint.
   * Returns { routed, original, current }.
   */
  setLibrarianEndpointOverride(url: string | null): { routed: boolean; original: string | null; current: string | null } {
    const provider = this.providers.get('librarian');
    if (!provider) return { routed: false, original: null, current: null };
    const cfg: any = provider.providerConfig;
    if (url === null) {
      // Restore
      if (this.librarianOriginalEndpoint) {
        cfg.endpoint = this.librarianOriginalEndpoint;
        this.librarianOriginalEndpoint = null;
      }
      return { routed: false, original: null, current: cfg.endpoint };
    }
    if (this.librarianOriginalEndpoint === null) {
      this.librarianOriginalEndpoint = cfg.endpoint;
    }
    cfg.endpoint = url;
    return { routed: true, original: this.librarianOriginalEndpoint, current: cfg.endpoint };
  }
}
