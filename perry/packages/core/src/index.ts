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
export { AbilityProposer, loadInstalledAbilities } from './ability-proposer.js';
export type { AbilityProposal, LoadedAbility } from './ability-proposer.js';
export { AbilityEvaluator } from './ability-evaluator.js';
export { TrajectoryAbilityWriter, listTrajectoryAbilities, listTrajectorySources } from './trajectory-abilities.js';
export type { TrajectoryRecord } from './trajectory-abilities.js';
export type { PluginAPI, PluginMeta, PluginModule, PluginHandle, PluginRouteHandler } from './plugin-api.js';

// Re-export all types
export type * from './types.js';
// Runtime helpers from types.ts (must be exported as values, not types)
export { projectTypeDomain } from './types.js';
