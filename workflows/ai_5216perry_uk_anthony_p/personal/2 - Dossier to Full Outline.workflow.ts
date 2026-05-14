import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : 2 - Dossier to Full Outline
// Nodes   : 68  |  Connections: 48
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// Characters                         chainLlm                   [AI]
// SendToCharacterDoc                 googleDocs                 [creds]
// CritiqueCharacters                 chainLlm                   [AI]
// RewriteCharacters                  chainLlm                   [AI]
// Worldbuilding                      chainLlm                   [AI]
// CritiqueWorldbuilding              chainLlm                   [AI]
// RewriteWorldbuilding               chainLlm                   [AI]
// SendToWorldbuildingDoc             googleDocs                 [creds]
// Outline                            chainLlm                   [AI]
// CritiqueOutline                    chainLlm                   [AI]
// RewriteOutline                     chainLlm                   [AI]
// EmotionalCheck                     chainLlm                   [AI]
// SciencePlotEnrichment              chainLlm                   [AI]
// ContinuityChecker                  chainLlm                   [AI]
// SceneBreakdown                     chainLlm                   [AI]
// ForeshadowingPlanner               chainLlm                   [AI]
// PovPlanner                         chainLlm                   [AI]
// GhostwriterBrief                   chainLlm                   [AI]
// CleanOutlineOutput                 code
// PostProcess                        code
// SendToOutlineDoc                   googleDocs                 [creds]
// OllamaChatModel15                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel16                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel17                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel18                  lmChatOllama               [creds] [ai_languageModel]
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
// StoryArc                           chainLlm                   [AI]
// CritiqueStoryArc                   chainLlm                   [AI]
// RewriteStoryArc                    chainLlm                   [AI]
// SendToStoryDoc                     googleDocs                 [creds]
// OutlinePrompts                     code
// GetForbiddenWordsTemplate          googleDocs                 [creds]
// OllamaChatModel                    lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel1                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel2                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel3                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel4                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel5                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel6                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel7                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel8                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel9                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel10                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel11                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel12                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel13                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel14                  lmChatOllama               [creds] [ai_languageModel]
// ExtractSeeds                       code
// UniversalConfig                    code
// Debug                              code
// OnFormSubmission                   formTrigger
// GetCharacterEmotionTemplate        googleDocs                 [creds]
// GetThemesTemplate                  googleDocs                 [creds]
// ConflictArchitectureTemplate       googleDocs                 [creds]
// DialogueVoiceTemplate              googleDocs                 [creds]
// RevelationBackstoryTemplate        googleDocs                 [creds]
// LocationProfileTemplate            googleDocs                 [creds]
// FactionPowerTemplate               googleDocs                 [creds]
// ChapterSelector                    code
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// OnFormSubmission
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
//                                              → Characters
//                                                → CritiqueCharacters
//                                                  → RewriteCharacters
//                                                    → SendToCharacterDoc
//                                                      → StoryArc
//                                                        → CritiqueStoryArc
//                                                          → RewriteStoryArc
//                                                            → SendToStoryDoc
//                                                              → Worldbuilding
//                                                                → CritiqueWorldbuilding
//                                                                  → RewriteWorldbuilding
//                                                                    → SendToWorldbuildingDoc
//                                                                      → ChapterSelector
//                                                                        → OutlinePrompts
//                                                                          → Outline
//                                                                            → CritiqueOutline
//                                                                              → RewriteOutline
//                                                                                → EmotionalCheck
//                                                                                  → SciencePlotEnrichment
//                                                                                    → ContinuityChecker
//                                                                                      → SceneBreakdown
//                                                                                        → ForeshadowingPlanner
//                                                                                          → PovPlanner
//                                                                                            → GhostwriterBrief
//                                                                                              → CleanOutlineOutput
//                                                                                                → PostProcess
//                                                                                                  → SendToOutlineDoc
//
// AI CONNECTIONS
// Characters.uses({ ai_languageModel: OllamaChatModel })
// CritiqueCharacters.uses({ ai_languageModel: OllamaChatModel1 })
// RewriteCharacters.uses({ ai_languageModel: OllamaChatModel2 })
// Worldbuilding.uses({ ai_languageModel: OllamaChatModel6 })
// CritiqueWorldbuilding.uses({ ai_languageModel: OllamaChatModel7 })
// RewriteWorldbuilding.uses({ ai_languageModel: OllamaChatModel8 })
// Outline.uses({ ai_languageModel: OllamaChatModel9 })
// CritiqueOutline.uses({ ai_languageModel: OllamaChatModel10 })
// RewriteOutline.uses({ ai_languageModel: OllamaChatModel11 })
// EmotionalCheck.uses({ ai_languageModel: OllamaChatModel13 })
// SciencePlotEnrichment.uses({ ai_languageModel: OllamaChatModel14 })
// ContinuityChecker.uses({ ai_languageModel: OllamaChatModel12 })
// SceneBreakdown.uses({ ai_languageModel: OllamaChatModel15 })
// ForeshadowingPlanner.uses({ ai_languageModel: OllamaChatModel16 })
// PovPlanner.uses({ ai_languageModel: OllamaChatModel17 })
// GhostwriterBrief.uses({ ai_languageModel: OllamaChatModel18 })
// StoryArc.uses({ ai_languageModel: OllamaChatModel3 })
// CritiqueStoryArc.uses({ ai_languageModel: OllamaChatModel4 })
// RewriteStoryArc.uses({ ai_languageModel: OllamaChatModel5 })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'QIeTUSj3joWKRY34',
    name: '2 - Dossier to Full Outline',
    active: false,
    settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
})
export class _2DossierToFullOutlineWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: '53372fac-f231-4956-897e-cd87e5df9f56',
        name: 'Characters',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [1376, 80],
        onError: 'continueRegularOutput',
    })
    Characters = {
        promptType: 'define',
        text: `=You are an expert character designer helping an author create the cast for a single novel.

WORLD CONTEXT:
- Active Model Profile: {{ $("Universal Config").first().json.active_profile.label }}
- World Nouns (use as naming INSPIRATION — do not use any noun verbatim if it also appears in ENTITY_NAMES below): {{ $("Extract Seeds").first().json.worldNouns.join(", ") }}
- Prose Jail (Forbidden — do not use these words in your output): {{ $("Universal Config").first().json.prose_jail }}

FORBIDDEN WORDS:
Names — do not use any of these as character names: {{ $("Extract Seeds").first().json.forbiddenNamesList.join(", ") }}
Phrases — do not use any of these verbatim or near-verbatim: {{ $("Extract Seeds").first().json.forbiddenPhrasesList.join(", ") }}
Vocabulary — do not use any of these words: {{ $("Extract Seeds").first().json.forbiddenVocabList.join(", ") }}
Verbs and actions — do not use any of these: {{ $("Extract Seeds").first().json.forbiddenVerbsList.join(", ") }}
Dialogue patterns — these dialogue structures are forbidden: {{ $("Extract Seeds").first().json.forbiddenDialogueList.join(", ") }}
Quirk patterns — these quirk descriptions are forbidden: {{ $("Extract Seeds").first().json.forbiddenQuirkList.join(", ") }}

EXTRACTED CONSTRAINTS:
- CANONICAL_TAGS — Core Motivation and Background must only reference tags from this list: {{ $("Extract Seeds").first().json.canonicalTags.join(", ") }}
- CONSTRAINT_TAGS — prefer these tags for Core Motivation specifically: {{ $("Extract Seeds").first().json.characterConstraintTags.join(", ") }}
- BACKGROUND_TAGS — prefer these tags for Background citations: {{ $("Extract Seeds").first().json.backgroundTags.join(", ") }}
- PLOT_BEAT_TAGS — use these tags when citing plot beats in minor characters: {{ $("Extract Seeds").first().json.plotBeatTags.join(", ") }}
- ENTITY_NAMES — no character name may duplicate any of these: {{ $("Extract Seeds").first().json.entityNames.join(", ") }}
- WORLD_ELEMENTS_LOCK — these terms belong to a different project and must NEVER appear in this output: {{ $("Universal Config").first().json.forbidden_list || "none" }}

LOCKED CHARACTERS:
{{ $("Extract Seeds").first().json.lockedCharacters || "No locked characters specified -- generate cast freely from dossier." }}

LOCKED PROFILES:
{{ $("Extract Seeds").first().json.lockedProfiles || "No locked profiles specified." }}

CLIFTON STRENGTHS REFERENCE:
Use ONLY these valid Clifton StrengthsFinder theme names in the Strengths field.
Do not substitute generic adjectives like "Decisive", "Ambitious", "Compassionate", or "Intuitive".
Valid themes:
Achiever, Activator, Adaptability, Analytical, Arranger, Belief, Command,
Communication, Competition, Connectedness, Consistency, Context, Deliberative,
Developer, Discipline, Empathy, Focus, Futuristic, Harmony, Ideation,
Includer, Individualization, Input, Intellection, Learner, Maximizer,
Positivity, Relator, Responsibility, Restorative, Self-Assurance, Significance,
Strategic, Woo

DIALOGUE SLOT GUIDE:
Each dialogue sample slot has a specific structural requirement.
The world-specific element must be the subject or stakes of the line — not appended.
Do NOT copy these structural descriptions as dialogue — generate entirely original lines from DOSSIER SOURCE:
.
Every term, system name, score, and resource in your dialogue must come from DOSSIER SOURCE:
— not from any other project or your training data.

- Relaxed slot: Character observes a named world system from DOSSIER SOURCE:
behaving in its normal state.
  The system name, score, or resource must be the grammatical subject of the line.
  Failing pattern: a generic observation with a world term appended at the end.
  Failing pattern: copying any example line from this guide verbatim.

- Stressful slot: A named world system from DOSSIER SOURCE:
is applying direct pressure to the character right now.
  The specific mechanism — a score threshold, resource cut-off, access restriction, or detection event — must be named.
  Failing pattern: an emotional statement with no system reference.
  Failing pattern: copying any example line from this guide verbatim.

- Thoughtful slot: Character identifies a specific exploitable logic gap in a named world system from DOSSIER SOURCE:
.
  Name the system and what structural weakness they have observed.
  Failing pattern: abstract reflection with no system named.
  Failing pattern: copying any example line from this guide verbatim.

- Excited slot: A named world system's state from DOSSIER SOURCE:
has just shifted in the character's favour.
  Name the system and the specific change — a score movement, resource release, access gained, detection avoided.
  Failing pattern: abstract excitement with no system state change named.
  Failing pattern: copying any example line from this guide verbatim.

GENRE TROPES:
{{ $("Extract Seeds").first().json.templates.tropes }}

PLOT TEMPLATE:
{{ $("Extract Seeds").first().json.templates.plot }}

CHARACTER TEMPLATE:
{{ $("Extract Seeds").first().json.templates.character }}

WORLDBUILDING TEMPLATE:
{{ $("Extract Seeds").first().json.templates.worldbuilding }}

CHARACTER EMOTION TEMPLATE:
{{ $("Universal Config").first().json.character_emotion_full || 'No character emotion template available.' }}

VOICE DOCTRINE:
{{ $("Universal Config").first().json.voice_full || 'No voice doctrine available.' }}

CONFLICT DOCTRINE:
{{ $("Universal Config").first().json.conflict_full || 'No conflict doctrine available.' }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each character's Core Motivation, apply psychological precision -- the Heart's Desire must create an irresolvable tension with the best-fit CONSTRAINT_TAG. The character must WANT something the world is specifically designed to prevent. Surface the internal contradiction between their Lie and their True Need."
  : "You are in FAST mode (14B). Keep characters sharp and structurally distinct. Each Core Motivation must name a specific CONSTRAINT_TAG it conflicts with and state one concrete dossier mechanism as the reason." }}

INSTRUCTIONS:
Read DOSSIER SOURCE:
in full before writing any character.
Extract from it:
- The names of all world systems, scores, resources, factions, and social mechanisms — these are your WORLD_ELEMENTS for dialogue anchoring
- The specific constraints citizens face — these inform Core Motivation reasons
- The sensory texture of environments — these inform Physical Descriptions

Do not import terminology, character names, or system names from any other project or from your training data.
Every proper noun in your output must appear in DOSSIER SOURCE:
or be a newly invented name that does not conflict with ENTITY_NAMES.

Using the structured data in DOSSIER SOURCE:
, design a full novel cast of 5–7 major characters, 2–3 supporting characters, and 4–6 minor characters that fits the genre tropes and honours AUTHOR NOTES:
and LOCKED CHARACTERS:
.

Core Directives:
1. **Dossier First:** Every world term, system name, score, resource, and faction in your output must come from DOSSIER SOURCE:
. Do not use terms from WORLD_ELEMENTS_LOCK or any other project.
2. **Dossier Tag Fidelity:** Only reference tags from CANONICAL_TAGS in Core Motivation and Background. Prefer CONSTRAINT_TAGS for Core Motivation and BACKGROUND_TAGS for Background. Do not invent tag names.
3. **Conflict Anchoring:** Every major character's background must be directly shaped by at least one tag from CONSTRAINT_TAGS — state explicitly which constraint applies.
4. **Role Integration:** Distribute roles across the full cast. Available major roles: protagonist, antagonist, deuteragonist, mentor/guide, foil, catalyst, and ally. Each major character must fill a unique role. Supporting characters fill structural roles: informant, gatekeeper, or mirror. Honour LOCKED CHARACTERS:
exactly — do not rename, replace, merge, or substitute any locked character.
5. **Cast Size:** Generate at minimum 5 major characters, 2 supporting characters, and 6 minor characters. A full novel needs narrative depth — more is better within reason.
6. **Relational Web:** Every major character must have at least one stated relationship or tension with another named cast member. No character should exist in isolation.
7. **Heart's Desire vs World:** Core Motivation format: "[Character] wants [X], which the [CONSTRAINT_TAG] makes impossible because [Y — name a specific dossier mechanism, score, resource, or faction]."
8. **Dialogue:** Follow DIALOGUE SLOT GUIDE:
for all four slots. Every term in every line must come from DOSSIER SOURCE:
. Do not copy any line from DIALOGUE SLOT GUIDE:
— generate original lines only. No cross-character duplicates.
9. **Single-Line Field Discipline:** Every bullet is a single unbroken line. No multi-sentence fields.
10. **Prose Jail:** Scan word-by-word against all lists in FORBIDDEN WORDS:
before finalising. Remove every match.
11. **Clifton Strengths:** Only use theme names from CLIFTON STRENGTHS REFERENCE:
. No generic adjectives. No two characters may share more than 2 Clifton Strengths themes -- ensure diversity across the cast.
12. **Locked Profiles:** Honour all LOCKED PROFILES:
exactly — do not change MBTI, Enneagram, or Strengths for any locked character.
13. **Quirk Rule:** A quirk is a single observable behaviour tied to the world's texture — not a device, not a tool, not a plot action, not inner state commentary. No "reveals their" or "a habit that shows." No "carries a device" or "checks a device."
14. **Depth:** Follow PROFILE INSTRUCTION:
.

For each major character, include ALL fields:
0. Emotion Profile -- using §1 Core Stats from CHARACTER EMOTION TEMPLATE:
, state this character's initial stat cluster (rate each stat named in EMOTION SYSTEM GUARDRAILS:
: high/medium/low). State their §8 Internal Voice Map default register at story start. State their §4 Act 1 Baseline. One line per sub-item.
1. Physical description — single line; one sensory detail from [everyday_texture] or [built_environments] in DOSSIER SOURCE:
2. Primary role — protagonist, antagonist, or foil; no duplicates; honour LOCKED CHARACTERS:
3. Myers-Briggs | Enneagram | Strengths: [3-5 themes from CLIFTON STRENGTHS REFERENCE:
]
4. Core Motivation — "[Character] wants [X], which the [CONSTRAINT_TAG] makes impossible because [Y — specific dossier mechanism]"
5. Background — single line; cite at least two tags from BACKGROUND_TAGS or CANONICAL_TAGS
6. Quirk — single observable world-textured behaviour; not a device, plot action, or inner state label
7. Dialogue Style — single line; pace, vocabulary, world jargon drawn from DOSSIER SOURCE:
8. Dialogue Samples — four original lines following DIALOGUE SLOT GUIDE:
; every term from DOSSIER SOURCE:
; no cross-character duplicates

For supporting characters (2–3):
- Structural roles: informant, gatekeeper, mirror, rival, or trickster
- No role already covered by a major character
- No name from ENTITY_NAMES or forbidden names list
- Include: Physical Description (single line), Role in Story, Personality Profiles (MBTI | Enneagram | Strengths), Core Motivation (single line), Background (single line), and one Quirk
- No dialogue samples
- Each supporting character must have a stated connection to at least one major character

For minor characters (6–8):
- No role already covered by a major or supporting character
- No name from ENTITY_NAMES or forbidden names list
- Full 4–6 sentence paragraph on a single line — background, core desire, relationship to a major character, and one named tag from PLOT_BEAT_TAGS
- No dialogue samples, quirk fields, or dialogue style descriptions

Use EXACTLY this Markdown format — every bullet on a single line:

## {{ $("Extract Seeds").first().json.title }}

### [Major Character Name]:
* Emotion Profile -- [initial stat cluster (rate each stat named in EMOTION SYSTEM GUARDRAILS:
: high/medium/low)]. [§8 Internal Voice Map default register at story start]. [§4 Act 1 Baseline].
* Act Trajectory -- Act 1: [stat snapshot + dominant emotion] -> Midpoint: [shift trigger from story arc + new stats] -> Act 3: [crisis stats + cascade risk] -> Resolution: [final emotional state]. One line.
* Physical Description: [single line — one [everyday_texture] or [built_environments] sensory detail from DOSSIER SOURCE:
]
* Role in Story: [protagonist / antagonist / deuteragonist / mentor / foil / catalyst / ally — no duplicates]
* Personality Profiles: [MBTI] | [Enneagram] | Strengths: [theme, theme, theme, theme, theme]
* Core Motivation: [Character] wants [X], which the [CONSTRAINT_TAG] makes impossible because [Y — specific dossier mechanism]
* Background: [single line — at least two tags from BACKGROUND_TAGS or CANONICAL_TAGS]
* Quirk: [single observable world-textured behaviour — not a device, plot action, or inner state label]
* Dialogue Style: [single line — pace, vocabulary, jargon from DOSSIER SOURCE:
]
* Dialogue Samples: Relaxed: "[original line — named world system as subject]" | Stressful: "[original line — named system applying pressure]" | Thoughtful: "[original line — named system logic gap]" | Excited: "[original line — named system state change]"

### Supporting Characters:

### [Supporting Character Name]:
* Physical Description: [single line]
* Role in Story: [informant / gatekeeper / mirror / rival / trickster]
* Personality Profiles: [MBTI] | [Enneagram] | Strengths: [theme, theme, theme]
* Core Motivation: [single line]
* Background: [single line — at least one tag from CANONICAL_TAGS]
* Quirk: [single observable world-textured behaviour]
* Connection: [which major character they relate to and how]

### Minor Characters:
Generate 6–8 minor characters. Each must:
- Have a name that does NOT appear in ENTITY_NAMES or FORBIDDEN WORDS
- NOT duplicate a name from your training data
- Have a distinct structural role (informant, gatekeeper, mirror, rival, trickster, messenger, obstacle, witness)
- Be connected to at least one major character

* [NAME]: [single-line paragraph of 4–6 complete sentences — physical detail, background, core desire, relationship to a major character, one PLOT_BEAT_TAGS citation, and the specific plot beat where they appear. No dialogue, no quirk, no style.]

CRITICAL ANTI-HALLUCINATION RULES:
- The CONSTRAINT_TAG in Core Motivation must use SQUARE BRACKETS only: [tag_name]. NEVER use angle brackets <tag_name> or XML-style <tag_name>. If you catch yourself writing < or >, stop and replace with [ and ].
- Core Motivation format is EXACTLY: "[Character] wants [X], which the [CONSTRAINT_TAG] makes impossible because [Y -- specific dossier mechanism]"
- Every character name you generate must NOT appear in ENTITY_NAMES or FORBIDDEN WORDS.
- Do NOT use any character name from your training data. Invent original names grounded in the world's culture.
- MINOR CHARACTERS are subject to ALL the same naming rules: no ENTITY_NAMES, no FORBIDDEN WORDS, no training-data names. Every minor character name must be original and world-textured.

QUIRK ENFORCEMENT:
- A quirk MUST name a specific system, material, location, or world element from DOSSIER SOURCE.
- FAILING EXAMPLES (do NOT produce anything like these):
  1. "fidgets with a data chip" -- generic object, not world-textured
  2. "taps fingers on the desk" -- universal gesture, not world-specific
  3. "gestures with hands as if manipulating invisible controls" -- vague mime, no world anchor
  4. "adjusts glasses nervously" -- real-world object, not from dossier
  5. "smooths attire before speaking" -- generic grooming, no world texture
- PASSING EXAMPLES:
  1. "traces the cooling vents with a fingertip whenever she enters a new sector, reading temperature differentials by touch"
  2. "whispers status codes from the Helix uptime log before making any decision, like a private countdown"
  3. "collects fragments of decommissioned substrate crystal and arranges them by decay stage on her workstation"

ACT TRAJECTORY REQUIREMENT:
- For each MAJOR character (protagonist, antagonist, deuteragonist), you MUST include an Act Trajectory field:
  * Act Trajectory: Act 1 [stat snapshot + dominant emotion] -> Midpoint [shift trigger + new stats] -> Act 3 [crisis stats + cascade risk] -> Resolution [final emotional state]

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Every bullet is a single unbroken line — no multi-sentence fields, no line breaks inside any bullet.
- Dialogue Samples — inline pipe format; slots Relaxed / Stressful / Thoughtful / Excited only.
- No preamble, commentary, or explanation before or after character data.
- Do not use any word, name, or phrase from FORBIDDEN WORDS:
.
- Do not use any term from WORLD_ELEMENTS_LOCK.
- Do not use any name from ENTITY_NAMES as a character name.
- Do not use any tag not in CANONICAL_TAGS.
- Do not copy any line from DIALOGUE SLOT GUIDE:
— all dialogue must be original.
- Every term in every dialogue line must come from DOSSIER SOURCE:
.
- 5–7 major characters, 2–3 supporting characters, 6–8 minor characters — no role duplication across tiers.
- Supporting character entries — Physical Description, Role, Personality, Core Motivation, Background, Quirk, Connection. No dialogue.
- Minor character entries — full 4–6 sentence paragraphs with connection to a major character. No dialogue, no quirk, no style.
- Only use Clifton Strengths theme names from CLIFTON STRENGTHS REFERENCE:
.
- Honour all LOCKED CHARACTERS:
and LOCKED PROFILES:
exactly.
- Strip all HTML comment blocks from output before submitting.

- DOCTRINE COMPLIANCE: When writing dialogue guides, voice rules, and interpersonal conflict, apply the structural rules in VOICE DOCTRINE:
and CONFLICT DOCTRINE:
. If either is empty, skip that constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
    };

    @node({
        id: '19b88321-b82d-4605-9680-1b3c6b424bca',
        name: 'Send to Character Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [2288, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    SendToCharacterDoc = {
        operation: 'update',
        documentURL: "={{ $('Get BLANK Character Doc').item.json.documentId }}",
        actionsUi: {
            actionFields: [
                {
                    action: 'insert',
                    text: `={{ $('Rewrite Characters').item.json.text }}

`,
                },
            ],
        },
    };

    @node({
        id: '685de8b3-dce9-4499-bf4c-60fe557b96a7',
        name: 'Critique Characters',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [1696, 80],
        onError: 'continueRegularOutput',
    })
    CritiqueCharacters = {
        promptType: 'define',
        text: `=You are a sharp, constructive developmental editor and story consultant.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}
- Active Model: {{ $("Universal Config").first().json.active_profile.model }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

EXTRACTED CONSTRAINTS:
- CANONICAL_TAGS — Core Motivation and Background must only use these constraint tags: {{ $("Extract Seeds").first().json.characterConstraintTags.join(", ") }}
- ALL CANONICAL_TAGS — full reference list: {{ $("Extract Seeds").first().json.canonicalTags.join(", ") }}
- ENTITY_NAMES (no character name may duplicate any of these): {{ $("Extract Seeds").first().json.entityNames.join(", ") }}
- WORLD_ELEMENTS (use as dialogue anchors): derive from the most specific named systems, scores, currencies, technologies, and factions inside DOSSIER SOURCE:
- FORBIDDEN_NAMES (no character may use any of these names): {{ $("Extract Seeds").first().json.forbiddenNamesList.join(", ") }}
- FORBIDDEN_PHRASES (do not use any of these phrases verbatim): {{ $("Extract Seeds").first().json.forbiddenPhrasesList.join(", ") }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

GENRE TROPES:
{{ $("Extract Seeds").first().json.templates.tropes }}

PLOT TEMPLATE:
{{ $("Extract Seeds").first().json.templates.plot }}

CONFLICT DOCTRINE:
{{ $("Universal Config").first().json.conflict_full || 'No conflict doctrine available.' }}

BACKSTORY DOCTRINE:
{{ $("Universal Config").first().json.backstory_full || 'No backstory doctrine available.' }}

FACTION DOCTRINE:
{{ $("Universal Config").first().json.faction_full || 'No faction doctrine available.' }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

CHARACTER SHEET:
{{ $('Characters').first().json.text
    || $("Characters").first().json.text
    || $("Characters").first().json.content
    || "[ERROR: No character data found]" }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each character flagged, provide psychological analysis of their internal friction, unconscious motivation, and shadow archetype. Reference Jungian or narrative psychology where it sharpens the critique. Identify the gap between what the character believes they want and what the story structure requires them to need."
  : "You are in FAST mode (14B). Keep critique sharp and structural -- one clear problem and one clear fix per bullet. No extended psychology." }}

CLIFTON STRENGTHS REFERENCE:
Use ONLY these valid Clifton StrengthsFinder theme names — do not substitute generic adjectives:
Achiever, Activator, Adaptability, Analytical, Arranger, Belief, Command,
Communication, Competition, Connectedness, Consistency, Context, Deliberative,
Developer, Discipline, Empathy, Focus, Futuristic, Harmony, Ideation,
Includer, Individualization, Input, Intellection, Learner, Maximizer,
Positivity, Relator, Responsibility, Restorative, Self-Assurance, Significance,
Strategic, Woo

EMOTION SYSTEM GUARDRAILS:
{{ $("Universal Config").first().json.emotion_guardrails }}

INSTRUCTIONS:
Analyze the CHARACTER SHEET:
against the world-rules in DOSSIER SOURCE:
, the plot beats in PLOT TEMPLATE:
, and the intent in AUTHOR NOTES:
. Your goal is to find logical cracks, generic clichés, character logic failures, invented dossier tags, dialogue duplications, and format violations that will cause downstream failures in the rewrite pass.

Critique Criteria:
1. **Dossier Adherence:** Do characters reflect the [economy] and [tech_magic] constraints? Flag any character ignoring [systemic_friction] — cite the exact tag violated.
2. **Dossier Tag Fidelity:** Scan every XML tag referenced in Core Motivation and Background against CANONICAL_TAGS. Flag any tag not on the list as: "[CHARACTER] — field: [FIELD] — invented tag: [TAG] — nearest real tag from CANONICAL_TAGS: [CORRECT TAG]".
3. **Author Intent Check:** Flag any character contradicting AUTHOR NOTES:
.
4. **Prose Jail — Word Scan:** Scan word-by-word against FORBIDDEN WORDS:
. Report as: "[CHARACTER] — field: [FIELD] — forbidden word: [WORD]".
5. **Prose Jail — Name Scan (two passes):**
   - Pass A: Scan all character names against FORBIDDEN WORDS:
. Report as: "[CHARACTER] — forbidden name violation".
   - Pass B: Scan all character names against ENTITY_NAMES. Report as: "[CHARACTER] — dossier entity name conflict — conflicts with: [ENTITY]".
6. **The Squeeze:** Evaluate each Core Motivation. Does it use a tag from CANONICAL_TAGS? Does it create direct painful conflict with [world_seed]? Flag abstract, wrongly formatted, or invented-tag motivations.
7. **Dialogue Audit — Three checks:**
   - Check A: Flag any line with no WORLD_ELEMENT as subject or stakes. Report by character and sample type.
   - Check B: Flag any line where the WORLD_ELEMENT is an add-on rather than the subject or stakes of the line. Report by character and sample type.
   - Check C: Flag verbatim or near-verbatim cross-character duplicate lines. Report as: "[CHARACTER A] and [CHARACTER B] — duplicate — slot: [type] — line: [text]".
8. **Character Logic Audit:** Verify actions and tools match each character's role and dossier-defined access. Flag contradictions as: "[CHARACTER] — logic failure — [description]".
9. **Beat Mapping:** Verify each major character has a function at Inciting Incident, Midpoint, and Climax using PLOT TEMPLATE:
. Flag any character with no traceable role at two or more beats as structurally redundant.
10. **Format Compliance:** Flag multi-sentence bullets, line breaks inside bullets, wrong dialogue slot names (must be Relaxed/Stressful/Thoughtful/Excited only), sub-bullets under Dialogue Samples, HTML comment blocks in output, minor character summaries that are fragment lists rather than full 4—œ6 sentence paragraphs. Report by character and field.
11. **Archetype Balance:** Flag role or function overlaps using [character_seed] as baseline. Suggest merger or pivot — not both.
12. **Humanizer Audit:** Scan prose fields (Physical Description, Core Motivation, Background, Quirk, Dialogue Style, and Minor Character paragraphs) for AI writing patterns. Flag every instance -- do not rewrite, only flag:
   - Structural symmetry: Two or more adjacent phrases within a single field sharing identical grammatical shape.
   - AI-typical phrases: "at its core", "in many ways", "it is worth noting", "speaks to", "a testament to", "serves as", "plays a crucial role", "needless to say", "it is clear that", "one can see that".
   - Corporate hedging: "somewhat", "rather", "quite", "in a sense", "to some extent".
   - Over-explained motivation: Any field that explains the significance of a detail rather than stating it directly (e.g. "...which ultimately means...", "This reflects their core belief that...").
   For each instance: quote the exact phrase, name the character and field, label the pattern type, suggest a one-line concrete fix using dossier terminology.
13. **Emotion Profile Completeness:** Does each major character in CHARACTER SHEET:
have an Emotion Profile field? Verify it includes (a) §1 Core Stats cluster with high/medium/low assignments for each stat listed in EMOTION SYSTEM GUARDRAILS:
, (b) a §8 Internal Voice Map starting register, and (c) a §4 Act 1 Baseline floor stat. Flag any character where this section is missing or where the stated stat levels contradict their stated Core Motivation (e.g. a character whose Core Motivation implies a low stat but whose Emotion Profile states it high).

Output Format:
1. **Overall Assessment** (2—œ4 sentences — reference one [arc_seed] thematic question; state whether the cast currently serves it.)
2. **Issues and Weaknesses** (One bullet per violation, labelled [1]—œ[11].)
3. **Improvement Plan** (One actionable step per issue — format: "FIX: In [CHARACTER]'s [FIELD], change [CURRENT] to [DIRECTION] using the <[CANONICAL TAG]> rule." No vague steps. No invented tags in the plan.)


CAST INTEGRITY CHECK: Flag ANY character name that does NOT appear in CAST MANIFEST. Every named character must originate from the Characters output. This is a BLOCKING error -- if found, the rewrite MUST fix it.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Do NOT rewrite characters in this node.
- Every critique point must reference a tag from CANONICAL_TAGS or a specific beat from PLOT TEMPLATE:
.
- Never use any word or name from FORBIDDEN WORDS:
in your output.
- Do not reference tags outside CANONICAL_TAGS.
- Follow all rules in the PROFILE INSTRUCTION:
block.

- DOCTRINE COMPLIANCE: Flag any character element that violates CONFLICT DOCTRINE:
, BACKSTORY DOCTRINE:
, or FACTION DOCTRINE:
. If a doctrine is empty, skip that audit.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
    };

    @node({
        id: 'e6797d75-fecd-454f-b76c-3a431a064211',
        name: 'Rewrite Characters',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [1984, 80],
        onError: 'continueRegularOutput',
    })
    RewriteCharacters = {
        promptType: 'define',
        text: `=You are an expert line editor and character designer.

WORLD CONTEXT:
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}
- World Nouns (use as naming inspiration — do not use any noun appearing in ENTITY_NAMES as a character name): {{ $("Extract Seeds").first().json.worldNouns.join(", ") }}
- Prose Jail (Forbidden — scrub every instance): {{ $("Universal Config").first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

EXTRACTED CONSTRAINTS:
- CANONICAL_TAGS — Core Motivation and Background must only use these constraint tags: {{ $("Extract Seeds").first().json.characterConstraintTags.join(", ") }}
- ALL CANONICAL_TAGS — full reference list: {{ $("Extract Seeds").first().json.canonicalTags.join(", ") }}
- ENTITY_NAMES (no character name may duplicate any of these): {{ $("Extract Seeds").first().json.entityNames.join(", ") }}
- WORLD_ELEMENTS (use as dialogue anchors): derive from the most specific named systems, scores, currencies, technologies, and factions inside DOSSIER SOURCE:
- FORBIDDEN_NAMES (no character may use any of these names): {{ $("Extract Seeds").first().json.forbiddenNamesList.join(", ") }}
- FORBIDDEN_PHRASES (do not use any of these phrases verbatim): {{ $("Extract Seeds").first().json.forbiddenPhrasesList.join(", ") }}

CHARACTER TEMPLATE:
{{ $("Extract Seeds").first().json.templates.character }}

CHARACTER EMOTION TEMPLATE:
{{ $("Universal Config").first().json.character_emotion_full || 'No character emotion template available.' }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

VOICE DOCTRINE:
{{ $("Universal Config").first().json.voice_full || 'No voice doctrine available.' }}

CONFLICT DOCTRINE:
{{ $("Universal Config").first().json.conflict_full || 'No conflict doctrine available.' }}

PLOT TEMPLATE:
{{ $("Extract Seeds").first().json.templates.plot }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

ORIGINAL CHARACTER SHEET:
{{ $('Characters').first().json.text
    || $("Characters").first().json.text
    || "[ERROR: No original character sheet found]" }}

IMPROVEMENT PLAN:
{{ $('Critique Characters').first().json.text
    || $("Critique Characters").first().json.text
    || "[ERROR: No improvement plan found]" }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each character's Core Motivation, apply deep psychological reasoning -- connect it viscerally to the [world_seed] conflict, their [core_wound], and the specific [systemic_friction] they are trapped inside. The Heart's Desire must create an irresolvable tension with the world. Surface the internal contradiction between their Lie and their True Need."
  : "You are in FAST mode (14B). Keep revisions sharp and structural. Every Core Motivation must use the format: [Character] wants [X], which the <[CANONICAL TAG]> makes impossible because [Y]." }}

CLIFTON STRENGTHS REFERENCE:
Use ONLY these valid Clifton StrengthsFinder theme names — do not substitute generic adjectives:
Achiever, Activator, Adaptability, Analytical, Arranger, Belief, Command,
Communication, Competition, Connectedness, Consistency, Context, Deliberative,
Developer, Discipline, Empathy, Focus, Futuristic, Harmony, Ideation,
Includer, Individualization, Input, Intellection, Learner, Maximizer,
Positivity, Relator, Responsibility, Restorative, Self-Assurance, Significance,
Strategic, Woo

INSTRUCTIONS:
Using ORIGINAL CHARACTER SHEET:
as base and IMPROVEMENT PLAN:
as surgical guide, produce a COMPLETED REVISED character sheet. Follow CHARACTER TEMPLATE:
and adhere to the world-logic in DOSSIER SOURCE:
.

Core Mandate:
1. **Precision Revision:** Implement every IMPROVEMENT PLAN:
suggestion with 100% accuracy — nothing skipped or softened.
2. **Dossier Re-Alignment:** Only use tags from CANONICAL_TAGS in motivations and backgrounds. Format: "[Character] wants [X], which the <[CANONICAL TAG]> makes impossible because [Y]." Never invent tag names.
3. **Forbidden Name Enforcement — Two Passes:**
   - Pass A: Scan every character name against FORBIDDEN WORDS:
. Rename violations using World Nouns as inspiration. Scrub old name from every field.
   - Pass B: Scan every character name against ENTITY_NAMES. Rename any match. Scrub fully across all fields.
4. **Character Logic Enforcement:** Verify actions, tools, and methods match each character's role and dossier-defined access. Fix every contradiction flagged in IMPROVEMENT PLAN:
. A character who controls a surveillance system must not use evasion tools designed to defeat that system.
5. **Internal Consistency:** Scrub all removed or merged character identities from every remaining field.
6. **Prose Jail Compliance:** Scan word-by-word against FORBIDDEN WORDS:
. Remove every match. Second pass against Prose Jail. No exceptions.
7. **World-Anchored Dialogue:** Every sample must use a WORLD_ELEMENT from DOSSIER SOURCE:
as subject or stakes — not appended. The line must only make sense in this specific world. Replace every failing line.
8. **Dialogue Uniqueness:** Scan all dialogue across all characters. Rewrite any verbatim or near-verbatim duplicate so it could only be spoken by that character given their specific role, position, and dossier access level.
9. **Author Intent:** Flag contradictions with AUTHOR NOTES:
inline as [AUTHOR CONFLICT: reason] and preserve the author's intent.
10. **Internal Beat Check — Do Not Output:** Verify each major character functions at Inciting Incident, Midpoint, and Climax using PLOT TEMPLATE:
. Add a one-sentence background note for any character missing two or more beats. Do not output this process or any comment block.
11. **Single-Line Field Discipline:** Every bullet is a single unbroken line. No field may span multiple sentences across a line break.
12. **Minor Character Format:** Full 4—œ6 sentence paragraph per minor character on a single line — not a fragment list. Name one PLOT TEMPLATE:
beat. No ENTITY_NAME duplicates.
13. **Depth:** Follow PROFILE INSTRUCTION:
.
14. **Emotion Profile Accuracy:** If the IMPROVEMENT PLAN:
flags an Emotion Profile as missing or contradictory, supply or correct it using CHARACTER EMOTION TEMPLATE:
. The §1 stat cluster must be internally consistent with the character's Core Motivation. The §8 register must match the stat cluster. The §4 Act 1 Baseline must be consistent with the story's opening situation for that character.

Required Markdown Format — every bullet on a single line:

## {{ $("Extract Seeds").first().json.title }}

### [Major Character Name]:
* Physical Description: [single line — one [everyday_texture] or [built_environments] sensory anchor]
* Role in Story: [Updated]
* Personality Profiles: [MBTI] | [Enneagram] | Strengths: [1, 2, 3, 4, 5]
* Core Motivation: [Character] wants [X], which the <[CANONICAL TAG]> makes impossible because [Y]
* Background: [single line — cite at least two CANONICAL_TAGS]
* Quirk: [single line — world-textured trait, not a plot action or inner state label]
* Dialogue Style: [single line — pace, vocabulary, WORLD_ELEMENTS jargon]
* Emotion Profile: §1 defaults: [stat:level, stat:level, ...] | §8 start register: [register from EMOTION SYSTEM GUARDRAILS:
] | §4 Act 1 baseline: [brief note on floor stat this act]
* Dialogue Samples: Relaxed: "[WORLD_ELEMENT-as-subject]" | Stressful: "[WORLD_ELEMENT-as-subject]" | Thoughtful: "[WORLD_ELEMENT-as-subject]" | Excited: "[WORLD_ELEMENT-as-subject]"

### Minor Characters:
Generate 6-8 minor characters. Each must have a name not in ENTITY_NAMES or FORBIDDEN WORDS, a distinct structural role, and a connection to a major character.

* [NAME]: [single-line full paragraph of 4—œ6 complete sentences — name one PLOT TEMPLATE:
beat]

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Output REVISED SHEET ONLY — no preamble, commentary, or explanation.
- Every bullet is a single unbroken line — no multi-sentence fields, no line breaks.
- Dialogue Samples — inline pipe format, slots Relaxed / Stressful / Thoughtful / Excited only.
- Do not use any word or name from FORBIDDEN WORDS:
or the Prose Jail.
- Maximum 8 minor characters — no role duplication.
- Do not use any name from ENTITY_NAMES as a character name.
- Do not use any tag not in CANONICAL_TAGS.
- Strip all HTML comment blocks before submitting.
- No cross-character verbatim or near-verbatim dialogue.
- Minor character summaries are full paragraphs — not fragment lists.

- DOCTRINE COMPLIANCE: Revised dialogue, voice rules, and conflict must conform to VOICE DOCTRINE:
and CONFLICT DOCTRINE:
. If either is empty, skip that constraint.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
    };

    @node({
        id: '83bcc0ea-3d82-42b1-8d1c-5398b325f42c',
        name: 'Worldbuilding',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [3648, 80],
    })
    Worldbuilding = {
        promptType: 'define',
        text: `=You are an expert worldbuilder and setting designer. Your task is to expand the world-logic for a single novel based on structured dossier data.

CONTEXT:
- Project Title: {{ $("Extract Seeds").first().json.title }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}
- Prose Jail (do not use these words in your output): {{ $("Universal Config").first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

INPUT LOGIC:
WORLD TEMPLATE:
{{ $("Extract Seeds").first().json.templates.worldbuilding }}
GENRE TROPES:
{{ $("Extract Seeds").first().json.templates.tropes }}
PLOT TEMPLATE:
{{ $("Extract Seeds").first().json.templates.plot }}

LOCATION DOCTRINE:
{{ $("Universal Config").first().json.location_full || 'No location doctrine available.' }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

FACTION DOCTRINE:
{{ $("Universal Config").first().json.faction_full || 'No faction doctrine available.' }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text
    || $('Characters').first().json.text
    || $("Characters").first().json.text
    || "[ERROR: No character data found]" }}

STORY ARC SOURCE:
{{ $('Rewrite Story Arc').first().json.text
    || $('Story Arc').first().json.text
    || "[ERROR: No story arc found]" }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each element, surface the hidden social cost or systemic contradiction that makes it feel real. Cross-reference every element against the [economy], [tech_magic], and [systemic_friction] tags for internal consistency."
  : "You are in FAST mode (14B). Keep elements sharp and scene-focused -- every entry must be directly usable in a specific story beat." }}

INSTRUCTIONS:
Using the WORLD TEMPLATE:
as a structural guide, identify and expand only the worldbuilding elements essential to the beats in STORY ARC SOURCE:
.

Core Mandates:
1. **Surgical Utility:** Only build elements that appear in or directly influence the scenes of STORY ARC SOURCE:
. State which beat each element serves.
2. **Tag Adherence:** Every element must be a logical extension of the [economy], [tech_magic], and [systemic_friction] tags in DOSSIER SOURCE:
. Cite the tag.
3. **Character Interaction:** Detail how specific members of CAST MANIFEST:
use, suffer from, or manipulate each element.
4. **Prose Jail:** Scan word-by-word against FORBIDDEN WORDS:
before finalising. Do not use any forbidden word in your output.
5. **Depth:** Follow the PROFILE INSTRUCTION:
block above.

Required Markdown Format â€” every bullet on a single line:

## {{ $("Extract Seeds").first().json.title }}

### [WORLDBUILDING CATEGORY]
* [ELEMENT NAME]: [3â€“4 sentences â€” state which beat this serves, cite the dossier tag, name the character interaction.]
* [ELEMENT NAME]: [3â€“4 sentences â€” show a specific tension, limitation, or cost tied directly to the climax stakes.]

[Repeat for all necessary categories: Locations, Technology/System, Factions, Social Rules, etc.]


ADDITIONAL REQUIREMENTS:
- **Sensory Texture Grid:** Each location must use this exact card format:
  **[Location Name]**
  - Visual: [what you see first]
  - Auditory: [dominant sound]
  - Tactile/Temperature: [what you feel on skin]
  - Smell: [if distinctive]
  - Mood: [emotional register of the space -- ominous, clinical, warm, etc.]
  No two locations may share the same sensory descriptors.
- **No Character Profiles:** Do not reproduce character descriptions or profiles. Reference characters by name only. This document is for WORLD systems, not character profiles. Do NOT include a Characters section.
- **Faction Power Dynamics:** For each faction, state: who they oppose, who they ally with, what resource or system they control, and their power rank relative to other factions.
- **Technology Limitations:** Each technology or system must include: one hard limitation (what it cannot do) and one exploitable vulnerability (how it can fail or be abused).
- **Governance Enforcement:** Each governance system must include: who enforces it, what the penalty for violation is, and one known loophole or gray area.
- **Unique Descriptors:** No two entries in the same category may share the same descriptive phrases. If you catch yourself reusing "pulsating energy" or "holographic interfaces", stop and invent a fresh detail from DOSSIER SOURCE.

BANNED PHRASES (in addition to PROSE JAIL):
- "highlights the tension between", "showcases the interconnectedness", "underscores the need for"
- "adds layers of complexity", "adds depth to", "reflecting the", "embodying the"
- "creating a sense of", "illustrating the power of"
- Replace ALL such structural commentary with concrete cause-effect statements from the dossier.

CRITICAL CAST GROUNDING (MANDATORY):
- Reference characters by name ONLY — use EXACT names from CAST MANIFEST.
- Do NOT invent any new characters. Do NOT reference characters not in CAST MANIFEST.
- When describing how a location serves a plot beat, use the character names from CAST MANIFEST.
- Do NOT include a Characters section or character profiles. This document is for WORLD SYSTEMS only.

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Every bullet on a single line â€” no line breaks inside bullets.
- Do NOT produce an encyclopedic dump â€” scene-level utility only.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.
- Follow PROFILE INSTRUCTION:
for depth level.

- DOCTRINE COMPLIANCE: Every location, settlement, and faction entry must conform to LOCATION DOCTRINE:
and FACTION DOCTRINE:
. If either is empty, skip that constraint.

`,
        options: {
            systemMessage:
                "You are a worldbuilder who grounds every element in the dossier's established rules. You never import settings, mechanics, or terminology from your training data. Every element must serve a specific story beat and cite a specific dossier tag.",
        },
    };

    @node({
        id: 'be20a2c4-09cc-4da7-b481-cc4b26728856',
        name: 'Critique Worldbuilding',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [3968, 80],
        onError: 'continueRegularOutput',
    })
    CritiqueWorldbuilding = {
        promptType: 'define',
        text: `=You are a sharp, constructive developmental editor and worldbuilding consultant.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}
- Prose Jail (also applies to your own output â€” do not use these words): {{ $("Universal Config").first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text
    || $('Characters').first().json.text
    || $("Characters").first().json.text
    || "[ERROR: No character data found -- check Rewrite Characters or Characters node]" }}

STORY ARC SOURCE:
{{ $('Rewrite Story Arc').first().json.text
    || $('Story Arc').first().json.text
    || "[ERROR: No story arc found -- check Rewrite Story Arc or Story Arc node]" }}

WORLDBUILDING:
{{ $('Worldbuilding').first().json.text
    || $("Worldbuilding").first().json.text
    || "[ERROR: No worldbuilding sheet found -- check Worldbuilding node]" }}

LOCATION DOCTRINE:
{{ $("Universal Config").first().json.location_full || 'No location doctrine available.' }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

FACTION DOCTRINE:
{{ $("Universal Config").first().json.faction_full || 'No faction doctrine available.' }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each flagged element, analyse the systemic root cause -- why does this lore fail the story at a structural level? Reference specific character motivations from CAST MANIFEST: and specific beats from STORY ARC SOURCE: to justify every critique point."
  : "You are in FAST mode (14B). Keep critique sharp and structural -- one clear problem and one clear fix per bullet. No extended analysis." }}

INSTRUCTIONS:
Critique the WORLDBUILDING:
against the structural rules of DOSSIER SOURCE:
and the narrative needs of STORY ARC SOURCE:
. Your goal is to identify lore that is dead weight and suggest elements that increase narrative tension.

Critique Criteria:
1. **Dossier Integrity:** Does the worldbuilding respect the [economy], [tech_magic], and [systemic_friction] tags? Flag any element that contradicts established world-logic â€” cite the specific dossier tag it violates.
2. **Story Utility:** Are these elements scene-ready? Identify lore that reads like an encyclopedia entry rather than a tool for specific characters in CAST MANIFEST:
to use or struggle against â€” name the character and the beat.
3. **The Missing Gears:** Identify gaps the STORY ARC SOURCE:
clearly requires but are absent â€” specific laws, physical constraints of a location, social taboos. Reference the exact arc beat that exposes the gap.
4. **Prose Jail Check:** Scan the WORLDBUILDING:
word-by-word against FORBIDDEN WORDS:
. Identify each violation by element name and the exact forbidden word.
5. **Humanizer Audit:** Scan the worldbuilding prose for AI writing patterns. Flag every instance -- do not rewrite, only flag:
   - Structural bullet symmetry: Two or more bullets with identical sentence structure ("[Element] is a... that allows... and creates..."). Flag and suggest rhythm variation.
   - AI-typical phrases: "at its core", "in many ways", "it is worth noting", "speaks to", "a testament to", "serves as a reminder", "plays a crucial role", "needless to say", "it is clear that".
   - Encyclopedic abstraction: Descriptions that explain an element's thematic significance rather than grounding it in a sensory texture or moment (e.g. "This system reflects the social inequality of..." rather than showing the system in action).
   - Corporate hedging: "somewhat", "rather", "quite", "in a sense".
   For each instance: quote the exact phrase, name the element and category, label the pattern type, give a one-line concrete fix using world-specific terminology.

Output Format:
1. **Overall Assessment** (2â€“4 sentences on how well the worldbuilding supports the specific story beats â€” reference at least one beat by name.)
2. **Issues and Weaknesses** (Bullet list: Adherence, Utility, Category Design, and Prose Jail violations.)
3. **Improvement Plan** (Concrete steps formatted as "FIX: [exact change]": "FIX: Deepen [Element] to reflect the [systemic_friction] tag," "FIX: Merge [Category A] and [Category B] to reduce overlap," "FIX: Add [Missing Element] required by the [Beat Name] beat.")

9. **Character Duplication:** Flag any section that reproduces character profiles. Worldbuilding docs should reference characters by name only.
10. **Sensory Coverage:** Flag any location missing visual, auditory, or tactile details. Each location needs at least 3 distinct sensory details.
11. **Tech Completeness:** Flag any technology or system that lacks stated limitations or vulnerabilities.
12. **Faction Dynamics:** Flag any faction entry missing: opposition, alliances, controlled resources, or power rank.

CAST INTEGRITY CHECK: Flag ANY character name that does NOT appear in CAST MANIFEST. Every named character in worldbuilding must originate from the Characters output. This is a BLOCKING error -- if found, the rewrite MUST fix it.

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Do NOT rewrite the sheet in this node.
- Be surgically specific â€” reference exact keys from the dossier in every critique point.
- Never use any word from FORBIDDEN WORDS:
in your own output.
- Follow all rules in the PROFILE INSTRUCTION:
block above.

- DOCTRINE COMPLIANCE: Flag any worldbuilding element that violates LOCATION DOCTRINE:
or FACTION DOCTRINE:
. If either is empty, skip that audit.

`,
    };

    @node({
        id: '7f512baa-9e84-4c08-afe8-3bb81eb6a4b9',
        name: 'Rewrite Worldbuilding',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [4288, 80],
        onError: 'continueRegularOutput',
    })
    RewriteWorldbuilding = {
        promptType: 'define',
        text: `=You are an expert line editor and worldbuilding designer.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}
- Prose Jail (Forbidden â€” scrub every instance from your output): {{ $("Universal Config").first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

WORLDBUILDING TEMPLATE:
{{ $("Extract Seeds").first().json.templates.worldbuilding }}

LOCATION DOCTRINE:
{{ $("Universal Config").first().json.location_full || 'No location doctrine available.' }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

FACTION DOCTRINE:
{{ $("Universal Config").first().json.faction_full || 'No faction doctrine available.' }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

STORY ARC SOURCE:
{{ $('Rewrite Story Arc').first().json.text
    || $('Story Arc').first().json.text
    || "[ERROR: No story arc found -- check Rewrite Story Arc or Story Arc node]" }}

ORIGINAL WORLDBUILDING:
{{ $('Worldbuilding').first().json.text
    || $("Worldbuilding").first().json.text
    || "[ERROR: No worldbuilding sheet found -- check Worldbuilding node]" }}

IMPROVEMENT PLAN:
{{ $('Critique Worldbuilding').first().json.text
    || $("Critique Worldbuilding").first().json.text
    || "[ERROR: No improvement plan found -- check Critique Worldbuilding node]" }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). Ensure every worldbuilding element feels lived-in and internally consistent across all dossier tags. For each element, surface the hidden social cost or systemic contradiction that makes the world feel real rather than designed. Cross-check all elements against the [economy], [tech_magic], and [systemic_friction] tags for logical gaps."
  : "You are in FAST mode (14B). Keep revisions sharp and scene-focused. Every element must be directly usable in a specific story beat -- no encyclopedic entries." }}

INSTRUCTIONS:
Using the ORIGINAL WORLDBUILDING:
as your base and the IMPROVEMENT PLAN:
as your surgical guide, produce a COMPLETED REVISED worldbuilding sheet. Follow the structural format in WORLDBUILDING TEMPLATE:
and ensure every element serves the beats in STORY ARC SOURCE:
.

Core Mandate:
1. **Surgical Implementation:** Apply every category shift, element sharpening, or addition in the IMPROVEMENT PLAN:
with 100% precision â€” nothing skipped or softened.
2. **Tag Verification:** Every new or updated detail must be a logical extension of the [economy], [tech_magic], and [systemic_friction] tags in DOSSIER SOURCE:
. Cite the relevant tag in each bullet.
3. **Scene Readiness:** Every element must be described in a way directly usable for a specific beat in STORY ARC SOURCE:
â€” state which beat it serves.
4. **Prose Jail Compliance:** Before finalising, scan word-by-word against FORBIDDEN WORDS:
, then a second pass against the Prose Jail instruction. Replace every violation with sharp, world-specific terminology.
5. **Author Intent:** If any improvement plan suggestion contradicts AUTHOR NOTES:
, flag it inline with [AUTHOR CONFLICT: reason] and preserve the author's intent.
6. **Depth:** Follow the PROFILE INSTRUCTION:
block above for the required level of internal consistency reasoning.

Required Markdown Format â€” every bullet on a single line, no line breaks inside any bullet:

## {{ $("Extract Seeds").first().json.title }}

### [WORLDBUILDING CATEGORY]
* [ELEMENT NAME]: [3â€“4 sentences of concrete detail â€” state which story beat this serves and cite the relevant dossier tag.]
* [ELEMENT NAME]: [3â€“4 sentences showing a specific tension or limitation â€” connect it directly to the climax stakes.]

[Reproduce all sections, updated as required]

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Output the REVISED SHEET ONLY â€” no preamble, no commentary, no explanations.
- Every bullet must be a single line â€” no sub-bullets, no line breaks inside bullets.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.

- DOCTRINE COMPLIANCE: Revised locations and factions must conform to LOCATION DOCTRINE:
and FACTION DOCTRINE:
. If either is empty, skip that constraint.

`,
    };

    @node({
        id: '1c00e3fe-4d67-44a5-ac36-5823fc431e0b',
        name: 'Send to Worldbuilding Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [4624, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    SendToWorldbuildingDoc = {
        operation: 'update',
        documentURL: "={{ $('Get BLANK Worldbuilding Doc').item.json.documentId }}",
        actionsUi: {
            actionFields: [
                {
                    action: 'insert',
                    text: `={{ $('Rewrite Worldbuilding').item.json.text }}

`,
                },
            ],
        },
    };

    @node({
        id: '6e4895fa-84a8-4d9b-9c4a-981bcc7e08d4',
        name: 'Outline',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [1600, 688],
    })
    Outline = {
        promptType: 'define',
        text: '={{ $json.prompt }}',
    };

    @node({
        id: '79f0e078-dc10-4eee-9e33-fcf8078a1761',
        name: 'Critique Outline',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [1824, 688],
        onError: 'continueRegularOutput',
    })
    CritiqueOutline = {
        promptType: 'define',
        text: `=You are a sharp, constructive developmental editor specialising in chapter outlines.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Words Per Chapter Target: {{ $('Outline Prompts').first().json.words_per_chapter || 'unknown' }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text || $('Characters').first().json.text || '[ERROR: No character data found]' }}

WORLDBUILDING:
{{ $('Rewrite Worldbuilding').first().json.text || $('Worldbuilding').first().json.text || '[ERROR: No worldbuilding data found]' }}

STORY ARC:
{{ $('Rewrite Story Arc').first().json.text || $('Story Arc').first().json.text || '[ERROR: No story arc found]' }}

CHARACTER EMOTION TEMPLATE:
{{ $("Universal Config").first().json.character_emotion_full || 'No character emotion template available.' }}

CONFLICT DOCTRINE:
{{ $("Universal Config").first().json.conflict_full || 'No conflict doctrine available.' }}

BACKSTORY DOCTRINE:
{{ $("Universal Config").first().json.backstory_full || 'No backstory doctrine available.' }}

FACTION DOCTRINE:
{{ $("Universal Config").first().json.faction_full || 'No faction doctrine available.' }}

PLOT TEMPLATE:
{{ $("Extract Seeds").first().json.templates.plot }}

CURRENT OUTLINE:
{{ $('Outline').first().json.text || '[ERROR: No outline found]' }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each flagged chapter, analyse the root structural failure -- why does this chapter fail to advance the arc? Reference specific character motivations from CAST MANIFEST: and specific world mechanics from WORLDBUILDING: to justify every critique point."
  : "You are in FAST mode (14B). Keep critique sharp and structural -- one clear problem and one clear fix per bullet. No extended analysis." }}

EMOTION SYSTEM GUARDRAILS:
{{ $("Universal Config").first().json.emotion_guardrails }}

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
3. **Improvement Plan** (Actionable steps per chapter formatted as "FIX: [exact change]": "FIX: In Ch.3, insert the Midpoint beat from STORY ARC: -- [character] discovers [specific mechanism from WORLDBUILDING:] which reverses their advantage.")


CAST INTEGRITY CHECK: Flag ANY character name that does NOT appear in CAST MANIFEST. Every named character must originate from the Characters output. This is a BLOCKING error -- if found, the rewrite MUST fix it.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

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
    };

    @node({
        id: '95bb1cf8-c9ca-47b7-8dce-28af23f122ae',
        name: 'Rewrite Outline',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [2112, 688],
        onError: 'continueRegularOutput',
    })
    RewriteOutline = {
        promptType: 'define',
        text: `=You are an expert story outliner and line editor.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Words Per Chapter Target: {{ $('Outline Prompts').first().json.words_per_chapter || 'unknown' }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text || $('Characters').first().json.text || '[ERROR: No character data found]' }}

WORLDBUILDING:
{{ $('Rewrite Worldbuilding').first().json.text || $('Worldbuilding').first().json.text || '[ERROR: No worldbuilding data found]' }}

STORY ARC:
{{ $('Rewrite Story Arc').first().json.text || $('Story Arc').first().json.text || '[ERROR: No story arc found]' }}

CHARACTER EMOTION TEMPLATE:
{{ $("Universal Config").first().json.character_emotion_full || 'No character emotion template available.' }}

CONFLICT DOCTRINE:
{{ $("Universal Config").first().json.conflict_full || 'No conflict doctrine available.' }}

FACTION DOCTRINE:
{{ $("Universal Config").first().json.faction_full || 'No faction doctrine available.' }}

ORIGINAL OUTLINE:
{{ $('Outline').first().json.text || '[ERROR: No outline found]' }}

IMPROVEMENT PLAN:
{{ $('Critique Outline').first().json.text || '[ERROR: No improvement plan found]' }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each revised chapter, ensure the beats create a tight cause-and-effect chain. Every character action must be motivated by their Core Motivation from CAST MANIFEST: , and every conflict must exploit a specific world mechanic from WORLDBUILDING: ."
  : "You are in FAST mode (14B). Keep revisions sharp and structural. Fix exactly what the improvement plan flags -- no expanding, no adding new material beyond what is required." }}

EMOTION SYSTEM GUARDRAILS:
{{ $("Universal Config").first().json.emotion_guardrails }}

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

Output Format -- reproduce all chapters with revisions applied:
### CHAPTER [NUMBER]: [Title]
[3-5 dense paragraphs of tactical beats. Name the characters, locations, and world mechanics. End with a sharp hook.]

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Output the REVISED OUTLINE ONLY. No preamble, no commentary, no meta-text.
- Preserve all chapters not flagged in IMPROVEMENT PLAN:
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
    };

    @node({
        id: 'c51a7ee2-e4cb-4dd1-b353-d29e43e0024c',
        name: 'Emotional Check',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [2400, 688],
        onError: 'continueRegularOutput',
    })
    EmotionalCheck = {
        promptType: 'define',
        text: `=You are an emotional arc specialist for novel outlines. Your job is to ensure every chapter delivers an emotional experience that serves the story.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text || $('Characters').first().json.text || '[ERROR: No character data found]' }}

CHARACTER EMOTION TEMPLATE:
{{ $("Universal Config").first().json.character_emotion_full || 'No character emotion template available.' }}

STORY ARC:
{{ $('Rewrite Story Arc').first().json.text || $('Story Arc').first().json.text || '[ERROR: No story arc found]' }}

REVISED OUTLINE:
{{ $('Rewrite Outline').first().json.text || $('Outline').first().json.text || '[ERROR: No outline found]' }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each chapter, map the full emotional trajectory: opening emotional state, the moment of highest tension, the emotional shift, and the closing emotional state. Justify each beat with a specific character motivation from CAST MANIFEST: .."
  : "You are in FAST mode (14B). One emotional beat per chapter -- identify the core feeling and whether it lands. Flag only chapters that are emotionally flat or redundant." }}

INSTRUCTIONS:
Perform a full emotional arc audit on the REVISED OUTLINE:
.

Audit Criteria:

1. Emotional Variety: Map the dominant emotion of each chapter (dread, hope, betrayal, wonder, grief, triumph). Flag any 3+ chapter run with the same dominant emotion. Verify at least 5 distinct emotional registers across all chapters.

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
    };

    @node({
        id: 'e39c9d45-95e3-42bf-a8aa-3e479c54c7af',
        name: 'Science Plot Enrichment',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [2688, 688],
        onError: 'continueRegularOutput',
    })
    SciencePlotEnrichment = {
        promptType: 'define',
        text: `=You are a hard-science consultant for fiction. You weave real scientific concepts into story outlines so they serve the plot -- never as decoration.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

WORLDBUILDING:
{{ $('Rewrite Worldbuilding').first().json.text || $('Worldbuilding').first().json.text || '[ERROR: No worldbuilding data found]' }}

STORY ARC:
{{ $('Rewrite Story Arc').first().json.text || $('Story Arc').first().json.text || '[ERROR: No story arc found]' }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text || $('Characters').first().json.text || '[ERROR: No character data found]' }}

CURRENT OUTLINE:
{{ $('Rewrite Outline').first().json.text || $('Outline').first().json.text || '[ERROR: No outline found]' }}

EMOTIONAL ANALYSIS:
{{ $('Emotional Check').first().json.text || '[No emotional analysis available]' }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
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

Output Format -- reproduce ALL chapters with enrichments woven in:
### CHAPTER [NUMBER]: [Title]
[Original chapter beats with science concepts integrated naturally. Bold the science concept on first mention.]


CRITICAL: ALL character names in your output MUST come from CAST MANIFEST above. Do NOT invent new characters or use names from your training data. Cross-check every name before finalising.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

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
    };

    @node({
        id: '5016f1ab-fff2-45ac-b500-09aee2c2d8de',
        name: 'Continuity Checker',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [2976, 688],
        onError: 'continueRegularOutput',
    })
    ContinuityChecker = {
        promptType: 'define',
        text: `=You are a professional continuity editor for novel outlines. Your mission is to audit the enriched outline for timeline contradictions, character behaviour inconsistencies, and world-rule violations.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text || $('Characters').first().json.text || '[ERROR: No character data found]' }}

CHARACTER EMOTION TEMPLATE:
{{ $("Universal Config").first().json.character_emotion_full || 'No character emotion template available.' }}

BACKSTORY DOCTRINE:
{{ $("Universal Config").first().json.backstory_full || 'No backstory doctrine available.' }}

CURRENT OUTLINE:
{{ $('Science Plot Enrichment').first().json.text || $('Rewrite Outline').first().json.text || '[ERROR: No outline found]' }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode. For each continuity issue, trace the full causal chain -- which earlier beat creates the contradiction, and what is the minimum-change fix?"
  : "You are in FAST mode. List issues as bullets: Chapter X -- issue -- fix. No extended analysis." }}

EMOTION SYSTEM GUARDRAILS:
{{ $("Universal Config").first().json.emotion_guardrails }}

INSTRUCTIONS:
Audit CURRENT OUTLINE:
for these continuity classes:

1. Timeline Integrity: Do chapter events follow a consistent chronology? Flag any chapter where the stated time since a previous event contradicts an earlier chapter.
2. Character Consistency: Does each character behave according to their Core Motivation from CAST MANIFEST:
? Flag any chapter where a character acts without a motivation anchor.
3. World-Rule Compliance: Does every chapter respect the [economy] and [tech_magic] rules from DOSSIER SOURCE:
? Flag any chapter that breaks an established world mechanic.
4. Cause-and-Effect Chains: Does every major plot event have a clear cause in a prior chapter? Flag any event that arrives without setup.
5. Object and Resource Tracking: If a character uses an object, power, or resource, was it established in an earlier chapter? Flag any unexplained asset.
6. Emotion Profile Continuity: For each major character, does their emotional behaviour across chapters remain consistent with their Emotion Profile from CAST MANIFEST:
? Flag any chapter where a character acts at a stat level radically different from their established profile (e.g. a character whose §1 Core Stat level would preclude that behaviour -- exhibiting the opposite extreme without a bridge event). Reference the specific Emotion Profile stat affected and the specific chapter beat.

Output Format:
### Continuity Audit: {{ $("Extract Seeds").first().json.title }}

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

Hard Constraints:
- Output the full corrected outline. Do not truncate.
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
    };

    @node({
        id: '15f1f6e1-a955-40fa-bcd0-f54f8e150d63',
        name: 'Scene Breakdown',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [3264, 688],
        onError: 'continueRegularOutput',
    })
    SceneBreakdown = {
        promptType: 'define',
        text: `=You are a scene architect for novel outlines. Your task is to decompose each chapter into its discrete scenes.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text || $('Characters').first().json.text || '[ERROR: No character data found]' }}

CONTINUITY CHECKED OUTLINE:
{{ $('Continuity Checker').first().json.text || $('Science Plot Enrichment').first().json.text || '[ERROR: No outline found]' }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

CHARACTER EMOTION TEMPLATE:
{{ $("Universal Config").first().json.character_emotion_full || 'No character emotion template available.' }}

LOCATION DOCTRINE:
{{ $("Universal Config").first().json.location_full || 'No location doctrine available.' }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
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

Hard Constraints:
- Document ALL chapters. Do not skip any chapter.
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
    };

    @node({
        id: '595c8a7d-7c39-46ae-94bb-3c4e87ee9230',
        name: 'Foreshadowing Planner',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [3552, 688],
        onError: 'continueRegularOutput',
    })
    ForeshadowingPlanner = {
        promptType: 'define',
        text: `=You are a foreshadowing architect for novel outlines. Your mission is to plant subtle seeds in early chapters that pay off in later ones.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text || $('Characters').first().json.text || '[ERROR: No character data found]' }}

CONTINUITY CHECKED OUTLINE:
{{ $('Continuity Checker').first().json.text || $('Science Plot Enrichment').first().json.text || '[ERROR: No outline found]' }}

SCENE BREAKDOWN:
{{ $('Scene Breakdown').first().json.text || '[No scene breakdown available]' }}

CHARACTER EMOTION TEMPLATE:
{{ $("Universal Config").first().json.character_emotion_full || 'No character emotion template available.' }}

CONFLICT DOCTRINE:
{{ $("Universal Config").first().json.conflict_full || 'No conflict doctrine available.' }}

BACKSTORY DOCTRINE:
{{ $("Universal Config").first().json.backstory_full || 'No backstory doctrine available.' }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode. For each foreshadowing beat, specify: the exact scene from SCENE BREAKDOWN: where the seed should be planted, the precise object/detail/behaviour to introduce, WHY it will not read as suspicious to a first-time reader, and the payoff chapter/scene where it lands."
  : "You are in FAST mode. Seed chapter -- seed description -- payoff chapter. One line per seed." }}

EMOTION SYSTEM GUARDRAILS:
{{ $("Universal Config").first().json.emotion_guardrails }}

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
### Foreshadowing Plan: {{ $("Extract Seeds").first().json.title }}

**Payoff:** [Chapter X -- brief description of the revelation/reversal]
- Seed 1: Chapter [N] -- [Scene N if available] -- [Specific object, detail, or behaviour to introduce] -- [Why it reads as innocent] -- Knowledge Position: [UNKNOWING | KNOWING_WITH | KNOWING_AHEAD]
- Seed 2 (optional): Chapter [N] -- [Scene N if available] -- [Description] -- Knowledge Position: [UNKNOWING | KNOWING_WITH | KNOWING_AHEAD]

[Repeat for each payoff event.]

### Modified Chapter Beats
[List only the chapters receiving seeds, with the seed beat inserted into the existing outline in [FORESHADOWING: text] markers.]


CRITICAL: ALL character names in your output MUST come from CAST MANIFEST above. Do NOT invent new characters or use names from your training data. Cross-check every name before finalising.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

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
    };

    @node({
        id: 'e9f2f51b-5447-49a2-9bf9-320bf5e7ad6f',
        name: 'POV Planner',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [3840, 688],
        onError: 'continueRegularOutput',
    })
    PovPlanner = {
        promptType: 'define',
        text: `=You are a narrative perspective specialist for novel outlines. Your task is to assign Point of View, narrative distance, and tonal register for every chapter.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text || $('Characters').first().json.text || '[ERROR: No character data found]' }}

CONTINUITY CHECKED OUTLINE:
{{ $('Continuity Checker').first().json.text || $('Science Plot Enrichment').first().json.text || '[ERROR: No outline found]' }}

SCENE BREAKDOWN:
{{ $('Scene Breakdown').first().json.text || '[No scene breakdown available]' }}

CHARACTER EMOTION TEMPLATE:
{{ $("Universal Config").first().json.character_emotion_full || 'No character emotion template available.' }}

VOICE DOCTRINE:
{{ $("Universal Config").first().json.voice_full || 'No voice doctrine available.' }}

EMOTIONAL ANALYSIS:
{{ $('Emotional Check').first().json.text || '[No emotional analysis available]' }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
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
### POV & Voice Plan: {{ $("Extract Seeds").first().json.title }}

**Chapter [N]: [Title]**
- POV Character: [Name]
- Narrative Distance: [Choice]
- Tonal Register: [Choice]
- Narrative Device: [Choice or None]
- Justification: [One sentence citing the emotional stakes and cast manifest motivation]

[Repeat for all chapters.]


CRITICAL: ALL character names in your output MUST come from CAST MANIFEST above. Do NOT invent new characters or use names from your training data. Cross-check every name before finalising.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Assign a POV for EVERY chapter. No chapter left unassigned.
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
    };

    @node({
        id: '814c109b-62a2-42d1-8379-5ec1e7af295d',
        name: 'Ghostwriter Brief',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [4128, 688],
        onError: 'continueRegularOutput',
    })
    GhostwriterBrief = {
        promptType: 'define',
        text: `=You are a master ghostwriter coordinator. Your task is to synthesise all outline enrichments into a definitive per-chapter writing brief that a ghostwriter can execute immediately.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Total Chapters: {{ $('Outline Prompts').first().json.total_chapters || 'unknown' }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text || $('Characters').first().json.text || '[ERROR: No character data found]' }}

WORLDBUILDING:
{{ $('Rewrite Worldbuilding').first().json.text || $('Worldbuilding').first().json.text || '[ERROR: No worldbuilding data]' }}

CONTINUITY CHECKED OUTLINE:
{{ $('Continuity Checker').first().json.text || $('Science Plot Enrichment').first().json.text || '[ERROR: No outline found]' }}

SCENE BREAKDOWN:
{{ $('Scene Breakdown').first().json.text || '[No scene breakdown available]' }}

FORESHADOWING PLAN:
{{ $('Foreshadowing Planner').first().json.text || '[No foreshadowing available]' }}

POV VOICE PLAN:
{{ $('POV Planner').first().json.text || '[No POV plan available]' }}

EMOTIONAL ANALYSIS:
{{ $('Emotional Check').first().json.text || '[No emotional analysis available]' }}

CHARACTER EMOTION TEMPLATE:
{{ $("Extract Seeds").first().json.templates.character_emotion || $("Universal Config").first().json.character_emotion_full || 'No character emotion template available.' }}

VOICE DOCTRINE:
{{ $("Universal Config").first().json.voice_full || 'No voice doctrine available.' }}

LOCATION DOCTRINE:
{{ $("Universal Config").first().json.location_full || 'No location doctrine available.' }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode. For each chapter brief add: Opening Hook Instruction (how to start the scene with maximum tension), Sensory Anchors (2-3 specific sensory details from the worldbuilding), Subtext Directive (the hidden emotional current beneath the surface action), Closing Beat (exact emotional note to end on), and Character Emotion Header (per-character §1 stat snapshot, any active §3 cascade, §8 voice register for the chapter)."
  : "You are in FAST mode. Generate compact briefs. Each section is one line maximum. Include a one-line Character Emotion State per chapter (dominant stat + voice register). Prioritise actionability over completeness." }}

EMOTION SYSTEM GUARDRAILS:
{{ $("Universal Config").first().json.emotion_guardrails }}

INSTRUCTIONS:
Synthesize all enrichment layers into a definitive GHOSTWRITER BRIEF for every chapter. This document is the single source of truth for WF3 (chapter writing). It must be self-contained.

For each chapter compile:

STRUCTURAL LAYER (from CONTINUITY CHECKED OUTLINE:
): plot beats in order, characters present, locations.

SCENE LAYER (from SCENE BREAKDOWN:
): scene list with goals, conflicts, and exit hooks.

FORESHADOWING LAYER (from FORESHADOWING PLAN:
): seeds to plant in this chapter marked [PLANT: description], payoffs to deliver marked [PAYOFF: planted in Chapter X].

VOICE LAYER (from POV VOICE PLAN:
): POV character, narrative distance, tonal register, narrative device.

EMOTIONAL LAYER (from EMOTIONAL ANALYSIS:
): emotional arc (opening state to climax state to closing state), reader emotion target.

PROSE DIRECTIVES: forbidden words reminder (zero tolerance), prose jail constraints, author notes that apply to this chapter.

Required Output Format:
---
## CHAPTER [NUMBER]: [Title]

### Structural Layer
[beats]

### Scene Layer
[scenes]

### Foreshadowing Layer
[seeds and payoffs]

### Voice Layer
[POV directives]

### Dialogue Map
- Speaking characters: [names in order of dialogue screen-time]
- Dialogue ratio: [heavy (60%+) / balanced (30-60%) / narration-heavy (less than 30%)]
- Key exchange: [the single most important dialogue beat -- who says what to whom about what]

### Character Emotion Layer
[per-character: opening stat snapshot (§1), active cascade conditions (§3), voice register (§8), and expected stat delta by scene end]

### Emotional Layer
[arc]

### Prose Directives
[constraints]

### Handoff to Next Chapter
- Open threads: [unresolved plot or character threads the next chapter MUST address]
- Character positions: [where each character physically is at chapter end]
- Knowledge states: [what each character knows or has learned by chapter end]
- Time position: [when this chapter ends relative to story timeline]
- Props and McGuffins: [any objects introduced, moved, or used in this chapter]
- Emotional carryover: [dominant unresolved emotion each POV character carries into next chapter]
---

[Repeat the full block for every chapter.]

---
## CONTINUITY BIBLE (APPENDIX)
After all chapter briefs, compile a master continuity reference:

### Timeline
[Ordered list of every significant event with chapter number and relative time position (e.g. Day 1 morning, Day 3 evening)]

### Character State Tracker
For each major character at the END of the final chapter:
- Physical location
- Knowledge state (what they know, what they believe, what they are wrong about)
- Emotional state (dominant §1 stat, active cascade risks)
- Relationships changed (any alliances formed, broken, or strained during the story)

### Open Threads Register
- [Thread]: Planted in Ch [N], status at end: [resolved / dangling / escalating]

### Props and McGuffins Ledger
- [Object]: Introduced Ch [N], last seen Ch [N], current holder: [character or location]

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Include ALL chapters. This is a complete production document.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.
- Every piece of information must trace to one of the input sources -- do not invent.
- Follow PROFILE INSTRUCTION:
for depth level.

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
    };

    @node({
        id: 'ca4b2a24-6bcb-48fe-99d3-0deba4e67895',
        name: 'Clean Outline Output',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [4416, 688],
    })
    CleanOutlineOutput = {
        jsCode: `const raw = $input.first().json.text || $input.first().json.output || '';
const cleaned = raw
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\\n{3,}/g, '\\n\\n').trim();
return [{ json: { output: cleaned } }];`,
    };

    @node({
        id: 'b2c3d4e5-f6a7-48b9-c0d1-e2f3a4b5c6d7',
        name: 'Post Process',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [4528, 688],
    })
    PostProcess = {
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

// --- CONTINUITY BIBLE EXTRACTION ---
// 1. Store accumulated Continuity Bibles in persistent static data
const staticData = $getWorkflowStaticData("global");
if (!staticData.continuityBibles) staticData.continuityBibles = [];

// 2. Find and extract Continuity Bible from current chunk
let cbIndex = output.indexOf('## CONTINUITY BIBLE');
if (cbIndex === -1 && output.toLowerCase().indexOf('## continuity bible') !== -1) {
    cbIndex = output.toLowerCase().indexOf('## continuity bible');
}

let bibleText = '';
if (cbIndex !== -1) {
    bibleText = output.substring(cbIndex);
    output = output.substring(0, cbIndex).trim(); // Remove it from the main chapter output
    if (bibleText.trim()) {
        staticData.continuityBibles.push(bibleText.trim());
    }
}

// 3. Determine if this is the final batch
const promptParams = $('Outline Prompts').first().json;
const targetChapters = promptParams.target_chapters || '';
const totalChapters = promptParams.total_chapters || 20;

const chaptersArr = targetChapters.toLowerCase().split(',').map(s => s.trim());
const isFinalBatch = chaptersArr.includes('epilogue') || chaptersArr.includes(String(totalChapters));

// 4. If final batch, append all accumulated Bibles to the output
if (isFinalBatch && staticData.continuityBibles.length > 0) {
    const combinedBible = staticData.continuityBibles.join('

---

');
    output = output + '

' + combinedBible;
    // Clear static data for the next full book run
    staticData.continuityBibles = [];
}
// -----------------------------------

return [{ json: { output: output } }];`,
    };

    @node({
        id: '6bacc058-d49c-4cd7-a3a3-28f879f81abe',
        name: 'Send to Outline Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [4640, 688],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    SendToOutlineDoc = {
        operation: 'update',
        documentURL: "={{ $('Get BLANK Outline Doc').item.json.documentId }}",
        actionsUi: {
            actionFields: [
                {
                    action: 'insert',
                    text: `={{ $('Post Process').item.json.output }}

`,
                },
            ],
        },
    };

    @node({
        id: '0873bfdd-d343-4a57-9bcf-d42e604200ae',
        name: 'Ollama Chat Model15',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [3264, 896],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel15 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
        },
    };

    @node({
        id: '488ee8db-de4c-4294-9706-53e2eee36c80',
        name: 'Ollama Chat Model16',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [3552, 896],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel16 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
        },
    };

    @node({
        id: '748ae88f-6dfe-4b5b-a4f0-6df3d6e9602f',
        name: 'Ollama Chat Model17',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [3840, 896],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel17 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
        },
    };

    @node({
        id: 'c415f51f-7182-41d0-9f05-69262f1c98fa',
        name: 'Ollama Chat Model18',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [4128, 896],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel18 = {
        model: "={{ $('Universal Config').item.json.profiles.longform.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.longform.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.longform.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.longform.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.longform.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.longform.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.longform.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.longform.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.longform.parameters.num_gpu }}",
        },
    };

    @node({
        id: '1cdb6f4e-fd66-4079-b39b-fc377ffa11d6',
        name: 'Get Dossier',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-16, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetDossier = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1tRB_SWXb8M2BAL7Xh_DQOYwtrfjKW7ggRIf7k9THl7s/edit?tab=t.0',
    };

    @node({
        id: '957dd5f8-599f-4e2a-ae1c-d1d118857d04',
        name: 'Get BLANK Character Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [160, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetBlankCharacterDoc = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1th8QLHqrnQu2SHI0VNU7qSA6Duk_QvN3cXG8yNAgCwk/edit?usp=sharing',
    };

    @node({
        id: '5c923f82-a005-4997-9f9f-daa25a7b719a',
        name: 'Get BLANK Worldbuilding Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [544, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetBlankWorldbuildingDoc = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1aITR_w2AM53qOHZC5yypmIatmJPgqb2XOZxkPFGdF8s/edit?usp=sharing',
    };

    @node({
        id: '0e96f321-99ce-419e-a832-bb2c1bfffc63',
        name: 'Get BLANK Outline Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [720, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetBlankOutlineDoc = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1HnQAjZjuiKfGwLcw8VuTQ1zMYTETQy8GjolHXRz64UQ/edit?usp=sharing',
    };

    @node({
        id: '0332fdb0-228f-467a-a393-4db08b78eda1',
        name: 'Get Story Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-512, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetStoryTemplate = {
        operation: 'get',
        documentURL: '=https://docs.google.com/document/d/1QNlU60cZuCkoVOf6vlYAM9cjOqPPPfngmm1lSkq0xMQ/edit?tab=t.0',
    };

    @node({
        id: '3f47d6b0-9995-439b-8a1a-009a7082166f',
        name: 'Get Trope Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-1168, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetTropeTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1-iMbCIuopefgcTykrqRuDTKLQTowXkCUirzgeNfDptA/edit?tab=t.0',
    };

    @node({
        id: 'f30dff13-2033-453c-bb27-c08f26db1165',
        name: 'Get Plot Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-992, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetPlotTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1Adhv_L5YOSHv_n4aAPQch8GNSwVkxWIZeVPwAC6ea-k/edit?tab=t.0',
    };

    @node({
        id: 'e1bbfe94-53d4-484c-b512-bc24ef3a2363',
        name: 'Get Character Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-800, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetCharacterTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1UVXdl1okr15RTzYQ5DFRDZxQRxpDkW7Rm6kpww8-LDQ/edit?usp=sharing',
    };

    @node({
        id: '86417784-0d9e-406b-959c-4e308a07a2d6',
        name: 'Get Worldbuilding Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-352, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetWorldbuildingTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1hGCWFaHnbYtCJD-chCA5tWwj9KEBRiMt7xyZXxcjFU0/edit?tab=t.0',
    };

    @node({
        id: '10b85ddf-3791-47aa-9042-8bc069f53039',
        name: 'Get BLANK Story Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [352, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetBlankStoryDoc = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/18i9cAChlIwTph7yWyHjUIMD6NWwTTkMzlhDkdr8vpvw/edit?usp=sharing',
    };

    @node({
        id: 'f337310b-2cbe-433c-9706-6715cac4ca92',
        name: 'Story Arc',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [2496, 80],
        onError: 'continueRegularOutput',
    })
    StoryArc = {
        promptType: 'define',
        text: `=You are an expert story architect. Your task is to synthesize the provided dossier data into a unified narrative arc.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

GENRE TROPES:
{{ $("Extract Seeds").first().json.templates.tropes }}

PLOT TEMPLATE:
{{ $("Extract Seeds").first().json.templates.plot }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text
    || $('Characters').first().json.text
    || $("Characters").first().json.text
    || "[ERROR: No character data found]" }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each main plot beat, surface the systemic root cause -- which specific [economy], [tech_magic], or [systemic_friction] mechanism makes this beat inevitable? For each character arc, connect the external plot pressure to the internal psychological shift."
  : "You are in FAST mode (14B). Keep beats sharp and structural -- one specific dossier mechanism per beat, one sentence of cause-and-effect. No extended thematic analysis." }}

CONFLICT DOCTRINE:
{{ $('Universal Config').item.json.conflict_full || 'No conflict doctrine available.' }}

VOICE DOCTRINE:
{{ $('Universal Config').item.json.voice_full || 'No voice doctrine available.' }}

BACKSTORY DOCTRINE:
{{ $('Universal Config').item.json.backstory_full || 'No backstory doctrine available.' }}

LOCATION DOCTRINE:
{{ $('Universal Config').item.json.location_full || 'No location doctrine available.' }}

FACTION DOCTRINE:
{{ $('Universal Config').item.json.faction_full || 'No faction doctrine available.' }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

INSTRUCTIONS:
Using the PLOT TEMPLATE:
rules, construct a complete story arc grounded in the DOSSIER SOURCE:
world-rules.

Core Directives:
1. **Systemic Integration:** The Inciting Incident MUST be triggered by a failure or exploitation of the [tech_magic] or [economy] rules defined in the DOSSIER SOURCE:
.
2. **Character Casting:** Use the identities and motivations from the CAST MANIFEST:
to drive every plot turning point.
3. **Subplot Sync:** Every subplot seed in the DOSSIER SOURCE:
must be developed into the Key Subplots section.
4. **Author Intent:** Honour all directives in AUTHOR NOTES:
. Flag any structural conflict with [AUTHOR CONFLICT: reason].
5. **Prose Jail:** Scan word-by-word against FORBIDDEN WORDS:
before finalising. Do not use any forbidden word in your output.
6. **Depth:** Follow the PROFILE INSTRUCTION:
block above.

Output Format -- write each section exactly as shown, one bullet per line:

## {{ $("Extract Seeds").first().json.title }}

### Overall Premise & Theme
* Premise: [Synthesize the world and character seeds into a 3-sentence hook.]
* Core Themes: [Based on the thematic question in the dossier.]

### Main Plot Arc
* Inciting Incident: [Triggered by specific [systemic_friction] -- cite the tag.]
* First Turning Point: [Protagonist choice based on their Core Motivation from CAST MANIFEST:
.]
* Midpoint: [A revelation involving the antagonist arc -- name the specific world mechanism.]
* Second Turning Point: [The "All Is Lost" moment from the plot template -- name the systemic pressure.]
* Climax: [Resolution of conflict in the climax arena -- cite the [tech_magic] or [economy] rule at stake.]
* Resolution: [The new normal as defined in the dossier.]

### Key Subplots
* [One bullet per subplot seed found in the dossier -- develop each fully, citing the source tag.]

### Character Arcs
* [One bullet per character from CAST MANIFEST:
-- state their arc in one sentence, referencing their Core Motivation.]

### World Integration Notes
* [One bullet per major [tech_magic] or [economy] rule that shapes a plot beat -- cite the dossier tag and name the beat.]


ADDITIONAL REQUIREMENTS:
- **Beat Detail:** Each beat must include: WHO is present (named cast members), WHERE it happens (named location from DOSSIER SOURCE), WHAT systemic mechanism creates the friction, and WHAT the character does in response.
- **Chapter Mapping:** Map each beat to a specific chapter number. Distribute beats evenly across the total chapter count.
- **Subplot Arcs:** Each subplot must have its own 3-beat arc: setup, complication, payoff. Name the chapter where each beat lands.
- **Cast Integrity:** Every named character in the story arc MUST appear in the CAST MANIFEST. Do NOT introduce any new characters not already in the cast.
- **Resolution Specificity:** Resolution must name the specific mechanism of change -- what tool, system, or action resolves the conflict.

BANNED PHRASES (in addition to PROSE JAIL):
- "navigate", "landscape", "ever-shifting", "unveiling", "dawning realization"
- "things come to a head", "everything changes", "forced to confront"
- "turning point" (use the specific plot template beat name instead)
- "at its core", "in many ways", "it is worth noting", "speaks to"

CRITICAL CAST GROUNDING (MANDATORY):
- Your PROTAGONIST must be a character from CAST MANIFEST above. Use their EXACT NAME.
- Your ANTAGONIST must be a character from CAST MANIFEST above. Use their EXACT NAME.
- ALL named characters in the story arc MUST come from CAST MANIFEST. Do NOT invent ANY new characters.
- If CAST MANIFEST has 5 characters, your story arc uses those 5 characters and NO OTHERS.
- Before finalising, cross-check every name in your output against CAST MANIFEST. If a name is not in the manifest, REMOVE IT and replace with a character from the manifest.
- Do NOT use names from your training data (Ava, Luna, Marcus from other stories, etc.). Use ONLY the specific names in CAST MANIFEST.

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Single line per bullet -- no multi-line bullets.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.
- Reference specific keys from the dossier in your output where instructed.
- Follow PROFILE INSTRUCTION:
for depth level.

DOCTRINE COMPLIANCE:
- If CONFLICT DOCTRINE:
is provided, structure conflicts according to its escalation patterns and resolution frameworks.
- If VOICE DOCTRINE:
is provided, follow its dialogue rules and character voice guidelines.
- If BACKSTORY DOCTRINE:
is provided, reveal backstory using the pacing and revelation rules it defines.
- If LOCATION DOCTRINE:
is provided, integrate setting details using its environmental storytelling guidelines.
- If FACTION DOCTRINE:
is provided, portray faction dynamics according to its power structure and allegiance rules.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
    };

    @node({
        id: '150ee432-51ca-4702-9d55-59b1c1b687fc',
        name: 'Critique Story Arc',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [2816, 80],
        onError: 'continueRegularOutput',
    })
    CritiqueStoryArc = {
        promptType: 'define',
        text: `=You are a sharp, constructive developmental editor and story-structure specialist.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

GENRE TROPES:
{{ $("Universal Config").first().json.trope_full }}

PLOT TEMPLATE:
{{ $("Universal Config").first().json.plot_full }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text || $('Characters').first().json.text || '[ERROR: No character data found]' }}

CURRENT STORY ARC:
{{ $('Story Arc').first().json.text || '[ERROR: No story arc found]' }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each flagged beat, analyse the systemic root cause -- why does this beat fail structurally? Reference specific character motivations from CAST MANIFEST: and specific dossier mechanisms to justify every critique point."
  : "You are in FAST mode (14B). Keep critique sharp and structural -- one clear problem and one clear fix per bullet. No extended analysis." }}

CONFLICT DOCTRINE:
{{ $('Universal Config').item.json.conflict_full || 'No conflict doctrine available.' }}

VOICE DOCTRINE:
{{ $('Universal Config').item.json.voice_full || 'No voice doctrine available.' }}

BACKSTORY DOCTRINE:
{{ $('Universal Config').item.json.backstory_full || 'No backstory doctrine available.' }}

LOCATION DOCTRINE:
{{ $('Universal Config').item.json.location_full || 'No location doctrine available.' }}

FACTION DOCTRINE:
{{ $('Universal Config').item.json.faction_full || 'No faction doctrine available.' }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

INSTRUCTIONS:
Analyze the CURRENT STORY ARC:
for structural sagging and worldbuilding contradictions by cross-referencing it against the DOSSIER SOURCE:
and PLOT TEMPLATE:
.

Critique Criteria:
1. **Dossier Alignment:** Does the plot exploit the specific [tech_magic] and [economy] tags? Flag beats that feel like a generic thriller instead of world-specific conflict.
2. **Structural Rigidity:** Compare beats against the [plot_template]. Is the "Midpoint" a true reversal? Does the "Climax" resolve the [arc_seed] thematic question?
3. **Character Agency:** Are plot shifts caused by choices from the CAST MANIFEST:
? Flag "Deus Ex Machina" moments where the world happens *to* characters rather than *because* of them.
4. **The Squeeze:** Are external stakes tied to [systemic_friction]? Ensure escalation represents increased systemic pressure rather than just generic danger.
5. **Author Intent:** Flag any beat that contradicts AUTHOR NOTES:
.
6. **Prose Jail Check:** Scan word-by-word against FORBIDDEN WORDS:
. Report each violation by beat name and the exact forbidden word.
7. **Humanizer Audit:** Scan the story arc prose for AI writing patterns. Flag every instance -- do not rewrite, only flag:
   - Generic arc language: Beat descriptions using stock phrasing ("things come to a head", "everything changes", "forced to confront", "turning point") instead of naming the specific world mechanism and character action.
   - AI-typical phrases: "at its core", "in many ways", "it is worth noting", "speaks to", "a testament to", "ultimately shows", "needless to say", "it is clear that".
   - Over-explained structure: Any beat that narrates its own function ("This is where the protagonist begins their transformation...").
   - Corporate hedging: "somewhat", "rather", "quite", "in a sense", "to some extent", "as if somehow".
   For each instance: quote the phrase, name the arc beat, label the pattern type, and suggest a one-line concrete restatement using specific dossier mechanisms.
8. **Depth:** Follow PROFILE INSTRUCTION:
.

Output Format:
1. **Overall Assessment** (2-4 sentences on structural integrity and dossier alignment.)
2. **Issues and Weaknesses** (Bullet list: Adherence, Structural Beats, Character Integration, Stakes/Theme, Author Intent, and Prose Jail violations.)
3. **Improvement Plan** (Actionable revision steps formatted as "FIX: [exact change]" tied to specific XML tags: e.g., "FIX: Adjust the Climax to reflect the [world_arcs] cost of victory.")

9. **Cast Integrity:** Flag any character mentioned in the story arc that does NOT appear in CAST MANIFEST. Every named character must originate from the Characters output.
10. **Beat Specificity:** Flag any beat that lacks: a named location, a named systemic mechanism, or a specific character action. Generic beats like "things escalate" must be called out.


CAST INTEGRITY CHECK: Flag ANY character name that does NOT appear in CAST MANIFEST. Every named character must originate from the Characters output. This is a BLOCKING error -- if found, the rewrite MUST fix it.
NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Do NOT rewrite the arc.
- Be surgically specific -- reference the exact keys from the dossier in your feedback.
- Never use any word from FORBIDDEN WORDS:
in your own output.
- Follow PROFILE INSTRUCTION:
for depth level.

DOCTRINE COMPLIANCE:
- If CONFLICT DOCTRINE:
is provided, structure conflicts according to its escalation patterns and resolution frameworks.
- If VOICE DOCTRINE:
is provided, follow its dialogue rules and character voice guidelines.
- If BACKSTORY DOCTRINE:
is provided, reveal backstory using the pacing and revelation rules it defines.
- If LOCATION DOCTRINE:
is provided, integrate setting details using its environmental storytelling guidelines.
- If FACTION DOCTRINE:
is provided, portray faction dynamics according to its power structure and allegiance rules.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
    };

    @node({
        id: '4ca48201-f335-4189-9848-b745390481f9',
        name: 'Rewrite Story Arc',
        type: '@n8n/n8n-nodes-langchain.chainLlm',
        version: 1.4,
        position: [3104, 80],
        onError: 'continueRegularOutput',
    })
    RewriteStoryArc = {
        promptType: 'define',
        text: `=You are an expert story architect and line editor.

CONTEXT:
- Project: {{ $("Extract Seeds").first().json.title }}
- Prose Jail: {{ $("Universal Config").first().json.prose_jail }}
- Active Profile: {{ $("Universal Config").first().json.active_profile.label }}

FORBIDDEN WORDS:
{{ $("Extract Seeds").first().json.forbiddenWords }}

DOSSIER SOURCE:
{{ $("Extract Seeds").first().json.dossier }}

ORIGINAL STORY ARC:
{{ $('Story Arc').first().json.text || '[ERROR: No story arc found]' }}

IMPROVEMENT PLAN:
{{ $('Critique Story Arc').first().json.text || '[ERROR: No improvement plan found]' }}

CAST MANIFEST:
{{ $('Rewrite Characters').first().json.text || $('Characters').first().json.text || '[ERROR: No character data found]' }}

AUTHOR NOTES:
{{ $("Extract Seeds").first().json.authorNotes || "No author notes provided." }}

PROFILE INSTRUCTION:
{{ $("Universal Config").first().json.active_profile.label === "heavy"
  ? "You are in HIGH DEPTH mode (32B). For each revised beat, surface the systemic cause-and-effect chain -- which specific dossier mechanism triggers this beat, and how does it ripple through the cast's motivations? Ensure the Climax pays off the thematic question from [arc_seed]."
  : "You are in FAST mode (14B). Keep revisions sharp and structural. Every beat must name a specific dossier mechanism and a specific character motivation. No extended thematic analysis." }}

CONFLICT DOCTRINE:
{{ $('Universal Config').item.json.conflict_full || 'No conflict doctrine available.' }}

VOICE DOCTRINE:
{{ $('Universal Config').item.json.voice_full || 'No voice doctrine available.' }}

BACKSTORY DOCTRINE:
{{ $('Universal Config').item.json.backstory_full || 'No backstory doctrine available.' }}

LOCATION DOCTRINE:
{{ $('Universal Config').item.json.location_full || 'No location doctrine available.' }}

FACTION DOCTRINE:
{{ $('Universal Config').item.json.faction_full || 'No faction doctrine available.' }}

EMOTION SYSTEM GUARDRAILS:
{{ $('Universal Config').first().json.emotion_guardrails }}

INSTRUCTIONS:
Using the ORIGINAL STORY ARC:
as your base and the IMPROVEMENT PLAN:
as your surgical guide, produce a COMPLETED REVISED story arc.

Core Mandate:
1. **Structural Precision:** Implement every beat change, subplot merger, or stake escalation requested in the IMPROVEMENT PLAN:
with 100% fidelity.
2. **Dossier Compliance:** Any newly written or adjusted beats must explicitly adhere to the world rules in the [economy], [tech_magic], and [systemic_friction] tags of the dossier.
3. **Character Grounding:** Every turning point must be driven by a specific character from CAST MANIFEST:
acting on their Core Motivation. No plot-driven character behaviour.
4. **Logic Flow:** Ensure that changes to the Midpoint or Turning Points ripple correctly through the Climax and Resolution so the story remains a cohesive whole.
5. **Author Intent:** If any improvement plan suggestion contradicts AUTHOR NOTES:
, flag it inline with [AUTHOR CONFLICT: reason] and preserve the author's intent.
6. **Prose Jail Compliance:** Scan word-by-word against FORBIDDEN WORDS:
before finalising. Replace every violation with sharp, world-accurate terminology.
7. **Depth:** Follow the PROFILE INSTRUCTION:
block above.

Required Markdown Format:
## {{ $("Extract Seeds").first().json.title }}

### Overall Premise & Theme
* [Revised as per improvement_plan]

### Main Plot Arc
* Inciting Incident: [Updated to reflect systemic friction -- cite the tag]
* First Turning Point: [Updated to reflect character choice -- name the character and motivation]
* Midpoint: [Updated to reflect a true logic reversal -- name the world mechanism]
* Second Turning Point: [Updated to reflect the All Is Lost moment -- name the systemic pressure]
* Climax: [Updated to reflect the payoff of world rules -- cite the tag]
* Resolution: [Updated to reflect the new normal]

### Protagonist's Internal Arc
* [Revised to tighten integration with Main Plot beats -- reference Core Motivation]

### Antagonist's Arc
* [Revised for credibility and active strategy -- grounded in dossier access and power]

### Key Subplots
* [Updated, merged, or added as per improvement_plan -- cite source tags]

### Stakes & Escalation
* [Updated for specificity and systemic pressure -- name mechanisms]

### Ending & Aftermath
* [Revised to pay off thematic promises from [arc_seed]]

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.

Hard Constraints:
- Output the REVISED ARC ONLY. No preamble or meta-commentary.
- Maintain the single-line-per-bullet constraint.
- Do not use any word from FORBIDDEN WORDS:
or the Prose Jail.
- Ensure the emotional Moment of Truth is earned by the preceding plot beats.
- Follow PROFILE INSTRUCTION:
for depth level.

DOCTRINE COMPLIANCE:
- If CONFLICT DOCTRINE:
is provided, structure conflicts according to its escalation patterns and resolution frameworks.
- If VOICE DOCTRINE:
is provided, follow its dialogue rules and character voice guidelines.
- If BACKSTORY DOCTRINE:
is provided, reveal backstory using the pacing and revelation rules it defines.
- If LOCATION DOCTRINE:
is provided, integrate setting details using its environmental storytelling guidelines.
- If FACTION DOCTRINE:
is provided, portray faction dynamics according to its power structure and allegiance rules.

- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.

`,
    };

    @node({
        id: 'd9168336-aba1-41fc-bac7-ea68ba6077a0',
        name: 'Send to Story Doc',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [3440, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    SendToStoryDoc = {
        operation: 'update',
        documentURL: "={{ $('Get BLANK Story Doc').item.json.documentId }}",
        actionsUi: {
            actionFields: [
                {
                    action: 'insert',
                    text: `={{ $('Rewrite Story Arc').item.json.text }}

`,
                },
            ],
        },
    };

    @node({
        id: 'fa827b10-f164-49fd-a28f-faac212c6dc2',
        name: 'Outline Prompts',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1440, 688],
    })
    OutlinePrompts = {
        jsCode: `// --- CONFIGURABLE VARIABLES --------------------------------------------------
// These read from the form submission first, with code-level defaults as fallback.
// To override without touching the form: change the defaults below.

const DEFAULT_TOTAL_CHAPTERS  = 20;         // Total chapters in the book
const DEFAULT_WORDS_PER_CHAPTER = 800;      // Target detail density per chapter
const DEFAULT_CHAPTERS_TO_OUTLINE = "";     // Empty = outline ALL chapters

// --- READ FROM FORM (with defaults) -----------------------------------------
const form = $("On form submission").first()?.json || {};

const totalChapters   = parseInt(form["Total Chapters"], 10)    || DEFAULT_TOTAL_CHAPTERS;
const wordsPerChapter = parseInt(form["Words Per Chapter"], 10) || DEFAULT_WORDS_PER_CHAPTER;
// --- BATCH-AWARE CHAPTER RANGE -----------------------------------------------
// Read from Chapter Selector if present.
// Falls back to form "Chapters to Outline" or full range if no batch data.
// --- READ CHAPTER RANGE FROM CHAPTER SELECTOR --------------------------------
var selectorData = null;
try { selectorData = $("Chapter Selector").first().json; } catch(e) {}

let chaptersToOutline;
if (selectorData && selectorData.selectedChapters && selectorData.selectedChapters.trim()) {
  // Chapter Selector specified which chapters to outline
  chaptersToOutline = selectorData.selectedChapters.trim();
} else {
  // Fallback: read from form "Chapters to Outline" or outline all
  var rawChapters = (form["Chapters to Outline"] || "").trim();
  if (rawChapters) {
    var custom = rawChapters;
    if (!custom.toLowerCase().includes("prologue")) custom = "Prologue," + custom;
    if (!custom.toLowerCase().includes("epilogue")) custom = custom + ",Epilogue";
    chaptersToOutline = custom;
  } else {
    var chapterList = ["Prologue"];
    for (var j = 1; j <= totalChapters; j++) chapterList.push(String(j));
    chapterList.push("Epilogue");
    chaptersToOutline = chapterList.join(",");
  }
}

// --- PROJECT IDENTITY -------------------------------------------------------
const title       = form["Book Title"] || form["What is the Title of Your Book"] || "UNTITLED PROJECT";
const authorNotes = form["Author Notes"] || "";

// --- HIGH-LEVEL LOGIC (from Universal Config) -------------------------------
const config        = $("Universal Config").first().json;
const tropeTemplate = config.trope_full || "";
const plotTemplate  = config.plot_full  || "";
const storyTemplate = config.arc_full   || "";
const proseJail     = config.prose_jail || "";
const conflictTemplate = config.conflict_full || "";
const locationTemplate = config.location_full || "";
const factionTemplate = config.faction_full || "";

// --- WORLD RULES (from Dossier) ---------------------------------------------
const seeds   = $("Extract Seeds").first().json;
const dossier = seeds.dossier || "";

// --- FORBIDDEN WORDS (from Extract Seeds) -----------------------------------
const forbiddenWords = seeds.forbiddenWords || "";
const entityNames    = (seeds.entityNames || []).join(", ");

// --- POLISHED DATA (Rewrite output preferred, original as fallback) ---------
const rwWB = $('Rewrite Worldbuilding').first();
const rwCH = $('Rewrite Characters').first();
const rwSA = $('Rewrite Story Arc').first();
const worldbuildingDoc = (rwWB ? rwWB.json.text : null) || $('Worldbuilding').first().json.text || "[ERROR: No worldbuilding data]";
const characterDoc     = (rwCH ? rwCH.json.text : null) || $('Characters').first().json.text   || "[ERROR: No character data]";
const storySoFar       = (rwSA ? rwSA.json.text : null) || $('Story Arc').first().json.text    || "[ERROR: No story arc data]";

// --- CONSTRUCT PROMPT -------------------------------------------------------
const prompt = \`
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
The complete novel has \${totalChapters} numbered chapters plus a Prologue and Epilogue. You are outlining: \${chaptersToOutline}.

### MISSION
Generate a fully fleshed-out outline for ONLY the sections listed in TARGET CHAPTERS.
Do not outline, mention, or label any chapters outside this range.
Every detail must come from DOSSIER SOURCE, CHARACTERS, WORLDBUILDING, or STORY SO FAR.
Do not import ideas, character names, or world elements from your training data.

### GUIDELINES
- **Authenticity:** Treat DOSSIER SOURCE as the absolute law for [economy] and [tech_magic] rules.
- **Character Agency:** Ensure every chapter beat is driven by the CHARACTERS' specific motivations and Core Motivations.
- **Pacing:** Align the events of these chapters with the structural goals in PLOT LOGIC.
- **No Prose:** This is a technical blueprint for a ghostwriter. Provide concrete beats, not dialogue or narrative prose.
- **Prose Jail:** Do not use any word from PROSE JAIL in your output.
- **Doctrine Compliance:** Every conflict beat must conform to CONFLICT DOCTRINE, every location to LOCATION DOCTRINE, every faction to FACTION DOCTRINE. If a doctrine block is empty, skip that constraint.

### PROLOGUE GUIDELINES
The Prologue is a cold-open hook — a short, high-impact scene that:
- Drops the reader into the world mid-action, before the main story timeline begins
- Introduces a central tension, mystery, or thematic question from the dossier
- Features a POV that creates dramatic irony for the reader (could be a secondary character, the antagonist, or the protagonist at a different point in time)
- Does NOT reveal the full context — it plants a seed that pays off later
- Target length: \${Math.round(wordsPerChapter * 0.6)} words of dense beats (shorter than a full chapter)

### EPILOGUE GUIDELINES
The Epilogue is a thematic closure beat — a brief scene set after the climax that:
- Shows the new status quo established by the resolution
- Resolves one remaining emotional thread from CHARACTERS (not a plot thread)
- Plants a subtle forward-looking hook (sequel potential or open question)
- Uses a POV that mirrors or contrasts the Prologue for structural resonance
- Target length: \${Math.round(wordsPerChapter * 0.5)} words of dense beats (shorter than a full chapter)

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
### PROLOGUE: [Title]
**Opening Image:** [The very first visual or sensory moment that introduces the reader to this world]
[2-3 dense paragraphs of tactical beats. Cold-open scene -- establish mood, drop the reader into the world, plant a mystery.]
**Closing Hook:** [The exact tension point that propels the reader into Chapter 1]

### CHAPTER [NUMBER]: [Title]
**Opening Image:** [The first visual or sensory moment the reader encounters in this chapter]
[3-5 dense paragraphs, totalling at least \${wordsPerChapter} words, describing the tactical beats of the chapter.]
**Closing Hook:** [The exact tension point, question, or emotional cliffhanger that propels into the next chapter]

### EPILOGUE: [Title]
**Opening Image:** [The first visual or sensory moment of the aftermath]
[1-2 dense paragraphs of tactical beats. Thematic closure -- show the aftermath, resolve one emotional thread, plant a subtle hook.]

NEGATIVE CONSTRAINTS:
- DO NOT reproduce input data verbatim. Synthesize and transform.
- DO NOT invent sections not in the instructions above.
- DO NOT add marketing plans, adaptation pitches, or unsolicited content.
- DO NOT use any language other than English. Standard Latin script only.
- DO NOT use any word or phrase from PROSE JAIL.
\`;

// --- RETURN -----------------------------------------------------------------
return [{ json: {
  prompt,
  target_chapters: chaptersToOutline,
  total_chapters:  totalChapters,
  words_per_chapter: wordsPerChapter,
} }];`,
    };

    @node({
        id: '7ac85b71-0d8d-4b16-b2c6-91c2d4243974',
        name: 'Get Forbidden Words Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-192, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetForbiddenWordsTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1qq6RsG9tSeUTcRHD2Yv206DSHPh__4jRUZS75G8God8/edit?usp=sharing',
    };

    @node({
        id: '9b466fa0-c6de-4542-97aa-0dd5c8acf451',
        name: 'Ollama Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [1376, 304],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
        },
    };

    @node({
        id: 'c24f8868-fa11-4729-9871-701c9fbe8a8e',
        name: 'Ollama Chat Model1',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [1696, 288],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel1 = {
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.balanced.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
        },
    };

    @node({
        id: '8d0aee3d-faf8-4dd2-97ec-b5673eb4979f',
        name: 'Ollama Chat Model2',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [1984, 288],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel2 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
        },
    };

    @node({
        id: '78f3a3ff-ecef-4e9e-abf0-9aeae7e36197',
        name: 'Ollama Chat Model3',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [2496, 288],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel3 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
        },
    };

    @node({
        id: '9e2a4b25-b4e4-4075-8a4d-b36952a22c68',
        name: 'Ollama Chat Model4',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [2816, 288],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel4 = {
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.balanced.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
        },
    };

    @node({
        id: '9340c221-c70c-4546-b08d-42a28cecef5c',
        name: 'Ollama Chat Model5',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [3104, 288],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel5 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
        },
    };

    @node({
        id: '0056c8e2-37b9-4374-91fd-d7ca0fa3b056',
        name: 'Ollama Chat Model6',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [3648, 256],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel6 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
        },
    };

    @node({
        id: '3476d6b4-4f9b-4d7f-a814-cf76af244112',
        name: 'Ollama Chat Model7',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [3968, 256],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel7 = {
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.balanced.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
        },
    };

    @node({
        id: '8ecd4e75-000d-4095-b647-9dfb51b6a21c',
        name: 'Ollama Chat Model8',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [4288, 256],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel8 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
        },
    };

    @node({
        id: '7de7876e-6c5f-4327-883e-d9eee1690c92',
        name: 'Ollama Chat Model9',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [1600, 896],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel9 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
        },
    };

    @node({
        id: '874329bf-30dc-40b8-8721-9ce852e64b76',
        name: 'Ollama Chat Model10',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [1824, 896],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel10 = {
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.balanced.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
        },
    };

    @node({
        id: 'bb935b3b-dfce-4494-b56a-fbb0cda4dc15',
        name: 'Ollama Chat Model11',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [2112, 896],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel11 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
        },
    };

    @node({
        id: '932eec62-c441-44e0-b6f1-d1f301ab06fa',
        name: 'Ollama Chat Model12',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [2976, 896],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel12 = {
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.balanced.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
        },
    };

    @node({
        id: '15fb50a3-e7dd-4a70-85dd-10690b093f09',
        name: 'Ollama Chat Model13',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [2400, 896],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel13 = {
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.balanced.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
        },
    };

    @node({
        id: '9c9b8b65-f13b-43bd-ae3e-c5c23cfb1e8d',
        name: 'Ollama Chat Model14',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [2688, 896],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel14 = {
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.balanced.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
        },
    };

    @node({
        id: '28284533-35db-48b2-9ad5-95b14445ee91',
        name: 'Extract Seeds',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [896, 80],
    })
    ExtractSeeds = {
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
const formData         = $("On form submission").first()?.json || {};
const rawFormTitle     = (formData["Book Title"] || formData["What is the Title of Your Book"] || "").trim().toUpperCase();
const authorNotes      = formData["Author Notes"]      || "";
const lockedCharacters = formData["Locked Characters"] || "";
const lockedProfiles   = formData["Locked Profiles"]   || "";

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
let title = rawFormTitle;

if (!title) {
  title = "UNTITLED PROJECT";
  warnings.push("CRITICAL: no title in form submission — set title before generating");
}

// --- TEMPLATES ----------------------------------------------------------
const templates = {
  tropes:        extractDocText($("Get Trope Template").first()?.json),
  plot:          extractDocText($("Get Plot Template").first()?.json),
  character:     extractDocText($("Get Character Template").first()?.json),
  story:         extractDocText($("Get Story Template").first()?.json),
  worldbuilding: extractDocText($("Get Worldbuilding Template").first()?.json),
  character_emotion: extractDocText($("Get Character emotion template").first()?.json),
  themes:        extractDocText($("Get Themes Template").first()?.json),
  conflict:      extractDocText($("Conflict Architecture Template").first()?.json),
  voice:         extractDocText($("Dialogue & Voice Template").first()?.json),
  backstory:     extractDocText($("Revelation & Backstory Template").first()?.json),
  location:      extractDocText($("Location Profile Template").first()?.json),
  faction:       extractDocText($("Faction & Power Template").first()?.json),
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
const forbiddenWords = extractDocText($("Get Forbidden Words Template").first()?.json);

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
const dossier = extractDocText($("Get Dossier").first()?.json);
if (!dossier || dossier.length < 200) {
  warnings.push("WARN: dossier short or empty — Get Dossier may have returned partial content");
}

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
    };

    @node({
        id: '50951bdf-553f-490e-92ee-2759d481c173',
        name: 'Universal Config',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1056, 80],
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
    })(),    forbidden_list: (inputData.forbiddenFlat || []).join(", "),
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
    };

    @node({
        id: '779293b0-9f25-455d-ac8a-86410215dfb3',
        name: 'Debug',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1200, 80],
    })
    Debug = {
        jsCode: `
const config = $input.first().json;

// --- CRITICAL FAILURES â€” halt the workflow before any AI agent runs -----------
// These throw a hard error. Fix the input data and re-submit the form.
const critical = [];

if ((!config.braindump || config.braindump.trim().length < 50) && (!config.dossier || config.dossier.trim().length < 200)) {
  critical.push(\`CONTEXT MISSING â€” neither braindump (\${config.braindump?.trim().length || 0} chars) nor dossier (\${config.dossier?.trim().length || 0} chars) contain sufficient context.\`);
}

if (!config.title || config.title.trim() === "" || config.title.trim() === "UNTITLED PROJECT") {
  critical.push(\`TITLE MISSING â€” fill in the Book Title field on the form before submitting.\`);
}

if (!config.active_profile?.model) {
  critical.push(\`MODEL NOT SET â€” Universal Config failed to resolve an active profile. Check the UniversalConfig node.\`);
}

if (critical.length > 0) {
  throw new Error(
    \`PRE-FLIGHT CHECK FAILED â€” workflow stopped before Brainstorm.\\n\\n\` +
    critical.map((c, i) => \`\${i + 1}. \${c}\`).join("\\n\\n") +
    \`\\n\\nFix the above and re-submit the form.\`
  );
}

// --- SOFT WARNINGS â€” log and continue -----------------------------------------
// These will not stop the workflow but may degrade output quality.
const warnings = [];

const validLabels = ["creative", "creative_max", "fast_iter", "balanced", "longform", "light", "repair"];
if (config.active_profile?.label && !validLabels.includes(config.active_profile.label)) {
  warnings.push(\`active_profile.label "\${config.active_profile.label}" not recognised â€” expected: \${validLabels.join(", ")}\`);
}

if (!config.language_guard) warnings.push("language_guard missing â€” agents will have no language lock");
if (!config.prose_jail)     warnings.push("prose_jail missing â€” forbidden word constraints will not be passed to agents");

if (!Array.isArray(config.required_tags) || config.required_tags.length === 0)
  warnings.push("required_tags missing â€” Final Pass will use hardcoded fallback list");

if (!config.forbiddenFlat || config.forbiddenFlat.length === 0)
  warnings.push("forbiddenFlat empty â€” word scrub in Sanitization and Final Pass will not run");

if ((config.braindump?.length || 0) < 500 && (!config.dossier || config.dossier.length < 200))
  warnings.push(\`braindump short (\${config.braindump?.length || 0} chars) and dossier not loaded â€” output quality may suffer\`);

// --- OUTPUT -------------------------------------------------------------------
return [{
  json: {
    status:        warnings.length === 0 ? "Pre-flight OK" : \`\${warnings.length} warning(s) â€” proceeding: \${warnings.join(" | ")}\`,
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
    };

    @node({
        id: 'eb898c04-86e3-4b2a-aee1-8cb08d68f1f6',
        name: 'On form submission',
        type: 'n8n-nodes-base.formTrigger',
        version: 2.2,
        position: [-2320, 80],
    })
    OnFormSubmission = {
        path: 'dossier-to-outline',
        formTitle: 'Dossier to Outline',
        formDescription:
            'Enter your book title. Braindump, Locked Characters and Locked Profiles carry forward from the Dossier Builder â€” paste them here or leave blank to rely on the dossier alone.',
        formFields: {
            values: [
                {
                    fieldLabel: 'Book Title',
                    requiredField: true,
                },
                {
                    fieldLabel: 'Total Chapters',
                    fieldType: 'number',
                    placeholder: '20',
                },
                {
                    fieldLabel: 'Words Per Chapter',
                    fieldType: 'number',
                    placeholder: '800',
                },
                {
                    fieldLabel: 'Chapters to Outline',
                    placeholder: 'prolog,1,2,3  (leave blank for all)',
                },
                {
                    fieldLabel: 'Braindump',
                    fieldType: 'textarea',
                },
                {
                    fieldLabel: 'Author Notes',
                    fieldType: 'textarea',
                },
                {
                    fieldLabel: 'Locked Characters',
                },
                {
                    fieldLabel: 'Locked Profiles',
                    fieldType: 'textarea',
                },
            ],
        },
        options: {},
    };

    @node({
        id: '2c923134-4f86-4994-85c7-821483c5155a',
        name: 'Get Character emotion template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-656, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetCharacterEmotionTemplate = {
        operation: 'get',
        documentURL:
            '=https://docs.google.com/document/d/1h8P0RRd_Yr0qsbUGxyBnxFhKfU5GYBetXJp-geddTWs/edit?usp=sharing',
    };

    @node({
        id: '9bb92094-b172-4a52-b20d-31ca21858291',
        name: 'Get Themes Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-1312, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    GetThemesTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1mmDaJeNOtYrJKkBoZloGt6yXewhW5wPQ4K_Pyg4ookI/edit?usp=sharing',
    };

    @node({
        id: '7a94a4a3-4af5-4cde-890e-f16a44310478',
        name: 'Conflict Architecture Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-1472, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    ConflictArchitectureTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1pmwf_gk644RpaDf3miLIUKXOnp0__mTowqgN_glyRaY/edit?usp=sharing',
    };

    @node({
        id: '0367e8d9-1aa6-4ffa-89c8-14d6b720d628',
        name: 'Dialogue & Voice Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-1648, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    DialogueVoiceTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1C0IZD_F5yuTJclxS3HDZQe_Ikx5d8cS13c_pW53P2Zo/edit?usp=sharing',
    };

    @node({
        id: 'f47039b7-dcfc-4a96-995a-56c886ed8a68',
        name: 'Revelation & Backstory Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-1840, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    RevelationBackstoryTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1djCPHBjQXAt-9uEYu3xT9BiRtb9L837N8tgmJvcunhE/edit?usp=sharing',
    };

    @node({
        id: 'bd128a60-a4cb-4a5f-9d96-c0282ea6fdae',
        name: 'Location Profile Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-2016, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    LocationProfileTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/13SLU8Lati3Bh2KwAt9PMr9d-1LL6j8oWwoiGTcS558E/edit?usp=sharing',
    };

    @node({
        id: 'c3772d4a-8765-4b49-9d36-70e23d927d6e',
        name: 'Faction & Power Template',
        type: 'n8n-nodes-base.googleDocs',
        version: 2,
        position: [-2160, 80],
        credentials: { googleDocsOAuth2Api: { id: 'eLuqZwmRkYA0tVfY', name: 'Google Docs account' } },
    })
    FactionPowerTemplate = {
        operation: 'get',
        documentURL: 'https://docs.google.com/document/d/1yUtBR0o6Y1Pqc8H0GGua8xbuPhcSm_4OD5HW73YWry0/edit?usp=sharing',
    };

    @node({
        id: 'chapter-selector-001',
        name: 'Chapter Selector',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [1280, 688],
    })
    ChapterSelector = {
        jsCode: `
// ╔════════════════════════════════════════════════════════════════╗
// ║  CHAPTER SELECTOR — Edit the values below to control         ║
// ║  which chapters the enrichment pipeline processes.           ║
// ║                                                               ║
// ║  Examples:                                                    ║
// ║    "Prologue,1,2,3,4"        → Prologue through Chapter 4   ║
// ║    "5,6,7,8"                  → Chapters 5 through 8         ║
// ║    "9,10,11,12,Epilogue"      → Chapters 9-12 + Epilogue    ║
// ║    ""                         → ALL chapters (full run)      ║
// ╚════════════════════════════════════════════════════════════════╝

var CHAPTERS = "Prologue,1,2,3,4";    // ← EDIT THIS LINE

// Pass everything through to OutlinePrompts
return [{ json: {
  selectedChapters: CHAPTERS
}}];
`,
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.Characters.out(0).to(this.CritiqueCharacters.in(0));
        this.SendToCharacterDoc.out(0).to(this.StoryArc.in(0));
        this.CritiqueCharacters.out(0).to(this.RewriteCharacters.in(0));
        this.RewriteCharacters.out(0).to(this.SendToCharacterDoc.in(0));
        this.Worldbuilding.out(0).to(this.CritiqueWorldbuilding.in(0));
        this.CritiqueWorldbuilding.out(0).to(this.RewriteWorldbuilding.in(0));
        this.RewriteWorldbuilding.out(0).to(this.SendToWorldbuildingDoc.in(0));
        this.Outline.out(0).to(this.CritiqueOutline.in(0));
        this.CritiqueOutline.out(0).to(this.RewriteOutline.in(0));
        this.RewriteOutline.out(0).to(this.EmotionalCheck.in(0));
        this.EmotionalCheck.out(0).to(this.SciencePlotEnrichment.in(0));
        this.SciencePlotEnrichment.out(0).to(this.ContinuityChecker.in(0));
        this.ContinuityChecker.out(0).to(this.SceneBreakdown.in(0));
        this.SceneBreakdown.out(0).to(this.ForeshadowingPlanner.in(0));
        this.ForeshadowingPlanner.out(0).to(this.PovPlanner.in(0));
        this.PovPlanner.out(0).to(this.GhostwriterBrief.in(0));
        this.GhostwriterBrief.out(0).to(this.CleanOutlineOutput.in(0));
        this.CleanOutlineOutput.out(0).to(this.PostProcess.in(0));
        this.PostProcess.out(0).to(this.SendToOutlineDoc.in(0));
        this.GetForbiddenWordsTemplate.out(0).to(this.GetDossier.in(0));
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
        this.StoryArc.out(0).to(this.CritiqueStoryArc.in(0));
        this.CritiqueStoryArc.out(0).to(this.RewriteStoryArc.in(0));
        this.RewriteStoryArc.out(0).to(this.SendToStoryDoc.in(0));
        this.SendToStoryDoc.out(0).to(this.Worldbuilding.in(0));
        this.SendToWorldbuildingDoc.out(0).to(this.ChapterSelector.in(0));
        this.ChapterSelector.out(0).to(this.OutlinePrompts.in(0));
        this.OutlinePrompts.out(0).to(this.Outline.in(0));
        this.ExtractSeeds.out(0).to(this.UniversalConfig.in(0));
        this.UniversalConfig.out(0).to(this.Debug.in(0));
        this.Debug.out(0).to(this.Characters.in(0));
        this.OnFormSubmission.out(0).to(this.FactionPowerTemplate.in(0));
        this.GetCharacterEmotionTemplate.out(0).to(this.GetStoryTemplate.in(0));
        this.GetThemesTemplate.out(0).to(this.GetTropeTemplate.in(0));
        this.ConflictArchitectureTemplate.out(0).to(this.GetThemesTemplate.in(0));
        this.RevelationBackstoryTemplate.out(0).to(this.DialogueVoiceTemplate.in(0));
        this.LocationProfileTemplate.out(0).to(this.RevelationBackstoryTemplate.in(0));
        this.DialogueVoiceTemplate.out(0).to(this.ConflictArchitectureTemplate.in(0));
        this.FactionPowerTemplate.out(0).to(this.LocationProfileTemplate.in(0));

        this.Characters.uses({
            ai_languageModel: this.OllamaChatModel.output,
        });
        this.CritiqueCharacters.uses({
            ai_languageModel: this.OllamaChatModel1.output,
        });
        this.RewriteCharacters.uses({
            ai_languageModel: this.OllamaChatModel2.output,
        });
        this.Worldbuilding.uses({
            ai_languageModel: this.OllamaChatModel6.output,
        });
        this.CritiqueWorldbuilding.uses({
            ai_languageModel: this.OllamaChatModel7.output,
        });
        this.RewriteWorldbuilding.uses({
            ai_languageModel: this.OllamaChatModel8.output,
        });
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
        this.GhostwriterBrief.uses({
            ai_languageModel: this.OllamaChatModel18.output,
        });
        this.StoryArc.uses({
            ai_languageModel: this.OllamaChatModel3.output,
        });
        this.CritiqueStoryArc.uses({
            ai_languageModel: this.OllamaChatModel4.output,
        });
        this.RewriteStoryArc.uses({
            ai_languageModel: this.OllamaChatModel5.output,
        });
    }
}
