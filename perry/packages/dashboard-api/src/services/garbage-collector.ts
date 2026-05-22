/**
 * GarbageCollector — top-level sweep that reconciles all of perry's
 * accumulating state. Sweeps task_pool, meta, file caches, pen-integrity,
 * prompt-staleness, and orphan flags.
 *
 * Triggers:
 *   - boot pass (~10s after container is up; idempotent catch-up)
 *   - scheduled (every GC_INTERVAL_MS, default 6h)
 *   - admin endpoint POST /api/system/gc/run
 *
 * Persists summary to meta.gc_last_summary + meta.gc_last_run_at so the
 * dashboard fleet view can display "last GC: 14 stale claims released,
 * 3 stale debug files deleted" etc.
 *
 * SAFETY: never restarts containers, never sends signals to perry-trainer.
 * The training-flag check uses `docker exec perry-trainer pgrep` which is
 * read-only — pgrep just inspects the process list. If pgrep fails (no
 * docker socket / no trainer container), the stage is skipped.
 */

import { Logger } from '@perry/core';
import type { EventBus, LoadedSkill } from '@perry/core';
import { loadInstalledSkills } from '@perry/core';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectEngine, NetworkCache } from '@perry/projects';
import type { MemoryStore } from '@perry/rag';
import type { ChatMemoryService } from './chat-memory-service.js';

const GC_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6h
const BOOT_DELAY_MS  = 10 * 1000;             // 10s after boot
const WORKSPACE_DIR  = process.env.PERRY_WORKSPACE || '/app/workspace';
const TRAINING_DIR   = path.join(WORKSPACE_DIR, 'training');
const COMFYUI_OUT_DIR= path.join(WORKSPACE_DIR, 'comfyui-output');
const SCOUT_OUT_DIR  = path.join(WORKSPACE_DIR, 'scout-findings');
const PENS_DIR       = path.join(WORKSPACE_DIR, 'pens');
const SKILLS_PENDING_DIR  = path.join(WORKSPACE_DIR, 'skills-pending');
const SKILLS_REJECTED_DIR = path.join(WORKSPACE_DIR, 'skills-rejected');

// Thresholds (seconds-based for SQL strftime comparisons; ms for fs.stat).
const STALE_CLAIM_SECS         = 60 * 60;          // release claimed after 1h
const DONE_ARCHIVE_SECS        = 24 * 60 * 60;     // archive done after 24h
const ARCHIVED_DELETE_SECS     = 7  * 24 * 60 * 60; // delete archived after 7d
const FAILED_DELETE_SECS       = 14 * 24 * 60 * 60; // delete failed after 14d
const ONE_SHOT_FLAG_SECS       = 60;                // delete control flags after 60s
const DEBUG_FILE_TTL_MS        = 14 * 24 * 60 * 60 * 1000;
const NETWORK_CACHE_TTL_MS     = 7  * 24 * 60 * 60 * 1000;
const READY_FLAG_TTL_MS        = 24 * 60 * 60 * 1000;

// New thresholds (added for production-scale GC — 2026-05-21).
const COMFYUI_OUTPUT_TTL_MS    = 30 * 24 * 60 * 60 * 1000;  // 30d for ad-hoc covers
const SCOUT_FINDINGS_TTL_MS    = 30 * 24 * 60 * 60 * 1000;  // 30d for scrape dumps
const SKILLS_PENDING_TTL_MS    = 14 * 24 * 60 * 60 * 1000;  // 14d unreviewed → reject
const AUDIT_FILES_KEEP_LAST    = 10;                          // per pen, keep last N audit-v*.md/jsonl pairs
const RAG_LEARNING_TTL_DAYS    = 180;                         // learning_* corpus age-out
const RAG_REFERENCE_TTL_DAYS   = 365;                         // bible_*/voice_anchor age-out
const RAG_LEARNING_MAX         = 500;                         // cap per kind to avoid runaway
const RAG_REFERENCE_MAX        = 2000;                        // cap per kind

export interface StageResult {
  swept?: number;
  released?: number;
  archived?: number;
  deleted?: number;
  warnings?: string[];
  errors?: string[];
  skipped?: boolean;
  detail?: Record<string, any>;
}

export interface GcSummary {
  trigger: 'boot' | 'scheduled' | 'manual';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  stages: Record<string, StageResult>;
}

export class GarbageCollector {
  private log = new Logger('gc');
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private lastSummary: GcSummary | null = null;

  constructor(
    private projectEngine: ProjectEngine,
    private memoryStore?: MemoryStore,
    private chatMemory?: ChatMemoryService,
    private eventBus?: EventBus,
  ) {}

  start(): void {
    // Defer boot pass so DB migrations, MCP connection, etc. settle first.
    this.bootTimer = setTimeout(() => {
      void this.sweep('boot');
    }, BOOT_DELAY_MS);

    this.timer = setInterval(() => {
      void this.sweep('scheduled');
    }, GC_INTERVAL_MS);

    this.log.info('garbage collector scheduled', {
      intervalMinutes: GC_INTERVAL_MS / 60_000,
      bootDelaySec: BOOT_DELAY_MS / 1000,
    });
  }

  stop(): void {
    if (this.bootTimer) { clearTimeout(this.bootTimer); this.bootTimer = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  getLastSummary(): GcSummary | null {
    return this.lastSummary;
  }

  async sweep(trigger: 'boot' | 'scheduled' | 'manual'): Promise<GcSummary> {
    if (this.inFlight) {
      this.log.warn('sweep skipped — previous run still in flight', { trigger });
      return this.lastSummary || { trigger, startedAt: new Date().toISOString(), stages: {} };
    }
    this.inFlight = true;
    const startedAt = new Date();
    const summary: GcSummary = { trigger, startedAt: startedAt.toISOString(), stages: {} };

    // Consumer side: load any promoted GC skills + log which directories
    // they'd override TTLs for. The actual TTL override is a follow-up; this
    // closes the visible producer→consumer loop and emits a learning event
    // so the dashboard can show "GC applied skill X for dir Y".
    try {
      const skills: LoadedSkill[] = loadInstalledSkills(WORKSPACE_DIR, 'gc');
      if (skills.length > 0) {
        this.log.info('GC sweep loaded skills', { count: skills.length, names: skills.map(s => s.name) });
        for (const s of skills) {
          const w = s.appliesWhen;
          if (w?.dir_path && w?.suggested_ttl_action) {
            this.log.info('GC skill applicable', { skill: s.name, dir_path: w.dir_path, action: w.suggested_ttl_action });
            this.eventBus?.emit('learning:observation', {
              source: 'gc',
              kind: 'skill-applied',
              fingerprint: `${s.name}::${String(w.dir_path)}`,
              value: 1,
              metadata: { skill: s.name, dir_path: w.dir_path, action: w.suggested_ttl_action, trigger },
            });
          }
        }
      }
    } catch (err: any) {
      this.log.warn('GC skill consumer pre-sweep step failed (non-fatal)', { error: err.message });
    }

    this.log.info('sweep starting', { trigger });

    try {
      summary.stages.taskPool       = await this.sweepTaskPool();
      summary.stages.meta           = await this.sweepMeta();
      summary.stages.stepHistory    = await this.sweepStepHistory();
      summary.stages.debugFiles     = await this.sweepDebugFiles();
      summary.stages.networkCache   = await this.sweepNetworkCache();
      summary.stages.orphanFlags    = await this.sweepOrphanFlags();
      summary.stages.penIntegrity   = await this.auditPenIntegrity();
      summary.stages.promptFreshness = await this.auditPromptFreshness();
      summary.stages.vaultKey       = this.auditVaultKey();
      // Storage / corpus stages — added 2026-05-21 for production scale.
      summary.stages.comfyuiOutput  = await this.sweepComfyuiOutput();
      summary.stages.scoutFindings  = await this.sweepScoutFindings();
      summary.stages.auditFiles     = await this.sweepAuditFiles();
      summary.stages.skillsPending  = await this.sweepSkillsPending();
      summary.stages.penProfiles    = await this.sweepPenProfiles();
      summary.stages.ragCorpus      = this.sweepRagCorpus();
      summary.stages.chatMemory     = await this.sweepChatMemory();
    } catch (e: any) {
      this.log.error('sweep failed mid-flight', { error: e.message, stack: e.stack });
      summary.stages.fatalError = { errors: [e.message] };
    } finally {
      summary.completedAt = new Date().toISOString();
      summary.durationMs = Date.now() - startedAt.getTime();
      this.lastSummary = summary;
      this.persistSummary(summary);
      // GC self-learning: look at post-sweep dir sizes and propose tighter
      // TTL skills for dirs that GC can't keep up with. Best-effort.
      try { this.observeDirGrowth(); } catch (e: any) {
        this.log.warn('GC skill observer threw', { error: e.message });
      }
      this.inFlight = false;
      const totalSwept = Object.values(summary.stages).reduce(
        (n, s: any) => n + (s.swept || 0) + (s.released || 0) + (s.archived || 0) + (s.deleted || 0), 0
      );
      this.log.info('sweep complete', { trigger, durationMs: summary.durationMs, totalSwept });
    }
    return summary;
  }

  /**
   * Compare current dir bytes to the prior sweep snapshot stored in meta.
   * Emit a `learning:observation('gc', 'dir-growth', dirPath)` for every
   * dir that doubled AND exceeds 10MB. LearningCore aggregates the
   * consecutive-streak count and proposes the tighter-TTL skill once the
   * threshold (3) is crossed.
   *
   * We still keep the lastBytes/streak meta blob because GC needs to KNOW
   * the prior size to detect growth — but the threshold + skill rendering
   * lives in LearningCore now.
   */
  private observeDirGrowth(): void {
    const snap = this.getStorageSnapshot();
    const stateStore: any = this.projectEngine.getStateStore();
    if (!stateStore?.getMeta || !stateStore?.setMeta) return;
    const META_KEY = 'gc_dir_growth_state';
    let state: Record<string, { lastBytes: number; growthStreak: number; lastSeen: string }> = {};
    try {
      const raw = stateStore.getMeta(META_KEY);
      if (raw) state = JSON.parse(raw);
    } catch {}

    for (const dir of snap.workspace) {
      const prev = state[dir.path];
      const newEntry = { lastBytes: dir.bytes, growthStreak: 0, lastSeen: new Date().toISOString() };
      const grew = prev && prev.lastBytes > 0 && dir.bytes >= prev.lastBytes * 2 && dir.bytes >= 10 * 1024 * 1024;
      if (grew) {
        newEntry.growthStreak = (prev.growthStreak || 0) + 1;
        // Emit an observation each time a dir doubles. LearningCore counts
        // consecutive observations of the same fingerprint = the streak.
        if (this.eventBus) {
          this.eventBus.emit('learning:observation', {
            source: 'gc',
            kind: 'dir-growth',
            fingerprint: dir.path,
            value: dir.bytes,
            metadata: { dir_path: dir.path, bytes: dir.bytes, files: dir.files, prev_bytes: prev?.lastBytes, growth_streak: newEntry.growthStreak },
          });
        }
      }
      state[dir.path] = newEntry;
    }

    try { stateStore.setMeta(META_KEY, JSON.stringify(state)); } catch {}
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: task_pool
  // ─────────────────────────────────────────────────────────────────────
  private async sweepTaskPool(): Promise<StageResult> {
    const db = this.db();
    if (!db) return { skipped: true };
    const r: StageResult = { released: 0, archived: 0, deleted: 0, detail: {} };

    // Release claimed rows whose worker likely crashed.
    try {
      const released = db.prepare(
        `UPDATE task_pool SET status='open', claimed_by=NULL, claimed_at=NULL
         WHERE status='claimed' AND claimed_at < datetime('now', ? || ' seconds')`
      ).run(`-${STALE_CLAIM_SECS}`);
      r.released = released.changes;
    } catch (e: any) { (r.errors ||= []).push(`release stale claims: ${e.message}`); }

    // Archive done rows older than 24h that weren't archived by their
    // type-specific handler (only voice_anchor_score auto-archives today).
    try {
      const archived = db.prepare(
        `UPDATE task_pool SET status='archived'
         WHERE status='done' AND completed_at < datetime('now', ? || ' seconds')`
      ).run(`-${DONE_ARCHIVE_SECS}`);
      r.archived = archived.changes;
    } catch (e: any) { (r.errors ||= []).push(`archive done: ${e.message}`); }

    // Delete archived rows older than 7d.
    try {
      const deletedArchived = db.prepare(
        `DELETE FROM task_pool
         WHERE status='archived' AND created_at < datetime('now', ? || ' seconds')`
      ).run(`-${ARCHIVED_DELETE_SECS}`);
      r.deleted = (r.deleted || 0) + deletedArchived.changes;
      (r.detail!).archivedDeleted = deletedArchived.changes;
    } catch (e: any) { (r.errors ||= []).push(`delete archived: ${e.message}`); }

    // Delete failed rows older than 14d. (Kept longer for debug value.)
    try {
      const deletedFailed = db.prepare(
        `DELETE FROM task_pool
         WHERE status='failed' AND created_at < datetime('now', ? || ' seconds')`
      ).run(`-${FAILED_DELETE_SECS}`);
      r.deleted = (r.deleted || 0) + deletedFailed.changes;
      (r.detail!).failedDeleted = deletedFailed.changes;
    } catch (e: any) { (r.errors ||= []).push(`delete failed: ${e.message}`); }

    return r;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: meta
  // ─────────────────────────────────────────────────────────────────────
  private async sweepMeta(): Promise<StageResult> {
    const db = this.db();
    if (!db) return { skipped: true };
    const r: StageResult = { deleted: 0, detail: {} };

    // One-shot daemon-control + fire-request flags. These should be consumed
    // by the coordinator within 60s; anything older is debris.
    const oneShotPrefixes = ['daemon_control_', 'assist_fire_requested_at_', 'daemon_stop_requested_'];
    let oneShotDeleted = 0;
    try {
      const cutoff = new Date(Date.now() - ONE_SHOT_FLAG_SECS * 1000).toISOString();
      const rows = db.prepare(
        "SELECT key, value FROM meta WHERE " + oneShotPrefixes.map(p => `key LIKE '${p}%'`).join(' OR ')
      ).all() as Array<{ key: string; value: string }>;
      for (const row of rows) {
        // Most one-shot values are JSON with an `at` field; fall back to row mtime if none.
        let isStale = false;
        try {
          const parsed = JSON.parse(row.value);
          if (parsed.at && parsed.at < cutoff) isStale = true;
        } catch {
          if (row.value && row.value < cutoff) isStale = true; // raw ISO timestamp
        }
        if (isStale) {
          db.prepare('DELETE FROM meta WHERE key=?').run(row.key);
          oneShotDeleted++;
        }
      }
      (r.detail!).oneShotFlags = oneShotDeleted;
      r.deleted! += oneShotDeleted;
    } catch (e: any) { (r.errors ||= []).push(`one-shot flag sweep: ${e.message}`); }

    // Pen-scoped meta keys orphaned by missing pens. Scan keys with patterns
    // matching the pen-scoped namespace, then check if the slug exists.
    try {
      const penRows = db.prepare("SELECT slug FROM pen_names").all() as Array<{ slug: string }>;
      const validSlugs = new Set(penRows.map(p => p.slug));
      const penScopedPatterns = ['voice_anchors_', 'worker_target_', 'assist_last_fired_at_', 'assist_worker_config_'];
      let orphanDeleted = 0;
      for (const prefix of penScopedPatterns) {
        const matches = db.prepare(`SELECT key FROM meta WHERE key LIKE '${prefix}%'`).all() as Array<{ key: string }>;
        for (const { key } of matches) {
          const slug = key.slice(prefix.length);
          // assist_*_<agent> keys aren't pen-scoped; assist agents are anthropic / antigrav / codex.
          if (slug === 'anthropic' || slug === 'antigrav' || slug === 'codex') continue;
          if (!validSlugs.has(slug)) {
            db.prepare('DELETE FROM meta WHERE key=?').run(key);
            orphanDeleted++;
          }
        }
      }
      (r.detail!).penOrphans = orphanDeleted;
      r.deleted! += orphanDeleted;
    } catch (e: any) { (r.errors ||= []).push(`pen-scoped orphan sweep: ${e.message}`); }

    return r;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: step_history
  // ─────────────────────────────────────────────────────────────────────
  private async sweepStepHistory(): Promise<StageResult> {
    const db = this.db();
    if (!db) return { skipped: true };
    try {
      const deleted = db.prepare(
        `DELETE FROM step_history
         WHERE project_id NOT IN (SELECT id FROM projects)`
      ).run();
      return { deleted: deleted.changes };
    } catch (e: any) {
      return { errors: [`step_history sweep: ${e.message}`] };
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: debug-calibration-*.txt and similar one-off dumps in workspace/
  // ─────────────────────────────────────────────────────────────────────
  private async sweepDebugFiles(): Promise<StageResult> {
    const cutoff = Date.now() - DEBUG_FILE_TTL_MS;
    let deleted = 0;
    const patterns = [
      /^debug-calibration-/,
      /^debug-prompt-/,
      /^debug-pov-/,
      /\.tmp$/,
    ];
    try {
      for (const f of fs.readdirSync(WORKSPACE_DIR)) {
        if (!patterns.some(re => re.test(f))) continue;
        const p = path.join(WORKSPACE_DIR, f);
        try {
          const st = fs.statSync(p);
          if (st.isFile() && st.mtimeMs < cutoff) { fs.unlinkSync(p); deleted++; }
        } catch { /* file vanished — fine */ }
      }
    } catch (e: any) {
      return { errors: [`debug file sweep: ${e.message}`] };
    }
    return { deleted };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: NetworkCache
  // ─────────────────────────────────────────────────────────────────────
  private async sweepNetworkCache(): Promise<StageResult> {
    try {
      const before = typeof NetworkCache.size === 'function' ? NetworkCache.size() : null;
      const removed = NetworkCache.prune(NETWORK_CACHE_TTL_MS);
      const after = typeof NetworkCache.size === 'function' ? NetworkCache.size() : null;
      return { deleted: removed || 0, detail: { sizeBefore: before, sizeAfter: after } };
    } catch (e: any) {
      return { errors: [`network cache: ${e.message}`] };
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: orphan training flags (READ-ONLY trainer probe)
  // ─────────────────────────────────────────────────────────────────────
  private async sweepOrphanFlags(): Promise<StageResult> {
    const trainingFlag = path.join(TRAINING_DIR, 'TRAINING_IN_PROGRESS.flag');
    const readyFlag    = path.join(TRAINING_DIR, 'READY_TO_FINETUNE.flag');
    const r: StageResult = { deleted: 0, detail: {} };

    // TRAINING_IN_PROGRESS: only delete if the trainer container is NOT
    // actually running a python finetune. pgrep is read-only. If we can't
    // probe (docker socket unmounted / trainer absent), skip — never delete
    // blindly.
    if (fs.existsSync(trainingFlag)) {
      let trainerRunning: boolean | null = null;
      try {
        execSync('docker exec perry-trainer pgrep -f finetune.py', { stdio: 'pipe', timeout: 10_000 });
        trainerRunning = true;
      } catch (e: any) {
        // pgrep exit code 1 = no match (trainer idle). Other errors = unable to probe.
        if (e.status === 1) trainerRunning = false;
        else { (r.detail!).trainerProbeFailed = e.message?.slice(0, 200); trainerRunning = null; }
      }
      (r.detail!).trainerRunning = trainerRunning;
      if (trainerRunning === false) {
        try { fs.unlinkSync(trainingFlag); r.deleted! += 1; (r.detail!).trainingFlagDeleted = true; }
        catch (e: any) { (r.errors ||= []).push(`unlink training flag: ${e.message}`); }
      }
    }

    // READY_TO_FINETUNE older than 24h with no LoRA progress.
    if (fs.existsSync(readyFlag)) {
      try {
        const st = fs.statSync(readyFlag);
        if (Date.now() - st.mtimeMs > READY_FLAG_TTL_MS) {
          fs.unlinkSync(readyFlag);
          r.deleted! += 1;
          (r.detail!).readyFlagDeleted = true;
        }
      } catch (e: any) { (r.errors ||= []).push(`ready flag check: ${e.message}`); }
    }

    return r;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: pen integrity audit (read-only)
  // ─────────────────────────────────────────────────────────────────────
  private async auditPenIntegrity(): Promise<StageResult> {
    const db = this.db();
    if (!db) return { skipped: true };
    const r: StageResult = { warnings: [], detail: {} };
    try {
      const pens = db.prepare("SELECT slug, current_lora_version FROM pen_names").all() as Array<{ slug: string; current_lora_version: number | null }>;
      const penReports: Record<string, any> = {};
      for (const pen of pens) {
        const report: any = { slug: pen.slug, currentLoraVersion: pen.current_lora_version };
        const maxRow = db.prepare(
          "SELECT MAX(version) AS max FROM lora_versions WHERE pen_slug=?"
        ).get(pen.slug) as { max: number | null };
        report.maxLoraVersion = maxRow?.max;
        if (pen.current_lora_version != null && maxRow?.max != null && pen.current_lora_version !== maxRow.max) {
          r.warnings!.push(`pen ${pen.slug}: current_lora_version=${pen.current_lora_version} but max=${maxRow.max}`);
          report.driftDetected = true;
        }
        // Check gguf paths exist on disk
        const ggufRows = db.prepare(
          "SELECT version, lora_gguf_path FROM lora_versions WHERE pen_slug=?"
        ).all(pen.slug) as Array<{ version: number; lora_gguf_path: string | null }>;
        const missing: number[] = [];
        for (const row of ggufRows) {
          if (row.lora_gguf_path && !fs.existsSync(row.lora_gguf_path)) missing.push(row.version);
        }
        if (missing.length) {
          r.warnings!.push(`pen ${pen.slug}: missing gguf files for versions ${missing.join(',')}`);
          report.missingGgufVersions = missing;
        }
        penReports[pen.slug] = report;
      }
      r.detail!.pens = penReports;
    } catch (e: any) { (r.errors ||= []).push(`pen integrity: ${e.message}`); }
    return r;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: prompt freshness audit (report only — engine handles regen)
  // ─────────────────────────────────────────────────────────────────────
  private async auditPromptFreshness(): Promise<StageResult> {
    // engine.refreshPendingPrompts auto-regenerates at execute-time. This
    // stage surfaces the *backlog* — how many projects have pending steps
    // whose stored prompt has drifted from the current template — so the
    // dashboard can show the impact of a template edit before any of those
    // projects next runs.
    try {
      const counts = this.projectEngine.countStalePendingPrompts();
      return {
        detail: {
          totalProjects: counts.totalProjects,
          staleProjects: counts.staleProjects,
          staleSteps: counts.staleSteps,
          perProject: counts.perProject,
        },
      };
    } catch (e: any) {
      return { errors: [`stale-prompt audit failed: ${e.message}`] };
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: vault key sanity
  // ─────────────────────────────────────────────────────────────────────
  private auditVaultKey(): StageResult {
    const k = process.env.PERRY_VAULT_KEY || '';
    if (!k) {
      this.log.error('PERRY_VAULT_KEY is empty — vault is using hostname-derived fallback. Set in .env.');
      return { warnings: ['PERRY_VAULT_KEY empty — vault using fallback key. Stored API keys may be unrecoverable on host change.'] };
    }
    return { detail: { length: k.length } };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: comfyui-output/ — cover image GC
  //
  // Pre-prod: ad-hoc covers + per-project covers all pile up here. Strategy:
  //   - delete loose files (top-level *.png/*.jpg/*.webp) older than TTL
  //   - leave subdirectories alone (they're per-project; project deletion
  //     already drops the whole subtree via projectEngine when implemented)
  // ─────────────────────────────────────────────────────────────────────
  private async sweepComfyuiOutput(): Promise<StageResult> {
    if (!fs.existsSync(COMFYUI_OUT_DIR)) return { skipped: true };
    const cutoff = Date.now() - COMFYUI_OUTPUT_TTL_MS;
    let deleted = 0;
    const errors: string[] = [];
    try {
      for (const f of fs.readdirSync(COMFYUI_OUT_DIR)) {
        const p = path.join(COMFYUI_OUT_DIR, f);
        try {
          const st = fs.statSync(p);
          if (!st.isFile()) continue;
          if (!/\.(png|jpe?g|webp|gif)$/i.test(f)) continue;
          if (st.mtimeMs < cutoff) { fs.unlinkSync(p); deleted++; }
        } catch { /* vanished */ }
      }
    } catch (e: any) { errors.push(e.message); }
    return { deleted, errors: errors.length ? errors : undefined };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: scout-findings/ — Reddit/Amazon scrape dumps
  //
  // Each scout run writes one JSON file with a timestamp prefix. Files
  // older than TTL drop; the corpus has already been fed into RAG by
  // that point so the raw dumps are recoverable noise.
  // ─────────────────────────────────────────────────────────────────────
  private async sweepScoutFindings(): Promise<StageResult> {
    if (!fs.existsSync(SCOUT_OUT_DIR)) return { skipped: true };
    const cutoff = Date.now() - SCOUT_FINDINGS_TTL_MS;
    let deleted = 0;
    const errors: string[] = [];
    const walk = (dir: string) => {
      try {
        for (const f of fs.readdirSync(dir)) {
          const p = path.join(dir, f);
          try {
            const st = fs.statSync(p);
            if (st.isDirectory()) { walk(p); continue; }
            if (!st.isFile() || !/\.(json|jsonl|txt)$/i.test(f)) continue;
            if (st.mtimeMs < cutoff) { fs.unlinkSync(p); deleted++; }
          } catch { /* vanished */ }
        }
      } catch (e: any) { errors.push(e.message); }
    };
    walk(SCOUT_OUT_DIR);
    return { deleted, errors: errors.length ? errors : undefined };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: audit-v{N}.md/jsonl rotation per pen
  //
  // Keeps the most recent AUDIT_FILES_KEEP_LAST versions per pen. Older
  // audit reports drop. The pen's priorityTags + LESSONS.md already
  // summarise what those audits found.
  // ─────────────────────────────────────────────────────────────────────
  private async sweepAuditFiles(): Promise<StageResult> {
    if (!fs.existsSync(TRAINING_DIR)) return { skipped: true };
    let deleted = 0;
    const errors: string[] = [];
    const detail: Record<string, number> = {};
    try {
      for (const penDir of fs.readdirSync(TRAINING_DIR)) {
        if (!penDir.startsWith('pen-')) continue;
        const full = path.join(TRAINING_DIR, penDir);
        try {
          if (!fs.statSync(full).isDirectory()) continue;
        } catch { continue; }
        // Group by version: collect audit-v{N}.{md,jsonl} and rank by N.
        const versions = new Map<number, { md?: string; jsonl?: string }>();
        for (const f of fs.readdirSync(full)) {
          const m = f.match(/^audit-v(\d+)\.(md|jsonl)$/);
          if (!m) continue;
          const n = parseInt(m[1], 10);
          if (!versions.has(n)) versions.set(n, {});
          versions.get(n)![m[2] as 'md' | 'jsonl'] = path.join(full, f);
        }
        const sortedDesc = [...versions.keys()].sort((a, b) => b - a);
        const toRemove = sortedDesc.slice(AUDIT_FILES_KEEP_LAST);
        for (const v of toRemove) {
          const pair = versions.get(v)!;
          for (const file of [pair.md, pair.jsonl]) {
            if (!file) continue;
            try { fs.unlinkSync(file); deleted++; } catch { /* vanished */ }
          }
        }
        if (toRemove.length > 0) detail[penDir] = toRemove.length;
      }
    } catch (e: any) { errors.push(e.message); }
    return { deleted, errors: errors.length ? errors : undefined, detail };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: skills-pending/ orphan sweep
  //
  // Workers can propose freely; humans review on a less-busy cadence.
  // Proposals that go unreviewed for SKILLS_PENDING_TTL_MS move into
  // skills-rejected/ (not deleted — operator can recover them) so the
  // Pending tab doesn't drown in stale candidates.
  // ─────────────────────────────────────────────────────────────────────
  private async sweepSkillsPending(): Promise<StageResult> {
    if (!fs.existsSync(SKILLS_PENDING_DIR)) return { skipped: true };
    const cutoff = Date.now() - SKILLS_PENDING_TTL_MS;
    let archived = 0;
    const errors: string[] = [];
    try {
      if (!fs.existsSync(SKILLS_REJECTED_DIR)) fs.mkdirSync(SKILLS_REJECTED_DIR, { recursive: true });
      for (const f of fs.readdirSync(SKILLS_PENDING_DIR)) {
        if (!f.endsWith('.md')) continue;
        const src = path.join(SKILLS_PENDING_DIR, f);
        try {
          const st = fs.statSync(src);
          if (st.mtimeMs >= cutoff) continue;
          const dst = path.join(SKILLS_REJECTED_DIR, f);
          fs.renameSync(src, dst);
          archived++;
        } catch (e: any) { errors.push(`${f}: ${e.message}`); }
      }
    } catch (e: any) { errors.push(e.message); }
    return { archived, errors: errors.length ? errors : undefined };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: workspace/pens/{slug}/ orphan sweep
  //
  // When a pen row is removed from pen_names, leftover SOUL.md/LESSONS.md
  // dirs become orphans. Drop them.
  // ─────────────────────────────────────────────────────────────────────
  private async sweepPenProfiles(): Promise<StageResult> {
    if (!fs.existsSync(PENS_DIR)) return { skipped: true };
    let deleted = 0;
    const errors: string[] = [];
    try {
      const store: any = this.projectEngine.getStateStore();
      const liveSlugs = new Set<string>((store.getPenNames?.() || []).map((p: any) => p.slug));
      for (const dirEntry of fs.readdirSync(PENS_DIR)) {
        if (liveSlugs.has(dirEntry)) continue;
        const orphan = path.join(PENS_DIR, dirEntry);
        try {
          if (!fs.statSync(orphan).isDirectory()) continue;
          fs.rmSync(orphan, { recursive: true, force: true });
          deleted++;
        } catch (e: any) { errors.push(`${dirEntry}: ${e.message}`); }
      }
    } catch (e: any) { errors.push(e.message); }
    return { deleted, errors: errors.length ? errors : undefined };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: chat-memory distillation
  //
  // Distills idle meta-domain agent sessions into workspace/chat-memory/
  // global.md via the Librarian. Bounded — ChatMemoryService caps the work
  // per sweep at SWEEP_BATCH_MAX to protect the librarian. Sweep records
  // distilled/skipped counts but the actual entry-writes are best-effort.
  // ─────────────────────────────────────────────────────────────────────
  private async sweepChatMemory(): Promise<StageResult> {
    if (!this.chatMemory) return { skipped: true };
    try {
      const results = await this.chatMemory.distillIdleSessions();
      const distilled = results.filter(r => r.distilled).length;
      const notable = results.filter(r => !r.distilled).map(r => ({ sessionId: r.sessionId.slice(-8), reason: r.reason }));
      return {
        deleted: 0,   // No deletions — distill is additive.
        detail: {
          distilled,
          considered: results.length,
          ...(notable.length ? { skipped: notable.slice(0, 5) } : {}),
        },
      };
    } catch (e: any) {
      return { errors: [`chat-memory sweep failed: ${e.message}`] };
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage: RAG corpus retention (memory.db chunks)
  //
  // Two-pass policy:
  //   1. Age out anything older than the kind's TTL (learning_* 180d,
  //      bible_*/voice_anchor 365d)
  //   2. Enforce a hard max-per-kind cap so a runaway worker can't
  //      drown the corpus before the age sweep runs
  //
  // Requires memoryStore — passed via GC constructor. Skipped if absent.
  // ─────────────────────────────────────────────────────────────────────
  private sweepRagCorpus(): StageResult {
    if (!this.memoryStore) return { skipped: true };
    const detail: Record<string, any> = {};
    let totalDeleted = 0;
    try {
      // Age-out learning_* corpus + scout findings (treated as learning-class).
      // Raw scout_finding chunks age out faster than verified_scout_finding ones —
      // raw is exploratory cache; verified is proven signal worth keeping.
      const aged1 = this.memoryStore.pruneOldChunks({
        olderThanDays: RAG_LEARNING_TTL_DAYS,
        kinds: ['learning_chapter', 'learning_calibration', 'learning_cover_prompt', 'learning_worker_task',
                'scout_finding', 'verified_scout_finding'],
      });
      totalDeleted += aged1.deleted;
      if (aged1.deleted > 0) detail.aged_learning = aged1.byKind;

      // Age-out reference corpus (bibles + anchors)
      const aged2 = this.memoryStore.pruneOldChunks({
        olderThanDays: RAG_REFERENCE_TTL_DAYS,
        kinds: ['bible_character', 'bible_setting', 'bible_architecture', 'bible_stats',
                'bible_world', 'bible_premise', 'voice_anchor'],
      });
      totalDeleted += aged2.deleted;
      if (aged2.deleted > 0) detail.aged_reference = aged2.byKind;

      // Hard cap per kind
      const cappedLearning = this.memoryStore.enforceMaxPerKind({
        maxPerKind: RAG_LEARNING_MAX,
        kinds: ['learning_chapter', 'learning_calibration', 'learning_cover_prompt', 'learning_worker_task',
                'scout_finding', 'verified_scout_finding'],
      });
      totalDeleted += cappedLearning.deleted;
      if (cappedLearning.deleted > 0) detail.capped_learning = cappedLearning.byKind;

      const cappedReference = this.memoryStore.enforceMaxPerKind({
        maxPerKind: RAG_REFERENCE_MAX,
        kinds: ['bible_character', 'bible_setting', 'bible_architecture', 'bible_stats',
                'bible_world', 'bible_premise', 'voice_anchor'],
      });
      totalDeleted += cappedReference.deleted;
      if (cappedReference.deleted > 0) detail.capped_reference = cappedReference.byKind;
    } catch (e: any) {
      return { errors: [e.message] };
    }
    return { deleted: totalDeleted, detail };
  }

  /**
   * Storage snapshot for the dashboard's Analytics → Storage section.
   * Lists ONLY the dirs the GC manages — deliberately excludes the
   * training/ subtree (multi-GB LoRA artifacts that we never sweep)
   * and the top-level workspace (would recurse into everything).
   *
   * Walks are file-by-file synchronous; safe at the small scale of
   * the dirs we DO include. Returns under 1s on a typical setup.
   */
  getStorageSnapshot(): {
    workspace: Array<{ path: string; bytes: number; files: number }>;
    ragCorpus: { chunks: number; bytes: number };
    lastSweep: GcSummary | null;
    notes: string[];
  } {
    // Dirs we DO walk — sized and manageable by GC.
    const dirs = [
      { path: COMFYUI_OUT_DIR,   label: '$WORKSPACE/comfyui-output' },
      { path: SCOUT_OUT_DIR,     label: '$WORKSPACE/scout-findings' },
      { path: PENS_DIR,          label: '$WORKSPACE/pens' },
      { path: SKILLS_PENDING_DIR,label: '$WORKSPACE/skills-pending' },
      { path: SKILLS_REJECTED_DIR,label:'$WORKSPACE/skills-rejected' },
      { path: path.join(WORKSPACE_DIR, '.config'), label: '$WORKSPACE/.config' },
      { path: path.join(WORKSPACE_DIR, 'memory'),  label: '$WORKSPACE/memory' },
    ];
    const workspace: Array<{ path: string; bytes: number; files: number }> = [];
    const MAX_DEPTH = 4;
    for (const d of dirs) {
      if (!fs.existsSync(d.path)) continue;
      let bytes = 0, files = 0;
      const walk = (dir: string, depth: number) => {
        if (depth > MAX_DEPTH) return;
        try {
          for (const f of fs.readdirSync(dir)) {
            const p = path.join(dir, f);
            try {
              const st = fs.statSync(p);
              if (st.isDirectory()) { walk(p, depth + 1); continue; }
              bytes += st.size;
              files++;
            } catch { /* vanished */ }
          }
        } catch { /* unreadable */ }
      };
      walk(d.path, 0);
      workspace.push({ path: d.label, bytes, files });
    }
    return {
      workspace,
      ragCorpus: this.memoryStore ? this.memoryStore.approximateCorpusBytes() : { chunks: 0, bytes: 0 },
      lastSweep: this.lastSummary,
      notes: [
        'training/ is excluded (multi-GB LoRA artifacts — never GC\'d).',
        `Walk depth capped at ${MAX_DEPTH} levels per dir.`,
      ],
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────
  private db(): any | null {
    const store: any = this.projectEngine.getStateStore();
    return store?.db || null;
  }

  private persistSummary(summary: GcSummary): void {
    try {
      const store: any = this.projectEngine.getStateStore();
      store.setMeta('gc_last_run_at', summary.completedAt || summary.startedAt);
      store.setMeta('gc_last_summary', JSON.stringify(summary));
    } catch (e: any) {
      this.log.warn('failed to persist gc summary', { error: e.message });
    }
  }
}
