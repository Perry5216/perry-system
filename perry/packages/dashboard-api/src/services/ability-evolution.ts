/**
 * AbilityEvolution — the spine of "Perry evolves with the user."
 *
 * One service, five capabilities:
 *   B. Ability scoring        — counts ability-applied events per (service, name)
 *   A. Auto-promotion          — verified-patterns crossing a stricter threshold
 *                                are auto-promoted to installed abilities
 *   D. Evolution log           — append-only JSONL of every evolution event
 *                                (ability applied, promoted, demoted, retired)
 *   C. Cross-domain transfer   — derived from scores: suggest high-confidence
 *                                abilities from other domains
 *   E. Suggestion engine       — surface trajectory-abilities + verified-patterns
 *                                matching current context as installable
 *                                candidates
 *
 * Storage:
 *   workspace/ability-scores.json     — { "service::name": { applied, lastSeen } }
 *   workspace/evolution-log.jsonl     — one JSON event per line, append-only
 *   workspace/abilities-installed/{svc}/ — read for installed inventory
 *   workspace/verified-patterns/{svc}.md — read by auto-promoter
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Logger, EventBus } from '@perry/core';
import type { StateStore } from '@perry/projects';
import { AbilityOptimizerService } from '@perry/projects';
import type { AIRouter } from '@perry/ai';

const SCORES_FILE = 'ability-scores.json';
const EVOLUTION_LOG = 'evolution-log.jsonl';
const AUTO_PROMOTE_MIN_RECURRENCE = 10;   // verified-pattern count required
const AUTO_PROMOTE_MIN_AGE_HOURS = 1;     // wait at least 1h since first-seen
const EVOLUTION_LOG_MAX_LINES = 5000;

export interface AbilityScore {
  service: string;
  name: string;
  applied: number;
  lastSeen: string;
  metadata?: Record<string, any>;
}

export interface EvolutionEvent {
  ts: string;
  kind: 'ability-applied' | 'ability-promoted' | 'ability-auto-promoted' | 'ability-created' | 'ability-deleted' | 'verified-pattern' | 'pattern-retired';
  service?: string;
  name?: string;
  source?: string;
  metadata?: Record<string, any>;
}

export interface SuggestedAbility {
  service: string;
  name: string;
  description: string;
  reason: string;
  signal: { kind: string; value: number };
}

export class AbilityEvolution {
  private scores: Record<string, AbilityScore> = {};
  private readonly scoresPath: string;
  private readonly evolutionPath: string;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private autoPromoteTimer: NodeJS.Timeout | null = null;
  private lastOptimizedAt: Map<string, number> = new Map();

  constructor(
    private workspaceDir: string,
    private log: Logger,
    private eventBus?: EventBus,
    private stateStore?: StateStore,
    private aiRouter?: AIRouter,
  ) {
    this.scoresPath = join(workspaceDir, SCORES_FILE);
    this.evolutionPath = join(workspaceDir, EVOLUTION_LOG);
    this.loadScores();
    this.subscribe();

    // Persist scores every 5s (batched).
    this.flushTimer = setInterval(() => this.flush(), 5_000);
    // Auto-promote pass every 5 minutes.
    this.autoPromoteTimer = setInterval(() => { void this.runAutoPromotionPass(); }, 5 * 60_000);
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.autoPromoteTimer) clearInterval(this.autoPromoteTimer);
    this.flush();
  }

  private subscribe(): void {
    if (!this.eventBus) return;
    // Ability-applied events flow from each consumer (audit, gc, director, …)
    // via learning:observation with kind === 'ability-applied'. Recordable
    // signal that drives both B (scoring) and D (evolution log).
    this.eventBus.on('learning:observation', (p: any) => {
      if (p?.kind === 'ability-applied' && p?.metadata?.ability) {
        this.recordAbilityApplied(p.source, p.metadata.ability, p.metadata);
      }
    });

    this.eventBus.on('ability:execution', (p: { service: string; name: string; success: boolean; durationMs: number; error: string | null }) => {
      void this.handleAbilityExecution(p);
    });
  }

  private async handleAbilityExecution(p: { service: string; name: string; success: boolean; durationMs: number; error: string | null }): Promise<void> {
    if (!this.stateStore || !this.aiRouter) {
      return;
    }
    const { service, name, success } = p;
    const key = `${service}::${name}`;
    const now = Date.now();
    const lastOptimized = this.lastOptimizedAt.get(key) || 0;

    // Throttle checks
    if (!success) {
      // Failure: optimize immediately, debounced by 60s
      if (now - lastOptimized < 60_000) {
        this.log.debug('Skipping auto-evolution optimization on failure (throttled)', { service, name });
        return;
      }
    } else {
      // Success: optimize periodically, debounced by 10 mins (600,000 ms)
      if (now - lastOptimized < 600_000) {
        return;
      }
    }

    this.lastOptimizedAt.set(key, now);
    this.log.info('Triggering background ability auto-evolution', { service, name, success });

    // Run optimization asynchronously in the background so it doesn't block the execution pipeline.
    setTimeout(async () => {
      try {
        const optimizer = new AbilityOptimizerService(this.workspaceDir, this.stateStore!, this.aiRouter!, this.log);
        const result = await optimizer.runOptimization(service, name);
        if (result.success) {
          this.log.info('Background ability auto-evolution succeeded and staged a proposal', { service, name, proposalId: result.proposalId });
        } else {
          this.log.info('Background ability auto-evolution completed without new proposals', { service, name, reason: result.reason });
        }
      } catch (err: any) {
        this.log.error('Background ability auto-evolution failed', { service, name, error: err.message });
      }
    }, 0);
  }

  // ─── B. Scoring ────────────────────────────────────────────────────────

  recordAbilityApplied(service: string, name: string, metadata?: Record<string, any>): void {
    const key = `${service}::${name}`;
    const now = new Date().toISOString();
    if (!this.scores[key]) {
      this.scores[key] = { service, name, applied: 0, lastSeen: now };
    }
    this.scores[key].applied += 1;
    this.scores[key].lastSeen = now;
    if (metadata) this.scores[key].metadata = metadata;
    this.dirty = true;
    this.recordEvolutionEvent({
      ts: now,
      kind: 'ability-applied',
      service,
      name,
      metadata,
    });
  }

  getScore(service: string, name: string): AbilityScore | null {
    return this.scores[`${service}::${name}`] || null;
  }

  getAllScores(): AbilityScore[] {
    return Object.values(this.scores).sort((a, b) => b.applied - a.applied);
  }

  // ─── A. Auto-promotion ─────────────────────────────────────────────────

  /**
   * Scan workspace/verified-patterns/{source}.md files. For each entry that
   * has reached `AUTO_PROMOTE_MIN_RECURRENCE` and is at least
   * `AUTO_PROMOTE_MIN_AGE_HOURS` old, write a corresponding installed ability
   * and emit an evolution event. Idempotent — skips if the ability already
   * exists.
   */
  async runAutoPromotionPass(): Promise<{ scanned: number; promoted: number }> {
    let scanned = 0;
    let promoted = 0;
    try {
      const vpRoot = join(this.workspaceDir, 'verified-patterns');
      if (!existsSync(vpRoot)) return { scanned, promoted };
      for (const file of readdirSync(vpRoot)) {
        if (!file.endsWith('.md')) continue;
        const source = file.replace(/\.md$/, '');
        const content = readFileSync(join(vpRoot, file), 'utf-8');
        const entries = this.parseVerifiedPatternEntries(content);
        for (const e of entries) {
          scanned += 1;
          if (e.count < AUTO_PROMOTE_MIN_RECURRENCE) continue;
          if (e.failures > 0) continue;
          if (e.firstSeenAt) {
            const ageHrs = (Date.now() - new Date(e.firstSeenAt).getTime()) / 3_600_000;
            if (ageHrs < AUTO_PROMOTE_MIN_AGE_HOURS) continue;
          }
          // Build ability name. Auto-promoted abilities get an `auto-` prefix so
          // operators can tell them apart from hand-curated ones at a glance.
          const safeFp = e.fingerprint.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30);
          const abilityName = `auto-${source}-${safeFp}`.slice(0, 40);
          const abilityPath = this.installedPathFor(source, abilityName);
          if (existsSync(abilityPath)) continue; // already promoted

          const content = this.renderAutoPromotedAbility(source, e, abilityName);
          mkdirSync(join(abilityPath, '..'), { recursive: true });
          writeFileSync(abilityPath, content, 'utf-8');
          promoted += 1;
          this.recordEvolutionEvent({
            ts: new Date().toISOString(),
            kind: 'ability-auto-promoted',
            source,
            service: source,
            name: abilityName,
            metadata: { fingerprint: e.fingerprint, count: e.count, kind: e.kind },
          });
          this.log.info('Auto-promoted verified pattern to installed ability', { source, name: abilityName, count: e.count });
        }
      }
    } catch (err: any) {
      this.log.warn('Auto-promotion pass failed', { error: err.message });
    }
    return { scanned, promoted };
  }

  private parseVerifiedPatternEntries(md: string): Array<{ kind: string; fingerprint: string; count: number; failures: number; firstSeenAt: string }> {
    // Match each `## <kind> · \`<fingerprint>\`` block.
    const blocks = md.split(/\n## /).slice(1);
    const out: Array<{ kind: string; fingerprint: string; count: number; failures: number; firstSeenAt: string }> = [];
    for (const b of blocks) {
      const header = b.split('\n', 1)[0];
      const m = header.match(/^(\S+)\s+·\s+`([^`]+)`/);
      if (!m) continue;
      const count = parseInt((b.match(/Recurred:\*\*\s*(\d+)/) || ['', '0'])[1], 10);
      const failures = parseInt((b.match(/Successes:\*\*\s*\d+\s*\(zero failures\)/) ? '0' : (b.match(/Failures:\*\*\s*(\d+)/) || ['','0'])[1]), 10);
      const firstSeenAt = (b.match(/First seen:\*\*\s*(\S+)/) || ['', ''])[1];
      out.push({ kind: m[1], fingerprint: m[2], count, failures, firstSeenAt });
    }
    return out;
  }

  private installedPathFor(service: string, name: string): string {
    if (service === 'worker') return join('/app/.claude/commands', `${name}.md`);
    return join(this.workspaceDir, 'abilities-installed', service, `${name}.md`);
  }

  private renderAutoPromotedAbility(source: string, e: { kind: string; fingerprint: string; count: number; firstSeenAt: string }, name: string): string {
    const now = new Date().toISOString();
    return [
      '---',
      `name: ${name}`,
      `service: ${source}`,
      `description: Auto-promoted from a verified pattern (${e.kind}/${e.fingerprint}) that recurred ${e.count}x with zero failures.`,
      `proposed_at: ${e.firstSeenAt}`,
      `promoted_at: ${now}`,
      'proposed_by: auto-evolution',
      'status: installed',
      `applies_when:`,
      `  kind: ${JSON.stringify(e.kind)}`,
      `  fingerprint: ${JSON.stringify(e.fingerprint)}`,
      '---',
      '',
      `# Auto-promoted: ${e.kind} / \`${e.fingerprint}\``,
      '',
      `Recorded ${e.count} successful occurrences with zero failures since ${e.firstSeenAt}.`,
      `Promoted automatically by Perry's self-evolution system on ${now}.`,
      '',
      'When this pattern recurs:',
      '- Treat as a verified-good behavior — replicate the conditions / decisions that produced these successes',
      '- Demote (delete) this ability if it ever causes a failure — auto-promotion can over-trust correlation',
      '',
      '_Edit or delete this file to override auto-promotion._',
    ].join('\n');
  }

  // ─── D. Evolution log ──────────────────────────────────────────────────

  recordEvolutionEvent(ev: EvolutionEvent): void {
    try {
      appendFileSync(this.evolutionPath, JSON.stringify(ev) + '\n', 'utf-8');
      this.maybeTruncateLog();
    } catch (err: any) {
      this.log.warn('recordEvolutionEvent failed', { error: err.message });
    }
  }

  getEvolutionLog(opts: { limit?: number; since?: string } = {}): EvolutionEvent[] {
    try {
      if (!existsSync(this.evolutionPath)) return [];
      const lines = readFileSync(this.evolutionPath, 'utf-8').split('\n').filter(Boolean);
      const events: EvolutionEvent[] = [];
      for (const line of lines) {
        try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
      let filtered = events;
      if (opts.since) filtered = filtered.filter(e => e.ts >= opts.since!);
      // Most recent first.
      filtered.reverse();
      if (opts.limit) filtered = filtered.slice(0, opts.limit);
      return filtered;
    } catch {
      return [];
    }
  }

  private maybeTruncateLog(): void {
    try {
      const stats = readFileSync(this.evolutionPath, 'utf-8');
      const lines = stats.split('\n').filter(Boolean);
      if (lines.length > EVOLUTION_LOG_MAX_LINES) {
        const kept = lines.slice(-EVOLUTION_LOG_MAX_LINES).join('\n') + '\n';
        writeFileSync(this.evolutionPath, kept, 'utf-8');
      }
    } catch { /* ignore */ }
  }

  // ─── C + E. Suggestion engine ─────────────────────────────────────────

  /**
   * For domain `id`, return installed abilities that:
   *   - Are not currently in this domain's defaultAbilities (or defaultSkills)
   *   - Have a non-zero applied count
   *   - Sorted by score (descending)
   *
   * Used by the Domains panel's "Suggested for this domain" tile to surface
   * high-confidence abilities from other contexts that might benefit this one.
   */
  getTransferCandidates(opts: { excludeNames?: Array<{ service: string; name: string }>; limit?: number } = {}): SuggestedAbility[] {
    const excludeKey = new Set((opts.excludeNames || []).map(s => `${s.service}::${s.name}`));
    const scored = this.getAllScores().filter(s => s.applied > 0 && !excludeKey.has(`${s.service}::${s.name}`));
    const limit = opts.limit ?? 10;
    return scored.slice(0, limit).map(s => ({
      service: s.service,
      name: s.name,
      description: `Proven effective in another context (applied ${s.applied}x).`,
      reason: 'cross-domain-transfer',
      signal: { kind: 'applied-count', value: s.applied },
    }));
  }

  /**
   * Suggest abilities derivable from trajectory-abilities + verified-patterns that
   * AREN'T yet installed. Caller can pass a context object to bias (e.g.
   * `{ source: 'audit' }`). For now we surface any verified-patterns whose
   * `kind`/`fingerprint` doesn't already correspond to an installed ability.
   */
  getInstallableSuggestions(opts: { source?: string; limit?: number } = {}): SuggestedAbility[] {
    const limit = opts.limit ?? 10;
    const installedKeys = new Set(this.listInstalledAbilityKeys());
    const out: SuggestedAbility[] = [];
    try {
      const vpRoot = join(this.workspaceDir, 'verified-patterns');
      if (!existsSync(vpRoot)) return out;
      for (const file of readdirSync(vpRoot)) {
        if (!file.endsWith('.md')) continue;
        const source = file.replace(/\.md$/, '');
        if (opts.source && source !== opts.source) continue;
        const content = readFileSync(join(vpRoot, file), 'utf-8');
        const entries = this.parseVerifiedPatternEntries(content);
        for (const e of entries) {
          const safeFp = e.fingerprint.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30);
          const candidateName = `auto-${source}-${safeFp}`.slice(0, 40);
          const key = `${source}::${candidateName}`;
          if (installedKeys.has(key)) continue;
          out.push({
            service: source,
            name: candidateName,
            description: `${e.kind} / ${e.fingerprint} — ${e.count} successful recurrences, no failures`,
            reason: 'verified-pattern-candidate',
            signal: { kind: 'recurrence', value: e.count },
          });
          if (out.length >= limit) break;
        }
        if (out.length >= limit) break;
      }
    } catch (err: any) {
      this.log.warn('getInstallableSuggestions failed', { error: err.message });
    }
    return out;
  }

  private listInstalledAbilityKeys(): string[] {
    const out: string[] = [];
    try {
      const root = join(this.workspaceDir, 'abilities-installed');
      if (existsSync(root)) {
        for (const ent of readdirSync(root, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue;
          try {
            for (const f of readdirSync(join(root, ent.name))) {
              if (f.endsWith('.md')) out.push(`${ent.name}::${f.replace(/\.md$/, '')}`);
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
    try {
      for (const f of readdirSync('/app/.claude/commands')) {
        if (f.endsWith('.md')) out.push(`worker::${f.replace(/\.md$/, '')}`);
      }
    } catch { /* skip */ }
    return out;
  }

  // ─── Persistence ───────────────────────────────────────────────────────

  private loadScores(): void {
    try {
      if (existsSync(this.scoresPath)) {
        this.scores = JSON.parse(readFileSync(this.scoresPath, 'utf-8'));
        this.log.info('AbilityEvolution loaded scores', { count: Object.keys(this.scores).length });
      }
    } catch (err: any) {
      this.log.warn('AbilityEvolution failed to load scores', { error: err.message });
      this.scores = {};
    }
  }

  private flush(): void {
    if (!this.dirty) return;
    try {
      writeFileSync(this.scoresPath, JSON.stringify(this.scores, null, 2), 'utf-8');
      this.dirty = false;
    } catch (err: any) {
      this.log.warn('AbilityEvolution flush failed', { error: err.message });
    }
  }
}
