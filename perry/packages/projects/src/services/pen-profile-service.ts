/**
 * PenProfileService — generates stable per-pen identity files.
 *
 * For each pen, writes two small markdown files into
 *   {workspaceDir}/pens/{slug}/SOUL.md      — durable identity / voice signature
 *   {workspaceDir}/pens/{slug}/LESSONS.md   — audit-derived "what to avoid" rules
 *
 * Together they replace the inline pen-anti-patterns slot that PromptBuilder
 * used to construct fresh for every step. By the audit cycle these files
 * have settled into the pen's signal — re-rendering the same content per
 * prompt is wasted compute + tokens.
 *
 * Generation is triggered by:
 *   • AuditService at the end of a passing audit (priorityTags just changed)
 *   • A dashboard "Refresh pen profile" action
 *   • The 6h GarbageCollector sweep (idempotent catch-up)
 *
 * Read path: PromptBuilder loads {workspaceDir}/pens/{slug}/SOUL.md +
 * LESSONS.md when it's about to add the pen-context slots. If the files
 * don't exist (new pen / never audited) it falls back to building anti-
 * patterns from raw pen data in-place — same as before. So this is
 * additive and safe to roll out.
 *
 * Design rules:
 *   • SOUL.md must stay under ~400 tokens. It goes into EVERY chapter prompt.
 *   • LESSONS.md must stay under ~300 tokens. Same.
 *   • Both files are regenerated, not edited — the source of truth is
 *     pen_names.data + audit-vN.md report files. No round-tripping.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Logger } from '@perry/core';
import type { StateStore, PenNameRow } from '../state-store.js';

const MAX_SOUL_HARD_PROHIBITIONS = 5;
const MAX_LESSONS_ENTRIES = 12;

export interface PenProfile {
  slug: string;
  soulPath: string;
  lessonsPath: string;
  soulBytes: number;
  lessonsBytes: number;
}

export class PenProfileService {
  constructor(
    private stateStore: StateStore,
    private workspaceDir: string,
    private log: Logger,
  ) {}

  private dirFor(slug: string): string {
    return join(this.workspaceDir, 'pens', slug);
  }

  paths(slug: string): { soul: string; lessons: string } {
    const dir = this.dirFor(slug);
    return { soul: join(dir, 'SOUL.md'), lessons: join(dir, 'LESSONS.md') };
  }

  /**
   * Read the profile files for a pen. Returns nulls when missing so the
   * PromptBuilder can fall back to inline construction without throwing.
   */
  async load(slug: string): Promise<{ soul: string | null; lessons: string | null }> {
    const p = this.paths(slug);
    const tryRead = async (path: string): Promise<string | null> => {
      if (!existsSync(path)) return null;
      try {
        return (await readFile(path, 'utf-8')).trim() || null;
      } catch {
        return null;
      }
    };
    const [soul, lessons] = await Promise.all([tryRead(p.soul), tryRead(p.lessons)]);
    return { soul, lessons };
  }

  /**
   * Regenerate SOUL.md and LESSONS.md for one pen. Idempotent.
   */
  async generate(slug: string): Promise<PenProfile | null> {
    const pen = this.stateStore.getPenName(slug);
    if (!pen) {
      this.log.warn('pen-profile generate: pen not found', { slug });
      return null;
    }

    const dir = this.dirFor(slug);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    const soulBody = this.renderSoul(pen);
    const lessonsBody = this.renderLessons(pen);

    const p = this.paths(slug);
    await Promise.all([
      writeFile(p.soul, soulBody, 'utf-8'),
      writeFile(p.lessons, lessonsBody, 'utf-8'),
    ]);

    this.log.info('pen-profile written', {
      slug,
      soulBytes: soulBody.length,
      lessonsBytes: lessonsBody.length,
    });

    return {
      slug,
      soulPath: p.soul,
      lessonsPath: p.lessons,
      soulBytes: soulBody.length,
      lessonsBytes: lessonsBody.length,
    };
  }

  /**
   * Write a hand-edited SOUL.md / LESSONS.md from the dashboard. Lets the
   * operator tune voice or correct an audit-derived lesson without going
   * through the full regen cycle. `generate()` will overwrite this on the
   * next audit unless the user freezes the files (TODO: freeze flag).
   *
   * Either body may be null/undefined to skip writing that file.
   */
  async writeManual(slug: string, opts: { soul?: string | null; lessons?: string | null }): Promise<PenProfile | null> {
    const pen = this.stateStore.getPenName(slug);
    if (!pen) {
      this.log.warn('pen-profile writeManual: pen not found', { slug });
      return null;
    }
    const dir = this.dirFor(slug);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const p = this.paths(slug);
    const writes: Promise<any>[] = [];
    if (typeof opts.soul === 'string') writes.push(writeFile(p.soul, opts.soul, 'utf-8'));
    if (typeof opts.lessons === 'string') writes.push(writeFile(p.lessons, opts.lessons, 'utf-8'));
    await Promise.all(writes);
    this.log.info('pen-profile manually edited', {
      slug,
      soulBytes: typeof opts.soul === 'string' ? opts.soul.length : 'unchanged',
      lessonsBytes: typeof opts.lessons === 'string' ? opts.lessons.length : 'unchanged',
    });
    const reread = await this.load(slug);
    return {
      slug,
      soulPath: p.soul,
      lessonsPath: p.lessons,
      soulBytes: reread.soul?.length ?? 0,
      lessonsBytes: reread.lessons?.length ?? 0,
    };
  }

  /** Regenerate every pen. Used by the GC sweep. */
  async generateAll(): Promise<PenProfile[]> {
    const pens = this.stateStore.getPenNames();
    const out: PenProfile[] = [];
    for (const p of pens) {
      const result = await this.generate(p.slug).catch((err: any) => {
        this.log.warn('pen-profile generateAll failed for one pen', { slug: p.slug, error: err.message });
        return null;
      });
      if (result) out.push(result);
    }
    return out;
  }

  // ── Renderers ───────────────────────────────────────────────────────

  private renderSoul(pen: PenNameRow): string {
    const lines: string[] = [];
    const display = pen.displayName || pen.slug;
    const genre = pen.genreOrSeries || 'fiction';
    lines.push(`# ${display} — ${genre}`);
    lines.push('');

    if (pen.voiceTagline) {
      lines.push(`## Voice`);
      lines.push(pen.voiceTagline.trim());
      lines.push('');
    }

    // Voice principles — distilled, user-curated. Stored on data.voicePrinciples
    // as a string[] when the dashboard pen-editor saves them.
    const principles: string[] = Array.isArray(pen.raw?.voicePrinciples)
      ? (pen.raw.voicePrinciples as any[]).filter(p => typeof p === 'string')
      : [];
    if (principles.length > 0) {
      lines.push(`## Voice Principles`);
      for (const p of principles.slice(0, 6)) lines.push(`- ${p.trim()}`);
      lines.push('');
    }

    // POV / tense defaults — let the writer assume these unless overridden
    // by a per-step directive. Saves a tiny line in every prompt.
    const pov = (pen.raw?.defaultPov || pen.raw?.pov || 'close 3rd').toString();
    const tense = (pen.raw?.tense || pen.raw?.defaultTense || 'past').toString();
    lines.push(`## Defaults`);
    lines.push(`- POV: ${pov}`);
    lines.push(`- Tense: ${tense}`);
    lines.push('');

    // Top hard prohibitions from antiPatterns — the curated never-do list.
    // We keep this short; the long version lives in LESSONS.md.
    const antiPatterns: string[] = Array.isArray(pen.raw?.antiPatterns)
      ? (pen.raw.antiPatterns as any[]).filter(p => typeof p === 'string')
      : [];
    if (antiPatterns.length > 0) {
      lines.push(`## Hard Prohibitions`);
      for (const p of antiPatterns.slice(0, MAX_SOUL_HARD_PROHIBITIONS)) {
        lines.push(`- ${p.trim()}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private renderLessons(pen: PenNameRow): string {
    const lines: string[] = [];
    const display = pen.displayName || pen.slug;
    lines.push(`# ${display} — Audit Lessons`);
    lines.push('');
    lines.push(`_Compiled from audit history. Avoid these patterns — each was flagged repeatedly during post-LoRA audits._`);
    lines.push('');

    // priorityTags is the cumulative leak summary written by AuditService
    // after each calibration pass — { tag, count, affectedPrompts, observedAt }
    const priorityTags: Array<{ tag: string; count: number; affectedPrompts: number; observedAt?: string }> =
      Array.isArray(pen.raw?.priorityTags) ? pen.raw.priorityTags : [];

    if (priorityTags.length === 0) {
      lines.push('_No audit failures recorded yet. This pen has not been calibrated, or all recent audits passed cleanly._');
      return lines.join('\n');
    }

    // Sort by count descending, take top N.
    const sorted = [...priorityTags]
      .filter(p => p && p.tag)
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, MAX_LESSONS_ENTRIES);

    for (const p of sorted) {
      lines.push(`- AVOID \`${p.tag}\` — ${p.count} hit(s) across ${p.affectedPrompts} prompt(s)`);
    }

    return lines.join('\n');
  }
}
