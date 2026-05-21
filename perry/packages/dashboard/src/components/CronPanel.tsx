/**
 * CronPanel — manage scheduled tasks.
 */
import { useEffect, useMemo, useState } from 'react';
import { PanelHeader } from './PanelHeader';

interface CronJob {
  name: string;
  schedule: string;
  action: { type: string; [k: string]: any };
  enabled?: boolean;
  description?: string;
  createdAt?: string;
  lastFiredAt?: string;
  lastFiredResult?: string;
}

const DEFAULT_DRAFT: CronJob = {
  name: '',
  schedule: '0 9 * * *',
  action: { type: 'execute-project', projectId: '' },
  enabled: true,
  description: '',
};

export function CronPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');
  const [draft, setDraft] = useState<CronJob>(DEFAULT_DRAFT);
  const [editingName, setEditingName] = useState<string | null>(null);

  async function refresh() {
    try {
      setError(null);
      const r = await fetch('/api/cron', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setJobs(d.jobs || []);
    } catch (e: any) { setError(e.message); }
  }

  useEffect(() => { refresh(); const id = setInterval(refresh, 15_000); return () => clearInterval(id); }, []);

  async function save() {
    try {
      setError(null);
      const r = await fetch('/api/cron', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
      setMode('list');
      setDraft(DEFAULT_DRAFT);
      setEditingName(null);
      refresh();
    } catch (e: any) { setError(e.message); }
  }

  async function del(name: string) {
    if (!confirm(`Delete cron job "${name}"?`)) return;
    try {
      const r = await fetch(`/api/cron/${name}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok && r.status !== 204) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
      refresh();
    } catch (e: any) { setError(e.message); }
  }

  async function fire(name: string) {
    try {
      const r = await fetch(`/api/cron/${name}/fire`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setError(null);
      setTimeout(() => refresh(), 500);
      alert(`Fired ${name}: ${j.result}`);
    } catch (e: any) { setError(e.message); }
  }

  function startEdit(j: CronJob) {
    setDraft(JSON.parse(JSON.stringify(j)));
    setEditingName(j.name);
    setMode('edit');
  }

  const sortedJobs = useMemo(() => jobs.slice().sort((a, b) => a.name.localeCompare(b.name)), [jobs]);

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%', fontFamily: 'var(--font-mono)' }}>
      <PanelHeader
        eyebrow="SCHEDULE"
        title="Cron"
        subtitle="Recurring tasks against Perry. Jobs live as JSON files in workspace/cron/. Minute-aligned scheduler; UTC schedules."
      />

      {error && <div style={errBox}>{error}</div>}

      {mode === 'list' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 16px' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{jobs.length} job(s)</span>
            <button onClick={() => { setDraft(DEFAULT_DRAFT); setEditingName(null); setMode('create'); }} style={btnPrimary}>+ Add cron job</button>
          </div>
          {jobs.length === 0 && (
            <div style={{ ...cardStyle, borderStyle: 'dashed', padding: 24 }}>
              <div style={{ fontSize: '1.05rem', color: 'var(--secondary)', marginBottom: 8 }}>No cron jobs yet</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 12 }}>
                Cron schedules recurring Perry tasks against UTC. Drop a job here and Perry will:
              </div>
              <ul style={{ color: 'var(--text-muted)', fontSize: '0.85rem', paddingLeft: 20, marginBottom: 12, lineHeight: 1.6 }}>
                <li><code>execute-project</code> — run all remaining steps of a project on schedule</li>
                <li><code>execute-step</code> — run just the next step of a project</li>
                <li><code>emit-event</code> — fire an event your plugins or services can react to</li>
              </ul>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                Examples: "draft chapter 12 every morning at 9am", "ping a WhatsApp contact at noon",
                "fire <code>gc:nudge</code> every Sunday so a plugin can do weekly cleanup."
              </div>
              <button onClick={() => { setDraft(DEFAULT_DRAFT); setEditingName(null); setMode('create'); }} style={{ ...btnPrimary, marginTop: 14 }}>+ Create your first job</button>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
            {sortedJobs.map(j => (
              <div key={j.name} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>{j.name}</div>
                    <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{j.schedule} UTC</code>
                    {j.enabled === false && <span style={{ marginLeft: 8, padding: '2px 6px', fontSize: '0.65rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3, color: '#fca5a5' }}>DISABLED</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => fire(j.name)} style={btnSmall} title="Fire now (manual trigger)">▶ Fire</button>
                    <button onClick={() => startEdit(j)} style={btnSmall}>Edit</button>
                    <button onClick={() => del(j.name)} style={{ ...btnSmall, borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>Delete</button>
                  </div>
                </div>
                {j.description && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 6 }}>{j.description}</div>}
                <div style={{ marginTop: 6, fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Action:</span> <code style={{ color: 'var(--accent)' }}>{j.action.type}</code>
                  {j.action.projectId && <span style={{ color: 'var(--text-muted)' }}> · projectId: <code>{j.action.projectId}</code></span>}
                  {j.action.event && <span style={{ color: 'var(--text-muted)' }}> · event: <code>{j.action.event}</code></span>}
                </div>
                {j.lastFiredAt && (
                  <div style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    Last fired: {new Date(j.lastFiredAt).toLocaleString()} · {j.lastFiredResult || '(no result)'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {(mode === 'create' || mode === 'edit') && (
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 12px', color: 'var(--secondary)' }}>{mode === 'edit' ? `Edit "${editingName}"` : 'New cron job'}</h3>
          {mode === 'create' && (
            <div style={fieldRow}><label style={labelStyle}>Name (kebab-case)</label>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="morning-write" style={inputStyle} /></div>
          )}
          <div style={fieldRow}>
            <label style={labelStyle}>Schedule (UTC) — "MM HH DOM MON DOW" (* or number per field)</label>
            <input value={draft.schedule} onChange={e => setDraft({ ...draft, schedule: e.target.value })} placeholder="0 9 * * *" style={inputStyle} />
            <div style={{ marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Examples: <code>0 9 * * *</code> = 9am UTC daily · <code>* * * * *</code> = every minute · <code>0 8 * * 1</code> = 8am UTC Mondays
            </div>
          </div>
          <div style={fieldRow}>
            <label style={labelStyle}>Description</label>
            <input value={draft.description || ''} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="What this job does" style={inputStyle} />
          </div>
          <div style={fieldRow}>
            <label style={labelStyle}>Action type</label>
            <select value={draft.action.type} onChange={e => setDraft({ ...draft, action: { type: e.target.value, projectId: '', event: '' } })} style={inputStyle}>
              <option value="execute-project">execute-project (run all remaining steps)</option>
              <option value="execute-step">execute-step (run next single step)</option>
              <option value="emit-event">emit-event (fire an event on the bus)</option>
            </select>
          </div>
          {(draft.action.type === 'execute-project' || draft.action.type === 'execute-step') && (
            <div style={fieldRow}><label style={labelStyle}>Project ID</label>
              <input value={draft.action.projectId || ''} onChange={e => setDraft({ ...draft, action: { ...draft.action, projectId: e.target.value } })} placeholder="project-166" style={inputStyle} /></div>
          )}
          {draft.action.type === 'emit-event' && (
            <>
              <div style={fieldRow}><label style={labelStyle}>Event name</label>
                <input value={draft.action.event || ''} onChange={e => setDraft({ ...draft, action: { ...draft.action, event: e.target.value } })} placeholder="custom:tick" style={inputStyle} /></div>
            </>
          )}
          <div style={fieldRow}>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={draft.enabled !== false} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={save} style={btnPrimary}>{mode === 'edit' ? 'Save changes' : 'Create job'}</button>
            <button onClick={() => { setMode('list'); setError(null); }} style={btnStyle}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

const btnStyle: any = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-main)', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem' };
const btnPrimary: any = { ...btnStyle, background: 'rgba(34,211,238,0.12)', borderColor: 'rgba(34,211,238,0.4)' };
const btnSmall: any = { ...btnStyle, padding: '4px 8px', fontSize: '0.7rem' };
const cardStyle: any = { background: 'rgba(7,9,15,0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 14, marginBottom: 12 };
const fieldRow: any = { marginBottom: 10 };
const labelStyle: any = { display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' };
const inputStyle: any = { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'var(--text-main)', padding: '6px 8px', fontFamily: 'inherit', fontSize: '0.85rem' };
const errBox: any = { padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#fca5a5', marginBottom: 12, fontSize: '0.85rem' };
