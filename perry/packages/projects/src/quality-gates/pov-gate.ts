/**
 * POV Quality Gate (Stub)
 */

import type { Logger } from '@perry/core';

export class PovQualityGate {
  constructor(log: Logger, eventBus: any, stateStore: any, styleDna: any) {}

  async apply(project: any, step: any, result: string): Promise<string> {
    return result;
  }
}
