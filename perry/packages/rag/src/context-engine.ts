/**
 * @perry/rag — Context Engine
 *
 * Manages per-project chapter summaries, entity tracking, and continuity.
 * Listens to EventBus 'step:completed' events to auto-index new chapters.
 *
 * Key differences from V4:
 *   - Decoupled from ProjectEngine (communicates via EventBus)
 *   - Uses MemoryStore for persistence (not standalone JSON files)
 *   - Delegates compression to the Librarian (ContextCompressor) instead
 *     of doing its own inline summarization
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import type {
  ChapterSummary, EntityEntry, EventBus, Logger,
} from '@perry/core';
import { MemoryStore } from './memory-store.js';

// ═══════════════════════════════════════════════════════════
// Project Context (in-memory working set)
// ═══════════════════════════════════════════════════════════

export interface ProjectContext {
  projectId: string;
  summaries: ChapterSummary[];
  entities: EntityEntry[];
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════
// Context Engine
// ═══════════════════════════════════════════════════════════

export class ContextEngine {
  private contexts = new Map<string, ProjectContext>();
  private contextDir: string;
  private memoryStore: MemoryStore;
  private log: Logger;

  constructor(workspaceDir: string, memoryStore: MemoryStore, log: Logger) {
    this.contextDir = join(workspaceDir, 'context');
    this.memoryStore = memoryStore;
    this.log = log;
  }

  /**
   * Register event listeners on the EventBus. Call once at startup.
   * When a writing step completes, auto-index the result.
   */
  registerEvents(eventBus: EventBus): void {
    eventBus.on('step:completed', async (payload) => {
      // Index the step result into the memory store
      this.memoryStore.upsert({
        source: 'project_step',
        sourceRef: payload.stepId,
        projectId: payload.projectId,
        timestamp: new Date().toISOString(),
        title: payload.stepId,
        body: payload.result.substring(0, 200000),
      });
      this.log.debug('Step result indexed', {
        projectId: payload.projectId,
        stepId: payload.stepId,
      });
    });

    eventBus.on('project:deleted', (payload) => {
      this.contexts.delete(payload.projectId);
      this.memoryStore.deleteProject(payload.projectId);
      try {
        rmSync(join(this.contextDir, `${payload.projectId}.json`), { force: true });
      } catch { /* file may not exist */ }
      this.log.info('Project context purged', { projectId: payload.projectId });
    });
  }

  // ── Context Loading ─────────────────────────────────────

  async loadContext(projectId: string): Promise<ProjectContext> {
    const cached = this.contexts.get(projectId);
    if (cached) return cached;

    const filePath = join(this.contextDir, `${projectId}.json`);
    if (existsSync(filePath)) {
      try {
        const raw = await readFile(filePath, 'utf-8');
        const ctx: ProjectContext = JSON.parse(raw);
        this.contexts.set(projectId, ctx);
        return ctx;
      } catch {
        this.log.warn('Failed to load context file, starting fresh', { projectId });
      }
    }

    const empty: ProjectContext = {
      projectId,
      summaries: [],
      entities: [],
      updatedAt: new Date().toISOString(),
    };
    this.contexts.set(projectId, empty);
    return empty;
  }

  async persistContext(projectId: string): Promise<void> {
    const ctx = this.contexts.get(projectId);
    if (!ctx) return;
    ctx.updatedAt = new Date().toISOString();
    await mkdir(this.contextDir, { recursive: true });
    await writeFile(
      join(this.contextDir, `${projectId}.json`),
      JSON.stringify(ctx, null, 2),
    );
  }

  // ── Chapter Summaries ───────────────────────────────────

  /**
   * Store a chapter summary (typically produced by the Librarian).
   */
  async addSummary(projectId: string, summary: ChapterSummary): Promise<void> {
    const ctx = await this.loadContext(projectId);
    const idx = ctx.summaries.findIndex(s => s.chapterId === summary.chapterId);
    if (idx >= 0) {
      ctx.summaries[idx] = summary;
    } else {
      ctx.summaries.push(summary);
    }
    ctx.summaries.sort((a, b) => a.chapterNumber - b.chapterNumber);
    await this.persistContext(projectId);
  }

  /**
   * Get the previous chapter's summary (for writing context).
   */
  getPreviousSummary(projectId: string, currentChapter: number): ChapterSummary | null {
    const ctx = this.contexts.get(projectId);
    if (!ctx) return null;
    return ctx.summaries.find(s => s.chapterNumber === currentChapter - 1) || null;
  }

  /**
   * Get all summaries for a project.
   */
  getSummaries(projectId: string): ChapterSummary[] {
    return this.contexts.get(projectId)?.summaries || [];
  }

  // ── Entity Management ───────────────────────────────────

  /**
   * Merge extracted entities into the project's entity index.
   * Handles alias deduplication and attribute change tracking.
   */
  async mergeEntities(projectId: string, stepId: string, newEntities: EntityEntry[]): Promise<void> {
    const ctx = await this.loadContext(projectId);

    for (const incoming of newEntities) {
      const normalizedName = incoming.name.toLowerCase().trim();
      const existing = ctx.entities.find(
        e => e.name.toLowerCase().trim() === normalizedName ||
             e.aliases.some(a => a.toLowerCase().trim() === normalizedName),
      );

      if (existing) {
        existing.lastSeen = stepId;

        // Merge aliases
        for (const alias of incoming.aliases || []) {
          if (!existing.aliases.some(a => a.toLowerCase() === alias.toLowerCase())) {
            existing.aliases.push(alias);
          }
        }

        // Track attribute changes
        for (const [key, value] of Object.entries(incoming.attributes || {})) {
          const old = existing.attributes[key];
          if (old && old !== value) {
            existing.changes.push({
              chapterId: stepId,
              description: `${key} changed from "${old}" to "${value}"`,
            });
          }
          existing.attributes[key] = value;
        }

        // Keep longer description
        if (incoming.description && incoming.description.length > existing.description.length) {
          existing.description = incoming.description;
        }
      } else {
        ctx.entities.push({
          ...incoming,
          firstAppearance: stepId,
          lastSeen: stepId,
          changes: [],
        });
      }
    }

    await this.persistContext(projectId);
  }

  /**
   * Convenience: add entities from the EntityIndexer's simplified format.
   * Wraps mergeEntities with sensible defaults for auto-extracted entities.
   */
  async addEntities(
    projectId: string,
    entities: Array<{ name: string; type: string; description: string }>,
  ): Promise<void> {
    const fullEntities: EntityEntry[] = entities.map(e => ({
      name: e.name,
      type: e.type as EntityEntry['type'],
      description: e.description,
      aliases: [],
      attributes: {},
      firstAppearance: 'auto-extracted',
      lastSeen: 'auto-extracted',
      changes: [],
    }));
    await this.mergeEntities(projectId, 'auto-extracted', fullEntities);
  }

  getEntities(projectId: string): EntityEntry[] {
    return this.contexts.get(projectId)?.entities || [];
  }

  getCharacters(projectId: string): EntityEntry[] {
    return this.getEntities(projectId).filter(e => e.type === 'character');
  }

  getLocations(projectId: string): EntityEntry[] {
    return this.getEntities(projectId).filter(e => e.type === 'location');
  }

  // ── Context Building (for PromptBuilder) ────────────────

  /**
   * Build a relevance-ranked context string for a writing step.
   * Returns structured sections that the PromptBuilder can feed
   * into the ContextBudgetManager as slots.
   */
  async getContextSlots(
    projectId: string,
    currentStepId: string,
    currentChapter?: number,
  ): Promise<Array<{ label: string; content: string; priority: number }>> {
    const ctx = await this.loadContext(projectId);
    const slots: Array<{ label: string; content: string; priority: number }> = [];

    // P2: Previous chapter summary
    if (currentChapter && currentChapter > 1) {
      const prev = ctx.summaries.find(s => s.chapterNumber === currentChapter - 1);
      if (prev) {
        slots.push({
          label: 'Previous Chapter',
          content: `## Previous Chapter: ${prev.title}\n${prev.summary}\n\n**Where things stand:** ${prev.endingState}`,
          priority: 2,
        });
      }
    }

    // P3: Key characters (with state changes for continuity)
    const characters = ctx.entities.filter(e => e.type === 'character');
    if (characters.length > 0) {
      const charBlock = characters.map(c => {
        const attrs = Object.entries(c.attributes).map(([k, v]) => `${k}: ${v}`).join(', ');
        let line = `- **${c.name}**: ${c.description}${attrs ? ` (${attrs})` : ''}`;

        // Include recent state changes so the Writer knows current character state
        if (c.changes && c.changes.length > 0) {
          const recentChanges = c.changes.slice(-3); // Last 3 changes
          const changeNotes = recentChanges.map(ch => `  - ⚡ ${ch.description}`).join('\n');
          line += `\n${changeNotes}`;
        }

        // Show when character was last seen (helps avoid placing absent characters)
        if (c.lastSeen && c.lastSeen !== 'auto-extracted' && currentChapter) {
          line += ` [last seen: ${c.lastSeen}]`;
        }

        return line;
      }).join('\n');
      slots.push({
        label: 'Character Profiles',
        content: `## Characters\n${charBlock}`,
        priority: 3,
      });
    }

    // P3: Key locations (with state changes)
    const locations = ctx.entities.filter(e => e.type === 'location');
    if (locations.length > 0) {
      const locBlock = locations.map(l => {
        const attrs = Object.entries(l.attributes).map(([k, v]) => `${k}: ${v}`).join(', ');
        let line = `- **${l.name}**: ${l.description}${attrs ? ` (${attrs})` : ''}`;

        // Include location state changes (e.g., "building collapsed in Ch7")
        if (l.changes && l.changes.length > 0) {
          const recentChanges = l.changes.slice(-2);
          const changeNotes = recentChanges.map(ch => `  - ⚡ ${ch.description}`).join('\n');
          line += `\n${changeNotes}`;
        }

        return line;
      }).join('\n');
      slots.push({
        label: 'Locations',
        content: `## Locations\n${locBlock}`,
        priority: 3,
      });
    }

    // P4: Tracked items/objects (weapons, documents, MacGuffins)
    const items = ctx.entities.filter(e => e.type === 'item' || e.type === 'object');
    if (items.length > 0) {
      const itemBlock = items.map(i => {
        const attrs = Object.entries(i.attributes).map(([k, v]) => `${k}: ${v}`).join(', ');
        return `- **${i.name}**: ${i.description}${attrs ? ` (${attrs})` : ''}`;
      }).join('\n');
      slots.push({
        label: 'Key Items',
        content: `## Key Items & Objects\n${itemBlock}`,
        priority: 4,
      });
    }

    // P4: Active plot threads from recent chapters
    const recentSummaries = ctx.summaries.slice(-3);
    if (recentSummaries.length > 0) {
      const threads = new Set<string>();
      for (const s of recentSummaries) {
        for (const t of s.plotThreads) threads.add(t);
      }
      if (threads.size > 0) {
        slots.push({
          label: 'Active Plot Threads',
          content: `## Active Plot Threads\n${Array.from(threads).map(t => `- ${t}`).join('\n')}`,
          priority: 4,
        });
      }
    }

    // P4: Timeline position
    if (ctx.summaries.length > 0) {
      const last = ctx.summaries[ctx.summaries.length - 1];
      if (last.timelineMarker) {
        slots.push({
          label: 'Timeline',
          content: `## Timeline\nLast known position: ${last.timelineMarker}`,
          priority: 4,
        });
      }
    }

    return slots;
  }

  /** Brief "where things stand" summary for dashboard. */
  getBriefSummary(projectId: string): string {
    const ctx = this.contexts.get(projectId);
    if (!ctx || ctx.summaries.length === 0) return '';
    const last = ctx.summaries[ctx.summaries.length - 1];
    const text = last.endingState || last.summary;
    return text.length > 200 ? text.substring(0, 197) + '...' : text;
  }

  /**
   * Purge Ghost Data
   * Sweeps the memory store for any records not belonging to an active project.
   */
  purgeGhostData(activeIds: Set<string>): number {
    return this.memoryStore.purgeGhostData(activeIds);
  }
}
