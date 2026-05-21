/**
 * LandingChat — the friendly "talk to Perry" panel for the Fleet landing.
 *
 * Modes:
 *   - docked:    sits in the right column of the Fleet view.
 *   - floating:  position-fixed window the user can drag and resize.
 *
 * Affordances:
 *   - Drag grip on the header (visible in both modes — drags when floating)
 *   - Collapse button — shrinks docked panel to a slim vertical rail
 *   - Pop-out / Dock button — toggles mode
 *   - Resize handle:
 *       • docked   → vertical bar on the LEFT edge (drag to change column width)
 *       • floating → diagonal handle in the bottom-LEFT corner
 *   - Snap-back: drop a floating drag near the right edge → re-docks.
 *
 * Talks to the Director agent: POST /api/agents/meta.director/invoke.
 */

import { useEffect, useRef, useState } from 'react';
import { playCommsSendSound, playCommsRecvSound } from '../utils/audio';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ? 'http://localhost:4000/api' : '/api';
const SNAP_DISTANCE = 32;
const MIN_W = 320;
const MIN_H = 320;
const MIN_DOCKED_W = 320;
const MAX_DOCKED_W = 720;
const COLLAPSED_W = 56;

interface ChatMessage {
  id: string;
  role: 'you' | 'perry';
  text: string;
  ts: number;
  pending?: boolean;
  error?: boolean;
}

const SUGGESTIONS = [
  'What can you do?',
  'Show me my projects',
  'Plan a new book',
  'Check my email',
];

type Mode = 'docked' | 'floating';

interface LandingChatProps {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  collapsed: boolean;
  onCollapsedChange: (c: boolean) => void;
  dockedWidth: number;
  onDockedWidthChange: (w: number) => void;
  onClose?: () => void;
}

// localStorage key for cross-mount sessionId persistence. The chat component
// unmounts on close (App.tsx conditionally renders it), so without this the
// sessionId would be lost — every reopen would start a fresh server-side
// session even though agent_sessions + agent_invocations have the history.
const CHAT_SESSION_STORAGE_KEY = 'perry-landing-chat-session-id';

export function LandingChat({
  mode,
  onModeChange,
  collapsed,
  onCollapsedChange,
  dockedWidth,
  onDockedWidthChange,
  onClose,
}: LandingChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // Hydrate sessionId synchronously from localStorage so the first render
  // doesn't accidentally trigger a session-create on send.
  const [sessionId, setSessionId] = useState<string | null>(() => {
    try {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(CHAT_SESSION_STORAGE_KEY);
    } catch {}
    return null;
  });
  const [hydrating, setHydrating] = useState<boolean>(() => {
    try { return typeof localStorage !== 'undefined' && !!localStorage.getItem(CHAT_SESSION_STORAGE_KEY); }
    catch { return false; }
  });

  // Hydrate prior conversation from the server when the component mounts
  // with a known sessionId. agent_invocations is the source of truth — each
  // row carries the user input + Perry output for one exchange.
  useEffect(() => {
    if (!sessionId) { setHydrating(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/agent-sessions/${encodeURIComponent(sessionId)}`);
        if (!r.ok) {
          // Session vanished (cleared by server). Drop the stale key.
          try { localStorage.removeItem(CHAT_SESSION_STORAGE_KEY); } catch {}
          if (!cancelled) { setSessionId(null); setHydrating(false); }
          return;
        }
        const data = await r.json();
        // NOTE: server returns rows straight from sqlite as snake_case
        // (`created_at`) — DO NOT rely on `createdAt` here, that's the shape
        // produced by AgentRunner's runtime return, not the GET endpoint.
        // Also: listAgentInvocations sorts DESC; we need oldest-first for
        // chronological chat display, so reverse before mapping.
        const raw: Array<{ id: string; input?: string; output?: string; created_at: string; status: string; error?: string }> = data.invocations || [];
        const ordered = [...raw].sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const hydrated: ChatMessage[] = [];
        for (const inv of ordered) {
          const ts = new Date(inv.created_at).getTime();
          if (inv.input) hydrated.push({ id: `u-${inv.id}`, role: 'you', text: inv.input, ts });
          if (inv.output) hydrated.push({ id: `p-${inv.id}`, role: 'perry', text: inv.output, ts });
          else if (inv.status === 'failed') hydrated.push({ id: `e-${inv.id}`, role: 'perry', text: `(previous reply failed — ${inv.error || 'no detail'})`, ts, error: true });
        }
        if (!cancelled) setMessages(hydrated);
      } catch {
        // Network blip — leave the empty state, user can keep chatting.
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
  // Intentionally only hydrate on initial mount with the stored sessionId.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Start a fresh conversation: clear the in-memory transcript AND drop
   * the persisted sessionId so the next message creates a new server-side
   * session. The old session is preserved on the server (closeAgentSession
   * not called) so the user can still inspect it from the Trajectories view.
   */
  const startNewChat = () => {
    if (sending) return;
    if (messages.length > 0 && !confirm('Start a new chat? The current conversation stays on the server but the chat panel resets.')) return;
    setMessages([]);
    setSessionId(null);
    try { localStorage.removeItem(CHAT_SESSION_STORAGE_KEY); } catch {}
  };

  // Floating-mode geometry — when popped out, default near the LEFT edge
  // (where the chat docks) so popping out doesn't displace the panel.
  const [pos, setPos] = useState(() => ({ x: 80, y: 80 }));
  const [size, setSize] = useState({ w: 420, h: 560 });

  // Mount guard for async setState — the parent unmounts LandingChat on
  // close (App.tsx conditionally renders it). Any in-flight invoke that
  // resolves AFTER unmount would call setMessages on a gone component and
  // trigger a React warning. Refs survive unmount; we check before every
  // post-await setState.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Drag + resize refs (gesture continues even if cursor leaves the panel)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const floatResizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const dockedResizeRef = useRef<{ startX: number; origW: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!collapsed) inputRef.current?.focus();
  }, [collapsed]);

  // Global mouse handlers for drag + resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        const newX = Math.max(0, Math.min(window.innerWidth - 80, dragRef.current.origX + dx));
        const newY = Math.max(36, Math.min(window.innerHeight - 80, dragRef.current.origY + dy));
        setPos({ x: newX, y: newY });
      }
      if (floatResizeRef.current) {
        const dx = e.clientX - floatResizeRef.current.startX;
        const dy = e.clientY - floatResizeRef.current.startY;
        // Bottom-RIGHT corner handle: pull right to widen, down to taller.
        const newW = Math.max(MIN_W, floatResizeRef.current.origW + dx);
        const newH = Math.max(MIN_H, Math.min(window.innerHeight - 60, floatResizeRef.current.origH + dy));
        setSize({ w: newW, h: newH });
      }
      if (dockedResizeRef.current) {
        const dx = e.clientX - dockedResizeRef.current.startX;
        // Chat is on the LEFT now — dragging RIGHT (dx>0) widens the column.
        const newW = Math.max(MIN_DOCKED_W, Math.min(MAX_DOCKED_W, dockedResizeRef.current.origW + dx));
        onDockedWidthChange(newW);
      }
    };
    const onUp = () => {
      if (dragRef.current) {
        // Snap back to dock if released near the LEFT edge (chat's home).
        const leftGap = pos.x;
        if (leftGap <= SNAP_DISTANCE) onModeChange('docked');
      }
      dragRef.current = null;
      floatResizeRef.current = null;
      dockedResizeRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onModeChange, onDockedWidthChange, pos.x]);

  const startDrag = (e: React.MouseEvent) => {
    if (mode !== 'floating') return;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      origX: pos.x, origY: pos.y,
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    e.preventDefault();
  };

  const startFloatResize = (e: React.MouseEvent) => {
    floatResizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      origW: size.w, origH: size.h,
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'nwse-resize';
    e.preventDefault();
    e.stopPropagation();
  };

  const startDockedResize = (e: React.MouseEvent) => {
    dockedResizeRef.current = { startX: e.clientX, origW: dockedWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
    e.preventDefault();
    e.stopPropagation();
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (collapsed) onCollapsedChange(false);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`, role: 'you', text: trimmed, ts: Date.now(),
    };
    const placeholder: ChatMessage = {
      id: `p-${Date.now()}`, role: 'perry', text: '', ts: Date.now(), pending: true,
    };

    setMessages(prev => [...prev, userMsg, placeholder]);
    playCommsSendSound();
    setInput('');
    setSending(true);

    try {
      const r = await fetch(`${API_BASE}/agents/meta.director/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: trimmed, sessionId }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `request failed (${r.status})`);
      const inv = data.invocation;
      // localStorage write is safe even after unmount — it's a side effect
      // outside React. Always persist the sessionId so the next mount can
      // hydrate it, even if the user closed the chat mid-flight.
      if (inv?.sessionId && !sessionId) {
        try { localStorage.setItem(CHAT_SESSION_STORAGE_KEY, inv.sessionId); } catch {}
      }
      if (!mountedRef.current) return;   // component closed mid-flight; skip setState
      if (inv?.sessionId && !sessionId) setSessionId(inv.sessionId);
      const replyText = inv?.output || inv?.text || '(empty response)';
      setMessages(prev => prev.map(m =>
        m.id === placeholder.id ? { ...m, text: replyText, pending: false } : m
      ));
      playCommsRecvSound();
    } catch (err: any) {
      if (!mountedRef.current) return;
      setMessages(prev => prev.map(m =>
        m.id === placeholder.id
          ? { ...m, text: `Something went wrong — ${err.message}`, pending: false, error: true }
          : m
      ));
      playCommsRecvSound();
    } finally {
      if (mountedRef.current) setSending(false);
    }
  };

  const isFloating = mode === 'floating';

  // collapsed prop is no longer used (chat is toggled from LeftNav). Keep
  // the prop signature so existing callers still type-check.
  void collapsed; void onCollapsedChange; void COLLAPSED_W;

  // ── FULL PANEL (docked or floating) ──────────────────────────
  const shellStyle: React.CSSProperties = isFloating
    ? {
        position: 'fixed',
        left: pos.x, top: pos.y,
        width: size.w, height: size.h,
        zIndex: 95,
        borderRadius: 14,
        boxShadow: '0 24px 60px rgba(0,0,0,0.7), 0 0 20px rgba(34, 211, 238, 0.15)',
        background: 'rgba(7, 9, 15, 0.85)',
        border: '1px solid rgba(34, 211, 238, 0.25)',
        display: 'flex', flexDirection: 'column',
        backdropFilter: 'blur(20px)',
        overflow: 'hidden',
      }
    : {
        height: '100%',
        background: 'rgba(7, 9, 15, 0.75)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(34, 211, 238, 0.2)',
        borderRadius: 14,
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        position: 'relative',
        boxShadow: 'inset 0 0 20px rgba(0, 0, 0, 0.4)',
      };

  return (
    <div style={shellStyle}>
      {/* Header — drag handle (floating) + action buttons */}
      <div
        onMouseDown={startDrag}
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid rgba(34, 211, 238, 0.15)',
          background: 'linear-gradient(180deg, rgba(34, 211, 238, 0.06) 0%, transparent 100%)',
          cursor: isFloating ? 'grab' : 'default',
          userSelect: 'none',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}
      >
        {/* Drag grip indicator */}
        <div style={{
          flexShrink: 0, marginTop: 4,
          width: 14, height: 22,
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          opacity: isFloating ? 0.8 : 0.35,
        }}
        title={isFloating ? 'Drag to move' : 'Pop out to drag'}
        >
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', gap: 3 }}>
              <span style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--secondary)' }} />
              <span style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--secondary)' }} />
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 4, color: 'var(--secondary)', letterSpacing: '0.12em' }}>COCKPIT COMMS // PERRY</div>
          <div style={{
            fontSize: '0.95rem', fontWeight: 700, letterSpacing: '-0.015em',
            color: 'var(--text-main)',
          }}>COMMS LINK ENGAGED</div>
          <div style={{
            marginTop: 4, fontSize: '0.72rem',
            color: 'var(--text-muted)', lineHeight: 1.4,
            fontFamily: 'var(--font-mono)',
          }}>
            Ask anything. I can formulate plans, orchestrate agents, or run diagnostic hacks.
          </div>
        </div>

        {/* Action buttons cluster — new chat + pop-out/dock toggle + close */}
        <div
          onMouseDown={(e: any) => e.stopPropagation()}
          style={{ display: 'flex', gap: 6, flexShrink: 0 }}
        >
          <HeaderButton
            label="Start a fresh conversation (current chat stays on the server)"
            icon="+"
            text="New"
            onClick={startNewChat}
          />
          <HeaderButton
            label={isFloating ? 'Dock chat back into the layout' : 'Pop chat out into a floating window'}
            icon={isFloating ? '⇲' : '⇱'}
            text={isFloating ? 'Dock' : 'Pop out'}
            onClick={() => onModeChange(isFloating ? 'docked' : 'floating')}
            primary
          />
          {onClose && (
            <HeaderButton
              label="Close chat (your conversation is saved — reopen to resume)"
              icon="✕"
              onClick={onClose}
            />
          )}
        </div>
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}
      >
        {hydrating && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', padding: 4 }}>
            Loading prior conversation…
          </div>
        )}
        {!hydrating && messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: 4 }}>
              Try one of these to get started:
            </div>
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                style={{
                  textAlign: 'left',
                  padding: '10px 14px', borderRadius: 10,
                  border: '1px solid var(--panel-border)',
                  background: 'rgba(168,85,247,0.04)',
                  color: 'var(--text-main)',
                  fontFamily: 'var(--font-sans)', fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e: any) => {
                  e.currentTarget.style.borderColor = 'var(--accent-border)';
                  e.currentTarget.style.background = 'var(--accent-soft)';
                }}
                onMouseLeave={(e: any) => {
                  e.currentTarget.style.borderColor = 'var(--panel-border)';
                  e.currentTarget.style.background = 'rgba(168,85,247,0.04)';
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map(m => <Bubble key={m.id} message={m} />)}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e: any) => { e.preventDefault(); send(input); }}
        style={{
          display: 'flex', gap: 8, padding: '12px 14px',
          borderTop: '1px solid var(--panel-border)',
          background: 'rgba(7, 9, 15, 0.6)',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e: any) => setInput(e.target.value)}
          placeholder="Type a message…"
          disabled={sending}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            border: '1px solid var(--panel-border)',
            background: 'rgba(0,0,0,0.35)',
            color: 'var(--text-main)',
            fontFamily: 'var(--font-sans)', fontSize: '0.9rem',
            outline: 'none',
          }}
          onFocus={(e: any) => e.currentTarget.style.borderColor = 'var(--accent-border)'}
          onBlur={(e: any) => e.currentTarget.style.borderColor = 'var(--panel-border)'}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          style={{
            padding: '10px 18px', borderRadius: 10,
            border: '1px solid var(--accent-border)',
            background: input.trim() && !sending ? 'var(--accent)' : 'var(--accent-soft)',
            color: input.trim() && !sending ? 'white' : 'var(--accent)',
            fontFamily: 'var(--font-sans)', fontSize: '0.85rem', fontWeight: 600,
            cursor: input.trim() && !sending ? 'pointer' : 'not-allowed',
            opacity: input.trim() && !sending ? 1 : 0.6,
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>

      {/* Resize handles */}
      {isFloating && (
        <div
          onMouseDown={startFloatResize}
          title="Drag to resize"
          style={{
            position: 'absolute',
            right: 0, bottom: 0,
            width: 18, height: 18,
            cursor: 'nwse-resize',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: 'block', opacity: 0.55 }}>
            <line x1="15" y1="2"  x2="2"  y2="15" stroke="var(--text-muted)" strokeWidth="1.2" />
            <line x1="15" y1="6"  x2="6"  y2="15" stroke="var(--text-muted)" strokeWidth="1.2" />
            <line x1="15" y1="10" x2="10" y2="15" stroke="var(--text-muted)" strokeWidth="1.2" />
          </svg>
        </div>
      )}
      {!isFloating && (
        <div
          onMouseDown={startDockedResize}
          title="Drag to resize"
          style={{
            // Right-edge handle now that the chat docks on the LEFT.
            position: 'absolute',
            right: -3, top: 0, bottom: 0, width: 6,
            cursor: 'ew-resize',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {/* Visible grip — three vertical dots */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 3,
            opacity: 0.5,
          }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                width: 3, height: 3, borderRadius: 999,
                background: 'var(--text-muted)',
              }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * HeaderButton — a small but legible pill with an icon and (optionally) a
 * text label. More discoverable than a 28×28 icon-only square.
 */
function HeaderButton({ label, icon, text, onClick, primary }: {
  label: string;
  icon: string;
  text?: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      style={{
        background: primary ? 'var(--accent-soft)' : 'transparent',
        border: `1px solid ${primary ? 'var(--accent-border)' : 'var(--panel-border)'}`,
        color: primary ? 'var(--accent)' : 'var(--text-muted)',
        borderRadius: 8,
        height: 30, padding: text ? '0 10px' : '0 8px',
        display: 'flex', alignItems: 'center', gap: 6,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)', fontSize: '0.78rem', fontWeight: 500,
        whiteSpace: 'nowrap',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e: any) => {
        e.currentTarget.style.color = 'var(--accent)';
        e.currentTarget.style.borderColor = 'var(--accent-border)';
        e.currentTarget.style.background = primary ? 'rgba(168,85,247,0.18)' : 'var(--accent-soft)';
      }}
      onMouseLeave={(e: any) => {
        e.currentTarget.style.color = primary ? 'var(--accent)' : 'var(--text-muted)';
        e.currentTarget.style.borderColor = primary ? 'var(--accent-border)' : 'var(--panel-border)';
        e.currentTarget.style.background = primary ? 'var(--accent-soft)' : 'transparent';
      }}
    >
      <span style={{ fontSize: '0.95rem', lineHeight: 1 }}>{icon}</span>
      {text && <span>{text}</span>}
    </button>
  );
}

function renderMessageText(text: string) {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const content = part.slice(3, -3).trim();
      const lines = content.split('\n');
      const lang = lines[0].match(/^[a-zA-Z0-9_-]+$/) ? lines[0] : '';
      const code = lang ? lines.slice(1).join('\n') : content;
      return (
        <div key={idx} style={{
          margin: '8px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.74rem',
          background: 'rgba(0, 0, 0, 0.4)',
          border: '1px solid rgba(34, 211, 238, 0.2)',
          borderRadius: 6,
          overflow: 'hidden',
          boxShadow: 'inset 0 0 10px rgba(0,0,0,0.6)',
        }}>
          {lang && (
            <div style={{
              background: 'rgba(34, 211, 238, 0.06)',
              padding: '4px 10px',
              borderBottom: '1px solid rgba(34, 211, 238, 0.12)',
              fontSize: '0.6rem',
              color: 'var(--secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontWeight: 600,
            }}>{lang}</div>
          )}
          <pre style={{
            padding: '8px 10px',
            margin: 0,
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: '#34D399',
          }}><code>{code}</code></pre>
        </div>
      );
    }
    
    const inlineParts = part.split(/(`[^`]+`)/g);
    return (
      <span key={idx}>
        {inlineParts.map((subPart, subIdx) => {
          if (subPart.startsWith('`') && subPart.endsWith('`')) {
            return (
              <code key={subIdx} style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.74rem',
                background: 'rgba(34, 211, 238, 0.1)',
                color: 'var(--secondary)',
                padding: '1px 4px',
                borderRadius: 3,
                border: '1px solid rgba(34, 211, 238, 0.25)',
              }}>
                {subPart.slice(1, -1)}
              </code>
            );
          }
          return subPart;
        })}
      </span>
    );
  });
}

function Bubble({ message }: { message: ChatMessage }) {
  const isYou = message.role === 'you';
  return (
    <div style={{ display: 'flex', justifyContent: isYou ? 'flex-end' : 'flex-start', margin: '4px 0' }}>
      <div style={{
        maxWidth: '85%',
        padding: '12px 16px',
        borderRadius: 10,
        borderTopRightRadius: isYou ? 2 : 10,
        borderTopLeftRadius: isYou ? 10 : 2,
        background: isYou
          ? 'rgba(168, 85, 247, 0.1)'
          : message.error
            ? 'rgba(239, 68, 68, 0.08)'
            : 'rgba(7, 9, 15, 0.6)',
        border: `1px solid ${isYou ? 'rgba(168, 85, 247, 0.35)' : message.error ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 211, 238, 0.2)'}`,
        color: message.error ? 'var(--danger)' : 'var(--text-main)',
        fontFamily: isYou ? 'var(--font-sans)' : 'var(--font-sans)',
        fontSize: '0.85rem',
        lineHeight: 1.5,
        wordBreak: 'break-word',
        boxShadow: isYou ? '0 0 10px rgba(168, 85, 247, 0.05)' : '0 0 10px rgba(34, 211, 238, 0.05)',
      }}>
        {!isYou && (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            color: 'var(--secondary)',
            letterSpacing: '0.12em',
            marginBottom: 4,
            textTransform: 'uppercase',
            opacity: 0.8,
          }}>
            PERRY.SYS // DECODE
          </div>
        )}
        {message.pending ? (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', height: 16 }}>
            <Dot delay={0} /><Dot delay={0.16} /><Dot delay={0.32} />
          </span>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {isYou ? message.text : renderMessageText(message.text)}
          </div>
        )}
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%',
      background: 'var(--accent)',
      display: 'inline-block',
      animation: `landingChatDot 1s ${delay}s infinite ease-in-out`,
    }} />
  );
}

if (typeof document !== 'undefined' && !document.getElementById('landing-chat-style')) {
  const style = document.createElement('style');
  style.id = 'landing-chat-style';
  style.textContent = `
    @keyframes landingChatDot {
      0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
      40%           { opacity: 1;   transform: translateY(-2px); }
    }
  `;
  document.head.appendChild(style);
}
