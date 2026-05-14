import type { Project, ProjectStep, Logger } from '@perry/core';
import type { ContextCompressor, BaseProvider } from '@perry/ai';
import type { ContextEngine } from '@perry/rag';

/**
 * @perry/projects — Librarian Agent
 *
 * Implements the "Pull Paradigm" (MCP Architecture).
 * Instead of PromptBuilder pushing 50k tokens of raw context onto the Writer,
 * the Librarian Agent uses Tool Calling to query the ContextEngine and
 * synthesizes a highly condensed Scene Briefing.
 */
export class LibrarianAgent {
  private compressor: ContextCompressor;
  private contextEngine: ContextEngine;
  private log: Logger;

  constructor(compressor: ContextCompressor, contextEngine: ContextEngine, log: Logger) {
    this.compressor = compressor;
    this.contextEngine = contextEngine;
    this.log = log.child('librarian-agent');
  }

  /**
   * Builds a tightly scoped Scene Briefing using direct context lookups.
   * Previously used Tool Calling but Gemma3:12b (Librarian GPU) does not support tools,
   * causing a 400 error on every call. Since the "tools" were just thin wrappers around
   * ContextEngine methods we already have access to, we now call them directly and skip
   * the provider round-trip for the data-gathering phase entirely.
   */
  async buildBriefing(project: Project, step: ProjectStep, provider: BaseProvider): Promise<string> {
    this.log.info('Librarian Agent building Scene Briefing (direct lookup)', { step: step.label });

    // ── Step 1: Gather data directly from the context engine (no tool calls needed) ──
    const characters = this.contextEngine.getCharacters(project.id);
    const summaries  = this.contextEngine.getSummaries(project.id);

    // Pull the most recent chapter summary for continuity
    const latestSummary = [...summaries].sort((a, b) => b.chapterNumber - a.chapterNumber)[0];

    // Extract character names mentioned in the step prompt to scope the lookup
    const mentionedChars = characters.filter(c =>
      step.prompt.toLowerCase().includes(c.name.toLowerCase()) ||
      (c.aliases || []).some((a: string) => step.prompt.toLowerCase().includes(a.toLowerCase()))
    ).slice(0, 3); // cap at 3 to keep briefing tight

    // Build a rich but compact data block — no LLM round-trip needed for this
    const charBlock = mentionedChars.length > 0
      ? mentionedChars.map(c => `**${c.name}**: ${JSON.stringify(c).slice(0, 400)}`).join('\n')
      : characters.slice(0, 2).map(c => `**${c.name}**: ${JSON.stringify(c).slice(0, 400)}`).join('\n');

    const summaryBlock = latestSummary
      ? `**Last chapter (Ch ${latestSummary.chapterNumber})**: ${JSON.stringify(latestSummary).slice(0, 600)}`
      : `No chapter summaries available yet.`;

    const synopsis = `Synopsis: ${project.description?.slice(0, 300) || 'Not defined'}\nWorldbuilding: ${project.context.planning?.slice(0, 300) || 'Not defined'}`;

    // ── Step 2: Ask the provider to synthesize a Scene Briefing from gathered data ──
    const systemPrompt = `You are the Librarian Agent. Synthesize the following raw data into a tightly scoped Scene Briefing (max 400 words) for the Writer model who is about to perform this task:

TASK: "${step.prompt.slice(0, 300)}"

Use ONLY the data provided below. Do not invent details. Output ONLY the briefing — no preamble.`;

    const dataMessage = `## PROJECT\n${synopsis}\n\n## RELEVANT CHARACTERS\n${charBlock}\n\n## CONTINUITY\n${summaryBlock}`;

    try {
      const response = await provider.complete({
        provider: provider.id,
        system: systemPrompt,
        messages: [{ role: 'user', content: dataMessage }],
        maxTokens: 600,
        temperature: 0.1,
        // NO tools — Gemma3 and many local models do not support tool calling
      });
      return response.text || '[Librarian: empty briefing returned]';
    } catch (err: any) {
      this.log.error('Librarian Agent failed', { error: err.message });
      // Non-fatal: return empty so the writer gets no briefing rather than crashing
      return `[Librarian briefing unavailable: ${err.message}]`;
    }
  }
}
