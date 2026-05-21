/**
 * DomainsPanel — define + edit the task verticals Perry can be pointed at.
 *
 * Features:
 *   - List, create, EDIT, delete domains
 *   - Per-domain default skills (skill picker)
 *   - "Create custom skill" form for hand-authored skills (skips propose
 *     queue → lands straight in skills-installed/)
 *
 * The platform is domain-agnostic. A domain definition tells the dashboard
 * which projects belong where, which color/icon to render, and which
 * dashboard panels to surface (plugin contract). `defaultSkills` ties a
 * skill list to a domain so each task vertical can carry its own playbook.
 */
import { useEffect, useMemo, useState } from 'react';
import { PanelHeader } from './PanelHeader';

interface Domain {
  id: string;
  label: string;
  description: string;
  color: string;
  icon: string;
  dashboardPanels: string[];
  defaultSkills: { service: string; name: string }[];
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Skill {
  filename: string;
  name: string;
  description: string;
  service: string;
}

const AVAILABLE_PANELS = ['projects', 'workers', 'trajectories', 'analytics', 'models', 'self-learning', 'pens'];
const KNOWN_SERVICES = ['worker', 'audit', 'director', 'gc', 'prompt-builder', 'scout', 'trainer'];

type FormState = {
  id: string;
  label: string;
  description: string;
  color: string;
  icon: string;
  dashboardPanels: string[];
  defaultSkills: { service: string; name: string }[];
};

const EMPTY_FORM: FormState = {
  id: '',
  label: '',
  description: '',
  color: '#a855f7',
  icon: 'sparkles',
  dashboardPanels: ['projects', 'self-learning', 'trajectories'],
  defaultSkills: [],
};

export function DomainsPanel() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FormState>(EMPTY_FORM);
  const [showSkillCreator, setShowSkillCreator] = useState(false);
  const [skillDraft, setSkillDraft] = useState({
    name: '',
    description: '',
    service: 'worker',
    body: '',
    appliesWhen: '',
  });

  async function refresh() {
    try {
      setError(null);
      const [dRes, sRes] = await Promise.all([
        fetch('/api/domains', { credentials: 'include' }),
        fetch('/api/skills', { credentials: 'include' }),
      ]);
      if (!dRes.ok) throw new Error(`domains HTTP ${dRes.status}`);
      const dData = await dRes.json();
      setDomains(dData.domains || []);
      if (sRes.ok) {
        const sData = await sRes.json();
        setSkills(sData.installed || []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function startCreate() {
    setDraft(EMPTY_FORM);
    setEditingId(null);
    setMode('create');
    setError(null);
  }

  function startEdit(d: Domain) {
    setDraft({
      id: d.id,
      label: d.label,
      description: d.description,
      color: d.color,
      icon: d.icon,
      dashboardPanels: d.dashboardPanels,
      defaultSkills: d.defaultSkills || [],
    });
    setEditingId(d.id);
    setMode('edit');
    setError(null);
  }

  function cancelForm() {
    setMode('list');
    setEditingId(null);
    setDraft(EMPTY_FORM);
    setError(null);
  }

  async function saveDomain() {
    try {
      setError(null);
      const isEdit = mode === 'edit' && editingId;
      const url = isEdit ? `/api/domains/${editingId}` : '/api/domains';
      const method = isEdit ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || 'save failed');
      }
      cancelForm();
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteDomain(id: string) {
    if (!confirm(`Delete domain "${id}"? This is not reversible.`)) return;
    try {
      const r = await fetch(`/api/domains/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || 'delete failed');
      }
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function createSkill() {
    try {
      setError(null);
      let appliesWhen: any = undefined;
      if (skillDraft.appliesWhen.trim()) {
        try { appliesWhen = JSON.parse(skillDraft.appliesWhen); } catch { throw new Error('appliesWhen must be valid JSON or empty'); }
      }
      const r = await fetch('/api/skills', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skillDraft.name,
          description: skillDraft.description,
          service: skillDraft.service,
          body: skillDraft.body,
          appliesWhen,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || 'skill create failed');
      }
      // Auto-add the new skill to the in-flight domain draft if we're in a form
      if (mode === 'create' || mode === 'edit') {
        setDraft(d => ({ ...d, defaultSkills: [...d.defaultSkills, { service: skillDraft.service, name: skillDraft.name }] }));
      }
      setShowSkillCreator(false);
      setSkillDraft({ name: '', description: '', service: 'worker', body: '', appliesWhen: '' });
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function togglePanel(panel: string) {
    setDraft(d => ({
      ...d,
      dashboardPanels: d.dashboardPanels.includes(panel)
        ? d.dashboardPanels.filter(p => p !== panel)
        : [...d.dashboardPanels, panel],
    }));
  }

  function toggleDefaultSkill(s: Skill) {
    setDraft(d => {
      const exists = d.defaultSkills.some(x => x.service === s.service && x.name === s.name);
      return {
        ...d,
        defaultSkills: exists
          ? d.defaultSkills.filter(x => !(x.service === s.service && x.name === s.name))
          : [...d.defaultSkills, { service: s.service, name: s.name }],
      };
    });
  }

  const sortedDomains = useMemo(
    () => domains.slice().sort((a, b) => (a.builtin === b.builtin ? a.label.localeCompare(b.label) : a.builtin ? -1 : 1)),
    [domains]
  );

  const isFormMode = mode === 'create' || mode === 'edit';

  return (
    <div style={{ padding: '24px', overflowY: 'auto', height: '100%', fontFamily: 'var(--font-mono)' }}>
      <PanelHeader
        eyebrow="CONFIGURE"
        title="Domains"
        subtitle="Task verticals Perry can be pointed at. Each domain configures dashboard panels, default skills, and identity."
      />

      {error && (
        <div style={errorBox}>{error}</div>
      )}

      {!isFormMode && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 16px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{domains.length} domain(s) · {skills.length} installed skill(s)</span>
          <button onClick={startCreate} style={btnPrimary}>+ Add domain</button>
        </div>
      )}

      {isFormMode && (
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 12px', color: 'var(--secondary)' }}>
            {mode === 'edit' ? `Edit "${draft.label || editingId}"` : 'New domain'}
          </h3>

          {mode === 'create' && (
            <div style={fieldRow}>
              <label style={labelStyle}>ID (kebab-case, immutable)</label>
              <input value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} placeholder="code-review" style={inputStyle} />
            </div>
          )}
          <div style={fieldRow}>
            <label style={labelStyle}>Label</label>
            <input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} placeholder="Code Review" style={inputStyle} />
          </div>
          <div style={fieldRow}>
            <label style={labelStyle}>Description</label>
            <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="One-line purpose statement..." style={{ ...inputStyle, minHeight: 60 }} />
          </div>
          <div style={fieldRow}>
            <label style={labelStyle}>Accent color</label>
            <input type="color" value={draft.color} onChange={e => setDraft({ ...draft, color: e.target.value })} style={{ ...inputStyle, padding: 2, width: 80 }} />
          </div>

          <div style={fieldRow}>
            <label style={labelStyle}>Dashboard panels</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {AVAILABLE_PANELS.map(p => {
                const on = draft.dashboardPanels.includes(p);
                return (
                  <button key={p} onClick={() => togglePanel(p)} style={{ ...chipStyle, background: on ? 'rgba(34,211,238,0.15)' : 'transparent', borderColor: on ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.1)' }}>{p}</button>
                );
              })}
            </div>
          </div>

          <div style={fieldRow}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={{ ...labelStyle, margin: 0 }}>Default skills ({draft.defaultSkills.length} selected)</label>
              <button onClick={() => setShowSkillCreator(true)} style={btnSmall}>+ Create custom skill</button>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
              Click to add/remove. Skills the domain wants active by default for any project in it.
            </div>
            {skills.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: 8 }}>(no installed skills yet — use "Create custom skill" to add one)</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {skills.map(s => {
                  const on = draft.defaultSkills.some(x => x.service === s.service && x.name === s.name);
                  return (
                    <button key={`${s.service}::${s.name}`} onClick={() => toggleDefaultSkill(s)} title={s.description} style={{ ...chipStyle, background: on ? 'rgba(168,85,247,0.15)' : 'transparent', borderColor: on ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.1)' }}>
                      <span style={{ opacity: 0.7, fontSize: '0.65rem' }}>{s.service}/</span>{s.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={saveDomain} style={btnPrimary}>{mode === 'edit' ? 'Save changes' : 'Create domain'}</button>
            <button onClick={cancelForm} style={btnStyle}>Cancel</button>
          </div>
        </div>
      )}

      {showSkillCreator && (
        <div style={modalBackdrop}>
          <div style={{ ...cardStyle, maxWidth: 700, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 12px', color: 'var(--accent)' }}>Create custom skill</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 0 }}>Hand-authored skill — lands straight in skills-installed/, skipping the propose flow.</p>
            <div style={fieldRow}><label style={labelStyle}>Service</label>
              <select value={skillDraft.service} onChange={e => setSkillDraft({ ...skillDraft, service: e.target.value })} style={inputStyle}>
                {KNOWN_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={fieldRow}><label style={labelStyle}>Name (kebab-case)</label>
              <input value={skillDraft.name} onChange={e => setSkillDraft({ ...skillDraft, name: e.target.value })} placeholder="custom-skill-name" style={inputStyle} /></div>
            <div style={fieldRow}><label style={labelStyle}>Description (10-200 chars)</label>
              <input value={skillDraft.description} onChange={e => setSkillDraft({ ...skillDraft, description: e.target.value })} placeholder="What this skill does" style={inputStyle} /></div>
            <div style={fieldRow}><label style={labelStyle}>Body (markdown, ≥50 chars)</label>
              <textarea value={skillDraft.body} onChange={e => setSkillDraft({ ...skillDraft, body: e.target.value })} placeholder="## Procedure&#10;&#10;1. ...&#10;2. ..." style={{ ...inputStyle, minHeight: 180, fontFamily: 'var(--font-mono)' }} /></div>
            <div style={fieldRow}><label style={labelStyle}>appliesWhen (JSON, optional)</label>
              <input value={skillDraft.appliesWhen} onChange={e => setSkillDraft({ ...skillDraft, appliesWhen: e.target.value })} placeholder='{"pen_slug": "*", "leak_tag": "filter-words"}' style={inputStyle} /></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={createSkill} style={btnPrimary}>Create skill</button>
              <button onClick={() => { setShowSkillCreator(false); setError(null); }} style={btnStyle}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {loading && !isFormMode && <div style={{ color: 'var(--text-muted)' }}>Loading...</div>}

      {!isFormMode && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
          {sortedDomains.map(d => (
            <div key={d.id} style={{ ...cardStyle, borderLeftColor: d.color, borderLeftWidth: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>{d.label}</div>
                  <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{d.id}</code>
                  {d.builtin && <span style={builtinBadge}>BUILT-IN</span>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => startEdit(d)} style={btnSmall}>Edit</button>
                  {!d.builtin && (
                    <button onClick={() => deleteDomain(d.id)} style={{ ...btnSmall, borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>Delete</button>
                  )}
                </div>
              </div>
              {d.description && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 8 }}>{d.description}</div>}
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Panels</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {d.dashboardPanels.map(p => (<span key={p} style={chipStyle}>{p}</span>))}
                </div>
              </div>
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Default skills ({(d.defaultSkills || []).length})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {(d.defaultSkills || []).length === 0 ? (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(none)</span>
                  ) : (
                    (d.defaultSkills || []).map(s => (
                      <span key={`${s.service}::${s.name}`} style={{ ...chipStyle, background: 'rgba(168,85,247,0.08)', borderColor: 'rgba(168,85,247,0.25)' }}>
                        <span style={{ opacity: 0.7, fontSize: '0.65rem' }}>{s.service}/</span>{s.name}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const btnStyle: any = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-main)', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem' };
const btnPrimary: any = { ...btnStyle, background: 'rgba(34,211,238,0.12)', borderColor: 'rgba(34,211,238,0.4)' };
const btnSmall: any = { ...btnStyle, padding: '4px 10px', fontSize: '0.75rem' };
const cardStyle: any = { background: 'rgba(7, 9, 15, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 14, marginBottom: 12 };
const fieldRow: any = { marginBottom: 10 };
const labelStyle: any = { display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' };
const inputStyle: any = { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'var(--text-main)', padding: '6px 8px', fontFamily: 'inherit', fontSize: '0.85rem' };
const chipStyle: any = { padding: '2px 8px', fontSize: '0.7rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' };
const builtinBadge: any = { marginLeft: 8, padding: '2px 6px', fontSize: '0.65rem', background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 3, color: 'var(--secondary)' };
const errorBox: any = { padding: '12px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#fca5a5', marginBottom: 16, fontSize: '0.85rem' };
const modalBackdrop: any = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
