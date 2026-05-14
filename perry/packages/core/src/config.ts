/**
 * @perry/core — Config Service
 *
 * Loads configuration from JSON files with typed accessors and dot-path
 * navigation. Supports a default config + user overrides.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export class ConfigService {
  private data: Record<string, unknown> = {};
  private configDir: string;

  constructor(configDir: string) {
    this.configDir = configDir;
  }

  /** Load config files from disk. Call once at startup. */
  load(): void {
    mkdirSync(this.configDir, { recursive: true });

    // Load default config
    const defaultPath = join(this.configDir, 'default.json');
    if (existsSync(defaultPath)) {
      const raw = readFileSync(defaultPath, 'utf-8');
      this.data = JSON.parse(raw);
    }

    // Merge user overrides
    const userPath = join(this.configDir, 'user.json');
    if (existsSync(userPath)) {
      const raw = readFileSync(userPath, 'utf-8');
      const userConfig = JSON.parse(raw);
      this.data = this.deepMerge(this.data, userConfig);
    }
  }

  /**
   * Get a config value by dot-path. Returns the default if not found.
   *
   * Example: config.get('ai.ollama.model', 'gemma3:27b')
   */
  get<T = unknown>(path: string, defaultValue?: T): T {
    const parts = path.split('.');
    let current: unknown = this.data;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return defaultValue as T;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return (current === undefined ? defaultValue : current) as T;
  }

  /** Set a config value by dot-path and persist to user.json. */
  set(path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = this.data;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;

    // Persist to user.json
    const userPath = join(this.configDir, 'user.json');
    let userConfig: Record<string, unknown> = {};
    if (existsSync(userPath)) {
      userConfig = JSON.parse(readFileSync(userPath, 'utf-8'));
    }

    let uCurrent: Record<string, unknown> = userConfig;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in uCurrent) || typeof uCurrent[parts[i]] !== 'object') {
        uCurrent[parts[i]] = {};
      }
      uCurrent = uCurrent[parts[i]] as Record<string, unknown>;
    }
    uCurrent[parts[parts.length - 1]] = value;

    mkdirSync(dirname(userPath), { recursive: true });
    writeFileSync(userPath, JSON.stringify(userConfig, null, 2));
  }

  /** Get the full config object (read-only). */
  getAll(): Record<string, unknown> {
    return structuredClone(this.data);
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        result[key] = this.deepMerge(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>,
        );
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}
