/**
 * @perry/projects — Continuity Quality Gate
 *
 * Handles continuity_check results: resets chapters with contradictions,
 * extracts planning doc overrides, and queues manuscript cleanup steps.
 * Also includes the manuscript cleanup applicator (JSON patch logic).
 *
 * Extracted from step-runner.ts (lines 1283–1627).
 */

import type { Project, ProjectStep, EventBus, Logger } from '@perry/core';
import type { StateStore } from '../state-store.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export class ContinuityGate {
  constructor(
    private log: Logger,
    private eventBus: EventBus,
    private stateStore: StateStore,
    private workspaceDir: string,
  ) {}

  async apply(project: Project, continuityStep: ProjectStep, result: string): Promise<void> {
    try {
      const cleanPatterns = [/no\s+(?:continuity\s+)?issues?\s+(?:detected|found)/i, /all\s+(?:categories?\s+)?pass/i, /no\s+contradictions/i];
      const hasIssues = /###\s+(\[?Issue|\d+\.)/i.test(result);
      const hasBoldIssues = /\*\*(issue|contradiction|fix required|error found)[:\s*]/i.test(result);
      const isClean = !hasIssues && !hasBoldIssues && cleanPatterns.some(p => p.test(result));

      this.log.info('Continuity Quality Gate', { step: continuityStep.label, passed: isClean });
      if (isClean) return;

      // Final Continuity Audit → queue cleanup step instead of resetting chapters
      if (continuityStep.label.toLowerCase().includes('final continuity audit')) {
        this.log.info('Final Continuity Audit found issues. Queueing Manuscript Cleanup step.');
        const compileIdx = project.steps.findIndex(s => s.taskType === 'export');
        const existingCleanup = project.steps.find(s => s.taskType === 'manuscript_cleanup' && s.status !== 'completed');
        if (!existingCleanup) {
          const cleanupStep: ProjectStep = {
            id: `step-${Date.now()}-cleanup`, label: 'Manuscript Cleanup (Auto-Fixes)',
            phase: 'revision', taskType: 'manuscript_cleanup', status: 'pending',
            prompt: `Review the following Continuity Audit report and output a JSON array of exact text replacements.\n\nReport:\n${result}\n\nOutput ONLY valid JSON: [{"old": "exact old text", "new": "exact new text"}]\nDo NOT wrap in markdown code blocks.`,
          };
          if (compileIdx !== -1) project.steps.splice(compileIdx, 0, cleanupStep);
          else project.steps.push(cleanupStep);
          this.stateStore.save(project);
          this.eventBus.emit('step:progress', { projectId: project.id, stepId: continuityStep.id, message: 'Queued automated manuscript cleanup step.' });
        }
        return;
      }

      // Collect chapter numbers from issue sections only
      const chapterMentions = new Set<number>();
      const issueSections = result.split(/###\s+/).slice(1);
      for (const section of issueSections) {
        const matches = [...section.matchAll(/chapter\s+(\d+)/gi)];
        for (const m of matches) chapterMentions.add(parseInt(m[1], 10));
      }

      // Prologue/Epilogue detection (only within issue context)
      if (/###[^#]*prologue/i.test(result) || /(?:issue|error|fix|rewrite|contradiction)[^\n]*prologue|prologue[^\n]*(?:issue|error|fix|rewrite|contradiction)/i.test(result)) {
        chapterMentions.add(0);
      }
      if (/###[^#]*epilogue/i.test(result) || /(?:issue|error|fix|rewrite|contradiction)[^\n]*epilogue|epilogue[^\n]*(?:issue|error|fix|rewrite|contradiction)/i.test(result)) {
        const epiStep = project.steps.find(s => s.phase === 'writing' && s.label.toLowerCase() === 'epilogue');
        if (epiStep?.chapterNumber !== undefined) chapterMentions.add(epiStep.chapterNumber);
      }

      // Extract planning doc overrides
      const planningKeywords = ['character bible', 'outline', 'premise', 'plot threads', 'locations section', 'characters section', 'world building'];
      const sections = result.split(/###\s+/);
      const newOverrides: string[] = [];
      for (const section of sections) {
        if (planningKeywords.some(kw => section.toLowerCase().includes(kw))) {
          const fixMatch = section.match(/suggested\s+fix[:\s]*([^\n]+(?:\n(?!###)[^\n]+)*)/i);
          if (fixMatch) {
            const fix = fixMatch[1].trim();
            const existing = project.continuityOverrides || [];
            if (!existing.some(o => o.toLowerCase().includes(fix.substring(0, 40).toLowerCase()))) {
              newOverrides.push(fix);
            }
          }
        }
      }
      if (newOverrides.length > 0) {
        if (!project.continuityOverrides) project.continuityOverrides = [];
        project.continuityOverrides.push(...newOverrides);
        this.log.info('Planning overrides added', { count: newOverrides.length });
      }

      // Reset affected chapters
      let resetCount = 0;
      for (const chNum of Array.from(chapterMentions).sort((a, b) => a - b)) {
        const chapterStep = project.steps.find(s => s.phase === 'writing' && s.chapterNumber === chNum && s.taskType === 'creative_writing');
        if (!chapterStep) continue;
        if (chapterStep.status === 'pending' || chapterStep.status === 'active') continue;

        let retryCount = 0;
        const rm = chapterStep.prompt.match(/\[CONTINUITY-RETRY:\s*(\d+)\]/);
        if (rm) retryCount = parseInt(rm[1], 10);
        if (retryCount >= 3) { this.log.warn('Continuity gate: max retries', { step: chapterStep.label }); continue; }

        const nextRetry = retryCount + 1;
        const isTarget = (line: string) => {
          const lower = line.toLowerCase();
          if (chNum === 0) return lower.includes('prologue');
          const isEpi = project.steps.find(s => s.phase === 'writing' && s.label.toLowerCase() === 'epilogue')?.chapterNumber === chNum;
          if (isEpi) return lower.includes('epilogue');
          return lower.includes(`chapter ${chNum}`);
        };
        const issueLines = result.split('\n').filter(l => isTarget(l) && l.trim().length > 10);
        const issueText = issueLines.length > 0 ? issueLines.join('\n') : 'Continuity contradictions detected.';

        let cleanPrompt = chapterStep.prompt.replace(/\n\n\[CONTINUITY-RETRY:.*$/s, '');
        chapterStep.prompt = cleanPrompt + `\n\n[CONTINUITY-RETRY: ${nextRetry}] CONTINUITY FIX (Attempt ${nextRetry}):\n${issueText}\nFix all contradictions. Maintain character/timeline/location consistency.`;
        chapterStep.status = 'pending'; chapterStep.result = undefined; chapterStep.error = undefined;
        chapterStep.startedAt = undefined; chapterStep.completedAt = undefined;

        const followups = project.steps.filter(s => s.chapterNumber === chNum && s.phase !== 'writing' && s.status === 'completed' && (s.taskType === 'pov_check' || s.taskType === 'stat_update'));
        for (const f of followups) { f.status = 'pending'; f.result = undefined; }
        resetCount++;
      }

      if (resetCount > 0 || newOverrides.length > 0) {
        if (resetCount > 0) {
          // Self-retry counter: prevents the continuity gate from re-queuing itself indefinitely.
          // Each time it resets itself, it embeds [CONTINUITY-SELF-RETRY: N] in its own prompt.
          // After 3 self-resets, it accepts the current state and lets the pipeline move forward.
          const selfRetryMatch = continuityStep.prompt?.match(/\[CONTINUITY-SELF-RETRY:\s*(\d+)\]/);
          const selfRetryCount = selfRetryMatch ? parseInt(selfRetryMatch[1], 10) : 0;
          if (selfRetryCount >= 3) {
            this.log.warn('Continuity gate: max self-retries (3) reached — proceeding without re-queuing', {
              step: continuityStep.label, selfRetryCount,
            });
          } else {
            continuityStep.status = 'pending';
            continuityStep.result = undefined;
            continuityStep.prompt = (continuityStep.prompt || '')
              .replace(/\s*\[CONTINUITY-SELF-RETRY:\s*\d+\]/g, '')
              + `\n\n[CONTINUITY-SELF-RETRY: ${selfRetryCount + 1}]`;
          }
        }
        const completed = project.steps.filter(s => s.status === 'completed').length;
        project.progress = Math.round((completed / project.steps.length) * 100);
        this.stateStore.save(project);
        this.eventBus.emit('step:progress', { projectId: project.id, stepId: continuityStep.id, message: `Continuity gate: ${resetCount} chapter(s) reset, ${newOverrides.length} override(s) added` });
      }
    } catch (error: any) {
      this.log.error('Error in continuity quality gate', { error: error.message, step: continuityStep.label });
    }
  }

  async applyManuscriptCleanup(project: Project, cleanupStep: ProjectStep, result: string): Promise<void> {
    try {
      const jsonStart = result.indexOf('[');
      const jsonEnd = result.lastIndexOf(']');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON array found');
      const fixes: { old: string; new: string }[] = JSON.parse(result.substring(jsonStart, jsonEnd + 1));
      if (!Array.isArray(fixes) || fixes.length === 0) { this.log.info('No mechanical fixes provided.'); return; }

      let totalReplacements = 0;
      const contentSteps = project.steps.filter(s => (s.taskType === 'creative_writing' || s.phase === 'planning') && s.status === 'completed' && s.result);
      for (const step of contentSteps) {
        let text = step.result!;
        let modified = false;
        for (const fix of fixes) {
          if (!fix.old || !fix.new || fix.old === fix.new) continue;
          const newText = text.split(fix.old).join(fix.new);
          if (newText !== text) { modified = true; totalReplacements += (text.split(fix.old).length - 1); text = newText; }
        }
        if (modified) {
          step.result = text;
          await this.saveStepToDisk(project, step, text);
          this.log.info(`Manuscript Cleanup: Applied fixes to ${step.label}`);
        }
      }
      cleanupStep.result = `${result}\n\n**Cleanup Execution:** ${totalReplacements} text replacements applied.`;
      this.stateStore.save(project);
    } catch (error: any) {
      this.log.error('Error applying manuscript cleanup', { error: error.message });
      cleanupStep.result = `${result}\n\n**Cleanup Error:** ${error.message}`;
      this.stateStore.save(project);
    }
  }

  private async saveStepToDisk(project: Project, step: ProjectStep, result: string): Promise<void> {
    const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60);
    const baseDir = join(this.workspaceDir, 'projects', `${project.id}-${slug}`);
    let subDir = 'analysis';
    if (step.phase === 'writing' || step.taskType === 'creative_writing') subDir = 'manuscript';
    else if (step.taskType === 'export') subDir = 'exports';
    else if (step.phase === 'revision') subDir = 'revisions';
    else if (step.phase === 'planning') subDir = 'planning';
    const dir = join(baseDir, subDir);
    await mkdir(dir, { recursive: true });
    const filename = `${step.id}-${step.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50)}.md`;
    await (await import('fs/promises')).writeFile(join(dir, filename), `# ${step.label}\n\n${result}`, 'utf-8');
  }
}
