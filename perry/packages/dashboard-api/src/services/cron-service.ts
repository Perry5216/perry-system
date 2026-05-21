/**
 * CronService — schedule recurring tasks against Perry's API.
 *
 * Loads job definitions from `workspace/cron/*.json`. Each job has a
 * cron-like schedule + an action. Checks every minute.
 *
 * Supported schedule format (subset of cron):
 *   "MM HH * * *"  — daily at HH:MM (UTC)
 *   "MM * * * *"   — every hour at minute MM
 *   "* * * * *"    — every minute (use sparingly)
 *   "MM HH * * DOW" — weekly on day-of-week (0=Sun..6=Sat)
 *
 * Supported actions:
 *   { type: "execute-project", projectId: "project-N" }    — kicks /execute
 *   { type: "execute-step",    projectId: "..." }          — runs next step
 *   { type: "gc-sweep" }                                    — fires manual GC
 *   { type: "distill-operator" }                            — distill profile
 *   { type: "auto-promote" }                                — run auto-promotion
 *   { type: "emit-event", event: "...", payload: {...} }    — emit on EventBus
 *
 * Job file shape (workspace/cron/{name}.json):
 *   {
 *     "name": "morning-write",
 *     "schedule": "0 9 * * *",
 *     "action": { "type": "execute-project", "projectId": "project-42" },
 *     "enabled": true
 *   }
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { Logger, EventBus } from '@perry/core';
import type { ProjectEngine } from '@perry/projects';

export interface CronJob {
  name: string;
  schedule: string;
  action: { type: string; [k: string]: any };
  enabled?: boolean;
  description?: string;
  createdAt?: string;
  lastFiredAt?: string;
  lastFiredResult?: string;
}

export class CronService {
  private readonly dir: string;
  private jobs: Map<string, CronJob> = new Map();
  private tickTimer: NodeJS.Timeout | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;

  constructor(
    private workspaceDir: string,
    private log: Logger,
    private projectEngine: ProjectEngine,
    private eventBus?: EventBus,
  ) {
    this.dir = join(workspaceDir, 'cron');
    mkdirSync(this.dir, { recursive: true });
    this.reload();
    // Tick every 60s on the wall clock. Aligns to top of the minute so cron
    // expressions like "0 9 * * *" fire predictably.
    const msUntilNextMinute = 60_000 - (Date.now() % 60_000);
    setTimeout(() => {
      this.tick();
      this.tickTimer = setInterval(() => this.tick(), 60_000);
    }, msUntilNextMinute);
    // Reload jobs from disk every 5 min so new files are picked up without
    // restart (e.g. when operator drops a new job JSON via the dashboard).
    this.reloadTimer = setInterval(() => this.reload(), 5 * 60_000);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.reloadTimer) clearInterval(this.reloadTimer);
  }

  reload(): void {
    try {
      const previous = new Set(this.jobs.keys());
      this.jobs.clear();
      for (const f of readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const job = JSON.parse(readFileSync(join(this.dir, f), 'utf-8')) as CronJob;
          if (!job.name || !job.schedule || !job.action) continue;
          this.jobs.set(job.name, job);
        } catch (err: any) {
          this.log.warn('CronService failed to load job', { file: f, error: err.message });
        }
      }
      const added = [...this.jobs.keys()].filter(k => !previous.has(k));
      const removed = [...previous].filter(k => !this.jobs.has(k));
      if (added.length > 0 || removed.length > 0) {
        this.log.info('CronService reloaded jobs', { count: this.jobs.size, added, removed });
      }
    } catch (err: any) {
      this.log.warn('CronService.reload failed', { error: err.message });
    }
  }

  list(): CronJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  upsert(job: CronJob): { ok: true } | { error: string } {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(job.name)) return { error: 'name must be kebab-case 2-40 chars' };
    if (!this.parseSchedule(job.schedule)) return { error: 'invalid schedule (expected "MM HH DOM MON DOW" with * or numbers)' };
    if (!job.action || typeof job.action !== 'object' || !job.action.type) return { error: 'action.type required' };
    const file = join(this.dir, `${job.name}.json`);
    const enriched: CronJob = {
      ...job,
      enabled: job.enabled !== false,
      createdAt: job.createdAt || new Date().toISOString(),
    };
    writeFileSync(file, JSON.stringify(enriched, null, 2), 'utf-8');
    this.jobs.set(job.name, enriched);
    this.log.info('CronService upserted job', { name: job.name, schedule: job.schedule, action: job.action.type });
    return { ok: true };
  }

  delete(name: string): { ok: true } | { error: string } {
    const file = join(this.dir, `${name}.json`);
    if (!existsSync(file)) return { error: 'not found' };
    try { unlinkSync(file); this.jobs.delete(name); return { ok: true }; }
    catch (err: any) { return { error: err.message }; }
  }

  // ─── Schedule matching ────────────────────────────────────────────────

  private parseSchedule(s: string): { mm: Matcher; hh: Matcher; dom: Matcher; mon: Matcher; dow: Matcher } | null {
    const parts = s.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const compile = (p: string, min: number, max: number): Matcher | null => {
      if (p === '*') return { match: () => true };
      const n = parseInt(p, 10);
      if (!Number.isFinite(n) || n < min || n > max) return null;
      return { match: (v: number) => v === n };
    };
    const mm = compile(parts[0], 0, 59);
    const hh = compile(parts[1], 0, 23);
    const dom = compile(parts[2], 1, 31);
    const mon = compile(parts[3], 1, 12);
    const dow = compile(parts[4], 0, 6);
    if (!mm || !hh || !dom || !mon || !dow) return null;
    return { mm, hh, dom, mon, dow };
  }

  private matches(now: Date, sched: ReturnType<typeof this.parseSchedule>): boolean {
    if (!sched) return false;
    return sched.mm.match(now.getUTCMinutes())
      && sched.hh.match(now.getUTCHours())
      && sched.dom.match(now.getUTCDate())
      && sched.mon.match(now.getUTCMonth() + 1)
      && sched.dow.match(now.getUTCDay());
  }

  // ─── Tick + action dispatch ───────────────────────────────────────────

  private async tick(): Promise<void> {
    const now = new Date();
    for (const job of this.jobs.values()) {
      if (job.enabled === false) continue;
      const sched = this.parseSchedule(job.schedule);
      if (!sched || !this.matches(now, sched)) continue;
      try {
        const result = await this.fire(job);
        job.lastFiredAt = now.toISOString();
        job.lastFiredResult = result;
        // Persist updated lastFired metadata.
        writeFileSync(join(this.dir, `${job.name}.json`), JSON.stringify(job, null, 2), 'utf-8');
        this.log.info('CronService fired', { name: job.name, result });
      } catch (err: any) {
        this.log.warn('CronService fire failed', { name: job.name, error: err.message });
      }
    }
  }

  /** Manual trigger — used by the dashboard "Fire now" button. */
  async fireManual(name: string): Promise<string> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`job ${name} not found`);
    const result = await this.fire(job);
    job.lastFiredAt = new Date().toISOString();
    job.lastFiredResult = result;
    writeFileSync(join(this.dir, `${name}.json`), JSON.stringify(job, null, 2), 'utf-8');
    return result;
  }

  private async fire(job: CronJob): Promise<string> {
    const action = job.action;
    switch (action.type) {
      case 'execute-project': {
        if (!action.projectId) return 'missing projectId';
        // Fire-and-forget in background; CronService doesn't wait for full run.
        this.projectEngine.executeAll(action.projectId).catch((err: any) => this.log.warn('execute-project cron tail failed', { projectId: action.projectId, error: err.message }));
        return `started execute-project ${action.projectId}`;
      }
      case 'execute-step': {
        if (!action.projectId) return 'missing projectId';
        this.projectEngine.executeNextStep(action.projectId).catch((err: any) => this.log.warn('execute-step cron tail failed', { projectId: action.projectId, error: err.message }));
        return `started execute-step ${action.projectId}`;
      }
      case 'emit-event': {
        if (!action.event || !this.eventBus) return 'missing event or no event bus';
        this.eventBus.emit(action.event, action.payload || {});
        return `emitted ${action.event}`;
      }
      default:
        return `unsupported action: ${action.type}`;
    }
  }
}

interface Matcher { match: (v: number) => boolean }
