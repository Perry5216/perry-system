import { useEffect, useState } from 'react';
import { PanelHeader } from './PanelHeader';
import {
  Play, Pause, Trash2, Plus, Loader2, Target, X, RefreshCw, Layers
} from 'lucide-react';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV)
  ? 'http://localhost:4000/api' : '/api';

interface Subgoal {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependencies: string[];
}

interface GoalState {
  text: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  turnsUsed: number;
  subgoals: Subgoal[];
  lastJudgeReason?: string;
}

interface ProjectSummary {
  id: string;
  title: string;
  status: string;
}

export function GoalsPanel({
  selectedProject,
  onSelectProject,
}: {
  selectedProject: any;
  onSelectProject: (project: any) => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [goal, setGoal] = useState<GoalState | null>(null);
  const [chatLog, setChatLog] = useState<Array<{ role: string; content: string; ts?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  
  // New goal form
  const [newGoalText, setNewGoalText] = useState('');
  
  // New subgoal form
  const [newSubgoalText, setNewSubgoalText] = useState('');
  const [subgoalDeps, setSubgoalDeps] = useState('');

  // Load projects list for the dropdown selector
  useEffect(() => {
    fetch(`${API_BASE}/projects`)
      .then(r => r.json())
      .then(j => {
        const list = Array.isArray(j) ? j : (j.projects || []);
        setProjects(list);
      })
      .catch(e => console.error('Failed to load projects', e));
  }, []);

  const fetchGoalData = async (projectId: string) => {
    try {
      const [gRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/projects/${projectId}/goal`),
        fetch(`${API_BASE}/projects/${projectId}/chat`),
      ]);
      if (!gRes.ok) throw new Error(`HTTP ${gRes.status}`);
      const goalData = await gRes.json();
      const chatData = cRes.ok ? await cRes.json() : [];
      setGoal(goalData);
      setChatLog(chatData);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  // Poll active goals or refresh when project changes
  useEffect(() => {
    if (!selectedProject?.id) {
      setGoal(null);
      setChatLog([]);
      return;
    }

    setLoading(true);
    fetchGoalData(selectedProject.id).finally(() => setLoading(false));

    // Poll if active, otherwise fetch occasionally
    const interval = setInterval(() => {
      fetchGoalData(selectedProject.id);
    }, goal?.status === 'active' ? 4000 : 10000);

    return () => clearInterval(interval);
  }, [selectedProject?.id, goal?.status]);

  // Execute a command by posting to director chat
  const runDirectorCommand = async (command: string) => {
    if (!selectedProject?.id) return;
    setActionLoading(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/projects/${selectedProject.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: command }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Wait for backend to settle
      await new Promise(r => setTimeout(r, 600));
      await fetchGoalData(selectedProject.id);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateGoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoalText.trim()) return;
    runDirectorCommand(`/goal ${newGoalText.trim()}`);
    setNewGoalText('');
  };

  const handleAddSubgoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubgoalText.trim()) return;
    let cmd = `/subgoal ${newSubgoalText.trim()}`;
    if (subgoalDeps.trim()) {
      cmd += ` dep:${subgoalDeps.trim().replace(/\s+/g, '')}`;
    }
    runDirectorCommand(cmd);
    setNewSubgoalText('');
    setSubgoalDeps('');
  };

  // Group subgoals by status
  const columns = {
    pending: goal?.subgoals?.filter(s => s.status === 'pending') || [],
    in_progress: goal?.subgoals?.filter(s => s.status === 'in_progress') || [],
    completed: goal?.subgoals?.filter(s => s.status === 'completed') || [],
    failed: goal?.subgoals?.filter(s => s.status === 'failed') || [],
  };

  const statusLabelMap = {
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
    failed: 'Failed',
  };

  const statusColorMap = {
    pending: 'var(--text-muted)',
    in_progress: 'var(--secondary)',
    completed: 'var(--success)',
    failed: 'var(--danger)',
  };

  const statusBgMap = {
    pending: 'rgba(255,255,255,0.02)',
    in_progress: 'rgba(34,211,238,0.04)',
    completed: 'rgba(16,185,129,0.04)',
    failed: 'rgba(239,68,68,0.04)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, fontFamily: 'var(--font-sans)', overflowY: 'auto' }}>
      <PanelHeader
        eyebrow="PERSISTENT GOALS"
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Target size={20} style={{ color: 'var(--accent)' }} />
            <span>Goals Board</span>
          </div>
        }
        subtitle="Manage stands of multi-turn autonomous goal execution loops and subgoal DAGs"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={14} style={{ color: 'var(--text-muted)' }} />
            <select
              value={selectedProject?.id || ''}
              onChange={(e) => {
                const proj = projects.find(p => p.id === e.target.value);
                if (proj) onSelectProject(proj);
              }}
              style={{
                padding: '6px 12px',
                background: 'rgba(7,9,15,0.8)',
                border: '1px solid rgba(34,211,238,0.2)',
                borderRadius: 6,
                color: 'var(--text-main)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              <option value="">-- Select Project Context --</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.title} ({p.status})</option>
              ))}
            </select>
            {selectedProject?.id && (
              <button
                onClick={() => fetchGoalData(selectedProject.id)}
                style={{
                  padding: 6,
                  background: 'transparent',
                  border: '1px solid rgba(34,211,238,0.2)',
                  borderRadius: 6,
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
                title="Force refresh"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            )}
          </div>
        }
      />

      {err && (
        <div style={{
          padding: 12,
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 6,
          color: 'var(--danger)',
          fontSize: '0.85rem',
          marginTop: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>{err}</span>
          <button onClick={() => setErr(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}><X size={14} /></button>
        </div>
      )}

      {!selectedProject?.id ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '40px 0', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Target size={32} style={{ color: 'var(--accent)' }} />
          </div>
          <div style={{ maxWidth: 450 }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 6 }}>No Project Selected</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.4 }}>
              Select a project from the dropdown at the top right to load or establish its standing autonomous goal loop and visualize its subgoal graph.
            </p>
          </div>
        </div>
      ) : loading && !goal ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40 }}>
          <Loader2 size={16} className="animate-spin" style={{ color: 'var(--secondary)' }} />
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading goal board…</span>
        </div>
      ) : !goal || !goal.text ? (
        /* NO ACTIVE GOAL */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 16 }}>
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--secondary)', borderBottom: '1px solid rgba(34,211,238,0.15)', paddingBottom: 6 }}>
              Set Project Goal
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Enter a standing high-level goal. The Director Agent will automatically break down this goal into a Directed Acyclic Graph (DAG) of subgoals, resolve dependencies, and coordinate background loops.
            </p>
            <form onSubmit={handleCreateGoal} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              <textarea
                value={newGoalText}
                onChange={e => setNewGoalText(e.target.value)}
                placeholder='e.g., Rewrite Chapter 1 incorporating digital drift anti-patterns and polish the dialogue'
                required
                style={{
                  width: '100%', minHeight: 80, padding: 10,
                  background: 'rgba(7,9,15,0.6)',
                  border: '1px solid rgba(34,211,238,0.2)',
                  borderRadius: 6,
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  resize: 'vertical',
                }}
              />
              <button
                type="submit"
                disabled={actionLoading || !newGoalText.trim()}
                style={{
                  padding: '8px 16px',
                  background: 'linear-gradient(135deg, var(--accent) 0%, #7C3AED 100%)',
                  border: '1px solid rgba(168,85,247,0.4)',
                  borderRadius: 6,
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  cursor: actionLoading ? 'wait' : 'pointer',
                  alignSelf: 'flex-start',
                  display: 'flex', alignItems: 'center', gap: 6
                }}
              >
                {actionLoading && <Loader2 size={12} className="animate-spin" />}
                Initialize Goal Loop
              </button>
            </form>
          </div>
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 6 }}>
              Goal Execution Guide
            </h3>
            <ul style={{ paddingLeft: 16, fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 8, lineHeight: 1.4 }}>
              <li><strong>Multi-Turn Loop</strong>: Background workers run continuous loops to accomplish subgoals, capped to safe iteration turn counts.</li>
              <li><strong>Preemption</strong>: Direct user input or message logs sent to the chat will instantly halt the loop and pause execution.</li>
              <li><strong>Autonomous Evaluation</strong>: Structured LLM-based judge assertions evaluate the completion criteria at each loop tick.</li>
            </ul>
          </div>
        </div>
      ) : (
        /* ACTIVE GOAL STATE */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          {/* Active Goal Info Header */}
          <div className="glass-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className={`status-badge status-${goal.status}`}>{goal.status}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    Turns Used: <strong style={{ color: 'var(--secondary)' }}>{goal.turnsUsed}</strong> / 5
                  </span>
                </div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main)', marginTop: 4 }}>
                  "{goal.text}"
                </h3>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {goal.status === 'active' ? (
                  <button
                    onClick={() => runDirectorCommand('/goal pause')}
                    disabled={actionLoading}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(245,158,11,0.12)',
                      border: '1px solid rgba(245,158,11,0.4)',
                      borderRadius: 6,
                      color: 'var(--warning)',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--font-mono)',
                      display: 'flex', alignItems: 'center', gap: 4
                    }}
                  >
                    <Pause size={12} /> PAUSE
                  </button>
                ) : (
                  <button
                    onClick={() => runDirectorCommand('/goal resume')}
                    disabled={actionLoading}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(34,197,94,0.12)',
                      border: '1px solid rgba(34,197,94,0.4)',
                      borderRadius: 6,
                      color: '#86EFAC',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--font-mono)',
                      display: 'flex', alignItems: 'center', gap: 4
                    }}
                  >
                    <Play size={12} /> RESUME
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm('Clear goal? This will reset all subgoal nodes.')) {
                      runDirectorCommand('/goal clear');
                    }
                  }}
                  disabled={actionLoading}
                  style={{
                    padding: '6px 12px',
                    background: 'rgba(220,38,38,0.12)',
                    border: '1px solid rgba(220,38,38,0.4)',
                    borderRadius: 6,
                    color: '#FCA5A5',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-mono)',
                    display: 'flex', alignItems: 'center', gap: 4
                  }}
                >
                  <Trash2 size={12} /> CLEAR
                </button>
              </div>
            </div>

            {goal.lastJudgeReason && (
              <div style={{
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.03)',
                borderLeft: '2px solid var(--accent)',
                borderRadius: '0 4px 4px 0',
                fontSize: '0.78rem',
                color: 'var(--text-muted)',
              }}>
                <span style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 6 }}>Last Judge Run:</span>
                {goal.lastJudgeReason}
              </div>
            )}
          </div>

          {/* Kanban / DAG Columns */}
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--secondary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1 }}>Subgoal DAG Nodes</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {goal.subgoals?.length || 0} nodes defined
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {(Object.keys(columns) as Array<keyof typeof columns>).map(colKey => (
                <div
                  key={colKey}
                  style={{
                    background: 'rgba(7,9,15,0.4)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: 8,
                    padding: 8,
                    minHeight: 280,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <h4 style={{
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: statusColorMap[colKey],
                    borderBottom: `1px solid ${colKey === 'in_progress' ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.05)'}`,
                    paddingBottom: 4,
                    marginBottom: 2,
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}>
                    <span>{statusLabelMap[colKey]}</span>
                    <span>({columns[colKey].length})</span>
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflowY: 'auto' }}>
                    {columns[colKey].length === 0 && (
                      <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.72rem', fontStyle: 'italic' }}>
                        Empty
                      </div>
                    )}
                    {columns[colKey].map(sg => (
                      <div
                        key={sg.id}
                        style={{
                          padding: 8,
                          background: statusBgMap[colKey],
                          border: `1px solid ${colKey === 'in_progress' ? 'rgba(34,211,238,0.3)' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: 6,
                          fontSize: '0.78rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          boxShadow: colKey === 'in_progress' ? '0 0 10px rgba(34,211,238,0.08)' : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', padding: '1px 4px', background: 'rgba(255,255,255,0.06)', borderRadius: 3, color: 'var(--text-muted)' }}>
                            {sg.id}
                          </span>
                          <button
                            onClick={() => {
                              if (confirm(`Remove subgoal ${sg.id}?`)) {
                                runDirectorCommand(`/subgoal remove ${sg.id}`);
                              }
                            }}
                            disabled={actionLoading}
                            style={{
                              background: 'none', border: 'none', padding: 0,
                              color: 'var(--text-dim)', cursor: 'pointer',
                            }}
                            onMouseEnter={(e: any) => e.currentTarget.style.color = 'var(--danger)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.color = 'var(--text-dim)'}
                            title="Remove subgoal"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                        <div style={{ color: 'var(--text-main)', lineHeight: 1.3 }}>{sg.text}</div>
                        {sg.dependencies?.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                            <span style={{ fontSize: '0.62rem', color: 'var(--text-dim)' }}>deps:</span>
                            {sg.dependencies.map(dep => (
                              <span key={dep} style={{ fontSize: '0.62rem', padding: '0 4px', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 3, color: '#c4a8ff' }}>
                                {dep}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Add Subgoal Form */}
          <div className="glass-panel" style={{ padding: 12 }}>
            <h4 style={{ fontSize: '0.78rem', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: 'var(--secondary)', marginBottom: 8 }}>
              Inject Subgoal
            </h4>
            <form onSubmit={handleAddSubgoal} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 2 }}>Subgoal Description</div>
                <input
                  type="text"
                  value={newSubgoalText}
                  onChange={e => setNewSubgoalText(e.target.value)}
                  placeholder="e.g. Generate revision guidelines from style-DNA analysis"
                  required
                  style={{
                    width: '100%', padding: '6px 10px',
                    background: 'rgba(7,9,15,0.6)',
                    border: '1px solid rgba(34,211,238,0.2)',
                    borderRadius: 6,
                    color: 'var(--text-main)',
                    fontSize: '0.8rem',
                  }}
                />
              </div>
              <div style={{ width: 180 }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 2 }}>Dependencies (optional)</div>
                <input
                  type="text"
                  value={subgoalDeps}
                  onChange={e => setSubgoalDeps(e.target.value)}
                  placeholder="e.g. sg-1, sg-2"
                  style={{
                    width: '100%', padding: '6px 10px',
                    background: 'rgba(7,9,15,0.6)',
                    border: '1px solid rgba(34,211,238,0.2)',
                    borderRadius: 6,
                    color: 'var(--text-main)',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={actionLoading || !newSubgoalText.trim()}
                style={{
                  padding: '7px 14px',
                  background: 'rgba(34,211,238,0.15)',
                  border: '1px solid rgba(34,211,238,0.4)',
                  borderRadius: 6,
                  color: 'var(--secondary)',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  cursor: actionLoading ? 'wait' : 'pointer',
                  height: 31,
                  display: 'flex', alignItems: 'center', gap: 4
                }}
              >
                <Plus size={14} /> Add
              </button>
            </form>
          </div>

          {/* Director Terminal Logs */}
          <div className="glass-panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h4 style={{ fontSize: '0.78rem', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 4 }}>
              Director Agent Activity Terminal
            </h4>
            <div style={{
              maxHeight: 160, overflowY: 'auto',
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: 6,
              padding: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              display: 'flex', flexDirection: 'column', gap: 4
            }}>
              {chatLog.length === 0 && (
                <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', textAlign: 'center', padding: 12 }}>
                  No activity logs in this project yet.
                </div>
              )}
              {chatLog.map((msg, i) => (
                <div key={i} style={{
                  borderBottom: i < chatLog.length - 1 ? '1px solid rgba(255,255,255,0.02)' : 'none',
                  paddingBottom: 4, marginBottom: 2
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: msg.role === 'user' ? 'var(--secondary)' : 'var(--accent)', fontWeight: 600 }}>
                    <span>{msg.role === 'user' ? '► OPERATOR' : '◄ DIRECTOR'}</span>
                    {msg.ts && <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>{new Date(msg.ts).toLocaleTimeString()}</span>}
                  </div>
                  <pre style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap', color: 'var(--text-main)', lineHeight: 1.3 }}>{msg.content}</pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
