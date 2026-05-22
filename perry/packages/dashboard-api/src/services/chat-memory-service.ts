/**
 * ChatMemoryService — chat "soul" / cross-session learning for LandingChat.
 *
 * The dashboard chat (LandingChat → POST /api/agents/meta.director/invoke)
 * persists each exchange as an `agent_invocation` row, so a single
 * conversation survives across sessions (we hydrate from agent_invocations
 * on the client). But Perry himself, the model behind the chat, has no
 * memory of what was discussed in any prior session — only the active
 * thread that the client hydrated.
 *
 * This service closes that gap: it distills closed/idle chat sessions
 * through the Librarian into a compact `chat-memory.md` file. The director
 * agent loads this file at the start of every new chat, giving Perry
 * persistent recall of past conversations without re-hydrating raw
 * transcripts (cheap on tokens, durable across container restarts).
 *
 * Same architectural pattern as per-pen SOUL.md / LESSONS.md, but global
 * — LandingChat isn't project-scoped today. Per-pen variants can land later
 * with `chat-memory/pen-{slug}.md` when the chat gets pen-aware.
 *
 *   workspace/chat-memory/global.md      ← shared "what we've talked about"
 *
 * Trigger model:
 *   - Manual:   POST /api/agents/sessions/:id/distill
 *   - Sweep:    GC stage runs distillIdleSessions() once per sweep
 *   - On close: POST /api/agents/sessions/:id/close auto-distills before close
 *
 * Idempotency: each session has a meta breadcrumb
 *   `chat_memory_last_distilled_{sessionId}` = ISO timestamp of last distill.
 * We only re-distill if there are invocations newer than that timestamp AND
 * the most-recent invocation is older than IDLE_MIN_MS (don't distill mid-
 * conversation).
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import type { Logger, SecretsService } from '@perry/core';
import type { AIRouter } from '@perry/ai';
import type { StateStore } from '@perry/projects';

const CHAT_MEMORY_DIR_NAME = 'chat-memory';
const GLOBAL_MEMORY_FILENAME = 'global.md';
/** Cap on entries kept in the file. Older entries fold via folder later. */
const MAX_ENTRIES = 30;
/** Don't distill until the last invocation is at least this old (5 min). */
const IDLE_MIN_MS = 5 * 60 * 1000;
/** Don't distill sessions with fewer than this many invocations. */
const MIN_INVOCATIONS = 2;
/** Compression target — short enough to inject into every chat without bloat. */
const SUMMARY_TARGET_TOKENS = 280;
/** Cap on how many sessions a single sweep distills. Protects the librarian. */
const SWEEP_BATCH_MAX = 5;

export interface DistillResult {
  sessionId: string;
  distilled: boolean;
  reason?: string;
  summaryChars?: number;
  invocationsConsidered?: number;
}

export class ChatMemoryService {
  private readonly memoryDir: string;
  private readonly globalPath: string;

  constructor(
    private workspaceDir: string,
    private stateStore: StateStore,
    private aiRouter: AIRouter,
    private log: Logger,
    private secrets: SecretsService,
  ) {
    this.memoryDir = join(workspaceDir, CHAT_MEMORY_DIR_NAME);
    this.globalPath = join(this.memoryDir, GLOBAL_MEMORY_FILENAME);
  }

  /** Returns the current memory file as a string (or null if it doesn't exist). */
  loadGlobal(): string | null {
    try {
      if (!existsSync(this.globalPath)) return null;
      return readFileSync(this.globalPath, 'utf-8');
    } catch { return null; }
  }

  /** Returns the wife/partner memory file as a string (or null if it doesn't exist). */
  loadMemoryForJid(jid: string): string | null {
    try {
      const path = join(this.memoryDir, `wife-${jid}.md`);
      if (!existsSync(path)) return null;
      return readFileSync(path, 'utf-8');
    } catch { return null; }
  }

  private wifeFileHeader(jid: string): string {
    return [
      `# WhatsApp Chat Memory - ${jid}`,
      '',
      'Auto-distilled summaries of past WhatsApp chat sessions with wife/partner. ',
      'The wife-responder agent loads this file at the start of every new chat so it ',
      'remembers what was discussed. Newest entries appear first.',
      '',
      'Edit by hand if a summary captured something wrong — your edits ',
      'survive future distillations (only new sessions are appended).',
      '',
    ].join('\n');
  }

  /**
   * Distill one session if it's ready (idle + has new content). Idempotent —
   * if there's nothing new since the last distill, returns `distilled: false`
   * with a reason rather than re-running the librarian.
   */
  async distillSession(sessionId: string, opts: { force?: boolean } = {}): Promise<DistillResult> {
    const session = this.stateStore.getAgentSession(sessionId);
    if (!session) return { sessionId, distilled: false, reason: 'session-not-found' };

    // We only care about meta-domain sessions for the LandingChat path. Other
    // domains (code.*) have their own conversations that don't share
    // the global Perry-chat memory.
    if (session.domain !== 'meta') {
      return { sessionId, distilled: false, reason: `domain=${session.domain} (skipped)` };
    }

    let memoryPath = this.globalPath;
    let isWifeSession = false;
    let wifeJid = '';
    if (session.title && session.title.startsWith('whatsapp:')) {
      const parts = session.title.split(':');
      const jid = parts[1];
      const wifeEnabled = this.secrets.getSync('whatsapp_wife_mode_enabled') !== 'false';
      if (wifeEnabled) {
        const wifeRaw = this.secrets.getSync('whatsapp_wife_user_ids') || '';
        const wifeIds = new Set(wifeRaw.split(',').map((s: string) => s.trim()).filter(Boolean));
        if (wifeIds.has(jid)) {
          isWifeSession = true;
          wifeJid = jid;
          memoryPath = join(this.memoryDir, `wife-${wifeJid}.md`);
        }
      }
    }

    const invocations = this.stateStore.listAgentInvocations({ sessionId, limit: 500 });
    if (invocations.length < MIN_INVOCATIONS) {
      return { sessionId, distilled: false, reason: `too-few-invocations (${invocations.length})` };
    }

    // Sort oldest-first for the transcript. listAgentInvocations returns DESC.
    invocations.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const newestAt = new Date(invocations[invocations.length - 1].created_at).getTime();

    if (!opts.force) {
      const idleMs = Date.now() - newestAt;
      if (idleMs < IDLE_MIN_MS) {
        return { sessionId, distilled: false, reason: `still-active (idle ${Math.round(idleMs / 1000)}s)` };
      }
      const lastDistilledRaw = this.stateStore.getMeta(`chat_memory_last_distilled_${sessionId}`);
      if (lastDistilledRaw) {
        const lastDistilledAt = Date.parse(lastDistilledRaw);
        if (Number.isFinite(lastDistilledAt) && lastDistilledAt >= newestAt) {
          return { sessionId, distilled: false, reason: 'no-new-content-since-last-distill' };
        }
      }
    }

    if (!this.aiRouter.compressor.isAvailable()) {
      return { sessionId, distilled: false, reason: 'librarian-unavailable' };
    }

    // Build a transcript. Trim each turn to keep the librarian input bounded —
    // we want a summary, not a verbatim replay.
    const lines: string[] = [];
    for (const inv of invocations) {
      if (inv.input) lines.push(`User: ${String(inv.input).slice(0, 600).trim()}`);
      if (inv.output) lines.push(`Perry: ${String(inv.output).slice(0, 600).trim()}`);
    }
    const transcript = lines.join('\n\n');

    let summaryText: string;
    try {
      const taskDescription = isWifeSession
        ? 'Summarise a chat conversation between the user (acting as the husband/partner) and their wife. ' +
          'Capture: (1) main TOPICS discussed, (2) DECISIONS or preferences expressed, ' +
          '(3) OPEN questions or things they said they\'d return to. ' +
          'Bullet form. Lead each bullet with a noun ("topic:", "decision:", "open:").'
        : 'Summarise a chat conversation between the user and Perry (an AI assistant). ' +
          'Capture: (1) main TOPICS discussed, (2) DECISIONS or preferences the user expressed, ' +
          '(3) OPEN questions or things the user said they\'d return to. ' +
          'Bullet form. Lead each bullet with a noun ("topic:", "decision:", "open:"). ' +
          'Stay concrete — name files, projects, pens by their actual names if mentioned.';

      const result = await this.aiRouter.compressor.compress({
        rawContext: transcript,
        taskDescription,
        targetTokens: SUMMARY_TARGET_TOKENS,
        mode: 'context_briefing',
      });
      summaryText = (result.compressed || '').trim();
    } catch (err: any) {
      this.log.warn('chat-memory distill failed at librarian step', { sessionId, error: err.message });
      return { sessionId, distilled: false, reason: `librarian-error: ${err.message}` };
    }

    if (!summaryText) {
      return { sessionId, distilled: false, reason: 'librarian-returned-empty' };
    }

    // Append entry to global memory file (creating dir + file if needed).
    try {
      mkdirSync(this.memoryDir, { recursive: true });
      const headerTime = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const entry = [
        `## ${headerTime} — session ${sessionId}`,
        '',
        summaryText,
        '',
        '---',
        '',
      ].join('\n');
      const existing = isWifeSession
        ? (this.loadMemoryForJid(wifeJid) || this.wifeFileHeader(wifeJid))
        : (this.loadGlobal() || this.fileHeader());
      // Insert the new entry just after the file header, before any older
      // entries. Newest-first ordering matches how SOUL.md surfaces recent
      // updates and lets the director see fresh context first if we ever
      // need to truncate-from-bottom under a tight budget.
      const headerEnd = existing.indexOf('\n## ');
      let updated: string;
      if (headerEnd === -1) {
        updated = existing.trimEnd() + '\n\n' + entry;
      } else {
        updated = existing.slice(0, headerEnd) + '\n\n' + entry + existing.slice(headerEnd + 1);
      }
      // Cap entries: keep MAX_ENTRIES most-recent ## sections. Drop older.
      updated = this.capEntries(updated, MAX_ENTRIES);
      writeFileSync(memoryPath, updated, 'utf-8');
      this.stateStore.setMeta(`chat_memory_last_distilled_${sessionId}`, new Date().toISOString());
      this.log.info('chat-memory distilled', {
        sessionId, summaryChars: summaryText.length, invocations: invocations.length,
      });
      return {
        sessionId, distilled: true,
        summaryChars: summaryText.length,
        invocationsConsidered: invocations.length,
      };
    } catch (err: any) {
      this.log.warn('chat-memory file write failed', { sessionId, error: err.message });
      return { sessionId, distilled: false, reason: `write-error: ${err.message}` };
    }
  }

  /**
   * Find meta-domain sessions that look idle + have new content, and distill
   * up to SWEEP_BATCH_MAX of them. Called from the GC sweep. Returns a per-
   * session result list for the sweep summary.
   */
  async distillIdleSessions(): Promise<DistillResult[]> {
    const sessions = this.stateStore.listAgentSessions({ domain: 'meta', limit: 50 });
    const results: DistillResult[] = [];
    for (const s of sessions) {
      if (results.filter(r => r.distilled).length >= SWEEP_BATCH_MAX) break;
      try {
        const r = await this.distillSession(s.id);
        if (r.distilled || (r.reason && !r.reason.startsWith('no-new-content'))) {
          // Only surface signal events — silent skips would flood the summary.
          results.push(r);
        }
      } catch (err: any) {
        results.push({ sessionId: s.id, distilled: false, reason: `unexpected: ${err.message}` });
      }
    }
    return results;
  }

  /** Header written when the file is first created. */
  private fileHeader(): string {
    return [
      '# Perry chat memory',
      '',
      'Auto-distilled summaries of past chat sessions. The director agent ',
      'loads this file at the start of every new chat so Perry remembers ',
      'what you\'ve been working on together. Newest entries appear first.',
      '',
      'Edit by hand if a summary captured something wrong — your edits ',
      'survive future distillations (only new sessions are appended).',
      '',
    ].join('\n');
  }

  /** Keep the file's header + the first N entries (most-recent). */
  private capEntries(text: string, maxEntries: number): string {
    const parts = text.split(/\n(?=## )/);
    if (parts.length <= maxEntries + 1) return text;
    const header = parts[0];
    const kept = parts.slice(1, maxEntries + 1);
    return [header, ...kept].join('\n');
  }
}
