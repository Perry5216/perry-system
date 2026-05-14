/**
 * @perry/core — Shared Types
 *
 * Every data structure in the system lives here. No package defines
 * its own project/step/entity types — they all import from core.
 */

// ═══════════════════════════════════════════════════════════
// Project Types
// ═══════════════════════════════════════════════════════════

export type ProjectType =
  | 'book-planning'
  | 'novel-pipeline'
  | 'deep-revision'
  | 'revision-execution'
  | 'book-production'
  | 'short-story'
  | 'style-calibration'
  | 'book-cover'
  | 'amazon-kdp-launch';

export type ProjectStatus = 'pending' | 'active' | 'paused' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

export interface ProjectStep {
  id: string;
  label: string;
  phase: string;
  taskType: string;
  prompt: string;
  status: StepStatus;
  result?: string;
  error?: string;
  skill?: string;
  wordCountTarget?: number;
  chapterNumber?: number;
  segmentIndex?: number;
  totalSegments?: number;
  startedAt?: string;
  completedAt?: string;
  autoResetCount?: number;
}

export interface ProjectContext {
  targetChapters?: number;
  targetWordsPerChapter?: number;
  estimatedTotalWords?: number;
  includePrologue?: boolean;
  includeEpilogue?: boolean;
  hasParent?: boolean;
  isSeries?: boolean;
  seriesTotalBooks?: number;
  seriesCurrentBook?: number;
  isInfiniteCalibration?: boolean;
  reviewMode?: boolean;
  planning?: string;
  config?: Record<string, unknown>;
  penName?: string;
  coverVariants?: number;
  coverFont?: string;
  brandColor?: string;
  /** 
   * Maps chapter numbers (0=Prologue, 1=Chapter 1) to their actual word count.
   * Inherited from parent projects so revision segments can scale dynamically.
   */
  chapterWordCounts?: Record<number, number>;
}

export interface Project {
  id: string;
  parentId?: string;
  type: ProjectType;
  title: string;
  description: string;
  status: ProjectStatus;
  progress: number;
  steps: ProjectStep[];
  context: ProjectContext;
  preferredProvider?: string;
  /** Runtime corrections from the Continuity Quality Gate. Injected into all future prompts. */
  continuityOverrides?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ═══════════════════════════════════════════════════════════
// AI Types
// ═══════════════════════════════════════════════════════════

export type ProviderTier = 'free' | 'cheap' | 'paid';
export type TaskTier = 'free' | 'mid' | 'premium' | 'libre';
export type ThinkingLevel = 'low' | 'medium' | 'high';

export interface AIProvider {
  id: string;
  name: string;
  model: string;
  tier: ProviderTier;
  available: boolean;
  endpoint: string;
  maxTokens: number;
  contextWindow: number;
  safeOutputTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
}

export interface CompletionRequest {
  provider: string;
  model?: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; name?: string; tool_calls?: any[] }>;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  thinking?: ThinkingLevel;
  repeatPenalty?: number;
  tools?: any[];
}

export interface CompletionResponse {
  text: string;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
  provider: string;
  finishReason?: string;
  toolCalls?: any[];
}

// ═══════════════════════════════════════════════════════════
// RAG / Context Types
// ═══════════════════════════════════════════════════════════

export interface ChapterSummary {
  chapterId: string;
  chapterNumber: number;
  title: string;
  summary: string;
  wordCount: number;
  characters: string[];
  locations: string[];
  timelineMarker: string;
  plotThreads: string[];
  endingState: string;
}

export interface EntityEntry {
  name: string;
  type: 'character' | 'location' | 'item' | 'object' | 'event' | 'rule';
  aliases: string[];
  description: string;
  firstAppearance: string;
  lastSeen: string;
  attributes: Record<string, string>;
  changes: Array<{ chapterId: string; description: string }>;
}

export interface SceneContext {
  sceneId: string;
  chapterId: string;
  povCharacter: string;
  presentCharacters: string[];
  location: string;
  timeOfDay: string;
  emotionalTone: string;
  activeThreads: string[];
  openQuestions: string[];
}

// ═══════════════════════════════════════════════════════════
// Context Budget Types
// ═══════════════════════════════════════════════════════════

export interface ContextBudget {
  provider: string;
  modelContextWindow: number;
  reservedForOutput: number;
  reservedForSystem: number;
  availableForContent: number;
}

export type SlotPriority = 1 | 2 | 3 | 4 | 5;

export interface ContextSlot {
  label: string;
  priority: SlotPriority;
  content: string;
  tokenCount: number;
  compressible: boolean;
  compressedVersion?: string;
  included: boolean;
}

export interface BudgetReport {
  totalBudget: number;
  used: number;
  remaining: number;
  slots: ContextSlot[];
  droppedSlots: string[];
  compressionApplied: boolean;
}

// ═══════════════════════════════════════════════════════════
// Style DNA Types
// ═══════════════════════════════════════════════════════════

export interface StyleDNA {
  avgSentenceLength: number;
  dialogueToNarrativeRatio: number;
  adverbFrequency: number;
  passiveVoiceFrequency: number;
  favoredTransitions: string[];
  forbiddenWords: string[];
  pov: 'first' | 'third-limited' | 'third-omniscient' | 'second';
  tense: 'past' | 'present';
  samplePassages: string[];
}

// ═══════════════════════════════════════════════════════════
// Event Types
// ═══════════════════════════════════════════════════════════

export interface EventMap {
  'project:created': { project: Project };
  'project:started': { projectId: string };
  'project:paused': { projectId: string };
  'project:completed': { projectId: string };
  'project:deleted': { projectId: string };
  'step:started': { projectId: string; stepId: string };
  'step:completed': { projectId: string; stepId: string; result: string };
  'step:failed': { projectId: string; stepId: string; error: string };
  'step:progress': { projectId: string; stepId: string; message: string };
  'context:indexed': { projectId: string; chapterId: string };
  'entity:extracted': { projectId: string; entities: EntityEntry[] };
}
