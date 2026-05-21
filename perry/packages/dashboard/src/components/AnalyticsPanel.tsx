import { ActivityHeatmap } from './ActivityHeatmap';
/**
 * AnalyticsPanel — Perry-flavoured analytics view.
 *
 * Inspired by Hermes' Analytics tab but tuned to the metrics we actually
 * capture: step volume, success rate, prompt-size trends, audit health,
 * LoRA training cadence. NOT token/cost — the llm_telemetry table only
 * stores prompts (no token counts or cost). Add token tracking later if
 * you want a Hermes-equivalent cost view.
 *
 * Backed by GET /api/analytics/summary?days=N.
 *
 * Chart: hand-rolled inline SVG. Avoids pulling in a 1MB+ chart library
 * for what's effectively one stacked bar chart. Cyberpunk-styled to
 * match the rest of the dashboard.
 */

import { useEffect, useState, useMemo } from 'react';
import { PanelHeader } from './PanelHeader';
import { BarChart3, TrendingUp, AlertTriangle, GitBranch, HardDrive, RotateCcw } from 'lucide-react';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV)
  ? 'http://localhost:4000/api' : '/api';

interface Summary {
  windowDays: number;
  totals: { completed: number; failed: number; inProgress: number; pending: number };
  successRate: number;
  daily: Array<{ day: string; completed: number; failed: number; byType: Record<string, number> }>;
  byProject: Array<{ projectId: string; title: string; completed: number; lastActivity: string | null }>;
  promptSize: Array<{ day: string; avgChars: number; calls: number }>;
  loraCadence: Array<{ penSlug: string; version: number; trainedAt: string | null; promoted: boolean }>;
  auditHealth: Array<{ penSlug: string; topTags: Array<{ tag: string; count: number }> }>;
  learningCorpus?: Array<{ kind: string; count: number }>;
  referenceCorpus?: Array<{ kind: string; count: number }>;
  otherCorpus?: Array<{ kind: string; count: number }>;
}

const RANGE_OPTIONS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

// Distinct colours per task type. Reuses the same palette family as the rest
// of the dashboard so a stacked bar reads at a glance.
const TYPE_COLORS: Record<string, string> = {
  creative_writing:    '#22D3EE',  // cyan — the headline kind
  revision_execution:  '#A855F7',  // purple — paired with creative
  draft_compile:       '#7CFC00',  // green
  book_bible:          '#FFD166',  // amber
  outline:             '#FB923C',  // orange
  pov_check:           '#EC4899',  // pink
  stat_update:         '#94A3B8',  // slate
  continuity_check:    '#60A5FA',  // blue
  voice_profile:       '#FB7185',  // rose
  research_assist:     '#4ADE80',  // emerald
  analysis:            '#F87171',  // red-ish
};

function colorFor(type: string): string {
  return TYPE_COLORS[type] || '#64748B';
}

interface StorageSnapshot {
  workspace: Array<{ path: string; bytes: number; files: number }>;
  ragCorpus: { chunks: number; bytes: number };
  lastSweep: { trigger?: string; completedAt?: string; stages?: Record<string, any> } | null;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function AnalyticsPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageSnapshot | null>(null);
  const [runningGc, setRunningGc] = useState(false);

  const loadStorage = () => {
    fetch(`${API_BASE}/system/storage`)
      .then(r => r.ok ? r.json() : null)
      .then(j => setStorage(j))
      .catch(() => {});
  };
  useEffect(() => { loadStorage(); }, []);

  const runGcNow = async () => {
    if (!confirm('Run a full GC sweep now? Safe — sweeps stale claims, archived tasks, old debug files, RAG corpus retention, etc. Takes a few seconds.')) return;
    setRunningGc(true);
    try {
      const r = await fetch(`${API_BASE}/system/gc/run`, { method: 'POST' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'unknown error');
      loadStorage();
    } catch (e: any) { alert('GC failed: ' + e.message); }
    finally { setRunningGc(false); }
  };

  useEffect(() => {
    setLoading(true); setErr(null);
    fetch(`${API_BASE}/analytics/summary?days=${days}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(j => setData(j))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  // ── Top task types in this window (drives chart legend) ────────────
  const topTypes = useMemo(() => {
    if (!data) return [] as string[];
    const totals: Record<string, number> = {};
    for (const d of data.daily) {
      for (const [t, n] of Object.entries(d.byType)) {
        totals[t] = (totals[t] || 0) + n;
      }
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  }, [data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16 }}>
      <PanelHeader
        eyebrow="ANALYTICS"
        title="Pipeline Analytics"
        subtitle="Step volume · success rate · prompt-size trend · audit health"
        actions={
          <div style={{ display: 'flex', gap: 4 }}>
            {RANGE_OPTIONS.map(opt => {
              const active = days === opt.days;
              return (
                <button key={opt.days} onClick={() => setDays(opt.days)}
                        style={rangeBtn(active)}>
                  {opt.label}
                </button>
              );
            })}
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Activity heatmap — 365-day calendar of step completions + agent
            invocations. Visible evolution at a glance. */}
        <div style={{ padding: 14, background: 'rgba(7,9,15,0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Activity heatmap</div>
          <ActivityHeatmap days={365} />
        </div>
        {err && <div style={errBox}>{err}</div>}
        {loading && <div style={{ color: 'var(--text-muted)', padding: 12 }}>Loading…</div>}

        {data && !loading && (
          <>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Card label="Completed steps" value={data.totals.completed.toLocaleString()} icon={<TrendingUp size={14} />} accent="cyan" />
              <Card label="Failed steps" value={data.totals.failed.toLocaleString()} icon={<AlertTriangle size={14} />} accent="red" />
              <Card label="In progress" value={data.totals.inProgress.toLocaleString()} icon={<BarChart3 size={14} />} accent="amber" />
              <Card label="Success rate" value={`${(data.successRate * 100).toFixed(1)}%`} icon={<TrendingUp size={14} />} accent={data.successRate > 0.9 ? 'green' : data.successRate > 0.75 ? 'amber' : 'red'} />
            </div>

            {/* Daily stacked bar chart */}
            <section>
              <h3 style={sectionHeading}>Completed steps · last {data.windowDays} days</h3>
              {data.daily.length === 0 ? (
                <div style={emptyBox}>No completed steps in window.</div>
              ) : (
                <DailyBarChart daily={data.daily} types={topTypes} />
              )}
            </section>

            {/* Per-project breakdown */}
            <section>
              <h3 style={sectionHeading}>By project</h3>
              {data.byProject.length === 0 ? (
                <div style={emptyBox}>No project activity in window.</div>
              ) : (
                <table style={dataTable}>
                  <thead>
                    <tr>
                      <th style={th}>Project</th>
                      <th style={{ ...th, textAlign: 'right' }}>Completed</th>
                      <th style={th}>Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProject.map(p => (
                      <tr key={p.projectId}>
                        <td style={td}>
                          <span style={{ color: 'var(--secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{p.projectId}</span>
                          {p.title && p.title !== '(deleted)' && <span style={{ marginLeft: 8 }}>{p.title}</span>}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>{p.completed}</td>
                        <td style={{ ...td, color: 'var(--text-muted)' }}>{p.lastActivity ? new Date(p.lastActivity).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Prompt-size trend */}
            <section>
              <h3 style={sectionHeading}>Avg prompt size per call · proxy for compression health</h3>
              {data.promptSize.length === 0 ? (
                <div style={emptyBox}>No LLM telemetry in window.</div>
              ) : (
                <PromptSizeChart data={data.promptSize} />
              )}
            </section>

            {/* Audit health */}
            <section>
              <h3 style={sectionHeading}>Audit health · top failure patterns per pen</h3>
              {data.auditHealth.length === 0 ? (
                <div style={emptyBox}>No audit history yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.auditHealth.map(p => (
                    <div key={p.penSlug} style={penAuditRow}>
                      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--secondary)', fontSize: '0.82rem' }}>{p.penSlug}</div>
                      {p.topTags.length === 0 ? (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>no audit data</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {p.topTags.map(t => (
                            <span key={t.tag} style={tagChip}>
                              {t.tag} <span style={{ color: 'var(--text-muted)' }}>· {t.count}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Storage — proves the GC is keeping bloat in check */}
            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ ...sectionHeading, margin: 0 }}>
                  <HardDrive size={12} style={{ verticalAlign: 'middle' }} /> Storage · per-dir size + RAG corpus
                </h3>
                <button onClick={runGcNow} disabled={runningGc} style={rangeBtn(false)}>
                  <RotateCcw size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {runningGc ? 'Sweeping…' : 'Run GC now'}
                </button>
              </div>
              {!storage ? (
                <div style={emptyBox}>Loading storage snapshot…</div>
              ) : (
                <>
                  <table style={dataTable}>
                    <thead>
                      <tr>
                        <th style={th}>Path</th>
                        <th style={{ ...th, textAlign: 'right' }}>Files</th>
                        <th style={{ ...th, textAlign: 'right' }}>Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storage.workspace.map(w => (
                        <tr key={w.path}>
                          <td style={td}><span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{w.path}</span></td>
                          <td style={{ ...td, textAlign: 'right' }}>{w.files.toLocaleString()}</td>
                          <td style={{ ...td, textAlign: 'right', color: w.bytes > 5 * 1024 * 1024 * 1024 ? '#FCA5A5' : 'var(--text-main)' }}>
                            {formatBytes(w.bytes)}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td style={{ ...td, fontStyle: 'italic' }}>RAG corpus (memory.db chunks)</td>
                        <td style={{ ...td, textAlign: 'right' }}>{storage.ragCorpus.chunks.toLocaleString()}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{formatBytes(storage.ragCorpus.bytes)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {storage.lastSweep && (
                    <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Last sweep: {storage.lastSweep.trigger || '—'}
                      {storage.lastSweep.completedAt && ` · ${new Date(storage.lastSweep.completedAt).toLocaleString()}`}
                      {' · '}stages: {Object.keys(storage.lastSweep.stages || {}).length}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Learning corpus — proves the self-learning loop is producing data */}
            <section>
              <h3 style={sectionHeading}>Self-learning corpus · verified outputs indexed for future generation</h3>
              {(!data.learningCorpus || data.learningCorpus.length === 0) ? (
                <div style={emptyBox}>Empty. Verified chapters/calibrations/covers populate this corpus — run audits or complete chapters to start filling it.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  {data.learningCorpus.map(c => (
                    <Card key={c.kind} label={c.kind} value={c.count.toLocaleString()} accent="green" icon={<TrendingUp size={14} />} />
                  ))}
                </div>
              )}
              {data.referenceCorpus && data.referenceCorpus.length > 0 && (
                <div style={{ marginTop: 8, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Reference corpus (bibles, anchors): {data.referenceCorpus.reduce((s, r) => s + r.count, 0).toLocaleString()} chunks across {data.referenceCorpus.length} kinds.
                </div>
              )}
            </section>

            {/* LoRA training cadence */}
            <section>
              <h3 style={sectionHeading}><GitBranch size={12} style={{ verticalAlign: 'middle' }} /> Recent LoRA training</h3>
              {data.loraCadence.length === 0 ? (
                <div style={emptyBox}>No LoRA versions registered yet.</div>
              ) : (
                <table style={dataTable}>
                  <thead>
                    <tr>
                      <th style={th}>Pen</th>
                      <th style={th}>Version</th>
                      <th style={th}>Trained</th>
                      <th style={th}>Promoted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.loraCadence.map((r, i) => (
                      <tr key={`${r.penSlug}-${r.version}-${i}`}>
                        <td style={td}><span style={{ color: 'var(--secondary)', fontFamily: 'var(--font-mono)' }}>{r.penSlug}</span></td>
                        <td style={td}>v{r.version}</td>
                        <td style={{ ...td, color: 'var(--text-muted)' }}>{r.trainedAt ? new Date(r.trainedAt).toLocaleString() : '—'}</td>
                        <td style={td}>{r.promoted ? '✓' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Chart components ───────────────────────────────────────────────────────

function DailyBarChart({ daily, types }: { daily: Summary['daily']; types: string[] }) {
  const W = 800, H = 220, PAD_L = 40, PAD_B = 30, PAD_T = 8, PAD_R = 12;
  const chartW = W - PAD_L - PAD_R, chartH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...daily.map(d => Object.values(d.byType).reduce((a, b) => a + b, 0)));
  const barW = chartW / daily.length * 0.7;
  const gap = chartW / daily.length;
  // Y-axis ticks at 0, 25%, 50%, 75%, 100% of max (rounded).
  const ticks = [0, max * 0.25, max * 0.5, max * 0.75, max].map(v => Math.round(v));

  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        {types.map(t => (
          <span key={t} style={legendItem}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: colorFor(t), borderRadius: 2 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t}</span>
          </span>
        ))}
      </div>
      <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(34,211,238,0.1)', borderRadius: 6, padding: 8 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} preserveAspectRatio="xMidYMid meet">
          {/* Y-axis ticks + grid lines */}
          {ticks.map((t, i) => {
            const y = PAD_T + chartH - (t / max) * chartH;
            return (
              <g key={i}>
                <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="rgba(34,211,238,0.08)" strokeDasharray="2,4" />
                <text x={PAD_L - 6} y={y + 3} textAnchor="end" fill="rgba(148,163,184,0.7)" fontSize="9" fontFamily="var(--font-mono)">{t}</text>
              </g>
            );
          })}
          {/* Stacked bars */}
          {daily.map((d, i) => {
            const x = PAD_L + i * gap + (gap - barW) / 2;
            let yStack = PAD_T + chartH;
            return (
              <g key={d.day}>
                {types.map(t => {
                  const v = d.byType[t] || 0;
                  if (!v) return null;
                  const h = (v / max) * chartH;
                  yStack -= h;
                  return (
                    <rect key={t} x={x} y={yStack} width={barW} height={h} fill={colorFor(t)} opacity={0.85}>
                      <title>{`${d.day} · ${t} · ${v}`}</title>
                    </rect>
                  );
                })}
                {/* X-axis label — every 3rd day to avoid clutter */}
                {i % Math.max(1, Math.floor(daily.length / 8)) === 0 && (
                  <text x={x + barW / 2} y={H - PAD_B + 14} textAnchor="middle" fill="rgba(148,163,184,0.7)" fontSize="9" fontFamily="var(--font-mono)">
                    {d.day.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}

function PromptSizeChart({ data }: { data: Summary['promptSize'] }) {
  const W = 800, H = 140, PAD_L = 50, PAD_B = 24, PAD_T = 8, PAD_R = 12;
  const chartW = W - PAD_L - PAD_R, chartH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...data.map(d => d.avgChars));
  if (data.length < 1) return null;
  const x = (i: number) => PAD_L + (i / Math.max(1, data.length - 1)) * chartW;
  const y = (v: number) => PAD_T + chartH - (v / max) * chartH;
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.avgChars)}`).join(' ');

  return (
    <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(34,211,238,0.1)', borderRadius: 6, padding: 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} preserveAspectRatio="xMidYMid meet">
        {[0, 0.5, 1].map(f => {
          const yy = PAD_T + chartH - f * chartH;
          const v = Math.round(max * f);
          return (
            <g key={f}>
              <line x1={PAD_L} y1={yy} x2={W - PAD_R} y2={yy} stroke="rgba(34,211,238,0.08)" strokeDasharray="2,4" />
              <text x={PAD_L - 6} y={yy + 3} textAnchor="end" fill="rgba(148,163,184,0.7)" fontSize="9" fontFamily="var(--font-mono)">{v}</text>
            </g>
          );
        })}
        <path d={path} fill="none" stroke="#22D3EE" strokeWidth={1.5} />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.avgChars)} r={2.5} fill="#22D3EE">
            <title>{`${d.day} · avg ${d.avgChars} chars · ${d.calls} calls`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

// ─── Card + style tokens ────────────────────────────────────────────────────

function Card({ label, value, icon, accent }: { label: string; value: string; icon?: React.ReactNode; accent: 'cyan' | 'red' | 'green' | 'amber' }) {
  const accentColor =
    accent === 'cyan'  ? 'var(--secondary)'  :
    accent === 'red'   ? '#FCA5A5'           :
    accent === 'green' ? '#86EFAC'           : '#FCD34D';
  return (
    <div style={{
      padding: 14,
      background: 'rgba(7,9,15,0.6)',
      border: '1px solid rgba(34,211,238,0.15)',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: accentColor, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>
        {icon}{label}
      </div>
      <div style={{ marginTop: 6, fontSize: '1.6rem', fontWeight: 600, color: accentColor }}>{value}</div>
    </div>
  );
}

const sectionHeading: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.78rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--secondary)',
};

function rangeBtn(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    background: active ? 'rgba(34,211,238,0.15)' : 'transparent',
    border: '1px solid',
    borderColor: active ? 'rgba(34,211,238,0.4)' : 'rgba(34,211,238,0.15)',
    borderRadius: 4,
    color: active ? 'var(--secondary)' : 'var(--text-muted)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  };
}

const emptyBox: React.CSSProperties = {
  padding: 16,
  background: 'rgba(7,9,15,0.4)',
  border: '1px dashed rgba(34,211,238,0.15)',
  borderRadius: 6,
  color: 'var(--text-muted)',
  fontSize: '0.82rem',
  textAlign: 'center',
};

const errBox: React.CSSProperties = {
  padding: 10,
  background: 'rgba(220,38,38,0.1)',
  border: '1px solid rgba(220,38,38,0.3)',
  borderRadius: 6,
  color: '#FCA5A5',
  fontSize: '0.82rem',
};

const dataTable: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: 'rgba(7,9,15,0.4)',
  border: '1px solid rgba(34,211,238,0.1)',
  borderRadius: 6,
};

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)',
  borderBottom: '1px solid rgba(34,211,238,0.1)',
};

const td: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: '0.82rem',
  color: 'var(--text-main)',
  borderBottom: '1px solid rgba(34,211,238,0.05)',
};

const penAuditRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: 8,
  background: 'rgba(7,9,15,0.4)',
  border: '1px solid rgba(34,211,238,0.08)',
  borderRadius: 6,
};

const tagChip: React.CSSProperties = {
  padding: '2px 8px',
  background: 'rgba(220,38,38,0.1)',
  border: '1px solid rgba(220,38,38,0.25)',
  borderRadius: 12,
  fontSize: '0.72rem',
  fontFamily: 'var(--font-mono)',
  color: '#FCA5A5',
};

const legendItem: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '2px 6px',
  border: '1px solid rgba(34,211,238,0.1)',
  borderRadius: 4,
};
