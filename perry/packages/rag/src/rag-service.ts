/**
 * @perry/rag — RagService
 *
 * Sits on top of MemoryStore (vector storage) + EmbeddingService (embeddings).
 *
 * Responsibilities:
 *   1. Chunk source text into overlapping passages
 *   2. Embed each chunk
 *   3. Persist to MemoryStore.chunks
 *   4. Retrieve top-K by query (vector + optional FTS5 hybrid scoring)
 *   5. Compute centroids (for drift detection)
 *
 * The service is intentionally thin — it's coordination, not models.
 * Embedding model + endpoint live on EmbeddingService; storage lives
 * on MemoryStore.
 */

import type { Logger } from '@perry/core';
import type { MemoryStore } from './memory-store.js';

export interface RagEmbeddingProvider {
  embed(text: string): Promise<{ embedding: number[]; model: string; dim: number; cached: boolean }>;
  isAvailable(): Promise<boolean>;
}

export interface ChunkerOptions {
  /** Target tokens per chunk (rough — we use chars/3.5 as proxy). */
  targetTokens?: number;
  /** Overlap between consecutive chunks, in tokens. */
  overlapTokens?: number;
  /** Minimum chunk size in chars — chunks smaller than this won't be split off. */
  minChunkChars?: number;
}

export interface IndexOptions extends ChunkerOptions {
  /** Replace existing chunks for this sourceRef before inserting new ones. */
  replace?: boolean;
  /** Optional per-source metadata stamped on every chunk (e.g., chapterNumber). */
  metadata?: Record<string, any>;
  /** Optional memory tier ('library', 'session', 'feedback') */
  tier?: string;
}

export interface RagHit {
  id: number;
  sourceRef: string;
  kind: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  score: number;
  metadata: any | null;
  parentText?: string;
}

const DEFAULT_TARGET_TOKENS = 400;
const DEFAULT_OVERLAP_TOKENS = 60;
const DEFAULT_MIN_CHARS = 80;

export class RagService {
  constructor(
    private store: MemoryStore,
    private embeddings: RagEmbeddingProvider,
    private log: Logger,
  ) {}

  /**
   * Lightweight NER — pulls likely proper nouns out of a chunk for tagging.
   * No LLM call; pattern-based. Catches Title-Cased multi-word names, all-
   * caps acronyms, and quoted faction/location names. Cheap (~1ms per chunk)
   * and good enough to power "all chunks mentioning Kaelen" queries. False
   * positives are fine — entity tags are advisory, not authoritative.
   */
  static extractEntities(text: string, maxPerChunk: number = 20): string[] {
    const found = new Set<string>();
    // Title-cased multi-word phrases: "Kaelen Dain", "Lisbon Packet", "The Constellate"
    const reMulti = /(?:[A-Z][a-z'\-]{1,}(?:\s+(?:de|of|the|du|von|d')?\s*[A-Z][a-z'\-]+){1,3})/g;
    // Single Title-cased word followed by lower-case = likely a name in context
    const reSingle = /(?<=^|[^\w'])([A-Z][a-z]{2,}(?:[-'][A-Z][a-z]+)?)(?=\s+[a-z])/g;
    // All-caps tokens 3+ chars
    const reAcronym = /\b[A-Z]{3,}(?:-[A-Z0-9]+)*\b/g;
    for (const re of [reMulti, reSingle, reAcronym]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const candidate = (m[1] || m[0]).trim();
        if (candidate.length < 3 || candidate.length > 60) continue;
        // Reject common sentence-starting words
        if (/^(The|This|That|These|Those|But|And|For|Or|So|Now|Then|When|Where|Why|How|What|Who|Yet|If|Though|Although|Because|Since|While|After|Before|During|Inside|Outside|Above|Below|Across|Through|Behind|Beside|Beneath|However|Therefore|Meanwhile|Suddenly|Slowly|Quickly|Finally|Once)$/i.test(candidate)) continue;
        found.add(candidate);
        if (found.size >= maxPerChunk) return [...found];
      }
    }
    return [...found];
  }

  /**
   * Split text into overlapping chunks. Prefers paragraph boundaries
   * (double-newline), falls back to sentence boundaries, then to hard
   * char-count splits. Each chunk is ~targetTokens long with `overlapTokens`
   * carried over from the previous chunk's tail so semantics aren't lost
   * at boundaries.
   */
  chunk(text: string, opts: ChunkerOptions = {}): Array<{ text: string; tokenCount: number }> {
    const targetTokens = opts.targetTokens ?? DEFAULT_TARGET_TOKENS;
    const overlapTokens = opts.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
    const minChars = opts.minChunkChars ?? DEFAULT_MIN_CHARS;

    // Char-based proxy for tokens (English ≈ 3.5 chars/token)
    const targetChars = Math.floor(targetTokens * 3.5);
    const overlapChars = Math.floor(overlapTokens * 3.5);

    const cleaned = text.replace(/\r\n/g, '\n').trim();
    if (cleaned.length === 0) return [];
    if (cleaned.length <= targetChars) {
      return [{ text: cleaned, tokenCount: Math.ceil(cleaned.length / 3.5) }];
    }

    // First pass: break into paragraphs
    const paragraphs = cleaned.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
    const chunks: Array<{ text: string; tokenCount: number }> = [];
    let buffer = '';

    const pushBuffer = () => {
      if (buffer.length >= minChars) {
        chunks.push({ text: buffer.trim(), tokenCount: Math.ceil(buffer.length / 3.5) });
      } else if (buffer.length > 0 && chunks.length > 0) {
        // Too-small tail — fold into the previous chunk
        const last = chunks[chunks.length - 1];
        last.text = `${last.text}\n\n${buffer.trim()}`;
        last.tokenCount = Math.ceil(last.text.length / 3.5);
      }
      buffer = '';
    };

    for (const p of paragraphs) {
      // Paragraph itself exceeds target — split by sentence
      if (p.length > targetChars) {
        pushBuffer();
        const sentences = p.match(/[^.!?\n]+[.!?]+(?:\s|$)|[^.!?\n]+$/g) || [p];
        for (const s of sentences) {
          if (buffer.length + s.length + 2 > targetChars && buffer.length > 0) {
            pushBuffer();
            // Carry overlap from end of previous chunk
            if (chunks.length > 0) {
              const prevTail = chunks[chunks.length - 1].text.slice(-overlapChars);
              buffer = prevTail + ' ';
            }
          }
          buffer += (buffer.length > 0 && !buffer.endsWith('\n') ? ' ' : '') + s.trim();
        }
        continue;
      }

      // Adding this paragraph would overflow — flush and carry overlap
      if (buffer.length + p.length + 2 > targetChars && buffer.length > 0) {
        pushBuffer();
        if (chunks.length > 0) {
          const prevTail = chunks[chunks.length - 1].text.slice(-overlapChars);
          buffer = prevTail + '\n\n';
        }
      }
      buffer += (buffer.length > 0 ? '\n\n' : '') + p;
    }
    pushBuffer();

    return chunks;
  }

  /**
   * Index a text blob: chunk → embed → store. Idempotent on (projectId, sourceRef)
   * when `replace=true` — wipes existing chunks for that source first.
   * Returns the number of chunks indexed.
   */
  async indexText(opts: {
    projectId: string;
    sourceRef: string;
    kind: string;
    text: string;
  } & IndexOptions): Promise<{ chunks: number; skipped: boolean; reason?: string }> {
    if (!(await this.embeddings.isAvailable())) {
      return { chunks: 0, skipped: true, reason: 'embedding-service-unavailable' };
    }
    if (!opts.text || opts.text.trim().length < (opts.minChunkChars ?? DEFAULT_MIN_CHARS)) {
      return { chunks: 0, skipped: true, reason: 'text-too-short' };
    }

    // Skip indexing if already chunked and we are not forcing a replace
    if (!opts.replace && this.store.hasChunksForSource(opts.projectId, opts.sourceRef)) {
      return { chunks: 0, skipped: true, reason: 'already-indexed' };
    }

    if (opts.replace) {
      this.store.deleteChunksBySource(opts.projectId, opts.sourceRef);
    }

    const chunks = this.chunk(opts.text, opts);
    const CONCURRENCY_LIMIT = 5;
    const results: Array<{
      chunkIndex: number;
      text: string;
      tokenCount: number;
      embedding: number[];
      embedModel: string;
      embedDim: number;
      entities: string[];
    } | null> = [];

    // Process chunk embedding in concurrent batches
    for (let i = 0; i < chunks.length; i += CONCURRENCY_LIMIT) {
      const batch = chunks.slice(i, i + CONCURRENCY_LIMIT);
      const batchPromises = batch.map(async (c, index) => {
        const chunkIndex = i + index;
        try {
          const e = await this.embeddings.embed(c.text);
          const entities = RagService.extractEntities(c.text);
          return {
            chunkIndex,
            text: c.text,
            tokenCount: c.tokenCount,
            embedding: e.embedding,
            embedModel: e.model,
            embedDim: e.dim,
            entities,
          };
        } catch (err: any) {
          this.log.warn('chunk embed failed — skipping chunk', {
            sourceRef: opts.sourceRef, chunkIndex, error: err.message,
          });
          return null;
        }
      });
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    let stored = 0;
    for (const r of results) {
      if (!r) continue;
      const id = this.store.upsertChunk({
        projectId: opts.projectId,
        sourceRef: opts.sourceRef,
        kind: opts.kind,
        chunkIndex: r.chunkIndex,
        text: r.text,
        tokenCount: r.tokenCount,
        embedding: r.embedding,
        embedModel: r.embedModel,
        embedDim: r.embedDim,
        metadata: { ...(opts.metadata || {}), entities: r.entities },
        tier: opts.tier,
      });
      if (id !== null) stored++;
    }

    if (stored > 0) {
      this.store.upsertParentDocument(opts.projectId, opts.sourceRef, opts.text);
    }

    this.log.info('Indexed text', {
      projectId: opts.projectId, sourceRef: opts.sourceRef, kind: opts.kind,
      chunks: stored, totalChars: opts.text.length,
    });
    return { chunks: stored, skipped: false };
  }

  /**
   * Gated index: runs `gate()` first and only writes to the index when the
   * verdict is `verified: true`. Stored under `learning_{kind}` so the
   * verified-success corpus is queryable separately from raw retrieval
   * indexes — RAG queries that drive new generation should target the
   * `learning_*` kinds, while retrieval/drift queries can keep using the
   * raw kinds. The `verified.reason` is preserved in chunk metadata for
   * debuggability ("why did we decide this was good?").
   *
   * Failed gates are logged at info, not as errors — they're an expected
   * outcome (most worker outputs fail the verification bar, by design).
   */
  async indexIfVerified(opts: {
    projectId: string;
    sourceRef: string;
    kind: string;
    text: string;
    gate: () => { verified: boolean; reason: string } | Promise<{ verified: boolean; reason: string }>;
  } & IndexOptions): Promise<{ indexed: boolean; reason: string; chunks?: number }> {
    let verdict: { verified: boolean; reason: string };
    try {
      verdict = await opts.gate();
    } catch (err: any) {
      this.log.warn('learning-gate threw, treating as not-verified', {
        sourceRef: opts.sourceRef, kind: opts.kind, error: err.message,
      });
      return { indexed: false, reason: `gate-error: ${err.message}` };
    }
    if (!verdict.verified) {
      this.log.info('skipped learning index (not verified)', {
        sourceRef: opts.sourceRef, kind: opts.kind, reason: verdict.reason,
      });
      return { indexed: false, reason: verdict.reason };
    }
    const learningKind = `learning_${opts.kind}`;
    const result = await this.indexText({
      projectId: opts.projectId,
      sourceRef: opts.sourceRef,
      kind: learningKind,
      text: opts.text,
      replace: opts.replace,
      metadata: { ...(opts.metadata || {}), verifiedReason: verdict.reason },
      minChunkChars: opts.minChunkChars,
      targetTokens: opts.targetTokens,
      overlapTokens: opts.overlapTokens,
      tier: opts.tier,
    });
    return {
      indexed: !result.skipped && result.chunks > 0,
      reason: verdict.reason,
      chunks: result.chunks,
    };
  }

  /** Fuses Vector and FTS search results using Reciprocal Rank Fusion (RRF) */
  private fuseRrf<T extends { id: number }>(vectorHits: T[], ftsHits: T[], topK: number): T[] {
    const k = 60; // Standard constant
    const scores = new Map<number, number>();
    const docMap = new Map<number, T>();

    // Process Vector Hits
    vectorHits.forEach((hit, index) => {
      const rank = index + 1;
      const rrf = 1 / (k + rank);
      scores.set(hit.id, rrf);
      docMap.set(hit.id, hit);
    });

    // Process FTS Hits
    ftsHits.forEach((hit, index) => {
      const rank = index + 1;
      const rrf = 1 / (k + rank);
      const prev = scores.get(hit.id) || 0;
      scores.set(hit.id, prev + rrf);
      if (!docMap.has(hit.id)) {
        docMap.set(hit.id, hit);
      }
    });

    // Sort by merged RRF score descending
    const merged = Array.from(docMap.keys()).map(id => {
      const hit = docMap.get(id)!;
      const rrfScore = scores.get(id)!;
      return {
        ...hit,
        score: rrfScore, // Use the fused RRF score
      };
    });

    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, topK);
  }

  /**
   * Retrieve top-K relevant chunks for a query string. Scoped to a project
   * and optionally to specific kinds (e.g., only 'bible' chunks).
   */
  async retrieve(opts: {
    projectId: string;
    query: string;
    kinds?: string[];
    topK?: number;
    minScore?: number;
    tier?: string;
  }): Promise<RagHit[]> {
    if (!opts.query?.trim()) return [];
    const topK = opts.topK ?? 8;

    // Check if embedding service is available
    let embeddingAvailable = false;
    try {
      embeddingAvailable = await this.embeddings.isAvailable();
    } catch {
      embeddingAvailable = false;
    }

    if (!embeddingAvailable) {
      this.log.info('Embedding service offline; falling back to local FTS5 keyword match for retrieve', {
        projectId: opts.projectId,
        query: opts.query
      });
      return this.store.searchChunksFts({
        projectId: opts.projectId,
        query: opts.query,
        kinds: opts.kinds,
        topK,
        tier: opts.tier,
      });
    }

    try {
      // 1. Embed query (or fall back to FTS-only on failure)
      let qEmb: { embedding: number[] };
      try {
        qEmb = await this.embeddings.embed(opts.query);
      } catch (err: any) {
        this.log.warn('Query embedding failed; falling back to local FTS5 keyword match', {
          projectId: opts.projectId,
          query: opts.query,
          error: err.message
        });
        return this.store.searchChunksFts({
          projectId: opts.projectId,
          query: opts.query,
          kinds: opts.kinds,
          topK,
          tier: opts.tier,
        });
      }

      // 2. Run Vector and FTS searches in parallel
      const searchLimit = Math.max(topK * 3, 50);

      const [vectorHits, ftsHits] = await Promise.all([
        this.store.searchChunks({
          projectId: opts.projectId,
          queryEmbedding: qEmb.embedding,
          kinds: opts.kinds,
          topK: searchLimit,
          minScore: opts.minScore,
          tier: opts.tier,
        }),
        this.store.searchChunksFts({
          projectId: opts.projectId,
          query: opts.query,
          kinds: opts.kinds,
          topK: searchLimit,
          tier: opts.tier,
        })
      ]);

      // 3. Merge and rank using RRF
      return this.fuseRrf(vectorHits, ftsHits, topK);
    } catch (err: any) {
      this.log.warn('retrieve failed, falling back to local FTS5 keyword match', { error: err.message });
      try {
        return this.store.searchChunksFts({
          projectId: opts.projectId,
          query: opts.query,
          kinds: opts.kinds,
          topK,
          tier: opts.tier,
        });
      } catch (ftsErr: any) {
        this.log.error('Fallback FTS5 search also failed', { error: ftsErr.message });
        return [];
      }
    }
  }

  /** Global (cross-project) retrieval. */
  async retrieveGlobal(opts: {
    query: string;
    kinds?: string[];
    topK?: number;
    minScore?: number;
    tier?: string;
  }): Promise<any[]> {
    if (!opts.query?.trim()) return [];
    const topK = opts.topK ?? 8;

    // Check if embedding service is available
    let embeddingAvailable = false;
    try {
      embeddingAvailable = await this.embeddings.isAvailable();
    } catch {
      embeddingAvailable = false;
    }

    if (!embeddingAvailable) {
      this.log.info('Embedding service offline; falling back to local FTS5 keyword match for retrieveGlobal', {
        query: opts.query
      });
      return this.store.searchChunksGlobalFts({
        query: opts.query,
        kinds: opts.kinds,
        topK,
        tier: opts.tier,
      });
    }

    try {
      // 1. Embed query (or fall back to FTS-only on failure)
      let qEmb: { embedding: number[] };
      try {
        qEmb = await this.embeddings.embed(opts.query);
      } catch (err: any) {
        this.log.warn('Query embedding failed in retrieveGlobal; falling back to local FTS5 keyword match', {
          query: opts.query,
          error: err.message
        });
        return this.store.searchChunksGlobalFts({
          query: opts.query,
          kinds: opts.kinds,
          topK,
          tier: opts.tier,
        });
      }

      // 2. Run Vector and FTS searches in parallel
      const searchLimit = Math.max(topK * 3, 50);

      const [vectorHits, ftsHits] = await Promise.all([
        this.store.searchChunksGlobal({
          queryEmbedding: qEmb.embedding,
          kinds: opts.kinds,
          topK: searchLimit,
          minScore: opts.minScore,
          tier: opts.tier,
        }),
        this.store.searchChunksGlobalFts({
          query: opts.query,
          kinds: opts.kinds,
          topK: searchLimit,
          tier: opts.tier,
        })
      ]);

      // 3. Merge and rank using RRF
      return this.fuseRrf(vectorHits, ftsHits, topK);
    } catch (err: any) {
      this.log.warn('retrieveGlobal failed, falling back to local FTS5 keyword match', { error: err.message });
      try {
        return this.store.searchChunksGlobalFts({
          query: opts.query,
          kinds: opts.kinds,
          topK,
          tier: opts.tier,
        });
      } catch (ftsErr: any) {
        this.log.error('Fallback global FTS5 search also failed', { error: ftsErr.message });
        return [];
      }
    }
  }

  /**
   * Find every chunk in a project whose entity tags include the given name.
   * Case-insensitive substring on tagged entities. Use for "show me every
   * chapter that mentions Kaelen" or "which bible sections describe Lisbon".
   * Optionally filter by kind. Returns chunks grouped by source so a single
   * chapter showing up multiple times collapses into one entry.
   */
  findByEntity(opts: {
    projectId: string;
    entity: string;
    kinds?: string[];
    topPerSource?: number;
  }): Array<{ sourceRef: string; kind: string; mentions: number; chunks: Array<{ chunkIndex: number; text: string; entities: string[] }> }> {
    const needle = opts.entity.trim().toLowerCase();
    if (!needle) return [];
    const all = (this.store as any).db
      .prepare(`SELECT source_ref, kind, chunk_index, text, metadata FROM chunks WHERE project_id = ?${
        opts.kinds && opts.kinds.length > 0 ? ` AND kind IN (${opts.kinds.map(() => '?').join(',')})` : ''
      }`)
      .all(opts.projectId, ...(opts.kinds || [])) as any[];
    const bySource = new Map<string, { kind: string; chunks: Array<{ chunkIndex: number; text: string; entities: string[] }> }>();
    for (const row of all) {
      let meta: any = null;
      try { meta = row.metadata ? JSON.parse(row.metadata) : null; } catch { meta = null; }
      const entities: string[] = Array.isArray(meta?.entities) ? meta.entities : [];
      const matched = entities.some(e => e.toLowerCase().includes(needle));
      if (!matched) continue;
      if (!bySource.has(row.source_ref)) bySource.set(row.source_ref, { kind: row.kind, chunks: [] });
      bySource.get(row.source_ref)!.chunks.push({
        chunkIndex: row.chunk_index,
        text: row.text,
        entities,
      });
    }
    const topPerSource = opts.topPerSource ?? 3;
    return [...bySource.entries()].map(([sourceRef, v]) => ({
      sourceRef,
      kind: v.kind,
      mentions: v.chunks.length,
      chunks: v.chunks.slice(0, topPerSource),
    })).sort((a, b) => b.mentions - a.mentions);
  }

  /**
   * Coverage check — count chunks of a kind matching metadata filters. Used by
   * self-learning consumers to decide whether a slice is saturated. E.g. scout
   * calls `countWithMetadata({kind:'scout_finding', filters:{subgenre:'cyberpunk', source:'reddit'}})`
   * and, if the count clears its saturation threshold, narrows its next crawl
   * to under-covered slices instead of re-pulling the same threads.
   */
  countWithMetadata(opts: {
    kind?: string;
    kindPrefix?: string;
    filters?: Record<string, string | number>;
  }): number {
    return this.store.countChunksWithMetadata(opts);
  }

  /** Stats for a project: total chunks + per-kind breakdown. */
  stats(projectId: string): { total: number; byKind: Record<string, number> } {
    const total = this.store.countChunks(projectId);
    // No per-kind count helper on MemoryStore — emulate with a small query
    const byKind: Record<string, number> = {};
    const KINDS = ['chapter', 'voice_anchor', 'bible_character', 'bible_setting', 'bible_architecture', 'bible_stats', 'bible_world', 'bible_premise', 'outline'];
    for (const k of KINDS) {
      const n = this.store.countChunks(projectId, k);
      if (n > 0) byKind[k] = n;
    }
    return { total, byKind };
  }

  /**
   * Compute drift score for a passage vs the centroid of a kind (e.g., 'voice_anchor').
   * Returns the cosine similarity between the passage embedding and the centroid.
   * Higher = more on-voice. Typical interpretation:
   *   > 0.85 — strongly on voice
   *   0.70–0.85 — neutral / acceptable
   *   < 0.70 — drift; consider re-anchoring
   */
  async driftScore(opts: {
    projectId: string;
    text: string;
    centroidKind: string;        // usually 'voice_anchor'
    centroidProjectId?: string;   // defaults to projectId; pass pen-wide projectId for cross-book centroid
  }): Promise<{ score: number | null; centroidExists: boolean; centroidProjectId: string } | null> {
    if (!(await this.embeddings.isAvailable())) return null;
    const centroidProjectId = opts.centroidProjectId ?? opts.projectId;
    const centroid = this.store.computeCentroid(centroidProjectId, opts.centroidKind);
    if (!centroid) return { score: null, centroidExists: false, centroidProjectId };
    try {
      const e = await this.embeddings.embed(opts.text);
      let dot = 0, m1 = 0, m2 = 0;
      for (let i = 0; i < centroid.length; i++) {
        dot += centroid[i] * e.embedding[i];
        m1 += centroid[i] * centroid[i];
        m2 += e.embedding[i] * e.embedding[i];
      }
      const score = (m1 === 0 || m2 === 0) ? 0 : dot / (Math.sqrt(m1) * Math.sqrt(m2));
      return { score, centroidExists: true, centroidProjectId };
    } catch (err: any) {
      this.log.warn('driftScore embed failed', { error: err.message });
      return { score: null, centroidExists: true, centroidProjectId };
    }
  }
}
