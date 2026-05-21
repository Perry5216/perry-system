# perry-worker — Containerised CLI worker

## What this is

Runs Claude Code + Gemini CLI inside a docker container, with the host's
OAuth state mounted read-only so the user's existing subscription auth
keeps working. Listens on `http://perry-worker:4711/spawn` for spawn
requests from perry's `WorkerCoordinator`.

This replaced an earlier host-side `PerryHostSpawner` Windows Service +
`.signals/` file IPC. That stack has been removed; the container is now
the only worker dispatch path.

## Why this exists

- One `docker compose up` boots the whole system — no Windows-specific
  install ceremony.
- Works on Linux / Mac / Windows hosts identically.
- The CLI subscription model is preserved — auth dirs mounted read-only,
  no API keys involved.
- Internal HTTP IPC instead of file-system signals.

## Architecture

```
                   ┌──── perry (decisions) ────┐
                   │  WorkerCoordinator        │
                   │     posts spawn requests  │
                   │     via internal HTTP     │
                   └─────────────┬─────────────┘
                                 │ http://perry-worker:4711/spawn
                                 ↓
                   ┌──── perry-worker ─────────┐
                   │  listener.cjs             │
                   │  Spawns claude / gemini   │
                   │  CLI subprocesses         │
                   │  Mounts ~/.claude  RO     │
                   │         ~/.gemini  RO     │
                   │  Logs to bind-mounted     │
                   │  ./perry/logs/workers/    │
                   └───────────────────────────┘
```

## Files

- `Dockerfile` — Node 22 alpine, installs both CLIs, runs `listener.cjs`.
- `listener.cjs` — HTTP server that spawns the CLI subprocesses.
- `README.md` — this file.
