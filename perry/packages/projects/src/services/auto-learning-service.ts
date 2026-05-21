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
import { WebhookEmitter } from './webhook-emitter.js';
import { UNIVERSAL_AI_ISM_PAIRS } from '../data/universal-ai-ism-pairs.js';
import { PEN_A_PERRY_PAIRS, PEN_A_PERRY_ANCHORS } from '../data/pen-a-perry-pairs.js';
import { scanLeaks, firstFailure } from '../voice-screens.js';

const execAsync = promisify(exec);

// Rebuild the Modelfile every N passes
const MODELFILE_REBUILD_INTERVAL = 5;

// Default minimum training pairs before emitting a fine-tune-ready flag.
// Overridable per-project via `project.context.minTrainingPairs`.
const FINETUNE_THRESHOLD_DEFAULT = 1000;

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

  // ─── Universal AI-ism baseline ───────────────────────────────────────────
  //
  // Every pen-name's training_data.jsonl is prepended with a curated set of
  // ~40 AI-ism → concrete-fix pairs (see data/universal-ai-ism-pairs.ts).
  // This ensures every fine-tuned LoRA learns to avoid the universally bad
  // LLM tells (chill down spine, tapestry of, in the blink of an eye, etc.)
  // regardless of genre.
  //
  // Per-pen opt-out: set meta['pen_config'][slug].disable_ai_ism_baseline=true
  // for genres that need to use these phrases deliberately.
  private isAiIsmBaselineDisabled(slug: string): boolean {
    if (!this.stateStore) return false;
    const raw = this.stateStore.getMeta('pen_config');
    if (!raw) return false;
    try {
      const cfg = JSON.parse(raw);
      return cfg?.[slug]?.disable_ai_ism_baseline === true;
    } catch {
      return false;
    }
  }

  // ─── Vocab-Diversity Gate ───────────────────────────────────────────────
  //
  // Tracks physical-action phrase frequency across accepted GOOD pairs. If a
  // new pair's GOOD reuses a phrase that already appears in >=5% of the pool,
  // reject — otherwise the model learns to use the same handful of physical
  // gestures (fists clenched, skin prickled, jaw tight) for every emotion.
  // Cold-start safe: skip when pool has fewer than 20 records.
  // Universal baseline pairs are NOT counted (they're the gold standard).
  private async checkVocabDiversity(goodText: string, projectId?: string): Promise<string | null> {
    const trainingPath = join(this.trainingPoolDir(projectId), 'training_data.jsonl');
    if (!existsSync(trainingPath)) return null;
    let pool: string[];
    try {
      pool = readFileSync(trainingPath, 'utf-8').split('\n').filter(l => l.trim());
    } catch { return null; }

    const PHRASE_RE = /\b(?:[A-Z][a-z]+'s\s+|[Hh]er\s+|[Hh]is\s+|[Tt]heir\s+|[Tt]he\s+)?(fists?|hands?|jaw|stomach|skin|chest|throat|eyes|fingers?|knuckles|shoulders|spine|nails|gaze|grip|breath|teeth|knees|lips|brow|temple|forehead|neck|gut)\s+(clenched|trembled|trembling|prickled|dropped|tightened|raced|caught|shook|shaking|stiffened|tensed|sagged|coiled|twitched|curled|hardened|softened|dug|digging|drummed|narrowed|widened|lifted|locked|set|hammered|pounded|throbbed|pulsed|fluttered)\b/gi;

    const freq = new Map<string, number>();
    let countedRecords = 0;
    for (const line of pool) {
      try {
        const rec = JSON.parse(line);
        if (rec?.metadata?.source === 'perry_baseline_universal') continue;
        const good = rec?.conversations?.find?.((c: any) => c.role === 'assistant')?.content || '';
        countedRecords++;
        const seen = new Set<string>();
        for (const m of good.matchAll(PHRASE_RE)) {
          const norm = `${m[1].toLowerCase()} ${m[2].toLowerCase()}`;
          if (!seen.has(norm)) {
            seen.add(norm);
            freq.set(norm, (freq.get(norm) || 0) + 1);
          }
        }
      } catch { /* skip malformed */ }
    }
    if (countedRecords < 20) return null;

    const seen = new Set<string>();
    for (const m of goodText.matchAll(PHRASE_RE)) {
      const norm = `${m[1].toLowerCase()} ${m[2].toLowerCase()}`;
      if (seen.has(norm)) continue;
      seen.add(norm);
      const count = freq.get(norm) || 0;
      const ratio = count / countedRecords;
      if (ratio >= 0.05) {
        return `vocab_overuse:"${norm}":${count}/${countedRecords}(${(ratio * 100).toFixed(0)}%)`;
      }
    }
    return null;
  }

  // ─── Paragraph-Level Auto-Promotion to Voice Anchors ────────────────────
  //
  // When a draft_compile step completes, split the scene into paragraphs and
  // score each on v2-harvest voice-strength criteria. Score-7+ paragraphs
  // get auto-added to the pen-name's voice_anchors meta as positive training
  // anchors. Runs regardless of overall POV check verdict — a REWRITE scene
  // can still contain voice-strong paragraphs worth keeping.
  //
  // Idempotent: skips paragraphs whose prose already exists as an anchor.
  // Auto-promoted anchors get weight 2.0 (vs user-curated 3.0) so curated
  // anchors stay influential.
  async promoteParagraphsToAnchors(projectId: string, compiledText: string): Promise<number> {
    if (!this.stateStore) return 0;
    const slug = this.resolvePenSlug(projectId);
    if (!slug || slug === DEFAULT_PEN_SLUG) return 0;

    const cleaned = compiledText
      .replace(/<\/?response>/gi, '')
      .replace(/\[CONTENT WARNING[\s\S]*?\][\s\S]*?(?=\n\n|$)/g, '')
      .trim();
    const paras = cleaned.split(/\n\s*\n+/).map(p => p.trim()).filter(p => p.length >= 80);
    if (paras.length === 0) return 0;

    const existingRaw = this.stateStore.getMeta(`voice_anchors_${slug}`);
    const existing: any[] = existingRaw ? (() => {
      try { return JSON.parse(existingRaw); } catch { return []; }
    })() : [];
    const existingProse = new Set(existing.map(a => a?.prose).filter(Boolean));

    let added = 0;
    for (const para of paras) {
      if (this.fastQualityScan(para)) continue;
      const quoteChars = (para.match(/"[^"]*"|'[^']*'/g) || []).join('').length;
      if (quoteChars / para.length > 0.7) continue;
      if (existingProse.has(para)) continue;

      const score = this.scoreVoiceParagraph(para);
      if (score < 7) continue;

      const wc = para.split(/\s+/).length;
      const anchor = {
        id: 'anchor-auto-' + Math.random().toString(36).slice(2, 10),
        slug,
        tier: wc <= 30 ? 'sentence' : wc <= 200 ? 'paragraph' : 'scene_segment',
        sourceAttribution: `auto-promoted from calibration ${projectId} (score=${score})`,
        sourceType: 'self_approved',
        sceneType: null,
        voiceTags: ['auto_promoted'],
        prose: para,
        wordCount: wc,
        weight: 2.0,
        createdAt: new Date().toISOString(),
        active: true,
      };
      existing.push(anchor);
      existingProse.add(para);
      added++;
    }

    if (added > 0) {
      this.stateStore.setMeta(`voice_anchors_${slug}`, JSON.stringify(existing));
      this.log.info('Paragraph anchors auto-promoted', { slug, added, totalAnchors: existing.length });
    }
    return added;
  }

  // Compact voice-strength score (0-12). Mirrors the v2 harvest scoring in
  // scripts/harvest-voice-paragraphs-v2.cjs so live promotion uses the same
  // criteria as offline harvesting.
  private scoreVoiceParagraph(text: string): number {
    let score = 0;
    const sentences = text.split(/[.!?]+\s+/).filter(s => s.trim().length > 3);
    if (sentences.length >= 3) {
      const lengths = sentences.map(s => s.split(/\s+/).length);
      const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const variance = lengths.reduce((acc, l) => acc + (l - mean) ** 2, 0) / lengths.length;
      if (variance > 12) score += 2;
      else if (variance > 6) score += 1;
      if (lengths.some(l => l < 5)) score += 1;
    }
    const CONCRETE_RE = /\b(?:door|window|wall|floor|chair|table|hand|eye|finger|screen|panel|stylus|console|server|terminal|avatar|street|room|corridor|elevator|monitor|cable|wire|edge|surface|key|button|lock|crack|stain|smear|drop|crumb|grain|thread|shard|chip|spark|hum|click|hiss|crackle|whir|coffee|stale|ozone|metallic|copper|girder|circuit|capacitor|relay|scanner|biometric|holo|implant|jack|substrate|fragment|register|kernel|packet|payload|daemon|signal|bandwidth|firewall|gateway|port|socket|byte|pixel|static|glitch|protocol|breach|node|encrypt|decrypt|drift|sever|constellate|reaper|holographic|datastream)\b/gi;
    const concreteHits = (text.match(CONCRETE_RE) || []).length;
    const totalWords = text.split(/\s+/).length;
    if (totalWords > 0) {
      const ratio = concreteHits / totalWords;
      if (ratio > 0.10) score += 3;
      else if (ratio > 0.06) score += 2;
      else if (ratio > 0.04) score += 1;
    }
    if (/\b(?:smelled\s+of|smelled\s+like|tasted\s+(?:of|like)|air\s+(?:thick|heavy|stale|sterile)|the\s+(?:hum|drone|whine|click|hiss|crackle)\s+of)/i.test(text)) score += 2;
    if (/\b(?:avatar|substrate|server|circuit|firewall|protocol|breach|node|byte|pixel|static|glitch|terminal|interface|drift|sever|constellate|reaper|holographic|datastream|holo|HUD|exploit|daemon|kernel|payload|implant|prosthetic|cybernetic|render|parse)\b/i.test(text)) score += 1;
    const RECYCLED_RE = /\b(?:[A-Z][a-z]+'s\s+|her\s+|his\s+|their\s+)?(?:fists?|hands?|jaw|stomach|skin|chest|throat|eyes|fingers?|pulse|breath|knuckles|shoulders|spine|nails)\s+(?:clenched|trembled|trembling|prickled|dropped|tightened|raced|caught|shook|shaking|stiffened|tensed|coiled|twitched|curled|dug|drummed)\b/i;
    if (!RECYCLED_RE.test(text)) score += 1;
    const INANIMATE_RE = /\b(?:screen|terminal|console|server|code|data|monitor|cable|circuit|signal|firewall|substrate|avatar|kernel|daemon|stream|render|pixel|polygon|latency)\s+(?:breathed|stuttered|whispered|sighed|hesitated|bled|wept|cried|sang|murmured|coughed|paused|blinked|winked|smiled|grinned|stretched)/i;
    if (INANIMATE_RE.test(text)) score += 2;
    if (/—|--/.test(text)) score += 1;
    return score;
  }

  private buildUniversalBaselineRecords(projectId?: string): object[] {
    const slug = projectId ? this.resolvePenSlug(projectId) : DEFAULT_PEN_SLUG;
    if (this.isAiIsmBaselineDisabled(slug)) {
      this.log.info('Universal AI-ism baseline disabled for pen', { slug });
      return [];
    }
    const systemPrompt = this.buildSystemPrompt(projectId);
    return UNIVERSAL_AI_ISM_PAIRS.map(p => ({
      conversations: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Rewrite this sentence to eliminate filter words, cognitive telling, and AI-isms. Output ONLY the corrected version. CRITICAL: Do NOT use repetitive LLM verbs like "bloomed", "shuddered", "slithered", or "resonated". Use sharp, varied physical verbs:\n\n"${p.bad}"`,
        },
        { role: 'assistant', content: p.good },
      ],
      metadata: {
        source: 'perry_baseline_universal',
        category: 'ai_ism_universal',
        family: p.family,
        pen: slug,
      },
    }));
  }

  // ─── Pen-specific baseline (a-perry: Digital Drift series) ──────────────
  //
  // Same shape as buildUniversalBaselineRecords but loads pairs only when the
  // calibration project belongs to a pen-name that has a curated baseline
  // file. Currently only 'a-perry' has one (30 pairs in
  // data/pen-a-perry-pairs.ts). Adding a new pen-name's baseline is a matter
  // of creating the data file + extending this switch.
  private buildPenSpecificBaselineRecords(projectId?: string): object[] {
    const slug = projectId ? this.resolvePenSlug(projectId) : DEFAULT_PEN_SLUG;
    if (this.isAiIsmBaselineDisabled(slug)) return [];

    let pairs: ReadonlyArray<{ bad: string; good: string; category: string }> | null = null;
    if (slug === 'a-perry') pairs = PEN_A_PERRY_PAIRS;
    if (!pairs) return [];

    const systemPrompt = this.buildSystemPrompt(projectId);
    return pairs.map(p => ({
      conversations: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Rewrite this sentence to eliminate filter words, cognitive telling, and AI-isms. Output ONLY the corrected version. CRITICAL: Do NOT use repetitive LLM verbs like "bloomed", "shuddered", "slithered", or "resonated". Use sharp, varied physical verbs:\n\n"${p.bad}"`,
        },
        { role: 'assistant', content: p.good },
      ],
      metadata: {
        source: `perry_baseline_${slug}`,
        category: p.category,
        pen: slug,
      },
    }));
  }

  /**
   * Build training records from claude_injected.jsonl — pairs added by an
   * external assistant (via MCP) that should be treated as curated baseline
   * (i.e. bypass the three-gate pipeline). Each line in claude_injected.jsonl
   * is `{ bad, good, category, injected_at }`.
   */
  private async buildClaudeInjectedRecords(projectId?: string, fallbackPenSlug?: string): Promise<object[]> {
    const dir = this.trainingPoolDir(projectId, fallbackPenSlug);
    const path = join(dir, 'claude_injected.jsonl');
    if (!existsSync(path)) return [];
    const slug = projectId ? this.resolvePenSlug(projectId) : (fallbackPenSlug || DEFAULT_PEN_SLUG);
    const systemPrompt = this.buildSystemPrompt(projectId);
    try {
      const content = await readFile(path, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      const records: object[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (!entry?.bad || !entry?.good) continue;
          // Long-form task types (long_form_scene, length_following) carry their
          // user prompt VERBATIM in entry.bad — do not wrap in the rewrite template.
          // _fill_manifest.py enqueues these; perry-worker.md tells workers to put
          // the user_prompt_verbatim into the bad field.
          const isLongform = entry.task_type === 'long_form_scene'
            || entry.task_type === 'length_following'
            || entry.task_type === 'long_form_chunk';
          if (isLongform) {
            records.push({
              conversations: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: entry.bad },
                { role: 'assistant', content: entry.good },
              ],
              metadata: {
                source: `perry_longform_${entry.task_type}_${slug}`,
                category: entry.category || entry.task_type,
                pen: slug,
                injected_at: entry.injected_at || null,
                target_words: entry.target_words ?? null,
              },
            });
            continue;
          }
          records.push({
            conversations: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: `Rewrite this sentence to eliminate filter words, cognitive telling, and AI-isms. Output ONLY the corrected version. CRITICAL: Do NOT use repetitive LLM verbs like "bloomed", "shuddered", "slithered", or "resonated". Use sharp, varied physical verbs:\n\n"${entry.bad}"`,
              },
              { role: 'assistant', content: entry.good },
            ],
            metadata: {
              source: `perry_baseline_claude_assisted_${slug}`,
              category: entry.category || 'claude_injected',
              pen: slug,
              injected_at: entry.injected_at || null,
            },
          });
        } catch { /* skip malformed line */ }
      }
      return records;
    } catch (err) {
      this.log.warn('Failed to read claude_injected.jsonl', { error: (err as Error).message });
      return [];
    }
  }

  /**
   * MCP-facing: append a single Claude-curated pair to claude_injected.jsonl
   * for the given pen. The pair is included in the next export as a trusted
   * baseline record (no gating). The file path is keyed by pen-slug, matching
   * how the rest of the training pool is laid out.
   */
  public async appendClaudeInjectedPairForPen(
    slug: string,
    bad: string,
    good: string,
    category: string,
  ): Promise<{ path: string; totalLines: number }> {
    const dir = join(this.workspaceDir, 'training', `pen-${slug}`);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const path = join(dir, 'claude_injected.jsonl');
    const entry = JSON.stringify({ bad, good, category, injected_at: new Date().toISOString() });
    await appendFile(path, entry + '\n', 'utf-8');
    let totalLines = 0;
    try {
      const content = await readFile(path, 'utf-8');
      totalLines = content.split('\n').filter(l => l.trim()).length;
    } catch { /* ignore */ }
    return { path, totalLines };
  }

  /**
   * MCP-facing wrapper around the private exportTrainingData. Looks up the
   * most-recent style-calibration project for the pen and exports using that
   * project's pool. If no calibration project exists, exports against the
   * pen-slug pool directly (`pen-{slug}/...`) so claude_injected.jsonl + the
   * mined_pairs.jsonl colocated with the pen still flow into training_data.jsonl.
   * This makes the "hours-not-days" worker-driven flow (no calibration project)
   * work end-to-end via `/perry-train-now`.
   */
  public async exportForPen(slug: string): Promise<number> {
    let projectId: string | undefined;
    if (this.stateStore) {
      const projects = this.stateStore.list().filter(p =>
        p.type === 'style-calibration' && p.context?.penNameSlug === slug
      );
      if (projects.length > 0) {
        // Most recent first (createdAt fallback to id ordering — calibrations
        // are short-lived so any of them shares the same pool anyway).
        projects.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        projectId = projects[0].id;
      }
    }
    return this.exportTrainingData(projectId, slug);
  }

  // Idempotent merge: copies pen-specific curated anchors into the
  // voice_anchors_{slug} meta key. Skips any anchor whose prose already
  // exists in the pool (so it's safe to call repeatedly). Returns the
  // number of NEW anchors added.
  private mergePenSpecificAnchors(projectId?: string): number {
    if (!this.stateStore || !projectId) return 0;
    const slug = this.resolvePenSlug(projectId);
    if (slug !== 'a-perry') return 0;

    const existingRaw = this.stateStore.getMeta(`voice_anchors_${slug}`);
    const existing: any[] = existingRaw ? (() => {
      try { return JSON.parse(existingRaw); } catch { return []; }
    })() : [];
    const existingProse = new Set(existing.map(a => a?.prose).filter(Boolean));

    let added = 0;
    for (let i = 0; i < PEN_A_PERRY_ANCHORS.length; i++) {
      const a = PEN_A_PERRY_ANCHORS[i];
      if (existingProse.has(a.prose)) continue;
      const wc = a.prose.split(/\s+/).length;
      existing.push({
        id: `anchor-${slug}-curated-${String(i).padStart(2, '0')}`,
        slug,
        tier: wc <= 30 ? 'sentence' : wc <= 200 ? 'paragraph' : 'scene_segment',
        sourceAttribution: `perry curated baseline (${slug}) #${i + 1}`,
        sourceType: 'self_approved',
        sceneType: a.sceneType,
        voiceTags: a.voiceTags,
        prose: a.prose,
        wordCount: wc,
        weight: 3.0,
        createdAt: new Date().toISOString(),
        active: true,
      });
      added++;
    }
    if (added > 0) {
      this.stateStore.setMeta(`voice_anchors_${slug}`, JSON.stringify(existing));
      this.log.info('Pen-specific curated anchors merged', { slug, added, total: existing.length });
    }
    return added;
  }

  // Returns the training pool directory for a given project, keyed by pen slug.
  // Falls back to `<workspace>/training` when no projectId is supplied — matches
  // legacy behavior so summary writes still have a home.
  private trainingPoolDir(projectId?: string, fallbackSlug?: string): string {
    if (projectId) {
      const slug = this.resolvePenSlug(projectId);
      return join(this.workspaceDir, 'training', `pen-${slug}`);
    }
    // exportForPen passes a slug fallback so the worker-driven path lands in
    // pen-{slug}/ rather than the workspace-level training/ root.
    if (fallbackSlug) {
      return join(this.workspaceDir, 'training', `pen-${fallbackSlug}`);
    }
    return join(this.workspaceDir, 'training');
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
      // Per-project threshold override: lets a calibration project specify
      // ctx.minTrainingPairs to fire fine-tuning earlier (e.g. fresh pen
      // names training on 200 pairs instead of waiting for 1000).
      const threshold = this.resolveFinetuneThreshold(projectId);

      // 0. If the project has claudeCollectionEnabled, drain completed
      // worker tasks from task_pool into claude_injected.jsonl BEFORE export
      // so parallel-worker contributions are baked into THIS pass's pool.
      // Hands-off: no separate cron required, drains happen automatically.
      if (projectId && this.isClaudeCollectionEnabled(projectId)) {
        await this.drainWorkerResults(projectId);
      }

      // 1. Ingest negative-pair JSON outputs from the new mining steps
      // BEFORE exporting, so the new pairs go through dedup + quality gates.
      if (projectId) await this.ingestNegativePairMining(projectId);

      // 2. Export training JSONL
      const pairCount = await this.exportTrainingData(projectId);

      this.log.info('Auto-learning: training data exported', {
        passNumber,
        verifiedPairs: pairCount,
        threshold,
        finetuneReady: pairCount >= threshold,
      });

      // 3. Every N passes — rebuild Modelfile and recreate Ollama model
      if (passNumber > 0 && passNumber % MODELFILE_REBUILD_INTERVAL === 0) {
        this.log.info('Auto-learning: Modelfile rebuild bypassed (managed by Trainer now)', { passNumber });
        // await this.rebuildModelfile(passNumber);
      }

      // 4. When threshold is hit — write a flag file for the trainer to pick up
      if (pairCount >= threshold) {
        await this.writeFinetuneFlag(pairCount, projectId, threshold);
      }

      // 4. Auto-ban AI-isms that repeat across 3+ consecutive passes
      await this.autoBanRepeatedAiIsms();

      // 5. Mine pass-level summary directives as structured training records
      if (projectId) {
        // Fire-and-forget summary directive mining
        // DISABLED: Generating unchecked training pairs from summaries.
        // await this.minePassSummaryDirectives(projectId, passNumber);
      }

      // 6. If the project is set up for Claude-Assisted Pair Collection,
      // top up the worker task_pool so /perry-worker chats always have
      // something to do during the NEXT pass. The actual generation
      // happens in user-spawned worker chats; we just keep the queue full
      // so the loop is fully hands-off.
      if (projectId && this.isClaudeCollectionEnabled(projectId)) {
        await this.topUpWorkerQueue(projectId);
      }

    } catch (err) {
      // Non-fatal — don't let learning failure break the calibration run
      this.log.warn('Auto-learning step failed (non-fatal)', { error: (err as Error).message });
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Worker-pool integration (Claude-Assisted Pair Collection)
  // ───────────────────────────────────────────────────────────────────────

  /** True when the project has the "Claude-Assisted Pair Collection" flag set. */
  private isClaudeCollectionEnabled(projectId: string): boolean {
    if (!this.stateStore) return false;
    const p = this.stateStore.get(projectId);
    return !!(p?.context as any)?.claudeCollectionEnabled;
  }

  // ── Voice fingerprint (pen-name muscle-memory guardrail) ─────────────
  // Computed once per pen-slug from voice_paragraphs_v2.jsonl. Each worker
  // pair's `good` is scored against this fingerprint at drain time; outliers
  // are rejected so synthetic Claude-Deep-POV can't drift the pen's voice
  // away from the curated prose anchors over hundreds of iterations.

  private voiceFingerprintCache = new Map<string, VoiceFingerprint>();

  private getVoiceFingerprint(slug: string): VoiceFingerprint | null {
    if (this.voiceFingerprintCache.has(slug)) {
      return this.voiceFingerprintCache.get(slug)!;
    }
    const path = join(this.workspaceDir, 'training', `pen-${slug}`, 'voice_paragraphs_v2.jsonl');
    if (!existsSync(path)) return null;
    try {
      const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim());
      const samples: number[][] = [];
      for (const line of lines) {
        try {
          const d = JSON.parse(line);
          if ((d.score || 0) < 5) continue; // only mid-to-top tier prose
          const text = String(d.text || '');
          if (text.length < 30) continue;
          const m = textMetrics(text);
          samples.push([m.meanSentenceLen, m.stdSentenceLen, m.adverbDensity, m.contractionRate]);
        } catch { /* skip */ }
      }
      if (samples.length < 20) {
        this.log.warn('Voice fingerprint: too few samples', { slug, samples: samples.length });
        return null;
      }
      const fp: VoiceFingerprint = {
        meanSentenceLenMu:   mean(samples.map(s => s[0])),
        meanSentenceLenSigma: stddev(samples.map(s => s[0])),
        stdSentenceLenMu:     mean(samples.map(s => s[1])),
        stdSentenceLenSigma:  stddev(samples.map(s => s[1])),
        adverbDensityMu:      mean(samples.map(s => s[2])),
        adverbDensitySigma:   stddev(samples.map(s => s[2])),
        contractionRateMu:    mean(samples.map(s => s[3])),
        contractionRateSigma: stddev(samples.map(s => s[3])),
        sampleCount: samples.length,
      };
      this.voiceFingerprintCache.set(slug, fp);
      this.log.info('Voice fingerprint computed', { slug, ...fp });
      return fp;
    } catch (err) {
      this.log.warn('Voice fingerprint load failed', { slug, error: (err as Error).message });
      return null;
    }
  }

  /**
   * Score a candidate good-text against the pen's fingerprint. Returns
   * { ok, reason, score } where score is the maximum z-distance across all
   * tracked metrics (lower is better; threshold defaults to 2.5σ).
   */
  private voiceMatch(text: string, fp: VoiceFingerprint, threshold: number = 1.5): { ok: boolean; reason?: string; score: number } {
    const m = textMetrics(text);
    const zs: Array<[string, number]> = [
      ['meanSentenceLen', Math.abs(m.meanSentenceLen - fp.meanSentenceLenMu) / Math.max(fp.meanSentenceLenSigma, 1)],
      ['stdSentenceLen',  Math.abs(m.stdSentenceLen  - fp.stdSentenceLenMu ) / Math.max(fp.stdSentenceLenSigma,  1)],
      ['adverbDensity',   Math.abs(m.adverbDensity   - fp.adverbDensityMu  ) / Math.max(fp.adverbDensitySigma, 0.005)],
    ];
    let worst: [string, number] = ['', 0];
    for (const z of zs) if (z[1] > worst[1]) worst = z;
    const ok = worst[1] <= threshold;
    return {
      ok,
      score: worst[1],
      reason: ok ? undefined : `voice_drift:${worst[0]}_z=${worst[1].toFixed(2)}`,
    };
  }

  /**
   * Drain every `done` task from task_pool whose pen matches this project
   * and append the worker's bad/good output into claude_injected.jsonl.
   * Then mark each task `archived` so it isn't re-injected. Runs every
   * pass when claudeCollectionEnabled is on.
   *
   * Mirrors the standalone _collect_worker_results.py script but lives in
   * the pipeline so calibration is fully hands-off — no separate cron.
   */
  private async drainWorkerResults(projectId: string): Promise<number> {
    if (!this.stateStore) return 0;
    const slug = this.resolvePenSlug(projectId);
    const dir = this.trainingPoolDir(projectId);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const path = join(dir, 'claude_injected.jsonl');

    // Build a dedup set from the current file so re-runs are idempotent.
    const seen = new Set<string>();
    if (existsSync(path)) {
      try {
        const content = await readFile(path, 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line);
            seen.add(`${(d.bad || '').trim()}||${(d.good || '').trim()}`);
          } catch { /* skip */ }
        }
      } catch { /* ignore */ }
    }

    const tasks = this.stateStore.listTasks({ status: 'done', limit: 500 });
    let written = 0;
    let voiceRejected = 0;
    let leakRejected = 0;
    const archived: string[] = [];
    const voiceFailed: string[] = [];
    const leakFailed: Array<{ id: string; reason: string }> = [];
    const fingerprint = this.getVoiceFingerprint(slug);
    const now = new Date().toISOString();
    for (const t of tasks) {
      if (t.penSlug && t.penSlug !== slug) continue;
      const r = (t.result || {}) as any;
      const bad = (r.bad || '').trim();
      const good = (r.good || '').trim();
      if (!bad || !good || bad.split(/\s+/).length < 8 || good.split(/\s+/).length < 8) {
        archived.push(t.id);
        continue;
      }
      const key = `${bad}||${good}`;
      if (seen.has(key)) {
        archived.push(t.id);
        continue;
      }
      // Voice-match + leak guardrails — synth pairs only. degrade_pair good is
      // verbatim from voice_paragraphs_v2.jsonl so it inherits the pen voice
      // by source and is the gold corpus the leak screen was calibrated on
      // (running it against degrade_pair would self-reject the curated anchors).
      if (t.type !== 'degrade_pair') {
        if (fingerprint) {
          const vm = this.voiceMatch(good, fingerprint);
          if (!vm.ok) {
            voiceFailed.push(t.id);
            voiceRejected++;
            continue;
          }
        }
        // Leak gate: bare filter verbs, named emotions, anti-patterns. Zero-
        // tolerance — any hit fails the pair so contaminated synth never enters
        // the training pool. Closes the gap that let v3 ship "thought clearer".
        const leaks = scanLeaks(good);
        if (leaks.length > 0) {
          const reason = leaks
            .slice(0, 3)
            .map(l => `${l.tag}:${l.matches[0]}`)
            .join(',');
          leakFailed.push({ id: t.id, reason });
          leakRejected++;
          continue;
        }
      }
      seen.add(key);
      const entry = {
        bad,
        good,
        category: r.category || `worker_${t.type}`,
        injected_at: now,
        source: r.source || `worker:${t.type}:${t.id}`,
        task_type: t.type,
        scene_type: r.scene_type || null,
        stat_band: r.stat_band || null,
      };
      await appendFile(path, JSON.stringify(entry) + '\n', 'utf-8');
      archived.push(t.id);
      written++;
    }

    // Bulk-archive accepted tasks; voice-drift + leak-fail get marked failed
    // with a specific reason so /api/system/workers triage can show them.
    if (archived.length > 0) {
      this.stateStore.archiveDoneTasks(archived);
    }
    for (const id of voiceFailed) {
      this.stateStore.reportTask(id, 'failed', undefined, 'voice_drift');
    }
    for (const { id, reason } of leakFailed) {
      this.stateStore.reportTask(id, 'failed', undefined, `leak:${reason}`);
    }

    if (written > 0 || voiceRejected > 0 || leakRejected > 0) {
      this.log.info('Worker results drained into claude_injected.jsonl', {
        pen: slug,
        injected: written,
        archived: archived.length,
        voiceRejected,
        leakRejected,
      });
    }
    return written;
  }

  /**
   * Push synthesize_pair + targeted_negative tasks for workers to chew on.
   * Triggered at the END of each calibration pass so the queue is full for
   * the next pass. Maintains a soft target depth — won't overshoot.
   */
  private async topUpWorkerQueue(projectId: string): Promise<void> {
    if (!this.stateStore) return;
    const slug = this.resolvePenSlug(projectId);
    const TARGET_OPEN = 60; // Soft target — workers will drain faster than this
    const depth = this.stateStore.queueDepth();
    const open = depth.open || 0;
    if (open >= TARGET_OPEN) return;
    const deficit = TARGET_OPEN - open;
    const nSynth = Math.ceil(deficit * 0.75);
    const nNegative = deficit - nSynth;

    const synthPayloads = Array.from({ length: nSynth }, () => this.makeSynthPayload());
    if (synthPayloads.length > 0) {
      this.stateStore.enqueueTasks('synthesize_pair', synthPayloads, slug);
    }

    const negPayloads = this.makeTargetedNegativePayloads(projectId, nNegative);
    if (negPayloads.length > 0) {
      this.stateStore.enqueueTasks('targeted_negative', negPayloads, slug);
    }

    this.log.info('Worker queue topped up', {
      pen: slug,
      synth_added: synthPayloads.length,
      negative_added: negPayloads.length,
      new_open_estimate: open + synthPayloads.length + negPayloads.length,
    });
  }

  private makeSynthPayload(): object {
    const sceneTypes = ['Action', 'Dialogue', 'Introspection', 'Setting', 'Confrontation', 'Discovery', 'Quiet', 'Group Dynamics'];
    const statBands = ['Peak', 'Stable', 'Stressed', 'Critical'];
    const antiPatterns = [
      'filter words + named emotion as noun',
      'AI clichés (jaw clenched, knuckles whitened, breath hitched)',
      'repetitive sentence structure',
      'watered-down passive verbs',
      'thematic summary at end',
    ];
    const scene = sceneTypes[Math.floor(Math.random() * sceneTypes.length)];
    const band = statBands[Math.floor(Math.random() * statBands.length)];
    const ap = antiPatterns[Math.floor(Math.random() * antiPatterns.length)];
    return {
      instructions: 'Generate ONE Deep POV training pair. Bad = typical LLM anti-patterns. Good = clean rewrite of the same scene. Both 25-55 words.',
      scene_type: scene,
      stat_band: band,
      anti_pattern_focus: ap,
      pen_voice: 'A.Perry / The Digital Drift — sci-fi techno-noir lyrical. Past tense, close third-person. Substrate / servers / neural links. Short fragments during action; longer flowing in introspection.',
      rules: [
        `Bad MUST exhibit ${ap}.`,
        'Good MUST NOT use filter words, named emotions, first-person, AI clichés, or repetitive structure.',
        'Third-person past tense ONLY.',
        'Output JSON only — keys: bad, good, category, scene_type, stat_band.',
      ],
    };
  }

  private makeTargetedNegativePayloads(projectId: string, count: number): object[] {
    if (count <= 0) return [];
    const slug = this.resolvePenSlug(projectId);
    const logPath = join(this.workspaceDir, 'training', `pen-${slug}`, 'rejected_pairs.log');
    if (!existsSync(logPath)) return [];
    let raw = '';
    try { raw = readFileSync(logPath, 'utf-8'); } catch { return []; }
    const patterns = new Set<string>();
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#') || !s.includes(':')) continue;
      const head = s.substring(0, s.lastIndexOf(':'));
      if (head.length >= 5) patterns.add(head);
      if (patterns.size >= count) break;
    }
    const out: object[] = [];
    for (const p of Array.from(patterns).slice(0, count)) {
      out.push({
        instructions: 'A previous worker output was rejected for the pattern below. Write ONE training pair that targets this exact failure: bad = a sentence exhibiting this pattern, good = a clean Deep POV rewrite of the same idea.',
        rejected_pattern: p,
        pen_voice: 'A.Perry / The Digital Drift — sci-fi techno-noir lyrical. Past tense, close third-person.',
        rules: [
          'Bad must clearly exhibit the rejected pattern.',
          'Good must be Deep POV: no filter words, no named emotions, no AI clichés.',
          'Output JSON only — keys: bad, good, category, rejected_pattern.',
        ],
      });
    }
    return out;
  }

  // ── Cold-start calibration ────────────────────────────────────────────────
  //
  // One-shot bootstrap for a brand-new pen-name: enqueues a balanced batch of
  // `synthesize_pair` tasks across the full (scene_type × stat_band ×
  // anti_pattern_focus) cartesian so the swarm can drain it in parallel and
  // produce a balanced training pool — no skew toward any single combination
  // (which v4 of a-perry suffered from, ~75% Critical/Introspection).
  //
  // Workers are the existing `synthesize_pair` consumers (headless-worker.cjs
  // or /perry-worker Claude sessions); drainWorkerResults handles routing
  // results into claude_injected.jsonl, then exportForPen produces the final
  // training_data.jsonl.
  public startCalibration(slug: string, targetPairs = 600): {
    slug: string;
    enqueued: number;
    perCell: number;
    scenes: string[];
    statBands: string[];
    antiPatterns: string[];
    penVoice: string;
    queueDepthAfter: Record<string, number>;
  } {
    if (!this.stateStore) throw new Error('state store unavailable');
    if (!slug || !slug.trim()) throw new Error('pen slug required');
    if (!Number.isFinite(targetPairs) || targetPairs < 1) targetPairs = 600;

    const scenes = ['Action', 'Dialogue', 'Introspection', 'Setting', 'Confrontation', 'Discovery', 'Quiet', 'Group Dynamics'];
    const statBands = ['Peak', 'Stable', 'Stressed', 'Critical'];
    const antiPatterns = [
      'filter words + named emotion as noun',
      'AI clichés (jaw clenched, knuckles whitened, breath hitched)',
      'repetitive sentence structure',
      'watered-down passive verbs',
      'thematic summary at end',
    ];

    const cells = scenes.length * statBands.length * antiPatterns.length;
    const perCell = Math.max(1, Math.ceil(targetPairs / cells));
    const penVoice = this.buildPenVoiceString(slug);

    const payloads: object[] = [];
    for (const scene of scenes) {
      for (const band of statBands) {
        for (const ap of antiPatterns) {
          for (let i = 0; i < perCell; i++) {
            payloads.push({
              instructions: 'Generate ONE Deep POV training pair. Bad = typical LLM anti-patterns. Good = clean rewrite of the same scene. Both 25-55 words.',
              scene_type: scene,
              stat_band: band,
              anti_pattern_focus: ap,
              pen_voice: penVoice,
              rules: [
                `Bad MUST exhibit ${ap}.`,
                'Good MUST NOT use filter words, named emotions, first-person, AI clichés, or repetitive structure.',
                'Third-person past tense ONLY.',
                'Output JSON only — keys: bad, good, category, scene_type, stat_band.',
              ],
              calibration_run: true,
            });
          }
        }
      }
    }

    this.stateStore.enqueueTasks('synthesize_pair', payloads, slug);
    this.log.info('Cold-start calibration enqueued', { slug, count: payloads.length, perCell });

    const summary = {
      slug,
      enqueued: payloads.length,
      perCell,
      scenes,
      statBands,
      antiPatterns,
      penVoice,
      queueDepthAfter: this.stateStore.queueDepth(),
    };
    WebhookEmitter.emit('calibration.started', summary);
    return summary;
  }

  // Build the pen_voice string injected into every calibration payload. Reads
  // the pen record from state (set during pen creation) and falls back to a
  // slug-only default so a brand-new pen still gets a usable payload.
  private buildPenVoiceString(slug: string): string {
    const rec = this.findPenRecord(slug);
    if (!rec) return `${slug} — generic Deep POV. Past tense, close third-person.`;
    const parts: string[] = [];
    if (rec.displayName) parts.push(rec.displayName);
    if (rec.genreOrSeries) parts.push(rec.genreOrSeries);
    if (rec.voiceTagline) parts.push(rec.voiceTagline);
    if (parts.length === 0) return `${slug} — generic Deep POV. Past tense, close third-person.`;
    return parts.join(' — ');
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
      newPairs.push(this.buildTrainingRecord('', m[1], 'golden_sentence', projectId));
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

        newPairs.push(this.buildTrainingRecord(text, correction, category, projectId));
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
    // Only accept PASS verdicts with Deep POV ≥ 9. The old gate (PASS or REVISE+8) was too
    // permissive — the writer-model POV gate is chatty and rubber-stamps prose containing
    // textbook filter words ("She thought. She felt."), which then become positive training
    // examples. Tightening to PASS + 9 narrows the funnel to clean scenes.
    if (verdict !== 'PASS' || !deepPovScore || deepPovScore < 9) return;
    if (!compiledText || compiledText.length < 200) return;

    // Second line of defense: run the fast quality scan that the export pipeline uses, so
    // bad prose can't ride a chatty POV check verdict into mined_pairs.jsonl. The scan
    // catches filter words, named-emotion nouns, bracket annotations, rule regurgitation,
    // first-person leaks, overused trigrams.
    const fastReject = this.fastQualityScan(compiledText);
    if (fastReject) {
      this.log.warn('Full scene mining rejected by fast scan', { sceneType, reason: fastReject, deepPovScore });
      return;
    }

    try {
      const sceneInstruction: Record<string, string> = {
        action:       'Write an 800-word Deep POV action scene with visceral, tactile physical grounding and short punchy sentences.',
        dialogue:     'Write an 800-word Deep POV dialogue scene where subtext and character voice carry the tension. No on-the-nose exchanges.',
        introspection:'Write an 800-word Deep POV introspection scene using only physical sensation and somatic markers. Zero thought verbs.',
        setting:      'Write an 800-word Deep POV scene that introduces a location through the character moving through it. No tour-guide descriptions, no info-dumps.',
        confrontation:'Write an 800-word Deep POV confrontation scene with two opposing goals, real blocking tactics on both sides, and a power shift before the end.',
        discovery:    'Write an 800-word Deep POV discovery scene where the character uncovers physical information (object, message, sound), reveals their bias through what they get wrong, and commits to a flawed course of action.',
        quiet:        'Write an 800-word Deep POV quiet scene with no plot beats — pure character work through tactile small-detail focus, weighted dialogue, and a small physical exchange that carries emotional truth.',
        group:        'Write an 800-word Deep POV group dynamics scene with three or more characters, each betraying their agenda through dialogue and proxemics. POV character may misread the alliances.',
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

    // 1-2 + 7. Voice screens — filter verbs, named emotions, first-person,
    // anti-patterns. The shared bank in voice-screens.ts uses the BARE-VERB
    // form so participle-elision leaks ("...moved faster, thought clearer.")
    // can't sneak past a subject-prefix regex like the loose v3-era version
    // did. Same screen runs in drainWorkerResults and audit-service so all
    // three gates share one definition of "leak."
    const voiceFail = firstFailure(text);
    if (voiceFail) return voiceFail;

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
   * Pair-structure validation — checks the BAD/category/lesson relationship.
   * Distinct from fastQualityScan (which only checks GOOD prose). Returns a
   * rejection reason or null. Added after audit pass revealed three classes
   * of pair the GOOD-only gates couldn't see:
   *   (a) lesson-equivalence — BAD and GOOD say the same thing, synonym swap
   *   (b) bad_lacks_filter_word — pair is labeled filter_word but BAD has none
   *   (c) bad_lacks_told_emotion — pair is labeled told_emotion but BAD has none
   * Together these caught ~7 of the 12 contaminated pairs in the audit set.
   */
  private validatePairStructure(badText: string, goodText: string, category: string): string | null {
    if (!badText || !goodText) return null;
    const cat = category.toLowerCase();

    // (a) Lesson-equivalence — Jaccard overlap on meaningful (length ≥ 4)
    //     words. If GOOD reuses ≥ 60% of BAD's vocabulary the pair is a
    //     synonym swap and won't teach the model anything new.
    const STOPWORDS = new Set(['that','this','they','them','their','there','these','those','were','have','been','will','with','from','what','when','where','which','about','then','than','some','such','only','very','just','also','into','onto','more','over','under']);
    const wordsOf = (s: string) => {
      const all = (s.toLowerCase().match(/\b[a-z]{4,}\b/g) || []).filter(w => !STOPWORDS.has(w));
      return new Set(all);
    };
    const badWords = wordsOf(badText);
    const goodWords = wordsOf(goodText);
    if (badWords.size >= 4 && goodWords.size >= 4) {
      let overlap = 0;
      for (const w of badWords) if (goodWords.has(w)) overlap++;
      const union = badWords.size + goodWords.size - overlap;
      const jaccard = overlap / union;
      if (jaccard >= 0.6) return `lesson_equivalence:jaccard_${jaccard.toFixed(2)}`;
    }

    // (b) Category-violation check on BAD — the BAD text must actually
    //     contain the violation the category claims. Otherwise the pair
    //     teaches nothing related to its label.
    //
    //     `(?:\w+\s+){0,2}` between subject and verb tolerates intervening
    //     adverbs/auxiliaries ("He almost didn't recognize", "She slowly
    //     turned and stared"). `It` is included as a subject because filter
    //     constructions like "It looked like X was happening" are common.
    const FILTER_VERBS_RE = /\b(?:[Hh]e|[Ss]he|[Tt]hey|[Ii]t|[A-Z][a-z]{2,}(?:'s|s')?)\s+(?:[\w']+\s+){0,2}(?:felt|noticed|realized|wondered|remembered|saw|heard|looked|stared|imagined|assumed|decided|thought|knew|seemed|watched|observed|witnessed|spotted|scanned|sensed|recognize|recognized|recognised|smelled|smelt|tasted|could\s+(?:see|hear|feel|sense|smell|taste))\b/;
    const TOLD_EMOTION_RE = /\b(?:felt|was|were|seemed|appeared|grew)\s+(?:a\s+|the\s+|so\s+|very\s+)?(?:overwhelming\s+|sudden\s+|cold\s+|deep\s+|strange\s+|growing\s+)?(?:anger|fear|dread|sadness|sorrow|joy|happiness|relief|frustration|hatred|love|hope|despair|disgust|nervous|anxious|afraid|scared|furious|angry|sad|happy|excited|worried|confused|tense|calm|exhausted|tired|content|jealous|guilty|ashamed|proud|terror|panic|rage|grief|elation|delight|unease|misery|concern|numb|exposed|vulnerable|chill|gloom|melancholy|detachment|envy|awe|shame|guilt|pride|loneliness|emptiness)\b/i;
    const TOLD_EMOTION_PHRASE_RE = /\b(?:flicker|surge|wave|rush|pang|sense|feeling|crash|jolt|wave)\s+of\s+(?:anger|fear|dread|sadness|joy|happiness|relief|frustration|love|hope|despair|disgust|terror|panic|rage|grief|unease|concern|worry|emotion|emotions?|detachment|calm)/i;

    if (cat.includes('filter')) {
      if (!FILTER_VERBS_RE.test(badText)) {
        return `bad_lacks_filter_word:cat="${category}"`;
      }
    }
    if (cat.includes('told') && cat.includes('emotion')) {
      const hasTold = TOLD_EMOTION_RE.test(badText) || TOLD_EMOTION_PHRASE_RE.test(badText);
      if (!hasTold) return `bad_lacks_told_emotion:cat="${category}"`;
    }

    return null;
  }

  /**
   * Extract the "bad" prose from a training record's user message. Records
   * built by `buildTrainingRecord(bad, good, category)` embed the bad text as
   * the last quoted span in the user prompt. This helper retrieves it for
   * downstream pair audits.
   */
  private extractBadText(record: any): string {
    const userMsg = (record?.conversations || []).find((c: any) => c.role === 'user')?.content || '';
    // The "bad" passage is typically the final quoted span in the user message.
    const quotedMatch = userMsg.match(/"([^"]+)"\s*$/);
    if (quotedMatch) return quotedMatch[1];
    // Fall back to the last paragraph of the user message, stripping surrounding quotes.
    const blocks = userMsg.split(/\n\n+/).filter(Boolean);
    return (blocks[blocks.length - 1] || '').replace(/^["']|["']$/g, '');
  }

  /**
   * Librarian (5070 Ti) PAIR audit — compares the BAD and GOOD text and decides
   * whether GOOD is a strict improvement that doesn't introduce new violations.
   * This is more grounded than the old generic prose-audit prompt (which
   * hallucinated failures on good 32B prose). Asks a concrete factual question
   * about a specific transformation rather than a vague "is this good?" call.
   */
  private async librarianPairAudit(badText: string, goodText: string, category: string): Promise<{ pass: boolean; reason: string }> {
    const LIBRARIAN_ENDPOINT = process.env.LIBRARIAN_ENDPOINT || 'http://ollama-embeddings:11434';
    const LIBRARIAN_MODEL = 'gemma3:12b';

    try {
      const response = await fetch(`${LIBRARIAN_ENDPOINT}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: LIBRARIAN_MODEL,
          stream: false,
          options: { temperature: 0.1 },
          messages: [
            {
              role: 'system',
              content: `You are a strict pair-quality auditor for LoRA training data.

Your job: decide whether the GOOD rewrite is a real improvement over the BAD original WITHOUT introducing new violations.

The pair has a stated category: ${category}. The GOOD rewrite must specifically address that category.

REJECT (output FAIL:reason) if ANY of these are true about the GOOD text:
1. It still contains the SAME violation the BAD text had (e.g. category is "filter_word" but GOOD still uses "he stared/she felt/he noticed").
2. It introduces a new anti-pattern: "chill ran/raced/snaked down [X]'s spine", "blood ran cold", "heart hammered/pounded in [X]'s chest", "tendrils of fear/dread/cold", "breath caught in [X]'s throat", "let out a breath [X] didn't know".
3. It uses purple-prose LLM-isms: "tapestry of", "symphony of", "cacophony of", "labyrinth of", "palpable", "delve", "a testament to", "in the blink of an eye", "the weight of the world".
4. It contains first-person pronouns (I, my, me, mine, we, our, us) in narration outside dialogue quotes.
5. It is barely different from BAD (cosmetic word-swap, same structural cliché).
6. It is shorter than 12 words and adds no concrete sensory detail.
7. It contradicts the category instead of fixing it (e.g. category "told_emotion" but GOOD still names an emotion as a noun).

ACCEPT (output PASS) if GOOD genuinely fixes the BAD's category violation AND avoids all the new-violation traps above.

Output EXACTLY one line:
PASS
FAIL:[short concrete reason naming the specific phrase if applicable]`,
            },
            {
              role: 'user',
              content: `Category: ${category}\n\nBAD:\n${badText}\n\nGOOD:\n${goodText}\n\nVerdict?`,
            },
          ],
        }),
      });

      if (!response.ok) return { pass: true, reason: 'librarian_unavailable' };
      const data = await response.json() as any;
      const verdict = (data?.message?.content || '').trim();

      if (/^PASS\b/i.test(verdict)) return { pass: true, reason: 'librarian_approved' };
      if (/^FAIL\b/i.test(verdict)) return { pass: false, reason: verdict.slice(0, 120) };
      return { pass: true, reason: 'librarian_ambiguous' };
    } catch {
      return { pass: true, reason: 'librarian_offline' };
    }
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

  private async exportTrainingData(projectId?: string, fallbackPenSlug?: string): Promise<number> {
    const outputDir = this.trainingPoolDir(projectId, fallbackPenSlug);
    const reportThreshold = this.resolveFinetuneThreshold(projectId);
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
        candidateRecords.push(this.buildTrainingRecord(pair.bad, pair.good, 'learned', projectId));
      }
    }

    // Add mined pairs from violation mining (primary accumulation source)
    const minedPath = join(outputDir, 'mined_pairs.jsonl');
    const exportSlug = projectId ? this.resolvePenSlug(projectId) : (fallbackPenSlug || DEFAULT_PEN_SLUG);
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
            const meta = (record.metadata = record.metadata || {});
            if (!meta.pen) meta.pen = exportSlug;
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

      // Phase 1.5: Pair-structure validation (lesson-equivalence + category-violation)
      // Runs before fastQualityScan so we reject category-mismatch / synonym-swap
      // pairs early without scanning GOOD prose.
      if (category !== 'full_scene_pass') {
        const badForStructure = this.extractBadText(record);
        if (badForStructure) {
          const structureResult = this.validatePairStructure(badForStructure, goodText, category);
          if (structureResult) {
            auditStats.fastReject++;
            this.trackRejection(auditStats.reasons, structureResult);
            this.log.debug('Quality gate: structure reject', { reason: structureResult, bad: badForStructure.slice(0, 50), good: goodText.slice(0, 50) });
            continue;
          }
        }
      }

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

      // Phase 2.5: Vocab-diversity gate
      // Reject pairs whose GOOD reuses physical-action phrases that already
      // appear in >=5% of the existing pool. Prevents the model from learning
      // a monotone substitution pattern (every emotion = fists clenched).
      // Skip on full_scene_pass and ai_ism_universal categories.
      if (category !== 'full_scene_pass' && category !== 'ai_ism_universal') {
        const diversityResult = await this.checkVocabDiversity(goodText, projectId);
        if (diversityResult) {
          auditStats.fastReject++;
          this.trackRejection(auditStats.reasons, diversityResult);
          this.log.debug('Quality gate: diversity reject', { reason: diversityResult, good: goodText.slice(0, 60) });
          continue;
        }
      }

      const needsDeepAudit = ['filter_word', 'show_vs_tell', 'ai_ism', 'learned', 'directive_positive', 'directive_negative', 'neg_pair_mining', 'told_emotion', 'told emotion', 'on_the_nose_dialogue', 'dialogue_tag_overuse', 'stat_band_drift', 'pov_slip', 'language_violation'].includes(category);

      // Phase 3: Librarian (5070 Ti, gemma3:12b) pair-audit gate.
      // RE-ENABLED with a NEW prompt that compares BAD vs GOOD instead of asking
      // "is this clean prose?". The old generic prose-audit prompt hallucinated
      // failures on good 32B prose. Comparing the pair is a more grounded,
      // factual task that the 12B handles reliably at temp 0.1.
      if (needsDeepAudit) {
        const badText = this.extractBadText(record);
        if (badText) {
          const auditResult = await this.librarianPairAudit(badText, goodText, category);
          if (!auditResult.pass) {
            auditStats.librarianReject++;
            this.trackRejection(auditStats.reasons, `librarian:${auditResult.reason}`);
            this.log.info('Quality gate: Librarian pair reject', { reason: auditResult.reason, bad: badText.slice(0, 50), good: goodText.slice(0, 50) });
            continue;
          }
        }
      }

      // Phase 4: Writer (5090) deep audit — final quality gate.
      // Magnum sees the "good" text and decides if it meets ITS own standards,
      // not just the 12B's. Pairs must pass BOTH gates.
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

    // Prepend universal AI-ism baseline pairs (40 curated examples) unless
    // this pen has opted out via meta['pen_config'][slug].disable_ai_ism_baseline.
    // These teach every model to avoid the universal LLM tells (chill-spine,
    // tapestry-of, blink-of-an-eye, etc.) regardless of genre.
    const baseline = this.buildUniversalBaselineRecords(projectId);
    if (baseline.length > 0) {
      this.log.info('Universal AI-ism baseline included', { count: baseline.length });
    }
    // Pen-specific curated baseline (additional, on top of universal).
    // For a-perry: 30 pairs in the Digital Drift voice.
    const penBaseline = this.buildPenSpecificBaselineRecords(projectId);
    if (penBaseline.length > 0) {
      this.log.info('Pen-specific baseline included', { count: penBaseline.length });
    }
    // Pen-specific curated anchors are also merged into the voice_anchors meta
    // (idempotent — only new prose gets added). At LoRA training time, the
    // existing merge_anchors_to_training.py pipeline expands these into
    // additional positive-style training pairs.
    this.mergePenSpecificAnchors(projectId);

    // Claude-injected (MCP) pairs: trusted curated baseline, no gating.
    const claudeRecords = await this.buildClaudeInjectedRecords(projectId, fallbackPenSlug);
    if (claudeRecords.length > 0) {
      this.log.info('Claude-injected baseline included', { count: claudeRecords.length });
    }

    const allRecords = [...baseline, ...penBaseline, ...claudeRecords, ...verifiedRecords];

    const jsonl = allRecords.map(r => JSON.stringify(r)).join('\n');
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
      `  - Universal AI-ism baseline (prepended): ${baseline.length}`,
      `  - Total records in training_data.jsonl: ${allRecords.length}`,
      ``,
      `## Fine-tune status`,
      verifiedRecords.length >= reportThreshold
        ? `✅ READY — ${verifiedRecords.length} verified pairs meets the ${reportThreshold} minimum threshold for LoRA fine-tuning.`
        : `⏳ ACCUMULATING — ${verifiedRecords.length}/${reportThreshold} verified pairs. Continue running calibration passes.`,
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

    WebhookEmitter.emit('export.complete', {
      pen: projectId ? this.resolvePenSlug(projectId) : (fallbackPenSlug || DEFAULT_PEN_SLUG),
      verifiedPairs: verifiedRecords.length,
      totalRecords: allRecords.length,
      passRate: auditStats.total > 0 ? Math.round((auditStats.passed / auditStats.total) * 100) : 0,
      outputPath,
    });
    return verifiedRecords.length;
  }

  private trackRejection(reasons: Map<string, number>, reason: string): void {
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }

  private buildTrainingRecord(bad: string, good: string, category: string, projectId?: string): object {
    const isGolden = category === 'golden_sentence';
    const systemPrompt = this.buildSystemPrompt(projectId);
    const slug = projectId ? this.resolvePenSlug(projectId) : DEFAULT_PEN_SLUG;
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
      metadata: { source: 'perry_calibration', category, pen: slug },
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

  // ─── Fine-tune Threshold Resolution ──────────────────────────────────────

  /**
   * Resolve the per-project fine-tune threshold. Lets a calibration project
   * specify `context.minTrainingPairs` (e.g. 200 for a fresh pen name that
   * shouldn't wait for 1000 pairs to accumulate). Falls back to the default.
   */
  private resolveFinetuneThreshold(projectId?: string): number {
    if (!projectId || !this.stateStore) return FINETUNE_THRESHOLD_DEFAULT;
    try {
      const project = this.stateStore.get(projectId);
      const ctx = project?.context as any;
      const v = ctx?.minTrainingPairs;
      if (typeof v === 'number' && v >= 50) return Math.floor(v);
    } catch { /* fall through */ }
    return FINETUNE_THRESHOLD_DEFAULT;
  }

  // ─── Negative-Pair Mining Ingestion ──────────────────────────────────────

  /**
   * Scan all completed `Negative-Pair Mining` steps in the calibration project
   * and convert their JSON outputs into training records appended to
   * `mined_pairs.jsonl`. The existing dedup + quality gate pipeline handles
   * the rest, so these pairs flow into `training_data.jsonl` like any other
   * mined data. Idempotent via a `.ingested_neg_pair_steps` marker file.
   */
  private async ingestNegativePairMining(projectId: string): Promise<void> {
    if (!this.stateStore) return;
    const project = this.stateStore.get(projectId);
    if (!project) return;

    const outputDir = this.trainingPoolDir(projectId);
    if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });

    const markerPath = join(outputDir, '.ingested_neg_pair_steps');
    let alreadyIngested: Set<string> = new Set();
    if (existsSync(markerPath)) {
      try {
        const raw = await readFile(markerPath, 'utf-8');
        alreadyIngested = new Set(raw.split('\n').filter(Boolean));
      } catch { /* ignore */ }
    }

    const candidates = project.steps.filter(
      s => s.status === 'completed' &&
           !!s.result &&
           s.label.includes('Negative-Pair Mining') &&
           !alreadyIngested.has(s.id),
    );
    if (candidates.length === 0) return;

    const newRecords: object[] = [];
    const newlyIngested: string[] = [];

    for (const s of candidates) {
      const raw = (s.result || '').trim();
      const claimedSkip = raw.startsWith('No negative pairs to mine');

      // Safety check: don't trust the mining model's claim of "no pairs" — cross-reference
      // with the actual POV check verdict from the upstream step (same chapterNumber).
      // The mining model has a documented failure mode where it emits the skip message
      // even when the verdict was REVISE/REWRITE, silently losing training pairs.
      const upstreamPov = project.steps.find(
        ps => ps.taskType === 'pov_check' &&
              ps.chapterNumber === s.chapterNumber &&
              ps.status === 'completed' &&
              !!ps.result,
      );
      const upstreamVerdictMatch = upstreamPov?.result?.match(/\*?\*?Verdict\*?\*?[:\s]+(\w+)/i);
      const upstreamVerdict = upstreamVerdictMatch?.[1]?.toUpperCase() || null;

      if (claimedSkip) {
        if (upstreamVerdict && upstreamVerdict !== 'PASS') {
          // Mining model claimed skip, but the POV check said REVISE/REWRITE — that's
          // the silent-loss bug. Log loudly and skip the idempotency mark so this
          // mining step can be retried later (e.g. after a prompt patch lands).
          this.log.warn('Neg-pair ingest: FALSE SKIP detected — mining returned skip but upstream verdict is not PASS', {
            step: s.label,
            chapterNumber: s.chapterNumber,
            upstreamVerdict,
            action: 'NOT marking ingested — retry possible',
          });
          continue;
        }
        // Legitimate skip: PASS verdict confirmed (or no upstream pov_check found to verify).
        newlyIngested.push(s.id);
        continue;
      }

      // Extract JSON: prefer ```json fenced block, fall back to first {...}
      let jsonText: string | null = null;
      const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
      if (fenceMatch) {
        jsonText = fenceMatch[1].trim();
      } else {
        const braceStart = raw.indexOf('{');
        const braceEnd = raw.lastIndexOf('}');
        if (braceStart >= 0 && braceEnd > braceStart) {
          jsonText = raw.slice(braceStart, braceEnd + 1);
        }
      }
      if (!jsonText) {
        // No JSON at all — don't mark ingested so future re-runs can retry.
        this.log.warn('Neg-pair ingest: no JSON found, NOT marking ingested', { step: s.label });
        continue;
      }

      // Two-stage parse:
      // 1. Try strict JSON.parse on the extracted block (with smart-quote normalisation first).
      // 2. On failure, fall back to a tolerant regex extractor that pulls
      //    {issue, bad, good, why} fields field-by-field. This recovers pairs
      //    from outputs where the model emitted unescaped internal double-quotes
      //    inside the "bad" or "good" string — the most common failure mode.
      let doc: any = null;
      const normalisedJson = jsonText
        .replace(/[“”]/g, '"')   // curly double quotes → straight
        .replace(/[‘’]/g, "'");  // curly single quotes → straight
      try {
        doc = JSON.parse(normalisedJson);
      } catch {
        // Strict parse failed — try the tolerant extractor below.
      }
      const pairs = Array.isArray(doc?.pairs)
        ? doc.pairs
        : this.extractPairsTolerantly(normalisedJson, s.label);
      const beforeCount = newRecords.length;
      for (const p of pairs) {
        if (typeof p?.bad !== 'string' || typeof p?.good !== 'string') continue;
        if (p.bad.trim().length < 5 || p.good.trim().length < 5) continue;
        const category = String(p.issue || 'neg_pair_mining').slice(0, 40);
        newRecords.push(this.buildTrainingRecord(p.bad.trim(), p.good.trim(), category, projectId));
      }

      // Mark ingested only if we either extracted at least one pair OR the JSON
      // explicitly had an empty "pairs" array (which is a valid no-op). If JSON
      // parse failed completely and tolerant extraction also returned nothing,
      // leave the step unmarked so a later re-ingest (perhaps after a parser
      // tweak) can recover the pairs.
      const validEmptyArray = Array.isArray(doc?.pairs) && doc.pairs.length === 0;
      if (newRecords.length > beforeCount || validEmptyArray) {
        newlyIngested.push(s.id);
      } else {
        this.log.warn('Neg-pair ingest: no pairs recovered, NOT marking ingested for possible retry', {
          step: s.label,
          chapterNumber: s.chapterNumber,
        });
      }
    }

    if (newRecords.length > 0) {
      const minedPath = join(outputDir, 'mined_pairs.jsonl');
      const lines = newRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
      await appendFile(minedPath, lines, 'utf-8');
    }

    // Mark all candidates ingested (even those that produced 0 records — they're skip lines)
    await writeFile(markerPath, [...alreadyIngested, ...newlyIngested].join('\n') + '\n', 'utf-8');

    this.log.info('Neg-pair ingest complete', {
      stepsProcessed: candidates.length,
      pairsAppended: newRecords.length,
    });
  }

  /**
   * Tolerant pair extractor — used as a fallback when JSON.parse fails on the
   * mining model's output. The most common failure mode is unescaped internal
   * double-quotes inside the "bad" or "good" string (e.g. dialogue lines that
   * the model copied verbatim without escaping the quote marks).
   *
   * Strategy: scan the text for `"issue"`/`"bad"`/`"good"`/`"why"` field
   * markers and use lookahead patterns to find the natural value boundary
   * (the next field marker or the closing brace). Returns whatever pairs we
   * could recover — better than zero.
   */
  private extractPairsTolerantly(text: string, stepLabel: string): Array<{ issue?: string; bad?: string; good?: string; why?: string }> {
    const pairs: Array<{ issue?: string; bad?: string; good?: string; why?: string }> = [];
    // Find every `{...}` candidate object inside the "pairs" array.
    // Pairs are usually enclosed in `"pairs": [ { ... }, { ... } ]`.
    // Use a simple state machine: locate "pairs"[, then scan brace-by-brace.
    const pairsStart = text.search(/"pairs"\s*:\s*\[/);
    const region = pairsStart >= 0 ? text.slice(pairsStart) : text;

    // Field extractor: find `"field"\s*:\s*"` then read until the next field
    // marker (`,\s*"<known field>"\s*:`) or the closing `}\s*[,\]]`.
    const FIELD_TERMINATORS = /,\s*"(?:issue|bad|good|why|category|reason)"\s*:|\}\s*[,\]]|$/;
    const extractField = (block: string, field: string): string | undefined => {
      const m = block.match(new RegExp(`"${field}"\\s*:\\s*"`));
      if (!m || m.index === undefined) return undefined;
      const start = m.index + m[0].length;
      const tail = block.slice(start);
      const stop = tail.search(FIELD_TERMINATORS);
      if (stop < 0) return undefined;
      // The value runs from start to stop. Trim a trailing closing quote if present.
      let value = tail.slice(0, stop).trim();
      value = value.replace(/"$/, ''); // strip trailing closing quote
      // De-escape \" -> " and \\ -> \
      value = value.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
      return value;
    };

    // Find every `{` that begins a pair object inside the pairs array.
    let depth = 0;
    let blockStart = -1;
    for (let i = 0; i < region.length; i++) {
      const c = region[i];
      if (c === '{') {
        if (depth === 0) blockStart = i;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0 && blockStart >= 0) {
          const block = region.slice(blockStart, i + 1);
          const issue = extractField(block, 'issue');
          const bad = extractField(block, 'bad');
          const good = extractField(block, 'good');
          const why = extractField(block, 'why');
          if (bad && good) pairs.push({ issue, bad, good, why });
          blockStart = -1;
        }
      }
    }

    if (pairs.length > 0) {
      this.log.info('Neg-pair ingest: tolerant parser recovered pairs from malformed JSON', {
        step: stepLabel,
        recoveredPairs: pairs.length,
      });
    } else {
      this.log.warn('Neg-pair ingest: tolerant parser could not recover any pairs', {
        step: stepLabel,
      });
    }
    return pairs;
  }

  // ─── Fine-tune Flag ──────────────────────────────────────────────────────

  private async writeFinetuneFlag(pairCount: number, projectId?: string, threshold?: number): Promise<void> {
    const outputDir = this.trainingPoolDir(projectId);
    const flagPath = join(outputDir, 'READY_TO_FINETUNE.flag');
    const sentinelPath = join(outputDir, '.last_finetune_threshold');

    const effectiveThreshold = threshold ?? this.resolveFinetuneThreshold(projectId);

    // Determine the last threshold we already triggered at (default 0 = never)
    let lastTriggeredAt = 0;
    if (existsSync(sentinelPath)) {
      try {
        lastTriggeredAt = parseInt(await readFile(sentinelPath, 'utf-8'), 10) || 0;
      } catch { /* ignore */ }
    }

    // Only trigger if we have crossed a NEW threshold-sized bucket since the last trigger.
    const currentBucket = Math.floor(pairCount / effectiveThreshold) * effectiveThreshold;
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

    // Record that we triggered at this bucket so we don't re-fire until the next bucket boundary
    await writeFile(sentinelPath, String(currentBucket), 'utf-8');

    this.log.info('Auto-learning: LoRA fine-tune threshold reached — flag written', { pairCount, bucket: currentBucket });
  }
}

// ── Voice fingerprint helpers ──────────────────────────────────────────
// Lightweight text metrics for the per-pen voice guardrail. Pure JS — no
// network or model calls — so it's cheap enough to run on every drained
// worker pair.

export interface VoiceFingerprint {
  meanSentenceLenMu: number;
  meanSentenceLenSigma: number;
  stdSentenceLenMu: number;
  stdSentenceLenSigma: number;
  adverbDensityMu: number;
  adverbDensitySigma: number;
  contractionRateMu: number;
  contractionRateSigma: number;
  sampleCount: number;
}

interface TextMetrics {
  meanSentenceLen: number;
  stdSentenceLen: number;
  adverbDensity: number;   // adverbs / total words
  contractionRate: number; // contractions / total verb-likely positions
}

const ADVERB_RX = /\b\w+ly\b/gi;
const CONTRACTION_RX = /\b\w+'(s|t|re|ve|ll|d|m)\b/gi;

function textMetrics(text: string): TextMetrics {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { meanSentenceLen: 0, stdSentenceLen: 0, adverbDensity: 0, contractionRate: 0 };
  }
  // Sentence split — naive but cheap. Treat ., !, ? as terminators; collapse multi.
  const sentences = cleaned.split(/[.!?]+\s+/).map(s => s.trim()).filter(Boolean);
  const lens = sentences.map(s => s.split(/\s+/).length);
  const totalWords = lens.reduce((a, b) => a + b, 0) || 1;
  const adverbCount = (cleaned.match(ADVERB_RX) || []).length;
  const contractionCount = (cleaned.match(CONTRACTION_RX) || []).length;
  return {
    meanSentenceLen: mean(lens),
    stdSentenceLen: stddev(lens),
    adverbDensity: adverbCount / totalWords,
    contractionRate: contractionCount / Math.max(sentences.length, 1),
  };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}
