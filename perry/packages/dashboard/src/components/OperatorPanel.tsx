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
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardData, setWizardData] = useState({
    name: '',
    persona: 'writer',
    interests: '',
    style: '',
    tone: 'professional'
  });

  async function submitWizard() {
    try {
      setBusy(true);
      setError(null);
      const r = await fetch('/api/operator/setup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wizardData),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setProfile(data.profile?.profile || '');
      setPreferences(data.profile?.preferences || '');
      setSavedMessage(`Onboarding complete! Your personalized profile has been generated.`);
      setTimeout(() => setSavedMessage(null), 4000);
      setShowWizard(false);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

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

  async function handleSetPersona(persona: string) {
    if (!confirm(`Are you sure you want to initialize the Operator Persona as "${persona}"? This will overwrite your current profile and preferences with the preset template.`)) return;
    try {
      setBusy(true);
      setError(null);
      const r = await fetch('/api/operator/persona', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setProfile(data.profile?.profile || '');
      setPreferences(data.profile?.preferences || '');
      setSavedMessage(`Persona initialized to ${persona}`);
      setTimeout(() => setSavedMessage(null), 3000);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={save} disabled={busy} style={btnPrimary}>{busy ? 'Saving...' : 'Save changes'}</button>
        <button onClick={distill} disabled={busy} style={btnStyle}>{busy ? 'Working...' : '⟳ Distill from observations'}</button>
        <button onClick={refresh} disabled={busy} style={btnStyle}>Refresh</button>
        <button onClick={() => { setWizardStep(1); setShowWizard(true); }} disabled={busy} style={{ ...btnStyle, borderColor: 'rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.08)' }}>⚙ Setup Wizard</button>
        <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Set Persona:</span>
        <select 
          onChange={(e) => {
            if (e.target.value) {
              handleSetPersona(e.target.value);
              e.target.value = '';
            }
          }}
          disabled={busy}
          style={{ ...btnStyle, padding: '6px 12px', background: 'rgba(34,211,238,0.05)', borderColor: 'rgba(34,211,238,0.25)' }}
        >
          <option value="" style={{ background: '#1c1c1e' }}>Select Persona...</option>
          <option value="writer" style={{ background: '#1c1c1e' }}>Writer</option>
          <option value="coder" style={{ background: '#1c1c1e' }}>Coder</option>
          <option value="gm" style={{ background: '#1c1c1e' }}>GM (Game Master)</option>
          <option value="security" style={{ background: '#1c1c1e' }}>Security Analyst</option>
        </select>
      </div>

      {(!profile.trim() && !preferences.trim() && !loading) && (
        <div style={{
          padding: 16,
          background: 'rgba(168,85,247,0.1)',
          border: '1px solid rgba(168,85,247,0.3)',
          borderRadius: 8,
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16
        }}>
          <div>
            <div style={{ fontWeight: 'bold', color: 'var(--secondary)', marginBottom: 4 }}>Welcome to Perry! Your Operator Profile is currently blank.</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>Take 1 minute to run the onboarding wizard to personalize how Perry interacts, writes, and codes for you.</div>
          </div>
          <button onClick={() => { setWizardStep(1); setShowWizard(true); }} style={btnPrimary}>Start Onboarding Wizard</button>
        </div>
      )}

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

      {showWizard && (
        <div style={modalBackdrop} onClick={() => setShowWizard(false)}>
          <div style={{ ...modalBox, maxWidth: 500, height: 'auto', maxHeight: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 }}>
              <h3 style={{ ...sectionHeading, margin: 0, fontSize: '1rem', color: '#c4a8ff' }}>Onboarding Setup Wizard (Step {wizardStep} of 4)</h3>
              <button onClick={() => setShowWizard(false)} style={btnGhost}>✕</button>
            </div>
            
            {wizardStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', marginBottom: 8 }}>Let's introduce yourself to Perry. Who are you?</div>
                <div style={formRow}>
                  <label style={formLabel}>Your Name / Call Sign</label>
                  <input
                    style={formInput}
                    type="text"
                    placeholder="e.g. Alex, CyberWriter"
                    value={wizardData.name}
                    onChange={e => setWizardData(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div style={formRow}>
                  <label style={formLabel}>Focus Persona</label>
                  <select
                    style={formInput}
                    value={wizardData.persona}
                    onChange={e => setWizardData(prev => ({ ...prev, persona: e.target.value }))}
                  >
                    <option value="writer">Creative Writer / Novelist</option>
                    <option value="coder">Software Engineer</option>
                    <option value="gm">D&D Game Master</option>
                    <option value="security">Security Analyst</option>
                    <option value="general">General / Multifaceted Operator</option>
                  </select>
                </div>
              </div>
            )}

            {wizardStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', marginBottom: 8 }}>What are your core interests and what are you using Perry for?</div>
                <div style={formRow}>
                  <label style={formLabel}>Your Interests & Projects</label>
                  <textarea
                    style={{ ...formInput, minHeight: 120, fontFamily: 'inherit', resize: 'vertical' }}
                    placeholder="e.g. I am writing a sci-fi novel about cybernetic futures, and also doing some web development with React."
                    value={wizardData.interests}
                    onChange={e => setWizardData(prev => ({ ...prev, interests: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', marginBottom: 8 }}>Tell Perry about your preferred working style and response tone.</div>
                <div style={formRow}>
                  <label style={formLabel}>Working Style & Rules</label>
                  <textarea
                    style={{ ...formInput, minHeight: 100, fontFamily: 'inherit', resize: 'vertical' }}
                    placeholder="e.g. Prefers direct answers with code, no conversational fluff, detailed outlines for books, show-dont-tell."
                    value={wizardData.style}
                    onChange={e => setWizardData(prev => ({ ...prev, style: e.target.value }))}
                  />
                </div>
                <div style={formRow}>
                  <label style={formLabel}>Response Tone</label>
                  <select
                    style={formInput}
                    value={wizardData.tone}
                    onChange={e => setWizardData(prev => ({ ...prev, tone: e.target.value }))}
                  >
                    <option value="professional">Professional & Technical</option>
                    <option value="concise">Concise / Direct (No Preamble)</option>
                    <option value="creative">Creative & Narratively Rich</option>
                    <option value="friendly">Warm & Conversational</option>
                  </select>
                </div>
              </div>
            )}

            {wizardStep === 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--secondary)', marginBottom: 4 }}>Review Onboarding Summary</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-main)', background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div><strong>Name:</strong> {wizardData.name || '(Operator)'}</div>
                  <div><strong>Persona:</strong> {wizardData.persona}</div>
                  <div><strong>Interests:</strong> {wizardData.interests || '(Not specified)'}</div>
                  <div><strong>Style:</strong> {wizardData.style || '(Not specified)'}</div>
                  <div><strong>Tone:</strong> {wizardData.tone}</div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
                  Clicking "Finish Setup" will ask Meta-AI to automatically compose a personalized <strong>PROFILE.md</strong> and <strong>PREFERENCES.md</strong> based on your onboarding answers.
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
              {wizardStep > 1 ? (
                <button onClick={() => setWizardStep(s => s - 1)} style={btnStyle}>Back</button>
              ) : <div />}
              
              {wizardStep < 4 ? (
                <button onClick={() => setWizardStep(s => s + 1)} style={btnPrimary}>Next</button>
              ) : (
                <button onClick={submitWizard} disabled={busy} style={{ ...btnPrimary, background: 'rgba(168,85,247,0.2)', borderColor: 'rgba(168,85,247,0.5)', color: '#c4a8ff' }}>
                  {busy ? 'Generating Profile...' : 'Finish Setup ⏵'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnStyle: any = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-main)', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem' };
const btnPrimary: any = { ...btnStyle, background: 'rgba(34,211,238,0.12)', borderColor: 'rgba(34,211,238,0.4)' };
const labelStyle: any = { display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' };
const inputStyle: any = { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'var(--text-main)', padding: '6px 8px', fontFamily: 'inherit', fontSize: '0.85rem' };
const errorBox: any = { padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#fca5a5', marginBottom: 12, fontSize: '0.85rem' };
const successBox: any = { padding: '8px 12px', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 6, color: '#86efac', marginBottom: 12, fontSize: '0.85rem' };

const modalBackdrop: any = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalBox: any = { width: '90%', maxWidth: 500, background: '#12131a', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 8, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 };
const sectionHeading: any = { fontFamily: 'var(--font-mono)', fontSize: '0.85rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--secondary)' };
const formRow: any = { display: 'flex', flexDirection: 'column', gap: 4 };
const formLabel: any = { fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' };
const formInput: any = { padding: '6px 10px', background: 'rgba(7,9,15,0.6)', border: '1px solid rgba(34,211,238,0.2)', borderRadius: 6, color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', outline: 'none' };
const btnGhost: any = { background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem' };
