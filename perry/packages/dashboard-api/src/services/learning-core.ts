/**
 * LearningCore — framework-wide self-learning observer.
 *
 * This is the load-bearing service for "every component learns by default."
 * Any agent or service emits one of the standardised EventBus events:
 *
 *   learning:success      — "task X succeeded"
 *   learning:failure      — "task X failed with error Y"
 *   learning:observation  — "I noticed X happened to N"
 *   learning:duration     — "task X took N ms"
 *
 * LearningCore subscribes to all of them. For each event it computes a
 * stable state key from `(source, kind, fingerprint)` and accumulates a
 * counter in the meta table. When the counter crosses a threshold (default
 * 3 — overridable per kind), LearningCore calls SkillProposer with an
 * auto-rendered skill description so the operator can review.
 *
 * This replaces the previous per-service producer wiring (director_fail_
 * pattern_*, audit_leak_pattern_*, promptbuilder_rag_outcome_*, etc.). The
 * services now just EMIT events; LearningCore does the bookkeeping.
 *
 * Adding a new domain (e.g. hacking.recon agents): emit a learning:*
 * event from anywhere in the new domain's code path. Skills will start
 * proposing automatically, surfaced in the dashboard's Self-Learning tab,
 * filtered by service = the source you used in the emit.
 *
 * Storage layout (single source of truth):
 *
 *   meta['learning_state']        = JSON of all current observation
 *                                   counters. One file's worth of state
 *                                   for the entire system. Easy to inspect.
 *
 * Why one big JSON blob instead of one row per state? Reads dominate
 * (every /api/learning/state hit walks all states). One blob = one query.
 * Writes are infrequent enough (per-event) that the read-modify-write
 * cost is irrelevant.
 */

import type { EventBus, Logger, SkillProposer } from '@perry/core';
import type { StateStore } from '@perry/projects';

const META_KEY = 'learning_state';

/** Per (source, kind, fingerprint) state. */
interface LearningEntry {
  source: string;
  kind: string;
  fingerprint: string;
  /** Total observations of this fingerprint. Drives threshold + display. */
  count: number;
  /** Failures only — for kinds where success/failure split matters. */
  failures: number;
  /** Successes only. */
  successes: number;
  /** Most-recent durationMs if any duration event landed here. */
  lastDurationMs?: number;
  /** Last error string when failures > 0. */
  lastError?: string;
  /** Last metadata block — folded into the skill body when threshold fires. */
  lastMetadata?: Record<string, any>;
  firstSeen: string;
  lastSeen: string;
  /** Set true once SkillProposer fired for this (source, kind, fingerprint). */
  proposed: boolean;
}

/** Map source+kind → custom threshold. Default = 3. */
const KIND_THRESHOLDS: Record<string, number> = {
  // Prompt-builder: misses are cheap to count and 5 is the historical bar
  // we set before this refactor — keep parity so behaviour is unchanged.
  'prompt-builder::rag-miss': 5,
  // Director step failures: 3 is enough signal that something is recurring.
  'director::step-fail': 3,
  // GC dir growth: 3 consecutive sweeps with doubling is the bar.
  'gc::dir-growth': 3,
  // Audit recurring tags: same bar.
  'audit::leak-pattern': 3,
  // Scout: lower bar — exhausted queries should be rare and worth surfacing fast.
  'scout::query-exhausted': 3,
  // Agent invocation failures (any domain): 3 same-fingerprint fails = "this kind of input is poison."
  '*::agent-invocation-fail': 3,
};

function thresholdFor(source: string, kind: string): number {
  return KIND_THRESHOLDS[`${source}::${kind}`]
    ?? KIND_THRESHOLDS[`*::${kind}`]
    ?? 3;
}

/**
 * Per-kind opt-in for proposing skills. The default policy (see
 * `shouldPropose` below) says "propose only when there's signal" —
 * failures, or pure observations that aren't success counters. These
 * explicit overrides cover edge cases that the default heuristic would
 * mishandle.
 */
const KIND_PROPOSES_EXPLICIT: Record<string, boolean> = {
  // Visibility-only success counters — useful for dashboard activity but
  // a stream of "step-complete observed 3x" skills would be pure noise.
  'director::step-complete': false,
  'prompt-builder::rag-hit': false,
  // Agent-invocation SUCCESS events (from AgentLearningBridge) — same
  // reasoning. Hand-waving "the director ran 3 times successfully" is not
  // a learnable pattern. The matching FAIL variant DOES propose.
  '*::agent-invocation': false,
  '*::agent-invocation-duration': false,
};

/** Stable hash for fingerprints. Stays inside the file — callers pass raw strings. */
function shortHash(s: string): string {
  // crypto.createHash imported lazily so this module doesn't pull node:crypto
  // into bundles that don't need it (no consumer-side use).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const c = require('crypto');
  return c.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
}

function entryKey(source: string, kind: string, fingerprint: string): string {
  return `${source}::${kind}::${fingerprint}`;
}

export class LearningCore {
  private state: Record<string, LearningEntry> = {};
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private eventBus: EventBus,
    private stateStore: StateStore,
    private skillProposer: SkillProposer,
    private log: Logger,
  ) {
    this.loadState();
    this.subscribe();
    // Throttled persistence — write at most every 5s. Avoids hammering the
    // meta table on burst events (e.g. a chapter write firing 20 RAG queries).
    this.flushTimer = setInterval(() => this.flush(), 5_000);
  }

  /** Stop the persistence timer + flush any pending state. Used on shutdown. */
  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.flush();
  }

  /** Snapshot for /api/learning/state. Cheap — returns the in-memory cache. */
  snapshot(): { entries: LearningEntry[]; sources: Array<{ source: string; observations: number; max_count: number; ready_to_fire: number; threshold_min: number }> } {
    const entries = Object.values(this.state);
    // Aggregate per-source for the Learning Activity strip.
    const bySource = new Map<string, LearningEntry[]>();
    for (const e of entries) {
      if (!bySource.has(e.source)) bySource.set(e.source, []);
      bySource.get(e.source)!.push(e);
    }
    const sources = Array.from(bySource.entries()).map(([source, es]) => {
      const thresholds = new Set(es.map(e => thresholdFor(e.source, e.kind)));
      const maxCount = es.reduce((m, e) => Math.max(m, e.count), 0);
      const minThreshold = Math.min(...thresholds);
      const readyToFire = es.filter(e => !e.proposed && e.count === thresholdFor(e.source, e.kind) - 1).length;
      return {
        source,
        observations: es.length,
        max_count: maxCount,
        ready_to_fire: readyToFire,
        threshold_min: minThreshold,
      };
    });
    return { entries, sources };
  }

  // ─── EventBus wiring ───────────────────────────────────────────────────

  private subscribe(): void {
    this.eventBus.on('learning:success', (p) => this.observe(p.source, p.kind, p.fingerprint, { kind: 'success', metadata: p.metadata }));
    this.eventBus.on('learning:failure', (p) => this.observe(p.source, p.kind, p.fingerprint, { kind: 'failure', error: p.error, metadata: p.metadata }));
    this.eventBus.on('learning:observation', (p) => this.observe(p.source, p.kind, p.fingerprint, { kind: 'observation', value: p.value, metadata: p.metadata }));
    this.eventBus.on('learning:duration', (p) => this.observe(p.source, p.kind, p.fingerprint, { kind: 'duration', durationMs: p.durationMs, metadata: p.metadata }));
  }

  // ─── Core: observe + maybe propose ─────────────────────────────────────

  private observe(source: string, kind: string, rawFingerprint: string, ev: { kind: 'success' | 'failure' | 'observation' | 'duration'; error?: string; value?: number; durationMs?: number; metadata?: Record<string, any> }): void {
    if (!source || !kind || !rawFingerprint) return;
    // Normalise the fingerprint so callers can pass long strings; we hash
    // to a stable 10-char key. The original is kept in metadata.
    const fingerprint = rawFingerprint.length > 60 ? shortHash(rawFingerprint) : rawFingerprint;
    const key = entryKey(source, kind, fingerprint);
    const now = new Date().toISOString();
    let entry = this.state[key];
    if (!entry) {
      entry = {
        source, kind, fingerprint,
        count: 0, failures: 0, successes: 0,
        firstSeen: now, lastSeen: now,
        proposed: false,
      };
      this.state[key] = entry;
    }
    entry.count += 1;
    entry.lastSeen = now;
    if (ev.kind === 'failure') {
      entry.failures += 1;
      entry.lastError = ev.error;
    }
    if (ev.kind === 'success') entry.successes += 1;
    if (ev.kind === 'duration') entry.lastDurationMs = ev.durationMs;
    if (ev.metadata) entry.lastMetadata = ev.metadata;
    this.dirty = true;

    if (!entry.proposed) {
      const threshold = thresholdFor(source, kind);
      if (entry.count >= threshold && this.shouldPropose(entry)) {
        const success = this.proposeFor(entry);
        if (success) entry.proposed = true;
      }
    }
  }

  /**
   * Gate: should this observation actually produce a SKILL, or is it
   * visibility-only? Pure-success counters (e.g. "agent X ran fine 5x",
   * "step Y completed normally", "RAG query Z hit") are valuable signals
   * for the dashboard to show "the system is working" — but they're not
   * learnable patterns and proposing skills from them is noise.
   *
   * Default policy: propose only if there's a failure signal OR the
   * observation events have no success counter at all (pure observations
   * like leak-pattern, dir-growth, rag-miss). Explicit per-kind overrides
   * via KIND_PROPOSES_EXPLICIT win.
   */
  private shouldPropose(entry: LearningEntry): boolean {
    const explicit = KIND_PROPOSES_EXPLICIT[`${entry.source}::${entry.kind}`]
      ?? KIND_PROPOSES_EXPLICIT[`*::${entry.kind}`];
    if (explicit !== undefined) return explicit;

    // Default rule: propose only when there's actionable signal.
    if (entry.failures > 0) return true;                 // failures are inherently signal
    if (entry.successes === 0 && entry.count > 0) return true; // pure observations (no success counter)
    return false;                                         // all-success → not a learnable pattern
  }

  // ─── Skill rendering ───────────────────────────────────────────────────

  private proposeFor(e: LearningEntry): boolean {
    const skillName = `${e.source}-${e.kind}-${e.fingerprint}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40);
    const body = this.renderBody(e);
    const description = this.renderDescription(e);
    const file = this.skillProposer.propose({
      name: skillName,
      description,
      service: e.source,
      body,
      appliesWhen: { kind: e.kind, fingerprint: e.fingerprint },
      evidence: {
        count: e.count,
        failures: e.failures,
        successes: e.successes,
        first_seen: e.firstSeen,
        last_seen: e.lastSeen,
        last_error: e.lastError,
        last_duration_ms: e.lastDurationMs,
        last_metadata: e.lastMetadata,
      },
    });
    if (file) {
      this.log.info('LearningCore proposed skill', { source: e.source, kind: e.kind, fingerprint: e.fingerprint, file });
      return true;
    }
    return false;
  }

  private renderDescription(e: LearningEntry): string {
    if (e.failures > 0) return `${e.source}/${e.kind}: pattern \`${e.fingerprint}\` failed ${e.failures}x`;
    if (e.lastDurationMs) return `${e.source}/${e.kind}: \`${e.fingerprint}\` observed ${e.count}x (recent ${e.lastDurationMs}ms)`;
    return `${e.source}/${e.kind}: pattern \`${e.fingerprint}\` recurred ${e.count}x`;
  }

  private renderBody(e: LearningEntry): string {
    const lines: string[] = [
      `# Recurring pattern: ${e.source}/${e.kind}`,
      '',
      '## What was observed',
      `\`${e.fingerprint}\` has been observed **${e.count}** time(s).`,
      e.failures > 0 ? `Of those, **${e.failures}** were failures, **${e.successes}** were successes.` : '',
      e.lastDurationMs ? `Most-recent duration: **${e.lastDurationMs}ms**.` : '',
      `First seen: ${e.firstSeen}` + ` · Last seen: ${e.lastSeen}.`,
      '',
    ];
    if (e.lastError) {
      lines.push('## Last error', '```', e.lastError.slice(0, 800), '```', '');
    }
    if (e.lastMetadata) {
      lines.push('## Last metadata', '```json', JSON.stringify(e.lastMetadata, null, 2).slice(0, 1200), '```', '');
    }
    lines.push(
      '## Suggested response',
      `LearningCore raised this because \`${e.source}\` saw the same \`${e.kind}\` pattern enough times to suggest it\'s a stable signal — not a one-off.`,
      'Options:',
      '- **Promote** if the pattern is real and the suggested response is correct. Promoted skills auto-load on the consumer side (where wired) or surface as documentation for operators.',
      '- **Reject** if this was noise (an outage, a debugging session, a one-time data quality issue).',
      '- **Edit** the markdown before promoting if the auto-rendered body needs tightening — your edits stick.',
      '',
      'When promoted, this skill becomes visible to any consumer reading `workspace/skills-installed/' + e.source + '/`.',
    );
    return lines.filter(l => l !== '').join('\n');
  }

  // ─── Persistence ───────────────────────────────────────────────────────

  private loadState(): void {
    try {
      const raw = this.stateStore.getMeta(META_KEY);
      if (raw) {
        this.state = JSON.parse(raw);
        this.log.info('LearningCore loaded prior state', { entries: Object.keys(this.state).length });
      }
    } catch (err: any) {
      this.log.warn('LearningCore failed to load state — starting fresh', { error: err.message });
      this.state = {};
    }
  }

  private flush(): void {
    if (!this.dirty) return;
    try {
      this.stateStore.setMeta(META_KEY, JSON.stringify(this.state));
      this.dirty = false;
    } catch (err: any) {
      this.log.warn('LearningCore flush failed (will retry)', { error: err.message });
    }
  }
}
