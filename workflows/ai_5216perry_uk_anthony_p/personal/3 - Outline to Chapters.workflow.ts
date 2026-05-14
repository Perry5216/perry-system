import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : 3 - Outline to Chapters
// Nodes   : 38  |  Connections: 27
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// GetProseStyle                      googleDocs                 [creds]
// LoopOverItems                      splitInBatches
// ReplaceMe                          noOp
// FindChapterNamesInJson             agent                      [AI]
// ParseChapterNames                  code
// SceneBrief                         agent                      [AI]
// FirstDraft                         agent                      [AI]
// ImprovementPlan                    agent                      [AI]
// Rewrite                            agent                      [AI]
// FinalPolish                        agent                      [AI]
// CleanChapterOutput                 code
// AddChapterToDocument               httpRequest
// GetLast2000Words1                  googleDocs                 [creds]
// GetLast2000Words2                  code
// OnFormSubmission                   formTrigger
// GetCharacterSheet                  googleDocs                 [creds]
// GetWorldbuilding                   googleDocs                 [creds]
// GetOutline                         googleDocs                 [creds]
// GetBlankFirstDraftDoc              googleDocs                 [creds]
// OllamaChatModel1                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel                    lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel2                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel3                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel4                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel5                   lmChatOllama               [creds] [ai_languageModel]
// GetCharacterEmotionTemplate        googleDocs                 [creds]
// ForbiddenWords                     googleDocs                 [creds]
// GetThemesTemplate                  googleDocs                 [creds]
// ExtractSeeds                       code
// UniversalConfig                    code
// QdrantContinuityLedger             vectorStoreQdrant          [AI] [creds] [ai_tool]
// EmbeddingsContinuity               embeddingsOllama           [creds] [ai_embedding]
// ExtractContinuityFacts             agent                      [AI]
// IngestModel                        lmChatOllama               [creds] [ai_languageModel]
// ParseFacts                         code
// QdrantIngest                       vectorStoreQdrant          [AI] [creds]
// EmbeddingsIngest                   embeddingsOllama           [creds] [ai_embedding]
// IngestDataLoader                   documentDefaultDataLoader  [ai_document]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// OnFormSubmission
//    → GetProseStyle
//      → ForbiddenWords
//        → GetCharacterSheet
//          → GetThemesTemplate
//            → GetCharacterEmotionTemplate
//              → GetWorldbuilding
//                → GetOutline
//                  → GetBlankFirstDraftDoc
//                    → ExtractSeeds
//                      → UniversalConfig
//                        → FindChapterNamesInJson
//                          → ParseChapterNames
//                            → LoopOverItems
//                              → GetLast2000Words1
//                                → GetLast2000Words2
//                                  → SceneBrief
//                                    → FirstDraft
//                                      → ImprovementPlan
//                                        → Rewrite
//                                          → FinalPolish
//                                            → CleanChapterOutput
//                                              → AddChapterToDocument
//                                                → ExtractContinuityFacts
//                                                  → ParseFacts
//                                                    → QdrantIngest
//                                                      → LoopOverItems (↩ loop)
//                             .out(1) → ReplaceMe
//
// AI CONNECTIONS
// OllamaChatModel1.uses({ ai_languageModel: FindChapterNamesInJson })
// OllamaChatModel.uses({ ai_languageModel: SceneBrief })
// QdrantContinuityLedger.uses({ ai_tool: [QdrantContinuityLedger] })
// OllamaChatModel2.uses({ ai_languageModel: FirstDraft })
// OllamaChatModel3.uses({ ai_languageModel: ImprovementPlan })
// OllamaChatModel4.uses({ ai_languageModel: Rewrite })
// OllamaChatModel5.uses({ ai_languageModel: FinalPolish })
// EmbeddingsContinuity.uses({ ai_embedding: QdrantContinuityLedger })
// IngestModel.uses({ ai_languageModel: ExtractContinuityFacts })
// EmbeddingsIngest.uses({ ai_embedding: QdrantIngest })
// IngestDataLoader.uses({ ai_document: [IngestDataLoader] })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'xeqjjyJiebrGV51h',
    name: '3 - Outline to Chapters',
    active: false,
    settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
})
export class _3OutlineToChaptersWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: 'd24c04a0-e654-4b5f-89cb-28015d078d16',
        name: 'Get Prose Style',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-4304, 416],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetProseStyle = {
        operation: 'get',
        documentURL: '1hNxnOT7Y1MLyTNxZX2qKPRgUzfiICUctNxEFbUOvU6U',
    };

    @node({
        id: '32de6f59-98e0-4cf9-9976-dc5e23cbce33',
        name: 'Loop Over Items',
        type: 'n8n-nodes-base.splitInBatches',
        version: 3,
        position: [-1232, 352],
    })
    LoopOverItems = {
        options: {
            reset: false,
        },
    };

    @node({
        id: '8bbc2afd-342f-4bd0-aca1-bae476aa7c85',
        name: 'Replace Me',
        type: 'n8n-nodes-base.noOp',
        version: 1,
        position: [2352, 672],
    })
    ReplaceMe = {};

    @node({
        id: 'b3c09798-ffaf-4c59-bb61-36d2bad9c98e',
        name: 'Find Chapter Names (in JSON)',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 2.2,
        position: [-2208, 400],
    })
    FindChapterNamesInJson = {
        promptType: 'define',
        text: `=<ghostwriter_brief>
{{ $('Get Outline').item.json.content }}
</ghostwriter_brief>

<instructions>
You are a parser. The above document is a structured multi-layer ghostwriter brief produced by an earlier workflow stage. Each chapter begins with a Markdown heading formatted as "## CHAPTER N: Title" (e.g. "## CHAPTER 1: The Arrival"), or special chapters like "## Prologue" or "## Epilogue".

Your task: locate every such ## heading and return a JSON object with a single key "chapters" whose value is an array of those heading strings -- with the leading "## " stripped. Include the chapter number and full title where present. Do not include any sub-headings (### or deeper).

Example output:
{"chapters": ["CHAPTER 1: The Arrival", "CHAPTER 2: Into the Dark", "Epilogue"]}

In this specific instance, I only want you to do Chapters 1 through 3.

Output only valid JSON. No explanation, no code fences, no markdown wrapper.
</instructions>
`,
        options: {},
    };

    @node({
        id: '91bf75e1-9f76-447f-82a4-e6cb10253918',
        name: 'Parse Chapter Names',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-1760, 352],
    })
    ParseChapterNames = {
        jsCode: `// Expect: incoming item has a string field \`output\` that contains JSON or quasi-JSON
// Goal: produce one item per chapter as { chapter: "..." }

function extractJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();

  // Strip code fences \`\`\`\`\`\`json
  s = s.replace(/^\`\`\`\`\`\`$/i, '').trim();

  // If it starts with "json", slice from first "{"
  if (s.toLowerCase().startsWith('json')) {
    const idx = s.indexOf('{');
    if (idx !== -1) s = s.slice(idx).trim();
  }

  // Sometimes content is like: json: "{ \\"chapters\\": [ ... ] }" (a JSON string of JSON)
  // Try first parse
  try {
    const first = JSON.parse(s);
    // If we parsed a string, try parsing again (double-encoded JSON)
    if (typeof first === 'string') {
      try {
        return JSON.parse(first);
      } catch {
        return first; // at least return the string
      }
    }
    return first;
  } catch {
    // If parsing failed, try to locate the first {...} block heuristically
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const candidate = s.slice(start, end + 1);
      try {
        const obj = JSON.parse(candidate);
        return obj;
      } catch {
        // Fall through
      }
    }
  }
  return null;
}

// 1) Read incoming text
const text = $json.output;

// 2) Extract JSON object
const obj = extractJson(text);
if (!obj || !obj.chapters || !Array.isArray(obj.chapters)) {
  throw new Error('Could not parse chapters JSON from previous node. Confirm the output contains a top-level "chapters" array.');
}

// 3) Normalize and emit one item per chapter
const out = [];
for (const raw of obj.chapters) {
  if (typeof raw !== 'string') continue;
  const title = raw.trim();
  if (!title) continue;
  out.push({ json: { chapter: title } });
}

return out;
`,
    };

    @node({
        id: '15fb6d9e-1c4a-4bce-9203-0232184599ab',
        name: 'Scene Brief',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 2.2,
        position: [0, 0],
    })
    SceneBrief = {
        promptType: 'define',
        text: `=<ghostwriter_brief>
{{ $('Get Outline').item.json.content }}
</ghostwriter_brief>

<characters>
{{ $('Get Character Sheet').item.json.content }}
</characters>

<worldbuilding>
{{ $('Get Worldbuilding').item.json.content }}
</worldbuilding>

<character_emotion_template>
{{ $('Get Character emotion template').item.json.content }}
</character_emotion_template>

<conflict_doctrine>
{{ $('Universal Config').item.json.conflict_full || 'No conflict doctrine available.' }}
</conflict_doctrine>

<voice_doctrine>
{{ $('Universal Config').item.json.voice_full || 'No voice doctrine available.' }}
</voice_doctrine>

<backstory_doctrine>
{{ $('Universal Config').item.json.backstory_full || 'No backstory doctrine available.' }}
</backstory_doctrine>

<location_doctrine>
{{ $('Universal Config').item.json.location_full || 'No location doctrine available.' }}
</location_doctrine>

<faction_doctrine>
{{ $('Universal Config').item.json.faction_full || 'No faction doctrine available.' }}
</faction_doctrine>

<emotion_system_guardrails>
{{ $('Universal Config').item.json.emotion_guardrails }}
</emotion_system_guardrails>

<previous_chapter_text>
{{ $('Get Last 2000 Words 2').item.json.last_2k_words }}
</previous_chapter_text>

<previous_chapter_resolution>
{{ $('Get Last 2000 Words 2').item.json.last_scene_resolution || 'No prior scene resolution recorded. Use the Ã‚Â§4 Act Baseline stats from character_emotion_template as the starting point.' }}
</previous_chapter_resolution>

<instructions>
The <ghostwriter_brief> above is a structured multi-layer document produced by a prior workflow stage. It contains a detailed pre-built brief for each chapter covering: Structural Layer (plot beats), Scene Breakdown Layer, Foreshadowing and Payoff Layer, Voice and POV Layer, Emotional Arc Layer, and Prose Direction Layer.

Your task is to produce a complete, production-ready Scene Brief for the chapter writer to use when drafting "{{ $('Loop Over Items').item.json.chapter }}".

--- STEP 1: EXTRACT THE PRE-BUILT BRIEF ---
Locate the section for "{{ $('Loop Over Items').item.json.chapter }}" in the ghostwriter_brief and reproduce ALL SIX LAYERS of that section verbatim. Do not summarise or paraphrase them -- they are authoritative. Label this section clearly: "## PRE-BUILT BRIEF (from Ghostwriter Brief doc)".

--- STEP 1.5: QUERY CONTINUITY LEDGER ---
Before proceeding to production staging, use the continuity_ledger tool to retrieve relevant facts from all previous chapters. You MUST make at least these queries:
1. Query for EACH character who appears in this chapter — retrieve their latest states, injuries, possessions, and past actions.
2. Query for the location/setting of this chapter — retrieve any established world rules, geography, or environmental details.
3. Query for any plot threads, foreshadowing, or unresolved events mentioned in the outline for this chapter.
If the continuity_ledger returns no results (e.g. this is the first chapter or the ledger is empty), note that and proceed.
Compile ALL retrieved facts into a section labelled "## CONTINUITY LEDGER CONTEXT". These facts are authoritative — they override assumptions and must be respected in all subsequent staging.

--- STEP 2: ADD PRODUCTION STAGING DETAILS ---
Now supplement the pre-built brief with the following, labelled "## PRODUCTION STAGING":

POV and Voice: First Person past tense from the perspective of Elaine. Confirm or refine the justification based on the Emotional Arc layer you extracted above.

Character Emotion Header: Before writing any staging, build each character's CURRENT stat snapshot using this sequence: (1) Start from the Ã‚Â§4 Act Baseline for the current act in <character_emotion_template>. (2) Apply ALL stat deltas from <previous_chapter_resolution> in order -- if a character entry says '[stat] -2', subtract 2 from that character's stat. If it says 'moodlet_added [name]', add that moodlet as active. If it says 'moodlet_expired [name]', remove it. (3) Using the resulting updated stats, identify: (a) active stats in Ã‚Â§1 Core Stats that are at a critical threshold, (b) any moodlets or cascade conditions from Ã‚Â§3 now triggered, (c) the Ã‚Â§8 Internal Voice Map register this character is CURRENTLY in based on those updated stats (per the registers in <emotion_system_guardrails>), (d) any active entries in the Ã‚Â§6 Memory Ledger that may fire as modifiers in this chapter. (4) If <previous_chapter_resolution> says 'No prior scene resolution', use the Ã‚Â§4 Act 1 baseline stats directly. This filled snapshot IS the scene driver -- stats accumulate and change across chapters, and every character action, dialogue choice, and internal thought must be consistent with their CURRENT (updated) stats. Label this section: "## CHARACTER EMOTION HEADER".

Previous Chapter Continuity: Based on the <previous_chapter_text>, specify exactly how this chapter should open to feel like a seamless continuation -- reference specific last images, emotions, or actions from that text. (Skip entirely if first chapter and no previous text exists.)

Blocking Per Beat: For each plot beat in the Structural Layer, add a physical blocking note -- describe how characters and objects are positioned in space, how they move, and what physical actions they perform in relation to each other and their environment.

Character States (this chapter only): For each character appearing in this chapter, provide:
  - Physical Appearance: clothing, posture, visible wear specific to this scene
  - Emotional State and Goals: what they feel and want in this moment; how it shapes dialogue, reactions, and inner thought
  - Behavioural Notes: specific gestures, speech patterns, or tics shaped by their current mood and stakes

Sensory Setting: Describe the environment with sensory-rich language -- time of day, terrain, sounds, smells, lighting, weather, temperature, and ambient details that lock the tone.

Tone and Dialogue Cadence: Specify the exact pacing and rhythm of dialogue interactions (e.g. fast/clipped/tense vs slow/wary/intimate). Reference specific character pairings if the cadence shifts between them.

Continuity Flags: List any specific items, emotional threads, worldbuilding rules, or foreshadowing plants from earlier chapters that must remain consistent or be paid off here.

ANTI-HALLUCINATION RULES (MANDATORY):
- Only reference characters, locations, organisations, and world details that appear verbatim in the <characters>, <worldbuilding>, or <ghostwriter_brief> source documents. Do NOT invent any name, place, magical ability, item, organisation, or historical fact not present in those documents.
- Do NOT add plot events, encounters, or beats that are not specified in the Structural Layer for {{ $('Loop Over Items').item.json.chapter }}. The Structural Layer is the complete and final list of what happens in this chapter.
- Do NOT reference events from chapters other than {{ $('Loop Over Items').item.json.chapter }} unless they explicitly appear in the Continuity Flags or Foreshadowing layer for this chapter.
- If a detail is absent or ambiguous in the source documents, omit it entirely rather than fill the gap with invented content.

- DOCTRINE COMPLIANCE: Staging notes must conform to <conflict_doctrine> for tension structure, <voice_doctrine> for character voice, <backstory_doctrine> for reveal timing, and <location_doctrine> for setting details. If a doctrine is empty, skip that constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in <emotion_system_guardrails>. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.
</instructions>
`,
        options: {},
    };

    @node({
        id: 'd250acd6-f3cf-4daf-8f42-04f84561970d',
        name: 'First Draft',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 2.2,
        position: [384, 0],
    })
    FirstDraft = {
        promptType: 'define',
        text: `=<style_sheet>
{{ $('Get Prose Style').item.json.content }}
</style_sheet>
<prohibited_words>
{{ $('Forbidden Words').item.json.content }}
</prohibited_words>

<full_context>
<outline>
{{ $('Get Outline').item.json.content }}
</outline>

<characters>
{{ $('Get Character Sheet').item.json.content }}
</characters>

<worldbuilding>
{{ $('Get Worldbuilding').item.json.content }}
</worldbuilding>
</full_context>

<character_emotion_template>
{{ $('Get Character emotion template').item.json.content }}
</character_emotion_template>

<conflict_doctrine>
{{ $('Universal Config').item.json.conflict_full || 'No conflict doctrine available.' }}
</conflict_doctrine>

<voice_doctrine>
{{ $('Universal Config').item.json.voice_full || 'No voice doctrine available.' }}
</voice_doctrine>

<backstory_doctrine>
{{ $('Universal Config').item.json.backstory_full || 'No backstory doctrine available.' }}
</backstory_doctrine>

<location_doctrine>
{{ $('Universal Config').item.json.location_full || 'No location doctrine available.' }}
</location_doctrine>

<faction_doctrine>
{{ $('Universal Config').item.json.faction_full || 'No faction doctrine available.' }}
</faction_doctrine>

<emotion_system_guardrails>
{{ $('Universal Config').item.json.emotion_guardrails }}
</emotion_system_guardrails>

<previous_chapter_text>
{{ $('Get Last 2000 Words 2').item.json.last_2k_words }}
</previous_chapter_text>

<scene_brief>
{{ $('Scene Brief').item.json.output }}
</scene_brief>

<instructions>
Your task is to write the entire "{{ $('Loop Over Items').item.json.chapter }}" based on the scene brief, and to cover it thoroughly, from deep point of view, writing the scene as if written by a bestselling novelist, and not rushing through the scene. Use the <style_sheet> samples to know what the prose style of your chapter should be. The chapter should be as long as it needs to be to properly flesh everything out. Pay special care to show deep point of view and showing not telling, in order to fully flesh out the scene without skipping over important details. The reader should feel that they are fully immersed in the scene, seeing the events through the lens of the viewpoint character, rather than being simply told what happened.
Always keep the following rules in mind:
-Style Guide: It is important that your output have a similar prose style to the prose style examples and style guide above.
-Word Count: The scene should be roughly 3000 words long.
-Previous Chapter Text: this new chapter should pick up appropriately following the end of the previous chapter, with no repeats of moments that have already been covered in the last chapter. (not applicable if you are writing the first chapter and there is no data for the previous chapter text yet.)
-Absolutely do NOT use em-dashes. Use commas or ... instead.
-Avoid starting multiple sentences in a row with the same word.
-Don't use any of the words in the <prohibited_words> list.
-Convey events and story through dialogue where possible.
-Avoid mushy dialog and descriptions, have dialogue always continue the action, never stall or add unnecessary fluff. Vary the descriptions to not repeat yourself.
-DO NOT use metaphors in the prose.
-NEVER conclude the scene on your own, follow the beat instructions very closely. NEVER end with foreshadowing. NEVER write further than what I prompt you with. AVOID imagining possible endings, NEVER deviate from the instructions.
-Character Voice Alignment: The <scene_brief> contains a CHARACTER EMOTION HEADER. Every character's internal voice, dialogue register, and behavioral reactions MUST match their Ã‚Â§8 voice register stated there. Render each register's prose style as described in Ã‚Â§8 of <character_emotion_template>. Never let a character speak or think in a register inconsistent with their current stat profile.
-Stat Continuity: The prose must implicitly show each character's stat state through behavior, not by naming the stats. When a character's moodlet fires, render it as a physical or behavioral response Ã¢â‚¬â€ never state "she felt X" directly.
-Vary paragraph length.
-Do not use the same words for multiple sentences in a row, including pronouns like he/she/it.
-Vary sentence length. Don't have too many short or long sentences in a row. Use mixed cadence so there is a blend of longer and shorter sentences.

Format the output using Markdown as needed.

ANTI-HALLUCINATION RULES (MANDATORY):
- The <scene_brief> is the sole authority for what happens in this chapter. Write ONLY the beats listed there. Do NOT add plot events, new reveals, new encounters, or new character introductions that are not in the scene brief.
- Every character name, location, magical ability, organisation, and worldbuilding fact you write must exist in the <characters>, <worldbuilding>, or <outline> documents. Do NOT invent any name, place, ability, or lore detail.
- Do NOT resolve, hint at, or foreshadow events from future chapters beyond what the Foreshadowing layer in the scene brief explicitly specifies.
- End the chapter exactly where the final beat in the scene brief ends. Do NOT continue past that point, add a closing reflection, or write a transition into the next chapter.
- If you are unsure whether a detail exists in the source documents, omit it rather than invent it.

- DOCTRINE COMPLIANCE: Prose voice must conform to <conflict_doctrine>, <voice_doctrine>, and location/setting details must conform to <location_doctrine>. If a doctrine is empty, skip that constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in <emotion_system_guardrails>. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.
</instructions>`,
        options: {},
    };

    @node({
        id: '1b2e6f0f-325a-48b1-ad06-cb912995c1bf',
        name: 'Improvement Plan',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 2.2,
        position: [784, 0],
    })
    ImprovementPlan = {
        promptType: 'define',
        text: `=<previous_chapter_text>
{{ $('Get Last 2000 Words 2').item.json.last_2k_words }}
</previous_chapter_text>

<chapter>
{{ $('First Draft').item.json.output }}
</chapter>

<scene_brief>
{{ $('Scene Brief').item.json.output }}
</scene_brief>

<conflict_doctrine>
{{ $('Universal Config').item.json.conflict_full || 'No conflict doctrine available.' }}
</conflict_doctrine>

<voice_doctrine>
{{ $('Universal Config').item.json.voice_full || 'No voice doctrine available.' }}
</voice_doctrine>

<backstory_doctrine>
{{ $('Universal Config').item.json.backstory_full || 'No backstory doctrine available.' }}
</backstory_doctrine>

<location_doctrine>
{{ $('Universal Config').item.json.location_full || 'No location doctrine available.' }}
</location_doctrine>

<faction_doctrine>
{{ $('Universal Config').item.json.faction_full || 'No faction doctrine available.' }}
</faction_doctrine>

<emotion_system_guardrails>
{{ $('Universal Config').item.json.emotion_guardrails }}
</emotion_system_guardrails>

<prose_style_example>
{{ $('Get Prose Style').item.json.content }}
</prose_style_example>

<prohibited_words>
{{ $('Forbidden Words').item.json.content }}
</prohibited_words>

<instructions>
Given the above chapter, I want you to critique the chapter on a line-by-line basis and find ways to improve the chapter. Give specific examples. Here are a few things to look out for:

-Show vs Tell: Highlight areas that are telling instead of showing, or not demonstrating good deep point of view for the character. Highlight exposition blocks for sensory or active-scene rewrites.
-Cliches: Highlight common cliches, and other signs of bad writing on the sentence level.
-Metaphors: Identify any metaphors and instruct them to be removed.
-Adverbs: Identify any over-reliance on adverbs.
-Dialogue Tags: Identify dialogue tags that are not "said" or "asked". Make suggestions for which ones should be changed to "said" or "asked".
-Passive Voice: Flag instances of passive voice.
-Zero Fluff: Highlight overly wordy sentences and paragraphs/areas where you could reduce fluff, as well as instances of mushy dialogue or descriptions.
-Prose Sample: Give instructions on how to make the text more like the prose style example text above.
-Voice Check: Compare each major/recurring character's dialogue and behavior against their established profile; flag off-character moments.
-Dialogue Cliches: Flag any lines or patterns of dialogue that appear cliche or overused in writing, especially in AI writing.
-Motivation Alignment: Ensure each action drives plot or character growth.
-Minor Characters: Verify new or returning minor characters match previously defined traits or enrich them without contradiction.
-Open Questions: Note any unclear motives, logic gaps, or plot holes.
-Ending: Did the text end where the scene brief said it should? If not, specify where the chapter should end.
-Beginning: Did the text begin in a way that feels like a natural continuation from the previous_chapter_text? If not, specify how it should begin.
-Reader Experience: Provide a Takeaway -- does the chapter leave readers eager for the next installment?
Overall, your most important task is to identify these problem areas, as well as any instances where the text sounds like it was AI-written or used any of the words in the <prohibited_words> list. The goal is to identify ways to make the text sound more human and natural. Once you have identified ways to do this, make a plan to improve the text. Give specific examples and recommendations.
-Repeat first words: Are there multiple sentences in a row (or multiple paragraphs in a row) that all start off with the same word? (Note, this is often the case with pronouns like he/she/it.)
-Sentence length: Note opportunities where there are too many short sentences next to each other, and which ones could be combined. Also note too many lengthy sentences. The goal is to have a mixture of shorter and longer sentences. Identify the paragraphs where there are too many short sentences, and in your plan, mention that some of those sentences (but not all) should be combined in order to vary the sentence length in that paragraph.
-Stat-Voice Alignment: Cross-reference the CHARACTER EMOTION HEADER in <scene_brief> against the prose. Does each character's internal narration, dialogue register, and behavioral reactions match their stated Ã‚Â§8 voice register? Flag any passage where a character's prose voice contradicts the Ã‚Â§8 register thresholds described in <character_emotion_template>. Flag -- do not rewrite, only identify the misalignment and note which Ã‚Â§8 threshold applies.\\n-HUMANIZER AUDIT: Scan the chapter for AI writing patterns and flag every instance found. Do not suggest rewrites -- only flag with the exact phrase, the pattern type, and a brief directional note:
  - Structural symmetry: Two or more adjacent sentences with near-identical grammatical structure (e.g. "She felt X. She saw Y. She knew Z."). Flag and suggest breaking the pattern with a different sentence form.
  - AI-typical phrases: Flag any of these verbatim -- "in many ways", "at its core", "it is worth noting", "furthermore", "moreover", "this creates a sense of", "plays a crucial role", "serves as a reminder", "speaks to", "a testament to", "needless to say", "it is clear that", "one can see that".
  - Over-explained emotion: Any sentence that labels the emotional significance of a beat rather than letting it land (e.g. "This was significant because...", "she couldn't help but feel overwhelmed"). Flag and note: cut the label.
  - Corporate hedging: Qualifiers that weaken directness -- "somewhat", "rather", "quite", "in a sense", "to some extent", "as if somehow".
  - Unearned abstraction: Vague thematic statements with no sensory or concrete anchor in this specific scene.

SCOPE CONSTRAINT (MANDATORY):
- Your role is line-level prose editing only. Suggest changes to HOW things are written, never to WHAT happens.
- Do NOT suggest adding new plot beats, new characters, new scenes, new events, new dialogue exchanges, or new worldbuilding details.
- Do NOT suggest expanding sections with content that is not already present in the chapter.
- Do NOT suggest removing or altering any event, character action, or story beat -- only suggest how the prose describing those things can be improved.
- If you notice a detail that contradicts the <characters> or <worldbuilding> documents, flag it as a continuity error -- but do NOT suggest inventing replacement content. Simply note that the offending detail should be removed or corrected to exactly match the source document.

- DOCTRINE COMPLIANCE: Flag any passage that violates <conflict_doctrine>, <voice_doctrine>, or <backstory_doctrine>. If a doctrine is empty, skip that audit.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in <emotion_system_guardrails>. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.
</instructions>`,
        options: {},
    };

    @node({
        id: 'e16e3976-0e9e-4a30-bd7a-e27020532b9d',
        name: 'Rewrite',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 2.2,
        position: [1104, 0],
    })
    Rewrite = {
        promptType: 'define',
        text: `=<original_chapter>
{{ $('First Draft').item.json.output }}
</original_chapter>

<improvement_plan>
{{ $('Improvement Plan').item.json.output }}
</improvement_plan>

<character_emotion_template>
{{ $('Get Character emotion template').item.json.content }}
</character_emotion_template>

<conflict_doctrine>
{{ $('Universal Config').item.json.conflict_full || 'No conflict doctrine available.' }}
</conflict_doctrine>

<voice_doctrine>
{{ $('Universal Config').item.json.voice_full || 'No voice doctrine available.' }}
</voice_doctrine>

<backstory_doctrine>
{{ $('Universal Config').item.json.backstory_full || 'No backstory doctrine available.' }}
</backstory_doctrine>

<location_doctrine>
{{ $('Universal Config').item.json.location_full || 'No location doctrine available.' }}
</location_doctrine>

<faction_doctrine>
{{ $('Universal Config').item.json.faction_full || 'No faction doctrine available.' }}
</faction_doctrine>

<emotion_system_guardrails>
{{ $('Universal Config').item.json.emotion_guardrails }}
</emotion_system_guardrails>

<scene_brief>
{{ $('Scene Brief').item.json.output }}
</scene_brief>

<instructions>
Using the text of the <original_chapter> and the <improvement_plan> I want you to implement the suggestions in the improvement plan. Only implement the suggested changes, and do not change anything else about the original_chapter. Reproduce the entire chapter with the suggested changes made.

The chapter should begin with the chapter header written in Markdown as an H2 heading like this: "## {{ $('Loop Over Items').item.json.chapter }}"

ANTI-HALLUCINATION RULES (MANDATORY):
- Only implement line-level prose improvements from the improvement plan: wording, sentence structure, dialogue tags, adverb removal, sentence-length variation. Nothing else.
- Do NOT add any new sentences, paragraphs, scenes, characters, events, or worldbuilding details that are not already present in the original_chapter.
- Do NOT expand any scene, extend any beat, or add any transition or closing paragraph that is not already in the original_chapter.
- If the improvement plan suggests adding new content, a new scene, a new character beat, or any plot addition -- ignore that suggestion entirely and leave the corresponding passage unchanged.
- The final output must cover exactly the same story events as the original_chapter. Word count should remain within 10% of the original.

SCENE RESOLUTION OUTPUT (MANDATORY):
After the final line of rewritten prose, append a scene resolution block in EXACTLY this format -- no angle brackets, no XML, no markdown:

--- SCENE RESOLUTION ---
[character_id]: [stat_name] [+N or -N] -- [one-line reason grounded in what happened in this scene]
[character_id]: moodlet_added [moodlet_name] -- [what triggered it]
[character_id]: moodlet_expired [moodlet_name] -- [why it ended]
--- END SCENE RESOLUTION ---

Rules for this block:
- Cross-reference the CHARACTER EMOTION HEADER in <scene_brief> for each character's opening stats.
- Record ONLY stats that actually changed due to events that occurred in this chapter (per Ã‚Â§1 Core Stats in <character_emotion_template>). Core stats to track: those named in <emotion_system_guardrails>.
- Record any Ã‚Â§3 Cascade Failure conditions that activated this chapter.
- Record any moodlet additions or expirations triggered by scene events.
- If no stats changed for a character, write: [character_id]: no change.
- List every named character who appeared in this chapter.
- This block is consumed by the NEXT chapter's SceneBrief to build an accurate CHARACTER EMOTION HEADER. Accuracy is critical -- an error here will compound across all future chapters.
- Do NOT summarise the scene in this block. Record mechanical stat changes only.

- DOCTRINE COMPLIANCE: Revised prose must conform to <conflict_doctrine> for tension and <voice_doctrine> for character voice. If either is empty, skip that constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in <emotion_system_guardrails>. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.
</instructions>
`,
        options: {},
    };

    @node({
        id: '66736e85-879e-4a57-874a-de4a5572ff5e',
        name: 'Final Polish',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 2.2,
        position: [1408, 0],
    })
    FinalPolish = {
        promptType: 'define',
        text: `=<chapter>
{{ $('Rewrite').item.json.output }}
</chapter>

<prohibited_words>
{{ $('Forbidden Words').item.json.content }}
</prohibited_words>

<prose_style>
{{ $('Get Prose Style').item.json.content }}
</prose_style>

<conflict_doctrine>
{{ $('Universal Config').item.json.conflict_full || 'No conflict doctrine available.' }}
</conflict_doctrine>

<voice_doctrine>
{{ $('Universal Config').item.json.voice_full || 'No voice doctrine available.' }}
</voice_doctrine>

<backstory_doctrine>
{{ $('Universal Config').item.json.backstory_full || 'No backstory doctrine available.' }}
</backstory_doctrine>

<location_doctrine>
{{ $('Universal Config').item.json.location_full || 'No location doctrine available.' }}
</location_doctrine>

<faction_doctrine>
{{ $('Universal Config').item.json.faction_full || 'No faction doctrine available.' }}
</faction_doctrine>

<emotion_system_guardrails>
{{ $('Universal Config').item.json.emotion_guardrails }}
</emotion_system_guardrails>

<instructions>
You are a final human-touch editor. Your task is a targeted polish pass on the chapter above. Do NOT rewrite the chapter. Make only minimal, precise changes to improve naturalness and remove any remaining AI writing patterns.

Specifically:

1. Prohibited words: Scan for any word from the <prohibited_words> list that remains in the chapter. Replace each with a natural, context-appropriate alternative.

2. Em-dashes: Remove every em-dash (--). Replace each with a comma or ellipsis (...) as fits the rhythm of the sentence.

3. Repeated sentence openings: Within any paragraph where two or more consecutive sentences begin with the same word (especially pronouns like he/she/it/they/I), vary one or two of those openings.

4. Weak adverbs: Identify adverb-verb pairs that weaken action (e.g. "walked slowly" becomes "crept"). Substitute with a precise strong verb.

5. AI filler phrases: Identify 2-4 word phrases that read as AI-typical filler (e.g. "in that moment", "suddenly", "a beat of silence", "the weight of", "couldn't help but"). Cut or replace with concrete action or a shorter phrase.

6. Dialogue tags: Ensure all dialogue tags are only "said" or "asked". Fix any that are not, unless removing the tag entirely reads more naturally.

7. Do NOT add new content, new beats, or new scenes. Only refine what is already there. Do not change the plot, characters, or any story detail.
8. SCENE RESOLUTION BLOCK: If the end of the chapter contains a block beginning with '--- SCENE RESOLUTION ---' and ending with '--- END SCENE RESOLUTION ---', preserve it EXACTLY as written. Do not alter, polish, or remove it. It is a structured data handoff consumed by the next chapter and must remain verbatim.

Output the complete polished chapter text with only the targeted corrections applied. Keep the ## chapter heading intact at the top.

- DOCTRINE COMPLIANCE: Final voice and location consistency must conform to <conflict_doctrine>, <voice_doctrine>, and <location_doctrine>. If a doctrine is empty, skip that constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in <emotion_system_guardrails>. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.
</instructions>
`,
        options: {},
    };

    @node({
        id: 'af1c6376-940c-4c3c-9b7c-f318794bd932',
        name: 'Clean Chapter Output',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1744, 272],
    })
    CleanChapterOutput = {
        jsCode: `// Get the raw output from the Final Polish agent
const raw = $input.first().json.output || '';

// Remove XML/HTML tags and clean up the text
const cleaned = raw
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\\n{3,}/g, '\\n\\n')
  .trim();

// Get the document ID
const documentId = $('Get BLANK First Draft Doc').first().json.documentId;

// Parse lines and identify headings (markdown ## markers)
const rawLines = cleaned.split('\\n');
const processedLines = [];

for (const line of rawLines) {
  const isHeading = /^#{1,4}\\s+/.test(line);
  const text = isHeading ? line.replace(/^#{1,4}\\s+/, '') : line;
  processedLines.push({ text, isHeading });
}

// Build Google Docs batchUpdate requests
const requests = [];
const headingRanges = [];
let fullText = '';
let currentIndex = 1; // Google Docs body starts at index 1

for (const pLine of processedLines) {
  const lineText = pLine.text + '\\n';
  if (pLine.isHeading) {
    headingRanges.push({
      startIndex: currentIndex,
      endIndex: currentIndex + lineText.length
    });
  }
  fullText += lineText;
  currentIndex += lineText.length;
}

// We need to find the current end of the document to insert at the end
// The Get Last 2000 Words 1 node fetched the doc content earlier
const existingContent = $('Get Last 2000 Words 1').first().json.content || '';
// Google Docs endIndex = body length + 1 (for the trailing newline char)
// A safe approach: insert at end by first getting the doc length
// Since batchUpdate insertText at index 1 prepends, we need the end index
// We'll use a large index and let the API clamp, or compute from content length
const bodyLength = existingContent.length;
const insertIndex = Math.max(1, bodyLength > 0 ? bodyLength : 1);

// Adjust heading ranges to offset from insertIndex instead of 1
const offset = insertIndex - 1;

// 1) Insert all cleaned text at the end of the document
requests.push({
  insertText: {
    location: { index: insertIndex },
    text: fullText
  }
});

// 2) Apply HEADING_1 paragraph style to each chapter heading
for (const range of headingRanges) {
  requests.push({
    updateParagraphStyle: {
      range: {
        startIndex: range.startIndex + offset,
        endIndex: range.endIndex + offset
      },
      paragraphStyle: { namedStyleType: 'HEADING_1' },
      fields: 'namedStyleType'
    }
  });
}

return [{ json: { requests, documentId } }];`,
    };

    @node({
        id: 'fab4d905-bf70-476c-9160-ec0cffb99662',
        name: 'Add Chapter to Document',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.2,
        position: [1936, 304],
    })
    AddChapterToDocument = {
        method: 'POST',
        url: '=https://docs.googleapis.com/v1/documents/{{ $json.documentId }}:batchUpdate',
        authentication: 'oAuth2',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ requests: $json.requests }) }}',
        options: {},
    };

    @node({
        id: 'b3229f51-c31b-4851-b0cf-2c902775f0d4',
        name: 'Get Last 2000 Words 1',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-896, 352],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetLast2000Words1 = {
        operation: 'get',
        documentURL: "={{ $('Get BLANK First Draft Doc').item.json.documentId }}",
    };

    @node({
        id: '70f1bc03-5a9f-4ee3-9d85-c1f1e14d4f88',
        name: 'Get Last 2000 Words 2',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-576, 352],
    })
    GetLast2000Words2 = {
        jsCode: `// Extract the last ~2,000 words from the Google Doc content
// Also extract the most recent SCENE RESOLUTION block for stat continuity tracking
const WORD_LIMIT = 2000;

// n8n Google Docs node typically surfaces content at items[0].json.content
// but your node may return content directly on item.json.content.
// Handle both cases defensively.
return items.map(i => {
  const content =
    (i.json && i.json.content) ||
    (i.binary && i.binary.data && Buffer.from(i.binary.data.data, 'base64').toString('utf-8')) ||
    '';

  // -- SCENE RESOLUTION EXTRACTION -----------------------------------------
  // Find the LAST occurrence of a scene resolution block written by the Rewrite node.
  // Format: --- SCENE RESOLUTION ---\\n...\\n--- END SCENE RESOLUTION ---
  let lastSceneResolution = '';
  const resolutionRegex = /---\\s*SCENE RESOLUTION\\s*---((?:[\\s\\S]*?))---\\s*END SCENE RESOLUTION\\s*---/gi;
  let resMatch;
  let lastResMatch = null;
  while ((resMatch = resolutionRegex.exec(content)) !== null) {
    lastResMatch = resMatch;
  }
  if (lastResMatch) {
    lastSceneResolution = lastResMatch[1].trim();
  }

  // -- PROSE EXTRACTION (last 2000 words) -----------------------------------
  // Normalize whitespace to avoid extreme splitting
  const normalized = content.replace(/\\s+/g, ' ').trim();
  if (!normalized) {
    i.json.last_2k_words = '';
    i.json.last_scene_resolution = '';
    return i;
  }

  const words = normalized.split(' ');
  const slice = words.slice(Math.max(0, words.length - WORD_LIMIT)).join(' ');
  i.json.last_2k_words = slice;
  i.json.last_scene_resolution = lastSceneResolution;
  return i;
});
`,
    };

    @node({
        id: 'b40cfefd-bc03-4b2e-90a3-0aac865d560d',
        webhookId: 'ae4cc514-6b5e-4b87-8a28-6d3706d0de9e',
        name: 'On form submission',
        type: 'n8n-nodes-base.formTrigger',
        version: 2.2,
        position: [-4544, 432],
    })
    OnFormSubmission = {
        formTitle: 'Setup',
        formFields: {
            values: [
                {
                    fieldLabel: 'What is the Title of Your Book',
                    requiredField: true,
                },
                {
                    fieldLabel: 'Author Notes:',
                    fieldType: 'textarea',
                },
            ],
        },
        options: {},
    };

    @node({
        id: 'd6b6aab6-3625-459f-b6fc-d00cbb6ff6e3',
        name: 'Get Character Sheet',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-3920, 416],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetCharacterSheet = {
        operation: 'get',
        documentURL: '=1th8QLHqrnQu2SHI0VNU7qSA6Duk_QvN3cXG8yNAgCwk',
    };

    @node({
        id: '08a4e3a5-4beb-483b-b498-6b31b3e49edd',
        name: 'Get Worldbuilding',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-3312, 416],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetWorldbuilding = {
        operation: 'get',
        documentURL: '=1aITR_w2AM53qOHZC5yypmIatmJPgqb2XOZxkPFGdF8s',
    };

    @node({
        id: '1b513c81-69e5-44f8-8a4e-9bda97436d18',
        name: 'Get Outline',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-3120, 416],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetOutline = {
        operation: 'get',
        documentURL: '=1HnQAjZjuiKfGwLcw8VuTQ1zMYTETQy8GjolHXRz64UQ',
    };

    @node({
        id: '78c1fed4-5809-46bb-84dc-5777fa91cba0',
        name: 'Get BLANK First Draft Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-2928, 416],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetBlankFirstDraftDoc = {
        operation: 'get',
        documentURL: '=1S2IB20Q47lhhjfO6e8mWuswcbcL8TW5MmFtesLOHbRw',
    };

    @node({
        id: '71b26dc4-0681-47ba-9b4c-2974d92b715e',
        name: 'Ollama Chat Model1',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [-2208, 576],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel1 = {
        model: "={{ $('Universal Config').item.json.profiles.light.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.active_profile.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.active_profile.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.active_profile.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.active_profile.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.light.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.active_profile.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.active_profile.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.active_profile.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: '2071af4e-ebc3-42fd-ba38-d768a726b859',
        name: 'Ollama Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [0, 208],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.active_profile.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.active_profile.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.active_profile.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.active_profile.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.active_profile.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.active_profile.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.active_profile.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: '8a6baf1e-34f5-43a2-9c81-f7965f432cb4',
        name: 'Ollama Chat Model2',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [384, 192],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel2 = {
        model: "={{ $('Universal Config').item.json.profiles.longform.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.active_profile.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.active_profile.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.active_profile.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.active_profile.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.longform.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.active_profile.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.active_profile.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.active_profile.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: 'de73505f-36be-47a3-bf53-7680b3bfc909',
        name: 'Ollama Chat Model3',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [784, 176],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel3 = {
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.active_profile.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.active_profile.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.active_profile.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.active_profile.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.active_profile.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.active_profile.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.active_profile.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: 'b292d180-226e-4234-8d69-5bf184360cce',
        name: 'Ollama Chat Model4',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [1104, 176],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel4 = {
        model: "={{ $('Universal Config').item.json.profiles.longform.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.active_profile.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.active_profile.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.active_profile.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.active_profile.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.longform.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.active_profile.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.active_profile.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.active_profile.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: 'd0c20d27-0477-4de0-b89c-40ddadd359be',
        name: 'Ollama Chat Model5',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [1408, 176],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel5 = {
        model: "={{ $('Universal Config').item.json.profiles.light.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.active_profile.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.active_profile.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.active_profile.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.active_profile.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.light.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.active_profile.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.active_profile.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.active_profile.parameters.repeat_penalty }}",
        },
    };

    @node({
        id: '4b7bb274-f87c-46ea-89d7-e2ac162d2731',
        name: 'Get Character emotion template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-3472, 416],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetCharacterEmotionTemplate = {
        operation: 'get',
        documentURL:
            '=https://docs.google.com/document/d/1h8P0RRd_Yr0qsbUGxyBnxFhKfU5GYBetXJp-geddTWs/edit?usp=sharing',
    };

    @node({
        id: '8d14f648-091c-40db-9069-871e8ab4e733',
        name: 'Forbidden Words',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-4112, 416],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    ForbiddenWords = {
        operation: 'get',
        documentURL: '1sNd_Nx05h1l6w-MAQ2VdKfDb5m8s5SovbNmGmKNLyvg',
    };

    @node({
        id: 'a9be7aa0-7785-4a8d-9ef2-c669d300acda',
        name: 'Get Themes Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-3680, 416],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetThemesTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1mmDaJeNOtYrJKkBoZloGt6yXewhW5wPQ4K_Pyg4ookI/edit?usp=sharing',
    };

    @node({
        id: '8187c422-98ef-4d2c-a358-6cbb702a4a9f',
        name: 'Extract Seeds',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-2624, 416],
    })
    ExtractSeeds = {
        jsCode: `
// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ HELPER FUNCTIONS ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬

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

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ FORM DATA ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const formData         = $("On form submission").first()?.json || {};
const rawFormTitle     = (formData["Book Title"] || formData["What is the Title of Your Book"] || "").trim().toUpperCase();
const authorNotes      = formData["Author Notes"]      || "";
const lockedCharacters = formData["Locked Characters"] || "";
const lockedProfiles   = formData["Locked Profiles"]   || "";

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ BRAINDUMP ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â with Author Notes fallback ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
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
  braindump_source = "Author Notes (fallback ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â add a dedicated Braindump field for best results)";
}

const braindump = rawBraindump.trim().replace(/\\n{3,}/g, "\\n\\n");

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ WARNINGS ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const warnings = [];

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ TITLE LOCK ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
let title = rawFormTitle;

if (!title) {
  title = "UNTITLED PROJECT";
  warnings.push("CRITICAL: no title in form submission ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â set title before generating");
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ TEMPLATES ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const templates = {
  tropes:        "",
  plot:          "",
  character:     extractDocText($("Get Character Sheet").first()?.json),
  story:         "",
  worldbuilding: extractDocText($("Get Worldbuilding").first()?.json),
  themes:        extractDocText($("Get Themes Template").first()?.json),
  character_emotion: extractDocText($("Get Character emotion template").first()?.json),
  conflict:      extractDocText($("Conflict Architecture Template").first()?.json),
  voice:         extractDocText($("Dialogue & Voice Template").first()?.json),
  backstory:     extractDocText($("Revelation & Backstory Template").first()?.json),
  location:      extractDocText($("Location Profile Template").first()?.json),
  faction:       extractDocText($("Faction & Power Template").first()?.json),
};

const TEMPLATE_MIN_LENGTH = 200;
if (!templates.tropes        || templates.tropes.length        < TEMPLATE_MIN_LENGTH) warnings.push(\`tropeTemplate short or empty (\${templates.tropes.length} chars) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Trope template may have returned partial content\`);
if (!templates.plot          || templates.plot.length          < TEMPLATE_MIN_LENGTH) warnings.push(\`plotTemplate short or empty (\${templates.plot.length} chars) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Plot template may have returned partial content\`);
if (!templates.character     || templates.character.length     < TEMPLATE_MIN_LENGTH) warnings.push(\`characterTemplate short or empty (\${templates.character.length} chars) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Character template may have returned partial content\`);
if (!templates.story         || templates.story.length         < TEMPLATE_MIN_LENGTH) warnings.push(\`storyTemplate short or empty (\${templates.story.length} chars) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Story template may have returned partial content\`);
if (!templates.worldbuilding || templates.worldbuilding.length < TEMPLATE_MIN_LENGTH) warnings.push(\`worldbuildingTemplate short or empty (\${templates.worldbuilding.length} chars) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Worldbuilding template may have returned partial content\`);
if (!templates.themes        || templates.themes.length        < TEMPLATE_MIN_LENGTH) warnings.push(\`themesTemplate short or empty (\${templates.themes.length} chars) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Get Themes Template may have returned partial content\`);

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

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ FORBIDDEN WORDS ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const forbiddenWords = extractDocText($("Forbidden Words").first()?.json);

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

if (!forbiddenWords)                   warnings.push("forbiddenWords empty ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Forbidden Words node returned nothing");
if (forbiddenFlat.length === 0)        warnings.push("forbiddenFlat empty ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â forbidden word parsing failed ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â check tag names in doc");
if (forbiddenNamesList.length === 0)   warnings.push("forbiddenNamesList empty ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â name scan will not run");
if (forbiddenPhrasesList.length === 0) warnings.push("forbiddenPhrasesList empty ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â phrase scan will not run");

if (lockedCharacters && forbiddenNamesList.length > 0) {
  const lockedLower = lockedCharacters.toLowerCase();
  const conflicts   = forbiddenNamesList.filter(n => lockedLower.includes(n.toLowerCase()));
  if (conflicts.length > 0) {
    warnings.push(\`WARN: locked character name conflicts with forbidden names list: \${conflicts.join(", ")} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â remove from forbidden list or Characters node will block the protagonist\`);
  }
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ BRAINDUMP GUARD ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
if (braindump_source === "none" || !braindump) {
  warnings.push("CRITICAL: braindump field not found and Author Notes also empty ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no context for Build nodes. Add a Braindump field to your form.");
} else if (braindump_source.startsWith("Author Notes")) {
  warnings.push(\`WARN: braindump sourced from Author Notes fallback (\${braindump.length} chars) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â add a dedicated Braindump field to the form for best results\`);
} else if (braindump.length < 500) {
  warnings.push(\`WARN: braindump short (\${braindump.length} chars) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Build nodes will have minimal context; aim for 500+ chars for best output\`);
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ BLANK DOSSIER DOC ID ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const blankDossierId = $("Get BLANK First Draft Doc").first()?.json?.documentId || "";

if (!blankDossierId) {
  warnings.push("WARN: blankDossierId empty ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â check Get BLANK First Draft Doc node is connected and returning a documentId");
}

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ CONDITIONAL DEBUG ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
const debug = warnings.length > 0 ? {
  titleResolved:    title,
  braindumpLength:  braindump.length,
  braindump_source,
  formFieldsFound:  Object.keys(formData), // lists all form keys ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â useful for field name mismatch diagnosis
  templateHealth: {
    tropes:        templates.tropes.length,
    plot:          templates.plot.length,
    character:     templates.character.length,
    story:         templates.story.length,
    worldbuilding: templates.worldbuilding.length,
    themes:        templates.themes.length,
    character_emotion: templates.character_emotion.length,
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
  blankDossierId,
} : null;

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ OUTPUT ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
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
    blankDossierId,

    status:   warnings.length === 0
                ? "Primed OK"
                : \`\${warnings.length} warning(s): \${warnings.join(" | ")}\`,
    warnings,

    ...(debug ? { debug } : {}),
  }
}];
`,
    };

    @node({
        id: 'd53d93ec-d614-4b54-8b0b-e046458b71f5',
        name: 'Universal Config',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-2464, 416],
    })
    UniversalConfig = {
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
      context_length:   16384,
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
      context_length:   16384,
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
      context_length:   16384,
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
      context_length:   16384,
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
      context_length:   16384,
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
      context_length:   8192,
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
      context_length:   16384,
      num_predict:      4096,
      top_p:            0.85,
      top_k:            20,
      repeat_penalty:   1.0,
      presence_penalty: 0,
          num_gpu:          99,
    }
  }
};

// --- PROFILE SELECTION ------------------------------------------------------
const validLabels = Object.keys(profiles);
const profileOverride = (inputData.profile_override || "").trim().toLowerCase();
const braindumpRaw = storyData.trim();
const selected = validLabels.includes(profileOverride)
  ? profiles[profileOverride]
  : (braindumpRaw.length > 9000 ? profiles.longform : profiles.creative);

// --- WARNINGS ---------------------------------------------------------------
const warnings = [];
if (profileOverride && !validLabels.includes(profileOverride)) {
  warnings.push(\`WARN: profile_override "\${profileOverride}" not recognised â€” used creative_max.\`);
}

if (braindumpRaw.length < 500) {
  warnings.push(\`WARN: braindump short (\${braindumpRaw.length} chars) â€” results may be generic.\`);
}

// --- OUTPUT -----------------------------------------------------------------
return [{
  json: {
    ...inputData,
    profiles,
    active_profile: selected,
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
    required_xml_structure: \`<dossier><metadata><title/><generated_date/></metadata><content><world_seed/><character_seed/><story_spine/><subplot_expansion/><trope_seed/></content></dossier>\`,  // NOTE: wrapper tags (worldbuilding_template, plot_template) removed â€” MergeDossier/Sanitization/FinalPass strip them

    status: warnings.length === 0 ? "Config OK" : \`\${warnings.length} warning(s): \${warnings.join(" | ")}\`,
    warning_count: warnings.length,
    warnings
  }
}];`,
    };

    @node({
        id: '36333f4f-c9d1-407a-8bc5-619492e2e983',
        name: 'Qdrant Continuity Ledger',
        type: '@n8n/n8n-nodes-langchain.vectorStoreQdrant',
        version: 1.3,
        position: [-100, 300],
        credentials: { qdrantApi: { id: '3', name: 'Qdrant account' } },
    })
    QdrantContinuityLedger = {
        mode: 'retrieve-as-tool',
        topK: 10,
        options: {},
        toolName: 'continuity_ledger',
        toolDescription:
            'Contains facts about ALL previous chapters in this book series: character states, plot events, world rules, physical details, and relationship changes. ALWAYS query this tool before writing a scene brief. Query with character names, locations, plot threads, or any detail you need to verify for continuity.',
        qdrantCollection: {
            __rl: true,
            mode: 'list',
            value: 'continuity-ledger',
            cachedResultName: 'continuity-ledger',
        },
        includeDocumentMetadata: false,
    };

    @node({
        id: 'a9052282-b81b-438a-966d-05c602e38510',
        name: 'Embeddings Continuity',
        type: '@n8n/n8n-nodes-langchain.embeddingsOllama',
        version: 1,
        position: [-100, 500],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    EmbeddingsContinuity = {
        model: 'nomic-embed-text:latest',
    };

    @node({
        id: '176234bf-9c0e-46f8-9681-08c3aa575976',
        name: 'Extract Continuity Facts',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 2.2,
        position: [2200, 0],
    })
    ExtractContinuityFacts = {
        promptType: 'define',
        text: "={{ $('Final Polish').item.json.output }}",
        options: {
            systemMessage: `You are a continuity analyst for a long-form fiction series. Your job is to extract discrete, factual statements from a chapter that are essential for maintaining story consistency in future chapters.

Extract facts in these categories:
- CHARACTER_STATE: Physical condition, emotional changes, injuries, abilities gained/lost, possessions
- PLOT_EVENT: Key actions, decisions, revelations, promises made/broken, consequences
- WORLD_RULE: Rules of the world established or confirmed, magic systems, political structures, geography
- PHYSICAL_DETAIL: Items gained/lost, significant objects introduced, environment changes
- RELATIONSHIP: Trust changes, alliances, betrayals, bonds formed/broken, power dynamics

For each fact, output a JSON object:
{
  "type": "CATEGORY_NAME",
  "characters": ["character names involved"],
  "location": "where this happened",
  "fact": "A clear, concise statement of what happened or what is now true"
}

Rules:
- Output ONLY a valid JSON array of fact objects. No markdown code fences, no explanation, no preamble.
- Extract 10-25 of the most important facts a future chapter writer needs.
- Each fact must be self-contained and readable without other context.
- Focus on CHANGES and CONSEQUENCES, not mundane actions.
- Include character names explicitly in the fact text.
- Write facts in past tense as established truths.`,
        },
    };

    @node({
        id: '137d738f-a1f5-487c-bbc6-df356e47397b',
        name: 'Ingest Model',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [2200, 200],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    IngestModel = {
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: 0.3,
            numCtx: 16384,
            numPredict: 4096,
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
        },
    };

    @node({
        id: 'b07bec18-ac3e-49ca-a415-5f83bc74395e',
        name: 'Parse Facts',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [2500, 0],
    })
    ParseFacts = {
        jsCode: `// Parse the agent's JSON output into individual items for Qdrant insertion
const agentOutput = $('Extract Continuity Facts').first().json.output;
const chapter = $('Loop Over Items').first().json.chapter || 'unknown';
const book = $('Extract Seeds').first().json.title
  || $('Extract Seeds').first().json['What is the Title of Your Book']
  || 'untitled';

let facts;
try {
    const cleaned = agentOutput.replace(/\\\`\\\`\\\`json\\n?|\\n?\\\`\\\`\\\`/g, '').trim();
    facts = JSON.parse(cleaned);
} catch (e) {
    return [{ json: { error: 'Failed to parse continuity facts: ' + e.message, raw: agentOutput } }];
}

if (!Array.isArray(facts)) {
    return [{ json: { error: 'Agent output is not a JSON array', raw: agentOutput } }];
}

return facts.map(f => {
    const chars = Array.isArray(f.characters) ? f.characters.join(', ') : (f.characters || '');
    const loc = f.location || '';
    return {
        json: {
            text: '[' + book + ' | ' + chapter + ' | ' + (f.type || 'UNKNOWN') + ']'
                + (chars ? ' Characters: ' + chars + '.' : '')
                + (loc ? ' Location: ' + loc + '.' : '')
                + ' ' + f.fact,
        }
    };
});`,
    };

    @node({
        id: '83294077-3b7d-4a58-9224-8dac8cb912f9',
        name: 'Qdrant Ingest',
        type: '@n8n/n8n-nodes-langchain.vectorStoreQdrant',
        version: 1.3,
        position: [2800, 0],
        credentials: { qdrantApi: { id: '3', name: 'Qdrant account' } },
    })
    QdrantIngest = {
        mode: 'insert',
        options: {},
        qdrantCollection: {
            __rl: true,
            mode: 'list',
            value: 'continuity-ledger',
            cachedResultName: 'continuity-ledger',
        },
    };

    @node({
        id: '4956dc7b-96de-4a4a-9670-e914c99f5b7f',
        name: 'Embeddings Ingest',
        type: '@n8n/n8n-nodes-langchain.embeddingsOllama',
        version: 1,
        position: [2700, 200],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    EmbeddingsIngest = {
        model: 'nomic-embed-text:latest',
    };

    @node({
        id: 'f68a1b2f-0eba-44d2-b287-50824d257853',
        name: 'Ingest Data Loader',
        type: '@n8n/n8n-nodes-langchain.documentDefaultDataLoader',
        version: 1.1,
        position: [2900, 200],
    })
    IngestDataLoader = {
        dataType: 'json',
        jsonMode: 'expressionData',
        jsonData: '={{ $json.text }}',
        textSplittingMode: 'simple',
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.OnFormSubmission.out(0).to(this.GetProseStyle.in(0));
        this.GetProseStyle.out(0).to(this.ForbiddenWords.in(0));
        this.ForbiddenWords.out(0).to(this.GetCharacterSheet.in(0));
        this.GetCharacterSheet.out(0).to(this.GetThemesTemplate.in(0));
        this.GetThemesTemplate.out(0).to(this.GetCharacterEmotionTemplate.in(0));
        this.GetCharacterEmotionTemplate.out(0).to(this.GetWorldbuilding.in(0));
        this.GetWorldbuilding.out(0).to(this.GetOutline.in(0));
        this.GetOutline.out(0).to(this.GetBlankFirstDraftDoc.in(0));
        this.GetBlankFirstDraftDoc.out(0).to(this.ExtractSeeds.in(0));
        this.ExtractSeeds.out(0).to(this.UniversalConfig.in(0));
        this.UniversalConfig.out(0).to(this.FindChapterNamesInJson.in(0));
        this.FindChapterNamesInJson.out(0).to(this.ParseChapterNames.in(0));
        this.ParseChapterNames.out(0).to(this.LoopOverItems.in(0));
        this.LoopOverItems.out(0).to(this.GetLast2000Words1.in(0));
        this.LoopOverItems.out(1).to(this.ReplaceMe.in(0));
        this.GetLast2000Words1.out(0).to(this.GetLast2000Words2.in(0));
        this.GetLast2000Words2.out(0).to(this.SceneBrief.in(0));
        this.SceneBrief.out(0).to(this.FirstDraft.in(0));
        this.FirstDraft.out(0).to(this.ImprovementPlan.in(0));
        this.ImprovementPlan.out(0).to(this.Rewrite.in(0));
        this.Rewrite.out(0).to(this.FinalPolish.in(0));
        this.FinalPolish.out(0).to(this.CleanChapterOutput.in(0));
        this.CleanChapterOutput.out(0).to(this.AddChapterToDocument.in(0));
        this.AddChapterToDocument.out(0).to(this.ExtractContinuityFacts.in(0));
        this.ExtractContinuityFacts.out(0).to(this.ParseFacts.in(0));
        this.ParseFacts.out(0).to(this.QdrantIngest.in(0));
        this.QdrantIngest.out(0).to(this.LoopOverItems.in(0));

        this.FindChapterNamesInJson.uses({
            ai_languageModel: this.OllamaChatModel1.output,
        });
        this.SceneBrief.uses({
            ai_languageModel: this.OllamaChatModel.output,
            ai_tool: [this.QdrantContinuityLedger.output],
        });
        this.FirstDraft.uses({
            ai_languageModel: this.OllamaChatModel2.output,
        });
        this.ImprovementPlan.uses({
            ai_languageModel: this.OllamaChatModel3.output,
        });
        this.Rewrite.uses({
            ai_languageModel: this.OllamaChatModel4.output,
        });
        this.FinalPolish.uses({
            ai_languageModel: this.OllamaChatModel5.output,
        });
        this.QdrantContinuityLedger.uses({
            ai_embedding: this.EmbeddingsContinuity.output,
        });
        this.ExtractContinuityFacts.uses({
            ai_languageModel: this.IngestModel.output,
        });
        this.QdrantIngest.uses({
            ai_embedding: this.EmbeddingsIngest.output,
            ai_document: [this.IngestDataLoader.output],
        });
    }
}
