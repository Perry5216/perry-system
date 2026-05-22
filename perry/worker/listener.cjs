/**
 * Perry Worker HTTP Listener
 *
 * Listens on a docker-internal port for spawn requests from the perry
 * container's WorkerCoordinator. Each request fires a subscription-CLI
 * subprocess (Anthropic / Google / OpenAI) with the same auth state the
 * user has on the host (mounted via docker volumes).
 *
 * Endpoints:
 *   POST /spawn   body: { command, agent, id, label, reason, config, working_dir }
 *                 Spawns the CLI. Streams stdout/stderr to a per-worker
 *                 log file under /app/logs/workers/. Returns immediately
 *                 with `{ ok: true, pid }`.
 *
 *   GET  /health  Returns `{ ok: true, activeWorkers: N }`
 *
 * Auth: shared secret in `PERRY_WORKER_SECRET` env, sent via
 * `X-Perry-Worker-Secret` header. Belt + suspenders since the listener
 * is only reachable on the docker network anyway.
 *
 * Process lifecycle:
 *   - Spawn child with auth dirs already mounted at /home/node/.claude and
 *     /home/node/.gemini (read-only via compose volumes)
 *   - Hard wall-clock timeout of 30 min
 *   - Logs to /app/logs/workers/<id>.log (bind-mounted to host so the
 *     dashboard's worker log viewer continues to work)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PORT = parseInt(process.env.PERRY_WORKER_PORT || '4711', 10);
const SECRET = process.env.PERRY_WORKER_SECRET || '';
const LOG_DIR = process.env.PERRY_WORKER_LOG_DIR || '/app/logs/workers';
const TIMEOUT_MS = 30 * 60 * 1000;

// ── MCP endpoint resolution ────────────────────────────────────────────
// Default to the compression gateway so workers see the lean tool surface.
// Override with PERRY_MCP_URL=http://perry:3850/mcp to bypass the gateway
// (useful for debugging or when the gateway is down). Rewrites .mcp.json
// + .gemini/settings.json on boot so both CLIs pick up the same target.
const MCP_URL = process.env.PERRY_MCP_URL || 'http://perry:3850/mcp';
const MCP_PROFILE = process.env.PERRY_MCP_PROFILE || 'drainer';
const MCP_COMPACT = (process.env.PERRY_MCP_COMPACT || 'true').toLowerCase() === 'true';
try {
  const headers = { 'X-Perry-MCP-Profile': MCP_PROFILE };
  if (MCP_COMPACT) headers['X-Perry-MCP-Compact'] = 'true';
  const mcpJson = {
    mcpServers: {
      perry: {
        type: 'http',
        url: MCP_URL,
        // Profile: returns only the tools relevant to this worker class.
        // Compact: returns 1-line tool descriptions + stub inputSchemas;
        // workers call mcp__perry__get_tool_schema to pull the full schema
        // only for tools they intend to invoke. Saves ~11k tokens per
        // session at the cost of one extra round-trip per actively-used tool.
        headers,
      },
    },
  };
  fs.writeFileSync('/app/.mcp.json', JSON.stringify(mcpJson, null, 2), 'utf8');
  const geminiSettings = {
    mcpServers: {
      perry: { url: MCP_URL, type: 'http', trust: true },
    },
  };
  fs.mkdirSync('/app/.gemini', { recursive: true });
  fs.writeFileSync('/app/.gemini/settings.json', JSON.stringify(geminiSettings, null, 2), 'utf8');
  console.log(`[listener] MCP target resolved to ${MCP_URL} (profile=${MCP_PROFILE}, compact=${MCP_COMPACT})`);
} catch (err) {
  console.error('[listener] failed to write MCP config files', err);
}

// ── Codex MCP config — passed inline per-spawn via `-c` overrides ─────
// Codex's `codex mcp add` CLI subcommand only accepts --url and
// --bearer-token-env-var; there's no flag for custom HTTP headers. We
// need X-Perry-MCP-Profile (worker class) + X-Perry-MCP-Compact (token
// budget) headers, so we drive the MCP server config inline on every
// `codex exec` invocation via `-c key="value"` overrides. This also
// avoids mutating the host's ~/.codex/config.toml, which would surprise
// the user if they later run codex interactively.
//
// Schema (verified against `codex mcp get` 2026-05-22):
//   [mcp_servers.perry]
//   url = "<MCP_URL>"
//   [mcp_servers.perry.http_headers]
//   "X-Perry-MCP-Profile" = "<MCP_PROFILE>"
//   "X-Perry-MCP-Compact" = "true"   # only when PERRY_MCP_COMPACT
const codexMcpFlags = [
  '-c', `mcp_servers.perry.url="${MCP_URL}"`,
  '-c', `mcp_servers.perry.http_headers."X-Perry-MCP-Profile"="${MCP_PROFILE}"`,
];
if (MCP_COMPACT) {
  codexMcpFlags.push('-c', `mcp_servers.perry.http_headers."X-Perry-MCP-Compact"="true"`);
}
console.log(`[listener] codex MCP config prepared (per-spawn): perry -> ${MCP_URL} (profile=${MCP_PROFILE}, compact=${MCP_COMPACT})`);

fs.mkdirSync(LOG_DIR, { recursive: true });

const activeWorkers = new Map(); // id -> { pid, startedAt, killTimer }

function log(level, msg, extra) {
  const ts = new Date().toISOString();
  const line = extra
    ? `[${ts}] ${level.padEnd(5)} ${msg} ${JSON.stringify(extra)}`
    : `[${ts}] ${level.padEnd(5)} ${msg}`;
  console.log(line);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function buildFinalCommand(signal) {
  const cfg = signal.config || {};
  const agent = signal.agent;
  // Per-agent command builders.
  if (agent === 'anthropic') {
    // Anthropic CLI — binary name is `claude` (from @anthropic-ai/claude-code).
    const flags = ['-p', '"/perry-worker"', '--max-turns', '60'];
    // Force-load /app/.mcp.json (Perry MCP HTTP transport) and ignore any
    // other MCP config the host's mounted auth state might contain.
    // Without --strict-mcp-config the workspace-trust dialog blocks the
    // server registration in non-interactive mode and the CLI boots with
    // no Perry tools.
    flags.push('--mcp-config', '/app/.mcp.json', '--strict-mcp-config');
    if (cfg.yolo !== false) flags.push('--dangerously-skip-permissions');
    if (cfg.model && cfg.model !== 'auto') flags.push('--model', cfg.model);
    return `claude ${flags.join(' ')}`;
  }
  if (agent === 'antigrav') {
    // Gemini CLI — same stdin-pipe pattern as before (the slash command
    // file is mounted in via the user's ~/.gemini volume).
    const slashCmdPath = '/home/node/.gemini/commands/perry-worker.md';
    if (fs.existsSync(slashCmdPath)) {
      const flags = [];
      if (cfg.yolo !== false) flags.push('--yolo');
      if (cfg.model && cfg.model !== 'auto') flags.push(`--model ${cfg.model}`);
      const flagsStr = flags.join(' ');
      return `cat ${slashCmdPath} | gemini ${flagsStr}`;
    }
  }
  if (agent === 'codex') {
    // Codex CLI — no native slash-command discovery, so pipe the shared
    // perry-worker prompt (already mounted at /app/.claude/commands/) into
    // `codex exec -` via stdin. Content is agent-agnostic; the only
    // Claude-specific bit is an example worker_id pattern which Codex
    // workers can adapt.
    //
    // MCP server config is passed inline via `-c` overrides (see
    // codexMcpFlags built at boot). Each `-c` value contains TOML literal
    // syntax with embedded double-quotes, so we shell-quote with single
    // quotes to keep the parser happy.
    const promptPath = '/app/.claude/commands/perry-worker.md';
    if (fs.existsSync(promptPath)) {
      const flags = [];
      // -c overrides go BEFORE the `exec` subcommand (top-level global flag).
      for (let i = 0; i < codexMcpFlags.length; i += 2) {
        flags.push(codexMcpFlags[i], `'${codexMcpFlags[i + 1]}'`);
      }
      flags.push('exec');
      // --yolo aliases --dangerously-bypass-approvals-and-sandbox — the
      // Claude `--dangerously-skip-permissions` / Gemini `--yolo` analogue.
      if (cfg.yolo !== false) flags.push('--yolo');
      if (cfg.model && cfg.model !== 'auto') flags.push('-m', cfg.model);
      flags.push('--skip-git-repo-check');
      flags.push('-C', '/app');
      // Trailing `-` tells `codex exec` to read the prompt body from stdin.
      flags.push('-');
      return `cat ${promptPath} | codex ${flags.join(' ')}`;
    }
  }
  return signal.command;  // fallback to whatever the coordinator sent
}

const server = http.createServer(async (req, res) => {
  if (SECRET && req.headers['x-perry-worker-secret'] !== SECRET) {
    res.writeHead(401); res.end('unauthorized'); return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, activeWorkers: activeWorkers.size }));
    return;
  }
  if (req.method === 'POST' && req.url === '/spawn') {
    try {
      const signal = await readBody(req);
      const { agent, id, label, reason } = signal;
      if (!agent || !id) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'agent and id required' })); return;
      }
      const finalCommand = buildFinalCommand(signal);
      log('INFO', `spawn ${label || agent} — ${reason || 'no reason'}`, { id });

      const workerLog = fs.createWriteStream(path.join(LOG_DIR, `${id}.log`), { flags: 'a' });
      workerLog.write(`# spawned at ${new Date().toISOString()}\n# command: ${finalCommand.slice(0, 200)}\n\n`);

      const child = spawn(finalCommand, [], {
        cwd: '/app',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        detached: false,
        env: process.env,
      });
      child.stdout.pipe(workerLog);
      child.stderr.pipe(workerLog);

      const killTimer = setTimeout(() => {
        log('WARN', `${label || agent} exceeded ${TIMEOUT_MS / 60000} min — killing`, { id, pid: child.pid });
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, TIMEOUT_MS);

      activeWorkers.set(id, { pid: child.pid, startedAt: Date.now(), killTimer });

      child.on('exit', code => {
        clearTimeout(killTimer);
        activeWorkers.delete(id);
        log('INFO', `${label || agent} exited`, { id, code });
        workerLog.end();
      });
      child.on('error', err => {
        clearTimeout(killTimer);
        activeWorkers.delete(id);
        log('ERROR', `${label || agent} spawn error`, { id, error: err.message });
        workerLog.end();
      });

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id, pid: child.pid }));
    } catch (e) {
      log('ERROR', 'spawn handler crashed', { error: e.message });
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  log('INFO', `perry-worker listener online on :${PORT}`, { logDir: LOG_DIR, secretSet: !!SECRET });
});

process.on('SIGINT', () => { log('INFO', 'received SIGINT'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { log('INFO', 'received SIGTERM'); server.close(() => process.exit(0)); });
