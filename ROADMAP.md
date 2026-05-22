# Perry — Project Roadmap

Living scope doc. What Perry already does, what's actively being built, what's
on the backlog, and the longer-term vision. Updated as we go.

---

## North Star

Anyone can `docker compose up`, plug in their Claude / Gemini subscription, and
have a self-hosted automatic book-writing pipeline with per-pen-name fine-tuned
models. Shareable, idiot-proof, open-source. ([[shareability-goal]],
[[commercial-strategy]]: MIT-ish + GitHub Sponsors)

---

## ✅ Shipped (as of 2026-05-22)

### Public Deployment & Domain Setup
- **CORS configuration support** — added `PERRY_CORS_ORIGINS` to `compose.yaml`, `.env.sample` and `.env` to enable secure cross-origin dashboard requests.
- **Custom public domain exposure** — configured public access routing to the dashboard and API under `perry.5216perry.uk` inside Docker using Cloudflare Tunnel.

### Goals Board
- **Kanban goals board visualizer** — added a brand new dashboard view and coordinator APIs to track complex `/goal` loops, subgoal DAG node status transitions (`pending`, `active`, `completed`, `failed`), and task dependencies.
- **Director command tunnel** — enabled real-time interaction and command tunneling via the dashboard Goals panel directly to `/api/projects/:id/chat`.

### Skills Librarian
- **Curation proposals queue** — human approval interface for worker-proposed and service-proposed skills, backed by `LibrarianService` integrations.
- **LLM-assisted skill merging** — allow operators to merge/synthesize duplicate or highly overlapping guidelines into a single parameterized skill, with automatic codebase-wide reference updates.
- **Skill locking & pins** — pin/unpin skills to protect them from garbage collection sweeps or librarian cleanup passes.
- **Manual/Automatic backups** — automatically snapshot skills before mutations (archiving/merging) and enable one-click rollback of active skills to past backup timestamps.
- **Execution telemetry** — gather historical hit rates, success rates, and average execution durations for installed skills.

## ✅ Shipped (as of 2026-05-21)

### Core pipeline
- **Per-pen-name LoRA training** — calibration → audit → automatic Modelfile
  rebuild → Ollama re-tag. Self-improving writer model.
- **Style DNA, voice anchors, anti-pattern lint** — curated + audit-derived
  filters that gate prose quality at multiple stages.
- **Novel pipeline** — outline → bible → scene breakdown → chapter writes →
  revision execution → final polish.
- **ComfyUI cover generation** with prompt builder.
- **Scout pipeline** — Amazon / Goodreads / Bookbub / Reddit scraping via
  VPN-routed (gluetun) proxy pool for comp-title intel.
- **MCP server + workers** — Claude / Gemini CLI workers spawn on demand,
  drain a shared task queue, talk to Perry's tool surface over MCP.
- **Dashboard** — fleet view, projects, secrets vault, models, trajectories.

### Stability fixes (2026-05-21 afternoon, late session)
- **step-runner double-JSON-parse bug** in `runResearchAssistTask` — worker
  results stored as double-encoded JSON in `task_pool.result`. Single-parse
  yielded a string, `parsed.result` was undefined, step-runner falsely
  declared "returned empty result" and after 3 retries marked the step
  failed. Fix at [step-runner.ts:3723-3735](perry/packages/projects/src/step-runner.ts#L3723):
  parse once, detect string, parse again.
- **Manual step-1 recovery** — Concept Keywords step on project-159 was
  marked failed by the bug above even though four successful worker results
  sat in `task_pool`. Recovered by lifting the most recent done task's
  result into the step + reindexing FTS5. Pipeline could resume.
- **Gemini skill file sync** — `.gemini/commands/perry-worker.md` was stuck
  at the May 19 version (missing compact-tool-surface notes, get_tool_schema
  instructions, and today's propose_skill addition). Hand-synced from the
  current `.claude/commands/` version. Auto-sync hook is on the backlog.

### Self-learning (built today)
- **Verified-success RAG corpus** — `learning_chapter`, `learning_calibration`,
  `learning_cover_prompt` only index outputs that pass an objective gate
  (scanLeaks, audit, ComfyUI success).
- **Per-pen SOUL.md + LESSONS.md** — stable identity files auto-generated
  after audits, injected into every chapter prompt instead of re-rendering
  verbose anti-pattern slots per call.
- **FTS5 session search** — keyword + BM25 over completed step outputs via
  new `session_search` and `session_view` MCP tools, plus REST API.
- **propose_skill MCP tool** — workers can submit candidate skills after
  verified-successful complex tasks. Lands in `workspace/skills-pending/`
  for human review. Promote / reject from the dashboard.
- **Self-Learning dashboard tab** — Sessions / Skills / Pens sub-tabs with
  edit-in-place for SOUL.md / LESSONS.md.
- **Analytics dashboard tab** — step volume, success rate, per-project
  breakdown, prompt-size trend (compression health signal), audit failure
  patterns per pen, LoRA training cadence.

### Self-learning framework — Perry-wide as a feature (built today, late session)
*"Every component (and every new domain) learns by default. No per-service wiring."*

The system was refactored from "5 hand-wired per-service producers" to a
**single event-driven LearningCore**. New domains (hacking, code, etc.)
get the entire learning loop for free — just emit a `learning:*` event from
anywhere in the domain's code path.

**Event taxonomy** ([types.ts:300+](perry/packages/core/src/types.ts))
- `learning:success` — `{ source, kind, fingerprint, metadata? }`
- `learning:failure` — `{ source, kind, fingerprint, error, metadata? }`
- `learning:observation` — generic recurrence counter
- `learning:duration` — `{ source, kind, fingerprint, durationMs }`

**Framework components**
- [LearningCore](perry/packages/dashboard-api/src/services/learning-core.ts) — subscribes to all `learning:*` events, tracks `(source, kind, fingerprint)` recurrence in a single `meta.learning_state` JSON blob, proposes skills via SkillProposer when thresholds cross. Persists every 5s. Renders skill bodies from observation metadata.
- [AgentLearningBridge](perry/packages/dashboard-api/src/services/agent-learning-bridge.ts) — translates already-existing `agent:invocation:{started,completed,failed}` events into `learning:*` events. **Every registered agent gets learning automatically** — register in `AGENT_REGISTRY`, learning works. Verified by adding zero code for a new agent.

**Per-service producers (refactored to ~5-line event emits)**
- Director (step-runner): emits `learning:failure` on `step:failed` + `learning:success` on `step:completed`
- Audit: emits `learning:observation` for each leak tag in `topFailureTags`
- GC: emits `learning:observation` on dir-growth detection
- Prompt-builder: emits `learning:observation` (miss) / `learning:success` (hit) on RAG queries

**Visibility** ([SelfLearningPanel.tsx](perry/packages/dashboard/src/components/SelfLearningPanel.tsx))
- Learning Activity strip renders DYNAMICALLY from `/api/learning/state` — new sources appear automatically as they emit their first event. No UI changes per service/domain.
- Cards pulse purple at threshold-1 ("ready to propose")

**What's NOT done (deferred)**
- Consumer-side wiring for director / audit / GC / scout — same pattern as
  prompt-builder's `shouldSkipRagQuery`, replicated per service
- Trainer producer (different container, Python — needs SkillProposer port)

---

### Skills system precursor — Phases 1 + 2 (earlier today)
*"Workers can propose; humans curate; consumers load per-service."*

Foundation that the LearningCore refactor sits on top of:

**Phase 1 — Foundation**
- **propose_skill extended** with `service` + `applies_when` frontmatter.
  Storage layout: `workspace/skills-pending/{service}/` (worker / scout /
  audit / director / trainer / gc / prompt-builder). Workers no longer
  the only producer.
- **Skills route + dashboard** walk per-service subdirs; filter chips +
  service badge per skill row in the Self-Learning → Skills tab. Promote
  routes worker skills to `.claude/commands/` (live for CLI workers) and
  non-worker skills to `workspace/skills-installed/{service}/`.

**Phase 2 — Scout (end-to-end producer + consumer)**
- `index_scout_finding` MCP tool — every scouted source the worker pulls
  gets indexed as `scout_finding` with `{source, subgenre, tone, query}`
  metadata. Feeds the dedup substrate.
- `check_scout_coverage` MCP tool — pre-crawl gate, returns
  raw/verified counts + saturation verdict (threshold 20). Worker reads
  this BEFORE deciding what to fetch.
- `mark_scout_finding_used` MCP tool — verified-success flip; after a
  bible/chapter step cites a finding, the finding gets re-indexed as
  `verified_scout_finding` so coverage weights real signal heavier than
  raw cache.
- `RagService.countWithMetadata` + `MemoryStore.countChunksWithMetadata`
  — json_extract-based metadata filters.
- GC TTL/cap rules added for `scout_finding` + `verified_scout_finding`.
- **perry-worker.md** updated with the scouting protocol (check → fetch
  → index → optionally mark_used → optionally propose_skill) and the
  extended propose_skill shape.

**Phase 3 + 4 — Producer side for in-process services (this session)**
- **`SkillProposer` helper** in `@perry/core` ([skill-proposer.ts](perry/packages/core/src/skill-proposer.ts)) — service-internal counterpart to the worker-facing `mcp__perry__propose_skill` tool. Same file format, same storage layout. Built-in throttling (1h between proposals of the same name) and pending-dir dedup. NEVER throws — best-effort, can't break the caller.
- **`loadInstalledSkills` helper** in `@perry/core` — reads `workspace/skills-installed/{service}/` and returns parsed frontmatter + body for consumer use. NOW used by prompt-builder's `refreshSkipSkills()` / `shouldSkipRagQuery()` — first end-to-end producer→librarian→consumer loop in production.
- **Director / step-runner** producer — EventBus listener on `step:failed`. After ≥3 occurrences of `(taskType, error fingerprint)`, propose a director skill. Counter persists in meta.
- **Audit service** producer — post-audit, counts which `topFailureTags` recur across audits per pen. After ≥3 consecutive audit runs flagging the same tag, propose a pre-screen-rule skill scoped to `(pen_slug, leak_tag)`.
- **GC** producer — post-sweep, compares dir bytes to prior snapshot stored in meta. After ≥3 consecutive sweeps where a dir doubles in size AND exceeds 10 MB, propose a tighter-TTL skill.
- **Prompt-builder** producer — records every RAG query outcome (hit count) in meta. After 5 misses + 0 hits for the same `(queryKind, topic fingerprint)`, propose a skip-this-query skill.
- **Worker skill discovery** — perry-worker.md now starts with an "always do this first" section: `ls /app/.claude/commands/` and skim descriptions of any promoted worker skills before claiming the first task.

What's NOT done (deferred to a follow-up session):
- **Consumer side for director / audit / GC / scout** — prompt-builder consumer
  shipped 2026-05-21 (`shouldSkipRagQuery` reads promoted skip skills and
  applies them at retrieval time). Remaining services need the same pattern.
- **Trainer producer** — trainer is in a different container (Python)
  and needs its own SkillProposer port. Out of scope today.

**Visibility (this session)**
- **`/api/learning/state`** ([learning.ts](perry/packages/dashboard-api/src/routes/learning.ts))
  — per-producer telemetry counters (observations / max_streak / threshold /
  ready_to_fire), chat-memory file stats, pending/installed skill counts by
  service. Polls live so the dashboard can show learning happening during a
  book-planning run.
- **Learning Activity strip** in `SelfLearningPanel` — 5 producer cards above
  the sub-tabs; cards pulse purple when a producer hits `threshold - 1` (one
  observation away from firing its first skill proposal).

### Token compression (built today)
- **~30 KB tokens saved per book** via three rounds of structural
  compression: continuation-segment Prose Style Controls, tighter
  Anti-Laziness / Anti-Patterns wording, dedup between step-runner system
  prompt and prompt-builder slots, compact JSON in MCP responses, always-
  trimmed tool descriptions, compressed header boilerplate.
- **A/B verified** with 5 seeds × OLD vs NEW prompts: 19% prompt-token cut
  with no quality regression (severity delta inside noise floor).

### Stability + infra
- **Per-service resource limits** on every container (mem + pids) — keeps a
  runaway in one service from exhausting WSL2.
- **mcp-gateway built from Rust source** with two upstream patches (bind
  0.0.0.0, disable_allowed_hosts). Parked from default route due to header-
  forwarding limitation — see backlog.
- **`.wslconfig` hardened** — CPU cap, swap cap, autoMemoryReclaim off.
- **Self-learning audit + GarbageCollector cleanup** — legacy `.signals/`
  IPC dead code removed; perry-scout depends_on completed; embedding-
  service double-init bug fixed.

---

## 🛠 Active backlog (ranked roughly by leverage / clarity)

### Coding IDE inside Perry
> *"Could I get a coding IDE inside Perry?"*

Three options, ascending in power:
1. **Monaco editor inline** (~1.5 MB) — Upgrade the SOUL.md / LESSONS.md /
   skill-pending textareas to a real editor with syntax highlighting,
   find/replace, multi-cursor. Best in-dashboard UX for the panels we
   already have.
2. **CodeMirror 6** (~200 KB) — Same as #1 but lighter bundle.
3. **`code-server` sidecar** — Browser-hosted VS Code at e.g.
   `localhost:8443`, mounted to the perry workspace. Edit any file, has
   terminal, full extensions. Add as a compose container + a new
   "IDE" nav link that iframes it.

**Recommendation:** Do **#3 first** (one compose entry, one nav link), then
layer Monaco for inline editing later if polish gap matters.

**Effort:** Small (#3) → Medium (#1+#3).

---

### Web-scraping training data before fine-tuning
> *"When I train a model, it can go onto the web and look for good data
> to train on first, then process the data before it's passed onto the
> model."*

Most of the pieces exist:
- ✅ `perry-browser` container with Playwright + stealth
- ✅ NetworkClient with VPN exits (gluetun-uk/us/de + torguard-uk/us)
- ✅ Scout pipeline scrapes Amazon/Goodreads/Bookbub already
- ✅ Voice-anchor centroid embeddings for similarity filtering

What's needed:
1. New task type `training_corpus_scrape` — enqueueable from dashboard;
   workers scrape target sources (Project Gutenberg, public-domain authors,
   AO3 with consent, specific blogs)
2. A **prose cleaner** — strips boilerplate, runs `scanLeaks` to drop
   chunks containing pen anti-patterns, splits to 200–500-word chunks
3. **Pen-aware similarity filter** — keep only chunks where embedding has
   cosine similarity > 0.7 to the pen's voice-anchor centroid
4. **"Verified-clean" pool** at `workspace/training/pen-{slug}/scraped-
   clean.jsonl` that the trainer picks up alongside curated pairs
5. Dashboard panel: enqueue scrape jobs, monitor progress, preview/approve
   chunks before they enter the corpus

**Effort:** Large (1–2 days). Real new pipeline.

---

### Cron / scheduled writes
> P.E.R.R.Y.'s Cron tab pattern — schedule recurring agent runs with delivery
> target (Telegram / Discord / Slack / email).

Perry version: *"Write chapter 12 at 9am and deliver to Telegram."*
Needs: gateway integration (Telegram / Discord — partial scaffolding exists
via GatewayManager), cron table, scheduler stage.

**Effort:** Medium-Large. Best after the messaging gateways are stable.

---

### Multi-service skills system — consumer-side application
> Producer-side for 5 services (scout, director, audit, gc, prompt-builder)
> is SHIPPED. Prompt-builder consumer ALSO shipped 2026-05-21 (loadInstalledSkills
> + shouldSkipRagQuery + applied at both retrieval call sites). Remaining
> services (director, audit, gc, scout) still need consumer wiring.

For each service, the consumer side is:
1. At init/sweep/build start, call `loadInstalledSkills(workspaceDir, '{service}')`.
2. For each loaded skill, parse `applies_when` from frontmatter.
3. At the relevant decision point, check whether current state matches
   any skill's `applies_when` — if yes, apply the skill's action.

Per-service consumer hooks:
- **Director / step-runner** — at step retry / failure-handler entry,
  check loaded `applies_when: { task_type, error_fingerprint }` for
  retry override / extended timeout.
- **Audit** — at scoreResponse() start, run pre-screen rules from
  `applies_when: { pen_slug, leak_tag }` skills before the full scanLeaks
  pass. Short-circuit on a match.
- **GC** — at sweep start, override DEFAULT TTLs for dirs matching
  `applies_when: { dir_path, suggested_ttl_action: 'tighten' }`.
- **Prompt-builder** — at RAG retrieval call, skip queries matching
  `applies_when: { query_kind, topic_fingerprint, action: 'skip' }`.
- **Scout** — workers already check coverage; once promoted scout skills
  exist, add a worker-side "read skills for this subgenre" step before
  crawl planning.

**Effort:** Medium — ~1h per service, plus a small `SkillEvaluator`
helper in @perry/core that takes a list of loaded skills + a context
object and returns matched skills. Defer until 5+ real skills have been
promoted across services (otherwise we'd be wiring against nothing).

---

### Chat memory — "soul" for the LandingChat (shipped 2026-05-21)
> ✅ DONE. Chat persistence + cross-session learning both live.

**Phase 1 — sessionId persistence** (earlier today)
- `localStorage.perry-landing-chat-session-id` survives close/reopen + browser refresh
- On mount, hydrate `messages[]` from `GET /api/agents/sessions/:id` invocations
- "New" button in chat header for explicit fresh-start
- Stale-session 404 clears localStorage automatically

**Phase 2 — chat-memory soul** (this session)
- **`ChatMemoryService`** ([chat-memory-service.ts](perry/packages/dashboard-api/src/services/chat-memory-service.ts)) — distills idle meta-domain agent sessions through `aiRouter.compressor` into `workspace/chat-memory/global.md`
- Each entry: `## YYYY-MM-DD HH:MM — session {id}` header + librarian-produced bullets (topic / decision / open)
- Idempotency via meta key `chat_memory_last_distilled_{sessionId}` — never re-distills the same content
- Idle guard: won't fire until last invocation is ≥5 min old (don't distill mid-conversation)
- Cap at 30 entries; older roll off via `capEntries`
- **GC `sweepChatMemory` stage** — runs distill on the 6h sweep + boot pass; capped at 5 sessions per sweep to protect the librarian
- **Auto-distill on close** — `POST /api/agents/sessions/:id/close` flushes before closing
- **Manual distill endpoint** — `POST /api/agents/sessions/:id/distill` for ad-hoc testing or future "remember this now" UI button
- **Memory view endpoint** — `GET /api/chat-memory` for dashboard rendering / hand-editing
- **Director system-prompt injection** — `/api/agents/meta.director/invoke` prepends the chat-memory file to the agent's system prompt for any `domain: 'meta'` invocation. Other domains untouched.

Verified end-to-end: boot sweep distilled 4 prior meta sessions into `global.md` with the expected topic/decision/open bullet shape. The director now sees its persistent memory on every new chat.

Possible follow-ups (low priority):
- **Dashboard chat-memory viewer/editor tab** — render `GET /api/chat-memory`, allow inline editing (POST /api/chat-memory) since the file format is human-editable already
- **Per-pen memory variants** — `chat-memory/pen-{slug}.md` when LandingChat becomes pen-scoped
- **Second-pass long-term distill** — when MAX_ENTRIES caps, fold the dropped entries into a "Long-term memory" header block rather than discarding outright
- **RAG semantic recall** — index summaries as `chat_memory` kind for "find past chats about X"

---

### Trainer producer side (Phase 3+4 deferred item)
> Trainer is in a separate container (Python) — needs its own SkillProposer port.

After each LoRA train, the trainer should:
- Measure perplexity against the verified-success calibration set
- Track which data-subset compositions produced the best PPL
- Propose a `service: trainer` skill summarising the best subset pattern

Storage write-through is already there (trainer writes to a shared
workspace mount). Just needs a Python SkillProposer equivalent that
mirrors the TS format exactly so the dashboard surfaces trainer skills
the same as any other service's.

**Effort:** Small (~1h) — single Python file mirroring `skill-proposer.ts`.

---

### Skill librarian GC stage (Phase 5 of skills system)
> Auto-promote `workspace/skills-pending/` entries when N≥3 independent
> proposals match.

Right now `propose_skill` lands files in the pending dir and the human
clicks promote in the dashboard. The librarian stage would:
- Run on the 6h GC sweep
- Deduplicate near-identical pending skills (cosine similarity ≥ 0.85)
- Count independent proposals per cluster
- Auto-promote clusters with N≥3 to `.claude/commands/`
- Leave singletons for human review

Needs real worker-proposed skills in the wild before it's worth building —
test data has to come from actual usage, not synthetic seeds.

**Effort:** Medium. Defer until we have ≥10 real proposals.

---

### Memory editor — profile curation
✅ **Partially done** — SOUL.md / LESSONS.md editable from the Pens tab.

Still want:
- **Diff view** — see what an audit-time regenerate would overwrite vs
  what you've manually edited
- **Freeze flag** — mark a pen profile as "manually curated; don't auto-
  regenerate"
- **Per-pen MEMORY.md** — small accumulated lessons across all the pen's
  sessions, separate from LESSONS.md (which is audit-driven)

**Effort:** Small for diff/freeze; Medium for per-pen memory.

---

### mcp-gateway profile header forwarding fix
The atlassian mcp-compressor we built today doesn't forward client HTTP
headers upstream. Workers send `X-Perry-MCP-Profile: drainer` but perry
sees the unfiltered surface. Currently bypassed — `PERRY_MCP_URL` defaults
back to `perry:3850/mcp` direct.

Fix: patch the Rust binary's reqwest client to inject static headers (same
pattern as the LOCALHOST + disable_allowed_hosts patches we already ship).
Or: file an upstream PR.

**Effort:** Small. Sed-patch + rebuild.

---

### Theme picker
P.E.R.R.Y. ships 6 themes (Perry Cyan, Midnight, Ember, Mono, Cyberpunk, Rosé).
Perry currently has one cyan/purple dark theme. Easy polish, cheap to add.

**Effort:** Small. ~30 min.

---

### Expanded GarbageCollector — beyond-book-side scale
> *"I want the GC to be expanded so it's able to keep the perry system [from]
> making too much bloat — as we expand past the book side this will get a lot
> for someone to manage."*

Current GC sweeps task_pool, meta, step_history, debug files, network cache,
orphan flags, pen-integrity, prompt-freshness, vault-key. Good for the
book-pipeline scale we have now. Won't scale once multimodal + scout + voice
land. New stages needed:

1. **`learning_*` RAG corpus retention** — verified prose accumulates
   forever. Cap to top-K per pen by recency × verification quality, OR
   age out entries older than N months unless flagged "exemplar."
2. **`workspace/skills-pending/` orphan sweep** — proposals that sat
   unreviewed for >14 days auto-archive (don't auto-promote; just move
   to `skills-rejected/` so the queue stays focused).
3. **`workspace/pens/{slug}/` for deleted pens** — when a pen row is
   removed from `pen_names`, sweep its profile dir.
4. **`workspace/comfyui-output/` cover image GC** — keep last N per
   project; delete losers + ad-hoc test gens >30 days old.
5. **`workspace/scout-findings/` Reddit + Amazon dumps** — already
   stamped with timestamps; age out >30 days.
6. **`workspace/training/pen-{slug}/audit-v{N}.{md,jsonl}` rotation** —
   keep last 10 versions per pen; older audits delete.
7. **`memory.db` RAG corpus pruning** — currently NO GC pass. Add an
   age + low-score sweep so embeddings don't bloat.
8. **`task_pool` archive table** — already partially handled, but the
   completed/failed retention thresholds (currently 7d/14d) should be
   surfaced as config so they're easy to tune as scale grows.
9. **`project_chats`, `agent_sessions`, `agent_invocations`,
   `agent_trajectories`** — director and agent runs accumulate. Add per-
   table retention configurable from the dashboard.
10. **Docker volume + log rotation** — perry container logs, gluetun
    logs, comfyui's output dir. Either docker daemon-level rotation
    config or a GC stage that prunes via the docker socket.
11. **Backup pruning** — `d:/n8n-backups/` accumulates tars from the
    backup-conventions ([[backup-conventions]]). Keep last N + last
    weekly + last monthly.

UI: extend the Analytics tab with a "Storage" sub-section — surface size
of each writable dir, last GC run, retention rules. Operator can dry-run
a sweep to see what would be deleted before committing.

**Effort:** Medium-Large. Each stage is small but there are many. Best
sequenced as: corpus pruning first (biggest growth), then skill/profile
orphan sweeps, then media (comfyui/scout), then audit/training rotation,
then telemetry/agent retention.

---

### `learning_worker_task` indexing (deferred from today)
The 4th verified-success kind. mcp-server is a separate process from
dashboard-api; needs an event bridge so worker task completions can flow
to the RAG indexer. Two options:
1. Meta-key signal — mcp-server writes `worker_assist_{stepId}` meta when
   it injects a result; dashboard-api's `step:completed` handler picks
   that up and indexes
2. Shared event bus over IPC

**Effort:** Small once a channel is chosen.

---

### Gemini skill-file sync
> Discovered 2026-05-21 during book-planning kickoff: antigrav (Gemini) workers
> were running on a stale `perry-worker.md` (dated May 19) because the
> `.gemini/commands/` dir is a separate copy from `.claude/commands/`. Every
> worker-instruction update silently misses the Gemini path.

Fix: at perry-worker container boot, either
1. **Symlink** `/home/node/.gemini/commands → /app/.claude/commands` so both
   CLIs read the single source of truth, OR
2. **rsync hook** that copies `.claude/commands/*.md` → `.gemini/commands/*.md`
   on container start (works even when the underlying mounts can't symlink
   across — e.g. some WSL2 setups).

Option 1 is cleaner if Gemini doesn't choke on symlinked dirs. Add a one-line
verify at boot (`diff /app/.claude/commands/perry-worker.md /home/node/.gemini/commands/perry-worker.md`)
that logs a warning if they ever drift.

**Effort:** Small (1 file in perry-worker Dockerfile entrypoint).

---

### Late-completing research_assist timeouts
> Discovered 2026-05-21 during book-planning kickoff: step-runner retried with
> "returned empty result" at ~25s intervals while the configured
> [timeoutMs default](perry/packages/projects/src/step-runner.ts#L3685) is
> 15 min. The fix that landed today addressed the **double-JSON-parse bug**
> that made worker results LOOK empty, but the retry cadence itself remains
> suspicious — engine should give workers more headroom before declaring
> them lost.

Trace: find every call site of `runResearchAssistTask` (or equivalent) and
audit which one passes a non-default `timeoutMs`. Likely a caller is passing
something like `30_000` thinking it's a worker poll interval, not a per-step
hard deadline.

Also: surface the per-task wait time + retry policy in the dashboard's
Workers panel so operators can tune without re-reading the source.

**Effort:** Small (audit + one config knob). Mainly investigation.

---

### Cover-kept signal
Today's `learning_cover_prompt` indexes any successful ComfyUI generation.
Better signal: only index prompts whose covers the user *kept* (didn't
regenerate). Needs a "kept" endpoint or dashboard button.

**Effort:** Small.

---

### Polish round
- Fix the leftover "rank" vs "score" wording inconsistencies
- Loading skeletons on Analytics cards
- Empty-state illustrations
- Keyboard shortcuts (vim-style nav within dashboard?)

**Effort:** Small, cumulative.

---

## 🔮 Aspirational

These are larger or longer-term — discussed but not blocking.

### DSPy prompt optimization
The P.E.R.R.Y. catalog has it. Conceptual match to Perry's "self-learning"
north star: a Python sidecar that A/B-tests prompt variants using the
verified-success RAG corpus as the reward signal. If it works, retires
the manual compression rounds we did today.

**Effort:** Large. Needs a Python sidecar service.

### Multimodal — voice + vision
Whisper STT, Piper TTS, native CLI image input. Per [[multimodal-plan]]:
slots in after Telegram gateway.

**Effort:** Large. New subsystems.

### Telegram + Discord gateways
Both have scaffolding via GatewayManager. Productionizing them unlocks
cron-delivery, mobile-driven writes, voice messages.

**Effort:** Medium each.

### Image-side CLIP embeddings
Cover-art similarity search ("find covers visually similar to top-selling
thrillers"). Different embedder; new RAG kind.

**Effort:** Medium.

### Container consolidation
[[container-consolidation-plan]] — Claude / Gemini CLI workers into
containerised pool with auth dirs mounted.

**Effort:** Mostly done via perry-worker today. Refinements remain.

### Hardware-aware setup wizard
[[hardware-aware-setup]] — First-run detects GPU/RAM, recommends models
and task params. Makes Perry idiot-proof for non-technical writers.

**Effort:** Medium.

### Model management API
[[model-management-api]] — Dashboard endpoints + UI to pull/remove Ollama
models + Hugging Face integration. Slots in after Secrets panel polish.

**Effort:** Medium.

### Dashboard sounds
[[dashboard-sounds]] — Sci-fi UI sound effects (toggleable, off by default).
Slots in with v2 polish.

**Effort:** Small.

### Sensory-phrase RAG kind
Was on the original 9-kind learning list. Needs a sentence-extractor +
vividness scorer — that's a real new pipeline component. Differs from
character bibles which got dropped because they need human-approval
signal that doesn't exist yet.

**Effort:** Medium. New text-analysis component.

### "AGENTS.md" / context-file system
P.E.R.R.Y.'s `.perry.md` / `AGENTS.md` / `CLAUDE.md` discovery pattern. Perry
has `CLAUDE.md` already. Could extend to per-pen / per-project context
files automatically discovered when a worker starts in a directory.

**Effort:** Small. Mostly a directory-walk + injection rule.

---

## 📎 Reference

- **Runtime topology** — Docker compose at [`compose.yaml`](compose.yaml).
  See [[perry-runtime-topology]] in memory.
- **Compose stability rules** — every service has mem + pids limits.
  [[perry-compose-stability]].
- **Subscription-only mode** — metered API providers blocked at type +
  runtime level. [[perry-subscription-only-mode]].
- **Backup conventions** — git backup branches + tar to `d:/n8n-backups/`
  before risky changes. [[backup-conventions]].
- **Nous-pattern source material** — reference Nous Research Hermes Agent
  docs at `https://hermes-agent.nousresearch.com/docs/`. Patterns we
  cribbed: Skills System, FTS5 sessions search, persistent memory,
  per-task auxiliary model picker, time-range analytics. Patterns we
  *don't* match: no chat-in-browser, no voice in dashboard.

---

## How to update this doc

- New idea? Add it to **Active backlog** with the *"why"* in the user's
  own words if possible (quoted), an effort estimate, and dependencies.
- Item shipped? Move to **Shipped**, prepend the date.
- Item dropped? Move to **Aspirational** with a `[archived YYYY-MM-DD]`
  note, or delete with a one-line git commit message.
- Keep the file under 400 lines. Promote frequently-referenced items
  to dedicated memory entries when they grow past one paragraph.
