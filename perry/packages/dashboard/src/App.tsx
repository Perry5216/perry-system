import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Play, Pause, AlertCircle, CheckCircle2, Circle, Loader2, Plus, X, BookOpen, Settings, Trash2, ChevronDown, ChevronRight, RotateCcw, Radio, Eye, EyeOff, ArrowDownToLine, ArrowUpFromLine, FileText, ClipboardCheck, BarChart3, GitBranch, Cpu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Project, ProjectStep } from '@perry/core';

// ── Live Feed Types ────────────────────────────────────────────────────────────
interface FeedEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'progress' | 'started' | 'completed' | 'failed';
  stepId: string;
  projectId: string;
}

/** Max entries kept per step to avoid memory bloat on long-running pipelines */
const MAX_FEED_PER_STEP = 50;
const MAX_GLOBAL_FEED = 100;

// ── Step I/O Types ───────────────────────────────────────────────────────────
interface StepIO {
  stepId: string;
  label: string;
  taskType: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  input: {
    systemPrompt: string;
    userPrompt: string;
    sentAt: string;
  } | null;
  output: string | null;
  error: string | null;
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:4000/api' : '/api';

function EditableMarkdown({ content, stepId, projectId, onSave }: { content: string, stepId: string, projectId: string, onSave: (newContent: string) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(content);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/steps/${stepId}/result`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: editValue })
      });
      if (res.ok) {
        onSave(editValue);
        setIsEditing(false);
      } else {
        alert('Failed to save step result');
      }
    } catch (e) {
      alert('Error saving step result');
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
        <textarea
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          style={{ width: '100%', minHeight: '300px', background: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--panel-border)', padding: '1rem', fontFamily: 'monospace', borderRadius: '4px', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }} onClick={() => setIsEditing(false)} disabled={isSaving}>Cancel</button>
          <button className="btn btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }} onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <button 
        className="btn btn-secondary" 
        style={{ position: 'absolute', top: '-1rem', right: '0', zIndex: 10, padding: '0.1rem 0.5rem', fontSize: '0.7rem', opacity: 0.7 }}
        onClick={() => { setEditValue(content); setIsEditing(true); }}
      >
        Edit Output
      </button>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // UI State
  type TabId = 'pipeline' | 'bible' | 'chapters' | 'revision' | 'stats' | 'gpu' | 'director';
  const [activeTab, setActiveTab] = useState<TabId>('pipeline');

  // GPU Context Watcher State
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
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);
  const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({ writer: [], librarian: [] });
  const [isSwappingModel, setIsSwappingModel] = useState<string | null>(null);
  // Create Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProject, setNewProject] = useState({ 
    title: '', description: '', type: '', parentId: '', preferredProvider: '',
    context: { targetWordsPerChapter: 3000, targetChapters: 25, includePrologue: false, includeEpilogue: false, isSeries: false, seriesTotalBooks: 3, seriesCurrentBook: 1, isInfiniteCalibration: false, penName: '', coverVariants: 1, coverFont: 'Serif (Georgia)', brandColor: '#00d2ff' }
  });
  const [isCreating, setIsCreating] = useState(false);

  // Style DNA Modal State
  const [isStyleModalOpen, setIsStyleModalOpen] = useState(false);
  const [styleDnaContent, setStyleDnaContent] = useState('');
  const [isSavingStyle, setIsSavingStyle] = useState(false);

  // Batch Reroll State
  const [selectedStepIds, setSelectedStepIds] = useState<Set<string>>(new Set());

  // Delete Project State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Sidebar Accordion State
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());

  // ── Live Activity Feed State ──────────────────────────────────────────────
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([]);
  const [latestActivity, setLatestActivity] = useState<FeedEntry | null>(null);
  const feedLogRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /** Auto-scroll feed log to bottom when new entries arrive */
  const scrollFeedToBottom = useCallback((stepId: string) => {
    requestAnimationFrame(() => {
      const el = feedLogRefs.current[stepId];
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  /** Push a new entry into the feed, respecting per-step limits */
  const pushFeedEntry = useCallback((entry: Omit<FeedEntry, 'id' | 'timestamp'>) => {
    const newEntry: FeedEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date(),
    };
    setLatestActivity(newEntry);
    setFeedEntries(prev => {
      const next = [...prev, newEntry];
      // Trim per-step overflow
      const stepEntries = next.filter(e => e.stepId === entry.stepId);
      if (stepEntries.length > MAX_FEED_PER_STEP) {
        const toRemove = stepEntries.slice(0, stepEntries.length - MAX_FEED_PER_STEP).map(e => e.id);
        return next.filter(e => !toRemove.includes(e.id)).slice(-MAX_GLOBAL_FEED);
      }
      return next.slice(-MAX_GLOBAL_FEED);
    });
    scrollFeedToBottom(entry.stepId);
  }, [scrollFeedToBottom]);

  /** Get feed entries for a specific step */
  const getStepFeed = useCallback((stepId: string) => {
    return feedEntries.filter(e => e.stepId === stepId);
  }, [feedEntries]);

  /** Format timestamp for the feed */
  const formatFeedTime = (date: Date) => {
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // ── Step I/O Inspector State ───────────────────────────────────────────────
  const [openIOStepId, setOpenIOStepId] = useState<string | null>(null);
  const [ioData, setIoData] = useState<Record<string, StepIO>>({});
  const [ioLoading, setIoLoading] = useState<Record<string, boolean>>({});
  const [ioActiveTab, setIoActiveTab] = useState<'input' | 'output'>('output');

  // ── Director Chat State ──────────────────────────────────────────────────
  const [chatHistory, setChatHistory] = useState<{role: string, content: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchChatHistory = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/chat`);
      if (res.ok) {
        const data = await res.json();
        setChatHistory(data);
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    } catch (err) {
      console.error('Failed to fetch chat history', err);
    }
  }, []);

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedProject) return;
    
    const userMessage = chatInput.trim();
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    
    setIsChatting(true);
    try {
      const res = await fetch(`${API_BASE}/projects/${selectedProject.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });
      if (res.ok) {
        const data = await res.json();
        setChatHistory(prev => [...prev, { role: 'assistant', content: data.response }]);
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    } catch (err) {
      console.error('Failed to send chat', err);
    } finally {
      setIsChatting(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'director' && selectedProject) {
      fetchChatHistory(selectedProject.id);
    }
  }, [activeTab, selectedProject, fetchChatHistory]);

  /** Fetch the I/O data for a step (system prompt, user prompt, output) */
  const fetchStepIO = useCallback(async (projectId: string, stepId: string) => {
    // Don't re-fetch if we already have it cached
    if (ioData[stepId]) return;
    
    setIoLoading(prev => ({ ...prev, [stepId]: true }));
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/steps/${stepId}/io`);
      if (res.ok) {
        const data: StepIO = await res.json();
        setIoData(prev => ({ ...prev, [stepId]: data }));
      }
    } catch (err) {
      console.error('Failed to fetch step I/O', err);
    } finally {
      setIoLoading(prev => ({ ...prev, [stepId]: false }));
    }
  }, [ioData]);

  /** Toggle the I/O inspector for a step */
  const toggleIO = useCallback((projectId: string, stepId: string) => {
    if (openIOStepId === stepId) {
      setOpenIOStepId(null);
    } else {
      setOpenIOStepId(stepId);
      setIoActiveTab('output');
      fetchStepIO(projectId, stepId);
    }
  }, [openIOStepId, fetchStepIO]);

  // ── Family Resolution: find all related projects for ancestry tabs ──────
  
  /** Find the root ancestor of a project by walking up the parentId chain */
  const findRoot = useCallback((projectId: string, allProjects: Project[]): string => {
    const p = allProjects.find(pr => pr.id === projectId);
    if (!p || !p.parentId) return projectId;
    return findRoot(p.parentId, allProjects);
  }, []);

  /** Resolve the full family tree: all projects sharing the same root */
  const projectFamily = useMemo(() => {
    if (!selectedProject || projects.length === 0) return [];
    const rootId = findRoot(selectedProject.id, projects);
    // Collect ALL projects that share this root (root itself + all descendants)
    return projects.filter(p => p.id === rootId || findRoot(p.id, projects) === rootId);
  }, [selectedProject, projects, findRoot]);

  /** Get completed steps of a specific taskType from across the family */
  const getFamilySteps = useCallback((taskType: string): { project: Project; step: ProjectStep }[] => {
    const results: { project: Project; step: ProjectStep }[] = [];
    for (const p of projectFamily) {
      for (const s of p.steps) {
        if (s.taskType === taskType && s.status === 'completed' && s.result) {
          results.push({ project: p, step: s });
        }
      }
    }
    return results;
  }, [projectFamily]);

  /** Dynamic tab definitions based on what data exists in the family */
  const availableTabs = useMemo((): { id: TabId; label: string; icon: React.ReactNode; count?: number }[] => {
    const tabs: { id: TabId; label: string; icon: React.ReactNode; count?: number }[] = [
      { id: 'pipeline', label: 'Pipeline', icon: <Play size={14} /> },
      { id: 'director', label: 'Director Chat', icon: <Radio size={14} /> },
      { id: 'gpu', label: 'GPU Monitor', icon: <Cpu size={14} /> },
    ];

    // Book Bible — from current project OR ancestors
    const bibleSteps = getFamilySteps('book_bible');
    if (bibleSteps.length > 0) {
      tabs.push({ id: 'bible', label: 'Book Bible', icon: <BookOpen size={14} />, count: bibleSteps.length });
    }

    // Chapters — creative_writing steps from ancestors
    const chapterSteps = getFamilySteps('creative_writing');
    if (chapterSteps.length > 0) {
      tabs.push({ id: 'chapters', label: 'Chapters', icon: <FileText size={14} />, count: chapterSteps.length });
    }

    // Revision Notes — revision_check steps from deep-revision ancestors
    const revisionSteps = getFamilySteps('revision_check');
    if (revisionSteps.length > 0) {
      tabs.push({ id: 'revision', label: 'Revision Notes', icon: <ClipboardCheck size={14} />, count: revisionSteps.length });
    }

    // Stats — stat_update steps from ancestors
    const statSteps = getFamilySteps('stat_update');
    if (statSteps.length > 0) {
      tabs.push({ id: 'stats', label: 'Live Stats', icon: <BarChart3 size={14} />, count: statSteps.length });
    }

    // GPU Monitor moved to second position

    return tabs;
  }, [getFamilySteps]);

  // Automatically fetch I/O data from disk for steps shown in the active tab
  // if they have been offloaded to disk.
  useEffect(() => {
    if (!selectedProject) return;

    const fetchIfOffloaded = (items: { project: Project; step: ProjectStep }[]) => {
      items.forEach(({ project, step }) => {
        if (step.result && step.result.includes('[Content written to disk')) {
          if (!ioData[step.id] && !ioLoading[step.id]) {
            fetchStepIO(project.id, step.id);
          }
        }
      });
    };

    if (activeTab === 'bible') {
      fetchIfOffloaded(getFamilySteps('book_bible'));
    } else if (activeTab === 'chapters') {
      fetchIfOffloaded(getFamilySteps('creative_writing'));
    } else if (activeTab === 'revision') {
      fetchIfOffloaded(getFamilySteps('revision_check'));
    } else if (activeTab === 'stats') {
      fetchIfOffloaded(getFamilySteps('stat_update'));
    }
  }, [activeTab, selectedProject, getFamilySteps, fetchStepIO, ioData, ioLoading]);

  /** Count words for display */
  const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

  const toggleSeries = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSet = new Set(expandedSeries);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedSeries(newSet);
  };

  const handleBatchReroll = async () => {
    if (!selectedProject || selectedStepIds.size === 0) return;
    
    try {
      await fetch(`${API_BASE}/projects/${selectedProject.id}/reset-steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepIds: Array.from(selectedStepIds) }),
      });
      setSelectedStepIds(new Set());
      await fetchData();
      
      // Automatically start the pipeline
      await executeProject(selectedProject.id);
    } catch (err) {
      console.error('Batch reroll failed', err);
    }
  };

  useEffect(() => {
    fetchData();
    // Setup SSE — capture event payloads for the live feed
    const evtSource = new EventSource(`${API_BASE}/events`);

    evtSource.addEventListener('step:started', (e) => {
      try {
        const data = JSON.parse(e.data);
        pushFeedEntry({ type: 'started', stepId: data.stepId, projectId: data.projectId, message: '⚡ Step started' });
      } catch { /* ignore parse errors */ }
      fetchData();
    });

    evtSource.addEventListener('step:progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        pushFeedEntry({ type: 'progress', stepId: data.stepId, projectId: data.projectId, message: data.message || 'Working...' });
      } catch { /* ignore parse errors */ }
      // Light refresh — only update project state, don't reset feed
      fetchData();
    });

    evtSource.addEventListener('step:completed', (e) => {
      try {
        const data = JSON.parse(e.data);
        pushFeedEntry({ type: 'completed', stepId: data.stepId, projectId: data.projectId, message: '✓ Step completed' });
      } catch { /* ignore parse errors */ }
      fetchData();
    });

    evtSource.addEventListener('step:failed', (e) => {
      try {
        const data = JSON.parse(e.data);
        pushFeedEntry({ type: 'failed', stepId: data.stepId, projectId: data.projectId, message: `✗ Failed: ${data.error || 'Unknown error'}` });
      } catch { /* ignore parse errors */ }
      fetchData();
    });

    evtSource.addEventListener('project:paused', () => {
      fetchData();
    });

    // GPU Context Watcher — live stats from the server
    evtSource.addEventListener('context:stats', (e) => {
      try {
        const data = JSON.parse(e.data);
        setContextStats(data);
      } catch { /* ignore parse errors */ }
    });

    // Also fetch initial context stats
    fetch(`${API_BASE}/system/context-stats`)
      .then(r => r.json())
      .then(data => setContextStats(data))
      .catch(() => {});
      
    Promise.all([
      fetch(`${API_BASE}/system/models?role=writer`).then(r => r.json()),
      fetch(`${API_BASE}/system/models?role=librarian`).then(r => r.json())
    ]).then(([writerData, libData]) => {
      setAvailableModels({
        writer: writerData.models || [],
        librarian: libData.models || []
      });
    }).catch(() => {});
    
    return () => evtSource.close();
  }, []);

  const handleSwapModel = async (role: string, model: string) => {
    try {
      setIsSwappingModel(role);
      const res = await fetch(`${API_BASE}/system/models/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, model })
      });
      if (!res.ok) throw new Error(await res.text());
      // Re-fetch system status and context stats
      fetchData();
      fetch(`${API_BASE}/system/context-stats`)
        .then(r => r.json())
        .then(data => setContextStats(data))
        .catch(() => {});
    } catch (e: any) {
      console.error('Failed to swap model', e);
      alert(`Failed to swap model: ${e.message}`);
    } finally {
      setIsSwappingModel(null);
    }
  };

  const fetchData = async () => {
    try {
      const [projRes, sysRes, tempRes] = await Promise.all([
        fetch(`${API_BASE}/projects`),
        fetch(`${API_BASE}/system/status`),
        fetch(`${API_BASE}/system/templates`)
      ]);
      const projData = await projRes.json();
      setProjects(projData);
      setSystemStatus(await sysRes.json());
      
      const templatesData = await tempRes.json();
      setTemplates(templatesData);
      if (templatesData.length > 0 && !newProject.type) {
        setNewProject(prev => ({ ...prev, type: templatesData[0].type }));
      }

      setSelectedProject(currentSelected => {
        if (currentSelected) {
          return projData.find((p: Project) => p.id === currentSelected.id) || currentSelected;
        }
        return currentSelected;
      });
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProject)
      });
      const created = await res.json();
      await fetchData();
      setSelectedProject(created);
      setIsCreateModalOpen(false);
      setNewProject({ 
        title: '', description: '', type: templates[0]?.type || '', parentId: '', preferredProvider: '',
        context: { targetWordsPerChapter: 3000, targetChapters: 25, includePrologue: false, includeEpilogue: false, isSeries: false, seriesTotalBooks: 3, seriesCurrentBook: 1, isInfiniteCalibration: false, penName: '', coverVariants: 1, coverFont: 'Serif (Georgia)', brandColor: '#00d2ff' }
      });
      setActiveTab('pipeline');
    } catch (err) {
      console.error("Failed to create project", err);
    } finally {
      setIsCreating(false);
    }
  };

  const openStyleModal = async () => {
    setIsStyleModalOpen(true);
    try {
      const res = await fetch(`${API_BASE}/system/style-dna`);
      const data = await res.json();
      setStyleDnaContent(data.content || '');
    } catch (err) {
      console.error("Failed to fetch Style DNA", err);
    }
  };

  const handleSaveStyle = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingStyle(true);
    try {
      const isJson = styleDnaContent.trim().startsWith('{');
      await fetch(`${API_BASE}/system/style-dna`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          content: styleDnaContent,
          format: isJson ? 'json' : 'text'
        })
      });
      setIsStyleModalOpen(false);
    } catch (err) {
      console.error("Failed to save Style DNA", err);
      alert("Failed to save Style DNA. Check format.");
    } finally {
      setIsSavingStyle(false);
    }
  };

  const executeProject = async (id: string) => {
    await fetch(`${API_BASE}/projects/${id}/execute`, { method: 'POST' });
    fetchData();
  };

  const pauseProject = async (id: string) => {
    await fetch(`${API_BASE}/projects/${id}/pause`, { method: 'POST' });
    fetchData();
  };

  const deleteProject = async (id: string) => {
    setIsDeleting(true);
    try {
      await fetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
      setSelectedProject(null);
      setIsDeleteModalOpen(false);
      fetchData();
    } catch (err) {
      console.error("Failed to delete project", err);
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--accent)" />
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--panel-border)' }}>
          <h1 style={{ fontSize: '1.25rem', color: 'white', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: systemStatus?.status === 'online' ? 'var(--success)' : 'var(--danger)' }} />
            P.E.R.R.Y. System
          </h1>
          <p className="text-sm text-muted mt-2">Librarian: {systemStatus?.librarianAvailable ? 'Online' : 'Offline'}</p>
        </div>
        
        <div style={{ padding: '1rem', flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Projects</h3>
            <button 
              className="btn btn-outline" 
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              onClick={() => setIsCreateModalOpen(true)}
            >
              <Plus size={14} /> New
            </button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {projects.filter(p => !p.parentId).map(p => (
              <React.Fragment key={p.id}>
                {/* Parent Project */}
                <div 
                  onClick={() => { setSelectedProject(p); setActiveTab('pipeline'); }}
                  style={{
                    padding: '0.75rem',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    background: selectedProject?.id === p.id ? 'var(--accent)' : 'transparent',
                    color: selectedProject?.id === p.id ? 'white' : 'var(--text-main)',
                    transition: 'all 0.2s ease',
                    border: '1px solid',
                    borderColor: selectedProject?.id === p.id ? 'var(--accent)' : 'var(--panel-border)',
                  }}
                >
                  <div style={{ fontWeight: 500, fontSize: '0.875rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                    {projects.some(c => c.parentId === p.id) && (
                      <span 
                        onClick={(e) => toggleSeries(p.id, e)}
                        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', marginTop: '2px' }}
                      >
                        {expandedSeries.has(p.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                    )}
                    {p.title}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', marginLeft: projects.some(c => c.parentId === p.id) ? '1.25rem' : '0' }}>
                    <span style={{ opacity: 0.8 }}>{p.type}</span>
                    <span style={{ opacity: 0.8 }}>{p.progress}%</span>
                  </div>
                  <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '0.5rem', overflow: 'hidden', marginLeft: projects.some(c => c.parentId === p.id) ? '1.25rem' : '0' }}>
                    <div style={{ height: '100%', background: selectedProject?.id === p.id ? 'white' : 'var(--accent)', width: `${p.progress}%` }} />
                  </div>
                  
                  {/* Quick Access Book Bible Link */}
                  {p.steps.some(s => s.taskType === 'book_bible' && s.status === 'completed') && (
                    <div 
                      onClick={(e) => { e.stopPropagation(); setSelectedProject(p); setActiveTab('bible'); }}
                      style={{ marginTop: '0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', color: selectedProject?.id === p.id && activeTab === 'bible' ? 'white' : 'var(--text-muted)', fontWeight: activeTab === 'bible' && selectedProject?.id === p.id ? 600 : 400, marginLeft: projects.some(c => c.parentId === p.id) ? '1.25rem' : '0' }}
                    >
                      <BookOpen size={12} /> View Book Bible
                    </div>
                  )}
                </div>

                {/* Child Projects (Series Books) */}
                {(expandedSeries.has(p.id) || selectedProject?.parentId === p.id || selectedProject?.id === p.id) && projects.filter(child => child.parentId === p.id).map(child => (
                  <div 
                    key={child.id}
                    onClick={() => { setSelectedProject(child); setActiveTab('pipeline'); }}
                    style={{
                      marginLeft: '1rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: selectedProject?.id === child.id ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                      color: selectedProject?.id === child.id ? 'white' : 'var(--text-muted)',
                      borderLeft: '2px solid',
                      borderColor: selectedProject?.id === child.id ? 'var(--accent)' : 'var(--panel-border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem'
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <span style={{ opacity: 0.5 }}>↳</span> {child.title}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', paddingLeft: '1rem' }}>
                      <span>{child.type}</span>
                      <span>{child.progress}%</span>
                    </div>
                  </div>
                ))}
              </React.Fragment>
            ))}
            {projects.length === 0 && (
              <div className="text-center text-muted text-sm mt-4">
                No projects yet.<br/>Click "New" to start one.
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Footer */}
        <div style={{ padding: '1rem', borderTop: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'center' }}>
          <button 
            onClick={openStyleModal}
            className="btn btn-outline"
            style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}
            title="Edit Style DNA Constraints"
          >
            <Settings size={16} /> Edit Style DNA
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {!selectedProject ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <h2 style={{ marginBottom: '1rem' }}>Welcome to the P.E.R.R.Y. System</h2>
            <p>Select a project from the sidebar or create a new one to begin.</p>
          </div>
        ) : (
          <div className="animate-fade-in">
            <header className="glass-panel" style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                  <h2 style={{ fontSize: '1.75rem' }}>{selectedProject.title}</h2>
                  <span className={`status-badge status-${selectedProject.status}`}>
                    {selectedProject.status}
                  </span>
                </div>
                <p className="text-muted">{selectedProject.description}</p>
              </div>
              
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {selectedStepIds.size > 0 && (
                  <button 
                    className="btn btn-primary" 
                    onClick={handleBatchReroll}
                    style={{ background: 'var(--warning)', color: '#000', borderColor: 'var(--warning)' }}
                  >
                    <RotateCcw size={16} /> Batch Reroll ({selectedStepIds.size})
                  </button>
                )}
                <button 
                  className="btn btn-outline" 
                  onClick={() => setIsDeleteModalOpen(true)} 
                  style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                  title="Delete Project"
                >
                  <Trash2 size={16} /> Delete
                </button>
                {selectedProject.status !== 'active' && selectedProject.status !== 'completed' && (
                  <button className="btn btn-primary" onClick={() => executeProject(selectedProject.id)}>
                    <Play size={16} /> Run Pipeline
                  </button>
                )}
                {selectedProject.status === 'active' && (
                  <button className="btn btn-outline" onClick={() => pauseProject(selectedProject.id)} style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
                    <Pause size={16} /> Pause Pipeline
                  </button>
                )}
              </div>
            </header>

            <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--panel-border)', marginBottom: '1.5rem', paddingBottom: '0.5rem', overflowX: 'auto' }}>
              {availableTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: activeTab === tab.id ? 'white' : 'var(--text-muted)',
                    fontWeight: activeTab === tab.id ? 600 : 400,
                    borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                    paddingBottom: '0.5rem', marginBottom: '-0.5rem',
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    fontSize: '0.875rem', whiteSpace: 'nowrap', padding: '0.25rem 0.75rem',
                  }}
                >
                  {tab.icon} {tab.label}
                  {tab.count !== undefined && (
                    <span style={{
                      fontSize: '0.65rem', background: activeTab === tab.id ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
                      padding: '1px 6px', borderRadius: '8px', marginLeft: '0.15rem',
                    }}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
              {projectFamily.length > 1 && (
                <span style={{ 
                  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.25rem',
                  fontSize: '0.7rem', color: 'var(--text-muted)', opacity: 0.6 
                }}>
                  <GitBranch size={12} /> {projectFamily.length} linked projects
                </span>
              )}
            </div>

            {/* Global Activity Banner — shows latest event across all steps */}
            {latestActivity && selectedProject.status === 'active' && (
              <div className="global-activity-bar animate-fade-in">
                <div className="live-pulse" />
                <span className="activity-label"><Radio size={14} /> LIVE</span>
                <span className="activity-message">{latestActivity.message}</span>
                <span className="activity-time">{formatFeedTime(latestActivity.timestamp)}</span>
              </div>
            )}

            {activeTab === 'director' && (() => {
              const isSystemBusy = projects.some(p => p.status === 'active');
              
              return (
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '600px' }}>
                <div className="mb-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                    <Radio size={18} color="var(--accent)" /> Chat with Director
                  </h3>
                  {chatHistory.length > 0 && (
                    <button
                      className="btn btn-outline"
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                      onClick={async () => {
                        if (!confirm('Are you sure you want to clear the chat history?')) return;
                        try {
                          await fetch(`${API_BASE}/projects/${selectedProject.id}/chat`, { method: 'DELETE' });
                          setChatHistory([]);
                        } catch (e) {
                          console.error(e);
                        }
                      }}
                      title="Clear Chat History"
                    >
                      <Trash2 size={14} /> Clear Chat
                    </button>
                  )}
                </div>

                {/* Director Agent Configuration */}
                <div style={{
                  marginBottom: '1rem',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '8px',
                  padding: '1rem 1.25rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <Radio size={16} color="var(--accent)" />
                      <span style={{ fontWeight: 600, fontSize: '1rem' }}>Director Agent</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      This model is used exclusively for the Director Chat interface.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Runs on:</div>
                    <select
                      value={systemStatus?.directorProvider || 'ollama'}
                      onChange={async (e) => {
                        try {
                          await fetch(`${API_BASE}/system/director-provider`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ provider: e.target.value })
                          });
                          fetchData();
                        } catch (err) {
                           console.error(err);
                        }
                      }}
                      style={{ 
                        background: 'rgba(255,255,255,0.05)', 
                        color: 'var(--text-main)', 
                        padding: '4px 8px', 
                        borderRadius: '4px', 
                        fontSize: '0.75rem',
                        border: '1px solid var(--panel-border)',
                        outline: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="ollama">Writer (5090)</option>
                      <option value="librarian">Librarian (5070 Ti)</option>
                    </select>
                    <select
                      value={systemStatus?.directorModel || 'qwen3.6:27b'}
                      onChange={(e) => handleSwapModel('director', e.target.value)}
                      disabled={isSwappingModel === 'director'}
                      style={{ 
                        background: 'rgba(99,102,241,0.15)', 
                        color: 'var(--accent)', 
                        padding: '4px 8px', 
                        borderRadius: '4px', 
                        fontSize: '0.75rem',
                        border: 'none',
                        outline: 'none',
                        cursor: 'pointer',
                        minWidth: '180px'
                      }}
                    >
                      <option value="" disabled>Select model</option>
                      {!(availableModels[systemStatus?.directorProvider === 'librarian' ? 'librarian' : 'writer'] || []).includes(systemStatus?.directorModel || 'qwen3.6:27b') && systemStatus?.directorModel && (
                        <option value={systemStatus.directorModel}>{systemStatus.directorModel}</option>
                      )}
                      {(availableModels[systemStatus?.directorProvider === 'librarian' ? 'librarian' : 'writer'] || []).map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    {isSwappingModel === 'director' && (
                      <Loader2 size={12} className="animate-spin" />
                    )}
                  </div>
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem', paddingRight: '0.5rem' }}>
                  {chatHistory.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                      Start the conversation...
                    </div>
                  ) : (
                    chatHistory.map((msg, i) => (
                      <div key={i} style={{
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '80%',
                        background: msg.role === 'user' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid',
                        borderColor: msg.role === 'user' ? 'rgba(99, 102, 241, 0.5)' : 'var(--panel-border)',
                        padding: '1rem',
                        borderRadius: '12px',
                        borderBottomRightRadius: msg.role === 'user' ? 0 : '12px',
                        borderBottomLeftRadius: msg.role === 'assistant' ? 0 : '12px',
                      }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase' }}>
                          {msg.role === 'user' ? 'You' : 'Director'}
                        </div>
                        <div style={{ fontSize: '0.9rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      </div>
                    ))
                  )}
                  {isChatting && (
                    <div style={{
                      alignSelf: 'flex-start',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--panel-border)',
                      padding: '0.5rem 1rem',
                      borderRadius: '12px',
                      borderBottomLeftRadius: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      height: '42px'
                    }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginRight: '0.25rem' }}>P.E.R.R.Y Agent is thinking</span>
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <form onSubmit={sendChatMessage} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={isSystemBusy ? "P.E.R.R.Y is busy executing a pipeline..." : "Ask the Director about this project..."}
                    style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white', fontSize: '0.9rem', opacity: isSystemBusy ? 0.5 : 1 }}
                    disabled={isChatting || isSystemBusy}
                  />
                  <button type="submit" className="btn btn-primary" disabled={isChatting || isSystemBusy || !chatInput.trim()}>
                    Send
                  </button>
                </form>
              </div>
              );
            })()}

            {activeTab === 'pipeline' && (
              <div className="glass-panel">
                <h3 className="mb-4">Pipeline Execution</h3>
                
                <div style={{ position: 'relative', paddingLeft: '1rem' }}>
                  {/* Vertical timeline line */}
                  <div style={{ position: 'absolute', left: '1.35rem', top: '1rem', bottom: '1rem', width: '2px', background: 'var(--panel-border)', zIndex: 0 }} />

                  {selectedProject.steps.map((step: ProjectStep, index: number) => {
                    const stepFeed = getStepFeed(step.id);
                    const lastProgressMsg = stepFeed.filter(e => e.type === 'progress').slice(-1)[0];

                    return (
                    <div key={step.id} style={{ display: 'flex', position: 'relative', zIndex: 1, marginBottom: index === selectedProject.steps.length - 1 ? 0 : '1.5rem', opacity: step.status === 'pending' ? 0.6 : 1 }}>
                      <div style={{ marginTop: '0.25rem', marginRight: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                        {(step.status === 'completed' || step.status === 'failed') && (
                          <input 
                            type="checkbox" 
                            checked={selectedStepIds.has(step.id)}
                            onChange={(e) => {
                              const newSet = new Set(selectedStepIds);
                              if (e.target.checked) newSet.add(step.id);
                              else newSet.delete(step.id);
                              setSelectedStepIds(newSet);
                            }}
                            style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                          />
                        )}
                        {step.status === 'completed' && <CheckCircle2 size={20} color="var(--success)" fill="var(--panel-bg)" />}
                        {step.status === 'active' && <Loader2 size={20} color="var(--accent)" className="animate-spin" style={{ background: 'var(--panel-bg)', borderRadius: '50%' }} />}
                        {step.status === 'failed' && <AlertCircle size={20} color="var(--danger)" fill="var(--panel-bg)" />}
                        {step.status === 'pending' && <Circle size={20} color="var(--text-muted)" fill="var(--panel-bg)" />}
                      </div>
                      
                      <div style={{ flex: 1, background: 'var(--panel-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid', borderColor: step.status === 'active' ? 'var(--accent)' : 'var(--panel-border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                          <h4 style={{ fontSize: '1rem', color: step.status === 'active' ? 'var(--accent)' : 'var(--text-main)' }}>
                            {step.label}
                          </h4>
                          <span className="text-xs text-muted" style={{ textTransform: 'uppercase' }}>{step.phase}</span>
                        </div>
                        <p className="text-sm text-muted mb-2">Task: {step.taskType}</p>
                        
                        {/* ── Active Step: Live Progress ─────────────────────── */}
                        {step.status === 'active' && (
                          <>
                            {/* Current status line */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent)', fontSize: '0.875rem' }}>
                              <div className="live-pulse" />
                              {lastProgressMsg ? lastProgressMsg.message : 'Starting...'}
                            </div>

                            {/* Shimmer progress bar */}
                            <div className="step-progress-bar">
                              <div className="step-progress-bar-inner" style={{ width: '100%' }} />
                            </div>

                            {/* Scrollable activity log for this step */}
                            {stepFeed.length > 0 && (
                              <div className="live-feed">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.5rem' }}>
                                  <Radio size={12} color="var(--accent)" />
                                  <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 600 }}>
                                    Activity Log ({stepFeed.length})
                                  </span>
                                </div>
                                <div 
                                  className="live-feed-log" 
                                  ref={(el) => { feedLogRefs.current[step.id] = el; }}
                                >
                                  {stepFeed.map(entry => (
                                    <div 
                                      key={entry.id} 
                                      className={`live-feed-entry ${entry.type === 'failed' ? 'feed-error' : ''} ${entry.type === 'completed' ? 'feed-complete' : ''}`}
                                    >
                                      <span className="feed-time">{formatFeedTime(entry.timestamp)}</span>
                                      <span className="feed-msg">{entry.message}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {/* ── Completed/Failed: Show summary from feed ─────── */}
                        {step.status === 'completed' && stepFeed.length > 0 && (
                          <details style={{ marginTop: '0.5rem' }}>
                            <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)', userSelect: 'none' }}>
                              View activity log ({stepFeed.length} events)
                            </summary>
                            <div className="live-feed-log" style={{ marginTop: '0.5rem', maxHeight: '100px' }}>
                              {stepFeed.map(entry => (
                                <div key={entry.id} className={`live-feed-entry ${entry.type === 'completed' ? 'feed-complete' : ''}`}>
                                  <span className="feed-time">{formatFeedTime(entry.timestamp)}</span>
                                  <span className="feed-msg">{entry.message}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        
                        {step.error && (
                          <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: '4px', fontSize: '0.875rem' }}>
                            {step.error}
                          </div>
                        )}

                        {(step.status === 'completed' || step.status === 'failed') && (
                          <>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const actionName = step.status === 'failed' ? 'Retry' : 'Re-roll';
                              if (!confirm(`${actionName} "${step.label}"? This will reset it to pending.`)) return;
                              await fetch(`${API_BASE}/projects/${selectedProject.id}/reset-step/${step.id}`, { method: 'POST' });
                              await fetchData();
                            }}
                            style={{ marginTop: '0.5rem', background: 'none', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                            title={step.status === 'failed' ? "Reset this failed step to pending" : "Reset this step and re-generate"}
                          >
                            <RotateCcw size={12} /> {step.status === 'failed' ? 'Retry Step' : 'Re-Roll'}
                          </button>

                          {/* I/O Inspector Toggle */}
                          <button
                            className="io-toggle-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleIO(selectedProject.id, step.id);
                            }}
                          >
                            {openIOStepId === step.id ? <EyeOff size={12} /> : <Eye size={12} />}
                            {openIOStepId === step.id ? 'Hide I/O' : 'Inspect I/O'}
                          </button>
                          </>
                        )}

                        {/* ── I/O Inspector Panel ──────────────────────── */}
                        {openIOStepId === step.id && (
                          <div className="io-inspector">
                            <div className="io-tabs">
                              <button
                                className={`io-tab ${ioActiveTab === 'input' ? 'active' : ''}`}
                                onClick={() => setIoActiveTab('input')}
                              >
                                <ArrowDownToLine size={12} /> Input
                                {ioData[step.id]?.input && <span className="io-badge">2</span>}
                              </button>
                              <button
                                className={`io-tab ${ioActiveTab === 'output' ? 'active' : ''}`}
                                onClick={() => setIoActiveTab('output')}
                              >
                                <ArrowUpFromLine size={12} /> Output
                                {ioData[step.id]?.output && <span className="io-badge">1</span>}
                              </button>
                            </div>

                            {ioLoading[step.id] ? (
                              <>
                                <div className="io-loading" />
                                <div className="io-loading" style={{ height: '40px' }} />
                              </>
                            ) : ioData[step.id] ? (
                              <div className="io-content">
                                {ioActiveTab === 'input' && (
                                  ioData[step.id].input ? (
                                    <>
                                      <div className="io-section">
                                        <div className="io-section-header">
                                          <span className="io-dot input" />
                                          System Prompt
                                        </div>
                                        <div className="io-code-block">
                                          {ioData[step.id].input!.systemPrompt}
                                        </div>
                                      </div>
                                      <div className="io-section">
                                        <div className="io-section-header">
                                          <span className="io-dot input" />
                                          User Message
                                        </div>
                                        <div className="io-code-block">
                                          {ioData[step.id].input!.userPrompt}
                                        </div>
                                      </div>
                                      <div className="io-meta">
                                        <span>Sent: {new Date(ioData[step.id].input!.sentAt).toLocaleString()}</span>
                                        <span>System: {countWords(ioData[step.id].input!.systemPrompt).toLocaleString()} words</span>
                                        <span>User: {countWords(ioData[step.id].input!.userPrompt).toLocaleString()} words</span>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="io-empty">
                                      No input telemetry recorded for this step.
                                      <br />
                                      <span style={{ fontSize: '0.75rem' }}>Mechanical tasks (compile, export) don't make LLM calls.</span>
                                    </div>
                                  )
                                )}
                                {ioActiveTab === 'output' && (
                                  ioData[step.id].output ? (
                                    <>
                                      <div className="io-section">
                                        <div className="io-section-header">
                                          <span className="io-dot output" />
                                          AI Response
                                        </div>
                                        <div className="io-code-block">
                                          {ioData[step.id].output}
                                        </div>
                                      </div>
                                      <div className="io-meta">
                                        {ioData[step.id].completedAt && (
                                          <span>Completed: {new Date(ioData[step.id].completedAt!).toLocaleString()}</span>
                                        )}
                                        <span>Output: {countWords(ioData[step.id].output!).toLocaleString()} words</span>
                                        <span>Characters: {ioData[step.id].output!.length.toLocaleString()}</span>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="io-empty">
                                      {step.status === 'active' ? 'Waiting for AI response...' : 'No output generated for this step.'}
                                    </div>
                                  )
                                )}
                              </div>
                            ) : (
                              <div className="io-empty">Failed to load I/O data.</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'bible' && (() => {
              // Collect bible steps from family (which now includes current project)
              const allBible = getFamilySteps('book_bible');
              
              return (
                <div className="glass-panel" style={{ background: 'var(--panel-bg)' }}>
                  <h3 className="mb-4">Project Book Bible</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {allBible.length === 0 ? (
                      <div className="text-muted text-center" style={{ padding: '2rem' }}>
                        No Book Bible content generated yet. Run the Pipeline to create it.
                      </div>
                    ) : (
                      allBible.map(({ project: srcProject, step }) => {
                        const content = ioData[step.id]?.output || step.result || '';
                        const isLoading = ioLoading[step.id];
                        return (
                          <details key={`${srcProject.id}-${step.id}`} open style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--panel-border)', marginBottom: '1rem' }}>
                            <summary style={{ cursor: 'pointer', padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none', fontSize: '1rem', fontWeight: 600, color: 'var(--accent)', borderBottom: '1px solid var(--panel-border)' }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {step.label}
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', opacity: 0.8 }}>(click to toggle)</span>
                              </span>
                              {srcProject.id !== selectedProject?.id && (
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <GitBranch size={10} /> {srcProject.title.slice(0, 40)}
                                </span>
                              )}
                            </summary>
                            <div style={{ padding: '1rem' }}>
                              <div className="markdown-body" style={{ color: 'var(--text-main)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                                {isLoading ? <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}><Loader2 size={14} className="animate-spin" /> Loading from disk...</span> : <EditableMarkdown content={content} stepId={step.id} projectId={srcProject.id} onSave={(newContent) => { setIoData(prev => ({...prev, [step.id]: { ...prev[step.id], output: newContent }})); }} />}
                              </div>
                            </div>
                          </details>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })()}

            {activeTab === 'chapters' && (() => {
              // Hide calibration scenes from the main manuscript chapters view
              const chapterSteps = getFamilySteps('creative_writing')
                .filter(item => item.project.type !== 'style-calibration');
                
              // Group by chapter number
              const grouped = new Map<number, { project: Project; step: ProjectStep }[]>();
              for (const item of chapterSteps) {
                const ch = item.step.chapterNumber ?? -1;
                if (!grouped.has(ch)) grouped.set(ch, []);
                grouped.get(ch)!.push(item);
              }
              const sortedChapters = [...grouped.entries()].sort((a, b) => a[0] - b[0]);

              return (
                <div className="glass-panel" style={{ background: 'var(--panel-bg)' }}>
                  {/* Manuscript Summary Bar */}
                  {(() => {
                    const totalWords = sortedChapters.reduce((sum, [, items]) => {
                      const text = items.map(i => ioData[i.step.id]?.output || i.step.result || '').join(' ');
                      return sum + text.trim().split(/\s+/).filter(Boolean).length;
                    }, 0);
                    const chapterCount = sortedChapters.length;
                    const avgPerChapter = chapterCount > 0 ? Math.round(totalWords / chapterCount) : 0;
                    const targetPerChapter = selectedProject?.context?.targetWordsPerChapter || 3000;
                    const targetChapters = selectedProject?.context?.targetChapters || 25;
                    const manuscriptTarget = targetPerChapter * targetChapters;
                    const progressPercent = Math.min(100, Math.round((totalWords / manuscriptTarget) * 100));

                    return (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
                          <h3 style={{ margin: 0 }}>Chapters from Production Pipeline</h3>
                          <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                                {totalWords.toLocaleString()}
                              </div>
                              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Words</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                                {chapterCount}
                              </div>
                              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Chapters</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: avgPerChapter >= targetPerChapter * 0.8 ? '#22c55e' : '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>
                                {avgPerChapter.toLocaleString()}
                              </div>
                              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg/Chapter</div>
                            </div>
                          </div>
                        </div>
                        {/* Progress bar towards manuscript target */}
                        <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%',
                            width: `${progressPercent}%`,
                            background: progressPercent >= 100 ? '#22c55e' : 'var(--accent)',
                            borderRadius: '3px',
                            transition: 'width 0.5s ease',
                          }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          <span>{progressPercent}% of target</span>
                          <span>Target: {manuscriptTarget.toLocaleString()} words ({targetChapters} ch × {targetPerChapter.toLocaleString()} w/ch)</span>
                        </div>
                      </div>
                    );
                  })()}

                  {chapterSteps.length === 0 ? (
                    <div className="text-muted text-center" style={{ padding: '2rem' }}>
                      No chapters generated yet in any related project.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {sortedChapters.map(([chNum, items]) => {
                        const chName = chNum === 0 ? 'Prologue' : chNum === -1 ? 'Unknown' : `Chapter ${chNum}`;
                        // Combine all segment results for this chapter
                        const fullText = items.map(i => ioData[i.step.id]?.output || i.step.result || '').join('\n\n');
                        const anyLoading = items.some(i => ioLoading[i.step.id]);
                        const wordCount = fullText.trim().split(/\s+/).filter(Boolean).length;
                        const srcProject = items[0].project;
                        return (
                          <details key={chNum} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                            <summary style={{ 
                              cursor: 'pointer', padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              userSelect: 'none', fontSize: '0.95rem', fontWeight: 500
                            }}>
                              <span>{chName} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>({items.length} segment{items.length > 1 ? 's' : ''})</span></span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <span style={{
                                  fontSize: '0.75rem',
                                  color: wordCount >= (selectedProject?.context?.targetWordsPerChapter || 3000) * 0.8 ? '#22c55e' : wordCount >= (selectedProject?.context?.targetWordsPerChapter || 3000) * 0.5 ? '#f59e0b' : '#ef4444',
                                  fontVariantNumeric: 'tabular-nums',
                                }}>{wordCount.toLocaleString()} words</span>
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                  <GitBranch size={10} /> {srcProject.title.slice(0, 30)}
                                </span>
                              </span>
                            </summary>
                            <div style={{ padding: '1rem', borderTop: '1px solid var(--panel-border)', maxHeight: '60vh', overflowY: 'auto' }}>
                              <div className="markdown-body" style={{ color: 'var(--text-main)', fontSize: '0.9rem', lineHeight: 1.7 }}>
                                {anyLoading ? <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}><Loader2 size={14} className="animate-spin" /> Loading parts from disk...</span> : items.map((item, idx) => (
                                  <div key={item.step.id} style={{ marginBottom: idx < items.length - 1 ? '2rem' : 0 }}>
                                    {items.length > 1 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.25rem' }}>Segment {idx + 1} ({item.step.label})</div>}
                                    <EditableMarkdown content={ioData[item.step.id]?.output || item.step.result || ''} stepId={item.step.id} projectId={item.project.id} onSave={(newContent) => { setIoData(prev => ({...prev, [item.step.id]: { ...prev[item.step.id], output: newContent }})); }} />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {activeTab === 'revision' && (() => {
              const revisionSteps = getFamilySteps('revision_check');
              // Group by chapter number
              const grouped = new Map<number, { project: Project; step: ProjectStep }[]>();
              for (const item of revisionSteps) {
                const ch = item.step.chapterNumber ?? -1;
                if (!grouped.has(ch)) grouped.set(ch, []);
                grouped.get(ch)!.push(item);
              }
              const sortedChapters = [...grouped.entries()].sort((a, b) => a[0] - b[0]);

              return (
                <div className="glass-panel" style={{ background: 'var(--panel-bg)' }}>
                  <h3 className="mb-4">Revision Audit Notes</h3>
                  {revisionSteps.length === 0 ? (
                    <div className="text-muted text-center" style={{ padding: '2rem' }}>
                      No revision audit data found in any related project.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {sortedChapters.map(([chNum, items]) => {
                        const srcProject = items[0].project;
                        const chName = chNum === 0 ? 'Prologue' : chNum === -1 ? 'Manuscript-Wide' : chNum > (srcProject.context.targetChapters || 25) ? 'Epilogue' : `Chapter ${chNum}`;
                        return (
                          <details key={chNum} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                            <summary style={{ 
                              cursor: 'pointer', padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              userSelect: 'none', fontSize: '0.95rem', fontWeight: 500
                            }}>
                              <span>{chName} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>({items.length} audit pass{items.length > 1 ? 'es' : ''})</span></span>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                <GitBranch size={10} /> {srcProject.title.slice(0, 30)}
                              </span>
                            </summary>
                            <div style={{ padding: '1rem', borderTop: '1px solid var(--panel-border)', maxHeight: '60vh', overflowY: 'auto' }}>
                              {items.map(({ step }) => {
                                const content = ioData[step.id]?.output || step.result || '';
                                const isLoading = ioLoading[step.id];
                                return (
                                  <div key={step.id} style={{ marginBottom: '1.5rem' }}>
                                    <h5 style={{ color: 'var(--accent)', fontSize: '0.85rem', marginBottom: '0.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.25rem' }}>
                                      {step.label}
                                    </h5>
                                    <div className="markdown-body" style={{ color: 'var(--text-main)', fontSize: '0.85rem', lineHeight: 1.6 }}>
                                      {isLoading ? <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}><Loader2 size={12} className="animate-spin" /> Loading...</span> : <ReactMarkdown>{content}</ReactMarkdown>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {activeTab === 'stats' && (() => {
              const statSteps = getFamilySteps('stat_update');
              // Sort by chapter number
              const sorted = [...statSteps].sort((a, b) => (a.step.chapterNumber ?? 0) - (b.step.chapterNumber ?? 0));
              
              return (
                <div className="glass-panel" style={{ background: 'var(--panel-bg)' }}>
                  <h3 className="mb-4">Live Character Stats</h3>
                  {statSteps.length === 0 ? (
                    <div className="text-muted text-center" style={{ padding: '2rem' }}>
                      No stat updates found in any related project.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {sorted.map(({ project: srcProject, step }) => {
                        const chNum = step.chapterNumber ?? 0;
                        const chName = chNum === 0 ? 'Prologue' : `Chapter ${chNum}`;
                        const content = ioData[step.id]?.output || step.result || '';
                        const isLoading = ioLoading[step.id];
                        return (
                          <details key={`${srcProject.id}-${step.id}`} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                            <summary style={{ 
                              cursor: 'pointer', padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              userSelect: 'none', fontSize: '0.95rem', fontWeight: 500
                            }}>
                              <span>{chName} — Stat Update</span>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                <GitBranch size={10} /> {srcProject.title.slice(0, 30)}
                              </span>
                            </summary>
                            <div style={{ padding: '1rem', borderTop: '1px solid var(--panel-border)' }}>
                              <div className="markdown-body" style={{ color: 'var(--text-main)', fontSize: '0.85rem', lineHeight: 1.6 }}>
                                {isLoading ? <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}><Loader2 size={12} className="animate-spin" /> Loading...</span> : <ReactMarkdown>{content}</ReactMarkdown>}
                              </div>
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {activeTab === 'gpu' && (
              <div className="glass-panel" style={{ background: 'var(--panel-bg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <h3 style={{ margin: 0 }}>GPU Context Monitor</h3>
                  {contextStats && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.25rem 0.75rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                      background: contextStats.globalRisk === 'high' ? 'rgba(239,68,68,0.15)' : contextStats.globalRisk === 'moderate' ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
                      color: contextStats.globalRisk === 'high' ? '#ef4444' : contextStats.globalRisk === 'moderate' ? '#f59e0b' : '#22c55e',
                      border: '1px solid',
                      borderColor: contextStats.globalRisk === 'high' ? 'rgba(239,68,68,0.3)' : contextStats.globalRisk === 'moderate' ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)',
                    }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', animation: contextStats.globalRisk !== 'low' ? 'pulse 2s infinite' : 'none' }} />
                      {contextStats.globalRisk === 'high' ? '⚠ High Risk' : contextStats.globalRisk === 'moderate' ? '⚡ Moderate' : '✓ Healthy'}
                    </div>
                  )}
                </div>

                {!contextStats ? (
                  <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Loader2 size={24} className="animate-spin" style={{ marginBottom: '0.5rem' }} />
                    <p>Connecting to GPU monitors...</p>
                  </div>
                ) : (
                  <>
                    {/* GPU Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
                      {contextStats.gpus.map(gpu => {
                        const ringColor = gpu.status === 'critical' ? '#ef4444'
                          : gpu.status === 'red' ? '#f97316'
                          : gpu.status === 'yellow' ? '#f59e0b'
                          : gpu.status === 'green' ? '#22c55e'
                          : '#6b7280';
                        const ringBg = 'rgba(255,255,255,0.06)';
                        const circumference = 2 * Math.PI * 54;
                        const offset = circumference - (gpu.percentFull / 100) * circumference;

                        return (
                          <div key={gpu.label} style={{
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid',
                            borderColor: gpu.hallucinationRisk ? 'rgba(239,68,68,0.4)' : 'var(--panel-border)',
                            borderRadius: '12px',
                            padding: '1.5rem',
                            position: 'relative',
                            overflow: 'hidden',
                          }}>
                            {/* Hallucination risk glow */}
                            {gpu.hallucinationRisk && (
                              <div style={{
                                position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
                                background: 'linear-gradient(90deg, transparent, #ef4444, transparent)',
                                animation: 'shimmer 2s infinite',
                              }} />
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                              {/* Radial Gauge */}
                              <div style={{ position: 'relative', width: '120px', height: '120px', flexShrink: 0 }}>
                                <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
                                  <circle cx="60" cy="60" r="54" fill="none" stroke={ringBg} strokeWidth="8" />
                                  <circle
                                    cx="60" cy="60" r="54" fill="none"
                                    stroke={ringColor}
                                    strokeWidth="8"
                                    strokeLinecap="round"
                                    strokeDasharray={`${circumference}`}
                                    strokeDashoffset={`${offset}`}
                                    style={{ transition: 'stroke-dashoffset 1s ease, stroke 0.5s ease' }}
                                  />
                                </svg>
                                <div style={{
                                  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                                  textAlign: 'center',
                                }}>
                                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: ringColor, lineHeight: 1 }}>
                                    {gpu.percentFull}%
                                  </div>
                                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {gpu.status === 'idle' ? 'IDLE' : 'CONTEXT'}
                                  </div>
                                </div>
                              </div>

                              {/* Info */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                  <Cpu size={16} color={ringColor} />
                                  <span style={{ fontWeight: 600, fontSize: '1rem' }}>{gpu.label}</span>
                                </div>

                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                  <select
                                    value={gpu.model || ''}
                                    onChange={(e) => handleSwapModel(gpu.label.toLowerCase().includes('writer') ? 'writer' : 'librarian', e.target.value)}
                                    disabled={isSwappingModel === (gpu.label.toLowerCase().includes('writer') ? 'writer' : 'librarian')}
                                    style={{ 
                                      background: 'rgba(99,102,241,0.15)', 
                                      color: 'var(--accent)', 
                                      padding: '2px 8px', 
                                      borderRadius: '4px', 
                                      fontSize: '0.7rem',
                                      border: 'none',
                                      outline: 'none',
                                      cursor: 'pointer',
                                      width: '100%',
                                      maxWidth: '180px'
                                    }}
                                  >
                                    <option value="" disabled>No model loaded</option>
                                    {!(availableModels[gpu.label.toLowerCase().includes('writer') ? 'writer' : 'librarian'] || []).includes(gpu.model || '') && gpu.model && (
                                      <option value={gpu.model}>{gpu.model}</option>
                                    )}
                                    {(availableModels[gpu.label.toLowerCase().includes('writer') ? 'writer' : 'librarian'] || []).map(m => (
                                      <option key={m} value={m}>{m}</option>
                                    ))}
                                  </select>
                                  {isSwappingModel === (gpu.label.toLowerCase().includes('writer') ? 'writer' : 'librarian') && (
                                    <Loader2 size={12} className="animate-spin" style={{ marginLeft: '0.5rem', display: 'inline' }} />
                                  )}
                                </div>

                                {/* Stats Grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.75rem' }}>
                                  <div>
                                    <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>Used</div>
                                    <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                      {(gpu.contextUsed / 1024).toFixed(1)}K tokens
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>Limit</div>
                                    <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                      {(gpu.contextLimit / 1024).toFixed(0)}K tokens
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>Headroom</div>
                                    <div style={{ fontWeight: 600, color: gpu.headroom < 4096 ? '#ef4444' : 'var(--text-main)', fontVariantNumeric: 'tabular-nums' }}>
                                      {(gpu.headroom / 1024).toFixed(1)}K tokens
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>Risk</div>
                                    <div style={{ fontWeight: 600, color: gpu.hallucinationRisk ? '#ef4444' : '#22c55e' }}>
                                      {gpu.hallucinationRisk ? '⚠ ACTIVE' : '✓ None'}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Last Polled */}
                            <div style={{ marginTop: '0.75rem', fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.6, textAlign: 'right' }}>
                              Last polled: {new Date(gpu.lastPolled).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Compression Feedback Strip */}
                    <div style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '8px',
                      padding: '1rem 1.25rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '1rem',
                    }}>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                          Compression Multiplier
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {contextStats.compressionMultiplier.toFixed(1)}×
                          <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                            {contextStats.compressionMultiplier > 1.0 ? '↑ Relaxed — more context included' :
                             contextStats.compressionMultiplier < 1.0 ? '↓ Squeezing — less context to fit' :
                             '— Normal compression'}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.7rem' }}>
                        {[0.3, 0.5, 0.7, 1.0, 1.5, 2.0, 3.0].map(m => (
                          <div key={m} style={{
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px',
                            background: contextStats.compressionMultiplier === m ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                            color: contextStats.compressionMultiplier === m ? 'white' : 'var(--text-muted)',
                            fontWeight: contextStats.compressionMultiplier === m ? 600 : 400,
                            border: '1px solid',
                            borderColor: contextStats.compressionMultiplier === m ? 'var(--accent)' : 'var(--panel-border)',
                          }}>
                            {m}×
                          </div>
                        ))}
                      </div>
                    </div>


                    {/* Legend */}
                    <div style={{ marginTop: '1rem', display: 'flex', gap: '1.5rem', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {[
                        { color: '#22c55e', label: 'Green (<60%)' },
                        { color: '#f59e0b', label: 'Yellow (60-80%)' },
                        { color: '#f97316', label: 'Red (80-95%)' },
                        { color: '#ef4444', label: 'Critical (>95%)' },
                      ].map(item => (
                        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color }} />
                          {item.label}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Create Modal */}
      {isCreateModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', position: 'relative' }}>
            <button 
              onClick={() => setIsCreateModalOpen(false)}
              style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            <h2 className="mb-4">Create New Project</h2>
            <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Project Title</label>
                <input 
                  type="text" 
                  value={newProject.title} 
                  onChange={e => setNewProject({...newProject, title: e.target.value})}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                />
              </div>
              <div>
                <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Pen Name (Author)</label>
                <input 
                  type="text" 
                  value={newProject.context.penName || ''} 
                  onChange={e => setNewProject({...newProject, context: { ...newProject.context, penName: e.target.value }})}
                  placeholder="Optional: Automatically injected into covers and metadata"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                />
              </div>

              {newProject.type === 'book-cover' && (
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', marginBottom: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Variations to Generate</label>
                    <input 
                      type="number" 
                      min="1" max="10"
                      value={newProject.context.coverVariants || 1} 
                      onChange={e => setNewProject({...newProject, context: { ...newProject.context, coverVariants: parseInt(e.target.value) || 1 }})}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Typography Style</label>
                    <select 
                      value={newProject.context.coverFont || 'Serif (Georgia)'} 
                      onChange={e => setNewProject({...newProject, context: { ...newProject.context, coverFont: e.target.value }})}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                    >
                      <option value="Serif (Georgia)">Classic Serif (Georgia)</option>
                      <option value="Sans-Serif (Helvetica)">Modern Sans-Serif (Helvetica)</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Brand Accent Color</label>
                    <select 
                      value={newProject.context.brandColor || '#00d2ff'} 
                      onChange={e => setNewProject({...newProject, context: { ...newProject.context, brandColor: e.target.value }})}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                    >
                      <option value="#00d2ff">Sci-Fi (Electric Teal)</option>
                      <option value="#ff3d3d">Noir (Deep Red)</option>
                      <option value="#ffc107">Fantasy (Cyber Gold)</option>
                      <option value="#ffffff">Classic (Pure White)</option>
                      <option value="#a020f0">Cyberpunk (Neon Purple)</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Parent Project (Series)</label>
                <select 
                  value={newProject.parentId} 
                  onChange={e => setNewProject({...newProject, parentId: e.target.value})}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                >
                  <option value="">None (Standalone/Series Root)</option>
                  {projects.filter(p => !p.parentId).map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>
              {!newProject.parentId && (
                <div>
                  <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Description / Premise</label>
                  <textarea 
                    value={newProject.description} 
                    onChange={e => setNewProject({...newProject, description: e.target.value})}
                    required
                    rows={4}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                  />
                </div>
              )}
              <div>
                <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Template</label>
                <select 
                  value={newProject.type} 
                  onChange={e => setNewProject({...newProject, type: e.target.value})}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                >
                  {templates.map(t => (
                    <option key={t.type} value={t.type}>{t.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted mt-1">
                  {templates.find(t => t.type === newProject.type)?.description}
                </p>
              </div>
              {/* Writer Model Selector */}
              <div>
                <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Writer Model</label>
                <select
                  value={newProject.preferredProvider || ''}
                  onChange={e => setNewProject({...newProject, preferredProvider: e.target.value})}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                >
                  <option value="">System Default (perry-writer)</option>
                  {(availableModels.writer || []).filter(m => m !== 'perry-writer').map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <p className="text-xs text-muted mt-1">
                  {newProject.preferredProvider
                    ? `✓ This project will use ${newProject.preferredProvider} for all writing steps.`
                    : 'Leave as default, or select a fine-tuned LoRA model trained from calibration.'}
                </p>
              </div>
              {/* Context fields — hidden when inheriting from a parent project.
                   Exception: pass-based templates (style-calibration) always show their pass count. */}
              {(newProject.parentId) ? (
                <>
                  <div style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '6px',
                    background: 'rgba(99, 179, 237, 0.08)',
                    border: '1px solid rgba(99, 179, 237, 0.25)',
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}>
                    <span style={{ fontSize: '1rem' }}>🔗</span>
                    <span>
                      Chapter count, word target, prologue &amp; epilogue will be <strong style={{ color: 'var(--accent)' }}>inherited automatically</strong> from the selected parent project.
                    </span>
                  </div>
                  {newProject.type === 'style-calibration' && (
                    <div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', marginBottom: '1rem', background: 'rgba(34, 197, 94, 0.1)', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                        <input
                          type="checkbox"
                          checked={newProject.context.isInfiniteCalibration || false}
                          onChange={e => setNewProject({...newProject, context: { ...newProject.context, isInfiniteCalibration: e.target.checked }})}
                        />
                        <strong style={{ color: '#22c55e' }}>Infinite Learning Loop (Continuous)</strong>
                      </label>
                      
                      {!newProject.context.isInfiniteCalibration && (
                        <>
                          <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Number of Passes</label>
                          <input
                            type="number"
                            value={newProject.context.targetChapters}
                            onChange={e => setNewProject({...newProject, context: { ...newProject.context, targetChapters: parseInt(e.target.value) || 2 }})}
                            min="1"
                            max="100"
                            style={{ width: '120px', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                          />
                          <p className="text-xs text-muted mt-1">Each pass = 3 writing samples + 3 POV checks + 1 summary. Recommended: 2–5.</p>
                        </>
                      )}
                      {newProject.context.isInfiniteCalibration && (
                        <p className="text-xs text-muted mt-1" style={{ color: '#22c55e' }}>
                          The pipeline will generate 1 pass at a time and automatically append the next pass infinitely until you pause or delete the project.
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Words per Chapter</label>
                      <input
                        type="number"
                        value={newProject.context.targetWordsPerChapter}
                        onChange={e => setNewProject({...newProject, context: { ...newProject.context, targetWordsPerChapter: parseInt(e.target.value) || 3000 }})}
                        min="100"
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                      />
                    </div>
                    <div>
                      <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Target Chapters</label>
                      <input
                        type="number"
                        value={newProject.context.targetChapters}
                        onChange={e => setNewProject({...newProject, context: { ...newProject.context, targetChapters: parseInt(e.target.value) || 25 }})}
                        min="1"
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                        <input
                          type="checkbox"
                          checked={newProject.context.includePrologue}
                          onChange={e => setNewProject({...newProject, context: { ...newProject.context, includePrologue: e.target.checked }})}
                        /> Include Prologue
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                        <input
                          type="checkbox"
                          checked={newProject.context.includeEpilogue}
                          onChange={e => setNewProject({...newProject, context: { ...newProject.context, includeEpilogue: e.target.checked }})}
                        /> Include Epilogue
                      </label>
                    </div>
                  </div>

                  {/* Series Configuration */}
                  <div style={{
                    padding: '1rem',
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: newProject.context.isSeries ? 'rgba(99, 102, 241, 0.3)' : 'var(--panel-border)',
                    background: newProject.context.isSeries ? 'rgba(99, 102, 241, 0.05)' : 'transparent',
                    transition: 'all 0.2s ease',
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', marginBottom: newProject.context.isSeries ? '0.75rem' : 0 }}>
                      <input
                        type="checkbox"
                        checked={newProject.context.isSeries}
                        onChange={e => setNewProject({...newProject, context: { ...newProject.context, isSeries: e.target.checked }})}
                      />
                      <span style={{ fontWeight: 500 }}>This is part of a series</span>
                    </label>

                    {newProject.context.isSeries && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Book Number</label>
                          <input
                            type="number"
                            value={newProject.context.seriesCurrentBook}
                            onChange={e => setNewProject({...newProject, context: { ...newProject.context, seriesCurrentBook: Math.max(1, parseInt(e.target.value) || 1) }})}
                            min="1"
                            style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                          />
                        </div>
                        <div>
                          <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Planned Books in Series</label>
                          <input
                            type="number"
                            value={newProject.context.seriesTotalBooks}
                            onChange={e => setNewProject({...newProject, context: { ...newProject.context, seriesTotalBooks: Math.max(1, parseInt(e.target.value) || 3) }})}
                            min="1"
                            style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                          />
                        </div>
                        <div style={{ gridColumn: '1 / -1', fontSize: '0.75rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <BookOpen size={12} />
                          Book {newProject.context.seriesCurrentBook} of {newProject.context.seriesTotalBooks} — {newProject.context.seriesCurrentBook === 1 ? 'the AI will plant hooks for future books and avoid resolving the overarching conflict' : newProject.context.seriesCurrentBook === newProject.context.seriesTotalBooks ? 'the AI will resolve the series arc in this final book' : 'the AI will advance the series arc while maintaining its own book-level resolution'}
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="text-sm text-muted">
                      Estimated Total: <strong style={{ color: 'var(--accent)' }}>{((newProject.context.targetWordsPerChapter || 3000) * ((newProject.context.targetChapters || 25) + (newProject.context.includePrologue ? 1 : 0) + (newProject.context.includeEpilogue ? 1 : 0))).toLocaleString()}</strong> words
                    </div>
                  </div>
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsCreateModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isCreating}>
                  {isCreating ? <Loader2 size={16} className="animate-spin" /> : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Style DNA Modal */}
      {isStyleModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '800px', position: 'relative', height: '80vh', display: 'flex', flexDirection: 'column' }}>
            <button 
              onClick={() => setIsStyleModalOpen(false)}
              style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            <h2 className="mb-2">Global Style DNA</h2>
            <p className="text-sm text-muted mb-4">
              These rules are injected into every creative writing step to prevent overused AI tropes.
            </p>
            <form onSubmit={handleSaveStyle} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <textarea 
                  value={styleDnaContent} 
                  onChange={e => setStyleDnaContent(e.target.value)}
                  style={{ flex: 1, width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white', fontFamily: 'monospace', fontSize: '0.85rem', resize: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsStyleModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSavingStyle}>
                  {isSavingStyle ? <Loader2 size={16} className="animate-spin" /> : 'Save Rules'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && selectedProject && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '400px' }}>
            <h2 className="mb-4" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={20} /> Delete Project
            </h2>
            <p className="mb-4">
              Are you sure you want to delete <strong>{selectedProject.title}</strong>? 
              This will permanently delete the project state, AI memory, and all generated markdown files from the workspace. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn btn-outline" onClick={() => setIsDeleteModalOpen(false)}>Cancel</button>
              <button 
                className="btn btn-primary" 
                onClick={() => deleteProject(selectedProject.id)} 
                disabled={isDeleting}
                style={{ background: 'var(--danger)' }}
              >
                {isDeleting ? <Loader2 size={16} className="animate-spin" /> : 'Yes, Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
