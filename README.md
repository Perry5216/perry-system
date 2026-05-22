# Perry — Self-Hosted Multi-Agent Platform

> A self-hosted, event-driven multi-agent AI platform you can train on any
> domain. Ships with a complete novel-writing pipeline as the flagship
> showcase — bring your own domain to point the same worker pool, learning
> loop, and fine-tuning stack at whatever you want.

Perry (**P**rose, **E**valuation, **R**esearch, & **R**evision Engine) is a
decoupled AI agent framework that runs entirely on your own hardware. Plug
in your Claude / Gemini subscription, and Perry orchestrates a fleet of
containerised workers, a self-learning skills loop, a local-LLM inference
stack, and a LoRA fine-tuning pipeline. The novel-writing pipeline is the
first end-to-end domain shipped on top of the platform; the architecture
itself is completely domain-agnostic.

## What you get out of the box

**The platform (domain-agnostic)**
- **Multi-agent worker pool** — Claude Code + Gemini CLI workers running in containers, claiming tasks from a shared MCP-exposed queue
- **Self-learning framework** — every component emits learning events; recurring patterns auto-propose skills that humans curate from the dashboard. Add a new domain and it gets the learning loop for free
- **Local LLM inference** — Ollama + ComfyUI with GPU scheduling, embedding / librarian / inference model split
- **LoRA fine-tuning pipeline** — train domain-specific adapters from your own curated data; auto-rebuild Modelfile and re-tag in Ollama
- **RAG corpus** — SQLite FTS5 + vector embeddings; pluggable per domain
- **VPN-routed scouting** — gluetun containers with NordVPN + TorGuard exits for any traffic that needs IP rotation or geographic diversity
- **React + TypeScript dashboard** — fleet view, project pipelines, Goals Board (Kanban visualizer), Skills Librarian (curation, telemetry, pin/unpin, merge, backup & rollback), analytics, secrets vault
- **Subscription-only cost model** — Claude Pro/Max + Gemini Advanced via the official CLIs; metered API providers are blocked at the runtime level by design

**The first domain — novel writing**
- Multi-pen-name pipeline (parallel projects under different voices)
- Per-pen-name fine-tuned LoRA on top of a local LLM
- Concept → market research → bible → scene breakdown → chapter drafting → audit → revision
- Anti-pattern lint, voice anchors, style DNA filters
- Comp title scouting (Amazon / Goodreads / Bookbub / Reddit)
- ComfyUI book cover generation

## Bring your own domain

The framework is intentionally domain-flexible. To point Perry at a new task
type (code generation, security research, customer support automation,
content moderation — anything you have training data for), you add:

1. New step definitions in the pipeline engine
2. Domain-specific MCP tools (the worker pool picks them up automatically)
3. Optional: a domain-specific LoRA training corpus
4. Optional: domain-specific audit gates / quality filters

The self-learning loop, worker pool, RAG corpus, dashboard, and fine-tuning
stack are reused as-is across domains.

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

# Dashboard at http://localhost:3847 (or your custom domain like https://perry.5216perry.uk) once perry reports healthy
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
- ✅ Goals Board (Kanban visualizer) for tracking /goal loops, subgoal DAG node statuses, and dependencies
- ✅ Skills Librarian (dashboard tab to curate proposals, view skill telemetry, pin/unpin, merge, run Passes, backups & rollbacks)
- ✅ CORS configuration (`PERRY_CORS_ORIGINS`) and Docker hosting via Cloudflare Tunnels (e.g. perry.5216perry.uk)
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

