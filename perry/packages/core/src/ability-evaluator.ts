import type { LoadedAbility } from './ability-proposer.js';

export class AbilityEvaluator {
  /**
   * Evaluate a list of LoadedAbilities against a context object.
   * Returns abilities where all conditions in appliesWhen match the context.
   */
  static evaluate(abilities: LoadedAbility[], context: Record<string, any>): LoadedAbility[] {
    return abilities.filter(ability => {
      const applies = ability.appliesWhen;
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
