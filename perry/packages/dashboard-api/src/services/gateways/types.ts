/**
 * Gateway adapter interface — shared shape for every messaging platform
 * (Telegram, Discord, future Slack/SMS/etc).
 *
 * Each gateway:
 *   - Reads its bot token from SecretsService at boot (skipped if absent)
 *   - Receives messages from the platform (push via webhooks OR pull via long-poll)
 *   - Filters by per-platform user-ID ACL (vault-stored allowlist)
 *   - Invokes the configured agent through AgentRunner (default: meta.director)
 *   - Streams the response back to the user via the platform's message API
 *   - Surfaces health to /api/gateways/status for the dashboard
 */

import type { AgentRunner } from '@perry/projects';
import type { Logger, SecretsService } from '@perry/core';
import type { ChatMemoryService } from '../chat-memory-service.js';

export interface GatewayContext {
  agentRunner: AgentRunner;
  secrets: SecretsService;
  stateStore: any;            // for createAgentSession etc.
  log: Logger;
  /** Which agent to invoke by default for incoming messages. */
  defaultAgentId: string;
  chatMemory?: ChatMemoryService;
}

export interface GatewayStatus {
  platform: 'telegram' | 'discord' | string;
  enabled: boolean;
  /** Did the bot token resolve and authenticate? */
  connected: boolean;
  /** Bot's own display name on the platform (e.g. "@perry_book_bot"). */
  botName?: string;
  /** ACL count — informational. */
  allowedUserCount: number;
  /** Last message received (display only). */
  lastMessageAt?: string;
  /** Last error if any. */
  lastError?: string;
  /** Whether Wife Mode is enabled (only applicable to WhatsApp). */
  wifeModeEnabled?: boolean;
}

export interface Gateway {
  readonly platform: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): GatewayStatus;
}
