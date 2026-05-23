/**
 * @perry/projects — Template Registry
 *
 * Coordinates and defines all project templates categorized by work types.
 */

import type { ProjectStep, ProjectType, ProjectContext, WorkType, ProjectTemplate } from '@perry/core';
import { bookTemplates, generateCalibrationPassSteps } from './domains/book/templates.js';
import { codeTemplates } from './domains/code/templates.js';
import { dndTemplates } from './domains/dnd/templates.js';
import { metaTemplates } from './domains/meta/templates.js';

export { generateCalibrationPassSteps };
export type { ProjectTemplate };

const TEMPLATES = new Map<string, ProjectTemplate>();

// Register book templates
for (const tpl of bookTemplates) {
  TEMPLATES.set(tpl.type, tpl);
}

// Register code templates
for (const tpl of codeTemplates) {
  TEMPLATES.set(tpl.type, tpl);
}

// Register D&D templates
for (const tpl of dndTemplates) {
  TEMPLATES.set(tpl.type, tpl);
}

// Register meta templates
for (const tpl of metaTemplates) {
  TEMPLATES.set(tpl.type, tpl);
}

export class TemplateRegistry {
  /** Get a template by type name. */
  get(type: string): ProjectTemplate | undefined {
    return TEMPLATES.get(type);
  }

  /** List all available templates. */
  list(): ProjectTemplate[] {
    return Array.from(TEMPLATES.values());
  }

  /** Register a custom template. */
  register(template: ProjectTemplate): void {
    TEMPLATES.set(template.type, template);
  }
}
