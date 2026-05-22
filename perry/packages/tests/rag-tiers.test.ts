/**
 * @perry/tests — RAG 3-Tier Architecture Tests
 *
 * Verifies SQLite migrations, automatic tier mapping, and tier-specific searches.
 *
 * Run: node --import tsx packages/tests/rag-tiers.test.ts
 */

import { rmSync, mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { MemoryStore, getTierForKind, getTierForSource } from '../rag/src/index.js';

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
  info: () => {},
  warn: () => {},
  error: (msg: string, meta?: any) => { console.error(`ERROR: ${msg}`, meta); },
  debug: () => {},
  child: () => mockLog,
} as any;

// Helper to create fresh temp workspace
function createTempWorkspace(): string {
  const systemTemp = tmpdir();
  return mkdtempSync(join(systemTemp, 'perry-test-workspace-'));
}

console.log('\n─── 1. Automatic Tier Mapping Tests ───');

await test('getTierForKind maps kinds correctly', () => {
  // Feedback
  assertEqual(getTierForKind('learning_scout_finding'), 'feedback', 'learning_*');
  assertEqual(getTierForKind('voice_anchor'), 'feedback', 'voice_anchor');
  assertEqual(getTierForKind('voyager_tool'), 'feedback', 'voyager_tool');
  assertEqual(getTierForKind('verified_scout_finding'), 'feedback', 'verified_scout_finding');

  // Session
  assertEqual(getTierForKind('session_chat'), 'session', 'session_chat');
  assertEqual(getTierForKind('recent_context'), 'session', 'recent_context');
  assertEqual(getTierForKind('active_task'), 'session', 'active_task');
  assertEqual(getTierForKind('step_history'), 'session', 'step_history');
  assertEqual(getTierForKind('chat_memory'), 'session', 'chat_memory');
  assertEqual(getTierForKind('project_step'), 'session', 'project_step');

  // Library
  assertEqual(getTierForKind('bible_character'), 'library', 'bible_character');
  assertEqual(getTierForKind('manuscript'), 'library', 'manuscript');
  assertEqual(getTierForKind('unknown_kind'), 'library', 'unknown');
});

await test('getTierForSource maps sources correctly', () => {
  assertEqual(getTierForSource('project_step'), 'session', 'project_step');
  assertEqual(getTierForSource('conversation'), 'session', 'conversation');
  assertEqual(getTierForSource('manuscript'), 'library', 'manuscript');
  assertEqual(getTierForSource('note'), 'library', 'note');
  assertEqual(getTierForSource('other_source'), 'library', 'other');
});

console.log('\n─── 2. SQLite Database Schema Migration Tests ───');

await test('Fresh initialization includes tier column and indices', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new MemoryStore(workspaceDir, mockLog);
    await store.initialize();

    assert(store.isAvailable(), 'MemoryStore should be initialized and available');

    // Check table schemas
    const db = (store as any).db;
    const entriesCols = db.pragma('table_info(entries)') as { name: string }[];
    const chunksCols = db.pragma('table_info(chunks)') as { name: string }[];

    assert(entriesCols.some(c => c.name === 'tier'), 'entries table should contain tier column');
    assert(chunksCols.some(c => c.name === 'tier'), 'chunks table should contain tier column');

    // Check index existence
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
    assert(indexes.some(idx => idx.name === 'idx_entries_project_tier'), 'entries project tier index should exist');
    assert(indexes.some(idx => idx.name === 'idx_chunks_project_tier'), 'chunks project tier index should exist');

    store.close();
  } finally {
    try { rmSync(workspaceDir, { recursive: true, force: true }); } catch {}
  }
});

await test('Migration of existing legacy schema adds tier column and defaults to library', async () => {
  const workspaceDir = createTempWorkspace();
  const dbDir = join(workspaceDir, 'memory');
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, 'memory.db');

  try {
    // 1. Manually build a legacy database structure
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE entries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        source      TEXT NOT NULL,
        source_ref  TEXT NOT NULL,
        project_id  TEXT NOT NULL,
        timestamp   TEXT NOT NULL,
        title       TEXT,
        body        TEXT NOT NULL,
        UNIQUE(source, source_ref, project_id)
      );
      CREATE INDEX idx_entries_project ON entries(project_id);
      CREATE INDEX idx_entries_timestamp ON entries(timestamp);

      CREATE TABLE chunks (
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
        UNIQUE(project_id, source_ref, chunk_index)
      );
      CREATE INDEX idx_chunks_project_kind ON chunks(project_id, kind);
      CREATE INDEX idx_chunks_source_ref ON chunks(source_ref);
    `);

    // Insert legacy data
    db.prepare(`
      INSERT INTO entries (source, source_ref, project_id, timestamp, title, body)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('manuscript', 'chap1', 'proj-1', '2026-05-22T00:00:00Z', 'Chapter 1', 'Prose of chap 1');

    // Create a 4-dimensional mock embedding blob (4 * 4 bytes float)
    const vec = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const blob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);

    db.prepare(`
      INSERT INTO chunks (project_id, source_ref, kind, chunk_index, text, token_count, embedding, embed_model, embed_dim, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('proj-1', 'chap1', 'manuscript', 0, 'Prose of chap 1', 4, blob, 'mock-model', 4, '2026-05-22T00:00:00Z');

    db.close();

    // 2. Initialize using MemoryStore (this triggers the migrations)
    const store = new MemoryStore(workspaceDir, mockLog);
    await store.initialize();

    assert(store.isAvailable(), 'MemoryStore should initialize legacy DB successfully');

    // 3. Verify data and columns
    const migDb = (store as any).db;
    const entriesCols = migDb.pragma('table_info(entries)') as { name: string }[];
    assert(entriesCols.some(c => c.name === 'tier'), 'entries should now have tier column');

    const entry = migDb.prepare('SELECT * FROM entries WHERE project_id = ?').get('proj-1') as any;
    assertEqual(entry.tier, 'library', 'legacy entry tier should default to library');

    const chunksCols = migDb.pragma('table_info(chunks)') as { name: string }[];
    assert(chunksCols.some(c => c.name === 'tier'), 'chunks should now have tier column');

    const chunk = migDb.prepare('SELECT * FROM chunks WHERE project_id = ?').get('proj-1') as any;
    assertEqual(chunk.tier, 'library', 'legacy chunk tier should default to library');

    // Check if the indexes referencing 'tier' are created
    const indexes = migDb.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
    assert(indexes.some(idx => idx.name === 'idx_entries_project_tier'), 'entries project tier index should exist after migration');
    assert(indexes.some(idx => idx.name === 'idx_chunks_project_tier'), 'chunks project tier index should exist after migration');

    store.close();
  } finally {
    try { rmSync(workspaceDir, { recursive: true, force: true }); } catch {}
  }
});

console.log('\n─── 3. Tier Query and Filtering Tests ───');

await test('Tier filtering in searchProject and searchChunks works correctly', async () => {
  const workspaceDir = createTempWorkspace();
  try {
    const store = new MemoryStore(workspaceDir, mockLog);
    await store.initialize();

    // Insert entries with different tiers
    // Explicit tier
    store.upsert({
      source: 'manuscript',
      sourceRef: 'bible-ref',
      projectId: 'proj-test',
      timestamp: '2026-05-22T01:00:00Z',
      title: 'Bible Entry',
      body: 'Green apples are sweet.',
      tier: 'library',
    });

    // Auto-mapped from source
    store.upsert({
      source: 'project_step', // Maps to 'session'
      sourceRef: 'step-ref',
      projectId: 'proj-test',
      timestamp: '2026-05-22T01:01:00Z',
      title: 'Step Log Entry',
      body: 'Worker completed the draft of Chapter 1.',
    });

    // Explicit tier feedback
    store.upsert({
      source: 'conversation',
      sourceRef: 'anchor-ref',
      projectId: 'proj-test',
      timestamp: '2026-05-22T01:02:00Z',
      title: 'Voice Anchor Entry',
      body: 'Verified style instructions for character speech.',
      tier: 'feedback',
    });

    // Verify searchProject filtering
    // 1. Without tier filter (returns everything matching query)
    const hitsAll = store.searchProject('proj-test', 'sweet OR worker OR speech');
    assertEqual(hitsAll.length, 3, 'should return all matches when no tier specified');

    // 2. Filter by 'library'
    const hitsLib = store.searchProject('proj-test', 'sweet OR worker OR speech', 25, 'library');
    assertEqual(hitsLib.length, 1, 'library filter hit count');
    assertEqual(hitsLib[0].sourceRef, 'bible-ref', 'library filter sourceRef');

    // 3. Filter by 'session'
    const hitsSess = store.searchProject('proj-test', 'sweet OR worker OR speech', 25, 'session');
    assertEqual(hitsSess.length, 1, 'session filter hit count');
    assertEqual(hitsSess[0].sourceRef, 'step-ref', 'session filter sourceRef');

    // 4. Filter by 'feedback'
    const hitsFeed = store.searchProject('proj-test', 'sweet OR worker OR speech', 25, 'feedback');
    assertEqual(hitsFeed.length, 1, 'feedback filter hit count');
    assertEqual(hitsFeed[0].sourceRef, 'anchor-ref', 'feedback filter sourceRef');

    // ─── Chunk searches ───
    const vec1 = [1.0, 0.0, 0.0, 0.0];
    const vec2 = [0.0, 1.0, 0.0, 0.0];

    // Insert chunks
    store.upsertChunk({
      projectId: 'proj-test',
      sourceRef: 'bible-chunk',
      kind: 'bible', // library
      chunkIndex: 0,
      text: 'Bible text',
      tokenCount: 2,
      embedding: vec1,
      embedModel: 'mock',
      embedDim: 4,
    });

    store.upsertChunk({
      projectId: 'proj-test',
      sourceRef: 'anchor-chunk',
      kind: 'voice_anchor', // feedback
      chunkIndex: 0,
      text: 'Anchor text',
      tokenCount: 2,
      embedding: vec1,
      embedModel: 'mock',
      embedDim: 4,
    });

    // Query with vec1
    // Without tier filter
    const chunkHitsAll = store.searchChunks({
      projectId: 'proj-test',
      queryEmbedding: vec1,
      topK: 5,
    });
    assertEqual(chunkHitsAll.length, 2, 'should return all matching chunks when no tier specified');

    // With library tier filter
    const chunkHitsLib = store.searchChunks({
      projectId: 'proj-test',
      queryEmbedding: vec1,
      tier: 'library',
      topK: 5,
    });
    assertEqual(chunkHitsLib.length, 1, 'library chunk filter hit count');
    assertEqual(chunkHitsLib[0].sourceRef, 'bible-chunk', 'library chunk sourceRef');

    // With feedback tier filter
    const chunkHitsFeed = store.searchChunks({
      projectId: 'proj-test',
      queryEmbedding: vec1,
      tier: 'feedback',
      topK: 5,
    });
    assertEqual(chunkHitsFeed.length, 1, 'feedback chunk filter hit count');
    assertEqual(chunkHitsFeed[0].sourceRef, 'anchor-chunk', 'feedback chunk sourceRef');

    // Global chunk search
    const globalHitsLib = store.searchChunksGlobal({
      queryEmbedding: vec1,
      tier: 'library',
      topK: 5,
    });
    assertEqual(globalHitsLib.length, 1, 'global library chunk filter hit count');
    assertEqual(globalHitsLib[0].sourceRef, 'bible-chunk', 'global library chunk sourceRef');

    store.close();
  } finally {
    try { rmSync(workspaceDir, { recursive: true, force: true }); } catch {}
  }
});

// ═══════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n✓ All tests passed!');
  process.exit(0);
}
