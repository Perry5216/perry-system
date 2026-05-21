# Perry — AI Novel Writing Engine

> A self-hosted, multi-agent AI system for writing novels under multiple pen names —
> with per-pen-name fine-tuned models, competitive title research, and a
> self-learning feedback loop.

Perry (**P**rose, **E**valuation, **R**esearch, & **R**evision Engine) is a decoupled book-writing
pipeline that runs entirely on your own hardware. Plug in your Claude / Gemini
subscription, and Perry handles concept generation, market research, scene-by-scene
drafting, audit gates, and revision — all coordinated by an event-driven multi-agent
framework with its own learning loop.

## What it does

- **Multi-pen-name pipeline** — manage parallel book projects under different
  voices, each with its own style profile, anti-pattern filters, and fine-tuned
  LoRA on top of a local LLM
- **Competitive scout** — Amazon / Goodreads / Bookbub / Reddit research via
  VPN-routed proxy pool, indexed into a per-pen RAG corpus
- **Self-learning loop** — every component (director, audit, scout, GC, prompt
  builder) emits learning events; recurring patterns get auto-proposed as skills
  that humans can promote or reject from the dashboard
- **Subscription-only cost model** — Perry routes all heavy reasoning to your
  Claude Pro/Max and Gemini Advanced subscriptions via the official CLIs. No
  per-token API charges; metered API providers are blocked at the runtime level by design

## Architecture (one-paragraph version)

A React + TypeScript dashboard talks to an Express coordinator backend (Node).
The coordinator enqueues complex steps as tasks in SQLite; an MCP server exposes
those tasks to a fleet of headless workers running Claude Code / Gemini CLI in
containers. Workers claim, complete, and report tasks back via MCP. Local Ollama
serves embedding + librarian models on GPU. Scout traffic routes through gluetun
containers holding WireGuard tunnels (NordVPN + TorGuard static IPs). Cloudflare
Tunnel exposes the dashboard to your devices.

Full diagrams and component breakdown in [`docs/perry_system_architecture.md`](docs/perry_system_architecture.md).

## Prerequisites

- Docker Desktop with WSL2 (Windows) or Docker Engine (Linux)
- NVIDIA GPU with CUDA support (Ollama containers expect `runtime: nvidia`)
- 32 GB+ system RAM recommended; ~80 GB of disk for local model weights
- A Claude Pro/Max subscription and/or a Gemini Advanced subscription
- Cloudflare account (free tier) if you want remote dashboard access

## Quickstart

```bash
git clone https://github.com/Perry5216/perry-system.git
cd perry-system

# Copy the environment template and fill in your keys
cp .env.sample .env
# Edit .env — see comments for what each block does

# Authenticate the CLIs once on the host (persists across container runs)
claude login
gemini login

# Bring up the stack
docker compose up -d

# Dashboard at http://localhost:3847 once perry reports healthy
```

The first boot pulls ~80 GB of model weights — give it 15–30 minutes on first run.

## Project layout

```
perry-system/
├─ compose.yaml            # Full multi-container stack
├─ .env.sample             # Environment template
├─ perry/                  # Monorepo: dashboard, coordinator, workers, MCP server, trainer
│  ├─ packages/
│  │  ├─ core/             # EventBus, encrypted vault, base types
│  │  ├─ ai/               # Ollama / ComfyUI connectors
│  │  ├─ rag/              # SQLite FTS5 + vector storage
│  │  ├─ projects/         # The pipeline engine
│  │  ├─ dashboard-api/    # Express REST + WS server
│  │  ├─ dashboard/        # React frontend
│  │  └─ mcp-server/       # MCP tool surface for workers
│  ├─ worker/              # Containerised Claude / Gemini CLI workers
│  ├─ scout/               # VPN-routed scraper containers
│  └─ trainer/             # Python LoRA fine-tuning pipeline
├─ data/                   # Bind-mounted model + image storage (gitignored)
└─ docs/                   # Architecture diagrams + design notes
```

## Status

Perry is in **active development** — see [`ROADMAP.md`](ROADMAP.md) for what's
shipped, what's in progress, and what's aspirational. The core pipeline (write
a novel end-to-end) is shipped; many ancillary features are in flight.

## What's next

A high-level look at what's in flight or queued — see [`ROADMAP.md`](ROADMAP.md)
for the full breakdown, dependencies, and effort estimates.

**Active backlog**
- [ ] In-dashboard VS Code (via `code-server` sidecar) — edit pipeline scripts and RAG templates from the dashboard
- [ ] Scrape-and-clean training corpus — workers fetch public-domain texts, prose-clean and similarity-filter, build pen-aware fine-tuning sets
- [ ] Cron / scheduled writes — *"draft chapter 12 at 9am and deliver to Telegram"*
- [ ] Multi-service skill consumers (director / audit / GC / scout) — producer-side already shipped
- [ ] Telegram + Discord messaging gateways — productionize the existing `GatewayManager` scaffolding
- [ ] Expanded garbage collector — RAG corpus retention, media GC, agent-session pruning at scale

**Aspirational**
- [ ] DSPy prompt optimisation — A/B test prompt variants against the verified-success RAG corpus
- [ ] Multimodal (Whisper STT + Piper TTS + native image input)
- [ ] Hardware-aware setup wizard — first-run detects GPU/RAM, recommends models
- [ ] Model management UI — Ollama + Hugging Face integration from the dashboard
- [ ] Theme picker — additional dashboard themes beyond the cyan/purple default

**Recently shipped**
- ✅ Event-driven self-learning framework (single `LearningCore`, auto-applies to new domains)
- ✅ FTS5 session search + RAG-indexed verified-success corpus per pen
- ✅ ~30 KB tokens saved per book via three rounds of prompt compression
- ✅ Per-pen `SOUL.md` / `LESSONS.md` curation editor
- ✅ Containerised worker pool (Claude Code + Gemini CLI) with MCP profile filtering

## License & Commercial Use

Perry is licensed under [PolyForm Noncommercial 1.0.0](LICENSE).

**You are free to use, modify, and share Perry for personal, hobby, research,
and noncommercial purposes.**

**For commercial use** — including SaaS deployments, internal tooling at a
company, ghostwriting services, or any revenue-generating deployment — please
contact **5216perry@gmail.com** to arrange a commercial license.

## Contributing

Issues and pull requests welcome. By submitting a PR, you agree to license your
contribution under the same terms (PolyForm Noncommercial 1.0.0) so the
project's commercial-licensing path stays clean.
