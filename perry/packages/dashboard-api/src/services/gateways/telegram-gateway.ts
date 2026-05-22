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

    const typingMode = (this.ctx.secrets.getSync('whatsapp_typing_mode') || 'typing_only').toLowerCase();
    let sent: any;
    let typingInterval: NodeJS.Timeout | undefined;

    try {
      if (typingMode === 'delete' || typingMode === 'edit') {
        try {
          sent = await ctx.reply(' ');
        } catch (sendErr: any) {
          this.ctx.log.error('telegram: failed to send space placeholder', { error: sendErr.message });
          throw sendErr;
        }
      }

      // Trigger typing presence immediately
      try {
        await ctx.replyWithChatAction('typing');
      } catch (presenceErr: any) {
        this.ctx.log.warn('telegram: failed to send typing status', { error: presenceErr.message });
      }

      // Telegram typing status expires after 5 seconds, so refresh it every 4 seconds.
      typingInterval = setInterval(async () => {
        try {
          await ctx.replyWithChatAction('typing');
        } catch (presenceErr: any) {
          this.ctx.log.warn('telegram: failed to refresh typing status', { error: presenceErr.message });
        }
      }, 4000);

      try {
        const inv = await this.ctx.agentRunner.invoke({
          agent,
          sessionId,
          input: text,
        });
        const rawOutput = inv.output || '(empty response)';
        const output = cleanOutputText(rawOutput);
        const chunks = chunkText(output, TELEGRAM_MAX_MESSAGE_LENGTH);

        if (typingMode === 'typing_only') {
          for (const chunk of chunks) {
            await ctx.reply(chunk);
          }
        } else if (typingMode === 'delete') {
          if (sent) {
            try {
              await ctx.api.deleteMessage(ctx.chat.id, sent.message_id);
            } catch (delErr: any) {
              this.ctx.log.warn('telegram: failed to delete space placeholder', { error: delErr.message });
            }
          }
          for (const chunk of chunks) {
            await ctx.reply(chunk);
          }
        } else {
          // edit mode
          if (sent) {
            try {
              await ctx.api.editMessageText(ctx.chat.id, sent.message_id, chunks[0]);
            } catch {
              await ctx.reply(chunks[0]);
            }
            for (const c of chunks.slice(1)) {
              await ctx.reply(c);
            }
          } else {
            for (const chunk of chunks) {
              await ctx.reply(chunk);
            }
          }
        }
      } catch (e: any) {
        this.ctx.log.error('telegram: invocation failed', { error: e.message });
        if (typingMode === 'typing_only') {
          await ctx.reply(`⚠️ ${e.message}`);
        } else if (typingMode === 'delete') {
          if (sent) {
            try {
              await ctx.api.deleteMessage(ctx.chat.id, sent.message_id);
            } catch {}
          }
          await ctx.reply(`⚠️ ${e.message}`);
        } else {
          if (sent) {
            try {
              await ctx.api.editMessageText(ctx.chat.id, sent.message_id, `⚠️ ${e.message}`);
            } catch {
              await ctx.reply(`⚠️ ${e.message}`);
            }
          } else {
            await ctx.reply(`⚠️ ${e.message}`);
          }
        }
      }
    } finally {
      if (typingInterval) {
        clearInterval(typingInterval);
      }
    }
  }
}

function cleanOutputText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        if ('result' in parsed && typeof parsed.result === 'string') {
          return parsed.result;
        }
        if ('output' in parsed && typeof parsed.output === 'string') {
          return parsed.output;
        }
        if ('text' in parsed && typeof parsed.text === 'string') {
          return parsed.text;
        }
        if ('message' in parsed && typeof parsed.message === 'string') {
          return parsed.message;
        }
        const keys = Object.keys(parsed);
        if (keys.length === 1 && typeof parsed[keys[0]] === 'string') {
          return parsed[keys[0]];
        }
      }
    } catch {
      // Ignore JSON parse error, fall back to raw text
    }
  }
  return text;
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
