/**
 * TopStatusBar — slim 36px bar pinned to the top of every screen.
 *
 * Three slots: brand (left), system health (centre), focus (right).
 * Adds the "this is a real product" signal: live container health,
 * the currently selected pen-name, and a build tag.
 *
 * Health is polled from /api/system/health every 10s. Each pill shows
 * a green/amber/red dot for perry / trainer / ollama / browser.
 */

import { useEffect, useState } from 'react';
import { DomainSwitcher } from './DomainSwitcher';
import { Volume2, VolumeX } from 'lucide-react';
import { isMuted, setMuted, playClickSound } from '../utils/audio';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ? 'http://localhost:4000/api' : '/api';
const BUILD_TAG = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_BUILD_TAG) || 'dev';

type Health = 'ok' | 'warn' | 'down' | 'unknown';

interface SystemHealth {
  perry: Health;
  writer: Health;
  librarian: Health;
  db: Health;
  uptimeSec?: number;
}

const STATUS_DOT_COLOR: Record<Health, string> = {
  ok: 'var(--success)',
  warn: 'var(--warning)',
  down: 'var(--danger)',
  unknown: 'var(--text-dim)',
};

const mapStatus = (s?: string): Health =>
  s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : s === 'fail' ? 'down' : 'unknown';

const formatUptime = (sec?: number) => {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export function TopStatusBar({ activePen }: { activePen?: string }) {
  const [health, setHealth] = useState<SystemHealth>({
    perry: 'unknown', writer: 'unknown', librarian: 'unknown', db: 'unknown',
  });
  const [muted, setMutedState] = useState(isMuted());

  const toggleMute = () => {
    const nextVal = !muted;
    setMuted(nextVal);
    setMutedState(nextVal);
    if (!nextVal) {
      setTimeout(() => playClickSound(), 50);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fetchHealth = async () => {
      try {
        const r = await fetch(`${API_BASE}/system/health`);
        const data = await r.json();
        if (cancelled) return;
        // /health returns 200 (healthy) or 503 (unhealthy) — either way the
        // perry container is reachable, so we know it's up.
        setHealth({
          perry: r.status === 200 ? 'ok' : r.status === 503 ? 'warn' : 'down',
          writer: mapStatus(data.checks?.writer?.status),
          librarian: mapStatus(data.checks?.librarian?.status),
          db: mapStatus(data.checks?.database?.status),
          uptimeSec: data.uptime,
        });
      } catch {
        if (!cancelled) setHealth(prev => ({ ...prev, perry: 'down' }));
      }
    };
    fetchHealth();
    const id = setInterval(fetchHealth, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      height: 36,
      zIndex: 90,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      background: 'rgba(7, 9, 15, 0.9)',
      backdropFilter: 'blur(16px)',
      borderBottom: '1px solid rgba(34, 211, 238, 0.15)',
      boxShadow: '0 2px 20px rgba(0, 0, 0, 0.5)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      color: 'var(--text-muted)',
      pointerEvents: 'auto',
      letterSpacing: '0.05em',
    }}>
      {/* Left: brand */}
      <div
        onClick={() => {
          if ((window as any).triggerPerryBoot) {
            playClickSound();
            (window as any).triggerPerryBoot();
          }
        }}
        title="Replay diagnostic boot sequence"
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
      >
        <div style={{
          width: 6, height: 6, borderRadius: 999,
          background: 'var(--secondary)',
          boxShadow: '0 0 8px var(--secondary)',
          animation: 'topStatusBarPulse 2s infinite ease-in-out',
        }} />
        <style>{`
          @keyframes topStatusBarPulse {
            0%, 100% { opacity: 0.6; transform: scale(0.9); }
            50%      { opacity: 1; transform: scale(1.1); }
          }
        `}</style>
        <span style={{
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: 'var(--text-main)',
          textShadow: '0 0 6px rgba(255, 255, 255, 0.25)',
        }}>
          P.E.R.R.Y.
        </span>
        <span style={{
          fontSize: '0.62rem',
          color: 'var(--text-dim)',
          background: 'rgba(34, 211, 238, 0.08)',
          padding: '1px 5px',
          borderRadius: 3,
          border: '1px solid rgba(34, 211, 238, 0.12)',
        }}>
          SYS.v{BUILD_TAG}
        </span>
      </div>

      {/* Centre: container health pills */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        background: 'rgba(0, 0, 0, 0.25)',
        padding: '3px 12px',
        borderRadius: 4,
        border: '1px solid rgba(255, 255, 255, 0.03)',
      }}>
        <HealthPill name="perry" status={health.perry} />
        <HealthPill name="writer" status={health.writer} />
        <HealthPill name="librarian" status={health.librarian} />
        <HealthPill name="db" status={health.db} />
      </div>

      {/* Right: active domain switcher + active pen + uptime + audio toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <DomainSwitcher />
        {activePen && (
          <span style={{
            background: 'rgba(168, 85, 247, 0.08)',
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid rgba(168, 85, 247, 0.2)',
          }}>
            <span style={{ color: 'var(--text-dim)' }}>PEN:</span>{' '}
            <span style={{ color: 'var(--accent-hover)', fontWeight: 600 }}>{activePen.toUpperCase()}</span>
          </span>
        )}
        {health.uptimeSec && (
          <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>
            UPTIME:{' '}
            <span style={{ color: 'var(--text-main)' }}>{formatUptime(health.uptimeSec).toUpperCase()}</span>
          </span>
        )}
        <button
          onClick={() => {
            playClickSound();
            toggleMute();
          }}
          title={muted ? 'Unmute cockpit audio' : 'Mute cockpit audio'}
          style={{
            background: 'transparent',
            border: 'none',
            color: muted ? 'var(--text-dim)' : 'var(--secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px',
            borderRadius: 4,
            transition: 'color 0.2s',
            outline: 'none',
          }}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} style={{ filter: 'drop-shadow(0 0 3px rgba(34,211,238,0.4))' }} />}
        </button>
      </div>
    </div>
  );
}

function HealthPill({ name, status }: { name: string; status: Health }) {
  const isOk = status === 'ok';
  const dotColor = STATUS_DOT_COLOR[status];
  const pulseStyle = isOk
    ? { animation: 'healthPulse 2s infinite ease-in-out' }
    : undefined;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: '0.68rem',
    }}>
      <style>{`
        @keyframes healthPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 4px ${dotColor}; }
          50%      { transform: scale(1.2); box-shadow: 0 0 10px ${dotColor}; }
        }
      `}</style>
      <div style={{
        width: 6, height: 6, borderRadius: 999,
        background: dotColor,
        ...pulseStyle,
      }} />
      <span style={{
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color: status === 'down' ? 'var(--danger)' : status === 'warn' ? 'var(--warning)' : 'var(--text-muted)',
      }}>
        {name}
      </span>
    </div>
  );
}
