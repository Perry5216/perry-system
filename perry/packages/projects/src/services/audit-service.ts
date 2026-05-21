/**
 * AuditService — Post-training quality check.
 *
 * For a newly trained LoRA (perry-{slug}:v{N}):
 *   1. Pulls the audit prompt set for the pen
 *   2. Sends each prompt through Ollama's /api/generate against that tag
 *   3. Scores the response with a strict regex bank (filter words, anti-
 *      patterns, first-person leaks, second-tier body clichés, tense slips)
 *   4. Aggregates failures into priorityTags written to pen_names.data
 *   5. Writes audit-v{N}.md + audit-v{N}.jsonl to the pen's training pool
 *   6. If the calibration project that generated this LoRA had
 *      `promoteOnComplete: true` AND the audit reports zero failures, calls
 *      stateStore.promoteLoraVersion(slug, version) automatically.
 *
 * The scoring is intentionally STRICT and collects ALL failures per response
 * (not just the first one, unlike fastQualityScan in auto-learning-service).
 * Distinct rules from that scan are inlined here so the audit can run as a
 * standalone module without coupling.
 */

import type { Logger, EventBus, LoadedSkill } from '@perry/core';
import { loadInstalledSkills } from '@perry/core';
import { StateStore } from '../state-store.js';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getAuditPromptsForPen, type AuditPrompt } from '../data/audit-prompts.js';
import { scanLeaks } from '../voice-screens.js';

// Type-only shape so AuditService can call RagService.indexIfVerified
// without taking a hard dependency on @perry/rag (which would create a
// dependency cycle since rag depends on projects via state-store types).
// dashboard-api passes the real RagService instance at construction time.
export interface LearningIndexer {
  indexIfVerified(opts: {
    projectId: string;
    sourceRef: string;
    kind: string;
    text: string;
    gate: () => { verified: boolean; reason: string } | Promise<{ verified: boolean; reason: string }>;
    replace?: boolean;
    metadata?: Record<string, any>;
  }): Promise<{ indexed: boolean; reason: string; chunks?: number }>;
}

const DEFAULT_OLLAMA = process.env.OLLAMA_ENDPOINT || 'http://ollama:11434';

// ─── Failure detection ────────────────────────────────────────────────────
// All regex banks live in voice-screens.ts so the worker-drain gate, pre-
// train pair gate, and this post-train audit share the SAME definition of
// "leak." scoreResponse() delegates to scanLeaks(), which aggregates ALL
// matches per response across filter words, named emotions, first-person,
// anti-patterns, and tense slips.

export interface AuditFailure {
  tag: string;
  matches: string[];
}

export interface AuditPromptResult {
  id: string;
  sceneType: string;
  statBand: string;
  pov: string;
  prompt: string;
  response: string;
  failures: AuditFailure[];
  failureCount: number;
}

export interface AuditReport {
  slug: string;
  version: number;
  ollamaTag: string;
  startedAt: string;
  finishedAt: string;
  totalPrompts: number;
  totalFailures: number;
  passed: boolean;
  topFailureTags: Array<{ tag: string; count: number; affectedPrompts: number }>;
  results: AuditPromptResult[];
  promoted: boolean;
  promotionReason: string;
}

// Type-only shape for the pen-profile generator so AuditService can call
// it without a hard import (avoids circular wiring through the projects
// package itself). server.ts passes the real PenProfileService instance.
export interface PenProfileWriter {
  generate(slug: string): Promise<any>;
}

export class AuditService {
  private auditSkills: LoadedSkill[] = [];
  private auditSkillsLoadedAt = 0;
  private readonly AUDIT_SKILLS_TTL_MS = 60_000;

  constructor(
    private stateStore: StateStore,
    private workspaceDir: string,
    private log: Logger,
    private rag?: LearningIndexer,
    private penProfile?: PenProfileWriter,
    private eventBus?: EventBus,
  ) {
    this.refreshAuditSkills();
  }

  /**
   * Reload installed audit skills from `workspace/skills-installed/audit/`.
   * Mirrors the prompt-builder consumer pattern: cache for AUDIT_SKILLS_TTL_MS
   * so a long audit run picks up newly-promoted skills without restart.
   */
  private refreshAuditSkills(): void {
    try {
      this.auditSkills = loadInstalledSkills(this.workspaceDir, 'audit');
      this.auditSkillsLoadedAt = Date.now();
      if (this.auditSkills.length > 0) {
        this.log.info('AuditService loaded skills', { count: this.auditSkills.length });
      }
    } catch (err: any) {
      this.log.warn('refreshAuditSkills failed', { error: err.message });
      this.auditSkills = [];
    }
  }

  private getAuditSkillsForPen(slug: string): LoadedSkill[] {
    if (Date.now() - this.auditSkillsLoadedAt > this.AUDIT_SKILLS_TTL_MS) {
      this.refreshAuditSkills();
    }
    return this.auditSkills.filter(s => {
      const w = s.appliesWhen;
      return w && (w.pen_slug === slug || w.pen_slug === '*');
    });
  }

  /**
   * Run the audit for a specific LoRA version. Returns the report and
   * (idempotent) writes audit-v{N}.md + audit-v{N}.jsonl.
   */
  async audit(slug: string, version: number): Promise<AuditReport> {
    const startedAt = new Date().toISOString();
    const pen = this.stateStore.getPenName(slug);
    if (!pen) throw new Error(`pen ${slug} not found`);
    const lora = this.stateStore.getLoraVersions(slug).find(v => v.version === version);
    if (!lora) throw new Error(`LoRA v${version} for ${slug} not registered`);
    const ollamaTag = lora.ollamaTag || `perry-${slug}:v${version}`;

    const prompts = getAuditPromptsForPen(slug);
    this.log.info('Audit starting', { slug, version, ollamaTag, prompts: prompts.length });

    const results: AuditPromptResult[] = [];
    for (const p of prompts) {
      try {
        const response = await this.generate(ollamaTag, p.prompt);
        const failures = this.scoreResponse(response, slug);
        results.push({
          id: p.id, sceneType: p.sceneType, statBand: p.statBand, pov: p.pov,
          prompt: p.prompt, response,
          failures, failureCount: failures.reduce((s, f) => s + f.matches.length, 0),
        });
      } catch (err) {
        this.log.warn('Audit prompt failed', { id: p.id, error: (err as Error).message });
        results.push({
          id: p.id, sceneType: p.sceneType, statBand: p.statBand, pov: p.pov,
          prompt: p.prompt, response: `[ERROR: ${(err as Error).message}]`,
          failures: [{ tag: 'audit_error', matches: [(err as Error).message] }],
          failureCount: 1,
        });
      }
    }

    const totalFailures = results.reduce((s, r) => s + r.failureCount, 0);
    const passed = totalFailures === 0;
    const topFailureTags = this.aggregateTopTags(results);
    const finishedAt = new Date().toISOString();

    // Update priorityTags on the pen DB row
    this.writePriorityTags(slug, topFailureTags);

    // Auto-promote check: only if some active calibration project for this pen
    // has promoteOnComplete=true AND audit passed.
    let promoted = false;
    let promotionReason = '';
    const promoteFlag = this.shouldAutoPromote(slug);
    if (passed && promoteFlag) {
      const ok = this.stateStore.promoteLoraVersion(slug, version);
      promoted = ok;
      promotionReason = ok
        ? `audit passed (0 failures) and promoteOnComplete=true`
        : `audit passed but promotion failed (row not found?)`;
    } else if (passed && !promoteFlag) {
      promotionReason = 'audit passed but promoteOnComplete=false — manual promotion required';
    } else {
      promotionReason = `audit failed: ${totalFailures} pattern hit(s) across ${results.filter(r => r.failureCount > 0).length}/${results.length} prompts`;
    }

    const report: AuditReport = {
      slug, version, ollamaTag,
      startedAt, finishedAt,
      totalPrompts: results.length,
      totalFailures,
      passed,
      topFailureTags,
      results,
      promoted,
      promotionReason,
    };

    await this.writeReports(slug, version, report);
    this.log.info('Audit complete', {
      slug, version, totalFailures, passed, promoted, topTags: topFailureTags.slice(0, 5).map(t => t.tag),
    });

    // Regenerate SOUL.md + LESSONS.md for this pen — priorityTags have
    // just been refreshed by writePriorityTags() above. Non-fatal on
    // failure; PromptBuilder falls back to inline rendering.
    if (this.penProfile) {
      try {
        await this.penProfile.generate(slug);
      } catch (err: any) {
        this.log.warn('pen-profile regeneration failed (non-fatal)', { slug, error: err.message });
      }
    }

    // Verified-success learning: for every audit prompt response that
    // scored 0 failures, index it under learning_calibration so the
    // trainer + writer can pull canonical examples of clean voice for
    // this pen later. Failed responses (any failureCount > 0) are
    // skipped — indexing those would have the self-learning loop
    // imitate the leaks we just flagged.
    if (this.rag) {
      for (const r of results) {
        try {
          await this.rag.indexIfVerified({
            projectId: `pen:${slug}`,
            sourceRef: `audit-${slug}-v${version}-${r.id}`,
            kind: 'calibration',
            text: r.response,
            replace: true,
            metadata: {
              loraVersion: version,
              sceneType: r.sceneType,
              statBand: r.statBand,
              pov: r.pov,
              promptId: r.id,
            },
            gate: () => ({
              verified: r.failureCount === 0,
              reason: r.failureCount === 0
                ? `audit v${version}: 0 leak hits`
                : `audit v${version}: ${r.failureCount} leak hit(s) — ${r.failures.map(f => f.tag).slice(0, 3).join(',')}`,
            }),
          });
        } catch (err: any) {
          this.log.warn('learning_calibration index failed (non-fatal)', {
            slug, version, promptId: r.id, error: err.message,
          });
        }
      }
    }

    // Audit self-learning: emit one learning:observation per leak tag found.
    // LearningCore aggregates per (source='audit', kind='leak-pattern',
    // fingerprint='{slug}::{tag}'). When the same tag recurs across the
    // threshold's worth of audits, a skill auto-proposes.
    if (this.eventBus) {
      try {
        for (const f of report.topFailureTags) {
          this.eventBus.emit('learning:observation', {
            source: 'audit',
            kind: 'leak-pattern',
            fingerprint: `${slug}::${f.tag}`,
            value: f.count,
            metadata: { pen_slug: slug, leak_tag: f.tag, affected_prompts: f.affectedPrompts, lora_version: version },
          });
        }
      } catch (err: any) {
        this.log.warn('audit learning-emit threw (non-fatal)', { slug, error: err.message });
      }
    }

    return report;
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private async generate(model: string, prompt: string): Promise<string> {
    const body = JSON.stringify({
      model, prompt, stream: false,
      options: { temperature: 0.85, num_predict: 240, top_p: 0.95 },
    });
    const res = await fetch(`${DEFAULT_OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    }
    const json = await res.json() as { response?: string };
    return (json.response || '').trim();
  }

  private scoreResponse(text: string, penSlug?: string): AuditFailure[] {
    const failures = scanLeaks(text);
    // Consumer side of the producer→curator→consumer loop: check whether any
    // promoted audit skills for this pen called out a leak_tag that scanLeaks
    // also caught. Log the match so we can see skills being learned from in
    // dashboards / logs. Doesn't change scoring — same failures, more signal.
    if (penSlug && failures.length > 0) {
      const matchedSkills = this.getAuditSkillsForPen(penSlug);
      for (const skill of matchedSkills) {
        const skillTag = String(skill.appliesWhen?.leak_tag ?? '');
        if (skillTag && failures.some(f => f.tag === skillTag)) {
          this.log.info('AuditService skill applied', {
            skill: skill.name,
            pen_slug: penSlug,
            leak_tag: skillTag,
          });
          this.eventBus?.emit('learning:observation', {
            source: 'audit',
            kind: 'skill-applied',
            fingerprint: `${skill.name}::${penSlug}`,
            value: 1,
            metadata: { skill: skill.name, pen_slug: penSlug, leak_tag: skillTag },
          });
        }
      }
    }
    return failures;
  }

  private aggregateTopTags(results: AuditPromptResult[]): Array<{ tag: string; count: number; affectedPrompts: number }> {
    const counts = new Map<string, { count: number; prompts: Set<string> }>();
    for (const r of results) {
      for (const f of r.failures) {
        const c = counts.get(f.tag) || { count: 0, prompts: new Set() };
        c.count += f.matches.length;
        c.prompts.add(r.id);
        counts.set(f.tag, c);
      }
    }
    return Array.from(counts.entries())
      .map(([tag, v]) => ({ tag, count: v.count, affectedPrompts: v.prompts.size }))
      .sort((a, b) => b.count - a.count);
  }

  private writePriorityTags(slug: string, topTags: Array<{ tag: string; count: number; affectedPrompts: number }>): void {
    if (!topTags.length) return;
    const payload = topTags.slice(0, 10).map(t => ({
      tag: t.tag,
      count: t.count,
      affectedPrompts: t.affectedPrompts,
      observedAt: new Date().toISOString(),
    }));
    this.stateStore.updatePenDataField(slug, 'priorityTags', payload);
  }

  private shouldAutoPromote(slug: string): boolean {
    if (!this.stateStore.list) return false;
    const projects = this.stateStore.list().filter(p =>
      p.type === 'style-calibration' && p.context?.penNameSlug === slug
    );
    if (!projects.length) return false;
    projects.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return !!projects[0].context?.promoteOnComplete;
  }

  private async writeReports(slug: string, version: number, report: AuditReport): Promise<void> {
    const dir = join(this.workspaceDir, 'training', `pen-${slug}`);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    // JSONL — full per-prompt detail
    const jsonl = report.results.map(r => JSON.stringify({ version, ...r })).join('\n');
    await writeFile(join(dir, `audit-v${version}.jsonl`), jsonl, 'utf-8');

    // Markdown summary
    const md = this.renderMarkdown(report);
    await writeFile(join(dir, `audit-v${version}.md`), md, 'utf-8');
  }

  private renderMarkdown(r: AuditReport): string {
    const lines: string[] = [];
    lines.push(`# Audit Report — ${r.ollamaTag}`);
    lines.push('');
    lines.push(`- Pen: \`${r.slug}\``);
    lines.push(`- Version: \`v${r.version}\``);
    lines.push(`- Prompts: **${r.totalPrompts}**`);
    lines.push(`- Total failures: **${r.totalFailures}**`);
    lines.push(`- Verdict: ${r.passed ? '✅ **PASS**' : '🚩 **FAIL**'}`);
    lines.push(`- Promoted: ${r.promoted ? '✅' : '❌'} — ${r.promotionReason}`);
    lines.push(`- Started: ${r.startedAt}`);
    lines.push(`- Finished: ${r.finishedAt}`);
    lines.push('');
    lines.push('## Top failure tags');
    lines.push('');
    if (r.topFailureTags.length === 0) {
      lines.push('_None — clean run._');
    } else {
      lines.push('| Tag | Count | Affected Prompts |');
      lines.push('|---|---|---|');
      for (const t of r.topFailureTags.slice(0, 15)) {
        lines.push(`| \`${t.tag}\` | ${t.count} | ${t.affectedPrompts}/${r.totalPrompts} |`);
      }
    }
    lines.push('');
    lines.push('## Per-prompt detail');
    for (const p of r.results) {
      const flag = p.failureCount === 0 ? '✅' : '🚩';
      lines.push('');
      lines.push(`### ${flag} ${p.id} — \`${p.sceneType} × ${p.statBand} × ${p.pov}\``);
      lines.push('');
      lines.push('**Response:**');
      lines.push('');
      lines.push('```');
      lines.push(p.response);
      lines.push('```');
      if (p.failures.length > 0) {
        lines.push('');
        lines.push('**Failures:**');
        for (const f of p.failures) {
          lines.push(`- \`${f.tag}\` (${f.matches.length}): ${f.matches.slice(0, 5).map(m => `"${m}"`).join(', ')}`);
        }
      }
    }
    return lines.join('\n');
  }
}
