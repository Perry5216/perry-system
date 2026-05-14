import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Logger } from '@perry/core';

export interface SceneHeuristics {
  stopWords: string[];
  propWords: string[];
  injuryWords: string[];
}

const DEFAULT_HEURISTICS: SceneHeuristics = {
  stopWords: [
    'The', 'His', 'Her', 'She', 'This', 'That', 'But', 'And', 'For',
    'Not', 'Just', 'What', 'Who', 'How', 'Why', 'When', 'Where', 'Then', 'Now',
    'One', 'Two', 'Three', 'Four', 'Five', 'Move', 'Wait', 'Stop', 'Nothing',
    'Behind', 'Below', 'Above', 'Between', 'Another', 'Every', 'Each', 'Either',
    'Neither', 'Beside', 'Pass', 'Part', 'Setting', 'Scenario', 'Scene'
  ],
  propWords: [
    // Sci-Fi / Thriller Defaults
    'wrench', 'pipe', 'blade', 'knife', 'gun', 'weapon', 'baton', 'rod', 'cable',
    'hatch', 'door', 'crate', 'console', 'panel', 'bulkhead', 'floor', 'wall', 'grate', 'lock',
    'cylinder', 'drive', 'keycard', 'flashlight', 'torch', 'coin', 'syringe', 'helmet', 'suit',
    // Fantasy Defaults
    'sword', 'wand', 'staff', 'shield', 'bow', 'arrow', 'potion', 'scroll', 'amulet', 'ring',
    'torch', 'lantern', 'map', 'key', 'coin', 'purse', 'cloak', 'dagger', 'book', 'tome'
  ],
  injuryWords: [
    'bleed', 'blood', 'fracture', 'crack', 'throb', 'ache', 'numb', 'limp', 'broke', 'split', 'cut', 'bruise',
    'burn', 'scorch', 'gash', 'wound', 'slash', 'pierce', 'sting', 'swel', 'scar'
  ]
};

export class HeuristicsService {
  private configPath: string;
  private log: Logger;
  private heuristics: SceneHeuristics;

  constructor(workspaceDir: string, log: Logger) {
    this.log = log;
    this.configPath = join(workspaceDir, '.config', 'heuristics.json');
    this.heuristics = this.load();
  }

  private load(): SceneHeuristics {
    try {
      if (!existsSync(join(this.configPath, '..'))) {
        mkdirSync(join(this.configPath, '..'), { recursive: true });
      }
      if (existsSync(this.configPath)) {
        const loaded = JSON.parse(readFileSync(this.configPath, 'utf8'));
        this.log.info('Loaded custom scene heuristics from ' + this.configPath);
        return { ...DEFAULT_HEURISTICS, ...loaded };
      } else {
        // Create an initial file with defaults so the user can edit it
        writeFileSync(this.configPath, JSON.stringify(DEFAULT_HEURISTICS, null, 2));
        this.log.info('Generated default scene heuristics at ' + this.configPath);
        return DEFAULT_HEURISTICS;
      }
    } catch (e) {
      this.log.error('Failed to load heuristics.json', { error: e instanceof Error ? e.message : String(e) });
      return DEFAULT_HEURISTICS;
    }
  }

  getStopWords(): Set<string> {
    // Reload on every request in case user edited file
    this.heuristics = this.load();
    return new Set(this.heuristics.stopWords);
  }

  getPropWords(): string[] {
    this.heuristics = this.load();
    return this.heuristics.propWords;
  }

  getInjuryWords(): string[] {
    this.heuristics = this.load();
    return this.heuristics.injuryWords;
  }
}
