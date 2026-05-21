/**
 * FleetCanvas — the sci-fi command-center view.
 *
 * Replaces the GPU monitor + Workers tabs with a single spatial display:
 *
 *   - Perry core at the center
 *   - Domain stations on an outer orbit (books, code, email, hacking, meta)
 *   - Agent satellites orbiting their domain station
 *   - Click an agent → right panel slides in with config + recent invocations
 *   - Bottom strip: live activity log (terminal-monospace style)
 *
 * v1 is static: positions are calculated from agent counts, no animation
 * beyond CSS transitions, no activity trails. v2 will add the polish layer
 * (pulsing, trails synced to SSE events, animated camera transitions).
 *
 * Coordinate system: SVG viewBox is 0 0 800 800 with center at (400, 400).
 * Math layouts the rings deterministically by index → angle.
 */

import { useEffect, useMemo, useState } from 'react';
import perryHologram from '../assets/perry_hologram.png';
import { playHoverSound, playClickSound } from '../utils/audio';

// Match App.tsx's API base convention. Auth is auto-injected by the
// window.fetch wrapper App.tsx installs at boot.
const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ? 'http://localhost:4000/api' : '/api';

interface AgentDef {
  id: string;
  domain: 'books' | 'code' | 'email' | 'hacking' | 'meta';
  label: string;
  description: string;
  systemPrompt: string;
  modelBinding: { provider: string; model?: string };
  toolACL: string[] | null;
  outputFormat: string;
  compression: string;
  timeoutMs: number;
  canDelegate: boolean;
}

interface DomainSummary {
  id: AgentDef['domain'];
  agentCount: number;
}

const DOMAIN_COLORS: Record<AgentDef['domain'], string> = {
  books:   '#FFD166', // warm gold
  code:    '#7CFC00', // phosphor green
  email:   '#4ECDC4', // cyan
  hacking: '#FF6B6B', // red
  meta:    '#E2E8F0', // off-white (system)
};

// Provider colors are also cost-coded. Local providers are cool tones
// (greens / cyans / violets — no marginal cost); subscription workers
// are warm orange (subscription cost, but flat-rate). The 4 local slots
// each get a distinct hue so the user can tell at a glance which model
// backs the agent. There is no color for metered API providers because
// the registry enum forbids them (subscription-only mode).
const PROVIDER_COLORS: Record<string, string> = {
  writer:        '#A855F7', // violet — biggest local model
  librarian:     '#22D3EE', // cyan — smaller librarian model
  researcher:    '#7CFC00', // lime — researcher (book-planning)
  'perry-agent': '#FF1493', // hot pink — locally-trained Perry LoRA (special)
  workers:       '#FB923C', // bright orange — CLI subscription pool
};

const PROVIDER_COST_LABELS: Record<string, { label: string; tone: 'local' | 'subscription' }> = {
  writer:        { label: 'LOCAL (free)', tone: 'local' },
  librarian:     { label: 'LOCAL (free)', tone: 'local' },
  researcher:    { label: 'LOCAL (free)', tone: 'local' },
  'perry-agent': { label: 'LOCAL — TRAINED LoRA', tone: 'local' },
  workers:       { label: 'SUBSCRIPTION (Claude/Gemini)', tone: 'subscription' },
};

// Geometry
const CX = 400, CY = 400;
const DOMAIN_ORBIT = 220;
const AGENT_ORBIT = 100;

function polar(cx: number, cy: number, r: number, angleRad: number) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

interface PlacedDomain {
  id: AgentDef['domain'];
  x: number;
  y: number;
  agents: AgentDef[];
}

function placeDomains(domains: DomainSummary[], agents: AgentDef[]): PlacedDomain[] {
  // Fixed canonical ordering — domains stay in stable positions even as
  // agent count fluctuates. Add new domains here.
  const canonical: AgentDef['domain'][] = ['books', 'code', 'email', 'hacking', 'meta'];
  const present = canonical.filter(d => domains.some(dom => dom.id === d));
  return present.map((id, idx) => {
    // Start at top (-π/2), distribute clockwise around the core.
    const angle = -Math.PI / 2 + (idx / Math.max(1, present.length)) * 2 * Math.PI;
    const { x, y } = polar(CX, CY, DOMAIN_ORBIT, angle);
    return { id, x, y, agents: agents.filter(a => a.domain === id) };
  });
}

interface PlacedAgent extends AgentDef {
  x: number;
  y: number;
  domainStation: PlacedDomain;
}

function placeAgentsForDomain(d: PlacedDomain): PlacedAgent[] {
  if (d.agents.length === 0) return [];
  return d.agents.map((a, idx) => {
    // Distribute around the domain station starting at its outward-facing side.
    // Compute the angle from core to station; spread agents on the far side.
    // Use a wider arc when there are more agents (60° per slot instead of 45°)
    // so labels don't collide.
    const stationAngle = Math.atan2(d.y - CY, d.x - CX);
    const SLOT_ANGLE = Math.PI / 2.5; // 72° per slot
    const spread = d.agents.length === 1
      ? stationAngle
      : stationAngle + (idx - (d.agents.length - 1) / 2) * SLOT_ANGLE;
    const { x, y } = polar(d.x, d.y, AGENT_ORBIT, spread);
    return { ...a, x, y, domainStation: d };
  });
}

/** Short, readable label for a satellite. Long agent labels like
 *  "Vulnerability Correlator" get truncated to keep neighbors legible. */
function shortAgentLabel(label: string): string {
  if (label.length <= 14) return label;
  // Try collapsing to initials of multi-word labels
  const words = label.split(/\s+/);
  if (words.length > 1) {
    return words.map(w => w[0]).join('').toUpperCase() + '·' + words[words.length - 1].slice(0, 8);
  }
  return label.slice(0, 12) + '…';
}

// Pre-randomised starfield (regenerate per mount; cached for stability).
// Each star carries a drift offset so the parallax field looks alive.
function generateStars(seed = 42, count = 120, width = 800, height = 800): Array<{ x: number; y: number; r: number; opacity: number; drift: number; phase: number }> {
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return Array.from({ length: count }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: 0.3 + rand() * 1.1,
    opacity: 0.15 + rand() * 0.5,
    drift: 12 + rand() * 28,        // seconds per cycle
    phase: rand() * Math.PI * 2,    // start offset
  }));
}

interface ActivityEvent {
  id: string;
  agentId: string;
  kind: 'started' | 'completed' | 'failed';
  ts: number;
}

export function FleetCanvas({ hideRightDock = false }: { hideRightDock?: boolean } = {}) {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const [trails, setTrails] = useState<ActivityEvent[]>([]);
  const [corePulse, setCorePulse] = useState(0);
  const stars = useMemo(() => generateStars(42, 380, 1600, 900), []);

  useEffect(() => {
    // window.fetch is monkey-patched by App.tsx to auto-inject Authorization.
    Promise.all([
      fetch(`${API_BASE}/agents`).then(r => r.json()).catch(() => ({ agents: [] })),
      fetch(`${API_BASE}/domains`).then(r => r.json()).catch(() => ({ domains: [] })),
    ]).then(([a, d]) => {
      setAgents(a.agents || []);
      setDomains(d.domains || []);
    }).finally(() => setLoading(false));
  }, []);

  // Slow Perry-core pulse synced to the coordinator's 5s tick — a subtle
  // "system alive" indicator. Pure CSS would work but using state lets the
  // pulse react to other events later (e.g. quicker when activity is high).
  useEffect(() => {
    const id = setInterval(() => setCorePulse(p => (p + 1) % 100), 2500);
    return () => clearInterval(id);
  }, []);

  // SSE: subscribe to agent invocation events. Each fires an activity
  // trail (animated line from satellite → core) + a feed entry. The real
  // SSE endpoint is /api/events; token in query param because EventSource
  // can't send custom headers.
  useEffect(() => {
    const apiKey = (typeof localStorage !== 'undefined' && localStorage.getItem('perry-api-key')) || '';
    const sseUrl = `${API_BASE}/events?token=${encodeURIComponent(apiKey)}`;
    const es = new EventSource(sseUrl);

    const onAgentEvent = (kind: ActivityEvent['kind']) => (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const ev: ActivityEvent = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          agentId: data.agentId,
          kind,
          ts: Date.now(),
        };
        setTrails(prev => [...prev.slice(-19), ev]); // keep last 20 trails
        setActivityFeed(prev => [...prev.slice(-49), ev]); // keep last 50 feed entries
      } catch { /* malformed event — ignore */ }
    };

    es.addEventListener('agent:invocation:started', onAgentEvent('started'));
    es.addEventListener('agent:invocation:completed', onAgentEvent('completed'));
    es.addEventListener('agent:invocation:failed', onAgentEvent('failed'));

    return () => es.close();
  }, []);

  // Trail expiry — fade out after 3s (controlled in render via age check).
  // We periodically cull the trails array so it doesn't grow forever.
  useEffect(() => {
    const id = setInterval(() => {
      setTrails(prev => prev.filter(t => Date.now() - t.ts < 3000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const placedDomains = useMemo(() => placeDomains(domains, agents), [domains, agents]);
  const placedAgents = useMemo(
    () => placedDomains.flatMap(d => placeAgentsForDomain(d)),
    [placedDomains],
  );
  const selectedAgent = placedAgents.find(a => a.id === selectedAgentId) || null;

  // Live counts for HUD telemetry
  const activeTrails = trails.length;
  const completedToday = activityFeed.filter(e => e.kind === 'completed').length;
  const failedToday = activityFeed.filter(e => e.kind === 'failed').length;

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      background: 'radial-gradient(circle at center, #0b0f19 0%, #05070d 60%, #000000 100%)',
      overflow: 'hidden',
      fontFamily: 'var(--font-sans)',
    }}>
      <style>{`
        @keyframes fleetStarTwinkle {
          0%, 100% { opacity: var(--star-base-opacity); }
          50%      { opacity: calc(var(--star-base-opacity) * 0.25); }
        }
        @keyframes fleetCoreRing {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes fleetCoreRingRev {
          from { transform: rotate(360deg); }
          to   { transform: rotate(0deg); }
        }
        @keyframes agentPulse {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.15); opacity: 0.3; }
          100% { transform: scale(1.35); opacity: 0; }
        }
        @keyframes hologramScan {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }
        @keyframes gridScroll {
          from { background-position: 0 0; }
          to { background-position: 50px 50px; }
        }
        @keyframes starWarp {
          0% {
            transform: translate(0px, 0px) rotate(0deg) scale(0.1);
            opacity: 0;
          }
          15% {
            opacity: 1;
          }
          100% {
            transform: translate(var(--dx), var(--dy)) rotate(140deg) scale(2.5);
            opacity: 0;
          }
        }
        @keyframes tunnelRing {
          0% {
            transform: scale(0.05);
            stroke-dasharray: 4 12;
            opacity: 0;
          }
          15% {
            opacity: 0.25;
          }
          85% {
            opacity: 0.25;
          }
          100% {
            transform: scale(3.5);
            stroke-dasharray: 12 36;
            opacity: 0;
          }
        }

        @keyframes flyAsteroid3D1 {
          0% {
            transform: translate(0px, 0px) scale(0.01) rotate(0deg);
            opacity: 0;
          }
          12% {
            opacity: 0.8;
          }
          95% {
            opacity: 0.8;
          }
          100% {
            transform: translate(950px, 500px) scale(3.5) rotate(280deg);
            opacity: 0;
          }
        }
        @keyframes flyAsteroid3D2 {
          0% {
            transform: translate(0px, 0px) scale(0.01) rotate(0deg);
            opacity: 0;
          }
          18% {
            opacity: 0.75;
          }
          95% {
            opacity: 0.75;
          }
          100% {
            transform: translate(-950px, -500px) scale(4.0) rotate(-420deg);
            opacity: 0;
          }
        }
        @keyframes flyAsteroid3D3 {
          0% {
            transform: translate(0px, 0px) scale(0.01) rotate(0deg);
            opacity: 0;
          }
          10% {
            opacity: 0.7;
          }
          95% {
            opacity: 0.7;
          }
          100% {
            transform: translate(-950px, 450px) scale(3.0) rotate(540deg);
            opacity: 0;
          }
        }
      `}</style>

      {/* ── HUD eyebrow: top-left ─────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 14, left: 24, zIndex: 4,
        fontFamily: 'var(--font-sans)',
        color: 'var(--text-muted)',
        maxWidth: 340,
      }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Your AI fleet
        </div>
        <div style={{
          color: 'var(--text-main)', fontSize: '1.05rem', fontWeight: 600,
          letterSpacing: '-0.01em', lineHeight: 1.2,
        }}>
          Welcome back
        </div>
        <div style={{
          marginTop: 4, fontSize: '0.82rem', color: 'var(--text-muted)',
          lineHeight: 1.45,
        }}>
          Each circle is an agent. Click any to see what it does. Use the
          chat on the right to ask Perry anything.
        </div>
      </div>

      {/* ── HUD telemetry: top-right ──────────────────────────── */}
      <div style={{
        position: 'absolute', top: 14, right: 24, zIndex: 4,
        display: 'flex', gap: 18, alignItems: 'center',
      }}>
        <HudStat label="Agents"    value={agents.length} />
        <HudStat label="Domains"   value={placedDomains.length} />
        <HudStat label="Active"    value={activeTrails} accent />
        <HudStat label="Done"      value={completedToday} tone="success" />
        {failedToday > 0 && <HudStat label="Failed" value={failedToday} tone="danger" />}
      </div>

      {/* 1. Widescreen Space Backdrop SVG (fills the entire panel, stars expand from viewport center) */}
      <svg
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      >
        <defs>
          <radialGradient id="nebula-glow-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(168, 85, 247, 0.18)" />
            <stop offset="60%" stopColor="rgba(34, 211, 238, 0.05)" />
            <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
          </radialGradient>
        </defs>

        {/* Ambient Nebula Backdrop */}
        <rect x={0} y={0} width={1600} height={900} fill="url(#nebula-glow-bg)" />

        {/* Concentric Warp Tunnel Rings */}
        <g style={{ pointerEvents: 'none' }}>
          <circle cx={800} cy={450} r={180} fill="none" stroke="rgba(34, 211, 238, 0.15)" strokeWidth={1.5}
                  style={{ transformOrigin: '800px 450px', animation: 'tunnelRing 8s linear infinite', animationDelay: '0s' }} />
          <circle cx={800} cy={450} r={180} fill="none" stroke="rgba(168, 85, 247, 0.15)" strokeWidth={1.5}
                  style={{ transformOrigin: '800px 450px', animation: 'tunnelRing 8s linear infinite', animationDelay: '2.66s' }} />
          <circle cx={800} cy={450} r={180} fill="none" stroke="rgba(34, 211, 238, 0.15)" strokeWidth={1.5}
                  style={{ transformOrigin: '800px 450px', animation: 'tunnelRing 8s linear infinite', animationDelay: '5.33s' }} />
        </g>

        {/* 3D Warp Starfield (Radiating from the cockpit center) */}
        <g>
          {stars.map((s, i) => {
            const dx = s.x - 800;
            const dy = s.y - 450;
            return (
              <circle
                key={`star-warp-${i}`}
                cx={800} cy={450} r={s.r} fill="#ffffff"
                style={{
                  ['--dx' as any]: `${dx}px`,
                  ['--dy' as any]: `${dy}px`,
                  transformOrigin: `800px 450px`,
                  animation: `starWarp ${s.drift / 1.8}s linear infinite`,
                  animationDelay: `${-s.phase}s`,
                }}
              />
            );
          })}
        </g>

        {/* Flying asteroids backdrop fluff (radiating outwards and growing in scale) */}
        <g>
          {/* Asteroid 1 (Large Rock) */}
          <g style={{ transformOrigin: '800px 450px', animation: 'flyAsteroid3D1 32s linear infinite', animationDelay: '1s' }}>
            <g style={{ transform: 'translate(800px, 450px)' }}>
              <path d="M 0,-14 L 11,-8 L 13,3 L 6,11 L -8,13 L -13,3 L -11,-10 Z" fill="#374151" stroke="#4b5563" strokeWidth="0.8" />
              <path d="M -3,-5 L 2,-6 L 5,-1 L 0,4 L -4,1 Z" fill="#1f2937" />
            </g>
          </g>
          {/* Asteroid 2 (Medium Rock) */}
          <g style={{ transformOrigin: '800px 450px', animation: 'flyAsteroid3D2 40s linear infinite', animationDelay: '11s' }}>
            <g style={{ transform: 'translate(800px, 450px)' }}>
              <path d="M 0,-8 L 6,-5 L 8,2 L 4,6 L -5,7 L -8,1 L -6,-6 Z" fill="#4b5563" stroke="#6b7280" strokeWidth="0.6" />
            </g>
          </g>
          {/* Asteroid 3 (Small Rock) */}
          <g style={{ transformOrigin: '800px 450px', animation: 'flyAsteroid3D3 26s linear infinite', animationDelay: '21s' }}>
            <g style={{ transform: 'translate(800px, 450px)' }}>
              <path d="M 0,-7 L 5,-4 L 6,2 L 3,5 L -4,6 L -6,1 L -5,-5 Z" fill="#2d3748" stroke="#4a5568" strokeWidth="0.5" />
            </g>
          </g>
        </g>
      </svg>

      {/* 2. Interactive Constellation Foreground SVG (Centered meet-ratio canvas) */}
      <svg viewBox="0 0 800 800" preserveAspectRatio="xMidYMid meet"
           style={{ width: '100%', height: '100%', display: 'block', position: 'relative', zIndex: 2, background: 'transparent' }}>
        <defs>
          <filter id="glow-purple" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Celestial Crosshair Target Grid */}
        <line x1={CX} y1={50} x2={CX} y2={750} stroke="rgba(34, 211, 238, 0.03)" strokeWidth={1} strokeDasharray="3 9" />
        <line x1={50} y1={CY} x2={750} y2={CY} stroke="rgba(34, 211, 238, 0.03)" strokeWidth={1} strokeDasharray="3 9" />
        <circle cx={CX} cy={CY} r={120} fill="none" stroke="rgba(34, 211, 238, 0.025)" strokeWidth={1} />
        <circle cx={CX} cy={CY} r={240} fill="none" stroke="rgba(34, 211, 238, 0.025)" strokeWidth={1} />
        <circle cx={CX} cy={CY} r={360} fill="none" stroke="rgba(34, 211, 238, 0.025)" strokeWidth={1} />

        {/* Orbital rings (rotating faint guides with cosmetic space dust) */}
        <g style={{ transformOrigin: `${CX}px ${CY}px`, animation: 'fleetCoreRing 120s linear infinite' }}>
          <circle cx={CX} cy={CY} r={DOMAIN_ORBIT} fill="none" stroke="rgba(34, 211, 238, 0.12)" strokeDasharray="3 12" />
          {/* Cosmic orbital dust particles */}
          <circle cx={CX + DOMAIN_ORBIT * Math.cos(0.2)} cy={CY + DOMAIN_ORBIT * Math.sin(0.2)} r={1.5} fill="rgba(34, 211, 238, 0.5)" />
          <circle cx={CX + DOMAIN_ORBIT * Math.cos(2.1)} cy={CY + DOMAIN_ORBIT * Math.sin(2.1)} r={1.2} fill="rgba(34, 211, 238, 0.3)" />
          <circle cx={CX + DOMAIN_ORBIT * Math.cos(4.3)} cy={CY + DOMAIN_ORBIT * Math.sin(4.3)} r={1.8} fill="rgba(34, 211, 238, 0.4)" />
        </g>
        <g style={{ transformOrigin: `${CX}px ${CY}px`, animation: 'fleetCoreRingRev 160s linear infinite' }}>
          <circle cx={CX} cy={CY} r={DOMAIN_ORBIT * 1.18} fill="none" stroke="rgba(168, 85, 247, 0.08)" strokeDasharray="1 18" />
          <circle cx={CX + DOMAIN_ORBIT * 1.18 * Math.cos(1.1)} cy={CY + DOMAIN_ORBIT * 1.18 * Math.sin(1.1)} r={1.5} fill="rgba(168, 85, 247, 0.4)" />
          <circle cx={CX + DOMAIN_ORBIT * 1.18 * Math.cos(3.5)} cy={CY + DOMAIN_ORBIT * 1.18 * Math.sin(3.5)} r={1.2} fill="rgba(168, 85, 247, 0.3)" />
          <circle cx={CX + DOMAIN_ORBIT * 1.18 * Math.cos(5.7)} cy={CY + DOMAIN_ORBIT * 1.18 * Math.sin(5.7)} r={1.6} fill="rgba(168, 85, 247, 0.5)" />
        </g>

        {/* Connection lines: core → domain → agents */}
        {placedDomains.map(d => (
          <g key={`conn-${d.id}`}>
            {/* Glowing communication laser lines */}
            <line x1={CX} y1={CY} x2={d.x} y2={d.y} stroke={DOMAIN_COLORS[d.id]} strokeOpacity={0.3} strokeWidth={1.5} filter="url(#glow-cyan)" />
            {placeAgentsForDomain(d).map(a => (
              <line key={`agentconn-${a.id}`} x1={d.x} y1={d.y} x2={a.x} y2={a.y}
                    stroke={DOMAIN_COLORS[d.id]} strokeOpacity={0.45} strokeWidth={1.2} />
            ))}
          </g>
        ))}

        {/* Activity trails — animated lines from agents to core when invocations fire. */}
        {trails.map(t => {
          const agent = placedAgents.find(a => a.id === t.agentId);
          if (!agent) return null;
          const age = Date.now() - t.ts;
          const opacity = Math.max(0, 1 - age / 3000);
          const color = t.kind === 'completed' ? '#7CFC00' : t.kind === 'failed' ? '#FF6B6B' : '#FB923C';
          return (
            <g key={t.id}>
              <line
                x1={agent.x} y1={agent.y} x2={CX} y2={CY}
                stroke={color} strokeOpacity={opacity * 0.8} strokeWidth={2.5}
                filter={t.kind === 'failed' ? 'url(#glow-purple)' : 'url(#glow-cyan)'}
              />
              <circle cx={agent.x + (CX - agent.x) * Math.min(1, age / 1500)}
                      cy={agent.y + (CY - agent.y) * Math.min(1, age / 1500)}
                      r={4} fill={color} opacity={opacity} filter="url(#glow-cyan)" />
            </g>
          );
        })}

        {/* Perry core — glowing fusion reactor energy core */}
        <g>
          {/* Outermost rotating telemetry ring */}
          <g style={{ transformOrigin: `${CX}px ${CY}px`, animation: 'fleetCoreRing 20s linear infinite' }}>
            <circle cx={CX} cy={CY} r={58} fill="none"
                    stroke="rgba(168,85,247,0.4)" strokeWidth={1}
                    strokeDasharray="4 12" />
          </g>
          {/* Middle counter-rotating dashboard ring */}
          <g style={{ transformOrigin: `${CX}px ${CY}px`, animation: 'fleetCoreRingRev 28s linear infinite' }}>
            <circle cx={CX} cy={CY} r={46} fill="none"
                    stroke="rgba(34,211,238,0.35)" strokeWidth={1}
                    strokeDasharray="2 8" />
          </g>
          {/* Pulsing energy shield */}
          <circle cx={CX} cy={CY} r={33 + (corePulse % 10) * 0.5}
                  fill="rgba(168,85,247,0.12)"
                  stroke="rgba(168,85,247,0.65)" strokeWidth={2}
                  opacity={0.6 + (corePulse % 10) * 0.04}
                  filter="url(#glow-purple)" />
          {/* Glowing central Core Nucleus */}
          <circle cx={CX} cy={CY} r={20}
                  fill="rgba(168,85,247,0.8)"
                  stroke="#FFFFFF" strokeWidth={1}
                  filter="url(#glow-purple)" />
          <text x={CX} y={CY + 5} textAnchor="middle"
                fontFamily="var(--font-mono)" fontSize="13" fontWeight="800"
                fill="white">P</text>
          
          {/* Floating cockpit HUD telemetry */}
          <text x={CX} y={CY + 82} textAnchor="middle"
                fontFamily="var(--font-mono)" fontSize="9" fontWeight="600"
                fill="rgba(34, 211, 238, 0.85)" letterSpacing="2" style={{ textShadow: '0 0 6px rgba(34, 211, 238, 0.5)' }}>
            {agents.length.toString().padStart(2, '0')} ACTIVE SATELLITES
          </text>
          <text x={CX} y={CY + 96} textAnchor="middle"
                fontFamily="var(--font-mono)" fontSize="7.5" fontWeight="600"
                fill="rgba(168, 85, 247, 0.7)" letterSpacing="3">
            SYS.REACTOR // ONLINE
          </text>
        </g>

        {/* Domain stations (hologram hubs) */}
        {placedDomains.map(d => (
          <g key={`station-${d.id}`}>
            {/* Outer rotating bracket circles */}
            <circle cx={d.x} cy={d.y} r={27} fill="none" stroke={DOMAIN_COLORS[d.id]} strokeDasharray="3 4" strokeOpacity={0.4} strokeWidth={1}
                    style={{ transformOrigin: `${d.x}px ${d.y}px`, animation: 'fleetCoreRing 18s linear infinite' }} />
            
            <circle cx={d.x} cy={d.y} r={21} fill={DOMAIN_COLORS[d.id]} fillOpacity={0.12}
                    stroke={DOMAIN_COLORS[d.id]} strokeOpacity={0.8} strokeWidth={1.5} />
            <text x={d.x} y={d.y + 4} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8.5"
                  fontWeight="bold" fill={DOMAIN_COLORS[d.id]} style={{ textTransform: 'uppercase', letterSpacing: '0.12em', textShadow: `0 0 4px ${DOMAIN_COLORS[d.id]}` }}>
              {d.id}
            </text>
            <text x={d.x} y={d.y + 40} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7.5"
                  fill="#9BA4B5" opacity={0.85}>
              [{d.agents.length} METRIC]
            </text>

            {/* Cosmetic Space Sector Readouts */}
            <text x={d.x} y={d.y - 34} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="6.5"
                  fill="rgba(34, 211, 238, 0.45)" style={{ letterSpacing: '1px' }}>
              SEC_{d.id.substring(0, 3).toUpperCase()}_0{d.agents.length}
            </text>
            <text x={d.x} y={d.y - 42} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="5.5"
                  fill="rgba(255,255,255,0.25)" style={{ letterSpacing: '0.5px' }}>
              RANGE: {(240 + d.agents.length * 15)}K KM // ROT: 0.0{4 + d.agents.length}R/S
            </text>
          </g>
        ))}

        {/* Agent satellites (nodes) */}
        {placedAgents.map(a => {
          const isSelected = a.id === selectedAgentId;
          const isHovered = a.id === hoveredAgentId;
          const providerColor = PROVIDER_COLORS[a.modelBinding.provider] || '#9BA4B5';
          return (
            <g
              key={`agent-${a.id}`}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                playClickSound();
                setSelectedAgentId(a.id);
              }}
              onMouseEnter={() => {
                playHoverSound();
                setHoveredAgentId(a.id);
              }}
              onMouseLeave={() => setHoveredAgentId(null)}
            >
              {/* Outer scaling radar sonar sweep */}
              {(isSelected || isHovered) && (
                <circle cx={a.x} cy={a.y} r={20} fill="none" stroke={providerColor} strokeOpacity={0.8} strokeWidth={1}
                        style={{ transformOrigin: `${a.x}px ${a.y}px`, animation: 'agentPulse 1.5s infinite ease-out' }} />
              )}
              {isSelected && (
                <circle cx={a.x} cy={a.y} r={17} fill="none" stroke="#FFFFFF" strokeOpacity={0.7} strokeWidth={1.5} />
              )}
              <circle cx={a.x} cy={a.y} r={11.5} fill={providerColor} fillOpacity={0.18}
                      stroke={providerColor} strokeOpacity={0.9} strokeWidth={1.8}
                      style={{ filter: isHovered ? 'drop-shadow(0 0 4px ' + providerColor + ')' : 'none' }} />
              
              <text x={a.x} y={a.y + 3} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7.5"
                    fontWeight="800" fill={providerColor}>
                {a.id.split('.')[1]?.slice(0, 3).toUpperCase() || '?'}
              </text>
              <text x={a.x} y={a.y + 24} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7.5"
                    fontWeight="600" fill="#E2E8F0" opacity={isHovered ? 1 : 0.8}
                    style={{ textShadow: isHovered ? '0 0 6px rgba(255,255,255,0.4)' : 'none' }}>
                {shortAgentLabel(a.label)}
              </text>
            </g>
          );
        })}

        {/* Empty-state hint */}
        {!loading && placedAgents.length === 0 && (
          <text x={CX} y={CY + 80} textAnchor="middle" fontFamily="monospace" fontSize="10" fill="#9BA4B5">
            no agents registered
          </text>
        )}
      </svg>

      {/* Detail panel — slides in from right when an agent is clicked */}
      <div
        onClick={() => setSelectedAgentId(null)}
        style={{
          position: 'absolute', inset: 0,
          background: selectedAgent ? 'rgba(0,0,0,0.4)' : 'transparent',
          pointerEvents: selectedAgent ? 'auto' : 'none',
          transition: 'background 0.25s ease',
          zIndex: 3,
        }}
      />
      <aside
        style={{
          position: 'absolute', top: 0, right: 0, height: '100%', width: 400,
          background: 'rgba(7, 9, 15, 0.85)',
          backdropFilter: 'blur(20px)',
          borderLeft: '1px solid rgba(34, 211, 238, 0.25)',
          padding: '64px 24px 32px',
          transform: selectedAgent ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
          fontFamily: 'var(--font-sans)',
          color: 'var(--text-main)',
          fontSize: '0.88rem',
          overflowY: 'auto',
          zIndex: 4,
          boxShadow: '-10px 0 40px rgba(0,0,0,0.6)',
        }}
        onClick={(e: any) => e.stopPropagation()}
      >
        {selectedAgent && (
          <>
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
                color: DOMAIN_COLORS[selectedAgent.domain as AgentDef['domain']],
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                {selectedAgent.domain} domain // satellite
              </div>
              <div style={{
                fontSize: '1.4rem',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: 1.2,
                color: 'var(--text-main)',
              }}>{selectedAgent.label}</div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
                color: 'var(--text-dim)',
                marginTop: 4,
              }}>{selectedAgent.id}</div>
            </div>

            {/* Holographic Diagnostic Display */}
            <div style={{
              position: 'relative',
              width: '100%',
              height: 140,
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid rgba(34, 211, 238, 0.25)',
              background: 'rgba(7, 9, 15, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
              boxShadow: '0 0 15px rgba(34, 211, 238, 0.1)',
            }}>
              <img src={perryHologram} alt="Perry Diagnostic Core" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.65 }} />
              {/* Animated green laser scanner bar */}
              <div style={{
                position: 'absolute',
                left: 0, right: 0,
                height: 2,
                background: 'var(--secondary)',
                boxShadow: '0 0 8px var(--secondary)',
                animation: 'hologramScan 3.5s ease-in-out infinite',
              }} />
              <div style={{
                position: 'absolute',
                top: 8, left: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.55rem',
                color: 'var(--secondary)',
                background: 'rgba(7, 9, 15, 0.75)',
                padding: '2px 6px',
                borderRadius: 3,
                border: '1px solid rgba(34, 211, 238, 0.15)',
                letterSpacing: '0.1em',
              }}>
                DIAG.SYS: ACTIVE
              </div>
              <div style={{
                position: 'absolute',
                bottom: 8, right: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.55rem',
                color: 'rgba(255, 255, 255, 0.5)',
                letterSpacing: '0.05em',
              }}>
                SIG_STRENGTH: 98.4%
              </div>
            </div>

            <Section title="Description">
              <span style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
                {selectedAgent.description}
              </span>
            </Section>

            <Section title="Model binding">
              <Row k="Provider" v={selectedAgent.modelBinding.provider} />
              <Row k="Model" v={selectedAgent.modelBinding.model || '(provider default)'} />
              {(() => {
                const cost = PROVIDER_COST_LABELS[selectedAgent.modelBinding.provider];
                if (!cost) return null;
                const color = cost.tone === 'local' ? 'var(--success)' : 'var(--warning)';
                return (
                  <div style={{
                    marginTop: 12, padding: '8px 12px', borderRadius: 6,
                    background: cost.tone === 'local' ? 'rgba(52,211,153,0.08)' : 'rgba(251,191,36,0.08)',
                    border: `1px solid ${cost.tone === 'local' ? 'rgba(52,211,153,0.25)' : 'rgba(251,191,36,0.25)'}`,
                    fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                    letterSpacing: '0.08em', color, textAlign: 'center',
                  }}>{cost.label}</div>
                );
              })()}
            </Section>

            <Section title="Tools">
              <Row k="Compression" v={selectedAgent.compression} />
              <Row k="ACL" v={selectedAgent.toolACL === null ? 'all MCP tools' : `${selectedAgent.toolACL.length} allowed`} />
              <Row k="Can delegate" v={selectedAgent.canDelegate ? 'yes (invoke_agent)' : 'no'} />
            </Section>

            <Section title="Runtime">
              <Row k="Output format" v={selectedAgent.outputFormat} />
              <Row k="Timeout" v={`${Math.round(selectedAgent.timeoutMs / 1000)}s`} />
            </Section>

            <button
              onClick={() => setSelectedAgentId(null)}
              style={{
                position: 'absolute', top: 18, right: 18,
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--panel-border)', borderRadius: 6,
                padding: '5px 12px',
                fontFamily: 'var(--font-sans)', fontSize: '0.74rem', fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = 'var(--accent-border)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--panel-border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              Close
            </button>
          </>
        )}
      </aside>

      {/* ── Right telemetry dock ──────────────────────────────
          Vertical strip on the right edge: provider legend on top,
          telemetry stream below. */}
      {!hideRightDock && (
      <div
        className="fleet-right-dock"
        style={{
          position: 'absolute', top: 60, right: 0, bottom: 0,
          width: 'var(--right-dock-w)',
          background: 'linear-gradient(270deg, rgba(7,9,15,0.85) 0%, rgba(7,9,15,0) 100%)',
          borderLeft: '1px solid var(--panel-border)',
          padding: '16px 20px',
          display: 'flex', flexDirection: 'column', gap: 18,
          zIndex: 2,
      }}>
        {/* Provider legend (top) */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Providers</div>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 5,
            fontFamily: 'var(--font-sans)', fontSize: '0.78rem',
            color: 'var(--text-muted)',
          }}>
            {Object.entries(PROVIDER_COLORS).map(([k, c]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: c, boxShadow: `0 0 6px ${c}`,
                  flexShrink: 0,
                }} />
                <span>{k}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Telemetry stream (fills remaining) */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Telemetry stream</div>
          <div style={{
            flex: 1, overflowY: 'auto',
            fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
            color: 'var(--text-muted)',
            display: 'flex', flexDirection: 'column', gap: 4,
            paddingRight: 4,
          }}>
            {activityFeed.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
                standing by · no recent invocations
              </div>
            ) : (
              activityFeed.slice(-20).reverse().map((ev: ActivityEvent) => {
                const color =
                  ev.kind === 'completed' ? 'var(--success)' :
                  ev.kind === 'failed'    ? 'var(--danger)'  : 'var(--warning)';
                return (
                  <div key={ev.id} style={{ lineHeight: 1.35 }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.62rem' }}>
                      {new Date(ev.ts).toLocaleTimeString()}
                    </div>
                    <div>
                      <span style={{ color, fontWeight: 600, letterSpacing: '0.06em' }}>
                        {ev.kind.toUpperCase()}
                      </span>
                      <span style={{ color: 'var(--text-dim)' }}> · </span>
                      <span style={{ color: 'var(--text-main)' }}>{ev.agentId}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase',
        color: '#9BA4B5', marginBottom: 6, borderBottom: '1px solid rgba(155,164,181,0.15)', paddingBottom: 4,
      }}>{title}</div>
      <div style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span style={{ color: '#9BA4B5' }}>{k}</span>
      <span style={{ color: '#E2E8F0', fontWeight: 500 }}>{v}</span>
    </div>
  );
}

/**
 * HudStat — small monospace telemetry chip used in the FleetCanvas HUD.
 * Mimics the heads-up display in flight-sim instruments: tiny uppercase
 * label above a larger numeric value.
 */
function HudStat({ label, value, accent, tone }: {
  label: string;
  value: number | string;
  accent?: boolean;
  tone?: 'success' | 'danger';
}) {
  const valueColor =
    tone === 'success' ? 'var(--success)' :
    tone === 'danger'  ? 'var(--danger)'  :
    accent             ? 'var(--accent)'  :
    'var(--text-main)';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
      lineHeight: 1,
    }}>
      <span style={{
        fontFamily: 'var(--font-sans)',
        fontSize: '0.65rem',
        fontWeight: 500,
        letterSpacing: '0.04em',
        color: 'var(--text-dim)',
        textTransform: 'uppercase',
        marginBottom: 4,
      }}>{label}</span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.95rem',
        fontWeight: 600,
        color: valueColor,
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
    </div>
  );
}
