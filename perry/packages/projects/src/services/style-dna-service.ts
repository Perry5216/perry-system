/**
 * @perry/projects — Style DNA Service (Stub)
 */

import type { Logger } from '@perry/core';
import type { StateStore } from '../state-store.js';

export interface GlobalRules {
  positiveDirectives: string[];
  tropeWarnings: string[];
}

export class StyleDnaService {
  constructor(stateStore: StateStore, log: Logger, workspaceDir: string) {}

  public getGlobalRules(): GlobalRules {
    return {
      positiveDirectives: [],
      tropeWarnings: []
    };
  }

  public lintProse(text: string, opts: { maxMatchesPerCategory?: number } = {}): {
    totalMatches: number;
    filterWords: string[];
    phrases: string[];
  } {
    return {
      totalMatches: 0,
      filterWords: [],
      phrases: []
    };
  }

  public applyDirectivesToGlobal(positive: string[], negative: string[], overwrite: boolean = false): void {}

  public addBannedPhrases(phrases: string[]): void {}

  public compileSeed(projectId: string, chapterNumber: number, povCharacter?: string): string {
    return '';
  }

  public compileGoldenExamples(sceneType: 'action' | 'dialogue' | 'introspection' | 'general' = 'general', maxPairs = 5): string {
    return '';
  }
}
