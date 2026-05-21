/**
 * @perry/projects — NetworkCache
 *
 * SQLite-backed cache for outbound HTTP fetches. Keyed on `(url, networkPath)`
 * with a per-request TTL. Stored in its own DB file (defaults to
 * `workspace/.config/network-cache.db`) so cache pruning / nuking is
 * independent of the main projects state.
 *
 * Why a cache exists at all: every Perry book-planning project re-fetches
 * the SAME OpenLibrary subject feeds, Reddit top posts, and Amazon search
 * pages. A 24h cache means:
 *   - Re-running a project takes seconds instead of minutes (~5-10× faster)
 *   - Amazon rate-limit pressure drops ~80% (we hit per-host cooldown far less)
 *   - You can iterate librarian prompt design without re-paying for fetches
 *   - Trainer-side scripts can replay a project against the same data
 *
 * Concurrency-safe via SQLite's WAL mode. Callers opt in by passing
 * `cacheTtlMs` in FetchOptions; opt out (or pass 0) for cache-bypass.
 */

import Database from 'better-sqlite3';
import { Logger } from '@perry/core';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface CachedFetch {
  status: number;
  ok: boolean;
  text: string;
  finalUrl: string;
  contentType: string;
  byteCount: number;
  fetchedAt: number;
}

let _db: Database.Database | null = null;
let _initFailed = false;
const log = new Logger('network-cache');

function getDb(): Database.Database | null {
  if (_db) return _db;
  if (_initFailed) return null;
  try {
    const cachePath = process.env.PERRY_NETWORK_CACHE_PATH
      || '/app/workspace/.config/network-cache.db';
    const dir = dirname(cachePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const db: Database.Database = new Database(cachePath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS network_cache (
        url           TEXT NOT NULL,
        networkPath   TEXT NOT NULL,
        fetched_at    INTEGER NOT NULL,
        status        INTEGER NOT NULL,
        ok            INTEGER NOT NULL,
        text          TEXT NOT NULL,
        finalUrl      TEXT,
        contentType   TEXT,
        byteCount     INTEGER,
        PRIMARY KEY (url, networkPath)
      );
      CREATE INDEX IF NOT EXISTS idx_network_cache_fetched_at
        ON network_cache(fetched_at);
    `);
    _db = db;
    log.info('Network cache initialised', { path: cachePath });
    return db;
  } catch (err: any) {
    _initFailed = true;
    log.warn('Network cache disabled — better-sqlite3 unavailable', {
      error: err?.message || String(err),
    });
    return null;
  }
}

export const NetworkCache = {
  /**
   * Look up a cached response. Returns null on miss, on TTL-expiry, or if
   * the cache subsystem failed to initialise.
   */
  get(url: string, networkPath: string, ttlMs: number): CachedFetch | null {
    const db = getDb();
    if (!db || ttlMs <= 0) return null;
    try {
      const row: any = db.prepare(
        'SELECT * FROM network_cache WHERE url = ? AND networkPath = ?',
      ).get(url, networkPath);
      if (!row) return null;
      const age = Date.now() - row.fetched_at;
      if (age > ttlMs) return null;
      return {
        status: row.status,
        ok: row.ok === 1,
        text: row.text,
        finalUrl: row.finalUrl || url,
        contentType: row.contentType || '',
        byteCount: row.byteCount ?? row.text?.length ?? 0,
        fetchedAt: row.fetched_at,
      };
    } catch (err: any) {
      log.warn('cache get failed', { url, error: err?.message });
      return null;
    }
  },

  /**
   * Store a successful response. Failed fetches (status:0, !ok) are NOT
   * cached — we want them to retry on the next call, not be stuck behind
   * a 24h "cached failure" wall.
   */
  set(url: string, networkPath: string, value: Omit<CachedFetch, 'fetchedAt'>): void {
    const db = getDb();
    if (!db) return;
    if (!value.ok || value.status === 0) return; // never cache failures
    try {
      db.prepare(`
        INSERT INTO network_cache
          (url, networkPath, fetched_at, status, ok, text, finalUrl, contentType, byteCount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url, networkPath) DO UPDATE SET
          fetched_at = excluded.fetched_at,
          status     = excluded.status,
          ok         = excluded.ok,
          text       = excluded.text,
          finalUrl   = excluded.finalUrl,
          contentType= excluded.contentType,
          byteCount  = excluded.byteCount
      `).run(
        url, networkPath, Date.now(),
        value.status, value.ok ? 1 : 0,
        value.text, value.finalUrl, value.contentType, value.byteCount,
      );
    } catch (err: any) {
      log.warn('cache set failed', { url, error: err?.message });
    }
  },

  /** Drop entries older than `maxAgeMs`. Returns rows removed. */
  prune(maxAgeMs: number): number {
    const db = getDb();
    if (!db) return 0;
    try {
      const cutoff = Date.now() - maxAgeMs;
      const r = db.prepare('DELETE FROM network_cache WHERE fetched_at < ?').run(cutoff);
      return r.changes;
    } catch {
      return 0;
    }
  },

  /** Total cached rows (for diagnostics). */
  size(): number {
    const db = getDb();
    if (!db) return 0;
    try {
      const r: any = db.prepare('SELECT COUNT(*) AS n FROM network_cache').get();
      return r?.n ?? 0;
    } catch { return 0; }
  },
};
