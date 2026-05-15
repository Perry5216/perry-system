/**
 * @perry/projects — Auto-Learning Service
 *
 * Runs after every calibration Summary step to:
 *  1. Export accumulated training pairs as JSONL (always)
 *  2. Every MODELFILE_REBUILD_INTERVAL passes: regenerate perry.Modelfile
 *     with the latest Golden Examples baked in, then rebuild perry-writer
 *     in Ollama so the next pass runs on a progressively smarter model.
 *
 * This creates a fully automated self-improvement loop:
 *   Calibration → POV Check → Learn violations → Export JSONL
 *   → Every 5 passes: rebuild Modelfile → Ollama recreates model
 *   → Next pass uses improved model
 */

import { writeFile, readFile, mkdir, appendFile } from 'fs/promises';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Logger } from '@perry/core';
import type { StyleDnaService } from './style-dna-service.js';
import type { StateStore } from '../state-store.js';

const execAsync = promisify(exec);

// Rebuild the Modelfile every N passes
const MODELFILE_REBUILD_INTERVAL = 5;

// Minimum training pairs before emitting a fine-tune-ready flag
const FINETUNE_THRESHOLD = 1000;

// Ollama container name (matches docker-compose)
const OLLAMA_CONTAINER = 'ollama';
const MODEL_NAME = 'perry-writer';

// ─── Baseline correction pairs always included in training data ─────────────
const BASELINE_PAIRS: { bad: string; good: string; category: string }[] = [
  { bad: 'He felt a surge of adrenaline as the drone fired.', good: 'The drone fired. The impact threw him sideways into the bulkhead. His ear rang.', category: 'filter_word' },
  { bad: 'He noticed the corridor was empty.', good: 'The corridor. Empty. No movement.', category: 'filter_word' },
  { bad: 'He had to make a decision — stay or run.', good: 'His knuckles locked around the pipe. He ran.', category: 'cognitive_telling' },
  { bad: 'He looked at the exit and calculated his odds.', good: 'Twelve metres to the exit. Two guards. One clip.', category: 'filter_word' },
  { bad: 'He stared at Vane, trying to read his intention.', good: "Vane's jaw tightened. His weight shifted to his left foot.", category: 'pov_leakage' },
  { bad: 'He felt the weight of the decision pressing down on him.', good: 'The joint between his shoulder and neck had locked solid. It had been doing that for three days.', category: 'cognitive_telling' },
  { bad: 'He remembered how it had all gone wrong.', good: "Docking Bay 7. The cargo manifest. Eighteen crates. The nineteenth one they hadn't opened.", category: 'filter_word' },
  { bad: 'He realized he had made a terrible mistake.', good: "The manifest. The one he'd signed. His signature, neat and unambiguous at the bottom.", category: 'cognitive_telling' },
  { bad: 'She thought about the choices that had led her here.', good: "Three years back, she'd turned right instead of left at the fork in Corridor D. Small things.", category: 'filter_word' },
  { bad: 'He felt alone and hopeless in the vast darkness.', good: 'The airlock hissed. Somewhere behind him, the ship ticked as it cooled.', category: 'cognitive_telling' },
  { bad: "Vane stood in the doorway. His face was tight, eyes darting — he was afraid.", good: "Vane stood in the doorway. His face was tight. His eyes moved to the corridor, then back.", category: 'pov_leakage' },
  { bad: 'He felt irritated by her question.', good: 'He set down the cup. The ceramic clicked against the table with more force than necessary.', category: 'cognitive_telling' },
  { bad: 'He thought she was lying.', good: "She'd used the wrong tense. Past, not present. He let it sit.", category: 'filter_word' },
  { bad: "She felt she couldn't trust him.", good: 'Her hand found the door handle. Just in case.', category: 'cognitive_telling' },
  { bad: 'He felt the tension between them rising.', good: 'Neither of them spoke. The ventilator hummed.', category: 'cognitive_telling' },
  { bad: 'The exit was a dark throat leading deeper into the facility.', good: "The exit. A corridor. He couldn't see the end of it.", category: 'ai_ism' },
  { bad: 'He had failed. It was over.', good: 'The blast door sealed. The lock engaged with a sound like a coffin lid.', category: 'cognitive_telling' },
  { bad: 'The silence was heavy with unspoken words.', good: 'Neither of them spoke. The dehumidifier in the corner ticked.', category: 'ai_ism' },
  { bad: 'The tension in the room was palpable.', good: "Across the table, her hands didn't move.", category: 'ai_ism' },
  { bad: 'He could feel the desperation radiating off of her.', good: "She hadn't blinked in ten seconds. Her knuckles were white on the chair arm.", category: 'pov_leakage' },
];

const DEFAULT_SYSTEM_PROMPT = `You are a professional Deep POV author. Write exclusively in Deep POV.

## PROSE STYLE CONTRACT
- Show internal conflict through physical sensation: jaw clenching, knuckles whitening, ribs throbbing, teeth grinding.
- Convey character emotions through somatic markers and environmental interaction only.
- Describe only what the POV character can directly observe about other characters — body language, tone, movement.
- End moments on concrete sensory detail, not thematic summary.
- Use somatic markers to externalise every internal state.
- Use short punchy sentences during action, longer ones during introspection.`;

// Default slug when a project has no pen-name attachment.
// Mirrors DEFAULT_PEN_SLUG in trainer/watch-and-train.sh.
const DEFAULT_PEN_SLUG = 'default';

export class AutoLearningService {
  private workspaceDir: string;
  private log: Logger;
  private styleDna: StyleDnaService;
  private stateStore?: StateStore;
  private voiceProfileCache: Map<string, string> = new Map();
  private penSlugCache: Map<string, string> = new Map();

  constructor(workspaceDir: string, styleDna: StyleDnaService, log: Logger, stateStore?: StateStore) {
    this.workspaceDir = workspaceDir;
    this.styleDna = styleDna;
    this.log = log;
    this.stateStore = stateStore;
  }

  // ─── Pen-name resolution ─────────────────────────────────────────────────
  //
  // Mirrors lookup_pen_slug() in trainer/watch-and-train.sh. Order:
  //   1. project.context.penNameSlug
  //   2. project.context.penName → match meta['pen_name_records'].penNames[].displayName
  //   3. associatedProjects[].id match in pen_name_records
  //   4. slugified penName
  //   5. DEFAULT_PEN_SLUG ('default')
  resolvePenSlug(projectId: string): string {
    const cached = this.penSlugCache.get(projectId);
    if (cached) return cached;
    const slug = this.computePenSlug(projectId);
    this.penSlugCache.set(projectId, slug);
    return slug;
  }

  private computePenSlug(projectId: string): string {
    if (!this.stateStore) return DEFAULT_PEN_SLUG;

    const project = this.stateStore.get(projectId);
    const ctx = (project?.context || {}) as Record<string, unknown>;

    const explicitSlug = typeof ctx.penNameSlug === 'string' ? ctx.penNameSlug.trim() : '';
    if (explicitSlug) return explicitSlug;

    const penName = typeof ctx.penName === 'string' ? ctx.penName : '';
    const records = this.readPenNameRecords();

    if (penName && records.length > 0) {
      const byName = records.find(pn => pn?.displayName === penName);
      if (byName?.slug) return byName.slug;
    }

    for (const pn of records) {
      const associated = Array.isArray(pn?.associatedProjects) ? pn.associatedProjects : [];
      if (associated.some((ap: any) => ap?.id === projectId)) {
        if (pn?.slug) return pn.slug;
      }
    }

    if (penName) {
      const slug = penName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (slug) return slug;
    }

    return DEFAULT_PEN_SLUG;
  }

  private readPenNameRecords(): any[] {
    if (!this.stateStore) return [];
    const raw = this.stateStore.getMeta('pen_name_records');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.penNames) ? parsed.penNames : [];
    } catch {
      return [];
    }
  }

  private findPenRecord(slug: string): any | null {
    return this.readPenNameRecords().find(pn => pn?.slug === slug) || null;
  }

  // Returns the training pool directory for a given project, keyed by pen slug.
  // Falls back to `<workspace>/training` when no projectId is supplied — matches
  // legacy behavior so summary writes still have a home.
  private trainingPoolDir(projectId?: string): string {
    if (!projectId) return join(this.workspaceDir, 'training');
    const slug = this.resolvePenSlug(projectId);
    return join(this.workspaceDir, 'training', `pen-${slug}`);
  }

  // ─── Voice Profile Resolution ─────────────────────────────────────────────

  /**
   * Resolve and read the voice profile from the parent book planning project.
   * The voice profile is generated during book planning as step-5-voice-profile.md.
   * Returns the raw markdown content, or null if not found.
   */
  private resolveVoiceProfile(projectId?: string): string | null {
    if (!projectId) return null;

    if (this.voiceProfileCache.has(projectId)) {
      return this.voiceProfileCache.get(projectId) || null;
    }

    const PEN_NAME_KEYWORDS = [
      'voice-profile', 'voice_profile',
      'influence-map', 'influence_map',
      'vocabulary-fingerprint', 'vocabulary_fingerprint',
      'structural-habits', 'structural_habits',
      'dialogue-fingerprint', 'dialogue_fingerprint',
      'thematic-obsessions', 'thematic_obsessions',
    ];

    try {
      const projectsDir = join(this.workspaceDir, 'projects');
      if (!existsSync(projectsDir)) return null;

      // Preferred path: look up the pen-name's voice-bible source via SQLite.
      // The bible CONTENT itself lives on disk in analysis/, but SQLite tells
      // us WHICH project's analysis/ to read — avoids the legacy "first dir
      // that happens to have voice-profile.md wins" behavior.
      const slug = this.resolvePenSlug(projectId);
      const penRecord = this.findPenRecord(slug);
      const voiceBible = penRecord?.voiceBible;

      if (voiceBible?.sourceProjectId) {
        const combined = this.readVoiceBibleFromDisk(
          projectsDir,
          voiceBible.sourceProjectId,
          Array.isArray(voiceBible.sourceStepIds) ? voiceBible.sourceStepIds : null,
          PEN_NAME_KEYWORDS,
        );
        if (combined) {
          this.voiceProfileCache.set(projectId, combined);
          this.log.info('Voice bible resolved from pen-name record', {
            projectId,
            slug,
            sourceProjectId: voiceBible.sourceProjectId,
            chars: combined.length,
          });
          return combined;
        }
      }

      // Fallback: scan analysis dirs (legacy behavior — first match wins).
      // Triggered when pen_name_records is missing/empty, e.g. fresh installs
      // before backfill. Will be dropped after Phase 0 schema migration.
      const entries = readdirSync(projectsDir);
      for (const entry of entries) {
        const analysisDir = join(projectsDir, entry, 'analysis');
        if (!existsSync(analysisDir)) continue;
        const files = readdirSync(analysisDir);
        if (!files.some(f => f.includes('voice-profile') || f.includes('voice_profile'))) continue;

        const parts = files
          .filter(f => PEN_NAME_KEYWORDS.some(kw => f.includes(kw)))
          .map(f => readFileSync(join(analysisDir, f), 'utf-8'));

        if (parts.length > 0) {
          const combined = parts.join('\n\n---\n\n');
          this.voiceProfileCache.set(projectId, combined);
          this.log.info('Voice bible resolved via legacy scan', {
            projectId, dir: entry, files: parts.length, chars: combined.length,
          });
          return combined;
        }
      }
    } catch (err) {
      this.log.warn('Failed to resolve voice profile', { error: (err as Error).message });
    }

    return null;
  }

  // Read the voice bible files from <projectsDir>/<sourceProjectId>-*/analysis/.
  // If sourceStepIds is supplied, only files whose name starts with that step
  // prefix (`step-5-`, `step-6-`, …) are included; otherwise all keyword
  // matches are included.
  private readVoiceBibleFromDisk(
    projectsDir: string,
    sourceProjectId: string,
    sourceStepIds: string[] | null,
    keywords: string[],
  ): string | null {
    const entries = readdirSync(projectsDir);
    const dirName = entries.find(e => e === sourceProjectId || e.startsWith(`${sourceProjectId}-`));
    if (!dirName) {
      this.log.warn('Voice bible source dir not found', { sourceProjectId });
      return null;
    }

    const analysisDir = join(projectsDir, dirName, 'analysis');
    if (!existsSync(analysisDir)) {
      this.log.warn('Voice bible analysis dir missing', { sourceProjectId, dir: dirName });
      return null;
    }

    const files = readdirSync(analysisDir);
    const parts: string[] = [];

    if (sourceStepIds && sourceStepIds.length > 0) {
      for (const stepId of sourceStepIds) {
        const match = files.find(f => f.startsWith(`${stepId}-`));
        if (match) parts.push(readFileSync(join(analysisDir, match), 'utf-8'));
      }
    } else {
      for (const file of files) {
        if (keywords.some(kw => file.includes(kw))) {
          parts.push(readFileSync(join(analysisDir, file), 'utf-8'));
        }
      }
    }

    return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
  }

  /**
   * Build a project-specific system prompt by merging the default rules
   * with voice profile data from the book planning stage.
   */
  private buildSystemPrompt(projectId?: string): string {
    const voiceProfile = this.resolveVoiceProfile(projectId);
    if (!voiceProfile) return DEFAULT_SYSTEM_PROMPT;

    const sections: string[] = [
      `You are a professional Deep POV author. Write exclusively in Deep POV.`,
      ``,
    ];

    // Extract GENRE VOICE section
    const genreVoiceMatch = voiceProfile.match(/## GENRE VOICE[\s\S]*?(?=## |$)/i);
    if (genreVoiceMatch) {
      sections.push(`## GENRE VOICE (from author profile)`);
      // Extract key rules from the markdown
      const lines = genreVoiceMatch[0].split('\n').filter(l => l.startsWith('- **'));
      for (const line of lines) {
        sections.push(line);
      }
      sections.push(``);
    }

    // Extract PROSE TARGETS section
    const proseTargetsMatch = voiceProfile.match(/## PROSE TARGETS[\s\S]*?(?=## |$)/i);
    if (proseTargetsMatch) {
      sections.push(`## PROSE TARGETS (from author profile)`);
      const lines = proseTargetsMatch[0].split('\n').filter(l => l.startsWith('- **'));
      for (const line of lines) {
        sections.push(line);
      }
      sections.push(``);
    }

    // Core style contract (always present — positive framing only)
    sections.push(
      `## PROSE STYLE CONTRACT`,
      `Show internal conflict through physical sensation: jaw clenching, knuckles whitening, ribs throbbing, teeth grinding.`,
      `Convey character emotions through somatic markers and environmental interaction only.`,
      `Describe only what the POV character can directly observe about other characters — body language, tone, movement.`,
      `End moments on concrete sensory detail, not thematic summary.`,
      ``,
    );

    // Extract ANTI-PATTERNS section (book-planning-specific bans)
    const antiPatternsMatch = voiceProfile.match(/## ANTI-PATTERNS[\s\S]*?(?=## |$)/i);
    if (antiPatternsMatch) {
      sections.push(`## ANTI-PATTERNS (from author profile)`);
      // Pull out the specific forbidden items
      const forbiddenLines = antiPatternsMatch[0].split('\n').filter(l =>
        l.startsWith('- "') || l.startsWith('- **') || l.startsWith('  - **')
      );
      for (const line of forbiddenLines) {
        sections.push(line);
      }
      sections.push(``);
    }

    // Extract SIGNATURE WORDS from Vocabulary Fingerprint
    const sigWordsMatch = voiceProfile.match(/## SIGNATURE WORDS[\s\S]*?(?=## |$)/i);
    if (sigWordsMatch) {
      sections.push(`## SIGNATURE WORDS (use these naturally)`);
      const lines = sigWordsMatch[0].split('\n').filter(l => l.startsWith('- '));
      for (const line of lines.slice(0, 8)) sections.push(line);
      sections.push(``);
    }

    // Extract BANNED WORDS from Vocabulary Fingerprint
    const bannedWordsMatch = voiceProfile.match(/## BANNED WORDS[\s\S]*?(?=## |$)/i);
    if (bannedWordsMatch) {
      sections.push(`## BANNED WORDS (NEVER use these)`);
      const lines = bannedWordsMatch[0].split('\n').filter(l => l.startsWith('- '));
      for (const line of lines.slice(0, 8)) sections.push(line);
      sections.push(``);
    }

    // Extract METAPHOR FAMILY
    const metaphorMatch = voiceProfile.match(/## METAPHOR FAMILY[\s\S]*?(?=## |$)/i);
    if (metaphorMatch) {
      sections.push(`## METAPHOR FAMILY`);
      const lines = metaphorMatch[0].split('\n').filter(l => l.startsWith('- **'));
      for (const line of lines) sections.push(line);
      sections.push(``);
    }

    // Extract CHAPTER OPENINGS from Structural Habits
    const openingsMatch = voiceProfile.match(/## CHAPTER OPENINGS[\s\S]*?(?=## |$)/i);
    if (openingsMatch) {
      sections.push(`## CHAPTER OPENINGS`);
      const lines = openingsMatch[0].split('\n').filter(l => l.startsWith('- '));
      for (const line of lines.slice(0, 3)) sections.push(line);
      sections.push(``);
    }

    // Extract ATTRIBUTION STYLE from Dialogue Fingerprint
    const attrMatch = voiceProfile.match(/## ATTRIBUTION STYLE[\s\S]*?(?=## |$)/i);
    if (attrMatch) {
      sections.push(`## DIALOGUE RULES`);
      const lines = attrMatch[0].split('\n').filter(l => l.startsWith('- '));
      for (const line of lines) sections.push(line);
      sections.push(``);
    }

    // Extract CORE THEMES from Thematic Obsessions
    const themesMatch = voiceProfile.match(/## CORE THEMES[\s\S]*?(?=## |$)/i);
    if (themesMatch) {
      sections.push(`## THEMATIC OBSESSIONS`);
      const lines = themesMatch[0].split('\n').filter(l => l.startsWith('- **'));
      for (const line of lines.slice(0, 6)) sections.push(line);
      sections.push(``);
    }

    // Sensory palette (from voice profile if available, otherwise default)
    const vocabMatch = voiceProfile?.match(/## SIGNATURE WORDS[\s\S]*?(?=## |$)/i);
    if (vocabMatch) {
      const sensoryLines = vocabMatch[0].split('\n').filter(l => l.startsWith('- '));
      if (sensoryLines.length > 0) {
        sections.push(`## SENSORY PALETTE (from author profile)`);
        for (const line of sensoryLines.slice(0, 5)) sections.push(line);
        sections.push(``);
      }
    }

    sections.push(
      `## MANDATORY STYLE`,
      `Use somatic markers (teeth vibrating, jaw locking, white knuckles, ribs throbbing).`,
      `Use short punchy sentences during action, longer ones during introspection.`,
    );

    return sections.join('\n');
  }

  /**
   * Called after every calibration Summary step.
   * Exports JSONL and, every N passes, rebuilds the Modelfile + Ollama model.
   */
  async onPassComplete(passNumber: number, projectId?: string): Promise<void> {
    try {
      // 1. Export training JSONL
      const pairCount = await this.exportTrainingData(projectId);

      this.log.info('Auto-learning: training data exported', {
        passNumber,
        verifiedPairs: pairCount,
        finetuneReady: pairCount >= FINETUNE_THRESHOLD,
      });

      // 2. Every N passes — rebuild Modelfile and recreate Ollama model
      if (passNumber > 0 && passNumber % MODELFILE_REBUILD_INTERVAL === 0) {
        this.log.info('Auto-learning: Modelfile rebuild bypassed (managed by Trainer now)', { passNumber });
        // await this.rebuildModelfile(passNumber);
      }

      // 3. When threshold is hit — write a flag file for the user
      if (pairCount >= FINETUNE_THRESHOLD) {
        await this.writeFinetuneFlag(pairCount, projectId);
      }

      // 4. Auto-ban AI-isms that repeat across 3+ consecutive passes
      await this.autoBanRepeatedAiIsms();

      // 5. Mine pass-level summary directives as structured training records
      if (projectId) {
        // Fire-and-forget summary directive mining
        // DISABLED: Generating unchecked training pairs from summaries.
        // await this.minePassSummaryDirectives(projectId, passNumber);
      }

    } catch (err) {
      // Non-fatal — don’t let learning failure break the calibration run
      this.log.warn('Auto-learning step failed (non-fatal)', { error: (err as Error).message });
    }
  }

  // ── Feature 1: Score Time-Series Tracking ─────────────────────────────────────────

  /**
   * Extract Deep POV / Pacing / Hook / Dialogue scores from a POV check result
   * and append them to workspace/training/scores.csv for trend analysis.
   */
  async recordPovScores(projectId: string, stepLabel: string, povCheckResult: string): Promise<void> {
    try {
      const outputDir = this.trainingPoolDir(projectId);
      if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });

      // Parse scores from the standard POV check markdown format
      const extract = (label: string): number | null => {
        const match = povCheckResult.match(new RegExp(`\\*\\*${label} Score\\*\\*:\\s*(\\d+)`, 'i'))
          || povCheckResult.match(new RegExp(`\\*\\*${label}\\*\\*:\\s*(\\d+)`, 'i'));
        return match ? parseInt(match[1]) : null;
      };

      const deepPov  = extract('Deep POV');
      const pacing   = extract('Pacing');
      const hook     = extract('Hook');
      const dialogue = extract('Dialogue Quality');
      const verdict  = (povCheckResult.match(/\*\*Verdict\*\*:\s*(\w+)/) || [])[1] || 'UNKNOWN';

      if (deepPov === null) return; // Not a scoreable POV check result

      const sceneType = stepLabel.toLowerCase().includes('action') ? 'action'
        : stepLabel.toLowerCase().includes('dialogue') ? 'dialogue'
        : stepLabel.toLowerCase().includes('introspection') ? 'introspection'
        : stepLabel.toLowerCase().includes('setting') ? 'setting' : 'unknown';

      const passMatch = stepLabel.match(/Pass (\d+)/);
      const passNum = passMatch ? passMatch[1] : '?';

      const csvPath = join(outputDir, 'scores.csv');
      const isNew = !existsSync(csvPath);

      const row = [
        new Date().toISOString(),
        projectId,
        passNum,
        sceneType,
        deepPov ?? '',
        pacing ?? '',
        hook ?? '',
        dialogue ?? '',
        verdict,
      ].join(',');

      const header = isNew ? 'timestamp,project,pass,scene,deep_pov,pacing,hook,dialogue,verdict\n' : '';
      await appendFile(csvPath, header + row + '\n', 'utf-8');

      this.log.info('Score tracked', { project: projectId, pass: passNum, scene: sceneType, deepPov, verdict });

      // Fire-and-forget violation mining - generates real training pairs from this check
      // DISABLED: Zero-shot rewrites are generating toxic purple prose clichés.
      // this.mineViolationsFromPovCheck(projectId, stepLabel, sceneType, povCheckResult).catch(err =>
      //  this.log.warn('Violation mining failed (non-fatal)', { error: (err as Error).message })
      // );
    } catch (err) {
      this.log.warn('Score tracking failed', { error: (err as Error).message });
    }
  }

  /**
   * Extract quoted bad phrases from a POV check result, send each to the Librarian
   * for a real Deep POV correction, and append the pairs to mined_pairs.jsonl.
   * This is the primary mechanism for accumulating training data fast.
   */
  private async mineViolationsFromPovCheck(projectId: string, stepLabel: string, sceneType: string, povCheckResult: string): Promise<void> {
    // ── 1. Extract all bad phrases from the structured sections ──────────────
    const badPhrases: { text: string; category: string }[] = [];

    // A universal regex to match `- "phrase"` or `* "phrase"` or `* *"phrase"*`
    const phraseRe = /[-*]\s*\**"([^"]{10,300})"\**/g;
    let m: RegExpExecArray | null;

    // Filter Words
    const filterWordsRe = /\**Filter Words(?: Found)?\**:[ \t]*[\s\S]*?(?=(?:\r?\n)[ \t]*[-*]*[ \t]*\**[A-Z]|$)/i;
    const filterWordsSection = povCheckResult.match(filterWordsRe)?.[0] || '';
    while ((m = phraseRe.exec(filterWordsSection)) !== null) {
      badPhrases.push({ text: m[1], category: 'filter_word' });
    }

    // Show vs Tell
    const showTellRe = /\**Show vs Tell Violations\**:[ \t]*[\s\S]*?(?=(?:\r?\n)[ \t]*[-*]*[ \t]*\**[A-Z]|$)/i;
    const showTellSection = povCheckResult.match(showTellRe)?.[0] || '';
    while ((m = phraseRe.exec(showTellSection)) !== null) {
      badPhrases.push({ text: m[1], category: 'show_vs_tell' });
    }

    // AI-Isms
    const aiIsmSection = povCheckResult.match(/\**AI-Isms(?: Found)?\**:[ \t]*[\s\S]*?(?=(?:\r?\n)[ \t]*[-*]*[ \t]*\**[A-Z]|$)/i)?.[0] || '';
    while ((m = phraseRe.exec(aiIsmSection)) !== null) {
      badPhrases.push({ text: m[1], category: 'ai_ism' });
    }

    // Language Violations
    const languageRe = /\**Language Violations(?: Found)?\**:[ \t]*[\s\S]*?(?=(?:\r?\n)[ \t]*[-*]*[ \t]*\**[A-Z]|$)/i;
    const languageSection = povCheckResult.match(languageRe)?.[0] || '';
    while ((m = phraseRe.exec(languageSection)) !== null) {
      badPhrases.push({ text: m[1], category: 'language_violation' });
    }

    if (badPhrases.length === 0 && !povCheckResult.includes('**Golden Sentences**')) {
      this.log.info('Violation mining: no extractable phrases found', { stepLabel });
      return;
    }

    this.log.info('Violation mining: processing phrases', {
      stepLabel, count: badPhrases.length,
    });

    // ── 1.5 Extract Golden Sentences (Positive Feedback) ─────────────────────
    const newPairs: object[] = [];
    const goldenSection = povCheckResult.match(/\*\*Golden Sentences\*\*:[\s\S]*?(?=\*\*[A-Z]|$)/i)?.[0] || '';
    while ((m = phraseRe.exec(goldenSection)) !== null) {
      newPairs.push(this.buildTrainingRecord('', m[1], 'golden_sentence'));
      this.log.info('Violation mining: golden sentence extracted', { good: m[1].slice(0, 60) });
    }

    // ── 2. Call Librarian to generate corrections for Violations ──────────────
    // Use the WRITER (5090 / Magnum 32B) to generate rewrites — NOT the Librarian.
    // This ensures training data reflects the Writer's own voice at its best,
    // not the Librarian's (Gemma 12B) limited vocabulary and style quirks.
    const WRITER_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://ollama:11434';
    const WRITER_MODEL = process.env.WRITER_MODEL || 'hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M';

    for (const { text, category } of badPhrases) {
      try {
        const response = await fetch(`${WRITER_ENDPOINT}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: WRITER_MODEL,
            stream: false,
            messages: [
              {
                role: 'system',
                content: 'You are a RUTHLESS Deep POV prose editor producing LoRA training data. Every sentence you write will be permanently baked into a writing model. Quality is everything.\n\nRULES:\n- Always use THIRD PERSON (she/he/they). NEVER use first person (I/my/me). This is non-negotiable.\n- Show internal experience through physical sensation, sound, texture, temperature, and proprioception ONLY.\n- NEVER start with "A", "The", or a pronoun. Start with: a verb, a prepositional phrase, a body part, a sound, an action fragment, or sensory detail.\n- BANNED VERBS (overused by LLMs): bloomed, shuddered, tightened, hitched, vibrated, tremor, slithered, resonated, pulsed, thrummed, whispered, echoed, cascaded, seared, lanced.\n- BANNED PHRASES: "metallic tang", "copper taste", "soles of", "behind her eyes", "back of her throat", "breath hitched", "jaw clenched", "knuckles whitened", "low hum", "dull throb", "scent of".\n- USE INSTEAD: specific textures (grit, chalk, rust, wet wool), specific sounds (click, scrape, hiss, creak), specific body parts (wrist, collarbone, sternum, shin, nape), temperatures (cold seeped, heat pooled).\n- Each rewrite must use DIFFERENT physical details. Surprise me.\n- Output ONLY the rewritten prose. No explanation, no preamble, no commentary.',
              },
              {
                role: 'user',
                content: `Rewrite this in third-person Deep POV:\n\n"${text}"`,
              },
            ],
          }),
        });

        if (!response.ok) continue;
        const data = await response.json() as any;
        const correction = data?.message?.content?.trim();

        if (!correction || correction.length < 5) continue;
        // Skip if the model returned an explanation instead of just a rewrite
        if (correction.toLowerCase().startsWith('here') || correction.includes(':\n')) continue;
        // Skip if the model asked for the text instead of rewriting
        if (correction.toLowerCase().startsWith('please') || correction.toLowerCase().startsWith('okay')) continue;
        // Skip if ANY first-person pronoun leaked through
        if (/\b(my|I|me|mine|myself)\b/.test(correction)) continue;

        newPairs.push(this.buildTrainingRecord(text, correction, category));
        this.log.info('Violation mining: pair generated', { category, bad: text.slice(0, 60) });
      } catch (err: any) {
        this.log.warn('Librarian connection failed', { phrase: text.slice(0, 30), error: err.message });
      }
    }

    if (newPairs.length === 0) return;

    // ── 3. Append to mined_pairs.jsonl ───────────────────────────────────────
    const outputDir = this.trainingPoolDir(projectId);
    if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });

    const minedPath = join(outputDir, 'mined_pairs.jsonl');
    const lines = newPairs.map(p => JSON.stringify(p)).join('\n') + '\n';
    await appendFile(minedPath, lines, 'utf-8');

    this.log.info('Violation mining: pairs saved', { count: newPairs.length, path: minedPath });
  }

  // ── Auto-source 3: Full PASS Scene Injection ──────────────────────────────

  /**
   * When a compiled scene earns a PASS verdict, add the entire scene as a
   * long-form positive training example. Teaches the model scene-level structure
   * and pacing, not just sentence-level mechanics.
   */
  async minePassedScene(projectId: string, sceneType: string, compiledText: string, verdict: string, deepPovScore?: number): Promise<void> {
    // Accept PASS verdicts, or REVISE verdicts with a high Deep POV score (≥8)
    if (verdict !== 'PASS' && !(verdict === 'REVISE' && deepPovScore && deepPovScore >= 8)) return;
    if (!compiledText || compiledText.length < 200) return;

    try {
      const sceneInstruction: Record<string, string> = {
        action:       'Write an 800-word Deep POV action scene with visceral, tactile physical grounding and short punchy sentences.',
        dialogue:     'Write an 800-word Deep POV dialogue scene where subtext and character voice carry the tension. No on-the-nose exchanges.',
        introspection:'Write an 800-word Deep POV introspection scene using only physical sensation and somatic markers. Zero thought verbs.',
      };

      const instruction = sceneInstruction[sceneType.toLowerCase()] ||
        'Write an 800-word Deep POV scene using only physical sensation and somatic markers.';

      const record = {
        conversations: [
          { role: 'system', content: this.buildSystemPrompt(projectId) },
          { role: 'user', content: instruction },
          { role: 'assistant', content: compiledText.trim() },
        ],
        metadata: { source: 'perry_calibration', category: 'full_scene_pass', sceneType },
      };

      const outputDir = this.trainingPoolDir(projectId);
      if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });
      const minedPath = join(outputDir, 'mined_pairs.jsonl');
      await appendFile(minedPath, JSON.stringify(record) + '\n', 'utf-8');
      this.log.info('Full scene mined as positive training example', { sceneType, chars: compiledText.length });
    } catch (err) {
      this.log.warn('Full scene mining failed (non-fatal)', { error: (err as Error).message });
    }
  }

  // ── Auto-source 4: Pass Summary Directive Injection ───────────────────────

  /**
   * After every Summary step, parse the JSON directive block and convert each
   * DO/AVOID directive into a standalone training record. Teaches the model
   * the exact stylistic rules it should follow in a structured Q&A format.
   */
  private async minePassSummaryDirectives(projectId: string, passNumber: number): Promise<void> {
    try {
      // Find the most recent summary file for this project/pass
      const projectsDir = join(this.workspaceDir, 'projects');
      if (!existsSync(projectsDir)) return;

      // Glob for the summary file matching this pass
      const { readdir, readFile: rf } = await import('fs/promises');
      const entries = await readdir(projectsDir, { withFileTypes: true });
      const projectDir = entries.find(e => e.isDirectory() && e.name.startsWith(projectId));
      if (!projectDir) return;

      const analysisDir = join(projectsDir, projectDir.name, 'analysis');
      if (!existsSync(analysisDir)) return;

      const files = await readdir(analysisDir);
      const summaryFile = files
        .filter(f => f.includes(`pass-${passNumber}-summary`) || f.includes(`pass-${String(passNumber).padStart(2,'0')}-summary`))
        .sort()
        .pop();

      if (!summaryFile) return;

      const content = await rf(join(analysisDir, summaryFile), 'utf-8');

      // Extract the JSON block
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) return;

      const directives = JSON.parse(jsonMatch[1]) as { positive?: string[]; negative?: string[] };
      const positives = directives.positive || [];
      const negatives = directives.negative || [];

      const newPairs: object[] = [];

      // Convert each positive directive into a prose demonstration pair
      for (const directive of positives) {
        const topic = directive.replace(/^DO:\s*/i, '').trim();
        newPairs.push({
          conversations: [
            { role: 'system', content: this.buildSystemPrompt(projectId) },
            { role: 'user', content: `Write a robust, 50-word paragraph of Deep POV prose that demonstrates: ${topic}` },
            { role: 'assistant', content: `[Demonstration of: ${directive}]` },
          ],
          metadata: { source: 'perry_calibration', category: 'directive_positive', pass: passNumber, needsLibrarianExpansion: true },
        });
      }

      // Convert each negative directive into a correction pair — show the fix, not the rule
      for (const directive of negatives) {
        const topic = directive.replace(/^AVOID:\s*/i, '').trim();
        newPairs.push({
          conversations: [
            { role: 'system', content: this.buildSystemPrompt(projectId) },
            { role: 'user', content: `Rewrite this passage to fix: ${topic}` },
            { role: 'assistant', content: `[Corrected prose avoiding: ${topic}]` },
          ],
          metadata: { source: 'perry_calibration', category: 'directive_negative', pass: passNumber, needsLibrarianExpansion: true },
        });
      }

      if (newPairs.length === 0) return;

      const outputDir = this.trainingPoolDir(projectId);
      if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });
      const minedPath = join(outputDir, 'mined_pairs.jsonl');
      const lines = newPairs.map(p => JSON.stringify(p)).join('\n') + '\n';
      await appendFile(minedPath, lines, 'utf-8');

      this.log.info('Directive mining: pairs saved from pass summary', {
        pass: passNumber, positive: positives.length, negative: negatives.length,
      });
    } catch (err) {
      this.log.warn('Directive mining failed (non-fatal)', { error: (err as Error).message });
    }
  }

  // ── Feature 2: Auto-Ban Repeated AI-Isms ───────────────────────────────────────

  /**
   * Scan recent POV check files for AI-Ism patterns.
   * If a pattern appears in 3+ consecutive passes, auto-add it to bannedPhrases.
   * This makes the ban list self-growing from real failure data.
   */
  private async autoBanRepeatedAiIsms(): Promise<void> {
    try {
      const analysisDir = join(this.workspaceDir, 'projects');
      if (!existsSync(analysisDir)) return;

      // Get AI-isms from global DNA trope warnings (already accumulated by learnFromFailure)
      const globalRules = this.styleDna.getGlobalRules();
      const tropeWarnings = globalRules.tropeWarnings || [];
      const currentBans = globalRules.bannedPhrases || [];
      const currentBanSet = new Set(currentBans.map((b: string) => b.toLowerCase()));

      // Count how many times each trope warning has appeared
      // tropeWarnings accumulate from learnFromFailure — high count = persistent failure
      const newBans: string[] = [];
      for (const trope of tropeWarnings) {
        // Extract the quoted phrase from trope warnings like: 'AVOID: "smudge of ink"'
        const quoted = trope.match(/"([^"]{5,60})"/);
        if (!quoted) continue;
        const phrase = quoted[1].toLowerCase();
        if (!currentBanSet.has(phrase)) {
          newBans.push(phrase);
          currentBanSet.add(phrase);
        }
      }

      if (newBans.length > 0) {
        this.styleDna.addBannedPhrases(newBans);
        this.log.info('Auto-ban: added repeated AI-isms to bannedPhrases', {
          count: newBans.length,
          phrases: newBans.slice(0, 5),
        });
      }
    } catch (err) {
      this.log.warn('Auto-ban failed (non-fatal)', { error: (err as Error).message });
    }
  }

  // ─── Librarian Quality Gate ─────────────────────────────────────────────

  /**
   * Fast local scan — catches obvious contamination without an LLM call.
   * Returns a rejection reason string, or null if the text passes.
   */
  private fastQualityScan(text: string): string | null {
    const lower = text.toLowerCase();

    // 0. Meta-contamination — Librarian asked for text instead of writing prose
    if (lower.startsWith('please provide') || lower.startsWith('please') || lower.startsWith('okay,') ||
        lower.includes('just paste the') || lower.includes('i need the text') ||
        lower.includes('i need the original') || lower.includes('i\'m ready to')) {
      return 'meta_contamination';
    }

    // 0b. First-person POV leak — manuscript is third-person Deep POV
    // Reject ANY first-person pronoun (my, I, me, mine, myself) — the model must learn third-person only
    if (/\b(my|I|me|mine|myself)\b/.test(text)) {
      return 'first_person_pov';
    }

    // 1. Filter words that should never appear in Deep POV prose
    const FILTER_WORDS = [
      'he felt', 'she felt', 'they felt',
      'he noticed', 'she noticed',
      'he realized', 'she realized',
      'he thought', 'she thought',
      'he saw', 'she saw',
      'he heard', 'she heard',
      'he looked', 'she looked',
      'he stared', 'she stared',
      'he wondered', 'she wondered',
      'he remembered', 'she remembered',
      'he imagined', 'she imagined',
      'he assumed', 'she assumed',
      'he decided', 'she decided',
    ];

    for (const fw of FILTER_WORDS) {
      if (lower.includes(fw)) return `filter_word:${fw}`;
    }

    // 2. Named emotions as nouns (the model should show, not tell)
    const EMOTION_NOUNS = [
      'a wave of', 'a surge of', 'a pang of', 'a rush of', 'a flicker of',
      'desperation', 'with panic', 'with fear', 'with anger', 'with grief',
      'with relief', 'with terror', 'with dread',
    ];

    for (const en of EMOTION_NOUNS) {
      if (lower.includes(en)) return `emotion_noun:${en}`;
    }

    // 3. Bracket annotations — prompt leakage into prose
    if (/\[(?:narrator|technique|pov|word count|scene|note)/i.test(text)) {
      return 'bracket_annotation';
    }

    // 4. Rule regurgitation — the model is quoting instructions instead of writing prose
    if (lower.includes('never use') || lower.includes('do not use') || lower.includes('avoid using')) {
      return 'rule_regurgitation';
    }

    // 5. Too short to be useful prose (less than 8 words)
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 8 && !text.includes('"')) {
      return `too_short:${wordCount}_words`;
    }

    // 6. Overused trigrams — prevents vocabulary collapse in training data
    const OVERUSED_TRIGRAMS = [
      'the soles of', 'the scent of', 'a low hum', 'behind my eyes',
      'in my teeth', 'my breath hitched', 'against my skin', 'through the soles',
      'a dull throb', 'a metallic tang', 'the back of', 'vibrated through my',
    ];
    for (const tri of OVERUSED_TRIGRAMS) {
      if (lower.includes(tri)) return `overused_trigram:${tri}`;
    }

    return null;
  }

  /**
   * Deep Librarian audit — sends the "good" text to gemma3:12b for quality scoring.
   * Returns true if the pair passes, false if rejected.
   * Only called on pairs that pass the fast scan but are from higher-risk sources.
   */
  private async librarianDeepAudit(goodText: string): Promise<{ pass: boolean; reason: string }> {
    const LIBRARIAN_ENDPOINT = process.env.LIBRARIAN_ENDPOINT || 'http://ollama-embeddings:11434';
    const LIBRARIAN_MODEL = 'gemma3:12b';

    try {
      const response = await fetch(`${LIBRARIAN_ENDPOINT}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: LIBRARIAN_MODEL,
          stream: false,
          messages: [
            {
              role: 'system',
              content: `You are a BRUTALLY strict prose quality auditor for LoRA training data. This text will be used to fine-tune a writing model — any contamination will permanently damage the model. Be merciless.

AUTOMATIC FAIL conditions:
1. Filter words (felt, noticed, realized, thought, saw, heard, wondered, stared, seemed, knew, decided)
2. Named emotions as nouns (fear, anger, grief, panic, desperation, relief, terror, dread, joy)
3. POV leakage (attributing internal states to non-POV characters)
4. AI-isms (Rule of Three, "a testament to", "tapestry", "palpable", "delve", "symphony", "cacophony", "labyrinth")
5. Thematic summaries ("He had failed." / "It was over." / "Nothing would ever be the same.")
6. First-person pronouns (I, my, me, mine) — the manuscript is THIRD PERSON only
7. Meta-commentary ("Here is", "Please provide", "I'm ready to", "the passage")
8. Clichéd somatic markers used as a crutch: "breath hitched", "jaw clenched", "knuckles whitened", "metallic tang", "copper taste" — only FAIL if 2+ of these appear in the SAME response
9. Purple prose or melodrama ("bloomed across", "tendrils of", "shattered into a thousand")
10. Starting with "A" followed by a generic noun ("A chill", "A tremor", "A shudder", "A prickle")

Respond with EXACTLY one line:
PASS - if the text is genuinely excellent, varied, third-person Deep POV prose
FAIL:[reason] - if ANY violation is found. Name the specific issue.`,
            },
            {
              role: 'user',
              content: goodText,
            },
          ],
        }),
      });

      if (!response.ok) return { pass: true, reason: 'librarian_unavailable' };
      const data = await response.json() as any;
      const verdict = data?.message?.content?.trim() || '';

      if (verdict.startsWith('PASS')) {
        return { pass: true, reason: 'librarian_approved' };
      } else if (verdict.startsWith('FAIL')) {
        return { pass: false, reason: verdict };
      }

      // Ambiguous response — let it through but flag
      return { pass: true, reason: 'librarian_ambiguous' };
    } catch {
      // Librarian offline — don't block the pipeline
      return { pass: true, reason: 'librarian_offline' };
    }
  }

  /**
   * Writer Quality Gate — sends the "good" text to the 5090 (Magnum 32B) for a
   * second-pass quality check. Only pairs that pass BOTH the Librarian and the
   * Writer get into the final training data. This ensures the 32B model's own
   * quality standards are met, not just the 12B's.
   */
  private async writerDeepAudit(goodText: string): Promise<{ pass: boolean; reason: string }> {
    const WRITER_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://ollama:11434';
    const WRITER_MODEL = process.env.WRITER_MODEL || 'hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M';

    try {
      const response = await fetch(`${WRITER_ENDPOINT}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: WRITER_MODEL,
          stream: false,
          messages: [
            {
              role: 'system',
              content: `You are a merciless prose quality auditor for LoRA fine-tuning data. This text will be permanently embedded into a writing model. If you let bad prose through, the model will reproduce it forever.

REJECT (output FAIL) if ANY of these are present:
1. First person pronouns (I, my, me, mine) — manuscript is THIRD PERSON only
2. Filter words (felt, noticed, realized, thought, saw, heard, seemed, knew, decided, wondered)
3. Named emotions as nouns (fear, anger, grief, panic, desperation, terror, dread, relief)
4. AI clichés: "metallic tang", "copper taste", "breath hitched", "jaw clenched", "knuckles whitened", "a testament to", "tapestry", "palpable", "delve"
5. Repetitive sentence structure (3+ sentences with same grammatical pattern)
6. Purple prose or melodrama ("bloomed", "tendrils", "shattered", "seared through")
7. Meta-commentary ("here is", "please provide", "I need the text", "rewrite")
8. Thematic summary statements ("Nothing would ever be the same", "It was over", "Everything had changed")
9. Weak prose that would teach the model bad habits

ACCEPT (output PASS) only if the text is genuinely excellent, varied, physically grounded third-person Deep POV prose that you would be proud to have a model learn from.

Respond with EXACTLY one line:
PASS - only if genuinely excellent
FAIL:[specific reason] - if any issue found`,
            },
            {
              role: 'user',
              content: goodText,
            },
          ],
        }),
      });

      if (!response.ok) return { pass: true, reason: 'writer_unavailable' };
      const data = await response.json() as any;
      const verdict = data?.message?.content?.trim() || '';

      if (verdict.startsWith('PASS')) {
        return { pass: true, reason: 'writer_approved' };
      } else if (verdict.startsWith('FAIL')) {
        return { pass: false, reason: verdict };
      }

      return { pass: true, reason: 'writer_ambiguous' };
    } catch {
      // Writer busy with pipeline — don't block
      return { pass: true, reason: 'writer_offline' };
    }
  }


  /**
   * Expand placeholder directive pairs into real prose demonstrations.
   * The directive mining step creates pairs like:
   *   user: "Write a paragraph that demonstrates: X"
   *   assistant: "[Demonstration of: DO: X]"
   *
   * This method replaces the placeholder with actual prose from the Librarian.
   */
  private async expandDirectivePair(record: any): Promise<any | null> {
    const assistantContent = record?.conversations?.[2]?.content || '';
    if (!assistantContent.startsWith('[')) return record; // Already expanded

    const userContent = record?.conversations?.[1]?.content || '';
    // Use the WRITER (5090) for directive expansion — it generates the training prose
    const WRITER_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://ollama:11434';
    const WRITER_MODEL = process.env.WRITER_MODEL || 'hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M';

    try {
      const response = await fetch(`${WRITER_ENDPOINT}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: WRITER_MODEL,
          stream: false,
          messages: [
            {
              role: 'system',
              content: record.conversations[0].content,
            },
            {
              role: 'user',
              content: userContent + '\n\nCRITICAL INSTRUCTION: Do NOT use repetitive LLM verbs like "bloomed", "shuddered", "slithered", or "resonated". You must use a massive variety of sharp, unique, and highly specific physical verbs.',
            },
          ],
        }),
      });

      if (!response.ok) return null;
      const data = await response.json() as any;
      const prose = data?.message?.content?.trim();

      if (!prose || prose.split(/\\s+/).length < 20) return null;
      // Reject if the Librarian returned an explanation instead of prose
      if (prose.toLowerCase().startsWith('here') || prose.includes(':\n-') || prose.includes('## ')) return null;
      // Reject if the Librarian asked for input instead of writing
      if (prose.toLowerCase().startsWith('please') || prose.toLowerCase().startsWith('okay')) return null;

      // Replace the placeholder with actual prose
      return {
        ...record,
        conversations: [
          record.conversations[0],
          record.conversations[1],
          { role: 'assistant', content: prose },
        ],
        metadata: { ...record.metadata, expanded: true },
      };
    } catch {
      return null; // Librarian offline — skip this pair
    }
  }

  // ─── JSONL Export (with Librarian Quality Gate) ─────────────────────────

  private async exportTrainingData(projectId?: string): Promise<number> {
    const outputDir = this.trainingPoolDir(projectId);
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    const candidateRecords: any[] = [];
    const auditStats = { total: 0, fastReject: 0, librarianReject: 0, writerReject: 0, expanded: 0, passed: 0, reasons: new Map<string, number>() };

    // NOTE: Baseline pairs intentionally excluded.
    // Each pen name's LoRA must train exclusively on pairs discovered by its own
    // calibration pipeline. Injecting generic pre-seeded pairs would cross-contaminate
    // models across different pen names and writing styles.

    // Add learned pairs from StyleDNA showVsTellExamples
    const learnedPairs = this.styleDna.getGlobalRules().showVsTellExamples || [];
    for (const pair of learnedPairs) {
      if (pair.bad && pair.good) {
        candidateRecords.push(this.buildTrainingRecord(pair.bad, pair.good, 'learned'));
      }
    }

    // Add mined pairs from violation mining (primary accumulation source)
    const minedPath = join(outputDir, 'mined_pairs.jsonl');
    if (existsSync(minedPath)) {
      const minedContent = await readFile(minedPath, 'utf-8');
      const minedLines = minedContent.split('\n').filter(l => l.trim());
      // Deduplicate by hashing the 'bad' field
      const seenBad = new Set<string>();
      for (const line of minedLines) {
        try {
          const record = JSON.parse(line) as any;
          // Extract the actual bad phrase — it's after the preamble in the user message
          const userContent = record?.conversations?.[1]?.content || '';
          // The bad text is the quoted phrase after the last newline: "bad text here"
          let badText = '';
          if (record?.metadata?.category === 'full_scene_pass') {
            // For full scenes, the user prompt is identical. Deduplicate based on the assistant's output instead.
            badText = (record?.conversations?.[2]?.content || '').slice(0, 80);
          } else {
            const badMatch = userContent.match(/"([^"]+)"$/);
            badText = badMatch ? badMatch[1] : userContent.slice(-80);
          }
          if (badText && !seenBad.has(badText)) {
            seenBad.add(badText);
            candidateRecords.push(record);
          }
        } catch { /* skip malformed lines */ }
      }
    }

    // ── Quality Gate Pipeline ──────────────────────────────────────────────
    const verifiedRecords: object[] = [];

    for (const record of candidateRecords) {
      auditStats.total++;

      const assistantContent = record?.conversations?.[2]?.content || '';

      // Phase 1: Expand placeholder directive pairs via Librarian
      if (record?.metadata?.needsLibrarianExpansion && assistantContent.startsWith('[')) {
        const expanded = await this.expandDirectivePair(record);
        if (!expanded) {
          auditStats.fastReject++;
          this.trackRejection(auditStats.reasons, 'expansion_failed');
          continue;
        }
        record.conversations = expanded.conversations;
        record.metadata = expanded.metadata;
        auditStats.expanded++;
      }

      const goodText = record?.conversations?.[2]?.content || '';
      const category = record?.metadata?.category || '';

      // Phase 2: Fast local scan (no LLM call — instant)
      // Bypass fast scan for full_scene_pass since a single minor filter word shouldn't ruin an entire 800-word scene
      if (category !== 'full_scene_pass') {
        const fastResult = this.fastQualityScan(goodText);
        if (fastResult) {
          auditStats.fastReject++;
          this.trackRejection(auditStats.reasons, fastResult);
          this.log.debug('Quality gate: fast reject', { reason: fastResult, text: goodText.slice(0, 60) });
          continue;
        }
      }

      // Phase 3: Librarian deep audit (BYPASSED)
      // The 12B model hallucinated failures on good 32B prose. Relying solely on the 32B Writer Deep Audit.
      const needsDeepAudit = ['filter_word', 'show_vs_tell', 'ai_ism', 'learned', 'directive_positive', 'directive_negative'].includes(category);

      /* BYPASS LIBRARIAN 12B AUDIT
      if (needsDeepAudit) {
        const auditResult = await this.librarianDeepAudit(goodText);
        if (!auditResult.pass) {
          auditStats.librarianReject++;
          this.trackRejection(auditStats.reasons, auditResult.reason);
          this.log.info('Quality gate: Librarian reject', { reason: auditResult.reason, text: goodText.slice(0, 60) });
          continue;
        }
      }
      */

      // Phase 4: Writer (5090) deep audit — final quality gate
      // The 32B model's own standards must be met, not just the 12B's
      if (needsDeepAudit) {
        const writerResult = await this.writerDeepAudit(goodText);
        if (!writerResult.pass) {
          auditStats.writerReject++;
          this.trackRejection(auditStats.reasons, `writer:${writerResult.reason}`);
          this.log.info('Quality gate: Writer (5090) reject', { reason: writerResult.reason, text: goodText.slice(0, 60) });
          continue;
        }
      }

      // Passed ALL gates (fast scan + Librarian + Writer)
      auditStats.passed++;
      verifiedRecords.push(record);
    }

    this.log.info('Quality gate complete', {
      total: auditStats.total,
      passed: auditStats.passed,
      fastReject: auditStats.fastReject,
      librarianReject: auditStats.librarianReject,
      writerReject: auditStats.writerReject,
      expanded: auditStats.expanded,
      passRate: auditStats.total > 0 ? `${Math.round((auditStats.passed / auditStats.total) * 100)}%` : 'N/A',
    });

    const jsonl = verifiedRecords.map(r => JSON.stringify(r)).join('\n');
    const outputPath = join(outputDir, 'training_data.jsonl');
    await writeFile(outputPath, jsonl, 'utf-8');

    // Write enriched summary with audit stats
    const summaryPath = join(outputDir, 'training_summary.md');
    const topRejects = [...auditStats.reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => `  - \`${reason}\`: ${count} rejected`)
      .join('\n');

    await writeFile(summaryPath, [
      `# Perry LoRA Training Data`,
      ``,
      `Generated: ${new Date().toISOString()}`,
      ``,
      `## Quality Gate Results`,
      `- **Candidates examined**: ${auditStats.total}`,
      `- **Fast scan rejected**: ${auditStats.fastReject} (filter words, emotion nouns, bracket annotations, rule regurgitation)`,
      `- **Librarian rejected**: ${auditStats.librarianReject} (deep POV audit failures)
- **Writer (5090) rejected**: ${auditStats.writerReject} (final quality gate)`,
      `- **Directives expanded**: ${auditStats.expanded} (placeholder → real prose via Librarian)`,
      `- **Verified pairs**: ${auditStats.passed}`,
      `- **Pass rate**: ${auditStats.total > 0 ? Math.round((auditStats.passed / auditStats.total) * 100) : 0}%`,
      ``,
      `### Top Rejection Reasons`,
      topRejects || '  (none)',
      ``,
      `## Data Sources`,
      `  - Learned from calibration (DNA): ${learnedPairs.filter(p => p.bad && p.good).length}`,
      `  - Mined from POV check violations: ${candidateRecords.length - learnedPairs.filter(p => p.bad && p.good).length}`,
      ``,
      `## Fine-tune status`,
      verifiedRecords.length >= FINETUNE_THRESHOLD
        ? `✅ READY — ${verifiedRecords.length} verified pairs meets the ${FINETUNE_THRESHOLD} minimum threshold for LoRA fine-tuning.`
        : `⏳ ACCUMULATING — ${verifiedRecords.length}/${FINETUNE_THRESHOLD} verified pairs. Continue running calibration passes.`,
      ``,
      `## To run LoRA fine-tuning`,
      `\`\`\`bash`,
      `python finetune-lora.py --data ${outputPath}`,
      `\`\`\``,
    ].join('\n'), 'utf-8');

    // Write rejected pairs log for debugging
    const rejectLogPath = join(outputDir, 'rejected_pairs.log');
    const rejectSummary = [...auditStats.reasons.entries()]
      .map(([reason, count]) => `${reason}: ${count}`)
      .join('\n');
    await writeFile(rejectLogPath, `# Rejected pairs log — ${new Date().toISOString()}\n\n${rejectSummary}\n`, 'utf-8');

    return verifiedRecords.length;
  }

  private trackRejection(reasons: Map<string, number>, reason: string): void {
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }

  private buildTrainingRecord(bad: string, good: string, category: string, projectId?: string): object {
    const isGolden = category === 'golden_sentence';
    const systemPrompt = this.buildSystemPrompt(projectId);
    return {
      conversations: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: isGolden
            ? `Write a highly effective, physically grounded Deep POV sentence.`
            : `Rewrite this sentence to eliminate filter words, cognitive telling, and AI-isms. Output ONLY the corrected version. CRITICAL: Do NOT use repetitive LLM verbs like "bloomed", "shuddered", "slithered", or "resonated". Use sharp, varied physical verbs:\n\n"${bad}"`,
        },
        { role: 'assistant', content: good },
      ],
      metadata: { source: 'perry_calibration', category },
    };
  }

  // ─── Modelfile Rebuild ───────────────────────────────────────────────────

  private async rebuildModelfile(passNumber: number): Promise<void> {
    const globalRules = this.styleDna.getGlobalRules();

    // Build the updated Golden Examples section from learned pairs only (no generic baseline)
    const learnedPairs = (globalRules.showVsTellExamples || []).slice(-10);
    const allPairs = [...learnedPairs].slice(0, 15);

    const examplesBlock = allPairs.map((p, i) =>
      `${i + 1}. BAD:  "${p.bad}"\n   GOOD: "${p.good}"`
    ).join('\n');

    // Build current negative directives from DNA
    const negDirectives = (globalRules.tropeWarnings || []).slice(0, 5);
    const posDirectives = (globalRules.positiveDirectives || []).slice(0, 5);

    const modelfileContent = [
      `FROM hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M`,
      ``,
      `SYSTEM """`,
      `You are a professional Deep POV author. Auto-learned from calibration pass ${passNumber}.`,
      ``,
    ];

    // Inject voice profile from book planning (if available)
    const voiceProfile = this.resolveVoiceProfile();
    if (voiceProfile) {
      // Genre voice
      const genreMatch = voiceProfile.match(/## GENRE VOICE[\s\S]*?(?=## |$)/i);
      if (genreMatch) {
        modelfileContent.push(`## GENRE VOICE (from author profile)`);
        const lines = genreMatch[0].split('\n').filter(l => l.startsWith('- **'));
        for (const line of lines) modelfileContent.push(line);
        modelfileContent.push(``);
      }
      // Prose targets
      const proseMatch = voiceProfile.match(/## PROSE TARGETS[\s\S]*?(?=## |$)/i);
      if (proseMatch) {
        modelfileContent.push(`## PROSE TARGETS (from author profile)`);
        const lines = proseMatch[0].split('\n').filter(l => l.startsWith('- **'));
        for (const line of lines) modelfileContent.push(line);
        modelfileContent.push(``);
      }
      // Anti-patterns
      const antiMatch = voiceProfile.match(/## ANTI-PATTERNS[\s\S]*?(?=## |$)/i);
      if (antiMatch) {
        modelfileContent.push(`## ANTI-PATTERNS (from author profile)`);
        const lines = antiMatch[0].split('\n').filter(l =>
          l.startsWith('- "') || l.startsWith('- **') || l.startsWith('  - **')
        );
        for (const line of lines) modelfileContent.push(line);
        modelfileContent.push(``);
      }
    }

    modelfileContent.push(
      `## PROSE STYLE CONTRACT`,
      `Show internal conflict through physical sensation: jaw clenching, knuckles whitening, ribs throbbing, teeth grinding.`,
      `Convey character emotions through somatic markers and environmental interaction only.`,
      `Describe only what the POV character can directly observe about other characters.`,
      `End moments on concrete sensory detail, not thematic summary.`,
      ``,
      ...(negDirectives.length > 0 ? [
        `## LEARNED AVOIDANCES (from calibration)`,
        ...negDirectives.map(d => `- ${d}`),
        ``,
      ] : []),
      ...(posDirectives.length > 0 ? [
        `## LEARNED BEHAVIOURS (from calibration)`,
        ...posDirectives.map(d => `- ${d}`),
        ``,
      ] : []),
      `## MANDATORY STYLE`,
      `Somatic markers: teeth vibrating, white knuckles locking, ribs throbbing, jaw tightening, sweat at hairline`,
      `Sentence rhythm: short punchy sentences (5-12 words) in action; longer in introspection.`,
      ``,
      `## CORRECTION PAIRS (study these — your output must match the GOOD style)`,
      examplesBlock,
      `"""`,
      ``,
      `PARAMETER temperature 0.85`,
      `PARAMETER top_p 0.95`,
      `PARAMETER top_k 64`,
      `PARAMETER repeat_penalty 1.05`,
      `PARAMETER num_ctx 32768`,
    );

    const modelfileString = modelfileContent.join('\n');

    // Write Modelfile to workspace (mounted volume, accessible from host)
    const modelfilePath = join(this.workspaceDir, 'perry.Modelfile');
    await writeFile(modelfilePath, modelfileString, 'utf-8');
    this.log.info('Auto-learning: Modelfile written', { path: modelfilePath, pairs: allPairs.length });

    // Copy into ollama container and rebuild model
    try {
      await execAsync(`docker cp "${modelfilePath}" ${OLLAMA_CONTAINER}:/root/perry.Modelfile`);
      await execAsync(`docker exec ${OLLAMA_CONTAINER} ollama create ${MODEL_NAME} -f /root/perry.Modelfile`);
      this.log.info('Auto-learning: perry-writer model rebuilt in Ollama', { passNumber });
    } catch (err) {
      // Ollama rebuild failing is non-fatal — next pass still runs on the previous model
      this.log.warn('Auto-learning: Ollama model rebuild failed (will retry next interval)', {
        error: (err as Error).message,
      });
    }
  }

  // ─── Fine-tune Flag ──────────────────────────────────────────────────────

  private async writeFinetuneFlag(pairCount: number, projectId?: string): Promise<void> {
    const outputDir = this.trainingPoolDir(projectId);
    const flagPath = join(outputDir, 'READY_TO_FINETUNE.flag');
    const sentinelPath = join(outputDir, '.last_finetune_threshold');

    // Determine the last threshold we already triggered at (default 0 = never)
    let lastTriggeredAt = 0;
    if (existsSync(sentinelPath)) {
      try {
        lastTriggeredAt = parseInt(await readFile(sentinelPath, 'utf-8'), 10) || 0;
      } catch { /* ignore */ }
    }

    // Only trigger if we have crossed a NEW 100-pair boundary since the last trigger
    const currentBucket = Math.floor(pairCount / FINETUNE_THRESHOLD) * FINETUNE_THRESHOLD;
    if (currentBucket <= lastTriggeredAt) {
      return; // Already triggered at or beyond this threshold
    }

    // Don't write the flag while the trainer is still running
    if (existsSync(join(this.workspaceDir, 'training', 'TRAINING_IN_PROGRESS.flag'))) {
      this.log.info('Auto-learning: fine-tune threshold reached but training already in progress — skipping flag', { pairCount });
      return;
    }

    await writeFile(flagPath, [
      `Calibration has accumulated ${pairCount} verified training pairs.`,
      `This meets the ${currentBucket}-pair threshold for LoRA fine-tuning.`,
      ``,
      `The perry-trainer container will automatically pick this up and start training.`,
      `The pipeline will pause until TRAINING_IN_PROGRESS.flag is removed.`,
      ``,
      `Generated: ${new Date().toISOString()}`,
    ].join('\n'), 'utf-8');

    // Record that we triggered at this bucket so we don't re-fire until the next +100
    await writeFile(sentinelPath, String(currentBucket), 'utf-8');

    this.log.info('Auto-learning: LoRA fine-tune threshold reached — flag written', { pairCount, bucket: currentBucket });
  }
}
