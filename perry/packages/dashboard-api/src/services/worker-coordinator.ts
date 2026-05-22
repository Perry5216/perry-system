/**
 * WorkerCoordinator — runs INSIDE the perry container, makes all the
 * worker-spawn decisions, dispatches them to perry-worker via HTTP.
 *
 *   ┌─ perry container ──────────────────────────────────┐
 *   │  WorkerCoordinator (this file)                     │
 *   │    - polls task_pool + per-agent state every 5s    │
 *   │    - applies auto-loop / cooldown / fire-request   │
 *   │      logic                                         │
 *   │    - when fire decided: POSTs {agent,id,label,...} │
 *   │      to http://perry-worker:4711/spawn             │
 *   └────────────────────────────────────────────────────┘
 *                       ↓ (docker network)
 *   ┌─ perry-worker container ───────────────────────────┐
 *   │  listener.cjs                                      │
 *   │    - receives spawn request                        │
 *   │    - runs claude / gemini CLI subprocess           │
 *   │    - host auth dirs mounted read-only at           │
 *   │      /home/node/.claude and /home/node/.gemini     │
 *   └────────────────────────────────────────────────────┘
 *
 * Requires `PERRY_WORKER_URL` to be set (compose.yaml defaults to
 * http://perry-worker:4711). Spawns are dropped with an error log if the
 * URL is unset or the HTTP POST fails — there is no host-spawner fallback
 * anymore.
 */

import { Logger } from '@perry/core';
import { ProjectEngine } from '@perry/projects';

const WORKER_URL = process.env.PERRY_WORKER_URL || '';
const WORKER_SECRET = process.env.PERRY_WORKER_SECRET || '';
const VALID_AGENTS = ['anthropic', 'antigrav', 'codex'] as const;
type Agent = typeof VALID_AGENTS[number];

interface AgentSpec {
  label: string;
  /** Shell-style command for perry-worker's listener to spawn. */
  hostCommand: string;
}

const AGENTS: Record<Agent, AgentSpec> = {
  anthropic: {
    label: 'Anthropic',
    // `claude` is the on-disk binary name installed by @anthropic-ai/claude-code.
    hostCommand: 'claude -p "/perry-worker" --max-turns 60 --dangerously-skip-permissions',
  },
  antigrav: {
    label: 'Anti-Grav',
    // Prefer gemini (Companion), fall back to antigravity. Both run /perry-worker.
    hostCommand: '(where gemini >NUL 2>NUL && gemini -p "/perry-worker") || antigravity chat -r "/perry-worker"',
  },
  codex: {
    label: 'Codex',
    // OpenAI Codex CLI — ChatGPT Plus/Pro subscription auth. listener.cjs
    // pipes the shared worker prompt into `codex exec -` via stdin (no
    // native slash-command discovery). hostCommand here is a best-effort
    // fallback the listener overrides; it never runs as-is.
    hostCommand: 'codex exec --yolo -C /app -',
  },
};

interface AgentState {
  lastFireAt: number; // epoch ms
}

export class WorkerCoordinator {
  private log = new Logger('worker-coord');
  private state: Record<Agent, AgentState>;
  private timer: NodeJS.Timeout | null = null;
  private readonly pollMs = 5_000;
  private readonly cooldownSec = 60;

  constructor(private projectEngine: ProjectEngine) {
    this.state = {
      anthropic: { lastFireAt: 0 },
      antigrav:  { lastFireAt: 0 },
      codex:     { lastFireAt: 0 },
    };
  }

  start(): void {
    if (!WORKER_URL) {
      this.log.error('PERRY_WORKER_URL is unset — spawns will be dropped. Set it in compose.yaml or .env.');
    }
    this.log.info('starting', { pollMs: this.pollMs, cooldownSec: this.cooldownSec, workerUrl: WORKER_URL || '<unset>' });
    this.migrateLegacyAgentMeta();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.bindPrewarmListeners();
  }

  /**
   * One-shot migration: rename legacy meta rows that still use the prior
   * agent slug for the Anthropic worker. Older installs stored per-agent
   * state under `assist_*_claude` keys (and the Pair Mining target stored
   * `assist_worker_agent = 'claude'`); the agent enum has been renamed
   * and the new code expects `assist_*_anthropic` / `'anthropic'`.
   * Idempotent — no-op after the first boot post-upgrade.
   */
  private migrateLegacyAgentMeta(): void {
    const store: any = this.projectEngine.getStateStore();
    const db = store?.db;
    if (!db) return;
    // Each statement in its own try so a single failure doesn't skip the
    // others. All operations are conditional on legacy data existing.
    let keysRenamed = 0;
    let valuesUpdated = 0;
    try {
      keysRenamed = db.prepare(
        "UPDATE meta SET key = REPLACE(key, '_claude', '_anthropic') WHERE key LIKE 'assist_%_claude'"
      ).run().changes;
    } catch (e: any) {
      this.log.warn('legacy meta-key rename skipped', { error: e.message });
    }
    try {
      valuesUpdated = db.prepare(
        "UPDATE meta SET value = 'anthropic' WHERE key = 'assist_worker_agent' AND value = 'claude'"
      ).run().changes;
    } catch (e: any) {
      this.log.warn('legacy meta-value rewrite skipped', { error: e.message });
    }
    if (keysRenamed > 0 || valuesUpdated > 0) {
      this.log.info('legacy agent meta migrated', { keysRenamed, valuesUpdated });
    }
  }

  /**
   * Pre-warm: when a step starts that's routed to workers, fire a tick
   * immediately instead of waiting for the next 5s poll. Workers are CLI
   * subprocesses — Claude CLI alone takes ~8-10s to boot before it can
   * claim a task. By the time the pipeline finishes building the prompt
   * (~20-40s with librarian work), the worker is already polling claim_task
   * and grabs the task within milliseconds of it landing.
   *
   * The cooldown logic in handleAgent prevents over-firing — if a worker
   * is already running or fired recently, the eager tick is a no-op.
   */
  private bindPrewarmListeners(): void {
    try {
      const eventBus: any = (this.projectEngine as any).getEventBus?.();
      if (!eventBus) return;
      eventBus.on('step:started', (payload: any) => {
        // Only fire eagerly when the step's intended target is workers — we
        // don't know that until step-runner resolves it, so this is a best-
        // effort signal. The polling tick covers everything else within 5s.
        // Cheap check: if any worker isn't on cooldown, tick once.
        void this.tick();
      });
      this.log.info('prewarm listener bound to step:started');
    } catch (e: any) {
      this.log.warn('prewarm listener failed to bind (non-fatal)', { error: e.message });
    }
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.log.info('stopped');
  }

  private async tick(): Promise<void> {
    try {
      const store: any = this.projectEngine.getStateStore();
      const now = new Date().toISOString();
      const nowMs = Date.now();

      // Heartbeat directly into meta (no HTTP). Both agents tick simultaneously
      // because the coordinator's aliveness is what powers BOTH panels.
      for (const a of VALID_AGENTS) {
        store.setMeta(`assist_daemon_hb_${a}`, now);
      }

      // Stale-claim sweep: a worker that crashed mid-task leaves its row
      // stuck in `claimed` forever. Release anything claimed >1h without a
      // report so the coordinator can re-fire and the new worker can grab it.
      // Costs one UPDATE per 5s tick; idempotent when nothing's stale.
      try {
        // Stale-claim sweep: containerised workers usually complete a single
        // task in seconds. A claim still held after 5 min almost always means
        // the worker is stuck (Bash sandbox crash, MCP hang, container died)
        // — release the task so the next worker can retry rather than
        // waiting an hour for the previous 60min threshold.
        const released = store.releaseStaleTasks(5 * 60);
        if (released > 0) this.log.warn('released stale claimed tasks', { count: released });
      } catch (e: any) {
        this.log.error('releaseStaleTasks failed', { error: e.message });
      }

      // Archive open async-quality-audit tasks older than 24h. Without this
      // they accumulate forever when nobody runs /perry-worker — reviews of
      // long-past prose aren't worth the worker time. Runs every tick;
      // cheap (single UPDATE filtered to a small subset of payloads).
      try {
        const archived = store.archiveStaleAuditTasks(24 * 60 * 60);
        if (archived > 0) this.log.info('archived stale audit tasks (>24h)', { count: archived });
      } catch (e: any) {
        this.log.error('archiveStaleAuditTasks failed', { error: e.message });
      }

      // Pending count — ANY open worker-claimable task. The worker doc
      // (/perry-worker) handles all known task types (pipeline_step_assist,
      // voice_anchor_score, synthesize_pair, long_form_scene, ...). Workers
      // claim whatever's first regardless of type, so the coordinator should
      // fire whenever there's any open task, not just assist tasks.
      let pending = 0;
      if (store.usingSqlite && store.db) {
        try {
          pending = store.db.prepare(
            "SELECT COUNT(*) AS n FROM task_pool WHERE status='open'"
          ).get().n as number;
        } catch (e: any) {
          this.log.error('failed to query pending task count from SQLite', { error: e.message });
        }
      }

      // Daemon control: dashboard wrote a start/stop request? Honor + ack.
      for (const a of VALID_AGENTS) {
        const raw = store.getMeta(`daemon_control_${a}`);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          const ageSec = (nowMs - new Date(parsed.at).getTime()) / 1000;
          if (ageSec < 60) {
            const newMode = parsed.action === 'start' ? 'auto' : 'manual';
            store.setMeta(`assist_worker_mode_${a}`, newMode);
            this.log.info('daemon-control honored', { agent: a, action: parsed.action, newMode });
          }
        } catch (e: any) {
          this.log.warn('daemon-control meta parse failed (deleting corrupt row)', { agent: a, error: e.message });
        }
        store.removeMeta(`daemon_control_${a}`);
      }

      // Per-agent fire decision.
      for (const a of VALID_AGENTS) {
        await this.handleAgent(a, store, pending, nowMs);
      }
    } catch (e: any) {
      this.log.error('tick failed', { error: e.message });
    }
  }

  private async handleAgent(agent: Agent, store: any, pending: number, nowMs: number): Promise<void> {
    const mode    = store.getMeta(`assist_worker_mode_${agent}`) || 'manual';
    const fireReq = store.getMeta(`assist_fire_requested_at_${agent}`);
    const cooldownOk = (nowMs - this.state[agent].lastFireAt) >= this.cooldownSec * 1000;

    let shouldFire = false;
    let reason = '';

    if (fireReq) {
      const ageSec = (nowMs - new Date(fireReq).getTime()) / 1000;
      if (ageSec < 60) { shouldFire = true; reason = `manual (${Math.round(ageSec)}s ago)`; }
    }
    if (!shouldFire && mode === 'auto' && pending > 0 && cooldownOk) {
      shouldFire = true; reason = `auto-mode, ${pending} pending`;
    }
    if (!shouldFire) return;

    this.dispatchSpawn(agent, reason);
    this.state[agent].lastFireAt = nowMs;
    store.setMeta(`assist_last_fired_at_${agent}`, new Date(nowMs).toISOString());
    store.removeMeta(`assist_fire_requested_at_${agent}`);
  }

  private dispatchSpawn(agent: Agent, reason: string): void {
    const spec = AGENTS[agent];
    const id = `${agent}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Read per-agent CLI config (yolo + model) from meta and pass via signal.
    // Falls back to sensible defaults if config not set.
    const store: any = this.projectEngine.getStateStore();
    let config: { yolo: boolean; model: string } = {
      yolo: true,
      model: agent === 'antigrav' ? 'gemini-2.5-flash' : 'auto',
    };
    try {
      const raw = store.getMeta(`assist_worker_config_${agent}`);
      if (raw) config = { ...config, ...JSON.parse(raw) };
    } catch (e: any) {
      this.log.warn('assist worker config meta parse failed — falling back to defaults', { agent, error: e.message });
    }

    const payload = {
      id,
      agent,
      label: spec.label,
      reason,
      command: spec.hostCommand,
      config,
      working_dir: '/app',
      created_at: new Date().toISOString(),
    };

    if (!WORKER_URL) {
      this.log.error('spawn dropped — PERRY_WORKER_URL unset', { agent, reason });
      return;
    }
    void this.postToWorker(payload);
  }

  private async postToWorker(payload: any): Promise<void> {
    try {
      const res = await fetch(`${WORKER_URL}/spawn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(WORKER_SECRET ? { 'X-Perry-Worker-Secret': WORKER_SECRET } : {}),
        },
        body: JSON.stringify(payload),
        // Spawn is fire-and-forget on the listener side (202 returned
        // immediately) but we still want a short timeout in case the
        // worker container is hung.
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.log.error('perry-worker spawn rejected', { id: payload.id, status: res.status });
        return;
      }
      this.log.info('perry-worker spawn accepted', { agent: payload.agent, id: payload.id, reason: payload.reason });
    } catch (e: any) {
      this.log.error('perry-worker POST failed', { agent: payload.agent, error: e.message });
    }
  }
}
