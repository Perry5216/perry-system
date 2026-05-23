import type { ProjectStep, ProjectContext, ProjectTemplate } from '@perry/core';

function step(
  index: number,
  label: string,
  phase: string,
  taskType: string,
  prompt: string,
  opts?: {
    wordCountTarget?: number;
    chapterNumber?: number;
    segmentIndex?: number;
    totalSegments?: number;
    networkRequests?: ProjectStep['networkRequests'];
  },
): ProjectStep {
  return {
    id: `step-${index}`,
    label,
    phase,
    taskType,
    prompt,
    status: 'pending',
    wordCountTarget: opts?.wordCountTarget,
    chapterNumber: opts?.chapterNumber,
    segmentIndex: opts?.segmentIndex,
    totalSegments: opts?.totalSegments,
    networkRequests: opts?.networkRequests,
  };
}

const systemEvolution: ProjectTemplate = {
  type: 'system-evolution',
  workType: 'meta',
  name: 'System Evolution & Skill Tuning',
  description: 'Evaluate agent execution logs, discover optimization patterns, and synthesize refined skills.',
  buildSteps: (ctx: ProjectContext, title: string, description: string) => {
    return [
      step(1, 'Log Analysis & Pattern Discovery', 'planning', 'research',
        `Analyze the recent execution logs and trajectory telemetry for: ${title}\n\nDescription: ${description}\n\nIdentify performance bottlenecks, stylistic drifts, or recurring errors.`),
      step(2, 'Skill/Playbook Synthesis', 'writing', 'architect',
        `Based on the analysis, draft a new modular playbook or skill markdown definition to improve agent intelligence in this area.`),
      step(3, 'Integration & Verification', 'verification', 'reviewer',
        `Review the generated skill playbook, verify its structure, and run target checks to ensure no regressions occur in the codebase.`)
    ];
  }
};

const templateGenerator: ProjectTemplate = {
  type: 'template-generator',
  workType: 'meta',
  name: 'Template & Pipeline Generator',
  description: 'Generate custom templates and project pipelines from existing execution instances.',
  buildSteps: (ctx: ProjectContext, title: string, description: string) => {
    return [
      step(1, 'Project Structure Intake', 'planning', 'research',
        `Analyze the stages, steps, prompts, and overrides of the designated target project: ${title}\n\nDescription: ${description}`),
      step(2, 'Pipeline Schema Generation', 'writing', 'architect',
        `Structure the custom pipeline schema inside .config/custom_pipelines.json, preserving the ordering and taskTypes.`),
      step(3, 'Librarian Skill Registration', 'verification', 'reviewer',
        `Generate the template-builder playbook skill and register it to the Domain Registry default skills list.`)
    ];
  }
};

export const metaTemplates: ProjectTemplate[] = [
  systemEvolution,
  templateGenerator
];
