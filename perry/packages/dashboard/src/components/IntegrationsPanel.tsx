/**
 * IntegrationsPanel — single discoverable surface for "infrastructure"
 * features that don't have their own tab.
 *
 * Sections:
 *   - Gateways (Telegram / Discord / WhatsApp) with WhatsApp QR inline
 *   - Voice (TTS + STT sidecar status + activation steps)
 *   - Web Search (Tavily / Exa / Firecrawl backend status)
 *   - OpenAI-compatible API (endpoint URL + sample curl)
 *   - Plugins (list + reload button)
 *   - Cron (count summary; link out to dedicated tab)
 */
import { useEffect, useState } from 'react';
import { Cpu, Activity } from 'lucide-react';
import { PanelHeader } from './PanelHeader';

interface GatewayStatus {
  platform: string;
  enabled: boolean;
  connected: boolean;
  botName?: string;
  allowedUserCount: number;
  lastMessageAt?: string;
  lastError?: string;
  wifeModeEnabled?: boolean;
}
interface PluginInfo {
  name: string;
  meta: { name: string; version?: string; description?: string; author?: string };
  loadedAt: string;
  routes: number;
}
interface SearchBackend { id: string; configured: boolean }

interface GpuStatus {
  label: string;
  endpoint: string;
  model: string | null;
  contextUsed: number;
  contextLimit: number;
  percentFull: number;
  headroom: number;
  status: 'idle' | 'green' | 'yellow' | 'red' | 'critical';
  hallucinationRisk: boolean;
  lastPolled: string;
}

interface ContextStats {
  gpus: GpuStatus[];
  compressionMultiplier: number;
  globalRisk: 'low' | 'moderate' | 'high';
}

export function IntegrationsPanel({ contextStats }: { contextStats: ContextStats | null }) {
  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%', fontFamily: 'var(--font-mono)' }}>
      <PanelHeader
        eyebrow="INTEGRATIONS"
        title="Integrations & Services"
        subtitle="Voice · Search · Gateways · OpenAI-compat · Plugins · Cron — everything that connects Perry to the outside world."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginTop: 16 }}>
        <HardwareStatsCard contextStats={contextStats} />
        <GatewaysCard />
        <VoiceCard />
        <SearchCard />
        <OpenAICard />
        <PluginsCard />
        <CronSummaryCard />
      </div>
    </div>
  );
}

function HardwareStatsCard({ contextStats }: { contextStats: ContextStats | null }) {
  if (!contextStats) {
    return (
      <Card title="Local Hardware & GPU Stats" eyebrow="Telemetry">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: 'var(--text-muted)' }}>
          <Activity size={16} className="animate-spin" />
          <span>Polling hardware sensors...</span>
        </div>
      </Card>
    );
  }

  const { gpus, compressionMultiplier, globalRisk } = contextStats;

  const riskColor = globalRisk === 'high' ? '#ef4444' : globalRisk === 'moderate' ? '#f59e0b' : '#10b981';
  const riskBg = globalRisk === 'high' ? 'rgba(239,68,68,0.15)' : globalRisk === 'moderate' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)';
  const riskText = globalRisk === 'high' ? 'HIGH VRAM RISK' : globalRisk === 'moderate' ? 'MODERATE LOAD' : 'SYSTEM HEALTHY';

  return (
    <Card title="Local Hardware & GPU Stats" eyebrow={`${gpus.length} active gpu(s)`}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        marginBottom: 12,
        background: riskBg,
        border: `1px solid rgba(${globalRisk === 'high' ? '239,68,68' : globalRisk === 'moderate' ? '245,158,11' : '16,185,129'}, 0.25)`,
        borderRadius: 6,
        transition: 'all 0.3s ease'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Activity size={14} style={{ color: riskColor }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: riskColor, letterSpacing: '0.05em' }}>
            {riskText}
          </span>
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>Compression:</span>
          <span style={{ color: 'var(--secondary)', fontWeight: 600 }}>{compressionMultiplier.toFixed(1)}x</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {gpus.map((gpu) => {
          const isCritical = gpu.percentFull > 90;
          const isWarning = gpu.percentFull > 70 && gpu.percentFull <= 90;
          const barColor = isCritical ? '#ef4444' : isWarning ? '#fbbf24' : '#10b981';

          return (
            <div key={gpu.label} style={{
              padding: 10,
              background: 'rgba(0,0,0,0.2)',
              border: `1px solid ${gpu.hallucinationRisk ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.04)'}`,
              borderRadius: 6,
              position: 'relative',
              overflow: 'hidden'
            }}>
              {gpu.hallucinationRisk && (
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: 'linear-gradient(90deg, #ef4444, transparent, #ef4444)',
                  opacity: 0.8
                }} />
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Cpu size={14} style={{ color: barColor }} />
                  <span style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-main)' }}>{gpu.label}</span>
                </div>
                <span style={{
                  fontSize: '0.65rem',
                  padding: '1px 6px',
                  borderRadius: 10,
                  fontWeight: 600,
                  background: gpu.status === 'idle' ? 'rgba(255,255,255,0.06)' : 'rgba(34,211,238,0.1)',
                  color: gpu.status === 'idle' ? 'var(--text-muted)' : 'var(--secondary)'
                }}>
                  {gpu.status === 'idle' ? 'IDLE' : gpu.model ? gpu.model.split('/').pop()?.split(':').shift() : 'ACTIVE'}
                </span>
              </div>

              <div style={{ margin: '8px 0 4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 2 }}>
                  <span>VRAM Context: {gpu.percentFull}%</span>
                  <span>{(gpu.contextUsed / 1024).toFixed(1)}K / {(gpu.contextLimit / 1024).toFixed(0)}K ctx</span>
                </div>
                <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${gpu.percentFull}%`,
                    height: '100%',
                    background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
                    borderRadius: 3,
                    boxShadow: `0 0 6px ${barColor}44`,
                    transition: 'width 1s ease'
                  }} />
                </div>
              </div>

              {gpu.hallucinationRisk && (
                <div style={{ fontSize: '0.65rem', color: '#fca5a5', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1.5s infinite' }} />
                  <span>VRAM Threshold Exceeded — High Hallucination Risk</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Help>
        Telemetry pulled dynamically from local Ollama instances. System self-limits concurrency when context fills up to avoid out-of-memory failure.
      </Help>
    </Card>
  );
}

// ─── Gateways ────────────────────────────────────────────────────────────

function GatewaysCard() {
  const [gws, setGws] = useState<GatewayStatus[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showWaQr, setShowWaQr] = useState(false);

  async function refresh() {
    try {
      const r = await fetch('/api/gateways', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setGws(j.gateways || []);
      setErr(null);
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { refresh(); const id = setInterval(refresh, 10_000); return () => clearInterval(id); }, []);

  async function restart(platform: string) {
    try {
      await fetch(`/api/gateways/${platform}/restart`, { method: 'POST', credentials: 'include' });
      setTimeout(refresh, 1000);
    } catch (e: any) { setErr(e.message); }
  }

  async function toggleWifeMode(platform: string, currentEnabled: boolean) {
    try {
      const newVal = !currentEnabled ? 'true' : 'false';
      await fetch(`/api/secrets/whatsapp_wife_mode_enabled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: newVal }),
        credentials: 'include',
      });
      await fetch(`/api/gateways/${platform}/restart`, { method: 'POST', credentials: 'include' });
      setTimeout(refresh, 1000);
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <Card title="Messaging Gateways" eyebrow="3 platforms">
      {err && <Err msg={err} />}
      {!gws && <Dim>Loading…</Dim>}
      {gws && gws.map(g => {
        const color = g.connected ? '#34d399' : g.enabled ? '#fbbf24' : '#94a3b8';
        return (
          <div key={g.platform} style={{ padding: 10, marginBottom: 8, background: 'rgba(0,0,0,0.25)', borderRadius: 4, borderLeft: `3px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ textTransform: 'capitalize', color: 'var(--text-main)' }}>{g.platform}</strong>
                {g.botName && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{g.botName}</span>}
              </div>
              <div style={{ fontSize: '0.7rem', color, textTransform: 'uppercase' }}>
                {g.connected ? 'connected' : g.enabled ? 'connecting' : 'disabled'}
              </div>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              ACL: {g.allowedUserCount} allowed user{g.allowedUserCount === 1 ? '' : 's'}
              {g.lastMessageAt && <> · last msg: {new Date(g.lastMessageAt).toLocaleString()}</>}
            </div>
            {g.lastError && <div style={{ fontSize: '0.7rem', color: '#fca5a5', marginTop: 4 }}>⚠️ {g.lastError}</div>}
            <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
              <button onClick={() => restart(g.platform)} style={btnSmall}>↻ Restart</button>
              {g.platform === 'whatsapp' && (
                <>
                  <button onClick={() => setShowWaQr(s => !s)} style={btnSmall}>
                    {showWaQr ? 'Hide' : 'Show'} QR
                  </button>
                  <button 
                    onClick={() => toggleWifeMode(g.platform, g.wifeModeEnabled !== false)} 
                    style={{
                      ...btnSmall,
                      background: g.wifeModeEnabled !== false ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      borderColor: g.wifeModeEnabled !== false ? '#34d399' : '#ef4444',
                      color: g.wifeModeEnabled !== false ? '#34d399' : '#f87171'
                    }}
                  >
                    Wife Mode: {g.wifeModeEnabled !== false ? 'ON' : 'OFF'}
                  </button>
                </>
              )}
            </div>
            {g.platform === 'whatsapp' && showWaQr && <WhatsAppQR />}
          </div>
        );
      })}
      <Help>
        Configure tokens / enabling in <strong>Secrets</strong> tab. After changing, click ↻ Restart.
        WhatsApp pairing: enable, restart, click Show QR, scan from WhatsApp → Linked Devices.
        Wife Responder: add numbers to <code>whatsapp_wife_user_ids</code> to trigger auto-responses and memory distilling.
      </Help>
    </Card>
  );
}

function WhatsAppQR() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 5_000); return () => clearInterval(id); }, []);
  return (
    <div style={{ marginTop: 8, padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 4, textAlign: 'center' }}>
      <img
        key={tick}
        src={`/api/gateways/whatsapp/qr?t=${tick}`}
        alt="WhatsApp QR"
        onError={(e: any) => { e.currentTarget.style.display = 'none'; }}
        style={{ maxWidth: 240, borderRadius: 4 }}
      />
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
        WhatsApp → Settings → Linked Devices → Link Device → scan above.<br />
        (404 = gateway already paired or not enabled. Auto-refreshes every 5s.)
      </div>
    </div>
  );
}

// ─── Voice ───────────────────────────────────────────────────────────────

function VoiceCard() {
  const [status, setStatus] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testText, setTestText] = useState('Hello from Perry. The voice system is online.');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const r = await fetch('/api/voice/healthz', { credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setStatus({ online: false, hint: j?.hint }); setErr(null); }
      else { setStatus({ online: true, ...j }); setErr(null); }
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { refresh(); const id = setInterval(refresh, 15_000); return () => clearInterval(id); }, []);

  async function playTTS() {
    try {
      setBusy(true);
      const url = `/api/voice/tts?text=${encodeURIComponent(testText)}`;
      const audio = new Audio(url);
      audio.play().catch(() => setErr('audio playback blocked or no sidecar'));
      audio.onended = () => setBusy(false);
      audio.onerror = () => { setBusy(false); setErr('TTS request failed'); };
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <Card title="Voice (TTS + STT)" eyebrow={status?.online ? 'sidecar online' : 'sidecar offline'}>
      {err && <Err msg={err} />}
      {!status && <Dim>Loading…</Dim>}
      {status && !status.online && (
        <>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 8 }}>
            Voice sidecar isn't running. To activate:
          </div>
          <Code>{`docker compose --profile voice up -d --build perry-voice`}</Code>
          <Help>
            Uses Edge TTS (free Microsoft endpoint) + faster-whisper (local). First build ~500MB
            of Python deps; first STT call downloads ~75MB whisper-tiny model. No API key needed.
          </Help>
        </>
      )}
      {status?.online && (
        <>
          <Row label="TTS provider">{status.tts?.provider} ({status.tts?.default_voice})</Row>
          <Row label="STT provider">{status.stt?.provider} · model {status.stt?.model} on {status.stt?.device}</Row>
          <Row label="Whisper loaded">{status.stt?.loaded ? 'yes' : 'lazy (loads on first call)'}</Row>
          <div style={{ marginTop: 8 }}>
            <label style={lbl}>Test TTS</label>
            <input value={testText} onChange={e => setTestText(e.target.value)} style={input} />
            <button onClick={playTTS} disabled={busy} style={{ ...btnSmall, marginTop: 6 }}>
              {busy ? '🔊 playing…' : '🔊 Speak'}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

// ─── Search ──────────────────────────────────────────────────────────────

function SearchCard() {
  const [backends, setBackends] = useState<SearchBackend[] | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/search/backends', { credentials: 'include' })
      .then(r => r.json())
      .then(j => setBackends(j.available || []))
      .catch(() => {});
  }, []);

  async function doSearch() {
    if (!q.trim()) return;
    try {
      setBusy(true);
      setErr(null);
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=5`, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setResults(j.results || []);
    } catch (e: any) { setErr(e.message); setResults(null); }
    finally { setBusy(false); }
  }

  const configuredCount = (backends || []).filter(b => b.configured).length;

  return (
    <Card title="Web Search" eyebrow={`${configuredCount}/3 backends configured`}>
      {err && <Err msg={err} />}
      {!backends && <Dim>Loading…</Dim>}
      {backends && (
        <div style={{ marginBottom: 8 }}>
          {backends.map(b => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '2px 0' }}>
              <span style={{ color: 'var(--text-main)' }}>{b.id}</span>
              <span style={{ color: b.configured ? '#34d399' : '#94a3b8' }}>{b.configured ? '✓ configured' : '— no key'}</span>
            </div>
          ))}
        </div>
      )}
      {configuredCount === 0 && (
        <Help>
          Set <code>TAVILY_API_KEY</code>, <code>EXA_API_KEY</code>, or <code>FIRECRAWL_API_KEY</code> in
          .env (or via Secrets panel), then restart perry.
        </Help>
      )}
      {configuredCount > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="search query…" style={{ ...input, flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') doSearch(); }} />
            <button onClick={doSearch} disabled={busy || !q.trim()} style={btnSmall}>{busy ? '…' : 'Search'}</button>
          </div>
          {results && results.length === 0 && <Dim>No results.</Dim>}
          {results && results.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {results.slice(0, 5).map((r, i) => (
                <div key={i} style={{ padding: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--secondary)', fontSize: '0.85rem' }}>{r.title || r.url}</a>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{(r.snippet || '').slice(0, 200)}…</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ─── OpenAI-compat ───────────────────────────────────────────────────────

function OpenAICard() {
  const [models, setModels] = useState<any[] | null>(null);
  useEffect(() => {
    fetch('/v1/models', { credentials: 'include' })
      .then(r => r.json())
      .then(j => setModels(j.data || []))
      .catch(() => setModels([]));
  }, []);
  const sample = `curl http://localhost:3847/v1/chat/completions \\
  -H "Authorization: Bearer <PERRY_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{ "model": "perry-director", "messages": [{"role": "user", "content": "Hi"}] }'`;
  return (
    <Card title="OpenAI-Compatible API" eyebrow={`${models?.length ?? 0} model(s) exposed`}>
      <Help>
        Talk to Perry from any OpenAI-shaped client (ChatBox, LibreChat, NextChat, custom scripts).
      </Help>
      <Row label="Base URL"><code>http://localhost:3847/v1</code></Row>
      <Row label="Auth"><code>Authorization: Bearer &lt;PERRY_API_KEY&gt;</code></Row>
      {models && (
        <Row label="Models">
          {models.map((m: any) => <span key={m.id} style={chip}>{m.id}</span>)}
        </Row>
      )}
      <Code>{sample}</Code>
    </Card>
  );
}

// ─── Plugins ─────────────────────────────────────────────────────────────

function PluginsCard() {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function refresh() {
    try { const r = await fetch('/api/plugins', { credentials: 'include' }); const j = await r.json(); setPlugins(j.plugins || []); } catch {}
  }
  useEffect(() => { refresh(); }, []);
  async function reload() {
    try {
      setBusy(true);
      const r = await fetch('/api/plugins/reload', { method: 'POST', credentials: 'include' });
      const j = await r.json();
      setMsg(`Loaded ${j.loaded}, failed ${j.failed}`);
      setTimeout(() => setMsg(null), 3000);
      refresh();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <Card title="Plugins" eyebrow={`${plugins?.length ?? 0} loaded`}>
      {msg && <div style={{ color: 'var(--secondary)', fontSize: '0.8rem', marginBottom: 6 }}>{msg}</div>}
      <button onClick={reload} disabled={busy} style={btnSmall}>{busy ? '…' : '↻ Reload from disk'}</button>
      {plugins && plugins.length === 0 && (
        <Help>
          No plugins loaded. Drop a <code>.cjs</code> file in <code>workspace/plugins/</code> and
          click Reload. See <code>example-greeter.cjs</code> for the API contract.
        </Help>
      )}
      {plugins && plugins.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {plugins.map(p => (
            <div key={p.name} style={{ padding: 6, marginBottom: 4, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ color: 'var(--text-main)' }}>{p.meta.name} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>v{p.meta.version}</span></div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.meta.description}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{p.routes} route(s) · /api/plugin/{p.name}/…</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Cron summary ────────────────────────────────────────────────────────

function CronSummaryCard() {
  const [jobs, setJobs] = useState<any[] | null>(null);
  useEffect(() => {
    fetch('/api/cron', { credentials: 'include' })
      .then(r => r.json())
      .then(j => setJobs(j.jobs || []))
      .catch(() => setJobs([]));
  }, []);
  return (
    <Card title="Cron Jobs" eyebrow={`${jobs?.length ?? 0} scheduled`}>
      {jobs && jobs.length === 0 && (
        <Help>
          No cron jobs yet. Use the dedicated <strong>Cron</strong> tab to schedule recurring tasks.
        </Help>
      )}
      {jobs && jobs.length > 0 && (
        <div>
          {jobs.slice(0, 5).map(j => (
            <Row key={j.name} label={j.name}>
              <code style={{ fontSize: '0.75rem' }}>{j.schedule}</code> ·{' '}
              <span style={{ color: j.enabled === false ? '#fca5a5' : '#34d399' }}>
                {j.enabled === false ? 'disabled' : 'enabled'}
              </span>
            </Row>
          ))}
          {jobs.length > 5 && <Dim>+{jobs.length - 5} more — open Cron tab to manage.</Dim>}
        </div>
      )}
    </Card>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────

function Card({ title, eyebrow, children }: { title: string; eyebrow?: string; children: any }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <h3 style={{ margin: 0, color: 'var(--secondary)', fontSize: '0.95rem' }}>{title}</h3>
        {eyebrow && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{eyebrow}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: any }) {
  return (
    <div style={{ marginBottom: 6, fontSize: '0.85rem' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 6 }}>{label}:</span>
      <span style={{ color: 'var(--text-main)' }}>{children}</span>
    </div>
  );
}
function Dim({ children }: { children: any }) { return <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{children}</div>; }
function Err({ msg }: { msg: string }) { return <div style={{ color: '#fca5a5', fontSize: '0.8rem', marginBottom: 6 }}>{msg}</div>; }
function Help({ children }: { children: any }) { return <div style={{ marginTop: 8, padding: 8, background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: 4, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{children}</div>; }
function Code({ children }: { children: any }) { return <pre style={{ marginTop: 6, padding: 8, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, fontSize: '0.72rem', color: 'var(--text-main)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{children}</pre>; }

const cardStyle: any = { background: 'rgba(7,9,15,0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 14 };
const btnSmall: any = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-main)', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.75rem' };
const input: any = { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'var(--text-main)', padding: '6px 8px', fontFamily: 'inherit', fontSize: '0.8rem' };
const lbl: any = { display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' };
const chip: any = { padding: '2px 8px', fontSize: '0.7rem', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 12, color: 'var(--secondary)', background: 'rgba(34,211,238,0.08)', marginRight: 4 };
