/**
 * @perry/projects — Prose Metrics Service
 *
 * Replaces the ban-list-growth strategy with measurable prose metrics.
 * After each chapter is generated, this service analyzes the output
 * and returns a structured report with pass/fail verdicts on each metric.
 *
 * If metrics drift outside target ranges, it returns corrective instructions
 * that are injected into the rewrite prompt — NOT added to the permanent
 * Style DNA ban list.
 */

export interface ProseMetrics {
  /** Average number of words per sentence */
  avgSentenceLength: number;
  /** Standard deviation of sentence lengths (higher = more natural) */
  sentenceLengthStdDev: number;
  /** % of sentences within ±5 words of the mean (lower = more varied) */
  sentenceMonotonyPct: number;
  /** Ratio of longest to shortest sentence */
  longShortRatio: number;
  /** % of words that are adverbs (-ly words) */
  adverbDensityPct: number;
  /** Ratio of unique words to total words (higher = richer vocabulary) */
  uniqueWordRatio: number;
  /** % of contractions in dialogue lines (higher = more natural speech) */
  dialogueContractionPct: number;
  /** Average paragraph length in sentences */
  avgParagraphLength: number;
  /** Number of sentence fragments (< 5 words) — indicates human-like variation */
  fragmentCount: number;
  /** Density of "To Be" verbs (was, were, is, are, etc.) — higher = telling/passive voice */
  toBeVerbDensityPct: number;
  /** Total word count */
  wordCount: number;
  /** Density of Em-dashes per 1000 words */
  emDashDensity: number;
  /** Density of Semicolons per 1000 words */
  semicolonDensity: number;
  /** Density of double-hyphens (-- / ---- ) per 1000 words — LoRA artifact */
  doubleDashDensity: number;
  /** Density of ellipses (...) per 1000 words */
  ellipsisDensity: number;
  /** Count of horizontal rules (--- on own line) — section breaks in prose */
  sectionBreakCount: number;
  /** % of words ending in -tion, -ment, -ness, -ity (nominalization density) */
  nominalizationDensityPct: number;
  /** % of sentences using passive voice (was being, were being, had been, etc.) */
  passiveVoicePct: number;
  /** % of sentences starting with He/She/The — monotone AI opener pattern */
  heTheOpeningRatePct: number;
}

export interface MetricTarget {
  min: number;
  max: number;
  label: string;
}

export interface ProseMetricsReport {
  metrics: ProseMetrics;
  passes: string[];
  failures: string[];
  overallPass: boolean;
  /** Corrective instructions for the rewrite prompt if any metrics failed */
  correctiveInstructions: string | null;
}

// Default targets — these produce natural-sounding prose
const DEFAULT_TARGETS: Record<keyof Omit<ProseMetrics, 'wordCount'>, MetricTarget> = {
  avgSentenceLength:     { min: 10, max: 20, label: 'Avg sentence length' },
  sentenceLengthStdDev:  { min: 6, max: 999, label: 'Sentence length variation' },
  sentenceMonotonyPct:   { min: 0, max: 80, label: 'Sentence monotony' },
  longShortRatio:        { min: 3, max: 999, label: 'Long/short sentence ratio' },
  adverbDensityPct:      { min: 0, max: 2.5, label: 'Adverb density' },
  uniqueWordRatio:       { min: 0.40, max: 1, label: 'Vocabulary richness' },
  dialogueContractionPct:{ min: 20, max: 100, label: 'Dialogue contraction rate' },
  avgParagraphLength:    { min: 1.5, max: 6, label: 'Avg paragraph length' },
  fragmentCount:         { min: 3, max: 999, label: 'Sentence fragments' },
  toBeVerbDensityPct:    { min: 0, max: 4.5, label: '"To Be" verb density (Telling index)' },
  emDashDensity:         { min: 0, max: 4, label: 'Em-dash density (per 1000 words)' },
  semicolonDensity:      { min: 0, max: 4, label: 'Semicolon density (per 1000 words)' },
  doubleDashDensity:     { min: 0, max: 1, label: 'Double-dash density (-- per 1000 words)' },
  ellipsisDensity:       { min: 0, max: 2, label: 'Ellipsis density (... per 1000 words)' },
  sectionBreakCount:     { min: 0, max: 1, label: 'Section break count (--- horizontal rules)' },
  nominalizationDensityPct: { min: 0, max: 3, label: 'Nominalization density (-tion/-ment/-ness/-ity words)' },
  passiveVoicePct:       { min: 0, max: 15, label: 'Passive voice density' },
  heTheOpeningRatePct:   { min: 0, max: 50, label: 'He/She/The sentence-opener rate' },
};

export class ProseMetricsService {
  /**
   * Analyze a prose text and return structured metrics.
   */
  analyze(text: string): ProseMetrics {
    const cleanText = this.stripMarkdownHeaders(text);
    const sentences = this.splitSentences(cleanText);
    const words = cleanText.split(/\s+/).filter(w => w.length > 0);
    const paragraphs = cleanText.split(/\n\s*\n/).filter(p => p.trim().length > 0);

    // Sentence lengths
    const sentenceLengths = sentences.map(s => s.split(/\s+/).filter(w => w.length > 0).length);
    const avgLen = sentenceLengths.length > 0
      ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
      : 0;

    // Standard deviation
    const variance = sentenceLengths.length > 1
      ? sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgLen, 2), 0) / sentenceLengths.length
      : 0;
    const stdDev = Math.sqrt(variance);

    // Monotony: % of sentences within ±5 words of the mean
    const monotoneCount = sentenceLengths.filter(len => Math.abs(len - avgLen) <= 5).length;
    const monotonyPct = sentenceLengths.length > 0
      ? (monotoneCount / sentenceLengths.length) * 100
      : 0;

    // Long/short ratio
    const sorted = [...sentenceLengths].sort((a, b) => a - b);
    const shortest = sorted[0] || 1;
    const longest = sorted[sorted.length - 1] || 1;
    const longShortRatio = shortest > 0 ? longest / shortest : 1;

    // Adverb density (words ending in -ly, excluding common non-adverbs)
    const nonAdverbs = new Set(['only', 'early', 'holy', 'ugly', 'July', 'family', 'really', 'likely',
      'friendly', 'lonely', 'daily', 'belly', 'ally', 'bully', 'rally', 'tally', 'jelly', 'lily',
      'supply', 'apply', 'reply', 'fly', 'rely', 'sly', 'multiply', 'italy', 'Sicily']);
    const adverbs = words.filter(w => {
      const lower = w.toLowerCase().replace(/[^a-z]/g, '');
      return lower.endsWith('ly') && lower.length > 3 && !nonAdverbs.has(lower);
    });
    const adverbDensity = words.length > 0 ? (adverbs.length / words.length) * 100 : 0;

    // Unique word ratio
    const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z']/g, '')).filter(w => w.length > 0));
    const uniqueRatio = words.length > 0 ? uniqueWords.size / words.length : 0;

    // Dialogue contraction rate
    const dialogueLines = this.extractDialogueLines(cleanText);
    let contractionPct = 100; // Default pass if no dialogue
    const dialogueWords = dialogueLines.join(' ').split(/\s+/).filter(w => w.length > 0);
    // Only evaluate if there are enough dialogue words to be statistically meaningful.
    // A chapter with 3 short lines and one robot/AI speaker can't be fairly graded
    // on contraction naturalness — the robotic voice is intentional worldbuilding.
    if (dialogueWords.length >= 100) {
      const contractions = dialogueWords.filter(w => /\w'\w/.test(w) || /\w\u2019\w/.test(w));
      contractionPct = (contractions.length / dialogueWords.length) * 100;
      // Scale: 5% contractions ≈ 50% rate, 10%+ ≈ 100%
      contractionPct = Math.min(100, contractionPct * 10);
    }

    // Average paragraph length (in sentences)
    const paragraphSentenceCounts = paragraphs.map(p => this.splitSentences(p).length);
    const avgParaLen = paragraphSentenceCounts.length > 0
      ? paragraphSentenceCounts.reduce((a, b) => a + b, 0) / paragraphSentenceCounts.length
      : 0;

    // Fragment count (sentences with < 5 words)
    const fragments = sentenceLengths.filter(len => len > 0 && len < 5).length;

    // To Be Verb Density
    const toBeVerbs = new Set(['is', 'are', 'was', 'were', 'am', 'be', 'been', 'being']);
    const toBeCount = words.filter(w => toBeVerbs.has(w.toLowerCase().replace(/[^a-z]/g, ''))).length;
    const toBeDensity = words.length > 0 ? (toBeCount / words.length) * 100 : 0;

    // Em-dashes and Semicolons
    const emDashCount = (text.match(/—/g) || []).length;
    const semicolonCount = (text.match(/;/g) || []).length;
    const emDashDensity = words.length > 0 ? (emDashCount / words.length) * 1000 : 0;
    const semicolonDensity = words.length > 0 ? (semicolonCount / words.length) * 1000 : 0;

    // Double-dashes (-- or ---- etc.) — LoRA training artifact. Catches 2+ hyphens.
    const doubleDashCount = (text.match(/-{2,}/g) || []).length;
    const doubleDashDensity = words.length > 0 ? (doubleDashCount / words.length) * 1000 : 0;

    // Ellipses (... or ....)
    const ellipsisCount = (text.match(/\.{3,}/g) || []).length;
    const ellipsisDensity = words.length > 0 ? (ellipsisCount / words.length) * 1000 : 0;

    // Section breaks (--- on its own line) — horizontal rules in prose
    const sectionBreakCount = (text.match(/^\s*-{3,}\s*$/gm) || []).length;

    return {
      avgSentenceLength: Math.round(avgLen * 10) / 10,
      sentenceLengthStdDev: Math.round(stdDev * 10) / 10,
      sentenceMonotonyPct: Math.round(monotonyPct * 10) / 10,
      longShortRatio: Math.round(longShortRatio * 10) / 10,
      adverbDensityPct: Math.round(adverbDensity * 100) / 100,
      uniqueWordRatio: Math.round(uniqueRatio * 100) / 100,
      dialogueContractionPct: Math.round(contractionPct),
      avgParagraphLength: Math.round(avgParaLen * 10) / 10,
      fragmentCount: fragments,
      toBeVerbDensityPct: Math.round(toBeDensity * 100) / 100,
      wordCount: words.length,
      emDashDensity: Math.round(emDashDensity * 10) / 10,
      semicolonDensity: Math.round(semicolonDensity * 10) / 10,
      doubleDashDensity: Math.round(doubleDashDensity * 10) / 10,
      ellipsisDensity: Math.round(ellipsisDensity * 10) / 10,
      sectionBreakCount,
      nominalizationDensityPct: Math.round(this.measureNominalizationDensity(words) * 100) / 100,
      passiveVoicePct: Math.round(this.measurePassiveVoice(sentences) * 100) / 100,
      heTheOpeningRatePct: Math.round(this.measureHeTheOpeners(sentences) * 100) / 100,
    };
  }

  /**
   * Evaluate metrics against targets and return a pass/fail report.
   */
  evaluate(metrics: ProseMetrics, customTargets?: Partial<Record<keyof ProseMetrics, MetricTarget>>): ProseMetricsReport {
    const targets = { ...DEFAULT_TARGETS, ...customTargets };
    const passes: string[] = [];
    const failures: string[] = [];

    for (const [key, target] of Object.entries(targets)) {
      const value = metrics[key as keyof ProseMetrics];
      if (value === undefined) continue;

      if (value >= target.min && value <= target.max) {
        passes.push(`✅ ${target.label}: ${value} (target: ${target.min}-${target.max})`);
      } else {
        const direction = value < target.min ? 'too low' : 'too high';
        failures.push(`❌ ${target.label}: ${value} (${direction}, target: ${target.min}-${target.max})`);
      }
    }

    // Build corrective instructions if there are failures
    let correctiveInstructions: string | null = null;
    if (failures.length > 0) {
      const instructions: string[] = ['## PROSE METRICS CORRECTIONS (from automated analysis)'];

      if (metrics.sentenceLengthStdDev < 6) {
        instructions.push('- SENTENCE VARIATION IS TOO LOW: Aggressively vary sentence length. Use 3-word fragments followed by 25+ word compound sentences.');
      }
      if (metrics.sentenceMonotonyPct > 50) {
        instructions.push('- SENTENCE RHYTHM IS MONOTONOUS: Too many sentences are similar length. Break the pattern with very short or very long sentences.');
      }
      if (metrics.adverbDensityPct > 2.5) {
        instructions.push(`- ADVERB DENSITY IS ${metrics.adverbDensityPct.toFixed(1)}%: Replace adverbs with stronger verbs. "She walked quickly" → "She bolted".`);
      }
      if (metrics.uniqueWordRatio < 0.40) {
        instructions.push('- VOCABULARY IS REPETITIVE: Use more varied word choices. Avoid repeating the same words within a paragraph.');
      }
      if (metrics.dialogueContractionPct < 40) {
        instructions.push('- DIALOGUE SOUNDS TOO FORMAL: Real people use contractions. "I am" → "I\'m", "cannot" → "can\'t", "do not" → "don\'t".');
      }
      if (metrics.fragmentCount < 3) {
        instructions.push('- PROSE LACKS FRAGMENTS: Include intentional sentence fragments for rhythm and emphasis. "Just like that." "Nothing." "Gone."');
      }
      if (metrics.toBeVerbDensityPct > 4.5) {
        instructions.push(`- EXCESSIVE TELLING DETECTED ("To Be" Verb Density: ${metrics.toBeVerbDensityPct.toFixed(1)}%): You are using too many state-of-being verbs (was, were, is, are). This means you are TELLING the reader states instead of SHOWING actions. Convert "was/were" statements into active verbs.`);
      }
      if (metrics.emDashDensity > 6) {
        instructions.push(`- EXCESSIVE EM-DASHES DETECTED: You used ${metrics.emDashDensity.toFixed(1)} em-dashes per 1000 words. Stop using em-dashes as a crutch for false thoughtfulness. Use periods and active sentences instead.`);
      }
      if (metrics.semicolonDensity > 4) {
        instructions.push(`- EXCESSIVE SEMICOLONS DETECTED: You used ${metrics.semicolonDensity.toFixed(1)} semicolons per 1000 words. Stop using semicolons to create false sophistication. Break compound sentences into shorter, punchy sentences.`);
      }
      if (metrics.doubleDashDensity > 1) {
        instructions.push(`- DOUBLE-DASH ARTIFACTS DETECTED: You used ${metrics.doubleDashDensity.toFixed(1)} instances of double-dashes (--) or triple-dashes (---) per 1000 words. NEVER use - or -- or --- as punctuation. Use proper em-dashes (—) sparingly, or restructure the sentence with periods and commas. Each -- is a sign of lazy prose.`);
      }
      if (metrics.ellipsisDensity > 2) {
        instructions.push(`- EXCESSIVE ELLIPSES DETECTED: You used ${metrics.ellipsisDensity.toFixed(1)} ellipses (...) per 1000 words. NEVER use ellipses to trail off thoughts. Finish your sentences with hard periods. Ellipses are lazy and weaken prose.`);
      }
      if (metrics.sectionBreakCount > 1) {
        instructions.push(`- EXCESSIVE SECTION BREAKS: You inserted ${metrics.sectionBreakCount} horizontal rules (---). Prose should flow continuously. Remove ALL section breaks unless a genuine time-skip or POV change requires one. Use paragraph breaks instead.`);
      }
      if (metrics.avgParagraphLength > 6) {
        instructions.push('- PARAGRAPHS ARE TOO LONG: Break long paragraphs. Use single-sentence paragraphs for dramatic beats.');
      }
      if (metrics.nominalizationDensityPct > 3) {
        instructions.push(`- EXCESSIVE NOMINALIZATION DETECTED (${metrics.nominalizationDensityPct.toFixed(1)}%): Too many abstract nouns ending in -tion, -ment, -ness, -ity. Convert these back to active verbs. "synchronization" → "synchronize", "fragmentation" → "fragment", "optimization" → "optimize". The reader wants ACTION, not ABSTRACTION.`);
      }
      if (metrics.passiveVoicePct > 15) {
        instructions.push(`- EXCESSIVE PASSIVE VOICE (${metrics.passiveVoicePct.toFixed(1)}%): Too many sentences use passive constructions ("was being", "were being", "had been"). Rewrite as active voice. "He was being compressed" → "The system compressed him". "The door was opened" → "She kicked the door open".`);
      }
      if (metrics.heTheOpeningRatePct > 40) {
        instructions.push(`- MONOTONE SENTENCE OPENERS (${metrics.heTheOpeningRatePct.toFixed(1)}% start with He/She/The): You are defaulting to robotic sentence structure. Start sentences with: action verbs, adverbial phrases, objects, dialogue, or environmental details. Never start two sentences in a row with the same word.`);
      }

      correctiveInstructions = instructions.join('\n');
    }

    return {
      metrics,
      passes,
      failures,
      overallPass: failures.length === 0,
      correctiveInstructions,
    };
  }

  // ── Helpers ────────────────────────────────────────────

  private stripMarkdownHeaders(text: string): string {
    return text.replace(/^#{1,6}\s+.*$/gm, '').trim();
  }

  private splitSentences(text: string): string[] {
    // Split on sentence-ending punctuation followed by whitespace or end-of-string
    return text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && /[a-zA-Z]/.test(s));
  }

  private extractDialogueLines(text: string): string[] {
    const lines: string[] = [];
    // Match text inside quotation marks (various styles)
    const patterns = [
      /["\u201C]([^"\u201D]+)["\u201D]/g,    // Smart quotes
      /"([^"]+)"/g,           // Standard quotes
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match[1] && match[1].length > 5) {
          lines.push(match[1]);
        }
      }
    }
    return lines;
  }

  /**
   * Measure nominalization density: % of words ending in -tion, -ment, -ness, -ity.
   * These abstract nouns derived from verbs are a hallmark of AI prose.
   */
  private measureNominalizationDensity(words: string[]): number {
    if (words.length === 0) return 0;
    // Common false positives to exclude
    const exceptions = new Set([
      'not', 'it', 'that', 'at', 'but', 'what', 'moment', 'comment',
      'government', 'apartment', 'city', 'pity', 'bit', 'hit', 'sit',
      'fit', 'kit', 'wit', 'grit', 'spit', 'lit', 'unit', 'exit',
      'admit', 'permit', 'submit', 'emit', 'orbit', 'habit', 'rabbit',
      'spirit', 'visit', 'merit', 'limit', 'digit', 'credit', 'edit',
      'nation', 'station', 'mention', 'attention', 'section', 'action',
      'question', 'position', 'condition', 'tradition', 'addition',
      'emotion', 'motion', 'notion', 'portion', 'caution',
    ]);
    const nominalSuffixes = /(tion|ment|ness|ity)$/i;
    const nomCount = words.filter(w => {
      const lower = w.toLowerCase().replace(/[^a-z]/g, '');
      return lower.length > 4 && nominalSuffixes.test(lower) && !exceptions.has(lower);
    }).length;
    return (nomCount / words.length) * 100;
  }

  /**
   * Measure passive voice density: % of sentences using passive constructions.
   * Detects "was/were/is/are/has been/had been + being/past participle" patterns.
   */
  private measurePassiveVoice(sentences: string[]): number {
    if (sentences.length === 0) return 0;
    const passivePattern = /\b(was|were|is|are|has been|had been|being)\s+(being\s+)?\w+(ed|en|t)\b/i;
    const passiveCount = sentences.filter(s => passivePattern.test(s)).length;
    return (passiveCount / sentences.length) * 100;
  }

  /**
   * Measure He/She/The sentence-opener rate.
   * A high rate signals robotic, monotone AI sentence structure.
   */
  private measureHeTheOpeners(sentences: string[]): number {
    if (sentences.length === 0) return 0;
    const openerPattern = /^(he|she|the|they|it)\b/i;
    const openerCount = sentences.filter(s => openerPattern.test(s.trim())).length;
    return (openerCount / sentences.length) * 100;
  }
}
