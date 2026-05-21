# Connecting Claude Code to the Perry MCP Server

The Perry MCP server runs inside the `perry` Docker container and exposes pair-collection + project-introspection tools to Claude Code (or any MCP client) over stdio.

## Setup (one-time)

1. Make sure perry is running: `docker compose up -d perry`

### Option A — Claude Code (VS Code extension or CLI)

A project-scoped `.mcp.json` at the workspace root is the recommended pattern. One has been written at `d:\n8n\.mcp.json`:

```json
{
  "mcpServers": {
    "perry": {
      "command": "docker",
      "args": ["exec", "-i", "perry", "node", "/app/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Reload Claude Code (Command Palette → "Claude Code: Reload Window", or restart VS Code). The Perry tools appear in any chat opened from this workspace.

Alternative: `claude mcp add perry docker -- exec -i perry node /app/packages/mcp-server/dist/index.js` (writes to the user-scoped config).

### Option B — Claude Desktop

Add the same entry to:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Restart Claude Desktop.

## Tools

### Existing (Phase 0)
- `list_projects` — enumerate active projects
- `get_project_context` — fetch project context (with optional Librarian compression)
- `execute_pipeline_step` — fire the next pipeline step
- `get_character_profile` — RAG-indexed character lookup
- `get_chapter_summary` — chapter summary + plot threads

### Pair-collection (Phase D, new)
- `list_pens` — all pens + LoRA versions + active version + anti-pattern count
- `get_recent_mined_pairs(slug, limit)` — recent raw BAD/GOOD candidates pre-gate
- `get_rejected_pairs(slug, limit)` — recent gate rejection log entries
- `inject_pair(slug, bad, good, category?)` — append a curated pair to `claude_injected.jsonl` (bypasses gates, included in next export)
- `trigger_export(slug)` — regenerate `training_data.jsonl` for the pen
- `get_anti_patterns(slug)` — pen-specific anti-pattern list
- `set_anti_patterns(slug, patterns[])` — replace the list (used to add new canon-specific patterns)

## Typical workflow

```
1. Claude calls `list_pens` → sees a-perry
2. Claude calls `get_recent_mined_pairs(slug="a-perry", limit=30)`
3. Claude reads the pairs, spots recurring failure modes
4. Claude calls `get_rejected_pairs(slug="a-perry", limit=50)` to see what the gates are catching
5. Claude composes 10-50 synthetic pairs targeting the failure modes
6. For each: `inject_pair(slug, bad, good, category)`
7. Claude calls `trigger_export(slug)` → new training_data.jsonl is written
8. Optionally: `set_anti_patterns(slug, [...])` to expand the calibration template's blocklist
```

## Notes

- `claude_injected.jsonl` lives at `/workspace/training/pen-{slug}/claude_injected.jsonl` inside the container, and on the host at `<n8n_data_volume>/training/pen-{slug}/claude_injected.jsonl`.
- Injected pairs bypass the three-gate pipeline because they are treated as trusted curated baseline (same status as `pen-a-perry-pairs.ts`).
- The MCP server uses the same StateStore + ProjectEngine instances as perry, so changes are seen immediately by both UIs.
