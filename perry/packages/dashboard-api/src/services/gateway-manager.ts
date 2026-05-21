/**
 * GatewayManager — boots messaging-platform adapters that are configured
 * (i.e., have a bot token in the vault). Each adapter is self-contained;
 * the manager just owns lifecycle (start/stop) and exposes status.
 *
 * Currently:
 *   - TelegramGateway (grammy long-poll)
 *   - DiscordGateway  (discord.js websocket)
 *
 * Adding a new platform: implement the Gateway interface, instantiate
 * here under a guard that checks for the platform's token.
 *
 * All gateways share one AgentRunner instance — invocations route to the
 * default agent (`meta.director`) which can delegate via invoke_agent.
 */

import { AgentRunner } from '@perry/projects';
import type { AIRouter } from '@perry/ai';
import type { EventBus, Logger, McpClientService, SecretsService } from '@perry/core';
import type { Gateway, GatewayContext, GatewayStatus } from './gateways/types.js';
import { TelegramGateway } from './gateways/telegram-gateway.js';
import { DiscordGateway } from './gateways/discord-gateway.js';

export class GatewayManager {
  private gateways: Gateway[] = [];
  private context: GatewayContext;

  constructor(opts: {
    aiRouter: AIRouter;
    stateStore: any;
    mcpClient: McpClientService;
    eventBus: EventBus;
    secrets: SecretsService;
    log: Logger;
  }) {
    const runner = new AgentRunner(
      opts.aiRouter,
      opts.stateStore,
      opts.mcpClient,
      opts.eventBus,
      opts.log.child('gateway-runner'),
    );
    this.context = {
      agentRunner: runner,
      secrets: opts.secrets,
      stateStore: opts.stateStore,
      log: opts.log,
      defaultAgentId: 'meta.director',
    };
  }

  async start(): Promise<void> {
    // Instantiate every gateway — each checks its own token internally and
    // stays dormant if not configured. No-op for users who don't enable any.
    this.gateways = [
      new TelegramGateway({ ...this.context, log: this.context.log.child('telegram') }),
      new DiscordGateway({ ...this.context, log: this.context.log.child('discord') }),
    ];
    for (const g of this.gateways) {
      try {
        await g.start();
      } catch (e: any) {
        this.context.log.error(`${g.platform} gateway failed to start`, { error: e.message });
      }
    }
  }

  async stop(): Promise<void> {
    for (const g of this.gateways) {
      try { await g.stop(); } catch { /* ignore */ }
    }
    this.gateways = [];
  }

  statuses(): GatewayStatus[] {
    return this.gateways.map(g => g.status());
  }

  /**
   * Restart a single gateway — used when the user updates the bot token or
   * ACL via the dashboard Secrets panel.
   */
  async restart(platform: string): Promise<void> {
    const g = this.gateways.find(g => g.platform === platform);
    if (!g) return;
    await g.stop();
    await g.start();
  }
}
