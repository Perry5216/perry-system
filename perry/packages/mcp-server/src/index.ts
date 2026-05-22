import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ConfigService, EventBus, Logger, Vault } from '@perry/core';
import { AIRouter } from '@perry/ai';
import { MemoryStore, ContextEngine, RagService } from '@perry/rag';
import { ProjectEngine, StateStore, LibrarianService } from '@perry/projects';
import { join } from 'path';
import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'fs';
import { pathToFileURL } from 'url';

async function bootstrap() {
  process.env.IS_MCP_SERVER = 'true';

  // If running in stdio transport mode (default, when PERRY_MCP_HTTP_PORT is not set),
  // redirect console.log and console.warn to console.error to keep stdout clean.
  // This prevents any accidental logging (e.g. from context compression or Ollama stream debugs)
  // from corrupting the stdio JSON-RPC stream.
  const isStdio = !process.env.PERRY_MCP_HTTP_PORT || parseInt(process.env.PERRY_MCP_HTTP_PORT, 10) <= 0;
  if (isStdio) {
    console.log = (...args: any[]) => {
      console.error(...args);
    };
    console.warn = (...args: any[]) => {
      console.error(...args);
    };
  }

  const log = new Logger('mcp', 'error'); // Keep stdout clean for MCP protocol

  // 1. Initialize P.E.R.R.Y. Core Services
  const WORKSPACE = process.env.PERRY_WORKSPACE || join(process.cwd(), 'workspace');
  const CONFIG_DIR = process.env.PERRY_CONFIG || join(process.cwd(), 'config');

  interface CustomTool {
    meta: {
      name: string;
      description: string;
      inputSchema: any;
    };
    run: (args: any, context: any) => Promise<{ content: Array<{ type: string; text: string }> }>;
    path: string;
  }
  const customTools = new Map<string, CustomTool>();
  const CUSTOM_TOOLS_DIR = join(WORKSPACE, 'custom-tools');
  mkdirSync(CUSTOM_TOOLS_DIR, { recursive: true });

  async function loadCustomTools() {
    customTools.clear();
    try {
      const files = readdirSync(CUSTOM_TOOLS_DIR).filter(f => (f.endsWith('.js') || f.endsWith('.cjs')) && !f.startsWith('_'));
      for (const file of files) {
        const fullPath = join(CUSTOM_TOOLS_DIR, file);
        try {
          const url = pathToFileURL(fullPath).href + `?t=${Date.now()}`;
          const mod = await import(url);
          const target = mod.default || mod;
          if (target.meta && typeof target.run === 'function') {
            const name = target.meta.name;
            if (!/^[a-z][a-z0-9-_]{1,40}$/.test(name)) {
              log.error(`[custom-tools] Invalid custom tool name: ${name}`);
              continue;
            }
            customTools.set(name, {
              meta: target.meta,
              run: target.run,
              path: fullPath,
            });
            log.error(`[custom-tools] Loaded custom tool: ${name}`);
          } else {
            log.error(`[custom-tools] Custom tool file ${file} must export 'meta' and 'run' function.`);
          }
        } catch (err: any) {
          log.error(`[custom-tools] Failed to load custom tool ${file}: ${err.message}`);
        }
      }
    } catch (err: any) {
      log.error(`[custom-tools] Error reading custom tools directory: ${err.message}`);
    }
  }

  await loadCustomTools();

  const config = new ConfigService(CONFIG_DIR);
  config.load();

  const vault = new Vault(join(CONFIG_DIR, '.vault'));
  vault.load();

  const eventBus = new EventBus();

  // State store must be ready before AI Router so the writer model can be
  // resolved from pen_name_records (Phase 0 pen-aware writer swap).
  const stateStore = new StateStore(WORKSPACE, log.child('state'));
  await stateStore.initialize();

  const aiRouter = new AIRouter(config, vault, log.child('ai'));
  await aiRouter.initialize();

  const memoryStore = new MemoryStore(WORKSPACE, log.child('memory'));
  await memoryStore.initialize();

  const contextEngine = new ContextEngine(WORKSPACE, memoryStore, log.child('context'));
  const ragService = new RagService(memoryStore, aiRouter.embeddings, log.child('rag'));

  const projectEngine = new ProjectEngine(
    stateStore,
    aiRouter,
    contextEngine,
    eventBus,
    log.child('engine'),
    { 
      workspaceDir: WORKSPACE,
      maxRetries: 3,
      minResponseLength: 50,
      config: config 
    }
  );

  // ── Tool-surface profiles ────────────────────────────────────────────
  // Workers calling /perry-worker only need a small subset of MCP tools.
  // Returning the FULL tool list (~24 tools) for every session burns 5-8k
  // tokens of context describing tools the worker won't use. A profile
  // header (X-Perry-MCP-Profile) on session-init lets the worker request
  // a leaner surface. Falls back to 'full' when absent / unknown.
  const TOOL_PROFILES: Record<string, Set<string>> = {
    drainer: new Set([
      'claim_task', 'report_task', 'queue_depth', 'list_tasks',
      'get_anti_patterns', 'get_recent_mined_pairs', 'get_rejected_pairs',
      'inject_pair', 'fetch_url',
      'embed_text', 'rag_search', 'session_search', 'session_view', 'compress_context',
      'propose_skill',
      'index_scout_finding', 'check_scout_coverage', 'mark_scout_finding_used',
    ]),
    researcher: new Set([
      'fetch_url', 'rag_search', 'rag_search_global',
      'compress_context', 'embed_text', 'embed_similarity',
      'claim_task', 'report_task',
      'index_scout_finding', 'check_scout_coverage', 'mark_scout_finding_used',
    ]),
    audit: new Set([
      'rag_drift_score', 'rag_search', 'rag_find_by_entity',
      'embed_text', 'compress_context',
      'claim_task', 'report_task',
    ]),
    // 'full' is implicit — when profile is unrecognized, return everything.
  };

  // ── Compact tool-listing mode ────────────────────────────────────────
  // When a session opens with X-Perry-MCP-Compact=true, tools/list returns
  // each tool with a 1-line description and a STUB inputSchema. Workers
  // then call mcp__perry__get_tool_schema to fetch the full schema only
  // for tools they actually want to use. Same shape as the Atlassian MCP
  // compressor's "small surface first, full schema on selection" pattern,
  // implemented natively so no sidecar is needed. Saves ~11k tokens of
  // tool-description overhead per worker session.
  const COMPACT_DESCRIPTIONS: Record<string, string> = {
    // 1-line ultra-summaries — workers use these to decide which tool to fetch full schemas for.
    list_projects:           'List all active Perry projects.',
    get_project_context:     'Get worldbuilding/characters/state of a project; optionally compressed.',
    execute_pipeline_step:   'Trigger execution of a project step.',
    get_character_profile:   'Look up one character profile by name.',
    get_chapter_summary:     'Get a chapter\'s summary.',
    list_pens:               'List configured pen-name slots + their LoRA versions.',
    get_recent_mined_pairs:  'Recent good/bad training pair examples; optional scene_type filter.',
    get_rejected_pairs:      'Recently leak-filter-rejected pairs (so you don\'t reproduce them).',
    inject_pair:             'Append a good/bad pair into the training corpus.',
    trigger_export:          'Trigger export build for a project.',
    get_anti_patterns:       'Current banned-phrase regex bank.',
    claim_task:              'Claim the next task from the worker queue.',
    report_task:             'Report a task as done/failed with result.',
    enqueue_tasks:           'Enqueue new tasks into the worker pool.',
    list_tasks:              'Inspect tasks by status/type.',
    queue_depth:             'Count of open tasks.',
    fetch_url:               'HTTP GET a URL via the network gateway; optional HTML strip.',
    start_calibration:       'Cold-start a balanced calibration batch for a pen.',
    set_anti_patterns:       'Replace a pen\'s anti-pattern list.',
    rag_search:              'Semantic search over a project\'s indexed bibles/chapters/anchors.',
    rag_search_global:       'Cross-project semantic search.',
    session_search:          'Exact-keyword (FTS5) search over completed step outputs; returns excerpts.',
    session_view:            'Fetch full content of one indexed step by step_id (companion to session_search).',
    propose_skill:           'Propose a new skill (procedural memory) after a verified-successful complex task. Lands in skills-pending/{service}/ for human review.',
    index_scout_finding:     'Index a scouted source as scout_finding with structured metadata (subgenre, source, tone). Feeds the dedup substrate.',
    check_scout_coverage:    'Pre-crawl check: count scout findings matching filters + saturation verdict. Skip queries that would only duplicate.',
    mark_scout_finding_used: 'Flip a scout finding to verified_scout_finding after the bible/chapter that cited it succeeded.',
    rag_find_by_entity:      'Find all chunks mentioning an entity name.',
    rag_drift_score:         'How on-voice is a passage vs the pen\'s anchor centroid?',
    embed_text:              'Compute embedding vector for a passage.',
    embed_similarity:        'Embed text and rank candidates by cosine similarity.',
    compress_context:        'Summarize a passage to target tokens via local Librarian.',
    get_tool_schema:         'Fetch the full inputSchema for a named tool (companion to compact mode).',
    reload_custom_tools:     'Reload custom synthesized tools from the workspace directory.',
    librarian_pin_skill:       'Pin a skill to protect it from curation or deletion.',
    librarian_unpin_skill:     'Unpin a skill to allow automated curation.',
    librarian_run_pass:        'Run automated skills curation maintenance pass.',
    librarian_list_backups:    'List backup snapshots of skills.',
    librarian_rollback:        'Rollback skills to a backup snapshot.',
    librarian_status:          'Get curation/pin status of skills.',
    librarian_list_proposals:  'List all pending and historical librarian proposals.',
    librarian_approve_proposal: 'Approve a librarian proposal to execute its archive/merge action.',
    librarian_reject_proposal: 'Reject a librarian proposal.',
    librarian_merge_skills:    'Directly merge two overlapping skills into a single synthesized skill.',
    librarian_get_telemetry:   'Retrieve skill execution telemetry history and aggregated statistics.',
  };
  const COMPACT_STUB_SCHEMA = { type: 'object', additionalProperties: true };

  // 2. Initialize MCP Server (factory — HTTP mode needs a fresh Server per
  //    session because MCP servers can only `initialize` once. Shared
  //    services (stateStore, projectEngine, aiRouter, …) come from the
  //    enclosing scope and are reused across sessions.)
  function buildServer(profile?: string, compact?: boolean): Server {
    const allowedTools = profile && TOOL_PROFILES[profile] ? TOOL_PROFILES[profile] : null;
    const compactMode = !!compact;
    // Per-session full tool list — populated on each tools/list call so
    // get_tool_schema can return the original schema without rebuilding.
    let serverFullToolList: any[] = [];
  const server = new Server(
    {
      name: 'perry-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
    }
  );

  // 3. Define Tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const fullList: any[] = [
        {
          name: 'list_projects',
          description: 'List all active P.E.R.R.Y. projects',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_project_context',
          description: 'Get the worldbuilding, characters, and narrative state of a project. Automatically utilizes the Librarian GPU to compress the context if compress=true, saving tens of thousands of tokens.',
          inputSchema: {
            type: 'object',
            properties: {
              projectId: {
                type: 'string',
                description: 'The ID of the project (e.g., project-4)',
              },
              compress: {
                type: 'boolean',
                description: 'If true, routes the payload through the local 5070 Ti Librarian GPU for deep summarization before returning. Set to false ONLY if you need the raw, uncompressed 50k+ word text.',
              },
            },
            required: ['projectId'],
          },
        },
        {
          name: 'execute_pipeline_step',
          description: 'Trigger the local P.E.R.R.Y. system to execute the next step in the project pipeline (e.g., drafting the next chapter).',
          inputSchema: {
            type: 'object',
            properties: {
              projectId: {
                type: 'string',
              },
            },
            required: ['projectId'],
          },
        },
        {
          name: 'get_character_profile',
          description: 'Get the exact profile, current state, and recent changes for a specific character from the RAG database.',
          inputSchema: {
            type: 'object',
            properties: {
              projectId: { type: 'string' },
              characterName: { type: 'string' },
            },
            required: ['projectId', 'characterName'],
          },
        },
        {
          name: 'get_chapter_summary',
          description: 'Get the detailed summary and ending state of a specific chapter.',
          inputSchema: {
            type: 'object',
            properties: {
              projectId: { type: 'string' },
              chapterNumber: { type: 'number' },
            },
            required: ['projectId', 'chapterNumber'],
          },
        },
        // ── Pair-collection tools (Phase D, MCP-driven contribution) ───────
        {
          name: 'list_pens',
          description: 'List all pen-names with their LoRA versions, active version, and pen-specific anti-patterns. Use this first to see what pens are available for pair collection.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'get_recent_mined_pairs',
          description: 'Read the most recent raw mined BAD/GOOD pairs from a pen\'s calibration pool (mined_pairs.jsonl). These are pre-gate candidates — they may include patterns that the model is still producing. Use to assess what failure modes are dominant.',
          inputSchema: {
            type: 'object',
            properties: {
              slug: { type: 'string', description: 'Pen slug (e.g. "a-perry")' },
              limit: { type: 'number', description: 'Number of most-recent records to return (default 20, max 200)' },
            },
            required: ['slug'],
          },
        },
        {
          name: 'get_rejected_pairs',
          description: 'Read the most recent gate rejection log entries for a pen (rejected_pairs.log). Each line is the reason a candidate pair was rejected by fastQualityScan / librarian / writer. Use to see which anti-patterns are firing.',
          inputSchema: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              limit: { type: 'number', description: 'Number of most-recent lines (default 40, max 500)' },
            },
            required: ['slug'],
          },
        },
        {
          name: 'inject_pair',
          description: 'Append a curated BAD→GOOD training pair to the pen\'s claude_injected.jsonl. The pair bypasses the three-gate pipeline and is included in the next training_data.jsonl export as a trusted baseline record. Use this to contribute synthetic pairs targeting specific failure modes you see in mined output.',
          inputSchema: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              bad: { type: 'string', description: 'The "BAD" sentence to rewrite (a clichéd / filter-word / told-emotion variant)' },
              good: { type: 'string', description: 'The "GOOD" rewrite in the pen\'s target voice (no filter words, no told emotion, no clichés)' },
              category: { type: 'string', description: 'Optional category tag (e.g. "filter_word", "told_emotion", "ai_ism"). Defaults to "claude_injected".' },
            },
            required: ['slug', 'bad', 'good'],
          },
        },
        {
          name: 'trigger_export',
          description: 'Regenerate training_data.jsonl for a pen. Includes universal baseline + pen-specific baseline + Claude-injected pairs + verified mined pairs. Call after injecting a batch of pairs so they go live.',
          inputSchema: {
            type: 'object',
            properties: { slug: { type: 'string' } },
            required: ['slug'],
          },
        },
        {
          name: 'get_anti_patterns',
          description: 'Return the pen-specific anti-patterns list (the canon-specific phrases blocked at calibration time, on top of the universal list). Use to see what is already covered before adding new patterns.',
          inputSchema: {
            type: 'object',
            properties: { slug: { type: 'string' } },
            required: ['slug'],
          },
        },
        {
          name: 'claim_task',
          description: 'Atomically claim the oldest open task from the parallel-worker pool. Returns the task or {empty: true} if the queue has no open work matching the filter. Workers should loop: claim → do the work → report_task.',
          inputSchema: {
            type: 'object',
            properties: {
              worker_id: { type: 'string', description: 'Stable identifier for this worker chat (e.g. "claude-chat-2"). Used to track which worker holds which task.' },
              type: { type: 'string', description: 'Optional task type filter (e.g. "degrade_pair"). If omitted, claims any open task.' },
              slug: { type: 'string', description: 'Optional pen-slug filter.' },
            },
            required: ['worker_id'],
          },
        },
        {
          name: 'report_task',
          description: 'Report the result of a claimed task. Sets status to "done" or "failed" and stores the result/error payload. Must be called after every claim_task.',
          inputSchema: {
            type: 'object',
            properties: {
              task_id: { type: 'string' },
              status: { type: 'string', enum: ['done', 'failed'] },
              result: { type: 'object', description: 'Result payload for status=done. Schema depends on task type.' },
              error: { type: 'string', description: 'Error message for status=failed.' },
            },
            required: ['task_id', 'status'],
          },
        },
        {
          name: 'enqueue_tasks',
          description: 'Coordinator-only: push N tasks onto the worker pool. Returns the array of new task IDs. Use this to fan out work that the coordinator chat would otherwise do serially.',
          inputSchema: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Task type identifier (e.g. "degrade_pair"). Workers filter on this.' },
              payloads: {
                type: 'array',
                items: { type: 'object' },
                description: 'One element per task. Opaque JSON.',
              },
              slug: { type: 'string', description: 'Optional pen-slug to attach to each task.' },
            },
            required: ['type', 'payloads'],
          },
        },
        {
          name: 'list_tasks',
          description: 'Coordinator visibility into the task pool. Optionally filter by status or type.',
          inputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['open', 'claimed', 'done', 'failed'] },
              type: { type: 'string' },
              limit: { type: 'number', description: 'Max rows (default 50, max 500).' },
            },
          },
        },
        {
          name: 'queue_depth',
          description: 'Counts of tasks by status (open/claimed/done/failed). Optionally scoped to one task type.',
          inputSchema: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Restrict to one task type.' },
            },
          },
        },
        {
          name: 'fetch_url',
          description: 'Fetch a URL through one of Perry\'s configured network paths (direct, gluetun-uk, gluetun-us, gluetun-de, browser). Use this when you want live data from the web — e.g. extracting current comp-title rankings, checking a publisher\'s site, pulling RSS. Returns response body (truncated to 100KB), status, content-type, and which exit was used.',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
              networkPath: { type: 'string', enum: ['direct', 'gluetun-uk', 'gluetun-us', 'gluetun-de', 'browser'], description: 'Routing path. Defaults to "direct".' },
              method: { type: 'string', description: 'HTTP method. Default GET.' },
              timeoutMs: { type: 'number', description: 'Request timeout ms. Default 30000.' },
              stripHtml: { type: 'boolean', description: 'If true, strip HTML tags before returning the body. Default false.' },
            },
            required: ['url'],
          },
        },
        {
          name: 'start_calibration',
          description: 'Cold-start a pen-name training pool. Enqueues a balanced batch of `synthesize_pair` tasks across the full (scene_type × stat_band × anti_pattern_focus) cartesian — defaults to ~600 pairs. Drains via the existing worker pool (headless-worker.cjs or /perry-worker sessions). Use this when a NEW pen-name is created and the pool is empty.',
          inputSchema: {
            type: 'object',
            properties: {
              slug: { type: 'string', description: 'Pen-name slug to bootstrap.' },
              targetPairs: { type: 'number', description: 'Rough pair count (default 600). Actual count rounds up to the next cartesian-balanced multiple.' },
            },
            required: ['slug'],
          },
        },
        {
          name: 'set_anti_patterns',
          description: 'Replace the pen-specific anti-pattern list. Use after observing recurring failures in mined / rejected output, to add new canon-specific patterns to the calibration template for future passes.',
          inputSchema: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              patterns: {
                type: 'array',
                items: { type: 'string' },
                description: 'Complete replacement list of pen-specific anti-patterns (each item is a rule string)',
              },
            },
            required: ['slug', 'patterns'],
          },
        },
        {
          name: 'rag_search',
          description: 'Semantic search over a project\'s indexed bibles, outlines, chapters, and voice anchors. Returns top-K chunks ranked by cosine similarity. Use when a worker needs "what does the setting bible say about X" or "have I described this character\'s scar before" — pulls only the relevant passages instead of forcing the worker to scan everything.',
          inputSchema: {
            type: 'object',
            properties: {
              project_id: { type: 'string', description: 'Project to search within.' },
              query: { type: 'string', description: 'Natural-language question or topic.' },
              kinds: { type: 'array', items: { type: 'string' }, description: 'Restrict to specific kinds (e.g., ["bible_character","bible_setting"]). Omit for all kinds.' },
              top_k: { type: 'number', description: 'Max hits to return. Default 8, max 50.' },
              min_score: { type: 'number', description: 'Drop hits below this cosine score (0–1). Default 0.' },
              tier: { type: 'string', enum: ['library', 'session', 'feedback'], description: 'Memory tier to restrict search. Omit for all tiers.' },
            },
            required: ['project_id', 'query'],
          },
        },
        {
          name: 'rag_search_global',
          description: 'Cross-project semantic search. Useful for "what have I written about this character/place across ALL my projects". Returns hits with projectId included.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              kinds: { type: 'array', items: { type: 'string' } },
              top_k: { type: 'number' },
              min_score: { type: 'number' },
              tier: { type: 'string', enum: ['library', 'session', 'feedback'], description: 'Memory tier to restrict search. Omit for all tiers.' },
            },
            required: ['query'],
          },
        },
        {
          name: 'session_search',
          description: 'Keyword (FTS5) search over completed step outputs. Complements rag_search — use for EXACT-PHRASE recall ("did I ever use the word \'Erebus\'", "find the chapter that mentioned the gluetun proxy bug") where semantic embeddings would miss. Returns ranked excerpts with hit highlighting. Fetch full content via session_view.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'FTS5 MATCH expression. Supports quoted phrases, NEAR(), AND/OR.' },
              project_id: { type: 'string', description: 'Optional — scope to a single project.' },
              limit: { type: 'number', description: 'Max excerpts to return (default 10, max 50).' },
            },
            required: ['query'],
          },
        },
        {
          name: 'session_view',
          description: 'Fetch the full content of one step by step_id. Used after session_search to pull a specific result for deeper inspection. Returns { found, stepId, projectId, content } or { found: false } if the step has no indexed content.',
          inputSchema: {
            type: 'object',
            properties: {
              step_id: { type: 'string' },
            },
            required: ['step_id'],
          },
        },
        {
          name: 'propose_skill',
          description: 'Submit a candidate skill (procedural memory) for human review. Use ONLY after finishing a verified-successful complex task — when you\'ve discovered a non-trivial workflow that other workers (or services) would benefit from. Lands in workspace/skills-pending/{service}/ for human approval. Set service="scout" for source-discovery patterns, "audit" for voice-leak recipes, "director" for orchestration patterns, etc. Default service="worker" (general agent workflows). Mirrors the agent-authored skills pattern with a verification gate.',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Skill slug: lowercase-kebab-case, 3-40 chars. Becomes /name when promoted (for service=worker).' },
              description: { type: 'string', description: 'One-line summary, 10-200 chars. Surfaces in the skill catalog.' },
              body: { type: 'string', description: 'Markdown procedure: when to use, steps, pitfalls, verification. Min 100 chars.' },
              service: { type: 'string', description: 'Which subsystem this skill is for. Default "worker" (LLM agents). Other values: "scout", "audit", "director", "trainer", "gc", "prompt-builder". Determines storage subdir and which consumer loads it.' },
              applies_when: {
                type: 'object',
                description: 'Optional structured trigger conditions consumed by non-LLM services (e.g. {subgenre:"cyberpunk", source:"reddit"}). Free-form key/value; serialised into frontmatter.',
                additionalProperties: true,
              },
              evidence: {
                type: 'object',
                description: 'Optional — task_ids, success signals, audit scores supporting the proposal.',
                additionalProperties: true,
              },
            },
            required: ['name', 'description', 'body'],
          },
        },
        {
          name: 'index_scout_finding',
          description: 'Index a scouted source (Reddit thread, blog post, comp title, market trend snippet) into RAG as a `scout_finding` chunk with structured metadata. Call this for EVERY non-trivial source you pull during a research_assist task — the corpus becomes the dedup substrate for future scout runs (see check_scout_coverage). Cheap and idempotent on source_ref; safe to call from inside a worker loop.',
          inputSchema: {
            type: 'object',
            properties: {
              source_ref: { type: 'string', description: 'Stable identifier for the source (e.g. "reddit:r/printSF:thread-1gom7rk", "blog:author-z:post-42"). Idempotency key.' },
              text: { type: 'string', description: 'The captured text — thread body, blog excerpt, etc. Min 200 chars for it to be worth indexing.' },
              source: { type: 'string', description: 'Source platform: "reddit", "blog", "amazon", "x", "rss", etc.' },
              subgenre: { type: 'string', description: 'Subgenre tag for the finding — drives coverage slicing. E.g. "cyberpunk", "epic-fantasy", "cozy-mystery".' },
              tone: { type: 'string', description: 'Optional tone descriptor: "literary-thriller", "snarky", "earnest", etc.' },
              query: { type: 'string', description: 'The query that produced this finding — feeds back into propose_skill if the query proves low/high-yield.' },
              pen_slug: { type: 'string', description: 'Optional pen-name slug to scope the finding (defaults to global pool).' },
            },
            required: ['source_ref', 'text', 'source', 'subgenre'],
          },
        },
        {
          name: 'check_scout_coverage',
          description: 'Before launching a new scout query, ask: "have we already saturated this slice?" Returns counts of scout_finding chunks matching the given filters plus a saturation verdict (default threshold: 20 per slice). Use to skip queries that would only return duplicates and to redirect the worker to under-covered subgenres/sources. Honour the verdict — if `saturated:true`, propose a SKILL about why this slice is exhausted, then look elsewhere.',
          inputSchema: {
            type: 'object',
            properties: {
              subgenre: { type: 'string', description: 'Subgenre to check coverage for.' },
              source: { type: 'string', description: 'Optional source filter — narrow to e.g. only reddit.' },
              tone: { type: 'string', description: 'Optional tone filter.' },
              threshold: { type: 'number', description: 'Saturation threshold (default 20). Slices at or above this count are flagged saturated.' },
            },
            required: ['subgenre'],
          },
        },
        {
          name: 'mark_scout_finding_used',
          description: 'After a bible/chapter/outline step succeeds AND you cited a previously-indexed scout finding in its output, call this to flip the finding into the verified-success corpus. Indexes a parallel chunk under `verified_scout_finding` so future coverage checks weight verified findings higher (they\'re proof of actual signal, not just data). The source_ref must match an existing scout_finding chunk.',
          inputSchema: {
            type: 'object',
            properties: {
              source_ref: { type: 'string', description: 'The source_ref previously passed to index_scout_finding.' },
              used_in: { type: 'string', description: 'What used it — e.g. "project-160/step-9", "chapter-3".' },
              verified_reason: { type: 'string', description: 'Why this finding was useful — one short sentence. Becomes searchable metadata.' },
            },
            required: ['source_ref', 'used_in'],
          },
        },
        {
          name: 'rag_find_by_entity',
          description: 'Find every chunk in a project that mentions a specific entity (character, location, faction, etc.) — based on entity tags assigned at index time. Returns grouped by source with mention counts. Use for "show me every chapter that mentions Kaelen" or "which bible sections describe the Lisbon Packet".',
          inputSchema: {
            type: 'object',
            properties: {
              project_id: { type: 'string' },
              entity: { type: 'string', description: 'Entity name (case-insensitive substring match against tagged entities).' },
              kinds: { type: 'array', items: { type: 'string' }, description: 'Restrict to specific kinds. Omit for all.' },
              top_per_source: { type: 'number', description: 'Max chunks per source. Default 3.' },
            },
            required: ['project_id', 'entity'],
          },
        },
        {
          name: 'rag_drift_score',
          description: 'Compute how on-voice a passage is, by cosine-comparing its embedding to the centroid of a pen\'s voice anchors. Higher = more on-voice (>0.85 strong, 0.70–0.85 neutral, <0.70 drifting).',
          inputSchema: {
            type: 'object',
            properties: {
              project_id: { type: 'string' },
              text: { type: 'string', description: 'Passage to score.' },
              centroid_kind: { type: 'string', description: 'Centroid source kind. Default: "voice_anchor".' },
              centroid_project_id: { type: 'string', description: 'Optional override; defaults to project_id. Use "pen:{slug}" to score against the pen-wide centroid.' },
            },
            required: ['project_id', 'text'],
          },
        },
        {
          name: 'embed_text',
          description: 'Compute a semantic embedding vector for a passage. Backed by nomic-embed-text on the local 5070 Ti (~100ms per query, results cached). Returns a 768-dim vector. Use for similarity / dedup / retrieval — NOT for compression (use compress_context for that).',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Passage to embed (non-empty).' },
            },
            required: ['text'],
          },
        },
        {
          name: 'embed_similarity',
          description: 'Embed a target passage and rank candidates by cosine similarity. Returns [{id, score}] sorted descending. Useful for "find the voice anchor closest to this paragraph" or "which character profile matches this snippet best".',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The target passage.' },
              candidates: {
                type: 'array',
                items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] },
                description: 'List of candidates to compare against.',
              },
              top_k: { type: 'number', description: 'Return only the top K results (default: all).' },
            },
            required: ['text', 'candidates'],
          },
        },
        {
          name: 'compress_context',
          description: 'Summarize a passage to a target token budget. Workers can call this to compress their own context before feeding it to the LLM, or to pre-digest a long passage. Backed by the local Librarian (5070 Ti, qwen3:14b) — fast and free; results are cached by content hash + level so identical inputs return instantly.',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'The raw text to compress.',
              },
              task: {
                type: 'string',
                description: 'Optional: what the compressed output will be used for (e.g., "Write Chapter 7" or "Continuity check"). Steers the compressor toward keeping facts relevant to the task. Defaults to a generic briefing.',
              },
              level: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'max'],
                description: 'Compression aggressiveness. low ≈ 50% of input, medium ≈ 25%, high ≈ 12%, max ≈ 6%. Default: medium.',
              },
              target_tokens: {
                type: 'number',
                description: 'Optional explicit output budget in tokens. Overrides level. Floor: 128.',
              },
              mode: {
                type: 'string',
                enum: ['context_briefing', 'chapter_summary', 'entity_extraction', 'continuity_check', 'style_analysis'],
                description: 'Compression style preset. Default: context_briefing.',
              },
            },
            required: ['text'],
          },
        },
        {
          name: 'get_tool_schema',
          description: 'Fetch the full inputSchema for a tool by name. Use this AFTER tools/list (which may have returned compact stubs) to get the parameters for a tool you intend to invoke. Argument: { name }.',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'The tool name (e.g., "rag_search").' },
            },
            required: ['name'],
          },
        },
        {
          name: 'reload_custom_tools',
          description: 'Scan and reload custom tools from the custom-tools/ workspace directory.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'librarian_pin_skill',
          description: 'Pin a skill to protect it from automated curation and deletion.',
          inputSchema: {
            type: 'object',
            properties: {
              service: { type: 'string', description: 'The service tag of the skill (e.g. worker, scout, audit)' },
              name: { type: 'string', description: 'The name of the skill' },
            },
            required: ['service', 'name'],
          },
        },
        {
          name: 'librarian_unpin_skill',
          description: 'Unpin a skill to allow automated curation and deletion.',
          inputSchema: {
            type: 'object',
            properties: {
              service: { type: 'string', description: 'The service tag of the skill (e.g. worker, scout, audit)' },
              name: { type: 'string', description: 'The name of the skill' },
            },
            required: ['service', 'name'],
          },
        },
        {
          name: 'librarian_run_pass',
          description: 'Run the automated librarian pass on installed skills.',
          inputSchema: {
            type: 'object',
            properties: {
              dryRun: { type: 'boolean', description: 'If true, does not write changes. Defaults to true.' },
              runLlmReview: { type: 'boolean', description: 'If true, performs LLM overlap/redundancy review. Defaults to false.' },
            },
          },
        },
        {
          name: 'librarian_list_backups',
          description: 'List all skills backup snapshots.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'librarian_rollback',
          description: 'Rollback skills to a specific backup snapshot timestamp.',
          inputSchema: {
            type: 'object',
            properties: {
              timestamp: { type: 'string', description: 'The backup snapshot timestamp' },
            },
            required: ['timestamp'],
          },
        },
        {
          name: 'librarian_status',
          description: 'Get curation/pin status of installed and pending skills.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'librarian_list_proposals',
          description: 'List all pending and historical librarian proposals.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'librarian_approve_proposal',
          description: 'Approve a librarian proposal to execute its archive/merge action.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'The unique ID of the proposal to approve' },
            },
            required: ['id'],
          },
        },
        {
          name: 'librarian_reject_proposal',
          description: 'Reject a librarian proposal.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'The unique ID of the proposal to reject' },
            },
            required: ['id'],
          },
        },
        {
          name: 'librarian_merge_skills',
          description: 'Directly merge two overlapping skills into a single synthesized skill.',
          inputSchema: {
            type: 'object',
            properties: {
              service: { type: 'string', description: 'The service tag (e.g. scout, worker)' },
              skillA: { type: 'string', description: 'The name of the first skill' },
              skillB: { type: 'string', description: 'The name of the second skill' },
              newSkillName: { type: 'string', description: 'The name of the new synthesized skill' },
            },
            required: ['service', 'skillA', 'skillB', 'newSkillName'],
          },
        },
        {
          name: 'librarian_get_telemetry',
          description: 'Retrieve skill execution telemetry history and aggregated statistics.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Maximum number of history records to return' },
            },
          },
        },
    ];

    // Append custom tools dynamically to the available tools list
    for (const [name, tool] of customTools.entries()) {
      fullList.push({
        name: name,
        description: tool.meta.description,
        inputSchema: tool.meta.inputSchema,
      });
    }

    // Stash full list on the server instance so get_tool_schema can look up
    // schemas at runtime without rebuilding the array. The fullList is
    // built fresh each tools/list call, but the captured `serverFullToolList`
    // closure stays consistent for this session.
    serverFullToolList = fullList;
    let tools = allowedTools ? fullList.filter(t => allowedTools.has(t.name)) : fullList;
    // Compact mode: strip inputSchemas to a stub + replace descriptions with
    // 1-liners so the worker can scan the surface cheaply, then call
    // get_tool_schema to fetch the full schema only for tools it actually
    // intends to use. Keeps get_tool_schema itself FULL so workers know how
    // to call it.
    //
    // Description trimming is ALWAYS applied — full descriptions exist for
    // human dev reference and are surfaced via get_tool_schema, but the
    // model only needs them to pick a tool, and the 1-liner is enough for
    // that. Saves ~3 KB per tools/list call (~28 tools × ~100 char delta
    // when verbose descriptions get truncated). InputSchema stripping is
    // still gated on compactMode because non-compact clients (dashboard,
    // dev CLI) need the full schema in the listing.
    tools = tools.map(t => {
      if (t.name === 'get_tool_schema') return t;
      const trimmedDescription = COMPACT_DESCRIPTIONS[t.name] || t.description.split('.')[0] + '.';
      if (compactMode) {
        return { ...t, description: trimmedDescription, inputSchema: COMPACT_STUB_SCHEMA };
      }
      return { ...t, description: trimmedDescription };
    });
    return { tools };
  });

  // 4. Handle Prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const templates = projectEngine.promptTemplateService.listTemplates();
    return {
      prompts: templates.map(t => ({
        name: t.id,
        description: `Editable pipeline prompt template: ${t.id}`,
        arguments: []
      }))
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const template = projectEngine.promptTemplateService.getTemplate(request.params.name);
    if (!template) {
      throw new McpError(ErrorCode.InvalidParams, `Prompt template ${request.params.name} not found`);
    }
    return {
      description: `Template: ${request.params.name}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: template
          }
        }
      ]
    };
  });

  // 5. Handle Resources
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: 'style-dna://{projectId}',
          name: 'Project Style DNA',
          description: 'The compiled Style DNA seed for a specific project, dictating prose constraints, forbidden names, and tone.',
          mimeType: 'text/markdown',
        }
      ]
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const projects = projectEngine.listProjects('active');
    return {
      resources: projects.map(p => ({
        uri: `style-dna://${p.id}`,
        name: `Style DNA for ${p.title}`,
        description: `Compiled prose constraints and voice profile for ${p.id}`,
        mimeType: 'text/markdown',
      }))
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const match = uri.match(/^style-dna:\/\/(project-\d+)$/);
    if (!match) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid resource URI: ${uri}`);
    }
    const projectId = match[1];
    
    // No custom style DNA generated for this project on main branch
    const dnaSeed = '';
    
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: dnaSeed || 'No custom style DNA generated for this project yet.'
        }
      ]
    };
  });

  // 6. Handle Tool Calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case 'list_projects': {
        const projects = projectEngine.listProjects('active');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(projects.map(p => ({ id: p.id, title: p.title, status: p.status }))),
            },
          ],
        };
      }

      case 'get_project_context': {
        const { projectId, compress = true } = request.params.arguments as any;
        const project = projectEngine.getProject(projectId);
        
        if (!project) {
          throw new McpError(ErrorCode.InvalidParams, `Project ${projectId} not found`);
        }

        // Fetch the raw context. Mirrors librarian-agent.ts:56 — synopsis comes
        // from project.description and worldbuilding from project.context.planning.
        // Character data lives in the entity index, not on the project itself,
        // so it's left to the Librarian compression step below to enrich.
        let payload = `Project: ${project.title}\n\nSYNOPSIS:\n${project.description ?? 'Not defined'}\n\n`;
        payload += `WORLDBUILDING:\n${project.context.planning ?? 'Not defined'}\n\n`;
        
        // Add the last 2 compiled segments for prose reference
        const recentSegments = project.steps
          .filter(s => s.status === 'completed' && s.result)
          .slice(-2);
        
        if (recentSegments.length > 0) {
          payload += `LATEST COMPILED MANUSCRIPT:\n`;
          recentSegments.forEach(s => {
            payload += `[Segment ${s.id}]\n${s.result}\n\n`;
          });
        }

        // --- NATIVE GPU COMPRESSION ---
        if (compress) {
          try {
            const result = await aiRouter.compressor.compress({
              rawContext: payload,
              taskDescription: `MCP get_project_context for project ${projectId}`,
              targetTokens: 2048,
              mode: 'context_briefing',
            });
            const compressed = result.compressed;
            payload = `[COMPRESSED BY LIBRARIAN GPU]\n\n${compressed}`;
          } catch (e: any) {
             // Fallback if Librarian is offline
             payload = `[WARNING: LIBRARIAN GPU COMPRESSION FAILED. SENDING RAW PAYLOAD.]\n\n${payload.substring(0, 50000)}`;
          }
        }

        return {
          content: [{ type: 'text', text: payload }],
        };
      }

      case 'execute_pipeline_step': {
        const { projectId } = request.params.arguments as any;
        const project = projectEngine.getProject(projectId);
        
        if (!project) {
          throw new McpError(ErrorCode.InvalidParams, `Project ${projectId} not found`);
        }

        // Fire and forget, execution happens in background
        projectEngine.executeNextStep(projectId).catch(() => {});
        
        return {
          content: [{ type: 'text', text: `Execution triggered for ${projectId}. The local GPUs are now spinning up.` }],
        };
      }

      case 'get_character_profile': {
        const { projectId, characterName } = request.params.arguments as any;
        const characters = contextEngine.getCharacters(projectId);
        const char = characters.find(c => 
          c.name.toLowerCase() === characterName.toLowerCase() || 
          c.aliases.some(a => a.toLowerCase() === characterName.toLowerCase())
        );

        if (!char) {
          return { content: [{ type: 'text', text: `Character '${characterName}' not found in the RAG database.` }] };
        }

        let profile = `**Name:** ${char.name}\n**Description:** ${char.description}\n`;
        if (Object.keys(char.attributes).length > 0) {
          profile += `**Attributes:** ${JSON.stringify(char.attributes)}\n`;
        }
        if (char.changes && char.changes.length > 0) {
          profile += `**Recent Changes / Events:**\n`;
          char.changes.slice(-5).forEach(ch => {
            profile += `- [Chapter ${ch.chapterId}] ${ch.description}\n`;
          });
        }

        return { content: [{ type: 'text', text: profile }] };
      }

      case 'get_chapter_summary': {
        const { projectId, chapterNumber } = request.params.arguments as any;
        const summaries = contextEngine.getSummaries(projectId);
        const summary = summaries.find(s => s.chapterNumber === chapterNumber);

        if (!summary) {
          return { content: [{ type: 'text', text: `Summary for Chapter ${chapterNumber} not found.` }] };
        }

        const details = `**Chapter ${summary.chapterNumber}: ${summary.title}**\n\n**Summary:**\n${summary.summary}\n\n**Ending State:**\n${summary.endingState}\n\n**Plot Threads Touched:**\n${summary.plotThreads.join(', ')}`;
        return { content: [{ type: 'text', text: details }] };
      }

      // ── Pair-collection handlers ──────────────────────────────────────
      case 'list_pens': {
        const pens = stateStore.getPenNames().map(p => ({
          slug: p.slug,
          displayName: p.displayName,
          genreOrSeries: p.genreOrSeries,
          currentLoraVersion: p.currentLoraVersion,
          loraVersions: stateStore.getLoraVersions(p.slug).map(v => ({
            version: v.version,
            ollamaTag: v.ollamaTag,
            trainingPairs: v.trainingPairs,
            finalLoss: v.finalLoss,
            promoted: v.promoted,
            isCurrent: v.version === p.currentLoraVersion,
          })),
          antiPatternCount: Array.isArray(p.raw?.antiPatterns) ? p.raw.antiPatterns.length : 0,
        }));
        return { content: [{ type: 'text', text: JSON.stringify({ pens }) }] };
      }

      case 'get_recent_mined_pairs': {
        const { slug, limit = 20 } = request.params.arguments as any;
        const cap = Math.min(Math.max(1, limit), 200);
        const path = join(WORKSPACE, 'training', `pen-${slug}`, 'mined_pairs.jsonl');
        if (!existsSync(path)) {
          return { content: [{ type: 'text', text: JSON.stringify({ slug, count: 0, records: [], note: 'mined_pairs.jsonl not found' }) }] };
        }
        const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim());
        const tail = lines.slice(-cap);
        const records = tail.map(l => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
        return { content: [{ type: 'text', text: JSON.stringify({ slug, count: records.length, records }) }] };
      }

      case 'get_rejected_pairs': {
        const { slug, limit = 40 } = request.params.arguments as any;
        const cap = Math.min(Math.max(1, limit), 500);
        const path = join(WORKSPACE, 'training', `pen-${slug}`, 'rejected_pairs.log');
        if (!existsSync(path)) {
          return { content: [{ type: 'text', text: JSON.stringify({ slug, count: 0, lines: [], note: 'rejected_pairs.log not found' }) }] };
        }
        const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim()).slice(-cap);
        return { content: [{ type: 'text', text: JSON.stringify({ slug, count: lines.length, lines }) }] };
      }

      case 'inject_pair': {
        const { slug, bad, good, category = 'claude_injected' } = request.params.arguments as any;
        if (typeof slug !== 'string' || typeof bad !== 'string' || typeof good !== 'string' || !bad.trim() || !good.trim()) {
          throw new McpError(ErrorCode.InvalidParams, 'slug, bad, good must be non-empty strings');
        }
        const autoLearning = projectEngine.getAutoLearning();
        const result = await autoLearning.appendClaudeInjectedPairForPen(slug, bad.trim(), good.trim(), category);
        return { content: [{ type: 'text', text: JSON.stringify({ slug, category, ...result }) }] };
      }

      case 'trigger_export': {
        const { slug } = request.params.arguments as any;
        if (typeof slug !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'slug must be a string');
        }
        const autoLearning = projectEngine.getAutoLearning();
        const verifiedCount = await autoLearning.exportForPen(slug);
        return { content: [{ type: 'text', text: JSON.stringify({ slug, verifiedPairs: verifiedCount }) }] };
      }

      case 'get_anti_patterns': {
        const { slug } = request.params.arguments as any;
        const pen = stateStore.getPenName(slug);
        if (!pen) throw new McpError(ErrorCode.InvalidParams, `pen ${slug} not found`);
        const patterns = Array.isArray(pen.raw?.antiPatterns) ? pen.raw.antiPatterns : [];
        return { content: [{ type: 'text', text: JSON.stringify({ slug, count: patterns.length, patterns }) }] };
      }

      case 'claim_task': {
        // Direct StateStore (better-sqlite3) — no longer shells out to perry-trainer.
        // Eliminates the cross-container dependency that broke whenever perry-trainer
        // was killed by Docker Desktop / compose / external docker stop.
        const { worker_id, type, slug } = request.params.arguments as any;
        if (typeof worker_id !== 'string' || !worker_id.trim()) {
          throw new McpError(ErrorCode.InvalidParams, 'worker_id must be a non-empty string');
        }
        try {
          const task = stateStore.claimTask(worker_id.trim(), {
            typeFilter: typeof type === 'string' ? type : undefined,
            penSlug: typeof slug === 'string' ? slug : undefined,
          });
          if (!task) {
            const depth = stateStore.queueDepth({ type: typeof type === 'string' ? type : undefined });
            return { content: [{ type: 'text', text: JSON.stringify({ empty: true, depth }) }] };
          }
          // Match the legacy task shape: snake_case keys for backward compatibility
          // with /perry-worker.md instructions (task.payload, task.type, etc.)
          const taskOut = {
            id: task.id,
            type: task.type,
            payload: task.payload,
            pen_slug: task.penSlug ?? null,
            created_at: task.createdAt,
            claimed_by: task.claimedBy ?? null,
            claimed_at: task.claimedAt ?? null,
          };
          return { content: [{ type: 'text', text: JSON.stringify({ task: taskOut }) }] };
        } catch (err: any) {
          return { content: [{ type: 'text', text: JSON.stringify({ empty: true, error: err.message }) }] };
        }
      }

      case 'report_task': {
        // Direct StateStore — no docker exec dependency.
        const { task_id, status, result, error } = request.params.arguments as any;
        if (typeof task_id !== 'string' || (status !== 'done' && status !== 'failed')) {
          throw new McpError(ErrorCode.InvalidParams, 'task_id required; status must be "done" or "failed"');
        }
        try {
          // Workers may report `result` as a parsed object OR as a JSON-stringified
          // string (depends on which CLI / MCP wrapper they're using). Try parsing
          // strings first so the routing logic gets a uniform shape and to prevent
          // double-stringifying when storing in the DB.
          let parsedResult: any = result;
          if (typeof result === 'string') {
            try { parsedResult = JSON.parse(result); } catch { /* keep as string */ }
          }

          const ok = stateStore.reportTask(task_id, status, parsedResult, typeof error === 'string' ? error : undefined);

          // Side-effect for pipeline_step_assist tasks: when worker reports
          // success with { project_id, step_id, result } in the payload, inject
          // that result into the named step so the pipeline can resume with
          // the better output. Worker contract = include those three keys.
          //
          // Lookup task type AND payload so we know whether to auto-route.
          // research_assist tasks are polled by step-runner directly (it
          // inserts the result into the project step itself), so MCP should
          // NOT also call completeStep — that'd race the polling write.
          //
          // async_quality_audit tasks are ADVISORY-ONLY: the v7 writer model
          // produced the prose, and we never want Claude/Gemini's rewrite
          // overwriting v7's voice. Store the audit verdict in meta for the
          // dashboard but leave the step's prose untouched.
          let taskType = '';
          let taskFailureReason = '';
          try {
            const row = (stateStore as any).db.prepare('SELECT type, payload FROM task_pool WHERE id = ?').get(task_id) as any;
            taskType = row?.type || '';
            if (row?.payload) {
              try { taskFailureReason = (JSON.parse(row.payload) || {}).failure_reason || ''; } catch { /* ignore */ }
            }
          } catch { /* ignore */ }

          if (ok && status === 'done' && typeof parsedResult === 'object' && parsedResult !== null) {
            const r = parsedResult as any;
            // VOICE GUARD: async_quality_audit never overwrites the step.
            // The audit is read-only — record the verdict, leave v7's prose.
            if (taskFailureReason === 'async_quality_audit' && r.project_id && r.step_id) {
              try {
                const verdict = {
                  task_id,
                  action: r.action || 'unspecified',
                  reported_at: new Date().toISOString(),
                  notes: r.notes || r.reason || r.rationale || null,
                };
                (stateStore as any).setMeta(`step_audit_${r.step_id}`, JSON.stringify(verdict));
              } catch { /* ignore */ }
              return { content: [{ type: 'text', text: JSON.stringify({
                task_id, status, ok,
                assist_injected: false,
                voice_preserved: true,
                target_step: r.step_id,
                note: 'async_quality_audit is advisory-only; step prose left intact to preserve v7 voice',
              }) }] };
            }
            if (taskType !== 'research_assist' && r.project_id && r.step_id && (r.result || r.output)) {
              try {
                const raw = r.result || r.output;
                const newResult = typeof raw === 'string' ? raw : JSON.stringify(raw);
                stateStore.completeStep(String(r.project_id), String(r.step_id), newResult);

                // Cross-process learning breadcrumb — mcp-server can't reach
                // ragService directly (separate process / instance), so we
                // drop a meta marker that dashboard-api's bridge poller
                // picks up + indexes as `learning_worker_task`. The bridge
                // removes the key after indexing so this table doesn't grow.
                try {
                  stateStore.setMeta(`worker_done_${task_id}`, JSON.stringify({
                    task_id,
                    task_type: taskType,
                    project_id: r.project_id,
                    step_id: r.step_id,
                    digest: typeof raw === 'string' ? raw.slice(0, 4000) : JSON.stringify(raw).slice(0, 4000),
                    completed_at: new Date().toISOString(),
                  }));
                } catch { /* best-effort; never block the worker report */ }

                return { content: [{ type: 'text', text: JSON.stringify({
                  task_id, status, ok,
                  assist_injected: true,
                  target_step: r.step_id,
                  project: r.project_id,
                }) }] };
              } catch (e: any) {
                return { content: [{ type: 'text', text: JSON.stringify({
                  task_id, status, ok, assist_inject_error: e.message,
                }) }] };
              }
            }

            // Side-effect for voice_anchor_score tasks: when worker reports
            // success with score + verdict, route the candidate to the right
            // file. Contract: { candidate_id, candidate_text, pen_slug, score,
            // verdict: "promote"|"review"|"reject", matches[], deviations[],
            // rationale }. Promote → voice_paragraphs_v2.jsonl; review →
            // _review.jsonl; reject → _rejected.jsonl.
            if (r.candidate_id && r.candidate_text && r.pen_slug && typeof r.score === 'number') {
              try {
                const fs = require('fs');
                const path = require('path');
                const slug = String(r.pen_slug);
                const score = Number(r.score);
                const verdict = (r.verdict || (score >= 7.5 ? 'promote' : score >= 5 ? 'review' : 'reject')) as string;
                const baseDir = `/app/workspace/training/pen-${slug}`;
                const targetFile =
                  verdict === 'promote' ? path.join(baseDir, 'voice_paragraphs_v2.jsonl') :
                  verdict === 'review'  ? path.join(baseDir, 'voice_paragraphs_v2_review.jsonl') :
                                          path.join(baseDir, 'voice_paragraphs_v2_rejected.jsonl');
                const record = {
                  project_id: 'reddit-scout',
                  step_id: String(r.candidate_id),
                  label: `voice_anchor_score:${score.toFixed(1)}`,
                  score,
                  words: (String(r.candidate_text).match(/\S+/g) || []).length,
                  reasons: Array.isArray(r.matches) ? r.matches : [],
                  penalties: Array.isArray(r.deviations) ? r.deviations : [],
                  text: String(r.candidate_text),
                  ...(r.rationale ? { rationale: String(r.rationale) } : {}),
                };
                fs.mkdirSync(baseDir, { recursive: true });
                fs.appendFileSync(targetFile, JSON.stringify(record) + '\n', 'utf8');
                // Archive the task so it doesn't sit forever in 'done' state.
                try { (stateStore as any).db.prepare("UPDATE task_pool SET status='archived' WHERE id=?").run(task_id); } catch { /* ignore */ }
                return { content: [{ type: 'text', text: JSON.stringify({
                  task_id, status, ok,
                  anchor_routed: true, verdict, score, target_file: targetFile,
                }) }] };
              } catch (e: any) {
                return { content: [{ type: 'text', text: JSON.stringify({
                  task_id, status, ok, anchor_route_error: e.message,
                }) }] };
              }
            }
          }

          return { content: [{ type: 'text', text: JSON.stringify({ task_id, status, ok }) }] };
        } catch (err: any) {
          return { content: [{ type: 'text', text: JSON.stringify({ task_id, status, ok: false, error: err.message }) }] };
        }
      }

      case 'enqueue_tasks': {
        const { type, payloads, slug } = request.params.arguments as any;
        if (typeof type !== 'string' || !type.trim() || !Array.isArray(payloads)) {
          throw new McpError(ErrorCode.InvalidParams, 'type (string) and payloads (array) are required');
        }
        const ids = stateStore.enqueueTasks(type.trim(), payloads, typeof slug === 'string' ? slug : undefined);
        return { content: [{ type: 'text', text: JSON.stringify({ type, count: ids.length, ids }) }] };
      }

      case 'list_tasks': {
        const { status, type, limit } = request.params.arguments as any;
        const tasks = stateStore.listTasks({ status, type, limit });
        return { content: [{ type: 'text', text: JSON.stringify({ count: tasks.length, tasks }) }] };
      }

      case 'queue_depth': {
        // Direct StateStore — no docker exec dependency.
        const { type } = request.params.arguments as any;
        try {
          const depth = stateStore.queueDepth({ type: typeof type === 'string' ? type : undefined });
          return { content: [{ type: 'text', text: JSON.stringify({ type: type || null, depth }) }] };
        } catch (err: any) {
          return { content: [{ type: 'text', text: JSON.stringify({ type: type || null, depth: {}, error: err.message }) }] };
        }
      }

      case 'fetch_url': {
        const { url, networkPath, method, timeoutMs, stripHtml } = request.params.arguments as any;
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
          throw new McpError(ErrorCode.InvalidParams, 'url (http/https) required');
        }
        try {
          const { NetworkClient } = await import('@perry/projects');
          const result = await NetworkClient.fetch(url, { networkPath, method, timeoutMs });
          const body = stripHtml ? NetworkClient.stripHtml(result.text) : result.text;
          const MAX = 100_000;
          const text = body.length > MAX ? body.slice(0, MAX) + '\n[...truncated...]' : body;
          const payload = { ...result, text, truncated: body.length > MAX, htmlStripped: !!stripHtml };
          return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `fetch_url failed: ${err.message}`);
        }
      }

      case 'start_calibration': {
        const { slug, targetPairs } = request.params.arguments as any;
        if (typeof slug !== 'string' || !slug.trim()) {
          throw new McpError(ErrorCode.InvalidParams, 'slug (string) is required');
        }
        const target = typeof targetPairs === 'number' && Number.isFinite(targetPairs) ? targetPairs : 600;
        try {
          const autoLearning = projectEngine.getAutoLearning();
          const summary = autoLearning.startCalibration(slug.trim(), target);
          return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `Failed to start calibration: ${err.message}`);
        }
      }

      case 'set_anti_patterns': {
        const { slug, patterns } = request.params.arguments as any;
        if (typeof slug !== 'string' || !Array.isArray(patterns) || !patterns.every((p: any) => typeof p === 'string')) {
          throw new McpError(ErrorCode.InvalidParams, 'slug must be a string and patterns must be a string array');
        }
        const ok = stateStore.updatePenAntiPatterns(slug, patterns);
        if (!ok) throw new McpError(ErrorCode.InvalidParams, `pen ${slug} not found`);
        return { content: [{ type: 'text', text: JSON.stringify({ slug, count: patterns.length, ok: true }) }] };
      }

      case 'rag_search': {
        const { project_id, query, kinds, top_k, min_score, tier } = request.params.arguments as any;
        if (typeof project_id !== 'string' || typeof query !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'project_id and query are required');
        }
        try {
          const hits = await ragService.retrieve({
            projectId: project_id, query, kinds,
            topK: typeof top_k === 'number' ? top_k : undefined,
            minScore: typeof min_score === 'number' ? min_score : undefined,
            tier: typeof tier === 'string' ? tier : undefined,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ hits, count: hits.length }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `rag_search failed: ${err.message}`);
        }
      }

      case 'session_search': {
        // Keyword (FTS5) search over completed step outputs — complements
        // rag_search which is semantic-only. Use for exact-phrase recall
        // ("did I ever write the word 'Erebus'?") where embeddings would
        // miss. Returns excerpts only; fetch full content via session_view.
        const { query, project_id, limit } = request.params.arguments as any;
        if (typeof query !== 'string' || !query.trim()) {
          throw new McpError(ErrorCode.InvalidParams, 'query is required');
        }
        try {
          const hits = stateStore.searchSteps({
            query, projectId: typeof project_id === 'string' ? project_id : undefined,
            limit: typeof limit === 'number' ? limit : undefined,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ hits, count: hits.length }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `session_search failed: ${err.message}`);
        }
      }

      case 'session_view': {
        // Companion to session_search — fetch the full content of one
        // indexed step. Workers scan excerpts first, then load full bodies
        // only for the few they need. Mirrors the get_tool_schema pattern.
        const { step_id } = request.params.arguments as any;
        if (typeof step_id !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'step_id required');
        }
        try {
          const row = stateStore.getStepResult(step_id);
          if (!row) {
            return { content: [{ type: 'text', text: JSON.stringify({ found: false, step_id }) }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify({ found: true, ...row }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `session_view failed: ${err.message}`);
        }
      }

      case 'propose_skill': {
        // Worker (or service-via-worker) has finished a verified-successful
        // complex task and wants to durably record the procedure. Lands in
        // workspace/skills-pending/{service}/ — never directly active — so a
        // human reviews before the skill enters rotation. Mirrors the
        // verified-success learning loop's gate philosophy: producers
        // propose, humans (or a future librarian) decide.
        const { name, description, body, service, applies_when, evidence } = request.params.arguments as any;
        if (typeof name !== 'string' || !/^[a-z0-9-]{3,40}$/.test(name)) {
          throw new McpError(ErrorCode.InvalidParams, 'name must be lowercase-kebab-case, 3-40 chars');
        }
        if (typeof description !== 'string' || description.length < 10 || description.length > 200) {
          throw new McpError(ErrorCode.InvalidParams, 'description must be 10-200 chars');
        }
        if (typeof body !== 'string' || body.length < 100) {
          throw new McpError(ErrorCode.InvalidParams, 'body must be at least 100 chars of markdown procedure');
        }
        const svc = typeof service === 'string' && /^[a-z][a-z0-9-]{1,20}$/.test(service) ? service : 'worker';
        try {
          const fs = await import('fs');
          const path = await import('path');
          const workspaceDir = process.env.PERRY_WORKSPACE || '/app/workspace';
          // Per-service subdir keeps audit/director/scout/etc. proposals
          // browseable independently and lets the consumer service load
          // only its own skills at runtime.
          const dir = path.join(workspaceDir, 'skills-pending', svc);
          fs.mkdirSync(dir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const filename = `${stamp}__${name}.md`;
          const fullPath = path.join(dir, filename);
          const evidenceBlock = evidence ? `\n## Evidence\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n` : '';
          // Serialise applies_when as a nested YAML block so non-LLM
          // consumers (audit-service, future GC tuner, etc.) can parse it
          // mechanically without re-running an LLM.
          let appliesBlock = '';
          if (applies_when && typeof applies_when === 'object') {
            const lines: string[] = ['applies_when:'];
            for (const [k, v] of Object.entries(applies_when)) {
              const safeV = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
              lines.push(`  ${k}: ${safeV}`);
            }
            appliesBlock = lines.join('\n') + '\n';
          }
          const content =
            `---\nname: ${name}\nservice: ${svc}\ndescription: ${description}\nproposed_at: ${new Date().toISOString()}\nstatus: pending\n${appliesBlock}---\n\n` +
            body.trim() + '\n' + evidenceBlock;
          fs.writeFileSync(fullPath, content, 'utf-8');
          return { content: [{ type: 'text', text: JSON.stringify({
            accepted: true,
            file: fullPath,
            service: svc,
            note: `Saved to skills-pending/${svc}/. Awaiting human review in the dashboard Self-Learning → Skills tab.`,
          }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `propose_skill failed: ${err.message}`);
        }
      }

      case 'index_scout_finding': {
        // Self-learning floor for scout: every non-trivial source the worker
        // pulls during research_assist gets indexed as `scout_finding` with
        // structured metadata. The corpus becomes the dedup substrate that
        // check_scout_coverage queries against. Cheap, idempotent on
        // source_ref (re-indexing replaces the existing chunks).
        const { source_ref, text, source, subgenre, tone, query, pen_slug } = request.params.arguments as any;
        if (typeof source_ref !== 'string' || source_ref.length < 3) {
          throw new McpError(ErrorCode.InvalidParams, 'source_ref required (≥3 chars)');
        }
        if (typeof text !== 'string' || text.length < 200) {
          throw new McpError(ErrorCode.InvalidParams, 'text required (≥200 chars — not worth indexing tiny snippets)');
        }
        if (typeof source !== 'string' || typeof subgenre !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'source and subgenre are required');
        }
        try {
          const projectId = pen_slug ? `pen:${pen_slug}` : 'global:scout';
          const result = await ragService.indexText({
            projectId,
            sourceRef: source_ref,
            kind: 'scout_finding',
            text,
            replace: true,
            metadata: { source, subgenre, ...(tone ? { tone } : {}), ...(query ? { query } : {}) },
          });
          return { content: [{ type: 'text', text: JSON.stringify({
            indexed: !result.skipped,
            chunks: result.chunks,
            source_ref,
            subgenre,
            source,
            ...(result.reason ? { skip_reason: result.reason } : {}),
          }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `index_scout_finding failed: ${err.message}`);
        }
      }

      case 'check_scout_coverage': {
        // Pre-crawl gate: if we already have N findings in this slice, skip
        // the query. Counts raw `scout_finding` plus `verified_scout_finding`
        // (verified weights heavier — counted separately so workers can see
        // signal quality, not just volume).
        const { subgenre, source, tone, threshold } = request.params.arguments as any;
        if (typeof subgenre !== 'string' || subgenre.length < 2) {
          throw new McpError(ErrorCode.InvalidParams, 'subgenre required');
        }
        const sat = typeof threshold === 'number' ? threshold : 20;
        try {
          const baseFilters: Record<string, string> = { subgenre };
          if (typeof source === 'string') baseFilters.source = source;
          if (typeof tone === 'string') baseFilters.tone = tone;
          const raw = ragService.countWithMetadata({ kind: 'scout_finding', filters: baseFilters });
          const verified = ragService.countWithMetadata({ kind: 'verified_scout_finding', filters: baseFilters });
          const combined = raw + verified;
          const saturated = combined >= sat;
          return { content: [{ type: 'text', text: JSON.stringify({
            slice: { subgenre, source: source || null, tone: tone || null },
            raw_count: raw,
            verified_count: verified,
            combined_count: combined,
            threshold: sat,
            saturated,
            recommendation: saturated
              ? 'SKIP this slice — already saturated. Either propose a SKILL describing why this slice is exhausted, or pivot to an under-covered subgenre/source.'
              : 'PROCEED with crawl — slice has room for more findings.',
          }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `check_scout_coverage failed: ${err.message}`);
        }
      }

      case 'mark_scout_finding_used': {
        // Verified-success flip: bible/chapter step succeeded AND cited this
        // finding. Index a parallel chunk under `verified_scout_finding` so
        // coverage checks can weight verified findings heavier than raw.
        // Doesn't re-fetch — re-uses the text from the existing scout_finding
        // chunk via the source_ref.
        const { source_ref, used_in, verified_reason } = request.params.arguments as any;
        if (typeof source_ref !== 'string' || typeof used_in !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'source_ref and used_in required');
        }
        try {
          // Find the original chunk to lift the text + metadata
          const existing = (memoryStore as any).db?.prepare(
            'SELECT project_id, text, metadata FROM chunks WHERE source_ref = ? AND kind = ? LIMIT 1'
          ).get(source_ref, 'scout_finding') as any;
          if (!existing) {
            return { content: [{ type: 'text', text: JSON.stringify({
              indexed: false,
              reason: `no scout_finding chunk found for source_ref=${source_ref}`,
            }) }] };
          }
          let baseMeta: Record<string, any> = {};
          try { baseMeta = JSON.parse(existing.metadata || '{}'); } catch {}
          const result = await ragService.indexText({
            projectId: existing.project_id,
            sourceRef: `${source_ref}::verified::${used_in}`,
            kind: 'verified_scout_finding',
            text: existing.text,
            replace: true,
            metadata: { ...baseMeta, verified_in: used_in, ...(verified_reason ? { verified_reason } : {}) },
          });
          return { content: [{ type: 'text', text: JSON.stringify({
            indexed: !result.skipped,
            chunks: result.chunks,
            source_ref,
            used_in,
          }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `mark_scout_finding_used failed: ${err.message}`);
        }
      }

      case 'rag_search_global': {
        const { query, kinds, top_k, min_score, tier } = request.params.arguments as any;
        if (typeof query !== 'string') throw new McpError(ErrorCode.InvalidParams, 'query is required');
        try {
          const hits = await ragService.retrieveGlobal({
            query, kinds,
            topK: typeof top_k === 'number' ? top_k : undefined,
            minScore: typeof min_score === 'number' ? min_score : undefined,
            tier: typeof tier === 'string' ? tier : undefined,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ hits, count: hits.length }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `rag_search_global failed: ${err.message}`);
        }
      }

      case 'rag_find_by_entity': {
        const { project_id, entity, kinds, top_per_source } = request.params.arguments as any;
        if (typeof project_id !== 'string' || typeof entity !== 'string' || !entity.trim()) {
          throw new McpError(ErrorCode.InvalidParams, 'project_id and entity required');
        }
        try {
          const hits = ragService.findByEntity({
            projectId: project_id, entity,
            kinds: Array.isArray(kinds) ? kinds : undefined,
            topPerSource: typeof top_per_source === 'number' ? top_per_source : undefined,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ hits, count: hits.length }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `rag_find_by_entity failed: ${err.message}`);
        }
      }

      case 'rag_drift_score': {
        const { project_id, text, centroid_kind, centroid_project_id } = request.params.arguments as any;
        if (typeof project_id !== 'string' || typeof text !== 'string' || text.trim().length < 80) {
          throw new McpError(ErrorCode.InvalidParams, 'project_id and text (>=80 chars) required');
        }
        try {
          const out = await ragService.driftScore({
            projectId: project_id, text,
            centroidKind: typeof centroid_kind === 'string' ? centroid_kind : 'voice_anchor',
            centroidProjectId: typeof centroid_project_id === 'string' ? centroid_project_id : undefined,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ drift: out }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `rag_drift_score failed: ${err.message}`);
        }
      }

      case 'embed_text': {
        const { text } = request.params.arguments as any;
        if (typeof text !== 'string' || text.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, 'text (string) is required');
        }
        try {
          const r = await aiRouter.embeddings.embed(text);
          return { content: [{ type: 'text', text: JSON.stringify({
            embedding: r.embedding,
            dim: r.dim,
            model: r.model,
            cached: r.cached,
          }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `embed_text failed: ${err.message}`);
        }
      }

      case 'embed_similarity': {
        const { text, candidates, top_k } = request.params.arguments as any;
        if (typeof text !== 'string' || text.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, 'text (string) is required');
        }
        if (!Array.isArray(candidates) || candidates.length === 0) {
          throw new McpError(ErrorCode.InvalidParams, 'candidates must be a non-empty array');
        }
        const valid = candidates.filter((c: any) => c && typeof c.id === 'string' && typeof c.text === 'string' && c.text.trim().length > 0);
        if (valid.length === 0) {
          throw new McpError(ErrorCode.InvalidParams, 'no valid candidates (each needs id + non-empty text)');
        }
        try {
          let ranked = await aiRouter.embeddings.similarityAgainst(text, valid);
          if (typeof top_k === 'number' && top_k > 0) ranked = ranked.slice(0, Math.floor(top_k));
          return { content: [{ type: 'text', text: JSON.stringify({ results: ranked, model: aiRouter.embeddings.stats().model }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `embed_similarity failed: ${err.message}`);
        }
      }

      case 'get_tool_schema': {
        const { name } = request.params.arguments as any;
        if (typeof name !== 'string' || !name.trim()) {
          throw new McpError(ErrorCode.InvalidParams, 'name (string) is required');
        }
        // Look up the tool in the most-recently-built full list. If
        // tools/list hasn't been called yet this session, the list is
        // empty — return a clear error.
        const match = serverFullToolList.find((t: any) => t.name === name);
        if (!match) {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}. Call tools/list first if this session is fresh.`);
        }
        return { content: [{ type: 'text', text: JSON.stringify({
          name: match.name,
          description: match.description,
          inputSchema: match.inputSchema,
        }) }] };
      }

      case 'compress_context': {
        const { text, task, level, target_tokens, mode } = request.params.arguments as any;
        if (typeof text !== 'string' || text.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidParams, 'text (string) is required');
        }
        // Estimate input tokens (4 chars ≈ 1 token, conservative).
        const inputTokens = Math.ceil(text.length / 3.5);
        // Level → target ratio. Caller-supplied target_tokens always wins.
        const LEVEL_RATIO: Record<string, number> = { low: 0.5, medium: 0.25, high: 0.12, max: 0.06 };
        const chosenLevel = (typeof level === 'string' && level in LEVEL_RATIO) ? level : 'medium';
        const target = typeof target_tokens === 'number' && target_tokens >= 128
          ? Math.floor(target_tokens)
          : Math.max(128, Math.floor(inputTokens * LEVEL_RATIO[chosenLevel]));
        const chosenMode = (typeof mode === 'string' && ['context_briefing', 'chapter_summary', 'entity_extraction', 'continuity_check', 'style_analysis'].includes(mode))
          ? mode
          : 'context_briefing';
        const taskDescription = typeof task === 'string' && task.trim().length > 0
          ? task.trim()
          : 'General-purpose context briefing for downstream consumer';

        try {
          const result = await aiRouter.compressor.compress({
            rawContext: text,
            taskDescription,
            targetTokens: target,
            mode: chosenMode as any,
          });
          return { content: [{ type: 'text', text: JSON.stringify({
            compressed: result.compressed,
            originalTokens: result.originalTokens,
            compressedTokens: result.compressedTokens,
            compressionRatio: result.compressionRatio,
            level: chosenLevel,
            mode: chosenMode,
            provider: result.provider,
            cached: result.provider === 'cache' || (result.provider === 'passthrough'),
          }) }] };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `compress_context failed: ${err.message}`);
        }
      }

      case 'reload_custom_tools': {
        try {
          await loadCustomTools();
          return {
            content: [
              {
                type: 'text',
                text: `Successfully reloaded custom tools. Currently loaded: ${Array.from(customTools.keys()).join(', ') || 'none'}`
              }
            ]
          };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `Failed to reload custom tools: ${err.message}`);
        }
      }

      case 'librarian_pin_skill': {
        const { service, name } = request.params.arguments as any;
        if (typeof service !== 'string' || typeof name !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'service and name must be strings');
        }
        stateStore.setMeta(`librarian_pin:${service}:${name}`, '1');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ pinned: true, service, name })
          }]
        };
      }

      case 'librarian_unpin_skill': {
        const { service, name } = request.params.arguments as any;
        if (typeof service !== 'string' || typeof name !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'service and name must be strings');
        }
        stateStore.removeMeta(`librarian_pin:${service}:${name}`);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ unpinned: true, service, name })
          }]
        };
      }

      case 'librarian_run_pass': {
        const { dryRun, runLlmReview } = request.params.arguments as any;
        try {
          const librarian = new LibrarianService(WORKSPACE, stateStore, aiRouter, log);
          const result = await librarian.runLibrarianPass({ dryRun, runLlmReview });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `librarian_run_pass failed: ${err.message}`);
        }
      }

      case 'librarian_list_backups': {
        try {
          const librarian = new LibrarianService(WORKSPACE, stateStore, aiRouter, log);
          const backups = await librarian.listBackups();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ backups }, null, 2)
            }]
          };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `librarian_list_backups failed: ${err.message}`);
        }
      }

      case 'librarian_rollback': {
        const { timestamp } = request.params.arguments as any;
        if (typeof timestamp !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'timestamp must be a string');
        }
        try {
          const librarian = new LibrarianService(WORKSPACE, stateStore, aiRouter, log);
          const result = await librarian.rollback(timestamp);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `librarian_rollback failed: ${err.message}`);
        }
      }

      case 'librarian_status': {
        try {
          const installedDir = join(WORKSPACE, 'skills-installed');
          const pendingDir = join(WORKSPACE, 'skills-pending');
          const legacyInstalledDir = '/app/.claude/commands';

          const scan = (dir: string): Array<{ name: string; service: string; isPinned: boolean; path: string }> => {
            if (!existsSync(dir)) return [];
            const out: any[] = [];
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const ent of entries) {
              if (ent.isDirectory()) {
                const subDir = join(dir, ent.name);
                const subFiles = readdirSync(subDir).filter(f => f.endsWith('.md'));
                for (const file of subFiles) {
                  const name = file.replace(/\.md$/, '');
                  const isPinned = stateStore.getMeta(`librarian_pin:${ent.name}:${name}`) === '1';
                  out.push({ name, service: ent.name, isPinned, path: join(subDir, file) });
                }
              } else if (ent.isFile() && ent.name.endsWith('.md')) {
                const name = ent.name.replace(/\.md$/, '');
                const isPinned = stateStore.getMeta(`librarian_pin:worker:${name}`) === '1';
                out.push({ name, service: 'worker', isPinned, path: join(dir, ent.name) });
              }
            }
            return out;
          };

          const installedList = [...scan(installedDir), ...scan(legacyInstalledDir)];
          const pendingList = scan(pendingDir);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                installed: installedList,
                pending: pendingList
              }, null, 2)
            }]
          };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `librarian_status failed: ${err.message}`);
        }
      }

      case 'librarian_list_proposals': {
        try {
          const proposals = stateStore.listLibrarianProposals();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ proposals }, null, 2)
            }]
          };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `librarian_list_proposals failed: ${err.message}`);
        }
      }

      case 'librarian_approve_proposal': {
        const { id } = request.params.arguments as any;
        if (typeof id !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'id must be a string');
        }
        try {
          const librarian = new LibrarianService(WORKSPACE, stateStore, aiRouter, log);
          await librarian.applyProposal(id);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true })
          }]
        };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `librarian_approve_proposal failed: ${err.message}`);
        }
      }

      case 'librarian_reject_proposal': {
        const { id } = request.params.arguments as any;
        if (typeof id !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'id must be a string');
        }
        try {
          stateStore.updateLibrarianProposalStatus(id, 'rejected');
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true })
            }]
          };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `librarian_reject_proposal failed: ${err.message}`);
        }
      }

      case 'librarian_merge_skills': {
        const { service, skillA, skillB, newSkillName } = request.params.arguments as any;
        if (typeof service !== 'string' || typeof skillA !== 'string' || typeof skillB !== 'string' || typeof newSkillName !== 'string') {
          throw new McpError(ErrorCode.InvalidParams, 'service, skillA, skillB, and newSkillName must be strings');
        }
        try {
          const librarian = new LibrarianService(WORKSPACE, stateStore, aiRouter, log);
          await librarian.mergeSkills(service, skillA, skillB, newSkillName);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true })
            }]
          };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `librarian_merge_skills failed: ${err.message}`);
        }
      }

      case 'librarian_get_telemetry': {
        const { limit } = request.params.arguments as any;
        const limitVal = typeof limit === 'number' ? limit : 100;
        try {
          const history = stateStore.listSkillTelemetry(limitVal);
          
          const allTelemetry = stateStore.listSkillTelemetry(1000);
          const statsMap = new Map<string, { service: string; name: string; total: number; successful: number; totalDuration: number }>();
          for (const item of allTelemetry) {
            const key = `${item.service}:${item.skill_name}`;
            let stat = statsMap.get(key);
            if (!stat) {
              stat = { service: item.service, name: item.skill_name, total: 0, successful: 0, totalDuration: 0 };
              statsMap.set(key, stat);
            }
            stat.total += 1;
            if (item.success === 1) stat.successful += 1;
            stat.totalDuration += item.duration_ms;
          }
          const stats = Array.from(statsMap.values()).map(s => ({
            service: s.service,
            name: s.name,
            total: s.total,
            successRate: s.total > 0 ? s.successful / s.total : 0,
            avgDurationMs: s.total > 0 ? s.totalDuration / s.total : 0
          }));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ history, stats }, null, 2)
            }]
          };
        } catch (err: any) {
          throw new McpError(ErrorCode.InternalError, `librarian_get_telemetry failed: ${err.message}`);
        }
      }

      default: {
        const tool = customTools.get(request.params.name);
        if (tool) {
          try {
            const context = {
              log,
              workspaceDir: WORKSPACE,
              config,
              vault,
              eventBus,
              stateStore,
              aiRouter,
              memoryStore,
              contextEngine,
              ragService,
              projectEngine,
              styleDnaService: null,
            };
            const result = await tool.run(request.params.arguments || {}, context);
            return result;
          } catch (err: any) {
            throw new McpError(
              ErrorCode.InternalError,
              `Error executing custom tool '${request.params.name}': ${err.message}`
            );
          }
        }
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      }
    }
  });

    return server;
  }

  // 5. Start Server
  //
  // Two transport modes:
  //  - stdio (default): the host's Claude Code spawns `node mcp-server/dist`
  //    and talks over stdin/stdout via .mcp.json `docker exec` config.
  //  - HTTP (when PERRY_MCP_HTTP_PORT is set): listens on the docker network
  //    so the perry-worker container's Claude can reach MCP without a docker
  //    socket. Per-session Server instances — each MCP client gets its own
  //    transport+Server pair, because the MCP `initialize` method can only
  //    fire once on a given Server.
  const httpPort = parseInt(process.env.PERRY_MCP_HTTP_PORT || '0', 10);
  if (httpPort > 0) {
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const expressMod = await import('express');
    const express: any = (expressMod as any).default || expressMod;
    const { randomUUID } = await import('crypto');

    const transports = new Map<string, any>();

    const app = express();
    app.use(express.json({ limit: '20mb' }));

    const dispatch = async (req: any, res: any) => {
      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport = sessionId ? transports.get(sessionId) : undefined;

        if (!transport) {
          // New session — mint a fresh Server + transport pair.
          // Honor X-Perry-MCP-Profile so workers can request a leaner tool
          // surface (e.g., 'drainer' or 'researcher').
          // Honor X-Perry-MCP-Compact=true so workers get stub schemas in
          // tools/list and fetch full schemas on-demand via get_tool_schema.
          const profileHeader = (req.headers['x-perry-mcp-profile'] || '') as string;
          const compactHeader = (req.headers['x-perry-mcp-compact'] || '') as string;
          const profile = profileHeader.trim().toLowerCase() || undefined;
          const compact = compactHeader.trim().toLowerCase() === 'true';
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });
          const sessionServer = buildServer(profile, compact);
          await sessionServer.connect(transport);
          transport.onclose = () => {
            if (transport.sessionId) transports.delete(transport.sessionId);
          };
        }

        await transport.handleRequest(req, res, req.body);

        // After init, the transport gets a sessionId — register it so
        // subsequent requests with the same MCP-Session-Id header reuse
        // this transport (and its Server).
        if (transport.sessionId && !transports.has(transport.sessionId)) {
          transports.set(transport.sessionId, transport);
        }
      } catch (e: any) {
        if (!res.headersSent) {
          res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: e.message } });
        }
      }
    };

    app.post('/mcp', dispatch);
    app.get('/mcp', dispatch);     // SSE stream for server-initiated messages
    app.delete('/mcp', dispatch);  // graceful session termination
    app.get('/health', (_req: any, res: any) => res.json({ ok: true, sessions: transports.size }));

    app.listen(httpPort, '0.0.0.0', () => {
      // eslint-disable-next-line no-console
      console.error(`[mcp-server] HTTP transport online on :${httpPort}`);
    });
  } else {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

bootstrap().catch(err => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
