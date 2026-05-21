/**
 * ActivityHeatmap — GitHub-style 52-week calendar of Perry's activity.
 *
 * Reads /api/system/activity-heatmap. Renders a grid of squares, one per
 * day, coloured by intensity (step completions + agent invocations). The
 * point: visible evolution. The operator can SEE how much Perry has done
 * over time at a glance.
 */
import { useEffect, useState } from 'react';

interface Bucket { date: string; steps: number; invocations: number; total: number }
interface HeatmapData { days: number; series: Bucket[]; max: number }

export function ActivityHeatmap({ days = 365 }: { days?: number }) {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/system/activity-heatmap?days=${days}`, { credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!cancelled) { setData(d); setErr(null); }
      } catch (e: any) { if (!cancelled) setErr(e.message); }
    };
    load();
    const id = setInterval(load, 60_000); // refresh every minute
    return () => { cancelled = true; clearInterval(id); };
  }, [days]);

  if (err) return <div style={{ color: '#fca5a5', fontSize: '0.85rem' }}>heatmap error: {err}</div>;
  if (!data) return <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading activity...</div>;

  // Group buckets into columns (weeks). Start on Sunday-aligned week boundaries.
  const series = data.series;
  if (series.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No activity yet.</div>;

  // Build a 7×N grid. Column = week, row = day-of-week (0=Sun..6=Sat).
  const weeks: Array<Array<Bucket | null>> = [];
  let currentWeek: Array<Bucket | null> = new Array(7).fill(null);
  let lastDow = -1;
  for (const b of series) {
    const dow = new Date(b.date + 'T00:00:00Z').getUTCDay();
    if (dow <= lastDow) {
      weeks.push(currentWeek);
      currentWeek = new Array(7).fill(null);
    }
    currentWeek[dow] = b;
    lastDow = dow;
  }
  weeks.push(currentWeek);

  const max = Math.max(1, data.max);
  const intensity = (n: number) => {
    if (n === 0) return 0;
    const r = n / max;
    if (r < 0.15) return 1;
    if (r < 0.35) return 2;
    if (r < 0.6) return 3;
    return 4;
  };
  const colors = ['rgba(255,255,255,0.04)', 'rgba(34,211,238,0.2)', 'rgba(34,211,238,0.45)', 'rgba(34,211,238,0.7)', 'rgba(34,211,238,1.0)'];

  return (
    <div style={{ fontFamily: 'var(--font-mono)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Last {days} days · max {max} events / day
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>less</span>
          {colors.map((c, i) => <span key={i} style={{ display: 'inline-block', width: 10, height: 10, background: c, borderRadius: 2 }} />)}
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>more</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 3, overflowX: 'auto', padding: '2px' }}>
        {weeks.map((wk, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {wk.map((b, di) => (
              <div
                key={di}
                title={b ? `${b.date}: ${b.steps} steps, ${b.invocations} invocations` : ''}
                style={{
                  width: 11,
                  height: 11,
                  background: b ? colors[intensity(b.total)] : 'transparent',
                  borderRadius: 2,
                  border: b ? '1px solid rgba(255,255,255,0.05)' : 'none',
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
