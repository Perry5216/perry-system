/**
 * @perry/projects — State Store
 *
 * Project state persistence with SQLite (preferred) or JSON file fallback.
 * Every mutation is immediate — no debouncing, no data loss on crash.
 *
 * SQLite is preferred (WAL mode, transactional) but requires native
 * compilation. When it's unavailable (e.g., Windows without build tools),
 * the store falls back to a JSON file with synchronous writes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Project, ProjectStep, Logger } from '@perry/core';

export class StateStore {
  private db: any = null;
  private jsonPath: string;
  private log: Logger;
  private cache = new Map<string, Project>();
  private metaCache = new Map<string, string>();
  private nextId = 1;
  private usingSqlite = false;

  constructor(workspaceDir: string, log: Logger) {
    const configDir = join(workspaceDir, '.config');
    mkdirSync(configDir, { recursive: true });
    this.jsonPath = join(configDir, 'projects.json');
    this.log = log;
  }

  async initialize(): Promise<void> {
    // Try SQLite first
    try {
      const mod: any = await import('better-sqlite3');
      const Database: any = mod.default || mod;
      const dbPath = this.jsonPath.replace('.json', '.db');
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.applySchema();
      this.loadAllFromDb();
      this.usingSqlite = true;

      // Migrate from JSON to SQLite if DB is empty but JSON has data
      if (this.cache.size === 0 && existsSync(this.jsonPath)) {
        this.log.info('Migrating existing projects.json to SQLite database');
        this.loadAllFromJson(); // loads into cache and sets nextId
        // Save everything to SQLite
        for (const project of this.cache.values()) {
          this.save(project);
        }
        // Force update the next_id meta
        this.db.prepare(
          "INSERT INTO meta (key, value) VALUES ('next_id', @v) ON CONFLICT(key) DO UPDATE SET value = @v"
        ).run({ v: String(this.nextId) });
        this.log.info('Migration complete', { projectsMigrated: this.cache.size });
      }

      // Phase 2: typed pen_names / lora_versions tables are the source of
      // truth — the trainer (Python) writes them directly. We still sync from
      // the legacy meta['pen_name_records'] blob ONCE, as a bootstrap, when the
      // typed tables are empty (covers upgrade from Phase 0 deployments and
      // disaster-recovery imports). After that the blob is no longer consulted.
      this.bootstrapPenNamesFromMetaIfEmpty();

      this.log.info('State store initialized (SQLite)', { projects: this.cache.size });
      return;
    } catch (err: any) {
      console.error('SQLITE LOAD ERROR:', err);
      this.log.info('SQLite unavailable, using JSON fallback');
    }

    // Fallback to JSON
    this.loadAllFromJson();
    this.log.info('State store initialized (JSON)', { projects: this.cache.size });
  }

  private applySchema(): void {
    // Check current schema version
    let currentVersion = 0;
    try {
      const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as any;
      if (row) currentVersion = parseInt(row.value, 10);
    } catch { /* meta table may not exist yet */ }

    // Migration 0 → 1: Initial schema
    if (currentVersion < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY, data TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS steps (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
          label TEXT NOT NULL, phase TEXT, task_type TEXT, chapter_number INTEGER,
          status TEXT NOT NULL, result TEXT, prompt TEXT,
          started_at TEXT, completed_at TEXT, error TEXT
        );
        CREATE TABLE IF NOT EXISTS step_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          step_id TEXT NOT NULL,
          previous_result TEXT NOT NULL,
          archived_at TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(step_id, project_id, content);
        CREATE TABLE IF NOT EXISTS llm_telemetry (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL, step_id TEXT NOT NULL,
          system_prompt TEXT NOT NULL, user_prompt TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      currentVersion = 1;
    }

    // Migration 1 → 2: Add indexes + telemetry index
    if (currentVersion < 2) {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_steps_project ON steps(project_id);
        CREATE INDEX IF NOT EXISTS idx_steps_status ON steps(status);
        CREATE INDEX IF NOT EXISTS idx_telemetry_created ON llm_telemetry(created_at);
        CREATE INDEX IF NOT EXISTS idx_telemetry_project ON llm_telemetry(project_id);
      `);
      currentVersion = 2;
    }

    // Migration 2 → 3: Fix cross-project step ID conflicts
    if (currentVersion < 3) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS steps_v3 (
          id TEXT NOT NULL, project_id TEXT NOT NULL,
          label TEXT NOT NULL, phase TEXT, task_type TEXT, chapter_number INTEGER,
          status TEXT NOT NULL, result TEXT, prompt TEXT,
          started_at TEXT, completed_at TEXT, error TEXT,
          PRIMARY KEY (project_id, id)
        );
        INSERT OR IGNORE INTO steps_v3 SELECT * FROM steps;
        DROP TABLE steps;
        ALTER TABLE steps_v3 RENAME TO steps;

        DROP TABLE IF EXISTS step_history;
        CREATE TABLE IF NOT EXISTS step_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL,
          step_id TEXT NOT NULL,
          previous_result TEXT NOT NULL,
          archived_at TEXT NOT NULL
        );
      `);
      currentVersion = 3;
    }

    // Migration 3 → 4: Add project_chats for AI Director
    if (currentVersion < 4) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS project_chats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chats_project ON project_chats(project_id);
      `);
      currentVersion = 4;
    }

    // Migration 4 → 5: Typed pen_names + lora_versions tables (Phase 0 pen-name migration).
    // These are denormalized projections of meta['pen_name_records']. The JSON blob
    // remains the write target for now (trainer writes it directly from Python); these
    // tables are refreshed from the blob on every state-store initialize().
    if (currentVersion < 5) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS pen_names (
          slug TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          genre_or_series TEXT,
          voice_tagline TEXT,
          base_model TEXT,
          current_lora_version INTEGER,
          created_at TEXT,
          data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS lora_versions (
          pen_slug TEXT NOT NULL,
          version INTEGER NOT NULL,
          ollama_tag TEXT,
          currently_registered_as TEXT,
          lora_gguf_path TEXT,
          lora_adapter_path TEXT,
          training_pairs INTEGER,
          training_steps INTEGER,
          epochs INTEGER,
          final_loss REAL,
          lora_rank INTEGER,
          max_length INTEGER,
          trained_at TEXT,
          promoted INTEGER DEFAULT 0,
          data TEXT NOT NULL,
          PRIMARY KEY (pen_slug, version)
        );
        CREATE INDEX IF NOT EXISTS idx_lora_pen ON lora_versions(pen_slug);
      `);
      currentVersion = 5;
    }

    // Migration 5 → 6: task_pool — coordination queue for parallel Claude
    // worker chats. Coordinator enqueues, workers claim atomically, report
    // results. Schema is intentionally minimal: type+payload are opaque JSON
    // so future task kinds don't require migrations.
    if (currentVersion < 6) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS task_pool (
          id TEXT PRIMARY KEY,
          pen_slug TEXT,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          claimed_by TEXT,
          claimed_at TEXT,
          result TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_task_status ON task_pool(status, type);
        CREATE INDEX IF NOT EXISTS idx_task_pen ON task_pool(pen_slug);
      `);
      currentVersion = 6;
    }

    // Migration 6 → 7: prompt_override column on steps. The original `prompt`
    // column was being treated as both "stored at project creation" and "the
    // active execute-time prompt." That's why template fixes never propagated
    // to existing projects — the stale stored prompt always won. Now: `prompt`
    // is the historical snapshot, `prompt_override` is set by mutators
    // (POV-gate retries, manual edits) and takes precedence at execute time.
    // When neither override nor stale-prompt-from-template applies, the
    // step-runner regenerates fresh from the template registry.
    if (currentVersion < 7) {
      const cols = this.db.prepare("PRAGMA table_info(steps)").all() as any[];
      const has = (name: string) => cols.some(c => c.name === name);
      if (!has('prompt_override')) {
        this.db.exec(`ALTER TABLE steps ADD COLUMN prompt_override TEXT`);
      }
      currentVersion = 7;
    }

    // Migration 7 → 8: Agent system foundation. See below.
    if (currentVersion < 8) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS agent_sessions (
          id TEXT PRIMARY KEY,
          domain TEXT NOT NULL DEFAULT 'books',
          project_id TEXT,
          pen_slug TEXT,
          created_at TEXT NOT NULL,
          closed_at TEXT,
          title TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(project_id);
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_domain ON agent_sessions(domain);

        CREATE TABLE IF NOT EXISTS agent_invocations (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          parent_invocation_id TEXT,
          agent_id TEXT NOT NULL,
          domain TEXT NOT NULL DEFAULT 'books',
          status TEXT NOT NULL DEFAULT 'pending',
          worker_class TEXT,
          model TEXT,
          input TEXT,
          output TEXT,
          tool_calls TEXT,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          cost_usd REAL,
          error TEXT,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_agent_invocations_session ON agent_invocations(session_id);
        CREATE INDEX IF NOT EXISTS idx_agent_invocations_agent ON agent_invocations(agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_invocations_status ON agent_invocations(status);

        CREATE TABLE IF NOT EXISTS agent_trajectories (
          id TEXT PRIMARY KEY,
          invocation_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          domain TEXT NOT NULL,
          pen_slug TEXT,
          worker_class TEXT,
          model TEXT NOT NULL,
          messages TEXT NOT NULL,
          tool_calls TEXT,
          outcome TEXT,
          quality_score REAL,
          rated_by TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_traj_agent ON agent_trajectories(agent_id);
        CREATE INDEX IF NOT EXISTS idx_traj_outcome ON agent_trajectories(outcome);
        CREATE INDEX IF NOT EXISTS idx_traj_domain ON agent_trajectories(domain);
      `);
      currentVersion = 8;
    }

    // Migration 8 → 9: secrets audit log. See below.
    if (currentVersion < 9) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS secrets_audit (
          id TEXT PRIMARY KEY,
          secret_name TEXT NOT NULL,
          action TEXT NOT NULL,
          caller TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_secrets_audit_name ON secrets_audit(secret_name);
        CREATE INDEX IF NOT EXISTS idx_secrets_audit_created ON secrets_audit(created_at);
      `);
      currentVersion = 9;
    }

    // Migration 9 → 10: Discord moderation audit log. Every kick/ban/timeout/
    // delete/slowmode action issued through the Director's mod tools writes
    // a row here. Lets you scroll back through "what did Perry do on my
    // server" and supports the dashboard's mod-actions surface later.
    if (currentVersion < 10) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS discord_mod_actions (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          guild_id TEXT,
          channel_id TEXT,
          target_user_id TEXT,
          target_message_id TEXT,
          actor TEXT,
          reason TEXT,
          metadata TEXT,
          success INTEGER NOT NULL,
          error TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_discord_mod_action ON discord_mod_actions(action);
        CREATE INDEX IF NOT EXISTS idx_discord_mod_guild ON discord_mod_actions(guild_id);
        CREATE INDEX IF NOT EXISTS idx_discord_mod_created ON discord_mod_actions(created_at);
      `);
      currentVersion = 10;
    }

    // Persist current schema version
    this.db.prepare(
      "INSERT INTO meta (key, value) VALUES ('schema_version', @v) ON CONFLICT(key) DO UPDATE SET value = @v"
    ).run({ v: String(currentVersion) });
  }

  // ── Key-Value Meta Storage ─────────────────────────────

  /** Read a value from the meta table. Returns undefined if not found. */
  getMeta(key: string): string | undefined {
    if (this.usingSqlite && this.db) {
      try {
        const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as any;
        return row?.value;
      } catch { return undefined; }
    }
    return this.metaCache.get(key);
  }

  /** Delete a meta key. Used by cross-process breadcrumb consumers. */
  removeMeta(key: string): void {
    if (this.usingSqlite && this.db) {
      try {
        this.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
      } catch (err: any) {
        this.log.error('Failed to remove meta', { key, error: err.message });
      }
    } else {
      this.metaCache.delete(key);
      this.persistJson();
    }
  }

  /**
   * List meta keys matching a prefix. Used by cross-process consumers
   * draining breadcrumb queues (e.g. dashboard-api picking up
   * worker_done_* entries written by mcp-server).
   */
  listMetaKeysByPrefix(prefix: string, limit = 100): string[] {
    if (this.usingSqlite && this.db) {
      try {
        const rows = this.db.prepare(
          'SELECT key FROM meta WHERE key LIKE ? ORDER BY key LIMIT ?'
        ).all(`${prefix}%`, limit) as any[];
        return rows.map(r => r.key);
      } catch { return []; }
    }
    const out: string[] = [];
    for (const k of this.metaCache.keys()) {
      if (k.startsWith(prefix)) out.push(k);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Look up a step's task_type without loading the full project. Used by
   * lightweight observers (e.g. director skill proposer) that only need
   * the taskType for fingerprinting.
   *
   * BUG history: this previously took only `stepId`, but step IDs are
   * NOT unique across projects (the steps table's primary key is
   * `(project_id, id)`). A bare `WHERE id = ?` LIMIT 1 returned whichever
   * project's step-N SQLite happened to surface first — usually the OLDEST
   * project — so learning observations got tagged with the wrong project's
   * task_type. Two args closes that gap; legacy single-arg callers should
   * migrate.
   */
  findStepTaskType(projectId: string, stepId: string): string | undefined {
    if (!this.usingSqlite || !this.db) return undefined;
    try {
      const row = this.db.prepare('SELECT task_type FROM steps WHERE project_id = ? AND id = ?').get(projectId, stepId) as any;
      return row?.task_type ?? undefined;
    } catch { return undefined; }
  }

  /** Write a value to the meta table. */
  setMeta(key: string, value: string): void {
    if (this.usingSqlite && this.db) {
      try {
        this.db.prepare(
          'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
        ).run(key, value, value);
      } catch (err: any) {
        this.log.error('Failed to write meta', { key, error: err.message });
      }
    } else {
      this.metaCache.set(key, value);
      this.persistJson();
    }
  }

  private loadAllFromDb(): void {
    const rows = this.db.prepare('SELECT id, data FROM projects').all() as any[];
    for (const row of rows) {
      try {
        const project: Project = JSON.parse(row.data);

        // Hydrate step results/prompts/overrides from the steps table.
        // The project blob strips these to save space (see save()).
        const stepRows = this.db.prepare(
          'SELECT id, result, prompt, prompt_override FROM steps WHERE project_id = ?'
        ).all(project.id) as any[];

        if (stepRows.length > 0) {
          const stepMap = new Map<string, { result: string | null; prompt: string; promptOverride: string | null }>();
          for (const sr of stepRows) {
            stepMap.set(sr.id, { result: sr.result, prompt: sr.prompt, promptOverride: sr.prompt_override });
          }
          for (const step of project.steps) {
            const stored = stepMap.get(step.id);
            if (stored) {
              if (!step.result && stored.result) step.result = stored.result;
              if (!step.prompt && stored.prompt) step.prompt = stored.prompt;
              if (!step.promptOverride && stored.promptOverride) step.promptOverride = stored.promptOverride;
            }
          }
        }

        this.cache.set(project.id, project);
      } catch {
        this.log.warn('Corrupt project record', { id: row.id });
      }
    }
    const idRow = this.db.prepare("SELECT value FROM meta WHERE key = 'next_id'").get() as any;
    if (idRow) this.nextId = parseInt(idRow.value, 10);
  }

  private loadAllFromJson(): void {
    if (!existsSync(this.jsonPath)) return;
    try {
      const raw = readFileSync(this.jsonPath, 'utf-8');
      const data = JSON.parse(raw);
      for (const project of (data.projects || [])) {
        this.cache.set(project.id, project);
      }
      if (data.meta) {
        for (const [k, v] of Object.entries(data.meta)) {
          this.metaCache.set(k, v as string);
        }
      }
      this.nextId = data.nextId || this.cache.size + 1;
    } catch {
      this.log.warn('Corrupt JSON state file, starting fresh');
    }
  }

  private persistJson(): void {
    if (this.usingSqlite) return;
    const metaObj: Record<string, string> = {};
    for (const [k, v] of this.metaCache.entries()) metaObj[k] = v;
    
    const data = {
      nextId: this.nextId,
      meta: metaObj,
      projects: Array.from(this.cache.values()),
    };
    writeFileSync(this.jsonPath, JSON.stringify(data, null, 2));
  }

  getNextId(): number {
    const id = this.nextId++;
    if (this.usingSqlite) {
      this.db.prepare(
        "INSERT INTO meta (key, value) VALUES ('next_id', @v) ON CONFLICT(key) DO UPDATE SET value = @v"
      ).run({ v: String(this.nextId) });
    } else {
      this.persistJson();
    }
    return id;
  }

  // ── CRUD ────────────────────────────────────────────────

  save(project: Project): void {
    project.updatedAt = new Date().toISOString();
    this.cache.set(project.id, project);
    if (this.usingSqlite) {
      // Strip heavy fields from the JSON blob to avoid duplicating data
      // that's already stored in the `steps` table and on disk as markdown.
      // The in-memory cache retains the full project object.
      const leanProject = {
        ...project,
        steps: project.steps.map(s => ({
          ...s,
          result: undefined,   // stored in `steps` table + disk
          prompt: undefined,   // stored in `steps` table
        })),
      };

      this.db.prepare(`
        INSERT INTO projects (id, data, created_at, updated_at)
        VALUES (@id, @data, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `).run({
        id: project.id,
        data: JSON.stringify(leanProject),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });

      const stepInsert = this.db.prepare(`
        INSERT INTO steps (id, project_id, label, phase, task_type, chapter_number, status, result, prompt, prompt_override, started_at, completed_at, error)
        VALUES (@id, @projectId, @label, @phase, @taskType, @chapterNumber, @status, @result, @prompt, @promptOverride, @startedAt, @completedAt, @error)
        ON CONFLICT(project_id, id) DO UPDATE SET
          status = excluded.status, result = excluded.result, prompt = excluded.prompt, prompt_override = excluded.prompt_override,
          started_at = excluded.started_at, completed_at = excluded.completed_at, error = excluded.error
      `);
      this.db.transaction(() => {
        for (const step of project.steps) {
          stepInsert.run({
            id: step.id, projectId: project.id, label: step.label, phase: step.phase || null,
            taskType: step.taskType, chapterNumber: step.chapterNumber || null,
            status: step.status, result: step.result || null, prompt: step.prompt,
            promptOverride: step.promptOverride || null,
            startedAt: step.startedAt || null, completedAt: step.completedAt || null, error: step.error || null
          });
        }
      })();
    } else {
      this.persistJson();
    }
  }

  get(id: string): Project | undefined {
    return this.cache.get(id);
  }

  list(status?: string): Project[] {
    const all = Array.from(this.cache.values());
    if (!status) return all;
    return all.filter(p => p.status === status);
  }

  delete(id: string): boolean {
    const existed = this.cache.delete(id);
    if (existed) {
      if (this.usingSqlite) {
        this.db.transaction(() => {
          this.db.prepare('DELETE FROM step_history WHERE project_id = @id').run({ id });
          this.db.prepare('DELETE FROM steps WHERE project_id = @id').run({ id });
          this.db.prepare('DELETE FROM llm_telemetry WHERE project_id = @id').run({ id });
          this.db.prepare('DELETE FROM search_index WHERE project_id = @id').run({ id });
          this.db.prepare('DELETE FROM projects WHERE id = @id').run({ id });
        })();
      } else {
        this.persistJson();
      }
    }
    return existed;
  }

  /**
   * Purge any SQLite records (steps, telemetry, history) that belong to projects
   * no longer present in the `projects` table.
   */
  purgeGhostSqliteData(): number {
    if (!this.usingSqlite) return 0;
    
    let purged = 0;
    this.db.transaction(() => {
      // 1. Delete step_history for steps that no longer exist or belong to non-existent projects
      const res1 = this.db.prepare(`
        DELETE FROM step_history 
        WHERE step_id NOT IN (
          SELECT steps.id FROM steps 
          JOIN projects ON steps.project_id = projects.id
        )
      `).run();
      purged += res1.changes;

      // 2. Delete steps for non-existent projects
      const res2 = this.db.prepare(`
        DELETE FROM steps WHERE project_id NOT IN (SELECT id FROM projects)
      `).run();
      purged += res2.changes;

      // 3. Delete telemetry for non-existent projects
      const res3 = this.db.prepare(`
        DELETE FROM llm_telemetry WHERE project_id NOT IN (SELECT id FROM projects)
      `).run();
      purged += res3.changes;
      
      // 4. Clean up full text search index
      try {
        const res4 = this.db.prepare(`
          DELETE FROM search_index WHERE project_id NOT IN (SELECT id FROM projects)
        `).run();
        purged += res4.changes;
      } catch (err) {
        // search_index might not support this directly depending on fts5 setup
      }
    })();
    
    return purged;
  }


  // ── Chat History (AI Director) ──────────────────────────

  saveChatMessage(projectId: string, role: string, content: string): void {
    if (!this.usingSqlite) return;
    try {
      this.db.prepare(`
        INSERT INTO project_chats (project_id, role, content, created_at)
        VALUES (@projectId, @role, @content, @createdAt)
      `).run({
        projectId,
        role,
        content,
        createdAt: new Date().toISOString()
      });
    } catch (err: any) {
      this.log.error('Failed to save chat message', { error: err.message });
    }
  }

  getChatHistory(projectId: string): { role: string, content: string }[] {
    if (!this.usingSqlite) return [];
    try {
      const rows = this.db.prepare(`
        SELECT role, content
        FROM project_chats
        WHERE project_id = @projectId
        ORDER BY id ASC
      `).all({ projectId }) as any[];
      return rows.map(r => ({ role: r.role, content: r.content }));
    } catch (err: any) {
      this.log.error('Failed to get chat history', { error: err.message });
      return [];
    }
  }

  clearChatHistory(projectId: string): void {
    if (!this.usingSqlite) return;
    try {
      this.db.prepare('DELETE FROM project_chats WHERE project_id = @projectId').run({ projectId });
    } catch (err: any) {
      this.log.error('Failed to clear chat history', { error: err.message });
    }
  }

  // ── Step Operations ─────────────────────────────────────

  completeStep(projectId: string, stepId: string, result: string): ProjectStep | null {
    const project = this.cache.get(projectId);
    if (!project) return null;
    const step = project.steps.find(s => s.id === stepId);
    if (!step) return null;

    // Archive previous result if it exists (Version History)
    if (this.usingSqlite && step.result && step.result !== result) {
      try {
        this.db.prepare(`
          INSERT INTO step_history (project_id, step_id, previous_result, archived_at)
          VALUES (@projectId, @stepId, @previousResult, @archivedAt)
        `).run({
          projectId: project.id,
          stepId: step.id,
          previousResult: step.result,
          archivedAt: new Date().toISOString()
        });
      } catch (err: any) {
        this.log.warn('Failed to archive step history', { error: err.message });
      }
    }

    step.status = 'completed';
    step.result = result;
    step.completedAt = new Date().toISOString();

    const completed = project.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
    project.progress = Math.round((completed / project.steps.length) * 100);

    if (completed === project.steps.length) {
      project.status = 'completed';
      project.completedAt = new Date().toISOString();
    }

    this.save(project);

    // Update FTS Index
    if (this.usingSqlite) {
      try {
        this.db.transaction(() => {
          this.db.prepare('DELETE FROM search_index WHERE project_id = @projectId AND step_id = @id').run({ projectId: project.id, id: step.id });
          this.db.prepare('INSERT INTO search_index (step_id, project_id, content) VALUES (@id, @projectId, @content)').run({
            id: step.id, projectId: project.id, content: result
          });
        })();
      } catch (err: any) {
        this.log.warn('Failed to update FTS search index', { error: err.message });
      }
    }

    this.log.info('Step completed', { projectId, stepId, progress: `${project.progress}%` });
    return step;
  }

  recordTelemetry(projectId: string, stepId: string, systemPrompt: string, userPrompt: string): void {
    if (!this.usingSqlite) return;
    try {
      this.db.prepare(`
        INSERT INTO llm_telemetry (project_id, step_id, system_prompt, user_prompt, created_at)
        VALUES (@projectId, @stepId, @systemPrompt, @userPrompt, @createdAt)
      `).run({
        projectId, stepId, systemPrompt, userPrompt,
        createdAt: new Date().toISOString()
      });
    } catch (err: any) {
      this.log.warn('Failed to record LLM telemetry', { error: err.message });
    }
  }

  /**
   * Retrieve the most recent telemetry record for a given step.
   * Returns the system prompt, user prompt (input), and timestamp.
   */
  getTelemetry(projectId: string, stepId: string): { systemPrompt: string; userPrompt: string; createdAt: string } | null {
    if (!this.usingSqlite) return null;
    try {
      const row = this.db.prepare(`
        SELECT system_prompt, user_prompt, created_at
        FROM llm_telemetry
        WHERE project_id = @projectId AND step_id = @stepId
        ORDER BY id DESC LIMIT 1
      `).get({ projectId, stepId }) as any;
      if (!row) return null;
      return {
        systemPrompt: row.system_prompt,
        userPrompt: row.user_prompt,
        createdAt: row.created_at,
      };
    } catch (err: any) {
      this.log.warn('Failed to read LLM telemetry', { error: err.message });
      return null;
    }
  }

  /**
   * Purge old telemetry records. Called during garbage collection.
   * Keeps the last `retainDays` of records, deletes everything older.
   */
  purgeTelemetry(retainDays: number = 30): number {
    if (!this.usingSqlite) return 0;
    try {
      const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000).toISOString();
      const result = this.db.prepare('DELETE FROM llm_telemetry WHERE created_at < @cutoff').run({ cutoff });
      if (result.changes > 0) {
        this.log.info('Telemetry purged', { deletedRows: result.changes, retainDays });
      }
      return result.changes;
    } catch (err: any) {
      this.log.warn('Failed to purge telemetry', { error: err.message });
      return 0;
    }
  }

  failStep(projectId: string, stepId: string, error: string): void {
    const project = this.cache.get(projectId);
    if (!project) return;
    const step = project.steps.find(s => s.id === stepId);
    if (!step) return;
    step.status = 'failed';
    step.error = error;
    project.status = 'paused';
    this.save(project);
    this.log.warn('Step failed, project paused', { projectId, stepId, error });
  }

  startStep(projectId: string, stepId: string): ProjectStep | null {
    const project = this.cache.get(projectId);
    if (!project) return null;
    const step = project.steps.find(s => s.id === stepId);
    if (!step) return null;
    step.status = 'active';
    step.startedAt = new Date().toISOString();
    project.status = 'active';
    this.save(project);
    return step;
  }

  getNextPendingStep(projectId: string): ProjectStep | null {
    const project = this.cache.get(projectId);
    if (!project) return null;
    return project.steps.find(s => s.status === 'pending') || null;
  }

  /**
   * Run VACUUM to reclaim freed space after deletions/GC.
   * Should only be called when no pipeline is executing.
   */
  vacuum(): void {
    if (!this.usingSqlite) return;
    try {
      this.db.exec('VACUUM');
      this.log.info('Database VACUUM completed');
    } catch (err: any) {
      this.log.warn('VACUUM failed', { error: err.message });
    }
  }

  close(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
    }
  }

  // ── Pen-name typed tables (Phase 0 schema, Phase 2 sole-truth) ─────────────
  // The Python trainer (watch-and-train.sh) writes these tables directly post-
  // Phase 1. The legacy meta['pen_name_records'] blob is consulted only as a
  // one-shot bootstrap if the typed tables are empty — useful when restoring
  // from an older snapshot or migrating from a Phase 0 deployment.

  /** Bootstrap typed pen-name tables from the legacy JSON blob if they are empty. */
  private bootstrapPenNamesFromMetaIfEmpty(): void {
    if (!this.usingSqlite || !this.db) return;
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM pen_names').get() as any;
      if (row && row.n > 0) return; // typed tables already populated — Phase 2 truth is authoritative
    } catch {
      return; // pen_names table not yet created (migration hasn't run); nothing to do
    }
    this.log.info('Pen-name tables empty — bootstrapping from legacy meta[pen_name_records]');
    this.syncPenNamesFromMeta();
  }

  private syncPenNamesFromMeta(): void {
    if (!this.usingSqlite || !this.db) return;
    const raw = this.getMeta('pen_name_records');
    if (!raw) return;

    let rec: any;
    try { rec = JSON.parse(raw); }
    catch (err: any) {
      this.log.warn('pen_name_records is not valid JSON; skipping typed sync', { error: err.message });
      return;
    }

    const pens: any[] = Array.isArray(rec.penNames) ? rec.penNames : [];
    if (!pens.length) return;

    const insertPen = this.db.prepare(`
      INSERT INTO pen_names (slug, display_name, genre_or_series, voice_tagline,
                             base_model, current_lora_version, created_at, data)
      VALUES (@slug, @display_name, @genre_or_series, @voice_tagline,
              @base_model, @current_lora_version, @created_at, @data)
      ON CONFLICT(slug) DO UPDATE SET
        display_name=excluded.display_name,
        genre_or_series=excluded.genre_or_series,
        voice_tagline=excluded.voice_tagline,
        base_model=excluded.base_model,
        current_lora_version=excluded.current_lora_version,
        created_at=excluded.created_at,
        data=excluded.data
    `);
    const insertLora = this.db.prepare(`
      INSERT INTO lora_versions (pen_slug, version, ollama_tag, currently_registered_as,
                                 lora_gguf_path, lora_adapter_path,
                                 training_pairs, training_steps, epochs, final_loss,
                                 lora_rank, max_length, trained_at, promoted, data)
      VALUES (@pen_slug, @version, @ollama_tag, @currently_registered_as,
              @lora_gguf_path, @lora_adapter_path,
              @training_pairs, @training_steps, @epochs, @final_loss,
              @lora_rank, @max_length, @trained_at, @promoted, @data)
      ON CONFLICT(pen_slug, version) DO UPDATE SET
        ollama_tag=excluded.ollama_tag,
        currently_registered_as=excluded.currently_registered_as,
        lora_gguf_path=excluded.lora_gguf_path,
        lora_adapter_path=excluded.lora_adapter_path,
        training_pairs=excluded.training_pairs,
        training_steps=excluded.training_steps,
        epochs=excluded.epochs,
        final_loss=excluded.final_loss,
        lora_rank=excluded.lora_rank,
        max_length=excluded.max_length,
        trained_at=excluded.trained_at,
        promoted=excluded.promoted,
        data=excluded.data
    `);

    const tx = this.db.transaction(() => {
      for (const p of pens) {
        if (!p || typeof p.slug !== 'string') continue;
        insertPen.run({
          slug: p.slug,
          display_name: p.displayName ?? p.slug,
          genre_or_series: p.genreOrSeries ?? null,
          voice_tagline: p.voiceTagline ?? null,
          base_model: p.baseModel ?? null,
          current_lora_version: typeof p.currentLoraVersion === 'number' ? p.currentLoraVersion : null,
          created_at: p.createdAt ?? null,
          data: JSON.stringify(p),
        });
        const versions: any[] = Array.isArray(p.loraVersions) ? p.loraVersions : [];
        for (const v of versions) {
          if (!v || typeof v.version !== 'number') continue;
          insertLora.run({
            pen_slug: p.slug,
            version: v.version,
            ollama_tag: v.ollamaTag ?? null,
            currently_registered_as: v.currentlyRegisteredAs ?? null,
            lora_gguf_path: v.loraGgufPath ?? null,
            lora_adapter_path: v.loraAdapterPath ?? null,
            training_pairs: typeof v.trainingPairs === 'number' ? v.trainingPairs : null,
            training_steps: typeof v.trainingSteps === 'number' ? v.trainingSteps : null,
            epochs: typeof v.epochs === 'number' ? v.epochs : null,
            final_loss: typeof v.finalLoss === 'number' ? v.finalLoss : null,
            lora_rank: typeof v.loraRank === 'number' ? v.loraRank : null,
            max_length: typeof v.maxLength === 'number' ? v.maxLength : null,
            trained_at: v.trainedAt ?? null,
            promoted: v.promoted ? 1 : 0,
            data: JSON.stringify(v),
          });
        }
      }
    });

    try {
      tx();
      this.log.info('Pen-name tables synced from meta', {
        pens: pens.length,
        loraVersions: pens.reduce((n, p) => n + (Array.isArray(p.loraVersions) ? p.loraVersions.length : 0), 0),
      });
    } catch (err: any) {
      this.log.warn('Failed to sync pen-name tables', { error: err.message });
    }
  }

  /** List all registered pen names (typed read; empty array if JSON blob has not been synced). */
  getPenNames(): PenNameRow[] {
    if (!this.usingSqlite || !this.db) return [];
    const rows = this.db.prepare('SELECT * FROM pen_names ORDER BY slug').all() as any[];
    return rows.map(rowToPenName);
  }

  /** Get a single pen-name record by slug, or null if not found. */
  getPenName(slug: string): PenNameRow | null {
    if (!this.usingSqlite || !this.db) return null;
    const row = this.db.prepare('SELECT * FROM pen_names WHERE slug = ?').get(slug) as any;
    return row ? rowToPenName(row) : null;
  }

  /** List all LoRA versions for a pen (ascending by version). */
  getLoraVersions(penSlug: string): LoraVersionRow[] {
    if (!this.usingSqlite || !this.db) return [];
    const rows = this.db.prepare(
      'SELECT * FROM lora_versions WHERE pen_slug = ? ORDER BY version'
    ).all(penSlug) as any[];
    return rows.map(rowToLoraVersion);
  }

  /** Resolve the LoRA version currently active for a pen. */
  getCurrentLora(penSlug: string): LoraVersionRow | null {
    if (!this.usingSqlite || !this.db) return null;
    const row = this.db.prepare(`
      SELECT lv.* FROM lora_versions lv
      JOIN pen_names pn ON pn.slug = lv.pen_slug
      WHERE lv.pen_slug = ? AND lv.version = pn.current_lora_version
    `).get(penSlug) as any;
    return row ? rowToLoraVersion(row) : null;
  }

  /**
   * Set a single named field on pen_names.data (the JSON blob) without
   * touching the other fields. Returns true if the pen exists and was
   * updated, false otherwise. Used by AuditService to write priorityTags
   * without clobbering antiPatterns and vice versa.
   */
  updatePenDataField(penSlug: string, field: string, value: unknown): boolean {
    if (!this.usingSqlite || !this.db) return false;
    const row = this.db.prepare('SELECT data FROM pen_names WHERE slug = ?').get(penSlug) as any;
    if (!row) return false;
    let doc: any;
    try { doc = JSON.parse(row.data || '{}'); } catch { doc = {}; }
    doc[field] = value;
    this.db.prepare('UPDATE pen_names SET data = ? WHERE slug = ?').run(JSON.stringify(doc), penSlug);
    return true;
  }

  /**
   * Replace the antiPatterns array stored in pen_names.data for the given pen.
   * Returns true if the pen exists and was updated, false otherwise.
   */
  updatePenAntiPatterns(penSlug: string, patterns: string[]): boolean {
    if (!this.usingSqlite || !this.db) return false;
    const row = this.db.prepare('SELECT data FROM pen_names WHERE slug = ?').get(penSlug) as any;
    if (!row) return false;
    let doc: any;
    try {
      doc = JSON.parse(row.data || '{}');
    } catch {
      doc = {};
    }
    doc.antiPatterns = patterns;
    this.db.prepare('UPDATE pen_names SET data = ? WHERE slug = ?').run(JSON.stringify(doc), penSlug);
    return true;
  }

  /**
   * Promote a LoRA version to be the pen's current writer model.
   *
   * - sets pen_names.current_lora_version = version
   * - sets lora_versions.promoted = 1 for that row (history flag — others stay
   *   as-is so we can see which versions have ever been promoted)
   * - returns true on success, false if the row doesn't exist
   *
   * The pen-name-resolver reads current_lora_version on every writer request,
   * so this swap takes effect for subsequent generations with no restart.
   */
  promoteLoraVersion(penSlug: string, version: number): boolean {
    if (!this.usingSqlite || !this.db) return false;
    const exists = this.db.prepare(
      'SELECT 1 FROM lora_versions WHERE pen_slug = ? AND version = ?'
    ).get(penSlug, version);
    if (!exists) return false;
    const tx = this.db.transaction(() => {
      this.db!.prepare(
        'UPDATE pen_names SET current_lora_version = ? WHERE slug = ?'
      ).run(version, penSlug);
      this.db!.prepare(
        'UPDATE lora_versions SET promoted = 1 WHERE pen_slug = ? AND version = ?'
      ).run(penSlug, version);
    });
    tx();
    return true;
  }

  // ── task_pool: parallel-worker coordination queue ─────────────────────
  // Coordinator enqueues; workers atomically claim the oldest open task of
  // a matching type; workers report done/failed when finished. Payload and
  // result are opaque JSON blobs so adding a new task type requires no
  // schema change.

  enqueueTasks(type: string, payloads: unknown[], penSlug?: string): string[] {
    if (!this.usingSqlite || !this.db || payloads.length === 0) return [];
    const now = new Date().toISOString();
    const ids: string[] = [];
    const insert = this.db.prepare(
      `INSERT INTO task_pool (id, pen_slug, type, payload, status, created_at)
       VALUES (?, ?, ?, ?, 'open', ?)`
    );
    const tx = this.db.transaction(() => {
      for (const p of payloads) {
        const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
        insert.run(id, penSlug || null, type, JSON.stringify(p), now);
        ids.push(id);
      }
    });
    tx();
    return ids;
  }

  /**
   * Atomically claim the oldest open task that matches the filter, marking it
   * 'claimed' and stamping the worker_id + claimed_at. Returns null if there
   * are no open tasks. Uses UPDATE...RETURNING which sqlite3 supports for
   * single-row claim atomicity.
   */
  claimTask(workerId: string, opts: { typeFilter?: string; penSlug?: string } = {}): TaskPoolRow | null {
    if (!this.usingSqlite || !this.db) return null;
    const now = new Date().toISOString();
    const conds: string[] = ["status = 'open'"];
    const params: any[] = [];
    if (opts.typeFilter) { conds.push('type = ?'); params.push(opts.typeFilter); }
    if (opts.penSlug) { conds.push('pen_slug = ?'); params.push(opts.penSlug); }
    // Find the oldest matching row's id, then UPDATE only if still 'open'.
    const pick = this.db.prepare(
      `SELECT id FROM task_pool WHERE ${conds.join(' AND ')} ORDER BY created_at LIMIT 1`
    ).get(...params) as any;
    if (!pick) return null;
    const upd = this.db.prepare(
      `UPDATE task_pool SET status = 'claimed', claimed_by = ?, claimed_at = ?
       WHERE id = ? AND status = 'open'`
    ).run(workerId, now, pick.id);
    if (upd.changes === 0) {
      // Lost the race; let caller retry.
      return null;
    }
    const row = this.db.prepare('SELECT * FROM task_pool WHERE id = ?').get(pick.id) as any;
    return row ? rowToTask(row) : null;
  }

  reportTask(taskId: string, status: 'done' | 'failed', result?: unknown, error?: string): boolean {
    if (!this.usingSqlite || !this.db) return false;
    const now = new Date().toISOString();
    const r = this.db.prepare(
      `UPDATE task_pool SET status = ?, result = ?, error = ?, completed_at = ?
       WHERE id = ? AND status = 'claimed'`
    ).run(
      status,
      result === undefined ? null : JSON.stringify(result),
      error || null,
      now,
      taskId,
    );
    return r.changes > 0;
  }

  /**
   * Keyword search over completed step outputs via the existing FTS5
   * `search_index` virtual table. Returns ranked excerpts so callers can
   * decide whether to fetch the full step content via `getStepResult`.
   *
   * Use cases:
   *   - "Have I written a scene like this before?" (workers)
   *   - "What chapter mentioned the gluetun proxy bug?" (debug)
   *   - "Find all steps that touched the Drift Ascendant character"
   *
   * Scoring uses FTS5's built-in BM25 ranking. The `snippet()` helper
   * yields a ~64-token excerpt with hits highlighted, keeping each row
   * cheap to read for the model.
   */
  searchSteps(opts: {
    query: string;
    projectId?: string;
    limit?: number;
  }): Array<{ stepId: string; projectId: string; excerpt: string; score: number }> {
    if (!this.usingSqlite || !this.db || !opts.query?.trim()) return [];
    const limit = Math.min(Math.max(1, opts.limit || 10), 50);
    const conds: string[] = ['search_index MATCH ?'];
    const params: any[] = [opts.query];
    if (opts.projectId) {
      conds.push('project_id = ?');
      params.push(opts.projectId);
    }
    try {
      const rows = this.db.prepare(`
        SELECT step_id AS stepId, project_id AS projectId,
               snippet(search_index, 2, '«', '»', '…', 16) AS excerpt,
               bm25(search_index) AS score
        FROM search_index
        WHERE ${conds.join(' AND ')}
        ORDER BY score
        LIMIT ?
      `).all(...params, limit) as any[];
      return rows.map(r => ({ stepId: r.stepId, projectId: r.projectId, excerpt: r.excerpt, score: r.score }));
    } catch (err) {
      // FTS5 MATCH throws on malformed queries (e.g. unbalanced quotes).
      // Caller should sanitize; we return empty rather than crash.
      return [];
    }
  }

  /**
   * Companion to searchSteps — fetch the full content of one indexed step.
   * Returns null if the step has no result or was deleted. Used by the
   * session_view MCP tool to lazy-load a full step body after the worker
   * has scanned excerpts.
   */
  getStepResult(stepId: string): { stepId: string; projectId: string; content: string } | null {
    if (!this.usingSqlite || !this.db) return null;
    const row = this.db.prepare(
      'SELECT step_id AS stepId, project_id AS projectId, content FROM search_index WHERE step_id = ? LIMIT 1'
    ).get(stepId) as any;
    return row ? { stepId: row.stepId, projectId: row.projectId, content: row.content } : null;
  }

  /**
   * Dashboard analytics — aggregated metrics over a time window.
   *
   * Returns the snapshot the AnalyticsPanel needs in one round-trip:
   *   - summary cards (total steps, success rate, audit pass rate)
   *   - daily timeseries of completed steps broken down by task_type
   *   - per-project activity in the window
   *   - average prompt size over time (proxy for compression health)
   *   - recent LoRA training cadence
   *
   * The `llm_telemetry` table doesn't track tokens or cost (only the raw
   * prompts), so this view leans on what we DO have: step completion
   * timestamps, status, prompt length, audit priorityTags, LoRA trained_at.
   */
  getAnalyticsSummary(opts: { days?: number } = {}): {
    windowDays: number;
    totals: { completed: number; failed: number; inProgress: number; pending: number };
    successRate: number;
    daily: Array<{ day: string; completed: number; failed: number; byType: Record<string, number> }>;
    byProject: Array<{ projectId: string; title: string; completed: number; lastActivity: string | null }>;
    promptSize: Array<{ day: string; avgChars: number; calls: number }>;
    loraCadence: Array<{ penSlug: string; version: number; trainedAt: string | null; promoted: boolean }>;
    auditHealth: Array<{ penSlug: string; topTags: Array<{ tag: string; count: number }> }>;
  } {
    const days = Math.max(1, Math.min(opts.days ?? 30, 365));
    const empty = {
      windowDays: days,
      totals: { completed: 0, failed: 0, inProgress: 0, pending: 0 },
      successRate: 0,
      daily: [] as Array<{ day: string; completed: number; failed: number; byType: Record<string, number> }>,
      byProject: [] as Array<{ projectId: string; title: string; completed: number; lastActivity: string | null }>,
      promptSize: [] as Array<{ day: string; avgChars: number; calls: number }>,
      loraCadence: [] as Array<{ penSlug: string; version: number; trainedAt: string | null; promoted: boolean }>,
      auditHealth: [] as Array<{ penSlug: string; topTags: Array<{ tag: string; count: number }> }>,
    };
    if (!this.usingSqlite || !this.db) return empty;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    try {
      // Totals across the entire steps table (lifetime), so the cards include
      // any in-flight work that started before the window. Daily/byProject
      // use the window cutoff.
      const totals = this.db.prepare(`
        SELECT
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
        FROM steps
      `).get() as any;

      const completedInWindow = this.db.prepare(`
        SELECT substr(completed_at, 1, 10) AS day, task_type, COUNT(*) AS n
        FROM steps
        WHERE status = 'completed' AND completed_at >= @cutoff
        GROUP BY day, task_type
        ORDER BY day ASC
      `).all({ cutoff }) as any[];

      const failedInWindow = this.db.prepare(`
        SELECT substr(completed_at, 1, 10) AS day, COUNT(*) AS n
        FROM steps
        WHERE status = 'failed' AND completed_at >= @cutoff
        GROUP BY day
      `).all({ cutoff }) as any[];

      // Stitch completed + failed into one daily timeseries.
      const dailyMap = new Map<string, { day: string; completed: number; failed: number; byType: Record<string, number> }>();
      for (const r of completedInWindow) {
        if (!r.day) continue;
        if (!dailyMap.has(r.day)) dailyMap.set(r.day, { day: r.day, completed: 0, failed: 0, byType: {} });
        const d = dailyMap.get(r.day)!;
        d.completed += r.n;
        if (r.task_type) d.byType[r.task_type] = (d.byType[r.task_type] || 0) + r.n;
      }
      for (const r of failedInWindow) {
        if (!r.day) continue;
        if (!dailyMap.has(r.day)) dailyMap.set(r.day, { day: r.day, completed: 0, failed: 0, byType: {} });
        dailyMap.get(r.day)!.failed += r.n;
      }
      const daily = Array.from(dailyMap.values()).sort((a, b) => a.day.localeCompare(b.day));

      // Per-project activity in the window. Projects keep their title
      // inside a JSON blob (`data` column), so extract it via json_extract
      // rather than a direct column ref. COALESCE to '(deleted)' when the
      // project row is gone but step records remain — pre-GC orphan case.
      const byProject = this.db.prepare(`
        SELECT s.project_id AS projectId,
               COALESCE(json_extract(p.data, '$.title'), '(deleted)') AS title,
               COUNT(*) AS completed, MAX(s.completed_at) AS lastActivity
        FROM steps s
        LEFT JOIN projects p ON p.id = s.project_id
        WHERE s.status = 'completed' AND s.completed_at >= @cutoff
        GROUP BY s.project_id
        ORDER BY completed DESC
        LIMIT 25
      `).all({ cutoff }) as any[];

      // Prompt size over time — average chars/call per day. Useful as a
      // proxy for whether the compression work is landing on prod calls.
      const promptSize = this.db.prepare(`
        SELECT substr(created_at, 1, 10) AS day,
               AVG(LENGTH(system_prompt) + LENGTH(user_prompt)) AS avgChars,
               COUNT(*) AS calls
        FROM llm_telemetry
        WHERE created_at >= @cutoff
        GROUP BY day
        ORDER BY day ASC
      `).all({ cutoff }) as any[];

      // LoRA training cadence — last 20 trained versions across all pens.
      let loraCadence: any[] = [];
      try {
        loraCadence = this.db.prepare(`
          SELECT pen_slug AS penSlug, version, trained_at AS trainedAt, promoted
          FROM lora_versions
          ORDER BY trained_at DESC
          LIMIT 20
        `).all() as any[];
        loraCadence = loraCadence.map(r => ({ ...r, promoted: !!r.promoted }));
      } catch { /* table may not exist on older deployments */ }

      // Audit health — top priorityTags per pen from pen_names.data.
      const pens = this.getPenNames();
      const auditHealth = pens.map(p => {
        const tags: Array<{ tag: string; count: number; affectedPrompts?: number }> =
          Array.isArray(p.raw?.priorityTags) ? p.raw.priorityTags : [];
        return {
          penSlug: p.slug,
          topTags: tags
            .filter(t => t && t.tag)
            .sort((a, b) => (b.count || 0) - (a.count || 0))
            .slice(0, 5)
            .map(t => ({ tag: t.tag, count: t.count || 0 })),
        };
      });

      const completed = totals?.completed || 0;
      const failed = totals?.failed || 0;
      const successRate = completed + failed > 0 ? completed / (completed + failed) : 0;

      return {
        windowDays: days,
        totals: {
          completed,
          failed,
          inProgress: totals?.inProgress || 0,
          pending: totals?.pending || 0,
        },
        successRate,
        daily,
        byProject: byProject.map(r => ({
          projectId: r.projectId,
          title: r.title || '(deleted)',
          completed: r.completed,
          lastActivity: r.lastActivity,
        })),
        promptSize: promptSize.map(r => ({
          day: r.day,
          avgChars: Math.round(r.avgChars || 0),
          calls: r.calls || 0,
        })),
        loraCadence,
        auditHealth,
      };
    } catch (err: any) {
      // Log the underlying SQL error so future regressions don't silently
      // hide behind the empty-shape fallback. (The shape is still returned
      // for graceful render; the error gets a breadcrumb.)
      this.log?.warn?.('getAnalyticsSummary failed', { error: err.message });
      return empty;
    }
  }

  listTasks(opts: { status?: string; type?: string; limit?: number } = {}): TaskPoolRow[] {
    if (!this.usingSqlite || !this.db) return [];
    const conds: string[] = [];
    const params: any[] = [];
    if (opts.status) { conds.push('status = ?'); params.push(opts.status); }
    if (opts.type) { conds.push('type = ?'); params.push(opts.type); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const limit = Math.min(Math.max(1, opts.limit || 50), 500);
    const rows = this.db.prepare(
      `SELECT * FROM task_pool ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params, limit) as any[];
    return rows.map(rowToTask);
  }

  queueDepth(opts: { type?: string } = {}): Record<string, number> {
    // Non-SQLite path returns empty counts. The old code shelled out to
    // `docker exec perry-trainer python3 /workspace/mcp_db.py` here — that
    // path hasn't been exercised since perry switched to embedded SQLite
    // and risked accidentally touching the trainer container.
    if (!this.usingSqlite || !this.db) {
      return { open: 0, claimed: 0, done: 0, failed: 0 };
    }
    const conds: string[] = [];
    const params: any[] = [];
    if (opts.type) { conds.push('type = ?'); params.push(opts.type); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT status, COUNT(*) AS n FROM task_pool ${where} GROUP BY status`
    ).all(...params) as any[];
    const out: Record<string, number> = { open: 0, claimed: 0, done: 0, failed: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  /** Mark a list of done tasks as archived so they don't reappear in drains. */
  archiveDoneTasks(taskIds: string[]): number {
    if (!this.usingSqlite || !this.db || taskIds.length === 0) return 0;
    const stmt = this.db.prepare(
      "UPDATE task_pool SET status='archived' WHERE id = ? AND status='done'"
    );
    let total = 0;
    const tx = this.db.transaction(() => {
      for (const id of taskIds) total += stmt.run(id).changes;
    });
    tx();
    return total;
  }

  /** Release tasks that have been claimed for too long without a report. */
  releaseStaleTasks(staleSeconds: number = 600): number {
    if (!this.usingSqlite || !this.db) return 0;
    const cutoff = new Date(Date.now() - staleSeconds * 1000).toISOString();
    const r = this.db.prepare(
      `UPDATE task_pool SET status = 'open', claimed_by = NULL, claimed_at = NULL
       WHERE status = 'claimed' AND claimed_at < ?`
    ).run(cutoff);
    return r.changes;
  }

  /**
   * Archive open async-quality-audit tasks older than `staleSeconds`.
   * The async audit pattern enqueues a review task per creative_writing step.
   * If nobody drains the worker pool, these accumulate indefinitely. Reviews
   * older than 24h are stale (the prose is long-past) so we archive them
   * rather than waste worker time on backlog catch-up.
   */
  archiveStaleAuditTasks(staleSeconds: number = 24 * 60 * 60): number {
    if (!this.usingSqlite || !this.db) return 0;
    const cutoff = new Date(Date.now() - staleSeconds * 1000).toISOString();
    // Payload is a JSON blob; we match on the failure_reason field via LIKE.
    // This is approximate but cheap; precision isn't critical for GC.
    const r = this.db.prepare(
      `UPDATE task_pool SET status = 'archived'
       WHERE status = 'open'
         AND created_at < ?
         AND payload LIKE '%"failure_reason":"async_quality_audit"%'`
    ).run(cutoff);
    return r.changes;
  }

  // ── Agent system: sessions / invocations / trajectories ──────────────
  //
  // These methods are the persistence layer for the agent foundation
  // (Phase 0). The tables are created by migration 7→8; this layer
  // exposes safe, typed access. AgentRunner is the only consumer today.

  createAgentSession(opts: { id?: string; domain?: string; projectId?: string; penSlug?: string; title?: string }): string {
    if (!this.usingSqlite || !this.db) throw new Error('SQLite not available');
    const id = opts.id || `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(
      `INSERT INTO agent_sessions (id, domain, project_id, pen_slug, title, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, opts.domain || 'books', opts.projectId || null, opts.penSlug || null, opts.title || null, new Date().toISOString());
    return id;
  }

  getAgentSession(id: string): any | null {
    if (!this.usingSqlite || !this.db) return null;
    return this.db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) || null;
  }

  closeAgentSession(id: string): boolean {
    if (!this.usingSqlite || !this.db) return false;
    const r = this.db.prepare(
      'UPDATE agent_sessions SET closed_at = ? WHERE id = ? AND closed_at IS NULL'
    ).run(new Date().toISOString(), id);
    return r.changes > 0;
  }

  listAgentSessions(opts: { projectId?: string; domain?: string; limit?: number } = {}): any[] {
    if (!this.usingSqlite || !this.db) return [];
    const conds: string[] = [];
    const params: any[] = [];
    if (opts.projectId) { conds.push('project_id = ?'); params.push(opts.projectId); }
    if (opts.domain) { conds.push('domain = ?'); params.push(opts.domain); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return this.db.prepare(
      `SELECT * FROM agent_sessions ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params, Math.min(opts.limit || 50, 500));
  }

  createAgentInvocation(opts: {
    sessionId: string;
    agentId: string;
    domain: string;
    input?: string;
    parentInvocationId?: string;
    workerClass?: string;
  }): string {
    if (!this.usingSqlite || !this.db) throw new Error('SQLite not available');
    const id = `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(
      `INSERT INTO agent_invocations
       (id, session_id, parent_invocation_id, agent_id, domain, status, worker_class, input, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).run(
      id, opts.sessionId, opts.parentInvocationId || null, opts.agentId, opts.domain,
      opts.workerClass || null, opts.input || null, new Date().toISOString()
    );
    return id;
  }

  updateAgentInvocation(id: string, patch: {
    status?: 'pending' | 'running' | 'completed' | 'failed';
    model?: string;
    workerClass?: string;
    output?: string;
    toolCalls?: any[];
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
    error?: string;
  }): boolean {
    if (!this.usingSqlite || !this.db) return false;
    const setClauses: string[] = [];
    const params: any[] = [];
    if (patch.status !== undefined)      { setClauses.push('status = ?');           params.push(patch.status); }
    if (patch.model !== undefined)       { setClauses.push('model = ?');            params.push(patch.model); }
    if (patch.workerClass !== undefined) { setClauses.push('worker_class = ?');     params.push(patch.workerClass); }
    if (patch.output !== undefined)      { setClauses.push('output = ?');           params.push(patch.output); }
    if (patch.toolCalls !== undefined)   { setClauses.push('tool_calls = ?');       params.push(JSON.stringify(patch.toolCalls)); }
    if (patch.promptTokens !== undefined){ setClauses.push('prompt_tokens = ?');    params.push(patch.promptTokens); }
    if (patch.completionTokens !== undefined) { setClauses.push('completion_tokens = ?'); params.push(patch.completionTokens); }
    if (patch.costUsd !== undefined)     { setClauses.push('cost_usd = ?');         params.push(patch.costUsd); }
    if (patch.error !== undefined)       { setClauses.push('error = ?');            params.push(patch.error); }
    if (patch.status === 'completed' || patch.status === 'failed') {
      setClauses.push('completed_at = ?');
      params.push(new Date().toISOString());
    }
    if (setClauses.length === 0) return false;
    params.push(id);
    const r = this.db.prepare(
      `UPDATE agent_invocations SET ${setClauses.join(', ')} WHERE id = ?`
    ).run(...params);
    return r.changes > 0;
  }

  getAgentInvocation(id: string): any | null {
    if (!this.usingSqlite || !this.db) return null;
    return this.db.prepare('SELECT * FROM agent_invocations WHERE id = ?').get(id) || null;
  }

  listAgentInvocations(opts: { sessionId?: string; agentId?: string; status?: string; limit?: number } = {}): any[] {
    if (!this.usingSqlite || !this.db) return [];
    const conds: string[] = [];
    const params: any[] = [];
    if (opts.sessionId) { conds.push('session_id = ?'); params.push(opts.sessionId); }
    if (opts.agentId)   { conds.push('agent_id = ?');   params.push(opts.agentId); }
    if (opts.status)    { conds.push('status = ?');     params.push(opts.status); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return this.db.prepare(
      `SELECT * FROM agent_invocations ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params, Math.min(opts.limit || 100, 1000));
  }

  /** Record a completed invocation as a training trajectory. */
  recordAgentTrajectory(opts: {
    invocationId: string;
    agentId: string;
    domain: string;
    penSlug?: string;
    workerClass?: string;
    model: string;
    messages: any[];
    toolCalls?: any[];
    outcome: 'success' | 'failed' | 'rejected';
    qualityScore?: number;
    ratedBy?: string;
  }): string {
    if (!this.usingSqlite || !this.db) throw new Error('SQLite not available');
    const id = `traj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(
      `INSERT INTO agent_trajectories
       (id, invocation_id, agent_id, domain, pen_slug, worker_class, model, messages, tool_calls, outcome, quality_score, rated_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, opts.invocationId, opts.agentId, opts.domain, opts.penSlug || null,
      opts.workerClass || null, opts.model,
      JSON.stringify(opts.messages),
      opts.toolCalls ? JSON.stringify(opts.toolCalls) : null,
      opts.outcome, opts.qualityScore ?? null, opts.ratedBy || null,
      new Date().toISOString()
    );
    return id;
  }

  countAgentTrajectories(opts: { agentId?: string; outcome?: string; domain?: string } = {}): number {
    if (!this.usingSqlite || !this.db) return 0;
    const conds: string[] = [];
    const params: any[] = [];
    if (opts.agentId) { conds.push('agent_id = ?'); params.push(opts.agentId); }
    if (opts.outcome) { conds.push('outcome = ?'); params.push(opts.outcome); }
    if (opts.domain)  { conds.push('domain = ?');  params.push(opts.domain); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const row = this.db.prepare(
      `SELECT COUNT(*) AS n FROM agent_trajectories ${where}`
    ).get(...params) as any;
    return row?.n || 0;
  }
}

// ── Typed pen-name row shapes ─────────────────────────────────

export interface PenNameRow {
  slug: string;
  displayName: string;
  genreOrSeries: string | null;
  voiceTagline: string | null;
  baseModel: string | null;
  currentLoraVersion: number | null;
  createdAt: string | null;
  raw: any;
}

export interface LoraVersionRow {
  penSlug: string;
  version: number;
  ollamaTag: string | null;
  currentlyRegisteredAs: string | null;
  loraGgufPath: string | null;
  loraAdapterPath: string | null;
  trainingPairs: number | null;
  trainingSteps: number | null;
  epochs: number | null;
  finalLoss: number | null;
  loraRank: number | null;
  maxLength: number | null;
  trainedAt: string | null;
  promoted: boolean;
  raw: any;
}

export interface TaskPoolRow {
  id: string;
  penSlug: string | null;
  type: string;
  payload: any;
  status: 'open' | 'claimed' | 'done' | 'failed';
  claimedBy: string | null;
  claimedAt: string | null;
  result: any;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

function rowToTask(r: any): TaskPoolRow {
  return {
    id: r.id,
    penSlug: r.pen_slug,
    type: r.type,
    payload: safeParse(r.payload),
    status: r.status,
    claimedBy: r.claimed_by,
    claimedAt: r.claimed_at,
    result: r.result ? safeParse(r.result) : null,
    error: r.error,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

function rowToPenName(r: any): PenNameRow {
  return {
    slug: r.slug,
    displayName: r.display_name,
    genreOrSeries: r.genre_or_series,
    voiceTagline: r.voice_tagline,
    baseModel: r.base_model,
    currentLoraVersion: r.current_lora_version,
    createdAt: r.created_at,
    raw: safeParse(r.data),
  };
}

function rowToLoraVersion(r: any): LoraVersionRow {
  return {
    penSlug: r.pen_slug,
    version: r.version,
    ollamaTag: r.ollama_tag,
    currentlyRegisteredAs: r.currently_registered_as,
    loraGgufPath: r.lora_gguf_path,
    loraAdapterPath: r.lora_adapter_path,
    trainingPairs: r.training_pairs,
    trainingSteps: r.training_steps,
    epochs: r.epochs,
    finalLoss: r.final_loss,
    loraRank: r.lora_rank,
    maxLength: r.max_length,
    trainedAt: r.trained_at,
    promoted: !!r.promoted,
    raw: safeParse(r.data),
  };
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
