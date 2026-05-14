// Audit forbidden words / entity names coverage across all 19 chainLlm nodes
const fs = require('fs');
const s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

const nodeBlocks = s.split('@node({');
const results = [];

for (let i = 1; i < nodeBlocks.length; i++) {
    const block = nodeBlocks[i];
    if (!block.includes('chainLlm')) continue;

    const nameMatch = block.match(/name:\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : `UNKNOWN_${i}`;

    // Get text content (could be inline or dynamic via $json.prompt)
    const isDynamic = block.includes('$json.prompt');

    // Check for FORBIDDEN WORDS header (data section)
    const hasFWHeader = block.includes('FORBIDDEN WORDS:') || block.includes('FORBIDDEN WORDS');

    // Check for forbiddenWords expression
    const hasFWExpr = block.includes('forbiddenWords');

    // Check for enforcement instructions (various wordings)
    const hasFWEnforce = block.includes('FORBIDDEN WORDS') && (
        block.includes('Scan word-by-word') ||
        block.includes('Do not use any word') ||
        block.includes('Never use any word') ||
        block.includes('Prose Jail')
    );

    // Check for ENTITY_NAMES
    const hasEntity = block.includes('ENTITY_NAMES');

    // Check for prose_jail from Universal Config
    const hasProseJail = block.includes('prose_jail');

    // Determine if this node SHOULD have forbidden words
    // All content-generating nodes should have them
    const isGenNode = !name.startsWith('Critique'); // Critiques mainly flag, not generate

    results.push({
        name,
        isDynamic,
        hasFWHeader,
        hasFWExpr,
        hasFWEnforce,
        hasEntity,
        hasProseJail,
        issues: []
    });

    const r = results[results.length - 1];

    if (isDynamic) {
        r.issues.push('Dynamic prompt ($json.prompt) — check OutlinePrompts code node');
    } else {
        if (!hasFWHeader) r.issues.push('MISSING: FORBIDDEN WORDS: data header');
        if (!hasFWExpr) r.issues.push('MISSING: forbiddenWords expression');
        if (!hasFWEnforce) r.issues.push('MISSING: Enforcement instruction (scan/do not use)');
        if (!hasProseJail) r.issues.push('MISSING: prose_jail reference');
    }
}

// Print results
console.log('FORBIDDEN WORDS / ENTITY NAMES AUDIT');
console.log('=====================================\n');

let allGood = true;
results.forEach(r => {
    const status = r.issues.length === 0 ? '✅' : '❌';
    if (r.issues.length > 0) allGood = false;
    console.log(`${status} ${r.name}`);
    console.log(`   FW Header: ${r.hasFWHeader ? 'YES' : 'NO'} | FW Expr: ${r.hasFWExpr ? 'YES' : 'NO'} | Enforce: ${r.hasFWEnforce ? 'YES' : 'NO'} | Entity: ${r.hasEntity ? 'YES' : 'NO'} | ProseJail: ${r.hasProseJail ? 'YES' : 'NO'}`);
    if (r.issues.length > 0) {
        r.issues.forEach(issue => console.log(`   ⚠ ${issue}`));
    }
    console.log('');
});

if (allGood) {
    console.log('All nodes verified ✅');
} else {
    console.log('Issues found — see above');
}

// Also check the Outline Prompts code node
console.log('\n--- OUTLINE PROMPTS CODE NODE ---');
const opIdx = s.indexOf('name: "Outline Prompts"');
if (opIdx > -1) {
    const opBlock = s.substring(opIdx, opIdx + 10000);
    console.log('  Has forbiddenWords:', opBlock.includes('forbiddenWords'));
    console.log('  Has prose_jail:', opBlock.includes('prose_jail') || opBlock.includes('proseJail'));
    console.log('  Has FORBIDDEN WORDS:', opBlock.includes('FORBIDDEN WORDS'));
    console.log('  Has ENTITY_NAMES:', opBlock.includes('ENTITY_NAMES') || opBlock.includes('entityNames'));
}

// Check Extract Seeds for forbidden words output
console.log('\n--- EXTRACT SEEDS ---');
const esIdx = s.indexOf('name: "Extract Seeds"');
if (esIdx > -1) {
    const esBlock = s.substring(esIdx, esIdx + 5000);
    console.log('  Outputs forbiddenWords:', esBlock.includes('forbiddenWords'));
    console.log('  Outputs entityNames:', esBlock.includes('entityNames'));
}
