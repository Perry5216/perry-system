/**
 * PanelHeader — single header treatment used by every global panel
 * (Trajectories, Models, Secrets, Fleet detail drawers, etc).
 *
 * Layout:
 *   ┌────────────────────────────────────────────────┐
 *   │  EYEBROW (mono uppercase, dim)                 │
 *   │  Title (sans, prominent)            <actions>  │
 *   │  Subtitle (sans, muted)                        │
 *   └────────────────────────────────────────────────┘
 *
 * Keeps panels visually consistent without forcing a shared component
 * for body content — the body is whatever the panel needs.
 */

import type { ReactNode } from 'react';

export function PanelHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div style={{
      padding: '20px 28px 18px',
      borderBottom: '1px solid var(--panel-border)',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 24,
    }}>
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>
        <h2 style={{
          fontSize: '1.35rem',
          fontWeight: 600,
          letterSpacing: '-0.015em',
          lineHeight: 1.2,
        }}>{title}</h2>
        {subtitle && (
          <div style={{
            marginTop: 4,
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
          }}>{subtitle}</div>
        )}
      </div>
      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
