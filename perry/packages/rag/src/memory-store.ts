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
export type RagTier = 'library' | 'session' | 'feedback';

export function getTierForKind(kind: string): RagTier {
  if (kind.startsWith('learning_') || kind === 'voice_anchor' || kind === 'voyager_tool' || kind === 'verified_scout_finding') {
    return 'feedback';
  }
  if (kind === 'session_chat' || kind === 'recent_context' || kind === 'active_task' || kind === 'step_history' || kind === 'chat_memory' || kind === 'project_step') {
    return 'session';
  }
  return 'library';
}

export function getTierForSource(source: string): RagTier {
  if (source === 'project_step' || source === 'conversation') {
    return 'session';
  }
  return 'library';
}

export interface MemoryEntry {
  source: MemorySource;
  sourceRef: string;
  projectId: string;          // REQUIRED — no unscoped entries
  timestamp: string;
  title: string | null;
  body: string;
  tier?: string;
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
  tier?: string;
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
      this.db = new Database(this.dbPath, { timeout: 5000 });
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('temp_store = MEMORY');
      this.db.pragma('cache_size = -16000');
      this.db.pragma('journal_size_limit = 67108864');
      this.db.pragma('mmap_size = 268435456');

      // Wrap prepare to transparently cache prepared statements
      const originalPrepare = this.db.prepare.bind(this.db);
      const stmtCache = new Map<string, any>();
      this.db.prepare = (sql: string) => {
        let stmt = stmtCache.get(sql);
        if (!stmt) {
          stmt = originalPrepare(sql);
          stmtCache.set(sql, stmt);
        }
        return stmt;
      };

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
    // 1. Create base tables if they don't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        source      TEXT NOT NULL,
        source_ref  TEXT NOT NULL,
        project_id  TEXT NOT NULL,
        timestamp   TEXT NOT NULL,
        title       TEXT,
        body        TEXT NOT NULL,
        tier        TEXT DEFAULT 'library',
        UNIQUE(source, source_ref, project_id)
      );
      CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_id);
      CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp);
    `);

    // ── Vector chunks ─────────────────────────────────────────────────
    // Embedding-indexed slices of larger texts. We store the raw vector
    // as a BLOB (Float32Array buffer) — SQLite doesn't have a native
    // vector type and a linear scan over a few thousand 768-dim vectors
    // takes ~10ms which is fast enough for Perry's scale.
    //
    // Indexed by (project_id, kind) so we can filter cheaply BEFORE the
    // cosine pass. `kind` is the logical category (bible, outline,
    // chapter, voice_anchor, review, etc.) — query layer can scope to
    // one kind at a time, or all.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id   TEXT NOT NULL,
        source_ref   TEXT NOT NULL,
        kind         TEXT NOT NULL,
        chunk_index  INTEGER NOT NULL,
        text         TEXT NOT NULL,
        token_count  INTEGER NOT NULL,
        embedding    BLOB NOT NULL,
        embed_model  TEXT NOT NULL,
        embed_dim    INTEGER NOT NULL,
        metadata     TEXT,
        indexed_at   TEXT NOT NULL,
        tier         TEXT DEFAULT 'library',
        UNIQUE(project_id, source_ref, chunk_index)
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_project_kind ON chunks(project_id, kind);
      CREATE INDEX IF NOT EXISTS idx_chunks_source_ref ON chunks(source_ref);
    `);

    // 2. Perform migrations to add 'tier' column to existing tables if missing
    const entriesCols = this.db.pragma('table_info(entries)') as { name: string }[];
    const chunksCols = this.db.pragma('table_info(chunks)') as { name: string }[];

    if (!entriesCols.some(c => c.name === 'tier')) {
      this.db.exec("ALTER TABLE entries ADD COLUMN tier TEXT DEFAULT 'library'");
    }
    if (!chunksCols.some(c => c.name === 'tier')) {
      this.db.exec("ALTER TABLE chunks ADD COLUMN tier TEXT DEFAULT 'library'");
    }

    // 3. Create indices referencing 'tier' now that the column is guaranteed to exist
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entries_project_tier ON entries(project_id, tier);
      CREATE INDEX IF NOT EXISTS idx_chunks_project_tier ON chunks(project_id, tier);
    `);

    // ── Parent Documents ──
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS parent_documents (
        project_id  TEXT NOT NULL,
        source_ref  TEXT NOT NULL,
        text        TEXT NOT NULL,
        PRIMARY KEY (project_id, source_ref)
      );
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

    // ── Chunks FTS ──
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text,
        content='chunks',
        content_rowid='id',
        tokenize='porter unicode61 remove_diacritics 2'
      );
      INSERT OR IGNORE INTO chunks_fts(rowid, text) SELECT id, text FROM chunks;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS trg_chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS trg_chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
        INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
    `);
  }

  /**
   * Add or update a memory entry. Immediate write — no debouncing.
   */
  upsert(entry: MemoryEntry): number | null {
    if (!this.db) return null;
    const tier = entry.tier || getTierForSource(entry.source);
    try {
      const result = this.db.prepare(`
        INSERT INTO entries (source, source_ref, project_id, timestamp, title, body, tier)
        VALUES (@source, @sourceRef, @projectId, @timestamp, @title, @body, @tier)
        ON CONFLICT(source, source_ref, project_id) DO UPDATE SET
          timestamp = excluded.timestamp,
          title     = excluded.title,
          body      = excluded.body,
          tier      = excluded.tier
      `).run({
        source: entry.source,
        sourceRef: entry.sourceRef,
        projectId: entry.projectId,
        timestamp: entry.timestamp,
        title: entry.title,
        body: entry.body,
        tier,
      });
      return result.lastInsertRowid ? Number(result.lastInsertRowid) : null;
    } catch (err) {
      this.log.error('Upsert failed', { error: String(err) });
      return null;
    }
  }

  /**
   * Add or update a parent document text.
   */
  upsertParentDocument(projectId: string, sourceRef: string, text: string): void {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT INTO parent_documents (project_id, source_ref, text)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id, source_ref) DO UPDATE SET text = excluded.text
      `).run(projectId, sourceRef, text);
    } catch (err: any) {
      this.log.error('upsertParentDocument failed', { error: err.message });
    }
  }

  /**
   * Search within a SPECIFIC project. This is the primary search method.
   * projectId is REQUIRED — no accidental cross-project leaks.
   */
  searchProject(projectId: string, query: string, limit: number = 25, tier?: string): SearchHit[] {
    if (!this.db || !query?.trim()) return [];
    const safeQuery = query.replace(/[\x00-\x1f]/g, '').trim();
    try {
      const tierFilter = tier ? 'AND e.tier = @tier' : '';
      const params: any = { q: safeQuery, projectId };
      if (tier) {
        params.tier = tier;
      }
      return this.db.prepare(`
        SELECT e.id, e.source, e.source_ref, e.project_id,
               e.timestamp, e.title, e.tier,
               snippet(entries_fts, 1, '[', ']', '…', 32) AS snippet,
               bm25(entries_fts) AS rank
        FROM entries_fts
        JOIN entries e ON e.id = entries_fts.rowid
        WHERE entries_fts MATCH @q AND e.project_id = @projectId ${tierFilter}
        ORDER BY rank
        LIMIT ${Math.min(limit, 100)}
      `).all(params).map((r: any) => ({
        id: r.id,
        source: r.source as MemorySource,
        sourceRef: r.source_ref,
        projectId: r.project_id,
        timestamp: r.timestamp,
        title: r.title,
        snippet: r.snippet,
        rank: r.rank,
        tier: r.tier,
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
    const chunkResult = this.db.prepare('DELETE FROM chunks WHERE project_id = @projectId')
      .run({ projectId });
    this.db.prepare('DELETE FROM parent_documents WHERE project_id = @projectId')
      .run({ projectId });
    this.log.info('Project entries + chunks deleted', { projectId, entries: result.changes, chunks: chunkResult.changes });
    return result.changes;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Vector chunks API
  // ─────────────────────────────────────────────────────────────────────

  /** Encode a number[] embedding to a Float32 BLOB for storage. */
  static encodeEmbedding(vec: number[]): Buffer {
    const f32 = new Float32Array(vec);
    return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
  }

  /** Decode a stored BLOB back into a Float32Array for cosine math. */
  static decodeEmbedding(blob: Buffer): Float32Array {
    return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  }

  /** Insert or replace a single chunk. */
  upsertChunk(chunk: {
    projectId: string;
    sourceRef: string;
    kind: string;
    chunkIndex: number;
    text: string;
    tokenCount: number;
    embedding: number[];
    embedModel: string;
    embedDim: number;
    metadata?: Record<string, any>;
    tier?: string;
  }): number | null {
    if (!this.db) return null;
    const tier = chunk.tier || getTierForKind(chunk.kind);
    try {
      const result = this.db.prepare(`
        INSERT INTO chunks (project_id, source_ref, kind, chunk_index, text, token_count, embedding, embed_model, embed_dim, metadata, indexed_at, tier)
        VALUES (@projectId, @sourceRef, @kind, @chunkIndex, @text, @tokenCount, @embedding, @embedModel, @embedDim, @metadata, @indexedAt, @tier)
        ON CONFLICT(project_id, source_ref, chunk_index) DO UPDATE SET
          kind        = excluded.kind,
          text        = excluded.text,
          token_count = excluded.token_count,
          embedding   = excluded.embedding,
          embed_model = excluded.embed_model,
          embed_dim   = excluded.embed_dim,
          metadata    = excluded.metadata,
          indexed_at  = excluded.indexed_at,
          tier        = excluded.tier
      `).run({
        projectId: chunk.projectId,
        sourceRef: chunk.sourceRef,
        kind: chunk.kind,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        embedding: MemoryStore.encodeEmbedding(chunk.embedding),
        embedModel: chunk.embedModel,
        embedDim: chunk.embedDim,
        metadata: chunk.metadata ? JSON.stringify(chunk.metadata) : null,
        indexedAt: new Date().toISOString(),
        tier,
      });
      if (result.changes > 0) {
        return result.lastInsertRowid ? Number(result.lastInsertRowid) : 1;
      }
      return null;
    } catch (err: any) {
      this.log.error('upsertChunk failed', { error: err.message, sourceRef: chunk.sourceRef });
      return null;
    }
  }

  /** Delete all chunks for a sourceRef (e.g., re-indexing a step's output). */
  deleteChunksBySource(projectId: string, sourceRef: string): number {
    if (!this.db) return 0;
    const result = this.db.prepare(
      'DELETE FROM chunks WHERE project_id = @projectId AND source_ref = @sourceRef'
    ).run({ projectId, sourceRef });
    this.db.prepare(
      'DELETE FROM parent_documents WHERE project_id = @projectId AND source_ref = @sourceRef'
    ).run({ projectId, sourceRef });
    return result.changes;
  }

  /** Quick check to see if chunks exist for a given source reference. */
  hasChunksForSource(projectId: string, sourceRef: string): boolean {
    if (!this.db) return false;
    const row = this.db.prepare(
      'SELECT 1 FROM chunks WHERE project_id = ? AND source_ref = ? LIMIT 1'
    ).get(projectId, sourceRef);
    return !!row;
  }

  /** Count chunks for a project, optionally scoped to a kind. */
  countChunks(projectId: string, kind?: string): number {
    if (!this.db) return 0;
    if (kind) {
      const row = this.db.prepare(
        'SELECT COUNT(*) AS n FROM chunks WHERE project_id = @projectId AND kind = @kind'
      ).get({ projectId, kind });
      return row?.n || 0;
    }
    const row = this.db.prepare(
      'SELECT COUNT(*) AS n FROM chunks WHERE project_id = @projectId'
    ).get({ projectId });
    return row?.n || 0;
  }

  /** Linear cosine scan. Returns top-K hits. */
  searchChunks(opts: {
    projectId: string;
    queryEmbedding: number[];
    kinds?: string[];      // restrict to these kinds; empty/undefined = all
    topK?: number;
    minScore?: number;     // drop hits below this cosine
    tier?: string;
    tiers?: string[];
  }): Array<{
    id: number;
    sourceRef: string;
    kind: string;
    chunkIndex: number;
    text: string;
    tokenCount: number;
    score: number;
    metadata: any | null;
    tier?: string;
    parentText?: string;
  }> {
    if (!this.db) return [];
    const topK = Math.max(1, Math.min(opts.topK ?? 8, 50));
    const minScore = opts.minScore ?? 0;
    const kindFilter = opts.kinds && opts.kinds.length > 0
      ? `AND c.kind IN (${opts.kinds.map(() => '?').join(',')})`
      : '';
    const targetTiers = opts.tier ? [opts.tier] : opts.tiers;
    const tierFilter = targetTiers && targetTiers.length > 0
      ? `AND c.tier IN (${targetTiers.map(() => '?').join(',')})`
      : '';

    const sql = `
      SELECT c.id, c.source_ref, c.kind, c.chunk_index, c.text, c.token_count, c.embedding, c.metadata, c.tier, p.text AS parent_text
      FROM chunks c
      LEFT JOIN parent_documents p ON p.project_id = c.project_id AND p.source_ref = c.source_ref
      WHERE c.project_id = ? ${kindFilter} ${tierFilter}
    `;
    const params = [opts.projectId, ...(opts.kinds || []), ...(targetTiers || [])];
    const rows = this.db.prepare(sql).all(...params) as any[];
    if (rows.length === 0) return [];
    // Inline cosine
    const q = opts.queryEmbedding;
    let qMag = 0;
    for (let i = 0; i < q.length; i++) qMag += q[i] * q[i];
    qMag = Math.sqrt(qMag);
    if (qMag === 0) return [];

    const scored: Array<any> = [];
    for (const r of rows) {
      const v = MemoryStore.decodeEmbedding(r.embedding);
      if (v.length !== q.length) continue;
      let dot = 0, vMag = 0;
      for (let i = 0; i < v.length; i++) {
        dot += q[i] * v[i];
        vMag += v[i] * v[i];
      }
      vMag = Math.sqrt(vMag);
      if (vMag === 0) continue;
      const score = dot / (qMag * vMag);
      if (score < minScore) continue;
      scored.push({
        id: r.id,
        sourceRef: r.source_ref,
        kind: r.kind,
        chunkIndex: r.chunk_index,
        text: r.text,
        tokenCount: r.token_count,
        score,
        metadata: r.metadata ? (() => { try { return JSON.parse(r.metadata); } catch { return null; } })() : null,
        tier: r.tier,
        parentText: r.parent_text || undefined,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** FTS5 text match on chunks. Returns top-K BM25 ranked hits. */
  searchChunksFts(opts: {
    projectId: string;
    query: string;
    kinds?: string[];
    topK?: number;
    tier?: string;
    tiers?: string[];
  }): Array<{
    id: number;
    sourceRef: string;
    kind: string;
    chunkIndex: number;
    text: string;
    tokenCount: number;
    score: number;
    metadata: any | null;
    tier?: string;
    parentText?: string;
  }> {
    if (!this.db || !opts.query?.trim()) return [];
    const safeQuery = opts.query.replace(/[\x00-\x1f]/g, '').trim();
    const kindFilter = opts.kinds && opts.kinds.length > 0
      ? `AND c.kind IN (${opts.kinds.map(() => '?').join(',')})`
      : '';
    const targetTiers = opts.tier ? [opts.tier] : opts.tiers;
    const tierFilter = targetTiers && targetTiers.length > 0
      ? `AND c.tier IN (${targetTiers.map(() => '?').join(',')})`
      : '';

    const sql = `
      SELECT c.id, c.source_ref, c.kind, c.chunk_index, c.text, c.token_count, c.metadata, c.tier, p.text AS parent_text,
             bm25(chunks_fts) AS rank
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.rowid
      LEFT JOIN parent_documents p ON p.project_id = c.project_id AND p.source_ref = c.source_ref
      WHERE chunks_fts MATCH ? AND c.project_id = ? ${kindFilter} ${tierFilter}
      ORDER BY rank
      LIMIT ?
    `;
    const params = [
      safeQuery,
      opts.projectId,
      ...(opts.kinds || []),
      ...(targetTiers || []),
      Math.min(opts.topK ?? 25, 100)
    ];
    try {
      return this.db.prepare(sql).all(...params).map((r: any) => ({
        id: r.id,
        sourceRef: r.source_ref,
        kind: r.kind,
        chunkIndex: r.chunk_index,
        text: r.text,
        tokenCount: r.token_count,
        score: -r.rank,
        metadata: r.metadata ? (() => { try { return JSON.parse(r.metadata); } catch { return null; } })() : null,
        tier: r.tier,
        parentText: r.parent_text || undefined,
      }));
    } catch (err: any) {
      this.log.warn('searchChunksFts failed', { error: err.message });
      return [];
    }
  }

  /**
   * GC: age out chunks indexed before `olderThanDays`. Optional `kinds`
   * filter scopes the sweep (e.g. only prune `learning_*`). Returns count
   * deleted per kind so the GC summary can report the breakdown.
   */
  pruneOldChunks(opts: { olderThanDays: number; kinds?: string[] }): { deleted: number; byKind: Record<string, number> } {
    if (!this.db) return { deleted: 0, byKind: {} };
    const cutoff = new Date(Date.now() - opts.olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const byKind: Record<string, number> = {};
    let total = 0;
    try {
      const kindFilter = (opts.kinds && opts.kinds.length > 0)
        ? `AND kind IN (${opts.kinds.map(() => '?').join(',')})`
        : '';
      const params: any[] = [cutoff, ...(opts.kinds || [])];
      // Pre-count so the GC summary can show per-kind detail.
      const rows = this.db.prepare(
        `SELECT kind, COUNT(*) AS n FROM chunks WHERE indexed_at < ? ${kindFilter} GROUP BY kind`
      ).all(...params) as any[];
      for (const r of rows) { byKind[r.kind] = r.n; total += r.n; }
      if (total > 0) {
        this.db.prepare(
          `DELETE FROM chunks WHERE indexed_at < ? ${kindFilter}`
        ).run(...params);
      }
    } catch { /* swallow — return whatever we got */ }
    return { deleted: total, byKind };
  }

  /**
   * GC: trim each kind down to the most-recent `maxPerKind` chunks.
   * Useful when age-out alone leaves too much (e.g. a runaway worker
   * filling `learning_worker_task` faster than 6h retention can clear).
   */
  enforceMaxPerKind(opts: { maxPerKind: number; kinds?: string[] }): { deleted: number; byKind: Record<string, number> } {
    if (!this.db || opts.maxPerKind < 1) return { deleted: 0, byKind: {} };
    const byKind: Record<string, number> = {};
    let total = 0;
    try {
      const allKinds = opts.kinds && opts.kinds.length > 0
        ? opts.kinds
        : (this.db.prepare('SELECT DISTINCT kind FROM chunks').all() as any[]).map(r => r.kind);
      for (const kind of allKinds) {
        const excess = this.db.prepare(
          `SELECT COUNT(*) AS n FROM chunks WHERE kind = ?`
        ).get(kind) as any;
        if (!excess || excess.n <= opts.maxPerKind) continue;
        const toDelete = excess.n - opts.maxPerKind;
        const res = this.db.prepare(`
          DELETE FROM chunks WHERE id IN (
            SELECT id FROM chunks WHERE kind = ?
            ORDER BY indexed_at ASC, id ASC LIMIT ?
          )
        `).run(kind, toDelete);
        byKind[kind] = res.changes;
        total += res.changes;
      }
    } catch { /* swallow */ }
    return { deleted: total, byKind };
  }

  /**
   * Compute total bytes in the chunks table (best-effort via SUM of text
   * length + embedding blob size). For the dashboard's Storage view.
   */
  approximateCorpusBytes(): { chunks: number; bytes: number } {
    if (!this.db) return { chunks: 0, bytes: 0 };
    try {
      const row = this.db.prepare(
        `SELECT COUNT(*) AS n, SUM(LENGTH(text) + LENGTH(embedding)) AS bytes FROM chunks`
      ).get() as any;
      return { chunks: row?.n || 0, bytes: row?.bytes || 0 };
    } catch { return { chunks: 0, bytes: 0 }; }
  }

  /**
   * Count indexed chunks grouped by `kind`. Used by the Analytics dashboard
   * to surface "the self-learning corpus has N verified chapters" etc.
   * Optional prefix filter — pass 'learning_' to count only the verified-
   * success corpus.
   */
  countChunksByKind(opts: { prefix?: string } = {}): Array<{ kind: string; count: number }> {
    if (!this.db) return [];
    const where = opts.prefix ? "WHERE kind LIKE ?" : '';
    const sql = `SELECT kind, COUNT(*) AS count FROM chunks ${where} GROUP BY kind ORDER BY count DESC`;
    try {
      const rows = opts.prefix
        ? (this.db.prepare(sql).all(`${opts.prefix}%`) as any[])
        : (this.db.prepare(sql).all() as any[]);
      return rows.map(r => ({ kind: r.kind, count: r.count }));
    } catch { return []; }
  }

  /**
   * Count chunks of a given kind (or kind prefix) whose metadata fields all
   * match the supplied filters. Used by self-learning consumers — e.g. scout's
   * coverage check: "how many verified_scout_finding chunks do we already have
   * for {subgenre:'cyberpunk', source:'reddit'}?".
   *
   * `filters` is matched via SQLite json_extract; string values match exactly,
   * numeric values match numerically. Empty filters returns the kind count.
   */
  countChunksWithMetadata(opts: {
    kind?: string;
    kindPrefix?: string;
    filters?: Record<string, string | number>;
  }): number {
    if (!this.db) return 0;
    const where: string[] = [];
    const params: any[] = [];
    if (opts.kind) { where.push('kind = ?'); params.push(opts.kind); }
    if (opts.kindPrefix) { where.push('kind LIKE ?'); params.push(opts.kindPrefix + '%'); }
    if (opts.filters) {
      for (const [k, v] of Object.entries(opts.filters)) {
        where.push(`json_extract(metadata, '$.${k}') = ?`);
        params.push(v);
      }
    }
    const sql = `SELECT COUNT(*) AS n FROM chunks${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
    try {
      const row = this.db.prepare(sql).get(...params) as any;
      return row?.n ?? 0;
    } catch { return 0; }
  }

  /** FTS5 text match on chunks globally across all projects. Returns top-K BM25 ranked hits. */
  searchChunksGlobalFts(opts: {
    query: string;
    kinds?: string[];
    topK?: number;
    tier?: string;
    tiers?: string[];
  }): Array<{
    id: number;
    projectId: string;
    sourceRef: string;
    kind: string;
    chunkIndex: number;
    text: string;
    tokenCount: number;
    score: number;
    metadata: any | null;
    tier?: string;
    parentText?: string;
  }> {
    if (!this.db || !opts.query?.trim()) return [];
    const safeQuery = opts.query.replace(/[\x00-\x1f]/g, '').trim();
    const kindFilter = opts.kinds && opts.kinds.length > 0
      ? `AND c.kind IN (${opts.kinds.map(() => '?').join(',')})`
      : '';
    const targetTiers = opts.tier ? [opts.tier] : opts.tiers;
    const tierFilter = targetTiers && targetTiers.length > 0
      ? `AND c.tier IN (${targetTiers.map(() => '?').join(',')})`
      : '';

    const sql = `
      SELECT c.id, c.project_id, c.source_ref, c.kind, c.chunk_index, c.text, c.token_count, c.metadata, c.tier, p.text AS parent_text,
             bm25(chunks_fts) AS rank
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.rowid
      LEFT JOIN parent_documents p ON p.project_id = c.project_id AND p.source_ref = c.source_ref
      WHERE chunks_fts MATCH ? ${kindFilter} ${tierFilter}
      ORDER BY rank
      LIMIT ?
    `;
    const params = [
      safeQuery,
      ...(opts.kinds || []),
      ...(targetTiers || []),
      Math.min(opts.topK ?? 25, 100)
    ];
    try {
      return this.db.prepare(sql).all(...params).map((r: any) => ({
        id: r.id,
        projectId: r.project_id,
        sourceRef: r.source_ref,
        kind: r.kind,
        chunkIndex: r.chunk_index,
        text: r.text,
        tokenCount: r.token_count,
        score: -r.rank,
        metadata: r.metadata ? (() => { try { return JSON.parse(r.metadata); } catch { return null; } })() : null,
        tier: r.tier,
        parentText: r.parent_text || undefined,
      }));
    } catch (err: any) {
      this.log.warn('searchChunksGlobalFts failed', { error: err.message });
      return [];
    }
  }

  /** Cross-project chunk search (e.g., "where have I written about X across all projects"). */
  searchChunksGlobal(opts: {
    queryEmbedding: number[];
    kinds?: string[];
    topK?: number;
    minScore?: number;
    tier?: string;
    tiers?: string[];
  }): Array<any> {
    if (!this.db) return [];
    const topK = Math.max(1, Math.min(opts.topK ?? 8, 50));
    const minScore = opts.minScore ?? 0;
    const kindFilter = opts.kinds && opts.kinds.length > 0
      ? `c.kind IN (${opts.kinds.map(() => '?').join(',')})`
      : '';
    const targetTiers = opts.tier ? [opts.tier] : opts.tiers;
    const tierFilter = targetTiers && targetTiers.length > 0
      ? `c.tier IN (${targetTiers.map(() => '?').join(',')})`
      : '';
    
    const whereClauses: string[] = [];
    if (kindFilter) whereClauses.push(kindFilter);
    if (tierFilter) whereClauses.push(tierFilter);
    
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const params = [...(opts.kinds || []), ...(targetTiers || [])];

    const rows = this.db.prepare(`
      SELECT c.id, c.project_id, c.source_ref, c.kind, c.chunk_index, c.text, c.token_count, c.embedding, c.metadata, c.tier, p.text AS parent_text
      FROM chunks c
      LEFT JOIN parent_documents p ON p.project_id = c.project_id AND p.source_ref = c.source_ref
      ${whereSql}
    `).all(...params) as any[];
    const q = opts.queryEmbedding;
    let qMag = 0;
    for (let i = 0; i < q.length; i++) qMag += q[i] * q[i];
    qMag = Math.sqrt(qMag);
    if (qMag === 0) return [];

    const scored: any[] = [];
    for (const r of rows) {
      const v = MemoryStore.decodeEmbedding(r.embedding);
      if (v.length !== q.length) continue;
      let dot = 0, vMag = 0;
      for (let i = 0; i < v.length; i++) { dot += q[i] * v[i]; vMag += v[i] * v[i]; }
      vMag = Math.sqrt(vMag);
      if (vMag === 0) continue;
      const score = dot / (qMag * vMag);
      if (score < minScore) continue;
      scored.push({
        id: r.id, projectId: r.project_id, sourceRef: r.source_ref,
        kind: r.kind, chunkIndex: r.chunk_index, text: r.text,
        tokenCount: r.token_count, score,
        metadata: r.metadata ? (() => { try { return JSON.parse(r.metadata); } catch { return null; } })() : null,
        tier: r.tier,
        parentText: r.parent_text || undefined,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Compute the centroid (averaged unit vector) of all chunks for a given kind in a project. */
  computeCentroid(projectId: string, kind: string): number[] | null {
    if (!this.db) return null;
    const rows = this.db.prepare(
      'SELECT embedding FROM chunks WHERE project_id = @projectId AND kind = @kind'
    ).all({ projectId, kind }) as any[];
    if (rows.length === 0) return null;
    let dim = 0;
    let sum: Float64Array | null = null;
    for (const r of rows) {
      const v = MemoryStore.decodeEmbedding(r.embedding);
      if (!sum) { dim = v.length; sum = new Float64Array(dim); }
      if (v.length !== dim) continue;
      for (let i = 0; i < dim; i++) sum[i] += v[i];
    }
    if (!sum) return null;
    const n = rows.length;
    const centroid = new Array(dim);
    let mag = 0;
    for (let i = 0; i < dim; i++) { centroid[i] = sum[i] / n; mag += centroid[i] * centroid[i]; }
    mag = Math.sqrt(mag);
    if (mag > 0) for (let i = 0; i < dim; i++) centroid[i] /= mag;
    return centroid;
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
      'SELECT * FROM entries WHERE project_id = @projectId ORDER BY timestamp ASC, id ASC'
    ).all({ projectId }).map((r: any) => ({
      source: r.source,
      sourceRef: r.source_ref,
      projectId: r.project_id,
      timestamp: r.timestamp,
      title: r.title,
      body: r.body,
      tier: r.tier,
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
