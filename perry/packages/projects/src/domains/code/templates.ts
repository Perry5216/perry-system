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

const softwareDev: ProjectTemplate = {
  type: 'software-dev',
  workType: 'code',
  name: 'Software Development',
  description: 'Design, implement, review, and verify software tasks.',
  buildSteps: (ctx: ProjectContext, title: string, description: string) => {
    return [
      step(1, 'Architecting & Design', 'planning', 'architect',
        `Create a detailed implementation plan for: ${title}\n\nDescription: ${description}`),
      step(2, 'Implementation', 'writing', 'coder',
        `Write code based on the design.\n\nDescription: ${description}`),
      step(3, 'Verification', 'verification', 'reviewer',
        `Verify the changes against requirements and run tests.`)
    ];
  }
};

export const codeTemplates: ProjectTemplate[] = [
  softwareDev
];
