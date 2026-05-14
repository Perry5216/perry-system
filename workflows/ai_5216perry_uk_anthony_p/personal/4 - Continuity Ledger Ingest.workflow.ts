import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : 4 - Continuity Ledger Ingest
// Nodes   : 7  |  Connections: 3
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// OnFormSubmission                   formTrigger
// ExtractContinuityFacts             agent                      [AI]
// OllamaChatModel                    lmChatOllama               [creds] [ai_languageModel]
// ParseFacts                         code
// QdrantInsert                       vectorStoreQdrant          [AI] [creds]
// EmbeddingsOllama                   embeddingsOllama           [creds] [ai_embedding]
// DefaultDataLoader                  documentDefaultDataLoader  [ai_document]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// OnFormSubmission
//    → ExtractContinuityFacts
//      → ParseFacts
//        → QdrantInsert
//
// AI CONNECTIONS
// OllamaChatModel.uses({ ai_languageModel: ExtractContinuityFacts })
// EmbeddingsOllama.uses({ ai_embedding: QdrantInsert })
// DefaultDataLoader.uses({ ai_document: [DefaultDataLoader] })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'tI8bpxno7tOMus7x',
    name: '4 - Continuity Ledger Ingest',
    active: false,
    settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
})
export class _4ContinuityLedgerIngestWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: '546f29a0-6338-4a9f-b55a-b9c6a494f496',
        name: 'On Form Submission',
        type: 'n8n-nodes-base.formTrigger',
        version: 2.2,
        position: [-600, 0],
    })
    OnFormSubmission = {
        path: 'continuity-ingest',
        formTitle: 'Continuity Ledger Ingest',
        formFields: {
            values: [
                {
                    fieldLabel: 'Book Title',
                    requiredField: true,
                },
                {
                    fieldLabel: 'Chapter Number',
                    requiredField: true,
                },
                {
                    fieldLabel: 'Chapter Text',
                    fieldType: 'textarea',
                    requiredField: true,
                },
            ],
        },
        options: {},
    };

    @node({
        id: '3f20fb7d-1c46-43ae-85f1-73994ecf01dd',
        name: 'Extract Continuity Facts',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 2.2,
        position: [-200, 0],
    })
    ExtractContinuityFacts = {
        promptType: 'define',
        text: "={{ $json['Chapter Text'] }}",
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
        id: 'b9c0d43b-560d-484f-ae27-ee7dd67fc7e9',
        name: 'Ollama Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatOllama',
        version: 1,
        position: [-200, 200],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    OllamaChatModel = {
        model: 'mistral:latest',
        options: {
            temperature: 0.3,
            numCtx: 16384,
            numPredict: 4096,
            numGpu: 99,
        },
    };

    @node({
        id: '36ad11a1-8fb0-4b8d-839e-daa40f574820',
        name: 'Parse Facts',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [200, 0],
    })
    ParseFacts = {
        jsCode: `// Parse the agent's JSON output into individual items for Qdrant insertion
const agentOutput = $('Extract Continuity Facts').first().json.output;
const chapter = $('On Form Submission').first().json['Chapter Number'];
const book = $('On Form Submission').first().json['Book Title'];

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
            text: '[' + book + ' | Chapter ' + chapter + ' | ' + (f.type || 'UNKNOWN') + ']'
                + (chars ? ' Characters: ' + chars + '.' : '')
                + (loc ? ' Location: ' + loc + '.' : '')
                + ' ' + f.fact,
        }
    };
});`,
    };

    @node({
        id: 'e228e7ec-413a-4035-a398-647108209ef9',
        name: 'Qdrant Insert',
        type: '@n8n/n8n-nodes-langchain.vectorStoreQdrant',
        version: 1.3,
        position: [600, 0],
        credentials: { qdrantApi: { id: '3', name: 'Qdrant account' } },
    })
    QdrantInsert = {
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
        id: '532ab38e-3094-407f-8f0d-70292c08579a',
        name: 'Embeddings Ollama',
        type: '@n8n/n8n-nodes-langchain.embeddingsOllama',
        version: 1,
        position: [500, 200],
        credentials: { ollamaApi: { id: '198xQURttLedd1Rr', name: 'Ollama account' } },
    })
    EmbeddingsOllama = {
        model: 'nomic-embed-text:latest',
    };

    @node({
        id: '8acbbbb0-3650-4447-b238-aee00fa52e0a',
        name: 'Default Data Loader',
        type: '@n8n/n8n-nodes-langchain.documentDefaultDataLoader',
        version: 1.1,
        position: [700, 200],
    })
    DefaultDataLoader = {
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
        this.OnFormSubmission.out(0).to(this.ExtractContinuityFacts.in(0));
        this.ExtractContinuityFacts.out(0).to(this.ParseFacts.in(0));
        this.ParseFacts.out(0).to(this.QdrantInsert.in(0));

        this.ExtractContinuityFacts.uses({
            ai_languageModel: this.OllamaChatModel.output,
        });
        this.QdrantInsert.uses({
            ai_embedding: this.EmbeddingsOllama.output,
            ai_document: [this.DefaultDataLoader.output],
        });
    }
}
