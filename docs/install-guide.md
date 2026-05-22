# Install Guide

Step-by-step walkthrough of getting Perry running on your machine. The
short version lives in [the README quickstart](../README.md#quickstart--one-command);
this document expands on each step and answers the questions the wizard
will ask you.

Target time: **3-5 minutes of clicking + 15-30 minutes for the first
model pull** to a working dashboard.

---

## Prerequisites

Perry runs entirely in Docker. Three things must be in place before the
installer runs:

### 1. Docker
- **Windows**: [Docker Desktop](https://docs.docker.com/desktop/install/windows-install/)
  with WSL 2 backend enabled. After install, open Docker Desktop and
  wait for it to report "Engine running" in the bottom-left.
- **macOS**: [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/).
- **Linux**: [Docker Engine](https://docs.docker.com/engine/install/) +
  [the compose plugin](https://docs.docker.com/compose/install/linux/).

Verify: `docker info` returns server info without errors.

### 2. NVIDIA GPU (strongly recommended)
- One CUDA-capable GPU with ≥12 GB VRAM is the practical floor for the
  local model stack (Ollama + ComfyUI).
- Two GPUs is better: Perry can pin the writer model to GPU 0 and the
  librarian / embeddings model to GPU 1. The wizard asks which layout
  you have.
- Install the NVIDIA driver + the
  [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
  so Docker can see the GPU.

Verify: `nvidia-smi` lists your GPU(s). If you run the installer
without a GPU it will warn but proceed; the local LLM containers will
crash-loop until you add one.

### 3. git
- [Windows](https://git-scm.com/download/win) / [macOS](https://git-scm.com/download/mac) (or `brew install git`) / your package manager on Linux.

Verify: `git --version` prints a version string.

### 4. At least one subscription CLI (optional but recommended)
Perry's worker pool wraps three subscription CLIs. You don't need all
three — one is enough to get going. You can add others later.

| Provider | Plan needed | CLI command to log in later |
|---|---|---|
| Anthropic | Pro or Max | `claude login` |
| Google | Gemini Advanced | `gemini login` |
| OpenAI | ChatGPT Plus / Pro / Business / Edu / Enterprise | `codex login` |

If you tick a CLI in the wizard, you'll run the corresponding `… login`
command on the host **once** after the installer finishes. The auth
state mounts into the worker container automatically and persists.

---

## Step 1 — Run the installer

### Windows (PowerShell)
```powershell
irm https://perry.5216perry.uk/install.ps1 | iex
```

### Linux / macOS
```bash
curl -fsSL https://perry.5216perry.uk/install.sh | bash
```

### Fallback (always works — no custom-domain redirect needed)
```powershell
# Windows
irm https://raw.githubusercontent.com/Perry5216/perry-system/main/install.ps1 | iex
```
```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/Perry5216/perry-system/main/install.sh | bash
```

The installer:

1. Checks prereqs and bails early with a clear error if Docker isn't
   running.
2. Asks where to put the repo (default: `./perry-system`).
3. Clones from https://github.com/Perry5216/perry-system.
4. Walks you through 6 questions (see next section).
5. Writes `.env` with random secrets + your chosen `COMPOSE_PROFILES`.
6. Runs `docker compose up -d` for the selected profile set.
7. Polls `/api/system/health` until the dashboard responds (max 3 min).
8. Prints a summary with the dashboard URL, your generated
   `PERRY_API_KEY`, and next steps. Also written to `setup-summary.txt`.

---

## Step 2 — Answering the 6 questions

### Q1. Where will Perry's dashboard live?

| Choice | What changes |
|---|---|
| **Local-only** (default) | Dashboard at `http://localhost:3847`. No Cloudflare. Simplest. |
| **LAN** | Same `http://localhost:3847` from this machine; CORS is configured to also allow other devices on your LAN. You'll need their IP / hostname to reach it. |
| **Public via Cloudflare Tunnel** | The `cloudflared` container starts and joins the stack. You'll need a Cloudflare Tunnel Token (Q6). See [docs/cloudflare-tunnel.md](cloudflare-tunnel.md) for the step-by-step token-creation walk-through. |

### Q2. Which subscription CLIs do you want to enable?

Multi-select (yes/no per provider). Each enabled CLI gets its own
worker panel in the dashboard. Workers race for tasks — whichever
worker fires first claims the next task. You can change this later
(install / log out individual CLIs without touching the others).

**Recommendation:** tick at least one. The local-model stack works
without any subscription CLI, but the worker pool is what makes
complex pipeline steps feasible.

### Q3. GPU layout

| Choice | Notes |
|---|---|
| **Single GPU** | Both `ollama` (writer) and `ollama-embeddings` (librarian) share the same card. Works on 16+ GB cards. |
| **Dual GPU** | `ollama` pinned to GPU 0, `ollama-embeddings` pinned to GPU 1. Better latency, halves memory pressure on the primary card. |

### Q4. Book covers?

Toggles the `comfyui` container (~6 GB image + ~4 GB model weights on
first run). Off by default. You can flip this on later by adding
`covers` to `COMPOSE_PROFILES` in `.env` and running
`docker compose up -d`.

### Q5. VPN-routed scouting?

Toggles 5 `gluetun-*` containers + the `perry-scout` helper. Lets the
Comp Title Scout fetch Amazon / Goodreads / Bookbub / Reddit through
NordVPN or TorGuard exits. Off by default; perfectly fine to leave off
unless you're actively running scout jobs.

If you say yes, the installer adds placeholder VPN env vars to `.env`
(`TG_WG_UK_*`, `NORDVPN_WG_PRIVATE_KEY`, etc.). You'll fill those in
once you have a VPN account.

### Q6. (Public only) Cloudflare Tunnel Token

Only shown if you picked "Public" in Q1. Paste the token from your
Cloudflare Tunnel dashboard (see [cloudflare-tunnel.md](cloudflare-tunnel.md)
for how to get one). You can skip and paste later — `cloudflared`
just won't start until the token is in `.env`.

---

## Step 3 — Post-install

After the installer prints its summary:

### Bind your subscription CLI accounts

Run the corresponding login command **on the host machine** for every
CLI you ticked. The auth state lives under `~/.claude/`,
`~/.gemini/`, `~/.codex/` respectively and is mounted into the worker
container automatically.

```bash
claude login    # if Anthropic ticked
gemini login    # if Google ticked
codex login     # if OpenAI ticked
```

Each opens a browser tab for OAuth. Sign in with the account that
holds your subscription. The CLI writes the auth files locally and the
worker pool picks them up on the next spawn.

### First dashboard load

Open `http://localhost:3847` (or your Cloudflare hostname). The
dashboard prompts for your API key on first load — paste the
`PERRY_API_KEY` from the install summary. It's saved to
`localStorage` so you don't need to re-paste.

### First model pull

The Models tab shows what's loaded in Ollama. Click "Pull" on the
writer + librarian models. **This is the slow part** — model weights
are 4-40 GB each and take 5-30 minutes depending on bandwidth.

A working out-of-the-box pairing:
- **Writer**: `qwen3:14b` (~9 GB) or `qwen3.6:27b` (~16 GB) if you have
  the VRAM
- **Librarian**: `qwen3:14b` on the second card, or share with writer
  on single-GPU setups

---

## Troubleshooting

### `docker info` fails after install
Docker Desktop isn't running. Open it and wait for "Engine running".

### Installer hangs on health check
First-boot pulls images (~5-10 GB) before any container starts. Three
minutes is the wizard's cutoff but pulls can take longer on slow
links. If it times out, the containers may still be coming up — check:
```bash
cd perry-system
docker compose ps
docker compose logs -f perry
```

### Dashboard returns 401
The `PERRY_API_KEY` in `localStorage` doesn't match `.env`. Open
DevTools → Application → Local Storage → delete the `perry-api-key`
entry, refresh, paste the correct key from `setup-summary.txt`.

### Workers say "offline" even though `docker compose ps` shows healthy
The `perry` container's `WorkerCoordinator` writes a heartbeat into
SQLite every 5 s. If it's not heartbeating, perry itself is the
problem — check `docker compose logs perry`. The most common cause
post-install is a missing or wrong `PERRY_VAULT_KEY` / `PERRY_API_KEY`
in `.env`.

### `--yolo` flag missing on a CLI version
Older CLI versions used different flag names. The installer pins
`@openai/codex`, `@anthropic-ai/claude-code`, and `@google/gemini-cli`
to current versions via the worker Dockerfile. Rebuild with
`docker compose build perry-worker && docker compose up -d perry-worker`
to pick up flag changes if the upstream CLI updates.

### GPU not visible inside container
Confirm `nvidia-smi` works on the host, then verify the container
toolkit is installed:
```bash
docker run --rm --gpus all nvidia/cuda:13.1.0-base-ubuntu24.04 nvidia-smi
```
If that prints your GPU info, Perry's containers will see it too. If
not, install / re-install the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

### `.env` overwrites on re-running the installer
The installer asks before overwriting. If you answered yes by mistake
and lost custom edits, your secrets are saved to `setup-summary.txt`
(`PERRY_API_KEY` at least) — re-paste anything else from version
control or backups.

---

## Reinstall / wipe

```bash
cd perry-system
docker compose down -v       # stops + removes containers AND volumes (DESTROYS DATA)
cd ..
rm -rf perry-system
# Re-run the installer.
```

`-v` is destructive — it deletes the SQLite database holding your
projects, pen names, training data references, and worker state.
Omit `-v` if you only want to refresh the containers and keep data.

---

## Upgrading

```bash
cd perry-system
git pull
docker compose pull          # refresh upstream images
docker compose build perry-worker  # rebuild worker if its Dockerfile changed
docker compose up -d
```

Perry's coordinator runs SQLite migrations on boot, so schema changes
are handled automatically. Check `docker compose logs perry` after a
pull to confirm migrations ran cleanly.

---

## Where to go next

- **First pen + first book**: see the dashboard's onboarding tour
  (Goals Board → "Start your first book") once the dashboard loads.
- **Public access**: [docs/cloudflare-tunnel.md](cloudflare-tunnel.md)
- **Architecture overview**: [docs/perry_system_architecture.md](perry_system_architecture.md)
- **What's shipped, what's in flight**: [ROADMAP.md](../ROADMAP.md)
