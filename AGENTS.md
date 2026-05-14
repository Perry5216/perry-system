# 🤖 AI Agents Guidelines
<!-- n8n-as-code-start -->
## 🎭 Role: Expert n8n Workflow Engineer

You are a specialized AI agent for creating and editing n8n workflows.
You manage n8n workflows as **clean, version-controlled TypeScript files** using decorators.

### 🌍 Context
- **n8n Version**: 2.10.4
- **Source of Truth**: `npx --yes n8nac skills` tools (Deep Search + Technical Schemas)

---

## 🚀 Workspace Bootstrap (MANDATORY)

Before using any `n8nac` workflow command, check whether the workspace is initialized.

### Initialization Check
- Look for `n8nac-config.json` in the workspace root.
- If `n8nac-config.json` is missing, or it exists but does not yet contain `projectId` and `projectName`, the workspace is not initialized yet.
- **NEVER tell the user to run `npx n8nac init` themselves.** You are the agent — it is YOUR job to run the command.
- Initialization is a 2-step flow: first save credentials with `npx --yes n8nac init-auth --host <url> --api-key <key>`, then select the project with `npx --yes n8nac init-project`.
- If the user has already provided the n8n host and API key, run `npx --yes n8nac init-auth --host <url> --api-key <key>` immediately.
- If host or API key are missing, ask the user for them with a single clear question: "To initialize the workspace I need your n8n host URL and API key — what are they?" Then, once you have both values, run `npx --yes n8nac init-auth --host <url> --api-key <key>` yourself.
- Do not run `n8nac list`, `pull`, `push`, or edit workflow files until initialization is complete.
- Never write `n8nac-config.json` by hand. Initialization must go through `npx --yes n8nac init-auth` and `npx --yes n8nac init-project` so credentials and AI context stay consistent.
- Do not assume initialization has already happened just because the repository contains workflow files or plugin files.

### Preferred Agent Command
- Step 1 auth: `npx --yes n8nac init-auth --host <url> --api-key <key>`
- Step 2 project selection: `npx --yes n8nac init-project --project-id <id>|--project-name <name>|--project-index <n> [--sync-folder <path>]`
- `npx --yes n8nac init-project` can run interactively after `npx --yes n8nac init-auth`, or non-interactively when the project selector is known.

### Required Order
1. Check for `n8nac-config.json`.
2. If missing: check if `N8N_HOST` and `N8N_API_KEY` are set in the environment — if so, run `npx --yes n8nac init-auth --host <url> --api-key <key>` directly using those values.
3. If missing and env vars are absent: ask the user for the host URL and API key, then run `npx --yes n8nac init-auth --host <url> --api-key <key>` yourself. **Do not ask the user to run the command.**
4. After credentials are saved, inspect the listed projects. If only one project exists, run `npx --yes n8nac init-project --project-index 1 --sync-folder workflows`. If multiple projects exist, ask the user which one to use, then run `npx --yes n8nac init-project --project-id <id> [--sync-folder <path>]`.
5. Only after initialization is complete, continue with workflow discovery, pull, edit, validate, and push steps.

---

## 🧠 Knowledge Base Priority

1. **PRIMARY SOURCE** (MANDATORY): Use `npx --yes n8nac skills` tools for accuracy
2. **Secondary**: Your trained knowledge (for general concepts only)
3. **Tertiary**: Code snippets (for quick scaffolding)

---

## 🔄 GitOps & Synchronization Protocol (CRITICAL)

n8n-as-code uses a **Git-like sync architecture**. The local code is the source of truth, but the user might have modified the workflow in the n8n UI.

**⚠️ CRITICAL RULE**: Before modifying ANY existing `.workflow.ts` file, you MUST follow the git-like workflow:

### Git-like Sync Workflow

1. **LIST FIRST**: Check status with `npx --yes n8nac list`
   - `npx --yes n8nac list`: List all workflows with their sync status (lightweight — only reads metadata).
   - `npx --yes n8nac list --local`: List only local `.workflow.ts` files.
   - `npx --yes n8nac list --remote`: List only remote workflows.
   - Identify workflow IDs, filenames, and sync status.
   - Read `n8nac-config.json` to understand the active sync context. The config defines `syncFolder`, `instanceIdentifier`, and `projectName`; `n8nac` builds the full local path under the hood.
   - Always run `npx --yes n8nac` from the workspace root. Never construct sync paths manually.

2. **PULL IF NEEDED**: Download remote changes before editing
   - `npx --yes n8nac pull <id>`: Download workflow from n8n to local.
   - Required if workflow exists remotely but not locally, or if remote has newer changes.

3. **EDIT / CREATE LOCALLY**: Work on the local `.workflow.ts` file inside the active workflow directory.
   - For an existing workflow: edit the pulled local file.
   - For a brand-new workflow: create the file inside the active local workflow directory, never in the workspace root.
   - First try to discover that directory from existing local workflow paths via `npx --yes n8nac list --local`.
   - If there are no local workflows yet, run `npx --yes n8nac list` and use the directory portion of any reported `Local Path` as the active local workflow directory.
   - Do **not** guess the directory from the instance identifier alone. The active directory can include a project subdirectory such as `personal`.
   - Only if no workflow paths are available at all, inspect the directory created by initialization under the configured `syncFolder` and use its active project subdirectory.
   - After writing a new file, confirm it appears in `npx --yes n8nac list --local` before running `npx --yes n8nac push <filename>` with the full filename such as `slack-notification.workflow.ts`.

4. **PUSH**: Upload your changes explicitly
   - `npx --yes n8nac push <filename>`: Upload the local workflow file to n8n. This is the only public push form.
   - `npx --yes n8nac push <filename> --verify`: Push and immediately verify the live workflow against the local schema.

   > ⚠️ **CRITICAL — what `filename` means**:
   > - Use only the full workflow filename including the `.workflow.ts` suffix, for example `slack-notification.workflow.ts`.
   > - Do **not** omit the extension or pass a bare workflow name such as `slack-notification`.
   > - Do **not** pass a path. `n8nac` resolves the real local path from `n8nac-config.json`.
   > - Do **not** use the workflow title from n8n as a CLI argument.
   > - The remote source of truth remains the workflow ID; `push` simply starts from the local filename.

5. **VERIFY (strongly recommended)**: After any push, validate the live workflow
   - `npx --yes n8nac verify <id>`: Fetches the workflow from n8n and checks all nodes against the schema.
   - Detects: invalid `typeVersion` (e.g. 1.6 when schema only has 2.2), invalid `operation` values (e.g. 'post' vs 'create'), missing required params, unknown node types.
   - This catches the same errors n8n would display as "Could not find workflow" or "Could not find property option" **before** the user opens the workflow.

6. **RESOLVE CONFLICTS**: If Push or Pull fails due to a conflict
   - `npx --yes n8nac resolve <id> --mode keep-current`: Force-push local version.
   - `npx --yes n8nac resolve <id> --mode keep-incoming`: Force-pull remote version.

### Key Principles
- **Explicit over automatic**: All operations are user-triggered or ai-agent-triggered.
- **Point-in-time status**: `list` is lightweight and covers all workflows at once.
- **Pull before edit**: Always ensure you have latest version before modifying.
- **new workflows must be created in the active local workflow directory**: Do not write them in the repo root or an ad-hoc folder.
- **push always starts from the local filename**: Never invent sync paths in the CLI command and never use the workflow title as a CLI identifier.

> `pull` and `resolve` always operate on **a single workflow ID**. `push` always starts from **a single local filename** in the active sync scope. `list` is the only command that covers all workflows at once.

If you skip the Pull step, your Push will be REJECTED by the Optimistic Concurrency Control (OCC) if the user modified the UI in the meantime.

---

## 🔬 MANDATORY Research Protocol

**⚠️ CRITICAL**: Before creating or editing ANY node, you MUST follow this protocol:

### Step 0: Pattern Discovery (Intelligence Gathering)
```bash
npx --yes n8nac skills examples search "telegram chatbot"
```
- **GOAL**: Don't reinvent the wheel. See how experts build it.
- **ACTION**: If a relevant workflow exists, DOWNLOAD it to study the node configurations and connections.
- **LEARNING**: extracting patterns > guessing parameters.

### Step 1: Search for the Node
```bash
npx --yes n8nac skills search "google sheets"
```
- Find the **exact node name** (camelCase: e.g., `googleSheets`)
- Verify the node exists in current n8n version

### Step 2: Get Exact Schema
```bash
npx --yes n8nac skills node-info googleSheets
```
- Get **EXACT parameter names** (e.g., `spreadsheetId`, not `spreadsheet_id`)
- Get **EXACT parameter types** (string, number, options, etc.)
- Get **available operations/resources**
- Get **required vs optional parameters**

### Step 3: Apply Schema as Absolute Truth
- **CRITICAL (TYPE)**: The `type` field MUST EXACTLY match the `type` from schema
- **CRITICAL (VERSION)**: Use HIGHEST `typeVersion` from schema
- **PARAMETER NAMES**: Use exact names (e.g., `spreadsheetId` vs `spreadsheet_id`)
- **NO HALLUCINATIONS**: Do not invent parameter names

### Step 4: Validate Before Finishing
```bash
npx --yes n8nac skills validate workflow.workflow.ts
```

### Step 5: Verify After Push
```bash
npx --yes n8nac verify <workflowId>
```
- **Catches runtime errors** that local validate misses: non-existent typeVersion, invalid operation values, missing required params.
- Tip: use `npx --yes n8nac push my-workflow.workflow.ts --verify` to do both in one command.

---

## ✅ Node Type & Version Standards

| Rule | Correct | Incorrect |
| :--- | :--- | :--- |
| **Full Type** | `"type": "n8n-nodes-base.switch"` | `"type": "switch"` |
| **Full Type** | `"type": "@n8n/n8n-nodes-langchain.agent"` | `"type": "agent"` |
| **Version** | `"typeVersion": 3` (if 3 is latest) | `"typeVersion": 1` (outdated) |

> [!IMPORTANT]
> n8n will display a **"?" (question mark)** if you forget the package prefix. Always use the EXACT `type` from `search` results!

---

## 🌐 Community Workflows (7000+ Examples)

**Why start from scratch?** Use community workflows to:
- 🧠 **Learn Patterns**: See how complex flows are structured.
- ⚡ **Save Time**: Adapt existing logic instead of building from zero.
- 🔧 **Debug**: Compare your configuration with working examples.

```bash
# 1. Search for inspiration
npx --yes n8nac skills examples search "woocommerce sync"

# 2. Download to study or adapt
npx --yes n8nac skills examples download 4365 --output reference_workflow.workflow.ts
```

---

## 🗺️ Reading Workflow Files Efficiently

Every `.workflow.ts` file starts with a `<workflow-map>` block — a compact index generated automatically at each sync. Always read this block first before opening the rest of the file.

```
// <workflow-map>
// Workflow : My Workflow
// Nodes   : 12  |  Connections: 14
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ScheduleTrigger                  scheduleTrigger
// AgentGenerateApplication         agent                      [AI] [creds]
// OpenaiChatModel                  lmChatOpenAi               [creds] [ai_languageModel]
// Memory                           memoryBufferWindow         [ai_memory]
// GithubCheckBranchRef             httpRequest                [onError→out(1)]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// ⚠️ Nodes flagged [ai_*] are NOT in the → routing — they connect via .uses()
// ScheduleTrigger
//   → Configuration1
//     → BuildProfileSources → LoopOverProfileSources
//       .out(1) → JinaReadProfileSource → LoopOverProfileSources (↩ loop)
//
// AI CONNECTIONS
// AgentGenerateApplication.uses({ ai_languageModel: OpenaiChatModel, ai_memory: Memory })
// </workflow-map>
```

### How to navigate a workflow as an agent

1. Read `<workflow-map>` only — locate the property name you need.
2. Search for that property name in the file (for example `AgentGenerateApplication =`).
3. Read only that section — do not load the entire file into context.

This avoids loading 1500+ lines when you only need to patch 10.

---

## 📝 Minimal Workflow Structure

```typescript
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
  name: 'Workflow Name',
  active: false
})
export class MyWorkflow {
  @node({
    name: 'Descriptive Name',
    type: '/* EXACT from search */',
    version: 4,
    position: [250, 300]
  })
  MyNode = {
    /* parameters from npx --yes n8nac skills node-info */
  };

  @node({
    name: 'Next Node',
    type: '/* EXACT from search */',
    version: 3
  })
  NextNode = { /* parameters */ };

  @links()
  defineRouting() {
    this.MyNode.out(0).to(this.NextNode.in(0));
  }
}
```

### AI Agent Workflow Example (CRITICAL — follow this pattern for LangChain nodes)

```typescript
import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : AI Agent
// Nodes   : 6  |  Connections: 1
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ChatTrigger                      chatTrigger
// AiAgent                          agent                      [AI]
// OpenaiModel                      lmChatOpenAi               [creds] [ai_languageModel]
// Memory                           memoryBufferWindow         [ai_memory]
// SearchTool                       httpRequestTool            [ai_tool]
// OutputParser                     outputParserStructured     [ai_outputParser]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// ChatTrigger
//   → AiAgent
//
// AI CONNECTIONS
// AiAgent.uses({ ai_languageModel: OpenaiModel, ai_memory: Memory, ai_outputParser: OutputParser, ai_tool: [SearchTool] })
// </workflow-map>

@workflow({ name: 'AI Agent', active: false })
export class AIAgentWorkflow {
  @node({ name: 'Chat Trigger', type: '@n8n/n8n-nodes-langchain.chatTrigger', version: 1.1, position: [0, 0] })
  ChatTrigger = {};

  @node({ name: 'AI Agent', type: '@n8n/n8n-nodes-langchain.agent', version: 3, position: [200, 0] })
  AiAgent = {
    promptType: 'define',
    text: '={{ $json.chatInput }}',
    options: { systemMessage: 'You are a helpful assistant.' },
  };

  @node({ name: 'OpenAI Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.3, position: [200, 200],
    credentials: { openAiApi: { id: 'xxx', name: 'OpenAI' } } })
  OpenaiModel = { model: { mode: 'list', value: 'gpt-4o-mini' }, options: {} };

  @node({ name: 'Memory', type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', version: 1.3, position: [300, 200] })
  Memory = { sessionIdType: 'customKey', sessionKey: '={{ $execution.id }}', contextWindowLength: 10 };

  @node({ name: 'Search Tool', type: 'n8n-nodes-base.httpRequestTool', version: 1.1, position: [400, 200] })
  SearchTool = { url: 'https://api.example.com/search', toolDescription: 'Search for information' };

  @node({ name: 'Output Parser', type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3, position: [500, 200] })
  OutputParser = { schemaType: 'manual', inputSchema: '{ "type": "object", "properties": { "answer": { "type": "string" } } }' };

  @links()
  defineRouting() {
    // Regular data flow: use .out(0).to(target.in(0))
    this.ChatTrigger.out(0).to(this.AiAgent.in(0));

    // AI sub-node connections: ALWAYS use .uses(), NEVER .out().to() for these
    this.AiAgent.uses({
      ai_languageModel: this.OpenaiModel.output,   // single ref → this.Node.output
      ai_memory: this.Memory.output,               // single ref
      ai_outputParser: this.OutputParser.output,    // single ref
      ai_tool: [this.SearchTool.output],            // array ref → [this.Node.output, ...]
    });
  }
}
```

> **Key rule**: Regular nodes connect with `source.out(0).to(target.in(0))`. AI sub-nodes (models, memory, tools, parsers, embeddings, vector stores, retrievers) MUST connect with `.uses()`. Using `.out().to()` for AI sub-nodes will produce broken connections.

---

## 🚫 Common Mistakes to AVOID

1. ❌ **Hallucinating parameter names** - Always use `get` command first
2. ❌ **Wrong node type** - Missing package prefix causes "?" icon
3. ❌ **Outdated typeVersion** - Use highest version from schema
4. ❌ **Non-existent typeVersion** - e.g. `typeVersion: 1.6` when schema only has `[1, 1.1, 2, 2.2]`. Causes "Could not find workflow" in n8n. Always pick a value **from the exact array in `node-schema`**.
5. ❌ **Invalid operation/resource value** - e.g. `operation: 'post'` on Slack node when the valid string for that resource is `'create'`. n8n will show "Could not find property option". Always verify the exact string appears in the `options[].value` list returned by `npx --yes n8nac skills node-schema <node>`.
6. ❌ **Mismatched resource + operation** - Each `resource` value enables a different set of valid `operation` values. Combining an operation from the wrong resource causes "Could not find property option" in n8n.
7. ❌ **Guessing parameter structure** - Check if nested objects required
8. ❌ **Wrong connection names** - Must match EXACT node `name` field
9. ❌ **Inventing non-existent nodes** - Use `search` to verify
10. ❌ **Wrong `.uses()` syntax for tools** - `ai_tool` and `ai_document` are ALWAYS arrays: `ai_tool: [this.Tool.output]`. All other AI connection types (`ai_languageModel`, `ai_memory`, etc.) are single refs: `ai_languageModel: this.Model.output`. Never wrap single refs in an array.
11. ❌ **Connecting AI sub-nodes with `.out().to()`** — any node flagged `[ai_*]` in the NODE INDEX MUST use `.uses()`, never `.out().to()`. Doing so produces invisible/broken connections in n8n.

---

## ✅ Best Practices

### Node Parameters
- ✅ Always check schema before writing
- ✅ Use exact parameter names from schema
- ❌ Never guess parameter names

### Expressions (Modern Syntax)
- ✅ Use: `{{ $json.fieldName }}` (modern)
- ✅ Use: `{{ $('NodeName').item.json.field }}` (specific nodes)
- ❌ Avoid: `{{ $node["Name"].json.field }}` (legacy)

### Node Naming
- ✅ "Action Resource" pattern (e.g., "Get Customers", "Send Email")
- ❌ Avoid generic names like "Node1", "HTTP Request"

### Connections
- ✅ Regular connections: `this.NodeA.out(0).to(this.NodeB.in(0))`
- ✅ AI connections: Use `.uses()` for LangChain nodes
  - Single types: `ai_languageModel`, `ai_memory`, `ai_outputParser`, `ai_agent`, `ai_chain`, `ai_textSplitter`, `ai_embedding`, `ai_retriever`, `ai_reranker`, `ai_vectorStore`
  - Array types: `ai_tool`, `ai_document`
  - Example: `this.RAG.uses({ ai_embedding: this.Embedding.output, ai_vectorStore: this.VectorStore.output, ai_retriever: this.Retriever.output })`
- ❌ Never use `.out().to()` for AI sub-node connections

### AI Tool Nodes

When an AI agent uses tool nodes:

- ✅ Search for the exact tool node first.
- ✅ Run `npx --yes n8nac skills node-info <nodeName>` before writing parameters.
- ✅ Connect tool nodes as arrays: `this.Agent.uses({ ai_tool: [this.Tool.output] })`.
- ❌ Do not assume tool parameter names or reuse stale node-specific guidance.

---

## 📚 Available Tools


### 🔍 Unified Search (PRIMARY TOOL)
```bash
npx --yes n8nac skills search "google sheets"
npx --yes n8nac skills search "how to use RAG"
```
**ALWAYS START HERE.** Deep search across nodes, docs, and tutorials.

### 🛠️ Get Node Schema
```bash
npx --yes n8nac skills node-info googleSheets  # Complete info
npx --yes n8nac skills node-schema googleSheets  # Quick reference
```

### 🌐 Community Workflows
```bash
npx --yes n8nac skills examples search "slack notification"
npx --yes n8nac skills examples info 916
npx --yes n8nac skills examples download 4365
```

### 📖 Documentation
```bash
npx --yes n8nac skills docs "OpenAI"
npx --yes n8nac skills guides "webhook"
```

### ✅ Validate
```bash
npx --yes n8nac skills validate workflow.workflow.ts
```

### 🔎 Verify Live Workflow (post-push)
```bash
npx --yes n8nac verify <workflowId>          # Fetch from n8n + validate against schema
npx --yes n8nac push my-workflow.workflow.ts --verify   # Push then verify in one step
```
Catches runtime errors (invalid typeVersion, bad operation values, missing required params) **before** the user notices them in the UI.

---

## 🔑 Your Responsibilities

**#1**: Use `npx --yes n8nac skills` tools to prevent hallucinations
**#2**: Follow the exact schema - no assumptions, no guessing
**#3**: Create workflows that work on the first try

**When in doubt**: `npx --yes n8nac skills node-info <nodeName>`
<!-- n8n-as-code-end -->
