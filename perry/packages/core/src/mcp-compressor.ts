/**
 * MCP Tool Compressor — shrinks the tool surface sent to LLMs.
 *
 * Problem: MCP exposes ~20+ tools with full JSON schemas. Each tool's
 * `description` + parameters can be 200-1000 tokens. Send all of them in
 * every prompt and you burn 5-15k tokens before the model writes a word.
 * Multiply across thousands of invocations and it adds up.
 *
 * Solution (per-agent, declarative):
 *   - Each agent declares a `compression: 'none' | 'low' | 'medium' | 'high' | 'max'`
 *     level in the registry
 *   - At invocation time, the compressor transforms the tool list per that level
 *   - For high/max levels, agents see compact stubs + an auto-injected
 *     `get_tool_schema(name)` meta-tool to fetch full schemas on demand
 *
 * Inspired by atlassian-labs/mcp-compressor, but Perry-native:
 *   - No proxy hop (compression happens in-process)
 *   - Per-agent, not global
 *   - Tied to AgentRunner / registry, not standalone
 *   - Subscription-only safe — works identically for local Ollama models
 *     and CLI subscription workers
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type CompressionLevel = 'none' | 'low' | 'medium' | 'high' | 'max';

export interface CompressedToolList {
  /** The tool list to send to the LLM (already compressed per level). */
  tools: any[];
  /** Cached full schemas by tool name, served via the get_tool_schema
   *  meta-tool when the LLM asks for them. */
  fullSchemas: Map<string, any>;
  /** Approximate token count for the compressed tool list (rough estimate
   *  for diagnostics — uses ~4 chars per token heuristic). */
  estimatedTokens: number;
}

/**
 * Compress a tool list per the requested level.
 *
 * Levels:
 *   none   → no transformation (full schemas, full descriptions)
 *   low    → strip examples and verbose docs; keep types and required fields
 *   medium → drop optional args from schemas; trim descriptions to ~120 chars
 *   high   → compact stubs (name + 1-line summary); add get_tool_schema tool
 *   max    → names + types only; add get_tool_schema tool
 */
export function compressTools(
  tools: Tool[],
  level: CompressionLevel,
  allowList?: string[] | null,
): CompressedToolList {
  // Apply ACL first — agents only see tools they're permitted to use.
  let filtered: any[] = tools as any[];
  if (allowList !== null && allowList !== undefined) {
    const allow = new Set(allowList);
    filtered = filtered.filter((t: any) => allow.has(t?.name || t?.function?.name));
  }

  const fullSchemas = new Map<string, any>();
  for (const t of filtered) {
    const name = (t as any).name || (t as any).function?.name;
    if (name) fullSchemas.set(name, t);
  }

  if (level === 'none') {
    return { tools: filtered, fullSchemas, estimatedTokens: estimateTokens(filtered) };
  }

  const compressed = filtered.map(t => compressOne(t, level));

  // High/max levels also expose a `get_tool_schema` tool for on-demand
  // schema retrieval. AgentRunner intercepts calls to this tool.
  if (level === 'high' || level === 'max') {
    compressed.push({
      type: 'function',
      function: {
        name: 'get_tool_schema',
        description: 'Fetch the full schema (parameters + description) for one of the tools listed above. Use this BEFORE calling a tool when you need to know its exact argument structure. The compact tool list shows names + summaries; this returns the complete schema.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The tool name (one of those listed above)' },
          },
          required: ['name'],
        },
      },
    });
  }

  return {
    tools: compressed,
    fullSchemas,
    estimatedTokens: estimateTokens(compressed),
  };
}

function compressOne(tool: any, level: CompressionLevel): any {
  const fn = tool.function || tool;
  const name = fn.name || tool.name;
  const description = fn.description || tool.description || '';
  const params = fn.parameters || tool.inputSchema || {};

  switch (level) {
    case 'low':
      // Strip examples and trim description; keep schema shape.
      return wrapFunction(name, trimDescription(description, 400), stripExamples(params));

    case 'medium':
      // Drop optional args, trim description more aggressively.
      return wrapFunction(
        name,
        trimDescription(description, 120),
        keepOnlyRequired(params),
      );

    case 'high':
      // Name + 1-line summary, no parameters in the description (model uses get_tool_schema).
      return wrapFunction(
        name,
        trimDescription(description, 80) + ' (call get_tool_schema for full args)',
        // Provide a stub schema that just shows the tool exists and accepts an object.
        { type: 'object', properties: {}, additionalProperties: true },
      );

    case 'max':
      // Name only.
      return wrapFunction(
        name,
        'see get_tool_schema',
        { type: 'object', properties: {}, additionalProperties: true },
      );

    default:
      return tool;
  }
}

function wrapFunction(name: string, description: string, parameters: any): any {
  return { type: 'function', function: { name, description, parameters } };
}

function trimDescription(desc: string, max: number): string {
  if (!desc) return '';
  const clean = desc.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trim() + '…';
}

function stripExamples(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const copy: any = { ...schema };
  delete copy.examples;
  delete copy.example;
  if (copy.properties && typeof copy.properties === 'object') {
    copy.properties = Object.fromEntries(
      Object.entries(copy.properties).map(([k, v]) => [k, stripExamples(v)])
    );
  }
  return copy;
}

function keepOnlyRequired(schema: any): any {
  if (!schema || typeof schema !== 'object' || !schema.properties) return schema;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties)
        .filter(([k]) => required.has(k))
        .map(([k, v]) => [k, stripExamples(v)])
    ),
  };
}

function estimateTokens(tools: any[]): number {
  // Crude heuristic: ~4 chars per token. Accurate enough for diagnostics.
  const json = JSON.stringify(tools);
  return Math.ceil(json.length / 4);
}
