/**
 * @perry/projects — Prompt Builder
 *
 * Builds the user message for each project step. This is where the
 * Context Budget Manager and Librarian (ContextCompressor) are orchestrated.
 *
 * CRITICAL DESIGN RULE: The PromptBuilder ONLY uses project-scoped data.
 * No global memories. No skills. No heartbeat. No active project context.
 * This is the fix for V4's cross-project context bleed.
 */

import type {
  Project, ProjectStep, ContextBudget, ContextSlot, SlotPriority,
  BudgetReport, AIProvider, Logger,
} from '@perry/core';
import { ContextBudgetManager, ConfigService } from '@perry/core';
import type { ContextCompressor } from '@perry/ai';
import type { ContextEngine } from '@perry/rag';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { StateStore } from './state-store.js';
import type { StyleDnaService } from './services/style-dna-service.js';
import { HeuristicsService } from './services/heuristics-service.js';

import { LibrarianAgent } from './librarian-agent.js';

export class PromptBuilder {
  private budgetManager: ContextBudgetManager;
  private compressor: ContextCompressor | null;
  private contextEngine: ContextEngine;
  private stateStore: StateStore;
  private log: Logger;
  private workspaceDir: string;
  private styleDna: StyleDnaService | null;
  private heuristics: HeuristicsService;
  private config: ConfigService;
  private librarianAgent: LibrarianAgent | null = null;

  /**
   * Budget carry-forward: when a chapter uses less context than allocated,
   * the surplus (up to 20% of the base budget) is banked and added to
   * the next chapter's budget. This allows narratively denser later
   * chapters to include more context from earlier in the story.
   */
  private carryForward = new Map<string, number>();

  constructor(
    workspaceDir: string,
    contextEngine: ContextEngine,
    stateStore: StateStore,
    compressor: ContextCompressor | null,
    config: ConfigService,
    log: Logger,
    styleDna?: StyleDnaService,
  ) {
    this.workspaceDir = workspaceDir;
    this.budgetManager = new ContextBudgetManager();
    this.compressor = compressor;
    this.contextEngine = contextEngine;
    this.stateStore = stateStore;
    this.config = config;
    this.log = log;
    this.heuristics = new HeuristicsService(workspaceDir, log.child('heuristics'));
    this.styleDna = styleDna || null;
    if (this.compressor) {
      this.librarianAgent = new LibrarianAgent(this.compressor, this.contextEngine, this.log);
    }
  }

  /**
   * Build the complete user message for a project step.
   *
   * This is the most important method in the system. It determines what
   * context the Writer model sees. The pipeline:
   *
   * 1. Start with the step's prompt (P1 — always included)
   * 2. Gather context from ContextEngine (summaries, entities, threads)
   * 3. If Librarian is available, compress large context slots
   * 4. Feed everything into the BudgetManager for priority-based fitting
   * 5. Return the assembled message that fits within the provider's limits
   */
  async build(
    project: Project,
    step: ProjectStep,
    provider: AIProvider,
    systemPrompt: string,
    compressionMultiplier: number = 1.0,
  ): Promise<{ message: string; budgetReport: BudgetReport }> {
    // Calculate available budget
    const outputBudget = step.wordCountTarget
      ? Math.ceil(step.wordCountTarget * 1.3) // ~1.3 tokens per word
      : undefined;
    const budget = this.budgetManager.calculateBudget(provider, systemPrompt, outputBudget);

    // ── Context Watcher Feedback ──────────────────────────────────────
    // Scale the content budget by the compression multiplier from the GPU
    // context watcher. When the Writer GPU is under pressure (mult < 1.0),
    // shrink the budget so fewer/smaller slots are included, reducing
    // hallucination risk. When GPU has headroom (mult > 1.0), expand to
    // include more context for richer prose.
    if (compressionMultiplier !== 1.0) {
      const originalBudget = budget.availableForContent;
      budget.availableForContent = Math.floor(budget.availableForContent * compressionMultiplier);
      this.log.info('Context budget scaled by GPU pressure', {
        multiplier: compressionMultiplier,
        original: originalBudget,
        adjusted: budget.availableForContent,
      });
    }

    // ── Budget Carry-Forward ─────────────────────────────────────────
    // If the previous chapter underran its budget, apply a bonus here.
    // Capped at 20% of the base budget to prevent runaway expansion.
    const carry = this.carryForward.get(project.id) || 0;
    if (carry > 0) {
      const maxCarry = Math.floor(budget.availableForContent * 0.2);
      const applied = Math.min(carry, maxCarry);
      budget.availableForContent += applied;
      this.carryForward.set(project.id, carry - applied);
      this.log.info('Budget carry-forward applied', {
        banked: carry,
        applied,
        newBudget: budget.availableForContent,
      });
    }

    this.log.debug('Building prompt', {
      step: step.label,
      contextWindow: budget.modelContextWindow,
      available: budget.availableForContent,
    });

    // ── P1: Step prompt + project description (mandatory) ──
    const slots: ContextSlot[] = [];

    const stepPrompt = step.prompt;
    slots.push({
      label: 'Step Prompt',
      content: stepPrompt,
      priority: 1,
      tokenCount: 0, // Will be calculated by fillSlots
      compressible: false,
      included: false,
    });

    // BUG FIX N3: Skip Anti-Laziness Protocol for analytical/structured steps.
    // "NEVER summarize" directly conflicts with:
    //   - pov_check/analysis/stat_update: need concise grading reports, not exhaustive creative output
    //   - book_bible: needs tight Markdown tables, not verbose planning prose
    //   - outline: needs structured planning docs; Anti-Laziness causes narrative drift
    //   - voice_profile: needs structured targets + sample passages; Anti-Laziness causes prose rambling
    const isAnalyticalStep = ['pov_check', 'stat_update', 'continuity_check', 'revision_audit', 'analysis', 'book_bible', 'outline', 'voice_profile'].includes(step.taskType);
    const canSegment = ['creative_writing', 'revision_execution'].includes(step.taskType);
    if (!isAnalyticalStep) {
      slots.push({
        label: 'Anti-Laziness Protocol',
        content: `[ANTI-LAZINESS PROTOCOL: You must output FULL, exhaustive detail. NEVER use placeholders (e.g. "profiles will be similarly detailed"). NEVER summarize. Complete the ENTIRE requested structure no matter how long it takes.` +
          (canSegment ? ` If you are running out of memory, stop cleanly when you reach the limit.` : '') + `]`,
        priority: 1,
        tokenCount: 0,
        compressible: false,
        included: false,
      });
    }

    // ── Global Anti-Patterns ──
    // BUG FIX: Do not inject forbidden names/cliches into planning steps. 
    // It causes infinite reasoning loops if the model accidentally generates a banned word.
    if (!isAnalyticalStep) {
      slots.push({
        label: 'Global Anti-Patterns',
        content: `[ANTI-PATTERNS (FORBIDDEN NAMES & PHRASES): The following are overused AI defaults and are strictly banned. Do NOT use them:
  - Names: Chen, Sarah Chen, Elara, Lyra, Jasper, Lena, Zara, Zane, Niko, Lila, Mira, Leo.
  - AI-isms/Clichés: "a testament to", "tapestry", "symphony", "palpable", "delve", "echoed", "cacophony", "labyrinth", "dance of blades".
  - Melodrama: "a shiver ran down his spine", "his blood ran cold", "heart hammered in his chest", "let out a breath he didn't know he was holding".]`,
        priority: 1,
        tokenCount: 0,
        compressible: false,
        included: false,
      });
    }

    // ── Prose Style Controls (apply to all writing steps) ──
    if (canSegment) {
      slots.push({
        label: 'Prose Style Controls',
        content: `[PROSE STYLE CONTROLS — ALL RULES ARE HARD CONSTRAINTS, NOT SUGGESTIONS]\n` +
          `1. EM DASH DISCIPLINE: You are PROHIBITED from using more than 1 em dash (—) per 500 words. ` +
          `Em dashes are reserved for sharp interruptions only. In all other cases, use commas, semicolons, colons, periods, or parentheses. ` +
          `NEVER place two em-dash clauses in the same sentence.\n` +
          `2. WORD REPETITION BAN: No single common noun, verb, or adjective may appear more than 4 times per 500 words. ` +
          `This includes environment-specific words like "node", "lattice", "static", "pulse", "core". ` +
          `If you reach the limit, use a synonym or restructure the sentence. Count as you write.\n` +
          `3. PHRASE REPETITION BAN: Do NOT repeat the same phrase, metaphor, or motif more than ONCE per segment. ` +
          `If you have used a phrase (e.g., "the lattice shuddered"), it is now retired for this segment.\n` +
          `4. DIALOGUE REQUIREMENT: Every segment MUST contain at least one exchange of direct speech or italicised internal voice. Pure narration with no voice is FORBIDDEN.\n` +
          `5. SENTENCE VARIETY: Vary sentence length and structure. Do NOT start 3 consecutive sentences with the same word or pattern.`,
        priority: 1,
        tokenCount: 0,
        compressible: false,
        included: false,
      });
    }

    slots.push({
      label: 'Project Description',
      content: `## Project: ${project.title}\n\n${project.description}`,
      priority: 1,
      tokenCount: 0,
      compressible: false,
      included: false,
    });

    // ── Continuity Overrides (runtime corrections from quality gates) ──
    if (project.continuityOverrides && project.continuityOverrides.length > 0) {
      const overrideContent = `## CONTINUITY CORRECTIONS (MANDATORY)\n\n` +
        `The following corrections were identified by the Continuity Auditor. ` +
        `You MUST obey these in ALL output:\n\n` +
        project.continuityOverrides.map((o, i) => `${i + 1}. ${o}`).join('\n');

      slots.push({
        label: 'Continuity Overrides',
        content: overrideContent,
        priority: 1,
        tokenCount: 0,
        compressible: false,
        included: false,
      });
    }

    // ── Feature 3: Series Bible Auto-Inheritance ──
    // Style-calibration projects MUST NOT inherit parent planning context.
    // The Book Bible and outline are irrelevant to prose calibration — when injected,
    // they dominate the prompt (10 slots, ~56k tokens) and cause the model to analyse
    // the novel structure instead of grading/synthesising from the POV check reports.
    if (project.parentId && project.type !== 'style-calibration') {
      const parent = this.stateStore.get(project.parentId);
      if (parent) {
        let planningPhases = ['bible', 'outline', 'premise'];
        if (step.taskType === 'continuity_check') {
          planningPhases = ['bible', 'premise']; // Exclude outline to prevent spoilers
        } else if (step.phase === 'writing') {
          planningPhases = []; // Handled specifically by getWritingContextSlots
        }
        
        const parentPlanningSteps = parent.steps.filter(
          s => s.status === 'completed' && s.result && planningPhases.includes(s.phase),
        );
        for (const ps of parentPlanningSteps) {
          const compressed = await this.tryCompress(
            ps.result!,
            `Inherited from parent project "${parent.title}" for continuity. ${step.label}`,
            1024,
          );
          slots.push({
            label: `[Inherited] ${ps.label}`,
            content: compressed ? compressed : ps.result!,
            priority: 3,
            tokenCount: 0,
            compressible: false,
            compressedVersion: undefined,
            included: false,
          });
        }
        this.log.info('Inherited parent planning context', {
          parent: parent.title,
          stepsInherited: parentPlanningSteps.length,
        });
      }
    }

    // ── Style DNA ──
    // MOVED: Style DNA is now injected as a compact seed (~300 tokens) directly
    // into the system prompt by StepRunner.buildSystemPrompt(). This frees up
    // ~4,000 tokens in the user message budget for actual creative context.

    // ── BUG FIX #1: Skip RAG for style-calibration analysis steps ──
    // The ContextEngine is a semantic search engine. For calibration projects,
    // the Book Bible is the dominant indexed document, so it always wins the
    // similarity search and gets injected into POV checks and Summary steps,
    // causing the LLM to summarise the Bible instead of grading the prose.
    const isCalibrationAnalysis = project.type === 'style-calibration' &&
      (step.taskType === 'pov_check' || step.taskType === 'analysis');

    // ── P2-P4: Context from ContextEngine ──
    if (!isCalibrationAnalysis) {
      const contextSlots = await this.contextEngine.getContextSlots(
        project.id,
        step.id,
        step.chapterNumber,
      );

      for (const cs of contextSlots) {
        const compressedVersion = this.compressor
          ? await this.tryCompress(cs.content, step.label, 1024)
          : undefined;

        slots.push({
          label: cs.label,
          content: compressedVersion ? compressedVersion : cs.content,
          priority: cs.priority as SlotPriority,
          tokenCount: 0,
          compressible: false,
          compressedVersion: undefined,
          included: false,
        });
      }
    }

    // ── P2: Continuity check — inject each chapter as its own slot ──
    if (step.taskType === 'continuity_check') {
      const ccSlots = await this.getContinuityCheckSlots(project, step);
      slots.push(...ccSlots);
    } else if (step.taskType === 'revision_check') {
      // ── P2: Revision audit pass — inject chapter + POV findings + prior passes ──
      const revSlots = await this.getRevisionCheckSlots(project, step);
      slots.push(...revSlots);
    } else if (step.taskType === 'revision_execution') {
      // ── P2: Revision execution — inject action plan + original chapter + all audit findings ──
      const execSlots = await this.getRevisionExecutionSlots(project, step);
      slots.push(...execSlots);
    } else if (project.type === 'style-calibration' && step.taskType === 'analysis' && step.label.includes('Summary')) {
      // ── BUG FIX #2: Explicit routing for Calibration Summary steps ──
      // The Summary step has taskType='analysis' and phase='analysis', which
      // previously fell through to the generic else-branch and only got 1 POV
      // report (the immediately preceding step). Now it gets all 3 with P1 priority.
      const calSlots = await this.getCalibrationSummarySlots(project, step);
      slots.push(...calSlots);
    } else if (step.phase === 'writing' || step.taskType === 'pov_check' || step.taskType === 'stat_update' || (step.taskType === 'book_bible' && step.label.includes('Stat'))) {
      
      const librarianProvider = this.compressor?.getProvider();
      
      // ── THE PULL PARADIGM (MCP ARCHITECTURE) ──
      // If we have a Librarian Agent configured, and this is a creative writing step,
      // DO NOT push 50,000 tokens of raw context. Ask the Librarian to pull only what is needed.
      if (step.taskType === 'creative_writing' && this.librarianAgent && librarianProvider) {
        const briefing = await this.librarianAgent.buildBriefing(project, step, librarianProvider);
        slots.push({
          label: 'Librarian Scene Briefing',
          content: `## Scene Briefing\n\n${briefing}`,
          priority: 2,
          tokenCount: 0,
          compressible: false,
          included: false,
        });
        
        // We still need to give it the previous step results for flow
        const prevSteps = this.getPreviousStepResults(project, step);
        if (prevSteps) {
          slots.push({
            label: 'Previous Step Results',
            content: prevSteps,
            priority: 2,
            tokenCount: 0,
            compressible: false,
            included: false,
          });
        }
      } else {
        // ── LEGACY PUSH PARADIGM ──
        // P2-P5: Individually scoped writing context (Finding #1)
        const writingSlots = await this.getWritingContextSlots(project, step);
        slots.push(...writingSlots);
      }

      // ── Inject Chapter Text for Analysis Tasks ──
      if (step.taskType === 'pov_check' || step.taskType === 'stat_update') {
        const textToAnalyze = this.getChapterTextToAnalyze(project, step);
        if (textToAnalyze) {
          slots.push({
            label: 'Chapter Text to Analyze',
            content: `## Chapter Text to Analyze\n\n${textToAnalyze}`,
            priority: 1, // Highest priority
            tokenCount: 0,
            compressible: false, // Do not compress the text we are grading
            included: false,
          });
        }
      }
    } else {
      // ── P2: Previous step results (for sequential steps) ──
      const prevSteps = this.getPreviousStepResults(project, step);
      if (prevSteps) {
        const compressedVersion = this.compressor
          ? await this.tryCompress(prevSteps, step.label, 2048)
          : undefined;

        slots.push({
          label: 'Previous Step Results',
          content: compressedVersion ? compressedVersion : prevSteps,
          priority: 2,
          tokenCount: 0,
          compressible: false,
          compressedVersion: undefined,
          included: false,
        });
      }
    }

    // ── Fill slots within budget (V2: adaptive with re-compression) ──
    const report = this.budgetManager.fillSlotsAdaptive(budget, slots);

    // V2: Re-compress any slots that were slightly too large
    if (report.slotsNeedingRecompress.length > 0 && this.compressor) {
      for (const recomp of report.slotsNeedingRecompress) {
        const slot = report.slots.find(s => s.label === recomp.label);
        if (slot) {
          try {
            const result = await this.compressor.recompress(
              slot.content,
              recomp.targetTokens,
              step.label,
            );
            slot.content = result.compressed;
            slot.tokenCount = result.compressedTokens;
            this.log.info('Re-compressed slot to fit budget', {
              label: slot.label,
              targetTokens: recomp.targetTokens,
              actualTokens: result.compressedTokens,
            });
          } catch {
            // Re-compression failed — truncate at sentence boundary as last resort
            const maxChars = Math.floor(recomp.targetTokens * 3.5);
            const truncated = slot.content.substring(0, maxChars);
            const lastSentence = truncated.lastIndexOf('. ');
            slot.content = lastSentence > 0 ? truncated.substring(0, lastSentence + 1) : truncated;
            slot.tokenCount = recomp.targetTokens;
          }
        }
      }
    }

    // Assemble the final message
    const includedSlots = report.slots;
    let message = includedSlots.map(s => s.content).join('\n\n---\n\n');

    // ── Cognitive Lens Reinforcement (A2) ───────────────────────────────
    // The full Cognitive Lens is in the system prompt, but some providers
    // weight user messages more. Reinforce the most critical anti-AI directive
    // as the LAST thing the Writer sees before generating.
    if (step.taskType === 'creative_writing' || step.taskType === 'revision_execution') {
      message += '\n\n---\n\n**REMINDER**: Include 1-2 moments where the POV character misjudges, misremembers, or has a blind spot. Imperfect perception = human prose.';
      // NOTE: The old <pre_flight> XML block was REMOVED because it caused the fine-tuned
      // a.perry model to memorize and regurgitate constraint instructions as prose output.
      // Instead, use a simple output contract that anchors the first token.
      message += '\n\n**OUTPUT CONTRACT**: Your response must contain ONLY narrative prose. No instructions, no constraint lists, no XML tags, no HTML, no meta-commentary. Begin with the first word of the story. End sentences with periods, not ellipses.';
    }

    if (step.taskType === 'pov_check' || step.taskType === 'revision_audit') {
      // Reinforce the analytical role and format. Do NOT re-emit step.prompt here —
      // it already exists in the slots and repeating it wastes ~800 tokens.
      message += `\n\n---\n\n**OUTPUT CONTRACT**: You are an analytical grading engine. Evaluate ONLY the "Chapter Text to Analyze" section above. Return ONLY the structured evaluation format specified in the task prompt. Do not write story prose.`;
    }

    if (step.taskType === 'stat_update') {
      // stat_update is a tracking database, not a prose grader — needs its own framing.
      // Do NOT re-emit step.prompt — it already exists in the slots.
      message += `\n\n---\n\n**OUTPUT CONTRACT**: You are a live tracking database. Evaluate the chapter events above and output ONLY the structured tables (Sections A–G) specified in the task prompt. Begin immediately with Section A. No preamble, no commentary.`;
    }

    if (step.taskType === 'outline') {
      // Do NOT re-emit step.prompt — it already exists in the slots and repeating wastes tokens.
      message += `\n\n---\n\n**OUTPUT CONTRACT**: You are a fiction architect. BEGIN your output immediately with the first required section heading. Output ONLY the structured planning document — no preamble, no reasoning chains, no narrative prose.`;
    }

    if (step.taskType === 'book_bible') {
      // Positive framing only — negative constraints ("Do NOT...") cause some models
      // to fixate on the forbidden behaviour and reproduce it. Instead, state exactly
      // what the first token of output must be, leaving no ambiguity.
      const isStatStep = step.label.toLowerCase().includes('stat');
      if (isStatStep) {
        // Ultra-tight lock for Stat System Definition: the single biggest hallucination source.
        // The model MUST begin output immediately with the first section header, with zero preamble.
        message += `\n\n---\n\n**OUTPUT CONTRACT**: Your response MUST begin immediately with the line "## A. Character Stats" and contain ONLY the five Markdown table sections (A, B, C, D, E) requested above. Every section must be a properly formatted Markdown table. Output begins NOW:`;
      } else {
        // Do NOT re-emit step.prompt — already in slots. Just anchor the output start.
        message += `\n\n---\n\n**OUTPUT CONTRACT**: You are a structured data generator. BEGIN your output immediately with the first section heading. Every section must be fully populated with specific data from the project context. Output ONLY the structured document — no preamble, no commentary, no reasoning.`;
      }
    }

    if (report.droppedSlots.length > 0) {
      this.log.info('Context slots dropped (budget exhausted)', {
        dropped: report.droppedSlots,
        compressionApplied: report.compressionApplied,
        recompressed: report.slotsNeedingRecompress.map(r => r.label),
      });
    }

    this.log.info('Prompt built', {
      step: step.label,
      slotsIncluded: includedSlots.length,
      slotsDropped: report.droppedSlots.length,
      tokensUsed: report.used,
      tokensRemaining: report.remaining,
    });

    // Bank any underrun for the next chapter
    if (report.remaining > 0 && step.chapterNumber) {
      const currentCarry = this.carryForward.get(project.id) || 0;
      const maxBank = Math.floor(budget.availableForContent * 0.2);
      const newCarry = Math.min(currentCarry + report.remaining, maxBank);
      this.carryForward.set(project.id, newCarry);
      if (newCarry > 0) {
        this.log.debug('Budget underrun banked for next chapter', {
          remaining: report.remaining,
          banked: newCarry,
        });
      }
    }

    return { message, budgetReport: report };
  }

  /**
   * Clears the context budget carry-forward for a project.
   * Call this when a project is deleted or fully reset to prevent memory leaks.
   */
  clearProjectBudget(projectId: string): void {
    if (this.carryForward.has(projectId)) {
      this.carryForward.delete(projectId);
      this.log.debug('Cleared budget carry-forward map for project', { projectId });
    }
  }

  /**
   * Get relevant previous step results for the current step.
   * Only includes results from the same project — no cross-project bleed.
   *
   * OPTIMIZATION (Finding #1): Writing steps NO LONGER dump all planning
   * docs into one blob. Instead, use getWritingContextSlots() which returns
   * individually scoped, priority-ranked slots that the BudgetManager can
   * handle intelligently.
   */
  private getChapterTextToAnalyze(project: Project, currentStep: ProjectStep): string | null {
    if (currentStep.chapterNumber === undefined) return null;
    
    // Check if there is a compiled draft for this chapter
    const compiled = project.steps.find(s => 
      s.taskType === 'draft_compile' && 
      s.chapterNumber === currentStep.chapterNumber && 
      s.status === 'completed' && 
      s.result
    );
    if (compiled?.result) return compiled.result;

    // Fallback: concatenate segmented creative_writing steps
    const segments = project.steps
      .filter(s => s.taskType === 'creative_writing' && s.chapterNumber === currentStep.chapterNumber && s.status === 'completed' && s.result)
      .sort((a, b) => (a.segmentIndex || 0) - (b.segmentIndex || 0));
    
    if (segments.length > 0) {
      return segments.map(s => s.result).join('\n\n');
    }
    
    // Fallback for non-segmented legacy chapters
    const legacy = project.steps.find(s => 
      s.taskType === 'creative_writing' && 
      s.chapterNumber === currentStep.chapterNumber && 
      s.status === 'completed' && 
      s.result
    );
    return legacy?.result || null;
  }

  /**
   * Build context slots for a Style Calibration Summary step.
   *
   * Collects all three POV check reports for the current pass (Action,
   * Dialogue, Introspection) and injects them as P1-priority slots.
   * This replaces the generic getPreviousStepResults() fallback which
   * only returned the immediately preceding step (Bug Fix #2).
   */
  private async getCalibrationSummarySlots(
    project: Project,
    currentStep: ProjectStep,
  ): Promise<ContextSlot[]> {
    const slots: ContextSlot[] = [];
    const completedSteps = project.steps.filter(
      s => s.status === 'completed' && s.result && s.id !== currentStep.id,
    );

    // Extract pass number from label e.g. "Pass 1: Summary & Improvement Directives"
    const match = currentStep.label.match(/^Pass\s+(\d+):/i);
    if (!match) return slots;
    const passNum = match[1];
    const passRegex = new RegExp(`^Pass ${passNum}:`);

    // Collect all three POV check reports for this exact pass (anchored regex — Bug Fix #5)
    const povChecks = completedSteps.filter(
      s => s.taskType === 'pov_check' && passRegex.test(s.label)
    );

    for (const check of povChecks) {
      slots.push({
        label: `POV Check: ${check.label}`,
        content: `### ${check.label}\n\n${check.result}`,
        priority: 1, // Must NOT be compressed or dropped — this is the primary input
        tokenCount: 0,
        compressible: false,
        included: false,
      });
    }

    if (slots.length === 0) {
      this.log.warn('Calibration Summary: no POV check reports found for this pass', {
        pass: passNum, step: currentStep.label,
      });
    } else {
      this.log.info('Calibration Summary: injected POV check reports', {
        pass: passNum, count: slots.length, labels: povChecks.map(s => s.label),
      });
    }

    return slots;
  }

  /**
   * Get relevant previous step results for the current step.
   */
  private getPreviousStepResults(project: Project, currentStep: ProjectStep): string | null {
    const completedSteps = project.steps.filter(
      s => s.status === 'completed' && s.result && s.id !== currentStep.id,
    );

    if (completedSteps.length === 0) return null;

    // Writing steps are handled by getWritingContextSlots() — skip here
    if (currentStep.phase === 'writing') return null;

    // Continuity checks are handled by getContinuityCheckSlots() — skip here
    if (currentStep.taskType === 'continuity_check') return null;

    // For revision steps, include the last few writing step results
    if (currentStep.phase === 'revision') {
      const writing = completedSteps.filter(s => s.phase === 'writing');
      const recent = writing.slice(-3); // Last 3 chapters
      if (recent.length === 0) return null;
      return recent.map(s => `### ${s.label}\n${s.result}`).join('\n\n');
    }

    // For style calibration summary steps, include all POV checks for the current pass
    // BUG FIX #5: Anchored regex prevents "Pass 1:" matching "Pass 10:", "Pass 11:" etc.
    if (currentStep.taskType === 'analysis' && currentStep.label.includes('Summary & Improvement Directives')) {
      const match = currentStep.label.match(/^Pass\s+(\d+):/i);
      if (match) {
        const passNum = match[1];
        const povChecks = completedSteps.filter(s =>
          s.taskType === 'pov_check' && new RegExp(`^Pass ${passNum}:`).test(s.label)
        );
        if (povChecks.length > 0) {
          return povChecks.map(s => `### ${s.label}\n${s.result}`).join('\n\n');
        }
      }
    }

    // For other steps, include the immediately previous step
    const idx = project.steps.indexOf(currentStep);
    if (idx > 0) {
      const prev = project.steps[idx - 1];
      if (prev.result) return `### ${prev.label}\n${prev.result}`;
    }

    return null;
  }

  /**
   * Extract just the outline entry for a specific chapter number.
   * Instead of injecting the entire 18KB outline, this pulls only
   * the ~200-400 token section for the current chapter.
   */
  private async extractChapterOutline(fullOutline: string, chapterNumber: number): Promise<string | null> {
    // Fix 7: Extended extraction with Roman numeral and named chapter fallbacks.
    const romanNumerals = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
      'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
      'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV'];
    const roman = chapterNumber < romanNumerals.length ? romanNumerals[chapterNumber] : null;

    const patterns = [
      // Standard / Bolded: "# Chapter 7", "**CHAPTER 7**", or "Chapter 7"
      new RegExp(`((?:#{1,3}|\\*\\*)\\s*Chapter\\s+${chapterNumber}\\b[\\s\\S]*?)(?=(?:#{1,3}|\\*\\*)\\s*Chapter\\s+${chapterNumber + 1}\\b|$)`, 'i'),
      // Numeric: "7. Title" or "7: Title"
      new RegExp(`((?:#{1,3}|\\*\\*)\\s*${chapterNumber}[.:\\s][\\s\\S]*?)(?=(?:#{1,3}|\\*\\*)\\s*${chapterNumber + 1}[.:\\s]|$)`, 'i'),
      // Roman numeral: "Chapter VII"
      ...(roman ? [new RegExp(`((?:#{1,3}|\\*\\*)\\s*Chapter\\s+${roman}\\b[\\s\\S]*?)(?=(?:#{1,3}|\\*\\*)\\s*Chapter\\s+|$)`, 'i')] : []),
    ];

    for (const pattern of patterns) {
      const match = fullOutline.match(pattern);
      if (match && match[1] && match[1].trim().length > 50) {
        return match[1].trim();
      }
    }

    // Last-resort fallback: find any ## block that contains the chapter number
    const sections = fullOutline.split(/(?=#{1,3}\s)/);
    for (const section of sections) {
      if (new RegExp(`\\b${chapterNumber}\\b`).test(section.split('\n')[0])) {
        if (section.trim().length > 50) return section.trim();
      }
    }

    // Librarian fallback: if regex extraction failed and the Librarian is available,
    // ask it to extract the chapter section from the full outline
    if (this.compressor && this.compressor.isAvailable()) {
      try {
        this.log.info('Outline regex extraction failed — falling back to Librarian', { chapterNumber });
        const result = await this.compressor.buildBriefing(
          fullOutline,
          `Extract ONLY the outline section for Chapter ${chapterNumber}. Include all plot points, character arcs, and scene details for this chapter only. Do not include other chapters.`,
          2048,
        );
        if (result.compressed && result.compressed.trim().length > 50) {
          this.log.info('Librarian outline extraction succeeded', { chapterNumber, tokens: result.compressedTokens });
          return result.compressed.trim();
        }
      } catch (err: any) {
        this.log.warn('Librarian outline extraction failed', { chapterNumber, error: err.message });
      }
    }

    return null;
  }

  /**
   * Build individually scoped context slots for continuity checks.
   *
   * Each chapter gets its own slot so the BudgetManager can intelligently
   * fit as many as possible. Recent chapters (within 5 of the check point)
   * are injected at full resolution (P2). Older chapters are compressed
   * into summaries (P3) so the AI still has the thread but doesn't blow
   * the context window on 20+ full chapters.
   */
  private async getContinuityCheckSlots(
    project: Project,
    currentStep: ProjectStep,
  ): Promise<ContextSlot[]> {
    const slots: ContextSlot[] = [];
    const completedSteps = project.steps.filter(
      s => s.status === 'completed' && s.result && s.id !== currentStep.id,
    );
    const writingSteps = completedSteps.filter(s => s.phase === 'writing');

    if (writingSteps.length === 0) return slots;

    // Recent chapters get full text (last 5), older ones get compressed
    const recentCount = 5;
    const recentStart = Math.max(0, writingSteps.length - recentCount);

    for (let i = 0; i < writingSteps.length; i++) {
      const ws = writingSteps[i];
      const isRecent = i >= recentStart;

      if (isRecent) {
        // Recent chapters: full text, high priority, compressible as fallback
        const compressed = await this.tryCompress(
          ws.result!,
          `Continuity check — summarise ${ws.label} preserving all character names, locations, timeline events, and faction actions`,
          1024,
        );
        slots.push({
          label: `[Full] ${ws.label}`,
          content: `## ${ws.label}\n\n${ws.result}`,
          priority: 2,
          tokenCount: 0,
          compressible: !!compressed,
          compressedVersion: compressed,
          included: false,
        });
      } else {
        // Older chapters: compress to key facts, lower priority
        const compressed = await this.tryCompress(
          ws.result!,
          `Continuity check — summarise ${ws.label} preserving ALL character names, locations, timeline, key events, faction actions, and any items or plot threads introduced`,
          512,
        );
        slots.push({
          label: `[Summary] ${ws.label}`,
          content: compressed || `## ${ws.label}\n\n${ws.result}`,
          priority: 3,
          tokenCount: 0,
          compressible: false, // Already compressed (or using raw as last resort)
          included: false,
        });
      }
    }

    this.log.info('Continuity check slots built', {
      total: writingSteps.length,
      fullText: Math.min(recentCount, writingSteps.length),
      compressed: Math.max(0, writingSteps.length - recentCount),
    });

    return slots;
  }

  /**
   * Build individually scoped context slots for writing steps.
   * Each planning document becomes its own slot with appropriate priority
   * and compression budget, instead of being concatenated into one blob.
   *
   * This is the core of Finding #1 — the single biggest token optimization.
   */
  private async getWritingContextSlots(
    project: Project,
    currentStep: ProjectStep,
  ): Promise<ContextSlot[]> {
    const slots: ContextSlot[] = [];
    const completedSteps = project.steps.filter(
      s => s.status === 'completed' && s.result && s.id !== currentStep.id,
    );

    let parentSteps: ProjectStep[] = [];
    if (project.parentId) {
      const parent = this.stateStore.get(project.parentId);
      if (parent) {
        parentSteps = parent.steps.filter(s => s.status === 'completed' && s.result);
      }
    }

    const chapterNum = currentStep.chapterNumber || 0;
    const isWriting = currentStep.phase === 'writing';

    // ── BUG FIX #3: Style Calibration scenes must NOT receive novel-pipeline slots ──
    // Calibration chapters are numbered 101, 102, 103 (pass 1), 201, 202, 203 (pass 2), etc.
    // These chapter numbers don't exist in the parent novel outline, scene breakdown,
    // tension blueprint, or foreshadowing map. Injecting those slots causes the LLM to
    // receive malformed context ("Chapter 101: [not found]") and wastes Librarian calls.
    // Calibration writing steps only need: prior-pass directives + segment continuity.
    // Calibration pov_check steps only need: the chapter text to grade (injected separately).
    if (project.type === 'style-calibration') {
      // ── BUG FIX #4: inject prior-pass directives for BOTH writing AND pov_check ──
      // Previously only writing steps (isWriting) got the directives. POV checks for
      // Pass 2+ also need to know what was supposed to be fixed so they grade accordingly.
      const pass = Math.floor(chapterNum / 100);
      if (pass >= 2) {
        const priorSummaryChapter = (pass - 1) * 100 + 99;
        const priorSummary = completedSteps.find(
          s => s.taskType === 'analysis' && s.chapterNumber === priorSummaryChapter
        );
        if (priorSummary?.result) {
          slots.push({
            label: `Pass ${pass - 1} Improvement Directives`,
            content: `## MANDATORY IMPROVEMENT DIRECTIVES (from Pass ${pass - 1} Summary)\n\n` +
              `The following directives were generated from the previous pass's POV Quality Gate analysis. ` +
              `These are the SPECIFIC ISSUES the model must fix this pass. Treat every "AVOID" as a hard constraint.\n\n` +
              priorSummary.result,
            priority: 1,
            tokenCount: 0,
            compressible: false,
            included: false,
          });
        }
      }
      // P1 (calibration): Inject scene-state-locked continuation for Part 2
      const segmentIndex = currentStep.segmentIndex;
      if (isWriting && segmentIndex && segmentIndex > 1) {
        const prevStep = completedSteps.find(
          s => s.taskType === 'creative_writing' && s.chapterNumber === chapterNum && s.segmentIndex === segmentIndex - 1
        );
        if (prevStep?.result) {
          const prevText = prevStep.result;
          
          // Inject the full text of Part 1 as a read-only context so it knows what happened
          slots.push({
            label: `Story So Far — Part ${segmentIndex - 1}`,
            content:
              `## 📖 STORY SO FAR (PREVIOUS SEGMENT)\n` +
              `[READ THIS to know what already happened. DO NOT rewrite, repeat, or summarize any of this text.]\n` +
              `${'━'.repeat(60)}\n${prevText}\n${'━'.repeat(60)}\n`,
            priority: 1,
            tokenCount: 0,
            compressible: false,
            included: false,
          });

          const snapshot = this.buildSceneStateSnapshot(prevText);
          // Use only the last 3 sentences as the anchor — short enough the model
          // cannot echo it wholesale, long enough to continue cleanly.
          const prevSentences = (prevText.match(/[^.!?]+[.!?]+/g) || []).map(s => s.trim()).filter(Boolean);
          const tail = prevSentences.slice(-3).join(' ');
          slots.push({
            label: `Scene State Lock — Part ${segmentIndex - 1} End`,
            content:
              `## ⛔ SCENE STATE LOCK — Part 2 MUST HONOUR THIS EXACTLY\n` +
              `${'━'.repeat(60)}\n` +
              `${snapshot}\n` +
              `${'━'.repeat(60)}\n` +
              `⚠️ PROHIBITED IN PART 2:\n` +
              `- DO NOT repeat any distance, position, or spatial description already in Part 1\n` +
              `- DO NOT re-write the scene opening or re-introduce the POV character\n` +
              `- DO NOT cycle back to an action that already failed in Part 1\n` +
              `- DO NOT use the same prop in the same way twice\n` +
              `- Part 2 MUST advance: new position, new consequence, new information\n\n` +
              `## CONTINUATION — WRITE THE NEXT SENTENCE AFTER THIS EXACT ENDING:\n\n"...${tail}"`,
            priority: 1,
            tokenCount: 0,
            compressible: false,
            included: false,
          });
        }
      }
      // Return early — skip all novel-pipeline context slots below
      return slots;
    }

    // P1 (novel pipeline): Inject scene-state-locked continuation for Part 2
    const segmentIndex = currentStep.segmentIndex;
    if (isWriting && segmentIndex && segmentIndex > 1) {
      const prevStep = completedSteps.find(
        s => s.taskType === 'creative_writing' && s.chapterNumber === chapterNum && s.segmentIndex === segmentIndex - 1
      );
      if (prevStep?.result) {
        const prevText = prevStep.result;
        
        // Inject the full text of Part 1 as a read-only context so it knows what happened
        slots.push({
          label: `Story So Far — Part ${segmentIndex - 1}`,
          content:
            `## 📖 STORY SO FAR (PREVIOUS SEGMENT)\n` +
            `[READ THIS to know what already happened. DO NOT rewrite, repeat, or summarize any of this text.]\n` +
            `${'━'.repeat(60)}\n${prevText}\n${'━'.repeat(60)}\n`,
          priority: 1,
          tokenCount: 0,
          compressible: false,
          included: false,
        });

        const snapshot = this.buildSceneStateSnapshot(prevText);
        const prevSentences = (prevText.match(/[^.!?]+[.!?]+/g) || []).map(s => s.trim()).filter(Boolean);
        const tail = prevSentences.slice(-3).join(' ');
        slots.push({
          label: `Scene State Lock — Part ${segmentIndex - 1} End`,
          content:
            `## ⛔ SCENE STATE LOCK — Part 2 MUST HONOUR THIS EXACTLY\n` +
            `${'━'.repeat(60)}\n` +
            `${snapshot}\n` +
            `${'━'.repeat(60)}\n` +
            `⚠️ PROHIBITED IN PART 2:\n` +
            `- DO NOT repeat any distance, position, or spatial description already in Part 1\n` +
            `- DO NOT re-write the scene opening or re-introduce the POV character\n` +
            `- DO NOT cycle back to an action that already failed in Part 1\n` +
            `- DO NOT use the same prop in the same way twice\n` +
            `- Part 2 MUST advance: new position, new consequence, new information\n\n` +
            `## CONTINUATION — WRITE THE NEXT SENTENCE AFTER THIS EXACT ENDING:\n\n"...${tail}"`,
          priority: 1,
          tokenCount: 0,
          compressible: false,
          included: false,
        });
      }
    }

    // ── Novel pipeline: inject prior-pass Summary directives (legacy path, kept for completeness) ──
    // (Style Calibration now handled by the early-return block above.)

    // P2: Current chapter's outline section ONLY (not the entire outline)
    const outlineStep = parentSteps.find(s => s.label.includes('Outline') && s.phase === 'outline') || completedSteps.find(s => s.label.includes('Outline') && s.phase === 'outline');
    if (outlineStep?.result) {
      const section = await this.extractChapterOutline(outlineStep.result, chapterNum);
      if (section) {
        slots.push({
          label: 'Chapter Outline (Current)',
          content: `## Outline for Chapter ${chapterNum}\n\n${section}`,
          priority: 2,
          tokenCount: 0,
          compressible: false, // Already small — don't waste a Librarian call
          included: false,
        });
      }
    }

    // P2: Scene-Level Breakdown for this chapter (replaces thin outline with granular scenes)
    const sceneStep = parentSteps.find(s => s.label === 'Scene-Level Breakdown') || completedSteps.find(s => s.label === 'Scene-Level Breakdown');
    if (sceneStep?.result) {
      const sceneSection = await this.extractChapterOutline(sceneStep.result, chapterNum);
      if (sceneSection) {
        slots.push({
          label: 'Scene Breakdown (Current)',
          content: `## Scene Blueprint for Chapter ${chapterNum}\n\nFollow this scene-by-scene breakdown. Each scene has a word budget, entry/exit points, and foreshadowing requirements.\n\n${sceneSection}`,
          priority: 2,
          tokenCount: 0,
          compressible: false,
          included: false,
        });
      }
    }

    // P2: Tension Blueprint target for this chapter
    const tensionStep = parentSteps.find(s => s.label === 'Tension Blueprint') || completedSteps.find(s => s.label === 'Tension Blueprint');
    if (isWriting && tensionStep?.result) {
      // Extract this chapter's row from the tension table using an index so we can
      // also grab any prose annotation on the line immediately below (beat type notes,
      // valley warnings, etc.) — these give the writer structural intent beyond the number.
      const tensionLines = tensionStep.result.split('\n');
      const rowIdx = tensionLines.findIndex(line => {
        const match = line.match(/^\|?\s*(?:Chapter\s+)?(\d+)\s*\|/i);
        return match && parseInt(match[1], 10) === chapterNum;
      });
      if (rowIdx !== -1) {
        const chapterRow = tensionLines[rowIdx];
        const nextLine = tensionLines[rowIdx + 1] ?? '';
        const proseNote = !nextLine.startsWith('|') && nextLine.trim().length > 0
          ? `\n\n**Structural Note**: ${nextLine.trim().substring(0, 250)}`
          : '';
        slots.push({
          label: 'Tension Target',
          content: `## Tension Target for Chapter ${chapterNum}\n\n${chapterRow}${proseNote}\n\nMatch this tension level in your prose. High tension = short sentences, rapid dialogue, visceral action. Low tension = longer sentences, atmosphere, introspection.`,
          priority: 2,
          tokenCount: 0,
          compressible: false,
          included: false,
        });
      }
    }

    // P2: Foreshadowing seeds relevant to this chapter (plants + payoffs)
    const foreshadowStep = parentSteps.find(s => s.label.includes('Foreshadowing')) || completedSteps.find(s => s.label.includes('Foreshadowing'));
    if ((isWriting || currentStep.label.includes('Stat')) && foreshadowStep?.result) {
      if (currentStep.label.includes('Stat')) {
        // Stat Definition needs the FULL foreshadowing table, not filtered by chapter
        slots.push({
          label: 'Foreshadowing & Payoff Map (Full)',
          content: `## Foreshadowing & Payoff Map\n\n${foreshadowStep.result}`,
          priority: 2,
          tokenCount: 0,
          compressible: true,
          compressedVersion: await this.tryCompress(
            foreshadowStep.result,
            `Full foreshadowing map — preserve all seed IDs, plant chapters, payoff chapters`,
            1024,
          ),
          included: false,
        });
      } else {
        // Writing steps: filter to just the seeds relevant to this chapter
        const fLines = foreshadowStep.result.split('\n');
        const relevantSeeds = fLines.filter(line => {
          // Match rows where this chapter is the plant or payoff chapter
          const chPattern = new RegExp(`\\b(?:Ch(?:apter)?\\s*)?${chapterNum}\\b`, 'i');
          return line.includes('|') && chPattern.test(line) && !line.match(/^[\s|]*[-:]+[\s|]*$/);
        });
        if (relevantSeeds.length > 0) {
          // Find the header row
          const headerRow = fLines.find(line => /seed\s*id/i.test(line) && line.includes('|'));
          const seedContent = headerRow
            ? `${headerRow}\n${fLines.find(l => l.match(/^[\s|]*[-:]+[\s|]*$/)) || ''}\n${relevantSeeds.join('\n')}`
            : relevantSeeds.join('\n');

          slots.push({
            label: 'Foreshadowing Seeds (This Chapter)',
            content: `## Foreshadowing for Chapter ${chapterNum}\n\nThe following seeds must be PLANTED or PAID OFF in this chapter. Weave them naturally into the prose — they should feel organic, not forced.\n\n${seedContent}`,
            priority: 2,
            tokenCount: 0,
            compressible: false,
            included: false,
          });
        }
      }
    }

    // P2: Chapter Echo — last ~300 words of previous chapter for emotional continuity
    if (isWriting && chapterNum > 0) {
      const segmentIndex = currentStep.segmentIndex;
      // Only inject chapter echo for the FIRST segment of a chapter (or non-segmented chapters)
      if (!segmentIndex || segmentIndex === 1) {
        const prevChapterSteps = completedSteps.filter(
          s => s.chapterNumber === chapterNum - 1 &&
            (s.taskType === 'creative_writing' || s.taskType === 'draft_compile' || s.taskType === 'revision_execution'),
        );
        // Pick the compiled draft if available, otherwise the last writing segment
        const prevChapter = prevChapterSteps.find(s => s.taskType === 'draft_compile') || prevChapterSteps[prevChapterSteps.length - 1];
        if (prevChapter?.result) {
          // 300 words gives ~2 full paragraphs of prose context — enough to establish
          // tone, last sentence, and scene state for a clean narrative continuation.
          // Previously 200 words was too short for multi-POV novels where chapter
          // boundaries often fall mid-scene.
          const prevWords = prevChapter.result.split(/\s+/);
          const tail = prevWords.slice(-300).join(' ');
          const prevLabel = chapterNum === 1 ? 'Prologue' : `Chapter ${chapterNum - 1}`;
          slots.push({
            label: `Chapter Echo (${prevLabel})`,
            content: `## End of ${prevLabel} (for emotional continuity — pick up the thread exactly where this leaves off)\n\n...${tail}`,
            priority: 2,
            tokenCount: 0,
            compressible: false,
            included: false,
          });
        }
      }
    }

    // P2: Narrative Directives from the most recent stat update (POV-scoped prose instructions)
    // P3: Full stat table (compressible fallback for reference)
    const statSteps = completedSteps.filter(s => s.taskType === 'stat_update' || s.label.includes('Stat'));
    const lastStat = statSteps[statSteps.length - 1];
    if (lastStat?.result) {
      // BUG FIX #7: Extract Section G (Narrative Directives) — was incorrectly matching ## F.
      // The stat_update prompt defines this as Section G, not Section F.
      // This was silently returning undefined, meaning every chapter was written without
      // POV-scoped stat directives — a critical context injection failure.
      const directivesMatch = lastStat.result.match(/##\s*G\.?\s*NARRATIVE DIRECTIVES[\s\S]*$/i);
      if (isWriting && directivesMatch) {
        slots.push({
          // Consistent label/heading: matches what the model produced so it reads coherently in context
          label: 'G. Narrative Directives (POV-Scoped)',
          content: `## G. NARRATIVE DIRECTIVES (from Live Stat System)\n\nThe following directives tell you HOW to write each character in this chapter based on their current stat levels and relationship dynamics. Follow these exactly.\n\n${directivesMatch[0]}`,
          priority: 2,
          tokenCount: 0,
          compressible: false, // Actionable prose instructions — must be preserved exactly
          included: false,
        });
      }

      // Extract Faction Reputation (Section B of stat updates) for NPC behaviour
      // BUG FIX #7b: Tightened regex — was matching 'FACTION REPUTATION' anywhere in the document
      // (including from the Stat Definition output injected as context), causing the wrong
      // reputation table to be used. Now anchored to Section B of stat update output.
      const reputationMatch = lastStat.result.match(/##\s*B\.?\s*Faction Reputation[\s\S]*?(?=##\s*[C-Z]\.?|$)/i);
      if (isWriting && reputationMatch) {
        slots.push({
          label: 'B. Faction Reputation (NPC Reactions)',
          content: `## B. FACTION REPUTATION (from Live Stat System)\n\nThese reputation levels MUST govern how NPCs from each faction interact with the POV character. Hostile = suspicious, withholds information, may obstruct. Revered = defers, shares secrets, offers aid.\n\n${reputationMatch[0]}`,
          priority: 2,
          tokenCount: 0,
          compressible: false,
          included: false,
        });
      }

      // Full stat table as lower-priority reference
      const compressed = await this.tryCompress(
        lastStat.result,
        `Latest stat update — preserve character stat values, relationship dynamics, foreshadowing status`,
        512,
      );
      slots.push({
        label: 'Latest Stat Snapshot (Full)',
        content: `## Live Tracking Status\n\n${lastStat.result}`,
        priority: 3,
        tokenCount: 0,
        compressible: !!compressed,
        compressedVersion: compressed,
        included: false,
      });
    }

    // P2: Voice Profile — injected as high-priority style reference
    const voiceStep = parentSteps.find(s => s.taskType === 'voice_profile') || completedSteps.find(s => s.taskType === 'voice_profile');
    if (isWriting && voiceStep?.result) {
      slots.push({
        label: 'Voice Profile',
        content: `## VOICE PROFILE (Style Reference)\n\nThe following voice profile defines the EXACT prose style for this novel. ` +
          `Match the rhythm, vocabulary, and tone of the sample passages. ` +
          `Avoid all listed anti-patterns.\n\n${voiceStep.result}`,
        priority: 2,
        tokenCount: 0,
        compressible: false, // Voice samples must be preserved exactly
        included: false,
      });
    }

    // P3: Character Bible — compress to key facts only
    const bibleStep = parentSteps.find(s => s.label === 'Character Bible') || completedSteps.find(s => s.label === 'Character Bible');
    if (bibleStep?.result) {
      const compressed = await this.tryCompress(
        bibleStep.result,
        `Write Chapter ${chapterNum} — need character names, roles, relationships, faction allegiance`,
        1024,
      );
      slots.push({
        label: 'Character Bible',
        content: bibleStep.result,
        priority: 3,
        tokenCount: 0,
        compressible: !!compressed,
        compressedVersion: compressed,
        included: false,
      });
    }

    // P3: Faction Bible — compress to power dynamics, territories, and inter-faction rules
    const factionStep = parentSteps.find(s => s.label === 'Faction Bible') || completedSteps.find(s => s.label === 'Faction Bible');
    if (factionStep?.result) {
      const compressed = await this.tryCompress(
        factionStep.result,
        `Write Chapter ${chapterNum} — need faction names, hierarchies, power dynamics, territories, alliance/rivalry status`,
        768,
      );
      slots.push({
        label: 'Faction Bible',
        content: factionStep.result,
        priority: 3,
        tokenCount: 0,
        compressible: !!compressed,
        compressedVersion: compressed,
        included: false,
      });
    }

    // P4: World Building — compress to setting essentials
    const worldStep = parentSteps.find(s => s.label === 'World Building') || completedSteps.find(s => s.label === 'World Building');
    if (worldStep?.result) {
      const compressed = await this.tryCompress(
        worldStep.result,
        `Write Chapter ${chapterNum} — need locations, faction territories, rules, technology`,
        512,
      );
      slots.push({
        label: 'World Building',
        content: worldStep.result,
        priority: 4,
        tokenCount: 0,
        compressible: !!compressed,
        compressedVersion: compressed,
        included: false,
      });
    }

    // P5: Subplots — lowest priority, most compressible
    const subplotStep = parentSteps.find(s => s.label.includes('Subplot')) || completedSteps.find(s => s.label.includes('Subplot'));
    if (subplotStep?.result) {
      const compressed = await this.tryCompress(
        subplotStep.result,
        `Write Chapter ${chapterNum} — need active B/C-story threads for this chapter`,
        512,
      );
      slots.push({
        label: 'Subplot Arcs',
        content: subplotStep.result,
        priority: 5,
        tokenCount: 0,
        compressible: !!compressed,
        compressedVersion: compressed,
        included: false,
      });
    }

    return slots;
  }

  /**
   * Build context slots for revision_check steps.
   *
   * Priority stack for each revision pass:
   *   P1 — The chapter's prose text (what is being audited)
   *   P1 — The chapter's POV check result (what the gate already found — don't repeat)
   *   P2 — Prior revision passes for this chapter (A–G feed into Pass H)
   *   P3 — Manuscript-level audits (Structural Arc, Character Arc, Thematic Cohesion)
   */
  private async getRevisionCheckSlots(
    project: Project,
    currentStep: ProjectStep,
  ): Promise<ContextSlot[]> {
    const slots: ContextSlot[] = [];
    const chapterNum = currentStep.chapterNumber;
    const familyCompleted = this.getFamilyCompletedSteps(project.id).filter(
      s => s.id !== currentStep.id
    );

    // ── P1: The chapter text itself ──
    const chapterStep = familyCompleted.find(
      s => s.taskType === 'draft_compile' && s.chapterNumber === chapterNum
    ) || familyCompleted.find(
      s => s.taskType === 'creative_writing' && s.chapterNumber === chapterNum
    );
    
    if (chapterStep?.result) {
      slots.push({
        label: `Chapter ${chapterNum} — Full Text`,
        content: `## Chapter ${chapterNum} (Source Text)\n\n${chapterStep.result}`,
        priority: 1,
        tokenCount: 0,
        compressible: false,
        included: false,
      });
    }

    // ── P1: POV check findings for this chapter ──
    const povCheck = familyCompleted.find(
      s => s.taskType === 'pov_check' && s.chapterNumber === chapterNum,
    );
    if (povCheck?.result) {
      slots.push({
        label: `Chapter ${chapterNum} — POV Check Findings`,
        content: `## POV Quality Gate Findings (Chapter ${chapterNum})\n\nThese have ALREADY been identified. Do NOT repeat them — build on them or cross-reference patterns.\n\n${povCheck.result}`,
        priority: 1,
        tokenCount: 0,
        compressible: true,
        compressedVersion: await this.tryCompress(
          povCheck.result,
          `POV check summary for Chapter ${chapterNum} — preserve scores, filter words, show/tell violations, plot threads stalled`,
          512,
        ),
        included: false,
      });
    }

    // ── P2: Prior revision passes for this chapter (A–G feed into H) ──
    const revisionPasses = familyCompleted.filter(
      s => s.taskType === 'revision_check' && s.chapterNumber === chapterNum,
    );
    for (const pass of revisionPasses) {
      const compressed = await this.tryCompress(
        pass.result!,
        `Revision audit pass summary for Chapter ${chapterNum} — preserve verdict, key issues, scores`,
        512,
      );
      slots.push({
        label: `[Prior Pass] ${pass.label}`,
        content: `## ${pass.label}\n\n${pass.result}`,
        priority: 2,
        tokenCount: 0,
        compressible: !!compressed,
        compressedVersion: compressed,
        included: false,
      });
    }

    // ── P3: Manuscript-level audit results as background context ──
    const manuscriptAudits = familyCompleted.filter(
      s => s.phase === 'analysis' && s.taskType === 'analysis' &&
        (s.label === 'Structural Arc Audit' ||
         s.label === 'Character Arc Tracker' ||
         s.label === 'Thematic Cohesion Report'),
    );
    for (const audit of manuscriptAudits) {
      const compressed = await this.tryCompress(
        audit.result!,
        `${audit.label} — key findings relevant to Chapter ${chapterNum}`,
        512,
      );
      slots.push({
        label: `[Manuscript] ${audit.label}`,
        content: `## ${audit.label}\n\n${audit.result}`,
        priority: 3,
        tokenCount: 0,
        compressible: !!compressed,
        compressedVersion: compressed,
        included: false,
      });
    }

    this.log.info('Revision check slots built', {
      chapter: chapterNum,
      hasChapterText: !!chapterStep,
      hasPovCheck: !!povCheck,
      priorPasses: revisionPasses.length,
      manuscriptAudits: manuscriptAudits.length,
    });

    return slots;
  }

  /**
   * Build context slots for revision_execution steps.
   *
   * Pulls from the PARENT Deep Revision project:
   *   P1 — Revision Action Plan (the synthesised directive for all chapters)
   *   P1 — This chapter's Pass H Revision Brief (the specific verdict + issues)
   *   P1 — Original chapter prose (from the novel-pipeline grandparent or parent)
   *   P2 — All specialist passes A–G for this chapter (full audit context)
   *   P2 — POV check findings for this chapter
   *   P3 — Manuscript-level audits (Structural Arc, Character Arc, Thematic Cohesion)
   */
  private getFamilyCompletedSteps(projectId: string): ProjectStep[] {
    const projects = this.stateStore.list();
    const findRoot = (id: string, all: Project[]): string => {
      const p = all.find(pr => pr.id === id);
      if (!p || !p.parentId) return id;
      return findRoot(p.parentId, all);
    };
    const rootId = findRoot(projectId, projects);
    const family = projects.filter(p => p.id === rootId || findRoot(p.id, projects) === rootId);
    return family.flatMap(p => p.steps.filter(s => s.status === 'completed' && s.result));
  }

  private async getRevisionExecutionSlots(
    project: Project,
    currentStep: ProjectStep,
  ): Promise<ContextSlot[]> {
    const slots: ContextSlot[] = [];
    const chapterNum = currentStep.chapterNumber;
    const isPrologue = chapterNum === 0;
    const isEpilogue = chapterNum !== undefined && project.context.targetChapters !== undefined && chapterNum > project.context.targetChapters;
    const chName = isPrologue ? 'Prologue' : isEpilogue ? 'Epilogue' : `Chapter ${chapterNum}`;
    const familyCompleted = this.getFamilyCompletedSteps(project.id);

    // ── P1: Revision Action Plan (step 1 of the execution project) ──
    const actionPlan = project.steps.find(
      s => s.label === 'Revision Action Plan' && s.status === 'completed' && s.result,
    );
    if (actionPlan?.result) {
      slots.push({
        label: 'Revision Action Plan',
        content: `## Revision Action Plan\n\n${actionPlan.result}`,
        priority: 1,
        tokenCount: 0,
        compressible: false, // Must not lose the per-chapter verdicts
        included: false,
      });
    }

    // ── P1: Pass H Revision Brief for this chapter (from family) ──
    const revisionBrief = familyCompleted.find(
      s => s.taskType === 'revision_check' &&
           s.chapterNumber === chapterNum &&
           s.label.includes('Revision Brief'),
    );
    if (revisionBrief?.result) {
      slots.push({
        label: `${chName} — Revision Brief`,
        content: `## Revision Brief (${chName})\n\n${revisionBrief.result}`,
        priority: 1,
        tokenCount: 0,
        compressible: false, // Verdict + line rewrites must be preserved exactly
        included: false,
      });
    }

    // ── P1: Original chapter prose (from family's novel-pipeline) ──
    const originalChapter = familyCompleted.find(
      s => s.taskType === 'draft_compile' && s.chapterNumber === chapterNum && s.result
    ) || familyCompleted.find(
      s => s.taskType === 'creative_writing' && s.chapterNumber === chapterNum && s.result
    );

    if (originalChapter?.result) {
      let segmentContent = originalChapter.result;
      const { segmentIndex, totalSegments } = currentStep;
      
      if (segmentIndex && totalSegments && totalSegments > 1) {
        // Split original text into paragraphs and chunk it
        const paragraphs = originalChapter.result.split(/\n\s*\n/);
        const parasPerSegment = Math.ceil(paragraphs.length / totalSegments);
        const startIndex = (segmentIndex - 1) * parasPerSegment;
        const endIndex = startIndex + parasPerSegment;
        
        segmentContent = paragraphs.slice(startIndex, endIndex).join('\n\n');

        // Inject continuity context from the previous segment
        if (segmentIndex > 1) {
          const prevStep = project.steps.find(
            s => s.chapterNumber === chapterNum && s.segmentIndex === segmentIndex - 1 && s.result
          );
          if (prevStep?.result) {
            const prevWords = prevStep.result.split(/\s+/);
            const tail = prevWords.slice(-250).join(' '); // last 250 words
            slots.push({
              label: `Preceding Text (Part ${segmentIndex - 1})`,
              content: `## End of Part ${segmentIndex - 1} — MANDATORY CONTINUATION POINT\n\n` +
                `⚠️ YOUR OUTPUT MUST BEGIN EXACTLY WHERE THIS TEXT ENDS. Do NOT restart the scene. Do NOT re-introduce characters. ` +
                `Do NOT write a new opening. Continue the narrative mid-flow.\n\n...${tail}`,
              priority: 1,
              tokenCount: 0,
              compressible: false,
              included: false,
            });
          }
        }
      }

      slots.push({
        label: `${chName} — Original Text${segmentIndex ? ` (Part ${segmentIndex})` : ''}`,
        content: `## ${chName} (Original Text${segmentIndex ? ` Part ${segmentIndex}` : ''} — for reference)\n\n${segmentContent}`,
        priority: 1,
        tokenCount: 0,
        compressible: false, // The executing AI needs to read every word
        included: false,
      });
    }

    // ── P2: All specialist revision passes A–G for this chapter (from family) ──
    const specialistPasses = familyCompleted.filter(
      s => s.taskType === 'revision_check' &&
           s.chapterNumber === chapterNum &&
           !s.label.includes('Revision Brief'),
    );
    for (const pass of specialistPasses) {
      const compressed = await this.tryCompress(
        pass.result!,
        `${pass.label} — preserve verdict, specific issues, quoted examples`,
        512,
      );
      slots.push({
        label: `[Audit] ${pass.label}`,
        content: `## ${pass.label}\n\n${pass.result}`,
        priority: 2,
        tokenCount: 0,
        compressible: !!compressed,
        compressedVersion: compressed,
        included: false,
      });
    }

    // ── P2: POV check findings for this chapter (from family) ──
    const povCheck = familyCompleted.find(
      s => s.taskType === 'pov_check' && s.chapterNumber === chapterNum,
    );
    if (povCheck?.result) {
      const compressed = await this.tryCompress(
        povCheck.result,
        `POV check for ${chName} — preserve filter words, show/tell violations, scores`,
        512,
      );
      slots.push({
        label: `${chName} — POV Check`,
        content: `## POV Check Findings (${chName})\n\n${povCheck.result}`,
        priority: 2,
        tokenCount: 0,
        compressible: !!compressed,
        compressedVersion: compressed,
        included: false,
      });
    }

    // ── P3: Manuscript-level audits from family ──
    const manuscriptAudits = familyCompleted.filter(
      s => s.taskType === 'analysis' &&
        (s.label === 'Structural Arc Audit' ||
         s.label === 'Character Arc Tracker' ||
         s.label === 'Thematic Cohesion Report'),
    );
    for (const audit of manuscriptAudits) {
      const compressed = await this.tryCompress(
        audit.result!,
        `${audit.label} — key findings relevant to Chapter ${chapterNum}`,
        512,
      );
      slots.push({
        label: `[Manuscript] ${audit.label}`,
        content: `## ${audit.label}\n\n${audit.result}`,
        priority: 3,
        tokenCount: 0,
        compressible: !!compressed,
        compressedVersion: compressed,
        included: false,
      });
    }

    this.log.info('Revision execution slots built', {
      chapter: chapterNum,
      hasActionPlan: !!actionPlan,
      hasBrief: !!revisionBrief,
      hasOriginalText: !!originalChapter,
      specialistPasses: specialistPasses.length,
      hasPovCheck: !!povCheck,
    });

    return slots;
  }

  /**
   * Attempt to compress content using the Librarian.
   * Returns null if compression fails (the system continues without it).
   */
  private async tryCompress(
    content: string,
    taskDescription: string,
    targetTokens?: number,
  ): Promise<string | undefined> {
    if (!this.compressor || !this.compressor.isAvailable()) return undefined;
    const limit = targetTokens ?? this.config.get<number>('ai.compression.briefingTarget', 512);
    try {
      const result = await this.compressor.buildBriefing(content, taskDescription, limit);
      return result.compressed;
    } catch (err: any) {
      this.log.warn('Compression failed, using raw content', { error: err.message });
      return undefined;
    }
  }

  /**
   * Extract a concrete scene state snapshot from Part 1 prose.
   * Pulls out the POV character, distances, active props, dialogue speakers,
   * and last action to give Part 2 a hard anchor — preventing spatial resets,
   * POV switches, and action loops.
   */
  private buildSceneStateSnapshot(part1Text: string): string {
    const lines: string[] = [];
    const searchText = part1Text.slice(-2000); // Only last ~500 words
    const lowerText = searchText.toLowerCase();

    // ── POV Character Lock ────────────────────────────────────────────────
    // Find the most frequently mentioned proper noun as sentence subject.
    // Also scan for dialogue attribution to extract speaker names.
    const nameRe = /\b([A-Z][a-z]{2,})\b/g;
    const nameCounts = new Map<string, number>();
    const stopWords = this.heuristics.getStopWords();
    let nm: RegExpExecArray | null;
    while ((nm = nameRe.exec(part1Text)) !== null) {
      const name = nm[1];
      if (!stopWords.has(name)) {
        nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
      }
    }

    // Sort by frequency — the most mentioned name is likely the POV character
    const sortedNames = [...nameCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (sortedNames.length > 0) {
      const povName = sortedNames[0][0];
      lines.push(`POV CHARACTER: "${povName}" — Part 2 MUST keep this EXACT character as the POV. DO NOT switch to a different character's perspective.`);
      if (sortedNames.length > 1) {
        const otherNames = sortedNames.slice(1, 4).map(([n]) => n).join(', ');
        lines.push(`OTHER CHARACTERS PRESENT: ${otherNames} — these are NON-POV; do not show their thoughts or feelings.`);
      }
    }

    // ── Dialogue speakers ─────────────────────────────────────────────────
    const dialogueRe = /["""]\s*([^"""]+?)["""]\s*(?:,?\s*)?(\b[A-Z][a-z]+)\s+(?:said|asked|replied|whispered|muttered|growled|snapped|called|answered|demanded)/g;
    const speakers = new Set<string>();
    let dMatch: RegExpExecArray | null;
    while ((dMatch = dialogueRe.exec(part1Text)) !== null) {
      speakers.add(dMatch[2]);
    }
    // Also match "Name said" patterns
    const saidRe = /\b([A-Z][a-z]{2,})\s+(?:said|asked|replied|whispered|muttered)/g;
    while ((dMatch = saidRe.exec(part1Text)) !== null) {
      if (!stopWords.has(dMatch[1])) speakers.add(dMatch[1]);
    }
    if (speakers.size > 0) {
      lines.push(`DIALOGUE SPEAKERS IN PART 1: ${[...speakers].join(', ')} — keep these same characters and voices in Part 2.`);
    }

    // ── Last confirmed distance/position ──────────────────────────────────
    const distanceRe = /\b(\w+\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s+(metre|meter|feet|foot|pace|step|centimetre|centimeter)s?\b/gi;
    const distances: string[] = [];
    let dm: RegExpExecArray | null;
    while ((dm = distanceRe.exec(searchText)) !== null) {
      distances.push(dm[0].trim());
    }
    if (distances.length > 0) {
      lines.push(`LAST CONFIRMED DISTANCE: "${distances[distances.length - 1]}" — DO NOT repeat or reset this.`);
    }

    // ── Props in play ──────────────────────────────────────────────────────
    const propWords = this.heuristics.getPropWords();
    const foundProps = new Set<string>();
    for (const prop of propWords) {
      if (lowerText.includes(prop)) foundProps.add(prop);
    }
    if (foundProps.size > 0) {
      lines.push(`PROPS IN PLAY: ${[...foundProps].join(', ')} — these exist in the scene; do not teleport or duplicate them.`);
    }

    // ── Last completed action (last full sentence of Part 1) ──────────────
    const sentences = part1Text.match(/[^.!?]+[.!?]+/g) || [];
    const lastSentences = sentences.slice(-3).map(s => s.trim()).filter(Boolean);
    if (lastSentences.length > 0) {
      lines.push(`LAST ACTION IN PART 1: "${lastSentences[lastSentences.length - 1]}"`);
    }

    // ── Physical/injury state ──────────────────────────────────────────────
    const injuryWords = this.heuristics.getInjuryWords();
    const injuryMentions: string[] = [];
    for (const word of injuryWords) {
      if (lowerText.includes(word)) injuryMentions.push(word);
    }
    if (injuryMentions.length > 0) {
      lines.push(`POV PHYSICAL STATE: injury markers present (${injuryMentions.join(', ')}) — maintain these in Part 2.`);
    }

    return lines.length > 0
      ? lines.join('\n')
      : 'NOTE: No specific positions extracted — infer from the continuation text below and do NOT reset.';
  }

}
