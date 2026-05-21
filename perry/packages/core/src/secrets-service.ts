/**
 * SecretsService — central registry for sensitive values.
 *
 * Wraps the underlying Vault (AES-256-GCM at rest, scrypt KDF) and adds:
 *   - Audit log of every read / write / rotate / delete / import
 *   - Rotation with optional grace period (old value still serves for N ms)
 *   - Known-secret registry that drives bootstrapFromEnv() at boot
 *   - Caller attribution (best-effort: route name or service name)
 *
 * **Subscription-only mode (see perry-subscription-only-mode memory):**
 * Perry deliberately does NOT manage LLM API keys (anthropic, gemini, etc.)
 * — those are reachable from the AgentRunner anyway, but the user routes
 * agents through CLI workers (subscription OAuth in ~/.claude / ~/.gemini)
 * by default. The KNOWN_SECRETS list below contains only the secrets Perry
 * actually needs to encrypt — none of them are LLM provider keys.
 *
 * If you find yourself adding anthropic_api_key / gemini_api_key to
 * KNOWN_SECRETS, stop and re-read the subscription-only mode design.
 */

import type { Vault } from './vault.js';
import type { Logger } from './logger.js';

/**
 * The set of secret names Perry knows about. bootstrapFromEnv reads these
 * env vars and copies to vault if missing. Anything outside this list can
 * still be set via SecretsService.set(); the list just gates the migration
 * helper.
 */
export const KNOWN_SECRETS = [
  // Dashboard auth (Bearer token gating /api/*)
  { name: 'perry_api_key',           envFallback: 'PERRY_API_KEY',          required: true,
    purpose: 'Dashboard Bearer auth. Required to access /api/*.' },

  // Webhook auth (n8n / external webhooks signed with this secret)
  { name: 'perry_webhook_secret',    envFallback: 'PERRY_WEBHOOK_SECRET',   required: false,
    purpose: 'HMAC signature verification on inbound webhooks. Required only if you receive webhooks.' },

  // Reddit OAuth for book research (NOT a worker model)
  { name: 'reddit_client_id',        envFallback: 'REDDIT_CLIENT_ID',       required: false,
    purpose: 'Reddit OAuth client ID — research path falls back to proxy pool when absent.' },
  { name: 'reddit_client_secret',    envFallback: 'REDDIT_CLIENT_SECRET',   required: false,
    purpose: 'Reddit OAuth client secret. Paired with reddit_client_id.' },

  // Google Books API (small free quota; not an LLM provider)
  { name: 'google_books_api_key',    envFallback: 'GOOGLE_BOOKS_API_KEY',   required: false,
    purpose: 'Google Books API. Powers Source 6 in Live Comp Title Scout.' },

  // Messaging gateway bot tokens. Created via Telegram @BotFather / Discord
  // Developer Portal. Both are OPTIONAL — gateways stay dormant when blank.
  { name: 'telegram_bot_token',      envFallback: 'TELEGRAM_BOT_TOKEN',     required: false,
    purpose: 'Telegram bot token from @BotFather. Enables /api/gateways/telegram.' },
  { name: 'discord_bot_token',       envFallback: 'DISCORD_BOT_TOKEN',      required: false,
    purpose: 'Discord bot token from the Developer Portal. Enables /api/gateways/discord.' },

  // Per-platform user ACL. Comma-separated allowlists of user IDs (Telegram
  // user IDs are numeric; Discord uses snowflake IDs). Required if you
  // enable a gateway — without these, messages from anyone hit your agents.
  { name: 'telegram_allowed_user_ids', envFallback: 'TELEGRAM_ALLOWED_USER_IDS', required: false,
    purpose: 'Comma-separated Telegram user IDs allowed to message the bot.' },
  { name: 'discord_allowed_user_ids',  envFallback: 'DISCORD_ALLOWED_USER_IDS',  required: false,
    purpose: 'Comma-separated Discord user IDs allowed to message the bot.' },
] as const;

export type KnownSecretName = (typeof KNOWN_SECRETS)[number]['name'];

export interface SecretAuditRow {
  id: string;
  secret_name: string;
  action: 'read' | 'write' | 'rotate' | 'delete' | 'import' | 'reveal';
  caller: string | null;
  created_at: string;
}

export interface SecretMetadata {
  name: string;
  hasValue: boolean;
  /** From the known-secret registry, undefined if user-added freeform. */
  purpose?: string;
  /** From the known-secret registry. */
  required?: boolean;
  /** Last write timestamp from audit log. */
  lastWriteAt?: string;
  /** Last read timestamp from audit log. */
  lastReadAt?: string;
  /** If a rotation grace period is active, the prior value still resolves
   *  for compatibility. UI should flag this. */
  rotationGraceExpiresAt?: string;
}

/** In-memory rotation overlay: name → { newValue, oldValue, expiresAt }. */
interface RotationOverlay {
  newValue: string;
  oldValue: string;
  expiresAt: number;
}

export class SecretsService {
  /** Active rotations — old values still served until expiry. */
  private rotations: Map<string, RotationOverlay> = new Map();
  /** SQLite handle from StateStore. Set lazily via setDb() since vault
   *  is constructed before state-store is ready. */
  private db: any = null;

  constructor(private vault: Vault, private log: Logger) {}

  /**
   * Hook the audit log to a SQLite database. Optional — without it, the
   * service still works, just with no audit trail. Call from server boot
   * after the state store is initialised.
   */
  setDb(db: any): void {
    this.db = db;
  }

  /**
   * Read a secret. Returns undefined if not set. Audit-logged. Honors
   * active rotation overlay (returns new value; old value still works
   * until grace expires for backwards-compat consumers).
   */
  async get(name: string, caller?: string): Promise<string | undefined> {
    // Active rotation: prefer the new value.
    const rot = this.rotations.get(name);
    if (rot) {
      if (Date.now() < rot.expiresAt) {
        this.audit(name, 'read', caller);
        return rot.newValue;
      }
      // Grace window expired — promote new value to vault, clear overlay.
      await this.vault.set(name, rot.newValue);
      this.rotations.delete(name);
    }
    const value = await this.vault.get(name);
    if (value !== undefined) this.audit(name, 'read', caller);
    return value;
  }

  /**
   * Synchronous read for hot paths that can't go async (middleware token
   * checks). Reads from the Vault's in-memory cache; works for any secret
   * that's been loaded. NOT audit-logged (would tank middleware latency).
   */
  getSync(name: string): string | undefined {
    const rot = this.rotations.get(name);
    if (rot && Date.now() < rot.expiresAt) return rot.newValue;
    return this.vault.getSync(name);
  }

  /**
   * Set a secret. Encrypts + persists. Audit-logged.
   */
  async set(name: string, value: string, caller?: string): Promise<void> {
    await this.vault.set(name, value);
    // Setting overrides any active rotation.
    this.rotations.delete(name);
    this.audit(name, 'write', caller);
  }

  /**
   * Rotate a secret with optional grace period during which the OLD value
   * still resolves (useful when downstream consumers cache the old value
   * for some time — they get a window to refresh).
   *
   * graceMs=0 (default): instant cutover. Equivalent to set().
   * graceMs>0: old value remains in vault, new value served from overlay
   *            until expiry, then vault is updated.
   */
  async rotate(name: string, newValue: string, graceMs: number = 0, caller?: string): Promise<void> {
    const oldValue = await this.vault.get(name);
    if (!oldValue || graceMs <= 0) {
      // No prior value or no grace → just set.
      await this.vault.set(name, newValue);
      this.rotations.delete(name);
    } else {
      // Hold the new value in overlay; vault keeps the old until expiry.
      this.rotations.set(name, {
        newValue,
        oldValue,
        expiresAt: Date.now() + graceMs,
      });
    }
    this.audit(name, 'rotate', caller);
  }

  /**
   * Resolve a rotation explicitly (forces the new value into vault now,
   * discards the grace window).
   */
  async resolveRotation(name: string, caller?: string): Promise<boolean> {
    const rot = this.rotations.get(name);
    if (!rot) return false;
    await this.vault.set(name, rot.newValue);
    this.rotations.delete(name);
    this.audit(name, 'rotate', caller);
    return true;
  }

  /** Delete a secret. Audit-logged. */
  async delete(name: string, caller?: string): Promise<boolean> {
    const existed = await this.vault.delete(name);
    this.rotations.delete(name);
    if (existed) this.audit(name, 'delete', caller);
    return existed;
  }

  /** Check existence without revealing the value. Not audit-logged. */
  has(name: string): boolean {
    return this.vault.has(name) || this.rotations.has(name);
  }

  /**
   * List metadata for all secrets — names, purpose, last activity. NEVER
   * returns values. Safe for dashboard list view.
   */
  list(): SecretMetadata[] {
    const allNames = new Set<string>([
      ...this.vault.keys(),
      ...this.rotations.keys(),
      ...KNOWN_SECRETS.map(k => k.name),
    ]);
    return Array.from(allNames).map(name => {
      const known = KNOWN_SECRETS.find(k => k.name === name);
      const rot = this.rotations.get(name);
      const lastWrite = this.lookupLastAudit(name, ['write', 'rotate', 'import']);
      const lastRead = this.lookupLastAudit(name, ['read']);
      return {
        name,
        hasValue: this.vault.has(name) || !!rot,
        purpose: known?.purpose,
        required: known?.required,
        lastWriteAt: lastWrite?.created_at,
        lastReadAt: lastRead?.created_at,
        rotationGraceExpiresAt: rot ? new Date(rot.expiresAt).toISOString() : undefined,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Reveal a secret's value (audited explicitly as 'reveal' rather than
   * 'read' so it stands out in the log). For dashboard "show value" button.
   */
  async reveal(name: string, caller?: string): Promise<string | undefined> {
    const value = await this.get(name, undefined);
    if (value !== undefined) this.audit(name, 'reveal', caller || 'dashboard');
    return value;
  }

  /**
   * Recent audit entries for the dashboard. Optionally filter by name.
   */
  audit_recent(opts: { name?: string; limit?: number } = {}): SecretAuditRow[] {
    if (!this.db) return [];
    const conds: string[] = [];
    const params: any[] = [];
    if (opts.name) { conds.push('secret_name = ?'); params.push(opts.name); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    try {
      return this.db.prepare(
        `SELECT * FROM secrets_audit ${where} ORDER BY created_at DESC LIMIT ?`
      ).all(...params, Math.min(opts.limit || 50, 500)) as SecretAuditRow[];
    } catch (e: any) {
      this.log.warn('audit query failed', { error: e.message });
      return [];
    }
  }

  /**
   * Boot-time import: for each KNOWN_SECRET, if it's in process.env but
   * NOT in the vault, copy it into the vault. Returns a summary of what
   * was done so the boot log can surface security warnings ("X is still
   * in .env, remove it now that it's in the vault").
   */
  async bootstrapFromEnv(): Promise<{
    imported: string[];
    alreadyInVault: string[];
    stillInEnv: string[];
    missing: string[];
  }> {
    const imported: string[] = [];
    const alreadyInVault: string[] = [];
    const stillInEnv: string[] = [];
    const missing: string[] = [];
    for (const known of KNOWN_SECRETS) {
      const inVault = this.vault.has(known.name);
      const envValue = process.env[known.envFallback];
      const inEnv = !!(envValue && envValue.trim());
      if (inVault) {
        alreadyInVault.push(known.name);
        if (inEnv) stillInEnv.push(known.name);
        continue;
      }
      if (inEnv) {
        await this.vault.set(known.name, envValue!.trim());
        this.audit(known.name, 'import', 'bootstrap');
        imported.push(known.name);
        stillInEnv.push(known.name);
        continue;
      }
      if (known.required) missing.push(known.name);
    }
    if (imported.length) {
      this.log.info('SecretsService imported from .env', { secrets: imported });
    }
    if (stillInEnv.length) {
      this.log.warn(
        '⚠️  These secrets are in the vault BUT also present in .env — remove from .env now that they are encrypted: ' +
        stillInEnv.join(', ')
      );
    }
    if (missing.length) {
      this.log.warn('Required secrets are MISSING from both vault and .env: ' + missing.join(', '));
    }
    return { imported, alreadyInVault, stillInEnv, missing };
  }

  // ─────────────────────────────────────────────────────────────────────

  private audit(name: string, action: SecretAuditRow['action'], caller?: string): void {
    if (!this.db) return;
    try {
      this.db.prepare(
        `INSERT INTO secrets_audit (id, secret_name, action, caller, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run(
        `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name, action, caller || null, new Date().toISOString()
      );
    } catch (e: any) {
      // Audit is best-effort. Don't fail the underlying get/set.
      this.log.warn('audit write failed', { name, action, error: e.message });
    }
  }

  private lookupLastAudit(name: string, actions: string[]): SecretAuditRow | null {
    if (!this.db) return null;
    try {
      const placeholders = actions.map(() => '?').join(',');
      return this.db.prepare(
        `SELECT * FROM secrets_audit WHERE secret_name = ? AND action IN (${placeholders})
         ORDER BY created_at DESC LIMIT 1`
      ).get(name, ...actions) as SecretAuditRow | null;
    } catch { return null; }
  }
}
