/**
 * @perry/projects — Template Registry
 *
 * Defines all project types and their step sequences.
 */

import type { ProjectStep, ProjectType, ProjectContext } from '@perry/core';

export interface ProjectTemplate {
  type: ProjectType;
  name: string;
  description: string;
  buildSteps: (context: ProjectContext, title: string, description: string) => ProjectStep[];
}

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
  name: 'Software Development',
  description: 'Design, implement, review, and verify software tasks.',
  buildSteps: (ctx, title, description) => {
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

export function generateCalibrationPassSteps(
  pass: number,
  startIdx: number,
  title: string,
  ctx: any,
  isFinal: boolean,
  unused?: any,
  totalChapters?: number
): any[] {
  return [];
}

const TEMPLATES = new Map<string, ProjectTemplate>([
  ['software-dev', softwareDev],
]);

export class TemplateRegistry {
  /** Get a template by type name. */
  get(type: string): ProjectTemplate | undefined {
    return TEMPLATES.get(type);
  }

  /** List all available templates. */
  list(): ProjectTemplate[] {
    return Array.from(TEMPLATES.values());
  }

  /** Register a custom template. */
  register(template: ProjectTemplate): void {
    TEMPLATES.set(template.type, template);
  }
}
