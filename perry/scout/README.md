# Perry Scout Pool

Parallel data-extraction workers that fetch external pages, run them through a
small local LLM for structured extraction, and return JSON back via the MCP
task queue — same pattern as the pair-mining swarm, different purpose.

This directory is the **placeholder home** for the scout worker code that will
land here. Today it documents the **task-payload contract** and the **VPN
routing infrastructure** that's already wired in `compose.yaml`, so when the
worker arrives it has a stable target.

---

## VPN exits — what's wired right now

Three NordVPN-backed exits run as `gluetun` containers (UK, US, Germany).
Each exposes an HTTP proxy on port 8888 inside the docker network. Any
container in `perry-system` can route a request through a specific exit by
hitting that proxy URL — no `network_mode` rebinding needed, so a single
scout container can pick a different exit per task.

| Service | Proxy URL (from inside docker network) | Country |
|---|---|---|
| `gluetun-uk` | `http://gluetun-uk:8888` | United Kingdom |
| `gluetun-us` | `http://gluetun-us:8888` | United States |
| `gluetun-de` | `http://gluetun-de:8888` | Germany |
| *(direct)* | *no proxy — uses host network* | your home IP |

### Verifying it works

```sh
# Each command should return a different IP in the matching country:
docker exec perry-scout curl -x http://gluetun-uk:8888 https://api.ipify.org
docker exec perry-scout curl -x http://gluetun-us:8888 https://api.ipify.org
docker exec perry-scout curl -x http://gluetun-de:8888 https://api.ipify.org

# And confirm the home IP for the direct path:
docker exec perry-scout curl https://api.ipify.org
```

---

## NordVPN setup (one-time)

You need a NordVPN WireGuard private key — NordVPN intentionally hides this
from their app. Two extraction paths:

**Option A — NordVPN Linux CLI** (easiest if you have WSL2 or a Linux VM):
```sh
sudo apt install nordvpn   # or follow nordvpn.com/download for your distro
nordvpn login
nordvpn set technology nordlynx
nordvpn connect
sudo wg show nordlynx private-key
```
Copy the key it prints.

**Option B — community script**: search GitHub for `nordvpn wireguard key
generator`. Generates the key from a NordVPN access token you create on the
NordVPN dashboard — no Linux required.

Then drop the key in `d:/n8n/.env`:
```
NORDVPN_WG_PRIVATE_KEY=<your key here>
```

Bring the stack up:
```sh
docker compose up -d gluetun-uk gluetun-us gluetun-de perry-scout
```

Healthchecks must turn green before `perry-scout` will start (gluetun verifies
the tunnel by pulling `https://api.ipify.org` through it).

---

## NordVPN device limits

NordVPN allows **10 simultaneous connections** per account. Each gluetun
container counts as one device. Current setup uses 3; you have 7 more if you
want to add country diversity. To add another exit, duplicate any `gluetun-*`
block in `compose.yaml` and change `SERVER_COUNTRIES`. Then add it to
`perry-scout`'s `depends_on` list.

---

## Task-payload contract

The scout worker will claim tasks of type `scout_url` via the existing
`mcp__perry__claim_task` flow. Payload shape:

```json
{
  "url": "https://www.goodreads.com/book/show/1234567",
  "extraction_schema": {
    "title": "string",
    "author": "string",
    "rating_avg": "number",
    "rating_count": "number",
    "genres": "array of strings",
    "synopsis": "string"
  },
  "extraction_hint": "Look for the average rating near the top of the page and the genre tags below the synopsis.",
  "network_path": "gluetun-uk",
  "fetch_options": {
    "render_js": false,
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "timeout_ms": 30000
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `url` | yes | Target page. |
| `extraction_schema` | yes | JSON Schema-lite. Tells the small LLM what to extract and what types. |
| `extraction_hint` | no | Optional free-text guidance to the LLM. Helps when the page layout is unusual. |
| `network_path` | no | One of `direct`, `gluetun-uk`, `gluetun-us`, `gluetun-de`. Defaults to `direct`. |
| `fetch_options.render_js` | no | If `true`, fetch via headless browser (Playwright). Default `false` (`curl`-style). |
| `fetch_options.user_agent` | no | UA override. |
| `fetch_options.timeout_ms` | no | Fetch timeout. Default 30000. |

### Result shape (what the worker reports back)

```json
{
  "url": "...",
  "fetched_at": "2026-05-18T12:34:56Z",
  "network_path": "gluetun-uk",
  "exit_ip": "185.156.46.42",
  "http_status": 200,
  "extracted": { /* matches extraction_schema */ },
  "extractor_confidence": 0.86,
  "warnings": []
}
```

`extractor_confidence` is the small LLM's self-rated confidence (0–1).
Anything under ~0.6 should be re-scouted from a different exit or escalated to
a larger model.

---

## Network-path selection heuristics (for the coordinator)

When enqueuing scout tasks, pick `network_path` based on the target:

| Target | Recommended path | Why |
|---|---|---|
| Goodreads, OpenLibrary, Wikipedia, Reddit | `direct` or any gluetun | Lenient sites, your home IP is fine |
| RSS feeds, author blogs | `direct` | Nothing to anonymize from |
| Sites that rate-limit by IP | rotate across gluetun-* | Spreads load across 3 IPs |
| Sites that geo-block content | matching country gluetun | Pull region-specific data |
| Amazon product pages | **don't** — use a search API (Tavily/Brave) | NordVPN exits are pre-flagged by Amazon's anti-bot stack |

---

## What's NOT here yet

- The actual `scout-worker` process that polls the queue, fetches URLs, calls
  the small extractor model, and reports back. Will live as
  `perry/scout/worker.cjs` or similar.
- The `scout_url` MCP tool/handler. Will mirror `synthesize_pair` in
  `packages/mcp-server/src/index.ts`.
- A dashboard surface for enqueuing scout tasks and viewing findings.
- A `scout_findings` SQLite table (or a JSONL file in
  `workspace/scout-findings/`) for accumulated extractions.

These will be built once the VPN routing is verified working end-to-end.
