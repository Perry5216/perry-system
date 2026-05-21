/**
 * @perry/ai — EmbeddingService
 *
 * Thin wrapper around the Ollama `/api/embeddings` endpoint. Used for
 * semantic-similarity tasks: voice-anchor dedup, "what did I write about
 * this character before", style-drift detection, future RAG retrieval.
 *
 * Defaults to nomic-embed-text running on the ollama-embeddings container
 * (5070 Ti). 274 MB, 768-dim vectors, ~100ms per query. Cheap and good.
 *
 * The provider field is intentionally narrow — embeddings are always
 * vector-out, never text-out, so they don't share a contract with the
 * chat/completion providers.
 */

import type { Logger } from '@perry/core';

export interface EmbeddingConfig {
  endpoint: string;       // e.g. http://ollama-embeddings:11434
  model: string;          // e.g. nomic-embed-text
  /** Cache results by SHA-256(text+model) for N minutes. 0 disables. */
  cacheTtlMinutes?: number;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dim: number;
  cached: boolean;
}

interface CacheEntry {
  embedding: number[];
  dim: number;
  storedAt: number;
}

export class EmbeddingService {
  private config: EmbeddingConfig;
  private log: Logger;
  private cache = new Map<string, CacheEntry>();
  private cacheTtlMs: number;
  private availabilityCheckedAt = 0;
  private available = false;

  constructor(config: EmbeddingConfig, log: Logger) {
    this.config = config;
    this.log = log;
    this.cacheTtlMs = (config.cacheTtlMinutes ?? 30) * 60 * 1000;
  }

  /** Probe the endpoint. Cached for 30s so repeated isAvailable() calls don't spam Ollama. */
  async isAvailable(): Promise<boolean> {
    if (Date.now() - this.availabilityCheckedAt < 30_000) return this.available;
    try {
      const res = await fetch(`${this.config.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });
      this.available = res.ok;
      this.availabilityCheckedAt = Date.now();
      return this.available;
    } catch {
      this.available = false;
      this.availabilityCheckedAt = Date.now();
      return false;
    }
  }

  /** Compute a single embedding. Returns { embedding, dim, cached }. */
  async embed(text: string): Promise<EmbeddingResult> {
    const cleaned = (text || '').trim();
    if (!cleaned) throw new Error('embed(): text must be non-empty');

    const cacheKey = this.cacheKey(cleaned);
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.storedAt < this.cacheTtlMs) {
      return { embedding: hit.embedding, model: this.config.model, dim: hit.dim, cached: true };
    }

    const res = await fetch(`${this.config.endpoint}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, prompt: cleaned }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama embeddings HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json() as { embedding?: number[] };
    const embedding = data.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`Ollama returned no embedding (check that ${this.config.model} is pulled on ${this.config.endpoint})`);
    }
    const dim = embedding.length;
    this.cache.set(cacheKey, { embedding, dim, storedAt: Date.now() });
    // Bound cache size — drop oldest 50 when we cross 1000 entries.
    if (this.cache.size > 1000) {
      const ordered = [...this.cache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt);
      for (let i = 0; i < 50; i++) this.cache.delete(ordered[i][0]);
    }
    return { embedding, model: this.config.model, dim, cached: false };
  }

  /** Batch embed — sequential under the hood since Ollama doesn't batch on /api/embeddings. */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const out: EmbeddingResult[] = [];
    for (const t of texts) {
      out.push(await this.embed(t));
    }
    return out;
  }

  /** Cosine similarity between two equal-length vectors. Returns [-1, 1]. */
  static cosine(a: number[], b: number[]): number {
    if (a.length !== b.length) throw new Error(`cosine: dim mismatch ${a.length} vs ${b.length}`);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const mag = Math.sqrt(na) * Math.sqrt(nb);
    return mag === 0 ? 0 : dot / mag;
  }

  /** Embed `text` and return cosine similarity against each candidate. */
  async similarityAgainst(text: string, candidates: Array<{ id: string; text: string }>): Promise<Array<{ id: string; score: number }>> {
    const target = await this.embed(text);
    const results: Array<{ id: string; score: number }> = [];
    for (const c of candidates) {
      try {
        const e = await this.embed(c.text);
        results.push({ id: c.id, score: EmbeddingService.cosine(target.embedding, e.embedding) });
      } catch (err: any) {
        this.log.warn('similarityAgainst: embed failed for candidate', { id: c.id, error: err.message });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }

  /** Lightweight stats for dashboard / GC. */
  stats(): { cacheSize: number; model: string; endpoint: string } {
    return { cacheSize: this.cache.size, model: this.config.model, endpoint: this.config.endpoint };
  }

  private cacheKey(text: string): string {
    // Cheap non-crypto hash — DJB2. We don't need collision-resistance, just
    // a stable bucket for the in-memory cache.
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h) ^ text.charCodeAt(i);
    return `${this.config.model}:${h >>> 0}:${text.length}`;
  }
}
