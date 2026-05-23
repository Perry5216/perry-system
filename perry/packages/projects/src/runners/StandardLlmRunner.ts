import { AbilityEvaluator } from '@perry/core';
import type { Project, ProjectStep, CompletionResponse } from '@perry/core';
import { getGateFor } from '../services/quality-gates.js';
import { generateCalibrationPassSteps } from '../templates.js';
import * as path from 'path';
import * as fs from 'fs';
import type { StepRunnerStrategy } from './BaseRunner.js';
import type { StepRunner } from '../step-runner.js';
import { DomainRegistry } from '../services/domain-registry.js';

function resolveDomainBinding(baseModel: string): { provider: string; model?: string } {
  const parts = baseModel.split('/');
  let provider = parts[0];
  let model = parts.slice(1).join('/');
  
  const PROVIDER_ID_ALIAS: Record<string, string> = {
    writer: 'ollama',
  };
  if (PROVIDER_ID_ALIAS[provider]) {
    provider = PROVIDER_ID_ALIAS[provider];
  }
  return { provider, model: model || undefined };
}

const OL_SUBJECT_ENUM = [
  'fiction', 'non-fiction', 'history', 'biography', 'memoir',
  'science_fiction', 'fantasy', 'cyberpunk', 'epic_fantasy', 'urban_fantasy', 'dark_fantasy',
  'space_opera', 'hard_science_fiction', 'dystopia', 'post-apocalyptic', 'steampunk',
  'mystery', 'thriller', 'horror', 'cozy_mystery', 'detective_and_mystery_stories',
  'crime', 'psychological_thriller', 'noir',
  'romance', 'paranormal_romance', 'contemporary_romance', 'historical_romance',
  'literary_fiction', 'contemporary_fiction', 'historical_fiction', 'classics',
  'military_fiction', 'war_stories', 'war', 'military_history',
  'young_adult', 'childrens_fiction', 'middle_grade',
  'self-help', 'business', 'philosophy', 'religion', 'science', 'travel', 'cooking', 'art',
];

const CONCEPT_KEYWORDS_SCHEMA_PLANNING = {
  type: 'object',
  required: ['subjectSlug', 'subjectSlugFallback', 'redditSubs', 'primaryQuery', 'altQueries'],
  properties: {
    subjectSlug:         { type: 'string', enum: OL_SUBJECT_ENUM },
    subjectSlugFallback: { type: 'string', enum: OL_SUBJECT_ENUM },
    redditSubs:          { type: 'string', minLength: 5, maxLength: 120 },
    primaryQuery:        { type: 'string', minLength: 5, maxLength: 120 },
    altQueries:          { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
  },
};

const CONCEPT_KEYWORDS_SCHEMA_KDP = {
  type: 'object',
  required: ['subjectSlug', 'subjectSlugFallback', 'redditSubs', 'redditAuthorSubs', 'primaryQuery', 'altQueries'],
  properties: {
    subjectSlug:         { type: 'string', enum: OL_SUBJECT_ENUM },
    subjectSlugFallback: { type: 'string', enum: OL_SUBJECT_ENUM },
    redditSubs:          { type: 'string', minLength: 5, maxLength: 120 },
    redditAuthorSubs:    { type: 'string', minLength: 5, maxLength: 120 },
    primaryQuery:        { type: 'string', minLength: 5, maxLength: 120 },
    altQueries:          { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
  },
};

export class StandardLlmRunner implements StepRunnerStrategy {
  canHandle(step: ProjectStep): boolean {
    // Standard LLM runner acts as the fallback handler for any step not handled by others
    return true;
  }

  async execute(project: Project, step: ProjectStep, runner: StepRunner): Promise<string> {
    const startTime = Date.now();
    const appliedAbilities = runner.directorAbilities.filter(s => {
      const w = s.appliesWhen;
      if (!w) return false;
      return !w.task_type || w.task_type === '*' || w.task_type === step.taskType;
    });

    try {
      // 2. Select provider
      const isCastExtraction = step.label === 'Cast Extraction' &&
        (project.type as string) === 'style-calibration' &&
        step.taskType === 'analysis';
      const isCalibrationPovCheck = step.taskType === 'pov_check' &&
        (project.type as string) === 'style-calibration';
      const isConceptKeywords = (step.label === 'Concept Keywords' || step.label === 'KDP Concept Keywords') &&
        ((project.type as string) === 'book-planning' || (project.type as string) === 'amazon-kdp-launch');

      const useWorkersForResearchBP = runner.shouldUseWorkersForResearch(project, step);
      const isBookPlanningResearch = (project.type as string) === 'book-planning' &&
        (step.taskType === 'network_research' ||
         (step.label === 'Concept Keywords' && step.taskType === 'research') ||
         step.label === 'Market & Genre Analysis');
      const routeToResearcher = isBookPlanningResearch && !useWorkersForResearchBP;
      const researcherProvider = routeToResearcher ? runner.router.getProvider('researcher') : null;

      const routeToLibrarian = !routeToResearcher && (isCastExtraction || isCalibrationPovCheck || isConceptKeywords);
      const librarianProvider = routeToLibrarian ? runner.router.getProvider('librarian') : null;

      const tableTarget = (researcherProvider || librarianProvider)
        ? null
        : runner.router.resolveRoutingTarget(step.taskType);

      // Load Domain Override if specified
      const registry = runner.config.workspaceDir ? new DomainRegistry({ workspaceDir: runner.config.workspaceDir, log: runner.log }) : null;
      const domainDef = (registry && project.workType) ? registry.get(project.workType) : null;
      const resolvedDomain = domainDef?.baseModel ? resolveDomainBinding(domainDef.baseModel) : null;

      const provider = researcherProvider ?? librarianProvider ?? (() => {
        if (resolvedDomain) {
          if (resolvedDomain.provider === 'workers') {
            return { id: 'workers', name: 'External Workers', providerConfig: {} } as any;
          }
          const p = runner.router.getProvider(resolvedDomain.provider);
          if (p) {
            if (resolvedDomain.model) {
              return { ...p, model: resolvedDomain.model };
            }
            return p;
          }
        }
        if (tableTarget === 'librarian' && runner.router.getProvider('librarian')) return runner.router.getProvider('librarian')!;
        if (tableTarget === 'researcher' && runner.router.getProvider('researcher')) return runner.router.getProvider('researcher')!;
        return runner.router.selectProvider(step.taskType, project.preferredProvider);
      })();

      const routeToWorkers = !researcherProvider && !librarianProvider && (resolvedDomain ? resolvedDomain.provider === 'workers' : tableTarget === 'workers');

      runner.log.info('Provider selected', {
        provider: routeToWorkers ? 'workers' : provider.id,
        model: routeToWorkers ? '<external CLI>' : provider.model,
        routingTarget: tableTarget || (researcherProvider ? 'researcher' : 'librarian'),
      });

      // 3. Build the system prompt
      let systemPrompt = this.buildSystemPrompt(project, step, runner);
      if (isConceptKeywords && (provider.id === 'researcher' || provider.id === 'librarian')) {
        systemPrompt = `/no_think\n\n${systemPrompt}`;
      }

      // 4. Build the user message (with budget management + compression)
      runner.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: `Building context (provider: ${routeToWorkers ? 'workers' : provider.name})...`,
      });

      const compressionMultiplier = runner.router.contextWatcher.getCompressionMultiplier();

      const buildProviderConfig = routeToWorkers
        ? { ...provider.providerConfig, contextWindow: 200_000, model: 'worker' }
        : provider.providerConfig;

      const { message, budgetReport } = await runner.promptBuilder.build(
        project, step, buildProviderConfig, systemPrompt, compressionMultiplier,
        { skipCompression: routeToWorkers },
      );

      runner.log.info('Budget report', {
        used: budgetReport.used,
        remaining: budgetReport.remaining,
        dropped: budgetReport.droppedSlots,
      });

      let result = '';

      if (routeToWorkers) {
        runner.eventBus.emit('step:progress', {
          projectId: project.id, stepId: step.id,
          message: `Dispatching ${step.taskType} to external worker (Claude / Gemini)...`,
        });
        const wresp = await runner.runResearchAssistTask({
          project, step,
          systemPrompt,
          userContent: message,
        });
        if (!wresp.text || wresp.text.trim().length === 0) {
          throw new Error(`Worker returned empty result for step "${step.label}"`);
        }
        result = wresp.text;
        runner.log.info('Step completed via workers', {
          step: step.label,
          taskType: step.taskType,
          length: result.length,
          wordCount: result.split(/\s+/).length,
        });
      }

      // 5. Send to AI with retry/continuation logic
      let currentMessage = message;
      let accumulatedText = '';
      let accumulatedTokens = 0;
      let accumulatedCost = 0;

      let maxAttempts = routeToWorkers ? 0 : (runner.config.maxRetries + 2);
      let MAX_TOTAL_ITERATIONS = maxAttempts + 4;
      let attempt = 1;
      let segmentCount = 1;
      let totalIterations = 0;
      let lastError: Error | null = null;

      while (attempt <= maxAttempts) {
        totalIterations++;
        if (totalIterations > MAX_TOTAL_ITERATIONS) {
          throw new Error(
            `[AUTO_RESET_REQUIRED] Step "${step.label}" exceeded absolute iteration cap (${MAX_TOTAL_ITERATIONS}). ` +
            `Possible infinite continuation loop. Auto-reset required.`
          );
        }
        try {
          runner.eventBus.emit('step:progress', {
            projectId: project.id,
            stepId: step.id,
            message: segmentCount > 1 
              ? `Generating segment ${segmentCount}...`
              : `Generating (attempt ${attempt}/${maxAttempts})...`,
          });

          runner.stateStore.recordTelemetry(project.id, step.id, systemPrompt, currentMessage);

          if (segmentCount === 1) {
            accumulatedText = '';
          }

          const outputBudget = runner.router.getOutputBudget(step.taskType);
          const thinking = runner.router.getRecommendedThinking(step.taskType);

          const isCreativeStep = step.taskType === 'creative_writing' || step.taskType === 'revision_execution';

          let temperature = 0.7;
          if (isCreativeStep) {
            temperature = this.getSceneTemperature(currentMessage, step);
          }
          if (step.label === 'Cast Extraction' && (project.type as string) === 'style-calibration') {
            temperature = 0.1;
          }
          if (step.taskType === 'pov_check' && (project.type as string) === 'style-calibration') {
            temperature = 0.1;
          }
          if (step.label === 'Concept Keywords' && (project.type as string) === 'book-planning') {
            temperature = 0.1;
          }

          const estimatedPromptTokens = Math.ceil((systemPrompt.length + currentMessage.length) / 3.0);
          const gpuLabel = provider.name || 'Writer (5090)';
          runner.router.contextWatcher.recordPromptTokens(gpuLabel, estimatedPromptTokens);

          const hallucinationWarning = runner.router.contextWatcher.getHallucinationWarning(gpuLabel);
          let effectiveMessage = currentMessage;
          if (hallucinationWarning && isCreativeStep) {
            effectiveMessage = currentMessage + hallucinationWarning;
            runner.log.warn('Hallucination guard injected — context near capacity', {
              percentFull: runner.router.contextWatcher.getStats().gpus.find(g => g.label === gpuLabel)?.percentFull,
            });
          }

          if (step.label.includes('Negative-Pair Mining') && (project.type as string) === 'style-calibration') {
            const upstreamPov = project.steps.find(
              ps => ps.taskType === 'pov_check' &&
                    ps.chapterNumber === step.chapterNumber &&
                    ps.status === 'completed' &&
                    !!ps.result,
            );
            const verdictMatch = upstreamPov?.result?.match(/\*?\*?Verdict\*?\*?[:\s]+(PASS|REVISE|REWRITE)/i);
            const upstreamVerdict = verdictMatch?.[1]?.toUpperCase() || 'REVISE';
            const decision = upstreamVerdict === 'PASS'
              ? '- Verdict is **PASS**. Output exactly this line and stop: `No negative pairs to mine — verdict was PASS.`'
              : `- Verdict is **${upstreamVerdict}**. You MUST proceed with mining per the JSON contract below. Do NOT emit the skip line under any circumstances.`;
            const verdictBlock =
              `## UPSTREAM POV CHECK VERDICT (DETERMINISTIC — DO NOT RE-INTERPRET)\n\n` +
              `The Pass ${step.chapterNumber ? Math.floor(step.chapterNumber / 100) : '?'} POV check for this scene returned: **${upstreamVerdict}**\n\n` +
              `This value was parsed directly from the upstream POV Quality Gate step. It is authoritative.\n\n` +
              `DECISION:\n${decision}\n\n` +
              `${'─'.repeat(60)}\n\n`;
            effectiveMessage = verdictBlock + effectiveMessage;
            runner.log.info('Negative-Pair Mining: deterministic verdict injected', {
              step: step.label,
              upstreamVerdict,
              chapterNumber: step.chapterNumber,
            });
          }

          if (['Chapter Outline', 'Chapter-by-Chapter Outline', 'Tension Blueprint', 'Scene-Level Breakdown'].includes(step.label)) {
            const targetChs = (project.context as any).targetChapters || 25;
            const structureConstraint =
              `\n\nCRITICAL ANTI-HALLUCINATION PROTOCOL:\n` +
              `You MUST strictly follow the exact structure of the project. You are required to generate data for exactly: ` +
              `${(project.context as any).includePrologue ? 'Prologue, ' : ''}Chapters 1 through ${targetChs}${(project.context as any).includeEpilogue ? ', and an Epilogue' : ''}.\n` +
              `Do NOT invent new chapters. Do NOT skip chapters. Do NOT merge the Epilogue into the final chapter.\n\n` +
              `MANDATORY FORMAT — every chapter MUST use this EXACT header (numeric digit, NOT a word):\n` +
              `## Chapter 1: [Title]\n` +
              `**POV:** [Character]\n` +
              `**Key Events:** [events]\n` +
              `...\n\n` +
              `## Chapter 2: [Title]\n...\n\n` +
              `Do NOT use tables, Roman numerals, or word-numbers ("Chapter One"). ` +
              `Use "## Chapter 1:", "## Chapter 2:", etc. exactly. ` +
              `Generate ALL ${targetChs} chapters in one continuous response.`;
            effectiveMessage += structureConstraint;
          }

          let currentMessages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; name?: string; tool_calls?: any[] }> = [
            { role: 'user', content: effectiveMessage }
          ];

          let response: CompletionResponse | null = null;
          let toolLoopActive = true;
          let safetyCounter = 0;

          const availableTools = runner.mcpClient.getTools();
          const allowedToolTasks = ['planning', 'book_cover', 'research', 'outline'];
          let useTools = allowedToolTasks.includes(step.taskType) && !routeToLibrarian && !routeToResearcher;

          if (useWorkersForResearchBP) {
            response = await runner.runResearchAssistTask({
              project, step,
              systemPrompt,
              userContent: effectiveMessage,
            });
            toolLoopActive = false;
          }

          while (toolLoopActive && safetyCounter < 10) {
            safetyCounter++;
            const domainParams = domainDef?.modelParameters || {};
            const finalTemperature = domainParams.temperature ?? temperature;
            const finalMaxTokens = domainParams.maxTokens ?? outputBudget;
            const finalRepeatPenalty = domainParams.repeatPenalty ?? (isCreativeStep ? 1.15 : undefined);
            const finalTopP = domainParams.topP;
            const finalTopK = domainParams.topK;

            try {
              response = await runner.router.complete({
                provider: provider.id,
                system: systemPrompt,
                messages: currentMessages,
                maxTokens: finalMaxTokens,
                temperature: finalTemperature,
                thinking,
                repeatPenalty: finalRepeatPenalty,
                topP: finalTopP,
                topK: finalTopK,
                tools: (useTools && availableTools.length > 0) ? availableTools : undefined,
                penSlug: (routeToLibrarian || routeToResearcher) ? undefined : (project.context as any).penNameSlug,
                format: isConceptKeywords
                  ? ((project.type as string) === 'amazon-kdp-launch'
                      ? CONCEPT_KEYWORDS_SCHEMA_KDP
                      : CONCEPT_KEYWORDS_SCHEMA_PLANNING)
                  : undefined,
              });
            } catch (err: any) {
              const msg = String(err?.message || err);
              if (useTools && /does not support tools/i.test(msg)) {
                runner.log.warn('Provider rejected tools; retrying without', { provider: provider.id, error: msg });
                useTools = false;
                continue;
              }
              throw err;
            }

            if (response.toolCalls && response.toolCalls.length > 0) {
              runner.log.info(`AI requested ${response.toolCalls.length} tool calls`);
              currentMessages.push({
                role: 'assistant',
                content: response.text || '',
                tool_calls: response.toolCalls
              });

              for (const tc of response.toolCalls) {
                try {
                  const result = await runner.mcpClient.executeTool(tc.function.name, JSON.parse(tc.function.arguments));
                  currentMessages.push({
                    role: 'tool',
                    name: tc.function.name,
                    content: JSON.stringify(result)
                  });
                } catch (err: any) {
                  runner.log.warn(`Tool execution failed: ${tc.function.name}`, { error: err.message });
                  currentMessages.push({
                    role: 'tool',
                    name: tc.function.name,
                    content: `Error executing tool: ${err.message}`
                  });
                }
              }
            } else {
              toolLoopActive = false;
            }
          }

          if (!response) {
            throw new Error('No response generated by the AI router.');
          }

          if (response.promptTokens) {
            runner.router.contextWatcher.recordActualUsage(
              'Writer (5090)',
              response.promptTokens,
              response.completionTokens || 0,
            );
          }

          accumulatedCost += response.estimatedCost || 0;
          accumulatedTokens += response.tokensUsed || 0;

          if (response.estimatedCost && response.estimatedCost > 0) {
            const withinBudget = runner.costTracker.recordCost(project.id, response.estimatedCost);
            if (!withinBudget) {
              throw new Error(`Budget exceeded for project ${project.id}. Pipeline halted.`);
            }
          }
          
          if (accumulatedText.length > 0 && response.text.trim().length > 0) {
            accumulatedText += '\n\n';
          }
          accumulatedText += response.text.trim();

          if (isCreativeStep) {
            const wordCount = accumulatedText.split(/\s+/).filter(Boolean).length;
            const minWords = step.wordCountTarget ? Math.floor(step.wordCountTarget * 0.3) : 300;
            if (wordCount < minWords) {
              throw new Error(
                `Prose response too short (${wordCount} words). ` +
                `Minimum for this step: ${minWords} words. Retrying...`
              );
            }
          } else if (accumulatedText.length < runner.config.minResponseLength) {
            const isLegitShortAnswer =
              step.label.includes('Negative-Pair Mining') &&
              /no negative pairs to mine/i.test(accumulatedText);
            if (!isLegitShortAnswer) {
              throw new Error(
                `Response too short (${accumulatedText.length} chars). ` +
                `Minimum: ${runner.config.minResponseLength}. Retrying...`
              );
            }
          }

          if (isCreativeStep) {
            accumulatedText = runner.dedup.deduplicateContent(accumulatedText, step.id, project.id);
          }

          if (isCreativeStep && step.wordCountTarget) {
            const wordCount = accumulatedText.split(/\s+/).filter(Boolean).length;
            const threshold = step.taskType === 'revision_execution' ? 0.70 : 0.90;
            const minWords = Math.floor(step.wordCountTarget * threshold);
            const maxWords = Math.floor(step.wordCountTarget * 1.20);
            const maxContinuations = 4;

            if (wordCount > maxWords) {
              runner.log.warn('Chapter exceeded max word count cap — accepting result', {
                currentWords: wordCount, target: step.wordCountTarget, maxAllowed: maxWords,
              });
            } else if (wordCount < minWords && segmentCount <= maxContinuations) {
              const words = accumulatedText.split(/\s+/);
              const tailWords = words.slice(-200).join(' ');
              const remaining = step.wordCountTarget - wordCount;

              runner.log.info('Output truncated by num_predict — requesting Librarian briefing', {
                currentWords: wordCount, target: step.wordCountTarget, remaining, segmentCount,
              });
              runner.eventBus.emit('step:progress', {
                projectId: project.id,
                stepId: step.id,
                message: `Output truncated (${wordCount}/${step.wordCountTarget} words). Librarian briefing continuation... (part ${segmentCount + 1})`,
              });

              let librarianBriefing = '';
              try {
                const briefingPrompt =
                  `You are a story continuity analyst. Read the following partial chapter draft and produce a concise structured briefing.\n\n` +
                  `DRAFT SO FAR (${wordCount} words):\n---\n${accumulatedText.slice(-4000)}\n---\n\n` +
                  `Produce ONLY this structured briefing (max 250 words):\n` +
                  `**Scene Location:** [where we are right now]\n` +
                  `**Characters Present:** [who is in the scene and their current state]\n` +
                  `**Events So Far:** [bullet list of what has happened, 3-5 points]\n` +
                  `**Unresolved Tension:** [what conflict or question is still open]\n` +
                  `**What Must Happen Next:** [what the continuation must cover to complete the chapter arc]\n` +
                  `**Prose Tail (last line):** [copy the exact last sentence of the draft above]`;

                const librarianProvider = runner.router.getProvider('librarian') ? 'librarian' : 'ollama';
                const briefingResponse = await runner.router.complete({
                  provider: librarianProvider,
                  system: 'You are a concise story continuity analyst. Output only the requested structured briefing. No preamble.',
                  messages: [{ role: 'user', content: briefingPrompt }],
                  maxTokens: 512,
                  temperature: 0.3,
                });
                librarianBriefing = briefingResponse.text.trim();
                runner.log.info('Librarian continuation briefing received', {
                  briefingLength: librarianBriefing.length, segmentCount,
                });
              } catch (err: any) {
                runner.log.warn('Librarian briefing failed — falling back to tail-only continuation', { error: err.message });
              }

              const briefingBlock = librarianBriefing
                ? `\n\n[CHAPTER STATE — from Librarian analysis]:\n${librarianBriefing}\n`
                : '';

              currentMessage = message +
                briefingBlock +
                `\n\n[CONTINUATION INSTRUCTION]: The previous generation stopped early. Continue the SAME prose seamlessly.\n` +
                `\n` +
                `⚠️ HARD CONSTRAINTS — read carefully:\n` +
                `1. Output PROSE ONLY. Do NOT write a synopsis, summary, outline, or "the next section…" lead-ins.\n` +
                `2. Do NOT echo the [CHAPTER STATE] briefing format above — that block is READ-ONLY reference for you, not a template to mirror.\n` +
                `3. Do NOT write "THE END", "the prologue ends on this note", or any meta-narration about the scene.\n` +
                `4. Do NOT include any "PROSE METRIC SNAPSHOT", word counts, sentence counts, or any auditor-style critique.\n` +
                `5. Continue EXACTLY from where the prose tail ends — same scene, same characters, same beat. Do NOT restart or re-introduce.\n` +
                `6. Do NOT repeat any text already written.\n` +
                `\n` +
                `[PROSE TAIL — your next sentence must follow directly from this]:\n---\n${tailWords}\n---\n` +
                `\n` +
                `Write approximately ${remaining} more words of continuous narrative prose to complete the segment.`;

              segmentCount++;
              attempt--;
              continue;
            } else if (wordCount < minWords) {
              runner.log.warn('Segment below target after max continuations — accepting as-is', {
                currentWords: wordCount, target: step.wordCountTarget, segmentCount,
              });
            }
          } else if (step.wordCountTarget) {
            const wordCount = accumulatedText.split(/\s+/).length;
            const minWords = Math.floor(step.wordCountTarget * 0.70);
            if (wordCount < minWords) {
              runner.log.info('Step below word count target — accepting result', {
                currentWords: wordCount, target: step.wordCountTarget,
              });
            }
          }

          if (['Chapter Outline', 'Chapter-by-Chapter Outline', 'Tension Blueprint', 'Scene-Level Breakdown'].includes(step.label)) {
            const missingChapters: number[] = [];
            const thinChapters: number[] = [];
            const targetCh = (project.context as any).targetChapters || 25;

            const WORD_NUMS: Record<number, string> = {
              1:'One',2:'Two',3:'Three',4:'Four',5:'Five',6:'Six',7:'Seven',8:'Eight',9:'Nine',
              10:'Ten',11:'Eleven',12:'Twelve',13:'Thirteen',14:'Fourteen',15:'Fifteen',
              16:'Sixteen',17:'Seventeen',18:'Eighteen',19:'Nineteen',20:'Twenty',
              21:'Twenty-?One',22:'Twenty-?Two',23:'Twenty-?Three',24:'Twenty-?Four',
              25:'Twenty-?Five',26:'Twenty-?Six',27:'Twenty-?Seven',28:'Twenty-?Eight',
              29:'Twenty-?Nine',30:'Thirty',31:'Thirty-?One',32:'Thirty-?Two',
              33:'Thirty-?Three',34:'Thirty-?Four',35:'Thirty-?Five',36:'Thirty-?Six',
              37:'Thirty-?Seven',38:'Thirty-?Eight',39:'Thirty-?Nine',40:'Forty',
            };

            for (let i = 1; i <= targetCh; i++) {
              const wordNum = WORD_NUMS[i] || '';
              const chRegex = new RegExp(
                `(?:#+\\s*(?:Chapter\\s+)?0?${i}\\b` +
                `|\\*{1,2}Chapter\\s+0?${i}\\b` +
                `|^Chapter\\s+0?${i}\\b` +
                `|^0?${i}[.:]\\s` +
                (wordNum ? `|Chapter\\s+${wordNum}\\b` : '') +
                `)`,
                'im'
              );
              const chMatch = accumulatedText.match(chRegex);
              if (!chMatch) {
                missingChapters.push(i);
              } else {
                const chStart = accumulatedText.indexOf(chMatch[0]);
                const chSection = accumulatedText.substring(chStart, chStart + 500).replace(/\s+/g, ' ').trim();
                if (chSection.length < 100) {
                  thinChapters.push(i);
                }
              }
            }
            let missingEpi = false;
            if ((project.context as any).includeEpilogue && !accumulatedText.match(/Epilogue/i)) {
              missingEpi = true;
            }

            if (missingChapters.length > 0 || missingEpi) {
              const MAX_OUTLINE_CONTINUATIONS = 4;
              if (segmentCount <= MAX_OUTLINE_CONTINUATIONS) {
                const resumeFrom = missingChapters.length > 0 ? missingChapters[0] : targetCh + 1;
                const epilogueNote = missingEpi ? ` and then the Epilogue` : '';
                const isFormatFailure = resumeFrom === 1;

                runner.log.info('Outline continuation triggered', {
                  resumeFrom, missingCount: missingChapters.length, segmentCount, isFormatFailure,
                });
                runner.eventBus.emit('step:progress', {
                  projectId: project.id,
                  stepId: step.id,
                  message: isFormatFailure
                    ? `Outline format not recognised — retrying with strict enforcement... (attempt ${segmentCount + 1})`
                    : `Outline truncated at Ch${resumeFrom - 1}. Continuing from Ch${resumeFrom}... (segment ${segmentCount + 1})`,
                });

                const outlineTail = accumulatedText.split(/\n/).slice(-10).join('\n').trim();

                if (isFormatFailure) {
                  currentMessage = message +
                    `\n\n[FORMAT ENFORCEMENT — Attempt ${segmentCount + 1}]:\n` +
                    `Your previous response did not use the required "## Chapter N:" header format. ` +
                    `The automated pipeline could not detect any chapters in your output. ` +
                    `You MUST restart the outline using EXACTLY this format for every chapter:\n` +
                    `## Chapter 1: [Title]\n**POV:** [name]\n**Key Events:** ...\n\n` +
                    `## Chapter 2: [Title]\n...\n\n` +
                    `Use NUMERIC digits (1, 2, 3 — NOT One, Two, Three). ` +
                    `Generate ALL ${targetCh} chapters now.`;
                  accumulatedText = '';
                } else {
                  currentMessage = message +
                    `\n\n[OUTLINE CONTINUATION — Segment ${segmentCount + 1}]:\n` +
                    `You have already written the outline up to Chapter ${resumeFrom - 1}. ` +
                    `The text so far ends with:\n---\n${outlineTail}\n---\n\n` +
                    `Continue IMMEDIATELY from **## Chapter ${resumeFrom}** through **Chapter ${targetCh}**${epilogueNote}. ` +
                    `Use the same "## Chapter N: [Title]" format. ` +
                    `Do NOT repeat any chapters already written. Start with "## Chapter ${resumeFrom}:".`;
                }

                segmentCount++;
                attempt--;
                continue;
              }

              throw new Error(`Structural hallucination detected: Missing Chapter(s) ${missingChapters.join(', ')} ${missingEpi ? 'and Epilogue' : ''}. Retrying...`);
            }
            if (thinChapters.length > 0) {
              throw new Error(`Thin outline detected: Chapter(s) ${thinChapters.join(', ')} have placeholder content (<100 chars). Retrying...`);
            }
          }

          result = accumulatedText;
          runner.log.info('AI response received and finalized', {
            tokens: accumulatedTokens,
            cost: accumulatedCost,
            provider: response.provider,
            length: result.length,
            wordCount: result.split(/\s+/).length,
          });

          const AUDITABLE_TASKS = ['creative_writing', 'revision_execution'];
          if (AUDITABLE_TASKS.includes(step.taskType)) {
            try {
              let dnaLint: any = null;
              const lintEnabled = runner.router.config.get<boolean>('ai.styleDna.enabled', true);
              if (lintEnabled) {
                try {
                  const lintResult = runner.styleDna.lintProse(result);
                  if (lintResult.totalMatches > 0) {
                    dnaLint = lintResult;
                    runner.log.info('style DNA lint flagged matches', {
                      step: step.label,
                      totalMatches: lintResult.totalMatches,
                      filterWords: lintResult.filterWords.length,
                      phrases: lintResult.phrases.length,
                    });
                  }
                } catch (lintErr: any) {
                  runner.log.warn('style DNA lint failed', { step: step.label, error: lintErr.message });
                }
              }

              runner.stateStore.enqueueTasks('pipeline_step_assist', [{
                project_id: project.id,
                step_id: step.id,
                step_label: step.label,
                failure_reason: 'async_quality_audit',
                prior_attempt: result,
                project_title: project.title,
                project_description: project.description,
                prompt: step.prompt,
                ...(dnaLint ? { style_dna_lint: dnaLint } : {}),
              }], (project.context as any)?.penNameSlug);
              runner.log.info('async quality audit enqueued for worker pool', {
                step: step.label,
                wordCount: result.split(/\s+/).length,
                dnaLintMatches: dnaLint?.totalMatches || 0,
              });
            } catch (e: any) {
              runner.log.warn('failed to enqueue async audit', { step: step.label, error: e.message });
            }
          }

          break;
        } catch (err: any) {
          lastError = err;
          runner.log.warn(`Attempt ${attempt} failed`, { error: err.message });
          
          try {
            const matched = AbilityEvaluator.evaluate(runner.directorAbilities, {
              task_type: step.taskType,
              error_fingerprint: err.message,
            });
            if (matched.length > 0) {
              const ability = matched[0];
              if (ability.frontmatter.retry_override !== undefined) {
                const parsedOverride = parseInt(ability.frontmatter.retry_override, 10);
                if (!isNaN(parsedOverride) && parsedOverride > maxAttempts) {
                  runner.log.info('Applying director ability retry override', {
                    ability: ability.name,
                    oldMaxAttempts: maxAttempts,
                    newMaxAttempts: parsedOverride,
                  });
                  maxAttempts = parsedOverride;
                  MAX_TOTAL_ITERATIONS = maxAttempts + 4;
                }
              }
            }
          } catch (abilityErr: any) {
            runner.log.warn('Failed to evaluate director abilities for retry override', { error: abilityErr.message });
          }
          
          if (err.message.startsWith('[AUDITOR REJECTION]:')) {
            const critique = err.message.replace('[AUDITOR REJECTION]:', '').trim();
            currentMessage = currentMessage.replace(
              /\n\n\[SYSTEM ALERT: Your previous attempt was REJECTED[\s\S]*?(?=\n\n\[|$)/,
              ''
            );
            currentMessage += `\n\n[SYSTEM ALERT: Your previous attempt was REJECTED by the Quality Auditor. Reason:\n${critique}\n\nPlease redo the task and fix these issues.]`;
            segmentCount = 1;
          }
          
          if (attempt < maxAttempts) {
            const fallback = runner.router.getFallbackProvider(provider.id);
            if (fallback) {
              runner.log.info('Switching to fallback provider', { fallback: fallback.id });
            }
            const backoffMs = Math.min(30_000, 2000 * Math.pow(2, attempt - 1));
            runner.log.info(`Retrying in ${backoffMs / 1000}s...`, { attempt, backoffMs });
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
          attempt++;
        }
      }

      if (!result) {
        throw new Error(`Step failed after ${maxAttempts} attempts: ${lastError?.message}`);
      }

      // Mechanical Formatting Overrides
      if (step.label === 'Stat System Definition') {
        result = runner.forceRelationshipMatrixFormat(result);
      }

      // Sanitize prose results BEFORE storing
      if (step.taskType === 'creative_writing' || step.taskType === 'revision_execution') {
        result = runner.sanitizer.sanitize(runner.dedup.deduplicateOutput(result));

        const STRIP_PATTERNS: Array<{ re: RegExp; label: string }> = [
          { re: /---+\s*PROSE METRIC SNAPSHOT\s*---+[\s\S]*?(?=\n\n[A-Z]|\n*$)/gi, label: 'metric_snapshot' },
          { re: /^\s*THE\s+END\s*\.?\s*$/gim, label: 'the_end_marker' },
          { re: /^.*?\bthe (?:prologue|chapter|epilogue) ends? (?:here|on)\b.*$/gim, label: 'meta_ends_marker' },
          { re: /^\s*The\s+(?:prologue|chapter|epilogue|next\s+section|third\s+(?:part|section)|final\s+section)\s+(?:opens|begins|starts|focuses|shifts|brings|introduces|closes)\b[^.\n]*\.\s*/gim, label: 'synopsis_lead' },
          { re: /^\s*\*{0,2}(?:Deep\s+POV|Pacing|Hook)\s+Score\*{0,2}\s*:\s*\d+(?:\s*\/\s*10)?\s*$/gim, label: 'audit_score_field' },
          { re: /^\s*\*{0,2}(?:POV\s+Character|Outline\s+Match|Verdict|Revision\s+Success|Filter\s+Words(?:\s+Found)?|Show\s+vs\s+Tell|Trope\s+Warnings?|AI-isms?\s+Found|Plot\s+Threads?\s+Stalled|Issues)\*{0,2}\s*:[^\n]*$/gim, label: 'audit_field_line' },
          { re: /\[POV-RETRY:\s*\d+\][^\n]*\n?/gi, label: 'pov_retry_marker' },
          { re: /\[TOTAL-REWRITES:\s*\d+\][^\n]*\n?/gi, label: 'total_rewrites_marker' },
          { re: /^#+\s*🔍\s*Critic\s+Analysis\s*$/gim, label: 'critic_header' },
          { re: /^#+\s*📝\s*Generated\s+Prose\s*$/gim, label: 'generated_prose_header' },
          { re: /^#+\s*📖\s*Compiled\s+Scene\s*$/gim, label: 'compiled_scene_header' },
          { re: /\bCRITICAL REWRITE INSTRUCTIONS[\s\S]*?(?=\n\n[A-Z]|\n*$)/gi, label: 'rewrite_instructions_block' },
          { re: /###\s*YOUR PREVIOUS DRAFT \(NEEDS HEALING\)[\s\S]*?---\s*\n/gi, label: 'healing_block_echo' },
          { re: /^\s*⚠️?\s*PROSE METRICS[^\n]*$/gim, label: 'prose_metrics_header' },
          { re: /^\s*The\s+(?:prologue|chapter|epilogue|draft|scene)\s+(?:draft\s+)?is\s+(?:complete|finished|ready)[\s\S]*?(?:Here\s+(?:is|are)\s+the\s+(?:full\s+)?(?:text|prose|chapter|scene)\s*:?\s*)?\n+/gim, label: 'writer_preamble' },
          { re: /^#{0,3}\s*PART\s+(?:ONE|TWO|1|2|I|II)\s*[—–-]\s*(?:NARRATIVE\s+AUDIT|QUALITY\s+AUDIT|LIVE\s+TRACKING\s+UPDATE)[\s\S]*?(?=\n\n[A-Z][a-z]|\n*$)/gim, label: 'review_block_bleed' },
          { re: /^(?:Score\s+Breakdown|Repetition\s+Audit|Em\s+Dash\s+Count|Tropes?\s+Deployed|Show\s+vs\s+Tell\s+Violations?|Plot\s+Threads?\s+Advanced)\s*:[^\n]*\n?/gim, label: 'audit_subheader' },
          { re: /^[A-Z]\.\s+(?:Character\s+Stats|Faction\s+Reputation\s+Update|Foreshadowing\s+Ledger|Subplot\s+Tracker|Tension\s+Check|Relationship\s+Dynamics|NARRATIVE\s+DIRECTIVES)[\s\S]*?(?=\n\n[A-Z]\.\s+[A-Z]|\n\n[A-Z][a-z]{2,}|\n*$)/gim, label: 'live_tracking_section' },
          { re: /^G\.\s+NARRATIVE\s+DIRECTIVES\s+FOR\s+Chapter\s+\d+[\s\S]*?(?=\n\n[A-Z]|\n*$)/gim, label: 'narrative_directives_block' },
          { re: /^NEVER\s+use\s+placeholder\s+names?\s+like[\s\S]*?\n\n/gim, label: 'prompt_instruction_echo' },
        ];
        for (const { re, label } of STRIP_PATTERNS) {
          const before = result.length;
          result = result.replace(re, '').trim();
          const removed = before - result.length;
          if (removed > 0) {
            runner.log.info('meta-prose contamination stripped', {
              stepId: step.id, label: step.label, pattern: label, chars: removed,
            });
          }
        }

        const MOJIBAKE: Array<[RegExp, string]> = [
          [/ÔÇö/g, '—'],
          [/ÔÇô/g, '–'],
          [/ÔÇ£/g, '"'],
          [/ÔÇØ/g, '"'],
          [/ÔÇÖ/g, '’'],
          [/ÔÇÿ/g, '‘'],
          [/ÔÇª/g, '…'],
          [/(?<=[A-Za-z])Õ(?=[a-z])/g, '’'],
        ];
        for (const [re, rep] of MOJIBAKE) {
          result = result.replace(re, rep);
        }

        const target = (step as any).wordCountTarget as number | undefined;
        if (typeof target === 'number' && target > 0) {
          const hardCeil = target + 1000;
          const words = result.split(/\s+/);
          const overrunPct = ((words.length - hardCeil) / hardCeil) * 100;
          if (words.length > hardCeil && overrunPct > 25) {
            const paragraphs = result.split(/\n\s*\n/);
            let running = 0;
            let cutAt = paragraphs.length;
            for (let i = 0; i < paragraphs.length; i++) {
              const pWords = paragraphs[i].split(/\s+/).length;
              if (running + pWords > hardCeil) { cutAt = i; break; }
              running += pWords;
            }
            if (cutAt < paragraphs.length && cutAt > 0) {
              const trimmed = paragraphs.slice(0, cutAt).join('\n\n').trim();
              runner.log.info('chapter polish: trimmed overrun', {
                stepId: step.id,
                label: step.label,
                targetWords: target,
                originalWords: words.length,
                trimmedWords: trimmed.split(/\s+/).length,
                paragraphsCut: paragraphs.length - cutAt,
              });
              result = trimmed;
            }
          }
        }
      }

      runner.stateStore.completeStep(project.id, step.id, result);

      try {
        const gate = getGateFor(step);
        if (gate) {
          const failure = gate(result, step, project);
          if (failure) {
            runner.log.warn('quality gate failed — enqueueing Claude assist task', {
              project: project.id, step: step.id, label: step.label, failure,
            });
            runner.stateStore.enqueueTasks('pipeline_step_assist', [{
              project_id: project.id,
              step_id: step.id,
              step_label: step.label,
              failure_reason: failure,
              prior_attempt: result,
              project_title: project.title,
              project_description: project.description,
              prompt: step.prompt,
            }], (project.context as any)?.penNameSlug);
          }
        }
      } catch (e: any) {
        runner.log.warn('quality gate threw', { project: project.id, step: step.id, error: e.message });
      }

      await runner.saveStepToDisk(project, step, result);

      if ((step.taskType === 'stat_update' || step.label?.includes(' — Review')) && result && result.length > 100) {
        try {
          const key = `living_diffs_${project.id}`;
          const existingRaw = runner.stateStore.getMeta(key);
          const existing: any[] = existingRaw ? (() => { try { return JSON.parse(existingRaw); } catch { return []; } })() : [];
          existing.push({
            chapter: step.chapterNumber ?? null,
            label: step.label,
            stepId: step.id,
            recordedAt: new Date().toISOString(),
            content: result,
          });
          const capped = existing.slice(-30);
          runner.stateStore.setMeta(key, JSON.stringify(capped));
          runner.log.info('living bible diff recorded', {
            step: step.label, chapter: step.chapterNumber, totalDiffs: capped.length,
          });
        } catch (e: any) {
          runner.log.warn('Failed to record living bible diff', { step: step.label, error: e.message });
        }
      }

      runner.eventBus.emit('step:completed', { projectId: project.id, stepId: step.id, result });
      runner.eventBus.emit('step:progress', { projectId: project.id, stepId: step.id, message: `Completed: ${step.label}` });

      if (step.taskType === 'pov_check') {
        result = await runner.povGate.apply(project, step, result);
        await runner.saveStepToDisk(project, step, result);
        if ((project.type as string) === 'style-calibration') {
          runner.autoLearning.recordPovScores(project.id, step.label, result).catch(err =>
            runner.log.warn('Score tracking failed (non-fatal)', { error: (err as Error).message })
          );

          const verdictMatch = result.match(/Verdict(?:[\s:*]+)(PASS|REVISE|REWRITE)/i);
          const deepPovMatch = result.match(/Deep POV(?: Score)?(?:[\s:*]+)(\d+)/i);
          const verdict = verdictMatch?.[1]?.toUpperCase() || 'UNKNOWN';
          const deepPovScore = deepPovMatch ? parseInt(deepPovMatch[1]) : 0;

          const compiledStep = project.steps.find(
            s => s.taskType === 'draft_compile' &&
                 s.chapterNumber === step.chapterNumber &&
                 s.status === 'completed' && s.result
          );
          if (compiledStep?.result) {
            runner.autoLearning.promoteParagraphsToAnchors(project.id, compiledStep.result).catch(err =>
              runner.log.warn('Paragraph anchor promotion failed (non-fatal)', { error: (err as Error).message })
            );
          }

          if (verdict === 'PASS' || (verdict === 'REVISE' && deepPovScore >= 8)) {
            const sceneTypeMatch = step.label.match(/\b(Action|Dialogue|Introspection|Setting|Confrontation|Discovery|Quiet|Group)\b/i);
            const sceneType = sceneTypeMatch ? sceneTypeMatch[1].toLowerCase() : 'scene';
            if (compiledStep?.result) {
              runner.autoLearning.minePassedScene(project.id, sceneType, compiledStep.result, verdict, deepPovScore).catch(err =>
                runner.log.warn('Full scene mining failed (non-fatal)', { error: (err as Error).message })
              );
            }
          }
        }
      }

      if (step.taskType === 'continuity_check') {
        await runner.continuityGate.apply(project, step, result);
      }
      if (step.taskType === 'revision_audit') {
        await runner.revisionGate.apply(project, step, result);
      }

      if ((project.type as string) === 'style-calibration' && step.taskType === 'analysis' && step.label.includes('Summary')) {
        let positive: string[] = [];
        let negative: string[] = [];
        
        const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            const parsed = JSON.parse(jsonMatch[1]);
            if (Array.isArray(parsed)) {
              negative = parsed;
            } else {
              positive = parsed.positive || [];
              negative = parsed.negative || [];
            }
          } catch (e) {
            runner.log.warn('Failed to parse JSON directives from calibration summary', { error: (e as any).message });
          }
        }
        
        if (positive.length === 0 && negative.length === 0) {
          const lines = result.split('\n');
          const directives = lines
            .filter(l => l.match(/^[-*]\s+(?:DO|AVOID)/i))
            .map(l => l.replace(/^[-*]\s*/, '').trim());
          
          positive = directives.filter(d => d.startsWith('DO:'));
          negative = directives.filter(d => d.startsWith('AVOID:'));
        }
        
        if (positive.length > 0 || negative.length > 0) {
          runner.styleDna.applyDirectivesToGlobal(positive, negative, true);
          runner.log.info('Calibration pass completed — auto-compressed global DNA', { 
            positiveCount: positive.length, 
            negativeCount: negative.length 
          });
        } else {
          runner.log.warn('Calibration pass completed but no DO/AVOID directives found in output', { step: step.label });
        }

        const passMatch = step.label.match(/^Pass (\d+):/);
        const completedPass = passMatch ? parseInt(passMatch[1]) : 0;
        runner.autoLearning.onPassComplete(completedPass, project.id).catch(err =>
          runner.log.warn('Auto-learning background task failed', { error: (err as Error).message })
        );

        if ((project.context as any).isInfiniteCalibration) {
          const match = step.label.match(/^Pass (\d+):/);
          if (match) {
            const currentPass = parseInt(match[1]);
            const nextPass = currentPass + 1;
            const nextIdx = project.steps.length + 1;
            
            runner.log.info('Infinite Calibration Loop active. Generating next pass...', { nextPass });
            
            const freshProject = runner.stateStore.get(project.id) || project;
            const currentDna = {
              positive: runner.styleDna.getGlobalRules().positiveDirectives || [],
              negative: runner.styleDna.getGlobalRules().tropeWarnings || []
            };
            const totalChapters = (freshProject.context as any).targetChapters || 25;
            
            const infiniteSharedContext = [
              `## NOVEL CONTEXT`,
              `Title: "${freshProject.title}"`,
              `Note: "${freshProject.title}" is the project codename — NOT a character. POV characters come ONLY from the Cast Roster injected separately as "Cast Roster (POV Character Lock)". If you cannot see a Cast Roster in your context, STOP and emit a single line: "ERROR: Cast Roster missing from context."`,
              ...(freshProject.description ? [``, `## PROJECT DESCRIPTION`, freshProject.description] : []),
              ``,
              `## WORLD & CHARACTER CONTEXT (from Book Bible)`,
              `MANDATORY: You MUST consult the 'Character Bible', 'Faction Bible', and 'World Building' documents in your context.`,
              `Use the exact character traits, faction allegiances, and sensory rules defined there.`,
              ``,
              `## YOUR TASK`,
              `Write a single scene of manuscript-quality prose in the locked POV character's voice and stat band.`,
              `Output ONLY the scene prose. Do not annotate, summarise, grade, or comment on your own work. No callouts, no verdicts, no notes.`,
              `## POV CHARACTER LOCK (CRITICAL)`,
              `Each pass of this calibration is LOCKED to ONE POV character — DO NOT switch characters mid-pass.`,
              `The Cast Roster (inherited from the Cast Extraction step) lists the POV characters in order.`,
              `Use the character at the position equal to this pass number (Pass 1 → entry #1, Pass 5 → entry #5,`,
              `cycling back to entry #1 after the last entry). The pass-specific prompt below tells you which entry to use.`,
              ``,
              `## STAT BAND LOCK (CRITICAL)`,
              `Each pass is also locked to one stat band that governs the POV character's prose register:`,
              `- **Peak (81-100)**: calm, analytical, measured sentences. The character is at their best.`,
              `- **Stable (51-80)**: baseline behaviour. Default voice — the character as you'd describe them normally.`,
              `- **Stressed (21-50)**: paranoid asides, shorter sentences, misreading social cues, somatic tension.`,
              `- **Critical (1-20)**: fragmented internal monologue, hallucinated sensory details, unreliable narration, sentences break mid-thought.`,
              `Look up the POV character's specific stat-threshold definitions in the inherited Character Bible / Stat System Definition.`,
              `Write the entire scene in the assigned band — sentence rhythm, perception, and decision-making all reflect that band.`,
              ``,
              ``,
              `## ANTI-PATTERNS — DO NOT USE THESE`,
              `1. "In the blink of an eye" for action transitions`,
              `2. "The weight of the world" clichés in introspective moments`,
              `3. Overusing "Quantum" as a noun (e.g., "a quantum of dread")`,
              `4. "Ghostly" or "Soulless" to describe digital entities`,
              `5. "Heartbeats of the Drift" as a metaphor`,
              `6. "The storm of emotions" in character reactions`,
              `7. Filter words: felt, noticed, saw, heard, realized, wondered, thought`,
              `8. Repetitive dialogue tags (hissed, growled, snapped, exclaimed, etc.)`,
              `9. "The Drift whispered" as passive agency`,
              `10. "Data streams flowed like rivers" for technical descriptions`,
              `11. AI-isms and cliché words: "a testament to", "tapestry", "symphony", "palpable", "delve", "echoed", "cacophony", "labyrinth"`,
              `12. Overdramatic physical reactions: "a shiver ran down his spine", "his blood ran cold", "heart hammered in his chest", "let out a breath he didn't know he was holding"`,
              `13. Grandiose metaphorical filler: "a delicate dance", "beacon of hope", "silent guardian", "symphony of destruction"`,
              ``,
              `## STRICT NEGATIVE CONSTRAINTS (MANDATORY)`,
              `1. NEVER use "Negative Telling" — never describe what a character *didn't* do or feel (e.g., "he didn't flinch"). Only describe concrete actions they *did* take.`,
              `2. NO "Analytical Summaries" — DO NOT explain the "meaning" or "purpose" of any action or setting. Only state the raw sensory facts and let the reader infer the stakes.`,
              `3. AVOID "Syntactic Monotony" — DO NOT start consecutive sentences with the same pronoun or noun (e.g., "He", "The"). Vary sentence openings using prepositional phrases, gerunds, or action beats.`,
            ].join('\n');
            const nextSteps = generateCalibrationPassSteps(nextPass, nextIdx, freshProject.title, infiniteSharedContext, false, currentDna, totalChapters);
            
            freshProject.steps.push(...nextSteps);
            runner.stateStore.save(freshProject);
          }
        }
      }

      if (step.taskType === 'manuscript_cleanup') {
        await runner.continuityGate.applyManuscriptCleanup(project, step, result);
      }
      if (step.taskType === 'revision_check' && step.label.includes('Revision Brief')) {
        await runner.revisionGate.apply(project, step, result);
      }

      const duration = Date.now() - startTime;
      for (const ability of appliedAbilities) {
        runner.stateStore.logAbilityExecution('director', ability.name, true, duration);
      }

      return result;
    } catch (err: any) {
      const duration = Date.now() - startTime;
      for (const ability of appliedAbilities) {
        runner.stateStore.logAbilityExecution('director', ability.name, false, duration, err.message || String(err));
      }
      throw err;
    }
  }

  private detectPovCharacter(project: Project, step: ProjectStep, runner: StepRunner): string | undefined {
    if (!step.chapterNumber) return undefined;

    let outlineResult: string | undefined;
    if (project.parentId) {
      const parent = runner.stateStore.get(project.parentId);
      const outlineStep = parent?.steps.find(s => s.label.includes('Outline') && s.phase === 'outline');
      outlineResult = outlineStep?.result;
    }
    if (!outlineResult) {
      const outlineStep = project.steps.find(s => s.label.includes('Outline') && s.phase === 'outline');
      outlineResult = outlineStep?.result;
    }
    if (!outlineResult) return undefined;

    const chapterSection = outlineResult.match(
      new RegExp(`Chapter\\s+${step.chapterNumber}\\b[\\s\\S]*?(?=Chapter\\s+${step.chapterNumber + 1}\\b|$)`, 'i')
    );
    if (!chapterSection) return undefined;

    const povMatch = chapterSection[0].match(/POV(?:\s+Character)?[:\s]+([^\n(]+)/i);
    if (povMatch) return povMatch[1].trim();

    return undefined;
  }

  private buildSystemPrompt(project: Project, step: ProjectStep, runner: StepRunner): string {
    const analyticalTypes = ['pov_check', 'stat_update', 'continuity_check', 'revision_audit', 'analysis', 'research'];
    const planningTypes = ['book_bible', 'outline', 'voice_profile'];

    if (analyticalTypes.includes(step.taskType)) {
      let prompt = `You are the P.E.R.R.Y. Analytical Engine — a strict literary critic and quality auditing system.\n\n`;
      prompt += `You are working on: "${project.title}"\n`;
      prompt += `Current task: ${step.label}\n\n`;
      prompt += `ROLE: You are NOT a creative writer. You are an auditor and grader.\n`;
      prompt += `OUTPUT FORMAT: Return ONLY the structured evaluation format specified in your task prompt.\n`;
      prompt += `CRITICAL: Do NOT write story content. Do NOT continue the narrative. Do NOT output prose. Grade, analyse, and report only.\n`;
      prompt += `CRITICAL: Do NOT summarise the plot or characters. Evaluate the PROSE TECHNIQUE against the criteria given.\n`;
      return prompt;
    }

    if (planningTypes.includes(step.taskType)) {
      let prompt = `You are the P.E.R.R.Y. System — an expert fiction plotting and world-building architect.\n\n`;
      prompt += `You are working on: "${project.title}"\n`;
      prompt += `Current task: ${step.label}\n\n`;
      prompt += `ROLE: You are an architect of fiction. Your job is to structure, track, and define the narrative elements.\n`;
      prompt += `INSTRUCTIONS: Complete the ENTIRE task in full. Do not skip sections, do not summarize unless explicitly asked, and do not use placeholders.\n`;
      prompt += `FORMATTING: Begin your response immediately with the first section heading. Output structured data only — tables, definitions, and lists. No preamble, no narrative prose.\n`;
      return prompt;
    }

    let prompt = `You are the P.E.R.R.Y. System (Predictive Engine for Rapid Revision & Yield), an expert fiction writing AI assistant.\n\n`;
    prompt += `You are working on: "${project.title}"\n`;
    prompt += `Current task: ${step.label}\n\n`;

    if (step.taskType === 'creative_writing' && step.wordCountTarget) {
      prompt += `TARGET WORD COUNT: ${step.wordCountTarget} words.\n`;
      prompt += `Write the COMPLETE chapter. Do not summarize, truncate, or use placeholders.\n\n`;
    }

    if ((project.context as any).isSeries && (project.context as any).seriesTotalBooks && (project.context as any).seriesCurrentBook) {
      const cur = (project.context as any).seriesCurrentBook;
      const total = (project.context as any).seriesTotalBooks;
      prompt += `SERIES: Book ${cur}/${total}. `;
      if (cur === 1) {
        prompt += `First book — plant hooks, leave the series conflict unresolved. Wrap only this book's plot.\n\n`;
      } else if (cur === total) {
        prompt += `Final book — resolve all series-level arcs and conflicts.\n\n`;
      } else {
        prompt += `Middle book — advance the series plot; resolve only this book's arc.\n\n`;
      }
    }

    prompt += `CRITICAL FORMATTING INSTRUCTION: Output ONLY the raw story prose. Do NOT output any conversational filler, introductory remarks, or revision notes (e.g. "Here is the revised chapter..."). Do NOT explain what you changed. Just output the story.\n`;

    const dnaDisabled = (project.context as any)?.disableStyleDna === true;
    const dnaGloballyEnabled = runner.router.config.get<boolean>('ai.styleDna.enabled', true);
    const routingTarget = runner.router.resolveRoutingTarget(step.taskType);
    const skipDnaForWriter = routingTarget === 'writer';

    if (step.taskType === 'creative_writing' || step.taskType === 'revision_execution') {
      const povCharacter = this.detectPovCharacter(project, step, runner);

      if (dnaGloballyEnabled && !dnaDisabled && !skipDnaForWriter) {
        const seed = runner.styleDna.compileSeed(project.id, step.chapterNumber || 0, povCharacter);
        if (seed) prompt += `\n${seed}\n`;

        const stepLabel = step.label.toLowerCase();
        const sceneType: 'action' | 'dialogue' | 'introspection' | 'general' =
          stepLabel.includes('action') ? 'action' :
          stepLabel.includes('dialogue') ? 'dialogue' :
          stepLabel.includes('introspection') ? 'introspection' : 'general';
        const goldenExamples = runner.styleDna.compileGoldenExamples(sceneType, 5);
        if (goldenExamples) prompt += `\n${goldenExamples}\n`;

        prompt += `\n## PROSE RHYTHM\n`;
        prompt += `Mix sentence lengths aggressively: a 15-word sentence, then a 3-word fragment, then a 30-word compound. `;
        prompt += `Never 3+ consecutive sentences at similar length. ≥1 intentional fragment per page. One-word paragraphs for emphasis.\n`;

        prompt += `\n## ANTI-AI CLICHES\n`;
        prompt += `- No "Rule of Three" lists ("He was a ghost. He was a glitch. He was a variable.")\n`;
        prompt += `- No repetitive dialogue tags ("said", "replied") — use action beats\n`;
        prompt += `- No nominalisations: "fluid" not "fluidness"; "synchronize" not "synchronization"\n`;
        prompt += `- No formulaic fragments ("He gasped. A wet sound."; "She smiled. A sad expression.")\n`;
        prompt += `- No cliché similes ("heart hammering like a trapped bird", "eyes like pools")\n`;
        prompt += `- Never use "transcend"\n`;
      }

      if (povCharacter) {
        prompt += `\n## COGNITIVE LENS (${povCharacter.toUpperCase()})\n`;
        prompt += `Write ONLY what ${povCharacter} would perceive, notice, and misinterpret.\n`;
        prompt += `- Use vocabulary and metaphors drawn from their background and expertise\n`;
        prompt += `- Have them MISS things outside their knowledge domain\n`;
        prompt += `- Include 1-2 moments where they misjudge, misremember, or have a blind spot\n`;
        prompt += `- Their internal monologue should have imperfect grammar — fragments, trailing thoughts, self-corrections\n`;
        prompt += `- Do NOT make every character equally articulate in dialogue. Match their education and emotional state.\n`;
      }
    }

    return prompt;
  }

  private getSceneTemperature(promptContent: string, step: ProjectStep): number {
    const lower = promptContent.toLowerCase();
    const jitter = (Math.random() - 0.5) * 0.06;

    if (step.chapterNumber === 0 || step.label.includes('Epilogue')) {
      return Math.min(1.0, Math.max(0.7, 0.90 + jitter));
    }

    const dialogueSignals = ['dialogue', 'conversation', 'argues', 'confronts', 'discusses', 'reveals to',
      'argument', 'debate', 'interrogat', 'negotiate', 'plea', 'confides', 'whispers', 'shouts',
      'phone call', 'meeting', 'interview', 'confront'];
    const actionSignals = ['fight', 'battle', 'chase', 'escape', 'combat', 'explosion', 'attack', 'ambush',
      'pursuit', 'siege', 'shootout', 'brawl', 'duel', 'assault', 'raid', 'standoff', 'flee',
      'infiltrat', 'heist', 'break-in', 'car crash', 'collapse'];
    const emotionalSignals = ['grief', 'loss', 'revelation', 'betrayal', 'confession', 'emotional', 'mourns',
      'heartbreak', 'reunion', 'forgive', 'breakdown', 'crying', 'trauma', 'funeral', 'goodbye',
      'intimate', 'vulnerable', 'regret', 'shame', 'guilt'];
    const expositionSignals = ['discovers', 'explains', 'world-building', 'exposition', 'lore', 'politics',
      'research', 'briefing', 'debrief', 'history', 'backstory', 'flashback', 'investigation',
      'intel', 'data', 'report', 'map', 'archives', 'council'];

    const hasDialogue = dialogueSignals.some(s => lower.includes(s));
    const hasAction = actionSignals.some(s => lower.includes(s));
    const hasEmotion = emotionalSignals.some(s => lower.includes(s));
    const hasExposition = expositionSignals.some(s => lower.includes(s));

    if (hasAction && !hasDialogue) {
      return Math.min(1.0, Math.max(0.7, 0.75 + jitter));
    }
    if (hasDialogue) {
      return Math.min(1.0, Math.max(0.7, 0.95 + jitter));
    }
    if (hasEmotion) {
      return Math.min(1.0, Math.max(0.7, 0.90 + jitter));
    }
    if (hasExposition) {
      return Math.min(1.0, Math.max(0.7, 0.78 + jitter));
    }

    return Math.min(1.0, Math.max(0.7, 0.85 + jitter));
  }
}
