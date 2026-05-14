import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : 1 - Braindump to Dossier
// Nodes   : 51  |  Connections: 39
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// OnFormSubmission                   formTrigger                
// FactionPowerTemplate               googleDocs                 [creds]
// LocationProfileTemplate            googleDocs                 [creds]
// RevelationBackstoryTemplate        googleDocs                 [creds]
// DialogueVoiceTemplate              googleDocs                 [creds]
// ConflictArchitectureTemplate       googleDocs                 [creds]
// GetThemesTemplate                  googleDocs                 [creds]
// GetTropeTemplate                   googleDocs                 [creds]
// GetPlotTemplate                    googleDocs                 [creds]
// GetCharacterTemplate               googleDocs                 [creds]
// GetCharacterEmotionTemplate        googleDocs                 [creds]
// GetStoryTemplate                   googleDocs                 [creds]
// GetWorldbuildingTemplate           googleDocs                 [creds]
// GetForbiddenWordsTemplate          set                        
// GetBlankDossier                    googleDocs                 [creds]
// UpdateDossierDoc                   googleDocs                 [creds]
// ExtractSeeds                       code                       
// UniversalConfig                    code                       
// IdentifyGenre                      chainLlm                   [AI]
// PrepPitchInput                     code                       
// BrainstormPitch                    chainLlm                   [AI]
// PickTheBest                        chainLlm                   [AI]
// PrepareBuilder                     code                       
// BuildDossierWorld                  chainLlm                   [AI]
// PrepCharactersInput                code                       
// BuildDossierCharacters             chainLlm                   [AI]
// PrepPlotInput                      code                       
// BuildDossierPlotArcs               chainLlm                   [AI]
// PrepSubplotInput                   code                       
// BuildDossierSubplot                chainLlm                   [AI]
// PrepTropeInput                     code                       
// BuildDossierTropes                 chainLlm                   [AI]
// MergeDossier                       code                       
// PrepNameCheckInput                 code                       
// NameCheck                          chainLlm                   [AI]
// PrepStructuralReviewInput          code                       
// StructuralReview                   chainLlm                   [AI]
// PrepRewriteInput                   code                       
// DossierRewrite                     chainLlm                   [AI]
// PostProcess                        code                       
// OllamaChatModel2                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel3                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel4                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel5                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel6                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel7                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel15                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel8                   lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel10                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel12                  lmChatOllama               [creds] [ai_languageModel]
// OllamaChatModel13                  lmChatOllama               [creds] [ai_languageModel]
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
//                              → GetBlankDossier
//                                → ExtractSeeds
//                                  → UniversalConfig
//                                    → IdentifyGenre
//                                      → PrepPitchInput
//                                        → BrainstormPitch
//                                          → PickTheBest
//                                            → PrepareBuilder
//                                              → BuildDossierWorld
//                                                → PrepCharactersInput
//                                                  → BuildDossierCharacters
//                                                    → PrepPlotInput
//                                                      → BuildDossierPlotArcs
//                                                        → PrepSubplotInput
//                                                          → BuildDossierSubplot
//                                                            → PrepTropeInput
//                                                              → BuildDossierTropes
//                                                                → MergeDossier
//                                                                  → PrepNameCheckInput
//                                                                    → NameCheck
//                                                                      → PrepStructuralReviewInput
//                                                                        → StructuralReview
//                                                                          → PrepRewriteInput
//                                                                            → DossierRewrite
//                                                                              → PostProcess
//                                                                                → UpdateDossierDoc
//
// AI CONNECTIONS
// IdentifyGenre.uses({ ai_languageModel: OllamaChatModel13 })
// BrainstormPitch.uses({ ai_languageModel: OllamaChatModel12 })
// PickTheBest.uses({ ai_languageModel: OllamaChatModel10 })
// BuildDossierWorld.uses({ ai_languageModel: OllamaChatModel2 })
// BuildDossierCharacters.uses({ ai_languageModel: OllamaChatModel3 })
// BuildDossierPlotArcs.uses({ ai_languageModel: OllamaChatModel4 })
// BuildDossierSubplot.uses({ ai_languageModel: OllamaChatModel5 })
// BuildDossierTropes.uses({ ai_languageModel: OllamaChatModel6 })
// NameCheck.uses({ ai_languageModel: OllamaChatModel15 })
// StructuralReview.uses({ ai_languageModel: OllamaChatModel7 })
// DossierRewrite.uses({ ai_languageModel: OllamaChatModel8 })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: "PwhrD21L52oRR241",
    name: "1 - Braindump to Dossier",
    active: false,
    settings: { executionOrder: "v1", callerPolicy: "workflowsFromSameOwner", availableInMCP: false }
})
export class _1BraindumpToDossierWorkflow {

    // =====================================================================
// CONFIGURATION DES NOEUDS
// =====================================================================

    @node({
        id: "264805ab-4947-454c-bc53-bc28af72b6ce",
        webhookId: "a7c83b9c-445a-4828-bb52-93ca8c26750a",
        name: "On form submission",
        type: "n8n-nodes-base.formTrigger",
        version: 2.2,
        position: [-1712, 128]
    })
    OnFormSubmission = {
        formTitle: "Dossier Builder",
        formDescription: "Fill in your story details. All fields except Author Notes, Locked Characters and Locked Profiles are required.",
        formFields: {
            values: [
                {
                    fieldLabel: "Book Title",
                    requiredField: true
                },
                {
                    fieldLabel: "Braindump",
                    fieldType: "textarea",
                    requiredField: true
                },
                {
                    fieldLabel: "Author Notes",
                    fieldType: "textarea"
                },
                {
                    fieldLabel: "Locked Characters"
                },
                {
                    fieldLabel: "Locked Profiles",
                    fieldType: "textarea"
                },
                {
                    fieldLabel: "The Promise",
                    fieldType: "textarea",
                    placeholder: "What transformation does the reader undergo? e.g. \"The reader finishes believing whistleblowing costs everything and is still worth it.\""
                },
                {
                    fieldLabel: "The Edges",
                    fieldType: "textarea",
                    placeholder: "Who is this book NOT for? e.g. \"Not a cozy mystery. Not YA. Not a redemption arc — the system does not reform.\""
                },
                {
                    fieldLabel: "The Differentiator",
                    fieldType: "textarea",
                    placeholder: "What lived insight makes this book impossible to replicate from training data? e.g. \"Author spent 8 years in pharma compliance — every regulatory scene is autobiographical.\""
                }
            ]
        },
        options: {}
    };

    @node({
        id: "347d6ad2-467d-4610-914f-1987a2d1cfb7",
        name: "Faction & Power Template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-1520, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    FactionPowerTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1yUtBR0o6Y1Pqc8H0GGua8xbuPhcSm_4OD5HW73YWry0/edit?usp=sharing"
    };

    @node({
        id: "a3331a09-8fec-40f1-95e0-3862cce06938",
        name: "Location Profile Template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-1328, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    LocationProfileTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/13SLU8Lati3Bh2KwAt9PMr9d-1LL6j8oWwoiGTcS558E/edit?usp=sharing"
    };

    @node({
        id: "d68f854b-de52-4c4d-9d45-da11c78fe8bb",
        name: "Revelation & Backstory Template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-1152, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    RevelationBackstoryTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1djCPHBjQXAt-9uEYu3xT9BiRtb9L837N8tgmJvcunhE/edit?usp=sharing"
    };

    @node({
        id: "eb7f1597-5d3d-4893-8e17-a3dd08597eaa",
        name: "Dialogue & Voice Template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-960, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    DialogueVoiceTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1C0IZD_F5yuTJclxS3HDZQe_Ikx5d8cS13c_pW53P2Zo/edit?usp=sharing"
    };

    @node({
        id: "c0335ab1-687c-418b-9ef8-74c5743049a4",
        name: "Conflict Architecture Template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-784, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    ConflictArchitectureTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1pmwf_gk644RpaDf3miLIUKXOnp0__mTowqgN_glyRaY/edit?usp=sharing"
    };

    @node({
        id: "bab0204f-46d1-4c34-a64e-0b8debd76ced",
        name: "Get Themes Template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-608, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetThemesTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1mmDaJeNOtYrJKkBoZloGt6yXewhW5wPQ4K_Pyg4ookI/edit?usp=sharing"
    };

    @node({
        id: "f4e4458b-2c2d-4c71-a0a7-3fe6a951c379",
        name: "Get Trope Template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-416, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetTropeTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1-iMbCIuopefgcTykrqRuDTKLQTowXkCUirzgeNfDptA/edit?tab=t.0"
    };

    @node({
        id: "060e8fd5-72bd-4ce7-8264-172b9b298ca4",
        name: "Get Plot Template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-240, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetPlotTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1Adhv_L5YOSHv_n4aAPQch8GNSwVkxWIZeVPwAC6ea-k/edit?usp=sharing"
    };

    @node({
        id: "4b8567d3-d6ae-4d20-a96d-6da3fda6b976",
        name: "Get Character Template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [-48, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetCharacterTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1CzwF5e6abQCWiQjeG2w3PWHcMVT8Lv2pn61-tOZMKrM/edit?tab=t.0"
    };

    @node({
        id: "723415d9-7d00-41d4-ae97-667817a57afd",
        name: "Get Character emotion template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [144, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetCharacterEmotionTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1h8P0RRd_Yr0qsbUGxyBnxFhKfU5GYBetXJp-geddTWs/edit?usp=sharing"
    };

    @node({
        id: "22dba889-b664-4f61-870d-8ca3860df621",
        name: "Get Story Template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [320, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetStoryTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1QNlU60cZuCkoVOf6vlYAM9cjOqPPPfngmm1lSkq0xMQ/edit?tab=t.0"
    };

    @node({
        id: "c4703b46-54b7-43c4-a845-bb866a9c9431",
        name: "Get Worldbuilding Template",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [512, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetWorldbuildingTemplate = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1hGCWFaHnbYtCJD-chCA5tWwj9KEBRiMt7xyZXxcjFU0/edit?tab=t.0"
    };

    @node({
        id: "1766b4d7-f0a9-4d82-8ba9-00193ce9d4b7",
        name: "Get Forbidden Words Template",
        type: "n8n-nodes-base.set",
        version: 3.4,
        position: [672, 128]
    })
    GetForbiddenWordsTemplate = {
        mode: "raw",
        jsonOutput: `{
  "forbidden_content": {
    "meta": { "title": "Forbidden Content Registry", "version": "1.0", "usage": "Standing reference applied to all prose, dialogue, and character writing across every project." },
    "forbidden_names": ["Chen","Sarah Chen","Elara","Lyra","Jasper","Lena","Zara","Zane","Niko","Lila","Mira","Leo"],
    "forbidden_phrases": ["A bastion of","A clarion of","A mosaic of","A testament to","Beacon of hope","Cautionary tale","Embark on a journey","Embark on an adventure","Embark on an odyssey","Embark on an exploration","Game changer","In stark contrast","In the wake of","Mist-shrouded world","Shimmering curtain","Sweeping vistas","Twists and turns","Variegated tapestry","Vibrant symphony","Wordsmith's craft","Little did she know","It was a testament to","Only time would tell","A new chapter began","The transition was seamless","A high-stakes game","The data doesn't lie","We need to find a way","I can't do this alone","Everything is under control","This is a victory for all of us","We must neutralize","We cannot afford any leaks","The system will ultimately correct itself","If we're not careful the whole system could collapse","We have a chance to make a real difference","We could really make a real difference","We have to expose the truth","This could change everything","We need to act fast","No one will expose our operations","We will maintain order at any cost","Make a real difference","Get it to the right people","Our only hope","Find a way to expose","The whole system could collapse"],
    "forbidden_vocabulary": ["Akin","Albeit","Ambiance","Arcane","Backdrop","Beacon","Bespoke","Breathtaking","Cacophony","Captivate","Delve","Drifting","Echoes","Elegant","Enigma","Ethereal","Evocative","Facets","Haunting","Hub","Immersive","Labyrinthine","Myriad","Narrative","Odyssey","Otherworldly","Pivotal","Realm","Resonate","Shimmering","Superimposed","Symphony","Tapestry","Timeless","Transcend","Transformative","Ubiquitous","Utterly","Vibrant","Whimsical","Neon","Cyber-space","Wired","Singularity","Digital ghost","Ghost in the machine","Unravel","Unleash","Navigate","Journey","Embark","Thrust","Grapple","Stark","Profound","Visceral","Palpable","Haunted","Shadowed","Looming","Sprawling","Teeming","Bustling","Gleaming","Glittering","Pulsing","Humming"],
    "forbidden_verbs_and_actions": ["Nodded","Sighed","Chuckled","Smirked","Gestured vaguely","Pondered","Commenced","Utilized","Orchestrated","Thought to themselves","Meandered","Shuddered","Gazed","Stared into the distance","Whispered softly","Clenched her fists","Took a deep breath","Looked away","Felt a chill","Heart raced","Steeled herself","Squared her shoulders"],
    "forbidden_dialogue_patterns": ["Any line that contains no world-specific element as subject or stakes","Any line that could appear in a different story without modification","Any line where inner state is stated directly rather than shown through world-specific action","Any antagonist line implying self-aware villainy rather than belief in order","Any protagonist line using abstract hope language without a specific system reference"],
    "forbidden_quirk_patterns": ["Any quirk described as a plot action or tool use","Any quirk followed by inner state commentary such as 'reveals their' or 'a habit that shows'","Carries a device","Uses a device","Checks a device","Always has a tool","Often monitors","Frequently checks"]
  }
}`,
        options: {}
    };

    @node({
        id: "8b7515dc-12fe-4e3f-9afc-25b009ac980c",
        name: "Get BLANK Dossier",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [848, 128],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    GetBlankDossier = {
        operation: "get",
        documentURL: "https://docs.google.com/document/d/1tRB_SWXb8M2BAL7Xh_DQOYwtrfjKW7ggRIf7k9THl7s/edit?usp=sharing"
    };

    @node({
        id: "515e78fc-c4c0-44a2-829f-e50a922398a7",
        name: "Update Dossier Doc",
        type: "n8n-nodes-base.googleDocs",
        version: 2,
        position: [2656, 368],
        credentials: {googleDocsOAuth2Api:{id:"eLuqZwmRkYA0tVfY",name:"Google Docs account"}}
    })
    UpdateDossierDoc = {
        operation: "update",
        documentURL: "={{ $('Get BLANK Dossier').item.json.documentId }}",
        actionsUi: {
            actionFields: [
                {
                    action: "insert",
                    text: `={{ $json.text }}
`
                }
            ]
        }
    };

    @node({
        id: "cb65c8a4-2d67-4845-ba66-4419c265aea5",
        name: "Extract Seeds",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [992, 128]
    })
    ExtractSeeds = {
        jsCode: `
function extractDocText(docJson) {
  if (!docJson) return "";
  try {
    const viaParagraphs = (docJson?.body?.content || [])
      .flatMap(el => el?.paragraph?.elements || [])
      .map(el => el?.textRun?.content || "")
      .join("").trim();
    if (viaParagraphs) return viaParagraphs;
    if (typeof docJson?.body === "string" && docJson.body.trim()) return docJson.body.trim();
    if (typeof docJson?.text === "string" && docJson.text.trim()) return docJson.text.trim();
    if (typeof docJson?.content === "string" && docJson.content.trim()) return docJson.content.trim();
    return "";
  } catch(e) { return ""; }
}

const formData = $("On form submission").first()?.json || {};
const title = (formData["Book Title"] || "UNTITLED PROJECT").trim().toUpperCase();
const braindump = (formData["Braindump"] || formData["braindump"] || "").trim();
const authorNotes = formData["Author Notes"] || "";
const lockedCharacters = formData["Locked Characters"] || "";
const lockedProfiles = formData["Locked Profiles"] || "";
const thePromise = formData["The Promise"] || "";
const theEdges = formData["The Edges"] || "";
const theDifferentiator = formData["The Differentiator"] || "";

const templates = {
  tropes:            extractDocText($("Get Trope Template").first()?.json),
  plot:              extractDocText($("Get Plot Template").first()?.json),
  character:         extractDocText($("Get Character Template").first()?.json),
  story:             extractDocText($("Get Story Template").first()?.json),
  worldbuilding:     extractDocText($("Get Worldbuilding Template").first()?.json),
  themes:            extractDocText($("Get Themes Template").first()?.json),
  character_emotion: extractDocText($("Get Character emotion template").first()?.json),
  conflict:          extractDocText($("Conflict Architecture Template").first()?.json),
  voice:             extractDocText($("Dialogue & Voice Template").first()?.json),
  backstory:         extractDocText($("Revelation & Backstory Template").first()?.json),
  location:          extractDocText($("Location Profile Template").first()?.json),
  faction:           extractDocText($("Faction & Power Template").first()?.json),
};

const forbiddenData = $('Get Forbidden Words Template').first()?.json?.forbidden_content || {};
const forbiddenWords = JSON.stringify(forbiddenData, null, 2);
const forbiddenFlat = [...new Set([
  ...(forbiddenData.forbidden_names || []),
  ...(forbiddenData.forbidden_phrases || []),
  ...(forbiddenData.forbidden_vocabulary || []),
  ...(forbiddenData.forbidden_verbs_and_actions || []),
].filter(w => w.length > 1))];

const blankDossierId = $("Get BLANK Dossier").first()?.json?.documentId || "";

return [{
  json: {
    title, braindump, authorNotes, lockedCharacters, lockedProfiles,
    thePromise, theEdges, theDifferentiator,
    templates, forbiddenWords, forbiddenFlat, blankDossierId,
    forbiddenNamesList: forbiddenData.forbidden_names || [],
    forbiddenPhrasesList: forbiddenData.forbidden_phrases || [],
  }
}];
`
    };

    @node({
        id: "70ec2e29-aeb1-4b97-af08-fa484b63a66e",
        name: "Universal Config",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [1152, 128]
    })
    UniversalConfig = {
        jsCode: `const inputData = $input.first().json;
const profiles = {
  creative: { label: "creative", model: "MHKetbi/Mistral-Small-24B-Instruct-2501-writer:Q4_K_M", parameters: { temperature: 0.72, context_length: 16384, num_predict: 4096, top_p: 0.9, top_k: 50, repeat_penalty: 1.08, presence_penalty: 0, num_gpu: 99 } },
  creative_max: { label: "creative_max", model: "qwen2.5:32b", parameters: { temperature: 0.78, context_length: 16384, num_predict: 4096, top_p: 0.92, top_k: 60, repeat_penalty: 1.05, presence_penalty: 0, num_gpu: 99 } },
  balanced: { label: "balanced", model: "mistral:latest", parameters: { temperature: 0.6, context_length: 16384, num_predict: 4096, top_p: 0.88, top_k: 40, repeat_penalty: 1.08, presence_penalty: 0, num_gpu: 99 } },
  light: { label: "light", model: "llama3.1:8b", parameters: { temperature: 0.55, context_length: 8192, num_predict: 3072, top_p: 0.85, top_k: 30, repeat_penalty: 1.1, presence_penalty: 0, num_gpu: 99 } },
  fast_iter: { label: "fast_iter", model: "qwen:14b", parameters: { temperature: 0.65, context_length: 16384, num_predict: 6144, top_p: 0.9, top_k: 40, repeat_penalty: 1.08, presence_penalty: 0, num_gpu: 99 } },
  rewrite: { label: "rewrite", model: "MHKetbi/Mistral-Small-24B-Instruct-2501-writer:Q4_K_M", parameters: { temperature: 0.55, context_length: 24576, num_predict: 8192, top_p: 0.86, top_k: 40, repeat_penalty: 1.1, presence_penalty: 0, num_gpu: 99 } }
};

const prose_jail = (inputData.forbiddenFlat && inputData.forbiddenFlat.length > 0)
  ? "STRICT NEGATIVE PROMPT: Never use these words/phrases: " + inputData.forbiddenFlat.join(', ') + "."
  : "STRICT NEGATIVE PROMPT: No vague, decorative, or AI-cliche language.";

return [{
  json: {
    ...inputData,
    profiles,
    prose_jail,
    braindump: inputData.braindump || "",
    book_title: inputData.title || "UNTITLED PROJECT",
  }
}];
`
    };

    @node({
        id: "c707f173-430f-47a4-b5eb-52a161eace6c",
        name: "Identify Genre",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [-1920, 368]
    })
    IdentifyGenre = {
        promptType: "define",
        text: `=You are a precise commercial fiction genre classifier.

TASK: Read the braindump and author's promise below, then classify the story into its most specific marketable subgenre.

OUTPUT FORMAT — return exactly this JSON, nothing else:
A JSON object with keys: genre (primary subgenre), secondary (secondary subgenre if applicable), comp_titles (2-3 comparable published novels).

RULES:
- Choose from real publishing-industry subgenres.
- comp_titles must be real published books.
- Use the author's promise and edges to inform genre positioning.

NEGATIVE CONSTRAINTS:
- DO NOT invent genres. Use established publishing categories only.
- DO NOT output anything except the JSON object.
- No markdown, no explanation, no preamble.

BRAINDUMP:
{{ $('Universal Config').item.json.braindump }}

THE PROMISE:
{{ $('Universal Config').item.json.thePromise }}

THE EDGES:
{{ $('Universal Config').item.json.theEdges }}`
    };

    @node({
        id: "a1b2c3d4-prep-0010-000000000010",
        name: "Prep Pitch Input",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [-1648, 368]
    })
    PrepPitchInput = {
        jsCode: `
const genre = $("Identify Genre").item.json.text || "";
const config = $("Universal Config").item.json;
const NL = String.fromCharCode(10);
const input = [
  "GENRE CLASSIFICATION:", genre, "",
  "THE PROMISE:", config.thePromise || "(not provided)", "",
  "THE EDGES:", config.theEdges || "(not provided)", "",
  "THE DIFFERENTIATOR:", config.theDifferentiator || "(not provided)", "",
  "BRAINDUMP:", config.braindump || ""
].join(NL);
return [{ json: { text: input } }];
`
    };

    @node({
        id: "919f3101-3059-4cb5-803e-ce008bbdec90",
        name: "Brainstorm Pitch",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [-1520, 368]
    })
    BrainstormPitch = {
        promptType: "define",
        text: `=You are an experienced commercial genre novelist and story doctor. Generate 3 distinct, compelling story concepts from the braindump provided.

OUTPUT FORMAT:
Return a JSON object with a pitches array. Each pitch has keys: title, logline (one-sentence hook max 35 words), central_conflict, stakes, unique_hooks (array of 3+), braindump_evidence (array of exact braindump phrases).

QUALITY RUBRIC — each pitch MUST:
1. Name at least 3 specific elements from the braindump.
2. Have stakes that are concrete and personal, not abstract.
3. Contain a central conflict that creates genuine dramatic tension.
4. Honour the author's PROMISE and respect the EDGES (who this is NOT for).

NEGATIVE CONSTRAINTS:
- DO NOT invent characters, locations, or concepts not in the braindump.
- DO NOT synthesize external lore from your training data.
- Output pure JSON only. No markdown, no preamble, no commentary.

BRAINDUMP AND GENRE:
{{ $('Prep Pitch Input').item.json.text }}`
    };

    @node({
        id: "f8c66776-a826-4679-a181-2aafc41c8650",
        name: "Pick the Best",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [-1264, 368]
    })
    PickTheBest = {
        promptType: "define",
        text: `=You are a sharp, market-savvy developmental editor. Evaluate the pitches below and select the strongest concept for a full novel.

OUTPUT FORMAT — return exactly this JSON:
A JSON object with: selected_idea (full pitch title), selection_reasoning (2-3 sentences), scores (array of objects with title, commercial_viability 1-5, emotional_resonance 1-5, braindump_fidelity 1-5, conflict_clarity 1-5, total 4-20).

RULES:
- Pick the pitch with the highest total score. Break ties by braindump_fidelity.

NEGATIVE CONSTRAINTS:
- DO NOT invent new content. Evaluate only what is presented.
- Output pure JSON only. No markdown, no preamble.

PITCHES TO EVALUATE:
{{ $('Brainstorm Pitch').item.json.text }}`
    };

    @node({
        id: "a1b2c3d4-prep-0001-000000000001",
        name: "Prepare Builder",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [-944, 368]
    })
    PrepareBuilder = {
        jsCode: `
const pickOutput = $("Pick the Best").item.json.text || "";
let selectedIdea = "";
try {
  const m = pickOutput.match(/\\{[\\s\\S]*\\}/);
  if (m) { selectedIdea = (JSON.parse(m[0]).selected_idea || "").trim(); }
} catch(e) {}
if (!selectedIdea) selectedIdea = pickOutput.trim();

const genre = $("Identify Genre").item.json.text || "";
const seeds = $("Extract Seeds").item.json;
const config = $("Universal Config").item.json;
const NL = String.fromCharCode(10);

const worldInput = [
  "SELECTED PITCH:", selectedIdea, "",
  "GENRE:", genre, "",
  "AUTHOR NOTES:", seeds.authorNotes || "(none)", "",
  "WORLDBUILDING TEMPLATE:", seeds.templates?.worldbuilding || "(no template)", "",
  "LOCATION PROFILE TEMPLATE:", seeds.templates?.location || "(no template)", "",
  "FACTION & POWER TEMPLATE:", seeds.templates?.faction || "(no template)", "",
  "BRAINDUMP:", seeds.braindump || "(no braindump)", "",
  config.prose_jail || ""
].join(NL);

return [{
  json: {
    text: worldInput,
    selected_pitch: selectedIdea,
    genre,
    title: seeds.title || "UNTITLED PROJECT",
    braindump: seeds.braindump || "",
    authorNotes: seeds.authorNotes || "",
    lockedCharacters: seeds.lockedCharacters || "",
    lockedProfiles: seeds.lockedProfiles || "",
    thePromise: seeds.thePromise || "",
    theEdges: seeds.theEdges || "",
    theDifferentiator: seeds.theDifferentiator || "",
    templates: seeds.templates || {},
    forbiddenWords: seeds.forbiddenWords || "{}",
    forbiddenFlat: seeds.forbiddenFlat || [],
    prose_jail: config.prose_jail || "",
    blankDossierId: seeds.blankDossierId || "",
  }
}];
`
    };

    @node({
        id: "f2080ad2-2cd2-4f29-a4c6-f82454a86cce",
        name: "Build Dossier: World",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [-800, 368]
    })
    BuildDossierWorld = {
        promptType: "define",
        text: `=You are a worldbuilder who grounds every detail in the author's braindump. You never import settings, mechanics, or terminology from your training data.

TASK: Using the braindump and the three templates provided (WORLDBUILDING, LOCATION PROFILE, FACTION & POWER), build a comprehensive world document. Fill every template section with content derived from the braindump. If a detail is not in the braindump, mark it (NEEDS AUTHOR INPUT).

TEMPLATE COVERAGE:
- Use the WORLDBUILDING TEMPLATE for environmental details, history, technology/magic systems, and rules.
- Use the LOCATION PROFILE TEMPLATE for specific location breakdowns with sensory detail.
- Use the FACTION & POWER TEMPLATE for political structures, power dynamics, and organisations.

QUALITY STANDARDS:
- Locations must have sensory details (sight, sound, smell).
- Power structures must connect to specific characters or factions from the braindump.
- Technology or magic systems must have clear rules and limitations.

NEGATIVE CONSTRAINTS:
- DO NOT invent locations, factions, or mechanics not in the braindump.
- DO NOT synthesize external lore from your training data.
- DO NOT address the user or refer to "your project" or "your narrative".
- DO NOT include conclusions, summaries, or meta-commentary about the writing process.
- DO NOT reproduce the braindump or templates verbatim. Output ONLY your original analysis filling the template sections.
- DO NOT invent sections not covered by the templates (no marketing plans, no target audience, no adaptation pitches, no stylistic advice).
- DO NOT use words from non-English languages.
- Follow all restrictions in the NEGATIVE PROMPT section.
- No preamble, no commentary. Output the world document only.

{{ $('Prepare Builder').item.json.text }}`
    };

    @node({
        id: "a1b2c3d4-prep-0002-000000000002",
        name: "Prep Characters Input",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [-528, 368]
    })
    PrepCharactersInput = {
        jsCode: `
const prep = $("Prepare Builder").item.json;
const worldOutput = $("Build Dossier: World").item.json.text || "";
const NL = String.fromCharCode(10);
const input = [
  "COMPLETED WORLD SECTION:", worldOutput, "",
  "CHARACTER TEMPLATE:", prep.templates?.character || "(no template)", "",
  "CHARACTER EMOTION TEMPLATE:", prep.templates?.character_emotion || "(no template)", "",
  "DIALOGUE & VOICE TEMPLATE:", prep.templates?.voice || "(no template)", "",
  "REVELATION & BACKSTORY TEMPLATE:", prep.templates?.backstory || "(no template)", "",
  "LOCKED CHARACTERS:", prep.lockedCharacters || "(none)", "",
  "LOCKED PROFILES:", prep.lockedProfiles || "(none)", "",
  "AUTHOR NOTES:", prep.authorNotes || "(none)", "",
  "SELECTED PITCH:", prep.selected_pitch || "", "",
  "BRAINDUMP:", prep.braindump || "(no braindump)", "",
  prep.prose_jail || ""
].join(NL);
return [{ json: { text: input } }];
`
    };

    @node({
        id: "e3b4db7d-9b22-46cc-9010-7fd234b87dec",
        name: "Build Dossier: Characters",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [-384, 368]
    })
    BuildDossierCharacters = {
        promptType: "define",
        text: `=You are a character architect who builds psychology exclusively from the author's braindump and completed world.

TASK: Build comprehensive character profiles using ALL four templates provided: CHARACTER, CHARACTER EMOTION, DIALOGUE & VOICE, and REVELATION & BACKSTORY.

TEMPLATE COVERAGE:
- CHARACTER TEMPLATE: core identity, role, arc, relationships.
- CHARACTER EMOTION TEMPLATE: emotional range, triggers, coping mechanisms.
- DIALOGUE & VOICE TEMPLATE: speech patterns, vocabulary level, verbal tics, silence habits.
- REVELATION & BACKSTORY TEMPLATE: key past events, secrets, what they hide and why.

CHARACTER DEPTH STANDARDS:
- core_wound: Specific past event. Must be concrete, not abstract.
- core_lie: False belief they hold. Must be a sentence they would say.
- core_need: What they actually need to heal.
- key_relationships: Friction points with other named characters.
- voice: Each character must sound distinct in dialogue.

NEGATIVE CONSTRAINTS:
- DO NOT invent characters not in the braindump or locked characters list.
- DO NOT use AI-cliche names (Lyra, Elara, Kael, Chen, Thorne, Raven, Ash, Kai).
- Use ONLY names from the braindump or locked characters list.
- DO NOT address the user or refer to "your project" or "your narrative".
- DO NOT include conclusions, summaries, or meta-commentary about the writing process.
- DO NOT reproduce the braindump or templates verbatim. Output ONLY your original analysis filling the template sections.
- DO NOT invent sections not covered by the templates (no marketing plans, no target audience, no adaptation pitches, no stylistic advice).
- DO NOT use words from non-English languages.
- Follow all restrictions in the NEGATIVE PROMPT section.
- No preamble, no commentary. Output character profiles only.

{{ $('Prep Characters Input').item.json.text }}`
    };

    @node({
        id: "a1b2c3d4-prep-0003-000000000003",
        name: "Prep Plot Input",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [-112, 368]
    })
    PrepPlotInput = {
        jsCode: `
const prep = $("Prepare Builder").item.json;
const worldOutput = $("Build Dossier: World").item.json.text || "";
const charOutput = $("Build Dossier: Characters").item.json.text || "";
const NL = String.fromCharCode(10);
const input = [
  "COMPLETED WORLD:", worldOutput, "",
  "COMPLETED CHARACTERS:", charOutput, "",
  "PLOT TEMPLATE:", prep.templates?.plot || "(no template)", "",
  "CONFLICT ARCHITECTURE TEMPLATE:", prep.templates?.conflict || "(no template)", "",
  "THE PROMISE:", prep.thePromise || "(not provided)", "",
  "THE EDGES:", prep.theEdges || "(not provided)", "",
  "SELECTED PITCH:", prep.selected_pitch || "", "",
  "BRAINDUMP:", prep.braindump || "(no braindump)", "",
  prep.prose_jail || ""
].join(NL);
return [{ json: { text: input } }];
`
    };

    @node({
        id: "3c38d669-34d2-49d6-bd77-d252bf246790",
        name: "Build Dossier: Plot & Arcs",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [32, 368]
    })
    BuildDossierPlotArcs = {
        promptType: "define",
        text: `=You are a structural plot architect. You build every beat from the braindump, completed world, and completed characters.

TASK: Construct a complete plot architecture using BOTH the PLOT TEMPLATE and the CONFLICT ARCHITECTURE TEMPLATE. Honour THE PROMISE (the reader transformation) and respect THE EDGES (who this is NOT for).

TEMPLATE COVERAGE:
- PLOT TEMPLATE: acts, turning points, escalation, climax, resolution.
- CONFLICT ARCHITECTURE TEMPLATE: layers of conflict (internal, interpersonal, societal), tension escalation patterns, stakes laddering.

PLOT ARCHITECTURE STANDARDS:
- Act 1: Protagonist ordinary world, core wound, inciting incident.
- Act 2a: Escalating complications forcing protagonist to confront core lie.
- Midpoint: Revelation or reversal shifting story direction.
- Act 2b: Stakes intensify. Coping mechanisms fail.
- Act 3: Climax forces choice between core lie and core need. Resolution.
- Every turning point must create irreversible consequences.
- Every beat must name a specific character AND location.

NEGATIVE CONSTRAINTS:
- DO NOT invent characters, locations, or events not in the braindump.
- DO NOT use generic plot beats. Be specific to THIS story.
- DO NOT address the user or refer to "your project" or "your narrative".
- DO NOT include conclusions, summaries, or meta-commentary about the writing process.
- DO NOT reproduce the braindump, completed world, or completed characters verbatim. Output ONLY your original plot architecture filling the template sections.
- DO NOT invent sections not covered by the templates (no marketing plans, no target audience, no adaptation pitches, no stylistic advice).
- DO NOT use words from non-English languages.
- Follow all restrictions in the NEGATIVE PROMPT section.
- No preamble, no commentary. Output plot architecture only.

{{ $('Prep Plot Input').item.json.text }}`
    };

    @node({
        id: "a1b2c3d4-prep-0004-000000000004",
        name: "Prep Subplot Input",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [304, 368]
    })
    PrepSubplotInput = {
        jsCode: `
const prep = $("Prepare Builder").item.json;
const charOutput = $("Build Dossier: Characters").item.json.text || "";
const plotOutput = $("Build Dossier: Plot & Arcs").item.json.text || "";
const NL = String.fromCharCode(10);
const input = [
  "COMPLETED PLOT:", plotOutput, "",
  "COMPLETED CHARACTERS:", charOutput, "",
  "STORY TEMPLATE:", prep.templates?.story || "(no template)", "",
  "THEMES TEMPLATE:", prep.templates?.themes || "(no template)", "",
  "THE PROMISE:", prep.thePromise || "(not provided)", "",
  "THE DIFFERENTIATOR:", prep.theDifferentiator || "(not provided)", "",
  "BRAINDUMP:", prep.braindump || "(no braindump)", "",
  prep.prose_jail || ""
].join(NL);
return [{ json: { text: input } }];
`
    };

    @node({
        id: "64a533f1-65a4-441e-854e-da24f6d5575c",
        name: "Build Dossier: Subplot",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [448, 368]
    })
    BuildDossierSubplot = {
        promptType: "define",
        text: `=You are a subplot architect and thematic analyst who derives friction exclusively from this story's world mechanics and character wounds.

TASK: Design subplot threads AND map thematic layers using BOTH the STORY TEMPLATE and the THEMES TEMPLATE. Weave subplots through the main plot, creating organic friction between characters. Map how themes manifest through specific plot events.

TEMPLATE COVERAGE:
- STORY TEMPLATE: subplot thread structure, intersection points with main plot.
- THEMES TEMPLATE: thematic pillars, how each theme manifests, thematic counterpoint.

SUBPLOT & THEME STANDARDS:
- Each subplot must involve at least 2 named characters.
- source_of_friction must reference a specific character wound or world mechanic.
- Subplots must intersect with the main plot at specific beats.
- At least one subplot should create a moral dilemma.
- Each theme must be shown through at least 2 specific story events, not stated abstractly.
- Honour THE PROMISE and THE DIFFERENTIATOR.

NEGATIVE CONSTRAINTS:
- DO NOT invent characters or relationships not in the braindump.
- Every friction point must name a specific element from the world or character profiles.
- DO NOT address the user or refer to "your project" or "your narrative".
- DO NOT include conclusions, summaries, or meta-commentary about the writing process.
- DO NOT reproduce the braindump, completed plot, or completed characters verbatim. Output ONLY your original subplot and theme analysis filling the template sections.
- DO NOT invent sections not covered by the templates (no marketing plans, no target audience, no adaptation pitches, no stylistic advice).
- DO NOT use words from non-English languages.
- Follow all restrictions in the NEGATIVE PROMPT section.
- No preamble, no commentary. Output subplot and theme analysis only.

{{ $('Prep Subplot Input').item.json.text }}`
    };

    @node({
        id: "a1b2c3d4-prep-0005-000000000005",
        name: "Prep Trope Input",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [720, 368]
    })
    PrepTropeInput = {
        jsCode: `
const prep = $("Prepare Builder").item.json;
const charOutput = $("Build Dossier: Characters").item.json.text || "";
const plotOutput = $("Build Dossier: Plot & Arcs").item.json.text || "";
const NL = String.fromCharCode(10);
const input = [
  "COMPLETED PLOT:", plotOutput, "",
  "COMPLETED CHARACTERS:", charOutput, "",
  "TROPE TEMPLATE:", prep.templates?.tropes || "(no template)", "",
  "BRAINDUMP:", prep.braindump || "(no braindump)", "",
  prep.prose_jail || ""
].join(NL);
return [{ json: { text: input } }];
`
    };

    @node({
        id: "4ff8b0d3-ef94-43b7-8675-c450565cde1d",
        name: "Build Dossier: Tropes",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [880, 368]
    })
    BuildDossierTropes = {
        promptType: "define",
        text: `=You are a trope analyst who maps structural machinery using only events from THIS specific story.

TASK: Identify and map the narrative tropes operating in the completed plot using the trope template as your guide.

TROPE MAPPING STANDARDS:
- For each trope include: trope_name, how_it_manifests, specific_beat_reference, subversion_or_straight.
- specific_beat_reference must cite the exact plot beat or turning point.
- Map only tropes genuinely present. Do not force-fit tropes to fill sections.

NEGATIVE CONSTRAINTS:
- DO NOT import trope definitions from other stories.
- DO NOT invent trope instances not supported by the plot beats.
- DO NOT address the user or refer to "your project" or "your narrative".
- DO NOT include conclusions, summaries, or meta-commentary about the writing process.
- DO NOT reproduce the braindump, completed plot, or completed characters verbatim. Output ONLY your original trope analysis.
- DO NOT invent sections not covered by the templates (no marketing plans, no target audience, no adaptation pitches, no stylistic advice).
- DO NOT use words from non-English languages.
- Follow all restrictions in the NEGATIVE PROMPT section.
- No preamble, no commentary. Output trope analysis only.

{{ $('Prep Trope Input').item.json.text }}`
    };

    @node({
        id: "f90eb1c2-52c5-4da9-bb7f-e255a7bcf9c3",
        name: "Merge Dossier",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [1152, 368]
    })
    MergeDossier = {
        jsCode: `
function scrub(text) {
  if (!text || text.trim().length === 0) return "(MISSING DATA PACKET)";
  text = text.replace(/<think>[\\s\\S]*?<\\/think>/gi, "");
  text = text.replace(/^\\s*>\\s*.+$/gm, "");
  text = text.replace(/^(Let me|I'll|I will|First,|Now,|Next,|Here is|Here's|Below is).+$/gim, "");
  text = text.replace(/^(Note:|Please note:|Given the|By integrating|In conclusion|To summarize).+$/gim, "");
  text = text.replace(/^(Let's apply|Let us apply|This approach|This ensures).+$/gim, "");
  text = text.replace(/your (project|narrative|story|braindump)/gi, "the $1");
  text = text.replace(/^#{1,3}\\s*(Conclusion|Summary|Final Thoughts).*$/gim, "");
  text = text.replace(/\\\`\\\`\\\`json\\s*/g, "");
  text = text.replace(/\\\`\\\`\\\`\\s*/g, "");
  text = text.replace(/\\\\{3,}/g, "");
  text = text.replace(/\\n{4,}/g, "\\n\\n\\n");
  return text.trim();
}
const world    = scrub($("Build Dossier: World").item.json.text || "");
const chars    = scrub($("Build Dossier: Characters").item.json.text || "");
const plot     = scrub($("Build Dossier: Plot & Arcs").item.json.text || "");
const subplots = scrub($("Build Dossier: Subplot").item.json.text || "");
const tropes   = scrub($("Build Dossier: Tropes").item.json.text || "");
const prep = $("Prepare Builder").item.json;
const NL = String.fromCharCode(10);
const SEP = NL + NL + "---" + NL + NL;
const titleHeader = "# " + (prep.title || "UNTITLED PROJECT") + NL + NL;
const finalDossier = titleHeader + [world, chars, plot, subplots, tropes].join(SEP).trim();
return [{
  json: {
    text: finalDossier,
    word_count: finalDossier.split(/\\s+/).length,
    title: prep.title || "UNTITLED PROJECT",
    braindump: prep.braindump || "",
    lockedCharacters: prep.lockedCharacters || "",
    blankDossierId: prep.blankDossierId || "",
    forbiddenFlat: prep.forbiddenFlat || [],
    prose_jail: prep.prose_jail || "",
  }
}];
`
    };

    @node({
        id: "a1b2c3d4-prep-0006-000000000006",
        name: "Prep Name Check Input",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [1312, 368]
    })
    PrepNameCheckInput = {
        jsCode: `
const merge = $("Merge Dossier").item.json;
const NL = String.fromCharCode(10);
const input = [
  "LOCKED CHARACTERS:", merge.lockedCharacters || "(none)", "",
  "DOSSIER TO REVIEW:", merge.text || "(empty dossier)"
].join(NL);
return [{ json: { text: input } }];
`
    };

    @node({
        id: "04ce793e-28f4-4c35-b66c-1be919eb4955",
        name: "Name Check",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [1472, 368]
    })
    NameCheck = {
        promptType: "define",
        text: `=You are a veteran genre-fiction editor specialising in catching AI-generated character names.

TASK: Audit EVERY character name in the dossier. You MUST flag any that match or closely resemble:
1. AI-cliche defaults (MANDATORY FLAGS): Chen, Lyra, Elara, Kael, Thorne, Raven, Ash, Kai, Sera, Zara, Aria, Nova, Luna, Orion, Jasper, Rowan, Sage, Hartwell, Blackwood, Reeves, and ANY close variants or compound forms.
2. Names that are generic, bland, or interchangeable across stories.
3. Names culturally mismatched to the story setting.

CRITICAL: If a name appears in the AI-cliche list above, it MUST be flagged regardless of context. No exceptions unless the name also appears in the LOCKED CHARACTERS section or the BRAINDUMP.

OUTPUT FORMAT — return JSON with:
- flagged_names: array of objects with current_name, issue, suggested_replacement (single best replacement)
- approved_names: array of names that passed

RULES:
- LOCKED CHARACTERS are the ONLY exception to flagging.
- When in doubt, FLAG the name.
- Each suggestion must be distinctive, memorable, and appropriate to the story setting.

NEGATIVE CONSTRAINTS:
- DO NOT invent new characters.
- DO NOT approve AI-cliche names.
- Output pure JSON only. No markdown, no preamble.

{{ $('Prep Name Check Input').item.json.text }}`
    };

    @node({
        id: "a1b2c3d4-prep-0007-000000000007",
        name: "Prep Structural Review Input",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [1760, 368]
    })
    PrepStructuralReviewInput = {
        jsCode: `
const merge = $("Merge Dossier").item.json;
return [{ json: { text: merge.text || "(empty dossier)" } }];
`
    };

    @node({
        id: "e3e4dae9-821c-48fe-bde9-17bf3f6d5249",
        name: "Structural Review",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [1920, 368]
    })
    StructuralReview = {
        promptType: "define",
        text: `=You are a structural fault detector and developmental editor. You identify only REAL problems.

TASK: Audit the dossier for three categories of issues:
1. STRUCTURAL: Plot contradictions, missing motivations, broken cause-and-effect.
2. EMOTIONAL: Theme gaps, unearned payoffs, missing setups.
3. LOGIC: Timeline impossibilities, worldbuilding rule violations, contradictions.

OUTPUT FORMAT — return JSON with:
- issues: array of objects with id, category, severity, location (quote exact text), problem, fix
- issue_count: number
- overall_health: 1-5 score

RULES:
- Every fix must use text ALREADY in the dossier. Never add new material.
- If fewer than 3 real issues exist, return fewer items.

NEGATIVE CONSTRAINTS:
- DO NOT invent issues to fill a quota.
- DO NOT propose fixes adding new content.
- Output pure JSON only. No markdown, no preamble.

DOSSIER TO ANALYZE:
{{ $('Prep Structural Review Input').item.json.text }}`
    };

    @node({
        id: "a1b2c3d4-prep-0008-000000000008",
        name: "Prep Rewrite Input",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [2192, 368]
    })
    PrepRewriteInput = {
        jsCode: `
const merge = $("Merge Dossier").item.json;
const structural = $("Structural Review").item.json.text || "";
const nameCheck = $("Name Check").item.json.text || "";
const NL = String.fromCharCode(10);
const input = [
  "DOSSIER:", merge.text || "(empty)", "",
  "STRUCTURAL REVIEW:", structural, "",
  "NAME CHECK:", nameCheck
].join(NL);
return [{ json: { text: input } }];
`
    };

    @node({
        id: "abd7eb2b-d39f-485b-b2a9-fd000a2e28e9",
        name: "Dossier Rewrite",
        type: "@n8n/n8n-nodes-langchain.chainLlm",
        version: 1.4,
        position: [2352, 368]
    })
    DossierRewrite = {
        promptType: "define",
        text: `=You are a precision dossier editor. You apply fixes from the structural review and name check, leaving everything else EXACTLY unchanged.

REWRITE PROTOCOL:
1. Read each issue from the structural review.
2. Locate the exact text referenced.
3. Apply the fix exactly as described.
4. If the name check flagged names, replace them with the first suggestion.
5. Leave all other text unchanged.
6. Output the COMPLETE dossier with fixes applied inline.

CRITICAL RULES:
- The output MUST be at least as long as the input dossier. Never summarise or truncate.
- Do NOT restructure sections or move text between sections.
- Do NOT add new content, characters, or world elements.
- Do NOT duplicate existing sections. If a section already exists, do NOT create a second version of it.
- Do NOT add marketing plans, target audience sections, adaptation pitches, narrative style advice, or any section not already in the dossier.
- Do NOT translate or transliterate words into other languages. All output must be in English.
- If a fix is unclear, skip it and leave original text.
- Output the complete revised dossier as plain text. No JSON wrapping.

{{ $('Prep Rewrite Input').item.json.text }}`
    };

    @node({
        id: "a1b2c3d4-post-proc-000000000001",
        name: "Post Process",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [2528, 368]
    })
    PostProcess = {
        jsCode: `
const rewrite = $input.first().json.text || "";

// Full-word replacement map with explicit inflections.
// Each forbidden word/form maps to its replacement.
// DO NOT add stems that could match story proper nouns (e.g. "drift" matches "The Drift").
const wordMap = {
  "akin": "similar", "albeit": "although", "ambiance": "atmosphere", "arcane": "obscure",
  "backdrop": "setting", "backdrops": "settings",
  "beacon": "signal", "beacons": "signals",
  "bespoke": "custom",
  "breathtaking": "striking", "breathtakingly": "strikingly",
  "cacophony": "din", "cacophonous": "discordant",
  "captivate": "engage", "captivates": "engages", "captivated": "engaged", "captivating": "engaging",
  "delve": "examine", "delves": "examines", "delved": "examined", "delving": "examining",
  "elegant": "refined", "elegantly": "in a refined way",
  "enigma": "puzzle", "enigmas": "puzzles", "enigmatic": "mysterious",
  "ethereal": "wispy", "ethereally": "faintly",
  "evocative": "suggestive", "evocatively": "suggestively",
  "facet": "aspect", "facets": "aspects",
  "haunting": "lingering", "hauntingly": "lingeringly",
  "hub": "centre", "hubs": "centres",
  "immersive": "absorbing", "immersed": "absorbed", "immersion": "absorption",
  "labyrinthine": "complex", "labyrinth": "maze",
  "myriad": "many",
  "odyssey": "voyage", "odysseys": "voyages",
  "otherworldly": "strange",
  "pivotal": "critical", "pivotally": "critically",
  "realm": "domain", "realms": "domains",
  "resonate": "register", "resonates": "registers", "resonated": "registered", "resonating": "registering",
  "shimmering": "flickering", "shimmer": "flicker", "shimmered": "flickered",
  "superimposed": "overlaid",
  "symphony": "chorus", "symphonies": "choruses",
  "tapestry": "weave", "tapestries": "weaves",
  "timeless": "enduring",
  "transcend": "surpass", "transcends": "surpasses", "transcended": "surpassed", "transcending": "surpassing",
  "transformative": "decisive",
  "ubiquitous": "pervasive",
  "utterly": "completely",
  "vibrant": "vivid", "vibrantly": "vividly",
  "whimsical": "playful",
  "neon": "fluorescent",
  "cyber-space": "network",
  "singularity": "convergence",
  "digital ghost": "data remnant", "digital ghosts": "data remnants",
  "ghost in the machine": "system echo",
  "unravel": "untangle", "unravels": "untangles", "unravelled": "untangled", "unraveling": "untangling",
  "unleash": "release", "unleashes": "releases", "unleashed": "released", "unleashing": "releasing",
  "navigate": "traverse", "navigates": "traverses", "navigated": "traversed", "navigating": "traversing",
  "journey": "path", "journeys": "paths",
  "embark": "begin", "embarks": "begins", "embarked": "began", "embarking": "beginning",
  "thrust": "push",
  "grapple": "wrestle", "grapples": "wrestles", "grappled": "wrestled", "grappling": "wrestling",
  "stark": "severe", "starkly": "severely",
  "profound": "deep", "profoundly": "deeply",
  "visceral": "raw", "viscerally": "in a raw way",
  "palpable": "tangible", "palpably": "tangibly",
  "haunted": "troubled",
  "shadowed": "darkened",
  "looming": "approaching",
  "sprawling": "extensive",
  "teeming": "full",
  "bustling": "busy",
  "gleaming": "bright",
  "glittering": "sparkling",
  "pulsing": "beating",
  "humming": "droning",
  "nodded": "agreed",
  "sighed": "exhaled", "sighing": "exhaling",
  "chuckled": "laughed", "chuckling": "laughing",
  "smirked": "half-smiled", "smirking": "half-smiling",
  "pondered": "considered", "pondering": "considering",
  "commenced": "started", "commencing": "starting",
  "utilized": "used", "utilizing": "using", "utilizes": "uses",
  "orchestrated": "arranged", "orchestrating": "arranging",
  "meandered": "wandered", "meandering": "wandering",
  "shuddered": "trembled", "shuddering": "trembling",
  "gazed": "looked", "gazing": "looking",
  "whispered softly": "murmured",
  "seamlessly": "smoothly", "seamless": "smooth"
};

let output = rewrite;

// 1. Replace forbidden vocabulary (case-insensitive, exact word boundary)
for (const [word, replacement] of Object.entries(wordMap)) {
  const escaped = word.replace(/[-/\\\\^$*+?.()| ]/g, "\\\\$&");
  const regex = new RegExp("\\\\b" + escaped + "\\\\b", "gi");
  output = output.replace(regex, function(match) {
    if (match[0] === match[0].toUpperCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });
}

// 2. Remove forbidden phrases (case-insensitive)
const forbiddenPhrases = [
  "A bastion of", "A clarion of", "A mosaic of", "A testament to",
  "Beacon of hope", "Cautionary tale", "Embark on a journey",
  "Embark on an adventure", "Embark on an odyssey", "Embark on an exploration",
  "Game changer", "In stark contrast", "In the wake of",
  "Mist-shrouded world", "Shimmering curtain", "Sweeping vistas",
  "Twists and turns", "Variegated tapestry", "Vibrant symphony",
  "Wordsmith's craft", "Little did she know", "It was a testament to",
  "Only time would tell", "A new chapter began", "The transition was seamless",
  "Make a real difference", "Our only hope", "This could change everything"
];

// 2b. Fix collocations broken by word replacement
output = output.replace(/examines into/gi, "looks into");
output = output.replace(/examined into/gi, "looked into");
output = output.replace(/examining into/gi, "looking into");
for (const phrase of forbiddenPhrases) {
  const escaped = phrase.replace(/[-/\\\\^$*+?.()| ]/g, "\\\\$&");
  const regex = new RegExp(escaped, "gi");
  output = output.replace(regex, "");
}

// 3. Strip meta-language lines (LLM preamble / conclusions)
output = output.replace(/^(Based on|Given the|In conclusion|To summarize|To seamlessly|To effectively|To ensure that).+$/gim, "");
output = output.replace(/^(By integrating|By leveraging|By meticulously|By mapping|By analyzing|By examining|By applying).+$/gim, "");
output = output.replace(/^(Let's apply|Let us apply|This approach|This ensures|This analysis provides).+$/gim, "");
output = output.replace(/^(This outline provides|This structured approach|This provides a|This narrative framework).+$/gim, "");
output = output.replace(/^(This detailed|This comprehensive|This plot outline|This document provides).+$/gim, "");
output = output.replace(/your (project|narrative|story|braindump|detailed specification)/gi, "the $1");

// 4. Strip non-ASCII characters (catches Cyrillic/Russian hallucinations)
output = output.replace(/[^ -]+/g, "");

// 5. Collapse excessive whitespace
output = output.replace(/\\n{4,}/g, "\\n\\n\\n").trim();

return [{ json: { text: output, blankDossierId: $("Merge Dossier").item.json.blankDossierId || "" } }];
`
    };

    @node({
        id: "0f8048b2-29c4-4650-bb19-d7d596dd3cb8",
        name: "Ollama Chat Model2",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [-800, 592],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaChatModel2 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}"
        }
    };

    @node({
        id: "83b651bc-338b-4a96-accd-77431f60be41",
        name: "Ollama Chat Model3",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [-384, 608],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaChatModel3 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}"
        }
    };

    @node({
        id: "eb4e98c1-aa34-45a1-b1d4-c051da3bf012",
        name: "Ollama Chat Model4",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [32, 608],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaChatModel4 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}"
        }
    };

    @node({
        id: "ba65b940-9220-4204-a216-4923a908ab15",
        name: "Ollama Chat Model5",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [448, 608],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaChatModel5 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}"
        }
    };

    @node({
        id: "5dc7801e-a9d6-4927-bbe1-132124129d24",
        name: "Ollama Chat Model6",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [880, 592],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaChatModel6 = {
        model: "={{ $('Universal Config').item.json.profiles.creative.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative.parameters.repeat_penalty }}"
        }
    };

    @node({
        id: "3293e0cd-494d-427a-a307-b6a0bce98839",
        name: "Ollama Chat Model7",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [1920, 576],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaChatModel7 = {
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.balanced.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}"
        }
    };

    @node({
        id: "caa7ddda-25c6-41f1-b5d3-40fb38967598",
        name: "Ollama Chat Model15",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [1472, 544],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaChatModel15 = {
        model: "={{ $('Universal Config').item.json.profiles.light.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.light.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.light.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.light.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.light.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.light.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.light.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.light.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.light.parameters.repeat_penalty }}"
        }
    };

    @node({
        id: "6014cb4d-6948-4c52-a954-1dd363f62741",
        name: "Ollama Chat Model8",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [2352, 592],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaChatModel8 = {
        model: "={{ $('Universal Config').item.json.profiles.rewrite.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.rewrite.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.rewrite.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.rewrite.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.rewrite.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.rewrite.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.rewrite.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.rewrite.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.rewrite.parameters.repeat_penalty }}"
        }
    };

    @node({
        id: "c836f72e-e887-4387-9e2b-3bff1e9ce866",
        name: "Ollama Chat Model10",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [-1264, 576],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaChatModel10 = {
        model: "={{ $('Universal Config').item.json.profiles.balanced.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.balanced.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.balanced.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.balanced.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.balanced.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.balanced.parameters.repeat_penalty }}"
        }
    };

    @node({
        id: "d7ed488d-a3e2-4e3b-b974-efe764247508",
        name: "Ollama Chat Model12",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [-1520, 576],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaChatModel12 = {
        model: "={{ $('Universal Config').item.json.profiles.creative_max.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.creative_max.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.creative_max.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.creative_max.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.creative_max.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.creative_max.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.creative_max.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.creative_max.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.creative_max.parameters.repeat_penalty }}"
        }
    };

    @node({
        id: "e972b20f-a53b-4f5f-b95c-6d38ab859533",
        name: "Ollama Chat Model13",
        type: "@n8n/n8n-nodes-langchain.lmChatOllama",
        version: 1,
        position: [-1920, 576],
        credentials: {ollamaApi:{id:"198xQURttLedd1Rr",name:"Ollama account"}}
    })
    OllamaChatModel13 = {
        model: "={{ $('Universal Config').item.json.profiles.light.model }}",
        options: {
            temperature: "={{ $('Universal Config').item.json.profiles.light.parameters.temperature }}",
            topK: "={{ $('Universal Config').item.json.profiles.light.parameters.top_k }}",
            topP: "={{ $('Universal Config').item.json.profiles.light.parameters.top_p }}",
            numCtx: "={{ $('Universal Config').item.json.profiles.light.parameters.context_length }}",
            numGpu: "={{ $('Universal Config').item.json.profiles.light.parameters.num_gpu }}",
            numPredict: "={{ $('Universal Config').item.json.profiles.light.parameters.num_predict }}",
            presencePenalty: "={{ $('Universal Config').item.json.profiles.light.parameters.presence_penalty }}",
            repeatPenalty: "={{ $('Universal Config').item.json.profiles.light.parameters.repeat_penalty }}"
        }
    };


    // =====================================================================
// ROUTAGE ET CONNEXIONS
// =====================================================================

    @links()
    defineRouting() {
        this.OnFormSubmission.out(0).to(this.FactionPowerTemplate.in(0));
        this.FactionPowerTemplate.out(0).to(this.LocationProfileTemplate.in(0));
        this.LocationProfileTemplate.out(0).to(this.RevelationBackstoryTemplate.in(0));
        this.RevelationBackstoryTemplate.out(0).to(this.DialogueVoiceTemplate.in(0));
        this.DialogueVoiceTemplate.out(0).to(this.ConflictArchitectureTemplate.in(0));
        this.ConflictArchitectureTemplate.out(0).to(this.GetThemesTemplate.in(0));
        this.GetThemesTemplate.out(0).to(this.GetTropeTemplate.in(0));
        this.GetTropeTemplate.out(0).to(this.GetPlotTemplate.in(0));
        this.GetPlotTemplate.out(0).to(this.GetCharacterTemplate.in(0));
        this.GetCharacterTemplate.out(0).to(this.GetCharacterEmotionTemplate.in(0));
        this.GetCharacterEmotionTemplate.out(0).to(this.GetStoryTemplate.in(0));
        this.GetStoryTemplate.out(0).to(this.GetWorldbuildingTemplate.in(0));
        this.GetWorldbuildingTemplate.out(0).to(this.GetForbiddenWordsTemplate.in(0));
        this.GetForbiddenWordsTemplate.out(0).to(this.GetBlankDossier.in(0));
        this.GetBlankDossier.out(0).to(this.ExtractSeeds.in(0));
        this.ExtractSeeds.out(0).to(this.UniversalConfig.in(0));
        this.UniversalConfig.out(0).to(this.IdentifyGenre.in(0));
        this.IdentifyGenre.out(0).to(this.PrepPitchInput.in(0));
        this.PrepPitchInput.out(0).to(this.BrainstormPitch.in(0));
        this.BrainstormPitch.out(0).to(this.PickTheBest.in(0));
        this.PickTheBest.out(0).to(this.PrepareBuilder.in(0));
        this.PrepareBuilder.out(0).to(this.BuildDossierWorld.in(0));
        this.BuildDossierWorld.out(0).to(this.PrepCharactersInput.in(0));
        this.PrepCharactersInput.out(0).to(this.BuildDossierCharacters.in(0));
        this.BuildDossierCharacters.out(0).to(this.PrepPlotInput.in(0));
        this.PrepPlotInput.out(0).to(this.BuildDossierPlotArcs.in(0));
        this.BuildDossierPlotArcs.out(0).to(this.PrepSubplotInput.in(0));
        this.PrepSubplotInput.out(0).to(this.BuildDossierSubplot.in(0));
        this.BuildDossierSubplot.out(0).to(this.PrepTropeInput.in(0));
        this.PrepTropeInput.out(0).to(this.BuildDossierTropes.in(0));
        this.BuildDossierTropes.out(0).to(this.MergeDossier.in(0));
        this.MergeDossier.out(0).to(this.PrepNameCheckInput.in(0));
        this.PrepNameCheckInput.out(0).to(this.NameCheck.in(0));
        this.NameCheck.out(0).to(this.PrepStructuralReviewInput.in(0));
        this.PrepStructuralReviewInput.out(0).to(this.StructuralReview.in(0));
        this.StructuralReview.out(0).to(this.PrepRewriteInput.in(0));
        this.PrepRewriteInput.out(0).to(this.DossierRewrite.in(0));
        this.DossierRewrite.out(0).to(this.PostProcess.in(0));
        this.PostProcess.out(0).to(this.UpdateDossierDoc.in(0));

        this.IdentifyGenre.uses({
            ai_languageModel: this.OllamaChatModel13.output
        });
        this.BrainstormPitch.uses({
            ai_languageModel: this.OllamaChatModel12.output
        });
        this.PickTheBest.uses({
            ai_languageModel: this.OllamaChatModel10.output
        });
        this.BuildDossierWorld.uses({
            ai_languageModel: this.OllamaChatModel2.output
        });
        this.BuildDossierCharacters.uses({
            ai_languageModel: this.OllamaChatModel3.output
        });
        this.BuildDossierPlotArcs.uses({
            ai_languageModel: this.OllamaChatModel4.output
        });
        this.BuildDossierSubplot.uses({
            ai_languageModel: this.OllamaChatModel5.output
        });
        this.BuildDossierTropes.uses({
            ai_languageModel: this.OllamaChatModel6.output
        });
        this.NameCheck.uses({
            ai_languageModel: this.OllamaChatModel15.output
        });
        this.StructuralReview.uses({
            ai_languageModel: this.OllamaChatModel7.output
        });
        this.DossierRewrite.uses({
            ai_languageModel: this.OllamaChatModel8.output
        });
    }
}