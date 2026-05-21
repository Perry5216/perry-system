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
   *
   * Old behavior auto-wrote every fresh template prompt into JSON the first
   * time a project of that type was created — then on every subsequent call
   * the JSON value won, even after `templates.ts` was edited. That was the
   * actual root cause of the "Digital Drift v2 → The Last Synapse" frozen-
   * prompt bug: yesterday's refreshPendingPrompts re-rendered the template
   * fresh, then applyOverrides immediately stomped it with the stale JSON.
   *
   * New rule: JSON entries are user overrides only. Apply them when they
   * exist AND differ from the current template default. Never auto-write
   * defaults into JSON — that bloats the file and locks in stale text.
   */
  applyOverrides(projectType: string, steps: ProjectStep[]): ProjectStep[] {
    this.load();
    const projectOverrides = this.templates[projectType] || {};
    for (const step of steps) {
      const override = projectOverrides[step.label];
      if (override && override !== step.prompt) {
        step.prompt = override;
      }
    }
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
