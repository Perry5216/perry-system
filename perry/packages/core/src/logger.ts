/**
 * @perry/core — Logger
 *
 * Structured logging with levels and prefixes. Replaces the scattered
 * console.log/warn/error calls throughout V4.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',   // gray
  info: '\x1b[36m',    // cyan
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
};

const RESET = '\x1b[0m';

export class Logger {
  private prefix: string;
  private minLevel: LogLevel;
  private logStream: any = null;
  private logDir: string | null = null;

  constructor(prefix: string, minLevel: LogLevel = 'info', logDir?: string) {
    this.prefix = prefix;
    this.minLevel = minLevel;

    // Enable file logging if a logDir is provided or LOG_FILE env var is set
    const dir = logDir || process.env.PERRY_LOG_DIR;
    if (dir) {
      this.logDir = dir;
      this.initFileTransport(dir);
    }
  }

  private initFileTransport(dir: string): void {
    try {
      const fs = require('fs');
      const path = require('path');
      fs.mkdirSync(dir, { recursive: true });
      const filename = `perry-${new Date().toISOString().slice(0, 10)}.log`;
      this.logStream = fs.createWriteStream(path.join(dir, filename), { flags: 'a' });

      // Rotate: delete logs older than 7 days
      try {
        const files = fs.readdirSync(dir).filter((f: string) => f.startsWith('perry-') && f.endsWith('.log'));
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        for (const file of files) {
          const stat = fs.statSync(path.join(dir, file));
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(path.join(dir, file));
          }
        }
      } catch { /* rotation cleanup is best-effort */ }
    } catch { /* file logging is optional — silently skip */ }
  }

  /** Create a child logger with a sub-prefix. */
  child(subPrefix: string): Logger {
    return new Logger(`${this.prefix}:${subPrefix}`, this.minLevel, this.logDir || undefined);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const timestamp = new Date().toISOString().slice(11, 19);
    const color = LEVEL_COLORS[level];
    const tag = level.toUpperCase().padEnd(5);

    let line = `${color}${timestamp} ${tag}${RESET} [${this.prefix}] ${message}`;
    if (data && Object.keys(data).length > 0) {
      line += ` ${JSON.stringify(data)}`;
    }

    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }

    // Write to file (JSON structured, no ANSI colors)
    if (this.logStream) {
      try {
        const entry = JSON.stringify({
          ts: new Date().toISOString(),
          level,
          prefix: this.prefix,
          msg: message,
          ...(data || {}),
        });
        this.logStream.write(entry + '\n');
      } catch { /* file write failure is non-fatal */ }
    }
  }
}
