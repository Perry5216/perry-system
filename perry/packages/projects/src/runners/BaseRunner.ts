import type { Project, ProjectStep } from '@perry/core';
import type { StepRunner } from '../step-runner.js';

export interface StepRunnerStrategy {
  canHandle(step: ProjectStep): boolean;
  execute(project: Project, step: ProjectStep, runner: StepRunner): Promise<string>;
}
