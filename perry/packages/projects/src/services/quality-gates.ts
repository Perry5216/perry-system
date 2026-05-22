/**
 * Per-step output quality gates.
 *
 * Runs after a step's result lands. Returns null if the result passes; returns
 * a short failure tag if it doesn't.
 */

import { Project, ProjectStep } from '@perry/core';

export type QualityGate = (result: string, step: ProjectStep, project: Project) => string | null;

export function getGateFor(step: ProjectStep): QualityGate | null {
  return null;
}
