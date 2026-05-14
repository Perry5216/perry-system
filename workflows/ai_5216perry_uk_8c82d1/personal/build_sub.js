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

const lines = fileContent.split('\n');
const nodes = [];

let insideNode = false;
let currentNodeLines = [];
let currentNodeName = "";
let currentNodeVar = "";

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '@node({') {
        insideNode = true;
        currentNodeLines = [line];
        currentNodeName = "";
        currentNodeVar = "";
        continue;
    }

    if (insideNode) {
        currentNodeLines.push(line);

        const nameMatch = line.match(/\bname:\s*["']([^"']+)["']/);
        if (nameMatch && !currentNodeName) {
            currentNodeName = nameMatch[1];
        }

        if (line.match(/^\s+[A-Za-z0-9_]+\s*=\s*\{\s*$/) || line.match(/^\s+[A-Za-z0-9_]+\s*=\s*.*\[$/)) {
            currentNodeVar = line.trim().split(' ')[0];
        }

        if (line === '    };' || line === '    };\r') {
            insideNode = false;
            nodes.push({
                name: currentNodeName,
                varName: currentNodeVar,
                content: currentNodeLines.join('\n')
            });
        }
    }
}

const targetNodes = [];
const targetVars = [];

for (const name of wf2aNodeNames) {
    const found = nodes.find(n => n.name === name);
    if (found) {
        targetNodes.push(found.content);
        targetVars.push(found.varName);
    } else {
        console.warn('WARNING: Node not found ->', name);
    }
}

const routingStart = fileContent.indexOf('defineRouting() {');
const routingEnd = fileContent.indexOf('}', routingStart);
const routingBlock = fileContent.substring(routingStart, fileContent.length);

const allMatches = routingBlock.match(/this\.[A-Za-z0-9_]+\.out.*?;/g) || [];
const allUses = routingBlock.match(/this\.[A-Za-z0-9_]+\.uses\(\{([^}]+)\}\);/gs) || [];

const routingLines = [];
for (const flow of allMatches) {
    const mentionsTarget = targetVars.some(v => flow.includes(`this.${v}`));
    if (mentionsTarget) {
        let allValid = true;
        const parts = flow.match(/this\.([A-Za-z0-9_]+)/g);
        if (parts) {
            for (const p of parts) {
                const varName = p.replace('this.', '');
                if (!targetVars.includes(varName)) {
                    allValid = false;
                }
            }
        }
        if (allValid) routingLines.push("        " + flow);
    }
}

for (const use of allUses) {
    const mentionsTarget = targetVars.some(v => use.includes(`this.${v}`));
    if (mentionsTarget) {
        routingLines.push("        " + use.split('\n').join('\n        '));
    }
}

const wf2aSource = `import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: "sub-workflow-outline-gen",
    name: "Sub-Workflow - Outline Generation",
    active: false,
    settings: { executionOrder: "v1", callerPolicy: "workflowsFromSameOwner", availableInMCP: false }
})
export class SubWorkflowOutlineGeneration {
${targetNodes.join('\n\n')}

    @links()
    defineRouting() {
${routingLines.join('\n')}
    }
}
`;

fs.writeFileSync('Sub-Workflow - Outline Generation.workflow.ts', wf2aSource, 'utf8');
console.log('✅ Generated Sub-Workflow - Outline Generation.workflow.ts');
