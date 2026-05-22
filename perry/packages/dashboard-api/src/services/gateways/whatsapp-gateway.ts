/**
 * WhatsApp gateway — Baileys-based connection to a paired WhatsApp account.
 *
 * Unlike Telegram/Discord which use bot tokens, WhatsApp pairs with a real
 * phone-account via the multi-device protocol. The flow:
 *
 *   1. First start: Baileys generates a QR code. Operator opens
 *      WhatsApp → Linked Devices → Link Device, scans the QR.
 *   2. After pairing: auth state persists in workspace/whatsapp-auth/.
 *      Subsequent restarts reconnect automatically.
 *   3. Messages sent to the paired account flow through Perry; replies are
 *      sent back via the same account.
 *
 * Auth model:
 *   - SecretsService key `whatsapp_enabled` ("true" to enable, anything else to disable)
 *   - SecretsService key `whatsapp_allowed_user_ids` — comma-separated phone
 *     JIDs (e.g. "447700900000@s.whatsapp.net"). Empty allowlist rejects all.
 *
 * The current QR code (during pairing) is exposed via
 *   GET /api/gateways/whatsapp/qr   → returns PNG of the QR
 * so the operator can scan it from the dashboard.
 *
 * Subscription-only ethos preserved: no Meta Business API account, no fees,
 * no platform-specific developer key. Just a real WhatsApp number that
 * pairs via QR like WhatsApp Web does.
 */

import { mkdirSync } from 'fs';
import { join } from 'path';
import * as QRCode from 'qrcode';
import { getAgent } from '@perry/projects';
import type { Gateway, GatewayContext, GatewayStatus } from './types.js';

const WHATSAPP_MAX_MESSAGE_LENGTH = 4000; // WhatsApp limit is 4096 — leave room for framing

export class WhatsAppGateway implements Gateway {
  readonly platform = 'whatsapp' as const;

  private sock: any = null;
  private connected = false;
  private connectionState: 'idle' | 'connecting' | 'qr-needed' | 'open' | 'closed' = 'idle';
  private currentQR: string | null = null;
  private currentQRDataUrl: string | null = null;
  private botName?: string;
  private allowedIds: Set<string> = new Set();
  private lastMessageAt?: string;
  private lastError?: string;
  private workspaceDir: string;
  private authDir: string;
  private startedAt?: number;

  constructor(private ctx: GatewayContext) {
    // The state store can give us the workspace dir reference; if not, default.
    this.workspaceDir = (ctx as any).workspaceDir || '/app/workspace';
    this.authDir = join(this.workspaceDir, 'whatsapp-auth');
    mkdirSync(this.authDir, { recursive: true });
  }

  async start(): Promise<void> {
    const enabled = (this.ctx.secrets.getSync('whatsapp_enabled') || '').toLowerCase() === 'true';
    if (!enabled) {
      this.ctx.log.info('whatsapp gateway disabled — set whatsapp_enabled=true in vault to enable');
      return;
    }
    this.refreshAllowList();
    this.connectionState = 'connecting';
    this.startedAt = Date.now();

    try {
      // Lazy import — Baileys is heavy (~30 MB). Don't pay the import cost
      // unless the gateway is enabled.
      const baileys: any = await import('@whiskeysockets/baileys');
      const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys;
      const makeWASocket = baileys.default || baileys.makeWASocket;
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion();

      this.ctx.log.info('whatsapp: starting connection', { baileysVersion: version.join('.') });

      this.sock = makeWASocket({
        version,
        auth: state,
        // Silence Baileys's verbose internal logger; we use our own.
        logger: pinoStub(this.ctx.log.child('baileys-internal')),
        printQRInTerminal: false, // We expose via API/log
        browser: ['Perry', 'Chrome', '2.0'],
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          this.currentQR = qr;
          this.currentQRDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
          this.connectionState = 'qr-needed';
          this.ctx.log.info('whatsapp: QR code generated — scan from WhatsApp → Linked Devices, or hit /api/gateways/whatsapp/qr');
        }
        if (connection === 'open') {
          this.connectionState = 'open';
          this.connected = true;
          this.currentQR = null;
          this.currentQRDataUrl = null;
          const me = this.sock.user;
          this.botName = me?.name || me?.id || 'WhatsApp';
          this.ctx.log.info('whatsapp gateway connected', { botName: this.botName, allowedUsers: this.allowedIds.size });
        }
        if (connection === 'close') {
          this.connected = false;
          this.connectionState = 'closed';
          const code = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = code !== DisconnectReason?.loggedOut;
          this.lastError = lastDisconnect?.error?.message;
          this.ctx.log.warn('whatsapp: connection closed', { code, shouldReconnect, error: this.lastError });
          if (shouldReconnect) {
            // Reconnect after brief backoff.
            setTimeout(() => this.start().catch((e: any) => this.ctx.log.error('whatsapp: reconnect failed', { error: e.message })), 3000);
          }
        }
      });

      this.sock.ev.on('messages.upsert', async (m: any) => {
        try {
          await this.handleMessageUpsert(m);
        } catch (e: any) {
          this.ctx.log.error('whatsapp: message handler crashed', { error: e.message });
        }
      });
    } catch (e: any) {
      this.connected = false;
      this.connectionState = 'closed';
      this.lastError = e.message;
      this.ctx.log.error('whatsapp gateway failed to start', { error: e.message });
    }
  }

  async stop(): Promise<void> {
    if (this.sock) {
      try { this.sock.end(undefined); } catch { /* ignore */ }
      this.sock = null;
    }
    this.connected = false;
    this.connectionState = 'closed';
  }

  status(): GatewayStatus {
    const enabled = (this.ctx.secrets.getSync('whatsapp_enabled') || '').toLowerCase() === 'true';
    return {
      platform: this.platform,
      enabled,
      connected: this.connected,
      botName: this.botName,
      allowedUserCount: this.allowedIds.size,
      lastMessageAt: this.lastMessageAt,
      lastError: this.connectionState === 'qr-needed' ? 'pairing required — scan QR via /api/gateways/whatsapp/qr' : this.lastError,
    };
  }

  /** Public accessor for the routes layer — current QR PNG data URL (or null when paired). */
  getQRDataUrl(): string | null {
    return this.currentQRDataUrl;
  }

  /** Send a message to a specific JID. Used by /api/gateways/whatsapp/send. */
  async sendMessage(jid: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.sock || !this.connected) {
      return { ok: false, error: 'whatsapp not connected' };
    }
    try {
      await this.sock.sendMessage(jid, { text });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  private refreshAllowList(): void {
    const raw = this.ctx.secrets.getSync('whatsapp_allowed_user_ids') || '';
    this.allowedIds = new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  }

  private async handleMessageUpsert(m: any): Promise<void> {
    // Process only new messages from real users — skip our own outbound,
    // skip status broadcasts, skip system messages.
    if (m.type !== 'notify') return;
    for (const msg of m.messages || []) {
      if (msg.key?.fromMe) continue;
      if (msg.key?.remoteJid === 'status@broadcast') continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      if (!text) continue;
      const senderJid = msg.key?.remoteJid;
      if (!senderJid) continue;

      this.lastMessageAt = new Date().toISOString();
      this.refreshAllowList(); // pick up any allowlist updates without restart

      if (this.allowedIds.size === 0) {
        this.ctx.log.warn('whatsapp: rejecting message — empty allowlist', { senderJid });
        await this.sendMessage(senderJid, '⛔ This Perry instance has no authorised users yet. Owner: set whatsapp_allowed_user_ids in the Secrets panel (comma-separated JIDs).');
        continue;
      }
      if (!this.allowedIds.has(senderJid)) {
        this.ctx.log.warn('whatsapp: rejecting message — sender not in allowlist', { senderJid });
        await this.sendMessage(senderJid, `⛔ ${senderJid} is not authorised to use this Perry instance.`);
        continue;
      }

      const agent = getAgent(this.ctx.defaultAgentId);
      if (!agent) {
        this.ctx.log.error('whatsapp: default agent not registered', { defaultAgentId: this.ctx.defaultAgentId });
        await this.sendMessage(senderJid, `⚠️ Default agent ${this.ctx.defaultAgentId} not found.`);
        continue;
      }

      // Reuse a session per (platform, jid) pair.
      const sessionTitle = `whatsapp:${senderJid}`;
      const existing = this.ctx.stateStore.listAgentSessions({ domain: agent.domain }).find((s: any) => s.title === sessionTitle && !s.closed_at);
      const sessionId = existing?.id || this.ctx.stateStore.createAgentSession({ domain: agent.domain, title: sessionTitle });

      try {
        // Send space placeholder message first
        let sent: any;
        try {
          sent = await this.sock.sendMessage(senderJid, { text: ' ' });
        } catch (sendErr: any) {
          this.ctx.log.error('whatsapp: failed to send space placeholder', { error: sendErr.message });
          throw sendErr;
        }

        // Trigger composing/typing presence AFTER sending the placeholder so it stays active
        try {
          await this.sock.sendPresenceUpdate('composing', senderJid);
        } catch (presenceErr: any) {
          this.ctx.log.warn('whatsapp: failed to send composing presence', { error: presenceErr.message });
        }

        try {
          const inv = await this.ctx.agentRunner.invoke({ agent, sessionId, input: text });
          const rawOutput = inv.output || '(empty response)';
          const output = cleanOutputText(rawOutput);
          const chunks = chunkText(output, WHATSAPP_MAX_MESSAGE_LENGTH);
          
          if (chunks.length > 0) {
            // Edit the space placeholder with the first chunk
            await this.sock.sendMessage(senderJid, { edit: sent.key, text: chunks[0] });
            // Send remaining chunks normally
            for (let i = 1; i < chunks.length; i++) {
              await this.sendMessage(senderJid, chunks[i]);
            }
          } else {
            await this.sock.sendMessage(senderJid, { edit: sent.key, text: '(empty response)' });
          }
        } catch (e: any) {
          this.ctx.log.error('whatsapp: invocation failed', { error: e.message });
          try {
            await this.sock.sendMessage(senderJid, { edit: sent.key, text: `⚠️ ${e.message}` });
          } catch {
            await this.sendMessage(senderJid, `⚠️ ${e.message}`);
          }
        }
      } finally {
        // Turn off composing presence
        try {
          await this.sock.sendPresenceUpdate('paused', senderJid);
        } catch (presenceErr: any) {
          this.ctx.log.warn('whatsapp: failed to send paused presence', { error: presenceErr.message });
        }
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
      while (buf.length > max) { out.push(buf.slice(0, max)); buf = buf.slice(max); }
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** Baileys requires a Pino-shaped logger. Wrap our Logger in the bare minimum. */
function pinoStub(log: any): any {
  const noop = () => {};
  const wrap = (level: 'debug' | 'info' | 'warn' | 'error') => (obj: any, msg?: any) => {
    const message = typeof obj === 'string' ? obj : msg;
    if (level === 'error' || level === 'warn') log[level]?.(message || JSON.stringify(obj).slice(0, 200));
    // skip debug/info — too chatty
  };
  return {
    level: 'silent',
    fatal: wrap('error'),
    error: wrap('error'),
    warn: wrap('warn'),
    info: noop,
    debug: noop,
    trace: noop,
    child: () => pinoStub(log),
  };
}
