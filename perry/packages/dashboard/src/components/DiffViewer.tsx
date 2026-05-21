/**
 * DiffViewer — minimal side-by-side / unified diff modal.
 *
 * No external diff library — naive line-based diff. Good enough for skill
 * edits, prompt revisions, profile distillations. Drop in as a modal
 * wherever before/after content needs comparing.
 */
import { useMemo, useState } from 'react';

interface DiffViewerProps {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
  onClose?: () => void;
}

export function DiffViewer({ before, after, beforeLabel = 'Before', afterLabel = 'After', onClose }: DiffViewerProps) {
  const [mode, setMode] = useState<'split' | 'unified'>('split');
  const diff = useMemo(() => computeLineDiff(before, after), [before, after]);

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: 'var(--secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.95rem' }}>Diff</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setMode(mode === 'split' ? 'unified' : 'split')} style={btn}>{mode === 'split' ? 'Unified' : 'Split'}</button>
            {onClose && <button onClick={onClose} style={btn}>Close</button>}
          </div>
        </div>
        {mode === 'split' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <DiffColumn label={beforeLabel} lines={diff.beforeLines} kind="before" />
            <DiffColumn label={afterLabel} lines={diff.afterLines} kind="after" />
          </div>
        ) : (
          <div>
            <div style={diffPaneLabel}>{beforeLabel} → {afterLabel}</div>
            <div style={diffPane}>
              {diff.unified.map((l, i) => (
                <div key={i} style={{ ...diffLine, ...lineStyle(l.kind) }}>
                  <span style={{ width: 18, display: 'inline-block', color: 'var(--text-muted)' }}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}</span>
                  <span>{l.text || ' '}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DiffColumn({ label, lines, kind }: { label: string; lines: Array<{ text: string; changed: boolean }>; kind: 'before' | 'after' }) {
  return (
    <div>
      <div style={diffPaneLabel}>{label}</div>
      <div style={diffPane}>
        {lines.map((l, i) => (
          <div key={i} style={{ ...diffLine, background: l.changed ? (kind === 'before' ? 'rgba(239,68,68,0.08)' : 'rgba(52,211,153,0.08)') : 'transparent' }}>
            {l.text || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}

interface UnifiedLine { kind: 'same' | 'add' | 'del'; text: string }
interface DiffResult {
  beforeLines: Array<{ text: string; changed: boolean }>;
  afterLines: Array<{ text: string; changed: boolean }>;
  unified: UnifiedLine[];
}

function computeLineDiff(before: string, after: string): DiffResult {
  const a = before.split('\n');
  const b = after.split('\n');
  // Naive line-by-line set-based diff. Fine for short markdown content.
  const aSet = new Set(a);
  const bSet = new Set(b);
  const beforeLines = a.map(l => ({ text: l, changed: !bSet.has(l) }));
  const afterLines = b.map(l => ({ text: l, changed: !aSet.has(l) }));
  const unified: UnifiedLine[] = [];
  // Build a longest-common-subsequence-ish unified diff. Approximation: walk
  // both in order, emit `same` when matched, otherwise emit `del`+`add`.
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { unified.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (j < b.length && (i >= a.length || !aSet.has(b[j]))) { unified.push({ kind: 'add', text: b[j] }); j++; }
    else if (i < a.length) { unified.push({ kind: 'del', text: a[i] }); i++; }
    else { j++; }
  }
  return { beforeLines, afterLines, unified };
}

function lineStyle(kind: 'same' | 'add' | 'del') {
  if (kind === 'add') return { background: 'rgba(52,211,153,0.10)', color: '#86efac' };
  if (kind === 'del') return { background: 'rgba(239,68,68,0.10)', color: '#fca5a5' };
  return {};
}

const backdrop: any = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modal: any = { background: '#0a0c14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 20, maxWidth: '95vw', maxHeight: '90vh', width: 1100, overflowY: 'auto', fontFamily: 'var(--font-mono)' };
const btn: any = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-main)', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit' };
const diffPaneLabel: any = { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 };
const diffPane: any = { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: 8, fontSize: '0.78rem', maxHeight: '60vh', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const diffLine: any = { padding: '1px 4px', lineHeight: 1.5 };
