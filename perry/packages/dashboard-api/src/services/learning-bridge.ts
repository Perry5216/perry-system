/**
 * LearningBridge — drains worker_done_* breadcrumbs from the meta table
 * and indexes them into the RAG corpus as `learning_worker_task`.
 *
 * Why this exists: mcp-server runs in a separate process from dashboard-
 * api, so it can't reach ragService directly. Instead it writes a small
 * marker into the shared SQLite meta table on every successful worker
 * task report. This service polls that table on an interval, indexes
 * each marker via ragService.indexIfVerified, then deletes the marker
 * so the meta table doesn't grow.
 *
 * Verification gate: `status === 'done'` already proved at write time,
 * so the gate is effectively a "yes, this is verified" pass-through.
 * Future enhancement: also check that the downstream step didn't get
 * marked failed within N minutes — that'd catch worker outputs that
 * unblocked a step which then crashed later.
 *
 * Configuration: poll interval 30s, batch size 25 per poll. Adjust if
 * the worker fleet gets very busy.
 */

import type { Logger } from '@perry/core';
import type { StateStore } from '@perry/projects';
import type { RagService } from '@perry/rag';

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 25;
const META_PREFIX = 'worker_done_';

export class LearningBridge {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private stateStore: StateStore,
    private rag: RagService,
    private log: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, POLL_INTERVAL_MS);
    // Kick once on startup to drain any backlog from before this bridge existed.
    setTimeout(() => { this.tick().catch(() => {}); }, 5_000);
    this.log.info('learning-bridge started', { pollMs: POLL_INTERVAL_MS, batch: BATCH_SIZE });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const keys = this.stateStore.listMetaKeysByPrefix(META_PREFIX, BATCH_SIZE);
      if (keys.length === 0) return;

      let indexed = 0, skipped = 0, malformed = 0;
      for (const key of keys) {
        const raw = this.stateStore.getMeta(key);
        if (!raw) {
          this.stateStore.removeMeta(key);
          continue;
        }
        let b: any;
        try { b = JSON.parse(raw); } catch {
          // Malformed breadcrumb — log + drop so it doesn't block the queue.
          this.stateStore.removeMeta(key);
          malformed++;
          continue;
        }
        if (!b.task_id || !b.digest || typeof b.digest !== 'string') {
          this.stateStore.removeMeta(key);
          malformed++;
          continue;
        }
        try {
          const r = await this.rag.indexIfVerified({
            projectId: b.project_id || 'workers',
            sourceRef: `worker-task-${b.task_id}`,
            kind: 'worker_task',
            text: b.digest,
            replace: true,
            metadata: {
              taskType: b.task_type || 'unknown',
              stepId: b.step_id || null,
              completedAt: b.completed_at || null,
            },
            gate: () => ({
              verified: true,
              reason: `assist_injected:${b.task_type || 'unknown'}`,
            }),
          });
          if (r.indexed) indexed++;
          else skipped++;
          // Always remove the breadcrumb — if rag declined to index (e.g.
          // text-too-short) we don't want to retry every 30s forever.
          this.stateStore.removeMeta(key);
        } catch (err: any) {
          // Real error (e.g. embedding service down). Leave the breadcrumb
          // for the next tick — transient outages recover automatically.
          this.log.warn('learning-bridge index failed (will retry)', { task_id: b.task_id, error: err.message });
        }
      }

      if (indexed + skipped + malformed > 0) {
        this.log.info('learning-bridge drained', { indexed, skipped, malformed });
      }
    } finally {
      this.busy = false;
    }
  }
}
