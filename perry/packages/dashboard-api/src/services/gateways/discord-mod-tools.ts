/**
 * Discord moderation tools — function-style tool definitions that the
 * Director can call when invoked through the Discord gateway. Each tool
 * wraps a discord.js client action and writes an audit row to
 * `discord_mod_actions`.
 *
 * Scope: these tools are NOT registered globally. The DiscordGateway
 * injects them per-invocation only when the gateway is the entry-point.
 * This means:
 *   - HTTP-invoked Director (POST /api/agents/meta.director/invoke) does
 *     NOT have access to these
 *   - Telegram-invoked Director does NOT have access
 *   - Only Discord-invoked Director can call these tools
 * Avoids accidentally banning your Discord server via the Telegram bot.
 *
 * The tools use NATURAL-LANGUAGE LLM extraction patterns. The Director
 * reads the user's intent and calls the right tool with parsed args.
 * Example: user DMs "timeout @whoever for 30m, they were rude" →
 * Director calls discord_timeout({ user_id: ..., minutes: 30, reason: ... }).
 *
 * Safety:
 *   - Bot role must be HIGHER than the target's role (Discord hierarchy)
 *   - Bot's user can't moderate the server owner — Discord blocks that
 *   - All actions audited; many are reversible (timeout, slowmode), some
 *     are not (delete_message)
 */

import type { Client, GuildMember } from 'discord.js';
import type { Logger } from '@perry/core';

export interface ToolImpl {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any) => Promise<any>;
}

export function getDiscordModTools(opts: {
  client: Client;
  stateStore: any;
  log: Logger;
  actorTag: string;          // Display name of who issued the action (e.g. "discord:1632197419")
}): ToolImpl[] {
  const { client, stateStore, log, actorTag } = opts;

  // Audit helper. Records every tool call regardless of success.
  const audit = (action: string, success: boolean, fields: {
    guildId?: string; channelId?: string; targetUserId?: string;
    targetMessageId?: string; reason?: string; error?: string; metadata?: any;
  } = {}): void => {
    try {
      stateStore.db.prepare(
        `INSERT INTO discord_mod_actions
         (id, action, guild_id, channel_id, target_user_id, target_message_id, actor, reason, metadata, success, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `mod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        action,
        fields.guildId || null,
        fields.channelId || null,
        fields.targetUserId || null,
        fields.targetMessageId || null,
        actorTag,
        fields.reason || null,
        fields.metadata ? JSON.stringify(fields.metadata) : null,
        success ? 1 : 0,
        fields.error || null,
        new Date().toISOString(),
      );
    } catch (e: any) {
      log.warn('mod audit write failed', { action, error: e.message });
    }
  };

  // Resolve a guild member by user ID. Discord requires us to fetch from
  // the guild (the bot's local cache may not have them).
  const fetchMember = async (guildId: string, userId: string): Promise<GuildMember> => {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
    return await guild.members.fetch(userId);
  };

  return [
    {
      name: 'discord_kick',
      description: 'Kick a user from the Discord server. Reversible (they can rejoin if they still have an invite link). Reason is logged in Discord audit log.',
      parameters: {
        type: 'object',
        properties: {
          guild_id: { type: 'string', description: 'Discord guild (server) ID' },
          user_id: { type: 'string', description: 'Target user ID' },
          reason: { type: 'string', description: 'Reason — shown in Discord audit log' },
        },
        required: ['guild_id', 'user_id', 'reason'],
      },
      execute: async (args: any) => {
        try {
          const member = await fetchMember(args.guild_id, args.user_id);
          await member.kick(args.reason);
          audit('kick', true, { guildId: args.guild_id, targetUserId: args.user_id, reason: args.reason });
          return { ok: true, action: 'kick', target: args.user_id };
        } catch (e: any) {
          audit('kick', false, { guildId: args.guild_id, targetUserId: args.user_id, reason: args.reason, error: e.message });
          return { ok: false, error: e.message };
        }
      },
    },

    {
      name: 'discord_ban',
      description: 'Ban a user from the Discord server. NOT immediately reversible (use discord_unban). Optional delete_message_seconds removes their recent messages.',
      parameters: {
        type: 'object',
        properties: {
          guild_id: { type: 'string', description: 'Discord guild (server) ID' },
          user_id: { type: 'string', description: 'Target user ID' },
          reason: { type: 'string', description: 'Reason — shown in Discord audit log' },
          delete_message_seconds: {
            type: 'number',
            description: 'Optional. Range 0-604800 (7 days). Deletes messages from this user within the past N seconds. Default 0 (no message deletion).',
          },
        },
        required: ['guild_id', 'user_id', 'reason'],
      },
      execute: async (args: any) => {
        try {
          const guild = client.guilds.cache.get(args.guild_id) || await client.guilds.fetch(args.guild_id);
          await guild.bans.create(args.user_id, {
            reason: args.reason,
            deleteMessageSeconds: Math.max(0, Math.min(604800, args.delete_message_seconds || 0)),
          });
          audit('ban', true, {
            guildId: args.guild_id, targetUserId: args.user_id, reason: args.reason,
            metadata: { delete_message_seconds: args.delete_message_seconds || 0 },
          });
          return { ok: true, action: 'ban', target: args.user_id };
        } catch (e: any) {
          audit('ban', false, { guildId: args.guild_id, targetUserId: args.user_id, reason: args.reason, error: e.message });
          return { ok: false, error: e.message };
        }
      },
    },

    {
      name: 'discord_unban',
      description: 'Unban a previously banned user. They can rejoin via any valid invite link.',
      parameters: {
        type: 'object',
        properties: {
          guild_id: { type: 'string' },
          user_id: { type: 'string' },
          reason: { type: 'string', description: 'Reason — shown in Discord audit log' },
        },
        required: ['guild_id', 'user_id'],
      },
      execute: async (args: any) => {
        try {
          const guild = client.guilds.cache.get(args.guild_id) || await client.guilds.fetch(args.guild_id);
          await guild.bans.remove(args.user_id, args.reason);
          audit('unban', true, { guildId: args.guild_id, targetUserId: args.user_id, reason: args.reason });
          return { ok: true, action: 'unban', target: args.user_id };
        } catch (e: any) {
          audit('unban', false, { guildId: args.guild_id, targetUserId: args.user_id, error: e.message });
          return { ok: false, error: e.message };
        }
      },
    },

    {
      name: 'discord_timeout',
      description: 'Temporarily mute a user (Discord "timeout"). Reversible — pass minutes=0 to lift early. Max duration is 28 days (Discord limit).',
      parameters: {
        type: 'object',
        properties: {
          guild_id: { type: 'string' },
          user_id: { type: 'string' },
          minutes: { type: 'number', description: 'Duration in minutes. 0 lifts an existing timeout. Cap 40320 (28 days).' },
          reason: { type: 'string', description: 'Reason — shown in Discord audit log' },
        },
        required: ['guild_id', 'user_id', 'minutes'],
      },
      execute: async (args: any) => {
        try {
          const member = await fetchMember(args.guild_id, args.user_id);
          const durMs = args.minutes > 0 ? Math.min(args.minutes, 40320) * 60_000 : null;
          await member.timeout(durMs, args.reason);
          audit('timeout', true, {
            guildId: args.guild_id, targetUserId: args.user_id, reason: args.reason,
            metadata: { minutes: args.minutes },
          });
          return { ok: true, action: 'timeout', target: args.user_id, minutes: args.minutes };
        } catch (e: any) {
          audit('timeout', false, { guildId: args.guild_id, targetUserId: args.user_id, reason: args.reason, error: e.message });
          return { ok: false, error: e.message };
        }
      },
    },

    {
      name: 'discord_delete_message',
      description: 'Delete a specific message in a Discord channel. NOT reversible. Requires the message ID and the channel it lives in.',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string' },
          message_id: { type: 'string' },
          reason: { type: 'string', description: 'For the audit log; Discord doesn\'t surface this in its own log for deletes.' },
        },
        required: ['channel_id', 'message_id'],
      },
      execute: async (args: any) => {
        try {
          const channel = await client.channels.fetch(args.channel_id);
          if (!channel || !channel.isTextBased()) {
            throw new Error('channel not text-based or not found');
          }
          const message = await (channel as any).messages.fetch(args.message_id);
          await message.delete();
          audit('delete_message', true, { channelId: args.channel_id, targetMessageId: args.message_id, reason: args.reason });
          return { ok: true, action: 'delete_message', message_id: args.message_id };
        } catch (e: any) {
          audit('delete_message', false, { channelId: args.channel_id, targetMessageId: args.message_id, error: e.message });
          return { ok: false, error: e.message };
        }
      },
    },

    {
      name: 'discord_set_slowmode',
      description: 'Set slowmode on a Discord channel. Users can only send one message per N seconds. 0 disables slowmode. Max 21600 (6 hours).',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string' },
          seconds: { type: 'number', description: '0 disables; cap 21600 (6h)' },
          reason: { type: 'string' },
        },
        required: ['channel_id', 'seconds'],
      },
      execute: async (args: any) => {
        try {
          const channel = await client.channels.fetch(args.channel_id);
          if (!channel || !(channel as any).setRateLimitPerUser) {
            throw new Error('channel does not support slowmode');
          }
          const sec = Math.max(0, Math.min(21600, args.seconds));
          await (channel as any).setRateLimitPerUser(sec, args.reason);
          audit('set_slowmode', true, { channelId: args.channel_id, reason: args.reason, metadata: { seconds: sec } });
          return { ok: true, action: 'set_slowmode', seconds: sec };
        } catch (e: any) {
          audit('set_slowmode', false, { channelId: args.channel_id, error: e.message });
          return { ok: false, error: e.message };
        }
      },
    },
  ];
}
