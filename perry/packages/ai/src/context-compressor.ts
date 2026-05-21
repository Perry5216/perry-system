/**
 * @perry/ai — Context Compressor (The Librarian)
 *
 * Dual-GPU architecture: uses a secondary, lighter model (the "Librarian")
 * to pre-process and compress context before it reaches the primary model
 * (the "Writer"). This effectively extends the Writer's usable context by
 * having the Librarian distill large volumes of raw text into dense,
 * structured summaries.
 *
 * Hardware mapping:
 *   Writer   = RTX 5090 (gemma4:31b)  → creative prose, full chapters
 *   Librarian = RTX 5070 Ti (gemma3:12b) → entity extraction, summarization,
 *               context compression, continuity checking
 *
 * Why this works:
 *   The 5090 has ~32K usable context with a 31B model. A 25-chapter novel
 *   with character profiles, world rules, and series bible could easily
 *   exceed 100K tokens of raw context. The Librarian reads ALL of it on
 *   the 5070 Ti (which can handle 12B models with huge context), extracts
 *   only what's relevant to the current step, and produces a ~4K-8K token
 *   briefing document. The Writer then gets a complete, curated context
 *   within its budget instead of a truncated mess.
 *
 * Compression pipeline:
 *   1. Raw context gathered (chapters, entities, bible, series)
 *   2. Librarian filters and ranks by relevance to current step
 *   3. Librarian summarizes verbose sections into dense bullet points
 *   4. Compressed context fits within Writer's budget
 *   5. Writer generates with full situational awareness
 */

import type { CompletionResponse } from '@perry/core';
import type { Logger } from '@perry/core';
import type { BaseProvider } from './providers/base.js';
import { createHash } from 'crypto';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface CompressionRequest {
  /** The raw context to compress (can be very large). */
  rawContext: string;
  /** What the Writer will be doing with this context (e.g., "Write Chapter 7"). */
  taskDescription: string;
  /** Maximum tokens for the compressed output. */
  targetTokens: number;
  /** Type of compression to apply. */
  mode: CompressionMode;
}

export type CompressionMode =
  | 'chapter_summary'    // Summarize a chapter into key beats + ending state
  | 'entity_extraction'  // Extract character/location/item profiles
  | 'context_briefing'   // General-purpose: distill raw context into a dense briefing
  | 'continuity_check'   // Check for contradictions in provided text
  | 'style_analysis';    // Analyze prose style and extract patterns

export interface CompressionResult {
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  mode: CompressionMode;
  provider: string;
}

// ═══════════════════════════════════════════════════════════
// Compression Prompts
// ═══════════════════════════════════════════════════════════

const PROMPTS: Record<CompressionMode, string> = {

  chapter_summary: `You are a story analyst preparing context for a writing AI.
Summarize the provided chapter text into a dense briefing document.

Include:
- Key events (what happened, in order)
- Character actions and emotional states
- Revelations or plot twists
- The exact ending state (where things stand)
- Any unresolved tension or open questions

Be precise. Use character names. Do NOT add commentary or analysis.
Output pure factual summary in bullet points.
MAXIMIZE DENSITY: Use telegraphic style. Drop articles (a/an/the) and helper verbs. Use arrows for movement (A -> Loc B). Use key:value for attributes.`,

  entity_extraction: `You are a story data extractor. Extract all named entities from the provided text.

For each entity, output:
- Name and any aliases used
- Type (character / location / item / faction / concept)
- Key attributes mentioned (appearance, role, status, relationships)
- Current state at end of text

Output as a structured list. Be exhaustive — miss nothing. Use exact names from the text.`,

  context_briefing: `You are a librarian preparing a highly optimized context briefing for an AI writing model.
Your job is to distill the provided raw text into an incredibly dense, factual summary tailored specifically for the writer's upcoming task.

TASK THE WRITER WILL PERFORM:
{{TASK}}

Instructions:
- Extract ONLY facts strictly necessary for the task above. Discard all filler, repetition, and irrelevant backstory.
- Format your output as a dense Markdown list.
- **Bold** key names, locations, and important concepts so the writer model can scan them easily.
- Preserve exact terminology and world rules without alteration.
- Note any critical emotional states, relationships, or immediate timeline positions if relevant to the task.
- If the raw context contains contradictory information, flag it inline with a bold prefix like "**CONTRADICTION:**". Do NOT use markdown blockquote callouts (no "> [!WARNING]", no "> [!NOTE]") — those leak into the writer's output as visible formatting.
- Output prose facts only — no markdown blockquotes ('>'), no fenced code blocks, no XML-style tags, no "Here is..." preamble, no "Let me know if you need anything else" postamble. The writer model will echo whatever shape you emit; keep the shape clean.
- MAXIMIZE DENSITY: Use a telegraphic writing style. Eliminate conversational filler, articles (a, an, the), and helper verbs where meaning remains clear. Use shorthand/symbols (e.g., 'Character A goes to Location B' -> 'A -> Loc B'). Use key-value pairs for stats/attributes.

Your output is injected directly into the writer's limited context window. Make every single token count.`,

  continuity_check: `You are a continuity editor. Review the provided text for internal contradictions.

Check for:
- Characters in two places at once
- Timeline impossibilities (events that can't happen in the stated order)
- Attribute contradictions (eye color, age, weapon, etc.)
- Dropped plot threads mentioned but never resolved
- Name inconsistencies (same character with different spellings)

For each issue found, output:
- What the contradiction is
- Where it occurs (reference specific passages)
- Suggested fix

If no issues found, say "No continuity issues detected."`,

  style_analysis: `You are a prose analyst. Analyze the writing style of the provided text.

Extract:
- Average sentence length (short/medium/long)
- Dialogue-to-narrative ratio (estimate)
- POV and tense used
- Vocabulary level (simple/moderate/literary)
- Common patterns (e.g., "tends to open scenes with setting", "uses fragments for emphasis")
- Distinctive phrases or verbal tics
- Emotional register (detached/warm/intense/etc.)

Output as a concise style profile the writer can reference.`,
};

// ═══════════════════════════════════════════════════════════
// Context Compressor
// ═══════════════════════════════════════════════════════════

export class ContextCompressor {
  private librarian: BaseProvider | null = null;
  private log: Logger;
  private cache = new Map<string, { result: CompressionResult; timestamp: number }>();
  private cacheMaxAge = 1000 * 60 * 30; // 30 minutes
  private cacheMaxEntries = 100;

  // Stats tracking for dashboard
  private cacheHits = 0;
  private cacheMisses = 0;
  private totalCompressions = 0;
  private totalCompressionTimeMs = 0;
  private totalCompressionRatio = 0;

  private watcher: any = null;

  constructor(log: Logger) {
    this.log = log;
  }

  setWatcher(watcher: any): void {
    this.watcher = watcher;
  }

  /**
   * Set the Librarian provider. This should be the secondary GPU model
   * (e.g., gemma3:12b on the 5070 Ti).
   */
  setLibrarian(provider: BaseProvider): void {
    this.librarian = provider;
    this.log.info('Librarian set', { provider: provider.id, model: provider.model });
  }

  getProvider(): BaseProvider | null {
    return this.librarian;
  }

  /** Check if a Librarian is available. */
  isAvailable(): boolean {
    return this.librarian !== null;
  }

  /**
   * Compress raw context using the Librarian model.
   *
   * This is the core method that enables the dual-GPU architecture:
   * 1. Takes large, raw context (potentially 50K+ tokens)
   * 2. Sends it to the 5070 Ti's smaller model (big context window, fast inference)
   * 3. Returns a dense briefing that fits in the 5090's smaller context window
   */
  async compress(request: CompressionRequest): Promise<CompressionResult> {
    if (!this.librarian) {
      // No Librarian available — return raw context truncated to budget
      this.log.warn('No Librarian available, returning raw context (truncated)');
      const estimatedTokens = Math.ceil(request.rawContext.length / 3.5);
      const maxChars = Math.floor(request.targetTokens * 3.5);
      return {
        compressed: request.rawContext.substring(0, maxChars),
        originalTokens: estimatedTokens,
        compressedTokens: Math.min(estimatedTokens, request.targetTokens),
        compressionRatio: 1,
        mode: request.mode,
        provider: 'none',
      };
    }

    // ── Skip compression when the input already fits the budget ──
    // Calling the librarian on a 28-token slot to "fit in 1024 tokens" is
    // a wasted LLM round-trip — it adds 1-2s of latency PLUS often expands
    // the output because the system prompt creates floor cost. Skip entirely
    // when input is already at or under the target, OR when the input is
    // below an absolute minimum (200 tokens) where compression can't yield
    // useful savings versus its round-trip cost.
    {
      const originalTokens = Math.ceil(request.rawContext.length / 3.5);
      const MIN_COMPRESS_TOKENS = 200;
      if (originalTokens <= request.targetTokens || originalTokens < MIN_COMPRESS_TOKENS) {
        this.log.debug('Skipping compression — input already within budget', {
          mode: request.mode, originalTokens, targetTokens: request.targetTokens,
        });
        return {
          compressed: request.rawContext,
          originalTokens,
          compressedTokens: originalTokens,
          compressionRatio: 1,
          mode: request.mode,
          provider: 'passthrough',
        };
      }
    }

    // ── Cache check ──
    const cacheKey = this.buildCacheKey(request);
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheMaxAge) {
      this.cacheHits++;
      this.log.debug('Cache hit for compression', { mode: request.mode, hitRate: this.getHitRate() });
      return cached.result;
    }
    this.cacheMisses++;

    // ── Build the Librarian prompt ──
    let systemPrompt = PROMPTS[request.mode];
    if (request.mode === 'context_briefing') {
      systemPrompt = systemPrompt.replace('{{TASK}}', request.taskDescription);
    }

    // Add output budget constraint
    systemPrompt += `\n\nIMPORTANT: Your output must be concise — maximum ~${request.targetTokens} tokens (~${Math.floor(request.targetTokens * 3)} characters). Prioritize density over completeness.`;

    const originalTokens = Math.ceil(request.rawContext.length / 3.5);
    this.log.info('Compressing context', {
      mode: request.mode,
      originalTokens,
      targetTokens: request.targetTokens,
    });

    if (this.watcher) {
      this.watcher.recordPromptTokens('Librarian (5070 Ti)', originalTokens);
    }

    try {
      const startTime = Date.now();
      const response = await this.librarian.complete({
        provider: this.librarian.id,
        system: systemPrompt,
        messages: [{ role: 'user', content: request.rawContext }],
        maxTokens: request.targetTokens,
        temperature: 0.1, // Low temperature for factual extraction
      });

      const elapsed = Date.now() - startTime;
      // Defensive strip: even with the prompt explicitly forbidding GFM callouts,
      // gemma3:12b sometimes still emits "> [!WARNING]" blocks. The writer model
      // (Magnum 32B) is finetuned to echo whatever scaffolding appears in its
      // context, so a single callout in the briefing becomes a callout in the
      // generated scene. Belt-and-braces: strip them here before the briefing
      // is cached or injected.
      const cleanText = response.text
        .replace(/^>\s*\[![^\]\n]+\][\s\S]*?(?=\n[^>\s]|\n\s*\n|$)/gim, '')
        .replace(/^>\s+.*$/gm, '');
      const compressedTokens = Math.ceil(cleanText.length / 3.5);
      const result: CompressionResult = {
        compressed: cleanText,
        originalTokens,
        compressedTokens,
        compressionRatio: originalTokens > 0 ? compressedTokens / originalTokens : 1,
        mode: request.mode,
        provider: this.librarian.id,
      };

      // Track stats
      this.totalCompressions++;
      this.totalCompressionTimeMs += elapsed;
      this.totalCompressionRatio += result.compressionRatio;

      this.log.info('Compression complete', {
        ratio: `${Math.round(result.compressionRatio * 100)}%`,
        originalTokens,
        compressedTokens,
        saved: originalTokens - compressedTokens,
        elapsedMs: elapsed,
      });

      // Cache the result (with eviction if at max capacity)
      if (this.cache.size >= this.cacheMaxEntries) {
        // Evict oldest entry
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, { result, timestamp: Date.now() });

      return result;
    } catch (err: any) {
      this.log.error('Librarian compression failed', { error: err.message });
      // Fallback: return raw context truncated
      const maxChars = Math.floor(request.targetTokens * 3.5);
      return {
        compressed: request.rawContext.substring(0, maxChars),
        originalTokens,
        compressedTokens: request.targetTokens,
        compressionRatio: 1,
        mode: request.mode,
        provider: 'fallback',
      };
    }
  }

  /**
   * Specialized: extract entities from chapter text for the entity index.
   */
  async extractEntities(
    text: string,
    targetTokens: number = 2048,
  ): Promise<CompressionResult> {
    return this.compress({
      rawContext: text,
      taskDescription: 'Entity extraction for story database',
      targetTokens,
      mode: 'entity_extraction',
    });
  }

  /**
   * Specialized: build a context briefing for a specific writing task.
   * This is the main method called by the PromptBuilder before each step.
   */
  async buildBriefing(
    rawContext: string,
    taskDescription: string,
    targetTokens: number = 4096,
  ): Promise<CompressionResult> {
    return this.compress({
      rawContext,
      taskDescription,
      targetTokens,
      mode: 'context_briefing',
    });
  }

  /**
   * Re-compress already-compressed content to a smaller target.
   * Used when a compressed slot is slightly too large for the remaining budget.
   */
  async recompress(
    previouslyCompressed: string,
    newTargetTokens: number,
    taskDescription: string,
  ): Promise<CompressionResult> {
    const currentTokens = Math.ceil(previouslyCompressed.length / 3.5);

    // If already small enough, return as-is
    if (currentTokens <= newTargetTokens) {
      return {
        compressed: previouslyCompressed,
        originalTokens: currentTokens,
        compressedTokens: currentTokens,
        compressionRatio: 1,
        mode: 'context_briefing',
        provider: 'passthrough',
      };
    }

    return this.compress({
      rawContext: previouslyCompressed,
      taskDescription: `Further compress this already-compressed briefing. It must fit in ${newTargetTokens} tokens. Preserve the most critical facts. ${taskDescription}`,
      targetTokens: newTargetTokens,
      mode: 'context_briefing',
    });
  }

  /** Clear the compression cache. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Get actual hit rate as a percentage string. */
  private getHitRate(): string {
    const total = this.cacheHits + this.cacheMisses;
    if (total === 0) return '0%';
    return `${Math.round((this.cacheHits / total) * 100)}%`;
  }

  /** Get cache and compression stats for the dashboard. */
  getCacheStats(): {
    entries: number;
    maxEntries: number;
    hitRate: string;
    hits: number;
    misses: number;
    totalCompressions: number;
    avgCompressionRatio: string;
    avgLatencyMs: number;
  } {
    return {
      entries: this.cache.size,
      maxEntries: this.cacheMaxEntries,
      hitRate: this.getHitRate(),
      hits: this.cacheHits,
      misses: this.cacheMisses,
      totalCompressions: this.totalCompressions,
      avgCompressionRatio: this.totalCompressions > 0
        ? `${Math.round((this.totalCompressionRatio / this.totalCompressions) * 100)}%`
        : 'N/A',
      avgLatencyMs: this.totalCompressions > 0
        ? Math.round(this.totalCompressionTimeMs / this.totalCompressions)
        : 0,
    };
  }

  private buildCacheKey(request: CompressionRequest): string {
    const hash = createHash('md5').update(request.rawContext).digest('hex').substring(0, 16);
    // V2: Include task description in key so the same Bible gets compressed differently
    // for "Chapter 3 — faction setup" vs "Chapter 22 — final alliance"
    const taskHash = createHash('md5').update(request.taskDescription).digest('hex').substring(0, 8);
    return `${request.mode}:${request.targetTokens}:${taskHash}:${hash}`;
  }
}
