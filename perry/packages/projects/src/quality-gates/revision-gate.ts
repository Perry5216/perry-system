/**
 * Revision Gate (Stub)
 */

import type { Logger } from '@perry/core';

export class RevisionGate {
  constructor(log: Logger, eventBus: any, stateStore: any) {}

  async apply(project: any, step: any, result: string): Promise<string> {
    return result;
  }
}
