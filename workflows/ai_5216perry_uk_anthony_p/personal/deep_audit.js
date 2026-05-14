// Deep audit: extract every {{ }} expression from every chainLlm node,
// validate it as JavaScript, and report exact failures
const fs = require('fs');
const vm = require('vm');
const s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

const nodeBlocks = s.split('@node({');

for (let i = 1; i < nodeBlocks.length; i++) {
    const block = nodeBlocks[i];
    if (!block.includes('chainLlm')) continue;

    const nameMatch = block.match(/name:\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : `UNKNOWN_${i}`;

    // Get the text content
    const textMatch = block.match(/text:\s*[`"](=?)([\s\S]*?)[`"]\s*\n\s*\};/);
    if (!textMatch) {
        if (name !== 'Outline') console.log(`[${name}] SKIP: Could not extract text field`);
        continue;
    }

    const fullText = textMatch[2];

    // Check 1: Unbalanced {{ and }}  
    const openCount = (fullText.match(/\{\{/g) || []).length;
    const closeCount = (fullText.match(/\}\}/g) || []).length;
    if (openCount !== closeCount) {
        console.log(`[${name}] CRITICAL: Unbalanced {{ }} — ${openCount} opens vs ${closeCount} closes`);
    }

    // Check 2: Single { or } between expression blocks (could confuse parser)
    const stripped = fullText.replace(/\{\{[\s\S]*?\}\}/g, '@@EXPR@@');
    const singleOpen = (stripped.match(/(?<!\{)\{(?!\{)/g) || []).length;
    const singleClose = (stripped.match(/(?<!\})\}(?!\})/g) || []).length;
    if (singleOpen > 0 || singleClose > 0) {
        console.log(`[${name}] WARNING: Bare braces OUTSIDE expressions: ${singleOpen} { and ${singleClose} }`);
        // Find the exact locations
        const lines = stripped.split('\n');
        lines.forEach((line, idx) => {
            if (line.match(/(?<!\{)\{(?!\{)/) || line.match(/(?<!\})\}(?!\})/)) {
                const origLine = fullText.split('\n')[idx];
                if (origLine && !origLine.match(/\{\{/)) {
                    console.log(`  Line ${idx + 1}: ${origLine.trim().substring(0, 100)}`);
                }
            }
        });
    }

    // Check 3: Each expression validates as JavaScript
    const exprRegex = /\{\{([\s\S]*?)\}\}/g;
    let match;
    let exprIdx = 0;
    while ((match = exprRegex.exec(fullText)) !== null) {
        exprIdx++;
        const expr = match[1].trim();
        try {
            // Try to parse as JS (won't execute, just syntax check)
            new Function('$', 'return ' + expr);
        } catch (e) {
            console.log(`[${name}] SYNTAX ERROR in expression #${exprIdx}: ${e.message}`);
            console.log(`  Expression: ${expr.substring(0, 120)}`);
        }
    }
}

console.log('\nDone');
