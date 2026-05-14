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
import { MemoryStore, ContextEngine, EntityIndexer } from '@perry/rag';
import { ProjectEngine, StateStore } from '@perry/projects';
import { StyleDnaService } from '@perry/projects/src/services/style-dna-service.js';
import { join } from 'path';

async function bootstrap() {
  process.env.IS_MCP_SERVER = 'true';
  const log = new Logger('mcp', 'error'); // Keep stdout clean for MCP protocol

  // 1. Initialize P.E.R.R.Y. Core Services
  const WORKSPACE = process.env.PERRY_WORKSPACE || join(process.cwd(), 'workspace');
  const CONFIG_DIR = process.env.PERRY_CONFIG || join(process.cwd(), 'config');

  const config = new ConfigService(CONFIG_DIR);
  config.load();

  const vault = new Vault(join(CONFIG_DIR, '.vault'));
  vault.load();

  const eventBus = new EventBus();
  const aiRouter = new AIRouter(config, vault, log.child('ai'));
  await aiRouter.initialize();

  const memoryStore = new MemoryStore(WORKSPACE, log.child('memory'));
  await memoryStore.initialize();

  const contextEngine = new ContextEngine(WORKSPACE, memoryStore, log.child('context'));
  const stateStore = new StateStore(WORKSPACE, log.child('state'));
  await stateStore.initialize();

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
  
  const styleDnaService = new StyleDnaService(stateStore, log.child('dna'), WORKSPACE);

  // 2. Initialize MCP Server
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
    return {
      tools: [
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
      ],
    };
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
    
    // Using compileSeed to give the MCP client the actual rules the LLM follows
    const dnaSeed = styleDnaService.compileSeed(projectId, 1);
    
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
              text: JSON.stringify(projects.map(p => ({ id: p.id, title: p.title, status: p.status })), null, 2),
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

        // Fetch the raw context
        let payload = `Project: ${project.title}\n\nSYNOPSIS:\n${project.context.synopsis}\n\n`;
        payload += `WORLDBUILDING:\n${project.context.worldbuilding}\n\n`;
        payload += `CHARACTERS:\n${JSON.stringify(project.context.characters, null, 2)}\n\n`;
        
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
            const compressed = await aiRouter.compressor.compress(payload, 'context_briefing', 2048);
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
          profile += `**Attributes:** ${JSON.stringify(char.attributes, null, 2)}\n`;
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

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  });

  // 5. Start Server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

bootstrap().catch(err => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
