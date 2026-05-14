/**
 * @perry/projects — POV Quality Gate
 *
 * Evaluates pov_check results and auto-resets chapters that fail.
 * Uses StyleDnaService V2 for structured learning (filter words,
 * show-vs-tell, character voice).
 * Score parsing defaults to 0 (fail-safe) instead of 10 (pass-through).
 *
 * V3: Integrated ProseMetricsService — measures sentence variation,
 * adverb density, vocabulary richness, and dialogue naturalness.
 * Corrective instructions are injected into the rewrite prompt
 * instead of growing the permanent ban list.
 *
 * Extracted from step-runner.ts, upgraded for DNA V2.
 */

import type { Project, ProjectStep, EventBus, Logger } from '@perry/core';
import type { StateStore } from '../state-store.js';
import type { StyleDnaService } from '../services/style-dna-service.js';
import { ProseMetricsService } from '../services/prose-metrics.js';

export class PovQualityGate {
  private proseMetrics: ProseMetricsService;

  constructor(
    private log: Logger,
    private eventBus: EventBus,
    private stateStore: StateStore,
    private styleDna: StyleDnaService,
  ) {
    this.proseMetrics = new ProseMetricsService();
  }

  async apply(project: Project, povStep: ProjectStep, result: string): Promise<string> {
    // BUG FIX N1: Require structured field format to prevent silent pass-through.
    // Loose regex like /pov\s+score[^\d]*(\d+)/ matched narrative sentences e.g.
    // "the POV score fell to a 6" in a hallucinated free-form analysis.
    // Now require the exact bold-field format produced by the grading template.
    const scoreMatch = result.match(/\*\*Deep POV Score\*\*[:\s]*(\d+)/i)
      ?? result.match(/Deep POV Score[:\s]*(\d+)/i)  // fallback for un-bolded format
      ?? result.match(/POV Score[^\d]*(\d+)/i);       // legacy fallback
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;

    const pacingMatch = result.match(/\*\*Pacing Score\*\*[:\s]*(\d+)/i)
      ?? result.match(/Pacing Score[:\s]*(\d+)/i)
      ?? result.match(/pacing[^\d]*(\d+)/i);
    const pacingScore = pacingMatch ? parseInt(pacingMatch[1], 10) : 0;

    const hookMatch = result.match(/\*\*Hook Score\*\*[:\s]*(\d+)/i)
      ?? result.match(/Hook Score[:\s]*(\d+)/i)
      ?? result.match(/hook[^\d]*(\d+)/i);
    const hookScore = hookMatch ? parseInt(hookMatch[1], 10) : 0;

    // Format validator: if fewer than 4 of the 7 required fields are present,
    // the entire output is a malformed hallucination — default all to 0 (fail-safe).
    const requiredFields = [
      /POV Character/i, /Outline Match/i, /Deep POV Score/i,
      /Pacing Score/i, /Hook Score/i, /Filter Words/i, /Verdict/i,
    ];
    const fieldsPresent = requiredFields.filter(f => f.test(result)).length;
    const isWellFormed = fieldsPresent >= 4;
    if (!isWellFormed) {
      this.log.warn('POV check output is malformed (hallucination suspected) — treating all scores as 0', {
        step: povStep.label, fieldsPresent, fieldsRequired: requiredFields.length,
      });
    }
    const effectiveScore = isWellFormed ? score : 0;
    const effectivePacing = isWellFormed ? pacingScore : 0;
    const effectiveHook = isWellFormed ? hookScore : 0;

    const matchResult = result.match(/outline\s+match[:\s]*(yes|no)/i);
    const outlineMatch = matchResult ? matchResult[1].toUpperCase() === 'YES' : true;
    const povMatch = result.match(/pov\s+character[:\s]*([^\n]+)/i);
    const detectedPov = povMatch ? povMatch[1].trim() : 'unknown';
    const issuesMatch = result.match(/\*\*issues\*\*[:\s]*([^\n]+(?:\n(?!\s*-\s*\*\*)[^\n]+)*)/i);
    const issues = issuesMatch ? issuesMatch[1].trim() : '';
    const stalledMatch = result.match(/plot\s+threads?\s+stalled[:\s]*([^\n]+(?:\n(?!\s*-\s*\*\*)[^\n]+)*)/i);
    const stalledThreads = stalledMatch ? stalledMatch[1].trim() : '';
    const filterMatch = result.match(/filter\s+words?\s+found[:\s]*([^\n]+(?:\n(?!\s*-\s*\*\*)[^\n]+)*)/i);
    const filterWords = filterMatch ? filterMatch[1].trim() : '';
    const showTellMatch = result.match(/show\s+vs\s+tell[:\s]*([^\n]+(?:\n(?!\s*-\s*\*\*)[^\n]+)*)/i);
    const showTellViolations = showTellMatch ? showTellMatch[1].trim() : '';
    const tropeWarnMatch = result.match(/trope\s+warnings?[:\s]*([^\n]+(?:\n(?!\s*-\s*\*\*)[^\n]+)*)/i);
    const tropeWarnings = tropeWarnMatch ? tropeWarnMatch[1].trim() : '';
    const aiIsmsMatch = result.match(/ai-isms?\s+found[:\s]*([^\n]+(?:\n(?!\s*-\s*\*\*)[^\n]+)*)/i);
    const aiIsmsFound = aiIsmsMatch ? aiIsmsMatch[1].trim() : '';

    // ── Style DNA V2 Learning ──
    const dnaUpdated = this.styleDna.learnFromFailure(
      project.id,
      povStep.label,
      filterWords,
      showTellViolations,
      tropeWarnings,
      detectedPov !== 'unknown' ? detectedPov : undefined,
    );

    // ── Prose Metrics Analysis ──────────────────────────────────────────────
    // Run automated prose quality analysis on the actual chapter text
    const chapterNum = povStep.chapterNumber || 0;
    const chapterStep = project.steps.find(
      (s: ProjectStep) => s.chapterNumber === chapterNum &&
        (s.taskType === 'creative_writing' || s.taskType === 'draft_compile' || s.taskType === 'revision_execution') &&
        s.status === 'completed' && s.result,
    );

    let metricsCorrection = '';
    if (chapterStep?.result) {
      const metrics = this.proseMetrics.analyze(chapterStep.result);
      const report = this.proseMetrics.evaluate(metrics);

      this.log.info('Prose Metrics', {
        step: povStep.label,
        avgSentLen: metrics.avgSentenceLength,
        stdDev: metrics.sentenceLengthStdDev,
        monotony: `${metrics.sentenceMonotonyPct}%`,
        adverbs: `${metrics.adverbDensityPct}%`,
        uniqueWords: metrics.uniqueWordRatio,
        contractions: `${metrics.dialogueContractionPct}%`,
        fragments: metrics.fragmentCount,
        overall: report.overallPass ? 'PASS' : 'FAIL',
      });

      if (!report.overallPass && report.correctiveInstructions) {
        metricsCorrection = `\n${report.correctiveInstructions}\n`;
        this.log.info('Prose metrics corrections generated', {
          failures: report.failures.length,
          step: povStep.label,
        });
      }

      // Always record metrics in Style DNA — pass or fail.
      // This builds a rolling trend that compileSeed() uses to inject
      // dynamic, data-driven warnings into the NEXT chapter's system prompt.
      this.styleDna.learnFromMetrics(
        project.id,
        chapterNum,
        povStep.label,
        {
          avgSentenceLength:    metrics.avgSentenceLength,
          sentenceMonotonyPct:  metrics.sentenceMonotonyPct,
          heTheOpeningRatePct:  metrics.heTheOpeningRatePct,
          adverbDensityPct:     metrics.adverbDensityPct,
          uniqueWordRatio:      metrics.uniqueWordRatio,
          toBeVerbDensityPct:   metrics.toBeVerbDensityPct,
          fragmentCount:        metrics.fragmentCount,
        }
      );
    }

    const povPassed = effectiveScore >= 8 && outlineMatch;
    const pacingPassed = effectivePacing >= 8;
    const hookPassed = effectiveHook >= 8;
    const revisionSuccessMatch = result.match(/revision\s+success[:\s]*(yes|no|partial)/i);
    const revisionSuccess = revisionSuccessMatch ? revisionSuccessMatch[1].toUpperCase() : 'YES';
    const revisionPassed = revisionSuccess !== 'NO';
    const metricsPassed = metricsCorrection.length === 0;
    // RELAXED: Do not hard-fail the entire chapter purely on sentence math (metricsPassed)
    const passed = povPassed && pacingPassed && hookPassed && revisionPassed;

    this.log.info('POV & Narrative Quality Gate', { step: povStep.label, score, pacingScore, hookScore, outlineMatch, detectedPov, revisionSuccess, dnaUpdated, metricsPassed, passed });
    
    // Append metrics correction to the result so the user sees it in the markdown file
    if (metricsCorrection) {
      result += `\n\n${metricsCorrection}\n`;
    }

    if (passed) return result;

    // For Style Calibration, we intentionally DO NOT want to rewrite failures.
    // We want the failures to persist so the Summary step can synthesize them
    // into directives for the NEXT pass.
    if (project.type === 'style-calibration') {
      this.log.info('POV gate failed, but skipping auto-rewrite (style-calibration mode)');
      return result;
    }

    // Find ALL chapter steps to rewrite (supports segmented architecture)
    const writeSteps = project.steps.filter(
      (s: ProjectStep) => s.chapterNumber === chapterNum &&
        (s.taskType === 'creative_writing' || s.taskType === 'revision_execution') &&
        (s.phase === 'writing' || s.phase === 'revision'),
    );
    if (writeSteps.length === 0) { this.log.warn('POV gate triggered but chapter steps not found', { chapterNum }); return result; }
    
    // Check if any segment is already running
    if (writeSteps.some(s => s.status === 'pending' || s.status === 'active')) { 
      this.log.info('POV gate: chapter already queued', { chapter: writeSteps[0].label }); 
      return result; 
    }

    // Use the first segment to determine retry count
    let retryCount = 0;
    const retryMatch = writeSteps[0].prompt.match(/\[POV-RETRY:\s*(\d+)\]/);
    if (retryMatch) retryCount = parseInt(retryMatch[1], 10);
    if (retryCount >= 3) { this.log.warn('POV gate: max retries reached', { step: writeSteps[0].label, retryCount }); return result; }

    // Shared total-rewrite cap — same counter read by the Revision gate.
    // Prevents compound loops where both gates fire on the same chapter (3 POV + 2 Revision = 5 rewrites).
    const totalRewriteMatch = writeSteps[0].prompt.match(/\[TOTAL-REWRITES:\s*(\d+)\]/);
    const totalRewrites = totalRewriteMatch ? parseInt(totalRewriteMatch[1], 10) : 0;
    if (totalRewrites >= 5) {
      this.log.warn('POV gate: absolute rewrite cap (5) reached — accepting chapter as-is', { step: writeSteps[0].label, totalRewrites });
      return result;
    }
    const nextTotalRewrites = totalRewrites + 1;

    const nextRetry = retryCount + 1;

    let correction = `\n\n[POV-RETRY: ${nextRetry}] CRITICAL REWRITE INSTRUCTIONS (Attempt ${nextRetry}):\n`;
    if (!outlineMatch) correction += `- Your previous attempt used ${detectedPov}'s POV. This is WRONG.\n- You MUST write from the POV character specified in the Chapter Outline.\n`;
    if (score < 8) correction += `- DEEP POV FAILED (${score}/10, need 8+): ${issues || 'head-hopping or inconsistent narrative voice'}\n- Remove ALL filter words. Deepen internal monologue.\n`;
    if (pacingScore < 8) correction += `- PACING FAILED (${pacingScore}/10, need 8+): Cut filler. Make EVENTS happen.\n`;
    if (hookScore < 8) correction += `- HOOK FAILED (${hookScore}/10, need 8+): End on a cliffhanger or revelation.\n`;
    if (stalledThreads && stalledThreads.toLowerCase() !== 'none') correction += `- STALLED PLOT THREADS: ${stalledThreads}\n`;
    if (filterWords && filterWords.toLowerCase() !== 'none') correction += `- FILTER WORDS DETECTED: Style DNA updated to ban these.\n`;
    if (showTellViolations && showTellViolations.toLowerCase() !== 'none') correction += `- SHOW VS TELL: Convert telling to showing.\n`;
    if (tropeWarnings && tropeWarnings.toLowerCase() !== 'none') correction += `- TROPE WARNING: ${tropeWarnings}\n`;
    if (aiIsmsFound && aiIsmsFound.toLowerCase() !== 'none') correction += `- AI-ISMS DETECTED: ${aiIsmsFound}\n`;

    // Append prose metrics corrections if any
    if (metricsCorrection) {
      correction += metricsCorrection;
    }

    // Apply correction and reset ALL segments
    for (const step of writeSteps) {
      let cleanPrompt = step.prompt
        .replace(/\n\n\[POV-RETRY:.*$/s, '')
        .replace(/\s*\[TOTAL-REWRITES:\s*\d+\]/g, ''); // strip old shared counter before re-injecting
      
      // Document Healing: Instead of erasing the draft, capture it and inject it 
      // into the prompt so the LLM edits it rather than starting from scratch.
      const oldDraft = step.result || '';
      let healingBlock = '';
      if (oldDraft) {
        if (pacingScore <= 5 || !outlineMatch) {
          // DO NOT inject the old draft for structural failures. 
          // It causes the LLM to anchor onto the broken text and hallucinate characters.
          healingBlock = `\n\n[STRUCTURAL REWRITE: Your previous attempt was discarded because the pacing was too slow or you used the wrong POV character. You must start fresh. Expand dialogue, condense boring transition sequences, and make events happen.]\n`;
        } else {
          healingBlock = `\n\n### YOUR PREVIOUS DRAFT (NEEDS HEALING)\n` +
            `Below is your previous attempt. Do NOT write a completely new chapter from scratch. ` +
            `Instead, REVISE and HEAL the text below line-by-line to fix the critical issues listed above. ` +
            `Keep the good parts, but aggressively fix the prose, Deep POV, and sentence monotony.\n\n` +
            `---\n${oldDraft}\n---\n\n` +
            `Now, output the fully revised chapter below:\n`;
        }
      }

      step.status = 'pending'; 
      step.result = undefined; 
      step.error = undefined;
      step.startedAt = undefined; 
      step.completedAt = undefined;
      step.prompt = cleanPrompt + correction + healingBlock + `\n\n[TOTAL-REWRITES: ${nextTotalRewrites}]`;
    }

    povStep.status = 'pending'; povStep.result = undefined; povStep.error = undefined;
    povStep.startedAt = undefined; povStep.completedAt = undefined;

    // Only reset stat_update if the POV character was wrong.
    // The stat_update's Narrative Directives are character-specific — resetting them for prose-only
    // failures (pacing, hook) produces different directives that can cascade into Ch N+1 failing its gate.
    if (!outlineMatch) {
      const statUpdate = project.steps.find((s: ProjectStep) => s.chapterNumber === chapterNum && s.taskType === 'stat_update' && s.status === 'completed');
      if (statUpdate) { statUpdate.status = 'pending'; statUpdate.result = undefined; statUpdate.startedAt = undefined; statUpdate.completedAt = undefined; }
    }

    // BUG FIX N4: Reset draft_compile so it doesn't concatenate old (failed) segments with new ones.
    // Previously only stat_update was reset; if draft_compile ran after the first attempt it would
    // hold compiled data from the failed chapter and merge it with the rewritten output.
    const draftCompile = project.steps.find((s: ProjectStep) => s.chapterNumber === chapterNum && s.taskType === 'draft_compile' && s.status === 'completed');
    if (draftCompile) { draftCompile.status = 'pending'; draftCompile.result = undefined; draftCompile.startedAt = undefined; draftCompile.completedAt = undefined; }

    const completed = project.steps.filter((s: ProjectStep) => s.status === 'completed').length;
    project.progress = Math.round((completed / project.steps.length) * 100);
    this.stateStore.save(project);

    const failReasons: string[] = [];
    if (effectiveScore < 8) failReasons.push(`POV: ${effectiveScore}/10`);
    if (effectivePacing < 7) failReasons.push(`Pacing: ${effectivePacing}/10`);
    if (effectiveHook < 7) failReasons.push(`Hook: ${effectiveHook}/10`);
    if (!isWellFormed) failReasons.push('Malformed output (hallucination)');
    if (!metricsPassed) failReasons.push('Prose metrics');
    if (dnaUpdated) failReasons.push('Style DNA updated');
    if (!outlineMatch) failReasons.push('Wrong POV character');
    this.eventBus.emit('step:progress', { projectId: project.id, stepId: writeSteps[0].id, message: `Quality gate failed (${failReasons.join(', ')}) — rewrite attempt ${nextRetry}` });
    
    return result;
  }
}

