/**
 * @perry/tests — RAG Reliability & Hybrid Retrieval Tests
 *
 * Verifies:
 *   1. Parent-child document mapping and storage.
 *   2. FTS5 full-text keyword indexing & retrieval.
 *   3. Reciprocal Rank Fusion (RRF) hybrid scoring.
 *   4. Graceful fallback to FTS5 search when embedding service is offline.
 *
 * Run: node --import tsx packages/tests/rag-reliability.test.ts
 */

import { rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from '../rag/src/memory-store.js';
import { RagService } from '../rag/src/rag-service.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertEqual(actual: any, expected: any, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const mockLog = {
  info: (msg: string, meta?: any) => { console.log(`INFO: ${msg}`, meta || ''); },
  warn: (msg: string, meta?: any) => { console.warn(`WARN: ${msg}`, meta || ''); },
  error: (msg: string, meta?: any) => { console.error(`ERROR: ${msg}`, meta || ''); },
  debug: () => {},
  child: () => mockLog,
} as any;

function createTempWorkspace(): string {
  const systemTemp = tmpdir();
  return mkdtempSync(join(systemTemp, 'perry-rag-reliability-test-'));
}

// Mock Embedding Provider
class MockEmbeddings {
  public available = true;
  public throwOnError = false;

  async isAvailable(): Promise<boolean> {
    if (this.throwOnError) throw new Error('Network error');
    return this.available;
  }

  async embed(text: string): Promise<{ embedding: number[]; model: string; dim: number; cached: boolean }> {
    if (this.throwOnError || !this.available) throw new Error('Embedding service unavailable');
    // Generate a simple deterministic embedding based on text
    const vec = new Array(4).fill(0);
    const lower = text.toLowerCase();
    if (lower.includes('apple')) vec[0] = 1.0;
    if (lower.includes('banana')) vec[1] = 1.0;
    if (lower.includes('orange')) vec[2] = 1.0;
    if (lower.includes('grape')) vec[3] = 1.0;
    return {
      embedding: vec,
      model: 'mock-embed-model',
      dim: 4,
      cached: false
    };
  }
}

console.log('\n─── RAG Reliability & Hybrid Retrieval Tests ───');

await test('Parent document mapping is stored and retrieved', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new MemoryStore(workspaceDir, mockLog);
    await store.initialize();
    const embedder = new MockEmbeddings();
    const rag = new RagService(store, embedder, mockLog);

    const text = 'The quick brown fox jumps over the lazy dog. Green apples are very sweet and tasty.';
    const result = await rag.indexText({
      projectId: 'proj-1',
      sourceRef: 'fox-story',
      kind: 'story',
      text,
      replace: true,
      minChunkChars: 10,
    });

    console.log('INDEX TEXT RESULT:', result);

    assertEqual(result.chunks > 0, true, 'should index at least 1 chunk');

    // Retrieve via vector search and verify parentText is returned
    const hits = await rag.retrieve({
      projectId: 'proj-1',
      query: 'apples',
      topK: 1,
    });

    assertEqual(hits.length, 1, 'should retrieve 1 hit');
    assertEqual(hits[0].parentText, text, 'should attach parent text to chunk hit');

    // Retrieve globally
    const globalHits = await rag.retrieveGlobal({
      query: 'fox',
      topK: 1,
    });
    assertEqual(globalHits.length, 1, 'should retrieve 1 global hit');
    assertEqual(globalHits[0].parentText, text, 'should attach parent text to global chunk hit');

    store.close();
  } finally {
    try { rmSync(workspaceDir, { recursive: true, force: true }); } catch {}
  }
});

await test('FTS5 keyword search works independently', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new MemoryStore(workspaceDir, mockLog);
    await store.initialize();
    const embedder = new MockEmbeddings();
    const rag = new RagService(store, embedder, mockLog);

    await rag.indexText({
      projectId: 'proj-1',
      sourceRef: 'fruit-list',
      kind: 'fruit',
      text: 'First line has sweet banana. Second line has yellow lemon.',
      replace: true,
      minChunkChars: 5,
    });

    // Run FTS5 search directly
    const ftsHits = store.searchChunksFts({
      projectId: 'proj-1',
      query: 'lemon',
      topK: 5,
    });

    assertEqual(ftsHits.length, 1, 'should match 1 chunk via FTS5');
    assert(ftsHits[0].text.includes('yellow lemon'), 'matched chunk text');

    // Run FTS5 search globally
    const ftsGlobalHits = store.searchChunksGlobalFts({
      query: 'banana',
      topK: 5,
    });

    assertEqual(ftsGlobalHits.length, 1, 'should match 1 chunk globally via FTS5');
    assert(ftsGlobalHits[0].text.includes('sweet banana'), 'matched global chunk text');

    store.close();
  } finally {
    try { rmSync(workspaceDir, { recursive: true, force: true }); } catch {}
  }
});

await test('Reciprocal Rank Fusion hybrid search blends vector and keyword ranks', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new MemoryStore(workspaceDir, mockLog);
    await store.initialize();
    const embedder = new MockEmbeddings();
    const rag = new RagService(store, embedder, mockLog);

    // Chunk 1: Has 'apple' in text and embedding
    await rag.indexText({
      projectId: 'proj-1',
      sourceRef: 'doc-apple',
      kind: 'doc',
      text: 'Apples are red fruits.',
      replace: true,
      minChunkChars: 5,
    });

    // Chunk 2: Has 'banana' in text and embedding
    await rag.indexText({
      projectId: 'proj-1',
      sourceRef: 'doc-banana',
      kind: 'doc',
      text: 'Bananas are yellow fruits.',
      replace: true,
      minChunkChars: 5,
    });

    // Search query 'apple banana'
    // Vector search will rank 'apple' or 'banana' highly depending on vector match.
    // FTS search matches both since both terms are present in different docs.
    const hybridHits = await rag.retrieve({
      projectId: 'proj-1',
      query: 'apple OR banana',
      topK: 5,
    });

    assertEqual(hybridHits.length, 2, 'should retrieve both documents');
    assertEqual(hybridHits[0].sourceRef, 'doc-apple', 'Apple doc should be ranked first for query "apple OR banana" (due to matching apple)');

    store.close();
  } finally {
    try { rmSync(workspaceDir, { recursive: true, force: true }); } catch {}
  }
});

await test('Graceful fallback to local FTS5 keyword matching when embedding provider is offline', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new MemoryStore(workspaceDir, mockLog);
    await store.initialize();
    const embedder = new MockEmbeddings();
    const rag = new RagService(store, embedder, mockLog);

    await rag.indexText({
      projectId: 'proj-1',
      sourceRef: 'offline-test',
      kind: 'doc',
      text: 'Keep the mindset that this will run locally in Docker.',
      replace: true,
      minChunkChars: 5,
    });

    // Put embedder in offline mode
    embedder.available = false;

    // Retrieval should not fail, but fall back to FTS5 match
    const hits = await rag.retrieve({
      projectId: 'proj-1',
      query: 'Docker',
      topK: 5,
    });

    assertEqual(hits.length, 1, 'should retrieve matching chunk via FTS5 fallback');
    assertEqual(hits[0].sourceRef, 'offline-test', 'matched chunk');
    assert(hits[0].text.includes('locally in Docker'), 'content verification');

    // Put embedder back online but make embedding throw error
    embedder.available = true;
    embedder.throwOnError = true;

    // Retrieval should still fall back gracefully to FTS5 match
    const hitsOnError = await rag.retrieve({
      projectId: 'proj-1',
      query: 'mindset',
      topK: 5,
    });

    assertEqual(hitsOnError.length, 1, 'should retrieve matching chunk via FTS5 fallback on embed error');
    assertEqual(hitsOnError[0].sourceRef, 'offline-test', 'matched chunk on error');

    // Global retrieval fallback
    const globalHits = await rag.retrieveGlobal({
      query: 'mindset',
      topK: 5,
    });
    assertEqual(globalHits.length, 1, 'should retrieve matching chunk globally via FTS5 fallback');

    store.close();
  } finally {
    try { rmSync(workspaceDir, { recursive: true, force: true }); } catch {}
  }
});

console.log('\n═══════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n✓ All RAG reliability tests passed!');
  process.exit(0);
}
