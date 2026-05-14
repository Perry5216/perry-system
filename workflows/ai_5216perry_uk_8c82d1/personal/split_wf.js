const fs = require('fs');

const fileContent = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

const wf2aNodeNames = [
    "Chapter Selector",
    "Outline Prompts",
    "Outline",
    "Critique Outline",
    "Rewrite Outline",
    "Emotional Check",
    "Science Plot Enrichment",
    "Continuity Checker",
    "Scene Breakdown",
    "Foreshadowing Planner",
    "POV Planner",
    "Ghostwriter Brief",
    "Clean Outline Output",
    "Post Process",
    "Send to Outline Doc",
    "Get BLANK Outline Doc", // Required for Send to Outline Doc
    "Ollama Chat Model9",
    "Ollama Chat Model10",
    "Ollama Chat Model11",
    "Ollama Chat Model13",
    "Ollama Chat Model14",
    "Ollama Chat Model12",
    "Ollama Chat Model15",
    "Ollama Chat Model16",
    "Ollama Chat Model17",
    "Ollama Chat Model18"
];

// Helper to grab a node's full definition string from the source file
function extractNodeDecl(name) {
    const nameStr = `name: "${name}"`;
    const idx = fileContent.indexOf(nameStr);
    if (idx === -1) return null;

    // Find preceding @node
    const startIdx = fileContent.lastIndexOf('@node', idx);
    if (startIdx === -1) return null;

    // Find next @node or @links
    let endIdx = fileContent.indexOf('@node', startIdx + 10);
    const linkIdx = fileContent.indexOf('@links', startIdx + 10);
    if (endIdx === -1) endIdx = linkIdx;
    else if (linkIdx !== -1 && linkIdx < endIdx) endIdx = linkIdx;

    if (endIdx === -1) endIdx = fileContent.length - 2; // Before the last }

    return fileContent.substring(startIdx, endIdx).trim();
}

// 1. Extract all nodes
const wf2aNodesStr = [];
const wf2aNodesNamesSet = new Set(wf2aNodeNames.map(n => n.replace(/[^a-zA-Z0-9]/g, '')));

// Map of names to property names, e.g. 'Outline Prompts' -> 'OutlinePrompts'
const dict = {};
for (const n of wf2aNodeNames) {
    const decl = extractNodeDecl(n);
    if (decl) {
        wf2aNodesStr.push(decl);
        const propMatch = decl.match(/\]\s*}\)\s*([A-Za-z0-9_]+)\s*=/);
        if (propMatch) {
            dict[n] = propMatch[1];
        }
    }
}

// Extract links from defineRouting()
const routingStart = fileContent.indexOf('defineRouting() {');
const routingEnd = fileContent.indexOf('}', routingStart);
const routingBlock = fileContent.substring(routingStart + 17, routingEnd);

const wf2aRouting = [];
const wf2Routing = [];
const lines = routingBlock.split('\\n');

const propNamesIn2a = Object.values(dict);

for (const line of lines) {
    if (!line.trim()) continue;
    let keepIn2a = false;
    // If the line references ANY node in 2a, we evaluate it
    for (const prop of propNamesIn2a) {
        if (line.includes(`this.${prop}.`)) {
            keepIn2a = true;
            break;
        }
    }

    if (keepIn2a) {
        // Special case: `this.SendToWorldbuildingDoc.out(0).to(this.ChapterSelector.in(0));`
        // Should NOT go into 2a because SendToWorldbuildingDoc isn't going to be in 2a
        if (line.includes('SendToWorldbuildingDoc') && line.includes('ChapterSelector')) {
            // Delete this link from both, they are split
            continue;
        } else if (line.includes('GetBlankWorldbuildingDoc') && line.includes('GetBlankOutlineDoc')) {
            // "this.GetBlankWorldbuildingDoc.out(0).to(this.GetBlankOutlineDoc.in(0));"
            continue;
        } else if (line.includes('GetBlankOutlineDoc') && line.includes('ExtractSeeds')) {
            // "this.GetBlankOutlineDoc.out(0).to(this.ExtractSeeds.in(0));"
            // Keep ExtractSeeds connection in WF2 but without OutlineDoc
            wf2Routing.push('        this.GetBlankWorldbuildingDoc.out(0).to(this.ExtractSeeds.in(0)); // Rewired during split');
            continue;
        }
        wf2aRouting.push(line);
    } else {
        wf2Routing.push(line);
    }
}

// Construct WF2a file
const wf2aSource = `import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: "WF2a-Outline-Gen",
    name: "2.a - Outline Generation",
    active: false,
    settings: { executionOrder: "v1", callerPolicy: "workflowsFromSameOwner", availableInMCP: false }
})
export class _2AOutlineGenerationWorkflow {
    ${wf2aNodesStr.join('\\n\\n    ')}

    @links()
    defineRouting() {
${wf2aRouting.join('\\n')}
    }
}
`;

fs.writeFileSync('2.a - Outline Generation.workflow.ts', wf2aSource, 'utf8');

// Construct WF2 file (by removing WF2a nodes)
let remainingWf2 = fileContent;
for (const decl of wf2aNodesStr) {
    remainingWf2 = remainingWf2.replace(decl, '');
}
// Replace the old routing block with the new wf2Routing
remainingWf2 = remainingWf2.replace(routingBlock, '\\n' + wf2Routing.join('\\n') + '\\n    ');

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', remainingWf2, 'utf8');

console.log('✅ Successfully separated Workflow 2 into two files: 2 and 2.a');
