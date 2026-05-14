/**
 * @perry/projects — Cost Tracker
 *
 * Tracks cumulative AI spend across providers. Emits warnings at 80%
 * of budget and halts execution at 100%. For local Ollama models,
 * cost is always $0 — this only matters for paid cloud providers.
 */

import type { EventBus, Logger } from '@perry/core';

export interface CostConfig {
  /** Maximum spend per project in USD. 0 = unlimited. */
  maxPerProject: number;
  /** Maximum total spend across all projects in USD. 0 = unlimited. */
  maxGlobal: number;
}

export class CostTracker {
  private projectCosts = new Map<string, number>();
  private totalCost = 0;
  private config: CostConfig;
  private log: Logger;
  private eventBus: EventBus;

  constructor(config: Partial<CostConfig>, log: Logger, eventBus: EventBus) {
    this.config = {
      maxPerProject: config.maxPerProject ?? 0,
      maxGlobal: config.maxGlobal ?? 0,
    };
    this.log = log;
    this.eventBus = eventBus;
  }

  /**
   * Record cost from a completion response.
   * Returns true if execution should continue, false if budget exceeded.
   */
  recordCost(projectId: string, cost: number): boolean {
    if (cost <= 0) return true; // Free (Ollama)

    const current = this.projectCosts.get(projectId) ?? 0;
    const newProjectCost = current + cost;
    this.projectCosts.set(projectId, newProjectCost);
    this.totalCost += cost;

    this.log.info('Cost recorded', {
      projectId,
      cost: `$${cost.toFixed(4)}`,
      projectTotal: `$${newProjectCost.toFixed(4)}`,
      globalTotal: `$${this.totalCost.toFixed(4)}`,
    });

    // Check project budget
    if (this.config.maxPerProject > 0) {
      const pct = newProjectCost / this.config.maxPerProject;
      if (pct >= 1.0) {
        this.log.warn('Project budget EXCEEDED', { projectId, spent: newProjectCost, limit: this.config.maxPerProject });
        this.eventBus.emit('step:progress', { projectId, stepId: 'cost-tracker', message: `🚨 Budget exceeded ($${newProjectCost.toFixed(2)}/$${this.config.maxPerProject})` });
        return false;
      }
      if (pct >= 0.8) {
        this.log.warn('Project budget 80% warning', { projectId, spent: newProjectCost, limit: this.config.maxPerProject });
        this.eventBus.emit('step:progress', { projectId, stepId: 'cost-tracker', message: `⚠️ Budget at ${Math.round(pct * 100)}% ($${newProjectCost.toFixed(2)}/$${this.config.maxPerProject})` });
      }
    }

    // Check global budget
    if (this.config.maxGlobal > 0 && this.totalCost >= this.config.maxGlobal) {
      this.log.warn('Global budget EXCEEDED', { total: this.totalCost, limit: this.config.maxGlobal });
      return false;
    }

    return true;
  }

  getProjectCost(projectId: string): number {
    return this.projectCosts.get(projectId) ?? 0;
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getStats(): { projectCosts: Record<string, number>; totalCost: number; config: CostConfig } {
    const costs: Record<string, number> = {};
    for (const [k, v] of this.projectCosts) costs[k] = v;
    return { projectCosts: costs, totalCost: this.totalCost, config: this.config };
  }
}
