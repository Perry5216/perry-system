/**
 * DomainRegistry — file-based storage for Perry's domain definitions.
 *
 * A "domain" is the task vertical Perry is being pointed at (code,
 * email, hacking, etc.). The platform itself is
 * domain-agnostic; domain definitions tell the dashboard which projects
 * belong where, which color/icon to render, and (for the plugin contract)
 * which dashboard panels to surface.
 *
 * Storage layout:
 *   workspace/domains/{id}.json
 *
 * `code` is the built-in default and is auto-created on first boot if
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
  /** Display name (e.g. "Code", "Email"). */
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
  /** Allowed MCP servers for this domain. If empty, no MCP servers are allowed.
   *  If undefined/null, all MCP servers are allowed (legacy behavior). */
  allowedMcpServers?: string[];
  /** Selected base model for LLM operations in this domain. */
  baseModel?: string;
  /** Model parameters configuration override for this domain. */
  modelParameters?: {
    temperature?: number;
    maxTokens?: number;
    repeatPenalty?: number;
    topP?: number;
    topK?: number;
  };
  /** Whether the domain is a built-in (locked from deletion). */
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

const BUILTIN_CODE: DomainDefinition = {
  id: 'code',
  label: 'Code',
  description: 'Software development pipeline with code review, architecting, and implementation.',
  color: '#3b82f6',
  icon: 'code',
  dashboardPanels: ['projects', 'self-learning', 'trajectories', 'analytics', 'models'],
  defaultSkills: [],
  baseModel: 'workers',
  builtin: true,
  createdAt: '2026-05-13T00:00:00.000Z',
  updatedAt: '2026-05-13T00:00:00.000Z',
};

const BUILTIN_BOOKS: DomainDefinition = {
  id: 'books',
  label: 'Books',
  description: 'Novel-writing pipeline with per-pen-name fine-tuning, scout, audit, and revision.',
  color: '#22d3ee',
  icon: 'book-open',
  dashboardPanels: ['projects', 'self-learning', 'trajectories', 'analytics', 'models'],
  defaultSkills: [],
  baseModel: 'workers',
  builtin: true,
  createdAt: '2026-05-13T00:00:00.000Z',
  updatedAt: '2026-05-13T00:00:00.000Z',
};

const BUILTIN_DND: DomainDefinition = {
  id: 'dnd',
  label: 'D&D',
  description: 'D&D campaign planning, session preparation, and character design.',
  color: '#ef4444',
  icon: 'swords',
  dashboardPanels: ['projects', 'self-learning', 'trajectories'],
  defaultSkills: [],
  baseModel: 'workers',
  builtin: true,
  createdAt: '2026-05-13T00:00:00.000Z',
  updatedAt: '2026-05-13T00:00:00.000Z',
};

const BUILTIN_META: DomainDefinition = {
  id: 'meta',
  label: 'Meta',
  description: 'Meta/admin domain dedicated to system evolution and generating project templates.',
  color: '#e2e8f0',
  icon: 'settings',
  dashboardPanels: ['projects', 'self-learning', 'trajectories'],
  defaultSkills: [],
  baseModel: 'workers',
  builtin: true,
  createdAt: '2026-05-13T00:00:00.000Z',
  updatedAt: '2026-05-13T00:00:00.000Z',
};

const BUILTIN_EMAIL: DomainDefinition = {
  id: 'email',
  label: 'Email',
  description: 'Email reading, drafting, filtering, and reply-chain planning.',
  color: '#06b6d4',
  icon: 'mail',
  dashboardPanels: ['projects', 'self-learning', 'trajectories'],
  defaultSkills: [],
  baseModel: 'workers',
  builtin: true,
  createdAt: '2026-05-13T00:00:00.000Z',
  updatedAt: '2026-05-13T00:00:00.000Z',
};

const BUILTIN_HACKING: DomainDefinition = {
  id: 'hacking',
  label: 'Hacking',
  description: 'Security audits, penetration testing, vulnerability reporting, and recon.',
  color: '#a855f7',
  icon: 'terminal',
  dashboardPanels: ['projects', 'self-learning', 'trajectories'],
  defaultSkills: [],
  baseModel: 'workers',
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
    const seed = (def: DomainDefinition) => {
      const p = join(this.dir, `${def.id}.json`);
      if (!existsSync(p)) {
        try {
          writeFileSync(p, JSON.stringify(def, null, 2), 'utf-8');
          this.log.info('DomainRegistry seeded built-in domain', { id: def.id });
        } catch (err: any) {
          this.log.warn(`Failed to seed builtin ${def.id} domain`, { error: err.message });
        }
      }
    };

    seed(BUILTIN_CODE);
    seed(BUILTIN_BOOKS);
    seed(BUILTIN_DND);
    seed(BUILTIN_META);
    seed(BUILTIN_EMAIL);
    seed(BUILTIN_HACKING);
  }

  list(): DomainDefinition[] {
    try {
      return readdirSync(this.dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            const d = JSON.parse(readFileSync(join(this.dir, f), 'utf-8')) as DomainDefinition;
            if (d && !d.baseModel) d.baseModel = 'workers';
            return d;
          }
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
    try {
      const d = JSON.parse(readFileSync(p, 'utf-8')) as DomainDefinition;
      if (d && !d.baseModel) d.baseModel = 'workers';
      return d;
    }
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
      allowedMcpServers: Array.isArray(input.allowedMcpServers) ? input.allowedMcpServers : undefined,
      baseModel: input.baseModel ?? 'workers',
      modelParameters: input.modelParameters,
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

    if ('allowedMcpServers' in patch) {
      if (patch.allowedMcpServers === null || patch.allowedMcpServers === undefined) {
        delete merged.allowedMcpServers;
      } else if (Array.isArray(patch.allowedMcpServers)) {
        merged.allowedMcpServers = patch.allowedMcpServers;
      }
    }

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
