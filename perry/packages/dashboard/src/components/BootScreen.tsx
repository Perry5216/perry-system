import { useEffect, useState } from 'react';
import { playBootChime, playBootFinish } from '../utils/audio';

const BOOT_LINES = [
  "INITIALIZING P.E.R.R.Y COGNITIVE OS v2.0.0...",
  "ESTABLISHING LOCAL CONTEXT MATRIX...",
  "STATUS: CORE WORKSPACE SCHEMAS LOADED",
  "STATUS: VAULT & SECRETS ENVELOPE ENCRYPTED",
  "AUDITING COMPLIANCE METRICS...",
  "OK: TYPESCRIPT ENVIRONMENT VERIFIED",
  "CONNECTING MULTI-AGENT STATIONS...",
  "OK: DOCKER CONTAINER DAEMONS DISCOVERED",
  "OK: WERNICKE COMFYUI ENGINE DETECTED",
  "LAUNCHING HUD TELEMETRY VIEWPORTS...",
  "ESTABLISHING HUD COMMS LINK...",
  "OK: ALL CRITICAL SUB-SYSTEMS RUNNING. READY TO BOARD."
];

export function BootScreen({ onComplete }: { onComplete: () => void }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'finishing' | 'done'>('loading');

  useEffect(() => {
    let active = true;
    let currentIdx = 0;
    
    // Quick startup sound at the very beginning
    playBootChime(0);

    const printNextLine = () => {
      if (!active) return;
      if (currentIdx < BOOT_LINES.length) {
        const line = BOOT_LINES[currentIdx];
        setLogs(prev => [...prev, line]);
        
        // Play chime synced with line print
        playBootChime(currentIdx);

        // Update progress bar
        const newProg = Math.round(((currentIdx + 1) / BOOT_LINES.length) * 100);
        setProgress(newProg);

        currentIdx++;

        // Random delay between lines to simulate actual CPU thinking
        const nextDelay = 80 + Math.random() * 120;
        setTimeout(printNextLine, nextDelay);
      } else {
        // All lines printed, play final confirmation chimes and transition out
        setPhase('finishing');
        playBootFinish();
        
        setTimeout(() => {
          if (active) {
            setPhase('done');
            setTimeout(onComplete, 400); // Allow fadeout animation to finish
          }
        }, 600);
      }
    };

    // Delay start of logging slightly
    const startTimeout = setTimeout(printNextLine, 300);

    return () => {
      active = false;
      clearTimeout(startTimeout);
    };
  }, [onComplete]);

  return (
    <div style={{
      position: 'fixed',
      top: 0, bottom: 0, left: 0, right: 0,
      background: '#04060b',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      fontFamily: 'var(--font-mono)',
      color: 'var(--secondary)',
      padding: '40px 20px',
      overflow: 'hidden',
      transition: 'opacity 0.45s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s ease-in-out',
      opacity: phase === 'done' ? 0 : 1,
      transform: phase === 'done' ? 'scale(1.05)' : 'scale(1)',
      pointerEvents: phase === 'done' ? 'none' : 'auto',
    }}>
      {/* Glitch CRT Scanlines and Glass reflection */}
      <div className="hud-scanline" style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
        pointerEvents: 'none',
        zIndex: 10,
        opacity: 0.12,
      }} />

      {/* Main Console Box */}
      <div style={{
        width: '100%',
        maxWidth: 720,
        background: 'rgba(7, 9, 15, 0.75)',
        border: '1px solid rgba(34, 211, 238, 0.25)',
        borderRadius: 12,
        boxShadow: '0 0 40px rgba(0, 0, 0, 0.85), inset 0 0 20px rgba(34, 211, 238, 0.05)',
        padding: '30px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        backdropFilter: 'blur(20px)',
      }}>
        {/* Terminal Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px dashed rgba(34, 211, 238, 0.15)',
          paddingBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 8, height: 8, borderRadius: 999,
              background: phase === 'finishing' ? 'var(--success)' : 'var(--secondary)',
              boxShadow: phase === 'finishing' ? '0 0 10px var(--success)' : '0 0 10px var(--secondary)',
            }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.15em' }}>
              PERRY COCKPIT CONSOLE BOOTLOADER
            </span>
          </div>
          <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>SYS_STATUS: {phase.toUpperCase()}</span>
        </div>

        {/* Console Logs */}
        <div style={{
          height: 240,
          overflowY: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          gap: 6,
          fontSize: '0.78rem',
          lineHeight: 1.4,
          letterSpacing: '0.04em',
        }}>
          {logs.map((log, idx) => (
            <div key={idx} style={{
              opacity: idx === logs.length - 1 ? 1 : 0.6,
              color: log.startsWith('OK') ? 'var(--success)' : log.startsWith('STATUS') ? 'var(--warning)' : 'var(--secondary)',
              textShadow: idx === logs.length - 1 ? '0 0 8px rgba(34, 211, 238, 0.4)' : 'none',
              transition: 'opacity 0.2s',
            }}>
              <span style={{ opacity: 0.4, marginRight: 8 }}>{'>'}</span>
              {log}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', opacity: 0.8 }}>
            <span style={{ opacity: 0.4, marginRight: 8 }}>{'>'}</span>
            <span style={{
              width: 8, height: 14,
              background: 'var(--secondary)',
              animation: 'bootCursorBlink 1s infinite steps(2, start)',
            }} />
          </div>
        </div>

        {/* Progress Bar Area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', opacity: 0.6 }}>
            <span>TELEMETRY LOAD MATRIX</span>
            <span>{progress}%</span>
          </div>
          <div style={{
            width: '100%', height: 6,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(34, 211, 238, 0.1)',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress}%`, height: '100%',
              background: 'linear-gradient(90deg, var(--secondary), var(--accent))',
              boxShadow: '0 0 10px var(--secondary)',
              transition: 'width 0.15s ease-out',
            }} />
          </div>
        </div>
      </div>

      {/* Skip Button */}
      <button
        onClick={onComplete}
        style={{
          marginTop: 24,
          background: 'transparent',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 4,
          padding: '6px 16px',
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.65rem',
          letterSpacing: '0.1em',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e: any) => {
          e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.3)';
          e.currentTarget.style.color = 'var(--text-main)';
        }}
        onMouseLeave={(e: any) => {
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
          e.currentTarget.style.color = 'var(--text-dim)';
        }}
      >
        SKIP CONSOLE DIAGNOSTIC
      </button>

      {/* Styling for blinking cursor */}
      <style>{`
        @keyframes bootCursorBlink {
          to { visibility: hidden; }
        }
      `}</style>
    </div>
  );
}
