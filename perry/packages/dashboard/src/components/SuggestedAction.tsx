/**
 * SuggestedAction — floating widget bottom-right that surfaces context-aware
 * next-step suggestions, derived from observed system state.
 *
 * Rules (simple, additive — easy to grow):
 *   - Active fixtures running → "Watch progress" / open Fleet
 *   - Project completed but un-audited → "Audit outputs?"
 *   - Skills installed but never applied (after >24h) → "Check why your skills aren't matching?"
 *   - Operator profile has unprocessed observations → "Run distillation?"
 *   - WhatsApp gateway in qr-needed state → "Pair WhatsApp now?"
 *   - No projects yet → "Create your first project"
 *   - Trajectory-skills accumulating → "Browse suggested installs"
 *
 * Dismissible per-suggestion; re-evaluated on each mount.
 */
import { useEffect, useState } from 'react';

interface Suggestion {
  id: string;          // stable id for dismissal
  emoji: string;
  text: string;
  cta: string;
  href?: string;       // a tab to navigate to via window.dispatchEvent
  tab?: string;        // alternative: a tab key the host can hook
}

const DISMISSED_KEY = 'perry-dismissed-suggestions';

export function SuggestedAction() {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')); } catch { return new Set(); }
  });

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      try {
        const [projRes, opRes, gwRes, suggRes] = await Promise.all([
          fetch('/api/projects', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
          fetch('/api/operator', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
          fetch('/api/gateways', { credentials: 'include' }).then(r => r.ok ? r.json() : { gateways: [] }),
          fetch('/api/learning/suggested-skills?limit=5', { credentials: 'include' }).then(r => r.ok ? r.json() : { installable: [] }),
        ]);

        const candidates: Suggestion[] = [];
        const projects: any[] = Array.isArray(projRes) ? projRes : [];
        const active = projects.filter(p => p.status === 'active');
        const recentComplete = projects.filter(p => p.status === 'completed' && p.completedAt && (Date.now() - new Date(p.completedAt).getTime()) < 24 * 3600_000);

        if (projects.length === 0) {
          candidates.push({
            id: 'first-project',
            emoji: '✨',
            text: 'Welcome! You have no projects yet — get started by creating one.',
            cta: 'Go to Projects',
            tab: 'projects',
          });
        }

        if (active.length > 0) {
          candidates.push({
            id: `active-${active[0].id}`,
            emoji: '⚡',
            text: `${active[0].title} is running. Watch the Fleet canvas to see step-by-step progress.`,
            cta: 'Open Fleet',
            tab: 'fleet',
          });
        }

        if (recentComplete.length > 0) {
          candidates.push({
            id: `audit-${recentComplete[0].id}`,
            emoji: '✅',
            text: `${recentComplete[0].title} just finished. Audit the outputs while it's fresh?`,
            cta: 'Open Self-Learn',
            tab: 'self-learning',
          });
        }

        const obsCount = opRes?.observationCount || 0;
        if (obsCount >= 5) {
          candidates.push({
            id: `distill-${obsCount}`,
            emoji: '🧠',
            text: `${obsCount} operator observations have accumulated. Distill them into your profile now?`,
            cta: 'Open You',
            tab: 'operator',
          });
        }

        const waNeedsQR = (gwRes.gateways || []).find((g: any) => g.platform === 'whatsapp' && g.enabled && !g.connected);
        if (waNeedsQR) {
          candidates.push({
            id: 'wa-qr',
            emoji: '📱',
            text: 'WhatsApp gateway is waiting for QR pairing. Scan to finish setup.',
            cta: 'Open Integrate',
            tab: 'integrations',
          });
        }

        const installable = (suggRes.installable || []);
        if (installable.length >= 2) {
          candidates.push({
            id: `installable-${installable.length}`,
            emoji: '🎯',
            text: `${installable.length} verified patterns are candidates for skill installation.`,
            cta: 'Open Self-Learn',
            tab: 'self-learning',
          });
        }

        // Pick the first non-dismissed candidate.
        const pick = candidates.find(c => !dismissed.has(c.id));
        if (!cancelled) setSuggestion(pick || null);
      } catch { /* ignore — widget is best-effort */ }
    };
    compute();
    const id = setInterval(compute, 60_000); // re-evaluate every minute
    return () => { cancelled = true; clearInterval(id); };
  }, [dismissed]);

  function dismiss(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(next))); } catch {}
  }

  function act(s: Suggestion) {
    if (s.tab) {
      window.dispatchEvent(new CustomEvent('perry:nav-tab', { detail: { tab: s.tab } }));
    } else if (s.href) {
      window.location.hash = s.href;
    }
    dismiss(s.id);
  }

  if (!suggestion) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      right: 16,
      maxWidth: 360,
      padding: 14,
      background: 'linear-gradient(135deg, rgba(168,85,247,0.10) 0%, rgba(34,211,238,0.08) 100%)',
      border: '1px solid rgba(168,85,247,0.3)',
      borderRadius: 10,
      backdropFilter: 'blur(12px)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      zIndex: 200,
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
          Suggested
        </div>
        <button
          onClick={() => dismiss(suggestion.id)}
          title="Dismiss"
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: 0, lineHeight: 1 }}
        >
          ×
        </button>
      </div>
      <div style={{ marginTop: 6, color: 'var(--text-main)', fontSize: '0.88rem', lineHeight: 1.4 }}>
        <span style={{ marginRight: 6 }}>{suggestion.emoji}</span>
        {suggestion.text}
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button
          onClick={() => act(suggestion)}
          style={{
            padding: '6px 12px',
            background: 'rgba(168,85,247,0.15)',
            border: '1px solid rgba(168,85,247,0.4)',
            color: 'var(--accent)',
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.78rem',
          }}
        >
          {suggestion.cta}
        </button>
        <button
          onClick={() => dismiss(suggestion.id)}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--text-muted)',
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.78rem',
          }}
        >
          Later
        </button>
      </div>
    </div>
  );
}
