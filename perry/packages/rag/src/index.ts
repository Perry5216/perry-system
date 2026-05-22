/**
 * @perry/rag — Public API
 */

export { MemoryStore, getTierForKind, getTierForSource } from './memory-store.js';
export type { MemoryEntry, SearchHit, MemoryStats, MemorySource, RagTier } from './memory-store.js';
export { ContextEngine } from './context-engine.js';
export type { ProjectContext } from './context-engine.js';
export { EntityIndexer } from './entity-indexer.js';
export { RagService } from './rag-service.js';
export type { RagHit, RagEmbeddingProvider, ChunkerOptions, IndexOptions } from './rag-service.js';
