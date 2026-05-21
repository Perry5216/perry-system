/**
 * ModelsPanel — Ollama model management. Pull / list / delete models
 * across both endpoints (Writer GPU, Librarian GPU) without ssh-ing into
 * containers.
 *
 * Built for the shareability goal: a new user opens this tab, clicks
 * "pull recommended for my hardware", and ends up with a working Perry
 * stack. They never need to touch Docker.
 */

import { useEffect, useState } from 'react';
import { PanelHeader } from './PanelHeader';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ? 'http://localhost:4000/api' : '/api';

interface ModelInfo {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
  parameter_size?: string;
  quant?: string;
  family?: string;
}

interface EndpointInfo {
  endpoint: 'writer' | 'librarian';
  label: string;
  url: string;
  ok: boolean;
  error?: string;
  models: ModelInfo[];
}

interface Suggestion {
  name: string;
  role: string;
  endpoint: 'writer' | 'librarian';
  size_gb: number;
  description: string;
}

const ROLE_COLORS: Record<string, string> = {
  writer: '#A855F7', librarian: '#22D3EE', researcher: '#7CFC00',
  vision: '#FF1493', code: '#FB923C',
};

function bytes(n: number): string {
  if (!n) return '?';
  const gb = n / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`;
}

export function ModelsPanel() {
  const [endpoints, setEndpoints] = useState<EndpointInfo[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [pulling, setPulling] = useState<{ name: string; endpoint: string; progress: string } | null>(null);
  const [pullInput, setPullInput] = useState({ name: '', endpoint: 'librarian' as 'writer' | 'librarian' });
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    Promise.all([
      fetch(`${API_BASE}/models`).then(r => r.json()),
      fetch(`${API_BASE}/models/suggestions`).then(r => r.json()),
    ]).then(([m, s]) => {
      setEndpoints(m.endpoints || []);
      setSuggestions(s.suggestions || []);
    }).catch(e => setError(e.message));
  };
  useEffect(() => { refresh(); }, []);

  const handleDelete = async (endpoint: string, name: string) => {
    if (!confirm(`Delete model "${name}" from ${endpoint}? This frees disk space but can be re-pulled.`)) return;
    try {
      const r = await fetch(`${API_BASE}/models`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, name }),
      });
      if (!r.ok) throw new Error(await r.text());
      refresh();
    } catch (e: any) { alert(`Delete failed: ${e.message}`); }
  };

  const handlePull = async (endpoint: string, name: string) => {
    if (pulling) { alert('Another pull is in progress. Wait for it to finish.'); return; }
    if (!name.trim()) { alert('Enter a model name'); return; }
    setPulling({ name, endpoint, progress: 'Connecting to Ollama…' });

    const apiKey = localStorage.getItem('perry-api-key') || '';
    const r = await fetch(`${API_BASE}/models/pull?token=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, name }),
    });
    if (!r.ok || !r.body) {
      setPulling(null);
      alert(`Pull failed: HTTP ${r.status}`);
      return;
    }

    // Parse SSE stream from the server. Ollama emits status lines like
    // "pulling manifest", "downloading <hash>", with completed/total bytes.
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const ev of events) {
        const lines = ev.split('\n');
        const eventType = lines.find(l => l.startsWith('event:'))?.slice(7).trim();
        const dataLine = lines.find(l => l.startsWith('data:'))?.slice(5).trim();
        if (!dataLine) continue;
        try {
          const data = JSON.parse(dataLine);
          if (eventType === 'progress') {
            const pct = data.completed && data.total ? Math.round((data.completed / data.total) * 100) : null;
            const sizeNote = data.total ? ` (${bytes(data.completed || 0)} / ${bytes(data.total)})` : '';
            setPulling({ name, endpoint, progress: pct !== null ? `${data.status} — ${pct}%${sizeNote}` : data.status || 'working…' });
          } else if (eventType === 'complete') {
            setPulling({ name, endpoint, progress: '✓ Complete' });
            setTimeout(() => { setPulling(null); refresh(); }, 1500);
          } else if (eventType === 'error') {
            setPulling({ name, endpoint, progress: `⚠ ${data.error}` });
            setTimeout(() => setPulling(null), 3000);
          }
        } catch { /* skip malformed */ }
      }
    }
    setTimeout(() => { setPulling(null); refresh(); }, 1500);
  };

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100vh',
      background: 'radial-gradient(ellipse at center, #0a0e1f 0%, #050714 70%, #000000 100%)',
      borderRadius: 0, overflow: 'auto', color: '#E2E8F0',
    }}>
      <PanelHeader
        eyebrow="P.E.R.R.Y. // Models"
        title="Local model registry"
        subtitle={<>
          <span className="mono">{endpoints.reduce((n, e) => n + e.models.length, 0)}</span> models · <span className="mono">{bytes(endpoints.reduce((n, e) => n + e.models.reduce((m, x) => m + (x.size || 0), 0), 0))}</span> on disk
        </>}
      />

      {error && <div style={{ padding: 16, color: '#FF6B6B' }}>{error}</div>}

      {/* Active pull indicator */}
      {pulling && (
        <div style={{
          margin: 16, padding: 12, borderRadius: 6,
          background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.4)',
          fontFamily: 'monospace', fontSize: '0.8rem',
        }}>
          <div style={{ color: '#A855F7', marginBottom: 4 }}>
            ⟳ pulling <strong>{pulling.name}</strong> → {pulling.endpoint}
          </div>
          <div style={{ color: '#9BA4B5' }}>{pulling.progress}</div>
        </div>
      )}

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16 }}>
        {/* Left: per-endpoint model lists */}
        <div>
          {endpoints.map(ep => (
            <div key={ep.endpoint} style={{
              marginBottom: 16, background: 'rgba(10,14,31,0.5)',
              border: '1px solid rgba(155,164,181,0.15)', borderRadius: 6, overflow: 'hidden',
            }}>
              <div style={{
                padding: '10px 16px', borderBottom: '1px solid rgba(155,164,181,0.1)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                fontFamily: 'monospace',
              }}>
                <div>
                  <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{ep.label}</span>
                  <span style={{ color: '#6B7280', fontSize: '0.7rem', marginLeft: 12 }}>{ep.url}</span>
                </div>
                <span style={{ fontSize: '0.7rem', color: ep.ok ? '#7CFC00' : '#FF6B6B' }}>
                  {ep.ok ? `● ${ep.models.length} model${ep.models.length === 1 ? '' : 's'}` : '✗ unreachable'}
                </span>
              </div>
              {ep.ok && ep.models.length === 0 && (
                <div style={{ padding: 16, color: '#6B7280', fontStyle: 'italic', textAlign: 'center', fontFamily: 'monospace' }}>
                  no models pulled yet — try the suggestions →
                </div>
              )}
              {ep.models.map(m => (
                <div key={m.name} style={{
                  padding: '8px 16px', borderTop: '1px solid rgba(155,164,181,0.06)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontFamily: 'monospace', fontSize: '0.8rem',
                }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                    <div style={{ color: '#E2E8F0' }}>{m.name}</div>
                    <div style={{ color: '#6B7280', fontSize: '0.65rem', marginTop: 2 }}>
                      {bytes(m.size)} · {m.parameter_size || '?'} · {m.quant || '?'} · digest {m.digest}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(ep.endpoint, m.name)}
                    style={{
                      background: 'transparent', color: '#FF6B6B',
                      border: '1px solid rgba(255,107,107,0.4)', borderRadius: 3,
                      padding: '3px 10px', fontFamily: 'monospace', fontSize: '0.65rem',
                      cursor: 'pointer', letterSpacing: '0.08em',
                    }}
                  >DELETE</button>
                </div>
              ))}
            </div>
          ))}

          {/* Manual pull form */}
          <div style={{
            background: 'rgba(10,14,31,0.5)', border: '1px solid rgba(155,164,181,0.15)',
            borderRadius: 6, padding: 16,
          }}>
            <div style={{ fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.15em', color: '#9BA4B5', textTransform: 'uppercase', marginBottom: 8 }}>
              Pull a model
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text" value={pullInput.name}
                onChange={e => setPullInput({ ...pullInput, name: e.target.value })}
                placeholder="e.g. qwen2.5vl:7b"
                style={{
                  flex: 1, minWidth: 240, padding: '8px 12px',
                  background: 'rgba(0,0,0,0.4)', color: '#E2E8F0',
                  border: '1px solid rgba(155,164,181,0.25)', borderRadius: 4,
                  fontFamily: 'monospace', fontSize: '0.8rem', outline: 'none',
                }}
              />
              <select
                value={pullInput.endpoint}
                onChange={e => setPullInput({ ...pullInput, endpoint: e.target.value as any })}
                style={{
                  padding: '8px 12px', background: 'rgba(0,0,0,0.4)', color: '#E2E8F0',
                  border: '1px solid rgba(155,164,181,0.25)', borderRadius: 4,
                  fontFamily: 'monospace', fontSize: '0.8rem',
                }}
              >
                <option value="writer">Writer (5090)</option>
                <option value="librarian">Librarian (5070 Ti)</option>
              </select>
              <button
                onClick={() => handlePull(pullInput.endpoint, pullInput.name)}
                disabled={!!pulling}
                style={{
                  padding: '8px 16px', background: 'rgba(168,85,247,0.2)', color: '#A855F7',
                  border: '1px solid rgba(168,85,247,0.5)', borderRadius: 4,
                  fontFamily: 'monospace', fontSize: '0.75rem', cursor: 'pointer',
                  letterSpacing: '0.08em',
                }}
              >PULL</button>
            </div>
          </div>
        </div>

        {/* Right: suggestions */}
        <div>
          <div style={{
            fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.15em',
            color: '#9BA4B5', marginBottom: 8, textTransform: 'uppercase',
          }}>Suggestions</div>
          <div style={{
            background: 'rgba(10,14,31,0.5)', border: '1px solid rgba(155,164,181,0.15)',
            borderRadius: 6, overflow: 'hidden',
          }}>
            {suggestions.map((s, i) => {
              const ep = endpoints.find(e => e.endpoint === s.endpoint);
              const installed = ep?.models.some(m => m.name === s.name || m.name.startsWith(s.name.split(':')[0] + ':'));
              const color = ROLE_COLORS[s.role] || '#9BA4B5';
              return (
                <div key={i} style={{
                  padding: 12, borderTop: i > 0 ? '1px solid rgba(155,164,181,0.06)' : 'none',
                  fontFamily: 'monospace',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{
                      color, fontSize: '0.6rem', letterSpacing: '0.15em',
                      textTransform: 'uppercase', fontWeight: 600,
                    }}>{s.role}</span>
                    <span style={{ color: '#6B7280', fontSize: '0.65rem' }}>~{s.size_gb} GB</span>
                  </div>
                  <div style={{ color: '#E2E8F0', fontSize: '0.75rem', margin: '4px 0', wordBreak: 'break-all' }}>
                    {s.name}
                  </div>
                  <div style={{ color: '#9BA4B5', fontSize: '0.7rem', lineHeight: 1.4 }}>
                    {s.description}
                  </div>
                  <button
                    onClick={() => handlePull(s.endpoint, s.name)}
                    disabled={!!pulling || installed}
                    style={{
                      marginTop: 6,
                      background: installed ? 'transparent' : `${color}22`,
                      color: installed ? '#6B7280' : color,
                      border: `1px solid ${installed ? 'rgba(155,164,181,0.2)' : color + '55'}`,
                      borderRadius: 3, padding: '3px 10px',
                      fontFamily: 'monospace', fontSize: '0.65rem', cursor: installed || pulling ? 'default' : 'pointer',
                      letterSpacing: '0.08em',
                    }}
                  >{installed ? '● installed' : 'PULL'}</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
