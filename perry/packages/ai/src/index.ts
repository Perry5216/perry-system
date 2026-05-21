/**
 * @perry/ai — Public API
 */

export { AIRouter, STEP_ROUTING_DEFAULTS } from './router.js';
export type { RoutingTarget } from './router.js';
export { EmbeddingService } from './embedding-service.js';
export type { EmbeddingConfig, EmbeddingResult } from './embedding-service.js';
export { ContextCompressor } from './context-compressor.js';
export type { CompressionRequest, CompressionResult, CompressionMode } from './context-compressor.js';
export { ContextWatcher } from './context-watcher.js';
export type { GpuContextStatus, ContextWatcherStats } from './context-watcher.js';
export { BaseProvider } from './providers/base.js';
export { OllamaProvider } from './providers/ollama.js';
export { GeminiProvider } from './providers/gemini.js';
export { ClaudeProvider } from './providers/claude.js';
export { OpenAICompatibleProvider } from './providers/openai-compatible.js';
export { ComfyUIService } from './comfyui.js';
export type { ComfyUIBookCoverParams, ComfyUIResult } from './comfyui.js';
export { QwenTextRenderService } from './qwen-text-render.js';
export type { TextRenderParams, TextRenderResult } from './qwen-text-render.js';
