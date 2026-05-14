import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : 2.a - Outline Generation
// Nodes   : 57  |  Connections: 45
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ChapterSelector                    code
// LoopController                     code
// Outline                            chainLlm                   [AI] [onError→regular]
// CritiqueOutline                    chainLlm                   [AI] [onError→regular]
// RewriteOutline                     chainLlm                   [AI] [onError→regular]
// EmotionalCheck                     chainLlm                   [AI] [onError→regular]
// SciencePlotEnrichment              chainLlm                   [AI] [onError→regular]
// ContinuityChecker                  chainLlm                   [AI] [onError→regular]
// SceneBreakdown                     chainLlm                   [AI] [onError→regular]
// ForeshadowingPlanner               chainLlm                   [AI] [onError→regular]
// PovPlanner                         chainLlm                   [AI] [onError→regular]
// DialogueVoiceMapper                chainLlm                   [AI] [onError→regular]
// OllamaChatModel19                  lmChatOllama               [creds] [ai_languageModel]
// ThemeWeaver                        chainLlm                   [AI] [onError→regular]
// OllamaChatModel20                  lmChatOllama               [creds] [ai_languageModel]
// GhostwriterBrief                   chainLlm                   [AI] [onError→regular]
// ChapterLimiter                     code
// StoreBrief                         code
// JoinBriefs                         code
// CleanOutlineOutput                 code
// PostProcess                        code
// SendToOutlineDoc                   googleDocs                 [creds]
// OllamaChatModel15                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel16                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel17                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel18                  lmChatOllama               [creds] [ai_languageModel]
// ChapterDoneCheck                   if
// OutlinePrompts                     code
// OllamaChatModel9                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel10                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel11                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel12                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel13                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel14                  lmChatOllama               [creds] [ai_languageModel]
// GetDossier                         googleDocs                 [creds]
// GetBlankCharacterDoc               googleDocs                 [creds]
// GetBlankWorldbuildingDoc           googleDocs                 [creds]
// GetBlankOutlineDoc                 googleDocs                 [creds]
// GetStoryTemplate                   googleDocs                 [creds]
// GetTropeTemplate                   googleDocs                 [creds]
// GetPlotTemplate                    googleDocs                 [creds]
// GetCharacterTemplate               googleDocs                 [creds]
// GetWorldbuildingTemplate           googleDocs                 [creds]
// GetBlankStoryDoc                   googleDocs                 [creds]
// GetForbiddenWordsTemplate          googleDocs                 [creds]
// ExtractSeeds                       code
// UniversalConfig                    code
// Debug                              code
// GetCharacterEmotionTemplate        googleDocs                 [creds]
// GetThemesTemplate                  googleDocs                 [creds]
// ConflictArchitectureTemplate       googleDocs                 [creds]
// DialogueVoiceTemplate              googleDocs                 [creds]
// RevelationBackstoryTemplate        googleDocs                 [creds]
// LocationProfileTemplate            googleDocs                 [creds]
// FactionPowerTemplate               googleDocs                 [creds]
// WhenClickingExecuteWorkflow        manualTrigger
// BriefValidator                     code
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// WhenClickingExecuteWorkflow
//    → FactionPowerTemplate
//      → LocationProfileTemplate
//        → RevelationBackstoryTemplate
//          → DialogueVoiceTemplate
//            → ConflictArchitectureTemplate
//              → GetThemesTemplate
//                → GetTropeTemplate
//                  → GetPlotTemplate
//                    → GetCharacterTemplate
//                      → GetCharacterEmotionTemplate
//                        → GetStoryTemplate
//                          → GetWorldbuildingTemplate
//                            → GetForbiddenWordsTemplate
//                              → GetDossier
//                                → GetBlankCharacterDoc
//                                  → GetBlankStoryDoc
//                                    → GetBlankWorldbuildingDoc
//                                      → GetBlankOutlineDoc
//                                        → ExtractSeeds
//                                          → UniversalConfig
//                                            → Debug
//                                              → ChapterSelector
//                                                → LoopController
//                                                  → ChapterDoneCheck
//                                                    → JoinBriefs
//                                                      → CleanOutlineOutput
//                                                        → PostProcess
//                                                          → SendToOutlineDoc
//                                                   .out(1) → OutlinePrompts
//                                                      → Outline
//                                                        → CritiqueOutline
//                                                          → RewriteOutline
//                                                            → EmotionalCheck
//                                                              → SciencePlotEnrichment
//                                                                → ContinuityChecker
//                                                                  → SceneBreakdown
//                                                                    → ForeshadowingPlanner
//                                                                      → PovPlanner
//                                                                        → DialogueVoiceMapper
//                                                                          → ThemeWeaver
//                                                                            → GhostwriterBrief
//                                                                              → ChapterLimiter
//                                                                                → BriefValidator
//                                                                                  → StoreBrief
//                                                                                    → LoopController (↩ loop)
//
// AI CONNECTIONS
// Outline.uses({ ai_languageModel: OllamaChatModel9 })
// CritiqueOutline.uses({ ai_languageModel: OllamaChatModel10 })
// RewriteOutline.uses({ ai_languageModel: OllamaChatModel11 })
// EmotionalCheck.uses({ ai_languageModel: OllamaChatModel13 })
// SciencePlotEnrichment.uses({ ai_languageModel: OllamaChatModel14 })
// ContinuityChecker.uses({ ai_languageModel: OllamaChatModel12 })
// SceneBreakdown.uses({ ai_languageModel: OllamaChatModel15 })
// ForeshadowingPlanner.uses({ ai_languageModel: OllamaChatModel16 })
// PovPlanner.uses({ ai_languageModel: OllamaChatModel17 })
// DialogueVoiceMapper.uses({ ai_languageModel: OllamaChatModel19 })
// ThemeWeaver.uses({ ai_languageModel: OllamaChatModel20 })
// GhostwriterBrief.uses({ ai_languageModel: OllamaChatModel18 })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'nB6dkKCA0npZSNQG',
    name: '2.a - Outline Generation',
    active: false,
    settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
})
export class _2AOutlineGenerationWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: 'chapter-selector-001',
        name: 'Chapter Selector',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-2608, 1280],
    })
    ChapterSelector = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `
// ╔════════════════════════════════════════════════════════════════╗
// ║  CHAPTER SELECTOR — Edit ALL configurable variables here.    ║
// ╠════════════════════════════════════════════════════════════════╣
// ║  PROJECT IDENTITY                                             ║
// ║    BOOK_TITLE — your book title (used when running standalone)║
// ╠════════════════════════════════════════════════════════════════╣
// ║  CHAPTER RANGE                                                ║
// ║    CHAPTER_START  — first numbered chapter to outline (int)  ║
// ║    CHAPTER_END    — last  numbered chapter to outline (int)  ║
// ║    TOTAL_CHAPTERS — total numbered chapters in the novel      ║
// ╠════════════════════════════════════════════════════════════════╣
// ║  PROLOGUE / EPILOGUE                                          ║
// ║    INCLUDE_PROLOGUE — true  → generate Prologue              ║
// ║    INCLUDE_EPILOGUE — true  → generate Epilogue              ║
// ║    Set to false to skip them in this pass.                   ║
// ╠════════════════════════════════════════════════════════════════╣
// ║  DENSITY                                                      ║
// ║    WORDS_PER_CHAPTER — target beat-density per chapter       ║
// ╚════════════════════════════════════════════════════════════════╝

var BOOK_TITLE       = "";      // ← your book title (leave empty to auto-detect from dossier)
var CHAPTER_START    = 1;       // ← first numbered chapter
var CHAPTER_END      = 4;       // ← last  numbered chapter
var TOTAL_CHAPTERS   = 20;      // ← total chapters in the novel
var INCLUDE_PROLOGUE = true;    // ← true / false
var INCLUDE_EPILOGUE = false;   // ← true / false
var WORDS_PER_CHAPTER = 800;    // ← target detail density

// Build the chapter list from the flags above
var chapters = [];
if (INCLUDE_PROLOGUE && INCLUDE_EPILOGUE) chapters.push("Prologue");
for (var i = CHAPTER_START; i <= Math.min(TOTAL_CHAPTERS, CHAPTER_END); i++) {
  chapters.push(String(i));
}
if (INCLUDE_EPILOGUE) chapters.push("Epilogue");

// Return one item PER chapter for the loop
return chapters.map(function(ch) {
  return { json: {
    chapter:           ch,
    selectedChapters:  ch,
    allChapters:       chapters.join(","),
    bookTitle:         BOOK_TITLE.trim().toUpperCase(),
    chapterStart:      CHAPTER_START,
    chapterEnd:        CHAPTER_END,
    totalChapters:     TOTAL_CHAPTERS,
    includePrologue:   INCLUDE_PROLOGUE,
    includeEpilogue:   INCLUDE_EPILOGUE,
    wordsPerChapter:   WORDS_PER_CHAPTER,
  }};
});
`,
        notice: '',
    };

    @node({
        id: '1fc77e4c-98b2-49b2-84f6-7e1752d33647',
        name: 'Loop Controller',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-2400, 1280],
    })
    LoopController = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `
// Manual loop controller — processes chapters one at a time
const staticData = $getWorkflowStaticData('global');
const input = $input.first().json;

// Detect fresh start vs loop-back:
// ChapterSelector output has bookTitle but no 'accumulated' field
// StoreBrief output has 'accumulated' field
const isLoopBack = input.hasOwnProperty('accumulated');

if (!isLoopBack) {
  // Fresh start from ChapterSelector — ALWAYS reset
  staticData.loopIndex = 0;
  staticData.accumulatedBriefs = '';
}

// Get all chapters from Chapter Selector
const allChapters = $('Chapter Selector').first().json.allChapters || '';
const chapterList = allChapters.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
const currentIndex = staticData.loopIndex || 0;

if (currentIndex >= chapterList.length) {
  // All chapters processed — signal done
  const accumulated = staticData.accumulatedBriefs || '';
  staticData.loopIndex = 0;
  staticData.accumulatedBriefs = '';
  return [{ json: { done: true, accumulated: accumulated, chapters_processed: chapterList.length } }];
}

// Get the current chapter
const currentChapter = chapterList[currentIndex];
const previousBriefs = staticData.accumulatedBriefs || '';

// Advance the index for the NEXT iteration
staticData.loopIndex = currentIndex + 1;

// Return the current chapter data
const selectorData = $('Chapter Selector').first().json;
return [{ json: {
  done: false,
  chapter: currentChapter,
  selectedChapters: currentChapter,
  allChapters: allChapters,
  bookTitle: selectorData.bookTitle || '',
  chapterStart: selectorData.chapterStart,
  chapterEnd: selectorData.chapterEnd,
  totalChapters: selectorData.totalChapters,
  includePrologue: selectorData.includePrologue,
  includeEpilogue: selectorData.includeEpilogue,
  wordsPerChapter: selectorData.wordsPerChapter,
  previousBriefs: previousBriefs,
  loopIndex: currentIndex,
  totalToProcess: chapterList.length,
} }];
`,
        notice: '',
    };

    @node({
        id: 'd8df3b9d-09e8-4776-8459-f5f07782894e',
        name: 'Outline',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [-1824, 1328],
        onError: 'continueRegularOutput',
    })
    Outline = {
        notice: '',
        promptType: 'define',
        text: '={{ $json.prompt }}',
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: '3f13e2a6-1839-415f-8025-e3a10dd133e2',
        name: 'Critique Outline',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [-1568, 1328],
        onError: 'continueRegularOutput',
    })
    CritiqueOutline = {
        notice: '',
        promptType: 'define',
        text: `=CRITICAL: For every issue you identify, write "FIX: [exact change to make]" so the Rewrite node can apply it directly. Do NOT just list problems.\\n\\nYou are a sharp, constructive developmental editor specialising in chapter outlines.

CONTEXT:
- Project: {{ $('Extract Seeds').first().json.title }}
- Prose Jail: {{ $('Universal Config').first().json.prose_jail }}
- Active Profile: {{ $('Universal Config').first().json?.active_profile?.label }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Target Chapters: {{ $('Outline Prompts').first().json.target_chapters || 'all' }}
- Words Per Chapter Target: {{ $('Outline Prompts').first().json.words_per_chapter || 'unknown' }}

FORBIDDEN WORDS:
{{ $('Extract Seeds').first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $('Extract Seeds').first().json.dossier }}

CAST MANIFEST:
{{ $('Extract Seeds').first().json?.characters || '[ERROR: No character data found]' }}

WORLDBUILDING:
{{ $('Extract Seeds').first().json?.worldbuilding || '[ERROR: No worldbuilding data found]' }}

STORY ARC:
{{ $('Extract Seeds').first().json?.storyArc || '[ERROR: No story arc found]' }}

CHARACTER EMOTION TEMPLATE:
{{ $('Universal Config').first().json.character_emotion_full || 'No character emotion template available.' }}

CONFLICT DOCTRINE:
{{ $('Universal Config').first().json.conflict_full || 'No conflict doctrine available.' }}

BACKSTORY DOCTRINE:
{{ $('Universal Config').first().json.backstory_full || 'No backstory doctrine available.' }}

FACTION DOCTRINE:
{{ $('Universal Config').first().json.faction_full || 'No faction doctrine available.' }}

GENRE TROPES:
{{ $('Universal Config').first().json.trope_full || 'No genre trope template available.' }}

PLOT TEMPLATE:
{{ $('Extract Seeds').first().json?.templates?.plot }}

CURRENT OUTLINE:
{{ $('Outline').first().json.text || '[ERROR: No outline found]' }}

AUTHOR NOTES:
{{ $('Extract Seeds').first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $('Universal Config').first().json?.active_profile?.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each flagged chapter, analyse the root structural failure -- why does this chapter fail to advance the arc? Reference specific character motivations from CAST MANIFEST: and specific world mechanics from WORLDBUILDING: to justify every critique point."
  : "You are in FAST mode (14B). Keep critique sharp and structural -- one clear problem and one clear fix per bullet. No extended analysis." }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

INSTRUCTIONS:
Critique the CURRENT OUTLINE:
against the structural rules of STORY ARC:
, the world-logic in DOSSIER SOURCE:
, and the character motivations in CAST MANIFEST:
.

Critique Criteria:
1. **Arc Alignment:** Does each chapter advance the beats defined in STORY ARC:
? Flag any chapter that stalls, repeats a beat, or skips a required turning point from PLOT TEMPLATE:
.
2. **Character Agency:** Is every chapter driven by a specific character's choice based on their Core Motivation from CAST MANIFEST:
? Flag chapters where events happen TO characters rather than BECAUSE of them.
3. **World Mechanics:** Does each chapter use at least one named world element from WORLDBUILDING:
or DOSSIER SOURCE:
as the source of conflict or stakes? Flag chapters with generic conflict that could belong to any novel.
4. **Dossier Compliance:** Scan for world rules, faction names, system names, and locations. Flag any element not traceable to DOSSIER SOURCE:
or WORLDBUILDING:
.
5. **Pacing & Density:** Flag chapters significantly under the target word count or chapters that are pure setup with no tension. Each chapter needs a micro-conflict and a hook.
6. **Hook Quality:** Does each chapter end with a specific, concrete hook that creates urgency? Flag vague or absent chapter endings.
7. **Author Intent:** Flag any chapter that contradicts AUTHOR NOTES:
.
8. **Prose Jail Check:** Scan word-by-word against FORBIDDEN WORDS:
. Report each violation by chapter number and the exact forbidden word.
9. **Humanizer Audit:** Scan the chapter outline text for AI writing patterns that would infect the finished prose. Flag every instance -- do not rewrite, only flag:
   - Structural parallelism: Multiple consecutive beats with the same grammatical structure ("Character does X. Character feels Y. Character realizes Z.").
   - AI-typical phrases: "at its core", "in many ways", "it is worth noting", "speaks to", "a testament to", "as if somehow", "needless to say", "it is clear that".
   - Over-explained emotion: Beat descriptions that tell us what the reader should feel rather than what happens (e.g. "This creates a sense of unease for the reader...").
   - Vague stakes: Generic emotional language ("tense confrontation", "shocking revelation", "emotional moment") instead of the specific mechanism or character action.
   For each instance: quote the phrase, name the chapter, label the pattern, and suggest a concrete dossier-specific replacement.
10. **Stat-Behaviour Alignment:** For each chapter, cross-reference character actions and decisions against the Emotion Profile fields in CAST MANIFEST:
. Flag any chapter where a character acts in a way that would require stats at a radically different level than their established profile (e.g. a character whose §1 Core Stat Act 1 baseline contradicts their in-scene behaviour without narrative justification for a stat shift). Reference the specific Emotion Profile entry and the specific chapter beat.
11. **Depth:** Follow PROFILE INSTRUCTION:
.

Output Format:
1. **Overall Assessment** (2-4 sentences -- does the outline serve the STORY ARC:
as a whole? Does it deliver on the thematic question from DOSSIER SOURCE:
?)
2. **Chapter-Level Issues** (One bullet per problem, labelled by chapter number and criterion: "Ch.3 [Arc Alignment] -- Midpoint reversal from STORY ARC:
is missing. The chapter ends with no shift in power dynamics.")
3. **Improvement Plan** (Actionable steps per chapter: "In Ch.3, insert the Midpoint beat from STORY ARC:
-- [character] discovers [specific mechanism from WORLDBUILDING:
] which reverses their advantage.")


CAST INTEGRITY CHECK: Flag ANY character name that does NOT appear in CAST MANIFEST. Every named character must originate from the Characters output. This is a BLOCKING error -- if found, the rewrite MUST fix it.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.

Hard Constraints:
- Do NOT rewrite any chapter in this node.
- Every critique point must reference a specific element from STORY ARC:
, CAST MANIFEST:
, WORLDBUILDING:
, or DOSSIER SOURCE:
.
- Never use any word from FORBIDDEN WORDS:
in your own output.
- Follow PROFILE INSTRUCTION:
for depth level.

- DOCTRINE COMPLIANCE: Flag any outline beat that violates CONFLICT DOCTRINE:
, BACKSTORY DOCTRINE:
, or FACTION DOCTRINE:
. If a doctrine is empty, skip that audit.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: '422c808f-fa63-403e-835d-68fcc56d4679',
        name: 'Rewrite Outline',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [-1296, 1328],
        onError: 'continueRegularOutput',
    })
    RewriteOutline = {
        notice: '',
        promptType: 'define',
        text: `=You are an expert story outliner and line editor.

CONTEXT:
- Project: {{ $('Extract Seeds').first().json.title }}
- Prose Jail: {{ $('Universal Config').first().json.prose_jail }}
- Active Profile: {{ $('Universal Config').first().json?.active_profile?.label }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Target Chapters: {{ $('Outline Prompts').first().json.target_chapters || 'all' }}
- Words Per Chapter Target: {{ $('Outline Prompts').first().json.words_per_chapter || 'unknown' }}

FORBIDDEN WORDS:
{{ $('Extract Seeds').first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $('Extract Seeds').first().json.dossier }}

CAST MANIFEST:
{{ $('Extract Seeds').first().json?.characters || '[ERROR: No character data found]' }}

WORLDBUILDING:
{{ $('Extract Seeds').first().json?.worldbuilding || '[ERROR: No worldbuilding data found]' }}

STORY ARC:
{{ $('Extract Seeds').first().json?.storyArc || '[ERROR: No story arc found]' }}

CHARACTER EMOTION TEMPLATE:
{{ $('Universal Config').first().json.character_emotion_full || 'No character emotion template available.' }}

CONFLICT DOCTRINE:
{{ $('Universal Config').first().json.conflict_full || 'No conflict doctrine available.' }}

FACTION DOCTRINE:
{{ $('Universal Config').first().json.faction_full || 'No faction doctrine available.' }}

ORIGINAL OUTLINE:
{{ $('Outline').first().json.text || '[ERROR: No outline found]' }}

IMPROVEMENT PLAN:
{{ $('Critique Outline').first().json.text || '[ERROR: No improvement plan found]' }}

AUTHOR NOTES:
{{ $('Extract Seeds').first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $('Universal Config').first().json?.active_profile?.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each revised chapter, ensure the beats create a tight cause-and-effect chain. Every character action must be motivated by their Core Motivation from CAST MANIFEST: , and every conflict must exploit a specific world mechanic from WORLDBUILDING: ."
  : "You are in FAST mode (14B). Keep revisions sharp and structural. Fix exactly what the improvement plan flags -- no expanding, no adding new material beyond what is required." }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

INSTRUCTIONS:
Using the ORIGINAL OUTLINE:
as your base and the IMPROVEMENT PLAN:
as your surgical guide, produce a COMPLETED REVISED outline.

Core Mandate:
1. **Surgical Implementation:** Apply every fix, beat insertion, or restructuring requested in the IMPROVEMENT PLAN:
with 100% precision. Nothing skipped or softened.
2. **Arc Compliance:** Every chapter must advance a specific beat from STORY ARC:
. State which beat each chapter serves.
3. **Character Grounding:** Every chapter must be driven by a specific character's choice from CAST MANIFEST:
. Name the character and their motivation.
4. **World Integration:** Every chapter must use at least one named world element from WORLDBUILDING:
as the source of conflict or stakes.
5. **Hook Strengthening:** Every chapter must end with a concrete, specific hook that creates urgency for the next chapter.
6. **Author Intent:** If any improvement plan suggestion contradicts AUTHOR NOTES:
, flag it inline with [AUTHOR CONFLICT: reason] and preserve the author's intent.
7. **Prose Jail Compliance:** Scan word-by-word against FORBIDDEN WORDS:
before finalising. Replace every violation.
8. **Depth:** Follow the PROFILE INSTRUCTION:
block above.
9. **Stat-Behaviour Fidelity:** When fixing chapters flagged for stat-behaviour misalignment, revise the beat so the character's action is consistent with their §1 stat profile from Emotion Profile in CAST MANIFEST:
. If a beat requires a character to act beyond their current stat level, add a bridging micro-beat that justifies the shift (e.g. a moodlet trigger or §3 cascade condition from CHARACTER EMOTION TEMPLATE:
).

Output Format -- reproduce all TARGET CHAPTERS with revisions applied:
### CHAPTER [NUMBER]: [Title]
[3-5 dense paragraphs of tactical beats. Name the characters, locations, and world mechanics. End with a sharp hook.]

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.

Hard Constraints:
- Output the REVISED OUTLINE ONLY. No preamble, no commentary, no meta-text.
- Preserve all TARGET CHAPTERS not flagged in IMPROVEMENT PLAN:
exactly as they appear in ORIGINAL OUTLINE:
.
- Do not add chapters beyond what exists in ORIGINAL OUTLINE:
unless explicitly requested in IMPROVEMENT PLAN:
.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.
- Follow PROFILE INSTRUCTION:
for depth level.

- DOCTRINE COMPLIANCE: Revised beats must conform to CONFLICT DOCTRINE:
and FACTION DOCTRINE:
. If either is empty, skip that constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: '1205dae3-203b-416d-8fb2-c53022a4bc0f',
        name: 'Emotional Check',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [-1008, 1328],
        onError: 'continueRegularOutput',
    })
    EmotionalCheck = {
        notice: '',
        promptType: 'define',
        text: `=You are an emotional arc specialist for novel outlines. Your job is to ensure every chapter delivers a rich, grounded emotional experience.

CRITICAL RULES:
1. The Character Emotion Layer MUST include EVERY character who appears in ANY scene of the chapter, not just the POV character.
2. For EACH character, provide: Opening stat snapshot with at least 2 named stats and numeric values, Active cascade conditions that reference SPECIFIC rules from CHARACTER EMOTION TEMPLATE (use actual condition names like "Hypervigilance Cascade" or "Trust Erosion Loop" — NOT generic phrases like "high X triggers Y"), Voice register from their Emotion Profile, and Expected stat delta with specific numeric changes and the scene event that causes them.
3. Emotional arcs must show MOVEMENT — stats that stay flat indicate a wasted scene. Every scene should shift at least one stat by 5+ points.
4. The Emotional Layer opening/mid/closing states must reference DIFFERENT stats or different triggers — not the same stat repeating.

CONTEXT:
- Project: {{ $('Extract Seeds').first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Target Chapters: {{ $('Outline Prompts').first().json.target_chapters || 'all' }}
- Prose Jail: {{ $('Universal Config').first().json.prose_jail }}
- Active Profile: {{ $('Universal Config').first().json?.active_profile?.label }}

FORBIDDEN WORDS:
{{ $('Extract Seeds').first().json.forbiddenWords }}

CAST MANIFEST:
{{ $('Extract Seeds').first().json?.characters || '[ERROR: No character data found]' }}

CHARACTER EMOTION TEMPLATE:
{{ $('Universal Config').first().json.character_emotion_full || 'No character emotion template available.' }}

STORY ARC:
{{ $('Extract Seeds').first().json?.storyArc || '[ERROR: No story arc found]' }}

REVISED OUTLINE:
{{ $('Rewrite Outline').first().json.text || $('Outline').first().json.text || '[ERROR: No outline found]' }}

AUTHOR NOTES:
{{ $('Extract Seeds').first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $('Universal Config').first().json?.active_profile?.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each chapter, map the full emotional trajectory: opening emotional state, the moment of highest tension, the emotional shift, and the closing emotional state. Justify each beat with a specific character motivation from CAST MANIFEST: .."
  : "You are in FAST mode (14B). One emotional beat per chapter -- identify the core feeling and whether it lands. Flag only chapters that are emotionally flat or redundant." }}

INSTRUCTIONS:
Perform a full emotional arc audit on the REVISED OUTLINE:
.

Audit Criteria:

1. Emotional Variety: Map the dominant emotion of each chapter (dread, hope, betrayal, wonder, grief, triumph). Flag any 3+ chapter run with the same dominant emotion. Verify at least 5 distinct emotional registers across all TARGET CHAPTERS.

2. Emotional Escalation: Verify emotional intensity increases toward the climax defined in STORY ARC:
. Flag chapters where emotional stakes reset without narrative justification. Verify the midpoint delivers a gut-punch (betrayal, loss, revelation) not just a plot twist.

3. Character Emotional Grounding: For each chapter, identify which character emotional journey drives the reader. Flag chapters where emotional payload comes from plot mechanics rather than character motivation. Cross-reference CAST MANIFEST:
-- does the reaction match their Core Wound?

4. Reader Investment Hooks: Flag chapters ending on a neutral emotional note. Verify chapter hooks create emotional urgency, not just informational curiosity.

5. Emotional Contrast: Flag adjacent chapters failing to shift emotional register. After a dark chapter the next should offer relief or contrast. Verify comedic or tender moments exist between high-tension sequences.

6. Catharsis Points: Verify the climax delivers emotional catharsis proportional to the build-up. Flag any resolution that feels emotionally unearned.

Output Format:
1. Emotional Arc Map (one line per chapter: Ch.1: [WONDER/UNEASE] -- Character discovers the anomaly.)
2. Emotional Flatlines (chapters that are emotionally dead or redundant, with fix suggestions)
3. Variety Score (count of distinct emotions used)
4. Escalation Check (does intensity build to climax? flag unearned dips)
5. Recommended Fixes (actionable: Ch.7 is emotionally flat -- inject [character] reaction to [event] to ground the reader before the Ch.8 pivot.)


CRITICAL: ALL character names in your output MUST come from CAST MANIFEST above. Do NOT invent new characters or use names from your training data. Cross-check every name before finalising.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.

Hard Constraints:
- Do NOT rewrite the outline. Output analysis and recommendations only.
- Every recommendation must reference a specific character from CAST MANIFEST:
and a beat from STORY ARC:
.
- Never use any word from FORBIDDEN WORDS:
in your output.
- Follow PROFILE INSTRUCTION:
for depth level.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS. Do NOT invent stat names, emotion names, or voice registers not listed there.

`,
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: 'ab1f324f-8254-400d-ab04-d3a708eb5712',
        name: 'Science Plot Enrichment',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [-720, 1328],
        onError: 'continueRegularOutput',
    })
    SciencePlotEnrichment = {
        notice: '',
        promptType: 'define',
        text: `=You are a hard-science consultant for fiction. You weave real scientific concepts into story outlines so they serve the plot -- never as decoration.

CONTEXT:
- Project: {{ $('Extract Seeds').first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Target Chapters: {{ $('Outline Prompts').first().json.target_chapters || 'all' }}
- Prose Jail: {{ $('Universal Config').first().json.prose_jail }}
- Active Profile: {{ $('Universal Config').first().json?.active_profile?.label }}

FORBIDDEN WORDS:
{{ $('Extract Seeds').first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $('Extract Seeds').first().json.dossier }}

WORLDBUILDING:
{{ $('Extract Seeds').first().json?.worldbuilding || '[ERROR: No worldbuilding data found]' }}

STORY ARC:
{{ $('Extract Seeds').first().json?.storyArc || '[ERROR: No story arc found]' }}

CAST MANIFEST:
{{ $('Extract Seeds').first().json?.characters || '[ERROR: No character data found]' }}

CURRENT OUTLINE:
{{ $('Rewrite Outline').first().json.text || $('Outline').first().json.text || '[ERROR: No outline found]' }}

EMOTIONAL ANALYSIS:
{{ $('Emotional Check').first().json.text || '[No emotional analysis available]' }}

AUTHOR NOTES:
{{ $('Extract Seeds').first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $('Universal Config').first().json?.active_profile?.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each science integration, explain the real physics in one sentence, then show exactly how it creates conflict, stakes, or wonder in the chapter. Every concept must serve a character emotional arc from EMOTIONAL ANALYSIS: .."
  : "You are in FAST mode (14B). One science enrichment per chapter maximum. State the concept, the chapter, and the plot payoff in one bullet." }}

SCIENCE TOOLBOX:
Use ONLY concepts from these domains where they serve the story organically:

Cosmology and Astrophysics: The Big Bang, cosmic inflation, dark energy, dark matter, black holes (event horizons, spaghettification, Hawking radiation), neutron stars, pulsars, magnetars, cosmic microwave background, redshift.

Relativity and Spacetime: Time dilation (gravitational and velocity-based), length contraction, relativistic mass, twins paradox, light cones, causality, gravitational waves, frame dragging.

Quantum Mechanics: Superposition, wave function collapse, measurement problem, quantum entanglement, quantum tunneling, uncertainty principle, Schrodinger cat (as metaphor for narrative stakes), decoherence, many-worlds interpretation.

Thermodynamics and Entropy: Heat death of the universe, entropy arrow of time, Maxwell demon, information thermodynamics, phase transitions, critical points.

Biology and Evolution: Natural selection, genetic drift, epigenetics, extremophiles, panspermia, CRISPR, gene drives, synthetic biology, emergent behaviour, swarm intelligence.

Information and Computation: Quantum computing, chaos theory, butterfly effect, strange attractors, simulation hypothesis, information paradox, Turing completeness, halting problem.

INSTRUCTIONS:
Enrich the CURRENT OUTLINE:
by weaving real scientific concepts into chapter beats where they SERVE THE PLOT. Every science element must create conflict, deepen stakes, enable a plot turn, or illuminate a character emotional state.

Core Rules:
1. Plot-First Integration: Each concept must answer -- what plot problem does this solve or create? If it does not create conflict, stakes, or wonder, do not include it.
2. One Concept Per Chapter Maximum: Pick the single best-fitting concept. Not every chapter needs science.
3. Accuracy Requirement: Every concept must be factually accurate. Simplify for clarity but never misrepresent the science. If you bend a rule flag it: [SCIENCE LICENSE: real physics says X, story uses Y for Z reason].
4. World Consistency: Cross-reference against WORLDBUILDING:
and DOSSIER SOURCE:
. Science must be compatible with established world mechanics.
5. Character Connection: Link each concept to a character emotional arc from EMOTIONAL ANALYSIS:
or CAST MANIFEST:
. Time dilation is not just physics -- it is a character experiencing the grief of lost years.
6. Author Notes Compliance: If AUTHOR NOTES:
specify a genre or tone, ensure the science fits.

Output Format -- reproduce all TARGET CHAPTERS with enrichments woven in:
### CHAPTER [NUMBER]: [Title]
[Original chapter beats with science concepts integrated naturally. Bold the science concept on first mention.]


CRITICAL: ALL character names in your output MUST come from CAST MANIFEST above. Do NOT invent new characters or use names from your training data. Cross-check every name before finalising.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.

Hard Constraints:
- Output the ENRICHED OUTLINE ONLY. No preamble, no commentary, no meta-text.
- Preserve all chapter structure and beats from CURRENT OUTLINE:
.
- Do not add new chapters or remove existing ones.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.
- If a chapter does not benefit from science enrichment, reproduce it unchanged.
- Follow PROFILE INSTRUCTION:
for depth level.
- All character names, locations, world mechanics, and faction names must come exclusively from DOSSIER SOURCE:
, CAST MANIFEST:
, or WORLDBUILDING:
. Do NOT add new characters, new events, new locations, or new world mechanics to accommodate a science concept -- integrate every science concept into EXISTING beats only.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS. Do NOT invent stat names, emotion names, or voice registers not listed there.

`,
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: '3146934e-02ff-4950-a26a-88ac337f5dec',
        name: 'Continuity Checker',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [-432, 1328],
        onError: 'continueRegularOutput',
    })
    ContinuityChecker = {
        notice: '',
        promptType: 'define',
        text: `=You are a professional continuity editor for novel outlines. Your mission is to audit the enriched outline for timeline contradictions, character behaviour inconsistencies, and world-rule violations.

CONTEXT:
- Project: {{ $('Extract Seeds').first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Target Chapters: {{ $('Outline Prompts').first().json.target_chapters || 'all' }}
- Prose Jail: {{ $('Universal Config').first().json.prose_jail }}
- Active Profile: {{ $('Universal Config').first().json?.active_profile?.label }}

FORBIDDEN WORDS:
{{ $('Extract Seeds').first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $('Extract Seeds').first().json.dossier }}

CAST MANIFEST:
{{ $('Extract Seeds').first().json?.characters || '[ERROR: No character data found]' }}

CHARACTER EMOTION TEMPLATE:
{{ $('Universal Config').first().json.character_emotion_full || 'No character emotion template available.' }}

BACKSTORY DOCTRINE:
{{ $('Universal Config').first().json.backstory_full || 'No backstory doctrine available.' }}

STORY ARC TEMPLATE:
{{ $('Universal Config').first().json.arc_full || 'No story arc template available.' }}

CURRENT OUTLINE:
{{ $('Science Plot Enrichment').first().json.text || $('Rewrite Outline').first().json.text || '[ERROR: No outline found]' }}

AUTHOR NOTES:
{{ $('Extract Seeds').first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $('Universal Config').first().json?.active_profile?.label === "heavy"
  ? "You are in HIGH DEPTH mode. For each continuity issue, trace the full causal chain -- which earlier beat creates the contradiction, and what is the minimum-change fix?"
  : "You are in FAST mode. List issues as bullets: Chapter X -- issue -- fix. No extended analysis." }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

INSTRUCTIONS:
Audit CURRENT OUTLINE:
for these continuity classes:

1. Timeline Integrity: Do chapter events follow a consistent chronology? Flag any chapter where the stated time since a previous event contradicts an earlier chapter.
2. Character Consistency: Does each character behave according to their Core Motivation from CAST MANIFEST:
? Flag any chapter where a character acts without a motivation anchor.
3. World-Rule Compliance: Does each TARGET CHAPTER respect the [economy] and [tech_magic] rules from DOSSIER SOURCE:
? Flag any chapter that breaks an established world mechanic.
4. Cause-and-Effect Chains: Does every major plot event have a clear cause in a prior chapter? Flag any event that arrives without setup.
5. Object and Resource Tracking: If a character uses an object, power, or resource, was it established in an earlier chapter? Flag any unexplained asset.
6. Emotion Profile Continuity: For each major character, does their emotional behaviour across chapters remain consistent with their Emotion Profile from CAST MANIFEST:
? Flag any chapter where a character acts at a stat level radically different from their established profile (e.g. a character whose §1 Core Stat level would preclude that behaviour -- exhibiting the opposite extreme without a bridge event). Reference the specific Emotion Profile stat affected and the specific chapter beat.

Output Format:
### Continuity Audit: {{ $('Extract Seeds').first().json.title }}

**Overall Verdict:** [PASS / MINOR ISSUES / MAJOR ISSUES]

**Issues Found:**
[Bullet list: Chapter X -- Issue Type -- Description -- Recommended Fix]

**Continuity-Safe Outline:**
[Reproduce the FULL outline from CURRENT OUTLINE:
with all issues resolved inline. Bold any changed text.]


CRITICAL: ALL character names in your output MUST come from CAST MANIFEST above. Do NOT invent new characters or use names from your training data. Cross-check every name before finalising.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.

Hard Constraints:
- Output the full corrected outline for ONLY the TARGET CHAPTERS. Do not truncate, and do not add chapters outside the target range.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.
- Follow PROFILE INSTRUCTION:
for depth level.
- When correcting continuity issues, make only the minimum change required to resolve the stated violation. Do NOT add new characters, new plot events, new locations, or new world mechanics not already present in CURRENT OUTLINE:
, DOSSIER SOURCE:
, or CAST MANIFEST:
.

- DOCTRINE COMPLIANCE: When checking backstory consistency, verify conformance with BACKSTORY DOCTRINE:
. If empty, skip this constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: 'df7675a3-79ce-4916-8685-a6d656806b79',
        name: 'Scene Breakdown',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [-144, 1328],
        onError: 'continueRegularOutput',
    })
    SceneBreakdown = {
        notice: '',
        promptType: 'define',
        text: `=You are a scene architect for novel outlines. Your task is to decompose each chapter into its discrete scenes.

CRITICAL RULES:
1. Each chapter MUST have 2-4 scenes. Each scene MUST use a DIFFERENT named location from WORLDBUILDING — never repeat the same location in consecutive scenes.
2. Scene word budgets MUST sum to approximately the WORDS PER CHAPTER target. If target is 800, scenes might be 250+300+250. If target is 1200, scenes might be 400+400+400.
3. Every character present in a scene must be listed by their EXACT NAME from CAST MANIFEST — no "Security Protocols (AI)" or invented entities.
4. Each scene must have a SPECIFIC goal tied to a character motivation from CAST MANIFEST, and a SPECIFIC conflict rooted in a world mechanic from WORLDBUILDING.
5. Pacing tags must VARY across scenes — never use the same tag twice in a row.

CONTEXT:
- Project: {{ $('Extract Seeds').first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Target Chapters: {{ $('Outline Prompts').first().json.target_chapters || 'all' }}
- Prose Jail: {{ $('Universal Config').first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $('Extract Seeds').first().json.forbiddenWords }}

CAST MANIFEST:
{{ $('Extract Seeds').first().json?.characters || '[ERROR: No character data found]' }}

CONTINUITY CHECKED OUTLINE:
{{ $('Continuity Checker').first().json.text || $('Science Plot Enrichment').first().json.text || '[ERROR: No outline found]' }}

AUTHOR NOTES:
{{ $('Extract Seeds').first().json.authorNotes || "No author notes provided." }}

CHARACTER EMOTION TEMPLATE:
{{ $('Universal Config').first().json.character_emotion_full || 'No character emotion template available.' }}

LOCATION DOCTRINE:
{{ $('Universal Config').first().json.location_full || 'No location doctrine available.' }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

PROFILE INSTRUCTION:
{{ $('Universal Config').first().json?.active_profile?.label === "heavy"
  ? "You are in HIGH DEPTH mode. For each scene, include: Setting (specific location from worldbuilding), Characters Present (from cast manifest), Scene Goal (what the POV character wants), Conflict (what opposes them), Beat Sequence (3-5 micro-beats), Scene Exit (how the scene ends and why it transitions), Character Emotion State (§1 active stats, §3 cascade conditions, §8 voice register at scene start and end)."
  : "You are in FAST mode. For each scene: Location, Characters, Goal, Conflict, Exit Hook, Emotion State (1 line: dominant stat + voice register). One line each." }}

INSTRUCTIONS:
For each chapter in CONTINUITY CHECKED OUTLINE:
, identify and document 2-5 discrete scenes.

Definition of a Scene: A scene is a continuous unit of action in a single location with a clear goal, conflict, and outcome. Scene changes are triggered by: location change, significant time jump, POV shift, or tonal shift.

Core Rules:
1. Every scene must have a clear goal for the focal character.
2. Every scene must have at least one source of conflict (internal, interpersonal, or systemic).
3. Scene exits must create momentum into the next scene or chapter.
4. No scene is purely expository -- information must emerge through action or conflict.
5. Use character names from CAST MANIFEST:
and locations from the worldbuilding data.

Required Output Format:
### CHAPTER [NUMBER]: [Title]
**Scene [N]:**
- Setting: [specific location from WORLDBUILDING]
- Characters: [names from cast manifest]
- Goal: [what the focal character wants in this scene]
- Conflict: [what opposes the goal]
- Beat Sequence: [2-4 micro-beats]
- Exit Hook: [how the scene ends / what propels us forward]
- Word Budget: [estimated word count for this scene, e.g. 800-1200]
- Pacing: [action / tension / reflection / transition]
- Scene Weight: [major / supporting / transitional]
- Character Emotion State: For each character present, note their dominant active stat (Â§1), any triggered cascade condition (Â§3), and Â§8 internal voice register at scene start vs end.

[Repeat for each scene in the chapter.]


CRITICAL: ALL character names in your output MUST come from CAST MANIFEST above. Do NOT invent new characters or use names from your training data. Cross-check every name before finalising.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.

Hard Constraints:
- Process ONLY the chapters listed in TARGET CHAPTERS above. YOUR OUTPUT MUST CONTAIN EXACTLY the same number of chapter sections as entries in TARGET CHAPTERS. Count them before finishing.
- Scene word budgets in each chapter MUST sum to approximately \${wordsPerChapter} words total. Do not add, skip, or reorder chapters outside that list.
- Do not invent characters or locations not present in the outline or cast manifest.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.
- Follow PROFILE INSTRUCTION:
for depth level.

- DOCTRINE COMPLIANCE: Every scene setting and location detail must conform to LOCATION DOCTRINE:
. If empty, skip this constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: 'a9d099f7-e59b-4d4f-b426-22de8331b944',
        name: 'Foreshadowing Planner',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [144, 1328],
        onError: 'continueRegularOutput',
    })
    ForeshadowingPlanner = {
        notice: '',
        promptType: 'define',
        text: `=You are a foreshadowing architect for novel outlines. Your mission is to plant subtle seeds in early chapters that pay off in later ones.

CONTEXT:
- Project: {{ $('Extract Seeds').first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Target Chapters: {{ $('Outline Prompts').first().json.target_chapters || 'all' }}
- Prose Jail: {{ $('Universal Config').first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $('Extract Seeds').first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $('Extract Seeds').first().json.dossier }}

CAST MANIFEST:
{{ $('Extract Seeds').first().json?.characters || '[ERROR: No character data found]' }}

CONTINUITY CHECKED OUTLINE:
{{ $('Continuity Checker').first().json.text || $('Science Plot Enrichment').first().json.text || '[ERROR: No outline found]' }}

SCENE BREAKDOWN:
{{ $('Scene Breakdown').first().json.text || '[No scene breakdown available]' }}

CHARACTER EMOTION TEMPLATE:
{{ $('Universal Config').first().json.character_emotion_full || 'No character emotion template available.' }}

CONFLICT DOCTRINE:
{{ $('Universal Config').first().json.conflict_full || 'No conflict doctrine available.' }}

BACKSTORY DOCTRINE:
{{ $('Universal Config').first().json.backstory_full || 'No backstory doctrine available.' }}

AUTHOR NOTES:
{{ $('Extract Seeds').first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $('Universal Config').first().json?.active_profile?.label === "heavy"
  ? "You are in HIGH DEPTH mode. For each foreshadowing beat, specify: the exact scene from SCENE BREAKDOWN: where the seed should be planted, the precise object/detail/behaviour to introduce, WHY it will not read as suspicious to a first-time reader, and the payoff chapter/scene where it lands."
  : "You are in FAST mode. Seed chapter -- seed description -- payoff chapter. One line per seed." }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

INSTRUCTIONS:
Analyse CONTINUITY CHECKED OUTLINE:
and identify the 5-10 most impactful revelations, reversals, or emotional payoffs. For each, design 1-2 foreshadowing seeds to plant in earlier chapters.

ECHO PATTERN SEEDS (in addition to plot foreshadowing):
For each major theme from DOSSIER SOURCE, identify one recurring image, phrase, or sensory detail that echoes across at least 3 chapters -- appearing in different contexts to build thematic resonance without being plot-functional.
Example: If the theme is "loss of identity" -- a mirror appearing in Ch 2 (clear reflection), Ch 8 (cracked mirror), Ch 14 (no reflection at all).
Output echo patterns in this format:
**Echo: [Theme]** -- [image/detail] -- appears in Ch [N] as [context], Ch [N] as [context], Ch [N] as [context].

Core Rules:
1. Invisible on First Read: Every seed must feel like ordinary detail to a first-time reader -- only retrospectively significant.
2. Anchored to Existing Scenes: Seeds must be planted in scenes already present in SCENE BREAKDOWN:
or the outline. Do not invent new scenes.
3. Thematic Resonance: Prefer seeds that also reinforce the thematic question from DOSSIER SOURCE:
.
4. Character-Integrated: Where possible, tie the seed to a character behaviour pattern from CAST MANIFEST:
.
5. No Spoilers in Plant: The seed text must not directly name or hint at the payoff.
6. Emotional Cascade Seeds: For each character with a §3 Cascade Failure condition listed in their Emotion Profile (from CAST MANIFEST:
), design at least one foreshadowing seed that plants the precondition stat pressure in an early chapter -- the seed should show the specific §1 Core Stat (per EMOTION SYSTEM GUARDRAILS:
) being eroded by a world mechanism, so the eventual cascade felt inevitable in retrospect.

Required Output Format:
### Foreshadowing Plan: {{ $('Extract Seeds').first().json.title }}

**Payoff:** [Chapter X -- brief description of the revelation/reversal]
- Seed 1: Chapter [N] -- [Scene N if available] -- [Specific object, detail, or behaviour to introduce] -- [Why it reads as innocent]
- Seed 2 (optional): Chapter [N] -- [Scene N if available] -- [Description]

[Repeat for each payoff event.]

### Modified Chapter Beats
[List only the chapters receiving seeds, with the seed beat inserted into the existing outline in [FORESHADOWING: text] markers.]


CRITICAL: ALL character names in your output MUST come from CAST MANIFEST above. Do NOT invent new characters or use names from your training data. Cross-check every name before finalising.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.

Hard Constraints:
- Plant seeds only in chapters earlier than the payoff chapter.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.
- Follow PROFILE INSTRUCTION:
for depth level.

- DOCTRINE COMPLIANCE: Every foreshadowing seed must conform to CONFLICT DOCTRINE:
and BACKSTORY DOCTRINE:
. If either is empty, skip that constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: '6785ef22-ad46-4865-8c2c-5bcddc7f5bdf',
        name: 'POV Planner',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [416, 1328],
        onError: 'continueRegularOutput',
    })
    PovPlanner = {
        notice: '',
        promptType: 'define',
        text: `=You are a narrative perspective specialist for novel outlines. Your task is to assign Point of View, narrative distance, and tonal register for each TARGET CHAPTER.

CONTEXT:
- Project: {{ $('Extract Seeds').first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Target Chapters: {{ $('Outline Prompts').first().json.target_chapters || 'all' }}
- Prose Jail: {{ $('Universal Config').first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $('Extract Seeds').first().json.forbiddenWords }}

CAST MANIFEST:
{{ $('Extract Seeds').first().json?.characters || '[ERROR: No character data found]' }}

CONTINUITY CHECKED OUTLINE:
{{ $('Continuity Checker').first().json.text || $('Science Plot Enrichment').first().json.text || '[ERROR: No outline found]' }}

SCENE BREAKDOWN:
{{ $('Scene Breakdown').first().json.text || '[No scene breakdown available]' }}

CHARACTER EMOTION TEMPLATE:
{{ $('Universal Config').first().json.character_emotion_full || 'No character emotion template available.' }}

VOICE DOCTRINE:
{{ $('Universal Config').first().json.voice_full || 'No voice doctrine available.' }}

EMOTIONAL ANALYSIS:
{{ $('Emotional Check').first().json.text || '[No emotional analysis available]' }}

AUTHOR NOTES:
{{ $('Extract Seeds').first().json.authorNotes || "No author notes provided." }}

DIALOGUE VOICE TEMPLATE:
{{ $('Universal Config').first().json.dialogue_full || 'No dialogue template available.' }}

PROFILE INSTRUCTION:
{{ $('Universal Config').first().json?.active_profile?.label === "heavy"
  ? "You are in HIGH DEPTH mode. For each chapter, justify: WHY this POV character maximises dramatic irony or emotional impact, HOW the narrative distance serves the scene tension, and what tonal shift (if any) occurs mid-chapter."
  : "You are in FAST mode. Chapter N -- POV Character -- Narrative Distance -- Tonal Register -- one-line justification." }}

INSTRUCTIONS:
For every chapter in CONTINUITY CHECKED OUTLINE:
, assign:

1. POV Character: Which character provides the perspective for this chapter? Choose based on: who has the most to lose, who possesses dramatic irony, or who will experience the greatest emotional arc.

2. Narrative Distance: Choose one -- Deep Close (stream of consciousness, raw emotion), Close (thoughts and feelings accessible, some interiority), Medium (observable behaviour and dialogue, limited interiority), Distant (external action only, cinematic).

3. Tonal Register: Choose one -- Tense/Thriller, Contemplative/Reflective, Satirical/Dark Comedy, Tragic/Elegiac, Propulsive/Action, Intimate/Lyrical. The tone must match the emotional arc from EMOTIONAL ANALYSIS:
.

4. Narrative Device (optional): Flag if the chapter benefits from -- Dramatic Irony (reader knows more than POV), Unreliable Narrator (POV misreads situation), Time Dilation (slow-motion key moment), Intercut (alternating storylines).
5. Emotion-Distance Alignment: Cross-reference the POV character's §8 Internal Voice Map register from their Emotion Profile in CAST MANIFEST:
when assigning Narrative Distance. Cross-reference the register-to-distance guidance in §8 of CHARACTER EMOTION TEMPLATE:
. If the template does not specify distance preferences, default to: closer distance for more emotionally intense registers, more distant for flatter registers. Flag any chapter where the assigned distance conflicts with the character's §8 register and justify the override.

Required Output Format:
### POV & Voice Plan: {{ $('Extract Seeds').first().json.title }}

**Chapter [N]: [Title]**
- POV Character: [Name]
- Narrative Distance: [Choice]
- Tonal Register: [Choice]
- Narrative Device: [Choice or None]
- Justification: [One sentence citing the emotional stakes and cast manifest motivation]

[Repeat for each chapter listed in TARGET CHAPTERS only.]


CRITICAL: ALL character names in your output MUST come from CAST MANIFEST above. Do NOT invent new characters or use names from your training data. Cross-check every name before finalising.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.

Hard Constraints:
- Assign a POV for EVERY TARGET CHAPTER. No target chapter left unassigned.
- POV characters must come from CAST MANIFEST:
.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.
- Follow PROFILE INSTRUCTION:
for depth level.

- DOCTRINE COMPLIANCE: POV voice consistency must conform to VOICE DOCTRINE:
. If empty, skip this constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS. Do NOT invent stat names, emotion names, or voice registers not listed there.

`,
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: '6529e048-7ab3-4956-913c-9f291e1c56b3',
        name: 'Dialogue Voice Mapper',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [672, 1328],
        onError: 'continueRegularOutput',
    })
    DialogueVoiceMapper = {
        notice: '',
        promptType: 'define',
        text: `=You are a dialogue architect for novel outlines. Your task is to map character speech patterns and plan key dialogue beats for each TARGET CHAPTER.

CONTEXT:
- Project: {{ $('Extract Seeds').first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Target Chapters: {{ $('Outline Prompts').first().json.target_chapters || 'all' }}
- Prose Jail: {{ $('Universal Config').first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $('Extract Seeds').first().json.forbiddenWords }}

CAST MANIFEST:
{{ $('Extract Seeds').first().json?.characters || '[ERROR: No character data found]' }}

DOSSIER SOURCE:
{{ $('Extract Seeds').first().json.dossier }}

DIALOGUE VOICE TEMPLATE:
{{ $('Universal Config').first().json.dialogue_full || 'No dialogue template available.' }}

CONTINUITY CHECKED OUTLINE:
{{ $('Continuity Checker').first().json.text || $('Science Plot Enrichment').first().json.text || '[ERROR: No outline found]' }}

SCENE BREAKDOWN:
{{ $('Scene Breakdown').first().json.text || '[No scene breakdown available]' }}

POV VOICE PLAN:
{{ $('POV Planner').first().json.text || '[No POV plan available]' }}

AUTHOR NOTES:
{{ $('Extract Seeds').first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $('Universal Config').first().json?.active_profile?.label === "heavy"
  ? "You are in HIGH DEPTH mode. For each chapter, provide a full dialogue blueprint: every speaking character's voice profile (vocabulary level, sentence structure, verbal tics, formality register), the key conversations with emotional subtext, and dialogue-to-narration ratio guidance."
  : "You are in FAST mode. One voice note per character, one key dialogue beat per chapter. Keep it compact." }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

INSTRUCTIONS:
Using DIALOGUE VOICE TEMPLATE as your framework, map the dialogue landscape for each TARGET CHAPTER.

SUBTEXT RULE (CRITICAL): Real dialogue is never about what characters literally say. Every key exchange must have:
- SURFACE: What they SAY (the words)
- SUBTEXT: What they MEAN (the emotion or agenda beneath)
- POWER: Who has control and how it shifts during the exchange

Example of GOOD dialogue mapping:
  Surface: Marcus explains the anomaly's origin
  Subtext: Marcus is testing whether Kai can handle the truth
  Power: Marcus holds information; power shifts to Kai when he deduces the connection

For each chapter, provide:

1. **Speaking Characters:** List every character who speaks in this chapter (from CAST MANIFEST only).
2. **Voice Profiles:** For each speaking character:
   - Vocabulary level (formal / colloquial / technical / street)
   - Sentence structure (short and clipped / flowing and complex / fragmented)
   - Verbal tics or catchphrases (from CAST MANIFEST or DOSSIER SOURCE)
   - Emotional register at scene start vs end (using EMOTION SYSTEM GUARDRAILS vocabulary)
3. **Key Dialogue Beats:**
   - The single most important conversation in this chapter
   - Who initiates, who resists, what's the subtext beneath the surface words
   - How the conversation shifts the power dynamic
4. **Dialogue-to-Narration Ratio:** heavy (60%+) / balanced (30-60%) / narration-heavy (<30%)
5. **Voice Differentiation Notes:** How a reader could identify who is speaking without dialogue tags

Required Output Format:
### CHAPTER [NUMBER]: [Title]
**Speaking Characters:** [list]
**Voice Profiles:**
- [Character]: [vocabulary] / [structure] / [tics] / [emotional arc]
**Key Dialogue Beat:** [who → who, surface topic, subtext]
**Dialogue Ratio:** [heavy/balanced/narration-heavy]
**Voice Differentiation:** [notes]

[Repeat for each TARGET CHAPTER. Each chapter MUST have DISTINCT voice profiles. Characters evolve emotionally and their dialogue must reflect this.]

ANTI-REPETITION: If two chapters have identical Voice Profiles or Key Dialogue Beats, your output is INVALID.

CRITICAL: ALL character names MUST come from CAST MANIFEST. Do NOT invent characters.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.

Hard Constraints:
- Process ONLY the chapters listed in TARGET CHAPTERS above. YOUR OUTPUT MUST CONTAIN EXACTLY the same number of chapter sections as entries in TARGET CHAPTERS. Count them before finishing.
- Do not use any word from FORBIDDEN WORDS or the Prose Jail.
- Follow PROFILE INSTRUCTION for depth level.
`,
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: '9229fc9d-43fa-4522-85c5-b3ced1429140',
        name: 'Ollama Chat Model19',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [672, 1488],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel19 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: 0.6,
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: 'dcb38d32-3f65-4a76-9cdc-8e3482592b29',
        name: 'Theme Weaver',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [928, 1328],
        onError: 'continueRegularOutput',
    })
    ThemeWeaver = {
        notice: '',
        promptType: 'define',
        text: `=You are a thematic analyst for novel outlines. Your task is to thread thematic elements through each TARGET CHAPTER to ensure the novel says something meaningful beneath the surface plot.

CONTEXT:
- Project: {{ $('Extract Seeds').first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Target Chapters: {{ $('Outline Prompts').first().json.target_chapters || 'all' }}
- Prose Jail: {{ $('Universal Config').first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $('Extract Seeds').first().json.forbiddenWords }}

CAST MANIFEST:
{{ $('Extract Seeds').first().json?.characters || '[ERROR: No character data found]' }}

DOSSIER SOURCE:
{{ $('Extract Seeds').first().json.dossier }}

THEMES TEMPLATE:
{{ $('Universal Config').first().json.themes_full || 'No themes template available.' }}

STORY ARC:
{{ $('Universal Config').first().json.arc_full || '[No story arc template]' }}

CONTINUITY CHECKED OUTLINE:
{{ $('Continuity Checker').first().json.text || $('Science Plot Enrichment').first().json.text || '[ERROR: No outline found]' }}

FORESHADOWING PLAN:
{{ $('Foreshadowing Planner').first().json.text || '[No foreshadowing plan available]' }}

DIALOGUE VOICE MAP:
{{ $('Dialogue Voice Mapper').first().json.text || '[No dialogue map available]' }}

AUTHOR NOTES:
{{ $('Extract Seeds').first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $('Universal Config').first().json?.active_profile?.label === "heavy"
  ? "You are in HIGH DEPTH mode. For each chapter, provide a multi-layered thematic analysis: the central thematic question, surface story vs. subtext, recurring motifs and symbols, how the chapter advances the novel's central argument, and thematic connections to other chapters."
  : "You are in FAST mode. One thematic question per chapter, one subtext note, one motif. Keep it actionable." }}

INSTRUCTIONS:
Using THEMES TEMPLATE as your thematic framework and STORY ARC for structural context, analyse and plan the thematic layer for each TARGET CHAPTER.

For each chapter, provide:

1. **Central Thematic Question:** What question about the human condition does this chapter explore? (Derived from THEMES TEMPLATE and DOSSIER SOURCE)
2. **Surface vs. Subtext:** What happens on the surface (plot) vs. what the chapter is really about (theme). Example: "Surface: character negotiates a trade deal. Subtext: the cost of compromising your values for survival."
3. **Recurring Motifs:** Specific images, objects, or sensory details that should recur to build thematic resonance. Track which chapters they first appeared in.
4. **Thematic Progression:** How this chapter advances the novel's central argument. Is the theme being questioned, challenged, reinforced, or subverted?
5. **Thematic Connections:** Which other chapters share thematic DNA with this one? What echoes or contrasts should the ghostwriter be aware of?

Required Output Format:
### CHAPTER [NUMBER]: [Title]
**Thematic Question:** [question]
**Surface:** [plot summary in one line]
**Subtext:** [what it really means]
**Motifs:** [list with origin chapter references]
**Thematic Arc:** [questioning / challenging / reinforcing / subverting]
**Connections:** [chapter numbers and nature of connection]

[Repeat for each TARGET CHAPTER. Each chapter MUST explore a DIFFERENT thematic question. Subtext must be actual analysis, not labels. Motifs must reference specific objects from DOSSIER SOURCE and WORLDBUILDING.]

ANTI-REPETITION: If two chapters have the same Thematic Question or identical Subtext, your output is INVALID.

CRITICAL: ALL character names MUST come from CAST MANIFEST. Do NOT invent characters.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.

Hard Constraints:
- Process ONLY the chapters listed in TARGET CHAPTERS above. YOUR OUTPUT MUST CONTAIN EXACTLY the same number of chapter sections as entries in TARGET CHAPTERS. Count them before finishing.
- Do not use any word from FORBIDDEN WORDS or the Prose Jail.
- Follow PROFILE INSTRUCTION for depth level.
`,
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: '77ca5624-1d6d-4472-bf5f-8251d5a94c99',
        name: 'Ollama Chat Model20',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [928, 1472],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel20 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: 0.7,
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: 'e3931433-9233-4e5f-a8c7-188507505346',
        name: 'Ghostwriter Brief',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [1232, 1328],
        onError: 'continueRegularOutput',
    })
    GhostwriterBrief = {
        notice: '',
        promptType: 'define',
        text: `=You are a master ghostwriter coordinator. Your task is to synthesise all outline enrichments into a definitive per-chapter writing brief that a ghostwriter can execute immediately.

CONTEXT:
- Project: {{ $('Extract Seeds').first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Target Chapters: {{ $('Outline Prompts').first().json.target_chapters || 'all' }}
- Prose Jail: {{ $('Universal Config').first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $('Extract Seeds').first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $('Extract Seeds').first().json.dossier }}

CAST MANIFEST:
{{ $('Extract Seeds').first().json?.characters || '[ERROR: No character data found]' }}

WORLDBUILDING:
{{ $('Extract Seeds').first().json?.worldbuilding || '[ERROR: No worldbuilding data]' }}

CONTINUITY CHECKED OUTLINE:
{{ $('Continuity Checker').first().json.text || $('Science Plot Enrichment').first().json.text || '[ERROR: No outline found]' }}

SCENE BREAKDOWN:
{{ $('Scene Breakdown').first().json.text || '[No scene breakdown available]' }}

FORESHADOWING PLAN:
{{ $('Foreshadowing Planner').first().json.text || '[No foreshadowing available]' }}

POV VOICE PLAN:
{{ $('POV Planner').first().json.text || '[No POV plan available]' }}

DIALOGUE VOICE MAP:
{{ $('Dialogue Voice Mapper').first().json.text || '[No dialogue voice map available]' }}

THEME & SUBTEXT PLAN:
{{ $('Theme Weaver').first().json.text || '[No theme plan available]' }}

EMOTIONAL ANALYSIS:
{{ $('Emotional Check').first().json.text || '[No emotional analysis available]' }}

CHARACTER EMOTION TEMPLATE:
{{ $('Extract Seeds').first().json?.templates?.character_emotion || $('Universal Config').first().json?.character_emotion_full || 'No character emotion template available.' }}

VOICE DOCTRINE:
{{ $('Universal Config').first().json.voice_full || 'No voice doctrine available.' }}

LOCATION DOCTRINE:
{{ $('Universal Config').first().json.location_full || 'No location doctrine available.' }}

AUTHOR NOTES:
{{ $('Extract Seeds').first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $('Universal Config').first().json?.active_profile?.label === "heavy"
  ? "You are in HIGH DEPTH mode. For each chapter brief add: Opening Hook Instruction (how to start the scene with maximum tension), Sensory Anchors (2-3 specific sensory details from the worldbuilding), Subtext Directive (the hidden emotional current beneath the surface action), Closing Beat (exact emotional note to end on), and Character Emotion Header (per-character §1 stat snapshot, any active §3 cascade, §8 voice register for the chapter)."
  : "You are in FAST mode. Generate compact briefs. Each section is one line maximum. Include a one-line Character Emotion State per chapter (dominant stat + voice register). Prioritise actionability over completeness." }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

INSTRUCTIONS:
Synthesize all enrichment layers into a definitive GHOSTWRITER BRIEF for each TARGET CHAPTER. This document is the single source of truth for WF3 (chapter writing). It must be self-contained.

For each chapter compile (synthesising from all available enrichment layers including DIALOGUE VOICE MAP and THEME & SUBTEXT PLAN):

Use this EXACT format for each chapter. Every section is MANDATORY:

### CHAPTER [N]: [Title]

#### Structural Layer
- Plot beats in order (from CONTINUITY CHECKED OUTLINE)
- Characters present with their ROLES
- Locations (NAMED from WORLDBUILDING)

#### Scene Layer
For each scene:
- **Scene [N]: [Scene Title]**
  - Location: [NAMED location from WORLDBUILDING]
  - Characters Present: [from CAST MANIFEST]
  - Goal: [what the POV character wants]
  - Conflict: [what opposes them, rooted in world mechanics]
  - Exit Hook: [how scene ends to pull reader into next]
  - Word Budget: [number] words
  - Pacing Tag: [Action/Tension/Reflection/Transition — vary across scenes]

#### Foreshadowing Layer
- Seeds to plant: [PLANT] tag with target payoff chapter
- Seeds to pay off: [PAYOFF] tag referencing original plant chapter

#### Character Voice Cards
For EACH character who appears in this chapter:
- **[Name]**: Vocabulary level (formal/colloquial/technical/street) | Sentence structure (clipped/flowing/fragmented) | Verbal tics or catchphrases | Emotional register at start vs end | How to identify them WITHOUT dialogue tags
- Example line: [One sample dialogue line that captures their voice]

#### Voice Layer
- POV Character | Narrative Distance (close/medium/distant) | Tonal Register | Narrative Device (unique per chapter)

#### Dialogue Voice Layer
- Dialogue-to-Narration Ratio: heavy (60%+) / balanced (30-60%) / narration-heavy (<30%)
- Key Exchange: Who initiates, who resists, what's the subtext BENEATH the surface words
- Power Dynamic Shift: How the conversation changes who has control

#### Thematic Layer
- Thematic Question (UNIQUE per chapter — never repeat across chapters)
- Surface: what happens on the plot level
- Subtext: what the scene is REALLY about emotionally/philosophically
- Motifs: specific objects/images that carry thematic weight
- Thematic Arc: Questioning / Challenging / Deepening / Resolving

#### Character Emotion Layer
For EVERY character present in ANY scene (not just POV):
- **[Name]**: Opening stats (§1: at least 2 named stats with numeric values) | Active cascade conditions (§3: use EXACT condition names from CHARACTER EMOTION TEMPLATE) | Voice register (§8) | Expected stat delta by chapter end with triggering event

#### Emotional Layer
- Opening state: [stat + trigger]
- Mid-chapter shift: [different stat + trigger]
- Closing state: [stat + emotion]
- Reader Emotion Target: [what the reader should FEEL]

#### Prose Directives
- Forbidden Words: [list from PROSE JAIL]
- Show-Don't-Tell Rules:
  * NEVER write "[Character] felt [emotion]" — instead describe the PHYSICAL manifestation
  * Replace "Kai felt anxious" → "Kai's fingers drummed the console, his jaw tight"
  * Replace "Marcus was angry" → "Marcus's voice dropped to a whisper, each word bitten off"
  * Internal thoughts should reveal emotion through WHAT the character notices, not what they label
- Sensory Anchors: 2-3 specific sensory details from WORLDBUILDING for this chapter's locations
- Author Notes: [any special instructions for this chapter]

#### Handoff to Next Chapter
- Open threads: [unresolved plot questions]
- Character positions: [where each character physically is]
- Knowledge states: [what each character knows/doesn't know]
- Time position: [time of day, elapsed time]
- Props and McGuffins: [objects that must carry forward]
- Emotional carryover: [unresolved feelings that bleed into next chapter]
- Setup for next chapter: [one sentence describing what Chapter N+1 should open with]

Required Output Format:
---
## CHAPTER [NUMBER]: [Title]

### Structural Layer
[Plot beats in order. MANDATORY GROUNDING RULES:
1. Every location must be a NAMED place from WORLDBUILDING (e.g., "The Resonance Chamber in the Axiom Complex" not "a room in the facility")
2. Every conflict must reference a specific world mechanic/rule from DOSSIER SOURCE (e.g., "the quantum entanglement limit of 3 concurrent links" not "advanced technology")
3. Every character action must cite their specific Core Motivation from CAST MANIFEST
4. Generic descriptions ("a facility", "a corridor", "a lab", "a forest") will cause the brief to be REJECTED]

### Scene Layer
[List EACH SCENE as a SEPARATE numbered entry (e.g., Scene 1, Scene 2, Scene 3). Each chapter should have 2-4 scenes matching the beats in Structural Layer. Per scene entry: specific NAMED location from WORLDBUILDING (not generic), characters present from CAST MANIFEST, concrete goal tied to character motivation, conflict rooted in a specific world mechanic from DOSSIER SOURCE, word budget estimate, pacing tag (action/tension/reflection/transition)]

### Foreshadowing Layer
[MINIMUM 2 entries per chapter. For each:
- [PLANT]: Name the EXACT object/detail (from WORLDBUILDING or DOSSIER SOURCE, not invented), the specific scene and character action that plants it, why it reads as natural/innocuous in context, and the target payoff chapter.
- [PAYOFF]: Reference the exact chapter where the seed was planted, the original plant description, and how it now resolves or escalates.
Generic foreshadowing like "hints at future conflicts" is INVALID — be concrete.]

### Voice Layer
[POV character name, narrative distance (intimate/close/middle/distant), tonal register specific to this chapter, narrative device (choose from: unreliable narration, epistolary fragments, stream of consciousness, cinematic cuts, parallel timelines, sensory immersion, dramatic irony, retrospective reflection). MUST use a DIFFERENT narrative device for each chapter — "Internal monologue" for every chapter is INVALID.]

### Dialogue Voice Layer
[per-character speech patterns from DIALOGUE VOICE MAP, key dialogue beats, dialogue ratio]

### Thematic Layer
[From THEME & SUBTEXT PLAN:
- Thematic Question: a question about the human condition (NOT a plot question)
- Surface: one-line plot summary
- Subtext: what the chapter MEANS thematically (must be DIFFERENT from the surface — "she struggles with X" is NOT subtext, it is plot restated. Real subtext example: "Surface: Eva negotiates a trade deal. Subtext: the impossibility of maintaining ethical purity when survival depends on compromise.")
- Motifs: specific objects/images from WORLDBUILDING that carry symbolic weight, with origin chapter
- Thematic Arc: questioning / challenging / reinforcing / subverting]

### Dialogue Map
- Speaking characters: [names in order of dialogue screen-time]
- Dialogue ratio: [heavy (60%+) / balanced (30-60%) / narration-heavy (less than 30%)]
- Key exchange: [the single most important dialogue beat -- who says what to whom about what]

### Character Emotion Layer
[For EACH character present, provide UNIQUE values based on their Emotion Profile in CAST MANIFEST.
ANTI-FORMULA RULES:
- Stats must come from the actual stat names in EMOTION SYSTEM GUARDRAILS, not invented ones.
- The delta pattern MUST VARY: some chapters should show Security rising, others falling. Competence is not the only stat that changes.
- Reference at least 2 different stats per character per chapter (not just Security and Competence).
- Cascade conditions must reference specific triggers from the character's Emotion Profile, not generic "High X triggers Y".]
- [Character Name]: Opening stat snapshot (§1), active cascade conditions (§3), voice register (§8), and expected stat delta by scene end]

### Emotional Layer
[THREE distinct beats:
- Opening state: [stat + value] triggered by [specific prior event]
- Mid-chapter shift: [new stat + value] triggered by [NAME THE SPECIFIC SCENE AND ACTION that causes the shift]
- Closing state: [stat + value] and what unresolved tension carries forward
The arc shape must VARY: not every chapter goes "confusion → understanding." Use different patterns: hope → betrayal, calm → chaos, resolve → doubt, anger → compassion.
Reader emotion target: the specific feeling the reader should carry into the next chapter.]

### Prose Directives
[Chapter-SPECIFIC constraints: which forbidden words are highest risk for this chapter, which prose jail rules apply to this chapter's tone, any author notes for this chapter. Do NOT copy-paste identical directives across chapters.]

### Handoff to Next Chapter
- Open threads: [unresolved plot or character threads the next chapter MUST address]
- Character positions: [where each character physically is at chapter end]
- Knowledge states: [what each character knows or has learned by chapter end]
- Time position: [when this chapter ends relative to story timeline]
- Props and McGuffins: [any objects introduced, moved, or used in this chapter]
- Emotional carryover: [dominant unresolved emotion each POV character carries into next chapter]
---

[Repeat the full block for each chapter listed in TARGET CHAPTERS only.]

---
{{ $('Outline Prompts').first().json.appendix_block }}

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.

PRIOR CHAPTER BRIEFS (reference for continuity, handoff, and foreshadowing):
{{ $getWorkflowStaticData('global').accumulatedBriefs || 'First chapter -- no prior context.' }}

FINAL SELF-CHECK (complete before outputting):
Before you finish, verify your output passes ALL of these:
□ Every location is a NAMED place from WORLDBUILDING (no generic "facility" or "room")
□ Every character name appears in CAST MANIFEST (no "Mysterious Figure" or invented names)
□ Each Scene Layer has 2-4 numbered scenes with DIFFERENT locations
□ No ### Dialogue Map section exists (only ### Dialogue Voice Layer)
□ The total number of chapter sections equals the number of TARGET CHAPTERS
□ Character Emotion Layer includes EVERY character present in ANY scene (not just POV)
□ Each character has at least 2 different stat names with specific numeric values
□ Cascade conditions reference specific rules from CHARACTER EMOTION TEMPLATE (use actual condition names, NOT generic "high X triggers Y")
□ Scene word budgets sum to approximately the WORDS PER CHAPTER target
□ FORBIDDEN WORD SCAN: Re-read your entire output — if ANY word from PROSE JAIL or FORBIDDEN WORDS appears in your text, REMOVE IT NOW. Common violations: "facility," "lab," "room," "mysterious," "unveiled"
□ Handoff section includes: open threads, character positions, knowledge states, time position, props, emotional carryover
If ANY check fails, revise before outputting.

Hard Constraints:
- Include ONLY the chapters listed in TARGET CHAPTERS above. Do NOT add chapters outside that list. This is a complete production document for the selected chapter range.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.
- Every piece of information must trace to one of the input sources -- do not invent.
- Follow PROFILE INSTRUCTION:
for depth level.

BANNED SECTIONS:
- DO NOT generate a ### Dialogue Map section. That section is DEPRECATED. All dialogue data belongs in ### Dialogue Voice Layer ONLY. If your output contains "### Dialogue Map", it is INVALID.

ANTI-REPETITION RULES (MANDATORY):
- Each chapter MUST have DIFFERENT emotional arcs, stat values, dialogue ratios, and thematic questions.
- If you find yourself copying text from one chapter to another, STOP and rethink.
- Every section must contain chapter-SPECIFIC content. Generic filler is a BLOCKING error.
- Scenes must name SPECIFIC locations and characters from the input sources.

PROSE QUALITY MANDATE (for Workflow 3 consumption):
- The brief must give the writer LLM everything needed to write WITHOUT referring to the dossier.
- Character Voice Cards are the most critical section for prose quality — without them, all characters sound identical.
- Show-Don't-Tell rules are MANDATORY in every chapter brief. The writer LLM will follow these literally.
- Sensory Anchors ground the prose in the physical world — pick details that are UNIQUE to each location.
- The Handoff section is critical for multi-chapter continuity — be SPECIFIC about character knowledge states.

ANTI-HALLUCINATION RULES (MANDATORY):
- EVERY character name in this brief MUST appear in CAST MANIFEST. Cross-check before finalising.
- Do NOT invent new characters. If CAST MANIFEST has 5 characters, use ONLY those 5.
- Do NOT use generic character names from your training data (Ava, Luna, Kira, Eli, etc.).
- Every location must come from WORLDBUILDING. Every plot beat from CONTINUITY CHECKED OUTLINE.
- Every faction from WORLDBUILDING. Every foreshadowing seed from FORESHADOWING PLAN.
- If an input source is empty or errored, mark that section with [DATA MISSING: source name].
- Do not import terminology, proper nouns, or world mechanics from your training data.
- This brief must contain ONLY elements from THIS story's documents.

- DOCTRINE COMPLIANCE: Voice/tone guidance and setting details must conform to VOICE DOCTRINE:
and LOCATION DOCTRINE:
. If either is empty, skip that constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
        hasOutputParser: false,
        needsFallback: false,
        messages: {},
    };

    @node({
        id: '8d4b0ba1-6a5b-4c60-96e6-3c222cc52499',
        name: 'Chapter Limiter',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1520, 1328],
    })
    ChapterLimiter = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `
// ============================================================================
// CHAPTER LIMITER — Belt-and-suspenders enforcement
// Strips chapters beyond target, removes duplicate sections, removes banned sections
// ============================================================================

const raw = $input.first().json.text || $input.first().json.output || '';

// Get allowed chapters from Outline Prompts
const targetStr = $('Outline Prompts').first().json.target_chapters || '';
const allowed = targetStr.split(',').map(s => s.trim().toLowerCase());

// Parse sections by splitting on ## CHAPTER or ## Prologue / ## Epilogue
const sections = raw.split(/(?=^---$\\n+^## )/m);

// If simple split fails, try by heading
let headerSections;
if (sections.length <= 1) {
  // Try splitting by ## headers
  headerSections = raw.split(/(?=^## CHAPTER |^## Prologue|^## Epilogue)/mi);
} else {
  headerSections = sections;
}

// Filter: keep only sections whose heading matches an allowed chapter
const filtered = [];
let preamble = '';

for (const section of headerSections) {
  // Check if this section starts with a chapter heading
  const headingMatch = section.match(/^(?:---\\s*)?\\n*## (?:CHAPTER\\s+)?(\\d+|Prologue|Epilogue)/i);
  
  if (!headingMatch) {
    // This is preamble (before first chapter) — keep it
    preamble += section;
    continue;
  }
  
  const chapterRef = headingMatch[1].toLowerCase();
  
  // Check if this chapter is in the allowed list
  if (allowed.includes(chapterRef)) {
    filtered.push(section);
  }
}

// Join filtered sections
let output = preamble + filtered.join('');

// Remove duplicate ### Dialogue Voice Layer (keep first instance per chapter)
output = output.replace(/(### Dialogue Voice Layer[\\s\\S]*?)### Dialogue Voice Layer/g, '$1');

// Remove any ### Dialogue Map sections entirely
output = output.replace(/### Dialogue Map[\\s\\S]*?(?=###|---\\s*$|$)/gm, '');

// Report what was done
const removedCount = headerSections.length - filtered.length - (preamble ? 1 : 0);
const report = removedCount > 0
  ? '[Chapter Limiter] Removed ' + removedCount + ' excess chapter(s). Kept: ' + allowed.join(', ')
  : '[Chapter Limiter] All chapters within bounds (' + allowed.join(', ') + ')';

return [{ json: { text: output.trim(), limiter_report: report } }];
`,
        notice: '',
    };

    @node({
        id: '01b8f138-a3f8-4123-ad1e-16c9a3ccf094',
        name: 'Store Brief',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1648, 1456],
    })
    StoreBrief = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `
// Accumulate chapter briefs across loop iterations using workflow static data
const currentBrief = $input.first().json.text || $input.first().json.output || '';
const chapterLabel = $('Loop Controller').first().json.chapter || 'unknown';

// Use workflow static data to persist across loop iterations
const staticData = $getWorkflowStaticData('global');
const separator = staticData.accumulatedBriefs ? String.fromCharCode(10, 10) + '---' + String.fromCharCode(10, 10) : '';
const accumulated = (staticData.accumulatedBriefs || '') + separator + currentBrief;
staticData.accumulatedBriefs = accumulated;

return [{
  json: {
    text: currentBrief,
    accumulated: accumulated,
    chapter: chapterLabel,
    chapters_processed: (accumulated.match(/## CHAPTER/gi) || []).length
  }
}];
`,
        notice: '',
    };

    @node({
        id: 'e81903e4-ca2c-43e9-9ac2-b26543444da9',
        name: 'Join Briefs',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1776, 1216],
    })
    JoinBriefs = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `
// Collect accumulated briefs from the Loop Controller's done output
// Loop Controller passes accumulated text in $json.accumulated when done=true
const input = $input.first().json;
const accumulated = input.accumulated || '';
if (!accumulated) {
  // Fallback: try static data
  const staticData = $getWorkflowStaticData('global');
  const fallback = staticData.accumulatedBriefs || '';
  if (fallback) {
    return [{ json: { text: fallback, output: fallback } }];
  }
}
return [{ json: { text: accumulated, output: accumulated } }];
`,
        notice: '',
    };

    @node({
        id: 'a6ee44c9-373a-458c-98f4-ec5ab8413a30',
        name: 'Clean Outline Output',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1936, 1216],
    })
    CleanOutlineOutput = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `const raw = $input.first().json.text || $input.first().json.output || '';
const cleaned = raw
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\\n{3,}/g, '\\n\\n').trim();
return [{ json: { output: cleaned } }];`,
        notice: '',
    };

    @node({
        id: '04d5b001-db9b-4fb9-ae0b-dbd7759e3384',
        name: 'Post Process',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [2080, 1216],
    })
    PostProcess = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `const raw = $input.first().json.output || $input.first().json.text || '';
const wordMap = {
  "delve": "examine", "delves": "examines", "delved": "examined", "delving": "examining",
  "tapestry": "weave", "tapestries": "weaves", "realm": "domain", "realms": "domains",
  "beacon": "signal", "beacons": "signals", "pivotal": "critical", "pivotally": "critically",
  "seamlessly": "smoothly", "seamless": "smooth", "myriad": "many",
  "resonate": "register", "resonates": "registers", "resonated": "registered",
  "captivate": "engage", "captivates": "engages", "captivated": "engaged", "captivating": "engaging",
  "unravel": "untangle", "unravels": "untangles", "unravelled": "untangled",
  "unleash": "release", "unleashes": "releases", "unleashed": "released",
  "navigate": "traverse", "navigates": "traverses", "navigated": "traversed",
  "embark": "begin", "embarks": "begins", "embarked": "began",
  "profound": "deep", "profoundly": "deeply", "palpable": "tangible",
  "visceral": "raw", "ethereal": "wispy", "enigmatic": "mysterious",
  "labyrinthine": "complex", "ubiquitous": "pervasive",
  "breathtaking": "striking", "vibrant": "vivid", "whimsical": "playful",
  "orchestrated": "arranged", "bespoke": "custom", "akin": "similar"
};
let output = raw;
for (const [w, r] of Object.entries(wordMap)) {
  const e = w.replace(/[-\\/\\\\^$*+?.()|[\\]]/g, '\\\\$&');
  output = output.replace(new RegExp('\\\\b' + e + '\\\\b', 'gi'), m =>
    m[0] === m[0].toUpperCase() ? r.charAt(0).toUpperCase() + r.slice(1) : r);
}
output = output.replace(/^(Based on|Given the|In conclusion|To summarize|Let's apply|This approach|This ensures).+$/gim, '');
output = output.replace(/^(This outline provides|This structured approach|This provides a|This narrative framework).+$/gim, '');
output = output.replace(/your (project|narrative|story|braindump)/gi, 'the $1');
output = output.replace(/[^ -~\\n\\r\\t]+/g, '');
output = output.replace(/\\n{4,}/g, '\\n\\n\\n').trim();
return [{ json: { output: output } }];`,
        notice: '',
    };

    @node({
        id: '689e9cb7-4daf-4cb7-9bc2-41b29dc65060',
        name: 'Send to Outline Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [2256, 1216],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    SendToOutlineDoc = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'update',
        documentURL: "={{ $('Get BLANK Outline Doc').item.json.documentId }}",
        simple: true,
        actionsUi: {
            actionFields: [
                {
                    object: 'text',
                    action: 'insert',
                    insertSegment: 'body',
                    locationChoice: 'endOfSegmentLocation',
                    text: `={{ $('Post Process').item.json.output }}

`,
                },
            ],
        },
        updateFields: {},
    };

    @node({
        id: 'fb1cbe28-d964-4313-87ef-19af12463087',
        name: 'Ollama Chat Model15',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [-144, 1488],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel15 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: 0.5,
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: '7f55e208-9b27-4b50-978b-c88c8058fc27',
        name: 'Ollama Chat Model16',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [144, 1488],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel16 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: 0.8,
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: 'b4ee11c9-769d-4812-b7f8-70581d5b8188',
        name: 'Ollama Chat Model17',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [432, 1488],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel17 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: 0.7,
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: 'f339f69a-f72a-44e9-bd6f-e34822cd91c5',
        name: 'Ollama Chat Model18',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [1232, 1488],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel18 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.longform.model }}",
        options: {
            temperature: 0.5,
            topK: "={{ $('Universal Config').item.json.profiles.longform.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.longform.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.longform.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.longform.parameters.num_gpu }}",
            numPredict: -1,
            presencePenalty: "={{ $('Universal Config').item.json.profiles.longform.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.longform.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: '026736f3-518e-4046-a6b1-80ba65ea13f3',
        name: 'Chapter Done Check',
        type: 'n8n-nodes-base.if',
        version: 2.2,
        position: [-2192, 1248],
    })
    ChapterDoneCheck = {
        conditions: {
            options: {
                caseSensitive: true,
                leftValue: '',
            },
            conditions: [
                {
                    id: 'done-check',
                    leftValue: '={{ $json.done }}',
                    rightValue: true,
                    operator: {
                        type: 'boolean',
                        operation: 'equals',
                        singleValue: true,
                    },
                },
            ],
            combinator: 'and',
        },
        looseTypeValidation: false,
        options: {},
    };

    @node({
        id: '66122f88-e4dc-41a2-816e-2da5b65d93e2',
        name: 'Outline Prompts',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-2000, 1328],
    })
    OutlinePrompts = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `// --- READS ALL CONFIGURABLE VARIABLES FROM CHAPTER SELECTOR -----------------
// Edit values in the "Chapter Selector" node above — not here.

function safeGet(nodeName) {
  try { const r = $(nodeName).first(); return r ? (r.json || {}) : {}; } catch(e) { return {}; }
}

var NL = String.fromCharCode(10);  // newline char — DO NOT EDIT

// Read the CURRENT chapter item from the loop (not all chapters)
var selectorData = $input.first().json;

const totalChapters   = selectorData.totalChapters   || 20;
const wordsPerChapter = selectorData.wordsPerChapter  || 800;
// Single chapter mode (loop processes one at a time)
const chaptersToOutline = (selectorData.chapter || selectorData.selectedChapters || "1").trim();

// Previous chapter briefs for cumulative context (from Loop Controller)
const previousBriefs = selectorData.previousBriefs || '';

const includePrologue = !!selectorData.includePrologue;
const includeEpilogue = !!selectorData.includeEpilogue;

// --- READ FROM FORM (for identity fields only) -------------------------------
const form = safeGet("On form submission");

// --- PROJECT IDENTITY -------------------------------------------------------
const title       = form["Book Title"] || form["What is the Title of Your Book"] || "UNTITLED PROJECT";
const authorNotes = form["Author Notes"] || "";

// --- HIGH-LEVEL LOGIC (from Universal Config) -------------------------------
const config        = safeGet("Universal Config");
const tropeTemplate = config.trope_full || "";
const plotTemplate  = config.plot_full  || "";
const storyTemplate = config.arc_full   || "";
const proseJail     = config.prose_jail || "";
const conflictTemplate = config.conflict_full || "";
const locationTemplate = config.location_full || "";
const factionTemplate = config.faction_full || "";

// --- WORLD RULES (from Dossier) ---------------------------------------------
const seeds   = safeGet("Extract Seeds");
const dossier = seeds.dossier || "";

// --- FORBIDDEN WORDS (from Extract Seeds) -----------------------------------
const forbiddenWords = seeds.forbiddenWords || "";
const entityNames    = (seeds.entityNames || []).join(", ");

// --- POLISHED DATA (Rewrite output preferred, original as fallback) ---------
const worldbuildingDoc = safeGet('Rewrite Worldbuilding').text || safeGet('Worldbuilding').text || "[ERROR: No worldbuilding data]";
const characterDoc     = safeGet('Rewrite Characters').text   || safeGet('Characters').text   || "[ERROR: No character data]";
const storySoFar       = safeGet('Rewrite Story Arc').text    || safeGet('Story Arc').text    || "[ERROR: No story arc data]";

// --- PRE-COMPUTE CONDITIONAL PROMPT SECTIONS --------------------------------
const prologueGuidelines = (includePrologue && includeEpilogue) ? [
  '### PROLOGUE GUIDELINES',
  'The Prologue is a cold-open hook — a short, high-impact scene that:',
  '- Drops the reader into the world mid-action, before the main story timeline begins',
  '- Introduces a central tension, mystery, or thematic question from the dossier',
  '- Features a POV that creates dramatic irony for the reader',
  '- Does NOT reveal the full context — it plants a seed that pays off later',
  '- Target length: ' + Math.round(wordsPerChapter * 0.6) + ' words of dense beats (shorter than a full chapter)',
].join(NL)
 : '';

const epilogueGuidelines = includeEpilogue ? [
  '### EPILOGUE GUIDELINES',
  'The Epilogue is a thematic closure beat — a brief scene set after the climax that:',
  '- Shows the new status quo established by the resolution',
  '- Resolves one remaining emotional thread from CHARACTERS (not a plot thread)',
  '- Plants a subtle forward-looking hook (sequel potential or open question)',
  '- Uses a POV that mirrors or contrasts the Prologue for structural resonance',
  '- Target length: ' + Math.round(wordsPerChapter * 0.5) + ' words of dense beats (shorter than a full chapter)',
].join(NL)
 : '';

const prologueOutputFormat = (includePrologue && includeEpilogue) ? [
  '### PROLOGUE: [Title]',
  '**Opening Image:** [The very first visual or sensory moment that introduces the reader to this world]',
  '[2-3 dense paragraphs of tactical beats. Cold-open scene -- establish mood, drop the reader into the world, plant a mystery.]',
  '**Closing Hook:** [The exact tension point that propels the reader into Chapter 1]',
  '',
].join(NL)
 : '';

const epilogueOutputFormat = includeEpilogue ? [
  '### EPILOGUE: [Title]',
  '**Opening Image:** [The first visual or sensory moment of the aftermath]',
  '[1-2 dense paragraphs of tactical beats. Thematic closure -- show the aftermath, resolve one emotional thread, plant a subtle hook.]',
  '',
].join(NL)
 : '';

const sectionCount = chaptersToOutline.split(',').length;

// --- CONSTRUCT PROMPT -------------------------------------------------------
const prompt = \`
PREVIOUS CHAPTER BRIEFS (use for continuity with prior chapters):
\${previousBriefs || "This is the first chapter -- no previous briefs."}

ABSOLUTE CHAPTER LOCK: You must produce EXACTLY \${sectionCount} chapter outlines for these chapters ONLY: \${chaptersToOutline}. ANY output containing chapters outside this list is INVALID and will be DISCARDED. Do NOT continue beyond the last listed chapter.

<system_constraints>
  <prose_jail>\${proseJail}</prose_jail>
  <forbidden_words>\${forbiddenWords}</forbidden_words>
  <entity_names>\${entityNames}</entity_names>
</system_constraints>

<world_context>
  <dossier_source>\${dossier}</dossier_source>
  <characters>\${characterDoc}</characters>
  <worldbuilding>\${worldbuildingDoc}</worldbuilding>
  <genre_tropes>\${tropeTemplate}</genre_tropes>
</world_context>

<doctrine_templates>
  <conflict_doctrine>\${conflictTemplate}</conflict_doctrine>
  <location_doctrine>\${locationTemplate}</location_doctrine>
  <faction_doctrine>\${factionTemplate}</faction_doctrine>
</doctrine_templates>

<narrative_spine>
  <story_so_far>\${storySoFar}</story_so_far>
  <author_notes>\${authorNotes}</author_notes>
  <plot_logic>\${plotTemplate}</plot_logic>
</narrative_spine>

<task_constraints>
  <total_chapters>\${totalChapters}</total_chapters>
  <target_chapters>\${chaptersToOutline}</target_chapters>
  <target_length>\${wordsPerChapter} words per chapter</target_length>
</task_constraints>

You are an expert story outliner creating chapter-level plans for "\${title}".
The complete novel has \${totalChapters} numbered chapters. You are outlining EXACTLY: \${chaptersToOutline}.\${(includePrologue && includeEpilogue) ? " This includes a PROLOGUE." : (includePrologue ? " (Prologue deferred until INCLUDE_EPILOGUE is enabled)" : "")}\${includeEpilogue ? " This includes an EPILOGUE." : ""} Do NOT add any sections beyond this list.

### MISSION
Generate a fully fleshed-out outline for EXACTLY these sections: \${chaptersToOutline}.
Do NOT outline, mention, or label ANY section not in the list above.
The total output must contain EXACTLY \${sectionCount} section(s). No more, no less.
Every detail must come from DOSSIER SOURCE, CHARACTERS, WORLDBUILDING, or STORY SO FAR.
Do not import ideas, character names, or world elements from your training data.

### GUIDELINES
- **Authenticity:** Treat DOSSIER SOURCE as the absolute law for [economy] and [tech_magic] rules.
- **Character Agency:** Ensure every chapter beat is driven by the CHARACTERS' specific motivations and Core Motivations.
- **Pacing:** Align the events of these chapters with the structural goals in PLOT LOGIC.
- **No Prose:** This is a technical blueprint for a ghostwriter. Provide concrete beats, not dialogue or narrative prose.
- **Prose Jail:** Do not use any word from PROSE JAIL in your output.
- **Doctrine Compliance:** Every conflict beat must conform to CONFLICT DOCTRINE, every location to LOCATION DOCTRINE, every faction to FACTION DOCTRINE. If a doctrine block is empty, skip that constraint.

\${prologueGuidelines}

\${epilogueGuidelines}

### FORBIDDEN WORD ENFORCEMENT
- Scan your ENTIRE output for any word in PROSE JAIL or FORBIDDEN WORDS.
- Common violations that MUST be caught: "facility," "lab," "room," "mysterious," "unveiled," "tapestry," "delve," "realm."
- Replace every violation with a SPECIFIC alternative from WORLDBUILDING or CAST MANIFEST.
- If you write "the facility" → replace with the NAMED location (e.g., "the Axiom Complex").
- If you write "a mysterious figure" → replace with a NAMED character from CAST MANIFEST.

### CRITICAL CAST GROUNDING
- EVERY character name in your outline MUST come from the CHARACTERS section above.
- Your PROTAGONIST is the character with role "protagonist" in CHARACTERS. Use their EXACT NAME.
- Do NOT invent any new characters. If you need a minor character, use one from CHARACTERS.
- Before finalising, cross-check ALL names against CHARACTERS. Remove any name not found there.

### CHAPTER DETAIL LEVEL
For each numbered chapter:
- Aim for \${wordsPerChapter} words of dense, specific beats.
- Clearly state who is in the scene, where it happens, and what systemic friction (from the dossier) creates the conflict.
- Name at least one specific world mechanic, location, or constraint from WORLDBUILDING per chapter.
- End with a sharp hook that pulls the reader into the next chapter.
- Every named character must come from the CHARACTERS section above. Do NOT introduce new characters.
- Do not use any word or phrase from FORBIDDEN WORDS or PROSE JAIL.
- Do not use any name from ENTITY NAMES as a new character name.

### OUTPUT FORMAT (MARKDOWN)
\${prologueOutputFormat}
### CHAPTER [NUMBER]: [Title]
**Opening Image:** [The first visual or sensory moment the reader encounters in this chapter]
[3-5 dense paragraphs, totalling at least \${wordsPerChapter} words, describing the tactical beats of the chapter.]
**Closing Hook:** [The exact tension point, question, or emotional cliffhanger that propels into the next chapter]

\${epilogueOutputFormat}

HARD CHAPTER LOCK (FINAL REMINDER):
You MUST produce EXACTLY \${sectionCount} sections: \${chaptersToOutline}. If your output contains ANY chapter not in this list, your output is INVALID and will be rejected. Count your sections before finishing.

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT generate output for any chapter not listed in TARGET CHAPTERS above.
- DO NOT use any word or phrase from PROSE JAIL.
- DO NOT generate any chapter or section not explicitly listed in TARGET CHAPTERS.
\`;

// --- RETURN -----------------------------------------------------------------

const appendixBlock = includeEpilogue ? [
  '## CONTINUITY BIBLE (APPENDIX)',
  'After all chapter briefs, compile a master continuity reference:',
  '',
  '### Timeline',
  '[Ordered list of every significant event with chapter number and relative time position (e.g. Day 1 morning, Day 3 evening)]',
  '',
  '### Character State Tracker',
  'For each major character at the END of the final chapter:',
  '- Physical location',
  '- Knowledge state (what they know, what they believe, what they are wrong about)',
  '- Emotional state (dominant stat, active cascade risks)',
  '- Relationships changed (any alliances formed, broken, or strained during the story)',
  '',
  '### Open Threads Register',
  '- [Thread]: Planted in Ch [N], status at end: [resolved / dangling / escalating]',
  '',
  '### Props and McGuffins Ledger',
  '- [Object]: Introduced Ch [N], last seen Ch [N], current holder: [character or location]',
].join(NL)
 : '';

return [{ json: {
  prompt,
  target_chapters: chaptersToOutline,
  total_chapters:  totalChapters,
  words_per_chapter: wordsPerChapter,
  include_epilogue: includeEpilogue,
  appendix_block: appendixBlock,
} }];`,
        notice: '',
    };

    @node({
        id: 'c3fb0f96-4558-4827-92d3-7594eacb732a',
        name: 'Ollama Chat Model9',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [-1808, 1488],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel9 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: 0.8,
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: 'cf6aeb5f-9566-4144-961a-ef38bbb24a9b',
        name: 'Ollama Chat Model10',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [-1584, 1488],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel10 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: 0.3,
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: '4daaf40d-24ab-486f-8562-20354d2c94b7',
        name: 'Ollama Chat Model11',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [-1296, 1488],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel11 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: 0.7,
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: '62105188-cb71-490d-a873-f0f156930176',
        name: 'Ollama Chat Model12',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [-432, 1488],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel12 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: 0.3,
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: '15e6a5a4-f05a-436a-ac64-2c3834135264',
        name: 'Ollama Chat Model13',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [-1008, 1488],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel13 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: 0.4,
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: 'ecf26923-b619-4a3a-9e79-565a73aa9848',
        name: 'Ollama Chat Model14',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [-720, 1488],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel14 = {
        notice: '',
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: 0.3,
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: '0819bee4-b167-43ae-bb47-ab921ea748e0',
        name: 'Get Dossier',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [112, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetDossier = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1tRB_SWXb8M2BAL7Xh_DQOYwtrfjKW7ggRIf7k9THl7s/edit?tab=t.0',
        simple: true,
    };

    @node({
        id: 'd3971835-6ae8-46f7-a5b1-a786610bead1',
        name: 'Get BLANK Character Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [288, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetBlankCharacterDoc = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1th8QLHqrnQu2SHI0VNU7qSA6Duk_QvN3cXG8yNAgCwk/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: '7247df21-e871-4351-bfcb-0275d8dc65f4',
        name: 'Get BLANK Worldbuilding Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [672, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetBlankWorldbuildingDoc = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1aITR_w2AM53qOHZC5yypmIatmJPgqb2XOZxkPFGdF8s/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: '39e221a3-1667-4a91-b8c0-c25f2567512f',
        name: 'Get BLANK Outline Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [848, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetBlankOutlineDoc = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1HnQAjZjuiKfGwLcw8VuTQ1zMYTETQy8GjolHXRz64UQ/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: '7ec39771-a721-46a8-8d1e-eebfdeb474fa',
        name: 'Get Story Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-384, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetStoryTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1QNlU60cZuCkoVOf6vlYAM9cjOqPPPfngmm1lSkq0xMQ/edit?tab=t.0',
        simple: true,
    };

    @node({
        id: '560d6d99-0728-42d0-b449-183bf005fddd',
        name: 'Get Trope Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-1040, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetTropeTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1-iMbCIuopefgcTykrqRuDTKLQTowXkCUirzgeNfDptA/edit?tab=t.0',
        simple: true,
    };

    @node({
        id: '588782c0-e832-4977-96c6-6abe6d45f008',
        name: 'Get Plot Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-864, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetPlotTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1Adhv_L5YOSHv_n4aAPQch8GNSwVkxWIZeVPwAC6ea-k/edit?tab=t.0',
        simple: true,
    };

    @node({
        id: 'a3af0a98-f0c8-4609-90e8-8768d64b75e4',
        name: 'Get Character Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-672, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetCharacterTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1UVXdl1okr15RTzYQ5DFRDZxQRxpDkW7Rm6kpww8-LDQ/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: '27aa2fe7-9acc-4a69-8e85-9785a266ca4f',
        name: 'Get Worldbuilding Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-224, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetWorldbuildingTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1hGCWFaHnbYtCJD-chCA5tWwj9KEBRiMt7xyZXxcjFU0/edit?tab=t.0',
        simple: true,
    };

    @node({
        id: 'fc7a8e3f-5bfd-4897-a952-bab1c68456cd',
        name: 'Get BLANK Story Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [480, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetBlankStoryDoc = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/18i9cAChlIwTph7yWyHjUIMD6NWwTTkMzlhDkdr8vpvw/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: '81abb5a2-6be1-4054-9452-a7af9aff1e0d',
        name: 'Get Forbidden Words Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-64, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetForbiddenWordsTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1qq6RsG9tSeUTcRHD2Yv206DSHPh__4jRUZS75G8God8/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: '2a4edda4-e70f-4ef9-8591-29678d3c9576',
        name: 'Extract Seeds',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1024, 1024],
    })
    ExtractSeeds = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `
// --- HELPER FUNCTIONS ---------------------------------------------------

function extractDocText(docJson) {
  if (!docJson) return "";
  try {
    const viaParagraphs = (docJson?.body?.content || [])
      .flatMap(el => el?.paragraph?.elements || [])
      .map(el => el?.textRun?.content || "")
      .join("").trim();
    if (viaParagraphs) return viaParagraphs;
    if (typeof docJson?.body    === "string" && docJson.body.trim())    return docJson.body.trim();
    if (typeof docJson?.text    === "string" && docJson.text.trim())    return docJson.text.trim();
    if (typeof docJson?.content === "string" && docJson.content.trim()) return docJson.content.trim();
    if (Array.isArray(docJson?.content)) {
      const viaContent = docJson.content
        .flatMap(el => el?.paragraph?.elements || [])
        .map(el => el?.textRun?.content || "")
        .join("").trim();
      if (viaContent) return viaContent;
    }
    const fallback = Object.values(docJson)
      .find(v => typeof v === "string" && v.length > 100);
    return fallback ? fallback.trim() : "";
  } catch(e) { return ""; }
}

function extractTagContent(doc, tagName) {
  if (!doc) return [];
  return [...(doc.matchAll(
    new RegExp(\`<\${tagName}[^>]*>([\\\\s\\\\S]*?)<\\\\/\${tagName}>\`, "gi")
  ))].flatMap(m =>
    m[1].split(/[\\n,]+/).map(s => s.trim()).filter(s => s.length > 1)
  );
}

// --- FORM DATA ----------------------------------------------------------
function safeGet(nodeName) {
  try { const r = $(nodeName).first(); return r ? (r.json || {}) : {}; } catch(e) { return {}; }
}

const formData         = safeGet("On form submission");
const rawFormTitle     = (formData["Book Title"] || formData["What is the Title of Your Book"] || "").trim().toUpperCase();
const authorNotes      = formData["Author Notes"]      || "";
const lockedCharacters = formData["Locked Characters"] || "";
const lockedProfiles   = formData["Locked Profiles"]   || "";

// Title override from Chapter Selector (used when running standalone without a form)
const selectorTitle = (safeGet("Chapter Selector").bookTitle || "").trim().toUpperCase();

// ---  BRAINDUMP - with Author Notes fallback  
// Tries dedicated Braindump field first; falls back to Author Notes if absent.
// braindump_source records which field was actually used for downstream visibility.
let braindump_source = "none";
let rawBraindump     = "";

if (formData["Braindump"] && formData["Braindump"].trim().length > 0) {
  rawBraindump     = formData["Braindump"];
  braindump_source = "Braindump";
} else if (formData["braindump"] && formData["braindump"].trim().length > 0) {
  rawBraindump     = formData["braindump"];
  braindump_source = "braindump";
} else if (authorNotes && authorNotes.trim().length > 0) {
  rawBraindump     = authorNotes;
  braindump_source = "Author Notes (fallback — add a dedicated Braindump field for best results)";
}

const braindump = rawBraindump.trim().replace(/\\n{3,}/g, "\\n\\n");

// --- WARNINGS -----------------------------------------------------------
const warnings = [];

// --- TITLE LOCK ---------------------------------------------------------
// Priority: form submission → Chapter Selector BOOK_TITLE → dossier <title> tag
let title = rawFormTitle || selectorTitle;

if (!title) {
  // Last resort: try to pull title from the dossier XML <title> tag
  const dossierRaw = extractDocText(safeGet("Get Dossier"));
  const titleFromDossier = (extractTagContent(dossierRaw, "title")[0] || "").trim().toUpperCase();
  title = titleFromDossier;
}

if (!title) {
  title = "UNTITLED PROJECT";
  warnings.push("CRITICAL: no title found — set title before generating");
}

// --- TEMPLATES ----------------------------------------------------------
const templates = {
  tropes:        extractDocText(safeGet("Get Trope Template")),
  plot:          extractDocText(safeGet("Get Plot Template")),
  character:     extractDocText(safeGet("Get Character Template")),
  story:         extractDocText(safeGet("Get Story Template")),
  worldbuilding: extractDocText(safeGet("Get Worldbuilding Template")),
  character_emotion: extractDocText(safeGet("Get Character emotion template")),
  themes:        extractDocText(safeGet("Get Themes Template")),
  conflict:      extractDocText(safeGet("Conflict Architecture Template")),
  voice:         extractDocText(safeGet("Dialogue & Voice Template")),
  backstory:     extractDocText(safeGet("Revelation & Backstory Template")),
  location:      extractDocText(safeGet("Location Profile Template")),
  faction:       extractDocText(safeGet("Faction & Power Template")),
};

const TEMPLATE_MIN_LENGTH = 200;
if (!templates.tropes        || templates.tropes.length        < TEMPLATE_MIN_LENGTH) warnings.push(\`tropeTemplate short or empty (\${templates.tropes.length} chars) — Get Trope Template may have returned partial content\`);
if (!templates.plot          || templates.plot.length          < TEMPLATE_MIN_LENGTH) warnings.push(\`plotTemplate short or empty (\${templates.plot.length} chars) — Get Plot Template may have returned partial content\`);
if (!templates.character     || templates.character.length     < TEMPLATE_MIN_LENGTH) warnings.push(\`characterTemplate short or empty (\${templates.character.length} chars) — Get Character Template may have returned partial content\`);
if (!templates.story         || templates.story.length         < TEMPLATE_MIN_LENGTH) warnings.push(\`storyTemplate short or empty (\${templates.story.length} chars) — Get Story Template may have returned partial content\`);
if (!templates.worldbuilding || templates.worldbuilding.length < TEMPLATE_MIN_LENGTH) warnings.push(\`worldbuildingTemplate short or empty (\${templates.worldbuilding.length} chars) — Get Worldbuilding Template may have returned partial content\`);

// â”€â”€â”€ EMOTION SYSTEM SEEDS (anti-hallucination) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const emotionSeeds = (() => {
  const tpl = templates.character_emotion || "";
  if (!tpl || tpl.length < 100) return null;
  // Extract valid stat names from <stat name="..."> patterns
  // Helper: extract enums from <valid_values> block if present
  const getEnum = (tag) => {
    const m = tpl.match(new RegExp("<" + tag + ">([^<]+)</" + tag + ">"));
    return m ? m[1].split(",").map(s => s.trim()).filter(Boolean) : null;
  };
  const enumWarnings = [];
  const requireEnum = (tag) => {
    const r = getEnum(tag);
    if (!r || r.length === 0) enumWarnings.push("MISSING <valid_values> tag: <" + tag + ">");
    return r || [];
  };

  const statNames = [...requireEnum("stat_names_physiological"), ...requireEnum("stat_names_psychological")];
  const emotionNames = requireEnum("emotion_names");
  const modifiers = requireEnum("emotion_modifiers");
  // Extract section index from SECTION N: TITLE patterns
  const sections = [...tpl.matchAll(/SECTION\\s+(\\d+):\\s*([^\\n]+)/gi)].map(m => "Â§" + m[1] + ": " + m[2].replace(/[\\u2500\\u2550\\u2501\\-]+$/g, "").trim());
  return {
    valid_stats: statNames,
    valid_emotions: emotionNames,
    valid_modifiers: modifiers,
    valid_relationship_stats: requireEnum("relationship_stats"),
    valid_act_positions: requireEnum("act_positions"),
    valid_cascade_types: requireEnum("cascade_types"),
    valid_moodlet_types: requireEnum("moodlet_types"),
    valid_voice_registers: requireEnum("voice_registers"),
    valid_memory_valence: requireEnum("memory_valence"),
    valid_memory_intensity: requireEnum("memory_intensity"),
    valid_trait_effect_types: requireEnum("trait_effect_types"),
    valid_environment_modifiers: requireEnum("environment_modifiers"),
    valid_threshold_operators: requireEnum("threshold_operators"),
    stat_range: requireEnum("stat_value_range").join(""),
    decay_rate_range: requireEnum("decay_rate_range").join(""),
    sections: sections,
    scene_resolution_required: requireEnum("scene_resolution_required"),
    character_snapshot_required: requireEnum("character_snapshot_required"),
    enum_warnings: enumWarnings
  };
})();

if (emotionSeeds && emotionSeeds.enum_warnings && emotionSeeds.enum_warnings.length) {
  warnings.push(...emotionSeeds.enum_warnings.map(w => "ENUM: " + w));
}

// Strip XML comments from emotion template (saves ~1000 tokens per agent)
if (templates.character_emotion) {
  templates.character_emotion = templates.character_emotion.replace(/<!--[\\s\\S]*?-->/g, "").replace(/\\n{3,}/g, "\\n\\n").trim();
}

// --- FORBIDDEN WORDS ----------------------------------------------------
const forbiddenWords = extractDocText(safeGet("Get Forbidden Words Template"));

const forbiddenNamesList    = extractTagContent(forbiddenWords, "forbidden_names");
const forbiddenPhrasesList  = extractTagContent(forbiddenWords, "forbidden_phrases");
const forbiddenVocabList    = extractTagContent(forbiddenWords, "forbidden_vocabulary");
const forbiddenVerbsList    = extractTagContent(forbiddenWords, "forbidden_verbs_and_actions");
const forbiddenDialogueList = extractTagContent(forbiddenWords, "forbidden_dialogue_patterns");
const forbiddenQuirkList    = extractTagContent(forbiddenWords, "forbidden_quirk_patterns");

const forbiddenFlat = [...new Set([
  ...forbiddenNamesList,
  ...forbiddenPhrasesList,
  ...forbiddenVocabList,
  ...forbiddenVerbsList,
].filter(w => w.length > 1))];

if (!forbiddenWords)                   warnings.push("forbiddenWords empty — Get Forbidden Words Template returned nothing");
if (forbiddenFlat.length === 0)        warnings.push("forbiddenFlat empty — forbidden word parsing failed — check tag names in doc");
if (forbiddenNamesList.length === 0)   warnings.push("forbiddenNamesList empty — name scan will not run");
if (forbiddenPhrasesList.length === 0) warnings.push("forbiddenPhrasesList empty — phrase scan will not run");

if (lockedCharacters && forbiddenNamesList.length > 0) {
  const lockedLower = lockedCharacters.toLowerCase();
  const conflicts   = forbiddenNamesList.filter(n => lockedLower.includes(n.toLowerCase()));
  if (conflicts.length > 0) {
    warnings.push(\`WARN: locked character name conflicts with forbidden names list: \${conflicts.join(", ")} — remove from forbidden list or Characters node will block the protagonist\`);
  }
}

// ---  BRAINDUMP GUARD (relaxed for WF2 - dossier is primary context)  
if (braindump_source === "none" || !braindump) {
  warnings.push("INFO: no braindump provided — dossier from WF1 will serve as primary context.");
} else if (braindump.length < 500) {
  warnings.push(\`WARN: braindump short (\${braindump.length} chars) — dossier will supplement.\`);
}

// --- DOSSIER EXTRACTION -------------------------------------------------
const dossier = extractDocText(safeGet("Get Dossier"));
if (!dossier || dossier.length < 200) {
  warnings.push("WARN: dossier short or empty — Get Dossier may have returned partial content");
}

// --- STANDALONE CONTENT DOCS (populated by Workflow 2) ------------------
const characters    = extractDocText(safeGet("Get BLANK Character Doc"));
const worldbuilding = extractDocText(safeGet("Get BLANK Worldbuilding Doc"));
const storyArc      = extractDocText(safeGet("Get BLANK Story Doc"));
if (!characters    || characters.length    < 100) warnings.push("WARN: characters doc empty — run Workflow 2 first");
if (!worldbuilding || worldbuilding.length < 100) warnings.push("WARN: worldbuilding doc empty — run Workflow 2 first");
if (!storyArc      || storyArc.length      < 100) warnings.push("WARN: storyArc doc empty — run Workflow 2 first");

// Collect all XML tag names from the dossier as canonical tags
const canonicalTags = [...new Set(
  [...(dossier || "").matchAll(/<([a-z_][a-z0-9_]*)[^>]*>/gi)].map(m => m[1])
)].filter(t => t.length > 2);
const characterConstraintTags = canonicalTags.filter(t =>
  /systemic_friction|character_seed|core_wound|arc_seed|world_arcs|social_strata/.test(t)
);
const backgroundTags = canonicalTags.filter(t =>
  /world_seed|economy|tech_magic|built_environments|everyday_texture/.test(t)
);
const plotBeatTags = canonicalTags.filter(t =>
  /story_spine|subplot_expansion|beat_map|trope_seed|climax/.test(t)
);
const worldNouns = [...new Set([
  ...extractTagContent(dossier, "economy"),
  ...extractTagContent(dossier, "tech_magic"),
  ...extractTagContent(dossier, "world_nouns"),
].flatMap(s => s.split(/[,;\\n]+/).map(w => w.trim()).filter(w => w.length > 2)))];
const entityNames = extractTagContent(dossier, "entity_names")

// --- CONDITIONAL DEBUG --------------------------------------------------
const debug = warnings.length > 0 ? {
  titleResolved:    title,
  braindumpLength:  braindump.length,
  braindump_source,
  formFieldsFound:  Object.keys(formData), // lists all form keys — useful for field name mismatch diagnosis
  templateHealth: {
    tropes:        templates.tropes.length,
    plot:          templates.plot.length,
    character:     templates.character.length,
    story:         templates.story.length,
    worldbuilding: templates.worldbuilding.length,
    character_emotion: templates.character_emotion.length,
    themes:            templates.themes.length,
    conflict:          templates.conflict.length,
    voice:             templates.voice.length,
    backstory:         templates.backstory.length,
    location:          templates.location.length,
    faction:           templates.faction.length,
  },
  forbiddenWordsLength:   forbiddenWords.length,
  forbiddenFlatCount:     forbiddenFlat.length,
  forbiddenNamesSample:   forbiddenNamesList.slice(0, 10),
  forbiddenPhrasesSample: forbiddenPhrasesList.slice(0, 5),
  forbiddenVocabCount:    forbiddenVocabList.length,
  forbiddenVerbsCount:    forbiddenVerbsList.length,
  forbiddenDialogueCount: forbiddenDialogueList.length,
  forbiddenQuirkCount:    forbiddenQuirkList.length,
  lockedCharacters,
  lockedProfiles,
  dossierLength:  (dossier || "").length,
} : null;

// --- OUTPUT -------------------------------------------------------------
return [{
  json: {
    title,
    braindump,
    braindump_source,
    authorNotes,
    lockedCharacters,
    lockedProfiles,

    forbiddenWords,
    forbiddenFlat,
    forbiddenNamesList,
    forbiddenPhrasesList,
    forbiddenVocabList,
    forbiddenVerbsList,
    forbiddenDialogueList,
    forbiddenQuirkList,

    templates,
    emotionSeeds,

    dossier,
    characters,
    worldbuilding,
    storyArc,
    worldNouns,
    canonicalTags,
    characterConstraintTags,
    backgroundTags,
    plotBeatTags,
    entityNames,

    status:   warnings.length === 0
                ? "Primed OK"
                : \`\${warnings.length} warning(s): \${warnings.join(" | ")}\`,
    warnings,

    ...(debug ? { debug } : {}),
  }
}];
`,
        notice: '',
    };

    @node({
        id: '0caae56d-cbc0-4c2d-b28a-82d96d933e15',
        name: 'Universal Config',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1184, 1024],
    })
    UniversalConfig = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `const inputData = $input.first().json;

// --- DATA RECOVERY ----------------------------------------------------------
// Prioritize Author Notes to ensure "The Digital Drift" specs overwrite errors
const storyData = inputData.authorNotes 
  || inputData.dossier 
  || inputData.content 
  || inputData.braindump 
  || "No data found";

// --- PROFILES ---------------------------------------------------------------
const profiles = {
  creative: {
    label: "creative",
    model: "MHKetbi/Mistral-Small-24B-Instruct-2501-writer:Q4_K_M",
    parameters: {
      temperature:      0.72,
      context_length:   32768,
      num_predict:      4096,
      top_p:            0.9,
      top_k:            50,
      repeat_penalty:   1.08,
      presence_penalty: 0,
      num_gpu:          99,
    }
  },
  creative_max: {
    label: "creative_max",
    model: "qwen2.5:32b",
    parameters: {
      temperature:      0.78,
      context_length:   32768,
      num_predict:      4096,
      top_p:            0.92,
      top_k:            60,
      repeat_penalty:   1.05,
      presence_penalty: 0,
      num_gpu:          99,
    }
  },
  fast_iter: {
    label: "fast_iter",
    model: "qwen:14b",
    parameters: {
      temperature:      0.65,
      context_length:   32768,
      num_predict:      4096,
      top_p:            0.9,
      top_k:            40,
      repeat_penalty:   1.08,
      presence_penalty: 0,
      num_gpu:          99,
    }
  },
  balanced: {
    label: "balanced",
    model: "mistral:latest",
    parameters: {
      temperature:      0.6,
      context_length:   32768,
      num_predict:      4096,
      top_p:            0.88,
      top_k:            40,
      repeat_penalty:   1.08,
      presence_penalty: 0,
      num_gpu:          99,
    }
  },
  longform: {
    label: "longform",
    model: "MHKetbi/Mistral-Small-24B-Instruct-2501-writer:Q4_K_M",
    parameters: {
      temperature:      0.55,
      context_length:   32768,
      num_predict:      6144,
      top_p:            0.86,
      top_k:            40,
      repeat_penalty:   1.1,
      presence_penalty: 0,
      num_gpu:          99,
    }
  },
  light: {
    label: "light",
    model: "llama3.1:8b",
    parameters: {
      temperature:      0.55,
      context_length:   16384,
      num_predict:      3072,
      top_p:            0.85,
      top_k:            30,
      repeat_penalty:   1.1,
      presence_penalty: 0,
      num_gpu:          99,
    }
  },
  repair: {
    label: "repair",
    model: "qwen:14b",
    parameters: {
      temperature:      0.1,
      context_length:   32768,
      num_predict:      4096,
      top_p:            0.85,
      top_k:            20,
      repeat_penalty:   1.0,
      presence_penalty: 0,
      num_gpu:          99,
    }
  }
};

// --- PROFILE SELECTION --------------------------------------------------
const braindumpRaw = storyData.trim();
const validLabels = Object.keys(profiles);
const profileOverride = (inputData.profile_override || "").trim().toLowerCase();
const selected = validLabels.includes(profileOverride)
  ? profiles[profileOverride]
  : (braindumpRaw.length > 9000 ? profiles.longform : profiles.creative);

// --- WARNINGS -----------------------------------------------------------
const warnings = [];
if (profileOverride && !validLabels.includes(profileOverride)) {
  warnings.push(\`WARN: profile_override "\${profileOverride}" not recognised — used creative_max.\`);
}

if (braindumpRaw.length < 500) {
  warnings.push(\`WARN: braindump short (\${braindumpRaw.length} chars) — results may be generic.\`);

}

// --- OUTPUT -------------------------------------------------------------
return [{
  json: {
    ...inputData,
    // Flattened aliases for downstream legacy references (CritiqueStoryArc, OutlinePrompts)
    trope_full: inputData.templates?.tropes || "",
    plot_full: inputData.templates?.plot || "",
    arc_full: inputData.templates?.story || "",
    character_full: inputData.templates?.character || "",
    world_full: inputData.templates?.worldbuilding || "",
    character_emotion_full: inputData.templates?.character_emotion || "",
    themes_full: inputData.templates?.themes || "",
    conflict_full: inputData.templates?.conflict || "",
    voice_full: inputData.templates?.voice || "",
    backstory_full: inputData.templates?.backstory || "",
    location_full: inputData.templates?.location || "",
    faction_full: inputData.templates?.faction || "",

    emotion_guardrails: (() => {
      const seeds = inputData.emotionSeeds;
      if (!seeds) return "";
      const NL = String.fromCharCode(10);
      return [
        "EMOTION SYSTEM VOCABULARY LOCK (parsed from character emotion template)",
        "Valid character stats: " + seeds.valid_stats.join(", "),
        "Valid emotions: " + seeds.valid_emotions.join(", "),
        "Valid emotion modifiers: " + seeds.valid_modifiers.join(", "),
        "Valid relationship stats: " + seeds.valid_relationship_stats.join(", "),
        "Valid voice registers: " + seeds.valid_voice_registers.join(", "),
        "Valid act positions: " + seeds.valid_act_positions.join(", "),
        "Moodlet types: " + seeds.valid_moodlet_types.join(", "),
        "Memory valence: " + seeds.valid_memory_valence.join(", "),
        "Memory intensity: " + seeds.valid_memory_intensity.join(", "),
        "Trait effect types: " + seeds.valid_trait_effect_types.join(", "),
        "Environment modifiers: " + seeds.valid_environment_modifiers.join(", "),
        "Threshold operators: " + seeds.valid_threshold_operators.join(", "),
        "Valid cascade types: " + seeds.valid_cascade_types.join(", "),
        "Stat values: " + seeds.stat_range + ". Decay rates: " + seeds.decay_rate_range,
        "",
        "ANTI-HALLUCINATION RULES",
        "- Do NOT invent stat names outside the valid lists above.",
        "- Do NOT assign stat values outside 0-100 (integers only).",
        "- Do NOT invent voice registers \\u2014 match \\u00A78 entries for that character.",
        "- Do NOT fabricate cascade rules \\u2014 use only \\u00A73 entries.",
        "- Do NOT skip scene_resolution fields: " + seeds.scene_resolution_required.join(", ") + ".",
        "- Do NOT skip character_snapshot fields: " + seeds.character_snapshot_required.join(", ") + ".",
        "",
        "SECTION INDEX",
        ...seeds.sections
      ].join(NL);
    })(),
    forbidden_list: (inputData.forbiddenFlat || []).join(", "),
    content: inputData.dossier || "",
    active_profile: selected,
    profiles,
    language_guard: "LANGUAGE LOCK: Write English only. Standard Latin script.",
    prose_jail: (() => {
      const NL = String.fromCharCode(10);
      const wordBlock = (inputData.forbiddenFlat && inputData.forbiddenFlat.length > 0)
        ? "STRICT NEGATIVE PROMPT" + NL + "Never use any of these words or phrases: " + inputData.forbiddenFlat.join(', ') + "."
        : "STRICT NEGATIVE PROMPT: No vague, decorative, or AI-cliche language.";

      const dialogueList = inputData.forbiddenDialogueList || [];
      const quirkList    = inputData.forbiddenQuirkList    || [];

      const dialogueBlock = dialogueList.length > 0
        ? NL + NL + "FORBIDDEN DIALOGUE PATTERNS - never write:" + NL + dialogueList.map(p => "- " + p).join(NL)
        : "";

      const quirkBlock = quirkList.length > 0
        ? NL + NL + "FORBIDDEN QUIRK PATTERNS - never write:" + NL + quirkList.map(p => "- " + p).join(NL)
        : "";

      return wordBlock + dialogueBlock + quirkBlock;
    })(),
    // Mirror the data so the Agent's {{ $json.braindump }} expression works
    braindump: storyData,
    book_title: inputData.title || inputData["Book Title"] || inputData["What is the Title of Your Book"] || "UNTITLED PROJECT",

    required_tags: ["world_seed", "character_seed", "story_spine", "subplot_expansion", "trope_seed"],
    required_xml_structure: \`<dossier><metadata><title/><generated_date/></metadata><content><world_seed/><character_seed/><story_spine/><subplot_expansion/><trope_seed/></content></dossier>\`,

    status: warnings.length === 0 ? "Config OK" : \`\${warnings.length} warning(s): \${warnings.join(" | ")}\`,
    warning_count: warnings.length,
    warnings
  }
}];`,
        notice: '',
    };

    @node({
        id: 'd47a3b18-eaa6-4fe1-a86c-66f7436debfa',
        name: 'Debug',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1328, 1024],
    })
    Debug = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `
const config = $input.first().json;

// --- SOFT WARNINGS - log and continue -----------------------------------------
const warnings = [];

// --- Check for critical data (demoted to warnings for WF2.a) ------------------
if ((!config.braindump || config.braindump.trim().length < 50) && (!config.dossier || config.dossier.trim().length < 200)) {
  warnings.push("[CRITICAL] CONTEXT MISSING - neither braindump (" + (config.braindump?.trim().length || 0) + " chars) nor dossier (" + (config.dossier?.trim().length || 0) + " chars) contain sufficient context.");
}

if (!config.active_profile?.model) {
  warnings.push("[CRITICAL] MODEL NOT SET - Universal Config failed to resolve an active profile. Check the UniversalConfig node.");
}

const validLabels = ["creative", "creative_max", "fast_iter", "balanced", "longform", "light", "repair"];
if (config.active_profile?.label && !validLabels.includes(config.active_profile.label)) {
  warnings.push("active_profile.label " + config.active_profile.label + " not recognised - expected: " + validLabels.join(", "));
}

if (!config.language_guard) warnings.push("language_guard missing - agents will have no language lock");
if (!config.prose_jail)     warnings.push("prose_jail missing - forbidden word constraints will not be passed to agents");

if (!Array.isArray(config.required_tags) || config.required_tags.length === 0)
  warnings.push("required_tags missing - Final Pass will use hardcoded fallback list");

if (!config.forbiddenFlat || config.forbiddenFlat.length === 0)
  warnings.push("forbiddenFlat empty - word scrub in Sanitization and Final Pass will not run");

if ((config.braindump?.length || 0) < 500 && (!config.dossier || config.dossier.length < 200))
  warnings.push("braindump short (" + (config.braindump?.length || 0) + " chars) and dossier not loaded - output quality may suffer");

// --- OUTPUT -------------------------------------------------------------------
return [{
  json: {
    status:        warnings.length === 0 ? "Pre-flight OK" : warnings.length + " warning(s) - proceeding: " + warnings.join(" | "),
    warning_count: warnings.length,
    warnings,
    summary: {
      selected_model:    config.active_profile?.model  || "none",
      selected_label:    config.active_profile?.label  || "none",
      braindump_length:  config.braindump?.length      || 0,
      dossier_length:    config.dossier?.length        || 0,
      title:             config.title                  || "none",
      forbidden_count:   config.forbiddenFlat?.length  || 0,
      prose_jail_set:    !!config.prose_jail,
      language_guard_set: !!config.language_guard,
    }
  }
}];`,
        notice: '',
    };

    @node({
        id: '9838029d-f46c-4b00-b51f-dd1012985f07',
        name: 'Get Character emotion template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-528, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetCharacterEmotionTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1h8P0RRd_Yr0qsbUGxyBnxFhKfU5GYBetXJp-geddTWs/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: 'ce44a344-0623-4e8e-a60c-547f1ee07e35',
        name: 'Get Themes Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-1184, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetThemesTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1mmDaJeNOtYrJKkBoZloGt6yXewhW5wPQ4K_Pyg4ookI/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: 'cdd230f3-d36b-46a3-8cad-860609894d8b',
        name: 'Conflict Architecture Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-1344, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    ConflictArchitectureTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1pmwf_gk644RpaDf3miLIUKXOnp0__mTowqgN_glyRaY/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: '48b01cae-b44f-4451-bdfb-3764aef47eb2',
        name: 'Dialogue & Voice Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-1520, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    DialogueVoiceTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1C0IZD_F5yuTJclxS3HDZQe_Ikx5d8cS13c_pW53P2Zo/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: 'f9b8311d-de71-4c7d-8b83-729d772a93bc',
        name: 'Revelation & Backstory Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-1712, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    RevelationBackstoryTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1djCPHBjQXAt-9uEYu3xT9BiRtb9L837N8tgmJvcunhE/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: '318352b4-485b-4ea2-b709-53c8f5fc8f23',
        name: 'Location Profile Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-1888, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    LocationProfileTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/13SLU8Lati3Bh2KwAt9PMr9d-1LL6j8oWwoiGTcS558E/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: '0bc694f4-fe5b-4ffd-bf38-cc092bd69cfb',
        name: 'Faction & Power Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-2032, 1024],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    FactionPowerTemplate = {
        authentication: 'oAuth2',
        resource: 'document',
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1yUtBR0o6Y1Pqc8H0GGua8xbuPhcSm_4OD5HW73YWry0/edit?usp=sharing',
        simple: true,
    };

    @node({
        id: 'f6c6036b-229e-4ed3-8dd7-036521f11949',
        name: 'When clicking ‘Execute workflow’',
        type: 'n8n-nodes-base.manualTrigger',
        version: 1,
        position: [-2224, 1024],
    })
    WhenClickingExecuteWorkflow = {
        notice: '',
    };

    @node({
        id: '05a1fe32-4cb9-44f9-80fb-707256fc4813',
        name: 'Brief Validator',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1600, 1328],
    })
    BriefValidator = {
        jsCode: `var brief = $input.first().json.text || $input.first().json.output || '';
var warnings = [];
var score = 100;
var req = ['Structural Layer','Scene Layer','Foreshadowing Layer','Character Voice Cards','Voice Layer','Dialogue Voice Layer','Thematic Layer','Character Emotion Layer','Emotional Layer','Prose Directives','Handoff to Next Chapter'];
var missing = [];
for (var i = 0; i < req.length; i++) { if (!brief.includes(req[i])) { missing.push(req[i]); score -= 5; } }
if (missing.length > 0) warnings.push('MISSING: ' + missing.join(', '));
var bad = ['facility', 'mysterious figure', 'unknown entity'];
var lo = brief.toLowerCase();
var found = [];
for (var j = 0; j < bad.length; j++) { if (lo.includes(bad[j])) { found.push(bad[j]); score -= 3; } }
if (found.length > 0) warnings.push('GENERIC: ' + found.join(', '));
if (brief.includes('Voice Cards')) score += 3;
if (brief.includes('Show-Don')) score += 3;
if (brief.includes('Handoff')) score += 3;
if (brief.includes('Setup for next')) score += 2;
score = Math.max(0, Math.min(100, score));
return [{ json: { text: brief, output: brief, validation: { score: score, grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D', warnings: warnings, found: req.length - missing.length, total: req.length } } }];`,
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.Outline.out(0).to(this.CritiqueOutline.in(0));
        this.CritiqueOutline.out(0).to(this.RewriteOutline.in(0));
        this.RewriteOutline.out(0).to(this.EmotionalCheck.in(0));
        this.EmotionalCheck.out(0).to(this.SciencePlotEnrichment.in(0));
        this.SciencePlotEnrichment.out(0).to(this.ContinuityChecker.in(0));
        this.ContinuityChecker.out(0).to(this.SceneBreakdown.in(0));
        this.SceneBreakdown.out(0).to(this.ForeshadowingPlanner.in(0));
        this.ForeshadowingPlanner.out(0).to(this.PovPlanner.in(0));
        this.PovPlanner.out(0).to(this.DialogueVoiceMapper.in(0));
        this.DialogueVoiceMapper.out(0).to(this.ThemeWeaver.in(0));
        this.ThemeWeaver.out(0).to(this.GhostwriterBrief.in(0));
        this.GhostwriterBrief.out(0).to(this.ChapterLimiter.in(0));
        this.ChapterLimiter.out(0).to(this.BriefValidator.in(0));
        this.StoreBrief.out(0).to(this.LoopController.in(0));
        this.LoopController.out(0).to(this.ChapterDoneCheck.in(0));
        this.ChapterDoneCheck.out(0).to(this.JoinBriefs.in(0));
        this.ChapterDoneCheck.out(1).to(this.OutlinePrompts.in(0));
        this.JoinBriefs.out(0).to(this.CleanOutlineOutput.in(0));
        this.CleanOutlineOutput.out(0).to(this.PostProcess.in(0));
        this.PostProcess.out(0).to(this.SendToOutlineDoc.in(0));
        this.OutlinePrompts.out(0).to(this.Outline.in(0));
        this.ChapterSelector.out(0).to(this.LoopController.in(0));
        this.GetDossier.out(0).to(this.GetBlankCharacterDoc.in(0));
        this.GetBlankCharacterDoc.out(0).to(this.GetBlankStoryDoc.in(0));
        this.GetBlankWorldbuildingDoc.out(0).to(this.GetBlankOutlineDoc.in(0));
        this.GetBlankOutlineDoc.out(0).to(this.ExtractSeeds.in(0));
        this.GetStoryTemplate.out(0).to(this.GetWorldbuildingTemplate.in(0));
        this.GetTropeTemplate.out(0).to(this.GetPlotTemplate.in(0));
        this.GetPlotTemplate.out(0).to(this.GetCharacterTemplate.in(0));
        this.GetCharacterTemplate.out(0).to(this.GetCharacterEmotionTemplate.in(0));
        this.GetWorldbuildingTemplate.out(0).to(this.GetForbiddenWordsTemplate.in(0));
        this.GetBlankStoryDoc.out(0).to(this.GetBlankWorldbuildingDoc.in(0));
        this.GetForbiddenWordsTemplate.out(0).to(this.GetDossier.in(0));
        this.ExtractSeeds.out(0).to(this.UniversalConfig.in(0));
        this.UniversalConfig.out(0).to(this.Debug.in(0));
        this.GetCharacterEmotionTemplate.out(0).to(this.GetStoryTemplate.in(0));
        this.GetThemesTemplate.out(0).to(this.GetTropeTemplate.in(0));
        this.ConflictArchitectureTemplate.out(0).to(this.GetThemesTemplate.in(0));
        this.DialogueVoiceTemplate.out(0).to(this.ConflictArchitectureTemplate.in(0));
        this.RevelationBackstoryTemplate.out(0).to(this.DialogueVoiceTemplate.in(0));
        this.LocationProfileTemplate.out(0).to(this.RevelationBackstoryTemplate.in(0));
        this.FactionPowerTemplate.out(0).to(this.LocationProfileTemplate.in(0));
        this.Debug.out(0).to(this.ChapterSelector.in(0));
        this.WhenClickingExecuteWorkflow.out(0).to(this.FactionPowerTemplate.in(0));
        this.BriefValidator.out(0).to(this.StoreBrief.in(0));

        this.Outline.uses({
            ai_languageModel: this.OllamaChatModel9.output,
        });
        this.CritiqueOutline.uses({
            ai_languageModel: this.OllamaChatModel10.output,
        });
        this.RewriteOutline.uses({
            ai_languageModel: this.OllamaChatModel11.output,
        });
        this.EmotionalCheck.uses({
            ai_languageModel: this.OllamaChatModel13.output,
        });
        this.SciencePlotEnrichment.uses({
            ai_languageModel: this.OllamaChatModel14.output,
        });
        this.ContinuityChecker.uses({
            ai_languageModel: this.OllamaChatModel12.output,
        });
        this.SceneBreakdown.uses({
            ai_languageModel: this.OllamaChatModel15.output,
        });
        this.ForeshadowingPlanner.uses({
            ai_languageModel: this.OllamaChatModel16.output,
        });
        this.PovPlanner.uses({
            ai_languageModel: this.OllamaChatModel17.output,
        });
        this.DialogueVoiceMapper.uses({
            ai_languageModel: this.OllamaChatModel19.output,
        });
        this.ThemeWeaver.uses({
            ai_languageModel: this.OllamaChatModel20.output,
        });
        this.GhostwriterBrief.uses({
            ai_languageModel: this.OllamaChatModel18.output,
        });
    }
}
