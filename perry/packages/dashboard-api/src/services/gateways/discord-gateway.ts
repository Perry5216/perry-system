/**
 * Discord gateway — websocket bot using discord.js v14.
 *
 * Behaves identically to the Telegram gateway in spirit, but Discord has
 * extra wrinkles (DM-only mode by default for safety, message intent
 * required, response chunking limit is 2000 chars).
 *
 * Boot flow:
 *   1. Check vault for `discord_bot_token`. Absent → gateway disabled.
 *   2. Create discord.js Client with MessageContent intent.
 *   3. Register message handler routing to AgentRunner.
 *   4. Login & connect to gateway.
 */

import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import { getAgent } from '@perry/projects';
import type { Gateway, GatewayContext, GatewayStatus } from './types.js';
import { getDiscordModTools } from './discord-mod-tools.js';

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

export class DiscordGateway implements Gateway {
  readonly platform = 'discord' as const;
  private client: Client | null = null;
  private botName?: string;
  private connected = false;
  private lastMessageAt?: string;
  private lastError?: string;
  private allowedIds: Set<string> = new Set();

  constructor(private ctx: GatewayContext) {}

  async start(): Promise<void> {
    const token = this.ctx.secrets.getSync('discord_bot_token');
    if (!token) {
      this.ctx.log.info('discord gateway disabled — no token in vault');
      return;
    }
    this.refreshAllowList();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.client.once(Events.ClientReady, (c) => {
      this.botName = c.user?.tag;
      this.connected = true;
      this.ctx.log.info('discord gateway connected', { botName: this.botName, allowedUsers: this.allowedIds.size });
    });

    this.client.on(Events.MessageCreate, async (message) => {
      try {
        if (message.author.bot) return;
        // Only respond to DMs OR explicit mentions in guild channels.
        const isDM = !message.guild;
        const isMention = !!this.client?.user && message.mentions.users.has(this.client.user.id);
        if (!isDM && !isMention) return;
        await this.handleMessage(message);
      } catch (e: any) {
        this.ctx.log.error('discord message handler crashed', { error: e.message });
        try { await message.reply('⚠️ Internal error processing that message.'); } catch { /* ignore */ }
      }
    });

    this.client.on(Events.Error, (err) => {
      this.lastError = err.message;
      this.ctx.log.error('discord client error', { error: err.message });
    });

    try {
      await this.client.login(token);
    } catch (e: any) {
      this.connected = false;
      this.lastError = e.message;
      this.ctx.log.error('discord gateway failed to log in', { error: e.message });
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      try { await this.client.destroy(); } catch { /* ignore */ }
      this.client = null;
    }
    this.connected = false;
  }

  status(): GatewayStatus {
    return {
      platform: this.platform,
      enabled: !!this.ctx.secrets.getSync('discord_bot_token'),
      connected: this.connected,
      botName: this.botName,
      allowedUserCount: this.allowedIds.size,
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError,
    };
  }

  private refreshAllowList(): void {
    const raw = this.ctx.secrets.getSync('discord_allowed_user_ids') || '';
    this.allowedIds = new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  }

  /**
   * Prepend a system-level context block to the user's input so the
   * Director knows the guild/channel/user IDs without having to extract
   * them from the message text. The model uses these for mod-tool args.
   * Hidden from the user; just travels through the agent loop.
   */
  private enrichInputWithContext(text: string, message: any): string {
    const guildId = message.guild?.id || '';
    const channelId = message.channel?.id || '';
    const messageId = message.id || '';
    const userTag = `${message.author.username || ''} (id: ${message.author.id})`;
    const isDM = !guildId;
    const lines = [
      `[discord context — DO NOT echo this to the user, use only for tool args]`,
      `  message_id: ${messageId}`,
      `  channel_id: ${channelId}`,
      `  from: ${userTag}`,
    ];
    if (isDM) {
      lines.push(`  guild_id: null  (this is a DM — server moderation tools (discord_kick, discord_ban, discord_timeout) CANNOT be used here)`);
      lines.push(`  Note: if the user asks to moderate a server, tell them to @-mention me in a channel ON that server instead of DMing.`);
    } else {
      lines.push(`  guild_id: ${guildId}`);
      // Extract resolved @-mentions from the message so the model has real
      // user IDs to target, not strings it has to guess at.
      const mentions = (message.mentions?.users?.map((u: any) => `${u.username || u.tag || u.id} (id: ${u.id})`) || []);
      if (mentions.length > 0) {
        lines.push(`  mentioned_users: ${mentions.join(', ')}`);
      }
    }
    lines.push(`[end discord context]`, '', text);
    return lines.join('\n');
  }

  private async handleMessage(message: any): Promise<void> {
    this.lastMessageAt = new Date().toISOString();
    const userId = String(message.author.id);
    // Strip the bot's own @-mention from the input so the model sees the
    // user's intent cleanly.
    const myMention = this.client?.user ? `<@${this.client.user.id}>` : '';
    const text = String(message.content || '').replace(myMention, '').trim();
    if (!text) return;

    // ACL check.
    if (this.allowedIds.size === 0) {
      this.ctx.log.warn('discord: rejecting message — empty allowlist', { userId });
      await message.reply('⛔ This Perry instance has no authorised users yet. Owner: set discord_allowed_user_ids in the Secrets panel.');
      return;
    }
    if (!this.allowedIds.has(userId)) {
      this.ctx.log.warn('discord: rejecting message — user not in allowlist', { userId });
      await message.reply(`⛔ User ${userId} is not authorised to use this Perry instance.`);
      return;
    }

    const agent = getAgent(this.ctx.defaultAgentId);
    if (!agent) {
      await message.reply(`⚠️ Default agent ${this.ctx.defaultAgentId} not found in registry.`);
      return;
    }

    // Per-channel session reuse.
    const sessionTitle = `discord:${message.channel.id}`;
    const existing = this.ctx.stateStore.listAgentSessions({ domain: agent.domain }).find((s: any) => s.title === sessionTitle && !s.closed_at);
    const sessionId = existing?.id || this.ctx.stateStore.createAgentSession({
      domain: agent.domain,
      title: sessionTitle,
    });

    const typingMode = (this.ctx.secrets.getSync('whatsapp_typing_mode') || 'typing_only').toLowerCase();
    let sent: any;
    let typingInterval: NodeJS.Timeout | undefined;

    // Inject Discord mod tools as gateway-scoped extras. The Director (and
    // ONLY the Director, since other agents don't have toolACL: null) gets
    // discord_kick / discord_ban / discord_timeout / etc. when invoked
    // through this gateway. Telegram / HTTP / step-runner paths never see
    // these tools — keeps the mod surface scoped to Discord context.
    const extraTools = this.client
      ? getDiscordModTools({
          client: this.client,
          stateStore: this.ctx.stateStore,
          log: this.ctx.log,
          actorTag: `discord:${userId}`,
        })
      : undefined;

    try {
      if (typingMode === 'delete' || typingMode === 'edit') {
        try {
          sent = await message.reply(' ');
        } catch (sendErr: any) {
          this.ctx.log.error('discord: failed to send space placeholder', { error: sendErr.message });
          throw sendErr;
        }
      }

      // Trigger typing presence immediately
      try {
        await message.channel.sendTyping();
      } catch (presenceErr: any) {
        this.ctx.log.warn('discord: failed to send typing status', { error: presenceErr.message });
      }

      // Discord typing status expires after ~10 seconds, so refresh it every 9 seconds.
      typingInterval = setInterval(async () => {
        try {
          await message.channel.sendTyping();
        } catch (presenceErr: any) {
          this.ctx.log.warn('discord: failed to refresh typing status', { error: presenceErr.message });
        }
      }, 9000);

      try {
        const inv = await this.ctx.agentRunner.invoke({
          agent,
          sessionId,
          input: this.enrichInputWithContext(text, message),
          extraTools,
        });
        const rawOutput = inv.output || '(empty response)';
        const output = cleanOutputText(rawOutput);
        const chunks = chunkText(output, DISCORD_MAX_MESSAGE_LENGTH);

        if (typingMode === 'typing_only') {
          for (const chunk of chunks) {
            await message.reply(chunk);
          }
        } else if (typingMode === 'delete') {
          if (sent) {
            try {
              await sent.delete();
            } catch (delErr: any) {
              this.ctx.log.warn('discord: failed to delete space placeholder', { error: delErr.message });
            }
          }
          for (const chunk of chunks) {
            await message.reply(chunk);
          }
        } else {
          // edit mode
          if (sent) {
            try {
              await sent.edit(chunks[0]);
            } catch {
              await message.reply(chunks[0]);
            }
            for (const c of chunks.slice(1)) {
              await message.reply(c);
            }
          } else {
            for (const chunk of chunks) {
              await message.reply(chunk);
            }
          }
        }
      } catch (e: any) {
        this.ctx.log.error('discord: invocation failed', { error: e.message });
        if (typingMode === 'typing_only') {
          await message.reply(`⚠️ ${e.message}`);
        } else if (typingMode === 'delete') {
          if (sent) {
            try {
              await sent.delete();
            } catch {}
          }
          await message.reply(`⚠️ ${e.message}`);
        } else {
          if (sent) {
            try {
              await sent.edit(`⚠️ ${e.message}`);
            } catch {
              await message.reply(`⚠️ ${e.message}`);
            }
          } else {
            await message.reply(`⚠️ ${e.message}`);
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
