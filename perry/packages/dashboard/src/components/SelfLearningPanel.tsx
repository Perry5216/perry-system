/**
 * SelfLearningPanel — surfaces Perry's self-learning machinery in the UI.
 *
 * Three sub-tabs:
 *   - Sessions  → FTS5 keyword search over completed step outputs.
 *                 Expand a row to read the full prose. Backed by
 *                 GET /api/sessions/search + GET /api/sessions/:stepId.
 *   - Skills    → list installed + pending slash commands, with
 *                 approve/reject buttons on pending ones. Backed by
 *                 GET /api/skills, POST /api/skills/promote,
 *                 DELETE /api/skills/pending/:filename.
 *   - Pens      → per-pen SOUL.md + LESSONS.md viewer with a "Refresh"
 *                 button that runs the audit-style profile rebuild.
 *                 Backed by GET /api/pens, GET /api/pens/:slug/profile,
 *                 POST /api/pens/:slug/refresh-profile.
 *
 * Visual language: matches existing panels (dark navy, cyan accents,
 * monospace headings, hover-lit borders).
 */

import { useEffect, useState } from 'react';
import { PanelHeader } from './PanelHeader';
import { Search, BookOpen, RotateCcw, Check, X, ChevronDown, ChevronRight, FileText, Sparkles, Edit3, Save } from 'lucide-react';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV)
  ? 'http://localhost:4000/api' : '/api';

type SubTab = 'sessions' | 'skills' | 'pens' | 'evolution';

export function SelfLearningPanel() {
  const [tab, setTab] = useState<SubTab>('sessions');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16 }}>
      <PanelHeader eyebrow="SELF-LEARNING" title="Self-Learning" subtitle="Sessions · Skills · Pens · Evolution" />
      <LearningActivity />
      <SubTabs current={tab} onChange={setTab} />
      <div style={{ flex: 1, overflowY: 'auto', marginTop: 12 }}>
        {tab === 'sessions' && <SessionsTab />}
        {tab === 'skills' && <SkillsTab />}
        {tab === 'pens' && <PensTab />}
        {tab === 'evolution' && <EvolutionTab />}
      </div>
    </div>
  );
}

// ─── Evolution tab ─────────────────────────────────────────────────────────
// Chronological view of how Perry is evolving: skill-applied events,
// auto-promotions, manual promotions/deletions, verified-pattern flips.
// Sourced from workspace/evolution-log.jsonl via /api/learning/evolution.
function EvolutionTab() {
  const [events, setEvents] = useState<Array<{ ts: string; kind: string; service?: string; name?: string; source?: string; metadata?: any }>>([]);
  const [scores, setScores] = useState<Array<{ service: string; name: string; applied: number; lastSeen: string }>>([]);
  const [suggestions, setSuggestions] = useState<{ installable: any[]; transfer: any[] }>({ installable: [], transfer: [] });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [eRes, sRes, sgRes] = await Promise.all([
          fetch(`${API_BASE}/learning/evolution?limit=100`),
          fetch(`${API_BASE}/learning/scores`),
          fetch(`${API_BASE}/learning/suggested-skills?limit=10`),
        ]);
        if (!eRes.ok) throw new Error(`evolution HTTP ${eRes.status}`);
        const ej = await eRes.json();
        const sj = sRes.ok ? await sRes.json() : { scores: [] };
        const sgj = sgRes.ok ? await sgRes.json() : { installable: [], transfer: [] };
        if (!cancelled) { setEvents(ej.events || []); setScores(sj.scores || []); setSuggestions(sgj); setErr(null); }
      } catch (e: any) { if (!cancelled) setErr(e.message); }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (err) return <div style={{ color: '#fca5a5' }}>error: {err}</div>;

  const kindColor = (k: string) => ({
    'skill-applied': '#22d3ee',
    'skill-promoted': '#a855f7',
    'skill-auto-promoted': '#fbbf24',
    'skill-created': '#34d399',
    'skill-deleted': '#fca5a5',
    'verified-pattern': '#94a3b8',
    'pattern-retired': '#fca5a5',
  } as Record<string, string>)[k] || '#94a3b8';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontFamily: 'var(--font-mono)' }}>
      <div>
        <h3 style={{ color: 'var(--secondary)', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>Timeline ({events.length})</h3>
        <div style={{ maxHeight: 600, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6 }}>
          {events.length === 0 && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: '0.85rem' }}>No evolution events yet. Will populate as skills are applied / promoted.</div>}
          {events.map((e, i) => (
            <div key={i} style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: kindColor(e.kind), fontWeight: 600 }}>{e.kind}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
              {(e.service || e.name) && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{e.service && <span>{e.service}/</span>}{e.name}</div>}
              {e.metadata?.count && <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>recurred {e.metadata.count}x</div>}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h3 style={{ color: 'var(--secondary)', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>Skill confidence ({scores.length})</h3>
          {scores.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No skill applications recorded yet.</div>}
          {scores.slice(0, 12).map(s => (
            <div key={`${s.service}::${s.name}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span><span style={{ color: 'var(--text-muted)' }}>{s.service}/</span>{s.name}</span>
              <span style={{ color: '#22d3ee', fontWeight: 600 }}>{s.applied}x</span>
            </div>
          ))}
        </div>
        <div>
          <h3 style={{ color: 'var(--secondary)', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>Suggested installs</h3>
          {suggestions.installable.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No suggestions yet — patterns will accumulate.</div>}
          {suggestions.installable.slice(0, 5).map((s, i) => (
            <div key={i} style={{ padding: 6, marginBottom: 4, background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.15)', borderRadius: 4, fontSize: '0.8rem' }}>
              <div><strong style={{ color: 'var(--secondary)' }}>{s.service}/{s.name}</strong></div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{s.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Learning Activity strip ────────────────────────────────────────────────
// Renders cards for every learning source the framework has observed,
// PLUS the chat-memory file (which is file-based, not event-based). When a
// new domain (hacking, code, etc.) emits its first learning:* event, a card
// appears automatically — no UI change needed per domain.

interface SourceSummary {
  source: string;
  observations: number;
  max_count: number;
  ready_to_fire: number;
  threshold_min: number;
}
interface LearningState {
  sources: SourceSummary[];
  entries: Array<{ source: string; kind: string; fingerprint: string; count: number; failures: number; successes: number; proposed: boolean }>;
  chat_memory: { sessions_distilled: number; file_chars: number; entries_in_file: number };
  pending_skills_total: number;
  pending_skills_by_service: Record<string, number>;
  installed_skills_by_service: Record<string, number>;
}

function LearningActivity() {
  const [state, setState] = useState<LearningState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/learning/state`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) { setState(j); setErr(null); }
      } catch (e: any) { if (!cancelled) setErr(e.message); }
    };
    load();
    const id = setInterval(load, 10_000); // refresh every 10s so live runs surface
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (err) return <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '8px 0' }}>Learning state unavailable: {err}</div>;
  if (!state) return <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '8px 0' }}>Loading learning state…</div>;

  // Build dynamic cards from the sources LearningCore has actually seen
  // events from. New domains appear here automatically.
  const cards = state.sources.map(s => {
    // For each source, count how many event KINDS the source has observed
    // (e.g. "director" might have step-fail + step-complete). Useful subtitle.
    const kindsInSource = new Set(state.entries.filter(e => e.source === s.source).map(e => e.kind));
    const proposedInSource = state.entries.filter(e => e.source === s.source && e.proposed).length;
    return {
      key: s.source,
      label: s.source.toUpperCase(),
      current: s.max_count,
      total: s.threshold_min,
      subtitle: `${s.observations} observation(s) · ${kindsInSource.size} kind(s)` + (proposedInSource > 0 ? ` · ${proposedInSource} proposed` : ''),
      pulse: s.ready_to_fire > 0,
    };
  });

  // Chat memory always rendered as its own card — file-based, not event-driven.
  cards.push({
    key: 'chat-memory',
    label: 'CHAT MEMORY',
    current: state.chat_memory.entries_in_file,
    total: 30,
    subtitle: `${state.chat_memory.sessions_distilled} session(s) distilled · ${Math.round(state.chat_memory.file_chars / 100) / 10}k chars`,
    pulse: false,
  });

  return (
    <div style={{ marginTop: 8, marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--secondary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1 }}>Learning Activity</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {state.pending_skills_total} pending · {Object.values(state.installed_skills_by_service).reduce((a, b) => a + b, 0)} installed · {state.sources.length} active source(s)
        </span>
      </div>
      {cards.length === 1 && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '4px 0', fontStyle: 'italic' }}>
          No learning events observed yet. Run a project step or chat with Perry and producer cards will appear here.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        {cards.map(c => (
          <div key={c.key} style={{
            padding: '8px 10px',
            background: c.pulse ? 'rgba(168,85,247,0.12)' : 'rgba(7,9,15,0.4)',
            border: '1px solid ' + (c.pulse ? 'rgba(168,85,247,0.5)' : 'rgba(34,211,238,0.15)'),
            borderRadius: 6,
            boxShadow: c.pulse ? '0 0 12px rgba(168,85,247,0.25)' : undefined,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: c.pulse ? '#c4a8ff' : 'var(--secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-main)' }}>{c.current}/{c.total}</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 3 }}>{c.subtitle}</div>
            {c.pulse && <div style={{ fontSize: '0.65rem', color: '#c4a8ff', marginTop: 3 }}>⏵ ready to propose</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-tab nav ────────────────────────────────────────────────────────────

function SubTabs({ current, onChange }: { current: SubTab; onChange: (t: SubTab) => void }) {
  const tabs: Array<{ key: SubTab; label: string; icon: any }> = [
    { key: 'sessions', label: 'Sessions',  icon: <Search size={14} /> },
    { key: 'skills',   label: 'Skills',    icon: <Sparkles size={14} /> },
    { key: 'pens',     label: 'Pens',      icon: <BookOpen size={14} /> },
    { key: 'evolution', label: 'Evolution', icon: <Sparkles size={14} /> },
  ];
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(34,211,238,0.15)', paddingBottom: 0 }}>
      {tabs.map(t => {
        const active = current === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              padding: '8px 16px',
              background: active ? 'rgba(34,211,238,0.08)' : 'transparent',
              border: '1px solid',
              borderColor: active ? 'rgba(34,211,238,0.3)' : 'transparent',
              borderBottom: 'none',
              borderRadius: '6px 6px 0 0',
              color: active ? 'var(--secondary)' : 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.78rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              marginBottom: -1,
            }}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Sessions tab ───────────────────────────────────────────────────────────

interface SessionHit {
  stepId: string;
  projectId: string;
  excerpt: string;
  score: number;
}

function SessionsTab() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SessionHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fullContent, setFullContent] = useState<Record<string, string>>({});

  const search = async (query: string) => {
    if (!query.trim()) { setHits([]); return; }
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`${API_BASE}/sessions/search?q=${encodeURIComponent(query)}&limit=25`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setHits(j.hits || []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const toggle = async (stepId: string) => {
    if (expanded === stepId) { setExpanded(null); return; }
    setExpanded(stepId);
    if (!fullContent[stepId]) {
      try {
        const r = await fetch(`${API_BASE}/sessions/${encodeURIComponent(stepId)}`);
        const j = await r.json();
        if (j.found) setFullContent(prev => ({ ...prev, [stepId]: j.content }));
      } catch { /* ignore */ }
    }
  };

  return (
    <div>
      <form onSubmit={e => { e.preventDefault(); search(q); }} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text" value={q} onChange={e => setQ(e.target.value)}
          placeholder='FTS5 query — try "Mia" or "reactor" or "Tomas radio"'
          autoCapitalize="off"
          style={{
            flex: 1, padding: '8px 12px', background: 'rgba(7,9,15,0.6)',
            border: '1px solid rgba(34,211,238,0.2)', borderRadius: 6,
            color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
            textTransform: 'none',
          }}
        />
        <button type="submit" style={btnPrimary(loading)}>{loading ? 'Searching…' : 'Search'}</button>
      </form>

      {err && <div style={errBox}>{err}</div>}

      {!loading && q && hits.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: 12 }}>
          No matches.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {hits.map(h => (
          <div key={h.stepId} style={hitRow}>
            <button onClick={() => toggle(h.stepId)} style={hitHeader}>
              {expanded === h.stepId ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span style={{ color: 'var(--secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                {h.stepId}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                · project {h.projectId}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginLeft: 'auto' }}
                    title="Lower (more negative) raw FTS5 BM25 = better match. Displayed as absolute value where higher = better.">
                rank {Math.abs(h.score).toFixed(2)}
              </span>
            </button>
            <div style={{ padding: '6px 12px 8px 28px', fontSize: '0.82rem', color: 'var(--text-main)',
                          fontFamily: 'var(--font-mono)' }}
                 dangerouslySetInnerHTML={{ __html:
                    h.excerpt.replace(/«/g, '<mark style="background:rgba(34,211,238,0.25);color:#fff;padding:0 2px;border-radius:2px;">')
                             .replace(/»/g, '</mark>') }} />
            {expanded === h.stepId && (
              <pre style={{
                margin: '0 12px 12px 28px', padding: 12,
                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(34,211,238,0.1)',
                borderRadius: 4, fontSize: '0.78rem', color: 'var(--text-main)',
                whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto',
              }}>
                {fullContent[h.stepId] || 'Loading…'}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Skills tab ─────────────────────────────────────────────────────────────

interface SkillSummary {
  filename: string;
  name: string;
  description: string;
  service: string;
  proposedAt?: string;
  bodyLength: number;
}

function SkillsTab() {
  const [installed, setInstalled] = useState<SkillSummary[]>([]);
  const [pending, setPending] = useState<SkillSummary[]>([]);
  const [services, setServices] = useState<Array<{ service: string; installed: number; pending: number }>>([]);
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<{ filename: string; raw: string } | null>(null);

  const refresh = async (svc?: string | null) => {
    setLoading(true); setErr(null);
    try {
      const qs = svc ? `?service=${encodeURIComponent(svc)}` : '';
      const r = await fetch(`${API_BASE}/skills${qs}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setInstalled(j.installed || []);
      setPending(j.pending || []);
      setServices(j.services || []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(serviceFilter); }, [serviceFilter]);

  const preview = async (filename: string) => {
    try {
      const r = await fetch(`${API_BASE}/skills/pending/${encodeURIComponent(filename)}/raw`);
      const j = await r.json();
      setPreviewing({ filename, raw: j.raw || '(empty)' });
    } catch (e: any) { setErr(e.message); }
  };

  const promote = async (filename: string) => {
    if (!confirm(`Promote ${filename}? Worker skills land in .claude/commands/ (immediately active). Non-worker skills land in workspace/skills-installed/{service}/ (active on the next consumer reload).`)) return;
    try {
      const r = await fetch(`${API_BASE}/skills/promote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      alert(`Promoted ${j.name} (service: ${j.service}).\n${j.note || ''}`);
      refresh(serviceFilter);
    } catch (e: any) { setErr(e.message); }
  };

  const reject = async (filename: string) => {
    if (!confirm(`Reject ${filename}? This deletes the pending file.`)) return;
    try {
      const r = await fetch(`${API_BASE}/skills/pending/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      refresh(serviceFilter);
    } catch (e: any) { setErr(e.message); }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: 12 }}>Loading skills…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {err && <div style={errBox}>{err}</div>}

      {services.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>filter:</span>
          <button
            onClick={() => setServiceFilter(null)}
            style={serviceFilter === null ? chipActive : chipIdle}
          >all</button>
          {services.map(s => (
            <button
              key={s.service}
              onClick={() => setServiceFilter(s.service)}
              style={serviceFilter === s.service ? chipActive : chipIdle}
              title={`${s.installed} installed · ${s.pending} pending`}
            >
              {s.service} <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>({s.installed}/{s.pending})</span>
            </button>
          ))}
        </div>
      )}

      <section>
        <h3 style={sectionHeading}>Pending review ({pending.length})</h3>
        {pending.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: 8 }}>
            No skills awaiting review. Producers call <code>propose_skill</code> after verified-successful tasks; proposals land here grouped by service.
          </div>
        )}
        {pending.map(s => (
          <div key={`${s.service}::${s.filename}`} style={skillRow}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={serviceBadge}>{s.service}</span>
                <span style={skillName}>{s.name}</span>
              </div>
              <div style={skillDesc}>{s.description}</div>
              <div style={skillMeta}>
                {s.proposedAt && `proposed ${new Date(s.proposedAt).toLocaleString()} · `}
                {s.bodyLength} chars · <code>{s.filename}</code>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => preview(s.filename)} style={btnGhost} title="View raw">
                <FileText size={14} />
              </button>
              <button onClick={() => promote(s.filename)} style={btnSuccess} title="Promote">
                <Check size={14} />
              </button>
              <button onClick={() => reject(s.filename)} style={btnDanger} title="Reject">
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3 style={sectionHeading}>Installed ({installed.length})</h3>
        {installed.map(s => (
          <div key={`${s.service}::${s.filename}`} style={skillRow}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={serviceBadge}>{s.service}</span>
                <span style={skillName}>{s.name}</span>
              </div>
              <div style={skillDesc}>{s.description}</div>
              <div style={skillMeta}><code>{s.filename}</code> · {s.bodyLength} chars</div>
            </div>
          </div>
        ))}
      </section>

      {previewing && (
        <div style={modalBackdrop} onClick={() => setPreviewing(null)}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ ...sectionHeading, margin: 0 }}>{previewing.filename}</h3>
              <button onClick={() => setPreviewing(null)} style={btnGhost}><X size={14} /></button>
            </div>
            <pre style={{
              margin: 0, padding: 12, background: 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(34,211,238,0.15)', borderRadius: 4,
              fontSize: '0.78rem', color: 'var(--text-main)',
              whiteSpace: 'pre-wrap', maxHeight: 480, overflowY: 'auto',
            }}>{previewing.raw}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pens tab ───────────────────────────────────────────────────────────────

interface PenSummary {
  slug: string;
  displayName: string;
  voiceTagline: string | null;
  currentLoraVersion: number | null;
}

function PensTab() {
  const [pens, setPens] = useState<PenSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ soul: string | null; lessons: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Edit mode is independent per file — operator can tweak just SOUL or just LESSONS.
  const [editingSoul, setEditingSoul] = useState(false);
  const [editingLessons, setEditingLessons] = useState(false);
  const [draftSoul, setDraftSoul] = useState('');
  const [draftLessons, setDraftLessons] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/pens`)
      .then(r => r.json())
      .then(j => {
        const list: PenSummary[] = Array.isArray(j) ? j : (j.pens || []);
        setPens(list);
        if (list.length > 0) setSelected(list[0].slug);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadProfile = (slug: string) => {
    fetch(`${API_BASE}/pens/${encodeURIComponent(slug)}/profile`)
      .then(r => r.json())
      .then(j => setProfile({ soul: j.soul, lessons: j.lessons }))
      .catch(e => setErr(e.message));
  };

  useEffect(() => {
    if (!selected) return;
    // Cancel any pending edits when switching pens
    setEditingSoul(false); setEditingLessons(false);
    loadProfile(selected);
  }, [selected]);

  const refresh = async () => {
    if (!selected) return;
    setRefreshing(true); setErr(null);
    try {
      const r = await fetch(`${API_BASE}/pens/${encodeURIComponent(selected)}/refresh-profile`, { method: 'POST' });
      if (!r.ok) throw new Error(await r.text());
      loadProfile(selected);
    } catch (e: any) { setErr(e.message); }
    finally { setRefreshing(false); }
  };

  const beginEdit = (which: 'soul' | 'lessons') => {
    if (which === 'soul') {
      setDraftSoul(profile?.soul ?? '');
      setEditingSoul(true);
    } else {
      setDraftLessons(profile?.lessons ?? '');
      setEditingLessons(true);
    }
  };

  const cancelEdit = (which: 'soul' | 'lessons') => {
    if (which === 'soul') setEditingSoul(false);
    else setEditingLessons(false);
  };

  const saveEdit = async (which: 'soul' | 'lessons') => {
    if (!selected) return;
    setSaving(true); setErr(null);
    try {
      const body: any = {};
      if (which === 'soul') body.soul = draftSoul;
      else body.lessons = draftLessons;
      const r = await fetch(`${API_BASE}/pens/${encodeURIComponent(selected)}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      // Optimistic: update local view from drafts, also re-fetch to confirm.
      setProfile(prev => ({
        soul: which === 'soul' ? draftSoul : (prev?.soul ?? null),
        lessons: which === 'lessons' ? draftLessons : (prev?.lessons ?? null),
      }));
      if (which === 'soul') setEditingSoul(false);
      else setEditingLessons(false);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: 12 }}>Loading pens…</div>;

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%' }}>
      <aside style={{ width: 200, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {pens.map(p => (
          <button
            key={p.slug}
            onClick={() => setSelected(p.slug)}
            style={{
              ...penListBtn,
              borderColor: selected === p.slug ? 'rgba(34,211,238,0.4)' : 'rgba(34,211,238,0.1)',
              background: selected === p.slug ? 'rgba(34,211,238,0.08)' : 'transparent',
            }}
          >
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--secondary)' }}>{p.slug}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {p.voiceTagline ? p.voiceTagline.slice(0, 50) : '(no tagline)'}
            </div>
          </button>
        ))}
      </aside>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
        {err && <div style={errBox}>{err}</div>}
        {selected && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={sectionHeading}>{selected}</h3>
              <button onClick={refresh} disabled={refreshing || editingSoul || editingLessons} style={btnPrimary(refreshing)} title="Regenerate from pen data + audit history. Will overwrite manual edits.">
                <RotateCcw size={12} /> {refreshing ? 'Refreshing…' : 'Refresh profile'}
              </button>
            </div>

            <EditableCard
              title="SOUL.md"
              body={profile?.soul}
              placeholder="No SOUL.md yet — refresh to generate."
              editing={editingSoul}
              draft={draftSoul}
              saving={saving}
              onDraftChange={setDraftSoul}
              onBeginEdit={() => beginEdit('soul')}
              onCancel={() => cancelEdit('soul')}
              onSave={() => saveEdit('soul')}
            />

            <EditableCard
              title="LESSONS.md"
              body={profile?.lessons}
              placeholder="No LESSONS.md yet — refresh after an audit completes."
              editing={editingLessons}
              draft={draftLessons}
              saving={saving}
              onDraftChange={setDraftLessons}
              onBeginEdit={() => beginEdit('lessons')}
              onCancel={() => cancelEdit('lessons')}
              onSave={() => saveEdit('lessons')}
            />

            {(editingSoul || editingLessons) && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '4px 8px' }}>
                Note: the next audit on this pen will regenerate these files automatically. Manual edits will be overwritten then.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EditableCard({
  title, body, placeholder, editing, draft, saving,
  onDraftChange, onBeginEdit, onCancel, onSave,
}: {
  title: string;
  body: string | null | undefined;
  placeholder: string;
  editing: boolean;
  draft: string;
  saving: boolean;
  onDraftChange: (s: string) => void;
  onBeginEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h4 style={{ ...sectionHeading, fontSize: '0.78rem', margin: 0 }}>{title}</h4>
        <div style={{ display: 'flex', gap: 6 }}>
          {!editing && (
            <button onClick={onBeginEdit} style={btnGhost} title={`Edit ${title}`}>
              <Edit3 size={12} />
            </button>
          )}
          {editing && (
            <>
              <button onClick={onSave} disabled={saving} style={btnSuccess} title="Save">
                <Save size={12} /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={onCancel} disabled={saving} style={btnDanger} title="Cancel">
                <X size={12} />
              </button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={e => onDraftChange(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%', minHeight: 200, padding: 12,
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(34,211,238,0.3)',
            borderRadius: 6,
            fontSize: '0.82rem', color: 'var(--text-main)',
            fontFamily: 'var(--font-mono)',
            resize: 'vertical',
            textTransform: 'none',
          }}
        />
      ) : (
        <pre style={{
          margin: 0, padding: 12,
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(34,211,238,0.1)',
          borderRadius: 6,
          fontSize: '0.82rem', color: 'var(--text-main)',
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--font-mono)',
        }}>
          {body || placeholder}
        </pre>
      )}
    </section>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const sectionHeading: React.CSSProperties = {
  margin: '8px 0',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.85rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--secondary)',
};

const skillRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 10,
  background: 'rgba(7,9,15,0.5)',
  border: '1px solid rgba(34,211,238,0.1)',
  borderRadius: 6,
  marginBottom: 6,
};

const skillName: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.88rem',
  color: 'var(--secondary)',
};

const skillDesc: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--text-main)',
  marginTop: 2,
};

const skillMeta: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--text-muted)',
  marginTop: 4,
};

const chipBase: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.72rem',
  padding: '3px 9px',
  borderRadius: 12,
  cursor: 'pointer',
  border: '1px solid rgba(34,211,238,0.25)',
  background: 'rgba(7,9,15,0.4)',
  color: 'var(--text-muted)',
  letterSpacing: 0.5,
};

const chipIdle: React.CSSProperties = chipBase;

const chipActive: React.CSSProperties = {
  ...chipBase,
  background: 'rgba(34,211,238,0.18)',
  borderColor: 'rgba(34,211,238,0.6)',
  color: 'var(--secondary)',
};

const serviceBadge: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.65rem',
  padding: '2px 7px',
  borderRadius: 3,
  background: 'rgba(168,85,247,0.12)',
  border: '1px solid rgba(168,85,247,0.3)',
  color: '#c4a8ff',
  letterSpacing: 0.5,
  textTransform: 'uppercase',
};

const hitRow: React.CSSProperties = {
  background: 'rgba(7,9,15,0.4)',
  border: '1px solid rgba(34,211,238,0.08)',
  borderRadius: 6,
};

const hitHeader: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
};

const errBox: React.CSSProperties = {
  padding: 10,
  background: 'rgba(220,38,38,0.1)',
  border: '1px solid rgba(220,38,38,0.3)',
  borderRadius: 6,
  color: '#FCA5A5',
  fontSize: '0.82rem',
  marginBottom: 8,
};

const penListBtn: React.CSSProperties = {
  textAlign: 'left',
  padding: 10,
  border: '1px solid',
  borderRadius: 6,
  cursor: 'pointer',
  color: 'var(--text-main)',
  display: 'flex', flexDirection: 'column', gap: 2,
};

function btnPrimary(disabled?: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    background: 'rgba(34,211,238,0.15)',
    border: '1px solid rgba(34,211,238,0.4)',
    borderRadius: 6,
    color: 'var(--secondary)',
    cursor: disabled ? 'wait' : 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    display: 'inline-flex', alignItems: 'center', gap: 6,
    opacity: disabled ? 0.6 : 1,
  };
}

const btnGhost: React.CSSProperties = {
  padding: 6,
  background: 'transparent',
  border: '1px solid rgba(34,211,238,0.2)',
  borderRadius: 6,
  color: 'var(--text-muted)',
  cursor: 'pointer',
};

const btnSuccess: React.CSSProperties = {
  padding: 6,
  background: 'rgba(34,197,94,0.12)',
  border: '1px solid rgba(34,197,94,0.4)',
  borderRadius: 6,
  color: '#86EFAC',
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  padding: 6,
  background: 'rgba(220,38,38,0.12)',
  border: '1px solid rgba(220,38,38,0.4)',
  borderRadius: 6,
  color: '#FCA5A5',
  cursor: 'pointer',
};

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 200,
};

const modalBox: React.CSSProperties = {
  width: '80%', maxWidth: 800, maxHeight: '80%',
  background: 'rgba(10,15,25,0.98)',
  border: '1px solid rgba(34,211,238,0.3)',
  borderRadius: 8,
  padding: 16,
  display: 'flex', flexDirection: 'column',
};
