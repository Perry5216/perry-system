/**
 * LeftNav — slim vertical sidebar pinned to the left edge of the dashboard.
 *
 * Replaces the BridgePlanet metaphor with a conventional Discord/Slack-style
 * navigation rail. The trade-off: less novel, but instantly recognisable
 * to a new user. Each entry is icon + label, current selection highlighted
 * with a left accent stripe.
 *
 * Entries:
 *   - Talk to Perry    → toggles the chat panel
 *   - Projects         → opens the projects sidebar
 *   - Trajectories     → switches to the trajectories tab
 *   - Models           → switches to the models tab
 *   - Secrets          → switches to the secrets tab
 *
 * Width is 88px so labels fit comfortably under each 28px icon without
 * truncating common words like "Projects".
 */

import type { ReactNode } from 'react';
import {
  Cpu, MessageSquare, FolderOpen, BarChart3, LineChart, ArrowDownToLine, Settings, Users, GitBranch, Sparkles,
} from 'lucide-react';
import { playHoverSound, playSelectSound } from '../utils/audio';

export type NavTab = 'fleet' | 'projects' | 'workers' | 'trajectories' | 'analytics' | 'models' | 'self-learning' | 'secrets' | 'system';

interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  accent?: boolean; // highlight (used for the chat toggle when chat is open)
}

export function LeftNav({
  activeTab,
  onSelectTab,
  chatOpen,
  onToggleChat,
}: {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  const items: NavItem[] = [
    {
      key: 'fleet',
      label: 'Fleet',
      icon: <Cpu size={22} />,
      active: activeTab === 'fleet',
      onClick: () => onSelectTab('fleet'),
    },
    {
      key: 'chat',
      label: 'Chat',
      icon: <MessageSquare size={22} />,
      active: chatOpen,
      onClick: onToggleChat,
      accent: true,
    },
    {
      key: 'projects',
      label: 'Projects',
      icon: <FolderOpen size={22} />,
      active: activeTab === 'projects',
      onClick: () => onSelectTab('projects'),
    },
    {
      key: 'workers',
      label: 'Workers',
      icon: <Users size={22} />,
      active: activeTab === 'workers',
      onClick: () => onSelectTab('workers'),
    },
    {
      key: 'trajectories',
      label: 'Trajectories',
      icon: <BarChart3 size={22} />,
      active: activeTab === 'trajectories',
      onClick: () => onSelectTab('trajectories'),
    },
    {
      key: 'analytics',
      label: 'Analytics',
      icon: <LineChart size={22} />,
      active: activeTab === 'analytics',
      onClick: () => onSelectTab('analytics'),
    },
    {
      key: 'models',
      label: 'Models',
      icon: <ArrowDownToLine size={22} />,
      active: activeTab === 'models',
      onClick: () => onSelectTab('models'),
    },
    {
      key: 'self-learning',
      label: 'Self-Learn',
      icon: <Sparkles size={22} />,
      active: activeTab === 'self-learning',
      onClick: () => onSelectTab('self-learning'),
    },
    {
      key: 'secrets',
      label: 'Secrets',
      icon: <Settings size={22} />,
      active: activeTab === 'secrets',
      onClick: () => onSelectTab('secrets'),
    },
    {
      key: 'system',
      label: 'System',
      icon: <GitBranch size={22} />,
      active: activeTab === 'system',
      onClick: () => onSelectTab('system'),
    },
  ];

  return (
    <nav style={{
      position: 'fixed',
      top: 'var(--top-bar-h)', bottom: 0, left: 0,
      width: 'var(--left-nav-w)',
      background: 'rgba(7, 9, 15, 0.85)',
      borderRight: '1px solid rgba(34, 211, 238, 0.15)',
      backdropFilter: 'blur(16px)',
      boxShadow: '4px 0 24px rgba(0, 0, 0, 0.6), 1px 0 0 rgba(34, 211, 238, 0.05)',
      display: 'flex', flexDirection: 'column',
      padding: '16px 0',
      gap: 8,
      zIndex: 80,
      fontFamily: 'var(--font-mono)',
    }}>
      {items.map((item, idx) => (
        <NavButton key={item.key} item={item} divider={idx === 1} />
      ))}
    </nav>
  );
}

function NavButton({ item, divider }: { item: NavItem; divider?: boolean }) {
  const activeColor = item.accent ? 'var(--accent)' : 'var(--secondary)';
  const activeBg = item.accent ? 'rgba(168, 85, 247, 0.08)' : 'rgba(34, 211, 238, 0.06)';
  const activeBorder = item.accent ? 'rgba(168, 85, 247, 0.3)' : 'rgba(34, 211, 238, 0.3)';
  const activeGlow = item.accent ? 'var(--neon-purple)' : 'var(--neon-cyan)';

  return (
    <>
      <button
        onClick={() => {
          playSelectSound();
          item.onClick();
        }}
        title={item.label}
        aria-current={item.active ? 'page' : undefined}
        style={{
          position: 'relative',
          background: item.active ? activeBg : 'transparent',
          border: '1px solid',
          borderColor: item.active ? activeBorder : 'transparent',
          padding: '12px 4px',
          margin: '0 10px',
          borderRadius: 8,
          cursor: 'pointer',
          color: item.active ? activeColor : 'var(--text-muted)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 6,
          boxShadow: item.active ? `inset 0 0 10px ${activeBg}, 0 0 12px ${item.accent ? 'rgba(168,85,247,0.1)' : 'rgba(34,211,238,0.1)'}` : 'none',
          transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onMouseEnter={(e: any) => {
          playHoverSound();
          if (!item.active) {
            e.currentTarget.style.background = 'rgba(34, 211, 238, 0.04)';
            e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.15)';
            e.currentTarget.style.color = 'var(--text-main)';
            e.currentTarget.style.transform = 'scale(1.03)';
            e.currentTarget.style.boxShadow = '0 0 8px rgba(34, 211, 238, 0.08)';
          }
        }}
        onMouseLeave={(e: any) => {
          if (!item.active) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'transparent';
            e.currentTarget.style.color = 'var(--text-muted)';
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = 'none';
          }
        }}
      >
        {/* Active-state glowing laser stripe on the left edge */}
        {item.active && (
          <span style={{
            position: 'absolute',
            left: -10, top: 8, bottom: 8,
            width: 3,
            borderRadius: '0 4px 4px 0',
            background: activeColor,
            boxShadow: activeGlow,
          }} />
        )}
        <div style={{
          transition: 'transform 0.25s ease',
          filter: item.active ? `drop-shadow(0 0 4px ${activeColor})` : 'none',
        }}>
          {item.icon}
        </div>
        <span style={{
          fontSize: '0.65rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          textAlign: 'center',
          lineHeight: 1.1,
          opacity: item.active ? 1 : 0.8,
        }}>{item.label}</span>
      </button>
      {divider && (
        <div style={{
          margin: '8px 18px',
          height: 1,
          background: 'rgba(34, 211, 238, 0.15)',
          boxShadow: '0 0 4px rgba(34, 211, 238, 0.05)',
        }} />
      )}
    </>
  );
}
