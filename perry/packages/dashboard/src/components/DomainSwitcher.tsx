/**
 * DomainSwitcher — top-bar dropdown for picking the active domain.
 *
 * Reads /api/domains. Stores the selection in localStorage
 * (`perry-active-domain`) and broadcasts a `perry:domain-changed` DOM event
 * so any panel can react. The persistent selection survives reloads.
 *
 * Other panels can subscribe:
 *
 *   useEffect(() => {
 *     const onChange = (e: CustomEvent) => setActiveDomain(e.detail.id);
 *     window.addEventListener('perry:domain-changed', onChange as any);
 *     return () => window.removeEventListener('perry:domain-changed', onChange as any);
 *   }, []);
 *
 * Doesn't filter anything itself — that's up to consuming panels. This is
 * the UX affordance + state store.
 */
import { useEffect, useState } from 'react';

interface Domain { id: string; label: string; color: string }

const STORAGE_KEY = 'perry-active-domain';

export function DomainSwitcher() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [active, setActive] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'books'; } catch { return 'books'; }
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/domains', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (!cancelled) setDomains(d.domains || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const pick = (id: string) => {
    setActive(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
    window.dispatchEvent(new CustomEvent('perry:domain-changed', { detail: { id } }));
    setOpen(false);
  };

  const current = domains.find(d => d.id === active);
  const color = current?.color || '#22d3ee';

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Switch active domain"
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--text-main)',
          padding: '2px 10px',
          borderRadius: 4,
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: '0.7rem',
          letterSpacing: '0.05em',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}` }} />
        <span style={{ color: 'var(--text-dim)' }}>DOMAIN:</span>
        <span style={{ fontWeight: 600 }}>{(current?.label || active).toUpperCase()}</span>
        <span style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          minWidth: 200,
          background: 'rgba(7,9,15,0.96)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 4,
          padding: 4,
          zIndex: 200,
          backdropFilter: 'blur(12px)',
        }}>
          {domains.length === 0 ? (
            <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: '0.75rem' }}>No domains. Configure at /domains.</div>
          ) : (
            domains.map(d => (
              <button
                key={d.id}
                onClick={() => pick(d.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%',
                  padding: '6px 8px',
                  background: d.id === active ? 'rgba(34,211,238,0.08)' : 'transparent',
                  border: 'none',
                  borderLeft: `3px solid ${d.color}`,
                  color: d.id === active ? 'var(--secondary)' : 'var(--text-main)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '0.75rem',
                  textAlign: 'left',
                  borderRadius: 3,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color }} />
                {d.label}
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-dim)' }}>{d.id}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
