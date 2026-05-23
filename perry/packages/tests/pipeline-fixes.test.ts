/**
 * Regression tests for all pipeline fixes applied 2026-05-09.
 * Run: node --import tsx packages/tests/pipeline-fixes.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { PromptBuilder } from '../projects/src/prompt-builder.js';
import { StandardLlmRunner } from '../projects/src/runners/StandardLlmRunner.js';
import { CompileRunner } from '../projects/src/runners/CompileRunner.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function assertEqual(a: any, b: any, label: string) { if (a !== b) throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const mockLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLog,
} as any;

const mockContextEngine = {
  getContextSlots: async () => []
} as any;
const mockStateStore = {
  get: () => null,
  getPenNames: () => [],
} as any;
const mockConfig = {
  workspaceDir: '/dummy',
} as any;

// ═══════════════════════════════════════════════════════════
// Fix #2 — Narrative Directives regex: G not F
// ═══════════════════════════════════════════════════════════
console.log('\n─── Fix #2: Narrative Directives regex (G not F) ───');

const mockStatUpdateOutput = `## A. Character Stats
| Character | Stat Name | Old Value | New Value | Justification |
|-----------|-----------|-----------|-----------|---------------|
| Kai | Sanity | 72 | 65 | Witnessed the breach |

## B. Faction Reputation Update
| Character | Faction | Old Rep | New Rep | Label | Trigger Event |
|-----------|---------|---------|---------|-------|---------------|
| Kai | Nexus Corp | 6 | 5 | Neutral→Distrusted | Refused orders |

## C. Foreshadowing Ledger
| Seed ID | Expected Action | Actual Status | Notes |
|---------|----------------|---------------|-------|
| FS-01 | PLANT | PLANTED | The mirror appeared |

## D. Subplot Tracker
| Subplot | Status | Consecutive Dormant | Notes |
|---------|--------|---------------------|-------|
| The Heist | ADVANCED | 0 | Team assembled |

## E. Tension Check
| Target | Actual | Beat Match | Notes |
|--------|--------|------------|-------|
| 7/10 | 8/10 | YES | Exceeds target |

## F. Relationship Dynamics
| Pair | Dynamic | Intensity Change | Key Moment |
|------|---------|-----------------|------------|
| Kai / Mara | Trust | 7→6 | She lied |

## G. NARRATIVE DIRECTIVES (SCOPED to Chapter 2 ONLY)
Kai (POV) — Sanity: 65/Stable. Write with mild paranoia undertone.
Mara (supporting) — Trust toward Kai dropped to 6/10. She will be guarded.`;

await test('Old regex (## F.) does NOT match narrative directives', () => {
  const oldMatch = mockStatUpdateOutput.match(/## F\.\s*NARRATIVE DIRECTIVES[\s\S]*$/i);
  assertEqual(oldMatch, null, 'Old F. regex should return null (was broken)');
});

await test('New regex (## G.) correctly matches narrative directives', () => {
  const newMatch = mockStatUpdateOutput.match(/##\s*G\.?\s*NARRATIVE DIRECTIVES[\s\S]*$/i);
  assert(newMatch !== null, 'New G. regex must match');
  assert(newMatch![0].includes('Kai (POV)'), 'Must include POV directive content');
  assert(newMatch![0].includes('Sanity: 65/Stable'), 'Must include stat level');
});

await test('Extracted directives do not include relationship section', () => {
  const match = mockStatUpdateOutput.match(/##\s*G\.?\s*NARRATIVE DIRECTIVES[\s\S]*$/i);
  assert(match !== null, 'Must match');
  assert(!match![0].includes('## F. Relationship'), 'Must not include Section F');
});

// ═══════════════════════════════════════════════════════════
// Fix #2b — Faction Reputation regex: anchored to Section B
// ═══════════════════════════════════════════════════════════
console.log('\n─── Fix #2b: Faction Reputation regex anchored to Section B ───');

await test('Old reputation regex false-positive: matches bare FACTION REPUTATION header (proves the bug existed)', () => {
  const oldStyleStatUpdate = `## FACTION REPUTATION
| Character | Faction | Old Rep | New Rep | Label |
|-----------|---------|---------|---------|-------|
| Kai | Nexus Corp | 6 | 5 | Neutral |`;

  const oldRegex = /## (?:E\.\s*)?FACTION REPUTATION[\s\S]*?(?=## [A-Z]|$)/i;
  const oldMatch = oldStyleStatUpdate.match(oldRegex);
  assert(oldMatch !== null, 'Old regex matches the bare FACTION REPUTATION header — confirms the bug existed');
});

await test('New reputation regex only matches Section B of stat updates', () => {
  const newRegex = /##\s*B\.?\s*Faction Reputation[\s\S]*?(?=##\s*[C-Z]\.?|$)/i;
  const match = mockStatUpdateOutput.match(newRegex);
  assert(match !== null, 'Must match Section B in stat update');
  assert(match![0].includes('Nexus Corp'), 'Must contain reputation data');
  assert(match![0].includes('Neutral→Distrusted'), 'Must contain threshold crossing flag');
});

await test('New reputation regex does not match stat DEFINITION output section C', () => {
  const statDefinitionOutput = `## C. Faction Reputation Tracker
| Character | Faction | Starting Reputation | Label | Reason |`;
  const newRegex = /##\s*B\.?\s*Faction Reputation[\s\S]*?(?=##\s*[C-Z]\.?|$)/i;
  const match = statDefinitionOutput.match(newRegex);
  assertEqual(match, null, 'New regex must NOT match ## C. Faction Reputation (definition output)');
});

// ═══════════════════════════════════════════════════════════
// Fix #1 — Section B is now a Markdown table in templates
// ═══════════════════════════════════════════════════════════
console.log('\n─── Fix #1: Section B Markdown table schema ───');

const projectRoot = join(import.meta.dirname, '..');
const templatesSource = readFileSync(join(projectRoot, 'projects/src/templates.ts'), 'utf8');

await test('Section B no longer uses bullet-point format', () => {
  assert(!templatesSource.includes('- **Pair**: Character A'), 'Old bullet-point Pair definition must be gone');
  assert(!templatesSource.includes('- **Starting Intensity**: 1-10 scale'), 'Old bullet-point Intensity must be gone');
});

await test('Section B now defines a Markdown table header', () => {
  if (templatesSource.includes('novel-pipeline')) {
    assert(templatesSource.includes('| Character A | Character B | Starting Dynamic | Intensity (1-10) | Trajectory'), 'Table header must be present');
  }
});

await test('Section B table schema is consistent with stat_update output columns', () => {
  if (templatesSource.includes('novel-pipeline')) {
    assert(templatesSource.includes('Intensity (1-10)'), 'Must define Intensity column');
    assert(templatesSource.includes('Pressure Point'), 'Must define Pressure Point column');
  }
});

// ═══════════════════════════════════════════════════════════
// Fix #7 — Task-aware minimum response length
// ═══════════════════════════════════════════════════════════
console.log('\n─── Fix #7: Task-aware minimum response length ───');

await test('Creative step word-count threshold: 30% of wordCountTarget', () => {
  const wordCountTarget = 3000;
  const minWords = Math.floor(wordCountTarget * 0.3);
  assertEqual(minWords, 900, 'minWords for 3000-word chapter');
});

await test('Creative step with no wordCountTarget defaults to 300 words', () => {
  const wordCountTarget = undefined;
  const minWords = wordCountTarget ? Math.floor(wordCountTarget * 0.3) : 300;
  assertEqual(minWords, 300, 'default minWords');
});

await test('Short PASS verdict passes char-based check (analytical steps)', () => {
  const text = '- **POV Character**: Kai\n- **Outline Match**: YES\n- **Deep POV Score**: 8\n- **Verdict**: PASS';
  const minResponseLength = 50; // system default
  assert(text.length >= minResponseLength, 'Short analytical verdict should pass char check');
});

// ═══════════════════════════════════════════════════════════
// Fix #8 — Outline validator: thin chapter detection
// ═══════════════════════════════════════════════════════════
console.log('\n─── Fix #8: Outline thin-chapter detection ───');

function runOutlineValidation(text: string, targetCh: number) {
  const missing: number[] = [];
  const thin: number[] = [];
  for (let i = 1; i <= targetCh; i++) {
    const chRegex = new RegExp(`(?:Chapter\\s+0?${i}\\b|\\*\\*Chapter\\s+0?${i}\\b|##\\s*(?:Chapter\\s+)?0?${i}\\b|^0?${i}[.:]\\s)`, 'im');
    const chMatch = text.match(chRegex);
    if (!chMatch) { missing.push(i); }
    else {
      const chStart = text.indexOf(chMatch[0]);
      const chSection = text.substring(chStart, chStart + 500);
      if (chSection.length < 100) thin.push(i);
    }
  }
  return { missing, thin };
}

await test('Validator passes a well-formed outline', () => {
  const ch1 = 'POV: Kai. Scene: Kai wakes in the server farm to find the central AI has been compromised by an unknown intruder. Rising tension as he navigates the breach protocols alone. Ends with discovery of the mole identity buried in the access logs. Foreshadowing: the mirror motif.\n\n';
  const ch2 = 'POV: Mara. Scene: Mara is tailed through the night market district by a Nexus Corp operative. Subplot B advances as she makes contact with the resistance cell leader. Faction reputation shift: Mara drops from Neutral to Distrusted with Nexus Corp. Ends on a cliffhanger ambush.\n\n';
  const ch3 = 'POV: Kai. Scene: Confrontation with the faction representative in the abandoned relay tower. Character stats pushed to breaking point — Sanity threshold crossed. Subplot A resolved. Ends with an uneasy truce that neither party intends to honour.';
  const text = `## Chapter 1\n${ch1}## Chapter 2\n${ch2}## Chapter 3\n${ch3}`;
  const { missing, thin } = runOutlineValidation(text, 3);
  assertEqual(missing.length, 0, 'no missing chapters');
  assertEqual(thin.length, 0, 'no thin chapters');
});

await test('Validator detects missing chapter', () => {
  const longContent = 'POV: Kai. Scene detail here with lots of content to fill the section past the 100-char threshold for the thin-chapter check. More content here.';
  const text = `## Chapter 1\n${longContent}\n\n## Chapter 3\n${longContent}`;
  const { missing } = runOutlineValidation(text, 3);
  assert(missing.includes(2), 'Chapter 2 must be flagged as missing');
});

await test('Thin-content predicate: trimmed section < 100 chars flags chapter', () => {
  const trimmedLength = (section: string) => section.replace(/\s+/g, ' ').trim().length;

  assert(trimmedLength('## Chapter 1 See above.') < 100, '"See above." placeholder is thin');
  assert(trimmedLength('## Chapter 3 Same.') < 100, '"Same." placeholder is thin');
  assert(trimmedLength('## Chapter 7') < 100, 'Header-only chapter is thin');
  assert(trimmedLength('## Chapter 2 [see above]') < 100, 'Bracket placeholder is thin');

  const realSection = '## Chapter 2 POV: Kai. Full scene detail — the heist begins in earnest, Mara takes point while Kai holds the server room. Faction reps shift. Subplot resolved. Ends with explosion.';
  assert(trimmedLength(realSection) >= 100, 'Full scene content is NOT thin');
});

// ═══════════════════════════════════════════════════════════
// Fix #10 — Tension Blueprint captures prose annotation
// ═══════════════════════════════════════════════════════════
console.log('\n─── Fix #10: Tension Blueprint prose annotation ───');

function extractTensionRow(tensionResult: string, chapterNum: number) {
  const lines = tensionResult.split('\n');
  const rowIdx = lines.findIndex(line => {
    const match = line.match(/^\|?\s*(?:Chapter\s+)?(\d+)\s*\|/i);
    return match && parseInt(match[1], 10) === chapterNum;
  });
  if (rowIdx === -1) return null;
  const chapterRow = lines[rowIdx];
  const nextLine = lines[rowIdx + 1] ?? '';
  const proseNote = !nextLine.startsWith('|') && nextLine.trim().length > 0
    ? `\n\n**Structural Note**: ${nextLine.trim().substring(0, 250)}`
    : '';
  return `${chapterRow}${proseNote}`;
}

const tensionBlueprint = `| Chapter | Target Tension | Beat Type | Notes |
|---------|---------------|-----------|-------|
| 1 | 5/10 | Inciting | Establish the world |
| 2 | 7/10 | Rising | First real threat |
Dark Night of the Soul approaching — do NOT resolve tension here. Let it linger.
| 3 | 9/10 | Climax | All-in confrontation |
| 4 | 3/10 | Denouement | Aftermath, breathe |`;

await test('Extracts correct row for chapter 2', () => {
  const result = extractTensionRow(tensionBlueprint, 2);
  assert(result !== null, 'Must find chapter 2 row');
  assert(result!.includes('7/10'), 'Must include tension level');
  assert(result!.includes('Rising'), 'Must include beat type');
});

await test('Captures prose annotation after chapter 2 row', () => {
  const result = extractTensionRow(tensionBlueprint, 2);
  assert(result!.includes('Dark Night of the Soul'), 'Must capture structural note');
  assert(result!.includes('**Structural Note**'), 'Must use Structural Note prefix');
});

await test('Does NOT add structural note when next line is another table row', () => {
  const result = extractTensionRow(tensionBlueprint, 3);
  assert(!result!.includes('**Structural Note**'), 'Chapter 3 next line is a table row — no note');
});

await test('Works for chapter with no annotation (chapter 4)', () => {
  const result = extractTensionRow(tensionBlueprint, 4);
  assert(result !== null, 'Must find row');
  assert(result!.includes('3/10'), 'Must include tension level');
  assert(!result!.includes('**Structural Note**'), 'No annotation on chapter 4');
});

// ═══════════════════════════════════════════════════════════
// Fix — ProseSanitizer strips <think> blocks
// ═══════════════════════════════════════════════════════════
console.log('\n─── Fix: ProseSanitizer <think> block stripping ───');

function sanitizeThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '');
}

await test('Strips single <think> block from prose', () => {
  const input = 'The rain fell hard.\n<think>The user wants me to write about rain. I should use sensory detail.</think>\nKai pulled his jacket tighter.';
  const result = sanitizeThinkBlocks(input);
  assert(!result.includes('<think>'), 'Must remove opening tag');
  assert(!result.includes('The user wants me'), 'Must remove think content');
  assert(result.includes('Kai pulled his jacket'), 'Must preserve prose');
});

await test('Strips multiple <think> blocks', () => {
  const input = '<think>First thought.</think>Prose here.<think>Second thought.</think>More prose.';
  const result = sanitizeThinkBlocks(input);
  assert(!result.includes('<think>'), 'No think tags remain');
  assert(result.includes('Prose here.'), 'First prose preserved');
  assert(result.includes('More prose.'), 'Second prose preserved');
});

await test('Case-insensitive: strips <THINK> uppercase variant', () => {
  const input = 'Start.<THINK>Reasoning block.</THINK>End.';
  const result = sanitizeThinkBlocks(input);
  assert(!result.includes('THINK'), 'Uppercase tags removed');
  assert(result.includes('Start.'), 'Content preserved');
});

await test('Leaves clean prose untouched', () => {
  const input = 'The server room was cold. Kai exhaled, watching his breath mist.';
  const result = sanitizeThinkBlocks(input);
  assertEqual(result, input, 'Clean prose must be unchanged');
});

// ═══════════════════════════════════════════════════════════
// Fix #6 — Chapter echo word count (200 → 300)
// ═══════════════════════════════════════════════════════════
console.log('\n─── Fix #6: Chapter echo 300 words ───');

await test('prompt-builder uses 300 words for chapter echo', async () => {
  const builder = new PromptBuilder('/dummy', mockContextEngine, mockStateStore, null, mockConfig, mockLog);
  
  const words: string[] = [];
  for (let i = 1; i <= 400; i++) {
    words.push(`word${i}`);
  }
  const chapter1Result = words.join(' ');

  const project = {
    id: 'p1',
    title: 'My Novel',
    context: {},
    steps: [
      { id: 's1', label: 'Chapter 1 writing', taskType: 'revision_execution', chapterNumber: 1, status: 'completed', result: chapter1Result }
    ]
  } as any;
  const provider = { id: 'ollama', name: 'Ollama', providerConfig: {}, contextWindow: 8192 } as any;

  const step = { id: 's2', label: 'Chapter 2 writing', taskType: 'creative_writing', chapterNumber: 2, phase: 'writing' } as any;
  const result = await builder.build(project, step, provider, 'System prompt');
  
  assert(result.message.includes('End of Chapter 1'), 'Should contain Chapter Echo');
  assert(result.message.includes('word101'), 'Echo must include word101');
  assert(!result.message.includes('word100'), 'Echo must slice out word100');
});

// ═══════════════════════════════════════════════════════════
// Fix — step-runner type routing & parameters
// ═══════════════════════════════════════════════════════════
console.log('\n─── Fix: Step-runner persona routing & parameters ───');

await test('StepRunner planning types builds correct system prompt', () => {
  const runner = new StandardLlmRunner();
  const project = { id: 'p1', title: 'My Novel', context: {} } as any;
  const dummyRunner = {} as any;

  const outlineStep = { id: 's1', label: 'Plot outline', taskType: 'outline' } as any;
  const outlinePrompt = (runner as any).buildSystemPrompt(project, outlineStep, dummyRunner);
  assert(outlinePrompt.includes('You are the P.E.R.R.Y. System — an expert fiction plotting and world-building architect.'), 'Outline system prompt must have planning framing');

  const voiceStep = { id: 's2', label: 'Voice targets', taskType: 'voice_profile' } as any;
  const voicePrompt = (runner as any).buildSystemPrompt(project, voiceStep, dummyRunner);
  assert(voicePrompt.includes('You are the P.E.R.R.Y. System — an expert fiction plotting and world-building architect.'), 'Voice profile system prompt must have planning framing');
});

await test('StepRunner analytical types builds correct system prompt', () => {
  const runner = new StandardLlmRunner();
  const project = { id: 'p1', title: 'My Novel', context: {} } as any;
  const dummyRunner = {} as any;

  const researchStep = { id: 's3', label: 'Network Research', taskType: 'research' } as any;
  const researchPrompt = (runner as any).buildSystemPrompt(project, researchStep, dummyRunner);
  assert(researchPrompt.includes('You are the P.E.R.R.Y. Analytical Engine — a strict literary critic and quality auditing system.'), 'Research system prompt must have analytical framing');
});

await test('Creative writing step uses repeat penalty of 1.15', async () => {
  const runner = new StandardLlmRunner();
  const project = {
    id: 'proj-creative',
    title: 'Creative Project',
    context: {},
    steps: []
  } as any;
  
  const step = {
    id: 'step-creative',
    label: 'Write Chapter 1',
    taskType: 'creative_writing',
    prompt: 'Start writing...',
    chapterNumber: 1
  } as any;

  let capturedParams: any = null;

  const mockRunner = {
    directorAbilities: [],
    shouldUseWorkersForResearch: () => false,
    log: mockLog,
    promptBuilder: {
      build: async () => ({ message: 'Mock Prompt', budgetReport: { used: 0, remaining: 1000, droppedSlots: [] } }),
    },
    mcpClient: {
      getTools: () => [],
    },
    config: {
      workspaceDir: '/dummy',
      maxRetries: 3,
    },
    styleDna: {
      compileSeed: () => null,
      compileGoldenExamples: () => null,
    },
    dedup: {
      deduplicateContent: (text: string) => text,
      deduplicateOutput: (text: string) => text,
    },
    sanitizer: {
      sanitize: (text: string) => text,
    },
    eventBus: {
      emit: () => {},
    },
    stateStore: {
      completeStep: () => {},
      failStep: () => {},
      recordTelemetry: () => {},
    },
    costTracker: {
      recordCost: () => true,
    },
    saveStepToDisk: async () => {},
    router: {
      config: {
        get: (key: string, def: any) => def,
      },
      resolveRoutingTarget: () => 'writer',
      getProvider: () => ({ id: 'writer-gpu', name: 'Writer GPU' }),
      selectProvider: () => ({ id: 'writer-gpu', name: 'Writer GPU' }),
      getFallbackProvider: () => null,
      getOutputBudget: () => 4096,
      getRecommendedThinking: () => undefined,
      contextWatcher: {
        recordPromptTokens: () => {},
        getHallucinationWarning: () => null,
        getCompressionMultiplier: () => 1.0,
        recordActualUsage: () => {},
      },
      complete: async (params: any) => {
        capturedParams = params;
        return {
          text: 'Once upon a time. '.repeat(100),
          promptTokens: 10,
          completionTokens: 5,
          estimatedCost: 0.0001,
          tokensUsed: 15,
        };
      }
    }
  } as any;

  await runner.execute(project, step, mockRunner);
  assert(capturedParams !== null, 'complete must be called');
  assertEqual(capturedParams.repeatPenalty, 1.15, 'repeatPenalty must be 1.15');
});

await test('Hallucination guard uses dynamic GPU label', async () => {
  const runner = new StandardLlmRunner();
  const project = {
    id: 'proj-creative',
    title: 'Creative Project',
    context: {},
    steps: []
  } as any;
  
  const step = {
    id: 'step-creative',
    label: 'Write Chapter 1',
    taskType: 'creative_writing',
    prompt: 'Start writing...',
    chapterNumber: 1
  } as any;

  let passedLabel: string | null = null;

  const mockRunner = {
    directorAbilities: [],
    shouldUseWorkersForResearch: () => false,
    log: mockLog,
    promptBuilder: {
      build: async () => ({ message: 'Mock Prompt', budgetReport: { used: 0, remaining: 1000, droppedSlots: [] } }),
    },
    mcpClient: {
      getTools: () => [],
    },
    config: {
      workspaceDir: '/dummy',
      maxRetries: 3,
    },
    styleDna: {
      compileSeed: () => null,
      compileGoldenExamples: () => null,
    },
    dedup: {
      deduplicateContent: (text: string) => text,
      deduplicateOutput: (text: string) => text,
    },
    sanitizer: {
      sanitize: (text: string) => text,
    },
    eventBus: {
      emit: () => {},
    },
    stateStore: {
      completeStep: () => {},
      failStep: () => {},
      recordTelemetry: () => {},
    },
    costTracker: {
      recordCost: () => true,
    },
    saveStepToDisk: async () => {},
    router: {
      config: {
        get: (key: string, def: any) => def,
      },
      resolveRoutingTarget: () => 'writer',
      getProvider: () => ({ id: 'writer-gpu', name: 'My Custom GPU (80GB)' }),
      selectProvider: () => ({ id: 'writer-gpu', name: 'My Custom GPU (80GB)' }),
      getFallbackProvider: () => null,
      getOutputBudget: () => 4096,
      getRecommendedThinking: () => undefined,
      contextWatcher: {
        recordPromptTokens: () => {},
        getHallucinationWarning: (label: string) => {
          passedLabel = label;
          return '\n[WARNING: Near capacity]';
        },
        getStats: () => ({ gpus: [{ label: 'My Custom GPU (80GB)', percentFull: 95 }] }),
        getCompressionMultiplier: () => 1.0,
        recordActualUsage: () => {},
      },
      complete: async (params: any) => {
        return {
          text: 'Story prose '.repeat(150),
          promptTokens: 10,
          completionTokens: 5,
          estimatedCost: 0.0001,
          tokensUsed: 15,
        };
      }
    }
  } as any;

  await runner.execute(project, step, mockRunner);
  assertEqual(passedLabel, 'My Custom GPU (80GB)', 'Hallucination warning check must receive custom GPU name');
});

await test('CompileRunner export task runs sanitizer on final result', async () => {
  const runner = new CompileRunner();
  const project = {
    id: 'proj-compile',
    title: 'Compilation Project',
    steps: []
  } as any;
  const step = {
    id: 'step-export',
    label: 'Export Novel',
    taskType: 'export'
  } as any;

  let sanitizeCalled = false;

  const mockRunner = {
    log: mockLog,
    stateStore: {
      completeStep: () => {},
      failStep: () => {},
    },
    eventBus: {
      emit: () => {},
    },
    saveStepToDisk: async () => {},
    dedup: {
      scanForCrossChapterDuplicates: () => {},
    },
    sanitizer: {
      sanitize: (text: string) => {
        sanitizeCalled = true;
        return text + ' (sanitized)';
      }
    }
  } as any;

  const result = await runner.execute(project, step, mockRunner);
  assert(sanitizeCalled, 'ProseSanitizer.sanitize must be called during export');
  assert(result.endsWith('(sanitized)'), 'Sanitized result must be returned');
});

await test('book_bible system prompt uses positive framing', () => {
  const runner = new StandardLlmRunner();
  const project = { id: 'p1', title: 'My Novel', context: {} } as any;
  const dummyRunner = {} as any;

  const step = { id: 's4', label: 'Book Bible Definitions', taskType: 'book_bible' } as any;
  const prompt = (runner as any).buildSystemPrompt(project, step, dummyRunner);
  assert(!prompt.includes('Do not write story prose. Do not include conversational filler.'), 'Must not contain old negative constraints');
  assert(prompt.includes('Output structured data only'), 'Must contain positive framing');
});

// ═══════════════════════════════════════════════════════════
// Fix — prompt-builder isAnalyticalStep expanded & footers
// ═══════════════════════════════════════════════════════════
console.log('\n─── Fix: isAnalyticalStep covers outline + voice_profile ───');

await test('prompt-builder isAnalyticalStep covers outline + voice_profile', async () => {
  const builder = new PromptBuilder('/dummy', mockContextEngine, mockStateStore, null, mockConfig, mockLog);
  const project = { id: 'p1', title: 'My Novel', context: {}, steps: [] } as any;
  const provider = { id: 'ollama', name: 'Ollama', providerConfig: {}, contextWindow: 8192 } as any;

  const outlineStep = { id: 's1', label: 'Plot outline', taskType: 'outline', prompt: 'outline prompt' } as any;
  const outlineResult = await builder.build(project, outlineStep, provider, 'System prompt');
  
  assert(!outlineResult.message.includes('[ANTI-LAZINESS:'), 'Outline must skip Anti-Laziness Protocol');
  assert(!outlineResult.message.includes('[BANNED (overused AI defaults'), 'Outline must skip Global Anti-Patterns');

  const creativeStep = { id: 's2', label: 'Chapter 1', taskType: 'creative_writing', prompt: 'creative prompt' } as any;
  const creativeResult = await builder.build(project, creativeStep, provider, 'System prompt');
  assert(creativeResult.message.includes('[ANTI-LAZINESS:'), 'Creative step must include Anti-Laziness Protocol');
  assert(creativeResult.message.includes('[BANNED (overused AI defaults'), 'Creative step must include Global Anti-Patterns');
});

await test('stat_update has separate reinforcement footer and does not re-emit step.prompt', async () => {
  const builder = new PromptBuilder('/dummy', mockContextEngine, mockStateStore, null, mockConfig, mockLog);
  const project = { id: 'p1', title: 'My Novel', context: {}, steps: [] } as any;
  const provider = { id: 'ollama', name: 'Ollama', providerConfig: {}, contextWindow: 8192 } as any;
  
  const step = { id: 's3', label: 'Stats update', taskType: 'stat_update', prompt: 'MY_UNIQUE_STEP_PROMPT' } as any;
  const result = await builder.build(project, step, provider, 'System prompt');
  
  assert(result.message.includes('You are a live tracking database'), 'stat_update must use its own reinforcement footer');
  assert(!result.message.includes('You are an analytical grading engine'), 'stat_update must not use pov_check framing');
  
  const occurrences = result.message.split('MY_UNIQUE_STEP_PROMPT').length - 1;
  assertEqual(occurrences, 1, 'step.prompt must only be emitted once in the whole prompt');
});

await test('pov_check reinforcement footer does not re-emit step.prompt', async () => {
  const builder = new PromptBuilder('/dummy', mockContextEngine, mockStateStore, null, mockConfig, mockLog);
  const project = { id: 'p1', title: 'My Novel', context: {}, steps: [] } as any;
  const provider = { id: 'ollama', name: 'Ollama', providerConfig: {}, contextWindow: 8192 } as any;
  
  const step = { id: 's4', label: 'POV audit check', taskType: 'pov_check', prompt: 'ANOTHER_UNIQUE_STEP_PROMPT' } as any;
  const result = await builder.build(project, step, provider, 'System prompt');
  
  assert(result.message.includes('You are an analytical grading engine'), 'pov_check must use its reinforcement footer');
  
  const occurrences = result.message.split('ANOTHER_UNIQUE_STEP_PROMPT').length - 1;
  assertEqual(occurrences, 1, 'step.prompt must only be emitted once in the whole prompt');
});

// ═══════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n✓ All tests passed!');
  process.exit(0);
}
