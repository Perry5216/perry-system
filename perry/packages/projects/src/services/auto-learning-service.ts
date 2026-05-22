/**
 * @perry/projects — Auto-Learning Service (Stub)
 */

import type { Logger } from '@perry/core';
import type { StateStore } from '../state-store.js';

export class AutoLearningService {
  constructor(
    private workspaceDir: string,
    private styleDna: any,
    private log: Logger,
    private stateStore?: StateStore
  ) {}

  public async appendClaudeInjectedPairForPen(
    slug: string,
    bad: string,
    good: string,
    category: string
  ): Promise<{ success: boolean; reason?: string }> {
    return { success: true };
  }

  public async exportForPen(slug: string): Promise<number> {
    return 0;
  }

  public startCalibration(slug: string, targetPairs = 600): { progress: number; target: number } {
    return { progress: 0, target: targetPairs };
  }

  public async recordPovScores(projectId: string, stepLabel: string, result: string): Promise<void> {}

  public async promoteParagraphsToAnchors(projectId: string, result: string): Promise<number> {
    return 0;
  }

  public async minePassedScene(
    projectId: string,
    sceneType: string,
    result: string,
    verdict: string,
    deepPovScore?: number
  ): Promise<void> {}

  public async onPassComplete(completedPass: any, projectId?: string): Promise<void> {}
}
