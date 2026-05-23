import type { Project, ProjectStep } from '@perry/core';
import type { StepRunnerStrategy } from './BaseRunner.js';
import type { StepRunner } from '../step-runner.js';

export class CompileRunner implements StepRunnerStrategy {
  canHandle(step: ProjectStep): boolean {
    return ['export', 'revision_compile', 'draft_compile'].includes(step.taskType);
  }

  async execute(project: Project, step: ProjectStep, runner: StepRunner): Promise<string> {
    try {
      let result = '';
      if (step.taskType === 'export') {
        result = await this.executeExport(project, step, runner);
      } else if (step.taskType === 'revision_compile') {
        result = await this.executeRevisionCompile(project, step, runner);
      } else if (step.taskType === 'draft_compile') {
        result = await this.executeDraftCompile(project, step, runner);
      }

      runner.stateStore.completeStep(project.id, step.id, result);
      await runner.saveStepToDisk(project, step, result);
      runner.eventBus.emit('step:completed', { projectId: project.id, stepId: step.id, result });
      runner.eventBus.emit('step:progress', { projectId: project.id, stepId: step.id, message: `Completed: ${step.label}` });

      return result;
    } catch (err: any) {
      runner.stateStore.failStep(project.id, step.id, err.message);
      runner.eventBus.emit('step:failed', { projectId: project.id, stepId: step.id, error: err.message });
      throw err;
    }
  }

  private async executeExport(project: Project, step: ProjectStep, runner: StepRunner): Promise<string> {
    runner.log.info('Executing mechanical export task');
    let manuscript = `# ${project.title}\n\n`;
    
    // Order of chapters: Prologue -> Chapters -> Epilogue
    const exportSteps = project.steps.filter(s => s.taskType === 'creative_writing' && s.status === 'completed');
    
    const prologue = exportSteps.find(s => s.label === 'Prologue');
    if (prologue && prologue.result) {
      manuscript += `${prologue.result}\n\n* * *\n\n`;
    }
    
    const chapters = exportSteps.filter(s => s.chapterNumber !== undefined && s.chapterNumber > 0).sort((a, b) => a.chapterNumber! - b.chapterNumber!);
    const compiledChapters = project.steps.filter(s => s.taskType === 'draft_compile' && s.status === 'completed');

    const processedChapters = new Set<number>();

    // Add compiled chapters
    for (const ch of compiledChapters) {
      if (ch.result && ch.chapterNumber) {
        if (ch.result.includes('P.E.R.R.Y. SYSTEM ALERT') || ch.result.includes('P.E.R.R.Y. System Alert') || ch.result.startsWith('BLOCKED')) {
          runner.log.warn('Skipping corrupted compiled chapter in export', { stepId: ch.id });
          continue;
        }
        manuscript += `${ch.result}\n\n* * *\n\n`;
        processedChapters.add(ch.chapterNumber);
      }
    }

    // Add any non-segmented creative_writing chapters (legacy or 1-segment chapters)
    for (const ch of chapters) {
      if (ch.result && ch.chapterNumber && !processedChapters.has(ch.chapterNumber) && !ch.segmentIndex) {
        if (ch.result.includes('P.E.R.R.Y. SYSTEM ALERT') || ch.result.includes('P.E.R.R.Y. System Alert') || ch.result.startsWith('BLOCKED')) {
          runner.log.warn('Skipping corrupted writing chapter in export', { stepId: ch.id });
          continue;
        }
        manuscript += `${ch.result}\n\n* * *\n\n`;
        processedChapters.add(ch.chapterNumber);
      }
    }
    
    const epilogue = exportSteps.find(s => s.label === 'Epilogue');
    if (epilogue && epilogue.result) {
      manuscript += `${epilogue.result}\n\n* * *\n\n`;
    }
    
    let result = manuscript.trim();

    // Run ProseSanitizer on the final assembled manuscript.
    result = runner.sanitizer.sanitize(result);

    // Cross-chapter duplicate passage scan — runs once at compile time.
    runner.dedup.scanForCrossChapterDuplicates(project, step, exportSteps);

    return result;
  }

  private async executeRevisionCompile(project: Project, step: ProjectStep, runner: StepRunner): Promise<string> {
    runner.log.info('Executing mechanical revision compile task', { chapter: step.chapterNumber });
    
    let compiledChapter = '';
    const segments = project.steps
      .filter(s => s.taskType === 'revision_execution' && s.chapterNumber === step.chapterNumber && s.status === 'completed' && s.result)
      .sort((a, b) => (a.segmentIndex || 0) - (b.segmentIndex || 0));

    for (const seg of segments) {
      if (!seg.result) continue;
      if (seg.result.includes('P.E.R.R.Y. SYSTEM ALERT') || seg.result.includes('P.E.R.R.Y. System Alert') || seg.result.startsWith('BLOCKED')) {
        runner.log.warn('Skipping corrupted segment in revision compile', { stepId: seg.id });
        continue;
      }
      let text = runner.sanitizer.stripSegmentHeaders(seg.result);
      text = runner.sanitizer.sanitize(text);
      
      if (compiledChapter.length > 0) {
        const trimmedCompiled = compiledChapter.trimEnd();
        if (!trimmedCompiled.match(/[.!?:"'”]$/) && !trimmedCompiled.endsWith('⁂')) {
          compiledChapter = trimmedCompiled + ' ' + text + '\n\n';
        } else {
          compiledChapter = trimmedCompiled + '\n\n' + text + '\n\n';
        }
      } else {
        compiledChapter = `${text}\n\n`;
      }
    }
    
    return compiledChapter.trim();
  }

  private async executeDraftCompile(project: Project, step: ProjectStep, runner: StepRunner): Promise<string> {
    runner.log.info('Executing mechanical draft compile task', { chapter: step.chapterNumber });
    
    let compiledChapter = '';
    const segments = project.steps
      .filter(s => s.taskType === 'creative_writing' && s.chapterNumber === step.chapterNumber && s.status === 'completed' && s.result)
      .sort((a, b) => (a.segmentIndex || 0) - (b.segmentIndex || 0));

    for (const seg of segments) {
      if (!seg.result) continue;
      if (seg.result.includes('P.E.R.R.Y. SYSTEM ALERT') || seg.result.includes('P.E.R.R.Y. System Alert') || seg.result.startsWith('BLOCKED')) {
        runner.log.warn('Skipping corrupted segment in draft compile', { stepId: seg.id });
        continue;
      }
      let text = runner.sanitizer.stripSegmentHeaders(seg.result);
      text = runner.sanitizer.sanitize(text);

      if (compiledChapter.length > 0) {
        const trimmedCompiled = compiledChapter.trimEnd();
        if (!trimmedCompiled.match(/[.!?:"'”]$/) && !trimmedCompiled.endsWith('⁂')) {
          compiledChapter = trimmedCompiled + ' ' + text + '\n\n';
        } else {
          compiledChapter = trimmedCompiled + '\n\n' + text + '\n\n';
        }
      } else {
        compiledChapter = `${text}\n\n`;
      }
    }
    
    let result = compiledChapter.trim();

    // POV Continuity Check
    if ((project.type as string) === 'style-calibration' && segments.length === 2) {
      const part1 = segments[0]?.result || '';
      const part2 = segments[1]?.result || '';
      const povFracture = this.detectPovFracture(part1, part2);
      if (povFracture) {
        runner.log.warn('POV FRACTURE detected at compile — character switched between Part 1 and Part 2', {
          chapter: step.chapterNumber,
          fracture: povFracture,
        });
        result = `[⚠️ AUTO-DETECTED POV FRACTURE: ${povFracture}. The POV character appears to have changed between Part 1 and Part 2. Grade this harshly on Deep POV.]\n\n${result}`;
      }
    }

    return result;
  }

  private detectPovFracture(part1: string, part2: string): string | null {
    if (!part1 || !part2) return null;
    const extractDominantName = (text: string): [string, number] | null => {
      const counts = new Map<string, number>();
      const matches = text.match(/(?<=[a-z,;!?"'] )[A-Z][a-z]{2,15}/g) || [];
      const skip = new Set(['The','His','Her','She','He','They','But','And','For','With','Its']);
      for (const name of matches) {
        if (!skip.has(name)) counts.set(name, (counts.get(name) || 0) + 1);
      }
      if (counts.size === 0) return null;
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return top[1] > 2 ? top : null;
    };
    const d1 = extractDominantName(part1);
    const d2 = extractDominantName(part2);
    if (!d1 || !d2) return null;
    if (d1[0] !== d2[0]) {
      return `Part 1 centres on "${d1[0]}" (${d1[1]}x), Part 2 shifts to "${d2[0]}" (${d2[1]}x)`;
    }
    return null;
  }
}
