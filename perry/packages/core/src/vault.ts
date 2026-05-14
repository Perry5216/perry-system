/**
 * @perry/core — Vault
 *
 * Encrypted secret storage for API keys. Uses AES-256-GCM with a
 * machine-derived key. Secrets are stored in a JSON file with each
 * value encrypted individually.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { createCipheriv, createDecipheriv, randomBytes, createHash, scryptSync } from 'crypto';
import { hostname } from 'os';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

interface EncryptedEntry {
  iv: string;    // hex
  tag: string;   // hex
  data: string;  // hex
}

export class Vault {
  private filePath: string;
  private key: Buffer;
  private cache: Map<string, string> = new Map();

  constructor(vaultDir: string) {
    this.filePath = join(vaultDir, 'vault.enc.json');

    // Key derivation priority:
    // 1. PERRY_VAULT_KEY env var (recommended) — uses scryptSync for KDF
    // 2. Hostname-derived fallback (convenience for local dev, warns loudly)
    const envKey = process.env.PERRY_VAULT_KEY;
    if (envKey) {
      const salt = Buffer.from('perry-system-vault-salt', 'utf-8');
      this.key = scryptSync(envKey, salt, 32);
    } else {
      console.warn(
        '⚠️  PERRY_VAULT_KEY not set — using hostname-derived key. ' +
        'Set PERRY_VAULT_KEY in .env for production security.'
      );
      const seed = `perry-system-${hostname()}-vault-key`;
      this.key = createHash('sha256').update(seed).digest();
    }
  }

  /** Load the vault from disk. Call once at startup. */
  load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const entries: Record<string, EncryptedEntry> = JSON.parse(raw);
      for (const [key, encrypted] of Object.entries(entries)) {
        try {
          const decrypted = this.decrypt(encrypted);
          this.cache.set(key, decrypted);
        } catch {
          // Corrupted entry — skip silently
        }
      }
    } catch {
      // Corrupted vault file — start fresh
    }
  }

  /** Get a secret by key. Returns undefined if not found. */
  async get(key: string): Promise<string | undefined> {
    return this.cache.get(key);
  }

  /** Get a secret synchronously. */
  getSync(key: string): string | undefined {
    return this.cache.get(key);
  }

  /** Store a secret and persist to disk. */
  async set(key: string, value: string): Promise<void> {
    this.cache.set(key, value);
    this.persist();
  }

  /** Delete a secret. */
  async delete(key: string): Promise<boolean> {
    const existed = this.cache.delete(key);
    if (existed) this.persist();
    return existed;
  }

  /** List all stored key names (not values). */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /** Check if a key exists. */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  private encrypt(plaintext: string): EncryptedEntry {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted,
    };
  }

  private decrypt(entry: EncryptedEntry): string {
    const iv = Buffer.from(entry.iv, 'hex');
    const tag = Buffer.from(entry.tag, 'hex');
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(entry.data, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  }

  private persist(): void {
    const entries: Record<string, EncryptedEntry> = {};
    for (const [key, value] of this.cache) {
      entries[key] = this.encrypt(value);
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    // Atomic write: write to .tmp then rename to prevent corruption on crash
    const tmpPath = this.filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(entries, null, 2));
    renameSync(tmpPath, this.filePath);
  }
}
