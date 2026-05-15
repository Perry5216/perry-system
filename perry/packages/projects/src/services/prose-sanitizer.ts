/**
 * @perry/projects — Prose Sanitizer
 *
 * Cleans raw LLM prose output for manuscript-quality formatting.
 * Extracted from step-runner.ts to isolate formatting concerns.
 */

export class ProseSanitizer {
  /**
   * Clean up raw LLM prose output for manuscript-quality formatting.
   * - Replaces Markdown scene breaks (*** / --- / ___) with a clean scene break marker
   * - Strips stray bold/italic markdown from prose (keeps dialogue and emphasis clean)
   * - Removes meta-commentary lines the LLM sometimes injects
   */
  sanitize(text: string): string {
    let clean = text;

    // Strip <think>...</think> blocks emitted by Qwen3 and other hybrid thinking models.
    // These appear when injected context contains thinking tags from a prior run, or when
    // the model partially enters thinking mode despite not being in /think mode.
    // Must run FIRST before any other pass so downstream patterns don't match think content.
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // Strip <pre_flight>...</pre_flight> Chain of Thought blocks used to enforce negative constraints.
    clean = clean.replace(/<pre_flight>[\s\S]*?<\/pre_flight>/gi, '');

    // Strip Markdown code blocks (```...```) - manuscript prose should never have code blocks.
    // This catches fake [WARNING: PROSE STYLE CONTRACT VIOLATION DETECTED] linter blocks.
    clean = clean.replace(/```[\s\S]*?```/gi, '');

    // Strip [WARNING: ...] style linter blocks that might appear without markdown code blocks.
    clean = clean.replace(/\[WARNING:[\s\S]*?(?:CORRECTION REQUIRED.*|\]\n+)/gi, '');

    // Fix 4: Replace ALL common Markdown scene-break forms (including ---) with ⁂.
    // Previously --- fell through to the meta-pattern stripper and was deleted entirely.
    // Now all scene break variants are normalised here first.
    clean = clean.replace(/^\s*(\*\s*\*\s*\*+|-\s*-\s*-+|_\s*_\s*_+)\s*$/gm, '\n⁂\n');

    // Remove lines that are just markdown headers within prose (##, ###)
    // but keep # (the main title is added by saveStepToDisk, not the LLM)
    clean = clean.replace(/^#{2,}\s+.*$/gm, '');

    // Strip bold markers (**text**) but keep the text — except inside dialogue
    // This catches LLM habits like **Chapter 1** or **Scene Break** annotations
    clean = clean.replace(/\*\*([^*]+)\*\*/g, '$1');

    // Strip stray single asterisks used for italic when they wrap entire lines
    // (keeps inline *emphasis* in dialogue)
    clean = clean.replace(/^\*([^*\n]+)\*$/gm, '$1');

    // Remove common LLM meta-commentary lines
    const metaPatterns = [
      /^\s*\[.*word count.*\]\s*$/gim,
      /^\s*\[.*end of chapter.*\]\s*$/gim,
      /^\s*\[.*scene break.*\]\s*$/gim,
      /^\s*\[.*continued.*\]\s*$/gim,
      // Magnum 32B / Qwen annotation artifacts — model writes internal notes in [brackets]
      /^\s*\[Narrator.*\]\s*$/gim,
      /^\s*\[Technique:.*\]\s*$/gim,
      /^\s*\[Note:.*\]\s*$/gim,
      /^\s*\[POV.*\]\s*$/gim,
      /^\s*\[.*voice.*\]\s*$/gim,
      /^\s*\[.*anchor.*\]\s*$/gim,
      /^\s*\[.*audit.*\]\s*$/gim,
      // Strip any remaining generic square-bracket-only metadata lines
      /^\s*\[[^\]]{5,120}\]\s*$/gim,
      // NOTE: do NOT add /---/ here — it is now handled above as a scene break
    ];
    for (const pattern of metaPatterns) {
      clean = clean.replace(pattern, '');
    }

    // Strip "(Continued)" or "(continued)" often appended to headers by the LLM during segmented generation
    clean = clean.replace(/\s*\(Continued\)/gi, '');

    // Aggressive strip for conversational filler
    clean = clean.replace(/^(Okay,? )?(Here is|Here's|Below is)[^:\n]{0,100}:?\s*$/gim, '');
    clean = clean.replace(/^\s*\([^)]*word limit[^)]*\)\s*$/gim, '');
    clean = clean.replace(/^I believe this revision aligns.*$/gim, '');
    clean = clean.replace(/^Let me know if you('d| would) like any further refinements!*.*$/gim, '');
    
    // Strip audit rejection preamble block (including list of intentions)
    clean = clean.replace(/^(#+\s*)?RESPONSE TO AUDIT REJECTION[\s\S]*?(Here is a rewrite|Here is the rewrite).*?:?\n+/gi, '');
    
    // Strip conversational postambles
    clean = clean.replace(/^Please let me know if this revision addresses.*$/gim, '');
    clean = clean.replace(/^I('m| am) committed to improving my writing.*$/gim, '');

    // Strip hallucinated placeholder tags like <AWAITING PROSE>
    clean = clean.replace(/<AWAITING PROSE>/gim, '');

    // If the LLM still outputs revision notes (usually at the end), strip them and everything after
    const revNotesMatch = clean.match(/^(?:#+\s*)?(?:Revision Notes|Possible Edits)/im);
    if (revNotesMatch && revNotesMatch.index !== undefined) {
      clean = clean.substring(0, revNotesMatch.index);
    }

    // Strip non-English characters (CJK, Cyrillic, Arabic, etc.)
    // Preserves: ASCII, Latin Extended (accents é, ñ, etc.), common punctuation, em-dashes, curly quotes
    clean = clean.replace(/[\u3000-\u9FFF\uF900-\uFAFF\u2E80-\u2FFF\u0400-\u04FF\u0600-\u06FF\uAC00-\uD7AF]/g, '');

    // Clean up any double-spaces or orphaned punctuation left after stripping
    clean = clean.replace(/  +/g, ' ');

    // Collapse excessive blank lines (more than 2) into exactly 2
    clean = clean.replace(/\n{4,}/g, '\n\n\n');

    // Trim leading/trailing whitespace
    clean = clean.trim();

    return clean;
  }

  /**
   * Strip internal segment/part headers left by the segmented generation pipeline.
   * Used by both draft_compile and revision_compile to produce clean prose.
   */
  stripSegmentHeaders(text: string): string {
    let cleaned = text.replace(/^(#+\s*).*(part|segment)\s*\d+.*$/gim, '');
    cleaned = cleaned.replace(/^(?:\*\*)?(part|segment)\s*\d+.*(?:\*\*)?$/gim, '');
    cleaned = cleaned.replace(/^(#+\s*)?continuation.*$/gim, '');
    cleaned = cleaned.replace(/^#+\s*TEXT SO FAR\s*#*$/gim, '');
    return cleaned.trim();
  }
}
