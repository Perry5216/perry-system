/**
 * TrajectoriesPanel — visualises Perry's training-data accumulation.
 *
 * Every successful agent invocation lands in `agent_trajectories`. Once
 * an agent has ~500 successful invocations of consistent quality, those
 * become the training set for a per-agent LoRA. This panel shows the
 * progress per agent, the recent invocation feed, and (when a threshold
 * is hit) a "ready to train" indicator.
 *
 * Visual language matches FleetCanvas / SecretsPanel — sci-fi mono,
 * dark navy, color-coded by domain + provider.
 */

import { useEffect, useState } from 'react';
import { PanelHeader } from './PanelHeader';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ? 'http://localhost:4000/api' : '/api';

interface TrajectoryRow {
  agentId: string;
  domain: string;
  label: string;
  provider: string;
  total: number;
  success: number;
  failed: number;
  lastInvocationAt?: string;
  lastInvocationStatus?: string;
}

interface Invocation {
  id: string;
  agent_id: string;
  domain: string;
  status: string;
  model?: string;
  input?: string;
  output?: string;
  created_at: string;
  completed_at?: string;
}

const TRAIN_THRESHOLD = 500;
const DOMAIN_COLORS: Record<string, string> = {
  books: '#FFD166', code: '#7CFC00', email: '#4ECDC4', hacking: '#FF6B6B', meta: '#E2E8F0',
};
const PROVIDER_COLORS: Record<string, string> = {
  writer: '#A855F7', librarian: '#22D3EE', researcher: '#7CFC00',
  'perry-agent': '#FF1493', workers: '#FB923C',
};

export function TrajectoriesPanel() {
  const [rows, setRows] = useState<TrajectoryRow[]>([]);
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const refresh = () => {
    Promise.all([
      fetch(`${API_BASE}/trajectories/summary`).then(r => r.json()),
      fetch(`${API_BASE}/trajectories/recent?limit=30`).then(r => r.json()),
    ]).then(([s, r]) => {
      setRows(s.trajectories || []);
      setInvocations(r.invocations || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  const totalSuccess = rows.reduce((n, r) => n + r.success, 0);

  if (loading) return <Shell><div style={{ padding: 24, color: '#9BA4B5' }}>Loading…</div></Shell>;

  const filteredInvocations = selectedAgent
    ? invocations.filter(i => i.agent_id === selectedAgent)
    : invocations;

  return (
    <Shell>
      <PanelHeader
        eyebrow="P.E.R.R.Y. // Trajectories"
        title="Training corpus"
        subtitle={<>
          <span className="mono">{totalSuccess.toLocaleString()}</span> successful invocations across <span className="mono">{rows.length}</span> agents
        </>}
        actions={
          <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
            auto-refresh 5s
          </span>
        }
      />

      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: 16 }}>
        {/* Left: agents + their progress bars */}
        <div>
          <SectionTitle>Agents</SectionTitle>
          <div style={{
            background: 'rgba(10,14,31,0.5)', border: '1px solid rgba(155,164,181,0.15)',
            borderRadius: 6, overflow: 'hidden',
          }}>
            {rows.length === 0 ? (
              <div style={{ padding: 24, color: '#6B7280', fontStyle: 'italic', textAlign: 'center' }}>
                no agents registered yet
              </div>
            ) : rows.map(r => {
              const ready = r.success >= TRAIN_THRESHOLD;
              const pct = Math.min(100, (r.success / TRAIN_THRESHOLD) * 100);
              const isSelected = selectedAgent === r.agentId;
              const domainColor = DOMAIN_COLORS[r.domain] || '#9BA4B5';
              const providerColor = PROVIDER_COLORS[r.provider] || '#9BA4B5';
              return (
                <div
                  key={r.agentId}
                  onClick={() => setSelectedAgent(isSelected ? null : r.agentId)}
                  style={{
                    padding: '12px 16px',
                    borderTop: '1px solid rgba(155,164,181,0.08)',
                    background: isSelected ? 'rgba(168,85,247,0.08)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    <div>
                      <span style={{
                        fontSize: '0.6rem', letterSpacing: '0.15em', color: domainColor,
                        textTransform: 'uppercase', marginRight: 8,
                      }}>{r.domain}</span>
                      <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{r.agentId}</span>
                      <span style={{
                        marginLeft: 12, fontSize: '0.65rem', color: providerColor,
                        padding: '1px 6px', border: `1px solid ${providerColor}55`, borderRadius: 3,
                      }}>{r.provider}</span>
                    </div>
                    <div style={{ color: ready ? '#7CFC00' : '#9BA4B5', fontSize: '0.7rem' }}>
                      {r.success}/{TRAIN_THRESHOLD}{ready && ' ✓ READY TO TRAIN'}
                    </div>
                  </div>
                  <div style={{
                    marginTop: 6, height: 4, background: 'rgba(155,164,181,0.15)',
                    borderRadius: 2, overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', width: `${pct}%`,
                      background: ready ? '#7CFC00' : domainColor,
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                  <div style={{
                    marginTop: 4, fontSize: '0.65rem', color: '#6B7280',
                    display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace',
                  }}>
                    <span>
                      {r.total} total · {r.success} success · {r.failed} failed
                    </span>
                    <span>{r.lastInvocationAt ? `last: ${new Date(r.lastInvocationAt).toLocaleTimeString()}` : 'no invocations yet'}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {totalSuccess >= TRAIN_THRESHOLD && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 4,
              background: 'rgba(124,252,0,0.08)', border: '1px solid rgba(124,252,0,0.4)',
              fontFamily: 'monospace', fontSize: '0.75rem', color: '#7CFC00',
            }}>
              💡 You have enough successful trajectories to start training a domain-level
              LoRA. Future: a "Train perry-{`{domain}`}-agent:v1" button appears here.
            </div>
          )}
        </div>

        {/* Right: invocation feed */}
        <div>
          <SectionTitle>
            Recent Invocations
            {selectedAgent && (
              <span style={{ marginLeft: 8, fontSize: '0.65rem', color: '#A855F7' }}>
                · filtered: {selectedAgent}{' '}
                <span style={{ cursor: 'pointer' }} onClick={() => setSelectedAgent(null)}>(clear)</span>
              </span>
            )}
          </SectionTitle>
          <div style={{
            background: 'rgba(10,14,31,0.5)', border: '1px solid rgba(155,164,181,0.15)',
            borderRadius: 6, maxHeight: 520, overflowY: 'auto',
            fontFamily: 'monospace', fontSize: '0.7rem',
          }}>
            {filteredInvocations.length === 0 ? (
              <div style={{ padding: 16, color: '#6B7280', fontStyle: 'italic', textAlign: 'center' }}>
                no invocations to show
              </div>
            ) : filteredInvocations.map(inv => {
              const color = inv.status === 'completed' ? '#7CFC00'
                          : inv.status === 'failed' ? '#FF6B6B'
                          : inv.status === 'running' ? '#FB923C'
                          : '#9BA4B5';
              const preview = (inv.input || '').replace(/\s+/g, ' ').slice(0, 80);
              return (
                <div key={inv.id} style={{
                  padding: '8px 12px',
                  borderTop: '1px solid rgba(155,164,181,0.06)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ color, textTransform: 'uppercase', fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.1em' }}>
                      {inv.status}
                    </span>
                    <span style={{ color: '#6B7280', fontSize: '0.6rem' }}>
                      {new Date(inv.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ color: '#E2E8F0', marginTop: 2 }}>{inv.agent_id}</div>
                  {preview && (
                    <div style={{ color: '#6B7280', marginTop: 2, fontStyle: 'italic' }}>
                      ⟶ {preview}{(inv.input || '').length > 80 ? '…' : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'relative', width: '100%', height: '100vh',
      background: 'radial-gradient(ellipse at center, #0a0e1f 0%, #050714 70%, #000000 100%)',
      borderRadius: 0, overflow: 'auto', color: '#E2E8F0',
    }}>{children}</div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.15em',
      textTransform: 'uppercase', color: '#9BA4B5', marginBottom: 8,
    }}>{children}</div>
  );
}
