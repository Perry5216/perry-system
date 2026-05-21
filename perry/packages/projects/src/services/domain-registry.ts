/**
 * DomainRegistry — file-based storage for Perry's domain definitions.
 *
 * A "domain" is the task vertical Perry is being pointed at (books,
 * code-review, security-research, etc.). The platform itself is
 * domain-agnostic; domain definitions tell the dashboard which projects
 * belong where, which color/icon to render, and (for the plugin contract)
 * which dashboard panels to surface.
 *
 * Storage layout:
 *   workspace/domains/{id}.json
 *
 * `books` is the built-in default and is auto-created on first boot if
 * the file is missing. User-created domains are added via the dashboard's
 * Domains panel + POST /api/domains.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { Logger } from '@perry/core';

export interface DomainSkillRef {
  service: string;
  name: string;
}

export interface DomainDefinition {
  /** Slug identifier — lowercase-kebab. Used as the `domain` field on projects. */
  id: string;
  /** Display name (e.g. "Books", "Code Review"). */
  label: string;
  /** One-line purpose statement. */
  description: string;
  /** Hex color for badges + UI accents. */
  color: string;
  /** Icon hint (lucide icon name) — frontend resolves. */
  icon: string;
  /** Plugin contract (C): which dashboard panel keys this domain wants surfaced. */
  dashboardPanels: string[];
  /** Default installed skills the domain wants active. Each entry references
   *  a skill by service + name. Consumers can read this list when initialising
   *  domain-specific behavior. Empty array if none configured. */
  defaultSkills: DomainSkillRef[];
  /** Whether the domain is a built-in (locked from deletion). */
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

const BUILTIN_BOOKS: DomainDefinition = {
  id: 'books',
  label: 'Books',
  description: 'Novel-writing pipeline with per-pen-name fine-tuning, scout, audit, and revision.',
  color: '#22d3ee',
  icon: 'book-open',
  dashboardPanels: ['projects', 'self-learning', 'trajectories', 'analytics', 'models'],
  defaultSkills: [],
  builtin: true,
  createdAt: '2026-05-13T00:00:00.000Z',
  updatedAt: '2026-05-13T00:00:00.000Z',
};

export class DomainRegistry {
  private readonly dir: string;
  private readonly log: Logger;

  constructor(opts: { workspaceDir: string; log: Logger }) {
    this.dir = join(opts.workspaceDir, 'domains');
    this.log = opts.log;
    mkdirSync(this.dir, { recursive: true });
    this.ensureBuiltins();
  }

  private ensureBuiltins(): void {
    const booksPath = join(this.dir, 'books.json');
    if (!existsSync(booksPath)) {
      try {
        writeFileSync(booksPath, JSON.stringify(BUILTIN_BOOKS, null, 2), 'utf-8');
        this.log.info('DomainRegistry seeded built-in domain', { id: 'books' });
      } catch (err: any) {
        this.log.warn('Failed to seed builtin books domain', { error: err.message });
      }
    }
  }

  list(): DomainDefinition[] {
    try {
      return readdirSync(this.dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try { return JSON.parse(readFileSync(join(this.dir, f), 'utf-8')) as DomainDefinition; }
          catch { return null; }
        })
        .filter((d): d is DomainDefinition => d !== null)
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch {
      return [];
    }
  }

  get(id: string): DomainDefinition | null {
    const safe = this.validateId(id);
    if (!safe) return null;
    const p = join(this.dir, `${safe}.json`);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf-8')) as DomainDefinition; }
    catch { return null; }
  }

  create(input: Partial<DomainDefinition> & { id: string; label: string }): DomainDefinition | { error: string } {
    const id = this.validateId(input.id);
    if (!id) return { error: 'id must be kebab-case (3-32 chars, lowercase a-z 0-9 -)' };
    if (input.label.length < 2 || input.label.length > 60) return { error: 'label must be 2-60 chars' };
    if (this.get(id)) return { error: `domain "${id}" already exists` };

    const now = new Date().toISOString();
    const def: DomainDefinition = {
      id,
      label: input.label,
      description: input.description ?? '',
      color: input.color ?? '#a855f7',
      icon: input.icon ?? 'sparkles',
      dashboardPanels: input.dashboardPanels && input.dashboardPanels.length > 0
        ? input.dashboardPanels
        : ['projects', 'self-learning', 'trajectories'],
      defaultSkills: Array.isArray(input.defaultSkills) ? input.defaultSkills : [],
      builtin: false,
      createdAt: now,
      updatedAt: now,
    };
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(def, null, 2), 'utf-8');
    this.log.info('DomainRegistry created domain', { id, label: def.label });
    return def;
  }

  update(id: string, patch: Partial<DomainDefinition>): DomainDefinition | { error: string } {
    const existing = this.get(id);
    if (!existing) return { error: `domain "${id}" not found` };
    if (existing.builtin && patch.id && patch.id !== id) return { error: 'cannot rename builtin domain' };

    const merged: DomainDefinition = {
      ...existing,
      ...patch,
      id: existing.id,           // immutable
      builtin: existing.builtin, // immutable
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
  }

  delete(id: string): { ok: true } | { error: string } {
    const existing = this.get(id);
    if (!existing) return { error: `domain "${id}" not found` };
    if (existing.builtin) return { error: `cannot delete builtin domain "${id}"` };
    try {
      unlinkSync(join(this.dir, `${id}.json`));
      this.log.info('DomainRegistry deleted domain', { id });
      return { ok: true };
    } catch (err: any) {
      return { error: `delete failed: ${err.message}` };
    }
  }

  private validateId(raw: string): string | null {
    const clean = (raw ?? '').toLowerCase().trim();
    if (!/^[a-z][a-z0-9-]{2,31}$/.test(clean)) return null;
    return clean;
  }
}
