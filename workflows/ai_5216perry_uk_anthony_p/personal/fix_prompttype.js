// Fix: add promptType: "define" to all chainLlm nodes
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

// Count chainLlm nodes before
const chainCount = (s.match(/chainLlm/g) || []).length;
console.log('chainLlm nodes found (including comments):', chainCount);

// For each chainLlm node definition, add promptType after the closing })
// Pattern: after the @node block with chainLlm, and the property assignment line,
// we need to add promptType: "define" as the first property

// Strategy: find each `NodeName = {` after a chainLlm @node and add promptType
// The pattern is:
//     type: "@n8n/n8n-nodes-langchain.chainLlm",
//     version: 1.4,
//     position: [X, Y]
// })
// NodeName = {
//     text: `=...

// We need to insert promptType: "define", before text:
let count = 0;
s = s.replace(
    /(type:\s*"@n8n\/n8n-nodes-langchain\.chainLlm",\s*\n\s*version:\s*1\.4,\s*\n\s*position:\s*\[[^\]]+\]\s*\n\s*\}\)\s*\n\s*\w+\s*=\s*\{\s*\n)(\s*text:\s*)/g,
    (match, before, textPart) => {
        count++;
        return before + '        promptType: "define",\n' + textPart;
    }
);

console.log('Added promptType to', count, 'nodes');

// Verify
const afterCount = (s.match(/promptType:\s*"define"/g) || []).length;
console.log('Total promptType: "define" in file:', afterCount);

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('Done');
