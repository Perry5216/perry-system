/**
 * @perry/projects — Revision Quality Gate
 *
 * Acts on Pass H (Revision Brief) verdicts:
 * PASS → do nothing. REVISE → queue targeted cleanup. REWRITE → reset chapter.
 * Max 2 revision cycles per chapter.
 *
 * Extracted from step-runner.ts (lines 1128–1281).
 */

import type { Project, ProjectStep, EventBus, Logger } from '@perry/core';
import type { StateStore } from '../state-store.js';

export class RevisionGate {
  constructor(
    private log: Logger,
    private eventBus: EventBus,
    private stateStore: StateStore,
  ) {}

  async apply(project: Project, briefStep: ProjectStep, result: string): Promise<void> {
    try {
      const chapterNum = briefStep.chapterNumber;
      const verdictMatch = result.match(/\*\*Verdict:\*\*\s*(PASS|REVISE|REWRITE)/i);
      const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'PASS';

      this.log.info('Revision Quality Gate', { chapter: `Chapter ${chapterNum}`, verdict });
      this.eventBus.emit('step:progress', { projectId: project.id, stepId: briefStep.id, message: `Revision Brief — Chapter ${chapterNum}: ${verdict}` });
      if (verdict === 'PASS') return;

      const chapterStep = project.steps.find(s => s.taskType === 'creative_writing' && s.chapterNumber === chapterNum);
      if (!chapterStep) return;

      const retryMatch = chapterStep.prompt.match(/\[REVISION-RETRY:\s*(\d+)\]/);
      const retryCount = retryMatch ? parseInt(retryMatch[1], 10) : 0;
      if (retryCount >= 2) { this.log.warn('Revision gate: max cycles reached', { chapter: chapterStep.label }); return; }

      // Shared total-rewrite cap \u2014 same [TOTAL-REWRITES: N] counter injected by the POV gate.
      // Prevents compound loops: 3 POV retries + 2 revision retries = 5 total rewrites max.
      const totalRewriteMatch = chapterStep.prompt.match(/\[TOTAL-REWRITES:\s*(\d+)\]/);
      const totalRewrites = totalRewriteMatch ? parseInt(totalRewriteMatch[1], 10) : 0;
      if (totalRewrites >= 5) {
        this.log.warn('Revision gate: absolute rewrite cap (5) reached \u2014 accepting chapter as-is', {
          chapter: chapterStep.label, totalRewrites,
        });
        return;
      }
      const nextTotalRewrites = totalRewrites + 1;

      if (verdict === 'REVISE') {
        const compileIdx = project.steps.findIndex(s => s.taskType === 'export');
        const existing = project.steps.find(s => s.taskType === 'manuscript_cleanup' && s.chapterNumber === chapterNum && s.status !== 'completed');
        if (!existing) {
          const cleanupStep: ProjectStep = {
            id: `step-${Date.now()}-rev-cleanup-ch${chapterNum}`,
            label: `Chapter ${chapterNum} \u2014 Revision Patch`,
            phase: 'revision', taskType: 'manuscript_cleanup', chapterNumber: chapterNum, status: 'pending',
            prompt: `Apply targeted line-level revisions to Chapter ${chapterNum}.\n\n${result}\n\nOutput ONLY valid JSON: [{"old": "exact original text", "new": "revised text"}]`,
          };
          const insertIdx = compileIdx !== -1 ? compileIdx : project.steps.length;
          project.steps.splice(insertIdx, 0, cleanupStep);
          this.stateStore.save(project);
          this.eventBus.emit('step:progress', { projectId: project.id, stepId: briefStep.id, message: `Queued revision patch for Chapter ${chapterNum}.` });
        }
        return;
      }

      if (verdict === 'REWRITE') {
        const nextRetry = retryCount + 1;
        const issuesMatch = result.match(/\*\*Critical Issues:\*\*([\s\S]*?)\*\*Line Rewrites:/i);
        const issueText = issuesMatch ? issuesMatch[1].trim() : 'See Revision Brief.';
        let cleanPrompt = chapterStep.prompt
          .replace(/\n\n\[REVISION-RETRY:.*$/s, '')
          .replace(/\s*\[TOTAL-REWRITES:\s*\d+\]/g, '');
        chapterStep.prompt = cleanPrompt +
          `\n\n[REVISION-RETRY: ${nextRetry}] REVISION REWRITE (Cycle ${nextRetry}):\n${issueText}\n\nAddress all issues. Write the full chapter.` +
          `\n\n[TOTAL-REWRITES: ${nextTotalRewrites}]`;
        chapterStep.status = 'pending'; chapterStep.result = undefined; chapterStep.error = undefined;
        chapterStep.startedAt = undefined; chapterStep.completedAt = undefined;

        // Reset all revision passes for this chapter
        for (const rp of project.steps.filter(s => s.taskType === 'revision_check' && s.chapterNumber === chapterNum)) {
          rp.status = 'pending'; rp.result = undefined; rp.startedAt = undefined; rp.completedAt = undefined;
        }
        for (const f of project.steps.filter(s => s.chapterNumber === chapterNum && (s.taskType === 'pov_check' || s.taskType === 'stat_update'))) {
          f.status = 'pending'; f.result = undefined;
        }

        const completed = project.steps.filter(s => s.status === 'completed').length;
        project.progress = Math.round((completed / project.steps.length) * 100);
        this.stateStore.save(project);
        this.eventBus.emit('step:progress', { projectId: project.id, stepId: briefStep.id, message: `Chapter ${chapterNum} queued for full rewrite (cycle ${nextRetry}).` });
      }
    } catch (error: any) {
      this.log.error('Error in revision quality gate', { error: error.message, step: briefStep.label });
    }
  }
}
