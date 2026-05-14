import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Logger, ProjectStep, ProjectType, ProjectContext } from '@perry/core';
import type { ProjectTemplate } from '../templates.js';

export interface CustomPipelineDef {
  id: string; // Used as the ProjectType
  name: string;
  description: string;
  steps: {
    label: string;
    phase: string;
    taskType: string;
    prompt: string;
  }[];
}

export class CustomPipelineService {
  private configPath: string;
  private log: Logger;
  private pipelines: CustomPipelineDef[] = [];

  constructor(workspaceDir: string, log: Logger) {
    this.log = log;
    this.configPath = join(workspaceDir, '.config', 'custom_pipelines.json');
    this.load();
  }

  private load() {
    try {
      if (!existsSync(join(this.configPath, '..'))) {
        mkdirSync(join(this.configPath, '..'), { recursive: true });
      }
      if (existsSync(this.configPath)) {
        this.pipelines = JSON.parse(readFileSync(this.configPath, 'utf8'));
        this.log.info('Loaded custom pipelines from ' + this.configPath);
      } else {
        // Create an example marketing pipeline so the user sees the format
        this.pipelines = [
          {
            id: 'marketing-package',
            name: 'Marketing Package',
            description: 'Generate blurbs, ad copy, and tweets for a completed novel.',
            steps: [
              {
                label: 'Amazon Blurb',
                phase: 'marketing',
                taskType: 'creative_writing',
                prompt: 'Based on the provided Project Context, write a 250-word Amazon blurb for the novel. Focus on the core conflict, the stakes, and end with a strong hook.'
              },
              {
                label: 'Twitter Thread',
                phase: 'marketing',
                taskType: 'creative_writing',
                prompt: 'Write a 5-tweet thread promoting the launch of this novel. Use the Amazon Blurb as a baseline.'
              }
            ]
          }
        ];
        writeFileSync(this.configPath, JSON.stringify(this.pipelines, null, 2));
      }
    } catch (e) {
      this.log.error('Failed to load custom_pipelines.json', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Convert custom JSON pipelines into Perry ProjectTemplates */
  getTemplates(): ProjectTemplate[] {
    // Hot reload
    this.load();

    return this.pipelines.map(def => {
      return {
        type: def.id as ProjectType,
        name: def.name,
        description: def.description,
        buildSteps: (ctx: ProjectContext, title: string, description: string) => {
          let idx = 1;
          return def.steps.map(s => {
            const step: ProjectStep = {
              id: `step-${idx++}-${s.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
              label: s.label,
              phase: s.phase,
              taskType: s.taskType as any,
              status: 'pending',
              prompt: s.prompt,
            };
            return step;
          });
        }
      };
    });
  }
}
