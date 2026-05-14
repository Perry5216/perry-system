/**
 * @perry/ai — Context Watcher
 *
 * Monitors real-time context window usage on each GPU by querying
 * Ollama's /api/ps endpoint. Provides:
 *
 * 1. Per-GPU context fill levels (used / limit / % full)
 * 2. Hallucination warnings injected into prompts when >80% full
 * 3. Dynamic compression budget adjustment — tells the Compressor
 *    to squeeze harder when headroom is tight, or relax when there's space
 * 4. Dashboard-ready stats for real-time monitoring
 *
 * Hardware mapping:
 *   Writer   = RTX 5090 (ollama primary)   → creative prose
 *   Librarian = RTX 5070 Ti (ollama secondary) → compression, analysis
 */

import type { Logger } from '@perry/core';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface GpuContextStatus {
  /** Human-readable GPU label */
  label: string;
  /** Ollama endpoint URL */
  endpoint: string;
  /** Model currently loaded (or null if idle) */
  model: string | null;
  /** Context tokens currently in use */
  contextUsed: number;
  /** Maximum context window for this model */
  contextLimit: number;
  /** Percentage of context window used (0-100) */
  percentFull: number;
  /** Available headroom in tokens */
  headroom: number;
  /** Status tier based on fill level */
  status: 'idle' | 'green' | 'yellow' | 'red' | 'critical';
  /** Whether a hallucination warning should be injected */
  hallucinationRisk: boolean;
  /** Last polled timestamp */
  lastPolled: string;
}

export interface ContextWatcherStats {
  gpus: GpuContextStatus[];
  /** Recommended compression budget multiplier (1.0 = normal, <1.0 = squeeze, >1.0 = relax) */
  compressionMultiplier: number;
  /** Global hallucination risk assessment */
  globalRisk: 'low' | 'moderate' | 'high';
}

// Ollama /api/ps response shape
interface OllamaPsResponse {
  models: Array<{
    name: string;
    model: string;
    size: number;
    digest: string;
    details?: {
      parameter_size?: string;
      quantization_level?: string;
    };
    // Context window info from Ollama 0.6+
    size_vram?: number;
    // These come from the running model metadata
    expires_at?: string;
  }>;
}

// Ollama /api/show response shape (for context window lookup)
interface OllamaShowResponse {
  modelfile?: string;
  parameters?: string;
  model_info?: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════
// Context Watcher
// ═══════════════════════════════════════════════════════════

export class ContextWatcher {
  private log: Logger;
  private gpuConfigs: Array<{
    label: string;
    endpoint: string;
    role: 'writer' | 'librarian';
    defaultContextWindow: number;
  }> = [];
  private lastStatus: GpuContextStatus[] = [];
  private pollIntervalMs = 15_000; // 15 seconds
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // Model context window cache (avoid re-fetching /api/show)
  private modelContextCache = new Map<string, number>();

  // Per-step tracking: stores the last prompt's estimated token count
  private lastPromptTokens = new Map<string, number>();

  constructor(log: Logger) {
    this.log = log;
  }

  /**
   * Register a GPU endpoint to monitor.
   */
  addGpu(label: string, endpoint: string, role: 'writer' | 'librarian', defaultContextWindow: number): void {
    // Avoid duplicates if called multiple times
    if (!this.gpuConfigs.some(g => g.label === label)) {
      this.gpuConfigs.push({ label, endpoint, role, defaultContextWindow });
      this.log.info('GPU registered for context watching', { label, endpoint, role });
    }
  }

  /**
   * Clear all registered GPUs (used during reinitialization).
   */
  clearGpus(): void {
    this.gpuConfigs = [];
    this.lastStatus = [];
  }

  /**
   * Start periodic polling of all registered GPUs.
   */
  startPolling(intervalMs?: number): void {
    if (this.pollTimer) return; // Already polling
    this.pollIntervalMs = intervalMs ?? this.pollIntervalMs;
    this.log.info('Context Watcher polling started', { intervalMs: this.pollIntervalMs });

    // Poll immediately, then on interval
    this.pollAll().catch(() => {});
    this.pollTimer = setInterval(() => {
      this.pollAll().catch(() => {});
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling.
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Poll all GPUs and update status.
   */
  async pollAll(): Promise<GpuContextStatus[]> {
    const results: GpuContextStatus[] = [];

    for (const gpu of this.gpuConfigs) {
      try {
        const status = await this.pollGpu(gpu);
        results.push(status);
      } catch (err: any) {
        // GPU is unreachable — report as idle
        results.push({
          label: gpu.label,
          endpoint: gpu.endpoint,
          model: null,
          contextUsed: 0,
          contextLimit: gpu.defaultContextWindow,
          percentFull: 0,
          headroom: gpu.defaultContextWindow,
          status: 'idle',
          hallucinationRisk: false,
          lastPolled: new Date().toISOString(),
        });
      }
    }

    this.lastStatus = results;
    return results;
  }

  /**
   * Poll a single GPU via Ollama /api/ps.
   */
  private async pollGpu(gpu: typeof this.gpuConfigs[0]): Promise<GpuContextStatus> {
    const psRes = await fetch(`${gpu.endpoint}/api/ps`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!psRes.ok) {
      throw new Error(`Ollama /api/ps returned ${psRes.status}`);
    }

    const psData = await psRes.json() as OllamaPsResponse;
    const now = new Date().toISOString();

    if (!psData.models || psData.models.length === 0) {
      return {
        label: gpu.label,
        endpoint: gpu.endpoint,
        model: null,
        contextUsed: 0,
        contextLimit: gpu.defaultContextWindow,
        percentFull: 0,
        headroom: gpu.defaultContextWindow,
        status: 'idle',
        hallucinationRisk: false,
        lastPolled: now,
      };
    }

    // Use the first loaded model (typically only one per GPU)
    const activeModel = psData.models[0];
    const modelName = activeModel.name || activeModel.model;

    // Get the context window for this model
    const contextLimit = await this.getModelContextWindow(gpu.endpoint, modelName, gpu.defaultContextWindow);

    // Estimate context usage from the model's VRAM footprint
    // Ollama 0.6+ exposes size_vram which correlates with context usage
    // For older versions, we track prompt tokens from our own completions
    let contextUsed = 0;
    const trackedTokens = this.lastPromptTokens.get(gpu.label);
    if (trackedTokens) {
      contextUsed = trackedTokens;
    }

    const percentFull = contextLimit > 0 ? Math.round((contextUsed / contextLimit) * 100) : 0;
    const headroom = Math.max(0, contextLimit - contextUsed);

    // Determine status tier
    let status: GpuContextStatus['status'];
    if (contextUsed === 0) status = 'idle';
    else if (percentFull < 60) status = 'green';
    else if (percentFull < 80) status = 'yellow';
    else if (percentFull < 95) status = 'red';
    else status = 'critical';

    const hallucinationRisk = percentFull >= 80;

    if (hallucinationRisk) {
      this.log.warn('Context window nearing capacity — hallucination risk elevated', {
        gpu: gpu.label,
        model: modelName,
        percentFull,
        headroom,
      });
    }

    return {
      label: gpu.label,
      endpoint: gpu.endpoint,
      model: modelName,
      contextUsed,
      contextLimit,
      percentFull,
      headroom,
      status,
      hallucinationRisk,
      lastPolled: now,
    };
  }

  /**
   * Look up the context window for a model (cached).
   */
  private async getModelContextWindow(endpoint: string, model: string, fallback: number): Promise<number> {
    const cacheKey = `${endpoint}:${model}`;
    const cached = this.modelContextCache.get(cacheKey);
    if (cached) return cached;

    try {
      const showRes = await fetch(`${endpoint}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
        signal: AbortSignal.timeout(5000),
      });

      if (showRes.ok) {
        const showData = await showRes.json() as OllamaShowResponse;

        // Try to extract context_length from model_info
        const info = showData.model_info || {};
        for (const [key, value] of Object.entries(info)) {
          if (key.includes('context_length') && typeof value === 'number') {
            const finalValue = Math.max(value, fallback);
            this.modelContextCache.set(cacheKey, finalValue);
            return finalValue;
          }
        }

        // Try to parse from parameters string
        if (showData.parameters) {
          const ctxMatch = showData.parameters.match(/num_ctx\s+(\d+)/);
          if (ctxMatch) {
            const ctxValue = parseInt(ctxMatch[1], 10);
            this.modelContextCache.set(cacheKey, ctxValue);
            return ctxValue;
          }
        }
      }
    } catch {
      // Ignore — use fallback
    }

    this.modelContextCache.set(cacheKey, fallback);
    return fallback;
  }

  // ═══════════════════════════════════════════════════════════
  // Prompt Token Tracking
  // ═══════════════════════════════════════════════════════════

  /**
   * Record the estimated prompt token count for a GPU.
   * Called by StepRunner after building the prompt, before sending to AI.
   */
  recordPromptTokens(gpuLabel: string, estimatedTokens: number): void {
    this.lastPromptTokens.set(gpuLabel, estimatedTokens);
  }

  /**
   * Record actual token usage from an Ollama completion response.
   */
  recordActualUsage(gpuLabel: string, promptTokens: number, completionTokens: number): void {
    this.lastPromptTokens.set(gpuLabel, promptTokens + completionTokens);
  }

  /**
   * Clear token tracking for a GPU (e.g., after VRAM flush).
   */
  clearTracking(gpuLabel: string): void {
    this.lastPromptTokens.delete(gpuLabel);
  }

  // ═══════════════════════════════════════════════════════════
  // Compression Budget Feedback
  // ═══════════════════════════════════════════════════════════

  /**
   * Get the recommended compression multiplier for the Writer GPU.
   *
   * This is the closed-loop feedback to the Compressor:
   *   - Writer at 90%+ → multiplier 0.5 (squeeze HARD)
   *   - Writer at 80-90% → multiplier 0.7 (compress more)
   *   - Writer at 60-80% → multiplier 1.0 (normal)
   *   - Writer at <60% → multiplier 1.3 (relax, include more context)
   */
  getCompressionMultiplier(): number {
    const writerGpu = this.lastStatus.find(g => g.label.toLowerCase().includes('writer'));
    if (!writerGpu || writerGpu.status === 'idle') return 1.0;

    if (writerGpu.percentFull >= 95) return 0.3;
    if (writerGpu.percentFull >= 90) return 0.5;
    if (writerGpu.percentFull >= 80) return 0.7;
    if (writerGpu.percentFull >= 60) return 1.0;
    if (writerGpu.percentFull >= 40) return 1.5;
    if (writerGpu.percentFull >= 20) return 2.0;
    return 3.0;
  }

  /**
   * Get the available headroom on the Writer GPU in tokens.
   * Used by PromptBuilder to dynamically size context slots.
   */
  getWriterHeadroom(): number | null {
    const writerGpu = this.lastStatus.find(g => g.label.toLowerCase().includes('writer'));
    if (!writerGpu || writerGpu.status === 'idle') return null;
    return writerGpu.headroom;
  }

  /**
   * Build a hallucination warning string to inject into prompts
   * when context is near capacity.
   */
  getHallucinationWarning(gpuLabel: string, taskType?: string): string | null {
    const gpu = this.lastStatus.find(g => g.label === gpuLabel);
    if (!gpu || !gpu.hallucinationRisk) return null;

    const canSegment = taskType === 'creative_writing' || taskType === 'revision_execution';

    if (gpu.percentFull >= 95) {
      return `\n\n[⚠️ CONTEXT CRITICAL: ${gpu.percentFull}% of your memory is used. ` +
        `You have only ~${gpu.headroom} tokens of headroom. ` +
        `If the task is too large to complete accurately within this constraint, BREAK THE TASK UP INTO SEGMENTS. ` +
        `Stop cleanly when you reach the limit.]\n`;
    }

    if (gpu.percentFull >= 80) {
      return `\n\n[⚠️ CONTEXT WARNING: ${gpu.percentFull}% of your memory is used. ` +
        `Prioritize accuracy over detail. Do not introduce new elements not already established. ` +
        `]\n`;
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // Dashboard API
  // ═══════════════════════════════════════════════════════════

  /**
   * Get full stats for the dashboard.
   */
  getStats(): ContextWatcherStats {
    const gpus = this.lastStatus.length > 0 ? this.lastStatus : this.gpuConfigs.map(g => ({
      label: g.label,
      endpoint: g.endpoint,
      model: null,
      contextUsed: 0,
      contextLimit: g.defaultContextWindow,
      percentFull: 0,
      headroom: g.defaultContextWindow,
      status: 'idle' as const,
      hallucinationRisk: false,
      lastPolled: new Date().toISOString(),
    }));

    const multiplier = this.getCompressionMultiplier();

    // Global risk assessment
    const hasRed = gpus.some(g => g.status === 'red' || g.status === 'critical');
    const hasYellow = gpus.some(g => g.status === 'yellow');
    const globalRisk = hasRed ? 'high' : hasYellow ? 'moderate' : 'low';

    return { gpus, compressionMultiplier: multiplier, globalRisk };
  }
}
