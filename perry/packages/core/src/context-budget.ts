/**
 * @perry/core — Context Budget Manager
 *
 * The smart context budget system that prevents OOM crashes by fitting
 * prompts to each provider's actual context window. Replaces V4's
 * blind `chars / 4` estimation with priority-based slot filling and
 * adaptive compression.
 */

import type { AIProvider, ContextBudget, ContextSlot, SlotPriority, BudgetReport } from './types.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/** Fallback conservative limits for unknown models. */
const FALLBACK_LIMITS = { contextWindow: 16384, safeOutput: 4096 };

export class ContextBudgetManager {
  private providerLimits: Record<string, { contextWindow: number; safeOutput: number }> = {};
  
  constructor() {
    this.loadLimits();
  }

  private loadLimits() {
    try {
      const configDir = process.env.PERRY_CONFIG || join(process.cwd(), 'config');
      const limitsPath = join(configDir, 'provider_limits.json');
      if (existsSync(limitsPath)) {
        this.providerLimits = JSON.parse(readFileSync(limitsPath, 'utf-8'));
      } else {
        // Fallback default set if file doesn't exist yet
        this.providerLimits = {
          'gemma4:31b':         { contextWindow: 65536,   safeOutput: 16384 },
          'gemma3:27b':         { contextWindow: 32768,   safeOutput: 6144  },
          'gemma3:12b':         { contextWindow: 32768,   safeOutput: 6144  },
          'llama3.2':           { contextWindow: 131072,  safeOutput: 8192  },
          'llama3.1:8b':        { contextWindow: 131072,  safeOutput: 8192  },
          'qwen2.5:32b':        { contextWindow: 32768,   safeOutput: 8192  },
          'qwen3:32b':          { contextWindow: 131072,  safeOutput: 8192  },
          'perry-writer':       { contextWindow: 131072,  safeOutput: 8192  },
          'gemini-2.5-flash':   { contextWindow: 1048576, safeOutput: 65536 },
          'gemini-2.5-pro':     { contextWindow: 1048576, safeOutput: 65536 },
          'claude-sonnet-4-5':  { contextWindow: 200000,  safeOutput: 16384 },
          'claude-opus-4':      { contextWindow: 200000,  safeOutput: 16384 },
          'gpt-4o':             { contextWindow: 128000,  safeOutput: 16384 },
          'deepseek-chat':      { contextWindow: 65536,   safeOutput: 8192  },
        };
        // We do not auto-write this file here to avoid read-only filesystem issues, 
        // the user can manually create it or the MCP server can create it.
      }
    } catch (err) {
      console.warn('[ContextBudgetManager] Failed to load provider_limits.json', err);
    }
  }

  /**
   * Estimate token count for a string.
   * Uses a conservative 3.5 chars/token for English prose.
   * This is intentionally conservative — overestimating tokens means
   * we leave headroom rather than crashing.
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.0);
  }

  /**
   * Get the known limits for a provider's model.
   */
  getProviderLimits(provider: AIProvider): { contextWindow: number; safeOutput: number } {
    return this.providerLimits[provider.model] || {
      contextWindow: provider.contextWindow || FALLBACK_LIMITS.contextWindow,
      safeOutput: provider.safeOutputTokens || FALLBACK_LIMITS.safeOutput,
    };
  }

  /**
   * Calculate the available budget for content given a provider and system prompt.
   */
  calculateBudget(provider: AIProvider, systemPrompt: string, requestedOutput?: number): ContextBudget {
    const limits = this.getProviderLimits(provider);
    const systemTokens = this.estimateTokens(systemPrompt);
    const outputTokens = requestedOutput || limits.safeOutput;

    // Available = total context - system prompt - output reservation - safety margin
    const safetyMargin = 512;
    const available = Math.max(0, limits.contextWindow - systemTokens - outputTokens - safetyMargin);

    return {
      provider: provider.id,
      modelContextWindow: limits.contextWindow,
      reservedForOutput: outputTokens,
      reservedForSystem: systemTokens,
      availableForContent: available,
    };
  }

  /**
   * Fill context slots by priority within the available budget.
   * Returns a report of what was included, what was dropped, and
   * whether compression was applied.
   *
   * Slots are filled in priority order (1 = highest). Within the same
   * priority, slots are filled in array order. If a slot doesn't fit:
   *   - If compressible AND has a compressed version → try the compressed version
   *   - Otherwise → drop it entirely
   *
   * No slot is ever truncated mid-sentence.
   */
  fillSlots(budget: ContextBudget, slots: ContextSlot[]): BudgetReport {
    // Sort by priority (ascending = highest priority first)
    const sorted = [...slots].sort((a, b) => a.priority - b.priority);

    let remaining = budget.availableForContent;
    const included: ContextSlot[] = [];
    const dropped: string[] = [];
    let compressionApplied = false;

    for (const slot of sorted) {
      // STRICT COMPRESSION PROTOCOL: Always prefer compressed version if it exists
      if (slot.compressible && slot.compressedVersion) {
        const compressedTokens = this.estimateTokens(slot.compressedVersion);
        if (compressedTokens <= remaining) {
          slot.content = slot.compressedVersion;
          slot.tokenCount = compressedTokens;
          slot.included = true;
          included.push(slot);
          remaining -= compressedTokens;
          compressionApplied = true;
        } else {
          // Even compressed doesn't fit
          slot.included = false;
          dropped.push(slot.label);
        }
      } else {
        // No compressed version available, try raw text
        const tokenCount = this.estimateTokens(slot.content);
        slot.tokenCount = tokenCount;
        
        if (tokenCount <= remaining) {
          // Fits as-is
          slot.included = true;
          included.push(slot);
          remaining -= tokenCount;
        } else {
          slot.included = false;
          dropped.push(slot.label);
        }
      }
    }

    return {
      totalBudget: budget.availableForContent,
      used: budget.availableForContent - remaining,
      remaining,
      slots: included,
      droppedSlots: dropped,
      compressionApplied,
    };
  }

  /**
   * V2: Adaptive slot filling with re-compression support.
   *
   * Unlike fillSlots() which does binary include/drop, this method:
   * 1. First tries to include full content
   * 2. If too large, tries compressed version
   * 3. If compressed is slightly too large (within 150% of remaining),
   *    marks the slot for re-compression to the exact remaining budget
   * 4. Only drops if none of the above work
   *
   * Returns the same BudgetReport but with recompressNeeded flags.
   */
  fillSlotsAdaptive(
    budget: ContextBudget,
    slots: ContextSlot[],
  ): BudgetReport & { slotsNeedingRecompress: Array<{ label: string; targetTokens: number }> } {
    const sorted = [...slots].sort((a, b) => a.priority - b.priority);

    let remaining = budget.availableForContent;
    const included: ContextSlot[] = [];
    const dropped: string[] = [];
    const slotsNeedingRecompress: Array<{ label: string; targetTokens: number }> = [];
    let compressionApplied = false;

    for (const slot of sorted) {
      // STRICT COMPRESSION PROTOCOL: Always prefer compressed version if it exists
      if (slot.compressible && slot.compressedVersion) {
        const compressedTokens = this.estimateTokens(slot.compressedVersion);

        if (compressedTokens <= remaining) {
          // Compressed version fits
          slot.content = slot.compressedVersion;
          slot.tokenCount = compressedTokens;
          slot.included = true;
          included.push(slot);
          remaining -= compressedTokens;
          compressionApplied = true;
        } else if (compressedTokens <= remaining * 1.5 && remaining >= 128) {
          // Compressed version is close — mark for re-compression
          slot.content = slot.compressedVersion;
          slot.tokenCount = remaining; 
          slot.included = true;
          included.push(slot);
          slotsNeedingRecompress.push({ label: slot.label, targetTokens: remaining });
          remaining = 0;
          compressionApplied = true;
        } else {
          slot.included = false;
          dropped.push(slot.label);
        }
      } else {
        // No compressed version available, try raw text
        const tokenCount = this.estimateTokens(slot.content);
        slot.tokenCount = tokenCount;

        if (tokenCount <= remaining) {
          // Fits as-is
          slot.included = true;
          included.push(slot);
          remaining -= tokenCount;
        } else {
          slot.included = false;
          dropped.push(slot.label);
        }
      }
    }

    return {
      totalBudget: budget.availableForContent,
      used: budget.availableForContent - remaining,
      remaining,
      slots: included,
      droppedSlots: dropped,
      compressionApplied,
      slotsNeedingRecompress,
    };
  }

  /**
   * Determine the optimal segment strategy for a chapter based on the
   * provider's output capacity and the target word count.
   *
   * Returns the number of segments needed.
   */
  calculateSegments(provider: AIProvider, targetWords: number): number {
    const limits = this.getProviderLimits(provider);
    // ~1.3 tokens per word for English prose output
    const tokensNeeded = Math.ceil(targetWords * 1.3);
    if (tokensNeeded <= limits.safeOutput) return 1;
    return Math.ceil(tokensNeeded / limits.safeOutput);
  }

  /**
   * Build a compressed entity summary for when the full profiles don't fit.
   */
  compressEntities(entities: Array<{ name: string; type: string; description: string }>): string {
    return entities
      .map(e => `- ${e.name} (${e.type}): ${e.description.substring(0, 80)}`)
      .join('\n');
  }
}
