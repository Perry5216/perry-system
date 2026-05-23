import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Play, Pause, AlertCircle, CheckCircle2, Circle, Loader2, Plus, X, Settings, Trash2, ChevronDown, ChevronRight, RotateCcw, Radio, Eye, EyeOff, ArrowDownToLine, ArrowUpFromLine, BarChart3, GitBranch, Cpu, Users, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Project, ProjectStep } from '@perry/core';
import { FleetCanvas } from './components/FleetCanvas';
import { SecretsPanel } from './components/SecretsPanel';
import { TrajectoriesPanel } from './components/TrajectoriesPanel';
import { ModelsPanel } from './components/ModelsPanel';
import { SystemPanel } from './components/SystemPanel';
import { SelfLearningPanel } from './components/SelfLearningPanel';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { DomainsPanel } from './components/DomainsPanel';
import { OperatorPanel } from './components/OperatorPanel';
import { CronPanel } from './components/CronPanel';
import { IntegrationsPanel } from './components/IntegrationsPanel';
import { FleetHeader } from './components/FleetHeader';
import { GoalsPanel } from './components/GoalsPanel';
import { SuggestedAction } from './components/SuggestedAction';
import { LeftNav, type NavTab } from './components/LeftNav';
import { TopStatusBar } from './components/TopStatusBar';
import { LandingChat } from './components/LandingChat';
import { BootScreen } from './components/BootScreen';
import { HelpGuide } from './components/HelpGuide';

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

// ─── Auth: auto-inject Bearer header on every /api/ request ───────────────
//
// When PERRY_API_KEY is set server-side, every API call must carry
// `Authorization: Bearer <key>`. The dashboard reads the key from localStorage
// (key: `perry-api-key`); if missing, prompts the user once and persists. On
// a 401 we clear the cached key and prompt again — so rotating the server key
// just means clicking through one prompt.
//
// Webhook receiver paths are exempt server-side (the handler has its own
// X-Webhook-Secret check), so this wrapper doesn't need to know about them —
// no Bearer header is harmful, the server just ignores it.
(function installApiAuth() {
  const STORAGE_KEY = 'perry-api-key';
  const getKey = (): string | null => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  };
  const promptForKey = (reason: string): string | null => {
    const entered = window.prompt(`Perry API key required (${reason}). Find it in your .env as PERRY_API_KEY.`);
    if (entered && entered.trim()) {
      try { localStorage.setItem(STORAGE_KEY, entered.trim()); } catch { }
      return entered.trim();
    }
    return null;
  };

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.toString()
        : (input as Request).url;
    const isApiCall = url.includes('/api/');

    let key = getKey();
    const attach = (k: string) => {
      const headers = new Headers(init.headers || (input instanceof Request ? (input as Request).headers : undefined));
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${k}`);
      return { ...init, headers };
    };
    const opts = isApiCall && key ? attach(key) : init;

    let res = await origFetch(input, opts);
    // First-time setup OR rotated key: prompt + retry once.
    if (isApiCall && res.status === 401) {
      try { localStorage.removeItem(STORAGE_KEY); } catch { }
      const fresh = promptForKey(key ? 'cached key rejected' : 'first-time setup');
      if (fresh) {
        res = await origFetch(input, attach(fresh));
      }
    }
    return res;
  };

  // Expose a manual "forget my key" hook for rotation: window.perryForgetApiKey()
  (window as any).perryForgetApiKey = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { }
    console.info('[perry] API key cleared — next /api call will re-prompt');
  };
})();


function cleanAuthLogs(logs: string): string {
  if (!logs) return '';
  // Strip ANSI escape codes
  const withoutAnsi = logs.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  const lines = withoutAnsi.split(/\r?\n/);
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim().toLowerCase();
    
    if (trimmed.includes('security warning')) return false;
    if (trimmed.includes('device codes are a common phishing target')) return false;
    if (trimmed.includes('never share this code')) return false;
    if (trimmed.includes('continue only if you started this sign-in')) return false;
    if (trimmed.includes('if you weren') && trimmed.includes('expecting this page')) return false;
    if (trimmed.includes('got this link from someone else')) return false;
    if (trimmed.includes('close this tab')) return false;
    
    return true;
  });
  return filteredLines.join('\n').trim();
}

function parseDeviceAuth(logs: string): { url: string; code: string } | null {
  if (!logs) return null;
  // Strip ANSI escape codes
  const cleanLogs = logs.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  const urlMatch = cleanLogs.match(/https?:\/\/[^\s"'`]+/);
  if (!urlMatch) return null;
  
  const url = urlMatch[0];
  let code = null;
  
  const lines = cleanLogs.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (line.includes('one-time code') || line.includes('enter the code') || line.includes('enter this code')) {
      const currentLineMatch = lines[i].match(/\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/i);
      if (currentLineMatch) {
        code = currentLineMatch[1].toUpperCase();
        break;
      }
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
        const nextLineMatch = lines[j].match(/\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/i);
        if (nextLineMatch) {
          code = nextLineMatch[1].toUpperCase();
          break;
        }
        const nextLineAlphaMatch = lines[j].trim().match(/^([A-Z0-9]{8,12})$/i);
        if (nextLineAlphaMatch) {
          code = nextLineAlphaMatch[1].toUpperCase();
          break;
        }
      }
    }
    if (code) break;
  }
  
  if (!code) {
    const codeMatchPhrase = logs.match(/(?:enter\s+the\s+code|code:?)\s+([A-Za-z0-9-]+)/i);
    if (codeMatchPhrase) {
      code = codeMatchPhrase[1].toUpperCase();
    } else {
      const codeMatchHyphen = logs.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/i);
      if (codeMatchHyphen) {
        code = codeMatchHyphen[1].toUpperCase();
      } else {
        const codeMatchAlpha = logs.match(/\b([A-Z0-9]{8,12})\b/i);
        if (codeMatchAlpha) {
          code = codeMatchAlpha[1].toUpperCase();
        }
      }
    }
  }
  
  if (url && code) {
    return { url, code };
  }
  return null;
}


export const workTypeDetails: Record<string, { label: string; description: string }> = {
  books: {
    label: 'Books',
    description: 'Novel-writing pipeline with per-pen-name fine-tuning, scout, audit, and revision.'
  },
  code: {
    label: 'Code',
    description: 'Software development pipeline with code review, architecting, and implementation.'
  },
  dnd: {
    label: 'D&D',
    description: 'D&D campaign planning, session preparation, and character design.'
  },
  email: {
    label: 'Email',
    description: 'Inbox triage and drafting replies in the user\'s voice.'
  },
  hacking: {
    label: 'Hacking',
    description: 'Defensive security analysis of vulnerabilities, CVEs, and recon dossiers.'
  }
};


export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isGeneratingTemplate, setIsGeneratingTemplate] = useState(false);

  // TopStatusBar Telemetry Counts
  const [agentsCount, setAgentsCount] = useState<number>(0);
  const [domainsCount, setDomainsCount] = useState<number>(0);
  const [activeCount, setActiveCount] = useState<number>(0);
  const [doneCount, setDoneCount] = useState<number>(0);
  const [, setActiveInvocations] = useState<Set<string>>(() => new Set());

  // Tick once per second so active-step elapsed timers (re)render. Kept
  // tiny — just a number that changes — so React's diff only updates
  // the elements that actually read it. Idle when no project is open
  // (cheap setInterval, ~negligible CPU).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!selectedProject) return;
    const anyActive = selectedProject.steps.some(s => (s.status as any) === 'active');
    if (!anyActive) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [selectedProject?.id, selectedProject?.steps.map(s => s.status).join(',')]);

  const [booted, setBooted] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('perry-booted') === 'true';
    }
    return false;
  });

  const handleBootComplete = useCallback(() => {
    sessionStorage.setItem('perry-booted', 'true');
    setBooted(true);
  }, []);

  useEffect(() => {
    (window as any).triggerPerryBoot = () => {
      sessionStorage.removeItem('perry-booted');
      setBooted(false);
    };
  }, []);

  // UI State
  type TabId = 'pipeline' | 'gpu' | 'workers' | 'fleet' | 'director' | 'secrets' | 'trajectories' | 'analytics' | 'models' | 'projects' | 'system' | 'self-learning' | 'domains' | 'operator' | 'cron' | 'integrations' | 'goals';
  // Fleet is the landing tab — the system's "home view" showing the
  // entire agent constellation. Projects, secrets, models, etc. are
  // all navigated to from Fleet rather than around it.
  const [activeTab, setActiveTab] = useState<TabId>('fleet');
  // Sidebar is hidden by default — Fleet view gets the whole canvas.
  // User can pop it back with the bridge menu when they need to pick
  // a project or switch tabs. Open automatically when a project IS
  // selected, since that implies they want to work with it.
  // Sidebar overlay retired — Projects is now a regular panel via
  // activeTab === 'projects'. No compatibility shim needed.

  // Work-type filter on the Projects panel. 'all' shows everything; the
  // others (code / email / hacking / meta / book / dnd) match the agent domains.
  type WorkType = 'all' | 'code' | 'email' | 'hacking' | 'meta' | 'books' | 'dnd';
  const [projectWorkType, setProjectWorkType] = useState<WorkType>('meta');

  /** Derive a project's work type from whatever signal we can find: an
   *  explicit `p.workType` or `metadata.workType` field if set, otherwise inferred from the
   *  step types in the project. Falls back to 'code'. */
  const inferProjectWorkType = (p: Project): Exclude<WorkType, 'all'> => {
    if (p.workType) {
      if ((p.workType as string) === 'book') return 'books';
      return p.workType as any;
    }
    const meta = (p as any).metadata || {};
    if (meta.workType && ['code','email','hacking','meta','books','book','dnd'].includes(meta.workType)) {
      return (meta.workType as string) === 'book' ? 'books' : (meta.workType as any);
    }
    if (['book-planning', 'style-calibration', 'novel-pipeline', 'deep-revision', 'revision-execution', 'book-production', 'amazon-kdp-launch', 'short-story', 'book-cover'].includes(p.type)) {
      return 'books';
    }
    if (['dnd-campaign-planning', 'dnd-session-prep', 'dnd-character-design'].includes(p.type)) {
      return 'dnd';
    }
    const tpl = templates.find(t => t.type === p.type);
    if (tpl && tpl.workType) {
      return (tpl.workType as string) === 'book' ? 'books' : (tpl.workType as any);
    }
    const stepTypes = new Set((p.steps || []).map(s => s.taskType));
    if ([...stepTypes].some(t => t.startsWith('code'))) return 'code';
    if ([...stepTypes].some(t => t.startsWith('email'))) return 'email';
    if ([...stepTypes].some(t => t.startsWith('hack') || t.includes('recon') || t.includes('vuln'))) return 'hacking';
    return 'code';
  };
  const [chatMode, setChatMode] = useState<'docked' | 'floating'>('docked');
  // Docked column width — user-resizable via the drag handle on the chat
  // panel. Persisted to localStorage so it survives reloads.
  const [chatDockedWidth, setChatDockedWidth] = useState<number>(() => {
    if (typeof localStorage === 'undefined') return 420;
    const stored = parseInt(localStorage.getItem('perry-chat-docked-width') || '0', 10);
    return Number.isFinite(stored) && stored >= 320 ? stored : 420;
  });
  // Whether the chat panel is open at all. Triggered from the Chat item in
  // LeftNav. When closed, the canvas fills the available width.
  const [chatOpen, setChatOpen] = useState(false);
  // Legacy: collapsed kept only so LandingChat doesn't crash; it now mirrors
  // chatOpen (false = closed, true = open & expanded).
  const chatCollapsed = false;
  const setChatCollapsed = (_v: boolean) => {};
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('perry-chat-docked-width', String(chatDockedWidth));
    }
  }, [chatDockedWidth]);

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
  const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({ writer: [], librarian: [], researcher: [] });
  const [isSwappingModel, setIsSwappingModel] = useState<string | null>(null);

  // Worker pool live state
  interface WorkersInfo {
    active: number;
    workers: Array<{ id: string; lastClaim: string; recentClaims: number }>;
    depth: Record<string, number>;
  }
  const [workersInfo, setWorkersInfo] = useState<WorkersInfo | null>(null);
  // Worker-target panel: user declares "stop when this pen has N pairs"; the
  // WorkerCoordinator (inside perry) polls task_pool against this target and
  // POSTs spawn requests to perry-worker. UI shows current vs target +
  // coordinator heartbeat.
  interface WorkerTargetInfo {
    slug: string;
    target: number | null;
    agent?: string;
    maxWorkers?: number;
    startedAt: string | null;
    injected: number;
    doneInPool: number;
    currentPairs: number;
    activeWorkers: number;
    counts: Record<string, number>;
    daemon: { lastHeartbeatAt: string; secondsSinceHeartbeat: number; alive: boolean } | null;
  }
  const [targetInfo, setTargetInfo] = useState<WorkerTargetInfo | null>(null);
  const [targetInput, setTargetInput] = useState<string>('');
  const [maxWorkersInput, setMaxWorkersInput] = useState<string>('');
  const [agentInput, setAgentInput] = useState<string>('anthropic');
  const [targetBusy, setTargetBusy] = useState(false);
  // Pool audit — scans claude_injected.jsonl + training_data.jsonl with the
  // same scanLeaks bank used by Phase B + worker drain. One-click visibility
  // into whether anything snuck past the gates.
  interface PoolAuditFileReport {
    file: string;
    exists: boolean;
    total: number;
    clean: number;
    leaked: number;
    untaggedPen?: number;
    tagCounts: Record<string, number>;
    topExamples: Array<{ index: number; tags: string[]; matches: string[]; excerpt: string }>;
  }
  interface PoolAuditManifestCategory {
    id: string;
    label: string;
    op: 'preserve' | 'cap' | 'farm' | 'farm_and_refine' | string;
    target: number;
    current: number;
    deficit: number;
    surplus: number;
    status: string;
    mustSatisfy: boolean;
  }
  interface PoolAuditManifest {
    version: number;
    ready: boolean;
    blocked: boolean;
    totalMatched: number;
    unmatched: number;
    minTotal: number;
    categories: PoolAuditManifestCategory[];
  }
  interface VoiceMatchSourceBucket {
    source: string;
    total: number;
    pass: number;
    soft: number;
    hard: number;
    leaks: number;
    meanDistance: number;
    passPct: number;
  }
  interface PoolAuditVoiceMatch {
    strict: number;
    lenient: number;
    fingerprintN: number;
    overall: { total: number; pass: number; soft: number; hard: number; leaks: number };
    bySource: VoiceMatchSourceBucket[];
  }
  interface PoolAuditQueueSync {
    archived: Record<string, number>;
    enqueued?: number;
    enqueueError?: string;
  }
  interface PoolAuditResult {
    slug: string;
    runAt: string;
    reports: PoolAuditFileReport[];
    manifest?: PoolAuditManifest | null;
    voiceMatch?: PoolAuditVoiceMatch | null;
    queueSync?: PoolAuditQueueSync | null;
  }
  const [poolAudit, setPoolAudit] = useState<PoolAuditResult | null>(null);
  const [poolAuditBusy, setPoolAuditBusy] = useState(false);
  interface ScrubResult {
    file: string; exists: boolean; before: number; kept: number;
    removed: number; backupPath: string | null;
    removedTags: Record<string, number>;
    removedByReason?: Record<string, number>;  // leak / first_person / voice_soft / voice_hard
  }
  const [scrubBusy, setScrubBusy] = useState(false);
  const [scrubResult, setScrubResult] = useState<{ slug: string; runAt: string; results: ScrubResult[] } | null>(null);
  // Pen-tag controls: visible when the audit reports untagged training_data rows.
  // Defaults the dropdown to the slug we audited, but the user can pick any pen.
  const [tagPenChoice, setTagPenChoice] = useState<string>('a-perry');
  const [tagBusy, setTagBusy] = useState(false);
  const [tagResult, setTagResult] = useState<{ slug: string; penSlug: string; tagged: number; alreadyTagged: number; total: number; backupPath: string } | null>(null);
  // Which pen's pool the audit/scrub/tag actions target. Defaults to a-perry
  // since that's the only pen with a populated pool today; the dropdown lets
  // you pivot once a second pen exists.
  const [auditPenSlug, setAuditPenSlug] = useState<string>('a-perry');
  const [isUnloadingLibrarian, setIsUnloadingLibrarian] = useState(false);
  const [librarianLoaded, setLibrarianLoaded] = useState<{ loadedCount: number; rerouted?: boolean } | null>(null);
  // Researcher slot — runs on configurable endpoint. Used by planning research phase.
  const [researcherStatus, setResearcherStatus] = useState<{ loadedCount: number; gpu: string; onLibrarianGpu: boolean; currentEndpoint: string; models?: Array<{ name: string }>; mode?: string } | null>(null);
  const [isSwitchingResearcher, setIsSwitchingResearcher] = useState(false);
  // Anthropic assist worker — daemon polls /assist-status and fires `claude -p
  // /perry-worker` when (mode='auto' and tasks pending) OR (manual fire
  // button clicked). This state mirrors the server side for the panel.
  type AssistAgentSlice = {
    mode: 'auto'|'manual';
    fireRequestedAt: string | null;
    lastFiredAt: string | null;
    daemonAlive: boolean;
    daemonAgeSec: number | null;
    config?: { yolo: boolean; model: string };
    authenticated?: boolean;
  };
  const [assistStatus, setAssistStatus] = useState<{
    pending: number; claimed: number;
    anthropic: AssistAgentSlice;
    antigrav: AssistAgentSlice;
    codex: AssistAgentSlice;
  } | null>(null);
  const [isFiringAssist, setIsFiringAssist] = useState<string | null>(null);

  // Interactive Auth Wizard State
  const [activeLoginAgent, setActiveLoginAgent] = useState<'anthropic' | 'antigrav' | 'codex' | null>(null);
  const [loginLogs, setLoginLogs] = useState<string>('');
  const [loginStatusActive, setLoginStatusActive] = useState<boolean>(false);
  const [loginInputValue, setLoginInputValue] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isStartingLogin, setIsStartingLogin] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  useEffect(() => {
    if (!activeLoginAgent) return;

    let timerId: any = null;
    let isSubscribed = true;

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/system/login-status`);
        if (!isSubscribed) return;
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();
        if (data.active !== undefined) {
          setLoginStatusActive(data.active);
          setLoginLogs(data.logs || '');
          setLoginError(data.error || null);
          
          if (!data.active && data.exitCode !== null) {
            setLoginLogs(prev => {
              if (prev.endsWith(`\n[Process Exited with code ${data.exitCode}]`)) return prev;
              return prev + `\n[Process Exited with code ${data.exitCode}]`;
            });
          }
        }
      } catch (err: any) {
        if (isSubscribed) {
          setLoginError(err.message);
        }
      }
    };

    poll();
    timerId = setInterval(poll, 1000);

    return () => {
      isSubscribed = false;
      clearInterval(timerId);
    };
  }, [activeLoginAgent]);

  const startAuthWizard = async (agent: 'anthropic' | 'antigrav' | 'codex') => {
    setActiveLoginAgent(agent);
    setLoginLogs('Initializing process...');
    setLoginStatusActive(true);
    setLoginInputValue('');
    setLoginError(null);
    setIsStartingLogin(true);

    try {
      const res = await fetch(`${API_BASE}/system/login-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent })
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
    } catch (err: any) {
      setLoginError(err.message);
      setLoginStatusActive(false);
    } finally {
      setIsStartingLogin(false);
    }
  };

  const sendAuthInput = async () => {
    if (!loginInputValue.trim() && loginInputValue !== '\n') return;
    const inputToSend = loginInputValue;
    setLoginInputValue('');

    try {
      const res = await fetch(`${API_BASE}/system/login-input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputToSend })
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
    } catch (err: any) {
      setLoginError(err.message);
    }
  };

  const killAuthWizard = async () => {
    try {
      await fetch(`${API_BASE}/system/login-kill`, { method: 'POST' });
    } catch (err) {
      console.error("Failed to kill auth process", err);
    }
    setActiveLoginAgent(null);
    setLoginLogs('');
    setLoginStatusActive(false);
    setLoginError(null);
  };
  // Create Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProject, setNewProject] = useState({
    title: '', description: '', type: '', parentId: '', preferredProvider: '',
    context: {}
  });
  const [isCreating, setIsCreating] = useState(false);

  // Step audit verdicts — map of stepId → { audit?, povVerdict? }
  // Loaded once per selected project, refreshed when steps complete.
  const [stepVerdicts, setStepVerdicts] = useState<Record<string, { audit?: any; povVerdict?: any }>>({});

  // Pens & LoRAs state — used by the Pens tab and the Promote-to-Production flow
  const [pensData] = useState<any[]>([]);

  // Batch Reroll State
  const [selectedStepIds, setSelectedStepIds] = useState<Set<string>>(new Set());

  // Delete Project State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Admin Operations State
  const [adminEvolveProjectId, setAdminEvolveProjectId] = useState<string>('');
  const [adminEvolveWorkType, setAdminEvolveWorkType] = useState<string>('books');
  const [isAssessing, setIsAssessing] = useState<boolean>(false);
  
  // Evolve WorkType to Template Wizard State
  const [isEvolveModalOpen, setIsEvolveModalOpen] = useState(false);
  const [evolveTemplateName, setEvolveTemplateName] = useState('');
  const [evolveTemplateDesc, setEvolveTemplateDesc] = useState('');
  const [evolvePipelineGoal, setEvolvePipelineGoal] = useState('');
  const [evolveWorkersMode, setEvolveWorkersMode] = useState('smart');
  const [isEvolvingTemplate, setIsEvolvingTemplate] = useState(false);
  const [adminIntelligentWorkType, setAdminIntelligentWorkType] = useState<string>('dnd');
  const [adminIntelligentTarget, setAdminIntelligentTarget] = useState<'workers' | 'gpu'>('workers');
  const [isIntelligentEnableSearch, setIntelligentEnableSearch] = useState<boolean>(true);
  const [isIntelligentlyEvolving, setIsIntelligentlyEvolving] = useState<boolean>(false);
  const [evolveLogs, setEvolveLogs] = useState<string[]>([]);
  const [assessmentSessionId, setAssessmentSessionId] = useState<string | null>(null);
  const [assessmentStatus, setAssessmentStatus] = useState<string>('');
  const [assessmentResult, setAssessmentResult] = useState<any | null>(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [installingSkills, setInstallingSkills] = useState<boolean>(false);
  const [installSuccessMessage, setInstallSuccessMessage] = useState<string | null>(null);

  // Sidebar Accordion State
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());

  // ── Live Activity Feed State ──────────────────────────────────────────────
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([]);
  // Derived: always the last entry in feedEntries (or null when empty).
  // Was a parallel state that needed manual sync via setLatestActivity on
  // every push — one render per SSE event for no value.
  const latestActivity = feedEntries.length > 0 ? feedEntries[feedEntries.length - 1] : null;
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
  // Refs mirror the state so the auto-fetch effect can check "already
  // loaded?" without subscribing to ioData/ioLoading in its dep array.
  // Subscribing caused the effect to re-run on every fetch completion
  // (since setIoData / setIoLoading fire mid-effect).
  const ioDataRef = useRef(ioData);
  const ioLoadingRef = useRef(ioLoading);
  ioDataRef.current = ioData;
  ioLoadingRef.current = ioLoading;
  const [ioActiveTab, setIoActiveTab] = useState<'input' | 'output'>('output');

  // ── Director Chat State ──────────────────────────────────────────────────
  const [chatHistory, setChatHistory] = useState<{ role: string, content: string }[]>([]);
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


  /** Tabs that work as truly global views (no project context required).
   *  These appear in the LeftNav. Other tabs (GPU, Workers,
   *  Pens, Pipeline, etc.) require a selected project — they only surface
   *  once the user opens a project from the sidebar. */
  const GLOBAL_TAB_IDS: Set<TabId> = useMemo(() => new Set<TabId>(['fleet', 'projects', 'trajectories', 'analytics', 'secrets', 'models', 'self-learning', 'system', 'domains', 'operator', 'cron', 'integrations', 'goals']), []);

  // If we land on a project-scoped tab without a project selected (e.g. user
  // bookmarked /workers, or activeTab is set by some other path), redirect
  // to fleet — the bridge view. Avoids ever showing a stale "select a
  // project" placeholder.
  useEffect(() => {
    // Workers is reachable from the LeftNav without a project context, so
    // it gets an explicit exemption from the bounce-to-fleet logic.
    if (!selectedProject && !GLOBAL_TAB_IDS.has(activeTab) && activeTab !== 'workers') {
      setActiveTab('fleet');
    }
  }, [selectedProject, activeTab, GLOBAL_TAB_IDS]);

  /** Dynamic tab definitions based on what data exists in the family.
   *  Global tabs are always present; project-scoped tabs only render
   *  when relevant data exists in the currently-selected project family. */
  const availableTabs = useMemo((): { id: TabId; label: string; icon: React.ReactNode; count?: number; global?: boolean }[] => {
    const tabs: { id: TabId; label: string; icon: React.ReactNode; count?: number; global?: boolean }[] = [
      { id: 'pipeline', label: 'Pipeline', icon: <Play size={14} /> },
      { id: 'director', label: 'Director Chat', icon: <Radio size={14} /> },
      { id: 'fleet', label: 'Fleet', icon: <Cpu size={14} />, global: true },
      // GPU / Workers / Pens are project-scoped — they only make sense once a
      // project is open. They appear in the in-project tab strip, not the
      // global LeftNav.
      { id: 'gpu', label: 'GPU Monitor', icon: <Cpu size={14} /> },
      { id: 'workers', label: 'Workers', icon: <Users size={14} />,
        count: (assistStatus?.pending ?? 0) + (workersInfo?.active ?? 0) || undefined },
      { id: 'trajectories', label: 'Trajectories', icon: <BarChart3 size={14} />, global: true },
      { id: 'models', label: 'Models', icon: <ArrowDownToLine size={14} />, global: true },
      { id: 'secrets', label: 'Secrets', icon: <Settings size={14} />, global: true },
      { id: 'system', label: 'System', icon: <GitBranch size={14} />, global: true },
    ];

    return tabs;
  }, [assistStatus, workersInfo]);

  /** Count words for display */
  const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

  const toggleSeries = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Functional updater: reads the latest `prev` from React rather than
    // the closure-captured `expandedSeries`. Without this, rapid clicks
    // can drop intermediate toggles when two updates queue in one tick.
    setExpandedSeries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    // EventSource doesn't support custom headers, so SSE auth uses a query
    // param (the auth middleware accepts `?token=` for /api/sse and /api/events
    // routes). Pull from the same localStorage slot the fetch wrapper uses.
    const sseKey = (typeof localStorage !== 'undefined' && localStorage.getItem('perry-api-key')) || '';
    const evtSource = new EventSource(`${API_BASE}/events${sseKey ? `?token=${encodeURIComponent(sseKey)}` : ''}`);

    // ── Live-feel helpers ────────────────────────────────────────────
    // 1. Optimistic state patches — flip the rendered step status the
    //    moment an SSE event arrives, instead of waiting for the next
    //    fetchData() round-trip. Server is still the source of truth;
    //    the debounced fetchData below confirms what we patched.
    // 2. Debounced fetchData — a burst of step:progress events (e.g.
    //    several gate stages firing in quick succession) used to fan out
    //    to one full project re-fetch per event. We now coalesce them
    //    into one fetch per 350ms window.
    let fetchTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFetch = () => {
      if (fetchTimer) return;
      fetchTimer = setTimeout(() => { fetchTimer = null; fetchData(); }, 350);
    };
    const patchStep = (
      projectId: string,
      stepId: string,
      patch: Partial<ProjectStep>,
    ) => {
      setSelectedProject(prev => {
        if (!prev || prev.id !== projectId) return prev;
        let touched = false;
        const nextSteps = prev.steps.map(s => {
          if (s.id !== stepId) return s;
          touched = true;
          return { ...s, ...patch };
        });
        return touched ? { ...prev, steps: nextSteps } : prev;
      });
    };

    evtSource.addEventListener('step:started', (e) => {
      try {
        const data = JSON.parse(e.data);
        pushFeedEntry({ type: 'started', stepId: data.stepId, projectId: data.projectId, message: '⚡ Step started' });
        // Optimistic: mark active + stamp startedAt now so the elapsed
        // timer can begin counting before the server round-trip finishes.
        patchStep(data.projectId, data.stepId, {
          status: 'active' as any,
          startedAt: new Date().toISOString() as any,
        });
      } catch { /* ignore parse errors */ }
      scheduleFetch();
    });

    evtSource.addEventListener('step:progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        pushFeedEntry({ type: 'progress', stepId: data.stepId, projectId: data.projectId, message: data.message || 'Working...' });
        // Progress means a step is alive; if for any reason we still see
        // it as pending locally, flip to active so the spinner shows up
        // immediately rather than at the next refresh.
        patchStep(data.projectId, data.stepId, { status: 'active' as any });
      } catch { /* ignore parse errors */ }
      scheduleFetch();
    });

    evtSource.addEventListener('step:completed', (e) => {
      try {
        const data = JSON.parse(e.data);
        pushFeedEntry({ type: 'completed', stepId: data.stepId, projectId: data.projectId, message: '✓ Step completed' });
        patchStep(data.projectId, data.stepId, {
          status: 'completed' as any,
          completedAt: new Date().toISOString() as any,
        });
      } catch { /* ignore parse errors */ }
      scheduleFetch();
    });

    evtSource.addEventListener('step:failed', (e) => {
      try {
        const data = JSON.parse(e.data);
        pushFeedEntry({ type: 'failed', stepId: data.stepId, projectId: data.projectId, message: `✗ Failed: ${data.error || 'Unknown error'}` });
        patchStep(data.projectId, data.stepId, {
          status: 'failed' as any,
          error: data.error || 'Unknown error' as any,
        });
      } catch { /* ignore parse errors */ }
      scheduleFetch();
    });

    evtSource.addEventListener('project:paused', () => {
      fetchData();
    });

    evtSource.addEventListener('agent:invocation:started', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.invocationId) {
          setActiveInvocations(prev => {
            if (prev.has(data.invocationId)) return prev;
            const next = new Set(prev);
            next.add(data.invocationId);
            setActiveCount(c => c + 1);
            return next;
          });
        }
      } catch {}
    });

    const handleAgentInvocationEnded = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.invocationId) {
          setActiveInvocations(prev => {
            const next = new Set(prev);
            next.delete(data.invocationId);
            setActiveCount(c => Math.max(0, c - 1));
            setDoneCount(c => c + 1);
            return next;
          });
        } else {
          setActiveCount(c => Math.max(0, c - 1));
          setDoneCount(c => c + 1);
        }
      } catch {}
    };

    evtSource.addEventListener('agent:invocation:completed', handleAgentInvocationEnded);
    evtSource.addEventListener('agent:invocation:failed', handleAgentInvocationEnded);

    // GPU Context Watcher — live stats from the server
    evtSource.addEventListener('context:stats', (e) => {
      try {
        const data = JSON.parse(e.data);
        setContextStats(data);
      } catch { /* ignore parse errors */ }
    });

    evtSource.addEventListener('intelligent-evolve:log', (e) => {
      try {
        const data = JSON.parse(e.data);
        const timestamp = data.timestamp ? `[${new Date(data.timestamp).toLocaleTimeString()}] ` : '';
        setEvolveLogs(prev => [...prev, `${timestamp}${data.message}`]);
      } catch { /* ignore parse errors */ }
    });

    // Also fetch initial context stats
    fetch(`${API_BASE}/system/context-stats`)
      .then(r => r.json())
      .then(data => setContextStats(data))
      .catch(() => { });

    // Poll workers + librarian-GPU status every 5s. Cheap SQL on task_pool +
    // a single /api/ps roundtrip to ollama-embeddings. No SSE since both are
    // small and bounded.
    const pollWorkers = () => {
      // Skip polling when the dashboard tab is hidden. The user can't see it
      // and the server pays for fetches it'll never display. Burns ~5 fetches
      // every 5s otherwise on a tab left open in the background.
      if (typeof document !== 'undefined' && document.hidden) return;
      const slug = auditPenSlug || 'a-perry';
      fetch(`${API_BASE}/system/workers`).then(r => r.json()).then(setWorkersInfo).catch(() => { });
      fetch(`${API_BASE}/system/gpu/librarian/status`).then(r => r.json()).then(setLibrarianLoaded).catch(() => { });
      fetch(`${API_BASE}/system/gpu/researcher/status`).then(r => r.json()).then(setResearcherStatus).catch(() => { });
      fetch(`${API_BASE}/system/assist-status`).then(r => r.json()).then(setAssistStatus).catch(() => { });
      fetch(`${API_BASE}/system/worker-target?slug=${encodeURIComponent(slug)}`).then(r => r.json()).then(setTargetInfo).catch(() => { });
    };
    pollWorkers();
    const workerInterval = setInterval(pollWorkers, 5000);

    Promise.all([
      fetch(`${API_BASE}/system/models?role=writer`).then(r => r.json()),
      fetch(`${API_BASE}/system/models?role=librarian`).then(r => r.json()),
      fetch(`${API_BASE}/system/models?role=researcher`).then(r => r.json())
    ]).then(([writerData, libData, researcherData]) => {
      setAvailableModels({
        writer: writerData.models || [],
        librarian: libData.models || [],
        researcher: researcherData.models || []
      });
    }).catch(() => { });

    // One-shot templates fetch. Templates are compile-time constants; they
    // don't change between project creations. Was previously re-fetched on
    // every SSE event in fetchData() (~4-6x/minute under load).
    fetch(`${API_BASE}/system/templates`)
      .then(r => r.json())
      .then((templatesData: any[]) => {
        setTemplates(templatesData);
        if (templatesData.length > 0) {
          setNewProject(prev => prev.type ? prev : { ...prev, type: templatesData[0].type });
        }
      })
      .catch(() => { });

    return () => {
      evtSource.close();
      clearInterval(workerInterval);
    };
  }, []);

  const handleLibrarianToggle = async () => {
    const isRouted = !!librarianLoaded?.rerouted;
    if (isRouted) {
      // Restore — pull librarian back to its own GPU.
      try {
        setIsUnloadingLibrarian(true);
        const r = await fetch(`${API_BASE}/system/gpu/librarian/restore`, { method: 'POST' });
        if (!r.ok) throw new Error(await r.text());
        fetch(`${API_BASE}/system/gpu/librarian/status`).then(r => r.json()).then(setLibrarianLoaded).catch(() => { });
      } catch (e: any) {
        alert(`Failed to restore librarian: ${e.message}`);
      } finally {
        setIsUnloadingLibrarian(false);
      }
      return;
    }
    if (!confirm('Free the 5070 Ti? This unloads librarian models and reroutes librarian calls to the 5090 (Magnum). Calibration POV checks will slow down because the writer GPU will hot-swap models. Recommended only during training-only periods.')) return;
    try {
      setIsUnloadingLibrarian(true);
      const r = await fetch(`${API_BASE}/system/gpu/librarian/unload`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'unload failed');
      fetch(`${API_BASE}/system/gpu/librarian/status`).then(r => r.json()).then(setLibrarianLoaded).catch(() => { });
    } catch (e: any) {
      alert(`Failed to free 5070 Ti: ${e.message}`);
    } finally {
      setIsUnloadingLibrarian(false);
    }
  };

  // Researcher endpoint swap — toggles which GPU runs the researcher model
  // for planning research-phase steps. Re-initializes the AI router on
  // the backend so the next research call lands on the new endpoint.
  const handleResearcherEndpointSwap = async (target: 'writer' | 'librarian' | 'workers') => {
    try {
      setIsSwitchingResearcher(true);
      const r = await fetch(`${API_BASE}/system/gpu/researcher/endpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'switch failed');
      // Refresh status + available models for the new endpoint.
      fetch(`${API_BASE}/system/gpu/researcher/status`).then(r => r.json()).then(setResearcherStatus).catch(() => { });
      fetch(`${API_BASE}/system/models?role=researcher`).then(r => r.json()).then(data => {
        setAvailableModels(prev => ({ ...prev, researcher: data.models || [] }));
      }).catch(() => { });
    } catch (e: any) {
      alert(`Failed to switch researcher endpoint: ${e.message}`);
    } finally {
      setIsSwitchingResearcher(false);
    }
  };

  // Per-agent assist worker controls. Optimistic local state updates make
  // every click feel instant — server round-trip happens in the background;
  // on failure we roll back.
  const refreshAssistStatus = () => {
    fetch(`${API_BASE}/system/assist-status`).then(r => r.json()).then(setAssistStatus).catch(() => { });
  };
  const handleAssistFireNow = async (agent: 'anthropic' | 'antigrav' | 'codex') => {
    // Optimistic: show "fire requested" stamp immediately so the button
    // disables + the badge updates without waiting for the round-trip.
    const nowIso = new Date().toISOString();
    setAssistStatus(prev => prev ? { ...prev, [agent]: { ...prev[agent], fireRequestedAt: nowIso } } : prev);
    setIsFiringAssist(agent);
    try {
      const r = await fetch(`${API_BASE}/system/fire-assist-worker`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent }),
      });
      if (!r.ok) throw new Error(await r.text());
      refreshAssistStatus();
    } catch (e: any) {
      // Rollback the optimistic fire-stamp.
      setAssistStatus(prev => prev ? { ...prev, [agent]: { ...prev[agent], fireRequestedAt: null } } : prev);
      alert(`Failed to request ${agent} assist worker: ${e.message}`);
    } finally {
      setIsFiringAssist(null);
    }
  };
  const handleAssistModeToggle = async (agent: 'anthropic' | 'antigrav' | 'codex') => {
    const current = assistStatus?.[agent]?.mode;
    const newMode: 'auto' | 'manual' = current === 'auto' ? 'manual' : 'auto';
    // Optimistic: flip the checkbox immediately. UI feels instant.
    setAssistStatus(prev => prev ? { ...prev, [agent]: { ...prev[agent], mode: newMode } } : prev);
    try {
      const r = await fetch(`${API_BASE}/system/assist-mode`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, mode: newMode }),
      });
      if (!r.ok) throw new Error(await r.text());
      refreshAssistStatus();
    } catch (e: any) {
      // Rollback.
      setAssistStatus(prev => prev ? { ...prev, [agent]: { ...prev[agent], mode: current ?? 'manual' } } : prev);
      alert(`Failed to set ${agent} assist mode: ${e.message}`);
    }
  };
  const handleAssistConfigChange = async (agent: 'anthropic' | 'antigrav' | 'codex', patch: { yolo?: boolean; model?: string }) => {
    // Capture previous config BEFORE the optimistic merge so a failure can
    // restore it locally — covers the case where the refresh GET also fails
    // and would otherwise leave the UI stuck in the wrong optimistic state.
    const previousConfig = assistStatus?.[agent]?.config;
    setAssistStatus(prev => prev ? {
      ...prev,
      [agent]: { ...prev[agent], config: { ...(prev[agent].config || { yolo: true, model: 'auto' }), ...patch } },
    } : prev);
    try {
      const r = await fetch(`${API_BASE}/system/assist-config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, ...patch }),
      });
      if (!r.ok) throw new Error(await r.text());
      refreshAssistStatus();
    } catch (e: any) {
      // Rollback to the pre-optimistic value first, then try a refresh.
      // If refresh also fails, the rollback already restored a sane state.
      setAssistStatus(prev => prev ? { ...prev, [agent]: { ...prev[agent], config: previousConfig } } : prev);
      alert(`Failed to update ${agent} config: ${e.message}`);
      refreshAssistStatus();
    }
  };
  // handleDaemonControl was used by the now-removed Start/Stop Daemon button.
  // The host-side daemon has been replaced by the perry-worker container.

  // Worker-target controls. Sets/clears meta['worker_target_<slug>'] on the
  // backend. WorkerCoordinator (inside perry) polls that and POSTs spawn
  // requests to perry-worker to hit the target, then archives remaining
  // open tasks.
  const handleSetWorkerTarget = async () => {
    const slug = auditPenSlug || 'a-perry';
    const t = parseInt(targetInput, 10);
    if (!Number.isFinite(t) || t <= 0) {
      alert('Enter a positive integer.');
      return;
    }
    try {
      setTargetBusy(true);
      const r = await fetch(`${API_BASE}/system/worker-target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, target: t, agent: agentInput, maxWorkers: maxWorkersInput ? parseInt(maxWorkersInput, 10) : undefined }),
      });
      if (!r.ok) throw new Error(await r.text());
      // refresh immediately so the panel shows the new target without waiting
      // for the next poll tick.
      const updated = await fetch(`${API_BASE}/system/worker-target?slug=${slug}`).then(x => x.json());
      setTargetInfo(updated);
      setTargetInput('');
    } catch (e: any) {
      alert(`Failed to set target: ${e.message}`);
    } finally {
      setTargetBusy(false);
    }
  };

  const handlePoolAudit = async () => {
    const slug = auditPenSlug;
    try {
      setPoolAuditBusy(true);
      const r = await fetch(`${API_BASE}/system/pool-audit?slug=${slug}&file=both`);
      if (!r.ok) throw new Error(await r.text());
      setPoolAudit(await r.json());
    } catch (e: any) {
      alert(`Pool audit failed: ${e.message}`);
    } finally {
      setPoolAuditBusy(false);
    }
  };

  const handleScrubPool = async () => {
    const slug = auditPenSlug;
    const lk = poolAudit?.reports.reduce((a, r) => a + r.leaked, 0) ?? 0;
    const vmSoft = poolAudit?.voiceMatch?.overall.soft ?? 0;
    const vmHard = poolAudit?.voiceMatch?.overall.hard ?? 0;
    const total = lk + vmSoft + vmHard;
    if (!confirm(
      `Scrub ${total} issue${total === 1 ? '' : 's'} from ${slug}/claude_injected.jsonl + ${slug}/training_data.jsonl?\n\n` +
      `Will drop:\n` +
      `  • ${lk} leaked pair${lk === 1 ? '' : 's'} (filter verbs / named emotions / clichés / first-person)\n` +
      `  • ${vmSoft} soft voice-match fail${vmSoft === 1 ? '' : 's'} (composite z-dist 4–7σ from pen corpus)\n` +
      `  • ${vmHard} hard voice-match fail${vmHard === 1 ? '' : 's'} (composite z-dist > 7σ)\n\n` +
      `After scrub, the manifest will auto-refill the deficit by enqueueing\n` +
      `replacement tasks (via _fill_manifest.py). Workers pick them up next.\n\n` +
      `Originals are saved as .bak-<timestamp> in the pen training dir — safe to roll back.`
    )) return;
    try {
      setScrubBusy(true);
      const r = await fetch(`${API_BASE}/system/pool-scrub`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, file: 'both' }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setScrubResult(data);
      // Re-run audit so the displayed numbers reflect the scrubbed pool.
      try {
        const a = await fetch(`${API_BASE}/system/pool-audit?slug=${slug}&file=both`);
        if (a.ok) setPoolAudit(await a.json());
      } catch { /* ignore */ }
    } catch (e: any) {
      alert(`Scrub failed: ${e.message}`);
    } finally {
      setScrubBusy(false);
    }
  };

  const handlePoolTag = async () => {
    const slug = auditPenSlug;
    if (!tagPenChoice.trim()) {
      alert('Pick a pen to tag the untagged rows with.');
      return;
    }
    if (!confirm(
      `Tag every untagged row in ${slug}/training_data.jsonl with pen "${tagPenChoice}"?\n\n` +
      'Original file is backed up to .bak-pretag-<timestamp> first.'
    )) return;
    try {
      setTagBusy(true);
      const r = await fetch(`${API_BASE}/system/pool-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, penSlug: tagPenChoice.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setTagResult(data);
      // Re-run audit so the untagged count drops to 0.
      try {
        const a = await fetch(`${API_BASE}/system/pool-audit?slug=${slug}&file=both`);
        if (a.ok) setPoolAudit(await a.json());
      } catch { /* ignore */ }
    } catch (e: any) {
      alert(`Pen tagging failed: ${e.message}`);
    } finally {
      setTagBusy(false);
    }
  };

  const handleCancelWorkerTarget = async () => {
    const slug = auditPenSlug || 'a-perry';
    if (!confirm('Cancel the worker target? In-flight workers will keep running until they self-exit on the next empty claim.')) return;
    try {
      setTargetBusy(true);
      const r = await fetch(`${API_BASE}/system/worker-target?slug=${slug}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      const updated = await fetch(`${API_BASE}/system/worker-target?slug=${slug}`).then(x => x.json());
      setTargetInfo(updated);
    } catch (e: any) {
      alert(`Failed to cancel target: ${e.message}`);
    } finally {
      setTargetBusy(false);
    }
  };

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
        .catch(() => { });
    } catch (e: any) {
      console.error('Failed to swap model', e);
      alert(`Failed to swap model: ${e.message}`);
    } finally {
      setIsSwappingModel(null);
    }
  };

  const fetchData = async () => {
    try {
      // Templates moved to a one-shot effect at boot (see useEffect below).
      // They don't change after compile time, so re-fetching them on every
      // SSE event was just burning the network.
      const [projRes, sysRes, telemetryRes] = await Promise.all([
        fetch(`${API_BASE}/projects`),
        fetch(`${API_BASE}/system/status`),
        fetch(`${API_BASE}/agents/telemetry-stats`).catch(() => null),
      ]);
      const projData = await projRes.json();
      setProjects(projData);
      setSystemStatus(await sysRes.json());

      if (telemetryRes && telemetryRes.ok) {
        const telemetryData = await telemetryRes.json();
        setAgentsCount(telemetryData.agentsCount || 0);
        setDomainsCount(telemetryData.domainsCount || 0);
        setDoneCount(telemetryData.doneCount || 0);
        setActiveCount(telemetryData.activeCount || 0);
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
        context: {}
      });
      setActiveTab('pipeline');
    } catch (err) {
      console.error("Failed to create project", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleGenerateTemplate = async () => {
    if (!selectedProject) return;
    if (!confirm(`Do you want to evolve this project "${selectedProject.title}" into a reusable template? This will create a template for the ${selectedProject.workType || 'books'} domain and register an AI template skill.`)) return;
    setIsGeneratingTemplate(true);
    try {
      const res = await fetch(`${API_BASE}/projects/${selectedProject.id}/generate-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate template');
      alert(`Successfully evolved to template: ${data.templateName}!\nA skill "${data.skillName}" has been assigned to the ${data.domainId} domain.`);
      // Refresh templates
      const templatesRes = await fetch(`${API_BASE}/system/templates`);
      if (templatesRes.ok) {
        const tData = await templatesRes.json();
        setTemplates(tData);
      }
    } catch (err: any) {
      alert(`Error generating template: ${err.message}`);
    } finally {
      setIsGeneratingTemplate(false);
    }
  };

  // Load audit verdicts for the selected project. Refreshes when any step
  // completes (so newly-landed audit results show up promptly).
  const fetchStepVerdicts = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`${API_BASE}/system/audit/project/${projectId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.verdicts) setStepVerdicts(data.verdicts);
    } catch (err) {
      console.error('Failed to fetch step verdicts', err);
    }
  }, []);

  useEffect(() => {
    if (!selectedProject) { setStepVerdicts({}); return; }
    fetchStepVerdicts(selectedProject.id);
    const intervalId = setInterval(() => fetchStepVerdicts(selectedProject.id), 15_000);
    return () => clearInterval(intervalId);
  }, [selectedProject, fetchStepVerdicts]);

  // Admin Operations Handlers
  const handleAdminEvolveProject = async () => {
    if (!adminEvolveProjectId) return;
    const targetProject = projects.find(p => p.id === adminEvolveProjectId);
    if (!targetProject) return;
    if (!confirm(`Do you want to evolve the project "${targetProject.title}" into a reusable template? This will create a template for the ${targetProject.workType || 'books'} domain and register an AI template skill.`)) return;
    
    setIsGeneratingTemplate(true);
    try {
      const res = await fetch(`${API_BASE}/projects/${targetProject.id}/generate-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate template');
      alert(`Successfully evolved to template: ${data.templateName}!\nA skill "${data.skillName}" has been assigned to the ${data.domainId} domain.`);
      
      // Refresh templates
      const templatesRes = await fetch(`${API_BASE}/system/templates`);
      if (templatesRes.ok) {
        const tData = await templatesRes.json();
        setTemplates(tData);
      }
      setAdminEvolveProjectId('');
    } catch (err: any) {
      alert(`Error generating template: ${err.message}`);
    } finally {
      setIsGeneratingTemplate(false);
    }
  };

  const handleAdminEvolveWorkType = () => {
    setEvolveTemplateName('');
    setEvolveTemplateDesc('');
    setEvolvePipelineGoal('');
    setEvolveWorkersMode('smart');
    setIsEvolveModalOpen(true);
  };

  const handleAdminEvolveWorkTypeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evolveTemplateName.trim() || !evolvePipelineGoal.trim()) {
      alert('Template Name and Pipeline Goal are required.');
      return;
    }

    setEvolveLogs([`[${new Date().toLocaleTimeString()}] Initializing guided evolve request...`]);
    setAssessmentResult(null);
    setAssessmentError(null);
    setAssessmentStatus('');
    setIsEvolvingTemplate(true);
    try {
      const res = await fetch(`${API_BASE}/domains/evolve-worktype-to-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workType: adminEvolveWorkType,
          name: evolveTemplateName,
          description: evolveTemplateDesc,
          pipelineGoal: evolvePipelineGoal,
          workersMode: evolveWorkersMode
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to evolve template');

      alert(`Successfully evolved work type "${adminEvolveWorkType}" to template: ${data.templateName}!\nA skill "${data.skillName}" has been assigned to the ${data.domainId} domain.`);

      // Refresh templates
      const templatesRes = await fetch(`${API_BASE}/system/templates`);
      if (templatesRes.ok) {
        const tData = await templatesRes.json();
        setTemplates(tData);
      }
      setIsEvolveModalOpen(false);
    } catch (err: any) {
      alert(`Error evolving template: ${err.message}`);
    } finally {
      setIsEvolvingTemplate(false);
    }
  };

  const handleIntelligentEvolve = async () => {
    if (!confirm(`Do you want to intelligently create a custom template for the "${adminIntelligentWorkType}" domain? This will perform web research for domain best-practices and generate optimized template steps.`)) return;

    setEvolveLogs([`[${new Date().toLocaleTimeString()}] Initializing intelligent evolve request...`]);
    setAssessmentResult(null);
    setAssessmentError(null);
    setAssessmentStatus('');
    setIsIntelligentlyEvolving(true);
    try {
      const res = await fetch(`${API_BASE}/domains/intelligent-evolve-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workType: adminIntelligentWorkType,
          enableSearch: isIntelligentEnableSearch,
          evolutionTarget: adminIntelligentTarget,
          workersMode: 'smart'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to intelligently generate template');

      alert(`Successfully created template: ${data.templateName}!\nAssigned skill "${data.skillName}" to the ${data.domainId} domain.`);

      // Refresh templates
      const templatesRes = await fetch(`${API_BASE}/system/templates`);
      if (templatesRes.ok) {
        const tData = await templatesRes.json();
        setTemplates(tData);
      }
    } catch (err: any) {
      alert(`Error during intelligent template generation: ${err.message}`);
    } finally {
      setIsIntelligentlyEvolving(false);
    }
  };

  const handleInstallProposedSkills = async () => {
    if (!assessmentResult?.suggestedNewSkills || assessmentResult.suggestedNewSkills.length === 0) return;
    setInstallingSkills(true);
    setInstallSuccessMessage(null);
    try {
      let count = 0;
      for (const skill of assessmentResult.suggestedNewSkills) {
        const res = await fetch(`${API_BASE}/domains/install-skill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: skill.name,
            description: skill.description,
            service: adminEvolveWorkType,
            body: skill.body
          })
        });
        if (!res.ok) {
          const data = await res.json();
          if (res.status !== 409) {
            throw new Error(data.error || `Failed to install skill ${skill.name}`);
          }
        } else {
          count++;
        }
      }
      setInstallSuccessMessage(`Successfully installed ${count} new custom skill playbooks to ${adminEvolveWorkType} domain!`);
    } catch (err: any) {
      alert(`Error installing skills: ${err.message}`);
    } finally {
      setInstallingSkills(false);
    }
  };

  useEffect(() => {
    if (!assessmentSessionId || !isAssessing) return;
    
    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/domains/assess-playbook/status/${assessmentSessionId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        if (data.status === 'completed') {
          setAssessmentResult(data.result);
          setIsAssessing(false);
          setAssessmentSessionId(null);
        } else if (data.status === 'failed') {
          setAssessmentError(data.error || 'Playbook assessment failed');
          setIsAssessing(false);
          setAssessmentSessionId(null);
        } else {
          setAssessmentStatus(prev => {
            if (prev.endsWith('...')) return prev.slice(0, -3) + '..';
            if (prev.endsWith('..')) return prev.slice(0, -2) + '.';
            return prev + '..';
          });
        }
      } catch (err: any) {
        setAssessmentError(err.message || 'Error checking assessment status');
        setIsAssessing(false);
        setAssessmentSessionId(null);
      }
    }, 2000);
    
    return () => clearInterval(intervalId);
  }, [assessmentSessionId, isAssessing, adminEvolveWorkType]);

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

  // Width of the left chat column when docked — used both for the chat panel
  // itself and the main-content padding so the panels don't overlap.
  const chatColumnWidth = chatOpen && chatMode === 'docked'
    ? `clamp(280px, ${chatDockedWidth}px, calc(100vw - var(--left-nav-w) - 280px))`
    : '0px';

  return (
    <>
      {!booted && <BootScreen onComplete={handleBootComplete} />}
      <div className="app-container" style={{
        position: 'relative',
        paddingLeft: chatOpen && chatMode === 'docked'
          ? `calc(var(--left-nav-w) + ${chatColumnWidth})`
          : 'var(--left-nav-w)',
        transition: 'padding-left 0.2s ease',
      }}>
      {/* Top status bar — slim 36px chrome with brand, container health,
          active pen, uptime. Always visible across every screen. */}
      <TopStatusBar
        activePen={(selectedProject as any)?.metadata?.pen || (selectedProject as any)?.pen_slug}
        agentsCount={agentsCount}
        domainsCount={domainsCount}
        activeCount={activeCount}
        doneCount={doneCount}
      />

      {/* Left navigation — Discord-style vertical sidebar pinned to the left
          edge. Replaces the BridgePlanet metaphor with a conventional rail
          that's familiar to any user. */}
      <LeftNav
        activeTab={(['fleet', 'projects', 'workers', 'trajectories', 'analytics', 'models', 'self-learning', 'secrets', 'system', 'domains', 'operator', 'cron', 'integrations', 'goals'].includes(activeTab) ? activeTab : 'fleet') as NavTab}
        onSelectTab={(t) => setActiveTab(t as TabId)}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(o => !o)}
      />

      {/* Chat panel — top-level so it's reachable on every tab, not just
          Fleet. Docked mode sits as a fixed column between LeftNav and the
          main content; floating mode renders itself wherever the user
          dragged it last. */}
      {chatOpen && chatMode === 'docked' && (
        <div style={{
          position: 'fixed',
          top: 'var(--top-bar-h)',
          left: 'var(--left-nav-w)',
          bottom: 0,
          width: chatColumnWidth,
          zIndex: 75,
          padding: '12px 0 12px 12px',
          boxSizing: 'border-box',
        }}>
          <LandingChat
            mode="docked"
            onModeChange={setChatMode}
            collapsed={chatCollapsed}
            onCollapsedChange={setChatCollapsed}
            dockedWidth={chatDockedWidth}
            onDockedWidthChange={setChatDockedWidth}
            onClose={() => setChatOpen(false)}
          />
        </div>
      )}
      {chatOpen && chatMode === 'floating' && (
        <LandingChat
          mode="floating"
          onModeChange={setChatMode}
          collapsed={false}
          onCollapsedChange={setChatCollapsed}
          dockedWidth={chatDockedWidth}
          onDockedWidthChange={setChatDockedWidth}
          onClose={() => setChatOpen(false)}
        />
      )}

      {/* Back-to-Fleet floating button removed — the Fleet entry in LeftNav
          now handles this navigation uniformly with every other panel. */}

      {/* Backdrop — clicking outside closes the sidebar */}
      {/* Projects panel — uniform with Trajectories/Models/Secrets. Renders
          inline inside the main content area when activeTab === 'projects'.
          The slide-in/backdrop overlay pattern has been retired. */}
      {activeTab === 'projects' && (
      <aside className="projects-panel" style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 'var(--top-bar-h)',
        // Shift right when chat is docked so the panel doesn't slide under it.
        left: chatOpen && chatMode === 'docked'
          ? `calc(var(--left-nav-w) + ${chatColumnWidth})`
          : 'var(--left-nav-w)',
        bottom: 0,
        right: 0,
        width: 'auto',  // override .sidebar's 260px
        zIndex: 70,
        background: 'radial-gradient(ellipse at center, #0a0e1f 0%, #050714 70%, #000000 100%)',
        borderRight: 'none',
        transition: 'left 0.2s ease',
      }}>
        {/* Top header strip — eyebrow + title + close */}
        <div style={{
          padding: '20px 28px 18px',
          borderBottom: '1px solid var(--panel-border)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          gap: 24,
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>P.E.R.R.Y. // Projects</div>
            <h2 style={{
              fontSize: '1.35rem', fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.2,
              color: 'var(--text-main)', margin: 0,
            }}>Workspace</h2>
            <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Pick a work type on the left, or jump straight into a project.
            </div>
          </div>
          <button
            onClick={() => setActiveTab('fleet')}
            title="Close projects panel"
            aria-label="Close projects panel"
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'transparent',
              border: '1px solid var(--panel-border)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-sans)', fontSize: '1rem',
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e: any) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent-border)'; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--panel-border)'; }}
          >✕</button>
        </div>

        {/* Two-column body: work types | projects list */}
        <div style={{
          flex: 1, minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(180px, 240px) minmax(0, 1fr)',
          gap: 0,
        }}>
          {/* Work types (left) */}
          <div style={{
            borderRight: '1px solid var(--panel-border)',
            padding: '18px 16px',
            overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div className="eyebrow" style={{ marginBottom: 8, paddingLeft: 6 }}>Work types</div>
            {([
              { id: 'meta',    label: 'Meta / admin', icon: '◉',  color: '#E2E8F0' },
              { id: 'all',     label: 'All projects', icon: '✦',  color: 'var(--accent)' },
              { id: 'code',    label: 'Code',         icon: '⌬',  color: '#7CFC00' },
              { id: 'books',   label: 'Books',        icon: '📖', color: '#22d3ee' },
              { id: 'dnd',     label: 'D&D',          icon: '🎲', color: '#ef4444' },
              { id: 'email',   label: 'Email',        icon: '✉',  color: '#22D3EE' },
              { id: 'hacking', label: 'Hacking',      icon: '⌖',  color: '#FF6B6B' },
            ] as const).map(t => {
              const count = (() => {
                if (t.id === 'all') return projects.length;
                return projects.filter(p => inferProjectWorkType(p) === t.id).length;
              })();
              const active = projectWorkType === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setProjectWorkType(t.id as WorkType)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: 8,
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    border: `1px solid ${active ? 'var(--accent-border)' : 'transparent'}`,
                    color: active ? 'var(--accent)' : 'var(--text-main)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)', fontSize: '0.88rem', fontWeight: 500,
                    transition: 'all 0.15s ease',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e: any) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={(e: any) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: t.color, fontSize: '0.95rem', width: 16, textAlign: 'center' }}>{t.icon}</span>
                    <span>{t.label}</span>
                  </span>
                  <span style={{
                    fontSize: '0.7rem', color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                    minWidth: 18, textAlign: 'right',
                  }}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Project list or Admin Buttons (right) */}
          <div style={{ padding: '18px 24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{
                fontFamily: 'monospace',
                fontSize: '0.6rem',
                color: '#9BA4B5',
                textTransform: 'uppercase',
                letterSpacing: '0.2em',
                margin: 0,
              }}>
                {projectWorkType === 'meta' ? '// ADMIN BUTTONS' : '// PROJECTS'}
              </h3>
              
              {projectWorkType !== 'meta' && (
                <button
                  onClick={() => {
                    const filtered = templates.filter(t => projectWorkType === 'all' || t.workType === projectWorkType);
                    setNewProject(prev => ({
                      ...prev,
                      type: filtered[0]?.type || templates[0]?.type || ''
                    }));
                    setIsCreateModalOpen(true);
                  }}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.65rem',
                    fontFamily: 'monospace',
                    background: 'rgba(168,85,247,0.15)',
                    color: '#A855F7',
                    border: '1px solid rgba(168,85,247,0.4)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    letterSpacing: '0.1em',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Plus size={12} /> NEW
                </button>
              )}
            </div>

            {projectWorkType === 'meta' ? (
              /* Admin Buttons Layout */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div className="glass-panel" style={{ padding: '1rem', border: '1px solid rgba(155, 164, 181, 0.15)', background: 'rgba(255, 255, 255, 0.02)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <Cpu size={16} color="var(--accent)" />
                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'white' }}>Meta Operations & System Tuning</span>
                  </div>
                  <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>
                    Execute administrative commands to self-assess the workspace, evolve domain playbooks, and promote active projects into reusable templates.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                  {/* Action 1: Evolve to Template */}
                  <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', border: '1px solid var(--panel-border)', background: 'rgba(10,14,31,0.4)' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <Sparkles size={16} color="#A855F7" />
                        <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'white', fontFamily: 'monospace' }}>EVOLVE PROJECT TO TEMPLATE</h4>
                      </div>
                      <p className="text-muted" style={{ fontSize: '0.7rem', margin: 0 }}>
                        Compile the pipeline steps and prompts from an existing project into a reusable template.
                      </p>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: 'auto' }}>
                      <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>SELECT TARGET PROJECT</label>
                      <select
                        value={adminEvolveProjectId}
                        onChange={(e) => setAdminEvolveProjectId(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.4rem',
                          borderRadius: '4px',
                          border: '1px solid var(--panel-border)',
                          background: 'var(--bg-main)',
                          color: 'white',
                          fontSize: '0.75rem',
                          outline: 'none'
                        }}
                      >
                        <option value="">-- Choose a project --</option>
                        {projects
                          .filter(p => p.type !== 'system-evolution' && p.type !== 'template-generator')
                          .map(p => (
                            <option key={p.id} value={p.id}>{p.title} ({p.type})</option>
                          ))}
                      </select>
                      
                      <button
                        className="btn btn-primary"
                        onClick={handleAdminEvolveProject}
                        disabled={!adminEvolveProjectId || isGeneratingTemplate}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.5rem',
                          fontFamily: 'monospace',
                          background: 'rgba(168,85,247,0.2)',
                          color: '#C084FC',
                          border: '1px solid rgba(168,85,247,0.5)',
                          marginTop: '0.25rem'
                        }}
                      >
                        {isGeneratingTemplate ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} EVOLVE TO TEMPLATE
                      </button>
                    </div>
                  </div>

                  {/* Action 2: Evolve WorkType to Template */}
                  <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', border: '1px solid var(--panel-border)', background: 'rgba(10,14,31,0.4)' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <Cpu size={16} color="var(--accent)" />
                        <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'white', fontFamily: 'monospace' }}>EVOLVE WORKTYPE TO TEMPLATE</h4>
                      </div>
                      <p className="text-muted" style={{ fontSize: '0.7rem', margin: 0 }}>
                        Evolve a domain work type into a custom template. Perry will structure the steps and route them to standard workers, GPUs, or ComfyUI.
                      </p>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: 'auto' }}>
                      <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>SELECT WORK TYPE</label>
                      <select
                        value={adminEvolveWorkType}
                        onChange={(e) => setAdminEvolveWorkType(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.4rem',
                          borderRadius: '4px',
                          border: '1px solid var(--panel-border)',
                          background: 'var(--bg-main)',
                          color: 'white',
                          fontSize: '0.75rem',
                          outline: 'none'
                        }}
                      >
                        <option value="books">Books</option>
                        <option value="code">Code</option>
                        <option value="dnd">D&D</option>
                        <option value="email">Email</option>
                        <option value="hacking">Hacking</option>
                      </select>
                      
                      <button
                        className="btn btn-primary"
                        onClick={handleAdminEvolveWorkType}
                        disabled={isEvolvingTemplate}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.5rem',
                          fontFamily: 'monospace',
                          background: 'rgba(34,211,238,0.15)',
                          color: '#22d3ee',
                          border: '1px solid rgba(34,211,238,0.4)',
                          marginTop: '0.25rem'
                        }}
                      >
                        {isEvolvingTemplate ? <Loader2 size={12} className="animate-spin" /> : <Cpu size={12} />} EVOLVE WORKTYPE
                      </button>
                    </div>
                  </div>

                  {/* Action 3: Intelligent Project & Work Type Evolution */}
                  <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', border: '1px solid var(--panel-border)', background: 'rgba(10,14,31,0.4)' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <Sparkles size={16} color="#10B981" />
                        <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'white', fontFamily: 'monospace' }}>INTELLIGENT EVOLVE</h4>
                      </div>
                      <p className="text-muted" style={{ fontSize: '0.7rem', margin: 0 }}>
                        Generate an optimized custom template for a work type (e.g. D&D) using web search context.
                      </p>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: 'auto' }}>
                      <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>SELECT WORK TYPE</label>
                      <select
                        value={adminIntelligentWorkType}
                        onChange={(e) => setAdminIntelligentWorkType(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.4rem',
                          borderRadius: '4px',
                          border: '1px solid var(--panel-border)',
                          background: 'var(--bg-main)',
                          color: 'white',
                          fontSize: '0.75rem',
                          outline: 'none'
                        }}
                      >
                        <option value="dnd">D&D</option>
                        <option value="books">Books</option>
                        <option value="code">Code</option>
                        <option value="email">Email</option>
                        <option value="hacking">Hacking</option>
                        <option value="meta">Meta</option>
                      </select>

                      <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>SELECT COMPUTE SOURCE</label>
                      <select
                        value={adminIntelligentTarget}
                        onChange={(e) => setAdminIntelligentTarget(e.target.value as any)}
                        style={{
                          width: '100%',
                          padding: '0.4rem',
                          borderRadius: '4px',
                          border: '1px solid var(--panel-border)',
                          background: 'var(--bg-main)',
                          color: 'white',
                          fontSize: '0.75rem',
                          outline: 'none'
                        }}
                      >
                        <option value="workers">Workers (Cloud API - Claude/Gemini)</option>
                        <option value="gpu">GPU (Local Ollama/Librarian)</option>
                      </select>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.25rem 0' }}>
                        <input
                          type="checkbox"
                          id="enableSearchCheckbox"
                          checked={isIntelligentEnableSearch}
                          onChange={(e) => setIntelligentEnableSearch(e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                        <label htmlFor="enableSearchCheckbox" style={{ fontSize: '0.7rem', color: 'white', cursor: 'pointer', fontFamily: 'monospace' }}>
                          Enable Web Search Context
                        </label>
                      </div>
                      
                      <button
                        className="btn btn-primary"
                        onClick={handleIntelligentEvolve}
                        disabled={isIntelligentlyEvolving}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.5rem',
                          fontFamily: 'monospace',
                          background: 'rgba(16,185,129,0.15)',
                          color: '#10B981',
                          border: '1px solid rgba(16,185,129,0.4)',
                          marginTop: '0.25rem'
                        }}
                      >
                        {isIntelligentlyEvolving ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} INTELLIGENT EVOLVE
                      </button>
                    </div>
                  </div>
                </div>

                {/* Console / Diagnostics View */}
                {(isAssessing || assessmentStatus || assessmentResult || assessmentError || isIntelligentlyEvolving || isEvolvingTemplate || evolveLogs.length > 0) && (
                  <div className="glass-panel" style={{
                    padding: '1.25rem',
                    border: '1px solid var(--panel-border)',
                    background: 'rgba(5,7,17,0.85)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.7rem', color: '#9BA4B5', fontWeight: 600, fontFamily: 'monospace' }}>
                        {isIntelligentlyEvolving || isEvolvingTemplate || evolveLogs.length > 0 ? 'TEMPLATE EVOLUTION PROCESS' : 'CONSOLE DIAGNOSTICS & TUNING'}
                      </span>
                      {isAssessing || isIntelligentlyEvolving || isEvolvingTemplate ? (
                        <span style={{ fontSize: '0.65rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.25rem', fontFamily: 'monospace' }}>
                          <Loader2 size={10} className="animate-spin" /> {isIntelligentlyEvolving || isEvolvingTemplate ? 'EVOLVING TEMPLATE' : 'AUDITING DOMAIN'}
                        </span>
                      ) : assessmentError ? (
                        <span style={{ fontSize: '0.65rem', color: 'var(--danger)', fontWeight: 600, fontFamily: 'monospace' }}>FAILED</span>
                      ) : (
                        <span style={{ fontSize: '0.65rem', color: 'var(--success)', fontWeight: 600, fontFamily: 'monospace' }}>COMPLETE</span>
                      )}
                    </div>

                    {/* Scrolling terminal window */}
                    <div style={{
                      background: 'black',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      fontFamily: 'monospace',
                      fontSize: '0.7rem',
                      color: '#4ADE80',
                      maxHeight: '240px',
                      overflowY: 'auto',
                      border: '1px solid rgba(255,255,255,0.05)',
                      lineHeight: '1.4'
                    }}>
                      {evolveLogs.length > 0 ? (
                        evolveLogs.map((logLine, idx) => {
                          const isError = logLine.includes('ERROR:');
                          const isSuccess = logLine.includes('Successfully created') || logLine.includes('generation complete') || logLine.includes('evolution complete') || logLine.includes('template "');
                          return (
                            <div key={idx} style={{ color: isError ? 'var(--danger)' : isSuccess ? '#34D399' : '#4ADE80' }}>
                              &gt; {logLine}
                            </div>
                          );
                        })
                      ) : (
                        <>
                          <div>&gt; Initializing workspace self-assessment context...</div>
                          {assessmentStatus && <div>&gt; {assessmentStatus}</div>}
                          {isAssessing && <div>&gt; Dispatching agent meta.playbook-analyst to subscription workers...</div>}
                          {isAssessing && <div>&gt; Performing search indices checks & drift scoring...</div>}
                          {assessmentError && <div style={{ color: 'var(--danger)' }}>&gt; ERROR: {assessmentError}</div>}
                          {assessmentResult && (
                            <>
                              <div style={{ color: '#60A5FA' }}>&gt; Diagnosis complete. Successfully retrieved payload from playbook-analyst.</div>
                              <div style={{ color: 'white', marginTop: '0.25rem' }}>
                                {assessmentResult.domainAnalysis?.summary}
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>

                    {/* Assessment results - interactive list of skills to install */}
                    {assessmentResult && (
                      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                        
                        {/* Domain Analysis stats */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', fontSize: '0.7rem' }}>
                          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ color: 'var(--text-muted)' }}>RECOMMENDED TEAM</div>
                            <div style={{ color: 'white', fontSize: '0.85rem', fontWeight: 600, marginTop: '2px' }}>
                              {assessmentResult.domainAnalysis?.suggestedTeamSize || 2} Agents
                            </div>
                          </div>
                          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ color: 'var(--text-muted)' }}>REQUIRED MCP SERVERS</div>
                            <div style={{ color: 'white', fontSize: '0.8rem', fontWeight: 600, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {assessmentResult.domainAnalysis?.requiredMcpServers?.join(', ') || 'None'}
                            </div>
                          </div>
                        </div>

                        {/* List of recommended existing skills */}
                        {assessmentResult.recommendedSkills && assessmentResult.recommendedSkills.length > 0 && (
                          <div>
                            <div style={{ fontSize: '0.65rem', color: '#9BA4B5', fontWeight: 600, fontFamily: 'monospace', marginBottom: '0.25rem' }}>RECOMMENDED EXISTING SKILLS</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              {assessmentResult.recommendedSkills.map((sk: any, i: number) => (
                                <div key={i} style={{ fontSize: '0.7rem', padding: '0.35rem', background: 'rgba(255,255,255,0.02)', borderLeft: '2px solid var(--accent)', display: 'flex', flexDirection: 'column' }}>
                                  <span style={{ color: 'white', fontWeight: 500 }}>{sk.name}</span>
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{sk.reason}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* List of suggested new skills */}
                        {assessmentResult.suggestedNewSkills && assessmentResult.suggestedNewSkills.length > 0 && (
                          <div>
                            <div style={{ fontSize: '0.65rem', color: '#9BA4B5', fontWeight: 600, fontFamily: 'monospace', marginBottom: '0.25rem' }}>
                              SYNTHESIZED PLAYBOOK SKILLS ({assessmentResult.suggestedNewSkills.length})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              {assessmentResult.suggestedNewSkills.map((sk: any, i: number) => (
                                <div key={i} style={{ background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                    <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.75rem', fontFamily: 'monospace' }}>{sk.name}</span>
                                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>proposed playbook</span>
                                  </div>
                                  <div style={{ fontSize: '0.68rem', color: 'white', marginBottom: '0.4rem' }}>{sk.description}</div>
                                  
                                  {/* Playbook Body Code Block */}
                                  <pre style={{
                                    background: 'rgba(0,0,0,0.5)',
                                    padding: '0.4rem',
                                    borderRadius: '3px',
                                    fontSize: '0.65rem',
                                    color: '#A78BFA',
                                    overflowX: 'auto',
                                    maxHeight: '120px',
                                    margin: 0,
                                    border: '1px solid rgba(255,255,255,0.03)'
                                  }}><code>{sk.body}</code></pre>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Success message / Install button */}
                        {installSuccessMessage ? (
                          <div style={{
                            padding: '0.5rem',
                            background: 'rgba(16,185,129,0.1)',
                            border: '1px solid rgba(16,185,129,0.3)',
                            color: '#34D399',
                            fontSize: '0.72rem',
                            borderRadius: '4px',
                            textAlign: 'center',
                            fontFamily: 'monospace'
                          }}>
                            ✓ {installSuccessMessage}
                          </div>
                        ) : (
                          <button
                            className="btn btn-primary"
                            onClick={handleInstallProposedSkills}
                            disabled={installingSkills || !assessmentResult.suggestedNewSkills || assessmentResult.suggestedNewSkills.length === 0}
                            style={{
                              fontSize: '0.75rem',
                              padding: '0.6rem',
                              fontFamily: 'monospace',
                              background: 'rgba(16,185,129,0.2)',
                              color: '#34D399',
                              borderColor: 'rgba(16,185,129,0.4)',
                              marginTop: '0.5rem'
                            }}
                          >
                            {installingSkills ? <Loader2 size={12} className="animate-spin" /> : '✓ INSTALL SYNTHESIZED PLAYBOOKS'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Standard Projects List Layout */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {projects
              .filter(p => !p.parentId)
              .filter(p => projectWorkType === 'all' || inferProjectWorkType(p) === projectWorkType)
              .map(p => (
              <React.Fragment key={p.id}>
                {/* Parent Project — sci-fi card */}
                <div
                  onClick={() => { setSelectedProject(p); setActiveTab('pipeline'); }}
                  style={{
                    padding: '0.65rem 0.75rem',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: '0.78rem',
                    background: selectedProject?.id === p.id ? 'rgba(168,85,247,0.12)' : 'rgba(10,14,31,0.6)',
                    color: '#E2E8F0',
                    transition: 'all 0.15s ease',
                    border: '1px solid',
                    borderColor: selectedProject?.id === p.id ? 'rgba(168,85,247,0.5)' : 'rgba(155,164,181,0.12)',
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


                </div>

                {/* Child Projects (Sub-projects) */}
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
                No projects yet.<br />Click "New" to start one.
              </div>
            )}
            {projects.length > 0 && projects.filter(p => !p.parentId && (projectWorkType === 'all' || inferProjectWorkType(p) === projectWorkType)).length === 0 && (
              <div style={{
                textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem',
                padding: '24px 16px',
              }}>
                No projects match this work type yet.
              </div>
            )}
          </div>
        )}
      </div>{/* close right column */}
    </div>{/* close 2-col grid */}


      </aside>
      )}

      {/* Main Content */}
      <main className="main-content" style={{
        // Bridge-aesthetic: every global view (Fleet, Trajectories, Models,
        // Secrets) runs edge-to-edge. The panels manage their own internal
        // padding. Project views keep the conventional 2rem gutter so the
        // long-form pipeline UI stays readable.
        padding: GLOBAL_TAB_IDS.has(activeTab) ? 0 : '2rem 2rem 2rem 2rem',
        paddingTop: GLOBAL_TAB_IDS.has(activeTab) ? 36 : 'calc(2rem + 20px)',
        width: '100%',
        height: GLOBAL_TAB_IDS.has(activeTab) ? '100vh' : undefined,
      }}>
        {/* No project selected → either land on the welcome OR render a
            global panel directly (Fleet / Secrets / Trajectories / etc.).
            Workers is rendered separately below since it lives in the
            project-style block. */}
        {!selectedProject && !GLOBAL_TAB_IDS.has(activeTab) && activeTab !== 'workers' && (
          <div className="animate-fade-in">
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ marginBottom: '0.5rem' }}>Welcome to the P.E.R.R.Y. System</h2>
              <p className="text-muted" style={{ marginBottom: '1rem' }}>
                Select a project from the sidebar to manage it — or explore the system below.
              </p>
              {/* Slim global-tabs strip so the user can jump to Fleet / Secrets / etc.
                  without first selecting a project. */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {availableTabs.filter(t => t.global).map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    style={{
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '6px',
                      padding: '10px 16px',
                      color: 'var(--text)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.875rem',
                    }}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Global tab content WITHOUT requiring a project. Navigation lives
            entirely in the LeftNav — no in-panel
            tab strip. Panels render edge-to-edge for the bridge aesthetic. */}
        {GLOBAL_TAB_IDS.has(activeTab) && (
          <div className="animate-fade-in" style={{ height: 'calc(100vh - 36px)', width: '100%' }}>
            {activeTab === 'fleet' && (
              <div style={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <FleetHeader />
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  <FleetCanvas />
                </div>
              </div>
            )}
            {activeTab === 'secrets' && <SecretsPanel />}
            {activeTab === 'trajectories' && <TrajectoriesPanel />}
            {activeTab === 'models' && <ModelsPanel />}
            {activeTab === 'self-learning' && <SelfLearningPanel />}
            {activeTab === 'analytics' && <AnalyticsPanel />}
            {activeTab === 'system' && <SystemPanel />}
            {activeTab === 'domains' && <DomainsPanel />}
            {activeTab === 'operator' && <OperatorPanel />}
            {activeTab === 'cron' && <CronPanel />}
            {activeTab === 'integrations' && <IntegrationsPanel contextStats={contextStats} />}
            {activeTab === 'goals' && <GoalsPanel selectedProject={selectedProject} onSelectProject={setSelectedProject} />}
          </div>
        )}
        <SuggestedAction />
        {(() => {
          // Wire the SuggestedAction's nav-tab event into the existing setActiveTab.
          // Mount-once listener; React's reconciliation keeps it stable.
          if (!(globalThis as any).__perryNavListenerMounted) {
            (globalThis as any).__perryNavListenerMounted = true;
            window.addEventListener('perry:nav-tab', (e: any) => {
              const tab = e?.detail?.tab;
              if (typeof tab === 'string') setActiveTab(tab as TabId);
            });
          }
          return null;
        })()}

        {(selectedProject || activeTab === 'workers') && !GLOBAL_TAB_IDS.has(activeTab) && (
          <div className="animate-fade-in">
            {/* Standalone workers header — shown when reached from the LeftNav
                rail without a project context. */}
            {!selectedProject && activeTab === 'workers' && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>P.E.R.R.Y. // Workers</div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.015em' }}>Worker pool</h2>
                <p className="text-muted" style={{ marginTop: 4, fontSize: '0.85rem' }}>
                  Spawn and monitor the subscription-CLI workers that drain the task queue.
                </p>
              </div>
            )}
            {selectedProject && (
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
            )}

            {selectedProject && (
            <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--panel-border)', marginBottom: '1.5rem', paddingBottom: '0.5rem', overflowX: 'auto' }}>
              {availableTabs.filter(tab => !tab.global).map(tab => (
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
            )}

            {/* Global Activity Banner — shows latest event across all steps */}
            {latestActivity && selectedProject && selectedProject.status === 'active' && (
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
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {selectedProject && (
                        <button
                          className="btn btn-outline"
                          onClick={handleGenerateTemplate}
                          disabled={isGeneratingTemplate}
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                          title="Evolve this project into a reusable template"
                        >
                          {isGeneratingTemplate ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} Evolve to Template
                        </button>
                      )}
                      {chatHistory.length > 0 && (
                        <button
                          className="btn btn-outline"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                          onClick={async () => {
                            if (!confirm('Are you sure you want to clear the chat history?')) return;
                            try {
                              const r = await fetch(`${API_BASE}/projects/${selectedProject!.id}/chat`, { method: 'DELETE' });
                              if (!r.ok) throw new Error(`HTTP ${r.status}`);
                              // Only clear local state AFTER server confirms — avoids
                              // showing an empty chat to the user if the DELETE failed
                              // (then a periodic refetch would re-populate, looking
                              // like a flicker / "the chat came back by itself").
                              setChatHistory([]);
                            } catch (e: any) {
                              console.error('clear chat failed', e);
                              alert(`Couldn\'t clear chat history: ${e.message || e}`);
                            }
                          }}
                          title="Clear Chat History"
                        >
                          <Trash2 size={14} /> Clear Chat
                        </button>
                      )}
                    </div>
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

                  {selectedProject!.steps.map((step: ProjectStep, index: number) => {
                    const stepFeed = getStepFeed(step.id);
                    const lastProgressMsg = stepFeed.filter(e => e.type === 'progress').slice(-1)[0];

                    return (
                      <div key={step.id} style={{ display: 'flex', position: 'relative', zIndex: 1, marginBottom: index === selectedProject!.steps.length - 1 ? 0 : '1.5rem', opacity: step.status === 'pending' ? 0.6 : 1 }}>
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
                            <h4 style={{ fontSize: '1rem', color: step.status === 'active' ? 'var(--accent)' : 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              {step.label}
                              {(() => {
                                const v = stepVerdicts[step.id];
                                if (!v) return null;
                                const a = v.audit;
                                const p = v.povVerdict;
                                const badges: Array<{ color: string; bg: string; label: string; title: string }> = [];
                                if (a) {
                                  const action = (a.action || '').toLowerCase();
                                  if (action.includes('catastrophic')) badges.push({ color: 'var(--danger)', bg: 'rgba(239,68,68,0.12)', label: '⚠ audit', title: `Audit: ${a.action}\n${a.notes || ''}` });
                                  else if (action.includes('stylistic')) badges.push({ color: 'var(--warning, #f59e0b)', bg: 'rgba(245,158,11,0.12)', label: '◐ audit', title: `Audit: ${a.action}\n${a.notes || ''}` });
                                  else badges.push({ color: 'var(--success)', bg: 'rgba(34,197,94,0.12)', label: '✓ audit', title: `Audit: ${a.action || 'accepted'}\n${a.notes || ''}` });
                                }
                                if (p) {
                                  const failed = !(p.povPassed && p.pacingPassed && p.hookPassed);
                                  badges.push({
                                    color: failed ? 'var(--warning, #f59e0b)' : 'var(--success)',
                                    bg: failed ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
                                    label: `POV ${p.povScore}/${p.pacingScore}/${p.hookScore}`,
                                    title: `POV ${p.povScore}/10 · Pacing ${p.pacingScore}/10 · Hook ${p.hookScore}/10\n${p.issues || ''}`,
                                  });
                                }
                                return badges.map((b, i) => (
                                  <span key={i} title={b.title} style={{
                                    fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px',
                                    background: b.bg, color: b.color, border: `1px solid ${b.color}`,
                                    fontWeight: 600, letterSpacing: '0.03em', cursor: 'help',
                                  }}>{b.label}</span>
                                ));
                              })()}
                            </h4>
                            <span className="text-xs text-muted" style={{ textTransform: 'uppercase' }}>{step.phase}</span>
                          </div>
                          <p className="text-sm text-muted mb-2">Task: {step.taskType}</p>

                          {/* ── Active Step: Live Progress ─────────────────────── */}
                          {step.status === 'active' && (
                            <>
                              {/* Current status line + live elapsed timer.
                                  Timer reads `tick` so it re-renders every
                                  second while this step is active; reads
                                  step.startedAt for the anchor. Falls back
                                  to the most recent feed entry's timestamp
                                  if startedAt isn't populated yet. */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent)', fontSize: '0.875rem' }}>
                                <div className="live-pulse" />
                                <span style={{ flex: 1 }}>
                                  {lastProgressMsg ? lastProgressMsg.message : 'Starting...'}
                                </span>
                                {(() => {
                                  const anchor =
                                    (step as any).startedAt
                                      ? new Date((step as any).startedAt).getTime()
                                      : (stepFeed[0]?.timestamp?.getTime?.() ?? null);
                                  if (!anchor) return null;
                                  void tick; // dep so the closure re-evaluates each tick
                                  const sec = Math.max(0, Math.floor((Date.now() - anchor) / 1000));
                                  const label = sec < 60
                                    ? `${sec}s`
                                    : sec < 3600
                                      ? `${Math.floor(sec / 60)}m ${sec % 60}s`
                                      : `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
                                  return (
                                    <span style={{
                                      fontFamily: 'var(--font-mono)',
                                      fontSize: '0.72rem',
                                      color: 'var(--text-muted)',
                                      padding: '2px 8px',
                                      background: 'rgba(34,211,238,0.06)',
                                      border: '1px solid rgba(34,211,238,0.15)',
                                      borderRadius: '10px',
                                    }} title={`Started ${new Date(anchor).toLocaleTimeString()}`}>
                                      ⏱ {label}
                                    </span>
                                  );
                                })()}
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
                                  await fetch(`${API_BASE}/projects/${selectedProject!.id}/reset-step/${step.id}`, { method: 'POST' });
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
                                  toggleIO(selectedProject!.id, step.id);
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



            {activeTab === 'fleet' && (
              <div className="glass-panel" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                <FleetCanvas />
              </div>
            )}

            {activeTab === 'secrets' && (
              <div className="glass-panel" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                <SecretsPanel />
              </div>
            )}

            {activeTab === 'trajectories' && (
              <div className="glass-panel" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                <TrajectoriesPanel />
              </div>
            )}

            {activeTab === 'models' && (
              <div className="glass-panel" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                <ModelsPanel />
              </div>
            )}

            {activeTab === 'self-learning' && (
              <div className="glass-panel" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                <SelfLearningPanel />
              </div>
            )}

            {activeTab === 'analytics' && (
              <div className="glass-panel" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                <AnalyticsPanel />
              </div>
            )}

            {(activeTab === 'gpu' || activeTab === 'workers') && (
              <div className="glass-panel" style={{ background: 'var(--panel-bg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0 }}>{activeTab === 'workers' ? 'Workers' : 'GPU Context Monitor'}</h3>
                  {activeTab === 'gpu' && contextStats && (
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

                {activeTab === 'workers' && (<>
                {/* Worker pool status — live from /api/system/workers (polled 5s).
                    Shows count of /perry-worker chats that claimed a task in
                    the last 2 minutes, plus the open/claimed/done queue depth. */}
                <div style={{
                  background: 'rgba(99,102,241,0.06)',
                  border: '1px solid rgba(99,102,241,0.25)',
                  borderRadius: '10px',
                  padding: '0.75rem 1rem',
                  marginBottom: '1.25rem',
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: '1rem',
                  alignItems: 'center',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: (workersInfo?.active ?? 0) > 0 ? '#22c55e' : '#6b7280',
                      animation: (workersInfo?.active ?? 0) > 0 ? 'pulse 2s infinite' : 'none',
                    }} />
                    <strong style={{ color: '#6366f1', fontSize: '0.875rem' }}>Workers</strong>
                  </div>
                  <div style={{ fontSize: '0.85rem', display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                    <span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{workersInfo?.active ?? '—'}</strong> active</span>
                    <span style={{ color: 'var(--text-muted)' }}>queue: open <strong style={{ color: 'white', fontVariantNumeric: 'tabular-nums' }}>{workersInfo?.depth?.open ?? 0}</strong> · claimed <strong style={{ color: 'white', fontVariantNumeric: 'tabular-nums' }}>{workersInfo?.depth?.claimed ?? 0}</strong> · done <strong style={{ color: 'white', fontVariantNumeric: 'tabular-nums' }}>{workersInfo?.depth?.done ?? 0}</strong></span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {workersInfo?.workers?.slice(0, 3).map(w => w.id.replace(/^claude-worker-/, '')).join(', ') || ''}
                    {(workersInfo?.workers?.length ?? 0) > 3 && ` +${(workersInfo?.workers?.length ?? 0) - 3}`}
                  </div>
                </div>

                {/* Worker Target panel — set a pair count goal for v4 training.
                    WorkerCoordinator polls /api/system/worker-target, POSTs
                    spawn requests to perry-worker as needed, and archives the
                    remaining queue once the target hits. Progress bar shows
                    current pairs / target; status dot shows coordinator
                    liveness. */}
                {(() => {
                  void targetInfo; // legacy data still hydrated for other callers; intentionally unused here
                  return (
                    <div style={{
                      background: 'rgba(34,197,94,0.06)',
                      border: '1px solid rgba(34,197,94,0.25)',
                      borderRadius: '10px',
                      padding: '0.75rem 1rem',
                      marginBottom: '1.25rem',
                    }}>
                      {/* (Worker Target + daemon banner removed — superseded by the
                          Anthropic Assist Worker panel below + per-agent PS daemons.) */}
                      {/* Pool audit — runs scanLeaks against claude_injected.jsonl
                          and training_data.jsonl. Same regex bank as Phase B + worker
                          drain, so this confirms what would actually end up in v4. */}
                      <div style={{
                        marginTop: '0.75rem', paddingTop: '0.75rem',
                        borderTop: '1px solid rgba(34,197,94,0.15)',
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem',
                      }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Pool audit — scan <code>pen-{auditPenSlug}</code>'s injected + training pool for filter words / named emotions / anti-patterns.
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <select
                            value={auditPenSlug}
                            onChange={(e) => {
                              setAuditPenSlug(e.target.value);
                              // Stale results would mislead — clear them on pen swap.
                              setPoolAudit(null);
                              setScrubResult(null);
                              setTagResult(null);
                            }}
                            disabled={poolAuditBusy || scrubBusy || tagBusy}
                            title="Which pen's training pool to audit"
                            style={{
                              padding: '0.3rem 0.5rem',
                              fontSize: '0.75rem',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.15)',
                              color: 'white',
                              borderRadius: '6px',
                              fontFamily: 'monospace',
                            }}
                          >
                            {pensData.length === 0 && (
                              <option value="a-perry">a-perry</option>
                            )}
                            {pensData.map((p: any) => (
                              <option key={p.slug} value={p.slug}>{p.slug}{p.displayName ? ` (${p.displayName})` : ''}</option>
                            ))}
                          </select>
                          <button
                            onClick={handlePoolAudit}
                            disabled={poolAuditBusy}
                            style={{
                              padding: '0.3rem 0.75rem', fontSize: '0.75rem',
                              background: 'rgba(99,102,241,0.15)',
                              border: '1px solid rgba(99,102,241,0.35)',
                              color: '#6366f1', borderRadius: '6px',
                              cursor: poolAuditBusy ? 'not-allowed' : 'pointer',
                            }}
                          >{poolAuditBusy ? 'Scanning…' : 'Audit pool'}</button>
                          {(() => {
                            if (!poolAudit) return null;
                            const leakCount = poolAudit.reports.reduce((a, r) => a + r.leaked, 0);
                            const vmHard = poolAudit.voiceMatch?.overall.hard ?? 0;
                            const vmSoft = poolAudit.voiceMatch?.overall.soft ?? 0;
                            // training_data only — claude_injected gets the same treatment
                            // since scrub does both, so we use only training-side voice numbers
                            // (claude_injected isn't in voiceMatch). Double for both files.
                            const totalIssues = leakCount + vmSoft + vmHard;
                            if (totalIssues === 0) return null;
                            return (
                              <button
                                onClick={handleScrubPool}
                                disabled={scrubBusy}
                                title={`Drop ${leakCount} leaks + ${vmSoft} soft drift + ${vmHard} hard drift from claude_injected.jsonl + training_data.jsonl (originals backed up to .bak files)`}
                                style={{
                                  padding: '0.3rem 0.75rem', fontSize: '0.75rem',
                                  background: 'rgba(239,68,68,0.15)',
                                  border: '1px solid rgba(239,68,68,0.35)',
                                  color: '#ef4444', borderRadius: '6px',
                                  cursor: scrubBusy ? 'not-allowed' : 'pointer',
                                }}
                              >{scrubBusy ? 'Scrubbing…' : `Scrub ${totalIssues} issue${totalIssues === 1 ? '' : 's'}`}</button>
                            );
                          })()}
                        </div>
                      </div>

                      {scrubResult && (
                        <div style={{
                          marginTop: '0.5rem',
                          padding: '0.5rem 0.75rem',
                          background: 'rgba(34,197,94,0.08)',
                          border: '1px solid rgba(34,197,94,0.25)',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                        }}>
                          <div style={{ color: '#22c55e', fontWeight: 600, marginBottom: '0.25rem' }}>
                            Scrub complete — {scrubResult.results.reduce((a, r) => a + r.removed, 0)} pair{scrubResult.results.reduce((a, r) => a + r.removed, 0) === 1 ? '' : 's'} removed
                          </div>
                          {scrubResult.results.map(r => (
                            <div key={r.file} style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                              {r.file}: {r.before} → {r.kept} (removed {r.removed})
                              {r.backupPath && (
                                <span style={{ color: '#6b7280' }}> · backup: <code>{r.backupPath.split(/[/\\]/).slice(-1)[0]}</code></span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {poolAudit && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
                          {/* MASTER POOL: training_data.jsonl is the canonical file the trainer reads.
                              claude_injected.jsonl is the input source — shown as a one-line summary below
                              the master pool card so the dashboard reflects "one pool" mental model. */}
                          {poolAudit.reports.filter(r => r.file === 'training_data.jsonl').map(r => {
                            const pct = r.total > 0 ? Math.round((r.clean / r.total) * 100) : 0;
                            return (
                              <div key={r.file} style={{
                                marginTop: '0.5rem',
                                padding: '0.6rem 0.75rem',
                                background: 'rgba(34,197,94,0.06)',
                                border: '1px solid rgba(34,197,94,0.2)',
                                borderRadius: '6px',
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                                  <div>
                                    <strong style={{ color: '#22c55e', fontSize: '0.85rem' }}>Training Pool</strong>
                                    <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                      <code>training_data.jsonl</code> — what the trainer reads
                                    </span>
                                  </div>
                                  {r.exists ? (
                                    <span style={{ color: 'var(--text-muted)' }}>
                                      <strong style={{ color: 'white', fontVariantNumeric: 'tabular-nums', fontSize: '1rem' }}>{r.total.toLocaleString()}</strong>
                                      {' pairs · '}
                                      <strong style={{ color: r.leaked > 0 ? '#ef4444' : '#22c55e', fontVariantNumeric: 'tabular-nums' }}>{r.leaked} leaked</strong>
                                      {' · '}{pct}% clean
                                    </span>
                                  ) : (
                                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>not exported yet</span>
                                  )}
                                </div>
                                {r.exists && Object.keys(r.tagCounts).length > 0 && (
                                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                                    {Object.entries(r.tagCounts)
                                      .sort((a, b) => b[1] - a[1])
                                      .map(([tag, n]) => (
                                        <span key={tag} style={{
                                          padding: '0.1rem 0.5rem',
                                          fontSize: '0.7rem',
                                          background: 'rgba(239,68,68,0.12)',
                                          border: '1px solid rgba(239,68,68,0.3)',
                                          color: '#ef4444',
                                          borderRadius: '4px',
                                          fontFamily: 'monospace',
                                        }}>{tag} × {n}</span>
                                      ))}
                                  </div>
                                )}
                                {r.exists && (r.untaggedPen ?? 0) > 0 && (
                                  <div style={{
                                    marginTop: '0.4rem',
                                    padding: '0.4rem 0.5rem',
                                    background: 'rgba(245,158,11,0.08)',
                                    border: '1px solid rgba(245,158,11,0.3)',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    flexWrap: 'wrap',
                                  }}>
                                    <span style={{ fontSize: '0.7rem', color: '#f59e0b' }}>
                                      <strong>{r.untaggedPen}</strong> row{r.untaggedPen === 1 ? '' : 's'} have no <code>metadata.pen</code> tag.
                                    </span>
                                    <select
                                      value={tagPenChoice}
                                      onChange={(e) => setTagPenChoice(e.target.value)}
                                      style={{
                                        padding: '0.2rem 0.4rem',
                                        fontSize: '0.7rem',
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px solid rgba(255,255,255,0.15)',
                                        color: 'white',
                                        borderRadius: '4px',
                                        fontFamily: 'monospace',
                                      }}
                                    >
                                      {pensData.length === 0 && (
                                        <option value="a-perry">a-perry</option>
                                      )}
                                      {pensData.map((p: any) => (
                                        <option key={p.slug} value={p.slug}>{p.slug}{p.displayName ? ` (${p.displayName})` : ''}</option>
                                      ))}
                                    </select>
                                    <button
                                      onClick={handlePoolTag}
                                      disabled={tagBusy}
                                      title="Backfill metadata.pen on every untagged row. Original backed up to .bak-pretag-<timestamp>."
                                      style={{
                                        padding: '0.2rem 0.6rem',
                                        fontSize: '0.7rem',
                                        background: 'rgba(245,158,11,0.18)',
                                        border: '1px solid rgba(245,158,11,0.4)',
                                        color: '#f59e0b',
                                        borderRadius: '4px',
                                        cursor: tagBusy ? 'not-allowed' : 'pointer',
                                      }}
                                    >{tagBusy ? 'Tagging…' : `Tag ${r.untaggedPen} with pen`}</button>
                                  </div>
                                )}
                                {r.exists && tagResult && r.file === 'training_data.jsonl' && (
                                  <div style={{ marginTop: '0.4rem', fontSize: '0.7rem', color: '#22c55e' }}>
                                    Tagged {tagResult.tagged} row{tagResult.tagged === 1 ? '' : 's'} with pen <code>{tagResult.penSlug}</code>
                                    {tagResult.alreadyTagged > 0 && <span style={{ color: 'var(--text-muted)' }}> ({tagResult.alreadyTagged} already tagged, untouched)</span>}
                                    {tagResult.backupPath && <span style={{ color: 'var(--text-muted)' }}> · backup: <code>{tagResult.backupPath.split(/[/\\]/).slice(-1)[0]}</code></span>}
                                  </div>
                                )}
                                {r.exists && r.topExamples.length > 0 && (
                                  <details style={{ marginTop: '0.4rem' }}>
                                    <summary style={{ cursor: 'pointer', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                      First {r.topExamples.length} leaked examples
                                    </summary>
                                    <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                      {r.topExamples.map((ex, i) => (
                                        <div key={i} style={{
                                          padding: '0.4rem 0.5rem',
                                          background: 'rgba(0,0,0,0.3)',
                                          border: '1px solid rgba(255,255,255,0.05)',
                                          borderRadius: '4px',
                                          fontSize: '0.7rem',
                                          fontFamily: 'monospace',
                                        }}>
                                          <div style={{ color: '#ef4444', marginBottom: '0.2rem' }}>
                                            line #{ex.index}: {ex.matches.slice(0, 6).map(m => `"${m}"`).join(', ')}
                                          </div>
                                          <div style={{ color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
                                            {ex.excerpt}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </div>
                            );
                          })}
                          {/* INPUT SOURCE: claude_injected.jsonl — small one-liner under the master pool */}
                          {(() => {
                            const inj = poolAudit.reports.find(r => r.file === 'claude_injected.jsonl' && r.exists);
                            if (!inj) return null;
                            return (
                              <div style={{
                                marginTop: '0.4rem',
                                padding: '0.4rem 0.6rem',
                                fontSize: '0.7rem',
                                color: 'var(--text-muted)',
                                background: 'rgba(0,0,0,0.12)',
                                border: '1px solid rgba(255,255,255,0.04)',
                                borderRadius: '4px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}>
                                <span>
                                  Input: <code style={{ color: '#a5b4fc' }}>claude_injected.jsonl</code> — <strong style={{ color: 'white', fontVariantNumeric: 'tabular-nums' }}>{inj.total.toLocaleString()}</strong> curated pairs
                                  {inj.leaked > 0 && <span style={{ color: '#ef4444' }}> · {inj.leaked} leaked (run Scrub)</span>}
                                </span>
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                  feeds the export pipeline
                                </span>
                              </div>
                            );
                          })()}

                          {/* MANIFEST COVERAGE: how many pairs of each category are needed to be train-ready */}
                          {poolAudit.manifest && (() => {
                            const m = poolAudit.manifest;
                            const reqDeficit = m.categories.filter(c => c.mustSatisfy && c.deficit > 0)
                              .reduce((s, c) => s + c.deficit, 0);
                            const reqCount = m.categories.filter(c => c.mustSatisfy && c.deficit > 0).length;
                            return (
                              <div style={{
                                marginTop: '0.6rem',
                                padding: '0.6rem 0.75rem',
                                background: m.ready ? 'rgba(34,197,94,0.06)' : 'rgba(168,85,247,0.06)',
                                border: `1px solid ${m.ready ? 'rgba(34,197,94,0.25)' : 'rgba(168,85,247,0.25)'}`,
                                borderRadius: '6px',
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                  <div>
                                    <strong style={{ color: m.ready ? '#22c55e' : '#a855f7', fontSize: '0.85rem' }}>
                                      Manifest Coverage
                                    </strong>
                                    <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                      v{m.version} — what the trainer needs
                                    </span>
                                  </div>
                                  <span style={{ fontSize: '0.78rem' }}>
                                    {m.ready ? (
                                      <strong style={{ color: '#22c55e' }}>✓ READY TO TRAIN</strong>
                                    ) : reqDeficit > 0 ? (
                                      <strong style={{ color: '#f59e0b' }}>
                                        need <span style={{ fontVariantNumeric: 'tabular-nums' }}>{reqDeficit}</span> more pairs across {reqCount} categor{reqCount === 1 ? 'y' : 'ies'}
                                      </strong>
                                    ) : (
                                      <strong style={{ color: '#f59e0b' }}>not ready (total under min)</strong>
                                    )}
                                  </span>
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                                  <thead>
                                    <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: '0.68rem' }}>
                                      <th style={{ padding: '0.25rem 0.4rem', fontWeight: 500 }}>Category</th>
                                      <th style={{ padding: '0.25rem 0.4rem', textAlign: 'right', fontWeight: 500 }}>Current</th>
                                      <th style={{ padding: '0.25rem 0.4rem', textAlign: 'right', fontWeight: 500 }}>Target</th>
                                      <th style={{ padding: '0.25rem 0.4rem', textAlign: 'right', fontWeight: 500 }}>Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {m.categories.map(c => {
                                      const need = c.deficit > 0;
                                      const over = c.surplus > 0;
                                      const statusEl = need
                                        ? <span style={{ color: c.mustSatisfy ? '#f59e0b' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>need <strong>{c.deficit}</strong></span>
                                        : over
                                          ? <span style={{ color: '#a855f7', fontVariantNumeric: 'tabular-nums' }}>+{c.surplus} (will trim)</span>
                                          : c.status === 'LOW'
                                            ? <span style={{ color: '#ef4444', fontVariantNumeric: 'tabular-nums' }}>LOW -{c.deficit}</span>
                                            : <span style={{ color: '#22c55e' }}>✓ {c.status}</span>;
                                      return (
                                        <tr key={c.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                          <td style={{ padding: '0.3rem 0.4rem' }}>
                                            <span style={{ color: need && c.mustSatisfy ? '#f59e0b' : 'var(--text-main)' }}>{c.label}</span>
                                            {c.mustSatisfy && (
                                              <span style={{ marginLeft: '0.4rem', fontSize: '0.6rem', padding: '0.05rem 0.3rem', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.35)', color: '#f59e0b', borderRadius: '3px' }}>required</span>
                                            )}
                                            <span style={{ marginLeft: '0.4rem', fontSize: '0.6rem', color: 'var(--text-muted)' }}>{c.op}</span>
                                          </td>
                                          <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                            <strong>{c.current.toLocaleString()}</strong>
                                          </td>
                                          <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                                            {c.target.toLocaleString()}
                                          </td>
                                          <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>
                                            {statusEl}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                                <div style={{ marginTop: '0.4rem', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                  Total: <strong style={{ color: 'white', fontVariantNumeric: 'tabular-nums' }}>{m.totalMatched.toLocaleString()}</strong> / {m.minTotal.toLocaleString()} min{m.unmatched > 0 ? ` · ${m.unmatched} unmatched` : ''}
                                </div>
                                {/* Queue sync result — what the audit did to the task pool */}
                                {poolAudit.queueSync && (
                                  (Object.keys(poolAudit.queueSync.archived).length > 0 || poolAudit.queueSync.enqueued || poolAudit.queueSync.enqueueError) && (
                                    <div style={{
                                      marginTop: '0.4rem', padding: '0.3rem 0.5rem',
                                      fontSize: '0.65rem', borderRadius: '4px',
                                      background: 'rgba(168,85,247,0.08)',
                                      border: '1px solid rgba(168,85,247,0.2)',
                                      color: 'var(--text-muted)',
                                    }}>
                                      <strong style={{ color: '#a855f7' }}>Queue sync:</strong>
                                      {Object.keys(poolAudit.queueSync.archived).length > 0 && (
                                        <span> archived obsolete{' '}
                                          {Object.entries(poolAudit.queueSync.archived).map(([k, v]) => (
                                            <span key={k}><strong style={{ color: 'white' }}>{v}</strong> × <code>{k}</code></span>
                                          )).reduce<React.ReactNode[]>((a, b, i) => i === 0 ? [b] : [...a, ', ', b], [])}
                                        </span>
                                      )}
                                      {(poolAudit.queueSync.enqueued ?? 0) > 0 && (
                                        <span>{Object.keys(poolAudit.queueSync.archived).length > 0 ? ' · ' : ' '}enqueued <strong style={{ color: '#22c55e' }}>{poolAudit.queueSync.enqueued}</strong> new tasks for deficits</span>
                                      )}
                                      {poolAudit.queueSync.enqueueError && (
                                        <span style={{ color: '#ef4444' }}> · enqueue error: {poolAudit.queueSync.enqueueError}</span>
                                      )}
                                    </div>
                                  )
                                )}
                              </div>
                            );
                          })()}

                          {/* VOICE MATCH: per-source z-distance from the pen's voice corpus.
                              Catches subtle stylistic drift (Antigravity vs Anthropic vs A.Perry)
                              that the regex leak filter misses. */}
                          {poolAudit.voiceMatch && (() => {
                            const vm = poolAudit.voiceMatch;
                            const passPct = vm.overall.total > 0 ? Math.round((vm.overall.pass / vm.overall.total) * 100) : 0;
                            const hardPct = vm.overall.total > 0 ? Math.round((vm.overall.hard / vm.overall.total) * 100) : 0;
                            const verdict = hardPct === 0 ? 'CLEAN' : hardPct < 5 ? 'MINOR DRIFT' : 'SIGNIFICANT DRIFT';
                            const verdictColor = hardPct === 0 ? '#22c55e' : hardPct < 5 ? '#f59e0b' : '#ef4444';
                            return (
                              <div style={{
                                marginTop: '0.6rem',
                                padding: '0.6rem 0.75rem',
                                background: 'rgba(59,130,246,0.06)',
                                border: '1px solid rgba(59,130,246,0.25)',
                                borderRadius: '6px',
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                  <div>
                                    <strong style={{ color: '#60a5fa', fontSize: '0.85rem' }}>Voice Match</strong>
                                    <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                      z-distance from pen corpus (n={vm.fingerprintN}) — HARD ≥{vm.lenient}σ or leak · SOFT ≥{vm.strict}σ
                                    </span>
                                  </div>
                                  <span style={{ fontSize: '0.78rem' }}>
                                    <strong style={{ color: verdictColor }}>{verdict}</strong>
                                    <span style={{ marginLeft: '0.5rem', color: 'var(--text-muted)' }}>
                                      {passPct}% pass · <strong style={{ color: hardPct > 0 ? '#ef4444' : '#22c55e', fontVariantNumeric: 'tabular-nums' }}>{vm.overall.hard}</strong> hard
                                    </span>
                                  </span>
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                                  <thead>
                                    <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: '0.68rem' }}>
                                      <th style={{ padding: '0.25rem 0.4rem', fontWeight: 500 }}>Source</th>
                                      <th style={{ padding: '0.25rem 0.4rem', textAlign: 'right', fontWeight: 500 }}>Total</th>
                                      <th style={{ padding: '0.25rem 0.4rem', textAlign: 'right', fontWeight: 500 }}>Pass</th>
                                      <th style={{ padding: '0.25rem 0.4rem', textAlign: 'right', fontWeight: 500 }}>Soft</th>
                                      <th style={{ padding: '0.25rem 0.4rem', textAlign: 'right', fontWeight: 500 }}>Hard</th>
                                      <th style={{ padding: '0.25rem 0.4rem', textAlign: 'right', fontWeight: 500 }}>Mean dz</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {vm.bySource.map(s => (
                                      <tr key={s.source} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                        <td style={{ padding: '0.3rem 0.4rem', fontFamily: 'monospace', fontSize: '0.7rem' }}>{s.source}</td>
                                        <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.total.toLocaleString()}</td>
                                        <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', color: '#22c55e', fontVariantNumeric: 'tabular-nums' }}>{s.pass.toLocaleString()}</td>
                                        <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', color: s.soft > 0 ? '#f59e0b' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{s.soft.toLocaleString()}</td>
                                        <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', color: s.hard > 0 ? '#ef4444' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}><strong>{s.hard.toLocaleString()}</strong></td>
                                        <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{s.meanDistance.toFixed(2)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}

                          <div style={{ marginTop: '0.4rem', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                            Last run: {new Date(poolAudit.runAt).toLocaleTimeString()}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                </>)}
                {!contextStats ? (
                  <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Loader2 size={24} className="animate-spin" style={{ marginBottom: '0.5rem' }} />
                    <p>Connecting to GPU monitors...</p>
                  </div>
                ) : (
                  <>
                  {activeTab === 'gpu' && (<>
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

                            {/* GPU Power toggle — only on the librarian card (5070 Ti).
                                Unload librarian models AND reroute librarian calls to
                                the writer GPU (5090). Reversible via Restore. */}
                            {gpu.label.toLowerCase().includes('librarian') && (
                              <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.5rem 0.75rem', background: librarianLoaded?.rerouted ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)', border: librarianLoaded?.rerouted ? '1px solid rgba(34,197,94,0.25)' : '1px solid rgba(245,158,11,0.25)', borderRadius: '6px' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                                  {librarianLoaded
                                    ? (librarianLoaded.rerouted
                                      ? <><strong style={{ color: '#22c55e' }}>5070 Ti freed</strong> — librarian → 5090 (may slow during calibration)</>
                                      : librarianLoaded.loadedCount > 0
                                        ? <><strong style={{ color: '#f59e0b' }}>{librarianLoaded.loadedCount}</strong> model{librarianLoaded.loadedCount === 1 ? '' : 's'} loaded on 5070 Ti</>
                                        : <><strong style={{ color: '#22c55e' }}>Idle</strong> on 5070 Ti</>)
                                    : '—'}
                                </div>
                                <button
                                  onClick={handleLibrarianToggle}
                                  disabled={isUnloadingLibrarian}
                                  style={{
                                    padding: '4px 10px', fontSize: '0.7rem', fontWeight: 600,
                                    borderRadius: '4px', cursor: isUnloadingLibrarian ? 'wait' : 'pointer',
                                    background: librarianLoaded?.rerouted ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)',
                                    color: librarianLoaded?.rerouted ? '#22c55e' : '#f59e0b',
                                    border: librarianLoaded?.rerouted ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(245,158,11,0.3)',
                                    opacity: isUnloadingLibrarian ? 0.6 : 1,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {isUnloadingLibrarian ? '…' : (librarianLoaded?.rerouted ? 'Restore to 5070 Ti' : 'Free 5070 Ti')}
                                </button>
                              </div>
                            )}

                            {/* Last Polled */}
                            <div style={{ marginTop: '0.75rem', fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.6, textAlign: 'right' }}>
                              Last polled: {new Date(gpu.lastPolled).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Researcher slot — logical 3rd role that hot-swaps with
                        writer on 5090 OR runs in parallel on 5070 Ti alongside
                        librarian. Endpoint is user-controlled here; model is
                        picked from whichever ollama host the endpoint points at. */}
                    <div style={{
                      background: 'rgba(168,85,247,0.04)',
                      border: '1px solid rgba(168,85,247,0.25)',
                      borderRadius: '12px',
                      padding: '1rem 1.25rem',
                      marginBottom: '1.5rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <Cpu size={18} color="#a855f7" />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Researcher</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              planning research phase · currently on <strong style={{ color: '#a855f7' }}>{researcherStatus?.mode === 'workers' ? 'Workers (subscription CLIs)' : (researcherStatus?.gpu || '—')}</strong>
                              {researcherStatus && researcherStatus.mode !== 'workers' && ` · ${researcherStatus.loadedCount} model${researcherStatus.loadedCount === 1 ? '' : 's'} loaded`}
                              {researcherStatus?.mode === 'workers' && ' · external queue (no local model loaded)'}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>GPU:</span>
                            {(() => {
                              const workersActive = researcherStatus?.mode === 'workers';
                              const writerActive = !workersActive && researcherStatus?.onLibrarianGpu === false;
                              const librarianActive = !workersActive && researcherStatus?.onLibrarianGpu === true;
                              const btnStyle = (active: boolean) => ({
                                padding: '4px 10px', fontSize: '0.7rem', fontWeight: 600 as const,
                                borderRadius: '4px',
                                cursor: (isSwitchingResearcher || active) ? 'default' as const : 'pointer' as const,
                                background: active ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.05)',
                                color: active ? '#a855f7' : 'var(--text-muted)',
                                border: active ? '1px solid rgba(168,85,247,0.4)' : '1px solid var(--panel-border)',
                                opacity: isSwitchingResearcher ? 0.6 : 1,
                              });
                              return (
                                <>
                                  <button
                                    onClick={() => handleResearcherEndpointSwap('writer')}
                                    disabled={isSwitchingResearcher || writerActive}
                                    style={btnStyle(writerActive)}
                                  >5090 (swap w/ writer)</button>
                                  <button
                                    onClick={() => handleResearcherEndpointSwap('librarian')}
                                    disabled={isSwitchingResearcher || librarianActive}
                                    style={btnStyle(librarianActive)}
                                  >5070 Ti (parallel w/ librarian)</button>
                                  <button
                                    onClick={() => handleResearcherEndpointSwap('workers')}
                                    disabled={isSwitchingResearcher || workersActive}
                                    style={btnStyle(workersActive)}
                                    title="Route planning research phase to subscription-CLI workers via task_pool. Bypasses local Ollama; uses your existing worker queue."
                                  >Workers (subscription CLIs)</button>
                                </>
                              );
                            })()}
                            {isSwitchingResearcher && <Loader2 size={12} className="animate-spin" />}
                          </div>
                          <select
                            value={researcherStatus?.models?.[0]?.name || ''}
                            onChange={(e) => handleSwapModel('researcher', e.target.value)}
                            disabled={isSwappingModel === 'researcher'}
                            style={{
                              background: 'rgba(168,85,247,0.15)',
                              color: '#a855f7',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              border: 'none',
                              outline: 'none',
                              cursor: 'pointer',
                              minWidth: '180px',
                            }}
                          >
                            <option value="" disabled>Pick researcher model</option>
                            {(availableModels.researcher || []).map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                          {isSwappingModel === 'researcher' && <Loader2 size={12} className="animate-spin" />}
                        </div>
                      </div>
                    </div>

                </>)}
                {activeTab === 'workers' && (<>
                  <HelpGuide panelName="workers" title="Workers & Login Wizard Guide">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                      <div>
                        <h4 style={{ color: 'var(--secondary)', marginBottom: 6, fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>🤖 What are Workers?</h4>
                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Workers are background assistants that perform heavy research or code-writing tasks. Instead of paying for expensive AI developer keys, Perry connects to your personal chat subscriptions (like Claude Pro, Gemini Advanced, or ChatGPT Plus) to run tasks for free.
                        </p>
                      </div>
                      <div>
                        <h4 style={{ color: 'var(--secondary)', marginBottom: 6, fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>🔑 Login Wizard (No Terminal Required)</h4>
                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          If a worker is offline or login has expired, click the <strong>🔑 Run Auth Wizard</strong> button on its card. A mini terminal will open. Follow the steps printed there (like clicking a link or copying a code), paste your response into the input box below the logs, and click <strong>SEND</strong>.
                        </p>
                      </div>
                      <div>
                        <h4 style={{ color: 'var(--secondary)', marginBottom: 6, fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>⚙️ Controls: Auto-Loop & YOLO</h4>
                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <strong>Auto-Loop</strong>: Turning this ON lets the worker start working automatically whenever there are tasks waiting. If OFF, it waits for you to click "Fire Worker Now".<br />
                          <strong>YOLO Mode</strong>: Allows the AI to automatically run commands or edit files in the background. It is highly recommended so the AI doesn't pause and wait for your manual approval.
                        </p>
                      </div>
                    </div>
                  </HelpGuide>

                  {/* Per-agent Assist Worker panels — Anthropic + Anti-Grav + Codex side by side.
                        Each panel toggles auto/manual fire decisions; WorkerCoordinator
                        (inside perry) POSTs spawn requests to the perry-worker container
                        which runs the matching subscription CLI. Pending task count is
                        shared — whichever agent fires first races to claim. */}
                    {(['anthropic', 'antigrav', 'codex'] as const).map(agent => {
                      const slice = assistStatus?.[agent];
                      const pending = assistStatus?.pending ?? 0;
                      const claimed = assistStatus?.claimed ?? 0;
                      const mode = slice?.mode ?? 'manual';
                      const lastFired = slice?.lastFiredAt;
                      const fireReq = slice?.fireRequestedAt;
                      const ageSec = lastFired ? Math.floor((Date.now() - new Date(lastFired).getTime()) / 1000) : null;
                      const ageStr = ageSec == null ? 'never' : ageSec < 60 ? `${ageSec}s ago` : ageSec < 3600 ? `${Math.floor(ageSec/60)}m ago` : `${Math.floor(ageSec/3600)}h ago`;
                      const fireReqAge = fireReq ? Math.floor((Date.now() - new Date(fireReq).getTime()) / 1000) : null;
                      const fireRequestActive = fireReqAge != null && fireReqAge < 60;
                      const agentDisplay =
                        agent === 'anthropic' ? 'Anthropic'
                        : agent === 'antigrav' ? 'Anti-Grav'
                        : 'Codex';
                      const label =
                        agent === 'anthropic' ? 'Anthropic Assist Worker'
                        : agent === 'antigrav' ? 'Anti-Grav Assist Worker (Gemini CLI)'
                        : 'Codex Assist Worker (OpenAI CLI)';
                      const accentRgb =
                        agent === 'anthropic' ? '34,197,94'
                        : agent === 'antigrav' ? '168,85,247'
                        : '251,146,60';
                      const daemonAlive = slice?.daemonAlive ?? false;
                      const daemonInstall = { script: 'docker compose up -d perry-worker', desc: 'Subscription-CLI worker container (host for all three panels)' };
                      const fireBtnLabel = fireRequestActive ? 'Fire Pending…'
                        : isFiringAssist === agent ? '…'
                        : `Fire ${agentDisplay} Worker Now`;
                      return (
                        <div key={agent} style={{
                          background: `rgba(${accentRgb},0.04)`,
                          border: `1px solid rgba(${accentRgb},0.25)`,
                          borderRadius: '12px',
                          padding: '1rem 1.25rem',
                          marginBottom: '1rem',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                              <div style={{
                                width: 28, height: 28, borderRadius: '50%',
                                background: pending > 0 ? 'rgba(245,158,11,0.25)' : `rgba(${accentRgb},0.25)`,
                                color: pending > 0 ? '#f59e0b' : `rgb(${accentRgb})`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: 700, fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums',
                              }}>{pending + claimed}</div>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{label}</div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  {pending > 0 ? <><strong style={{ color: '#f59e0b' }}>{pending}</strong> task{pending === 1 ? '' : 's'} pending</> : <strong style={{ color: `rgb(${accentRgb})` }}>0 pending</strong>}
                                  {claimed > 0 && <> · {claimed} in-progress</>}
                                  {' · last fired '}<strong>{ageStr}</strong>
                                  {' · daemon '}<strong style={{ color: daemonAlive ? `rgb(${accentRgb})` : '#f59e0b' }}>{daemonAlive ? 'online' : 'offline'}</strong>
                                  {fireRequestActive && <> · <span style={{ color: '#f59e0b' }}>fire requested ({fireReqAge}s ago)</span></>}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              {/* Status light — green pulsing when WorkerCoordinator
                                  is heartbeating into meta (every 5s), gray when
                                  offline. Coordinator runs in-process inside perry,
                                  so offline = perry container itself is down. */}
                              <div style={{
                                display: 'flex', alignItems: 'center', gap: '0.35rem',
                                padding: '4px 10px', borderRadius: '12px',
                                background: daemonAlive ? `rgba(${accentRgb},0.15)` : 'rgba(107,114,128,0.15)',
                                border: `1px solid ${daemonAlive ? `rgba(${accentRgb},0.4)` : 'rgba(107,114,128,0.3)'}`,
                              }}>
                                <div style={{
                                  width: 8, height: 8, borderRadius: '50%',
                                  background: daemonAlive ? `rgb(${accentRgb})` : '#6b7280',
                                  boxShadow: daemonAlive ? `0 0 6px rgba(${accentRgb},0.8)` : 'none',
                                  animation: daemonAlive ? 'pulse 2s infinite' : 'none',
                                }} />
                                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: daemonAlive ? `rgb(${accentRgb})` : 'var(--text-muted)' }}>
                                  {daemonAlive ? 'online' : 'offline'}
                                </span>
                              </div>
                              {/* No start/stop control: WorkerCoordinator is part of
                                  perry, and perry-worker is managed via docker compose,
                                  not a UI toggle. */}
                              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.75rem', color: mode === 'auto' ? `rgb(${accentRgb})` : 'var(--text-muted)' }}>
                                <input
                                  type="checkbox"
                                  checked={mode === 'auto'}
                                  onChange={() => handleAssistModeToggle(agent)}
                                  style={{ cursor: 'pointer' }}
                                />
                                <strong>Auto-Loop</strong>
                                <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>
                                  ({mode === 'auto' ? 'daemon fires whenever tasks pend' : 'manual only'})
                                </span>
                              </label>
                              {/* YOLO + Model — per-agent CLI tuning. Stored
                                  in meta, included in spawn signals, spawner
                                  builds command line from them. */}
                              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                <input
                                  type="checkbox"
                                  checked={(slice?.config?.yolo) !== false}
                                  onChange={(e) => handleAssistConfigChange(agent, { yolo: e.target.checked })}
                                  style={{ cursor: 'pointer' }}
                                />
                                <strong>YOLO</strong>
                                <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>
                                  (auto-approve tool calls; required for headless)
                                </span>
                              </label>
                              <select
                                value={slice?.config?.model || (agent === 'antigrav' ? 'gemini-2.5-flash' : 'auto')}
                                onChange={(e) => handleAssistConfigChange(agent, { model: e.target.value })}
                                style={{
                                  padding: '4px 8px', fontSize: '0.7rem',
                                  background: 'rgba(255,255,255,0.06)',
                                  border: '1px solid rgba(255,255,255,0.15)',
                                  borderRadius: '4px', color: 'white',
                                  cursor: 'pointer',
                                }}
                                title={agent === 'anthropic'
                                  ? 'Anthropic model. opus = best for hard reasoning, sonnet = balanced, haiku = fastest/cheapest, auto = let CLI pick'
                                  : agent === 'antigrav'
                                  ? 'Gemini model. flash = high quota, pro = higher quality, auto = let CLI pick'
                                  : 'Codex model picked by your ChatGPT subscription tier; override only if you know the exact model id (e.g. gpt-5.5).'}
                              >
                                {agent === 'anthropic' ? (
                                  <>
                                    <option value="auto">auto (CLI picks)</option>
                                    <option value="opus">opus (best reasoning)</option>
                                    <option value="sonnet">sonnet (balanced)</option>
                                    <option value="haiku">haiku (fast/cheap)</option>
                                  </>
                                ) : agent === 'antigrav' ? (
                                  <>
                                    <option value="auto">auto (CLI picks)</option>
                                    <option value="gemini-2.5-flash">gemini-2.5-flash (high quota)</option>
                                    <option value="gemini-2.5-pro">gemini-2.5-pro (better quality)</option>
                                    <option value="gemini-3-pro">gemini-3-pro (highest quality, low quota)</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="auto">auto (CLI picks)</option>
                                    <option value="gpt-5.5">gpt-5.5</option>
                                  </>
                                )}
                              </select>
                              <button
                                onClick={() => handleAssistFireNow(agent)}
                                disabled={isFiringAssist === agent || fireRequestActive}
                                style={{
                                  padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600,
                                  borderRadius: '4px',
                                  cursor: (isFiringAssist === agent || fireRequestActive) ? 'wait' : 'pointer',
                                  background: `rgba(${accentRgb},0.2)`,
                                  color: `rgb(${accentRgb})`,
                                  border: `1px solid rgba(${accentRgb},0.4)`,
                                  opacity: (isFiringAssist === agent || fireRequestActive) ? 0.6 : 1,
                                }}
                              >{fireBtnLabel}</button>
                            </div>
                          </div>
                          {!daemonAlive && (
                            <div style={{
                              marginTop: '0.75rem',
                              padding: '0.6rem 0.9rem',
                              background: 'rgba(245,158,11,0.1)',
                              border: '1px solid rgba(245,158,11,0.35)',
                              borderRadius: '6px',
                              fontSize: '0.7rem', lineHeight: 1.4,
                            }}>
                              <strong style={{ color: '#f59e0b' }}>⚠ {agentDisplay} coordinator not heartbeating.</strong>{' '}
                              The perry container or its WorkerCoordinator is offline. Bring it up: <code>{daemonInstall.script}</code>
                              <div style={{ marginTop: '0.3rem', color: 'var(--text-muted)' }}>
                                {daemonInstall.desc}
                              </div>
                            </div>
                          )}

                          {slice?.authenticated ? (
                            <div style={{
                              marginTop: '0.75rem',
                              padding: '0.6rem 0.9rem',
                              background: 'rgba(16, 185, 129, 0.08)',
                              border: '1px solid rgba(16, 185, 129, 0.25)',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              fontSize: '0.72rem',
                              color: '#34d399',
                              boxShadow: '0 2px 8px rgba(16, 185, 129, 0.05)',
                            }}>
                              <CheckCircle2 size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                              <div>
                                <span style={{ fontWeight: 600, color: '#f3f4f6' }}>Authenticated</span>
                                <span style={{ color: '#9ca3af', marginLeft: '6px' }}>— CLI is signed in and ready.</span>
                              </div>
                            </div>
                          ) : (
                            <div style={{
                              marginTop: '0.75rem',
                              padding: '0.6rem 0.8rem',
                              background: 'rgba(255,255,255,0.02)',
                              border: '1px solid rgba(255,255,255,0.06)',
                              borderRadius: '6px',
                              fontSize: '0.68rem',
                              color: 'var(--text-muted)',
                            }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Interactive Auth Command:</span>
                              <code style={{ display: 'block', marginTop: '4px', padding: '4px 8px', background: 'rgba(0,0,0,0.3)', borderRadius: 4, fontFamily: 'monospace', color: '#6366f1', overflowX: 'auto', whiteSpace: 'pre' }}>
                                {agent === 'codex'
                                  ? 'docker compose run --rm -it --entrypoint codex perry-worker login --device-auth'
                                  : `docker compose run --rm -it --entrypoint ${agent === 'antigrav' ? 'gemini' : 'claude'} perry-worker login`}
                              </code>

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                                <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>Or fire it off automatically from the dashboard:</span>
                                <button
                                  type="button"
                                  className="btn"
                                  style={{
                                    padding: '4px 12px',
                                    fontSize: '0.72rem',
                                    fontWeight: 600,
                                    borderRadius: '4px',
                                    background: activeLoginAgent === agent ? 'rgba(239, 68, 68, 0.2)' : `rgba(${accentRgb}, 0.15)`,
                                    border: `1px solid ${activeLoginAgent === agent ? 'rgb(239, 68, 68)' : `rgb(${accentRgb})`}`,
                                    color: 'white',
                                    cursor: isStartingLogin ? 'wait' : 'pointer',
                                    boxShadow: activeLoginAgent === agent ? '0 0 8px rgba(239, 68, 68, 0.4)' : `0 0 8px rgba(${accentRgb}, 0.3)`,
                                    transition: 'all 0.2s ease',
                                  }}
                                  onClick={() => {
                                    if (activeLoginAgent === agent) {
                                      killAuthWizard();
                                    } else {
                                      startAuthWizard(agent as any);
                                    }
                                  }}
                                  disabled={isStartingLogin}
                                >
                                  {activeLoginAgent === agent ? '🛑 Close Auth Wizard' : '🔑 Run Auth Wizard'}
                                </button>
                              </div>

                              {activeLoginAgent === agent && (() => {
                                const devAuth = parseDeviceAuth(loginLogs);
                                if (devAuth) {
                                  return (
                                    <div style={{
                                      marginTop: '12px',
                                      padding: '16px',
                                      background: '#070a13',
                                      border: '1px solid rgba(168, 85, 247, 0.4)',
                                      borderRadius: '8px',
                                      boxShadow: '0 0 15px rgba(168, 85, 247, 0.1)',
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#a855f7', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                          🔑 Device Authentication Required
                                        </span>
                                        <button
                                          type="button"
                                          onClick={killAuthWizard}
                                          style={{
                                            background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '0.72rem',
                                          }}
                                        >
                                          ✕ Close
                                        </button>
                                      </div>
                                      
                                      <div style={{ fontSize: '0.75rem', color: '#cbd5e1', lineHeight: '1.5', marginBottom: '12px' }}>
                                        Follow these steps to authorize the worker:
                                      </div>

                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                          <span style={{ color: '#a855f7', fontWeight: 'bold' }}>1.</span>
                                          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Copy the verification code below:</span>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '16px' }}>
                                          <code style={{
                                            fontFamily: 'monospace',
                                            fontSize: '1.1rem',
                                            background: 'rgba(0,0,0,0.4)',
                                            padding: '6px 12px',
                                            borderRadius: '6px',
                                            border: '1px solid rgba(255,255,255,0.15)',
                                            color: '#f3f4f6',
                                            letterSpacing: '2px',
                                            fontWeight: 'bold',
                                          }}>
                                            {devAuth.code}
                                          </code>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              navigator.clipboard.writeText(devAuth.code);
                                              setCopiedCode(true);
                                              setTimeout(() => setCopiedCode(false), 2000);
                                            }}
                                            style={{
                                              background: 'rgba(168,85,247,0.15)',
                                              color: '#c084fc',
                                              border: '1px solid rgba(168,85,247,0.3)',
                                              borderRadius: '4px',
                                              padding: '4px 10px',
                                              fontSize: '0.65rem',
                                              cursor: 'pointer',
                                              fontFamily: 'monospace',
                                              fontWeight: 600,
                                              transition: 'all 0.2s',
                                            }}
                                          >
                                            {copiedCode ? '✓ COPIED' : 'COPY'}
                                          </button>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
                                          <span style={{ color: '#a855f7', fontWeight: 'bold' }}>2.</span>
                                          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Click the link below and paste the code when prompted:</span>
                                        </div>

                                        <div style={{ paddingLeft: '16px' }}>
                                          <a
                                            href={devAuth.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '6px',
                                              background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
                                              color: 'white',
                                              textDecoration: 'none',
                                              padding: '6px 16px',
                                              borderRadius: '4px',
                                              fontSize: '0.72rem',
                                              fontWeight: 600,
                                              cursor: 'pointer',
                                              boxShadow: '0 2px 8px rgba(168, 85, 247, 0.3)',
                                              transition: 'all 0.2s',
                                            }}
                                          >
                                            Open Activation Page ↗
                                          </a>
                                        </div>
                                      </div>

                                      <details style={{ marginTop: '12px' }}>
                                        <summary style={{
                                          fontSize: '0.68rem',
                                          color: '#9ca3af',
                                          cursor: 'pointer',
                                          userSelect: 'none',
                                          outline: 'none',
                                          padding: '4px 0',
                                        }}>
                                          View terminal logs
                                        </summary>
                                        <pre style={{
                                          marginTop: '8px',
                                          background: '#02040a',
                                          padding: '10px',
                                          borderRadius: '6px',
                                          maxHeight: '150px',
                                          overflowY: 'auto',
                                          whiteSpace: 'pre-wrap',
                                          wordBreak: 'break-all',
                                          fontSize: '0.7rem',
                                          color: `rgb(${accentRgb})`,
                                          border: '1px solid rgba(255,255,255,0.05)',
                                          textAlign: 'left',
                                          lineHeight: 1.4,
                                        }}>
                                          {cleanAuthLogs(loginLogs) || 'Initializing auth process...'}
                                        </pre>
                                      </details>
                                    </div>
                                  );
                                }

                                return (
                                  <div style={{
                                    marginTop: '12px',
                                    padding: '12px',
                                    background: '#070a13',
                                    border: `1px solid rgba(${accentRgb}, 0.3)`,
                                    borderRadius: '8px',
                                    fontFamily: 'Consolas, Monaco, "Courier New", Courier, monospace',
                                    boxShadow: `0 0 15px rgba(${accentRgb}, 0.1)`,
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <div style={{
                                          width: 8, height: 8, borderRadius: '50%',
                                          background: loginStatusActive ? '#10b981' : '#6b7280',
                                          boxShadow: loginStatusActive ? '0 0 8px #10b981' : 'none',
                                          animation: loginStatusActive ? 'pulse 2s infinite' : 'none',
                                        }} />
                                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#f3f4f6' }}>
                                          Terminal ({loginStatusActive ? 'running' : 'exited'})
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={killAuthWizard}
                                        style={{
                                          background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '0.72rem',
                                          transition: 'color 0.2s',
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.color = '#f3f4f6'}
                                        onMouseLeave={(e) => e.currentTarget.style.color = '#9ca3af'}
                                      >
                                        ✕ Close
                                      </button>
                                    </div>

                                    {loginError && (
                                      <div style={{ color: '#ef4444', fontSize: '0.72rem', marginBottom: '8px', background: 'rgba(239, 68, 68, 0.1)', padding: '6px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                        <strong>Error:</strong> {loginError}
                                      </div>
                                    )}

                                    <pre style={{
                                      background: '#02040a',
                                      padding: '10px',
                                      borderRadius: '6px',
                                      maxHeight: '220px',
                                      overflowY: 'auto',
                                      margin: '0 0 10px 0',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-all',
                                      fontSize: '0.72rem',
                                      color: `rgb(${accentRgb})`,
                                      border: '1px solid rgba(255,255,255,0.05)',
                                      textAlign: 'left',
                                      lineHeight: 1.4,
                                      boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)',
                                    }}>
                                      {cleanAuthLogs(loginLogs) || 'Initializing auth process...'}
                                    </pre>

                                    {loginStatusActive && (
                                      <form onSubmit={(e) => { e.preventDefault(); sendAuthInput(); }} style={{ display: 'flex', gap: '8px' }}>
                                        <input
                                          type="text"
                                          value={loginInputValue}
                                          onChange={(e) => setLoginInputValue(e.target.value)}
                                          placeholder="Type verification code, email or prompt response..."
                                          style={{
                                            flex: 1,
                                            background: '#0b0f19',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '4px',
                                            padding: '6px 10px',
                                            color: '#f3f4f6',
                                            fontSize: '0.75rem',
                                            outline: 'none',
                                            transition: 'border-color 0.2s',
                                          }}
                                          onFocus={(e) => e.currentTarget.style.borderColor = `rgb(${accentRgb})`}
                                          onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
                                        />
                                        <button
                                          type="submit"
                                          style={{
                                            background: `rgba(${accentRgb}, 0.2)`,
                                            border: `1px solid rgb(${accentRgb})`,
                                            borderRadius: '4px',
                                            color: 'white',
                                            padding: '6px 16px',
                                            fontSize: '0.72rem',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                          }}
                                        >
                                          Send
                                        </button>
                                      </form>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Pair Mining (Worker Target) — orchestrates bulk training
                        data generation. Set a pair target; the coordinator fires
                        up to Max parallel CLI sessions (your subscription compute)
                        via perry-worker, running /perry-worker to crank through
                        synthesize_pair / long_form_scene tasks until the manifest
                        is satisfied. */}
                    {(() => {
                      const t = targetInfo?.target ?? null;
                      const cur = targetInfo?.currentPairs ?? 0;
                      const pct = t ? Math.min(100, Math.round((cur / t) * 100)) : 0;
                      const targetReached = t != null && cur >= t;
                      const anthropicPanelOnline = assistStatus?.anthropic?.daemonAlive ?? false;
                      const antigravPanelOnline = assistStatus?.antigrav?.daemonAlive ?? false;
                      const codexPanelOnline = assistStatus?.codex?.daemonAlive ?? false;
                      const anyDaemonOnline = anthropicPanelOnline || antigravPanelOnline || codexPanelOnline;
                      return (
                        <div style={{
                          background: 'rgba(99,102,241,0.04)',
                          border: '1px solid rgba(99,102,241,0.25)',
                          borderRadius: '12px',
                          padding: '1rem 1.25rem',
                          marginBottom: '1rem',
                        }}>
                          <div style={{
                            display: 'grid', gridTemplateColumns: 'auto 1fr auto',
                            gap: '1rem', alignItems: 'center', marginBottom: t ? '0.5rem' : 0,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div style={{
                                width: 10, height: 10, borderRadius: '50%',
                                background: anyDaemonOnline ? '#6366f1' : '#6b7280',
                                animation: anyDaemonOnline ? 'pulse 2s infinite' : 'none',
                              }} />
                              <strong style={{ color: '#6366f1', fontSize: '0.875rem' }}>Pair Mining Target</strong>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                {t ? `target ${t} pairs` : 'no target set'} · uses {agentInput === 'antigrav' ? 'Anti-Grav' : agentInput === 'codex' ? 'Codex' : 'Anthropic'} daemon
                              </span>
                            </div>
                            <div style={{ fontSize: '0.85rem', display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                              {t ? (
                                <>
                                  <span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{cur}</strong> / {t} pairs ({pct}%)</span>
                                  <span style={{ color: 'var(--text-muted)' }}>
                                    injected <strong style={{ color: 'white', fontVariantNumeric: 'tabular-nums' }}>{targetInfo?.injected ?? 0}</strong>
                                    {' · '}done <strong style={{ color: 'white', fontVariantNumeric: 'tabular-nums' }}>{targetInfo?.doneInPool ?? 0}</strong>
                                    {' · '}max workers <strong style={{ color: 'white', fontVariantNumeric: 'tabular-nums' }}>{targetInfo?.maxWorkers ?? 20}</strong>
                                  </span>
                                </>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>
                                  Daemon fires up to <strong>Max</strong> {agentInput === 'antigrav' ? 'Anti-Grav (Gemini)' : agentInput === 'codex' ? 'Codex (OpenAI)' : 'Anthropic'} sessions in parallel until the target is hit. Burns through assist + mining tasks; right approach for filling v7's training pool.
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              {!t ? (
                                <>
                                  <input
                                    type="number"
                                    placeholder="target (e.g. 1200)"
                                    value={targetInput}
                                    onChange={(e) => setTargetInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSetWorkerTarget()}
                                    disabled={targetBusy}
                                    style={{
                                      width: '110px', background: 'rgba(255,255,255,0.06)', color: 'white',
                                      border: '1px solid rgba(255,255,255,0.15)', padding: '0.3rem 0.5rem',
                                      borderRadius: '4px', fontSize: '0.75rem',
                                    }}
                                  />
                                  <input
                                    type="number"
                                    placeholder="max (20)"
                                    value={maxWorkersInput}
                                    onChange={(e) => setMaxWorkersInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSetWorkerTarget()}
                                    disabled={targetBusy}
                                    style={{
                                      width: '85px', padding: '0.3rem 0.5rem',
                                      background: 'rgba(255,255,255,0.06)',
                                      border: '1px solid rgba(255,255,255,0.15)',
                                      borderRadius: '4px', color: 'white', fontSize: '0.75rem',
                                    }}
                                  />
                                  <select
                                    value={agentInput}
                                    onChange={(e) => setAgentInput(e.target.value)}
                                    disabled={targetBusy}
                                    style={{
                                      padding: '0.3rem 0.5rem',
                                      background: 'rgba(255,255,255,0.06)',
                                      border: '1px solid rgba(255,255,255,0.15)',
                                      borderRadius: '4px', color: 'white', fontSize: '0.75rem',
                                    }}
                                  >
                                    <option value="anthropic">Anthropic</option>
                                    <option value="antigrav">Anti-Grav</option>
                                    <option value="codex">Codex</option>
                                  </select>
                                  <button
                                    onClick={handleSetWorkerTarget}
                                    disabled={targetBusy || !targetInput}
                                    style={{
                                      padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600,
                                      background: 'rgba(99,102,241,0.2)',
                                      border: '1px solid rgba(99,102,241,0.4)',
                                      color: '#6366f1', borderRadius: '4px',
                                      cursor: targetBusy || !targetInput ? 'not-allowed' : 'pointer',
                                      opacity: targetBusy || !targetInput ? 0.5 : 1,
                                    }}
                                  >Set</button>
                                </>
                              ) : (
                                <button
                                  onClick={handleCancelWorkerTarget}
                                  disabled={targetBusy}
                                  style={{
                                    padding: '0.3rem 0.75rem', fontSize: '0.75rem',
                                    background: 'rgba(239,68,68,0.15)',
                                    border: '1px solid rgba(239,68,68,0.3)',
                                    color: '#ef4444', borderRadius: '4px',
                                    cursor: targetBusy ? 'not-allowed' : 'pointer',
                                  }}
                                >{targetReached ? 'Clear' : 'Cancel'}</button>
                              )}
                            </div>
                          </div>
                          {t && (
                            <div style={{
                              height: 6, borderRadius: 3, overflow: 'hidden',
                              background: 'rgba(255,255,255,0.06)',
                            }}>
                              <div style={{
                                height: '100%', width: `${pct}%`,
                                background: targetReached ? '#22c55e' : 'linear-gradient(90deg, #6366f1, #818cf8)',
                                transition: 'width 0.5s ease',
                              }} />
                            </div>
                          )}
                          {t && !anyDaemonOnline && (
                            <div style={{
                              marginTop: '0.5rem', padding: '0.4rem 0.7rem', fontSize: '0.7rem',
                              background: 'rgba(245,158,11,0.1)',
                              border: '1px solid rgba(245,158,11,0.3)',
                              borderRadius: '4px', color: '#f59e0b',
                            }}>
                              ⚠ No daemon online to claim mining tasks. Start the <strong>{agentInput === 'antigrav' ? 'Anti-Grav' : agentInput === 'codex' ? 'Codex' : 'Anthropic'}</strong> daemon above ↑
                            </div>
                          )}
                        </div>
                      );
                    })()}

                </>)}
                {activeTab === 'gpu' && (<>
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
                          {contextStats!.compressionMultiplier.toFixed(1)}×
                          <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                            {contextStats!.compressionMultiplier > 1.0 ? '↑ Relaxed — more context included' :
                              contextStats!.compressionMultiplier < 1.0 ? '↓ Squeezing — less context to fit' :
                                '— Normal compression'}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.7rem' }}>
                        {[0.3, 0.5, 0.7, 1.0, 1.5, 2.0, 3.0].map(m => (
                          <div key={m} style={{
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px',
                            background: contextStats!.compressionMultiplier === m ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                            color: contextStats!.compressionMultiplier === m ? 'white' : 'var(--text-muted)',
                            fontWeight: contextStats!.compressionMultiplier === m ? 600 : 400,
                            border: '1px solid',
                            borderColor: contextStats!.compressionMultiplier === m ? 'var(--accent)' : 'var(--panel-border)',
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
                  </>)}
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
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
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
                  onChange={e => setNewProject({ ...newProject, title: e.target.value })}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                />
              </div>
              <div>
                <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Description</label>
                <textarea
                  value={newProject.description}
                  onChange={e => setNewProject({ ...newProject, description: e.target.value })}
                  required
                  rows={4}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                />
              </div>
              <div>
                <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Template</label>
                <select
                  value={newProject.type}
                  onChange={e => setNewProject({ ...newProject, type: e.target.value })}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                >
                  {projectWorkType !== 'all' ? (
                    templates
                      .filter(t => t.workType === projectWorkType)
                      .map(t => (
                        <option key={t.type} value={t.type}>{t.name}</option>
                      ))
                  ) : (
                    Array.from(new Set(templates.map(t => t.workType || 'other'))).map(wt => {
                      const groupTemplates = templates.filter(t => (t.workType || 'other') === wt);
                      if (groupTemplates.length === 0) return null;
                      let label = wt === 'dnd' ? 'D&D' : wt === 'other' ? 'Other' : wt.charAt(0).toUpperCase() + wt.slice(1) + 's';
                      if (wt === 'books') label = 'Books';
                      if (wt === 'code') label = 'Code';
                      return (
                        <optgroup key={wt} label={label}>
                          {groupTemplates.map(t => (
                            <option key={t.type} value={t.type}>{t.name}</option>
                          ))}
                        </optgroup>
                      );
                    })
                  )}
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
                  onChange={e => setNewProject({ ...newProject, preferredProvider: e.target.value })}
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

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && selectedProject && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
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

      {/* Evolve WorkType to Template Modal */}
      {isEvolveModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '550px', position: 'relative' }}>
            <button
              onClick={() => setIsEvolveModalOpen(false)}
              style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            <h2 className="mb-4" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'white' }}>
              <Cpu size={20} color="var(--accent)" /> Evolve {adminEvolveWorkType.toUpperCase()} to Template
            </h2>
            <p className="text-xs text-muted mb-4">
              Describe what you want the custom pipeline to do. Perry will analyze your goal and smartly assign steps to standard workers, local GPUs, or ComfyUI.
            </p>
            <form onSubmit={handleAdminEvolveWorkTypeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Template Name</label>
                <input
                  type="text"
                  value={evolveTemplateName}
                  onChange={e => setEvolveTemplateName(e.target.value)}
                  placeholder="e.g., Short Story Creator"
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                />
              </div>
              <div>
                <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Description</label>
                <input
                  type="text"
                  value={evolveTemplateDesc}
                  onChange={e => setEvolveTemplateDesc(e.target.value)}
                  placeholder="e.g., Generates characters, writes a draft, and runs ComfyUI cover art."
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                />
              </div>
              <div>
                <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Pipeline Goal & Steps</label>
                <textarea
                  value={evolvePipelineGoal}
                  onChange={e => setEvolvePipelineGoal(e.target.value)}
                  placeholder="e.g., First create a narrative blueprint, then write the scene prose, then run an analysis/critique step, and finally generate cover artwork using ComfyUI."
                  required
                  rows={4}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white', fontSize: '0.8rem' }}
                />
              </div>
              <div>
                <label className="text-sm text-muted mb-1" style={{ display: 'block' }}>Smart Worker & Resource Routing</label>
                <select
                  value={evolveWorkersMode}
                  onChange={e => setEvolveWorkersMode(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--panel-border)', background: 'var(--bg-main)', color: 'white' }}
                >
                  <option value="smart">Smart Routing (Decide automatically based on step requirements)</option>
                  <option value="gpu">Local GPU Only (Force LLM steps to Ollama local GPU)</option>
                  <option value="subscription">Subscription CLI Only (Force LLM steps to Claude/Gemini)</option>
                </select>
                <p className="text-xs text-muted mt-1">
                  * Note: Image generation steps will always bypass LLM workers and route directly to ComfyUI if detected.
                </p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsEvolveModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isEvolvingTemplate} style={{ background: 'rgba(34,211,238,0.15)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.4)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {isEvolvingTemplate ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Evolve to Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
