// Build WF2a (Foundation) and WF2b (Batch Outliner) from the current WF2
// Strategy: Copy the current file, then create a targeted script for each.
// 
// WF2a keeps: Form, all Template fetches, Extract Seeds, Universal Config, Debug,
//   Characters → Critique → Rewrite → SendToCharacterDoc,
//   Story Arc → Critique → Rewrite → SendToStoryDoc,
//   Worldbuilding → Critique → Rewrite → SendToWorldbuildingDoc
//   + all OllamaModels for those nodes
//
// WF2b keeps: NEW Form (chapter range), Doc fetchers (Dossier, Character, Story, Worldbuilding, Outline),
//   Extract Seeds (modified to read saved docs instead of template fetchers),
//   Universal Config, OutlinePrompts (filtered by chapter range),
//   Outline → Critique → Rewrite,
//   Enrichment pipeline → Ghostwriter Brief → Clean → PostProcess → SendToOutlineDoc
//   + all OllamaModels for those nodes

const fs = require('fs');

// Read current file
const src = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

// ============================================================
// WF2a: Foundation
// ============================================================
// Copy the whole file first, then modify the routing
let wf2a = src;

// Change the workflow class name and metadata
wf2a = wf2a.replace(
    /@workflow({\n\s*name: "[^"]*"/,
    '@workflow({\n        name: "2a - Foundation (Characters, Story Arc, Worldbuilding)"'
);

// Remove nodes that belong to WF2b only:
// These are: Outline, CritiqueOutline, RewriteOutline, EmotionalCheck,
// SciencePlotEnrichment, ContinuityChecker, SceneBreakdown, ForeshadowingPlanner,
// PovPlanner, GhostwriterBrief, CleanOutlineOutput, PostProcess,
// SendToOutlineDoc, OutlinePrompts, GetBlankOutlineDoc
// And their Ollama models: 9,10,11,13,14,12,15,16,17,18

// Actually, building WF2a/WF2b by script manipulation of a 4200-line file is extremely fragile.
// Better approach: keep WF2 as-is (it already works end-to-end), and create WF2b as a NEW
// lighter workflow that:
// 1. Has its own form with chapter_start, chapter_end
// 2. Loads foundation docs from Google Docs
// 3. Runs the enrichment pipeline
// 4. Appends to the outline doc
//
// This way WF2 continues to work as the "full run" option, and WF2b is the "batch" option.

console.log("APPROACH CHANGE: Instead of splitting, creating a NEW WF2b alongside WF2 (which remains unchanged).");
console.log("WF2 = full run (unchanged)");
console.log("WF2b = batch outliner (new workflow)");
console.log("This avoids breaking WF2 and lets the user choose which to run.");

// Creating WF2b as a NEW standalone workflow
const wf2b = `import { defineChatNode } from 'n8n-as-code';
import { node, workflow, links } from 'n8n-as-code/decorators';

@workflow({
        name: "2b - Batch Outliner (Chapter Range)",
        settings: { executionOrder: "v1" }
})
export class _2bBatchOutlinerWorkflow {

    // =====================================================================
    // FORM TRIGGER — User specifies chapter range
    // =====================================================================
    @node({
        id: "batch-form-001",
        name: "Batch Form",
        type: "n8n-nodes-base.formTrigger",
        version: 2.2,
        position: [-2400, 80]
    })
    BatchForm = {
        formTitle: "Batch Outliner — Chapter Range",
        formDescription: "Select which chapters to outline. Foundation docs (Characters, Story Arc, Worldbuilding) must already exist from WF2/WF2a.",
        formFields: {
            values: [
                { fieldLabel: "Book Title", fieldType: "text", requiredField: true, placeholder: "e.g. THE DIGITAL DRIFT" },
                { fieldLabel: "Chapter Start", fieldType: "text", requiredField: true, placeholder: "Prologue or 1" },
                { fieldLabel: "Chapter End", fieldType: "text", requiredField: true, placeholder: "3 or Epilogue" },
                { fieldLabel: "Total Chapters", fieldType: "number", requiredField: true, placeholder: "12" },
                { fieldLabel: "Words Per Chapter", fieldType: "number", requiredField: false, placeholder: "3000" },
                { fieldLabel: "Author Notes", fieldType: "textarea", requiredField: false },
                { fieldLabel: "Character Doc ID", fieldType: "text", requiredField: true, placeholder: "Google Doc ID for saved Characters" },
                { fieldLabel: "Story Arc Doc ID", fieldType: "text", requiredField: true, placeholder: "Google Doc ID for saved Story Arc" },
                { fieldLabel: "Worldbuilding Doc ID", fieldType: "text", requiredField: true, placeholder: "Google Doc ID for saved Worldbuilding" },
                { fieldLabel: "Dossier Doc ID", fieldType: "text", requiredField: true, placeholder: "Google Doc ID for Dossier from WF1" },
                { fieldLabel: "Outline Doc ID", fieldType: "text", requiredField: true, placeholder: "Google Doc ID for output (will APPEND)" },
                { fieldLabel: "Forbidden Words Doc ID", fieldType: "text", requiredField: true, placeholder: "Google Doc ID for Forbidden Words template" },
            ]
        },
        respondWith: "text",
        responseText: "Batch outliner started for chapters {{ $json['Chapter Start'] }} to {{ $json['Chapter End'] }}. Check n8n for progress."
    };

    // =====================================================================
    // LOAD FOUNDATION DOCS FROM GOOGLE
    // =====================================================================
    @node({
        id: "batch-get-dossier",
        name: "Get Dossier",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-2000, 80],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetDossier = {
        operation: "get",
        docId: "={{ $('Batch Form').first().json['Dossier Doc ID'] }}",
        simple: false
    };

    @node({
        id: "batch-get-characters",
        name: "Get Character Doc",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-1600, 80],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetCharacterDoc = {
        operation: "get",
        docId: "={{ $('Batch Form').first().json['Character Doc ID'] }}",
        simple: false
    };

    @node({
        id: "batch-get-story",
        name: "Get Story Doc",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-1200, 80],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetStoryDoc = {
        operation: "get",
        docId: "={{ $('Batch Form').first().json['Story Arc Doc ID'] }}",
        simple: false
    };

    @node({
        id: "batch-get-worldbuilding",
        name: "Get Worldbuilding Doc",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-800, 80],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetWorldbuildingDoc = {
        operation: "get",
        docId: "={{ $('Batch Form').first().json['Worldbuilding Doc ID'] }}",
        simple: false
    };

    @node({
        id: "batch-get-forbidden",
        name: "Get Forbidden Words",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-400, 80],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetForbiddenWords = {
        operation: "get",
        docId: "={{ $('Batch Form').first().json['Forbidden Words Doc ID'] }}",
        simple: false
    };

    // =====================================================================
    // EXTRACT SEEDS — Adapted for batch mode
    // =====================================================================
    @node({
        id: "batch-extract-seeds",
        name: "Extract Seeds",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [0, 80]
    })
    ExtractSeeds = {
        jsCode: \`
// --- HELPERS ---
function extractDocText(docJson) {
  if (!docJson) return "";
  try {
    const viaParagraphs = (docJson.body && docJson.body.content ? docJson.body.content : [])
      .flatMap(function(el) { return el && el.paragraph && el.paragraph.elements ? el.paragraph.elements : []; })
      .map(function(el) { return el && el.textRun && el.textRun.content ? el.textRun.content : ""; })
      .join("").trim();
    if (viaParagraphs) return viaParagraphs;
    if (typeof docJson.body === "string" && docJson.body.trim()) return docJson.body.trim();
    if (typeof docJson.text === "string" && docJson.text.trim()) return docJson.text.trim();
    if (typeof docJson.content === "string" && docJson.content.trim()) return docJson.content.trim();
    var fallback = Object.values(docJson).find(function(v) { return typeof v === "string" && v.length > 100; });
    return fallback ? fallback.trim() : "";
  } catch(e) { return ""; }
}

function extractTagContent(doc, tagName) {
  if (!doc) return [];
  var regex = new RegExp("<" + tagName + "[^>]*>([\\\\s\\\\S]*?)<\\\\/" + tagName + ">", "gi");
  var matches = [];
  var m;
  while ((m = regex.exec(doc)) !== null) {
    var items = m[1].split(/[\\n,]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 1; });
    matches = matches.concat(items);
  }
  return matches;
}

// --- FORM ---
var form = $("Batch Form").first().json;
var title = (form["Book Title"] || "UNTITLED").trim().toUpperCase();
var authorNotes = form["Author Notes"] || "";

// --- FOUNDATION DOCS (loaded from Google) ---
var dossier        = extractDocText($("Get Dossier").first().json);
var characterDoc   = extractDocText($("Get Character Doc").first().json);
var storyArcDoc    = extractDocText($("Get Story Doc").first().json);
var worldbuildingDoc = extractDocText($("Get Worldbuilding Doc").first().json);

// --- FORBIDDEN WORDS ---
var forbiddenWords = extractDocText($("Get Forbidden Words").first().json);
var forbiddenNamesList = extractTagContent(forbiddenWords, "forbidden_names");
var forbiddenPhrasesList = extractTagContent(forbiddenWords, "forbidden_phrases");
var forbiddenVocabList = extractTagContent(forbiddenWords, "forbidden_vocabulary");
var forbiddenVerbsList = extractTagContent(forbiddenWords, "forbidden_verbs_and_actions");
var forbiddenDialogueList = extractTagContent(forbiddenWords, "forbidden_dialogue_patterns");
var forbiddenQuirkList = extractTagContent(forbiddenWords, "forbidden_quirk_patterns");

var entityNames = extractTagContent(dossier, "entity_names");
var worldNouns = extractTagContent(dossier, "world_nouns");
var canonicalTags = [];

// --- OUTPUT ---
return [{ json: {
  title: title,
  authorNotes: authorNotes,
  dossier: dossier,
  characterDoc: characterDoc,
  storyArcDoc: storyArcDoc,
  worldbuildingDoc: worldbuildingDoc,
  forbiddenWords: forbiddenWords,
  forbiddenNamesList: forbiddenNamesList,
  forbiddenPhrasesList: forbiddenPhrasesList,
  forbiddenVocabList: forbiddenVocabList,
  forbiddenVerbsList: forbiddenVerbsList,
  forbiddenDialogueList: forbiddenDialogueList,
  forbiddenQuirkList: forbiddenQuirkList,
  entityNames: entityNames,
  worldNouns: worldNouns,
  canonicalTags: canonicalTags,
  chapterStart: form["Chapter Start"] || "Prologue",
  chapterEnd: form["Chapter End"] || "Epilogue",
  totalChapters: parseInt(form["Total Chapters"], 10) || 12,
  wordsPerChapter: parseInt(form["Words Per Chapter"], 10) || 3000,
  outlineDocId: form["Outline Doc ID"] || "",
}}];
\`
    };

    // =====================================================================
    // OUTLINE PROMPTS — Batch-aware (filtered chapter range)
    // =====================================================================
    @node({
        id: "batch-outline-prompts",
        name: "Outline Prompts",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [400, 80]
    })
    OutlinePrompts = {
        jsCode: \`
var seeds = $("Extract Seeds").first().json;

var chStart = seeds.chapterStart;
var chEnd   = seeds.chapterEnd;
var totalChapters = seeds.totalChapters;
var wordsPerChapter = seeds.wordsPerChapter;

// Build chapter list for this batch
var chapters = [];
var startNum = chStart.toLowerCase() === "prologue" ? 0 : parseInt(chStart, 10);
var endNum   = chEnd.toLowerCase() === "epilogue" ? totalChapters + 1 : parseInt(chEnd, 10);

if (startNum === 0) chapters.push("Prologue");
for (var i = Math.max(1, startNum); i <= Math.min(totalChapters, endNum); i++) {
  chapters.push(String(i));
}
if (endNum > totalChapters) chapters.push("Epilogue");

var chaptersToOutline = chapters.join(",");

// Build prompt using loaded foundation docs
var prompt = \\\`
<system_constraints>
  <prose_jail>Do not use generic AI phrasing. Write with specificity.</prose_jail>
  <forbidden_words>\\\${seeds.forbiddenWords}</forbidden_words>
  <entity_names>\\\${seeds.entityNames.join(", ")}</entity_names>
</system_constraints>

<world_context>
  <dossier_source>\\\${seeds.dossier}</dossier_source>
  <characters>\\\${seeds.characterDoc}</characters>
  <worldbuilding>\\\${seeds.worldbuildingDoc}</worldbuilding>
</world_context>

<narrative_spine>
  <story_so_far>\\\${seeds.storyArcDoc}</story_so_far>
  <author_notes>\\\${seeds.authorNotes}</author_notes>
</narrative_spine>

You are a master outliner for novel fiction. Generate a detailed chapter outline for chapters: \\\${chaptersToOutline}.

### CRITICAL CAST GROUNDING
- EVERY character name MUST come from the CHARACTERS section above.
- Your PROTAGONIST is the character with role "protagonist" in CHARACTERS. Use their EXACT NAME.
- Do NOT invent any new characters.

### CHAPTER DETAIL LEVEL
- Clearly state who is in the scene, where it happens, and what systemic friction creates the conflict.
- Name at least one specific world mechanic, location, or constraint from WORLDBUILDING per chapter.
- End with a sharp hook that pulls the reader into the next chapter.
- Every named character must come from the CHARACTERS section above. Do NOT introduce new characters.
- Do not use any word or phrase from FORBIDDEN WORDS or PROSE JAIL.

### OUTPUT FORMAT (MARKDOWN)
\\\${chapters.includes("Prologue") ? "### PROLOGUE: [Title]\\n**Opening Image:** [First visual moment]\\n[2-3 dense paragraphs of tactical beats.]\\n**Closing Hook:** [Tension point into Chapter 1]\\n" : ""}
### CHAPTER [NUMBER]: [Title]
**Opening Image:** [First visual or sensory moment]
[3-5 dense paragraphs, totalling at least \\\${wordsPerChapter} words, describing the tactical beats.]
**Closing Hook:** [Tension point into next chapter]

\\\${chapters.includes("Epilogue") ? "### EPILOGUE: [Title]\\n**Opening Image:** [First visual moment of aftermath]\\n[1-2 dense paragraphs. Thematic closure.]\\n" : ""}

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English.
\\\`;

return [{ json: {
  prompt: prompt,
  total_chapters: totalChapters,
  chapter_start: chStart,
  chapter_end: chEnd,
  chapters_in_batch: chaptersToOutline,
  words_per_chapter: wordsPerChapter,
  outline_doc_id: seeds.outlineDocId
}}];
\`
    };

    // =====================================================================
    // LLM CHAIN — Outline (batch)
    // =====================================================================
    @node({
        id: "batch-outline",
        name: "Outline",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [800, 80]
    })
    Outline = {
        promptType: "define",
        text: \`={{ $json.prompt }}\`
    };

    // =====================================================================
    // ENRICHMENT PIPELINE — Scene Breakdown + Ghostwriter Brief (streamlined for batch)
    // =====================================================================
    @node({
        id: "batch-scene-breakdown",
        name: "Scene Breakdown",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [1200, 80]
    })
    SceneBreakdown = {
        promptType: "define",
        text: \`=You are a scene architect. Decompose each chapter into discrete scenes.

CAST MANIFEST:
{{ $("Extract Seeds").first().json.characterDoc }}

OUTLINE:
{{ $('Outline').first().json.text || '[ERROR: No outline]' }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

CRITICAL: ALL character names MUST come from CAST MANIFEST. Do NOT invent new characters.

For each chapter, identify 2-5 scenes. Each scene must have:
**Scene [N]:**
- Setting: [specific location from worldbuilding]
- Characters: [names from cast manifest]
- Goal: [what the focal character wants]
- Conflict: [what opposes the goal]
- Beat Sequence: [2-4 micro-beats]
- Exit Hook: [how the scene ends]
- Word Budget: [estimated word count]
- Pacing: [action / tension / reflection / transition]
- Scene Weight: [major / supporting / transitional]

Cover ALL chapters in the outline. Do not skip any.\`
    };

    @node({
        id: "batch-ghostwriter",
        name: "Ghostwriter Brief",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [1600, 80]
    })
    GhostwriterBrief = {
        promptType: "define",
        text: \`=You are a master ghostwriter coordinator. Synthesise all data into a definitive per-chapter writing brief.

CAST MANIFEST:
{{ $("Extract Seeds").first().json.characterDoc }}

WORLDBUILDING:
{{ $("Extract Seeds").first().json.worldbuildingDoc }}

STORY ARC:
{{ $("Extract Seeds").first().json.storyArcDoc }}

OUTLINE:
{{ $('Outline').first().json.text || '[ERROR: No outline]' }}

SCENE BREAKDOWN:
{{ $('Scene Breakdown').first().json.text || '[No scene breakdown]' }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

CRITICAL: EVERY character name MUST appear in CAST MANIFEST. Cross-check before finalising.

For each chapter compile:
---
## CHAPTER [NUMBER]: [Title]

### Structural Layer
[plot beats, characters present, locations]

### Scene Layer
[scenes with goals, conflicts, exit hooks, word budgets, pacing]

### Voice Layer
[POV character, narrative distance, tonal register]

### Dialogue Map
- Speaking characters: [names in order of screen-time]
- Dialogue ratio: [heavy / balanced / narration-heavy]
- Key exchange: [most important dialogue beat]

### Emotional Layer
[emotional arc: opening -> climax -> closing state]

### Prose Directives
[forbidden words reminder, constraints]

### Handoff to Next Chapter
- Open threads: [unresolved threads next chapter MUST address]
- Character positions: [where each character is at chapter end]
- Knowledge states: [what each character knows by chapter end]
- Time position: [when this chapter ends]
- Props: [objects introduced or moved]
- Emotional carryover: [dominant unresolved emotion]
---
[Repeat for every chapter in this batch.]

Hard Constraints:
- Include ALL chapters in this batch.
- Do not use any word from FORBIDDEN WORDS.
- Every name must trace to CAST MANIFEST.\`
    };

    // =====================================================================
    // CLEAN OUTPUT + SAVE
    // =====================================================================
    @node({
        id: "batch-clean-output",
        name: "Clean Output",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [2000, 80]
    })
    CleanOutput = {
        jsCode: \`
var outline = $('Outline').first().json.text || "";
var sceneBreakdown = $('Scene Breakdown').first().json.text || "";
var ghostwriterBrief = $('Ghostwriter Brief').first().json.text || "";
var seeds = $("Extract Seeds").first().json;

var batchHeader = "\\n\\n---\\n## BATCH: Chapters " + seeds.chapterStart + " to " + seeds.chapterEnd + "\\n---\\n\\n";
var combined = batchHeader + ghostwriterBrief;

return [{ json: {
  text: combined,
  outline_doc_id: seeds.outlineDocId,
  batch_label: "Ch " + seeds.chapterStart + " - " + seeds.chapterEnd,
}}];
\`
    };

    @node({
        id: "batch-send-to-doc",
        name: "Append to Outline Doc",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [2400, 80],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    AppendToOutlineDoc = {
        operation: "update",
        docId: "={{ $json.outline_doc_id }}",
        actions: {
            values: [
                {
                    action: "insert",
                    text: "={{ $json.text }}",
                    locationChoice: "endOfBody"
                }
            ]
        }
    };

    // =====================================================================
    // OLLAMA MODELS
    // =====================================================================
    @node({
        id: "batch-ollama-outline",
        name: "Ollama - Outline",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [800, 288],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaOutline = {
        model: "qwen3:32b",
        options: { temperature: 0.6, numCtx: 32768 }
    };

    @node({
        id: "batch-ollama-scene",
        name: "Ollama - Scene",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [1200, 288],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaScene = {
        model: "qwen3:32b",
        options: { temperature: 0.5, numCtx: 32768 }
    };

    @node({
        id: "batch-ollama-ghostwriter",
        name: "Ollama - Ghostwriter",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [1600, 288],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaGhostwriter = {
        model: "qwen3:32b",
        options: { temperature: 0.4, numCtx: 65536 }
    };

    // =====================================================================
    // ROUTING
    // =====================================================================
    @links()
    defineRouting() {
        // Data flow
        this.BatchForm.out(0).to(this.GetDossier.in(0));
        this.GetDossier.out(0).to(this.GetCharacterDoc.in(0));
        this.GetCharacterDoc.out(0).to(this.GetStoryDoc.in(0));
        this.GetStoryDoc.out(0).to(this.GetWorldbuildingDoc.in(0));
        this.GetWorldbuildingDoc.out(0).to(this.GetForbiddenWords.in(0));
        this.GetForbiddenWords.out(0).to(this.ExtractSeeds.in(0));
        this.ExtractSeeds.out(0).to(this.OutlinePrompts.in(0));
        this.OutlinePrompts.out(0).to(this.Outline.in(0));
        this.Outline.out(0).to(this.SceneBreakdown.in(0));
        this.SceneBreakdown.out(0).to(this.GhostwriterBrief.in(0));
        this.GhostwriterBrief.out(0).to(this.CleanOutput.in(0));
        this.CleanOutput.out(0).to(this.AppendToOutlineDoc.in(0));

        // LLM connections
        this.Outline.uses({
            ai_languageModel: this.OllamaOutline.output
        });
        this.SceneBreakdown.uses({
            ai_languageModel: this.OllamaScene.output
        });
        this.GhostwriterBrief.uses({
            ai_languageModel: this.OllamaGhostwriter.output
        });
    }
}
`;

fs.writeFileSync('2b - Batch Outliner.workflow.ts', wf2b);
console.log('Created: 2b - Batch Outliner.workflow.ts');
console.log('Lines:', wf2b.split('\n').length);
console.log('');
console.log('WF2 (original) remains unchanged — still works as full run.');
console.log('WF2b is a NEW streamlined batch workflow with:');
console.log('  - Form with chapter_start, chapter_end, doc IDs');
console.log('  - Loads foundation docs from Google');
console.log('  - Outline -> Scene Breakdown -> Ghostwriter Brief pipeline');
console.log('  - APPENDS to outline doc (not replaces)');
console.log('  - All character grounding instructions baked in');
