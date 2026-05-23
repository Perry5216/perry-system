import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Logger } from '@perry/core';
import type { AIRouter } from '@perry/ai';
import type { StateStore } from '../state-store.js';

export interface MutationCandidate {
  body: string;
  reason: string;
  fitness?: number;
  failureRecoveryScore?: number;
  successPreservationScore?: number;
}

export class SkillOptimizerService {
  constructor(
    private workspaceDir: string,
    private stateStore: StateStore,
    private router: AIRouter,
    private log: Logger
  ) {}

  /**
   * Run the GEPA prompt optimization loop for a given skill.
   */
  async runOptimization(
    service: string,
    skillName: string,
    opts?: { provider?: string }
  ): Promise<{ success: boolean; proposalId?: string; reason?: string }> {
    this.log.info('Starting skill optimization loop', { service, skillName });

    // 1. Resolve skill path and load content
    const skillPath = this.resolveSkillPath(service, skillName);
    if (!skillPath) {
      return { success: false, reason: `Skill file for "${skillName}" under service "${service}" not found.` };
    }

    let rawContent: string;
    try {
      rawContent = readFileSync(skillPath, 'utf-8');
    } catch (err: any) {
      return { success: false, reason: `Failed to read skill file: ${err.message}` };
    }

    const { frontmatter, body: originalBody } = this.parseSkillFile(rawContent);

    // 2. Query historical trajectories
    const { success: successTraces, failure: failureTraces } = this.stateStore.getTrajectoriesForSkill(service, skillName);
    this.log.info('Retrieved trajectories for skill', {
      skillName,
      successCount: successTraces.length,
      failureCount: failureTraces.length,
    });

    if (successTraces.length === 0 && failureTraces.length === 0) {
      return {
        success: false,
        reason: 'No historical execution traces found for this skill in agent_trajectories. Execute some tasks first.'
      };
    }

    const provider = opts?.provider || 'librarian';

    // 3. Critique Phase: Analyze failures
    let critique = 'No failures available to critique.';
    if (failureTraces.length > 0) {
      this.log.info('Running LLM critique phase on failures');
      const failureSummary = failureTraces.slice(0, 3).map((t, idx) => {
        const lastMsg = t.messages[t.messages.length - 1];
        const error = t.outcome === 'failed' ? (lastMsg?.content || '') : '';
        const conversationSnippet = t.messages.slice(-6).map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
        return `Failed Trace #${idx + 1}:
- Task Input: ${t.input || '(none)'}
- Conversation Context:
${conversationSnippet}
- Outcome Error: ${error || t.outcome}
`;
      }).join('\n---\n');

      const systemCritique = `You are an expert prompt auditor. Analyze the following procedural skill instructions and the execution traces where it failed.
Identify:
1. Which specific instruction in the skill was violated or failed to prevent the error?
2. What missing instruction, warning, or safeguard would have guided the agent to complete the task successfully?
3. Propose a short corrective guideline.

Provide your critique in clear, concise points.`;

      const userCritique = `Current Skill Instructions:
${originalBody}

Failure Traces:
${failureSummary}`;

      try {
        const critiqueRes = await this.router.complete({
          provider,
          system: systemCritique,
          messages: [{ role: 'user', content: userCritique }],
          maxTokens: 1024,
          temperature: 0.2
        });
        critique = critiqueRes.text.trim();
        this.log.info('Critique phase completed', { critiqueSnippet: critique.slice(0, 100) + '...' });
      } catch (err: any) {
        return { success: false, reason: `Critique phase failed: ${err.message}` };
      }
    }

    // 4. Mutation Phase: Generate candidates
    this.log.info('Running LLM mutation phase');
    const successSummary = successTraces.slice(0, 2).map((t, idx) => {
      return `Successful Trace #${idx + 1}:
- Task Input: ${t.input || '(none)'}
- Completed Output: ${t.output || '(none)'}
`;
    }).join('\n---\n');

    const systemMutation = `You are a genetic prompt mutator. Your goal is to evolve the current skill instructions to prevent the identified failure modes while preserving successful behaviors.
You must output a JSON object containing exactly 3 mutated variations of the skill instructions.

Respond ONLY with a JSON object matching this schema:
{
  "mutations": [
    {
      "body": "complete revised skill instructions",
      "reason": "short explanation of the changes made in this mutation"
    }
  ]
}
Do not output any reasoning outside the JSON block.`;

    const userMutation = `Current Skill Instructions:
${originalBody}

Failed Trace Critique:
${critique}

${successSummary ? `Successful Trace Anchors (Do not break this behavior):\n${successSummary}\n` : ''}
Generate 3 unique, mutated variations of the skill instructions. For each, optimize for clear, concise imperative guidelines.`;

    const formatSchema = {
      type: "object",
      properties: {
        mutations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              body: { type: "string" },
              reason: { type: "string" }
            },
            required: ["body", "reason"]
          }
        }
      },
      required: ["mutations"]
    };

    let candidates: MutationCandidate[] = [];
    try {
      const mutationRes = await this.router.complete({
        provider,
        system: systemMutation,
        messages: [{ role: 'user', content: userMutation }],
        maxTokens: 3072,
        temperature: 0.7,
        format: formatSchema
      });

      const text = mutationRes.text.trim();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        const clean = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
        parsed = JSON.parse(clean);
      }

      if (parsed && Array.isArray(parsed.mutations)) {
        candidates = parsed.mutations;
      }
    } catch (err: any) {
      return { success: false, reason: `Mutation phase failed: ${err.message}` };
    }

    if (candidates.length === 0) {
      return { success: false, reason: 'Failed to generate any mutation candidates.' };
    }

    this.log.info('Generated mutation candidates', { count: candidates.length });

    // 5. Fitness Evaluation (LLM Judge)
    this.log.info('Running LLM Fitness Judge backtesting');
    const systemJudge = `You are a strict QA evaluator judge. Your task is to evaluate if a revised set of skill instructions would have prevented a past execution error.
Analyze the past task input, the original error, and the mutated instructions.
Decide if the mutated instructions successfully prevent the error.
Rate from 0.0 (Failed/Inadequate) to 1.0 (Completely Solved).

Respond ONLY with a JSON object matching this schema:
{
  "score": 0.9,
  "reason": "..."
}
Do not output any reasoning outside the JSON block.`;

    const formatJudgeSchema = {
      type: "object",
      properties: {
        score: { type: "number" },
        reason: { type: "string" }
      },
      required: ["score", "reason"]
    };

    const baselineRecovery = 0.0;
    const baselinePreservation = 1.0;
    const baselineFitness = 0.7 * baselineRecovery + 0.3 * baselinePreservation;

    for (const cand of candidates) {
      // Evaluate Failure Recovery
      let totalFailureScore = 0;
      if (failureTraces.length > 0) {
        const testFailures = failureTraces.slice(0, 3);
        for (const t of testFailures) {
          const lastMsg = t.messages[t.messages.length - 1];
          const error = t.outcome === 'failed' ? (lastMsg?.content || '') : '';
          const userJudge = `Task Input: ${t.input || '(none)'}
Original Error: ${error || t.outcome}
Mutated Skill Instructions:
${cand.body}

Would this mutated instruction guide the agent to successfully complete the task and prevent the error?`;

          try {
            const judgeRes = await this.router.complete({
              provider,
              system: systemJudge,
              messages: [{ role: 'user', content: userJudge }],
              maxTokens: 512,
              temperature: 0.1,
              format: formatJudgeSchema
            });

            const text = judgeRes.text.trim();
            let parsed: any;
            try {
              parsed = JSON.parse(text);
            } catch {
              const clean = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
              parsed = JSON.parse(clean);
            }
            if (parsed && typeof parsed.score === 'number') {
              totalFailureScore += parsed.score;
            }
          } catch (e: any) {
            this.log.warn('LLM judge error during failure backtest', { error: e.message });
          }
        }
        cand.failureRecoveryScore = totalFailureScore / testFailures.length;
      } else {
        cand.failureRecoveryScore = 1.0;
      }

      // Evaluate Success Preservation
      let totalSuccessScore = 0;
      if (successTraces.length > 0) {
        const testSuccesses = successTraces.slice(0, 2);
        for (const t of testSuccesses) {
          const userJudge = `Task Input: ${t.input || '(none)'}
Expected Output Summary: ${t.output || '(none)'}
Mutated Skill Instructions:
${cand.body}

Would this mutated instruction still allow the agent to successfully complete the task without regression?`;

          try {
            const judgeRes = await this.router.complete({
              provider,
              system: systemJudge,
              messages: [{ role: 'user', content: userJudge }],
              maxTokens: 512,
              temperature: 0.1,
              format: formatJudgeSchema
            });

            const text = judgeRes.text.trim();
            let parsed: any;
            try {
              parsed = JSON.parse(text);
            } catch {
              const clean = text.replace(/```json\n?/, '').replace(/```\n?/, '').trim();
              parsed = JSON.parse(clean);
            }
            if (parsed && typeof parsed.score === 'number') {
              totalSuccessScore += parsed.score;
            }
          } catch (e: any) {
            this.log.warn('LLM judge error during success backtest', { error: e.message });
          }
        }
        cand.successPreservationScore = totalSuccessScore / testSuccesses.length;
      } else {
        cand.successPreservationScore = 1.0;
      }

      cand.fitness = 0.7 * (cand.failureRecoveryScore || 0) + 0.3 * (cand.successPreservationScore || 0);
      this.log.info('Candidate evaluated', {
        reason: cand.reason,
        fitness: cand.fitness,
        recovery: cand.failureRecoveryScore,
        preservation: cand.successPreservationScore,
      });
    }

    // 6. Pareto Selection: choose candidate that improves over baseline.
    // In case of ties, choose the one with shorter character length.
    const improved = candidates.filter(c => c.fitness !== undefined && c.fitness > baselineFitness);
    if (improved.length === 0) {
      return { success: false, reason: `No mutation candidates improved upon the baseline fitness of ${baselineFitness.toFixed(2)}.` };
    }

    improved.sort((a, b) => {
      const diff = (b.fitness || 0) - (a.fitness || 0);
      if (Math.abs(diff) < 0.001) {
        return a.body.length - b.body.length; // shorter body preferred (Pareto principle)
      }
      return diff;
    });

    const winner = improved[0];
    this.log.info('Winning candidate selected', { fitness: winner.fitness, baseline: baselineFitness });

    // 7. Write proposal to librarian_proposals
    const proposalId = `prop-opt-${skillName}-${Date.now().toString(36)}`;
    const improvementPct = Math.round(((winner.fitness || 0) - baselineFitness) * 100);

    // Formulate final mutated content with original frontmatter
    const mutatedContent = `---
${Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n')}
status: pending
optimized_at: ${new Date().toISOString()}
---
${winner.body.trim()}
`;

    const details = {
      original: rawContent,
      mutated: mutatedContent,
      reason: winner.reason,
      telemetry: {
        failureCount: failureTraces.length,
        successCount: successTraces.length,
        improvementScore: `+${improvementPct}%`
      }
    };

    try {
      this.stateStore.addLibrarianProposal({
        id: proposalId,
        service,
        skill_name: skillName,
        status: 'pending',
        action: 'optimize',
        details
      });
      this.log.info('Successfully wrote librarian optimization proposal', { proposalId });
      return { success: true, proposalId };
    } catch (err: any) {
      return { success: false, reason: `Failed to save proposal: ${err.message}` };
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private resolveSkillPath(service: string, skillName: string): string | null {
    const paths = [
      join('/app/.claude/commands', `${skillName}.md`),
      join(this.workspaceDir, '.claude', 'commands', `${skillName}.md`),
      join(this.workspaceDir, 'skills-installed', service, `${skillName}.md`),
      join(this.workspaceDir, 'skills-installed', 'global', `${skillName}.md`),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    // Search in all other subdirs of skills-installed
    try {
      const { readdirSync } = require('fs');
      const root = join(this.workspaceDir, 'skills-installed');
      if (existsSync(root)) {
        const subdirs = readdirSync(root, { withFileTypes: true });
        for (const s of subdirs) {
          if (s.isDirectory() && s.name !== service && s.name !== 'global') {
            const p = join(root, s.name, `${skillName}.md`);
            if (existsSync(p)) return p;
          }
        }
      }
    } catch {}
    return null;
  }

  private parseSkillFile(raw: string): { frontmatter: Record<string, string>; body: string } {
    const normalized = raw.replace(/\r\n/g, '\n');
    const m = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return { frontmatter: {}, body: normalized };
    const block = m[1];
    const body = m[2];
    const frontmatter: any = {};
    for (const line of block.split('\n')) {
      const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
      if (kv) {
        let val = kv[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        frontmatter[kv[1]] = val;
      }
    }
    return { frontmatter, body };
  }
}
