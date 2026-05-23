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
          // Forward parent env to the child MCP server. The SDK's default is a
          // sanitized minimal env (PATH only) which strips PERRY_VAULT_KEY,
          // PERRY_API_KEY, etc. — every secret the child
          // needs disappears, and Vault falls back to the hostname-derived
          // key in the child only, which is why the warning fired despite
          // the parent having the key set correctly.
          transport = new StdioClientTransport({
            command: srvConfig.command,
            args: srvConfig.args || [],
            env: process.env as Record<string, string>,
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

  getTools(allowedMcpServers?: string[]): Tool[] {
    const list = Array.from(this.availableTools.values());
    if (allowedMcpServers !== undefined) {
      return list
        .filter(t => allowedMcpServers.includes(t.serverId))
        .map(t => t.tool);
    }
    return list.map(t => t.tool);
  }

  getToolServer(name: string): string | null {
    const registration = this.availableTools.get(name);
    return registration ? registration.serverId : null;
  }

  getConnectedServers(): { id: string; status: 'connected' | 'disconnected'; tools: Tool[] }[] {
    const serversConfig = this.config.get<Record<string, McpServerConfig>>('ai.mcpServers', {});
    return Object.keys(serversConfig).map(id => {
      const isConnected = this.clients.has(id);
      const serverTools = Array.from(this.availableTools.values())
        .filter(t => t.serverId === id)
        .map(t => t.tool);
      return {
        id,
        status: isConnected ? 'connected' : 'disconnected',
        tools: serverTools,
      };
    });
  }
  async registerAndConnectServer(serverId: string, srvConfig: McpServerConfig): Promise<boolean> {
    try {
      this.config.set(`ai.mcpServers.${serverId}`, srvConfig);

      let transport;
      if (srvConfig.type === 'sse' && srvConfig.url) {
        transport = new SSEClientTransport(new URL(srvConfig.url));
      } else if (srvConfig.type === 'stdio' && srvConfig.command) {
        transport = new StdioClientTransport({
          command: srvConfig.command,
          args: srvConfig.args || [],
          env: process.env as Record<string, string>,
        });
      } else {
        this.log.warn(`Invalid dynamic MCP config for ${serverId}`);
        return false;
      }

      const client = new Client({ name: 'perry-local-agent', version: '1.0.0' }, { capabilities: {} });
      await client.connect(transport);

      const existingClient = this.clients.get(serverId);
      if (existingClient) {
        try {
          await existingClient.close();
        } catch (closeErr: any) {
          this.log.error(`Error closing existing MCP client for ${serverId}:`, closeErr);
        }
      }

      this.clients.set(serverId, client);
      this.log.info(`Connected dynamically to MCP server: ${serverId}`);

      for (const [toolName, reg] of this.availableTools.entries()) {
        if (reg.serverId === serverId) {
          this.availableTools.delete(toolName);
        }
      }

      const { tools } = await client.listTools();
      for (const tool of tools) {
        this.availableTools.set(tool.name, { serverId, tool });
      }

      return true;
    } catch (err: any) {
      this.log.error(`Failed to dynamically connect to MCP server ${serverId}:`, { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
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
