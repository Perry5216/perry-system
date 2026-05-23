/**
 * @perry/core — Public API
 */

export { ConfigService } from './config.js';
export { EventBus } from './event-bus.js';
export { Logger } from './logger.js';
export { Vault } from './vault.js';
export { SecretsService, KNOWN_SECRETS } from './secrets-service.js';
export type { SecretAuditRow, SecretMetadata, KnownSecretName } from './secrets-service.js';
export { compressTools } from './mcp-compressor.js';
export type { CompressedToolList } from './mcp-compressor.js';
export { ContextBudgetManager } from './context-budget.js';
export { McpClientService, type McpServerConfig } from './mcp-client-service.js';
export { SkillProposer, loadInstalledSkills } from './skill-proposer.js';
export type { SkillProposal, LoadedSkill } from './skill-proposer.js';
export { SkillEvaluator } from './skill-evaluator.js';
export { TrajectorySkillWriter, listTrajectorySkills, listTrajectorySources } from './trajectory-skills.js';
export type { TrajectoryRecord } from './trajectory-skills.js';
export type { PluginAPI, PluginMeta, PluginModule, PluginHandle, PluginRouteHandler } from './plugin-api.js';

// Re-export all types
export type * from './types.js';
// Runtime helpers from types.ts (must be exported as values, not types)
export { projectTypeDomain } from './types.js';
