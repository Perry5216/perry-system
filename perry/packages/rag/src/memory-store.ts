/**
 * @perry/rag — Memory Store
 *
 * SQLite + FTS5 full-text search across all project data. This is the
 * persistence backbone for the RAG system.
 *
 * Key difference from V4:
 *   - projectId is REQUIRED for project-scoped searches (no accidental global leaks)
 *   - searchGlobal() is a separate, explicitly named method
 *   - WAL mode for concurrent reads during pipeline execution
 *   - Graceful degradation if better-sqlite3 isn't available
 */

import { existsSync, mkdirSync } from 'fs';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { Logger } from '@perry/core';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export type MemorySource = 'project_step' | 'manuscript' | 'note' | 'conversation';

export interface MemoryEntry {
  source: MemorySource;
  sourceRef: string;
  projectId: string;          // REQUIRED — no unscoped entries
  timestamp: string;
  title: string | null;
  body: string;
}

export interface SearchHit {
  id: number;
  source: MemorySource;
  sourceRef: string;
  projectId: string;
  timestamp: string;
  title: string | null;
  snippet: string;
  rank: number;
}

export interface MemoryStats {
  available: boolean;
  totalEntries: number;
  byProject: Record<string, number>;
  lastIndexedAt: string | null;
  unavailableReason?: string;
}

// ═══════════════════════════════════════════════════════════
// Memory Store
// ═══════════════════════════════════════════════════════════

export class MemoryStore {
  private db: any = null;
  private dbPath: string;
  private log: Logger;
  private unavailableReason: string | null = null;
  private lastIndexedAt: string | null = null;

  constructor(workspaceDir: string, log: Logger) {
    const memoryDir = join(workspaceDir, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    this.dbPath = join(memoryDir, 'memory.db');
    this.log = log;
  }

  /**
   * Initialize the SQLite database. If better-sqlite3 isn't available,
   * the store degrades gracefully — all operations become no-ops.
   */
  async initialize(): Promise<void> {
    try {
      const mod: any = await import('better-sqlite3');
      const Database: any = mod.default || mod;
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.applySchema();
      this.log.info('Memory store initialized', { path: this.dbPath });
    } catch (err: any) {
      this.unavailableReason = `better-sqlite3 unavailable: ${err?.message}. Memory search disabled.`;
      this.log.warn(this.unavailableReason);
      this.db = null;
    }
  }

  isAvailable(): boolean {
    return this.db !== null;
  }

  private applySchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        source      TEXT NOT NULL,
        source_ref  TEXT NOT NULL,
        project_id  TEXT NOT NULL,
        timestamp   TEXT NOT NULL,
        title       TEXT,
        body        TEXT NOT NULL,
        UNIQUE(source, source_ref, project_id)
      );
      CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_id);
      CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp);
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        title, body,
        content='entries',
        content_rowid='id',
        tokenize='porter unicode61 remove_diacritics 2'
      );
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_ai AFTER INSERT ON entries BEGIN
        INSERT INTO entries_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
      END;
      CREATE TRIGGER IF NOT EXISTS trg_ad AFTER DELETE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, title, body) VALUES('delete', old.id, old.title, old.body);
      END;
      CREATE TRIGGER IF NOT EXISTS trg_au AFTER UPDATE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, title, body) VALUES('delete', old.id, old.title, old.body);
        INSERT INTO entries_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
      END;
    `);
  }

  /**
   * Add or update a memory entry. Immediate write — no debouncing.
   */
  upsert(entry: MemoryEntry): number | null {
    if (!this.db) return null;
    try {
      const result = this.db.prepare(`
        INSERT INTO entries (source, source_ref, project_id, timestamp, title, body)
        VALUES (@source, @sourceRef, @projectId, @timestamp, @title, @body)
        ON CONFLICT(source, source_ref, project_id) DO UPDATE SET
          timestamp = excluded.timestamp,
          title     = excluded.title,
          body      = excluded.body
      `).run({
        source: entry.source,
        sourceRef: entry.sourceRef,
        projectId: entry.projectId,
        timestamp: entry.timestamp,
        title: entry.title,
        body: entry.body,
      });
      return result.lastInsertRowid ? Number(result.lastInsertRowid) : null;
    } catch (err) {
      this.log.error('Upsert failed', { error: String(err) });
      return null;
    }
  }

  /**
   * Search within a SPECIFIC project. This is the primary search method.
   * projectId is REQUIRED — no accidental cross-project leaks.
   */
  searchProject(projectId: string, query: string, limit: number = 25): SearchHit[] {
    if (!this.db || !query?.trim()) return [];
    const safeQuery = query.replace(/[\x00-\x1f]/g, '').trim();
    try {
      return this.db.prepare(`
        SELECT e.id, e.source, e.source_ref, e.project_id,
               e.timestamp, e.title,
               snippet(entries_fts, 1, '[', ']', '…', 32) AS snippet,
               bm25(entries_fts) AS rank
        FROM entries_fts
        JOIN entries e ON e.id = entries_fts.rowid
        WHERE entries_fts MATCH @q AND e.project_id = @projectId
        ORDER BY rank
        LIMIT ${Math.min(limit, 100)}
      `).all({ q: safeQuery, projectId }).map((r: any) => ({
        id: r.id,
        source: r.source as MemorySource,
        sourceRef: r.source_ref,
        projectId: r.project_id,
        timestamp: r.timestamp,
        title: r.title,
        snippet: r.snippet,
        rank: r.rank,
      }));
    } catch (err: any) {
      this.log.warn('Search failed', { error: err?.message });
      return [];
    }
  }

  /**
   * Delete all entries for a project. Called during project deletion.
   */
  deleteProject(projectId: string): number {
    if (!this.db) return 0;
    const result = this.db.prepare('DELETE FROM entries WHERE project_id = @projectId')
      .run({ projectId });
    this.log.info('Project entries deleted', { projectId, count: result.changes });
    return result.changes;
  }

  /**
   * Purge Ghost Data
   * Deletes any entries whose project_id is not in the provided active list.
   */
  purgeGhostData(activeIds: Set<string>): number {
    if (!this.db || activeIds.size === 0) return 0;
    
    // Get all unique project IDs currently in the DB
    const rows = this.db.prepare('SELECT DISTINCT project_id FROM entries').all() as any[];
    let purgedCount = 0;

    for (const row of rows) {
      if (!activeIds.has(row.project_id)) {
        const result = this.db.prepare('DELETE FROM entries WHERE project_id = @projectId')
          .run({ projectId: row.project_id });
        purgedCount += result.changes;
        this.log.info('Purged ghost project from memory store', { projectId: row.project_id, count: result.changes });
      }
    }

    return purgedCount;
  }

  /**
   * Get all entries for a project (for export or context building).
   */
  getProjectEntries(projectId: string): MemoryEntry[] {
    if (!this.db) return [];
    return this.db.prepare(
      'SELECT * FROM entries WHERE project_id = @projectId ORDER BY timestamp'
    ).all({ projectId }).map((r: any) => ({
      source: r.source,
      sourceRef: r.source_ref,
      projectId: r.project_id,
      timestamp: r.timestamp,
      title: r.title,
      body: r.body,
    }));
  }

  /** Stats for the dashboard. */
  getStats(): MemoryStats {
    if (!this.db) {
      return {
        available: false,
        totalEntries: 0,
        byProject: {},
        lastIndexedAt: null,
        unavailableReason: this.unavailableReason || 'Not initialized',
      };
    }
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM entries').get() as any)?.n || 0;
    const projectRows = this.db.prepare(
      'SELECT project_id, COUNT(*) AS n FROM entries GROUP BY project_id'
    ).all() as any[];
    const byProject: Record<string, number> = {};
    for (const r of projectRows) byProject[r.project_id] = r.n;
    return { available: true, totalEntries: total, byProject, lastIndexedAt: this.lastIndexedAt };
  }

  /** Close the DB on shutdown. */
  close(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
    }
  }
}
