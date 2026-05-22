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
import { Search, BookOpen, RotateCcw, Check, X, ChevronDown, ChevronRight, FileText, Sparkles, Edit3, Save, Pin, Trash2, Activity, Shield, Layers, Loader2, AlertTriangle, Wand2 } from 'lucide-react';
import { DiffViewer } from './DiffViewer';

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
  const [optimizing, setOptimizing] = useState<string | null>(null);
  const [diffingProposal, setDiffingProposal] = useState<any | null>(null);

  // Librarian states
  const [pins, setPins] = useState<Array<{ service: string; name: string }>>([]);
  const [proposals, setProposals] = useState<Array<{ id: string; skill_name: string; service: string; action: string; status: string; details: any }>>([]);
  const [telemetry, setTelemetry] = useState<{
    stats: Array<{ service: string; name: string; total: number; successRate: number; avgDurationMs: number }>;
    history: Array<{ id: string; service: string; skill_name: string; timestamp: string; success: number; duration_ms: number; error: string | null }>;
  }>({ stats: [], history: [] });
  const [backups, setBackups] = useState<string[]>([]);
  
  // Librarian pass states
  const [runningPass, setRunningPass] = useState(false);
  const [passResults, setPassResults] = useState<any>(null);
  const [dryRun, setDryRun] = useState(true);
  const [runLlmReview, setRunLlmReview] = useState(false);
  
  // Rollback state
  const [rollbackSelected, setRollbackSelected] = useState('');
  const [rollingBack, setRollingBack] = useState(false);
  
  // Merge states
  const [mergeService, setMergeService] = useState('');
  const [mergeSkillA, setMergeSkillA] = useState('');
  const [mergeSkillB, setMergeSkillB] = useState('');
  const [mergeNewName, setMergeNewName] = useState('');
  const [merging, setMerging] = useState(false);

  const refresh = async (svc?: string | null) => {
    setLoading(true); setErr(null);
    try {
      const qs = svc ? `?service=${encodeURIComponent(svc)}` : '';
      const [rSkills, rPins, rProposals, rTelemetry, rBackups] = await Promise.all([
        fetch(`${API_BASE}/skills${qs}`),
        fetch(`${API_BASE}/skills/pins`),
        fetch(`${API_BASE}/skills/proposals`),
        fetch(`${API_BASE}/skills/telemetry`),
        fetch(`${API_BASE}/skills/backups`),
      ]);

      if (!rSkills.ok) throw new Error(`Skills fetch failed: ${rSkills.statusText}`);
      
      const [jSkills, jPins, jProposals, jTelemetry, jBackups] = await Promise.all([
        rSkills.json(),
        rPins.ok ? rPins.json() : { pins: [] },
        rProposals.ok ? rProposals.json() : { proposals: [] },
        rTelemetry.ok ? rTelemetry.json() : { stats: [], history: [] },
        rBackups.ok ? rBackups.json() : { backups: [] },
      ]);

      setInstalled(jSkills.installed || []);
      setPending(jSkills.pending || []);
      setServices(jSkills.services || []);
      setPins(jPins.pins || []);
      setProposals(jProposals.proposals || []);
      setTelemetry({
        stats: jTelemetry.stats || [],
        history: jTelemetry.history || [],
      });
      setBackups(jBackups.backups || []);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(serviceFilter); }, [serviceFilter]);

  const optimizeSkill = async (service: string, name: string) => {
    if (!confirm(`Run GEPA Prompt Optimization for skill "${service}/${name}"?\nThis will analyze past failures, generate mutations, backtest them, and propose improvements.`)) return;
    setOptimizing(`${service}/${name}`);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/skills/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Optimization failed');
      if (data.success) {
        alert(`Optimization completed! A new proposal was created: ${data.proposalId}`);
      } else {
        alert(`Optimization finished but no improvements found: ${data.reason || 'none'}`);
      }
      refresh(serviceFilter);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setOptimizing(null);
    }
  };

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

  const togglePin = async (service: string, name: string) => {
    const isPinned = pins.some(p => p.service === service && p.name === name);
    try {
      const endpoint = isPinned ? 'unpin' : 'pin';
      const r = await fetch(`${API_BASE}/skills/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, name }),
      });
      if (!r.ok) throw new Error(await r.text());
      // Refresh pins
      const pinRes = await fetch(`${API_BASE}/skills/pins`);
      if (pinRes.ok) {
        const j = await pinRes.json();
        setPins(j.pins || []);
      }
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const deleteInstalled = async (service: string, name: string) => {
    if (!confirm(`Are you sure you want to delete installed skill "${service}/${name}"?`)) return;
    try {
      const r = await fetch(`${API_BASE}/skills/installed/${encodeURIComponent(service)}/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      alert(`Deleted installed skill ${service}/${name}.`);
      refresh(serviceFilter);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const approveProposal = async (id: string) => {
    try {
      const r = await fetch(`${API_BASE}/skills/proposals/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      alert(`Proposal approved and applied.`);
      refresh(serviceFilter);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const rejectProposal = async (id: string) => {
    try {
      const r = await fetch(`${API_BASE}/skills/proposals/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      alert(`Proposal rejected.`);
      refresh(serviceFilter);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const handleMerge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergeService || !mergeSkillA || !mergeSkillB || !mergeNewName) {
      alert('All fields are required to merge skills.');
      return;
    }
    if (mergeSkillA === mergeSkillB) {
      alert('Skill A and Skill B must be different.');
      return;
    }
    setMerging(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/skills/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: mergeService,
          skillA: mergeSkillA,
          skillB: mergeSkillB,
          newSkillName: mergeNewName,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      alert(`Merged skills into "${mergeNewName}".`);
      setMergeSkillA('');
      setMergeSkillB('');
      setMergeNewName('');
      refresh(serviceFilter);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setMerging(false);
    }
  };

  const triggerLibrarianPass = async () => {
    setRunningPass(true);
    setErr(null);
    setPassResults(null);
    try {
      const r = await fetch(`${API_BASE}/skills/librarian-pass`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, runLlmReview }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      setPassResults(data);
      refresh(serviceFilter);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunningPass(false);
    }
  };

  const triggerRollback = async () => {
    if (!rollbackSelected) {
      alert('Please select a backup snapshot to rollback.');
      return;
    }
    if (!confirm(`Are you sure you want to rollback skills to snapshot "${rollbackSelected}"?`)) return;
    setRollingBack(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/skills/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: rollbackSelected }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      alert(`Successfully rolled back to snapshot ${rollbackSelected}.`);
      setRollbackSelected('');
      refresh(serviceFilter);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRollingBack(false);
    }
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

      {/* Two Column Layout Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(320px, 1fr)', gap: 20, alignItems: 'start' }}>
        {/* Left Column: Skills Curation & Merge */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Pending Review Section */}
          <section style={cardPanelStyle}>
            <h3 style={sectionHeadingWithIcon}>
              <Sparkles size={16} style={{ color: 'var(--secondary)' }} />
              Pending Review ({pending.length})
            </h3>
            {pending.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '8px 0', fontStyle: 'italic' }}>
                No pending skills awaiting review.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                      <button onClick={() => preview(s.filename)} style={btnGhost} title="View raw code">
                        <FileText size={14} />
                      </button>
                      <button onClick={() => promote(s.filename)} style={btnSuccess} title="Approve & Promote">
                        <Check size={14} />
                      </button>
                      <button onClick={() => reject(s.filename)} style={btnDanger} title="Reject & Delete">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Installed Skills Section */}
          <section style={cardPanelStyle}>
            <h3 style={sectionHeadingWithIcon}>
              <BookOpen size={16} style={{ color: 'var(--secondary)' }} />
              Installed Skills ({installed.length})
            </h3>
            {installed.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '8px 0', fontStyle: 'italic' }}>
                No installed skills found.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto' }}>
                {installed.map(s => {
                  const isPinned = pins.some(p => p.service === s.service && p.name === s.name);
                  const stat = telemetry.stats.find(st => st.service === s.service && st.name === s.name);
                  const isLowPerf = stat && stat.total >= 3 && stat.successRate < 0.85;
                  const isSvcName = `${s.service}/${s.name}`;
                  const isCurrentlyOptimizing = optimizing === isSvcName;
                  return (
                    <div key={`${s.service}::${s.filename}`} style={skillRow}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={serviceBadge}>{s.service}</span>
                          <span style={skillName}>{s.name}</span>
                          {isPinned && (
                            <span style={pinnedBadge}>
                              <Pin size={10} style={{ fill: '#c4a8ff' }} /> PINNED
                            </span>
                          )}
                          {isLowPerf && (
                            <span style={lowPerfWarningStyle} title={`Success rate: ${(stat.successRate * 100).toFixed(1)}% over ${stat.total} runs. Optimization recommended.`}>
                              <AlertTriangle size={10} style={{ color: '#FCA5A5', marginRight: 3 }} /> LOW PERF
                            </span>
                          )}
                        </div>
                        <div style={skillDesc}>{s.description}</div>
                        <div style={skillMeta}>
                          <code>{s.filename}</code> · {s.bodyLength} chars
                          {stat && ` · Runs: ${stat.total} · Success: ${(stat.successRate * 100).toFixed(0)}%`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          onClick={() => optimizeSkill(s.service, s.name)}
                          disabled={isCurrentlyOptimizing}
                          style={isLowPerf ? btnOptimizeHighlight(isCurrentlyOptimizing) : btnGhost}
                          title="Run GEPA Prompt Optimization"
                        >
                          {isCurrentlyOptimizing ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Wand2 size={14} />
                          )}
                        </button>
                        <button
                          onClick={() => togglePin(s.service, s.name)}
                          style={isPinned ? btnPinActive : btnGhost}
                          title={isPinned ? 'Unpin skill' : 'Pin skill'}
                        >
                          <Pin size={14} style={{ fill: isPinned ? '#c4a8ff' : 'none' }} />
                        </button>
                        <button
                          onClick={() => deleteInstalled(s.service, s.name)}
                          disabled={isPinned}
                          style={isPinned ? btnDangerDisabled : btnDanger}
                          title={isPinned ? 'Unpin to enable deletion' : 'Delete skill'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Merge Skills Section */}
          <section style={cardPanelStyle}>
            <h3 style={sectionHeadingWithIcon}>
              <Layers size={16} style={{ color: 'var(--secondary)' }} />
              Merge Skills / Synthesis
            </h3>
            <form onSubmit={handleMerge} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={formRow}>
                <label style={formLabel}>Service Domain</label>
                <select
                  value={mergeService}
                  onChange={e => {
                    setMergeService(e.target.value);
                    setMergeSkillA('');
                    setMergeSkillB('');
                  }}
                  style={formInput}
                >
                  <option value="">-- Select Service --</option>
                  {Array.from(new Set(installed.map(s => s.service))).map(svc => (
                    <option key={svc} value={svc}>{svc}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={formRow}>
                  <label style={formLabel}>Skill A (Base)</label>
                  <select
                    value={mergeSkillA}
                    onChange={e => setMergeSkillA(e.target.value)}
                    disabled={!mergeService}
                    style={formInput}
                  >
                    <option value="">-- Skill A --</option>
                    {installed
                      .filter(s => s.service === mergeService)
                      .map(s => (
                        <option key={s.name} value={s.name}>{s.name}</option>
                      ))}
                  </select>
                </div>
                <div style={formRow}>
                  <label style={formLabel}>Skill B (Extension)</label>
                  <select
                    value={mergeSkillB}
                    onChange={e => setMergeSkillB(e.target.value)}
                    disabled={!mergeService}
                    style={formInput}
                  >
                    <option value="">-- Skill B --</option>
                    {installed
                      .filter(s => s.service === mergeService && s.name !== mergeSkillA)
                      .map(s => (
                        <option key={s.name} value={s.name}>{s.name}</option>
                      ))}
                  </select>
                </div>
              </div>
              <div style={formRow}>
                <label style={formLabel}>Synthesized Skill Name</label>
                <input
                  type="text"
                  placeholder="e.g. unified-code-standards"
                  value={mergeNewName}
                  onChange={e => setMergeNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  style={formInput}
                />
              </div>
              <button
                type="submit"
                disabled={merging || !mergeService || !mergeSkillA || !mergeSkillB || !mergeNewName}
                style={btnPrimary(merging)}
              >
                {merging ? <Loader2 size={12} className="animate-spin" /> : null}
                {merging ? 'Synthesizing...' : 'Synthesize & Merge'}
              </button>
            </form>
          </section>
        </div>

        {/* Right Column: Librarian Center, Proposals & Telemetry */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Librarian Center controls */}
          <section style={cardPanelStyle}>
            <h3 style={sectionHeadingWithIcon}>
              <Shield size={16} style={{ color: 'var(--secondary)' }} />
              Librarian Center
            </h3>
            
            {/* Run Pass */}
            <div style={{ borderBottom: '1px solid rgba(34,211,238,0.1)', paddingBottom: 16, marginBottom: 16 }}>
              <h4 style={subSectionTitle}>Librarian Pipeline Pass</h4>
              <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: '0.78rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-main)' }}>
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={e => setDryRun(e.target.checked)}
                    style={{ accentColor: 'var(--secondary)' }}
                  />
                  Dry Run (no file writes)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-main)' }}>
                  <input
                    type="checkbox"
                    checked={runLlmReview}
                    onChange={e => setRunLlmReview(e.target.checked)}
                    style={{ accentColor: 'var(--secondary)' }}
                  />
                  Run LLM Review
                </label>
              </div>
              <button onClick={triggerLibrarianPass} disabled={runningPass} style={btnPrimary(runningPass)}>
                {runningPass ? <Loader2 size={12} className="animate-spin" /> : null}
                {runningPass ? 'Executing Librarian...' : 'Run Librarian Pass'}
              </button>
              
              {passResults && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--secondary)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>Pass Results:</div>
                  <pre style={{
                    margin: 0, padding: 10, background: 'rgba(0,0,0,0.5)',
                    border: '1px solid rgba(34,211,238,0.15)', borderRadius: 4,
                    fontSize: '0.72rem', color: 'var(--text-main)',
                    whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {JSON.stringify(passResults, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Backups & Rollback */}
            <div>
              <h4 style={subSectionTitle}>System Restore & Rollback</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                  Select a past Librarian backup snapshot timestamp to restore skills to that point. Pinned skills are safe.
                </div>
                {backups.length === 0 ? (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No backups found.</div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      value={rollbackSelected}
                      onChange={e => setRollbackSelected(e.target.value)}
                      style={{ ...formInput, flex: 1 }}
                    >
                      <option value="">-- Choose snapshot backup --</option>
                      {backups.map(b => (
                        <option key={b} value={b}>
                          {new Date(parseInt(b, 10) || b).toLocaleString()}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={triggerRollback}
                      disabled={rollingBack || !rollbackSelected}
                      style={{
                        ...btnDanger,
                        padding: '6px 12px',
                        fontSize: '0.75rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        opacity: (rollingBack || !rollbackSelected) ? 0.6 : 1,
                        cursor: (rollingBack || !rollbackSelected) ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {rollingBack ? 'Restoring...' : 'Rollback'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Librarian Proposals */}
          <section style={cardPanelStyle}>
            <h3 style={sectionHeadingWithIcon}>
              <Layers size={16} style={{ color: 'var(--secondary)' }} />
              Librarian Proposals ({proposals.length})
            </h3>
            {proposals.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '8px 0', fontStyle: 'italic' }}>
                No active librarian recommendations or curation proposals.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {proposals.map(p => (
                  <div key={p.id} style={proposalRowStyle}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={serviceBadge}>{p.service}</span>
                        <span style={skillName}>{p.skill_name}</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-main)', marginTop: 2 }}>
                        Action: <strong style={{ color: p.action === 'delete' ? '#FCA5A5' : '#86EFAC', textTransform: 'uppercase' }}>{p.action}</strong>
                      </div>
                      {p.details && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>
                          {(() => {
                            if (typeof p.details === 'string') return p.details;
                            if (typeof p.details === 'object' && p.details !== null) {
                              const d = p.details;
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {d.reason && <div>{d.reason}</div>}
                                  {d.telemetry && (
                                    <div style={{ color: 'var(--secondary)', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                                      Telemetry: <span style={{ color: '#86EFAC', fontWeight: 'bold' }}>{d.telemetry.improvementScore}</span> improvement over {d.telemetry.failureCount} failure(s) / {d.telemetry.successCount} success(s)
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {p.action === 'optimize' && p.details && p.details.original && p.details.mutated && (
                        <button
                          onClick={() => setDiffingProposal(p)}
                          style={btnGhost}
                          title="View original vs mutated diff"
                        >
                          <FileText size={14} />
                        </button>
                      )}
                      <button onClick={() => approveProposal(p.id)} style={btnSuccess} title="Approve Recommendation">
                        <Check size={14} />
                      </button>
                      <button onClick={() => rejectProposal(p.id)} style={btnDanger} title="Reject Recommendation">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Skill Telemetry & Performance */}
          <section style={cardPanelStyle}>
            <h3 style={sectionHeadingWithIcon}>
              <Activity size={16} style={{ color: 'var(--secondary)' }} />
              Skill Performance Telemetry
            </h3>
            
            {/* Aggregate table */}
            <div style={{ marginBottom: 16 }}>
              <h4 style={subSectionTitle}>Execution Aggregates</h4>
              {telemetry.stats.length === 0 ? (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No skill execution stats recorded yet.</div>
              ) : (
                <div style={{ overflowX: 'auto', maxHeight: 180, overflowY: 'auto', border: '1px solid rgba(34,211,238,0.1)', borderRadius: 4 }}>
                  <table style={telemetryTableStyle}>
                    <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,15,25,0.98)', zIndex: 10 }}>
                      <tr>
                        <th style={telemetryThStyle}>Skill</th>
                        <th style={telemetryThStyle}>Runs</th>
                        <th style={telemetryThStyle}>Success</th>
                        <th style={telemetryThStyle}>Avg Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {telemetry.stats.map(s => (
                        <tr key={`${s.service}:${s.name}`} style={telemetryTrStyle}>
                          <td style={telemetryTdStyle}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{s.service}/</span>{s.name}
                          </td>
                          <td style={telemetryTdStyle}>{s.total}</td>
                          <td style={{ ...telemetryTdStyle, color: s.successRate > 0.9 ? '#86EFAC' : s.successRate > 0.7 ? '#fbbf24' : '#FCA5A5', fontWeight: 600 }}>
                            {(s.successRate * 100).toFixed(1)}%
                          </td>
                          <td style={telemetryTdStyle}>{s.avgDurationMs.toFixed(0)}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Run logs */}
            <div>
              <h4 style={subSectionTitle}>Recent Telemetry Logs</h4>
              {telemetry.history.length === 0 ? (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No run history logged.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                  {telemetry.history.slice(0, 15).map(h => (
                    <div key={h.id} style={telemetryHistoryRowStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-main)', fontWeight: 500 }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{h.service}/</span>{h.skill_name}
                        </span>
                        <span style={{
                          fontSize: '0.65rem',
                          color: h.success === 1 ? '#86EFAC' : '#FCA5A5',
                          fontWeight: 'bold',
                          letterSpacing: 0.5
                        }}>
                          {h.success === 1 ? 'SUCCESS' : 'FAILED'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>
                        <span>{new Date(h.timestamp).toLocaleTimeString()} · {h.duration_ms}ms</span>
                        {h.error && (
                          <span
                            style={{ color: '#FCA5A5', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '60%' }}
                            title={h.error}
                          >
                            {h.error}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

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

      {diffingProposal && (
        <DiffViewer
          before={diffingProposal.details.original}
          after={diffingProposal.details.mutated}
          beforeLabel="Original Skill Instructions"
          afterLabel="Evolved Mutated Instructions (GEPA)"
          onClose={() => setDiffingProposal(null)}
        />
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

const cardPanelStyle: React.CSSProperties = {
  background: 'rgba(7,9,15,0.4)',
  border: '1px solid rgba(34,211,238,0.15)',
  borderRadius: 8,
  padding: 16,
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

const sectionHeadingWithIcon: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: '0 0 12px 0',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.9rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--secondary)',
  borderBottom: '1px solid rgba(34,211,238,0.1)',
  paddingBottom: 8,
};

const subSectionTitle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.78rem',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-main)',
  margin: '0 0 8px 0',
};

const pinnedBadge: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.6rem',
  padding: '1px 5px',
  borderRadius: 3,
  background: 'rgba(168,85,247,0.2)',
  border: '1px solid rgba(168,85,247,0.5)',
  color: '#c4a8ff',
  letterSpacing: 0.5,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
};

const btnPinActive: React.CSSProperties = {
  padding: 6,
  background: 'rgba(168,85,247,0.15)',
  border: '1px solid rgba(168,85,247,0.4)',
  borderRadius: 6,
  color: '#c4a8ff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const btnDangerDisabled: React.CSSProperties = {
  padding: 6,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 6,
  color: 'var(--text-muted)',
  cursor: 'not-allowed',
  opacity: 0.5,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const lowPerfWarningStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.6rem',
  padding: '1px 5px',
  borderRadius: 3,
  background: 'rgba(239,68,68,0.15)',
  border: '1px solid rgba(239,68,68,0.4)',
  color: '#FCA5A5',
  letterSpacing: 0.5,
  display: 'inline-flex',
  alignItems: 'center',
};

function btnOptimizeHighlight(disabled?: boolean): React.CSSProperties {
  return {
    padding: 6,
    background: 'rgba(34,211,238,0.15)',
    border: '1px solid rgba(34,211,238,0.5)',
    borderRadius: 6,
    color: 'var(--secondary)',
    cursor: disabled ? 'wait' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 8px rgba(34,211,238,0.25)',
  };
}

const formRow: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const formLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.72rem',
  color: 'var(--text-muted)',
};

const formInput: React.CSSProperties = {
  padding: '6px 10px',
  background: 'rgba(7,9,15,0.6)',
  border: '1px solid rgba(34,211,238,0.2)',
  borderRadius: 6,
  color: 'var(--text-main)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.78rem',
  outline: 'none',
};

const proposalRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 8,
  background: 'rgba(7,9,15,0.5)',
  border: '1px solid rgba(34,211,238,0.1)',
  borderRadius: 6,
};

const telemetryTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.75rem',
  fontFamily: 'var(--font-mono)',
};

const telemetryThStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: '1px solid rgba(34,211,238,0.2)',
  color: 'var(--text-muted)',
  fontSize: '0.7rem',
  textTransform: 'uppercase',
};

const telemetryTrStyle: React.CSSProperties = {
  borderBottom: '1px solid rgba(34,211,238,0.05)',
};

const telemetryTdStyle: React.CSSProperties = {
  padding: '6px 8px',
  color: 'var(--text-main)',
};

const telemetryHistoryRowStyle: React.CSSProperties = {
  padding: 8,
  background: 'rgba(7,9,15,0.5)',
  border: '1px solid rgba(34,211,238,0.08)',
  borderRadius: 6,
  fontFamily: 'var(--font-mono)',
};
