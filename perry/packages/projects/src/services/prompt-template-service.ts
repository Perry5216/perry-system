import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Logger, ProjectStep } from '@perry/core';

export class PromptTemplateService {
  private templates: Record<string, Record<string, string>> = {};
  private configPath: string;
  private log: Logger;
  private dirty = false;

  constructor(workspaceDir: string, log: Logger) {
    this.log = log;
    this.configPath = join(workspaceDir, '.config', 'prompt_templates.json');
    this.load();
  }

  private load() {
    try {
      if (!existsSync(join(this.configPath, '..'))) {
        mkdirSync(join(this.configPath, '..'), { recursive: true });
      }
      if (existsSync(this.configPath)) {
        this.templates = JSON.parse(readFileSync(this.configPath, 'utf8'));
        this.log.info('Loaded dynamic prompt templates from ' + this.configPath);
      } else {
        this.templates = {};
        writeFileSync(this.configPath, JSON.stringify(this.templates, null, 2));
      }
    } catch (e) {
      this.log.error('Failed to load prompt_templates.json', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  private save() {
    if (this.dirty) {
      writeFileSync(this.configPath, JSON.stringify(this.templates, null, 2));
      this.dirty = false;
    }
  }

  /**
   * Applies user-defined prompt overrides to generated steps.
   * If a step doesn't have an override yet, it saves the default prompt to the JSON file
   * so the user can easily discover and edit it later.
   */
  applyOverrides(projectType: string, steps: ProjectStep[]): ProjectStep[] {
    // Hot reload in dev or whenever called
    this.load();

    if (!this.templates[projectType]) {
      this.templates[projectType] = {};
      this.dirty = true;
    }

    for (const step of steps) {
      const templateKey = step.label;
      
      // If the user has defined a custom prompt for this step in the JSON file, use it
      if (this.templates[projectType][templateKey]) {
        step.prompt = this.templates[projectType][templateKey];
      } else {
        // Otherwise, write the default hardcoded prompt into the JSON file so they can edit it
        this.templates[projectType][templateKey] = step.prompt;
        this.dirty = true;
      }
    }

    this.save();
    return steps;
  }

  /** MCP Server Helpers */
  
  listTemplates() {
    this.load();
    const list = [];
    for (const [projectType, steps] of Object.entries(this.templates)) {
      for (const [stepLabel, prompt] of Object.entries(steps)) {
        list.push({
          id: `${projectType}::${stepLabel}`,
          preview: prompt.substring(0, 100) + '...'
        });
      }
    }
    return list;
  }

  getTemplate(id: string): string | undefined {
    this.load();
    const [projectType, stepLabel] = id.split('::');
    if (this.templates[projectType] && this.templates[projectType][stepLabel]) {
      return this.templates[projectType][stepLabel];
    }
    return undefined;
  }
}
