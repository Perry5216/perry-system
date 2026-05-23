/**
 * @perry/core — Shared Types
 *
 * Every data structure in the system lives here. No package defines
 * its own project/step/entity types — they all import from core.
 */

// ═══════════════════════════════════════════════════════════
// Project Types
// ═══════════════════════════════════════════════════════════

export type WorkType = 'books' | 'code' | 'dnd' | 'meta' | 'email' | 'hacking';

export type ProjectType =
  | 'software-dev'
  | 'dynamic-skills'
  // Book templates
  | 'book-planning'
  | 'style-calibration'
  | 'novel-pipeline'
  | 'deep-revision'
  | 'revision-execution'
  | 'book-production'
  | 'amazon-kdp-launch'
  | 'short-story'
  | 'book-cover'
  // D&D templates
  | 'dnd-campaign-planning'
  | 'dnd-session-prep'
  | 'dnd-character-design'
  // Meta templates
  | 'system-evolution'
  | 'template-generator';

export type ProjectStatus = 'pending' | 'active' | 'paused' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

export interface TicketMetadata {
  order: {
    category: string;
    objective: string;
  };
  proof: {
    baselineState: string;
    failureLogs?: string;
  };
  boundary: {
    inScope: string[];
    outOfScope: string[];
    rules: string[];
  };
  budget: {
    maxIterations: number;
    tokenLimit: number;
    costLimitUsd?: number;
  };
  fallback: {
    strategy: 'escalate' | 'switch-provider' | 'default-rollback';
    escalationTarget: string;
  };
}

export interface ProjectStep {
  id: string;
  label: string;
  ticket?: TicketMetadata;
  phase: string;
  taskType: string;
  /**
   * The prompt used for this step's next execution. Refreshed from the
   * current template at execute time UNLESS `promptOverride` is set (in
   * which case the override wins). Treating `prompt` as the historical
   * snapshot caused stale text to outlive template fixes.
   */
  prompt: string;
  /**
   * Set by mutators (POV-gate retries, manual edits) when a step needs a
   * specific non-template prompt for its next attempt. Persisted to the
   * `steps.prompt_override` column. When present, the engine's pending-
   * prompt refresh skips this step so the override survives a restart.
   */
  promptOverride?: string;
  status: StepStatus;
  result?: string;
  error?: string;
  skill?: string;
  wordCountTarget?: number;
  chapterNumber?: number;
  segmentIndex?: number;
  totalSegments?: number;
  /**
   * Network requests executed by the step-runner for `taskType: 'network_research'`
   * steps. Each entry is fetched in parallel through `NetworkClient`, the bodies
   * are HTML-stripped + truncated, and the concatenated text is fed into the
   * model alongside the step's `prompt` for extraction/synthesis.
   *
   * Workflow: `prompt` describes what to extract; `networkRequests` describes
   * where to fetch from; the model's job is to turn the fetched text into
   * the structured output the prompt asks for.
   */
  networkRequests?: Array<{
    /** Absolute URL to fetch. */
    url: string;
    /** Routing path. Defaults to 'direct'. See NetworkClient. */
    networkPath?: string;
    /** Optional label shown in the context block so the model can cite. */
    label?: string;
    /** Max characters of body to keep (after HTML strip). Default 20000. */
    maxChars?: number;
    /** If true, skip HTML stripping (use for JSON / plain text endpoints). */
    rawBody?: boolean;
  }>;
  startedAt?: string;
  completedAt?: string;
  autoResetCount?: number;
}

export interface ProjectContext {
  hasParent?: boolean;
  reviewMode?: boolean;
  planning?: string;
  config?: Record<string, unknown>;
  [key: string]: any;
}

export interface ProjectTemplate {
  type: ProjectType;
  workType: WorkType;
  name: string;
  description: string;
  buildSteps: (context: ProjectContext, title: string, description: string) => ProjectStep[];
}

export interface Project {
  id: string;
  parentId?: string;
  type: ProjectType;
  workType?: WorkType;
  title: string;
  description: string;
  status: ProjectStatus;
  progress: number;
  steps: ProjectStep[];
  context: ProjectContext;
  preferredProvider?: string;
  /** Runtime corrections from the Continuity Quality Gate. Injected into all future prompts. */
  continuityOverrides?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ═══════════════════════════════════════════════════════════
// AI Types
// ═══════════════════════════════════════════════════════════

export type ProviderTier = 'free' | 'cheap' | 'paid';
export type TaskTier = 'free' | 'mid' | 'premium' | 'libre';
export type ThinkingLevel = 'low' | 'medium' | 'high';

export interface AIProvider {
  id: string;
  name: string;
  model: string;
  tier: ProviderTier;
  available: boolean;
  endpoint: string;
  maxTokens: number;
  contextWindow: number;
  safeOutputTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
}

export interface CompletionRequest {
  provider: string;
  model?: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; name?: string; tool_calls?: any[] }>;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  thinking?: ThinkingLevel;
  repeatPenalty?: number;
  tools?: any[];
  /**
   * Optional pen-name slug. When set, the AI router resolves the writer model
   * for this pen via pen_names/lora_versions and overrides `model` for the
   * ollama provider, so multi-pen workflows can swap writer LoRAs per call.
   */
  penSlug?: string;
  /**
   * Optional structured-output enforcement.
   *   - `'json'` — token-level JSON validity (Ollama `format: 'json'`).
   *     The model can only emit syntactically valid JSON, but is free to
   *     pick which fields.
   *   - An object — full JSON schema (Ollama 0.5+ structured outputs).
   *     Forces the model to emit EXACTLY the specified shape, including
   *     all `required` fields. Use this when prompt-level "ALL FIELDS
   *     MANDATORY" isn't reliable enough (gemma3:12b routinely drops
   *     fields with strong-genre descriptions).
   */
  format?: 'json' | Record<string, any>;
}

export interface CompletionResponse {
  text: string;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
  provider: string;
  finishReason?: string;
  toolCalls?: any[];
}

// ═══════════════════════════════════════════════════════════
// RAG / Context Types
// ═══════════════════════════════════════════════════════════

export interface ChapterSummary {
  chapterId: string;
  chapterNumber: number;
  title: string;
  summary: string;
  wordCount: number;
  characters: string[];
  locations: string[];
  timelineMarker: string;
  plotThreads: string[];
  endingState: string;
}

export interface EntityEntry {
  name: string;
  type: 'character' | 'location' | 'item' | 'object' | 'event' | 'rule';
  aliases: string[];
  description: string;
  firstAppearance: string;
  lastSeen: string;
  attributes: Record<string, string>;
  changes: Array<{ chapterId: string; description: string }>;
}

export interface SceneContext {
  sceneId: string;
  chapterId: string;
  povCharacter: string;
  presentCharacters: string[];
  location: string;
  timeOfDay: string;
  emotionalTone: string;
  activeThreads: string[];
  openQuestions: string[];
}

// ═══════════════════════════════════════════════════════════
// Context Budget Types
// ═══════════════════════════════════════════════════════════

export interface ContextBudget {
  provider: string;
  modelContextWindow: number;
  reservedForOutput: number;
  reservedForSystem: number;
  availableForContent: number;
}

export type SlotPriority = 1 | 2 | 3 | 4 | 5;

export interface ContextSlot {
  label: string;
  priority: SlotPriority;
  content: string;
  tokenCount: number;
  compressible: boolean;
  compressedVersion?: string;
  included: boolean;
}

export interface BudgetReport {
  totalBudget: number;
  used: number;
  remaining: number;
  slots: ContextSlot[];
  droppedSlots: string[];
  compressionApplied: boolean;
}

// ═══════════════════════════════════════════════════════════
// Style DNA Types
// ═══════════════════════════════════════════════════════════

export interface StyleDNA {
  avgSentenceLength: number;
  dialogueToNarrativeRatio: number;
  adverbFrequency: number;
  passiveVoiceFrequency: number;
  favoredTransitions: string[];
  forbiddenWords: string[];
  pov: 'first' | 'third-limited' | 'third-omniscient' | 'second';
  tense: 'past' | 'present';
  samplePassages: string[];
}

// ═══════════════════════════════════════════════════════════
// Event Types
// ═══════════════════════════════════════════════════════════

export interface EventMap {
  'project:created': { project: Project };
  'project:started': { projectId: string };
  'project:paused': { projectId: string };
  'project:completed': { projectId: string };
  'project:deleted': { projectId: string };
  'step:started': { projectId: string; stepId: string };
  'step:completed': { projectId: string; stepId: string; result: string };
  'step:failed': { projectId: string; stepId: string; error: string };
  'step:progress': { projectId: string; stepId: string; message: string };
  'context:indexed': { projectId: string; chapterId: string };
  'entity:extracted': { projectId: string; entities: EntityEntry[] };
  'agent:invocation:started': { invocationId: string; agentId: string; sessionId: string };
  'agent:invocation:completed': { invocationId: string; agentId: string; sessionId: string; durationMs: number };
  'agent:invocation:failed': { invocationId: string; agentId: string; sessionId: string; error: string };

  // ─── Self-learning taxonomy (load-bearing contract) ──────────────────
  // Emit one of these from ANY service or agent and the framework's
  // LearningCore picks it up — tracks recurrence by (source, kind,
  // fingerprint), proposes skills once a threshold is crossed. New
  // domains/services get learning automatically without writing their
  // own SkillProposer wiring.
  //
  //   source       — which subsystem produced the event ("director",
  //                  "audit", "gc", "prompt-builder", "scout", or a
  //                  domain like "hacking" / "code" / "meta").
  //                  Determines the proposed skill's service tag.
  //   kind         — the pattern bucket within the source
  //                  ("rag-miss", "dir-growth", "step-fail",
  //                  "leak-pattern"). Threshold + skill template are
  //                  selected per (source, kind).
  //   fingerprint  — what specifically recurred ("bible_rag::topic-hash",
  //                  "scout-findings", "research_assist::EISDIR").
  //                  Same fingerprint = same observation; counters
  //                  aggregate.
  //   metadata     — anything extra (samples, slugs, dir paths) folded
  //                  into the skill body when threshold fires.
  'learning:success':     { source: string; kind: string; fingerprint: string; metadata?: Record<string, any> };
  'learning:failure':     { source: string; kind: string; fingerprint: string; error: string; metadata?: Record<string, any> };
  'learning:observation': { source: string; kind: string; fingerprint: string; value?: number; metadata?: Record<string, any> };
  'learning:duration':    { source: string; kind: string; fingerprint: string; durationMs: number; metadata?: Record<string, any> };
  'skill:execution':      { service: string; name: string; success: boolean; durationMs: number; error: string | null };
  'intelligent-evolve:log': { message: string; timestamp: string };
}

// ═══════════════════════════════════════════════════════════
// Agent System Types
// ═══════════════════════════════════════════════════════════

/**
 * Domains group agents by purpose. Each domain has its own agents,
 * tool ACL, default model bindings, and memory namespace. The
 * core domains (code, email, hacking, meta) extend the framework.
 */
export type AgentDomain = 'code' | 'email' | 'hacking' | 'meta' | 'books' | 'dnd' | string;

/**
 * Map a ProjectType to its domain. Every project type belongs to exactly
 * one domain. The list is hand-maintained — when new domains add new
 * project types, add the mapping here.
 */
export function projectTypeDomain(type: ProjectType): AgentDomain {
  switch (type) {
    case 'software-dev':
    case 'dynamic-skills':
      return 'code';
    case 'book-planning':
    case 'style-calibration':
    case 'novel-pipeline':
    case 'deep-revision':
    case 'revision-execution':
    case 'book-production':
    case 'amazon-kdp-launch':
    case 'short-story':
    case 'book-cover':
      return 'books';
    case 'dnd-campaign-planning':
    case 'dnd-session-prep':
    case 'dnd-character-design':
      return 'dnd';
    case 'system-evolution':
    case 'template-generator':
      return 'meta';
    default:
      return 'code';
  }
}

/**
 * Worker class — which executor backend can claim this invocation.
 *   local-ollama    → in-process router.complete() against Ollama
 *   local-lora      → ditto, but the model is a pen/agent-specific LoRA
 *   claude-cli      → spawned via perry-worker HTTP /spawn
 *   gemini-cli      → ditto
 *   workers         → either of the CLIs (race / cheapest available)
 *   custom          → reserved for future executor backends
 */
export type WorkerClass = 'local-ollama' | 'local-lora' | 'claude-cli' | 'gemini-cli' | 'workers' | 'custom';

/**
 * Compression level for the agent's MCP tool surface. See
 * services/mcp-compressor.ts for what each level does.
 */
export type CompressionLevel = 'none' | 'low' | 'medium' | 'high' | 'max';

/**
 * Declarative agent definition. The registry holds one of these per
 * registered agent. The AgentRunner reads it at invocation time.
 *
 * Fields are intentionally narrow; everything that needs to be runtime-
 * variable (e.g. "current Worker is claude vs gemini") goes through
 * the per-invocation override, not the registry entry.
 */
export interface AgentDefinition {
  id: string;                                  // e.g. 'code.critic'
  domain: AgentDomain;
  label: string;
  description: string;
  /** System prompt template. May reference {{var}} placeholders that
   *  the runner fills from invocation context (project, pen, etc.). */
  systemPrompt: string;
  /**
   * Default backing model. Perry runs **subscription-only** by design:
   * either a LOCAL Ollama model (zero marginal cost) or the CLI WORKERS
   * pool (Claude Code / Gemini CLI using your existing subscription OAuth).
   * Metered API providers (anthropic, gemini-api, openai, openrouter) are
   * intentionally excluded from this enum so an agent can never route to
   * pay-per-token compute by accident.
   */
  modelBinding: {
    provider:
      | 'writer'        // local Magnum LoRA on writer GPU (free)
      | 'librarian'     // local qwen3:14b on librarian GPU (free)
      | 'researcher'    // local qwen3.6:27b on configurable endpoint (free)
      | 'perry-agent'   // future locally-trained Perry agent LoRA (free)
      | 'workers';      // CLI subscription pool — Claude Code + Gemini CLI race
    /** Optional explicit model override. Otherwise the provider's
     *  default is used. */
    model?: string;
    /** Per-pen overrides. Same provider enum restrictions apply — if you
     *  see TS errors after adding to byPen, double-check you're not
     *  trying to route to a metered API by name. */
    byPen?: Record<string, { provider?: AgentDefinition['modelBinding']['provider']; model?: string }>;
  };
  /** Allow-list of MCP tool names this agent may invoke. Empty array
   *  means "no tools" (pure LLM). null/undefined means "all tools"
   *  (rare — only meta-level agents like Director). */
  toolACL?: string[] | null;
  /** Schema enforcement for output. 'free' = arbitrary text. 'markdown'
   *  = wrap-and-validate. 'json' = parse + validate against jsonSchema. */
  outputFormat: 'free' | 'markdown' | 'json';
  jsonSchema?: any;
  /** Compression policy for this agent's tool list. */
  compression: CompressionLevel;
  /** Max wall-clock for one invocation. AgentRunner kills past this. */
  timeoutMs: number;
  /** Whether this agent can delegate to other agents (calls invoke_agent
   *  tool). Director is the only `true` by default. */
  canDelegate: boolean;
}

/**
 * An open conversation thread that one or more agent invocations write to.
 * Persisted to `agent_sessions` table.
 */
export interface AgentSession {
  id: string;
  domain: AgentDomain;
  projectId?: string;
  penSlug?: string;
  title?: string;
  createdAt: string;
  closedAt?: string;
}

/**
 * One agent execution. Persisted to `agent_invocations` table. The
 * trajectory captured for training purposes is a separate row in
 * `agent_trajectories`, derived from this when invocation completes.
 */
export interface AgentInvocation {
  id: string;
  sessionId: string;
  parentInvocationId?: string;
  agentId: string;
  domain: AgentDomain;
  status: 'pending' | 'running' | 'completed' | 'failed';
  workerClass?: WorkerClass;
  model?: string;
  input?: string;
  output?: string;
  toolCalls?: Array<{ name: string; arguments: any; result?: any; error?: string }>;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}
