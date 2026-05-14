/**
 * @perry/projects — Deduplication Service
 *
 * Consolidates all duplicate-detection algorithms into a single module:
 * 1. deduplicateOutput() — detects repeated chapter output (whole-chapter duplication)
 * 2. deduplicateContent() — sliding-window sentence deduplication within a chapter
 * 3. scanForCrossChapterDuplicates() — cross-chapter sentence-level scanning at export time
 *
 * Extracted from step-runner.ts to reduce god-object complexity.
 */

import type { Project, ProjectStep, EventBus, Logger } from '@perry/core';

export class DeduplicationService {
  private log: Logger;
  private eventBus: EventBus;

  constructor(log: Logger, eventBus: EventBus) {
    this.log = log;
    this.eventBus = eventBus;
  }

  /**
   * Detect and remove duplicated chapter output.
   *
   * Gemma 4 31B sometimes outputs the entire chapter 2-5 times when it hits
   * the end of the narrative but has remaining generation budget. This method
   * finds the first prose line, then searches for it appearing again later
   * in the text, and truncates everything from that second occurrence onward.
   */
  deduplicateOutput(text: string): string {
    const lines = text.split('\n');

    // Find the first non-empty line (this is the opening of the chapter)
    let firstProseLine = '';
    let firstProseIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().length > 20) { // Skip very short lines (headers, scene breaks)
        firstProseLine = lines[i].trim();
        firstProseIdx = i;
        break;
      }
    }

    if (!firstProseLine || firstProseIdx === -1) return text;

    // Use the first 60 chars as a fingerprint to find repetitions
    const searchKey = firstProseLine.substring(0, Math.min(60, firstProseLine.length));

    // Search for the fingerprint appearing again later in the text
    let duplicateIdx = -1;
    for (let i = firstProseIdx + 3; i < lines.length; i++) { // +3 to skip adjacent lines
      if (lines[i].trim().startsWith(searchKey)) {
        duplicateIdx = i;
        break;
      }
    }

    if (duplicateIdx === -1) return text; // No duplication found

    // Trim trailing blank lines before the cut point
    let cutIdx = duplicateIdx;
    while (cutIdx > 0 && lines[cutIdx - 1].trim() === '') {
      cutIdx--;
    }

    this.log?.info('[dedup] Detected repeated chapter output', {
      firstLine: searchKey.substring(0, 40) + '...',
      originalLines: lines.length,
      keptLines: cutIdx,
    });

    return lines.slice(0, cutIdx).join('\n');
  }

  /**
   * Duplicate Content Safety Check — detects if the AI has re-started
   * the chapter from the beginning during a continuation segment and
   * strips the duplicate half, keeping only the first unique copy.
   *
   * Strategy: splits the text into sentence-sized chunks, then uses a
   * sliding window of 3 consecutive sentences to check if that sequence
   * appears again later in the document. The first re-occurrence marks
   * the start of the duplicate block, which gets trimmed.
   */
  deduplicateContent(text: string, stepId: string, projectId: string): string {
    // Split into sentences (rough but effective for prose)
    const sentences = text
      .split(/(?<=[.!?"'])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 20);

    if (sentences.length < 10) return text; // Too short to bother

    const WINDOW = 3; // Number of consecutive sentences to use as fingerprint

    for (let i = 0; i < sentences.length - WINDOW * 2; i++) {
      // Build a fingerprint from sentences i..i+WINDOW
      const fingerprint = sentences.slice(i, i + WINDOW).join(' ').slice(0, 120);

      // Search for this fingerprint later in the text (must be >500 chars ahead)
      const searchFrom = text.indexOf(sentences[i]) + sentences[i].length + 500;
      const dupIndex = text.indexOf(fingerprint.slice(0, 80), searchFrom);

      if (dupIndex !== -1) {
        // Found a duplicate block — trim everything from dupIndex onward
        const trimmed = text.slice(0, dupIndex).trimEnd();
        const wordsBefore = text.split(/\s+/).length;
        const wordsAfter = trimmed.split(/\s+/).length;

        this.log.warn('Duplicate content detected and stripped', {
          step: stepId,
          dupStartChar: dupIndex,
          wordsBefore,
          wordsAfter,
          wordsRemoved: wordsBefore - wordsAfter,
        });

        this.eventBus.emit('step:progress', {
          projectId,
          stepId,
          message: `⚠️ Duplicate content detected — stripped ${wordsBefore - wordsAfter} repeated words automatically.`,
        });

        return trimmed;
      }
    }

    return text; // No duplicates found — return as-is
  }

  /**
   * Cross-Chapter Duplicate Passage Scanner
   *
   * Runs at export/compile time. Splits every chapter into sentences,
   * builds a fingerprint map of sentence → [chapters it appears in],
   * then reports any sentence found in 2+ chapters.
   *
   * Does NOT modify content — reporting only.
   */
  scanForCrossChapterDuplicates(
    project: Project,
    exportStep: ProjectStep,
    chapters: ProjectStep[],
  ): void {
    // sentence → list of chapter labels containing it
    const sentenceMap = new Map<string, string[]>();

    for (const ch of chapters) {
      if (!ch.result) continue;

      const sentences = ch.result
        .split(/(?<=[.!?"'])\s+/)
        .map(s => s.trim())
        .filter(s => {
          const wordCount = s.split(/\s+/).length;
          return wordCount >= 10 && s.length > 40; // Only meaningful sentences
        });

      for (const sentence of sentences) {
        // Use first 100 chars as fingerprint key to catch near-identical sentences
        const key = sentence.substring(0, 100).toLowerCase().replace(/[^\w\s]/g, '').trim();
        if (!sentenceMap.has(key)) {
          sentenceMap.set(key, []);
        }
        const existing = sentenceMap.get(key)!;
        // Only add the chapter label once per chapter
        if (!existing.includes(ch.label)) {
          existing.push(ch.label);
        }
      }
    }

    // Collect genuine cross-chapter duplicates
    const duplicates: Array<{ sentence: string; chapters: string[] }> = [];
    for (const [key, chapterList] of sentenceMap) {
      if (chapterList.length >= 2) {
        duplicates.push({ sentence: key, chapters: chapterList });
      }
    }

    if (duplicates.length === 0) {
      this.log.info('Cross-chapter duplicate scan: no duplicate passages found ✓', {
        chaptersScanned: chapters.length,
      });
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: exportStep.id,
        message: `✓ Cross-chapter duplicate scan: no duplicate passages found across ${chapters.length} chapters.`,
      });
      return;
    }

    // Log and surface each duplicate
    this.log.warn('Cross-chapter duplicate passages detected', {
      count: duplicates.length,
      duplicates: duplicates.map(d => ({
        sentence: d.sentence.substring(0, 80),
        chapters: d.chapters,
      })),
    });

    const summary = duplicates
      .map(d => `• "${d.sentence.substring(0, 80)}..." → appears in: ${d.chapters.join(', ')}`)
      .join('\n');

    this.eventBus.emit('step:progress', {
      projectId: project.id,
      stepId: exportStep.id,
      message: `⚠️ ${duplicates.length} duplicate passage(s) detected across chapters:\n${summary}`,
    });
  }
}
