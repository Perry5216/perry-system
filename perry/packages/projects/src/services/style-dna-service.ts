/**
 * @perry/projects — Style DNA Service V2
 *
 * Structured, per-project, per-character style DNA system.
 * Replaces the flat .config/style-dna.txt with a JSON document
 * stored in SQLite that supports:
 *
 * - Global baseline rules (filter words, trope warnings)
 * - Per-project genre overrides
 * - Per-character voice profiles (learned from passing chapters)
 * - Positive + negative learning
 * - Automatic pruning of stale rules
 */

import type { Logger } from '@perry/core';
import type { StateStore } from '../state-store.js';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ═══════════════════════════════════════════════════════════
// Schema Types
// ═══════════════════════════════════════════════════════════

export interface StyleDna {
  version: 2;
  globalRules: GlobalRules;
  projectOverrides: Record<string, ProjectStyleOverride>;
  characterVoices: Record<string, Record<string, CharacterVoice>>;
  /** Staging area: candidates must be seen N times before promotion to permanent DNA */
  candidates: StyleCandidate[];
}

export interface GlobalRules {
  bannedFilterWords: string[];
  bannedPhrases: string[];
  forbiddenNames: string[];
  showVsTellExamples: ShowTellExample[];
  tropeWarnings: string[];
  /** Golden sentences from human authors demonstrating target prose quality */
  positiveExamples: string[];
  /** Positive rules derived from calibration successes */
  positiveDirectives: string[];
  updatedAt: string;
}

export interface ShowTellExample {
  bad: string;
  good?: string;
  learnedFrom: string;
  addedAt: string;
}

export interface ProjectStyleOverride {
  genre?: string;
  allowedExceptions: string[];
  additionalBans: string[];
  styleProfile: LearnedStyleProfile;
  /** Rolling prose metric history — last N chapters, used to detect model tendencies */
  proseMetricsTrends: ProseMetricsTrend[];
}

export interface LearnedStyleProfile {
  sentenceLength?: 'short' | 'medium' | 'long' | 'varied';
  dialogueRatio?: 'low' | 'medium' | 'high';
  vocabulary?: 'simple' | 'moderate' | 'literary';
  learnedPatterns: string[];
}

/** Snapshot of key prose metrics for a single chapter, stored for trend analysis */
export interface ProseMetricsTrend {
  chapterNum: number;
  chapterLabel: string;
  recordedAt: string;
  avgSentenceLength: number;
  sentenceMonotonyPct: number;
  heTheOpeningRatePct: number;
  adverbDensityPct: number;
  uniqueWordRatio: number;
  toBeVerbDensityPct: number;
  fragmentCount: number;
}

export interface CharacterVoice {
  speechPattern?: string;
  internalVoice?: string;
  bannedInPOV: string[];
  signature: string[];
  learnedAt: string;
}

/** A candidate entry waiting for frequency-based promotion */
export interface StyleCandidate {
  text: string;
  type: 'show_tell' | 'trope';
  seenCount: number;
  firstSeenFrom: string;   // step label where first observed
  lastSeenFrom: string;    // step label where most recently observed
  firstSeenAt: string;
  lastSeenAt: string;
}

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

const META_KEY = 'style_dna_v2';
const MAX_SHOW_TELL_EXAMPLES = 50;
const MAX_PATTERNS_PER_CHARACTER = 20;
/** How many times a candidate must be seen before promotion to permanent DNA */
const PROMOTION_THRESHOLD = 3;
const MAX_CANDIDATES = 100;

export class StyleDnaService {
  private dna: StyleDna;
  private stateStore: StateStore;
  private log: Logger;
  private workspaceDir: string;
  private dirty = false;

  constructor(stateStore: StateStore, log: Logger, workspaceDir: string) {
    this.stateStore = stateStore;
    this.log = log;
    this.workspaceDir = workspaceDir;
    this.dna = this.load();

    // Auto-dedup on load to clean up any accumulated bloat
    const { removed } = this.deduplicate();
    if (removed > 0) {
      this.log.info('Style DNA auto-dedup on load', { removedDuplicates: removed });
    }
  }

  // ── Load / Save ────────────────────────────────────────

  private load(): StyleDna {
    // Try loading from SQLite meta table
    const raw = this.stateStore.getMeta?.(META_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.version === 2) {
          // Migrate: ensure candidates array exists (added in staging system)
          if (!parsed.candidates) parsed.candidates = [];
          this.log.info('Style DNA V2 loaded from database', {
            globalBans: parsed.globalRules?.bannedFilterWords?.length || 0,
            projects: Object.keys(parsed.projectOverrides || {}).length,
            candidates: parsed.candidates.length,
          });
          return parsed;
        }
      } catch { /* corrupted — rebuild */ }
    }

    // Migrate from legacy flat file if it exists
    const legacyPath = join(this.workspaceDir, '.config', 'style-dna.txt');
    if (existsSync(legacyPath)) {
      this.log.info('Migrating legacy style-dna.txt → Style DNA V2');
      return this.migrateFromLegacy(legacyPath);
    }

    // Fresh start
    return this.createEmpty();
  }

  private createEmpty(): StyleDna {
    const seedPath = join(this.workspaceDir, '.config', 'default_dna_seed.json');
    if (!existsSync(join(this.workspaceDir, '.config'))) {
      mkdirSync(join(this.workspaceDir, '.config'), { recursive: true });
    }

    if (existsSync(seedPath)) {
      try {
        const globalRules = JSON.parse(readFileSync(seedPath, 'utf8'));
        this.log.info('Loaded baseline Style DNA seed from ' + seedPath);
        return {
          version: 2,
          globalRules,
          projectOverrides: {},
          characterVoices: {},
          candidates: []
        };
      } catch (e) {
        this.log.error('Failed to load default_dna_seed.json, falling back to hardcoded defaults', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    const defaultGlobalRules: GlobalRules = {
        // Baseline filter words — the most common AI prose crutches.
        // These are seeded so fresh installs have immediate protection.
        bannedFilterWords: [
          'felt', 'saw', 'noticed', 'realized', 'seemed', 'wondered',
          'watched', 'heard', 'knew', 'thought', 'observed', 'sensed',
          'perceived', 'recognized', 'decided', 'considered', 'detected',
          'transcend', 'fluidness', 'synchronization',
          // OVERUSED TIER 1 & VOCABULARY
          'akin', 'albeit', 'ambiance', 'arcane', 'backdrop', 'beacon', 'bespoke',
          'breathtaking', 'cacophony', 'celestial', 'chasm', 'circuitous', 'coherence',
          'covert', 'crescendo', 'cryptic', 'delicate', 'deft', 'demystify',
          'delightful', 'deluge', 'delusion', 'demeaning', 'delving', 'diaphanous',
          'dichotomy', 'dilapidated', 'dimly', 'dirge', 'discomfiture', 'discordance',
          'disquieting', 'dissolution', 'diverge', 'docile', 'dogma', 'doleful',
          'dolorous', 'dominion', 'doomsday', 'dormancy', 'dormant',
          'delve', 'dive', 'embark', 'embrace', 'navigate', 'realm', 'explore',
          'endeavor', 'leverage', 'orchestrate', 'meticulously', 'whilst', 'amongst',
          'amidst', 'moreover', 'furthermore', 'additionally', 'conversely', 'notably',
          'arguably', 'transformative', 'unprecedented', 'innovative', 'strategic',
          'pivotal', 'vital', 'crucial', 'comprehensive', 'meticulous', 'intricate',
          'elaborate', 'profound', 'synergies', 'paradigm', 'dynamics', 'complexities',
          'nuances', 'granular', 'multi-faceted', 'potent', 'cogent', 'ingenious',
          'laudable', 'tapestry', 'ethos', 'catalyst', 'unveil', 'unlock', 'unravel',
          'unleash', 'harness', 'eradicate', 'mitigate', 'curtail', 'amplify',
          'catalyze', 'elevate', 'ascend', 'disruption', 'agile', 'scalable',
          'synergy', 'holistic', 'stakeholder',
          // ZOMBIE WORDS (v3 — survived 92 adversarial iterations)
          'shimmering', 'iridescent', 'towering', 'sprawling', 'oppressive',
          'formulaic', 'monolithic',
          // PACING CRUTCH ADVERBS (v4)
          'suddenly', 'slowly', 'silently', 'finally', 'inevitably',
          'gently', 'carefully', 'quietly', 'solemnly', 'hesitantly',
          'abruptly', 'softly', 'swiftly', 'urgently'
        ],
        // Forbidden character names — AI's go-to names that instantly signal
        // machine authorship. The Character Bible step will refuse these.
        forbiddenNames: [
          'Chen', 'Sarah Chen', 'Elara', 'Lyra', 'Jasper', 'Lena',
          'Zara', 'Zane', 'Niko', 'Lila', 'Mira', 'Leo',
        ],
        bannedPhrases: [
          'a bastion of', 'a clarion of', 'a mosaic of', 'a testament to',
          'beacon of hope', 'cautionary tale', 'embark on a journey',
          'embark on an adventure', 'embark on an odyssey', 'embark on an exploration',
          'game changer', 'in stark contrast', 'in the wake of', 'mist-shrouded world',
          'shimmering curtain', 'sweeping vistas', 'twists and turns',
          'variegated tapestry', 'vibrant symphony', 'wordsmith\'s craft',
          'little did she know', 'it was a testament to', 'only time would tell',
          'a new chapter began', 'the transition was seamless', 'a high-stakes game',
          'the data doesn\'t lie', 'we need to find a way', 'i can\'t do this alone',
          'everything is under control', 'this is a victory for all of us',
          'we must neutralize', 'we cannot afford any leaks',
          'the system will ultimately correct itself',
          'if we\'re not careful the whole system could collapse',
          'we have a chance to make a real difference', 'we could really make a real difference',
          'we have to expose the truth', 'this could change everything',
          'we need to act fast', 'no one will expose our operations',
          'we will maintain order at any cost', 'make a real difference',
          'get it to the right people', 'our only hope', 'find a way to expose',
          'the whole system could collapse', 'whispered softly', 'clenched her fists',
          'took a deep breath', 'looked away', 'fell a chill', 'heart raced',
          'steeled herself', 'squared her shoulders',
          'it\'s important to note that', 'one of the main reasons is that',
          'this is due to the fact that', 'in today\'s', 'in this context',
          'it goes without saying', 'for instance', 'all things considered',
          'to be honest', 'as it turned out', 'it should be noted that',
          'the reality is that', 'when all is said and done', 'it\'s worth noting',
          'to put it another way', 'in essence', 'at the end of the day',
          'in a nutshell', 'it cannot be overstated that', 'the fact of the matter is',
          // ZOMBIE PHRASES (v3 — survived 92 adversarial iterations)
          'he gasped. a wet sound', 'rose like ivory needles', 'rose like frozen prayers',
          'towering, metallic monstrosity', 'shimmering, iridescent haze',
          'shimmering, non-euclidean expanse', 'shimmering like a mirage',
          'flickering like a dying candle', 'heart hammering like a trapped bird',
          'like a cathedral built from frozen lightning',
          'a gilded cage', 'a god in a box',
          'he tried to scream, but he had no throat',
          'he screamed, but he no longer had a throat',
          'there was no tunnel of light, no welcoming choir',
          // STRUCTURAL AI-ISMS (v4)
          'it was not a', 'it was not the', 'this was not a', 'this was not the',
          'for centuries,', 'for millennia,', 'since the beginning of',
          'long before the', 'long before this',
          'his eyes drifted', 'her eyes drifted', 'his gaze fell', 'her gaze fell',
          'his eyes found', 'her eyes found', 'his hands found', 'her hands found',
          'his eyes wandered', 'her eyes wandered',
          'the irony was not lost', 'he understood now', 'she understood now',
          'this was the fundamental', 'now he understood', 'now she understood',
          'precision', 'optimization', 'resolution', 'surgical click',
          'void of grey', 'fraying into static', 'darkness swallowed', 'mass grave with a power switch'
        ],
        showVsTellExamples: [
          { bad: 'A wave of sadness washed over her', good: 'Her throat tightened. She looked away.', learnedFrom: 'baseline', addedAt: new Date().toISOString() },
          { bad: 'He felt a surge of anger', good: 'His fists clenched. The words came out through his teeth.', learnedFrom: 'baseline', addedAt: new Date().toISOString() },
          { bad: 'She was filled with dread', good: 'Her stomach dropped. The hallway stretched longer than it should.', learnedFrom: 'baseline', addedAt: new Date().toISOString() },
          { bad: 'The atmosphere was tense', good: 'Nobody touched their drinks. Every chair faced the door.', learnedFrom: 'baseline', addedAt: new Date().toISOString() },
          { bad: 'He couldn\'t help but smile', good: 'The corner of his mouth twitched before he could stop it.', learnedFrom: 'baseline', addedAt: new Date().toISOString() },
          { bad: 'He gasped. A wet sound.', good: 'He inhaled sharply, his throat rattling with fluid.', learnedFrom: 'baseline', addedAt: new Date().toISOString() },
          { bad: 'He felt a sudden, sharp surge of panic.', good: 'The air in the pod turned to ground glass. His lungs seized, scraping against his ribs.', learnedFrom: 'baseline-adversarial', addedAt: new Date().toISOString() },
          { bad: 'He was being translated. He was being optimized. He was being stripped.', good: 'The translation sequence hit him all at once, optimizing his code and stripping his humanity in a single, devastating cycle.', learnedFrom: 'baseline-adversarial', addedAt: new Date().toISOString() },
          { bad: 'Then the blackout hit. The darkness was absolute.', good: 'The blackout hit, swallowing the room in a thick, suffocating pitch.', learnedFrom: 'baseline-adversarial', addedAt: new Date().toISOString() },
          { bad: 'They clung to the ghosts of their former lives like shipwrecked sailors clutching driftwood.', good: 'They clung to the ghosts of their former lives like corrupted sectors fighting an overwrite protocol.', learnedFrom: 'baseline-adversarial', addedAt: new Date().toISOString() },
          { bad: 'You are a thought without a thinker, a scream without a throat.', good: 'Your cognitive architecture is running without a host body. You\'re a localized processing error.', learnedFrom: 'baseline-adversarial-advanced', addedAt: new Date().toISOString() },
          { bad: 'It was not a sanctuary. It was a prison.', good: 'The doors locked from the outside. The walls were lined with sensor mesh.', learnedFrom: 'baseline-adversarial-advanced', addedAt: new Date().toISOString() },
        ],
        positiveDirectives: [],
        positiveExamples: [
          // Golden sentences demonstrating TARGET prose quality.
          // Sourced from published science fiction with zero AI-isms.
          // Study these. Emulate the rhythm, the concrete specificity, and the active verbs.
          'The door dilated. Marek stepped through and felt the temperature drop by ten degrees. He checked his chrono: 03:14. Nobody else in the corridor.',
          'She hit the override. The safety rail snapped back into its housing with a sound like a gunshot and she was over the side, her fingers finding the service ladder three rungs down.',
          'The server room hummed. Not a clean hum—a stressed one, the kind that meant cooling arrays running past capacity and nobody filing the maintenance report.',
          'Voss set the charge and walked. She did not run. Running attracted cameras.',
          'The implant burned behind his ear. He pressed two fingers against it until the burn subsided, then pulled his hand away and looked at the blood on his fingertips.',
          'The lift doors opened onto a corridor full of bodies. Not dead. Seated. Forty-three people in corporate grey, all of them staring at screens, all of them perfectly still.',
          'She found the file three directories deep, behind a folder labelled MAINTENANCE LOG 2047. Inside: one document, forty-eight pages, no author.',
          'The gun was under the counter. He had put it there six months ago, when he still believed it would be the last resort. Now it was just the next step.',
          'Rain on the porthole. She counted the drops to stay awake. Got to eleven hundred before she heard the airlock cycle.',
          'He gave the handle a second pull. The drawer did not move. He went looking for something to force it with, because the alternative—that the drawer was locked from the inside—was not something he wanted to think about yet.',
          'The map showed three routes. Two were marked with red Xs. The third was not marked at all, which meant either nobody had tried it, or nobody who had tried it had come back to add the X.',
          'Her voice was steady. Her hands, out of sight under the table, were not.',
          'The pod bay was empty except for one scrubber unit working its way along the far wall, leaving a trail of clean floor behind it, heading nowhere in particular.',
          'He read the message twice. Then he deleted it. Then he sat for a long time looking at the space where it had been.',
          'The cargo manifest listed fourteen crates. Dock records showed fifteen had been loaded. He pulled on gloves before opening the fifteenth.',
        ],
        tropeWarnings: [
          'Using the Rule of Three (Tricolon) to structure descriptions',
          'Repetitive dialogue attribution (e.g., X said, Y replied every line)',
          'Character describing their own appearance in a mirror',
          'Opening with the character waking up',
          'Info-dumping world-building through "As you know, Bob" dialogue',
          'Using weather to set mood instead of character action',
          'Characters nodding, sighing, or raising eyebrows more than once per page',
          'Ending a chapter with the character falling asleep or losing consciousness',
          'Sensory Bridges: Using phrases like "He felt," "She realized," or "He noticed" instead of describing the physical or environmental manifestations directly.',
          'Asymmetrical Pacing: Relying on the Rule of Three to create rhythm. Deliberately break the Rule of Three to eradicate rhythmic predictability.',
          'Staccato Dramatic Fragments: Pairing an action beat directly with a short, absolute declaration (e.g., "The darkness was absolute").',
          'Mundane Similes: Using terrestrial or historical similes (e.g., shipwrecked sailors) instead of thematic metaphors drawn directly from the physical reality of the world.',
          'Anaphora/Consecutive Repetition: NEVER begin consecutive sentences or paragraphs with the same phrase or pronoun (e.g., "They told us... They spoke of... They promised..."). Vary sentence structures aggressively.',
          'Definitional Negation: BAN the "It was not X, it was Y" formula. Define people, places, and states by their active characteristics, never by negating their opposites.',
          'The Perspective Crutch: NEVER use the "To [Group], it was [Noun]" formula to explain how different factions view the world (e.g., "To the politicians, it was a threat"). Describe the faction\'s direct actions instead.',
          'State Declarations: BAN declarative state-of-being sentences ("He was data", "It was a neon purgatory"). Describe the physical manifestation of these states instead.',
          'The Omniscient "They": NEVER repeat "They [verb]" to describe faceless groups or corporations.',
          'Em-Dash Exposition Drop: NEVER use em-dashes to awkwardly inject definitions or titles into the middle of an action sentence (e.g., "men like Silas—the Eraser...").',
          'Thought Verbs: BAN "He thought", "She realized", "They knew", or "He remembered". Show the cognitive process or the physical trigger.',
          'The "Suddenly" Crutch: NEVER start sentences with "Suddenly", "Instantly", or "All at once".',
          'Thematic Telling: NEVER state the moral, theme, or irony of a situation directly to the reader (e.g., "the translation error is no longer a glitch"). Let the physical actions demonstrate it.',
        ],
        updatedAt: new Date().toISOString(),
      };

    try {
      writeFileSync(seedPath, JSON.stringify(defaultGlobalRules, null, 2));
      this.log.info('Generated default Style DNA seed at ' + seedPath);
    } catch (e) {
      this.log.error('Failed to write default_dna_seed.json', { error: e instanceof Error ? e.message : String(e) });
    }

    return {
      version: 2,
      globalRules: defaultGlobalRules,
      projectOverrides: {},
      characterVoices: {},
      candidates: [],
    };
  }

  private migrateFromLegacy(path: string): StyleDna {
    const content = readFileSync(path, 'utf-8');
    const dna = this.createEmpty();

    // Extract filter words from legacy format: BANNED_FILTER_WORDS: "felt", "saw", ...
    const filterMatch = content.match(/BANNED_FILTER_WORDS:\s*(.+)/i);
    if (filterMatch) {
      const words = filterMatch[1].match(/"([^"]+)"/g);
      if (words) {
        dna.globalRules.bannedFilterWords = words.map(w => w.replace(/"/g, ''));
      }
    }

    // Extract show-vs-tell examples from legacy format: - Avoid: ...
    const avoidMatches = content.matchAll(/- Avoid:\s*(.+)/g);
    for (const m of avoidMatches) {
      dna.globalRules.showVsTellExamples.push({
        bad: m[1].trim(),
        learnedFrom: 'legacy-migration',
        addedAt: new Date().toISOString(),
      });
    }

    this.dirty = true;
    this.log.info('Legacy DNA migrated', {
      filterWords: dna.globalRules.bannedFilterWords.length,
      showTellExamples: dna.globalRules.showVsTellExamples.length,
    });

    return dna;
  }

  save(): void {
    if (!this.dirty) return;
    this.dna.globalRules.updatedAt = new Date().toISOString();
    this.stateStore.setMeta?.(META_KEY, JSON.stringify(this.dna));
    this.dirty = false;
    this.log.debug('Style DNA V2 saved to database');
  }

  // ── Query API ──────────────────────────────────────────

  /**
   * Compile a compact "seed" version of the DNA for system prompt injection.
   * Instead of dumping the full ~4,000 token DNA into the user message,
   * this produces ~300 tokens for the system prompt.
   */
  compileSeed(projectId: string, chapterNum: number, povCharacter?: string): string {
    const parts: string[] = [];
    const global = this.dna.globalRules;
    const project = this.dna.projectOverrides[projectId];

    // 1. Banned words compact list (~50 tokens)
    const banned = new Set(global.bannedFilterWords);
    if (project?.additionalBans) {
      for (const w of project.additionalBans) banned.add(w);
    }
    if (project?.allowedExceptions) {
      for (const w of project.allowedExceptions) banned.delete(w);
    }
    if (banned.size > 0) {
      parts.push(`BANNED WORDS (never use in prose): ${[...banned].join(', ')}`);
    }

    // 1b. Forbidden names (~30 tokens)
    const names = global.forbiddenNames || [];
    if (names.length > 0) {
      parts.push(`FORBIDDEN NAMES (never use for any character): ${names.join(', ')}`);
    }

    // 1c. Banned phrases (~100 tokens)
    const phrases = global.bannedPhrases || [];
    if (phrases.length > 0) {
      parts.push(`FORBIDDEN PHRASES (instant rejection if used): ${phrases.join(', ')}`);
    }

    // 2. Show/Tell top 5 unique core patterns (~100 tokens)
    const examples = global.showVsTellExamples;
    if (examples.length > 0) {
      const corePatterns = new Set<string>();
      for (const e of examples) {
        const quoted = e.bad.match(/"([^"]+)"/)?.[1] || e.bad;
        const normalized = quoted.replace(/\b(the|a|an|was|were|is|are|his|her|its|of|in|to)\b/gi, '').trim();
        if (normalized.length > 5) corePatterns.add(quoted.slice(0, 80));
      }
      const topPatterns = [...corePatterns].slice(0, 5);
      parts.push(
        `SHOW DON'T TELL: Never state emotions/atmosphere directly. Show through action, dialogue, sensory detail.\n` +
        `Avoid patterns like: ${topPatterns.map(p => `"${p}"`).join('; ')}`
      );
    }

    // 2b. Structural Tropes and AI-Isms (CRITICAL)
    const tropes = global.tropeWarnings;
    if (tropes && tropes.length > 0) {
      parts.push(
        `NARRATIVE CONSTRAINTS (CRITICAL):\n` +
        tropes.map(t => `- ${t}`).join('\n')
      );
    }

    // 2c. Positive examples — target prose quality (up to 5 random examples)
    const posExamples = global.positiveExamples || [];
    if (posExamples.length > 0) {
      // Pick 5 random examples each call so the Writer sees variety
      const shuffled = [...posExamples].sort(() => Math.random() - 0.5).slice(0, 5);
      parts.push(
        `TARGET PROSE QUALITY — Study these sentences and emulate their rhythm, specificity, and active verbs:\n` +
        shuffled.map((e, i) => `${i + 1}. "${e}"`).join('\n')
      );
    }

    // 2d. Positive Directives - from successful calibration passes
    const posDirectives = global.positiveDirectives || [];
    if (posDirectives.length > 0) {
      parts.push(
        `TARGET BEHAVIORS (CRITICAL):\n` +
        posDirectives.map(d => `- ${d}`).join('\n')
      );
    }

    // 3. Character voice ONLY for current project + current POV (~80 tokens)
    if (povCharacter) {
      const voices = this.dna.characterVoices[projectId];
      const voice = voices?.[povCharacter];
      if (voice) {
        const traits: string[] = [`CHARACTER VOICE [${povCharacter}]:`];
        if (voice.speechPattern) traits.push(`Speech: ${voice.speechPattern}`);
        if (voice.internalVoice) traits.push(`Internal: ${voice.internalVoice}`);
        if (voice.bannedInPOV.length > 0) {
          traits.push(`Banned in POV: ${voice.bannedInPOV.join(', ')}`);
        }
        if (voice.signature.length > 0) {
          traits.push(`Signature: ${voice.signature.slice(-3).join('; ')}`);
        }
        parts.push(traits.join(' | '));
      }
    }

    // 4. Style profile if learned (~30 tokens)
    if (project?.styleProfile) {
      const sp = project.styleProfile;
      const traits: string[] = [];
      if (sp.sentenceLength) traits.push(`sentences=${sp.sentenceLength}`);
      if (sp.dialogueRatio) traits.push(`dialogue=${sp.dialogueRatio}`);
      if (sp.vocabulary) traits.push(`vocabulary=${sp.vocabulary}`);
      if (traits.length > 0) {
        parts.push(`STYLE: ${traits.join(', ')}`);
      }
    }

    // 5. Dynamic prose metric warnings — generated from this model's actual
    // measured tendencies across the last 3 chapters of this project.
    // These warnings are specific, data-driven, and update every chapter.
    const trends = project?.proseMetricsTrends;
    if (trends && trends.length >= 1) {
      const recent = trends.slice(-3);
      const avg = (key: keyof ProseMetricsTrend) =>
        recent.reduce((s, t) => s + (t[key] as number), 0) / recent.length;

      const warnings: string[] = [];

      const monotony = avg('sentenceMonotonyPct');
      if (monotony > 45) {
        warnings.push(
          `SENTENCE RHYTHM WARNING: Your last ${recent.length} chapter(s) averaged ${monotony.toFixed(0)}% sentence monotony ` +
          `(target: <50%). You are writing too many sentences of similar length. ` +
          `Deliberately alternate: very short (2–5 words) → long (20–30 words) → fragment → compound.`
        );
      }

      const heThe = avg('heTheOpeningRatePct');
      if (heThe > 35) {
        warnings.push(
          `SENTENCE OPENER WARNING: ${heThe.toFixed(0)}% of your sentences start with He/She/The/It. ` +
          `Start sentences with: verbs, adverbs, objects, participial phrases, or dialogue beats instead. ` +
          `Never begin two consecutive sentences with the same word.`
        );
      }

      const avgLen = avg('avgSentenceLength');
      if (avgLen < 10) {
        warnings.push(
          `SENTENCE LENGTH WARNING: Average sentence length is ${avgLen.toFixed(1)} words — too fragmented. ` +
          `Balance short punchy sentences with longer, more complex ones.`
        );
      } else if (avgLen > 20) {
        warnings.push(
          `SENTENCE LENGTH WARNING: Average sentence length is ${avgLen.toFixed(1)} words — too verbose. ` +
          `Cut sentences ruthlessly. Use periods where you'd use commas.`
        );
      }

      const adverbs = avg('adverbDensityPct');
      if (adverbs > 2.0) {
        warnings.push(
          `ADVERB WARNING: You used ${adverbs.toFixed(1)}% adverbs (target: <2.5%). ` +
          `Replace adverbs with stronger verbs. "walked quickly" → "bolted". "spoke softly" → "murmured".`
        );
      }

      const toBeVerbs = avg('toBeVerbDensityPct');
      if (toBeVerbs > 4.0) {
        warnings.push(
          `PASSIVE VOICE WARNING: ${toBeVerbs.toFixed(1)}% of words are "to be" verbs (was/were/is/are). ` +
          `This signals telling, not showing. Convert state descriptions to active physical actions.`
        );
      }

      const uniqueness = avg('uniqueWordRatio');
      if (uniqueness < 0.42) {
        warnings.push(
          `VOCABULARY WARNING: Word uniqueness ratio is ${(uniqueness * 100).toFixed(0)}% (target: >40%). ` +
          `You are repeating the same words too often. Vary your vocabulary — ` +
          `especially nouns and verbs. Check for overused words like "the drive", "the screen", "the shadow".`
        );
      }

      if (warnings.length > 0) {
        parts.push(
          `## PROSE PATTERN ALERTS (measured from your last ${recent.length} chapter(s) on this project)\n` +
          warnings.map(w => `- ${w}`).join('\n')
        );
      }
    }

    if (parts.length === 0) return '';
    return `## STYLE DNA (MANDATORY RULES)\n${parts.join('\n')}`;
  }

  // ── Golden Examples API ──────────────────────────────────

  /**
   * Compile scene-type-aware before/after prose correction pairs for few-shot injection.
   * These are far more effective than abstract rules — the model pattern-matches on
   * corrected prose and adopts the target style without needing to follow logical rules.
   *
   * @param sceneType - 'action' | 'dialogue' | 'introspection' | 'general'
   * @param maxPairs  - number of pairs to inject (default 5)
   */
  compileGoldenExamples(sceneType: 'action' | 'dialogue' | 'introspection' | 'general' = 'general', maxPairs = 5): string {
    const allPairs = this.dna.globalRules.showVsTellExamples || [];

    // Baseline scene-specific corrections always included
    const baselinesByType: Record<string, { bad: string; good: string }[]> = {
      action: [
        { bad: 'He felt a surge of adrenaline as the drone fired.', good: 'The drone fired. The impact threw him sideways into the bulkhead. His ear rang.' },
        { bad: 'He noticed the corridor was empty.', good: 'The corridor. Empty. No movement.' },
        { bad: 'He had to make a decision — stay or run.', good: "His knuckles locked around the pipe. He ran." },
        { bad: 'He looked at the exit and calculated his odds.', good: 'Twelve metres to the exit. Two guards. One clip.' },
        { bad: 'He stared at Vane, trying to read his intention.', good: "Vane's jaw tightened. His weight shifted to his left foot." },
      ],
      dialogue: [
        { bad: 'He felt irritated by her question.', good: 'He set down the cup. The ceramic clicked against the table with more force than necessary.' },
        { bad: '"I understand how you feel," she said, her voice full of sympathy.', good: '"Sure," she said. She looked at the wall.' },
        { bad: 'He thought she was lying.', good: "She'd used the wrong tense. Past, not present. He let it sit." },
        { bad: "She felt she couldn't trust him.", good: 'Her hand found the door handle. Just in case.' },
        { bad: 'He felt the tension between them rising.', good: 'Neither of them spoke. The ventilator hummed.' },
      ],
      introspection: [
        { bad: 'He felt the weight of the decision pressing down on him.', good: 'The joint between his shoulder and neck had locked solid. It had been doing that for three days.' },
        { bad: 'He remembered how it had all gone wrong.', good: "Docking Bay 7. The cargo manifest. Eighteen crates. The nineteenth one they hadn't opened." },
        { bad: 'He realized he had made a terrible mistake.', good: "The manifest. The one he'd signed. His signature, neat and unambiguous at the bottom." },
        { bad: 'She thought about the choices that had led her here.', good: "Three years back, she'd turned right instead of left at the fork in Corridor D. Small things." },
        { bad: 'He felt alone and hopeless in the vast darkness.', good: 'The airlock hissed. Somewhere behind him, the ship ticked as it cooled.' },
      ],
      general: [
        { bad: 'She felt the cold wind against her face.', good: 'Cold bit her cheeks. The wind off the gorge.' },
        { bad: 'He noticed the room was unusually quiet.', good: 'No ventilation hum. No data-feed chatter. Nothing.' },
        { bad: 'The silence was heavy with unspoken words.', good: 'Neither of them spoke. The dehumidifier in the corner ticked.' },
        { bad: 'He felt a sudden wave of grief wash over him.', good: 'His throat locked. He turned toward the window so she could not see his hands.' },
        { bad: 'She thought back to when she had first met him.', good: 'Dock 14. A coffee that had gone cold. The look on his face when he had seen the cargo.' },
      ],
    };

    const baselines = baselinesByType[sceneType] || baselinesByType.general;

    // Pull any learned pairs from the database (most recent first)
    const learnedPairs = allPairs.slice(-10);

    // Merge: baseline first, learned second, cap at maxPairs
    const merged = [...baselines, ...learnedPairs].slice(0, maxPairs);

    if (merged.length === 0) return '';

    const lines = merged.map((p, i) =>
      `${i + 1}. BAD:  "${p.bad}"\n   GOOD: "${p.good}"`
    ).join('\n');

    return `## CORRECTION PAIRS — Study These Before Writing\nEvery sentence you write must match the style of the GOOD examples below:\n${lines}`;
  }

  // ── Learning API ───────────────────────────────────────

  /**
   * Learn from a quality gate failure.
   * Extracts filter words, show-vs-tell violations, and trope warnings
   * from the raw POV check result text.
   */
  learnFromFailure(
    projectId: string,
    stepLabel: string,
    filterWordsRaw: string,
    showTellRaw: string,
    tropeWarningsRaw: string,
    povCharacter?: string,
  ): boolean {
    let learned = false;

    // Filter words
    if (filterWordsRaw && filterWordsRaw.toLowerCase() !== 'none') {
      const KNOWN = [
        'felt', 'saw', 'noticed', 'realized', 'seemed', 'wondered',
        'watched', 'heard', 'knew', 'thought', 'decided', 'observed',
        'sensed', 'perceived', 'recognized', 'detected', 'considered',
        'appeared', 'began', 'started', 'managed',
      ];
      const found = KNOWN.filter(w => filterWordsRaw.toLowerCase().includes(w));
      for (const word of found) {
        if (!this.dna.globalRules.bannedFilterWords.includes(word)) {
          this.dna.globalRules.bannedFilterWords.push(word);
          learned = true;
        }
      }

      // If a specific character keeps triggering, add to their voice DNA
      if (povCharacter && found.length > 0) {
        this.ensureCharacterVoice(projectId, povCharacter);
        const voice = this.dna.characterVoices[projectId][povCharacter];
        for (const word of found) {
          if (!voice.bannedInPOV.includes(word)) {
            voice.bannedInPOV.push(word);
          }
        }
      }
    }

    // Show vs Tell — staged through candidates
    if (showTellRaw && showTellRaw.toLowerCase() !== 'none') {
      const lines = showTellRaw.split('\n')
        .map(l => l.replace(/^[-*]\s*/, '').trim())
        .filter(l => this.isQualityEntry(l));

      for (const line of lines) {
        const promoted = this.stageCandidate(line, 'show_tell', stepLabel);
        if (promoted) learned = true;
      }
    }

    // Trope warnings
    if (tropeWarningsRaw && tropeWarningsRaw.toLowerCase() !== 'none') {
      const warnings = tropeWarningsRaw.split('\n')
        .map(l => l.replace(/^[-*]\s*/, '').trim())
        .filter(l => l.length > 10);
      for (const w of warnings) {
        if (!this.dna.globalRules.tropeWarnings.includes(w)) {
          this.dna.globalRules.tropeWarnings.push(w);
          learned = true;
        }
      }
    }

    if (learned) {
      this.dirty = true;
      this.save();
      this.log.info('Style DNA learned from failure', {
        stepLabel,
        totalBannedWords: this.dna.globalRules.bannedFilterWords.length,
        totalExamples: this.dna.globalRules.showVsTellExamples.length,
      });
    }

    return learned;
  }

  /**
   * Record prose metric measurements for a completed chapter.
   * Called by the POV gate after every chapter (pass or fail) to build
   * a rolling trend history. compileSeed() reads this to generate
   * dynamic, data-driven warnings for the NEXT chapter's prompt.
   *
   * @param metrics — The ProseMetrics snapshot from ProseMetricsService.analyze()
   */
  learnFromMetrics(
    projectId: string,
    chapterNum: number,
    chapterLabel: string,
    metrics: {
      avgSentenceLength: number;
      sentenceMonotonyPct: number;
      heTheOpeningRatePct: number;
      adverbDensityPct: number;
      uniqueWordRatio: number;
      toBeVerbDensityPct: number;
      fragmentCount: number;
    },
  ): void {
    // Ensure project override exists
    if (!this.dna.projectOverrides[projectId]) {
      this.dna.projectOverrides[projectId] = {
        allowedExceptions: [],
        additionalBans: [],
        styleProfile: { learnedPatterns: [] },
        proseMetricsTrends: [],
      };
    }
    if (!this.dna.projectOverrides[projectId].proseMetricsTrends) {
      this.dna.projectOverrides[projectId].proseMetricsTrends = [];
    }

    const trend: ProseMetricsTrend = {
      chapterNum,
      chapterLabel,
      recordedAt: new Date().toISOString(),
      avgSentenceLength: metrics.avgSentenceLength,
      sentenceMonotonyPct: metrics.sentenceMonotonyPct,
      heTheOpeningRatePct: metrics.heTheOpeningRatePct,
      adverbDensityPct: metrics.adverbDensityPct,
      uniqueWordRatio: metrics.uniqueWordRatio,
      toBeVerbDensityPct: metrics.toBeVerbDensityPct,
      fragmentCount: metrics.fragmentCount,
    };

    const trends = this.dna.projectOverrides[projectId].proseMetricsTrends;
    // Keep only the last 10 chapters to prevent unbounded growth
    trends.push(trend);
    if (trends.length > 10) {
      this.dna.projectOverrides[projectId].proseMetricsTrends = trends.slice(-10);
    }

    this.dirty = true;
    this.save();

    this.log.info('Style DNA: prose metrics trend recorded', {
      projectId, chapterNum, chapterLabel,
      monotony: `${metrics.sentenceMonotonyPct}%`,
      heTheOpeners: `${metrics.heTheOpeningRatePct}%`,
      avgSentLen: metrics.avgSentenceLength,
    });
  }

  /**
   * Get the global rules object containing positive and negative directives.
   */
  public getGlobalRules(): GlobalRules {
    return this.dna.globalRules;
  }

  /**
   * Post-write lint: scan prose for violations of the global DNA ban lists
   * and return a structured list of matches. Used by step-runner after a
   * writer-routed step completes so the async-quality-audit worker can flag
   * stylistic concerns WITHOUT us having to inject the ban lists into the
   * writer's prompt (the LoRA already encodes them).
   *
   * Returns matches grouped by category. Filter words are matched as whole
   * words (word boundary); phrases are substring (case-insensitive). Each
   * match carries the offending text + a small surrounding snippet so the
   * dashboard / worker can show context. Capped at 50 matches per category
   * to keep audit payloads bounded.
   */
  public lintProse(text: string, opts: { maxMatchesPerCategory?: number } = {}): {
    filterWords: Array<{ word: string; count: number; snippet: string }>;
    phrases: Array<{ phrase: string; count: number; snippet: string }>;
    totalMatches: number;
  } {
    const max = opts.maxMatchesPerCategory ?? 50;
    const rules = this.dna.globalRules;
    const filterWords: Array<{ word: string; count: number; snippet: string }> = [];
    const phrases: Array<{ phrase: string; count: number; snippet: string }> = [];

    const snippetAround = (idx: number, len: number): string => {
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + len + 40);
      return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
    };

    for (const word of rules.bannedFilterWords || []) {
      if (!word) continue;
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const matches = [...text.matchAll(re)];
      if (matches.length > 0 && filterWords.length < max) {
        filterWords.push({ word, count: matches.length, snippet: snippetAround(matches[0].index ?? 0, word.length) });
      }
    }
    for (const phrase of rules.bannedPhrases || []) {
      if (!phrase) continue;
      const lower = text.toLowerCase();
      const target = phrase.toLowerCase();
      let count = 0;
      let firstIdx = -1;
      let from = 0;
      while (true) {
        const idx = lower.indexOf(target, from);
        if (idx === -1) break;
        if (count === 0) firstIdx = idx;
        count++;
        from = idx + target.length;
      }
      if (count > 0 && phrases.length < max) {
        phrases.push({ phrase, count, snippet: snippetAround(firstIdx, phrase.length) });
      }
    }

    return {
      filterWords,
      phrases,
      totalMatches: filterWords.reduce((s, m) => s + m.count, 0) + phrases.reduce((s, m) => s + m.count, 0),
    };
  }

  /**
   * Apply a raw list of DO/AVOID improvement directives to the global DNA.
   * This is used by the Style Calibration pipeline to automatically upgrade
   * the global rules at the end of a run.
   */
  public applyDirectivesToGlobal(positive: string[], negative: string[], overwrite: boolean = false): void {
    if ((!positive || positive.length === 0) && (!negative || negative.length === 0)) return;
    
    let added = 0;

    if (overwrite) {
      if (positive && positive.length > 0) {
        this.dna.globalRules.positiveDirectives = [...positive];
        added++;
      }
      if (negative && negative.length > 0) {
        this.dna.globalRules.tropeWarnings = [...negative];
        added++;
      }
    } else {
      if (positive && positive.length > 0) {
        if (!this.dna.globalRules.positiveDirectives) {
          this.dna.globalRules.positiveDirectives = [];
        }
        for (const directive of positive) {
          if (!this.dna.globalRules.positiveDirectives.includes(directive)) {
            this.dna.globalRules.positiveDirectives.push(directive);
            added++;
          }
        }
      }

      if (negative && negative.length > 0) {
        for (const directive of negative) {
          if (!this.dna.globalRules.tropeWarnings.includes(directive)) {
            this.dna.globalRules.tropeWarnings.push(directive);
            added++;
          }
        }
      }
    }

    if (added > 0) {
      this.dirty = true;
      this.save();
      this.log.info(overwrite ? 'Auto-compressed Global Style DNA' : 'Auto-applied directives to Global Style DNA', { 
        positiveCount: positive?.length || 0,
        negativeCount: negative?.length || 0
      });
    }
  }

  /**
   * Auto-ban phrases extracted from repeated AI-ism failures.
   * Called by AutoLearningService after each calibration summary pass.
   */
  public addBannedPhrases(phrases: string[]): void {
    if (!phrases || phrases.length === 0) return;
    if (!this.dna.globalRules.bannedPhrases) {
      this.dna.globalRules.bannedPhrases = [];
    }
    let added = 0;
    const existingSet = new Set(this.dna.globalRules.bannedPhrases.map((p: string) => p.toLowerCase()));
    for (const phrase of phrases) {
      if (!existingSet.has(phrase.toLowerCase())) {
        this.dna.globalRules.bannedPhrases.push(phrase);
        existingSet.add(phrase.toLowerCase());
        added++;
      }
    }
    if (added > 0) {
      this.dirty = true;
      this.save();
      this.log.info('Auto-banned repeated AI-ism phrases', { count: added, total: this.dna.globalRules.bannedPhrases.length });
    }
  }

  // ── Maintenance ────────────────────────────────────────

  /**
   * Prune stale data to prevent unbounded growth.
   * - Show-vs-tell examples older than `maxAgeDays` are removed
   * - Character voices not updated in `maxAgeDays` get their lists trimmed
   */
  prune(maxAgeDays: number = 90): { removed: number } {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    // Prune old show-vs-tell examples
    const before = this.dna.globalRules.showVsTellExamples.length;
    this.dna.globalRules.showVsTellExamples = this.dna.globalRules.showVsTellExamples.filter(e => {
      return new Date(e.addedAt).getTime() > cutoff;
    });
    removed += before - this.dna.globalRules.showVsTellExamples.length;

    // Trim old character voice signatures (keep the 5 most recent)
    for (const [projId, chars] of Object.entries(this.dna.characterVoices)) {
      for (const [charName, voice] of Object.entries(chars)) {
        if (new Date(voice.learnedAt).getTime() < cutoff) {
          voice.signature = voice.signature.slice(-5);
        }
      }
    }

    if (removed > 0) {
      this.dirty = true;
      this.save();
      this.log.info('Style DNA pruned', { removedExamples: removed });
    }

    return { removed };
  }

  /** Get the full DNA for debugging/dashboard display. */
  getRaw(): StyleDna {
    return this.dna;
  }

  // ── Helpers ────────────────────────────────────────────

  private ensureCharacterVoice(projectId: string, character: string): void {
    if (!this.dna.characterVoices[projectId]) {
      this.dna.characterVoices[projectId] = {};
    }
    if (!this.dna.characterVoices[projectId][character]) {
      this.dna.characterVoices[projectId][character] = {
        bannedInPOV: [],
        signature: [],
        learnedAt: new Date().toISOString(),
      };
    }
  }

  // ── Candidate Staging (Quality Vetting) ────────────────

  /**
   * Validate an entry before it can enter staging.
   * Rejects LLM meta-commentary, overly vague, or garbage entries.
   */
  private isQualityEntry(text: string): boolean {
    if (!text || text.length < 15) return false;
    if (text.length > 300) return false; // Too long = LLM dumped a paragraph

    const lower = text.toLowerCase();

    // Reject LLM meta-commentary patterns
    const metaPatterns = [
      'violations**', 'issues**', '**issues', 'alert_level',
      'examples_to_avoid', 'rule:', 'minor overuse',
      'could benefit from', 'slight reliance',
      'the narrative is', 'overall', 'in general',
      'could be strengthened', 'some passages',
    ];
    if (metaPatterns.some(p => lower.includes(p))) return false;

    // Must contain a quoted prose example (the actual violation)
    // or start with a recognizable "Avoid:" / violation prefix
    const hasQuote = /[""\u201C\u201D]/.test(text);
    const hasAvoidPrefix = /^avoid/i.test(text);
    const hasTellsPrefix = /\(tells?\b/i.test(text);
    if (!hasQuote && !hasAvoidPrefix && !hasTellsPrefix) return false;

    return true;
  }

  /**
   * Stage a candidate entry. If it's been seen enough times, promote it.
   * Returns true if the entry was promoted to permanent DNA.
   */
  private stageCandidate(text: string, type: 'show_tell' | 'trope', stepLabel: string): boolean {
    // Ensure candidates array exists (migration from old data)
    if (!this.dna.candidates) this.dna.candidates = [];

    // Check if already in permanent DNA
    if (type === 'show_tell') {
      const existing = this.dna.globalRules.showVsTellExamples;
      if (existing.some(e => e.bad === text) || this.isFuzzyDuplicate(text, existing)) {
        return false; // Already promoted
      }
    }

    // Check if already a candidate (fuzzy match)
    const candidateMatch = this.dna.candidates.find(c =>
      c.type === type && (c.text === text || this.isFuzzyCandidateDuplicate(text, c.text))
    );

    const now = new Date().toISOString();

    if (candidateMatch) {
      // Increment count (only if from a different step to prevent same-chapter inflation)
      if (candidateMatch.lastSeenFrom !== stepLabel) {
        candidateMatch.seenCount++;
        candidateMatch.lastSeenFrom = stepLabel;
        candidateMatch.lastSeenAt = now;
        this.dirty = true;

        this.log.debug('Candidate seen again', {
          text: text.slice(0, 60),
          seenCount: candidateMatch.seenCount,
          threshold: PROMOTION_THRESHOLD,
        });

        // Check for promotion
        if (candidateMatch.seenCount >= PROMOTION_THRESHOLD) {
          return this.promoteCandidate(candidateMatch);
        }
      }
      return false;
    }

    // New candidate — add to staging
    this.dna.candidates.push({
      text,
      type,
      seenCount: 1,
      firstSeenFrom: stepLabel,
      lastSeenFrom: stepLabel,
      firstSeenAt: now,
      lastSeenAt: now,
    });

    // Cap candidates list
    if (this.dna.candidates.length > MAX_CANDIDATES) {
      this.dna.candidates = this.dna.candidates.slice(-MAX_CANDIDATES);
    }

    this.dirty = true;
    this.save();

    this.log.info('New DNA candidate staged', {
      type,
      text: text.slice(0, 60),
      threshold: PROMOTION_THRESHOLD,
    });

    return false;
  }

  /**
   * Promote a candidate to permanent DNA after meeting the frequency threshold.
   */
  private promoteCandidate(candidate: StyleCandidate): boolean {
    if (candidate.type === 'show_tell') {
      const existing = this.dna.globalRules.showVsTellExamples;
      if (!this.isFuzzyDuplicate(candidate.text, existing)) {
        existing.push({
          bad: candidate.text,
          learnedFrom: `${candidate.firstSeenFrom} (+${candidate.seenCount - 1} more)`,
          addedAt: new Date().toISOString(),
        });

        // Prune if over limit
        if (existing.length > MAX_SHOW_TELL_EXAMPLES) {
          this.dna.globalRules.showVsTellExamples = existing.slice(-MAX_SHOW_TELL_EXAMPLES);
        }
      }
    } else if (candidate.type === 'trope') {
      if (!this.dna.globalRules.tropeWarnings.includes(candidate.text)) {
        this.dna.globalRules.tropeWarnings.push(candidate.text);
      }
    }

    // Remove from candidates
    this.dna.candidates = this.dna.candidates.filter(c => c !== candidate);
    this.dirty = true;
    this.save();

    this.log.info('DNA candidate PROMOTED to permanent', {
      type: candidate.type,
      text: candidate.text.slice(0, 60),
      seenCount: candidate.seenCount,
    });

    return true;
  }

  /** Fuzzy compare two candidate texts (Jaccard on significant words) */
  private isFuzzyCandidateDuplicate(a: string, b: string): boolean {
    const aWords = this.extractSignificantWords(a);
    const bWords = this.extractSignificantWords(b);
    if (aWords.size < 3 || bWords.size < 3) return false;
    const intersection = new Set([...aWords].filter(w => bWords.has(w)));
    const union = new Set([...aWords, ...bWords]);
    return (intersection.size / union.size) > 0.6;
  }

  // ── Deduplication ──────────────────────────────────────

  /**
   * Check if a new example is a fuzzy duplicate of any existing one.
   * Uses word-level Jaccard similarity with a 60% threshold.
   */
  private isFuzzyDuplicate(newText: string, existing: ShowTellExample[]): boolean {
    const newWords = this.extractSignificantWords(newText);
    if (newWords.size < 3) return false;

    for (const e of existing) {
      const existingWords = this.extractSignificantWords(e.bad);
      const intersection = new Set([...newWords].filter(w => existingWords.has(w)));
      const union = new Set([...newWords, ...existingWords]);
      const similarity = intersection.size / union.size;
      if (similarity > 0.6) return true;
    }
    return false;
  }

  /** Extract significant words (strip articles, prepositions, quotes) */
  private extractSignificantWords(text: string): Set<string> {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'was', 'were', 'are', 'of', 'in', 'to',
      'and', 'or', 'for', 'it', 'its', 'his', 'her', 'this', 'that', 'with', 'from', 'by',
      'not', 'but', 'be', 'at', 'on', 'as', 'than', 'so', 'if', 'no', 'do', 'did']);
    return new Set(
      text.toLowerCase()
        .replace(/[\x22\x27\u2018\u2019\u201C\u201D\-\u2014()\[\]]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w))
    );
  }

  /**
   * One-time deduplication of all show/tell examples.
   * Keeps only examples that are sufficiently unique (Jaccard < 60%).
   */
  deduplicate(): { removed: number } {
    const original = this.dna.globalRules.showVsTellExamples;
    if (original.length <= 1) return { removed: 0 };

    const unique: ShowTellExample[] = [];
    for (const example of original) {
      if (!this.isFuzzyDuplicate(example.bad, unique)) {
        unique.push(example);
      }
    }

    const removed = original.length - unique.length;
    if (removed > 0) {
      this.dna.globalRules.showVsTellExamples = unique;
      this.dirty = true;
      this.save();
    }

    return { removed };
  }
}
