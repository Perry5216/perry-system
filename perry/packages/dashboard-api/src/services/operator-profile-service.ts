/**
 * OperatorProfileService — User Modeling for Perry.
 *
 * Mirrors the existing pen-profile architecture but for the OPERATOR (the
 * human in front of Perry), not the pens (the characters Perry writes as).
 * The system observes operator decisions across sessions and builds a
 * deepening model of who's driving it, surfacing that model to every agent
 * before generation so Perry can tune its output to the actual user.
 *
 * Mirrors the agentic user-modeling pattern. The "dialectic"
 * piece is the update loop: every approval/rejection/edit/preference is an
 * observation that sharpens the model.
 *
 * Storage:
 *   workspace/operator/PROFILE.md      — identity, preferences (slow-changing)
 *   workspace/operator/PREFERENCES.md  — operator decisions / patterns (faster)
 *   workspace/operator/observations.jsonl — raw event log, distilled on a cadence
 *
 * Update sources (subscribed via EventBus):
 *   - project:created                  → operator started a new domain/pen
 *   - skill:promoted, skill:rejected   → operator's curation taste
 *   - step:result:edited               → operator override of LLM output
 *   - agent:invocation:completed (meta) → director chat — what operator asks for
 *
 * Distillation: periodically the librarian (via AIRouter.compressor) reads
 * observations.jsonl and writes a condensed PROFILE.md + PREFERENCES.md.
 * Same idempotency pattern as ChatMemoryService.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import type { Logger, EventBus } from '@perry/core';

const OBSERVATIONS_FILE = 'observations.jsonl';
const PROFILE_FILE = 'PROFILE.md';
const PREFERENCES_FILE = 'PREFERENCES.md';
const MAX_OBSERVATIONS_INLINE = 200;

export interface OperatorObservation {
  ts: string;
  kind: 'project-created' | 'skill-promoted' | 'skill-rejected' | 'step-result-edited' | 'chat-message' | 'manual';
  source?: string;
  detail?: Record<string, any>;
}

const DEFAULT_PROFILE = `# Operator Profile

_This file is a living model of you — the human driving Perry. It updates
dialectically as you make decisions across sessions. Edit freely; the system
respects manual edits and only adds new observations on top._

## Identity

_(Will be inferred from your decisions. Empty until Perry has enough signal.)_

## Working style

_(Will be inferred from your skill curation, step edits, and project setup
choices.)_
`;

const DEFAULT_PREFERENCES = `# Operator Preferences

_Patterns observed in operator decisions. Distilled from observations.jsonl
on each sweep. Hand-editable._

## Approved patterns

_(none yet)_

## Rejected patterns

_(none yet)_

## Conversational style

_(none yet)_
`;

export class OperatorProfileService {
  private readonly dir: string;
  private readonly observationsPath: string;
  private readonly profilePath: string;
  private readonly preferencesPath: string;

  constructor(
    workspaceDir: string,
    private log: Logger,
    private eventBus?: EventBus,
  ) {
    this.dir = join(workspaceDir, 'operator');
    this.observationsPath = join(this.dir, OBSERVATIONS_FILE);
    this.profilePath = join(this.dir, PROFILE_FILE);
    this.preferencesPath = join(this.dir, PREFERENCES_FILE);
    this.ensureFiles();
    this.subscribe();
  }

  private ensureFiles(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      if (!existsSync(this.profilePath)) writeFileSync(this.profilePath, DEFAULT_PROFILE, 'utf-8');
      if (!existsSync(this.preferencesPath)) writeFileSync(this.preferencesPath, DEFAULT_PREFERENCES, 'utf-8');
    } catch (err: any) {
      this.log.warn('OperatorProfileService init failed', { error: err.message });
    }
  }

  private subscribe(): void {
    if (!this.eventBus) return;
    // Every event below sharpens the operator model. Each adds one
    // observation; the periodic distillation pass folds them into PROFILE +
    // PREFERENCES.
    this.eventBus.on('project:created' as any, (p: any) => this.observe({ ts: new Date().toISOString(), kind: 'project-created', detail: { id: p?.id, type: p?.type, domain: p?.domain } }));
    this.eventBus.on('skill:promoted' as any, (p: any) => this.observe({ ts: new Date().toISOString(), kind: 'skill-promoted', detail: { name: p?.name, service: p?.service } }));
    this.eventBus.on('skill:rejected' as any, (p: any) => this.observe({ ts: new Date().toISOString(), kind: 'skill-rejected', detail: { name: p?.name, service: p?.service } }));
    this.eventBus.on('step:result:edited' as any, (p: any) => this.observe({ ts: new Date().toISOString(), kind: 'step-result-edited', source: p?.projectId, detail: { stepId: p?.stepId } }));
  }

  /** Append a single observation to the raw log. Idempotent / append-only. */
  observe(obs: OperatorObservation): void {
    try {
      appendFileSync(this.observationsPath, JSON.stringify(obs) + '\n', 'utf-8');
    } catch (err: any) {
      this.log.warn('OperatorProfileService.observe failed', { error: err.message });
    }
  }

  /** Manual observation hook (e.g. from a dashboard endpoint). */
  recordManual(detail: string): void {
    this.observe({ ts: new Date().toISOString(), kind: 'manual', detail: { text: detail.slice(0, 1000) } });
  }

  getProfile(): { profile: string; preferences: string; observationCount: number; lastDistilledAt?: string } {
    let observationCount = 0;
    try {
      if (existsSync(this.observationsPath)) {
        const content = readFileSync(this.observationsPath, 'utf-8');
        observationCount = content.split('\n').filter(Boolean).length;
      }
    } catch { /* ignore */ }
    let profile = DEFAULT_PROFILE;
    let preferences = DEFAULT_PREFERENCES;
    try { if (existsSync(this.profilePath)) profile = readFileSync(this.profilePath, 'utf-8'); } catch { /* ignore */ }
    try { if (existsSync(this.preferencesPath)) preferences = readFileSync(this.preferencesPath, 'utf-8'); } catch { /* ignore */ }
    return { profile, preferences, observationCount };
  }

  /** Hand-edit endpoint — writes the operator-provided text directly. */
  setProfile(profile?: string, preferences?: string): void {
    try {
      if (typeof profile === 'string') writeFileSync(this.profilePath, profile, 'utf-8');
      if (typeof preferences === 'string') writeFileSync(this.preferencesPath, preferences, 'utf-8');
    } catch (err: any) {
      this.log.warn('OperatorProfileService.setProfile failed', { error: err.message });
    }
  }

  /** Returns the cached profile content for prompt injection. Cheap. */
  getPromptInjection(): string {
    try {
      const profile = existsSync(this.profilePath) ? readFileSync(this.profilePath, 'utf-8') : '';
      const prefs = existsSync(this.preferencesPath) ? readFileSync(this.preferencesPath, 'utf-8') : '';
      const trimmed = (s: string) => s.replace(/^_.*?_$/gm, '').trim();
      const out: string[] = [];
      const p = trimmed(profile);
      const pr = trimmed(prefs);
      if (p.length > 50) out.push('## About the operator', p);
      if (pr.length > 50) out.push('## Operator preferences', pr);
      return out.join('\n\n');
    } catch {
      return '';
    }
  }

  /**
   * Distillation pass — read observations.jsonl, ask the librarian to
   * compress the recent observations into an updated PROFILE.md +
   * PREFERENCES.md. Best-effort, never throws.
   *
   * Caller responsibility: provide a `librarianCompress(text) => string`
   * callable. We keep this dependency-injected so the service stays free of
   * AIRouter coupling.
   */
  async distill(librarianCompress: (text: string) => Promise<string>): Promise<{ updated: boolean; observationsSeen: number }> {
    try {
      if (!existsSync(this.observationsPath)) return { updated: false, observationsSeen: 0 };
      const raw = readFileSync(this.observationsPath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      if (lines.length === 0) return { updated: false, observationsSeen: 0 };

      // Tail recent observations (cap at MAX_OBSERVATIONS_INLINE).
      const recent = lines.slice(-MAX_OBSERVATIONS_INLINE).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      const currentProfile = existsSync(this.profilePath) ? readFileSync(this.profilePath, 'utf-8') : DEFAULT_PROFILE;
      const currentPreferences = existsSync(this.preferencesPath) ? readFileSync(this.preferencesPath, 'utf-8') : DEFAULT_PREFERENCES;

      const prompt = [
        'You are distilling observations of an operator into a living user-model for Perry, an AI agent platform.',
        '',
        '## CURRENT PROFILE',
        currentProfile,
        '',
        '## CURRENT PREFERENCES',
        currentPreferences,
        '',
        '## RECENT OBSERVATIONS (last 200, JSONL)',
        recent.map(o => JSON.stringify(o)).join('\n'),
        '',
        'Update PROFILE.md and PREFERENCES.md to reflect what these observations reveal about the operator.',
        '- Preserve hand-edited sections',
        '- Add new bullets to "Approved/Rejected patterns" based on skill-promoted/skill-rejected events',
        '- Add bullets to "Working style" based on project-created and step-result-edited events',
        '- Keep both files under 3000 chars each',
        '- Output AS TWO sections separated by `---PROFILE---` and `---PREFERENCES---` markers',
        '',
        'Output format:',
        '```',
        '---PROFILE---',
        '<full updated PROFILE.md content>',
        '---PREFERENCES---',
        '<full updated PREFERENCES.md content>',
        '```',
      ].join('\n');

      const out = await librarianCompress(prompt);
      const profileMatch = out.match(/---PROFILE---\n([\s\S]*?)\n---PREFERENCES---\n([\s\S]*?)$/);
      if (!profileMatch) {
        this.log.warn('Operator profile distillation returned unparseable output', { length: out.length });
        return { updated: false, observationsSeen: recent.length };
      }
      writeFileSync(this.profilePath, profileMatch[1].trim() + '\n', 'utf-8');
      writeFileSync(this.preferencesPath, profileMatch[2].trim() + '\n', 'utf-8');
      this.log.info('Operator profile distilled', { observations: recent.length });
      return { updated: true, observationsSeen: recent.length };
    } catch (err: any) {
      this.log.warn('OperatorProfileService.distill failed', { error: err.message });
      return { updated: false, observationsSeen: 0 };
    }
  }
}
