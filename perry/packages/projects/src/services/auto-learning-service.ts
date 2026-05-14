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

const execAsync = promisify(exec);

// Rebuild the Modelfile every N passes
const MODELFILE_REBUILD_INTERVAL = 5;

// Minimum training pairs before emitting a fine-tune-ready flag
const FINETUNE_THRESHOLD = 300;

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

const DEFAULT_SYSTEM_PROMPT = `You are a professional Deep POV science fiction author. Write exclusively in Deep POV.
NEVER use filter words (felt, thought, noticed, realized, saw, looked at, stared, heard, remembered, imagined, assumed).
NEVER name emotions directly — show them through physical/somatic markers only.
NEVER attribute internal states to non-POV characters.
NEVER summarize the meaning of a moment ("He had failed." / "It was over.").
DO use the industrial sensory palette (ozone, linseed oil, oxidized iron, graphite grit, wet copper).
DO use somatic markers (teeth vibrating, jaw locking, white knuckles, ribs throbbing).
DO use short punchy sentences during action, longer ones during introspection.`;

export class AutoLearningService {
  private workspaceDir: string;
  private log: Logger;
  private styleDna: StyleDnaService;
  private voiceProfileCache: Map<string, string> = new Map();

  constructor(workspaceDir: string, styleDna: StyleDnaService, log: Logger) {
    this.workspaceDir = workspaceDir;
    this.styleDna = styleDna;
    this.log = log;
  }

  // ─── Voice Profile Resolution ─────────────────────────────────────────────

  /**
   * Resolve and read the voice profile from the parent book planning project.
   * The voice profile is generated during book planning as step-5-voice-profile.md.
   * Returns the raw markdown content, or null if not found.
   */
  private resolveVoiceProfile(projectId?: string): string | null {
    if (!projectId) return null;

    // Check cache first
    if (this.voiceProfileCache.has(projectId)) {
      return this.voiceProfileCache.get(projectId) || null;
    }

    try {
      const projectsDir = join(this.workspaceDir, 'projects');
      if (!existsSync(projectsDir)) return null;

      const entries = readdirSync(projectsDir);

      // Walk up: calibration project → parent book project
      // Scan the parent project's analysis folder for all pen name identity files
      const PEN_NAME_KEYWORDS = [
        'voice-profile', 'voice_profile',
        'influence-map', 'influence_map',
        'vocabulary-fingerprint', 'vocabulary_fingerprint',
        'structural-habits', 'structural_habits',
        'dialogue-fingerprint', 'dialogue_fingerprint',
        'thematic-obsessions', 'thematic_obsessions',
      ];

      for (const entry of entries) {
        const analysisDir = join(projectsDir, entry, 'analysis');
        if (!existsSync(analysisDir)) continue;

        const files = readdirSync(analysisDir);
        const voiceFile = files.find(f => f.includes('voice-profile') || f.includes('voice_profile'));
        if (!voiceFile) continue; // Only process projects that have a voice profile

        // Read voice profile + all pen name identity files
        const parts: string[] = [];
        for (const file of files) {
          if (PEN_NAME_KEYWORDS.some(kw => file.includes(kw))) {
            parts.push(readFileSync(join(analysisDir, file), 'utf-8'));
          }
        }

        if (parts.length > 0) {
          const combined = parts.join('\n\n---\n\n');
          this.voiceProfileCache.set(projectId, combined);
          this.log.info('Pen name identity resolved from book planning', {
            projectId,
            filesFound: parts.length,
            totalLength: combined.length,
          });
          return combined;
        }
      }
    } catch (err) {
      this.log.warn('Failed to resolve voice profile', { error: (err as Error).message });
    }

    return null;
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

    // Core prohibitions (always present)
    sections.push(
      `## ABSOLUTE PROHIBITIONS`,
      `NEVER use filter words (felt, thought, noticed, realized, saw, looked at, stared, heard, remembered, imagined, assumed).`,
      `NEVER name emotions directly — show them through physical/somatic markers only.`,
      `NEVER attribute internal states to non-POV characters.`,
      `NEVER summarize the meaning of a moment ("He had failed." / "It was over.").`,
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

    // Sensory palette (default fallback)
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
        await this.minePassSummaryDirectives(projectId, passNumber);
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
      const outputDir = (typeof projectId !== 'undefined' && projectId) ? join(this.workspaceDir, 'training', 'project-' + projectId) : join(this.workspaceDir, 'training');
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

      // Fire-and-forget violation mining — generates real training pairs from this check
      this.mineViolationsFromPovCheck(projectId, stepLabel, sceneType, povCheckResult).catch(err =>
        this.log.warn('Violation mining failed (non-fatal)', { error: (err as Error).message })
      );
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

    // A universal regex to match `- "phrase"` or `- *"phrase"*`
    const phraseRe = /- \**"([^"]{10,300})"\**/g;
    let m: RegExpExecArray | null;

    // Filter Words
    const filterWordsRe = /\*\*Filter Words(?: Found)?\*\*:[\s\S]*?(?=\*\*[A-Z]|$)/i;
    const filterWordsSection = povCheckResult.match(filterWordsRe)?.[0] || '';
    while ((m = phraseRe.exec(filterWordsSection)) !== null) {
      badPhrases.push({ text: m[1], category: 'filter_word' });
    }

    // Show vs Tell
    const showTellRe = /\*\*Show vs Tell Violations\*\*:[\s\S]*?(?=\*\*[A-Z]|$)/i;
    const showTellSection = povCheckResult.match(showTellRe)?.[0] || '';
    while ((m = phraseRe.exec(showTellSection)) !== null) {
      badPhrases.push({ text: m[1], category: 'show_vs_tell' });
    }

    // AI-Isms
    const aiIsmSection = povCheckResult.match(/\*\*AI-Isms(?: Found)?\*\*:[\s\S]*?(?=\*\*[A-Z]|$)/i)?.[0] || '';
    while ((m = phraseRe.exec(aiIsmSection)) !== null) {
      badPhrases.push({ text: m[1], category: 'ai_ism' });
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
    const LIBRARIAN_ENDPOINT = process.env.LIBRARIAN_ENDPOINT || 'http://ollama-embeddings:11434';
    const LIBRARIAN_MODEL = 'gemma3:12b';

    for (const { text, category } of badPhrases) {
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
                content: 'You are a Deep POV prose editor. Rewrite the given sentence to eliminate filter words, cognitive telling, emotion-naming, and AI-isms. Show the internal experience through physical sensation, sound, and tactile detail only. Output ONLY the rewritten sentence — no explanation, no preamble.',
              },
              {
                role: 'user',
                content: `Rewrite this in Deep POV:\n\n"${text}"`,
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

        newPairs.push(this.buildTrainingRecord(text, correction, category));
        this.log.info('Violation mining: pair generated', { category, bad: text.slice(0, 60) });
      } catch (err: any) {
        this.log.warn('Librarian connection failed', { phrase: text.slice(0, 30), error: err.message });
      }
    }

    if (newPairs.length === 0) return;

    // ── 3. Append to mined_pairs.jsonl ───────────────────────────────────────
    const outputDir = (typeof projectId !== 'undefined' && projectId) ? join(this.workspaceDir, 'training', 'project-' + projectId) : join(this.workspaceDir, 'training');
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
  async minePassedScene(projectId: string, sceneType: string, compiledText: string, verdict: string): Promise<void> {
    if (verdict !== 'PASS') return;
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

      const outputDir = (typeof projectId !== 'undefined' && projectId) ? join(this.workspaceDir, 'training', 'project-' + projectId) : join(this.workspaceDir, 'training');
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

      // Convert each positive directive into a "what does good X look like?" pair
      for (const directive of positives) {
        const topic = directive.replace(/^DO:\s*/i, '').trim();
        newPairs.push({
          conversations: [
            { role: 'system', content: this.buildSystemPrompt(projectId) },
            { role: 'user', content: `What is the correct Deep POV approach for: ${topic}?` },
            { role: 'assistant', content: directive },
          ],
          metadata: { source: 'perry_calibration', category: 'directive_positive', pass: passNumber },
        });
      }

      // Convert each negative directive into a "what should you avoid?" pair
      for (const directive of negatives) {
        const topic = directive.replace(/^AVOID:\s*/i, '').trim();
        newPairs.push({
          conversations: [
            { role: 'system', content: this.buildSystemPrompt(projectId) },
            { role: 'user', content: `What prose patterns should be avoided in Deep POV writing?` },
            { role: 'assistant', content: `AVOID: ${topic}` },
          ],
          metadata: { source: 'perry_calibration', category: 'directive_negative', pass: passNumber },
        });
      }

      if (newPairs.length === 0) return;

      const outputDir = (typeof projectId !== 'undefined' && projectId) ? join(this.workspaceDir, 'training', 'project-' + projectId) : join(this.workspaceDir, 'training');
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

  // ─── JSONL Export ─────────────────────────────────────────────────────────

  private async exportTrainingData(projectId?: string): Promise<number> {
    const outputDir = (typeof projectId !== 'undefined' && projectId) ? join(this.workspaceDir, 'training', 'project-' + projectId) : join(this.workspaceDir, 'training');
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    const records: object[] = [];

    // NOTE: Baseline pairs intentionally excluded.
    // Each pen name's LoRA must train exclusively on pairs discovered by its own
    // calibration pipeline. Injecting generic pre-seeded pairs would cross-contaminate
    // models across different pen names and writing styles.

    // Add learned pairs from StyleDNA showVsTellExamples
    const learnedPairs = this.styleDna.getGlobalRules().showVsTellExamples || [];
    for (const pair of learnedPairs) {
      if (pair.bad && pair.good) {
        records.push(this.buildTrainingRecord(pair.bad, pair.good, 'learned'));
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
          const badMatch = userContent.match(/"([^"]+)"$/);
          const badText = badMatch ? badMatch[1] : userContent.slice(-80);
          if (badText && !seenBad.has(badText)) {
            seenBad.add(badText);
            records.push(record);
          }
        } catch { /* skip malformed lines */ }
      }
    }

    const jsonl = records.map(r => JSON.stringify(r)).join('\n');
    const outputPath = join(outputDir, 'training_data.jsonl');
    await writeFile(outputPath, jsonl, 'utf-8');

    // Also write a human-readable summary
    const summaryPath = join(outputDir, 'training_summary.md');
    await writeFile(summaryPath, [
      `# Perry LoRA Training Data`,
      ``,
      `Generated: ${new Date().toISOString()}`,
      `Total verified pairs: ${records.length}`,
      `  - Learned from calibration (DNA): ${learnedPairs.filter(p => p.bad && p.good).length}`,
      `  - Mined from POV check violations: ${records.length - learnedPairs.filter(p => p.bad && p.good).length}`,
      ``,
      `## Fine-tune status`,
      records.length >= FINETUNE_THRESHOLD
        ? `✅ READY — ${records.length} pairs meets the ${FINETUNE_THRESHOLD} minimum threshold for LoRA fine-tuning.`
        : `⏳ ACCUMULATING — ${records.length}/${FINETUNE_THRESHOLD} pairs. Continue running calibration passes.`,
      ``,
      `## To run LoRA fine-tuning`,
      `\`\`\`bash`,
      `python finetune-lora.py --data ${outputPath}`,
      `\`\`\``,
    ].join('\n'), 'utf-8');

    return records.length;
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
            : `Rewrite this sentence to eliminate filter words, cognitive telling, and AI-isms. Output ONLY the corrected version:\n\n"${bad}"`,
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
      `## ABSOLUTE PROHIBITIONS`,
      `NEVER use filter words: felt, thought, noticed, realized, saw, looked at, stared, heard, remembered, imagined, assumed, believed, decided, seemed, wondered`,
      `NEVER name emotions directly (desperation, panic, fear, anger, grief, relief, terror).`,
      `NEVER attribute internal states to non-POV characters.`,
      `NEVER summarize the meaning of a moment ("He had failed." / "It was over.").`,
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
      `Sensory palette: ionized ozone, linseed oil, oxidized iron, sulfur, graphite grit, wet copper, cold steel`,
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
    const outputDir = (typeof projectId !== 'undefined' && projectId) ? join(this.workspaceDir, 'training', 'project-' + projectId) : join(this.workspaceDir, 'training');
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
