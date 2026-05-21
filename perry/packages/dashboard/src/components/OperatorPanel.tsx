/**
 * OperatorPanel — view + edit the User Model.
 */
import { useEffect, useState } from 'react';
import { PanelHeader } from './PanelHeader';

export function OperatorPanel() {
  const [profile, setProfile] = useState('');
  const [preferences, setPreferences] = useState('');
  const [observationCount, setObservationCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [manualObservation, setManualObservation] = useState('');

  async function refresh() {
    try {
      setError(null);
      const r = await fetch('/api/operator', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setProfile(data.profile || '');
      setPreferences(data.preferences || '');
      setObservationCount(data.observationCount || 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function save() {
    try {
      setBusy(true);
      setError(null);
      const r = await fetch('/api/operator', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, preferences }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSavedMessage('Saved');
      setTimeout(() => setSavedMessage(null), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function distill() {
    try {
      setBusy(true);
      setError(null);
      const r = await fetch('/api/operator/distill', { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setSavedMessage(data.updated ? `Distilled ${data.observationsSeen} observations` : 'Distillation produced no change');
      setTimeout(() => setSavedMessage(null), 4000);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addObservation() {
    if (!manualObservation.trim()) return;
    try {
      setBusy(true);
      setError(null);
      const r = await fetch('/api/operator/observe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detail: manualObservation }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setManualObservation('');
      setSavedMessage('Observation recorded');
      setTimeout(() => setSavedMessage(null), 2000);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%', fontFamily: 'var(--font-mono)' }}>
      <PanelHeader
        eyebrow="USER MODEL"
        title="Operator"
        subtitle={`Perry's living model of YOU — distilled from your decisions across sessions. ${observationCount} observations recorded.`}
      />

      {error && <div style={errorBox}>{error}</div>}
      {savedMessage && <div style={successBox}>{savedMessage}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={save} disabled={busy} style={btnPrimary}>{busy ? 'Saving...' : 'Save changes'}</button>
        <button onClick={distill} disabled={busy} style={btnStyle}>{busy ? 'Working...' : '⟳ Distill from observations'}</button>
        <button onClick={refresh} disabled={busy} style={btnStyle}>Refresh</button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>PROFILE.md (identity, working style)</label>
            <textarea
              value={profile}
              onChange={e => setProfile(e.target.value)}
              style={{ ...inputStyle, minHeight: 400, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
            />
          </div>
          <div>
            <label style={labelStyle}>PREFERENCES.md (decision patterns)</label>
            <textarea
              value={preferences}
              onChange={e => setPreferences(e.target.value)}
              style={{ ...inputStyle, minHeight: 400, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
            />
          </div>
        </div>
      )}

      <div style={{ marginTop: 24, padding: 14, background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 6 }}>
        <div style={{ ...labelStyle, color: 'var(--accent)' }}>Add a manual observation</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
          Tell Perry something it should know about you. Will be folded into PROFILE/PREFERENCES on next distillation.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={manualObservation}
            onChange={e => setManualObservation(e.target.value)}
            placeholder="e.g. I prefer concise responses without preamble."
            style={{ ...inputStyle, flex: 1 }}
            onKeyDown={e => { if (e.key === 'Enter') addObservation(); }}
          />
          <button onClick={addObservation} disabled={busy || !manualObservation.trim()} style={btnPrimary}>Record</button>
        </div>
      </div>

      <div style={{ marginTop: 24, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        <strong>How this evolves:</strong> Perry watches for project-created, skill-promoted, skill-rejected, and
        step-result-edited events and appends an observation to <code>workspace/operator/observations.jsonl</code>.
        Distillation reads observations and updates the two markdown files via the librarian model.
        Files are hand-editable — your edits are preserved.
      </div>
    </div>
  );
}

const btnStyle: any = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-main)', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem' };
const btnPrimary: any = { ...btnStyle, background: 'rgba(34,211,238,0.12)', borderColor: 'rgba(34,211,238,0.4)' };
const labelStyle: any = { display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' };
const inputStyle: any = { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'var(--text-main)', padding: '6px 8px', fontFamily: 'inherit', fontSize: '0.85rem' };
const errorBox: any = { padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#fca5a5', marginBottom: 12, fontSize: '0.85rem' };
const successBox: any = { padding: '8px 12px', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 6, color: '#86efac', marginBottom: 12, fontSize: '0.85rem' };
