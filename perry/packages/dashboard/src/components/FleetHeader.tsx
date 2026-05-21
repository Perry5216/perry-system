/**
 * FleetHeader — adaptive welcome strip at the top of Fleet view.
 *
 * Shows the operator what changed since their last visit. Pulls from:
 *   - /api/learning/evolution → recent skill / pattern events
 *   - /api/projects → currently running projects
 *   - /api/cron → scheduled jobs count
 *   - /api/learning/state → fingerprint count
 *
 * Persists "last visit timestamp" to localStorage; the diff is computed
 * against that. Updated on each render so the next visit's diff is fresh.
 */
import { useEffect, useState } from 'react';

const LAST_VISIT_KEY = 'perry-last-visit-at';

interface EvolutionEvent { ts: string; kind: string; service?: string; name?: string }
interface Project { id: string; title: string; status: string; completedAt?: string }

interface AdaptiveData {
  lastVisitAt: string;
  hoursSinceLast: number;
  events: EvolutionEvent[];
  active: Project[];
  recentlyCompleted: Project[];
  cronCount: number;
  fingerprintCount: number;
  err: string | null;
}

export function FleetHeader() {
  const [data, setData] = useState<AdaptiveData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const lastVisit = (() => {
      try { return localStorage.getItem(LAST_VISIT_KEY) || new Date(Date.now() - 24 * 3600_000).toISOString(); } catch { return new Date(Date.now() - 24 * 3600_000).toISOString(); }
    })();
    const visitTime = new Date(lastVisit).getTime();
    const hoursSinceLast = Math.max(0, Math.round((Date.now() - visitTime) / 3600_000));

    const load = async () => {
      try {
        const [evRes, projRes, cronRes, learnRes] = await Promise.all([
          fetch(`/api/learning/evolution?since=${encodeURIComponent(lastVisit)}&limit=20`, { credentials: 'include' }),
          fetch('/api/projects', { credentials: 'include' }),
          fetch('/api/cron', { credentials: 'include' }),
          fetch('/api/learning/state', { credentials: 'include' }),
        ]);
        const ev = evRes.ok ? await evRes.json() : { events: [] };
        const projects: Project[] = projRes.ok ? await projRes.json() : [];
        const cron = cronRes.ok ? await cronRes.json() : { jobs: [] };
        const learn = learnRes.ok ? await learnRes.json() : { entries: [] };

        const active = projects.filter(p => p.status === 'active');
        const recentlyCompleted = projects
          .filter(p => p.status === 'completed' && p.completedAt && new Date(p.completedAt).getTime() > visitTime)
          .slice(0, 5);

        if (!cancelled) {
          setData({
            lastVisitAt: lastVisit,
            hoursSinceLast,
            events: ev.events || [],
            active,
            recentlyCompleted,
            cronCount: (cron.jobs || []).length,
            fingerprintCount: (learn.entries || []).length,
            err: null,
          });
        }
      } catch (e: any) {
        if (!cancelled) setData(prev => prev || {
          lastVisitAt: lastVisit, hoursSinceLast, events: [], active: [], recentlyCompleted: [],
          cronCount: 0, fingerprintCount: 0, err: e.message,
        });
      } finally {
        // Stamp THIS visit so the next render's diff is against now.
        try { localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString()); } catch {}
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (!data) return null;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return 'Up late';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 22) return 'Good evening';
    return 'Up late';
  })();

  const sinceText = data.hoursSinceLast < 1
    ? 'in the last few minutes'
    : data.hoursSinceLast < 24
      ? `in the last ${data.hoursSinceLast}h`
      : `since ${Math.round(data.hoursSinceLast / 24)} days ago`;

  // Bucket evolution events by kind for the summary line.
  const byKind: Record<string, number> = {};
  for (const e of data.events) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  const evolutionBullets: string[] = [];
  if (byKind['skill-auto-promoted']) evolutionBullets.push(`${byKind['skill-auto-promoted']} skill auto-promoted`);
  if (byKind['skill-applied']) evolutionBullets.push(`${byKind['skill-applied']} skill application${byKind['skill-applied'] === 1 ? '' : 's'}`);
  if (byKind['skill-created']) evolutionBullets.push(`${byKind['skill-created']} skill created`);
  if (byKind['verified-pattern']) evolutionBullets.push(`${byKind['verified-pattern']} verified pattern${byKind['verified-pattern'] === 1 ? '' : 's'}`);

  const nothingHappened = data.events.length === 0 && data.recentlyCompleted.length === 0 && data.active.length === 0;

  return (
    <div style={{
      margin: '12px 16px',
      padding: '14px 18px',
      background: 'linear-gradient(135deg, rgba(34, 211, 238, 0.05) 0%, rgba(168, 85, 247, 0.03) 100%)',
      border: '1px solid rgba(34, 211, 238, 0.15)',
      borderRadius: 10,
      fontFamily: 'var(--font-mono)',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: '1.05rem', color: 'var(--text-main)', fontWeight: 600 }}>
            {greeting}. <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Here's what changed {sinceText}.</span>
          </div>
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {data.active.length > 0 && <span style={{ color: '#34d399' }}>● {data.active.length} active</span>}
          {data.active.length > 0 && data.cronCount > 0 && <span style={{ margin: '0 8px', opacity: 0.3 }}>·</span>}
          {data.cronCount > 0 && <span>{data.cronCount} cron job{data.cronCount === 1 ? '' : 's'}</span>}
        </div>
      </div>

      {nothingHappened ? (
        <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
          All quiet. Nothing has happened on Perry since your last visit. Kick off a project, schedule a cron job, or chat with the director to get things moving.
        </div>
      ) : (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {data.recentlyCompleted.length > 0 && (
            <Tile heading="Fixtures completed" accent="#34d399">
              {data.recentlyCompleted.map(p => (
                <div key={p.id} style={tileItem}>
                  <strong style={{ color: 'var(--text-main)' }}>{p.title}</strong>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{p.id}</span>
                </div>
              ))}
            </Tile>
          )}
          {evolutionBullets.length > 0 && (
            <Tile heading="Self-learning" accent="#a855f7">
              {evolutionBullets.map(b => <div key={b} style={tileItem}>{b}</div>)}
              {data.events.length > evolutionBullets.length && (
                <div style={{ ...tileItem, color: 'var(--text-muted)' }}>+ {data.events.length - evolutionBullets.length} other event{data.events.length - evolutionBullets.length === 1 ? '' : 's'}</div>
              )}
            </Tile>
          )}
          {data.active.length > 0 && (
            <Tile heading="Currently active" accent="#22d3ee">
              {data.active.slice(0, 5).map(p => (
                <div key={p.id} style={tileItem}>
                  <strong style={{ color: 'var(--text-main)' }}>{p.title}</strong>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{p.id}</span>
                </div>
              ))}
            </Tile>
          )}
          {data.fingerprintCount > 0 && (
            <Tile heading="Learning state" accent="#fbbf24">
              <div style={tileItem}>{data.fingerprintCount} unique fingerprint{data.fingerprintCount === 1 ? '' : 's'} tracked</div>
            </Tile>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ heading, accent, children }: { heading: string; accent: string; children: any }) {
  return (
    <div style={{ padding: 10, background: 'rgba(0,0,0,0.25)', borderRadius: 6, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{heading}</div>
      <div>{children}</div>
    </div>
  );
}

const tileItem: any = { fontSize: '0.82rem', color: 'var(--text-main)', padding: '2px 0' };
