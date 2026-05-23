/**
 * DomainsPanel — define + edit the task verticals Perry can be pointed at.
 *
 * Features:
 *   - List, create, EDIT, delete domains
 *   - Per-domain default skills (skill picker)
 *   - "Create custom skill" form for hand-authored skills (skips propose
 *     queue → lands straight in skills-installed/)
 *   - GUIDED WIZARD: idiot-proof step-by-step single-page domain configuration.
 *   - PERRY AI MODEL RECOMMENDATIONS: simulates domain requirements research
 *     and offers 3 clear, hardware-aware model choices with inline status checks.
 *
 * The platform is domain-agnostic. A domain definition tells the dashboard
 * which projects belong where, which color/icon to render, and which
 * dashboard panels to surface (plugin contract). `defaultSkills` ties a
 * skill list to a domain so each task vertical can carry its own playbook.
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import { PanelHeader } from './PanelHeader';
import {
  Sparkles,
  Code,
  BookOpen,
  Shield,
  Terminal,
  Cpu,
  Database,
  Globe,
  Activity,
  PenTool,
  ArrowRight,
  ArrowLeft,
  Check,
  Brain,
  ChevronRight,
  Info,
  DownloadCloud,
  Mail,
  Swords
} from 'lucide-react';

interface Domain {
  id: string;
  label: string;
  description: string;
  color: string;
  icon: string;
  dashboardPanels: string[];
  defaultSkills: { service: string; name: string }[];
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
  baseModel?: string;
  allowedMcpServers?: string[];
  modelParameters?: {
    temperature?: number;
    maxTokens?: number;
    repeatPenalty?: number;
    topP?: number;
    topK?: number;
  };
}

interface Skill {
  filename: string;
  name: string;
  description: string;
  service: string;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema?: any;
}

interface McpServerInfo {
  id: string;
  status: 'connected' | 'disconnected';
  tools: McpTool[];
}

const AVAILABLE_PANELS = ['projects', 'workers', 'trajectories', 'analytics', 'models', 'self-learning', 'pens'];
const KNOWN_SERVICES = ['worker', 'audit', 'director', 'gc', 'prompt-builder', 'scout', 'trainer'];

const PRESET_COLORS = [
  { hex: '#22d3ee', name: 'Cyan' },
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#a855f7', name: 'Purple' },
  { hex: '#ec4899', name: 'Rose' },
  { hex: '#ef4444', name: 'Red' },
  { hex: '#10b981', name: 'Emerald' },
  { hex: '#f59e0b', name: 'Amber' },
  { hex: '#6366f1', name: 'Indigo' }
];

const PRESET_ICONS = [
  { name: 'sparkles', label: 'Sparkles' },
  { name: 'code', label: 'Code' },
  { name: 'book-open', label: 'Book' },
  { name: 'shield', label: 'Shield' },
  { name: 'terminal', label: 'Terminal' },
  { name: 'cpu', label: 'CPU' },
  { name: 'database', label: 'Database' },
  { name: 'globe', label: 'Globe' },
  { name: 'activity', label: 'Activity' },
  { name: 'pen-tool', label: 'Pen Tool' },
  { name: 'mail', label: 'Mail' },
  { name: 'swords', label: 'Swords' }
];

type FormState = {
  id: string;
  label: string;
  description: string;
  color: string;
  icon: string;
  dashboardPanels: string[];
  defaultSkills: { service: string; name: string }[];
  baseModel: string;
  allowedMcpServers?: string[];
  modelParameters?: {
    temperature?: number;
    maxTokens?: number;
    repeatPenalty?: number;
    topP?: number;
    topK?: number;
  };
};

const EMPTY_FORM: FormState = {
  id: '',
  label: '',
  description: '',
  color: '#a855f7',
  icon: 'sparkles',
  dashboardPanels: ['projects', 'self-learning', 'trajectories'],
  defaultSkills: [],
  baseModel: 'workers',
  allowedMcpServers: undefined,
  modelParameters: undefined,
};

function renderDomainIcon(name: string, size = 16, color?: string) {
  const props = { size, color };
  switch (name) {
    case 'sparkles': return <Sparkles {...props} />;
    case 'code': return <Code {...props} />;
    case 'book-open': return <BookOpen {...props} />;
    case 'shield': return <Shield {...props} />;
    case 'terminal': return <Terminal {...props} />;
    case 'cpu': return <Cpu {...props} />;
    case 'database': return <Database {...props} />;
    case 'globe': return <Globe {...props} />;
    case 'activity': return <Activity {...props} />;
    case 'pen-tool': return <PenTool {...props} />;
    case 'mail': return <Mail {...props} />;
    case 'swords': return <Swords {...props} />;
    default: return <Sparkles {...props} />;
  }
}

export function DomainsPanel() {
  // Helper for lazy state initialization from localStorage
  const getSavedDraftValue = <T,>(key: string, defaultValue: T): T => {
    try {
      const saved = localStorage.getItem('perry-domain-wizard-draft');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed[key] !== undefined) {
          return parsed[key];
        }
      }
    } catch (e) {
      console.error('Failed to load draft from localStorage:', e);
    }
    return defaultValue;
  };

  const [domains, setDomains] = useState<Domain[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [installedModels, setInstalledModels] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>(() => getSavedDraftValue('mode', 'list'));
  const [editingId, setEditingId] = useState<string | null>(() => getSavedDraftValue('editingId', null));
  const [draft, setDraft] = useState<FormState>(() => getSavedDraftValue('draft', EMPTY_FORM));
  const restrictMcp = draft.allowedMcpServers !== undefined;
  const [showSkillCreator, setShowSkillCreator] = useState(false);
  const [skillDraft, setSkillDraft] = useState({
    name: '',
    description: '',
    service: 'worker',
    body: '',
    appliesWhen: '',
  });

  // Wizard flow states
  const [currentStep, setCurrentStep] = useState<number>(() => getSavedDraftValue('currentStep', 1));
  const [lastResearchedText, setLastResearchedText] = useState<string>(() => getSavedDraftValue('lastResearchedText', ''));
  const [researchLogs, setResearchLogs] = useState<string[]>([]);
  const [researchProgress, setResearchProgress] = useState<number>(0);
  const [isResearching, setIsResearching] = useState<boolean>(false);

  // Playbook Assessment states
  const [assessmentResults, setAssessmentResults] = useState<{
    domainAnalysis?: {
      summary: string;
      requiredMcpServers: string[];
      requiredTools: string[];
      suggestedTeamSize: number;
      suggestedTeamRoles: { role: string; description: string }[];
    };
    recommendedSkills?: { name: string; reason: string }[];
    suggestedNewSkills?: { name: string; description: string; body: string }[];
  } | null>(() => getSavedDraftValue('assessmentResults', null));
  const [isAssessing, setIsAssessing] = useState<boolean>(false);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [assessmentStatus, setAssessmentStatus] = useState<string>('');
  const [expandedSuggestedSkills, setExpandedSuggestedSkills] = useState<Record<string, boolean>>(() => getSavedDraftValue('expandedSuggestedSkills', {}));
  const [installedSuggestedSkills, setInstalledSuggestedSkills] = useState<Record<string, boolean>>(() => getSavedDraftValue('installedSuggestedSkills', {}));

  // Model Pulling states
  const [pullingModel, setPullingModel] = useState<{ name: string; endpoint: string; progress: string; pct: number | null } | null>(null);
  const [customModelName, setCustomModelName] = useState<string>(() => getSavedDraftValue('customModelName', 'deepseek-r1:7b'));
  const [customModelEndpoint, setCustomModelEndpoint] = useState<'writer' | 'librarian'>(() => getSavedDraftValue('customModelEndpoint', 'librarian'));
  const [presetModel, setPresetModel] = useState<string>(() => getSavedDraftValue('presetModel', 'deepseek-r1:7b'));

  // Autosave draft state to localStorage
  useEffect(() => {
    if (mode === 'list') {
      localStorage.removeItem('perry-domain-wizard-draft');
    } else {
      const draftObj = {
        mode,
        editingId,
        draft,
        currentStep,
        lastResearchedText,
        assessmentResults,
        expandedSuggestedSkills,
        installedSuggestedSkills,
        customModelName,
        customModelEndpoint,
        presetModel,
      };
      localStorage.setItem('perry-domain-wizard-draft', JSON.stringify(draftObj));
    }
  }, [
    mode,
    editingId,
    draft,
    currentStep,
    lastResearchedText,
    assessmentResults,
    expandedSuggestedSkills,
    installedSuggestedSkills,
    customModelName,
    customModelEndpoint,
    presetModel,
  ]);

  const OLLAMA_PRESETS = [
    { value: 'deepseek-r1:7b', label: 'DeepSeek R1 7B (Reasoning)' },
    { value: 'deepseek-r1:14b', label: 'DeepSeek R1 14B (Reasoning)' },
    { value: 'deepseek-r1:32b', label: 'DeepSeek R1 32B (Reasoning)' },
    { value: 'llama3.3:70b', label: 'Llama 3.3 70B (General Heavyweight)' },
    { value: 'llama3.2:3b', label: 'Llama 3.2 3B (Lightweight)' },
    { value: 'llama3.2:1b', label: 'Llama 3.2 1B (Ultra-Lightweight)' },
    { value: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B (Coding)' },
    { value: 'qwen2.5-coder:14b', label: 'Qwen 2.5 Coder 14B (Coding)' },
    { value: 'gemma2:9b', label: 'Gemma 2 9B (Google Balanced)' },
    { value: 'gemma2:27b', label: 'Gemma 2 27B (Google Heavyweight)' },
    { value: 'mistral:7b', label: 'Mistral 7B (General)' },
    { value: 'phi3:3.8b', label: 'Phi 3 3.8B (Microsoft Lightweight)' },
    { value: 'nomic-embed-text', label: 'Nomic Embed Text (Embeddings)' },
    { value: 'custom', label: 'Custom / Enter custom name...' }
  ];

  const handlePresetChange = (val: string) => {
    setPresetModel(val);
    if (val !== 'custom') {
      setCustomModelName(val);
    } else {
      setCustomModelName('');
    }
  };

  async function pullModel(endpoint: string, name: string) {
    if (pullingModel) {
      alert('Another pull is in progress. Wait for it to finish.');
      return;
    }
    if (!name.trim()) {
      alert('Enter a model name');
      return;
    }
    setPullingModel({ name, endpoint, progress: 'Connecting to Ollama…', pct: null });

    const apiKey = localStorage.getItem('perry-api-key') || '';
    let finished = false;
    try {
      const r = await fetch(`/api/models/pull?token=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, name }),
      });
      if (!r.ok || !r.body) {
        setPullingModel(null);
        alert(`Pull failed: HTTP ${r.status}`);
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const ev of events) {
          const lines = ev.split('\n');
          const eventType = lines.find(l => l.startsWith('event:'))?.slice(7).trim();
          const dataLine = lines.find(l => l.startsWith('data:'))?.slice(5).trim();
          if (!dataLine) continue;
          try {
            const data = JSON.parse(dataLine);
            if (eventType === 'progress') {
              const pct = data.completed && data.total ? Math.round((data.completed / data.total) * 100) : null;
              const sizeNote = data.total ? ` (${(data.completed / 1e9).toFixed(1)} GB / ${(data.total / 1e9).toFixed(1)} GB)` : '';
              setPullingModel({ name, endpoint, progress: pct !== null ? `${data.status} — ${pct}%${sizeNote}` : data.status || 'working…', pct });
            } else if (eventType === 'complete') {
              finished = true;
              setPullingModel({ name, endpoint, progress: '✓ Complete', pct: 100 });
              setTimeout(() => {
                setDraft(d => ({ ...d, baseModel: name }));
                setPullingModel(null);
                refresh();
              }, 1500);
            } else if (eventType === 'error') {
              finished = true;
              setPullingModel({ name, endpoint, progress: `⚠ ${data.error}`, pct: null });
              setTimeout(() => setPullingModel(null), 3000);
            }
          } catch { /* skip malformed */ }
        }
      }
      if (!finished) {
        setDraft(d => ({ ...d, baseModel: name }));
        setPullingModel(null);
        refresh();
      }
    } catch (e: any) {
      setPullingModel({ name, endpoint, progress: `⚠ ${e.message}`, pct: null });
      setTimeout(() => setPullingModel(null), 3000);
    }
  }

  const pollIntervalRef = useRef<any>(null);
  const logIntervalRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (logIntervalRef.current) clearInterval(logIntervalRef.current);
    };
  }, []);

  async function runPlaybookAssessment() {
    setIsAssessing(true);
    setAssessmentError(null);
    setAssessmentResults(null);
    
    // Personalized logging messages showing the AI reading the inputs
    const logs = [
      `Initializing Perry AI Playbook Assistant for "${draft.label}"...`,
      `Reading domain description: "${draft.description.slice(0, 45)}${draft.description.length > 45 ? '...' : ''}"`,
      `Scanning workspace for existing installed skills...`,
      `Dispatching agent "meta.playbook-analyst" to subscription worker pool...`,
      `Setting DB immediate trigger flags for CLI daemon...`,
      `Worker started: analyzing capability gaps for "${draft.label}"...`,
      `Comparing existing playbooks against description keywords...`,
      `Bespoke skill generation in progress (designing kebab-case custom scripts)...`,
      `Validating generated skill syntax and Markdown formats...`,
      `Compiling final recommendations and explanations...`
    ];

    let currentLogIndex = 0;
    setAssessmentStatus(logs[0]);
    
    if (logIntervalRef.current) clearInterval(logIntervalRef.current);
    logIntervalRef.current = setInterval(() => {
      currentLogIndex = (currentLogIndex + 1) % logs.length;
      setAssessmentStatus(logs[currentLogIndex]);
    }, 2800);

    try {
      const response = await fetch('/api/domains/assess-playbook', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: draft.label,
          description: draft.description,
          baseModel: draft.baseModel,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || 'Playbook assessment failed');
      }

      const data = await response.json();
      const sessionId = data.sessionId;
      if (!sessionId) {
        throw new Error('No sessionId returned from playbook assessment API');
      }

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/domains/assess-playbook/status/${sessionId}`, {
            credentials: 'include',
          });
          if (!statusRes.ok) {
            const errData = await statusRes.json().catch(() => ({ error: `HTTP ${statusRes.status}` }));
            throw new Error(errData.error || 'Failed to poll assessment status');
          }
          const statusData = await statusRes.json();

          if (statusData.status === 'completed') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            if (logIntervalRef.current) {
              clearInterval(logIntervalRef.current);
              logIntervalRef.current = null;
            }
            setAssessmentResults(statusData.result);
            setIsAssessing(false);
          } else if (statusData.status === 'failed') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            if (logIntervalRef.current) {
              clearInterval(logIntervalRef.current);
              logIntervalRef.current = null;
            }
            setAssessmentError(statusData.error || 'Playbook assessment worker failed');
            setIsAssessing(false);
          }
        } catch (pollErr: any) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          if (logIntervalRef.current) {
            clearInterval(logIntervalRef.current);
            logIntervalRef.current = null;
          }
          setAssessmentError(pollErr.message);
          setIsAssessing(false);
        }
      }, 3000);

    } catch (err: any) {
      if (logIntervalRef.current) {
        clearInterval(logIntervalRef.current);
        logIntervalRef.current = null;
      }
      setAssessmentError(err.message);
      setIsAssessing(false);
    }
  }

  async function installSuggestedSkill(s: { name: string; description: string; body: string }) {
    try {
      setAssessmentError(null);
      const r = await fetch('/api/domains/install-skill', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: s.name,
          description: s.description,
          service: 'worker',
          body: s.body,
        }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || 'Failed to install skill');
      }

      // Mark as installed in UI state
      setInstalledSuggestedSkills(prev => ({ ...prev, [s.name]: true }));
      
      // Add to draft.defaultSkills
      setDraft(d => {
        const exists = d.defaultSkills.some(x => x.service === 'worker' && x.name === s.name);
        if (exists) return d;
        return {
          ...d,
          defaultSkills: [...d.defaultSkills, { service: 'worker', name: s.name }]
        };
      });

      // Refresh list of skills from backend so the rest of the UI knows about it
      await refresh();
    } catch (e: any) {
      setAssessmentError(e.message);
    }
  }

  function toggleRecommendedSkill(recName: string) {
    const skillObj = skills.find(s => s.name === recName);
    if (!skillObj) return;
    toggleDefaultSkill(skillObj);
  }

  async function refresh() {
    try {
      setError(null);
      const [dRes, sRes, mRes, mcpRes] = await Promise.all([
        fetch('/api/domains', { credentials: 'include' }),
        fetch('/api/skills', { credentials: 'include' }),
        fetch('/api/models', { credentials: 'include' }),
        fetch('/api/domains/mcp-servers', { credentials: 'include' }),
      ]);
      if (!dRes.ok) throw new Error(`domains HTTP ${dRes.status}`);
      const dData = await dRes.json();
      setDomains(dData.domains || []);
      
      if (sRes.ok) {
        const sData = await sRes.json();
        setSkills(sData.installed || []);
      }

      if (mcpRes.ok) {
        const mcpData = await mcpRes.json();
        setMcpServers(mcpData.servers || []);
      }

      if (mRes.ok) {
        const mData = await mRes.json();
        const modelsSet = new Set<string>();
        for (const ep of mData.endpoints || []) {
          for (const m of ep.models || []) {
            modelsSet.add(m.name);
          }
        }
        setInstalledModels(modelsSet);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  // Automatic kebab-case slug creator for domain ID
  useEffect(() => {
    if (mode === 'create' && draft.label) {
      const generatedSlug = draft.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      
      setDraft(d => {
        const prevSlug = d.label ? d.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : '';
        // Only auto-update ID if it is empty or matches the old generated slug
        if (!d.id || d.id === prevSlug) {
          return { ...d, id: generatedSlug };
        }
        return d;
      });
    }
  }, [draft.label, mode]);

  // Model selection recommendations algorithm
  const modelRecommendation = useMemo(() => {
    const text = `${draft.label} ${draft.description}`.toLowerCase();
    const isCoding = /\b(code|coding|dev|developer|software|programming|system|security|audit|script|bug|issue|git|github|rust|go|javascript|typescript|python|c\+\+|c#|java|html|css|sql)\b/.test(text);
    const isCreative = /\b(book|novel|fiction|story|creative|writing|author|literature|poetry|character|plot|nsfw|rp|roleplay|noromaid|magnum)\b/.test(text);

    if (isCoding) {
      return {
        recommendedName: 'qwen3.6:27b',
        role: 'researcher',
        reason: 'Qwen 3.6 27B is excellent at structured code analysis and technical tasks. Ideal for code-review and development domains.',
        options: [
          { name: 'qwen3.6:27b', label: 'Local Heavyweight (RTX 5090)', desc: 'Qwen 3.6 27B - Best for offline coding & architecture', recommended: true, hw: '5090', endpoint: 'writer' },
          { name: 'qwen3:14b', label: 'Local Balanced (RTX 5070 Ti)', desc: 'Qwen 3 14B - Faster execution, low resource usage', recommended: false, hw: '5070 Ti', endpoint: 'librarian' },
          { name: 'workers', label: 'Cloud Workers (Claude/Gemini)', desc: 'Claude 3.5 Sonnet & Gemini API - Maximum reasoning capabilities', recommended: false, hw: 'Cloud', endpoint: '' }
        ]
      };
    } else if (isCreative) {
      return {
        recommendedName: 'hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M',
        role: 'writer',
        reason: 'Magnum 32B offers exceptional narrative prose style and structural story plotting. Perfect for writing domains.',
        options: [
          { name: 'hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M', label: 'Local Heavyweight (RTX 5090)', desc: 'Magnum 32B - Best prose quality and character voices', recommended: true, hw: '5090', endpoint: 'writer' },
          { name: 'gemma3:12b', label: 'Local Balanced (RTX 5070 Ti)', desc: 'Gemma 3 12B - Good for outline generation and quick summaries', recommended: false, hw: '5070 Ti', endpoint: 'librarian' },
          { name: 'workers', label: 'Cloud Workers (Claude/Gemini)', desc: 'Claude/Gemini API - Top-tier copy-editing and brainstorming', recommended: false, hw: 'Cloud', endpoint: '' }
        ]
      };
    } else {
      return {
        recommendedName: 'gemma3:27b',
        role: 'general',
        reason: 'Gemma 3 27B provides a strong balance of conversational depth, reasoning, and standard agent instructions.',
        options: [
          { name: 'gemma3:27b', label: 'Local Heavyweight (RTX 5090)', desc: 'Gemma 3 27B - Standard offline agent model', recommended: true, hw: '5090', endpoint: 'writer' },
          { name: 'gemma3:12b', label: 'Local Balanced (RTX 5070 Ti)', desc: 'Gemma 3 12B - Efficient low-latency inference', recommended: false, hw: '5070 Ti', endpoint: 'librarian' },
          { name: 'workers', label: 'Cloud Workers (Claude/Gemini)', desc: 'Claude/Gemini API - Zero setup, handles any workload', recommended: false, hw: 'Cloud', endpoint: '' }
        ]
      };
    }
  }, [draft.label, draft.description]);

  function triggerModelResearch() {
    const searchText = `${draft.label} ${draft.description}`;
    if (searchText === lastResearchedText) {
      return;
    }
    
    setIsResearching(true);
    setResearchProgress(0);
    setResearchLogs(['Initializing Perry AI Model Assistant...']);
    
    const logs = [
      'Analyzing target domain vertical scope...',
      'Matching keywords against installed skill catalog...',
      'Evaluating hardware constraints (RTX 5090 / 5070 Ti capacity)...',
      'Checking VRAM allocation threshold constraints...',
      'Synthesizing model capabilities recommendation report...',
      'Research complete. Recommended models generated.'
    ];
    
    let currentLogIndex = 0;
    const interval = setInterval(() => {
      setResearchProgress(prev => {
        const next = prev + 15;
        if (next >= 100) {
          clearInterval(interval);
          setIsResearching(false);
          setLastResearchedText(searchText);
          
          // Auto-select recommended model based on description keywords
          setDraft(d => ({ ...d, baseModel: modelRecommendation.recommendedName }));
          return 100;
        }
        
        const logTrigger = Math.floor((next / 100) * logs.length);
        if (logTrigger > currentLogIndex && currentLogIndex < logs.length) {
          setResearchLogs(prevLogs => [...prevLogs, logs[currentLogIndex]]);
          currentLogIndex++;
        }
        return next;
      });
    }, 180);
  }

  function startCreate() {
    setDraft(EMPTY_FORM);
    setEditingId(null);
    setMode('create');
    setError(null);
    setCurrentStep(1);
    setLastResearchedText('');
    setAssessmentResults(null);
    setAssessmentError(null);
    setIsAssessing(false);
    setAssessmentStatus('');
    setExpandedSuggestedSkills({});
    setInstalledSuggestedSkills({});
  }

  // Clear assessment when editing domain as well
  function startEdit(d: Domain) {
    setDraft({
      id: d.id,
      label: d.label,
      description: d.description,
      color: d.color,
      icon: d.icon,
      dashboardPanels: d.dashboardPanels,
      defaultSkills: d.defaultSkills || [],
      baseModel: d.baseModel || 'workers',
      allowedMcpServers: d.allowedMcpServers,
      modelParameters: d.modelParameters,
    });
    setEditingId(d.id);
    setMode('edit');
    setError(null);
    setCurrentStep(1);
    setLastResearchedText('');
    setAssessmentResults(null);
    setAssessmentError(null);
    setIsAssessing(false);
    setAssessmentStatus('');
    setExpandedSuggestedSkills({});
    setInstalledSuggestedSkills({});
  }

  function cancelForm() {
    setMode('list');
    setEditingId(null);
    setDraft(EMPTY_FORM);
    setError(null);
    setCurrentStep(1);
    setLastResearchedText('');
    setAssessmentResults(null);
    setAssessmentError(null);
    setIsAssessing(false);
    setAssessmentStatus('');
    setExpandedSuggestedSkills({});
    setInstalledSuggestedSkills({});
    localStorage.removeItem('perry-domain-wizard-draft');
  }

  function nextStep() {
    if (currentStep === 1) {
      if (mode === 'create' && !draft.id.trim()) {
        setError('Domain ID is required');
        return;
      }
      if (mode === 'create' && !/^[a-z][a-z0-9-]{2,31}$/.test(draft.id)) {
        setError('ID must be kebab-case (3-32 chars, lowercase letters, numbers, and dashes)');
        return;
      }
      if (!draft.label.trim()) {
        setError('Label is required');
        return;
      }
      setError(null);
      setCurrentStep(2);
      triggerModelResearch();
    } else if (currentStep === 2) {
      if (pullingModel) {
        alert('Please wait for the model to finish downloading before proceeding.');
        return;
      }
      setCurrentStep(3);
    }
  }

  function prevStep() {
    if (pullingModel) {
      alert('Please wait for the model to finish downloading.');
      return;
    }
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  }

  async function saveDomain() {
    try {
      setError(null);
      const isEdit = mode === 'edit' && editingId;
      const url = isEdit ? `/api/domains/${editingId}` : '/api/domains';
      const method = isEdit ? 'PATCH' : 'POST';
      const payload = {
        ...draft,
        allowedMcpServers: draft.allowedMcpServers === undefined ? null : draft.allowedMcpServers
      };
      const r = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || 'save failed');
      }
      cancelForm();
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteDomain(id: string) {
    if (!confirm(`Delete domain "${id}"? This is not reversible.`)) return;
    try {
      const r = await fetch(`/api/domains/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || 'delete failed');
      }
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function createSkill() {
    try {
      setError(null);
      let appliesWhen: any = undefined;
      if (skillDraft.appliesWhen.trim()) {
        try { appliesWhen = JSON.parse(skillDraft.appliesWhen); } catch { throw new Error('appliesWhen must be valid JSON or empty'); }
      }
      const r = await fetch('/api/skills', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skillDraft.name,
          description: skillDraft.description,
          service: skillDraft.service,
          body: skillDraft.body,
          appliesWhen,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || 'skill create failed');
      }
      if (mode === 'create' || mode === 'edit') {
        setDraft(d => ({ ...d, defaultSkills: [...d.defaultSkills, { service: skillDraft.service, name: skillDraft.name }] }));
      }
      setShowSkillCreator(false);
      setSkillDraft({ name: '', description: '', service: 'worker', body: '', appliesWhen: '' });
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function togglePanel(panel: string) {
    setDraft(d => ({
      ...d,
      dashboardPanels: d.dashboardPanels.includes(panel)
        ? d.dashboardPanels.filter(p => p !== panel)
        : [...d.dashboardPanels, panel],
    }));
  }

  function toggleDefaultSkill(s: Skill) {
    setDraft(d => {
      const exists = d.defaultSkills.some(x => x.service === s.service && x.name === s.name);
      return {
        ...d,
        defaultSkills: exists
          ? d.defaultSkills.filter(x => !(x.service === s.service && x.name === s.name))
          : [...d.defaultSkills, { service: s.service, name: s.name }],
      };
    });
  }

  function toggleMcpRestriction() {
    setDraft(prev => ({
      ...prev,
      allowedMcpServers: prev.allowedMcpServers === undefined
        ? mcpServers.map(s => s.id)
        : undefined
    }));
  }

  function toggleMcpServer(serverId: string) {
    setDraft(prev => {
      const allowed = prev.allowedMcpServers || [];
      const nextAllowed = allowed.includes(serverId)
        ? allowed.filter(id => id !== serverId)
        : [...allowed, serverId];
      return { ...prev, allowedMcpServers: nextAllowed };
    });
  }

  const sortedDomains = useMemo(
    () => domains.slice().sort((a, b) => (a.builtin === b.builtin ? a.label.localeCompare(b.label) : a.builtin ? -1 : 1)),
    [domains]
  );

  const isFormMode = mode === 'create' || mode === 'edit';

  // Group installed skills by service
  const skillsByService = useMemo(() => {
    const groups: { [service: string]: Skill[] } = {};
    for (const s of skills) {
      if (!groups[s.service]) groups[s.service] = [];
      groups[s.service].push(s);
    }
    return groups;
  }, [skills]);

  return (
    <div style={{ padding: '24px', overflowY: 'auto', height: '100%', fontFamily: 'var(--font-mono)' }}>
      <PanelHeader
        eyebrow="CONFIGURE"
        title="Domains"
        subtitle="Task verticals Perry can be pointed at. Each domain configures dashboard panels, default skills, and identity."
      />

      {error && (
        <div style={errorBox}>{error}</div>
      )}

      {!isFormMode && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 16px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{domains.length} domain(s) · {skills.length} installed skill(s) · {installedModels.size} models loaded</span>
          <button onClick={startCreate} style={btnPrimary}>+ Add domain</button>
        </div>
      )}

      {isFormMode && (
        <div style={{ ...cardStyle, background: 'rgba(10, 14, 23, 0.75)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 24px' }}>
          
          {/* Stepper Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ ...stepNumStyle, background: currentStep === 1 ? draft.color : 'rgba(255,255,255,0.08)', color: currentStep === 1 ? '#000' : 'var(--text-dim)' }}>1</span>
                <span style={{ fontSize: '0.85rem', fontWeight: currentStep === 1 ? 600 : 400, color: currentStep === 1 ? 'var(--text-main)' : 'var(--text-dim)' }}>Identity</span>
              </div>
              <ChevronRight size={14} color="var(--text-dim)" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ ...stepNumStyle, background: currentStep === 2 ? draft.color : 'rgba(255,255,255,0.08)', color: currentStep === 2 ? '#000' : 'var(--text-dim)' }}>2</span>
                <span style={{ fontSize: '0.85rem', fontWeight: currentStep === 2 ? 600 : 400, color: currentStep === 2 ? 'var(--text-main)' : 'var(--text-dim)' }}>AI Assistant</span>
              </div>
              <ChevronRight size={14} color="var(--text-dim)" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ ...stepNumStyle, background: currentStep === 3 ? draft.color : 'rgba(255,255,255,0.08)', color: currentStep === 3 ? '#000' : 'var(--text-dim)' }}>3</span>
                <span style={{ fontSize: '0.85rem', fontWeight: currentStep === 3 ? 600 : 400, color: currentStep === 3 ? 'var(--text-main)' : 'var(--text-dim)' }}>Playbook</span>
              </div>
            </div>
            <h3 style={{ margin: 0, color: draft.color, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              {renderDomainIcon(draft.icon, 18, draft.color)}
              {mode === 'edit' ? `Edit "${draft.label || editingId}"` : 'Create Custom Domain'}
            </h3>
          </div>

          {/* STEP 1: IDENTITY & VISUAL THEME */}
          {currentStep === 1 && (
            <div>
              <div style={{ ...gridRow, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {mode === 'create' ? (
                  <div style={fieldRow}>
                    <label style={labelStyle}>Domain ID (Slugified value)</label>
                    <input
                      value={draft.id}
                      onChange={e => setDraft({ ...draft, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                      placeholder="e.g. security-audits"
                      style={inputStyle}
                    />
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                      Kebab-case string. Used internally to associate directories and projects.
                    </span>
                  </div>
                ) : (
                  <div style={fieldRow}>
                    <label style={labelStyle}>Domain ID (Immutable)</label>
                    <input value={draft.id} disabled style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }} />
                  </div>
                )}
                
                <div style={fieldRow}>
                  <label style={labelStyle}>Display Label</label>
                  <input
                    value={draft.label}
                    onChange={e => setDraft({ ...draft, label: e.target.value })}
                    placeholder="e.g. Security Audits"
                    style={inputStyle}
                    autoFocus
                  />
                </div>
              </div>

              <div style={fieldRow}>
                <label style={labelStyle}>Domain Description</label>
                <textarea
                  value={draft.description}
                  onChange={e => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Describe the purpose of this vertical. Perry AI will use this description to research and recommend the best model..."
                  style={{ ...inputStyle, minHeight: 70 }}
                />
              </div>

              {/* Accent Color Palette Picker */}
              <div style={fieldRow}>
                <label style={labelStyle}>Accent Color Palette</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'rgba(0,0,0,0.15)', padding: 12, borderRadius: 6 }}>
                  {PRESET_COLORS.map(c => {
                    const active = draft.color === c.hex;
                    return (
                      <button
                        key={c.hex}
                        onClick={() => setDraft({ ...draft, color: c.hex })}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: c.hex,
                          border: active ? '2px solid var(--text-main)' : '2px solid transparent',
                          boxShadow: active ? `0 0 10px ${c.hex}` : 'none',
                          cursor: 'pointer',
                          transition: 'transform 0.15s ease'
                        }}
                        title={c.name}
                      />
                    );
                  })}
                  <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', height: 24, margin: '0 8px' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Hex:</span>
                    <input
                      type="color"
                      value={draft.color}
                      onChange={e => setDraft({ ...draft, color: e.target.value })}
                      style={{ background: 'transparent', border: 'none', width: 34, height: 24, padding: 0, cursor: 'pointer' }}
                    />
                    <input
                      type="text"
                      value={draft.color}
                      onChange={e => setDraft({ ...draft, color: e.target.value })}
                      style={{ ...inputStyle, width: 80, padding: '2px 6px', fontSize: '0.75rem', height: 24 }}
                    />
                  </div>
                </div>
              </div>

              {/* Visual Icon Grid Picker */}
              <div style={fieldRow}>
                <label style={labelStyle}>Domain Visual Icon</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, background: 'rgba(0,0,0,0.15)', padding: 12, borderRadius: 6 }}>
                  {PRESET_ICONS.map(i => {
                    const active = draft.icon === i.name;
                    return (
                      <button
                        key={i.name}
                        onClick={() => setDraft({ ...draft, icon: i.name })}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          padding: '10px 8px',
                          background: active ? `${draft.color}18` : 'rgba(255,255,255,0.02)',
                          border: active ? `1px solid ${draft.color}` : '1px solid rgba(255,255,255,0.06)',
                          borderRadius: 6,
                          color: active ? draft.color : 'var(--text-muted)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: '0.75rem',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {renderDomainIcon(i.name, 16, active ? draft.color : 'var(--text-dim)')}
                        <span style={{ fontSize: '0.7rem' }}>{i.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: AI MODEL ASSISTANT RESEARCH & SELECTION */}
          {currentStep === 2 && (
            <div>
              {isResearching ? (
                /* Research Simulation Mode */
                <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 24, textAlign: 'center', minHeight: 280, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <Brain size={42} style={{ margin: '0 auto 16px', color: draft.color, animation: 'pulse 1.5s infinite' }} />
                  <h4 style={{ margin: '0 0 8px', color: 'var(--text-main)' }}>Perry AI Model Assistant</h4>
                  <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Researching hardware endpoints and matching best model configurations...</p>
                  
                  {/* Progress Bar */}
                  <div style={{ width: '80%', maxWidth: 400, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, margin: '0 auto 20px', overflow: 'hidden' }}>
                    <div style={{ width: `${researchProgress}%`, height: '100%', background: draft.color, transition: 'width 0.15s ease-out' }} />
                  </div>

                  {/* Log Console Terminal */}
                  <div style={{ width: '85%', maxWidth: 500, margin: '0 auto', background: '#030712', borderRadius: 4, padding: 12, border: '1px solid rgba(255,255,255,0.06)', textAlign: 'left', minHeight: 90 }}>
                    {researchLogs.map((log, idx) => (
                      <div key={idx} style={{ fontSize: '0.72rem', color: idx === researchLogs.length - 1 ? draft.color : '#9ca3af', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ color: draft.color }}>❯</span> {log}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Recommendation and Cards Selector */
                <div>
                  <div style={{ background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.2)', borderRadius: 8, padding: 14, marginBottom: 20 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <Brain size={20} color="var(--secondary)" style={{ marginTop: 2, flexShrink: 0 }} />
                      <div>
                        <h4 style={{ margin: '0 0 4px', color: 'var(--text-main)', fontSize: '0.85rem' }}>
                          Perry AI recommendation for <span style={{ color: draft.color }}>{draft.label || 'this domain'}</span>:
                        </h4>
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.4 }}>
                          {modelRecommendation.reason}
                        </p>
                      </div>
                    </div>
                  </div>

                  <label style={labelStyle}>Select Domain Base Model (Choose 1)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, margin: '8px 0 16px' }}>
                    {modelRecommendation.options.map(opt => {
                      const isSelected = draft.baseModel === opt.name;
                      const isInstalled = opt.name === 'workers' || installedModels.has(opt.name);
                      const isPulling = pullingModel?.name === opt.name && pullingModel?.endpoint === opt.endpoint;
                      const isAnyPulling = !!pullingModel;
                      
                      return (
                        <div
                          key={opt.name}
                          onClick={() => {
                            if (isAnyPulling) return;
                            setDraft({ ...draft, baseModel: opt.name });
                          }}
                          style={{
                            background: isSelected ? 'rgba(7, 9, 15, 0.9)' : 'rgba(7, 9, 15, 0.4)',
                            border: isSelected ? `2px solid ${draft.color}` : '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 8,
                            padding: 16,
                            cursor: isAnyPulling ? 'not-allowed' : 'pointer',
                            transition: 'all 0.15s ease',
                            position: 'relative',
                            boxShadow: isSelected ? `0 0 12px ${draft.color}22` : 'none',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            minHeight: 180,
                            opacity: isAnyPulling && !isSelected && !isPulling ? 0.5 : 1
                          }}
                        >
                          <div>
                            {/* Card Header & Badges */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                              <span style={{
                                padding: '2px 6px',
                                fontSize: '0.62rem',
                                borderRadius: 3,
                                background: opt.hw === '5090' ? '#581c87' : opt.hw === '5070 Ti' ? '#1e3a8a' : '#065f46',
                                color: '#f3f4f6',
                                textTransform: 'uppercase',
                                fontWeight: 600
                              }}>
                                {opt.hw}
                              </span>
                              
                              {opt.recommended && (
                                <span style={{
                                  padding: '2px 6px',
                                  fontSize: '0.62rem',
                                  borderRadius: 3,
                                  background: 'rgba(34,211,238,0.15)',
                                  border: '1px solid rgba(34,211,238,0.4)',
                                  color: 'var(--secondary)',
                                  fontWeight: 600
                                }}>
                                  RECOMMENDED
                                </span>
                              )}
                            </div>

                            <h4 style={{ margin: '0 0 4px', color: 'var(--text-main)', fontSize: '0.85rem' }}>{opt.label}</h4>
                            <code style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>{opt.name}</code>
                            <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.72rem', lineHeight: 1.35 }}>{opt.desc}</p>
                          </div>

                          {/* Status Indicator */}
                          <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                            {isPulling ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem', color: 'var(--text-main)' }}>
                                  <div style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: '50%',
                                    border: '2px solid rgba(255, 255, 255, 0.2)',
                                    borderTopColor: draft.color || '#10b981',
                                    animation: 'spin 1s linear infinite',
                                    flexShrink: 0
                                  }} />
                                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: 'var(--text-main)', fontSize: '0.68rem' }}>
                                    {pullingModel.progress}
                                  </span>
                                </div>
                                <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                                  <div style={{ width: `${pullingModel.pct ?? 0}%`, height: '100%', background: draft.color || '#10b981', transition: 'width 0.1s ease-out' }} />
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{
                                  fontSize: '0.68rem',
                                  color: isInstalled ? '#a7f3d0' : '#fca5a5',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4
                                }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: isInstalled ? '#10b981' : '#ef4444' }} />
                                  {isInstalled ? 'Ready to use' : 'Not pulled'}
                                </span>
                                
                                {isSelected && (
                                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: draft.color, color: '#000' }}>
                                    <Check size={10} strokeWidth={3} />
                                  </span>
                                )}
                              </div>
                            )}

                            {!isInstalled && opt.name !== 'workers' && !isPulling && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isAnyPulling) return;
                                  setDraft({ ...draft, baseModel: opt.name });
                                  pullModel(opt.endpoint || 'librarian', opt.name);
                                }}
                                disabled={isAnyPulling}
                                style={{
                                  width: '100%',
                                  padding: '6px 12px',
                                  fontSize: '0.7rem',
                                  background: 'rgba(255,255,255,0.05)',
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  borderRadius: 4,
                                  color: 'var(--text-main)',
                                  cursor: isAnyPulling ? 'not-allowed' : 'pointer',
                                  marginTop: 8,
                                  transition: 'all 0.15s ease',
                                  textAlign: 'center',
                                }}
                                onMouseEnter={(e) => {
                                  if (!isAnyPulling) {
                                    e.currentTarget.style.background = `${draft.color}15`;
                                    e.currentTarget.style.borderColor = draft.color;
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!isAnyPulling) {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                                  }
                                }}
                              >
                                Pull Model
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Info size={12} color="var(--text-dim)" />
                    <span>Selected base model will direct all core text reasoning workflows for this vertical. If a model says "Not pulled", download it in the Models panel.</span>
                  </div>

                  {/* Custom Model Puller Section */}
                  <div style={{
                    marginTop: 24,
                    paddingTop: 20,
                    borderTop: '1px solid rgba(255,255,255,0.06)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <DownloadCloud size={16} color={draft.color || 'var(--secondary)'} />
                      <h4 style={{ margin: 0, color: 'var(--text-main)', fontSize: '0.85rem', fontWeight: 600 }}>Pull Custom Ollama Model</h4>
                    </div>

                    <div style={{
                      background: 'rgba(7, 9, 15, 0.4)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 8,
                      padding: 16
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        {/* Select Preset */}
                        <div>
                          <label style={labelStyle}>Ollama Model Preset</label>
                          <select
                            value={presetModel}
                            onChange={(e) => handlePresetChange(e.target.value)}
                            disabled={pullingModel !== null}
                            style={{
                              ...inputStyle,
                              cursor: pullingModel !== null ? 'not-allowed' : 'pointer',
                              background: '#0a0e17'
                            }}
                          >
                            {OLLAMA_PRESETS.map(preset => (
                              <option key={preset.value} value={preset.value} style={{ background: '#0a0e17', color: 'var(--text-main)' }}>
                                {preset.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Target Endpoint */}
                        <div>
                          <label style={labelStyle}>Target Endpoint Instance</label>
                          <select
                            value={customModelEndpoint}
                            onChange={(e) => setCustomModelEndpoint(e.target.value as any)}
                            disabled={pullingModel !== null}
                            style={{
                              ...inputStyle,
                              cursor: pullingModel !== null ? 'not-allowed' : 'pointer',
                              background: '#0a0e17'
                            }}
                          >
                            <option value="librarian" style={{ background: '#0a0e17', color: 'var(--text-main)' }}>Librarian (RTX 5070 Ti)</option>
                            <option value="writer" style={{ background: '#0a0e17', color: 'var(--text-main)' }}>Writer (RTX 5090)</option>
                          </select>
                        </div>
                      </div>

                      {/* Custom Model Name Field */}
                      <div style={{ marginBottom: 16 }}>
                        <label style={labelStyle}>Model Identifier Name</label>
                        <input
                          type="text"
                          value={customModelName}
                          onChange={(e) => setCustomModelName(e.target.value)}
                          placeholder="e.g. llama3.3:70b"
                          disabled={presetModel !== 'custom' || pullingModel !== null}
                          style={{
                            ...inputStyle,
                            opacity: presetModel !== 'custom' ? 0.6 : 1,
                            cursor: (presetModel !== 'custom' || pullingModel !== null) ? 'not-allowed' : 'text'
                          }}
                        />
                        {presetModel !== 'custom' && (
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: 4 }}>
                            Preset mode: Input field is pre-populated and locked. Switch to "Custom" to type a specific tag.
                          </div>
                        )}
                      </div>

                      {/* Action Button / Progress */}
                      {pullingModel && pullingModel.name === customModelName && pullingModel.endpoint === customModelEndpoint ? (
                        <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--text-main)', marginBottom: 6 }}>
                            <div style={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              border: '2px solid rgba(255, 255, 255, 0.2)',
                              borderTopColor: draft.color || 'var(--secondary)',
                              animation: 'spin 1s linear infinite',
                              flexShrink: 0
                            }} />
                            <span>{pullingModel.progress}</span>
                          </div>
                          <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${pullingModel.pct ?? 0}%`, height: '100%', background: draft.color || 'var(--secondary)', transition: 'width 0.1s ease-out' }} />
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => pullModel(customModelEndpoint, customModelName)}
                          disabled={pullingModel !== null || !customModelName.trim()}
                          style={{
                            ...btnPrimary,
                            width: '100%',
                            background: (pullingModel !== null || !customModelName.trim()) ? 'rgba(255,255,255,0.02)' : `${draft.color}22`,
                            borderColor: (pullingModel !== null || !customModelName.trim()) ? 'rgba(255,255,255,0.05)' : draft.color,
                            color: (pullingModel !== null || !customModelName.trim()) ? 'var(--text-dim)' : 'var(--text-main)',
                            cursor: (pullingModel !== null || !customModelName.trim()) ? 'not-allowed' : 'pointer',
                            fontWeight: 600
                          }}
                        >
                          Pull & Select Model
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Model Parameters Override Section */}
                  <div style={{
                    marginTop: 24,
                    paddingTop: 20,
                    borderTop: '1px solid rgba(255,255,255,0.06)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Activity size={16} color={draft.color || 'var(--secondary)'} />
                      <h4 style={{ margin: 0, color: 'var(--text-main)', fontSize: '0.85rem', fontWeight: 600 }}>Model Parameters Override (Optional)</h4>
                    </div>

                    <div style={{
                      background: 'rgba(7, 9, 15, 0.4)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 8,
                      padding: 16,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 16
                    }}>
                      {/* Temperature */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <label style={{ ...labelStyle, marginBottom: 0 }}>Temperature</label>
                          <span style={{ fontSize: '0.75rem', color: draft.color, fontWeight: 600 }}>
                            {draft.modelParameters?.temperature !== undefined ? draft.modelParameters.temperature : 'Default'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <input
                            type="range"
                            min="0.0"
                            max="1.5"
                            step="0.05"
                            value={draft.modelParameters?.temperature ?? 0.7}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setDraft(d => ({
                                ...d,
                                modelParameters: {
                                  ...d.modelParameters,
                                  temperature: val
                                }
                              }));
                            }}
                            style={{ flex: 1, accentColor: draft.color }}
                          />
                          <input
                            type="number"
                            min="0.0"
                            max="1.5"
                            step="0.05"
                            value={draft.modelParameters?.temperature ?? 0.7}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (isNaN(val)) return;
                              setDraft(d => ({
                                ...d,
                                modelParameters: {
                                  ...d.modelParameters,
                                  temperature: Math.min(1.5, Math.max(0, val))
                                }
                              }));
                            }}
                            style={{
                              width: 60,
                              background: '#0a0e17',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: 4,
                              color: 'var(--text-main)',
                              fontSize: '0.75rem',
                              padding: '2px 6px',
                              textAlign: 'right'
                            }}
                          />
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: '0.62rem', color: 'var(--text-dim)' }}>
                          Higher values increase creativity/variety; lower values are more deterministic.
                        </p>
                      </div>

                      {/* Max Tokens */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <label style={{ ...labelStyle, marginBottom: 0 }}>Max Output Tokens</label>
                          <span style={{ fontSize: '0.75rem', color: draft.color, fontWeight: 600 }}>
                            {draft.modelParameters?.maxTokens !== undefined ? draft.modelParameters.maxTokens : 'Default'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <input
                            type="range"
                            min="128"
                            max="8192"
                            step="128"
                            value={draft.modelParameters?.maxTokens ?? 4096}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              setDraft(d => ({
                                ...d,
                                modelParameters: {
                                  ...d.modelParameters,
                                  maxTokens: val
                                }
                              }));
                            }}
                            style={{ flex: 1, accentColor: draft.color }}
                          />
                          <input
                            type="number"
                            min="128"
                            max="8192"
                            step="128"
                            value={draft.modelParameters?.maxTokens ?? 4096}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              if (isNaN(val)) return;
                              setDraft(d => ({
                                ...d,
                                modelParameters: {
                                  ...d.modelParameters,
                                  maxTokens: Math.min(8192, Math.max(128, val))
                                }
                              }));
                            }}
                            style={{
                              width: 60,
                              background: '#0a0e17',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: 4,
                              color: 'var(--text-main)',
                              fontSize: '0.75rem',
                              padding: '2px 6px',
                              textAlign: 'right'
                            }}
                          />
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: '0.62rem', color: 'var(--text-dim)' }}>
                          Maximum size of generated responses. Lower limits protect generation budget.
                        </p>
                      </div>

                      {/* Repeat Penalty */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <label style={{ ...labelStyle, marginBottom: 0 }}>Repeat Penalty</label>
                          <span style={{ fontSize: '0.75rem', color: draft.color, fontWeight: 600 }}>
                            {draft.modelParameters?.repeatPenalty !== undefined ? draft.modelParameters.repeatPenalty : 'Default'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <input
                            type="range"
                            min="0.5"
                            max="2.0"
                            step="0.05"
                            value={draft.modelParameters?.repeatPenalty ?? 1.15}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setDraft(d => ({
                                ...d,
                                modelParameters: {
                                  ...d.modelParameters,
                                  repeatPenalty: val
                                }
                              }));
                            }}
                            style={{ flex: 1, accentColor: draft.color }}
                          />
                          <input
                            type="number"
                            min="0.5"
                            max="2.0"
                            step="0.05"
                            value={draft.modelParameters?.repeatPenalty ?? 1.15}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (isNaN(val)) return;
                              setDraft(d => ({
                                ...d,
                                modelParameters: {
                                  ...d.modelParameters,
                                  repeatPenalty: Math.min(2.0, Math.max(0.5, val))
                                }
                              }));
                            }}
                            style={{
                              width: 60,
                              background: '#0a0e17',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: 4,
                              color: 'var(--text-main)',
                              fontSize: '0.75rem',
                              padding: '2px 6px',
                              textAlign: 'right'
                            }}
                          />
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: '0.62rem', color: 'var(--text-dim)' }}>
                          Higher values penalize repetition of identical tokens (1.0 = disabled).
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: PLAYBOOK & CAPABILITIES */}
          {currentStep === 3 && (
            <div>
              {/* Dashboard Panels Plugin Configuration */}
              <div style={fieldRow}>
                <label style={labelStyle}>Dashboard Interface Panels</label>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '2px 0 8px' }}>
                  Enable the plugin panels to expose on the main workspace navigation drawer for this domain.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, background: 'rgba(0,0,0,0.15)', padding: 12, borderRadius: 6 }}>
                  {AVAILABLE_PANELS.map(p => {
                    const on = draft.dashboardPanels.includes(p);
                    return (
                      <button
                        key={p}
                        onClick={() => togglePanel(p)}
                        style={{
                          ...chipStyle,
                          background: on ? `${draft.color}20` : 'transparent',
                          borderColor: on ? draft.color : 'rgba(255,255,255,0.1)',
                          color: on ? 'var(--text-main)' : 'var(--text-muted)',
                          padding: '6px 12px',
                          borderRadius: 4,
                          fontSize: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}
                      >
                        {on ? <Check size={12} color={draft.color} /> : <span style={{ width: 12 }} />}
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* MCP Capabilities & Integrations */}
              <div style={fieldRow}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div>
                    <label style={{ ...labelStyle, margin: 0 }}>MCP Server Integrations</label>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
                      Configure which Model Context Protocol (MCP) servers are allowed for agents executing in this domain.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleMcpRestriction}
                    style={{
                      ...btnSmall,
                      borderColor: restrictMcp ? 'rgba(239,68,68,0.3)' : draft.color,
                      color: restrictMcp ? '#fca5a5' : 'var(--text-main)',
                      cursor: 'pointer'
                    }}
                  >
                    {restrictMcp ? 'Disable Restriction (Allow All)' : 'Enable Security Restriction'}
                  </button>
                </div>

                {!restrictMcp ? (
                  <div style={{ fontSize: '0.78rem', color: '#10b981', background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', padding: '12px 16px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Activity size={14} color="#10b981" />
                    <span><strong>Unrestricted Access:</strong> All configured MCP servers ({mcpServers.length} active) and their tools are fully accessible in this domain.</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(0,0,0,0.15)', padding: 12, borderRadius: 6 }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                      Select which of the {mcpServers.length} configured MCP servers are allowed. Undeselected servers will be completely hidden from agents.
                    </div>
                    {mcpServers.length === 0 ? (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '8px 0', textAlign: 'center' }}>
                        No connected MCP servers detected. Check your system config.
                      </div>
                    ) : (
                      mcpServers.map(server => {
                        const isAllowed = draft.allowedMcpServers?.includes(server.id) ?? false;
                        return (
                          <div
                            key={server.id}
                            style={{
                              background: isAllowed ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.2)',
                              border: isAllowed ? `1px solid ${draft.color}40` : '1px solid rgba(255,255,255,0.05)',
                              borderRadius: 6,
                              padding: 10,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: isAllowed ? 'var(--text-main)' : 'var(--text-muted)' }}>
                                <input
                                  type="checkbox"
                                  checked={isAllowed}
                                  onChange={() => toggleMcpServer(server.id)}
                                  style={{ accentColor: draft.color, cursor: 'pointer' }}
                                />
                                {server.id}
                              </label>
                              <span
                                style={{
                                  fontSize: '0.62rem',
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  background: server.status === 'connected' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                  color: server.status === 'connected' ? '#10b981' : '#ef4444',
                                  border: server.status === 'connected' ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(239,68,68,0.2)'
                                }}
                              >
                                {server.status}
                              </span>
                            </div>

                            <details style={{ marginTop: 2 }}>
                              <summary style={{ fontSize: '0.65rem', color: 'var(--text-dim)', cursor: 'pointer', userSelect: 'none' }}>
                                View tools ({server.tools.length})
                              </summary>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, paddingLeft: 8, borderLeft: `1px dashed rgba(255,255,255,0.1)` }}>
                                {server.tools.length === 0 ? (
                                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No registered tools</div>
                                ) : (
                                  server.tools.map(tool => (
                                    <div key={tool.name} style={{ fontSize: '0.68rem', background: 'rgba(0,0,0,0.15)', padding: '6px 8px', borderRadius: 4 }}>
                                      <code style={{ color: draft.color, fontWeight: 600 }}>{tool.name}</code>
                                      {tool.description && <div style={{ color: 'var(--text-muted)', marginTop: 2, fontSize: '0.65rem', lineHeight: 1.3 }}>{tool.description}</div>}
                                    </div>
                                  ))
                                )}
                              </div>
                            </details>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {/* AI PLAYBOOK ASSISTANT */}
              <div style={{
                background: 'rgba(124, 58, 237, 0.03)',
                border: '1px solid rgba(124, 58, 237, 0.15)',
                borderRadius: 8,
                padding: 16,
                marginBottom: 20,
                position: 'relative'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Brain size={18} color="#a78bfa" />
                    <div>
                      <h4 style={{ margin: 0, color: '#f3f4f6', fontSize: '0.85rem', fontWeight: 600 }}>AI Playbook Assistant</h4>
                      <p style={{ margin: '2px 0 0', color: '#9ca3af', fontSize: '0.7rem' }}>
                        Scan your domain description to recommend existing skills and generate custom new skills.
                      </p>
                    </div>
                  </div>
                  {!isAssessing && !assessmentResults && (
                    <button
                      onClick={runPlaybookAssessment}
                      style={{
                        ...btnSmall,
                        background: 'rgba(124, 58, 237, 0.15)',
                        borderColor: '#a78bfa',
                        color: '#f3f4f6',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer'
                      }}
                    >
                      <Sparkles size={12} color="#a78bfa" />
                      Analyze & Suggest Skills
                    </button>
                  )}
                  {assessmentResults && (
                    <button
                      onClick={runPlaybookAssessment}
                      style={{
                        ...btnSmall,
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        color: 'var(--text-muted)',
                        fontSize: '0.68rem',
                        cursor: 'pointer'
                      }}
                    >
                      Re-Analyze Playbook
                    </button>
                  )}
                </div>

                {assessmentError && (
                  <div style={{ ...errorBox, margin: '8px 0' }}>{assessmentError}</div>
                )}

                {isAssessing && (
                  <div style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    borderRadius: 6,
                    padding: 16,
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        border: '2px solid rgba(167, 139, 250, 0.3)',
                        borderTopColor: '#a78bfa',
                        animation: 'spin 1s linear infinite'
                      }} />
                      <span style={{ fontSize: '0.75rem', color: '#f3f4f6', fontWeight: 600 }}>Analyzing Playbook requirements...</span>
                    </div>
                    <div style={{
                      background: '#030712',
                      borderRadius: 4,
                      padding: '8px 12px',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.68rem',
                      color: '#a78bfa'
                    }}>
                      <span style={{ marginRight: 6 }}>❯</span>
                      {assessmentStatus}
                    </div>
                  </div>
                )}

                {assessmentResults && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
                    {/* Domain Analysis Summary */}
                    {assessmentResults.domainAnalysis && (
                      <div style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: 8,
                        padding: 18,
                        marginBottom: 4,
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                          <Brain size={18} color="#a78bfa" />
                          <h4 style={{ margin: 0, color: '#f3f4f6', fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Domain Analysis & Strategy
                          </h4>
                        </div>

                        {/* Overview / Summary */}
                        {assessmentResults.domainAnalysis.summary && (
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4, letterSpacing: '0.03em' }}>Overview</div>
                            <p style={{ margin: 0, fontSize: '0.78rem', color: '#e5e7eb', lineHeight: 1.45 }}>
                              {assessmentResults.domainAnalysis.summary}
                            </p>
                          </div>
                        )}

                        {/* Required MCP Servers & Tools */}
                        {((assessmentResults.domainAnalysis.requiredMcpServers && assessmentResults.domainAnalysis.requiredMcpServers.length > 0) || 
                          (assessmentResults.domainAnalysis.requiredTools && assessmentResults.domainAnalysis.requiredTools.length > 0)) && (
                          <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {assessmentResults.domainAnalysis.requiredMcpServers && assessmentResults.domainAnalysis.requiredMcpServers.length > 0 && (
                              <div>
                                <div style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.03em' }}>Recommended MCP Servers</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {assessmentResults.domainAnalysis.requiredMcpServers.map(server => (
                                    <span key={server} style={{
                                      padding: '3px 8px',
                                      fontSize: '0.65rem',
                                      borderRadius: 4,
                                      background: 'rgba(56, 189, 248, 0.08)',
                                      border: '1px solid rgba(56, 189, 248, 0.25)',
                                      color: '#38bdf8',
                                      fontWeight: 500
                                    }}>
                                      {server}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {assessmentResults.domainAnalysis.requiredTools && assessmentResults.domainAnalysis.requiredTools.length > 0 && (
                              <div>
                                <div style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.03em' }}>Required Capabilities / Tools</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {assessmentResults.domainAnalysis.requiredTools.map(tool => (
                                    <span key={tool} style={{
                                      padding: '3px 8px',
                                      fontSize: '0.65rem',
                                      borderRadius: 4,
                                      background: 'rgba(244, 63, 94, 0.08)',
                                      border: '1px solid rgba(244, 63, 94, 0.25)',
                                      color: '#f43f5e',
                                      fontWeight: 500
                                    }}>
                                      {tool}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Suggested Team Fleet */}
                        {assessmentResults.domainAnalysis.suggestedTeamRoles && assessmentResults.domainAnalysis.suggestedTeamRoles.length > 0 && (
                          <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                Suggested Team Fleet
                              </div>
                              {assessmentResults.domainAnalysis.suggestedTeamSize && (
                                <span style={{
                                  padding: '2px 6px',
                                  fontSize: '0.65rem',
                                  borderRadius: 4,
                                  background: 'rgba(168, 85, 247, 0.12)',
                                  border: '1px solid rgba(168, 85, 247, 0.3)',
                                  color: '#c084fc',
                                  fontWeight: 600
                                }}>
                                  Fleet Size: {assessmentResults.domainAnalysis.suggestedTeamSize} Agents
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {assessmentResults.domainAnalysis.suggestedTeamRoles.map((roleInfo, rIdx) => (
                                <div key={rIdx} style={{
                                  background: 'rgba(0,0,0,0.15)',
                                  border: '1px solid rgba(255,255,255,0.03)',
                                  borderRadius: 6,
                                  padding: 10,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 4
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{
                                      fontSize: '0.68rem',
                                      padding: '2px 6px',
                                      borderRadius: 3,
                                      background: `${draft.color}15`,
                                      border: `1px solid ${draft.color}40`,
                                      color: draft.color || 'var(--secondary)',
                                      fontWeight: 600
                                    }}>
                                      {roleInfo.role}
                                    </span>
                                  </div>
                                  <p style={{ margin: 0, fontSize: '0.72rem', color: '#9ca3af', lineHeight: 1.35 }}>
                                    {roleInfo.description}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Recommended Skills */}
                    {assessmentResults.recommendedSkills && assessmentResults.recommendedSkills.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.72rem', color: '#a78bfa', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 8 }}>
                          Recommended Existing Skills
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                          {assessmentResults.recommendedSkills.map(rec => {
                            const matchingSkill = skills.find(s => s.name === rec.name);
                            const isChecked = draft.defaultSkills.some(x => x.name === rec.name);
                            
                            return (
                              <div
                                key={rec.name}
                                style={{
                                  background: 'rgba(255,255,255,0.02)',
                                  border: '1px solid rgba(255,255,255,0.05)',
                                  borderRadius: 6,
                                  padding: 12,
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 12
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleRecommendedSkill(rec.name)}
                                  disabled={!matchingSkill}
                                  style={{
                                    marginTop: 3,
                                    cursor: matchingSkill ? 'pointer' : 'not-allowed',
                                    accentColor: draft.color
                                  }}
                                />
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#f3f4f6' }}>{rec.name}</span>
                                    {matchingSkill ? (
                                      <span style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: 3, background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                                        Installed ({matchingSkill.service})
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                                        Not Installed
                                      </span>
                                    )}
                                  </div>
                                  <p style={{ margin: '4px 0 6px', fontSize: '0.75rem', color: '#9ca3af', lineHeight: 1.4 }}>
                                    {rec.reason}
                                  </p>
                                  {matchingSkill && (
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.15)', padding: '6px 8px', borderRadius: 4 }}>
                                      <span style={{ fontWeight: 600, color: 'var(--text-dim)' }}>Base Skill Description:</span> {matchingSkill.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Suggested New Skills */}
                    {assessmentResults.suggestedNewSkills && assessmentResults.suggestedNewSkills.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: '0.72rem', color: '#f59e0b', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 8 }}>
                          AI Generated Bespoke Skills
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                          {assessmentResults.suggestedNewSkills.map(s => {
                            const isExpanded = !!expandedSuggestedSkills[s.name];
                            const isInstalled = !!installedSuggestedSkills[s.name] || skills.some(x => x.name === s.name);
                            
                            return (
                              <div
                                key={s.name}
                                style={{
                                  background: 'rgba(245,158,11,0.02)',
                                  border: '1px solid rgba(245,158,11,0.1)',
                                  borderRadius: 6,
                                  padding: 12,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 8
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <Sparkles size={12} color="#f59e0b" />
                                      <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#f3f4f6' }}>{s.name}</span>
                                    </div>
                                    <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: '#9ca3af', lineHeight: 1.35 }}>
                                      {s.description}
                                    </p>
                                  </div>
                                  
                                  <button
                                    onClick={() => installSuggestedSkill(s)}
                                    disabled={isInstalled}
                                    style={{
                                      ...btnSmall,
                                      padding: '3px 8px',
                                      fontSize: '0.68rem',
                                      background: isInstalled ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.15)',
                                      borderColor: isInstalled ? '#10b981' : '#f59e0b',
                                      color: isInstalled ? '#10b981' : '#f3f4f6',
                                      cursor: isInstalled ? 'default' : 'pointer'
                                    }}
                                  >
                                    {isInstalled ? (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        <Check size={10} /> Installed
                                      </span>
                                    ) : 'Create & Install'}
                                  </button>
                                </div>

                                <div style={{ borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 6 }}>
                                  <button
                                    onClick={() => setExpandedSuggestedSkills(prev => ({ ...prev, [s.name]: !isExpanded }))}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: draft.color,
                                      fontSize: '0.65rem',
                                      cursor: 'pointer',
                                      padding: 0,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 4
                                    }}
                                  >
                                    {isExpanded ? 'Hide Code' : 'View Proposed Procedure Markdown'}
                                  </button>
                                  
                                  {isExpanded && (
                                    <pre style={{
                                      margin: '6px 0 0',
                                      padding: 8,
                                      background: '#030712',
                                      border: '1px solid rgba(255,255,255,0.05)',
                                      borderRadius: 4,
                                      fontSize: '0.65rem',
                                      color: '#9ca3af',
                                      overflowX: 'auto',
                                      whiteSpace: 'pre-wrap',
                                      fontFamily: 'var(--font-mono)'
                                    }}>
                                      {s.body}
                                    </pre>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Default Playbook Skills Selector */}
              <div style={fieldRow}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div>
                    <label style={{ ...labelStyle, margin: 0 }}>Playbook Default Skills ({draft.defaultSkills.length} selected)</label>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
                      Select which custom behavior playbook scripts should be enabled by default.
                    </p>
                  </div>
                  <button onClick={() => setShowSkillCreator(true)} style={{ ...btnSmall, borderColor: draft.color, color: 'var(--text-main)' }}>+ Create custom skill</button>
                </div>

                {skills.length === 0 ? (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: 16, textAlign: 'center', background: 'rgba(0,0,0,0.15)', borderRadius: 6 }}>
                    No installed skills yet — click "+ Create custom skill" above to add one directly.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 300, overflowY: 'auto', background: 'rgba(0,0,0,0.15)', padding: 12, borderRadius: 6 }}>
                    {Object.keys(skillsByService).map(service => (
                      <div key={service} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 8 }}>
                        <div style={{ fontSize: '0.68rem', color: draft.color, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 6 }}>
                          {service} service
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                          {skillsByService[service].map(s => {
                            const on = draft.defaultSkills.some(x => x.service === s.service && x.name === s.name);
                            return (
                              <button
                                key={`${s.service}::${s.name}`}
                                onClick={() => toggleDefaultSkill(s)}
                                title={s.description}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 8,
                                  padding: '8px 10px',
                                  background: on ? `${draft.color}08` : 'rgba(0,0,0,0.2)',
                                  border: on ? `1px solid ${draft.color}66` : '1px solid rgba(255,255,255,0.06)',
                                  borderRadius: 4,
                                  color: on ? 'var(--text-main)' : 'var(--text-muted)',
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  textAlign: 'left',
                                  fontSize: '0.72rem',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                <span style={{
                                  marginTop: 2,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: 12,
                                  height: 12,
                                  borderRadius: 2,
                                  border: `1px solid ${on ? draft.color : 'rgba(255,255,255,0.2)'}`,
                                  background: on ? draft.color : 'transparent',
                                  color: '#000',
                                  flexShrink: 0
                                }}>
                                  {on && <Check size={8} strokeWidth={4} />}
                                </span>
                                <div>
                                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                                  <div style={{ fontSize: '0.62rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                    {s.description || 'No description provided.'}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stepper Navigation Buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
            {currentStep > 1 ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={prevStep} style={btnStyle} disabled={isResearching}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={14} /> Back
                  </span>
                </button>
                <button onClick={cancelForm} style={btnStyle}>Cancel</button>
              </div>
            ) : (
              <button onClick={cancelForm} style={btnStyle}>Cancel</button>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {currentStep < 3 ? (
                <button onClick={nextStep} style={{ ...btnPrimary, background: `${draft.color}22`, borderColor: draft.color }} disabled={isResearching}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    Next <ArrowRight size={14} />
                  </span>
                </button>
              ) : (
                <button onClick={saveDomain} style={{ ...btnPrimary, background: draft.color, color: '#000', fontWeight: 600 }}>
                  {mode === 'edit' ? 'Save Changes' : 'Launch Domain'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showSkillCreator && (
        <div style={modalBackdrop}>
          <div style={{ ...cardStyle, maxWidth: 700, width: '90%', maxHeight: '90vh', overflowY: 'auto', background: 'rgba(10, 14, 23, 0.95)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <h3 style={{ margin: '0 0 12px', color: draft.color }}>Create Custom Skill</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 0 }}>Hand-authored skill — lands straight in skills-installed/, skipping the propose flow.</p>
            <div style={fieldRow}><label style={labelStyle}>Service</label>
              <select value={skillDraft.service} onChange={e => setSkillDraft({ ...skillDraft, service: e.target.value })} style={inputStyle}>
                {KNOWN_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={fieldRow}><label style={labelStyle}>Name (kebab-case)</label>
              <input value={skillDraft.name} onChange={e => setSkillDraft({ ...skillDraft, name: e.target.value })} placeholder="custom-skill-name" style={inputStyle} /></div>
            <div style={fieldRow}><label style={labelStyle}>Description (10-200 chars)</label>
              <input value={skillDraft.description} onChange={e => setSkillDraft({ ...skillDraft, description: e.target.value })} placeholder="What this skill does" style={inputStyle} /></div>
            <div style={fieldRow}><label style={labelStyle}>Body (markdown, ≥50 chars)</label>
              <textarea value={skillDraft.body} onChange={e => setSkillDraft({ ...skillDraft, body: e.target.value })} placeholder="## Procedure&#10;&#10;1. ...&#10;2. ..." style={{ ...inputStyle, minHeight: 180, fontFamily: 'var(--font-mono)' }} /></div>
            <div style={fieldRow}><label style={labelStyle}>appliesWhen (JSON, optional)</label>
              <input value={skillDraft.appliesWhen} onChange={e => setSkillDraft({ ...skillDraft, appliesWhen: e.target.value })} placeholder='{"pen_slug": "*", "leak_tag": "filter-words"}' style={inputStyle} /></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={createSkill} style={{ ...btnPrimary, background: draft.color, color: '#000', fontWeight: 600 }}>Create Skill</button>
              <button onClick={() => { setShowSkillCreator(false); setError(null); }} style={btnStyle}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {loading && !isFormMode && <div style={{ color: 'var(--text-muted)', padding: 12 }}>Loading domains...</div>}

      {!isFormMode && (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
          {sortedDomains.map(d => (
            <div key={d.id} style={{ ...cardStyle, borderLeftColor: d.color, borderLeftWidth: 4, background: 'rgba(7, 9, 15, 0.45)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 240 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {renderDomainIcon(d.icon, 20, d.color)}
                    <div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main)' }}>{d.label}</div>
                      <code style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{d.id}</code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => startEdit(d)} style={btnSmall}>Edit</button>
                    {!d.builtin && (
                      <button onClick={() => deleteDomain(d.id)} style={{ ...btnSmall, borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>Delete</button>
                    )}
                  </div>
                </div>
                
                {d.description && <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 12, lineHeight: 1.4 }}>{d.description}</div>}

                {/* Base Model Info */}
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 6, padding: '8px 10px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Brain size={14} color={d.color} />
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Base Model: <code style={{ color: 'var(--text-main)', fontSize: '0.75rem' }}>{d.baseModel || 'workers'}</code>
                  </div>
                </div>
              </div>

              <div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Panels</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {d.dashboardPanels.map(p => (<span key={p} style={{ ...chipStyle, fontSize: '0.65rem', padding: '1px 6px' }}>{p}</span>))}
                  </div>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Allowed MCP Servers</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {!d.allowedMcpServers ? (
                      <span style={{ fontSize: '0.65rem', color: '#10b981', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', padding: '1px 6px', borderRadius: 4 }}>All Servers Allowed</span>
                    ) : d.allowedMcpServers.length === 0 ? (
                      <span style={{ fontSize: '0.65rem', color: '#ef4444', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', padding: '1px 6px', borderRadius: 4 }}>No Servers Allowed</span>
                    ) : (
                      d.allowedMcpServers.map(srv => (
                        <span key={srv} style={{ ...chipStyle, fontSize: '0.65rem', padding: '1px 6px', background: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.25)', color: '#60a5fa' }}>{srv}</span>
                      ))
                    )}
                  </div>
                </div>
                
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Default Playbook Skills ({(d.defaultSkills || []).length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {(d.defaultSkills || []).length === 0 ? (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>(none)</span>
                    ) : (
                      (d.defaultSkills || []).slice(0, 5).map(s => (
                        <span key={`${s.service}::${s.name}`} style={{ ...chipStyle, fontSize: '0.65rem', padding: '1px 6px', background: 'rgba(168,85,247,0.08)', borderColor: 'rgba(168,85,247,0.25)' }}>
                          <span style={{ opacity: 0.7, fontSize: '0.6rem' }}>{s.service}/</span>{s.name}
                        </span>
                      ))
                    )}
                    {(d.defaultSkills || []).length > 5 && (
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 2 }}>
                        +{(d.defaultSkills || []).length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              {d.builtin && (
                <div style={{ ...builtinBadge, alignSelf: 'flex-start', margin: '10px 0 0', position: 'absolute', top: -8, right: 60, transform: 'translateY(-50%)' }}>
                  BUILT-IN
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const btnStyle: any = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-main)', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', outline: 'none', transition: 'all 0.15s ease' };
const btnPrimary: any = { ...btnStyle, background: 'rgba(34,211,238,0.12)', borderColor: 'rgba(34,211,238,0.4)', color: 'var(--secondary)' };
const btnSmall: any = { ...btnStyle, padding: '4px 10px', fontSize: '0.75rem' };
const cardStyle: any = { background: 'rgba(7, 9, 15, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 14, marginBottom: 12, position: 'relative' };
const fieldRow: any = { marginBottom: 16 };
const gridRow: any = { marginBottom: 4 };
const labelStyle: any = { display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 };
const inputStyle: any = { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'var(--text-main)', padding: '8px 10px', fontFamily: 'inherit', fontSize: '0.85rem', outline: 'none' };
const chipStyle: any = { padding: '2px 8px', fontSize: '0.7rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' };
const builtinBadge: any = { padding: '2px 6px', fontSize: '0.65rem', background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 3, color: 'var(--secondary)' };
const errorBox: any = { padding: '12px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#fca5a5', marginBottom: 16, fontSize: '0.85rem' };
const modalBackdrop: any = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const stepNumStyle: any = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', fontSize: '0.75rem', fontWeight: 700 };
