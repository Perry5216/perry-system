import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : 2.a - Outline Generation
// Nodes   : 56  |  Connections: 44
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ChapterSelector                    code                       
// LoopController                     code                       
// Outline                            chainLlm                   [AI]
// CritiqueOutline                    chainLlm                   [AI]
// RewriteOutline                     chainLlm                   [AI]
// EmotionalCheck                     chainLlm                   [AI]
// SciencePlotEnrichment              chainLlm                   [AI]
// ContinuityChecker                  chainLlm                   [AI]
// SceneBreakdown                     chainLlm                   [AI]
// ForeshadowingPlanner               chainLlm                   [AI]
// PovPlanner                         chainLlm                   [AI]
// DialogueVoiceMapper                chainLlm                   [AI]
// OllamaChatModel19                  lmChatOllama               [creds] [ai_languageModel]
// ThemeWeaver                        chainLlm                   [AI]
// OllamaChatModel20                  lmChatOllama               [creds] [ai_languageModel]
// GhostwriterBrief                   chainLlm                   [AI]
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
//                                                                                → StoreBrief
//                                                                                  → LoopController (↩ loop)
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
    id: "nB6dkKCA0npZSNQG",
    name: "2.a - Outline Generation",
    active: false,
    settings: { executionOrder: "v1", callerPolicy: "workflowsFromSameOwner", availableInMCP: false }
})
export class _2AOutlineGenerationWorkflow {

    // =====================================================================
// CONFIGURATION DES NOEUDS
// =====================================================================

    @node({
        id: "chapter-selector-001",
        name: "Chapter Selector",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [-2608, 1280]
    })
    ChapterSelector = {
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
`
    };

    @node({
        id: "1fc77e4c-98b2-49b2-84f6-7e1752d33647",
        name: "Loop Controller",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [-2400, 1280]
    })
    LoopController = {
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
  // Summarize briefs if they're getting long (context window optimization)
  previousBriefs: previousBriefs.length > 3000
    ? previousBriefs.split('---').map(function(chapterBrief) {
        // Extract key continuity data from each brief
        var lines = chapterBrief.split(String.fromCharCode(10));
        var summary = [];
        var inHandoff = false;
        var inForeshadowing = false;
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.includes('CHAPTER')) summary.push(line.trim());
          if (line.includes('Handoff') || line.includes('handoff')) inHandoff = true;
          if (line.includes('Foreshadowing')) inForeshadowing = true;
          if (inHandoff && line.trim().startsWith('-')) summary.push(line.trim());
          if (inForeshadowing && (line.includes('[PLANT]') || line.includes('[PAYOFF]'))) summary.push(line.trim());
          if (line.includes('Character positions')) summary.push(line.trim());
          if (line.includes('Knowledge states')) summary.push(line.trim());
          if (line.includes('Emotional carryover')) summary.push(line.trim());
          if (line.includes('Setup for next')) summary.push(line.trim());
          if (line.includes('Open threads')) summary.push(line.trim());
          if (line.trim() === '' && (inHandoff || inForeshadowing)) { inHandoff = false; inForeshadowing = false; }
        }
        return summary.join(String.fromCharCode(10));
      }).join(String.fromCharCode(10) + '---' + String.fromCharCode(10))
    : previousBriefs,
  loopIndex: currentIndex,
  totalToProcess: chapterList.length,
} }];
`
    };

    @node({
        onError: "continueRegularOutput",