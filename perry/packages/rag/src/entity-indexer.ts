/**
 * @perry/rag — Entity Indexer
 *
 * Automatically extracts entities (characters, locations, items) from
 * completed creative_writing steps using the Librarian GPU (5070 Ti).
 * Runs asynchronously after each chapter completes so the 5070 Ti
 * stays busy while the 5090 is idle between chapters.
 *
 * Entities are stored in the ContextEngine and available as P3 context
 * slots for future chapters.
 */

import type { EventBus, Logger } from '@perry/core';
import type { ContextCompressor } from '@perry/ai';
import type { ContextEngine } from './context-engine.js';

export class EntityIndexer {
  private compressor: ContextCompressor;
  private contextEngine: ContextEngine;
  private log: Logger;
  private indexingQueue: Array<{ projectId: string; stepId: string; text: string }> = [];
  private isProcessing = false;

  constructor(compressor: ContextCompressor, contextEngine: ContextEngine, log: Logger) {
    this.compressor = compressor;
    this.contextEngine = contextEngine;
    this.log = log;
  }

  /**
   * Register on the EventBus to auto-extract entities when chapters complete.
   */
  registerEvents(eventBus: EventBus): void {
    eventBus.on('step:completed', async (payload) => {
      // Only index creative writing steps (chapters, prologue, epilogue)
      // The step result contains the full chapter text
      if (!payload.result || payload.result.length < 500) return;

      // Queue the extraction — don't block the pipeline
      this.indexingQueue.push({
        projectId: payload.projectId,
        stepId: payload.stepId,
        text: payload.result,
      });

      // Process the queue if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the extraction queue sequentially on the Librarian GPU.
   * This ensures we don't overwhelm the 5070 Ti with parallel requests.
   */
  private async processQueue(): Promise<void> {
    if (!this.compressor.isAvailable()) {
      this.log.debug('Entity indexer: Librarian not available, skipping queue');
      this.indexingQueue = [];
      return;
    }

    this.isProcessing = true;

    while (this.indexingQueue.length > 0) {
      const item = this.indexingQueue.shift()!;
      try {
        this.log.info('Extracting entities from step', {
          projectId: item.projectId,
          stepId: item.stepId,
          textLength: item.text.length,
        });

        const result = await this.compressor.extractEntities(item.text, 2048);

        // Parse the extracted entities and add to context engine
        const entities = this.parseEntities(result.compressed);
        if (entities.length > 0) {
          await this.contextEngine.addEntities(item.projectId, entities);
          this.log.info('Entities indexed', {
            projectId: item.projectId,
            count: entities.length,
            names: entities.map(e => e.name).slice(0, 5),
          });
        }
      } catch (err: any) {
        this.log.warn('Entity extraction failed for step', {
          stepId: item.stepId,
          error: err.message,
        });
        // Don't rethrow — entity extraction is best-effort
      }
    }

    this.isProcessing = false;
  }

  /**
   * Parse the Librarian's entity extraction output into structured entities.
   * The Librarian outputs in the format:
   *   - Name (Type): Description
   */
  private parseEntities(raw: string): Array<{ name: string; type: string; description: string }> {
    const entities: Array<{ name: string; type: string; description: string }> = [];
    const lines = raw.split('\n');

    for (const line of lines) {
      // Match "- Name (Type): Description" or "- **Name** (Type): Description"
      const match = line.match(/^[-*]\s+\*{0,2}([^(*]+?)\*{0,2}\s*\(([^)]+)\)[:\s]*(.+)/);
      if (match) {
        entities.push({
          name: match[1].trim(),
          type: match[2].trim().toLowerCase(),
          description: match[3].trim(),
        });
      }
    }

    return entities;
  }

  /** Get the current queue size (for dashboard display). */
  getQueueSize(): number {
    return this.indexingQueue.length;
  }

  /** Check if currently processing. */
  isActive(): boolean {
    return this.isProcessing;
  }
}
