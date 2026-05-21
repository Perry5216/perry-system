/**
 * SecretsPanel — central UI for managing encrypted credentials.
 *
 * Backed by the SecretsService routes added in @perry/dashboard-api/routes/secrets.ts.
 * Lists all known secrets (metadata only — values never displayed in the list),
 * allows add/rotate/delete, and surfaces the audit log.
 *
 * Visual language matches FleetCanvas — dark navy, monospace, sci-fi accents.
 * Cost-coded: encrypted secrets have a green check, missing required secrets
 * get a red warning, missing optional get a muted icon.
 */

import { useEffect, useState } from 'react';
import { PanelHeader } from './PanelHeader';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ? 'http://localhost:4000/api' : '/api';

interface SecretMetadata {
  name: string;
  hasValue: boolean;
  required?: boolean;
  purpose?: string;
  lastWriteAt?: string;
  lastReadAt?: string;
  rotationGraceExpiresAt?: string;
}

interface SecretAuditRow {
  id: string;
  secret_name: string;
  action: 'read' | 'write' | 'rotate' | 'delete' | 'import' | 'reveal';
  caller: string | null;
  created_at: string;
}

const ACTION_COLORS: Record<SecretAuditRow['action'], string> = {
  read:   '#9BA4B5',
  write:  '#7CFC00',
  rotate: '#FFD166',
  delete: '#FF6B6B',
  import: '#4ECDC4',
  reveal: '#FB923C',
};

export function SecretsPanel() {
  const [secrets, setSecrets] = useState<SecretMetadata[]>([]);
  const [audit, setAudit] = useState<SecretAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const [revealedValue, setRevealedValue] = useState<{ name: string; value: string } | null>(null);

  const refresh = () => {
    Promise.all([
      fetch(`${API_BASE}/secrets`).then(r => r.json()),
      fetch(`${API_BASE}/secrets-audit?limit=30`).then(r => r.json()),
    ]).then(([s, a]) => {
      setSecrets(s.secrets || []);
      setAudit(a.audit || []);
      setError(null);
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleAdd = async (name: string, value: string) => {
    const r = await fetch(`${API_BASE}/secrets/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!r.ok) throw new Error(await r.text());
    refresh();
  };

  const handleRotate = async (name: string, newValue: string, graceMs: number) => {
    const r = await fetch(`${API_BASE}/secrets/${encodeURIComponent(name)}/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: newValue, graceMs }),
    });
    if (!r.ok) throw new Error(await r.text());
    refresh();
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete secret "${name}"? This cannot be undone.`)) return;
    const r = await fetch(`${API_BASE}/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!r.ok) { alert(await r.text()); return; }
    refresh();
  };

  const handleReveal = async (name: string) => {
    if (!confirm(`Reveal "${name}"? The action will be logged in the audit trail.`)) return;
    const r = await fetch(`${API_BASE}/secrets/${encodeURIComponent(name)}/reveal`);
    if (!r.ok) { alert(await r.text()); return; }
    const data = await r.json();
    setRevealedValue({ name, value: data.value });
    refresh(); // pulls the audit entry
  };

  if (loading) return <PanelShell><div style={{ padding: 24, color: '#9BA4B5' }}>Loading...</div></PanelShell>;
  if (error) return <PanelShell><div style={{ padding: 24, color: '#FF6B6B' }}>{error}</div></PanelShell>;

  return (
    <PanelShell>
      <Header onAdd={() => setAddOpen(true)} secretCount={secrets.length} />

      <div style={{ padding: '16px 24px', display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: 24 }}>
        <div>
          <SectionTitle>Encrypted Vault</SectionTitle>
          <div style={{
            border: '1px solid rgba(155,164,181,0.15)',
            borderRadius: 6,
            background: 'rgba(10,14,31,0.5)',
            overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', fontFamily: 'monospace' }}>
              <thead>
                <tr style={{ background: 'rgba(168,85,247,0.08)', color: '#9BA4B5', textAlign: 'left', fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                  <th style={{ padding: '8px 12px' }}>Name</th>
                  <th style={{ padding: '8px 12px' }}>Status</th>
                  <th style={{ padding: '8px 12px' }}>Last write</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {secrets.map(s => (
                  <tr key={s.name} style={{ borderTop: '1px solid rgba(155,164,181,0.08)' }}>
                    <td style={{ padding: '10px 12px', color: '#E2E8F0' }}>
                      <div>{s.name}</div>
                      {s.purpose && (
                        <div style={{ fontSize: '0.68rem', color: '#6B7280', marginTop: 2 }}>{s.purpose}</div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {s.hasValue ? (
                        <span style={{ color: '#7CFC00', fontSize: '0.7rem' }}>● ENCRYPTED</span>
                      ) : s.required ? (
                        <span style={{ color: '#FF6B6B', fontSize: '0.7rem' }}>● MISSING (required)</span>
                      ) : (
                        <span style={{ color: '#6B7280', fontSize: '0.7rem' }}>○ not set</span>
                      )}
                      {s.rotationGraceExpiresAt && (
                        <div style={{ fontSize: '0.65rem', color: '#FFD166', marginTop: 2 }}>
                          rotating · grace ends {new Date(s.rotationGraceExpiresAt).toLocaleTimeString()}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#9BA4B5', fontSize: '0.7rem' }}>
                      {s.lastWriteAt ? new Date(s.lastWriteAt).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <ActionButtons
                        hasValue={s.hasValue}
                        onSet={() => setEditName(s.name)}
                        onReveal={() => handleReveal(s.name)}
                        onDelete={() => handleDelete(s.name)}
                      />
                    </td>
                  </tr>
                ))}
                {secrets.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 20, textAlign: 'center', color: '#6B7280', fontStyle: 'italic' }}>
                    no secrets yet. add one above.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <SectionTitle>Audit Log</SectionTitle>
          <div style={{
            border: '1px solid rgba(155,164,181,0.15)',
            borderRadius: 6,
            background: 'rgba(10,14,31,0.5)',
            maxHeight: 480,
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: '0.7rem',
          }}>
            {audit.length === 0 ? (
              <div style={{ padding: 16, color: '#6B7280', fontStyle: 'italic', textAlign: 'center' }}>no audit entries yet</div>
            ) : audit.map(a => (
              <div key={a.id} style={{
                padding: '6px 12px',
                display: 'grid',
                gridTemplateColumns: '70px 60px 1fr',
                gap: 8,
                borderTop: '1px solid rgba(155,164,181,0.06)',
                alignItems: 'baseline',
              }}>
                <span style={{ color: '#6B7280' }}>{new Date(a.created_at).toLocaleTimeString()}</span>
                <span style={{ color: ACTION_COLORS[a.action], textTransform: 'uppercase', fontWeight: 600 }}>{a.action}</span>
                <span style={{ color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.secret_name}
                  {a.caller && <span style={{ color: '#6B7280' }}> · {a.caller}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modals */}
      {addOpen && <AddOrEditModal title="Add secret" allowName onSave={async (n, v) => { await handleAdd(n, v); setAddOpen(false); }} onClose={() => setAddOpen(false)} />}
      {editName && (
        <AddOrEditModal
          title={`Rotate "${editName}"`}
          initialName={editName}
          allowName={false}
          showGracePeriod
          onSave={async (_n, v, grace) => { await handleRotate(editName, v, grace || 0); setEditName(null); }}
          onClose={() => setEditName(null)}
        />
      )}
      {revealedValue && <RevealModal {...revealedValue} onClose={() => setRevealedValue(null)} />}
    </PanelShell>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100vh',
      background: 'radial-gradient(ellipse at center, #0a0e1f 0%, #050714 70%, #000000 100%)',
      borderRadius: 0,
      overflow: 'auto',
      color: '#E2E8F0',
    }}>
      {children}
    </div>
  );
}

function Header({ onAdd, secretCount }: { onAdd: () => void; secretCount: number }) {
  return (
    <PanelHeader
      eyebrow="P.E.R.R.Y. // Secrets Vault"
      title="Encrypted credential store"
      subtitle={<>AES-256-GCM at rest · <span className="mono">{secretCount}</span> entries</>}
      actions={
        <button
          onClick={onAdd}
          style={{
            padding: '7px 14px', borderRadius: 6,
            fontFamily: 'var(--font-sans)', fontSize: '0.78rem', fontWeight: 500,
            background: 'var(--accent-soft)', color: 'var(--accent)',
            border: '1px solid var(--accent-border)', cursor: 'pointer',
          }}
        >+ Add secret</button>
      }
    />
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

function ActionButtons({ hasValue, onSet, onReveal, onDelete }: {
  hasValue: boolean; onSet: () => void; onReveal: () => void; onDelete: () => void;
}) {
  const btn = (label: string, color: string, onClick: () => void) => (
    <button onClick={onClick} style={{
      background: 'transparent', color, border: `1px solid ${color}55`, borderRadius: 3,
      padding: '3px 8px', fontFamily: 'monospace', fontSize: '0.65rem', cursor: 'pointer',
      marginLeft: 4, letterSpacing: '0.08em',
    }}>{label}</button>
  );
  return (
    <>
      {hasValue && btn('REVEAL', '#FB923C', onReveal)}
      {btn(hasValue ? 'ROTATE' : 'SET', hasValue ? '#FFD166' : '#7CFC00', onSet)}
      {hasValue && btn('DEL', '#FF6B6B', onDelete)}
    </>
  );
}

function AddOrEditModal({
  title, initialName, allowName, showGracePeriod, onSave, onClose,
}: {
  title: string; initialName?: string; allowName: boolean; showGracePeriod?: boolean;
  onSave: (name: string, value: string, graceMs?: number) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName || '');
  const [value, setValue] = useState('');
  const [grace, setGrace] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.match(/^[a-z_][a-z0-9_]*$/)) { setErr('name must match [a-z_][a-z0-9_]*'); return; }
    if (!value) { setErr('value required'); return; }
    setBusy(true); setErr(null);
    try { await onSave(name, value, grace * 60_000); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div style={{ fontFamily: 'monospace', color: '#E2E8F0', fontSize: '1rem', marginBottom: 16 }}>{title}</div>
      {allowName && (
        <>
          <Label>Name</Label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value.toLowerCase())}
            placeholder="lowercase_with_underscores"
            style={inputStyle}
          />
        </>
      )}
      <Label>Value</Label>
      <input
        type="password" value={value} onChange={e => setValue(e.target.value)}
        placeholder="(will be encrypted on save)"
        style={inputStyle}
        autoFocus={!allowName}
      />
      {showGracePeriod && (
        <>
          <Label>Grace period (minutes — old value still valid)</Label>
          <input
            type="number" value={grace} onChange={e => setGrace(parseInt(e.target.value) || 0)}
            min={0} max={1440}
            style={inputStyle}
          />
        </>
      )}
      {err && <div style={{ color: '#FF6B6B', fontSize: '0.75rem', marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={cancelBtnStyle}>CANCEL</button>
        <button onClick={save} disabled={busy} style={saveBtnStyle}>{busy ? 'SAVING…' : 'SAVE'}</button>
      </div>
    </ModalShell>
  );
}

function RevealModal({ name, value, onClose }: { name: string; value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <ModalShell onClose={onClose}>
      <div style={{ fontFamily: 'monospace', color: '#FB923C', fontSize: '0.7rem', letterSpacing: '0.15em', marginBottom: 6 }}>
        ⚠ REVEALED — AUDIT LOGGED
      </div>
      <div style={{ fontFamily: 'monospace', color: '#E2E8F0', fontSize: '0.9rem', marginBottom: 16 }}>{name}</div>
      <div style={{
        padding: 12, borderRadius: 4, background: 'rgba(0,0,0,0.5)',
        border: '1px solid rgba(251,146,60,0.3)', fontFamily: 'monospace',
        color: '#E2E8F0', wordBreak: 'break-all', fontSize: '0.85rem',
      }}>{value}</div>
      <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={cancelBtnStyle}>{copied ? 'COPIED' : 'COPY'}</button>
        <button onClick={onClose} style={saveBtnStyle}>CLOSE</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 480, padding: 24, borderRadius: 8,
        background: 'rgba(10,14,31,0.98)', border: '1px solid rgba(168,85,247,0.3)',
        boxShadow: '0 10px 40px rgba(168,85,247,0.15)',
      }}>
        {children}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.15em',
      textTransform: 'uppercase', color: '#9BA4B5', marginBottom: 4, marginTop: 12,
    }}>{children}</div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px',
  background: 'rgba(0,0,0,0.4)', color: '#E2E8F0',
  border: '1px solid rgba(155,164,181,0.25)', borderRadius: 4,
  fontFamily: 'monospace', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px', background: 'transparent', color: '#9BA4B5',
  border: '1px solid rgba(155,164,181,0.3)', borderRadius: 4,
  fontFamily: 'monospace', fontSize: '0.7rem', cursor: 'pointer', letterSpacing: '0.1em',
};
const saveBtnStyle: React.CSSProperties = {
  padding: '6px 14px', background: 'rgba(168,85,247,0.2)', color: '#A855F7',
  border: '1px solid rgba(168,85,247,0.5)', borderRadius: 4,
  fontFamily: 'monospace', fontSize: '0.7rem', cursor: 'pointer', letterSpacing: '0.1em',
};
