const fs = require('fs');
const s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

// Verify all chainLlm nodes have promptType
const nodes = s.split('@node({');
let llmCount = 0;
let ptCount = 0;
let issues = [];

for (let i = 1; i < nodes.length; i++) {
    const block = nodes[i];
    if (!block.includes('chainLlm')) continue;
    llmCount++;

    // Get node name
    const nameMatch = block.match(/name:\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : 'UNKNOWN';

    // Check for promptType
    const hasPromptType = block.includes('promptType');
    // Check for text field
    const hasText = block.includes('text:');

    if (hasPromptType) ptCount++;

    if (!hasPromptType || !hasText) {
        issues.push(`${name}: promptType=${hasPromptType} text=${hasText}`);
    } else {
        console.log(`OK: ${name}`);
    }
}

console.log(`\nTotal chainLlm nodes: ${llmCount}`);
console.log(`Nodes with promptType: ${ptCount}`);
console.log(`Issues: ${issues.length}`);
issues.forEach(i => console.log('  ISSUE:', i));
