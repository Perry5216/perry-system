/**
 * @perry/core — TrajectoryAbilityWriter
 *
 * Companion to AbilityProposer + verified-patterns. Writes a "trajectory ability"
 * markdown file for every first-time-seen (source, kind, fingerprint) tuple
 * that flows through LearningCore. The aim: build a comprehensive record of
 * everything the system has done, browsable and mineable, without polluting
 * the curated abilities-pending queue.
 *
 * Design:
 *   - One file per unique fingerprint, written on FIRST occurrence
 *   - Lives at `workspace/trajectory-abilities/{source}/`
 *   - Each file is hand-promotable: copy to `workspace/abilities-installed/{source}/`
 *     to make it a curated ability that consumers actually load and apply
 *   - Capped per source (rolling — oldest dropped) to keep the dir manageable
 *
 * NEVER throws — best-effort, can't break the caller.
 */

import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { Logger } from './logger.js';

const DEFAULT_CAP_PER_SOURCE = 500;

export interface TrajectoryRecord {
  /** Source service emitting the event (e.g. 'director', 'audit', 'gc'). */
  source: string;
  /** Event kind (e.g. 'step-complete', 'agent-invocation', 'sweep'). */
  kind: string;
  /** Stable identifier for the action variant (e.g. 'voice_profile', 'research'). */
  fingerprint: string;
  /** When the trajectory was first observed. */
  firstSeen: string;
  /** Most-recent metadata block from the LearningCore entry. */
  metadata?: Record<string, any>;
  /** Most-recent duration if any. */
  durationMs?: number;
  /** Most-recent error if the inaugural observation was a failure. */
  error?: string;
}

export class TrajectoryAbilityWriter {
  private readonly workspaceDir: string;
  private readonly log: Logger;
  private readonly capPerSource: number;

  constructor(opts: { workspaceDir: string; log: Logger; capPerSource?: number }) {
    this.workspaceDir = opts.workspaceDir;
    this.log = opts.log;
    this.capPerSource = opts.capPerSource ?? DEFAULT_CAP_PER_SOURCE;
  }

  /**
   * Write a trajectory-ability for a first-time-seen fingerprint. Returns the
   * destination path on success, `null` on failure or skip.
   */
  write(rec: TrajectoryRecord): string | null {
    try {
      if (!/^[a-z][a-z0-9-]{1,20}$/.test(rec.source)) {
        return null;
      }
      const dir = join(this.workspaceDir, 'trajectory-abilities', rec.source);
      mkdirSync(dir, { recursive: true });

      const stamp = rec.firstSeen.replace(/[:.]/g, '-').slice(0, 19);
      const safeFingerprint = rec.fingerprint.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40);
      const filename = `${stamp}__${rec.kind}__${safeFingerprint}.md`;
      const fullPath = join(dir, filename);

      const content = this.render(rec);
      writeFileSync(fullPath, content, 'utf-8');

      // Enforce cap: drop oldest files if over.
      this.enforceCap(dir);

      return fullPath;
    } catch (err: any) {
      this.log.warn('TrajectoryAbilityWriter.write failed (non-fatal)', { source: rec.source, error: err.message });
      return null;
    }
  }

  private render(rec: TrajectoryRecord): string {
    const lines: string[] = [
      '---',
      `name: ${rec.source}-${rec.kind}-${rec.fingerprint}`.toLowerCase().replace(/[^a-z0-9-:]/g, '-').slice(0, 60),
      `source: ${rec.source}`,
      `kind: ${rec.kind}`,
      `fingerprint: ${rec.fingerprint}`,
      `first_seen: ${rec.firstSeen}`,
      'status: trajectory',
      '---',
      '',
      `# Trajectory: ${rec.source} / ${rec.kind} / \`${rec.fingerprint}\``,
      '',
      'First observation of this action variant. Hand-promote to ' +
        `\`workspace/abilities-installed/${rec.source}/\` to make it an active curated ability.`,
      '',
    ];
    if (rec.error) {
      lines.push('## Initial outcome: FAILURE', '```', rec.error.slice(0, 800), '```', '');
    } else {
      lines.push('## Initial outcome: success', '');
    }
    if (rec.durationMs) {
      lines.push(`## Duration`, `${rec.durationMs}ms on first observation`, '');
    }
    if (rec.metadata) {
      lines.push('## Metadata', '```json', JSON.stringify(rec.metadata, null, 2).slice(0, 1200), '```', '');
    }
    return lines.join('\n');
  }

  /**
   * If the source's trajectory dir exceeds the cap, delete the oldest files
   * by mtime until we're back under cap. Best-effort.
   */
  private enforceCap(dir: string): void {
    try {
      const files = readdirSync(dir)
        .filter(f => f.endsWith('.md'))
        .map(f => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime);
      const excess = files.length - this.capPerSource;
      for (let i = 0; i < excess; i++) {
        try { unlinkSync(join(dir, files[i].name)); } catch { /* skip */ }
      }
    } catch { /* dir-read failed; skip cap enforcement this round */ }
  }
}

/**
 * Read trajectory-ability files for a source. Returns metadata-only (filename,
 * size, mtime) so callers can render lists without paying for full content.
 */
export function listTrajectoryAbilities(workspaceDir: string, source: string): Array<{
  filename: string;
  bytes: number;
  mtime: string;
}> {
  const dir = join(workspaceDir, 'trajectory-abilities', source);
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const st = statSync(join(dir, f));
        return { filename: f, bytes: st.size, mtime: new Date(st.mtimeMs).toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

/**
 * List all sources that have trajectory-ability files. Used by the dashboard
 * to render the per-source counts tile.
 */
export function listTrajectorySources(workspaceDir: string): string[] {
  const root = join(workspaceDir, 'trajectory-abilities');
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
}
