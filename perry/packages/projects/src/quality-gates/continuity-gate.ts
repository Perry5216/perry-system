/**
 * Continuity Gate (Stub)
 */

import type { Logger } from '@perry/core';

export class ContinuityGate {
  constructor(log: Logger, eventBus: any, stateStore: any, workspaceDir: string) {}

  async apply(project: any, step: any, result: string): Promise<string> {
    return result;
  }

  async applyManuscriptCleanup(project: any, step: any, result: string): Promise<string> {
    return result;
  }
}
