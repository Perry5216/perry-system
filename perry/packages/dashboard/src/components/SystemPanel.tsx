/**
 * SystemPanel — central control surface for runtime routing + quality
 * gates that used to live behind APIs only.
 *
 * Three sections:
 *   1. Quality Gates — Style DNA on/off, POV gate blocking/advisory
 *   2. Step Routing — taskType → target table, editable per row
 *   3. Voice Anchors — paste prose, enqueue for scoring, list current set
 */

import { useEffect, useMemo, useState } from 'react';
import { PanelHeader } from './PanelHeader';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ? 'http://localhost:4000/api' : '/api';

type RoutingTarget = 'writer' | 'librarian' | 'researcher' | 'workers';

interface RoutingState {
  effective: Record<string, RoutingTarget>;
  overrides: Record<string, RoutingTarget>;
  validTargets: RoutingTarget[];
}

interface AnchorEntry {
  id?: string;
  tier?: string;
  sourceAttribution?: string;
  sourceType?: string;
  prose?: string;
  text?: string;
  wordCount?: number;
  active?: boolean;
}

const TARGET_COLORS: Record<RoutingTarget, { fg: string; bg: string }> = {
  writer:     { fg: '#7CFC00', bg: 'rgba(124,252,0,0.10)' },
  librarian:  { fg: '#FFD166', bg: 'rgba(255,209,102,0.10)' },
  researcher: { fg: '#4ECDC4', bg: 'rgba(78,205,196,0.10)' },
  workers:    { fg: '#A78BFA', bg: 'rgba(167,139,250,0.12)' },
};

export function SystemPanel() {
  const [routing, setRouting] = useState<RoutingState | null>(null);
  const [dnaEnabled, setDnaEnabled] = useState<boolean | null>(null);
  const [povBlocking, setPovBlocking] = useState<boolean | null>(null);
  const [sceneByScene, setSceneByScene] = useState<boolean | null>(null);
  const [wifeModeEnabled, setWifeModeEnabled] = useState<boolean | null>(null);
  const [pens, setPens] = useState<Array<{ slug: string; displayName?: string }>>([]);
  const [selectedPen, setSelectedPen] = useState<string>('');
  const [anchors, setAnchors] = useState<AnchorEntry[]>([]);
  const [anchorPasteText, setAnchorPasteText] = useState('');
  const [anchorSubmitting, setAnchorSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingRow, setSavingRow] = useState<string | null>(null);
  // RAG search
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [ragQuery, setRagQuery] = useState('');
  const [ragHits, setRagHits] = useState<any[]>([]);
  const [ragSearching, setRagSearching] = useState(false);
  const [ragGlobal, setRagGlobal] = useState(false);
  const [ragStats, setRagStats] = useState<{ total: number; byKind: Record<string, number> } | null>(null);
  const [driftScores, setDriftScores] = useState<any[]>([]);

  const refresh = async () => {
    try {
      const [r, dna, pov, scene, p, wife] = await Promise.all([
        fetch(`${API_BASE}/system/routing/steps`).then(r => r.json()),
        fetch(`${API_BASE}/system/style-dna/enabled`).then(r => r.json()),
        fetch(`${API_BASE}/system/quality/pov-gate-blocking`).then(r => r.json()),
        fetch(`${API_BASE}/system/pipeline/scene-by-scene`).then(r => r.json()),
        fetch(`${API_BASE}/pens`).then(r => r.ok ? r.json() : { pens: [] }).catch(() => ({ pens: [] })),
        fetch(`${API_BASE}/system/wife-mode/enabled`).then(r => r.json()).catch(() => ({ enabled: null })),
      ]);
      if (r?.effective) setRouting({ effective: r.effective, overrides: r.overrides || {}, validTargets: r.validTargets });
      if (typeof dna?.enabled === 'boolean') setDnaEnabled(dna.enabled);
      if (typeof pov?.blocking === 'boolean') setPovBlocking(pov.blocking);
      if (typeof scene?.enabled === 'boolean') setSceneByScene(scene.enabled);
      if (typeof wife?.enabled === 'boolean') setWifeModeEnabled(wife.enabled);
      const penList: Array<{ slug: string; displayName?: string }> = Array.isArray(p?.pens) ? p.pens : [];
      setPens(penList);
      if (!selectedPen && penList.length > 0) setSelectedPen(penList[0].slug);
      try {
        const projRes = await fetch(`${API_BASE}/projects`).then(r => r.json());
        const list: Array<{ id: string; title: string }> = (projRes.projects || projRes || []).map((x: any) => ({ id: x.id, title: x.title }));
        setProjects(list);
        if (!selectedProjectId && list.length > 0) setSelectedProjectId(list[0].id);
      } catch { /* ignore */ }
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!selectedPen) { setAnchors([]); return; }
    fetch(`${API_BASE}/system/voice-anchors/${encodeURIComponent(selectedPen)}`)
      .then(r => r.ok ? r.json() : { anchors: [] })
      .then(data => setAnchors(Array.isArray(data?.anchors) ? data.anchors : []))
      .catch(() => setAnchors([]));
  }, [selectedPen]);

  // Load RAG stats + drift scores when the selected project changes.
  useEffect(() => {
    if (!selectedProjectId) { setRagStats(null); setDriftScores([]); return; }
    fetch(`${API_BASE}/system/rag/stats/${encodeURIComponent(selectedProjectId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setRagStats({ total: d.total, byKind: d.byKind || {} }))
      .catch(() => setRagStats(null));
    fetch(`${API_BASE}/system/rag/drift/${encodeURIComponent(selectedProjectId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setDriftScores(Array.isArray(d.scores) ? d.scores : []))
      .catch(() => setDriftScores([]));
  }, [selectedProjectId]);

  const runRagSearch = async () => {
    if (!ragQuery.trim()) return;
    setRagSearching(true);
    try {
      const body: any = { query: ragQuery.trim(), topK: 10, minScore: 0.3 };
      if (ragGlobal) body.global = true;
      else body.projectId = selectedProjectId;
      const res = await fetch(`${API_BASE}/system/rag/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRagHits(Array.isArray(data?.hits) ? data.hits : []);
    } catch (e: any) {
      setError(e.message);
      setRagHits([]);
    } finally { setRagSearching(false); }
  };

  const updateRouting = async (taskType: string, target: RoutingTarget) => {
    if (!routing) return;
    setSavingRow(taskType);
    try {
      const nextOverrides: Record<string, RoutingTarget> = { ...routing.overrides, [taskType]: target };
      const res = await fetch(`${API_BASE}/system/routing/steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: nextOverrides }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.effective) setRouting({ effective: data.effective, overrides: nextOverrides, validTargets: routing.validTargets });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingRow(null);
    }
  };

  const resetRoutingRow = async (taskType: string) => {
    if (!routing) return;
    setSavingRow(taskType);
    try {
      const nextOverrides = { ...routing.overrides };
      delete nextOverrides[taskType];
      const res = await fetch(`${API_BASE}/system/routing/steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: nextOverrides }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.effective) setRouting({ effective: data.effective, overrides: nextOverrides, validTargets: routing.validTargets });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingRow(null);
    }
  };

  const toggleDna = async () => {
    if (dnaEnabled == null) return;
    const next = !dnaEnabled;
    setDnaEnabled(next);
    try {
      await fetch(`${API_BASE}/system/style-dna/enabled`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
    } catch (e: any) {
      setDnaEnabled(!next);
      setError(e.message);
    }
  };

  const togglePov = async () => {
    if (povBlocking == null) return;
    const next = !povBlocking;
    setPovBlocking(next);
    try {
      await fetch(`${API_BASE}/system/quality/pov-gate-blocking`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocking: next }),
      });
    } catch (e: any) {
      setPovBlocking(!next);
      setError(e.message);
    }
  };

  const toggleSceneByScene = async () => {
    if (sceneByScene == null) return;
    const next = !sceneByScene;
    setSceneByScene(next);
    try {
      await fetch(`${API_BASE}/system/pipeline/scene-by-scene`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
    } catch (e: any) {
      setSceneByScene(!next);
      setError(e.message);
    }
  };

  const toggleWifeMode = async () => {
    if (wifeModeEnabled == null) return;
    const next = !wifeModeEnabled;
    setWifeModeEnabled(next);
    try {
      await fetch(`${API_BASE}/system/wife-mode/enabled`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
    } catch (e: any) {
      setWifeModeEnabled(!next);
      setError(e.message);
    }
  };

  const submitAnchor = async () => {
    if (!selectedPen || !anchorPasteText.trim()) return;
    setAnchorSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/system/voice-anchors/${encodeURIComponent(selectedPen)}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: anchorPasteText.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAnchorPasteText('');
      const updated = await fetch(`${API_BASE}/system/voice-anchors/${encodeURIComponent(selectedPen)}`).then(r => r.json()).catch(() => ({ anchors: [] }));
      setAnchors(Array.isArray(updated?.anchors) ? updated.anchors : []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAnchorSubmitting(false);
    }
  };

  const removeAnchor = async (id?: string) => {
    if (!selectedPen || !id) return;
    try {
      await fetch(`${API_BASE}/system/voice-anchors/${encodeURIComponent(selectedPen)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setAnchors(prev => prev.filter(a => a.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const groupedTaskTypes = useMemo(() => {
    if (!routing) return new Map<RoutingTarget, string[]>();
    const m = new Map<RoutingTarget, string[]>();
    for (const [k, v] of Object.entries(routing.effective)) {
      if (!m.has(v)) m.set(v, []);
      m.get(v)!.push(k);
    }
    for (const arr of m.values()) arr.sort();
    return m;
  }, [routing]);

  return (
    <div style={{
      height: '100%', width: '100%', overflow: 'auto',
      background: 'var(--bg)', color: 'var(--text-main)',
    }}>
      <PanelHeader
        eyebrow="P.E.R.R.Y. // System"
        title="Runtime Controls"
        subtitle="Quality gates, dynamic step routing, and voice-anchor curation."
      />

      {error && (
        <div style={{ padding: '8px 16px', margin: '12px 28px', background: 'rgba(239,68,68,0.10)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 4, fontSize: '0.85rem' }}>
          {error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>×</button>
        </div>
      )}

      {/* ── Quality Gates ─────────────────────────────────────── */}
      <section style={{ padding: '24px 28px', borderBottom: '1px solid var(--panel-border)' }}>
        <h3 style={{ marginBottom: 12, fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Quality Gates</h3>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <ToggleCard
            label="Style DNA"
            state={dnaEnabled}
            onToggle={toggleDna}
            descOn="Rule lists inject into non-writer prompts; lint flags violations post-write."
            descOff="No DNA injection, no post-write lint. Pure trained-LoRA mode."
          />
          <ToggleCard
            label="POV Gate (blocking)"
            state={povBlocking}
            onToggle={togglePov}
            descOn="Below score 8 → chapter resets and retries (up to 3×). Loop-risk on a trained LoRA."
            descOff="Verdict logged only, no rewrite. Async audit still runs."
          />
          <ToggleCard
            label="Scene-by-scene chapters"
            state={sceneByScene}
            onToggle={toggleSceneByScene}
            descOn="New projects split chapters at ~1200 words per scene. LoRA writes tighter prose."
            descOff="Chapters write as 3000-word monoliths (legacy). Existing projects unaffected by this toggle."
          />
          <ToggleCard
            label="Wife Mode"
            state={wifeModeEnabled}
            onToggle={toggleWifeMode}
            descOn="Wife responder agent runs locally on RTX 5070 Ti using MistralRP-Noromaid GGUF."
            descOff="Wife responder agent disabled. Model is unloaded from VRAM when turned off."
          />
        </div>
      </section>

      {/* ── Routing Table ─────────────────────────────────────── */}
      <section style={{ padding: '24px 28px', borderBottom: '1px solid var(--panel-border)' }}>
        <h3 style={{ marginBottom: 12, fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Step Routing</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16, maxWidth: 720 }}>
          Each step's task type routes to one target. Writer = local Ollama (the trained LoRA).
          Librarian = 5070 Ti (qwen3:14b). Workers = Claude / Gemini CLI subscriptions. Researcher = larger local model.
          Change to repoint a task type without code edits.
        </p>

        {!routing && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}
        {routing && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {(['writer', 'librarian', 'researcher', 'workers'] as RoutingTarget[]).map(target => {
              const types = groupedTaskTypes.get(target) || [];
              const c = TARGET_COLORS[target];
              return (
                <div key={target} style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: 6, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontWeight: 600, color: c.fg, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.85rem' }}>{target}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{types.length} step{types.length === 1 ? '' : 's'}</span>
                  </div>
                  {types.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</div>}
                  {types.map(tt => {
                    const overridden = tt in routing.overrides;
                    const saving = savingRow === tt;
                    return (
                      <div key={tt} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px dashed var(--panel-border)', fontSize: '0.85rem' }}>
                        <span style={{ flex: 1, fontFamily: 'monospace', opacity: saving ? 0.5 : 1 }}>
                          {tt}
                          {overridden && <span title="Overridden from default" style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--accent)', background: 'rgba(56,189,248,0.12)', padding: '1px 5px', borderRadius: 3 }}>custom</span>}
                        </span>
                        <select
                          value={target}
                          onChange={e => updateRouting(tt, e.target.value as RoutingTarget)}
                          disabled={saving}
                          style={{ background: 'var(--bg)', color: 'var(--text-main)', border: '1px solid var(--panel-border)', borderRadius: 4, padding: '2px 6px', fontSize: '0.8rem', cursor: 'pointer' }}
                        >
                          {routing.validTargets.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        {overridden && (
                          <button onClick={() => resetRoutingRow(tt)} disabled={saving} style={{ marginLeft: 6, background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', borderRadius: 3, padding: '1px 6px', fontSize: '0.7rem', cursor: 'pointer' }} title="Revert to default">↺</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Voice Anchors ─────────────────────────────────────── */}
      <section style={{ padding: '24px 28px' }}>
        <h3 style={{ marginBottom: 12, fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Voice Anchors</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16, maxWidth: 720 }}>
          Paste exemplary prose to anchor the LoRA's voice. New submissions are scored automatically by a worker
          and routed to <code>voice_paragraphs_v2.jsonl</code> (promote), <code>_review.jsonl</code>, or <code>_rejected.jsonl</code>.
          Promoted anchors feed the next LoRA training pass AND inject into the first-scene prompt when there's no prior chapter to draw from.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Pen:</span>
          <select
            value={selectedPen}
            onChange={e => setSelectedPen(e.target.value)}
            style={{ background: 'var(--bg)', color: 'var(--text-main)', border: '1px solid var(--panel-border)', borderRadius: 4, padding: '4px 8px', fontSize: '0.85rem' }}
          >
            <option value="">— select —</option>
            {pens.map(p => <option key={p.slug} value={p.slug}>{p.displayName || p.slug}</option>)}
          </select>
        </div>

        <textarea
          placeholder={selectedPen ? `Paste 1–4 paragraphs of exemplary ${selectedPen} prose here…` : 'Select a pen first.'}
          value={anchorPasteText}
          onChange={e => setAnchorPasteText(e.target.value)}
          disabled={!selectedPen || anchorSubmitting}
          rows={6}
          style={{ width: '100%', maxWidth: 720, background: 'var(--panel-bg)', color: 'var(--text-main)', border: '1px solid var(--panel-border)', borderRadius: 4, padding: 10, fontSize: '0.85rem', fontFamily: 'inherit', resize: 'vertical' }}
        />
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={submitAnchor}
            disabled={!selectedPen || !anchorPasteText.trim() || anchorSubmitting}
            className="btn btn-primary"
            style={{ fontSize: '0.85rem' }}
          >
            {anchorSubmitting ? 'Submitting…' : 'Submit for scoring'}
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {anchorPasteText.trim().split(/\s+/).filter(Boolean).length} words
          </span>
        </div>

        {anchors.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
              Promoted anchors ({anchors.length})
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
              {anchors.map((a, i) => {
                const body = a.prose || a.text || '';
                const src = a.sourceAttribution || a.sourceType;
                return (
                  <div key={a.id || i} style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: 6, padding: '10px 12px', opacity: a.active === false ? 0.45 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      <span>{a.tier || 'anchor'}{src ? ` · ${src}` : ''}{typeof a.wordCount === 'number' ? ` · ${a.wordCount}w` : ''}</span>
                      {a.id && (
                        <button onClick={() => removeAnchor(a.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }} title="Remove">×</button>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>
                      {body}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── RAG Search + Drift ─────────────────────────────────── */}
      <section style={{ padding: '24px 28px', borderTop: '1px solid var(--panel-border)' }}>
        <h3 style={{ marginBottom: 12, fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>RAG Index</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16, maxWidth: 720 }}>
          Semantic search across indexed bibles, outlines, chapters, and voice anchors.
          Bibles are sliced into chunks and embedded with nomic-embed-text on the 5070 Ti as steps complete.
          Drift scores compare each completed chapter to the pen's voice-anchor centroid.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Project:</span>
          <select
            value={selectedProjectId}
            onChange={e => setSelectedProjectId(e.target.value)}
            style={{ background: 'var(--bg)', color: 'var(--text-main)', border: '1px solid var(--panel-border)', borderRadius: 4, padding: '4px 8px', fontSize: '0.85rem', minWidth: 200 }}
          >
            <option value="">— select —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          {ragStats && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {ragStats.total} chunks ·
              {Object.entries(ragStats.byKind).slice(0, 4).map(([k, n]) => ` ${k}:${n}`).join(' ')}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <input
            placeholder='Search ("how does the Lisbon Packet work", "describe Kaelen", etc.)'
            value={ragQuery}
            onChange={e => setRagQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runRagSearch(); }}
            style={{ flex: '1 1 320px', minWidth: 280, background: 'var(--panel-bg)', color: 'var(--text-main)', border: '1px solid var(--panel-border)', borderRadius: 4, padding: '8px 10px', fontSize: '0.85rem' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={ragGlobal} onChange={e => setRagGlobal(e.target.checked)} /> Cross-project
          </label>
          <button onClick={runRagSearch} disabled={!ragQuery.trim() || ragSearching || (!ragGlobal && !selectedProjectId)} className="btn btn-primary" style={{ fontSize: '0.85rem' }}>
            {ragSearching ? 'Searching…' : 'Search'}
          </button>
        </div>

        {ragHits.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {ragHits.map((h, i) => (
              <div key={`${h.id}-${i}`} style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  <span>
                    {h.kind} · <code style={{ fontSize: '0.7rem' }}>{h.sourceRef}{typeof h.chunkIndex === 'number' ? `#${h.chunkIndex}` : ''}</code>
                    {h.projectId ? ` · ${h.projectId}` : ''}
                  </span>
                  <span style={{ color: 'var(--accent)' }}>score {Number(h.score).toFixed(3)}</span>
                </div>
                <div style={{ fontSize: '0.8rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>{h.text}</div>
              </div>
            ))}
          </div>
        )}

        {driftScores.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
              Voice Drift (per chapter)
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 720 }}>
              {driftScores.map((d, i) => {
                const s = typeof d.score === 'number' ? d.score : 0;
                const color = s >= 0.85 ? '#7CFC00' : s >= 0.70 ? '#FFD166' : '#FF6B6B';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem' }}>
                    <span style={{ minWidth: 130, color: 'var(--text-muted)' }}>{d.label || `Chapter ${d.chapter ?? '?'}`}</span>
                    <div style={{ flex: 1, height: 8, background: 'var(--panel-bg)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(0, Math.min(1, s)) * 100}%`, height: '100%', background: color }} />
                    </div>
                    <span style={{ minWidth: 50, textAlign: 'right', color, fontWeight: 600 }}>{s.toFixed(3)}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 8 }}>
              {`>0.85 = strongly on voice · 0.70–0.85 = neutral · <0.70 = drifting`}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ToggleCard({ label, state, onToggle, descOn, descOff }: {
  label: string;
  state: boolean | null;
  onToggle: () => void;
  descOn: string;
  descOff: string;
}) {
  const isOn = state === true;
  const isLoaded = state !== null;
  return (
    <div style={{
      flex: '1 1 320px', minWidth: 280,
      background: 'var(--panel-bg)', border: '1px solid var(--panel-border)',
      borderRadius: 6, padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{label}</span>
        <button
          onClick={onToggle}
          disabled={!isLoaded}
          style={{
            background: isOn ? 'rgba(124,252,0,0.12)' : 'transparent',
            color: isOn ? '#7CFC00' : 'var(--text-muted)',
            border: `1px solid ${isOn ? '#7CFC00' : 'var(--panel-border)'}`,
            borderRadius: 4, padding: '3px 12px', cursor: isLoaded ? 'pointer' : 'wait',
            fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em',
          }}
        >
          {isLoaded ? (isOn ? 'ON' : 'OFF') : '…'}
        </button>
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
        {isOn ? descOn : descOff}
      </div>
    </div>
  );
}
