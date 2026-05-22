import { useState, useEffect } from 'react';

interface HelpGuideProps {
  panelName: string;
  title?: string;
  children: React.ReactNode;
}

export function HelpGuide({ panelName, title = 'Quick Guide & Tips', children }: HelpGuideProps) {
  const localStorageKey = `perry_help_collapsed_${panelName}`;
  const [collapsed, setCollapsed] = useState<boolean>(true);

  // Load initial state from localStorage
  useEffect(() => {
    try {
      const val = localStorage.getItem(localStorageKey);
      if (val !== null) {
        setCollapsed(val === 'true');
      } else {
        // Default to expanded for new users to be helpful!
        setCollapsed(false);
      }
    } catch {
      setCollapsed(false);
    }
  }, [localStorageKey]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(localStorageKey, String(next));
    } catch {}
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle} onClick={toggle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={iconStyle}>ℹ</span>
          <span style={titleStyle}>{title}</span>
        </div>
        <button style={toggleBtnStyle}>
          {collapsed ? '[ SHOW GUIDE ]' : '[ HIDE GUIDE ]'}
        </button>
      </div>
      
      {!collapsed && (
        <div style={bodyStyle}>
          {children}
          <RotatingTips />
        </div>
      )}
    </div>
  );
}

interface HelpTooltipProps {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function HelpTooltip({ text, position = 'top' }: HelpTooltipProps) {
  const [visible, setVisible] = useState(false);

  // Map position styles
  const tooltipStyles: Record<string, React.CSSProperties> = {
    top: { bottom: '125%', left: '50%', transform: 'translateX(-50%)' },
    bottom: { top: '125%', left: '50%', transform: 'translateX(-50%)' },
    left: { right: '125%', top: '50%', transform: 'translateY(-50%)' },
    right: { left: '125%', top: '50%', transform: 'translateY(-50%)' }
  };

  return (
    <span 
      style={tooltipWrapperStyle}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible(v => !v)}
    >
      <span style={tooltipTriggerStyle}>?</span>
      {visible && (
        <span style={{ ...tooltipBoxStyle, ...tooltipStyles[position] }}>
          {text}
        </span>
      )}
    </span>
  );
}

// --- Styles ---

const containerStyle: React.CSSProperties = {
  background: 'rgba(34, 211, 238, 0.03)',
  border: '1px dashed rgba(34, 211, 238, 0.2)',
  borderRadius: 8,
  marginBottom: 16,
  overflow: 'hidden',
  transition: 'all 0.2s ease',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 16px',
  cursor: 'pointer',
  background: 'rgba(34, 211, 238, 0.02)',
  userSelect: 'none',
};

const iconStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: 'rgba(34, 211, 238, 0.15)',
  color: 'var(--secondary)',
  fontSize: '0.75rem',
  fontWeight: 'bold',
};

const titleStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-main)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const toggleBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  cursor: 'pointer',
  letterSpacing: '0.05em',
  padding: 0,
};

const bodyStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderTop: '1px solid rgba(34, 211, 238, 0.08)',
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-muted)',
};

const tooltipWrapperStyle: React.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  marginLeft: 6,
  cursor: 'help',
  verticalAlign: 'middle',
};

const tooltipTriggerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 13,
  height: 13,
  borderRadius: '50%',
  border: '1px solid rgba(255, 255, 255, 0.25)',
  color: 'var(--text-muted)',
  fontSize: '0.65rem',
  fontWeight: 'bold',
  background: 'rgba(255, 255, 255, 0.02)',
  transition: 'all 0.2s ease',
};

const tooltipBoxStyle: React.CSSProperties = {
  position: 'absolute',
  width: 200,
  padding: '8px 12px',
  background: 'rgba(10, 14, 31, 0.98)',
  border: '1px solid rgba(34, 211, 238, 0.35)',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6), 0 0 10px rgba(34, 211, 238, 0.1)',
  borderRadius: 6,
  color: 'var(--text-main)',
  fontSize: '0.75rem',
  lineHeight: 1.4,
  fontFamily: 'var(--font-sans)',
  zIndex: 1000,
  pointerEvents: 'none',
  textAlign: 'left',
  fontWeight: 'normal',
};

const TIPS = [
  "Check the Evolution tab to view a real-time audit log of auto-promotions, telemetry scores, and suggested library commands.",
  "To enable the WhatsApp gateway, set whatsapp_enabled to true in Secrets and add your JID to whatsapp_allowed_user_ids (e.g. 447700900000@s.whatsapp.net).",
  "Direct user intervention (sending message instructions in chat or manual overrides) automatically halts and pauses the active loop to prevent conflicts.",
  "You can pull recommended models with one click from the Suggestions sidebar, or type any specific tag (e.g. mistral:latest) in the manual pull field.",
  "Use the Fire button to trigger a job manually immediately to test if your project steps run successfully.",
  "Configure external clients like ChatBox or Open WebUI to talk to Perry's OpenAI-compatible API at http://localhost:3847/v1.",
  "To reset a credential instead of deleting it, click RESET in the Secrets tab to clear its value while keeping the entry key.",
  "On a headless VPS, run 'codex login --device-auth' to get a code you can authorize from any browser.",
  "Click 'Distill Soul' in the Operator panel to run the background pipeline that consolidates observations into your core preferences.",
  "View execution step traces and compression ratios by clicking on any trajectory item in the Trajectories log.",
  "Run 'npm run build' inside the perry directory to check TypeScript compiler correctness before committing changes.",
  "Perry's AES-256-GCM vault encrypts all secrets at rest. Database values are safely stored inside memory/memory.db.",
  "If a worker status is 'offline', check that your Docker Desktop application is running and the worker container is started.",
  "You don't need any programming background to teach Perry custom skills. Perry learns from your instructions and automates tasks on its own.",
  "YOLO Mode (Auto-Approve Actions) lets Perry run commands and modify files in the background without pausing to ask for your permission.",
  "The Secrets Vault is like a secure keychain. Enter passwords or API keys here once, and Perry will securely use them without showing them on screen.",
  "Ollama is a helper program that runs AI models directly on your own computer. It is free and works offline."
];

const tipsContainerStyle: React.CSSProperties = {
  marginTop: 12,
  borderTop: '1px dashed rgba(34, 211, 238, 0.15)',
  paddingTop: 8,
  fontSize: '0.75rem',
  minHeight: '28px',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
  transition: 'opacity 0.3s ease',
};

export function RotatingTips() {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const timer = setInterval(() => {
      setOpacity(0);
      setTimeout(() => {
        setCurrentIdx(prev => (prev + 1) % TIPS.length);
        setOpacity(1);
      }, 300);
    }, 10000); // cycle every 10 seconds

    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ ...tipsContainerStyle, opacity }}>
      <strong style={{ color: 'var(--secondary)', whiteSpace: 'nowrap' }}>💡 Tip:</strong>
      <span style={{ color: 'var(--text-muted)' }}>{TIPS[currentIdx]}</span>
    </div>
  );
}
