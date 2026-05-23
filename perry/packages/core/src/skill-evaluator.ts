import type { LoadedSkill } from './skill-proposer.js';

export class SkillEvaluator {
  /**
   * Evaluate a list of LoadedSkills against a context object.
   * Returns skills where all conditions in appliesWhen match the context.
   */
  static evaluate(skills: LoadedSkill[], context: Record<string, any>): LoadedSkill[] {
    return skills.filter(skill => {
      const applies = skill.appliesWhen;
      if (!applies || Object.keys(applies).length === 0) return false;

      for (const [key, expected] of Object.entries(applies)) {
        const actual = context[key];
        if (actual === undefined) return false;

        // Wildcard match
        if (expected === '*') continue;

        // Exact match
        if (actual === expected) continue;

        // String/Substring/Regex check
        if (typeof expected === 'string' && typeof actual === 'string') {
          // Substring match
          if (actual.includes(expected)) continue;
          // Regex check
          try {
            const rx = new RegExp(expected, 'i');
            if (rx.test(actual)) continue;
          } catch {}
        }

        return false;
      }
      return true;
    });
  }
}
