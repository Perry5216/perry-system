/**
 * @perry/core — SkillProposer
 *
 * Service-internal counterpart to the worker-facing `mcp__perry__propose_skill`
 * MCP tool. Lets non-LLM services (director, audit, GC, prompt-builder)
 * propose skills directly without going through the MCP protocol.
 *
 * File format and storage layout MATCH the MCP version exactly so the
 * dashboard's per-service filter, the skills route, and the SkillLoader all
 * see identical proposals regardless of which producer emitted them.
 *
 *   workspace/skills-pending/{service}/{stamp}__{name}.md
 *
 * Throttling: a service that observes the same pattern every minute would
 * otherwise flood the queue. We track a (service, name) tuple in-memory and
 * suppress writes within DEFAULT_THROTTLE_MS. Persistence-survivable throttling
 * lives in the meta-table side (callers can stamp their own counter — this
 * module is intentionally stateless across restarts).
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Logger } from './logger.js';

const DEFAULT_THROTTLE_MS = 60 * 60 * 1000; // 1h between proposals of the same (service, name)

export interface SkillProposal {
  /** Lowercase-kebab-case, 3-40 chars. Becomes the filename + frontmatter `name`. */
  name: string;
  /** One-line summary, 10-200 chars. */
  description: string;
  /** Which subsystem this skill is for. Determines storage subdir + consumer. */
  service: string;
  /** Markdown procedure body. Min 100 chars. */
  body: string;
  /** Optional structured triggers for non-LLM consumers (e.g. `{subgenre:'cyberpunk', source:'reddit'}`). */
  appliesWhen?: Record<string, string | number | boolean>;
  /** Optional supporting data — task_ids, observed counts, source events. */
  evidence?: Record<string, unknown>;
}

export class SkillProposer {
  private readonly workspaceDir: string;
  private readonly log: Logger;
  private readonly throttleMs: number;
  private readonly lastProposed = new Map<string, number>();

  constructor(opts: { workspaceDir: string; log: Logger; throttleMs?: number }) {
    this.workspaceDir = opts.workspaceDir;
    this.log = opts.log;
    this.throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  /**
   * Write a proposal to `workspace/skills-pending/{service}/`. Returns the
   * destination path on success, `null` if throttled or already exists.
   *
   * NEVER throws — caller services should treat proposal as best-effort
   * background activity that must not break their primary work.
   */
  propose(p: SkillProposal): string | null {
    try {
      if (!/^[a-z][a-z0-9-]{2,39}$/.test(p.name)) {
        this.log.warn('skill name rejected (kebab-case, 3-40 chars)', { name: p.name, service: p.service });
        return null;
      }
      if (p.description.length < 10 || p.description.length > 200) {
        this.log.warn('skill description rejected (10-200 chars)', { length: p.description.length, service: p.service });
        return null;
      }
      if (p.body.length < 100) {
        this.log.warn('skill body rejected (<100 chars)', { length: p.body.length, name: p.name, service: p.service });
        return null;
      }
      if (!/^[a-z][a-z0-9-]{1,20}$/.test(p.service)) {
        this.log.warn('skill service rejected (kebab-case)', { service: p.service });
        return null;
      }

      // Throttle: same (service, name) can only fire once per throttle window.
      const throttleKey = `${p.service}::${p.name}`;
      const last = this.lastProposed.get(throttleKey);
      if (last && Date.now() - last < this.throttleMs) {
        return null;
      }

      const dir = join(this.workspaceDir, 'skills-pending', p.service);
      mkdirSync(dir, { recursive: true });

      // De-dup: if any pending file in this service already proposes the same
      // `name`, don't write a duplicate. Filenames are timestamp-prefixed, so
      // we have to scan rather than just check existence by name.
      try {
        const existing = readdirSync(dir).filter(f => f.endsWith('.md') && f.includes(`__${p.name}.md`));
        if (existing.length > 0) {
          this.lastProposed.set(throttleKey, Date.now());
          return null;
        }
      } catch { /* dir may not exist yet — proceed */ }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `${stamp}__${p.name}.md`;
      const fullPath = join(dir, filename);

      // Frontmatter mirrors the MCP propose_skill format exactly. applies_when
      // is serialised as nested YAML so SkillLoader (non-LLM consumers) can
      // parse it mechanically.
      let appliesBlock = '';
      if (p.appliesWhen && Object.keys(p.appliesWhen).length > 0) {
        const lines = ['applies_when:'];
        for (const [k, v] of Object.entries(p.appliesWhen)) {
          lines.push(`  ${k}: ${JSON.stringify(v)}`);
        }
        appliesBlock = lines.join('\n') + '\n';
      }
      const evidenceBlock = p.evidence
        ? `\n## Evidence\n\`\`\`json\n${JSON.stringify(p.evidence, null, 2)}\n\`\`\`\n`
        : '';
      const content =
        `---\nname: ${p.name}\nservice: ${p.service}\ndescription: ${p.description}\nproposed_at: ${new Date().toISOString()}\nproposed_by: service\nstatus: pending\n${appliesBlock}---\n\n` +
        p.body.trim() + '\n' + evidenceBlock;

      writeFileSync(fullPath, content, 'utf-8');
      this.lastProposed.set(throttleKey, Date.now());
      this.log.info('skill proposed', { service: p.service, name: p.name, path: fullPath });
      return fullPath;
    } catch (err: any) {
      this.log.warn('SkillProposer.propose failed (non-fatal)', { service: p.service, name: p.name, error: err.message });
      return null;
    }
  }

  /** Test/inspection helper — number of skills currently throttled in-memory. */
  throttledCount(): number {
    return this.lastProposed.size;
  }
}

/** Shape that any service's SkillLoader returns when reading installed skills. */
export interface LoadedSkill {
  name: string;
  description: string;
  service: string;
  appliesWhen: Record<string, string | number | boolean>;
  body: string;
  path: string;
}

/**
 * Read all installed skills for a given service from
 * `workspace/skills-installed/{service}/*.md`. Returns parsed frontmatter +
 * body for each. Used by non-LLM consumers.
 *
 * Stateless / fs-driven — re-call on a timer or via fs.watch if you want
 * hot-reload. Cheap (single dir read, small files).
 */
export function loadInstalledSkills(workspaceDir: string, service: string): LoadedSkill[] {
  const out: LoadedSkill[] = [];
  const loadedPaths = new Set<string>();

  const loadFromDir = (dir: string, svc: string) => {
    if (!existsSync(dir)) return;
    let files: string[] = [];
    try { files = readdirSync(dir).filter(f => f.endsWith('.md')); } catch { return; }
    for (const f of files) {
      const fullPath = join(dir, f);
      if (loadedPaths.has(fullPath)) continue;
      try {
        const fs = require('fs');
        const raw: string = fs.readFileSync(fullPath, 'utf-8');
        const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!m) continue;
        const block = m[1];
        const body = m[2];
        const frontmatter: Record<string, any> = {};
        const appliesWhen: Record<string, string | number | boolean> = {};
        let inApplies = false;
        for (const line of block.split('\n')) {
          if (/^applies_when:\s*$/.test(line)) { inApplies = true; continue; }
          if (inApplies) {
            const sub = line.match(/^\s{2}([a-z_][a-z0-9_]*):\s*(.*)$/i);
            if (sub) {
              let v: any = sub[2].trim();
              try { v = JSON.parse(v); } catch {}
              appliesWhen[sub[1]] = v;
              continue;
            } else {
              inApplies = false;
            }
          }
          const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
          if (kv) {
            let val = kv[2].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            frontmatter[kv[1]] = val;
          }
        }
        loadedPaths.add(fullPath);
        out.push({
          name: frontmatter.name || f.replace(/\.md$/, ''),
          description: frontmatter.description || '',
          service: frontmatter.service || svc,
          appliesWhen,
          body,
          path: fullPath,
        });
      } catch { /* skip */ }
    }
  };

  // 1. Primary: load from the requested service folder
  const primaryDir = join(workspaceDir, 'skills-installed', service);
  loadFromDir(primaryDir, service);

  // 2. Load from global service folder (if not already loaded)
  if (service !== 'global') {
    const globalDir = join(workspaceDir, 'skills-installed', 'global');
    loadFromDir(globalDir, 'global');
  }

  // 3. Fallback: Load from ALL subdirectories in skills-installed
  try {
    const root = join(workspaceDir, 'skills-installed');
    if (existsSync(root)) {
      const entries = readdirSync(root, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory() && ent.name !== service && ent.name !== 'global') {
          loadFromDir(join(root, ent.name), ent.name);
        }
      }
    }
  } catch {}

  // 4. Fallback: Load from .claude/commands (both under workspace and in system/worker)
  const claudePaths = [
    join(workspaceDir, '.claude', 'commands'),
    '/app/.claude/commands',
  ];
  for (const cp of claudePaths) {
    loadFromDir(cp, 'worker');
  }

  return out;
}
