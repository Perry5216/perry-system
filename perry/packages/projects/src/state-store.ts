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

      this.log.info('State store initialized (SQLite)', { projects: this.cache.size });
      return;
    } catch (err: any) {
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

        // Hydrate step results/prompts from the steps table.
        // The project blob strips these to save space (see save()).
        const stepRows = this.db.prepare(
          'SELECT id, result, prompt FROM steps WHERE project_id = ?'
        ).all(project.id) as any[];

        if (stepRows.length > 0) {
          const stepMap = new Map<string, { result: string | null; prompt: string }>();
          for (const sr of stepRows) {
            stepMap.set(sr.id, { result: sr.result, prompt: sr.prompt });
          }
          for (const step of project.steps) {
            const stored = stepMap.get(step.id);
            if (stored) {
              if (!step.result && stored.result) step.result = stored.result;
              if (!step.prompt && stored.prompt) step.prompt = stored.prompt;
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
        INSERT INTO steps (id, project_id, label, phase, task_type, chapter_number, status, result, prompt, started_at, completed_at, error)
        VALUES (@id, @projectId, @label, @phase, @taskType, @chapterNumber, @status, @result, @prompt, @startedAt, @completedAt, @error)
        ON CONFLICT(project_id, id) DO UPDATE SET 
          status = excluded.status, result = excluded.result, prompt = excluded.prompt, 
          started_at = excluded.started_at, completed_at = excluded.completed_at, error = excluded.error
      `);
      this.db.transaction(() => {
        for (const step of project.steps) {
          stepInsert.run({
            id: step.id, projectId: project.id, label: step.label, phase: step.phase || null,
            taskType: step.taskType, chapterNumber: step.chapterNumber || null,
            status: step.status, result: step.result || null, prompt: step.prompt,
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
}
