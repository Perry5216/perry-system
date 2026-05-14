import type { Logger, McpClientService, Project } from '@perry/core';
import type { AIRouter } from '@perry/ai';
import type { ContextEngine } from '@perry/rag';
import type { StateStore } from './state-store.js';

export class DirectorAgent {
  private router: AIRouter;
  private stateStore: StateStore;
  private mcpClient: McpClientService;
  private contextEngine: ContextEngine;
  private log: Logger;

  constructor(
    router: AIRouter,
    stateStore: StateStore,
    mcpClient: McpClientService,
    contextEngine: ContextEngine,
    log: Logger
  ) {
    this.router = router;
    this.stateStore = stateStore;
    this.mcpClient = mcpClient;
    this.contextEngine = contextEngine;
    this.log = log;
  }

  async chat(projectId: string, message: string): Promise<string> {
    const project = this.stateStore.get(projectId);
    if (!project) throw new Error('Project not found');

    // 1. Store the user's message
    this.stateStore.saveChatMessage(projectId, 'user', message);

    // 2. Fetch History
    const history = this.stateStore.getChatHistory(projectId);

    // 3. System Prompt
    const systemPrompt = `You are the AI Director for the P.E.R.R.Y. writing system. 
You are acting as an Executive Editor and Copilot for a human author.
You are currently managing the project: "${project.title}" (Type: ${project.type}).
Project Description: ${project.description || 'Not provided.'}

Your job is to discuss the project, brainstorm, and answer the author's questions. 
You have access to MCP tools to inspect the project database (SQLite) and filesystem.
Use tools when asked about specific chapters, character details, or to edit the project pipeline.
Respond concisely and creatively.`;

    // 4. Format Messages
    const messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; name?: string; tool_calls?: any[] }> = [];
    
    // Add history
    for (const h of history) {
      messages.push({ role: h.role as 'user' | 'assistant', content: h.content });
    }

    // 5. Tool Execution Loop
    let responseText = '';
    let toolLoopActive = true;
    let safetyCounter = 0;
    const availableTools = this.mcpClient.getTools();

    while (toolLoopActive && safetyCounter < 10) {
      safetyCounter++;
      this.log.info('Director LLM call', { safetyCounter, messagesCount: messages.length });

      const response = await this.router.complete({
        provider: this.router.config.get<string>('ai.director.provider', 'ollama'),
        model: this.router.config.get<string>('ai.ollama.directorModel', 'qwen3.6:27b'),
        system: systemPrompt,
        messages: messages,
        maxTokens: 4096,
        temperature: 0.7,
        tools: availableTools.length > 0 ? availableTools : undefined,
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        this.log.info(`Director requested ${response.toolCalls.length} tools`);
        
        messages.push({
          role: 'assistant',
          content: response.text || '',
          tool_calls: response.toolCalls
        });

        for (const tc of response.toolCalls) {
          try {
            const toolResult = await this.mcpClient.executeTool(tc.function.name, JSON.parse(tc.function.arguments));
            messages.push({
              role: 'tool',
              name: tc.function.name,
              content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
            });
          } catch (err: any) {
             messages.push({
              role: 'tool',
              name: tc.function.name,
              content: `Error executing tool: ${err.message}`
            });
          }
        }
      } else {
        responseText = response.text || '';
        toolLoopActive = false;
      }
    }

    if (!responseText) {
      responseText = "I'm sorry, I encountered an issue processing that request.";
    }

    // 6. Store Assistant Response
    this.stateStore.saveChatMessage(projectId, 'assistant', responseText);

    return responseText;
  }
}
