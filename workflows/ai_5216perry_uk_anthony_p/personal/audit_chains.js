// Comprehensive audit of all 19 chainLlm nodes
const fs = require('fs');
const s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

const nodeBlocks = s.split('@node({');
const issues = [];
let chainCount = 0;

for (let i = 1; i < nodeBlocks.length; i++) {
    const block = nodeBlocks[i];
    if (!block.includes('chainLlm')) continue;
    chainCount++;

    const nameMatch = block.match(/name:\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : `UNKNOWN_${i}`;

    // Check 1: promptType: "define"
    const hasPT = block.includes('promptType');
    if (!hasPT) issues.push(`[${name}] CRITICAL: Missing promptType: "define"`);

    // Check 2: text field exists and starts with =
    const hasText = block.includes('text:');
    if (!hasText) {
        issues.push(`[${name}] CRITICAL: Missing text field (no prompt)`);
    } else {
        // Check text starts with `=
        const textStart = block.match(/text:\s*`(.*)/);
        if (textStart && !textStart[1].startsWith('=')) {
            issues.push(`[${name}] CRITICAL: text field missing = prefix for expression evaluation`);
        }
    }

    // Check 3: Unescaped backticks inside text (would break the template)
    const textMatch = block.match(/text:\s*`([\s\S]*?)`\s*\n\s*\};/);
    if (textMatch) {
        const textContent = textMatch[1];
        // Look for bare backticks (not escaped)
        const bareBackticks = textContent.match(/(?<!\\)`/g);
        if (bareBackticks && bareBackticks.length > 0) {
            issues.push(`[${name}] WARNING: ${bareBackticks.length} unescaped backtick(s) inside text template`);
        }
    }

    // Check 4: Corrupted Unicode
    if (block.includes('Ã')) {
        issues.push(`[${name}] WARNING: Corrupted Unicode characters found`);
    }

    // Check 5: Residual XML tags in prompt (not bracketed)
    const xmlMatches = block.match(/<(?!\/)[a-z_][a-z_]*>/gi);
    if (xmlMatches) {
        const filtered = xmlMatches.filter(t =>
            !t.match(/<\/?valid_values>/i) && // benign in ExtractSeeds
            !t.match(/<br>/i) // html
        );
        if (filtered.length > 0) {
            issues.push(`[${name}] WARNING: Residual XML tags: ${filtered.slice(0, 5).join(', ')}`);
        }
    }

    // Check 6: Missing NEGATIVE CONSTRAINTS
    const hasNC = block.includes('NEGATIVE CONSTRAINTS');
    if (!hasNC) issues.push(`[${name}] WARNING: Missing NEGATIVE CONSTRAINTS block`);

    // Check 7: Expression syntax {{ }}
    const exprMatches = block.match(/\{\{[^}]*$/gm);
    if (exprMatches) {
        issues.push(`[${name}] WARNING: Possibly unclosed expression {{ }}`);
    }

    // Check 8: References to .json.output (should be .json.text now)
    if (block.includes('.json.output')) {
        issues.push(`[${name}] WARNING: References .json.output (should be .json.text)`);
    }

    // Check 9: EMOTION SYSTEM COMPLIANCE
    const needsEmotion = ['Emotional Check', 'POV Planner', 'Science Plot Enrichment',
        'Characters', 'Critique Characters', 'Rewrite Characters'];
    if (needsEmotion.includes(name)) {
        const hasEmotion = block.includes('EMOTION SYSTEM COMPLIANCE');
        if (!hasEmotion) issues.push(`[${name}] WARNING: Missing EMOTION SYSTEM COMPLIANCE block`);
    }

    console.log(`✓ ${name}`);
}

console.log(`\nAudited ${chainCount} chainLlm nodes`);
console.log(`Found ${issues.length} issue(s):\n`);
issues.forEach(i => console.log('  ▸', i));
