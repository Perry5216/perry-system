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
import { useEffect, useState } from 'react';
import {
  Cpu, MessageSquare, FolderOpen, BarChart3, LineChart, ArrowDownToLine, Settings, Users, GitBranch, Sparkles, Layers, UserCircle2, Clock, Plug, ChevronsLeft, ChevronsRight, Target,
} from 'lucide-react';
import { playHoverSound, playSelectSound } from '../utils/audio';

const NAV_COLLAPSED_PX = 56;
const NAV_EXPANDED_PX = 200;
const NAV_STATE_KEY = 'perry-leftnav-collapsed';

export type NavTab = 'fleet' | 'projects' | 'workers' | 'trajectories' | 'analytics' | 'models' | 'self-learning' | 'secrets' | 'system' | 'domains' | 'operator' | 'cron' | 'integrations' | 'goals';

interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  accent?: boolean; // highlight (used for the chat toggle when chat is open)
}

interface NavSection {
  /** Short label shown above the group (uppercase tracking-wide). Omitted for the leading section. */
  label?: string;
  items: NavItem[];
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
  // Collapse / expand state — persists across reloads.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(NAV_STATE_KEY) === 'true'; } catch { return false; }
  });
  // Sync CSS variable so positioned elements elsewhere in the app adjust.
  useEffect(() => {
    const w = collapsed ? NAV_COLLAPSED_PX : NAV_EXPANDED_PX;
    document.documentElement.style.setProperty('--left-nav-w', `${w}px`);
    try { localStorage.setItem(NAV_STATE_KEY, String(collapsed)); } catch {}
  }, [collapsed]);

  // Grouped sections — Operate (live work) / Configure (set things up) /
  // Observe (look at what's happening). Each renders with a small uppercase
  // label above and a divider below.
  const sections: NavSection[] = [
    {
      // Leading section (no header) — primary entry points.
      items: [
        { key: 'fleet',  label: 'Fleet', icon: <Cpu size={22} />,           active: activeTab === 'fleet',   onClick: () => onSelectTab('fleet') },
        { key: 'chat',   label: 'Chat',  icon: <MessageSquare size={22} />, active: chatOpen,                onClick: onToggleChat, accent: true },
      ],
    },
    {
      label: 'Operate',
      items: [
        { key: 'projects',     label: 'Projects',     icon: <FolderOpen size={22} />,  active: activeTab === 'projects',     onClick: () => onSelectTab('projects') },
        { key: 'workers',      label: 'Workers',      icon: <Users size={22} />,       active: activeTab === 'workers',      onClick: () => onSelectTab('workers') },
        { key: 'trajectories', label: 'Trajectories', icon: <BarChart3 size={22} />,   active: activeTab === 'trajectories', onClick: () => onSelectTab('trajectories') },
      ],
    },
    {
      label: 'Configure',
      items: [
        { key: 'domains',      label: 'Domains',      icon: <Layers size={22} />,        active: activeTab === 'domains',      onClick: () => onSelectTab('domains') },
        { key: 'integrations', label: 'Integrate',    icon: <Plug size={22} />,          active: activeTab === 'integrations', onClick: () => onSelectTab('integrations') },
        { key: 'operator',     label: 'You',          icon: <UserCircle2 size={22} />,   active: activeTab === 'operator',     onClick: () => onSelectTab('operator') },
        { key: 'models',       label: 'Models',       icon: <ArrowDownToLine size={22} />, active: activeTab === 'models',     onClick: () => onSelectTab('models') },
        { key: 'cron',         label: 'Cron',         icon: <Clock size={22} />,         active: activeTab === 'cron',         onClick: () => onSelectTab('cron') },
        { key: 'secrets',      label: 'Secrets',      icon: <Settings size={22} />,      active: activeTab === 'secrets',      onClick: () => onSelectTab('secrets') },
      ],
    },
    {
      label: 'Observe',
      items: [
        { key: 'goals',         label: 'Goals',      icon: <Target size={22} />,    active: activeTab === 'goals',        onClick: () => onSelectTab('goals') },
        { key: 'self-learning', label: 'Self-Learn', icon: <Sparkles size={22} />,  active: activeTab === 'self-learning', onClick: () => onSelectTab('self-learning') },
        { key: 'analytics',     label: 'Analytics',  icon: <LineChart size={22} />, active: activeTab === 'analytics',     onClick: () => onSelectTab('analytics') },
        { key: 'system',        label: 'System',     icon: <GitBranch size={22} />, active: activeTab === 'system',        onClick: () => onSelectTab('system') },
      ],
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
      {sections.map((section, sIdx) => (
        <div key={sIdx} style={{ display: 'flex', flexDirection: 'column' }}>
          {section.label && !collapsed && (
            <div style={{
              padding: '12px 14px 4px',
              fontSize: '0.55rem',
              fontWeight: 700,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'rgba(34, 211, 238, 0.5)',
              textAlign: 'center',
            }}>
              {section.label}
            </div>
          )}
          {section.items.map(item => <NavButton key={item.key} item={item} collapsed={collapsed} />)}
          {sIdx < sections.length - 1 && (
            <div style={{ margin: '6px 18px', height: 1, background: 'rgba(34, 211, 238, 0.1)' }} />
          )}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <button
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Expand nav' : 'Collapse nav'}
        style={{
          margin: '8px 10px 4px',
          padding: '8px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 6,
          color: 'var(--text-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          fontFamily: 'inherit',
          fontSize: '0.7rem',
          letterSpacing: '0.05em',
        }}
        onMouseEnter={(e: any) => { e.currentTarget.style.background = 'rgba(34,211,238,0.06)'; e.currentTarget.style.color = 'var(--secondary)'; }}
        onMouseLeave={(e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /> COLLAPSE</>}
      </button>
    </nav>
  );
}

function NavButton({ item, divider, collapsed }: { item: NavItem; divider?: boolean; collapsed?: boolean }) {
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
          padding: collapsed ? '10px 4px' : '10px 12px',
          margin: '0 8px',
          borderRadius: 8,
          cursor: 'pointer',
          color: item.active ? activeColor : 'var(--text-muted)',
          display: 'flex',
          flexDirection: collapsed ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: collapsed ? 6 : 12,
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
          fontSize: collapsed ? '0.65rem' : '0.78rem',
          fontWeight: 600,
          letterSpacing: collapsed ? '0.08em' : '0.05em',
          textTransform: 'uppercase',
          textAlign: collapsed ? 'center' : 'left',
          lineHeight: 1.1,
          opacity: item.active ? 1 : 0.8,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: collapsed ? 'none' : 130,
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
