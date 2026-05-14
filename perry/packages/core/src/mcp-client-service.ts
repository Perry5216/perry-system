import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ConfigService } from './config.js';
import type { Logger } from './logger.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface McpServerConfig {
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
}

export class McpClientService {
  private config: ConfigService;
  private log: Logger;
  private clients: Map<string, Client> = new Map();
  private availableTools: Map<string, { serverId: string; tool: Tool }> = new Map();

  constructor(config: ConfigService, log: Logger) {
    this.config = config;
    this.log = log;
  }

  async initialize(): Promise<void> {
    if (process.env.IS_MCP_SERVER === 'true') {
      this.log.debug('Skipping MCP Client initialization (running inside MCP Server)');
      return;
    }

    const servers = this.config.get<Record<string, McpServerConfig>>('ai.mcpServers', {});
    
    for (const [serverId, srvConfig] of Object.entries(servers)) {
      try {
        let transport;
        
        if (srvConfig.type === 'sse' && srvConfig.url) {
          transport = new SSEClientTransport(new URL(srvConfig.url));
        } else if (srvConfig.type === 'stdio' && srvConfig.command) {
          transport = new StdioClientTransport({
            command: srvConfig.command,
            args: srvConfig.args || []
          });
        } else {
          this.log.warn(`Invalid MCP config for ${serverId}`);
          continue;
        }

        const client = new Client({ name: 'perry-local-agent', version: '1.0.0' }, { capabilities: {} });
        await client.connect(transport);
        this.clients.set(serverId, client);
        this.log.info(`Connected to MCP server: ${serverId}`);

        // Fetch available tools
        const { tools } = await client.listTools();
        for (const tool of tools) {
          this.availableTools.set(tool.name, { serverId, tool });
        }
      } catch (err) {
        this.log.error(`Failed to connect to MCP server: ${serverId}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  getTools(): Tool[] {
    return Array.from(this.availableTools.values()).map(t => t.tool);
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<any> {
    const registration = this.availableTools.get(name);
    if (!registration) {
      throw new Error(`Tool ${name} is not available.`);
    }

    const client = this.clients.get(registration.serverId);
    if (!client) {
      throw new Error(`MCP Client for server ${registration.serverId} not found.`);
    }

    this.log.debug(`Executing tool: ${name}`, { args });
    const result = await client.callTool({ name, arguments: args });
    return result;
  }
}
