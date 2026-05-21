/**
 * Telegram gateway — long-polling bot using grammy.
 *
 * Boot flow:
 *   1. Check SecretsService for `telegram_bot_token`. If empty, gateway stays
 *      disabled (no error — just absent).
 *   2. Create grammy Bot, validate token (getMe).
 *   3. Register a single message handler that routes to AgentRunner.
 *   4. Start long-polling.
 *
 * Message flow:
 *   incoming text → ACL check → create/reuse session per chat → invoke
 *   default agent → reply with output (chunked if >4096 chars).
 *
 * Auth model:
 *   The user creates a bot via @BotFather, pastes the token into the
 *   dashboard Secrets panel. The TELEGRAM_ALLOWED_USER_IDS secret holds
 *   a comma-separated list of numeric Telegram user IDs the bot will
 *   respond to. Anyone else gets a polite refusal.
 */

import { Bot } from 'grammy';
import { getAgent } from '@perry/projects';
import type { Gateway, GatewayContext, GatewayStatus } from './types.js';

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export class TelegramGateway implements Gateway {
  readonly platform = 'telegram' as const;
  private bot: Bot | null = null;
  private botName?: string;
  private connected = false;
  private lastMessageAt?: string;
  private lastError?: string;
  private allowedIds: Set<string> = new Set();

  constructor(private ctx: GatewayContext) {}

  async start(): Promise<void> {
    const token = this.ctx.secrets.getSync('telegram_bot_token');
    if (!token) {
      this.ctx.log.info('telegram gateway disabled — no token in vault');
      return;
    }
    this.refreshAllowList();

    try {
      this.bot = new Bot(token);
      const me = await this.bot.api.getMe();
      this.botName = me.username ? `@${me.username}` : me.first_name;
      this.connected = true;
      this.ctx.log.info('telegram gateway connected', { botName: this.botName, allowedUsers: this.allowedIds.size });

      this.bot.on('message:text', async (ctx) => {
        try {
          await this.handleMessage(ctx);
        } catch (e: any) {
          this.ctx.log.error('telegram message handler crashed', { error: e.message });
          try { await ctx.reply('⚠️ Internal error processing that message.'); } catch { /* ignore */ }
        }
      });

      // Long-polling. grammy handles reconnects internally.
      this.bot.start().catch((err: any) => {
        this.connected = false;
        this.lastError = err?.message || String(err);
        this.ctx.log.error('telegram polling crashed', { error: this.lastError });
      });
    } catch (e: any) {
      this.connected = false;
      this.lastError = e.message;
      this.ctx.log.error('telegram gateway failed to start', { error: e.message });
    }
  }

  async stop(): Promise<void> {
    if (this.bot) {
      try { await this.bot.stop(); } catch { /* ignore */ }
      this.bot = null;
    }
    this.connected = false;
  }

  status(): GatewayStatus {
    return {
      platform: this.platform,
      enabled: !!this.ctx.secrets.getSync('telegram_bot_token'),
      connected: this.connected,
      botName: this.botName,
      allowedUserCount: this.allowedIds.size,
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError,
    };
  }

  private refreshAllowList(): void {
    const raw = this.ctx.secrets.getSync('telegram_allowed_user_ids') || '';
    this.allowedIds = new Set(
      raw.split(',').map(s => s.trim()).filter(Boolean)
    );
  }

  private async handleMessage(ctx: any): Promise<void> {
    this.lastMessageAt = new Date().toISOString();
    const userId = String(ctx.from?.id ?? '');
    const text = ctx.message?.text || '';
    if (!text) return;

    // ACL check. Allow-list of zero is "no one allowed" — safer than open.
    if (this.allowedIds.size === 0) {
      this.ctx.log.warn('telegram: rejecting message — empty allowlist', { userId });
      await ctx.reply('⛔ This Perry instance has no authorised users yet. Owner: set telegram_allowed_user_ids in the Secrets panel.');
      return;
    }
    if (!this.allowedIds.has(userId)) {
      this.ctx.log.warn('telegram: rejecting message — user not in allowlist', { userId });
      await ctx.reply(`⛔ User ${userId} is not authorised to use this Perry instance.`);
      return;
    }

    // Look up the default agent.
    const agent = getAgent(this.ctx.defaultAgentId);
    if (!agent) {
      this.ctx.log.error('telegram: default agent not registered', { defaultAgentId: this.ctx.defaultAgentId });
      await ctx.reply(`⚠️ Default agent ${this.ctx.defaultAgentId} not found in registry.`);
      return;
    }

    // Reuse a session per (platform, chat) pair so conversations cohere
    // across messages. Sessions are stored in agent_sessions.
    const sessionTitle = `telegram:${ctx.chat.id}`;
    const existing = this.ctx.stateStore.listAgentSessions({ domain: agent.domain }).find((s: any) => s.title === sessionTitle && !s.closed_at);
    const sessionId = existing?.id || this.ctx.stateStore.createAgentSession({
      domain: agent.domain,
      title: sessionTitle,
    });

    // "Working on it" placeholder while AgentRunner does its thing.
    const placeholder = await ctx.reply('⌛ thinking…');

    try {
      const inv = await this.ctx.agentRunner.invoke({
        agent,
        sessionId,
        input: text,
      });
      const output = inv.output || '(empty response)';
      // Edit placeholder with the first chunk, then send additional chunks.
      const chunks = chunkText(output, TELEGRAM_MAX_MESSAGE_LENGTH);
      try {
        await ctx.api.editMessageText(ctx.chat.id, placeholder.message_id, chunks[0]);
      } catch {
        // Edit can fail if response is identical or message gone — send fresh.
        await ctx.reply(chunks[0]);
      }
      for (const c of chunks.slice(1)) {
        await ctx.reply(c);
      }
    } catch (e: any) {
      this.ctx.log.error('telegram: invocation failed', { error: e.message });
      try { await ctx.api.editMessageText(ctx.chat.id, placeholder.message_id, `⚠️ ${e.message}`); }
      catch { await ctx.reply(`⚠️ ${e.message}`); }
    }
  }
}

function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if (buf.length + line.length + 1 > max) {
      if (buf) out.push(buf);
      buf = line.length > max ? line.slice(0, max) : line;
      // If a single line is itself too long, hard-split it.
      while (buf.length > max) {
        out.push(buf.slice(0, max));
        buf = buf.slice(max);
      }
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}
