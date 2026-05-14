// ============================================================================
// DEEP AUDIT: 2 - Dossier to Full Outline workflow
// Checks: expressions, $() references, routing, data flow, prompt grounding
// ============================================================================
const fs = require('fs');
const src = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

let issues = [];
let checks = 0;

function pass(label) { checks++; }
function fail(label, detail) { checks++; issues.push(`❌ ${label}: ${detail}`); }
function warn(label, detail) { checks++; issues.push(`⚠️  ${label}: ${detail}`); }

// ============================================================================
// 1. EXPRESSION SYNTAX — validate every {{ }} expression
// ============================================================================
const exprRe = /\{\{([\s\S]*?)\}\}/g;
let m;
let exprCount = 0;
let exprErrors = [];
while (m = exprRe.exec(src)) {
    exprCount++;
    const expr = m[1].trim();
    try {
        new Function('$', 'return ' + expr);
    } catch (e) {
        exprErrors.push({ expr: expr.substring(0, 80), error: e.message });
    }
}
if (exprErrors.length === 0) pass('Expression syntax');
else exprErrors.forEach(e => fail('Expression syntax', `"${e.expr}..." → ${e.error}`));

console.log(`\n=== 1. EXPRESSION SYNTAX ===`);
console.log(`  Total expressions: ${exprCount}`);
console.log(`  Errors: ${exprErrors.length}`);

// ============================================================================
// 2. $() REFERENCES — check every $('NodeName') references a real node
// ============================================================================
console.log(`\n=== 2. NODE REFERENCE CHECK ===`);

// Extract all node names from @node decorators
const nodeNameRe = /name:\s*"([^"]+)"/g;
const declaredNodes = new Set();
let nm;
while (nm = nodeNameRe.exec(src)) {
    declaredNodes.add(nm[1]);
}
console.log(`  Declared nodes: ${declaredNodes.size}`);

// Extract all $('name') and $("name") references  
const refRe = /\$\(['"]([^'"]+)['"]\)/g;
const referencedNodes = new Set();
let refErrors = [];
let rm;
while (rm = refRe.exec(src)) {
    referencedNodes.add(rm[1]);
    if (!declaredNodes.has(rm[1])) {
        refErrors.push(rm[1]);
    }
}
console.log(`  Referenced nodes: ${referencedNodes.size}`);
if (refErrors.length === 0) pass('Node references');
else {
    const unique = [...new Set(refErrors)];
    unique.forEach(r => fail('Node reference', `$('${r}') — node not found in workflow`));
    console.log(`  Missing: ${unique.join(', ')}`);
}

// ============================================================================
// 3. ROUTING — check all this.X.out().to() connections reference real properties
// ============================================================================
console.log(`\n=== 3. ROUTING CHECK ===`);

const routeRe = /this\.(\w+)\.(out|in)\(/g;
const routeNodes = new Set();
let rr;
while (rr = routeRe.exec(src)) {
    routeNodes.add(rr[1]);
}

// Extract property names (class members)
const propRe = /^\s+(\w+)\s*=\s*\{/gm;
const classProps = new Set();
let pp;
while (pp = propRe.exec(src)) {
    classProps.add(pp[1]);
}

let routeErrors = [];
routeNodes.forEach(n => {
    if (!classProps.has(n)) {
        routeErrors.push(n);
    }
});

if (routeErrors.length === 0) pass('Routing references');
else routeErrors.forEach(r => fail('Routing', `this.${r} — property not found`));

const connectionRe = /this\.\w+\.out\(\d+\)\.to\(this\.\w+\.in\(\d+\)\)/g;
const connections = src.match(connectionRe) || [];
console.log(`  Total connections: ${connections.length}`);
console.log(`  Route reference errors: ${routeErrors.length}`);

// Check for .uses() connections (AI model assignments)
const usesRe = /this\.(\w+)\.uses\(\{[\s\S]*?ai_languageModel:\s*this\.(\w+)\.output[\s\S]*?\}\)/g;
const aiConnections = [];
let uu;
while (uu = usesRe.exec(src)) {
    aiConnections.push({ node: uu[1], model: uu[2] });
    if (!classProps.has(uu[1])) fail('AI connection', `this.${uu[1]} — not found`);
    if (!classProps.has(uu[2])) fail('AI connection', `this.${uu[2]} — not found`);
}
console.log(`  AI model connections: ${aiConnections.length}`);

// ============================================================================
// 4. DATA FLOW — verify each enrichment node receives grounding data
// ============================================================================
console.log(`\n=== 4. GROUNDING DATA FLOW ===`);

const enrichmentNodes = [
    'Outline', 'Critique Outline', 'Rewrite Outline',
    'Emotional Check', 'Science Plot Enrichment', 'Continuity Checker',
    'Scene Breakdown', 'Foreshadowing Planner', 'POV Planner',
    'Ghostwriter Brief'
];

// Find each node's prompt/text and check what it references
enrichmentNodes.forEach(nodeName => {
    // Find the node definition
    const nodeIdx = src.indexOf(`name: "${nodeName}"`);
    if (nodeIdx === -1) {
        warn('Missing node', `"${nodeName}" not found`);
        return;
    }

    // Get the text/prompt for this node (search from node definition to next @node)
    const afterNode = src.substring(nodeIdx, nodeIdx + 15000);
    const nextNode = afterNode.indexOf('\n    @node(', 100);
    const nodeBlock = nextNode > -1 ? afterNode.substring(0, nextNode) : afterNode;

    // Check for CAST MANIFEST reference
    const hasCast = nodeBlock.includes('Rewrite Characters') || nodeBlock.includes('Characters');
    // Check for WORLDBUILDING reference  
    const hasWB = nodeBlock.includes('Rewrite Worldbuilding') || nodeBlock.includes('Worldbuilding');
    // Check for FORBIDDEN WORDS reference
    const hasFW = nodeBlock.includes('forbiddenWords') || nodeBlock.includes('FORBIDDEN WORDS') || nodeBlock.includes('forbidden');
    // Check for DOSSIER reference
    const hasDossier = nodeBlock.includes('dossier') || nodeBlock.includes('DOSSIER');

    if (!hasCast && nodeName !== 'Outline') warn(`${nodeName}`, 'No CAST MANIFEST reference found');
    if (!hasFW) warn(`${nodeName}`, 'No FORBIDDEN WORDS reference found');

    const status = [
        hasCast ? '✅CAST' : '❌CAST',
        hasWB ? '✅WB' : '⬜WB',
        hasFW ? '✅FW' : '❌FW',
        hasDossier ? '✅DOS' : '⬜DOS'
    ].join(' ');

    console.log(`  ${nodeName.padEnd(25)} ${status}`);
});

// ============================================================================
// 5. OUTLINE NODE — verify it receives $json.prompt from OutlinePrompts  
// ============================================================================
console.log(`\n=== 5. OUTLINE NODE DATA FLOW ===`);
const outlineNode = src.indexOf('name: "Outline"');
if (outlineNode > -1) {
    const block = src.substring(outlineNode, outlineNode + 500);
    if (block.includes('$json.prompt')) {
        pass('Outline reads prompt');
        console.log('  ✅ Outline reads $json.prompt from OutlinePrompts');
    } else {
        fail('Outline data', 'Does not read $json.prompt');
    }
}

// Check OutlinePrompts includes character/worldbuilding/storyarc data
const opNode = src.indexOf('name: "Outline Prompts"');
if (opNode > -1) {
    const opBlock = src.substring(opNode, opNode + 6000);
    const hasCharDoc = opBlock.includes('characterDoc') || opBlock.includes('Rewrite Characters');
    const hasWBDoc = opBlock.includes('worldbuildingDoc') || opBlock.includes('Rewrite Worldbuilding');
    const hasSA = opBlock.includes('storySoFar') || opBlock.includes('Rewrite Story Arc');
    const hasFW = opBlock.includes('forbiddenWords');
    const hasDossier = opBlock.includes('dossier');

    console.log(`  OutlinePrompts injects:`);
    console.log(`    ${hasCharDoc ? '✅' : '❌'} characterDoc (CAST MANIFEST)`);
    console.log(`    ${hasWBDoc ? '✅' : '❌'} worldbuildingDoc`);
    console.log(`    ${hasSA ? '✅' : '❌'} storySoFar (Story Arc)`);
    console.log(`    ${hasFW ? '✅' : '❌'} forbiddenWords`);
    console.log(`    ${hasDossier ? '✅' : '❌'} dossier`);
}

// ============================================================================
// 6. CHAPTER SELECTOR → OUTLINEPROMPTS DATA FLOW
// ============================================================================
console.log(`\n=== 6. CHAPTER SELECTOR FLOW ===`);
const csNode = src.indexOf('"Chapter Selector"');
if (csNode > -1) {
    pass('Chapter Selector exists');
    console.log('  ✅ Chapter Selector node found');

    // Check if OutlinePrompts reads from Chapter Selector
    const opCode = src.substring(src.indexOf('name: "Outline Prompts"'), src.indexOf('name: "Outline Prompts"') + 6000);
    if (opCode.includes('Chapter Selector')) {
        pass('OutlinePrompts reads Chapter Selector');
        console.log('  ✅ OutlinePrompts references Chapter Selector');
    } else {
        fail('Data flow', 'OutlinePrompts does not read from Chapter Selector');
    }
} else {
    fail('Chapter Selector', 'Not found');
}

// ============================================================================
// 7. SENDTOOUTLINEDOC — check it uses insert (not replace)
// ============================================================================
console.log(`\n=== 7. SEND TO OUTLINE DOC ===`);
const sendIdx = src.indexOf('name: "Send to Outline Doc"');
if (sendIdx > -1) {
    const sendBlock = src.substring(sendIdx, sendIdx + 500);
    if (sendBlock.includes('"insert"') || sendBlock.includes("'insert'")) {
        pass('SendToOutlineDoc uses insert');
        console.log('  ✅ Uses "insert" action (appends)');
    } else {
        warn('SendToOutlineDoc', 'Does not use "insert" — may replace content');
    }

    if (sendBlock.includes("$('Post Process')") || sendBlock.includes("$('CleanOutlineOutput')")) {
        pass('SendToOutlineDoc reads correct source');
        console.log('  ✅ Reads from Post Process');
    }
}

// ============================================================================
// 8. MODEL PROFILE ASSIGNMENTS — verify models are mapped correctly
// ============================================================================
console.log(`\n=== 8. MODEL PROFILE ASSIGNMENTS ===`);
const profileMap = {};
const modelRe = /name:\s*"([^"]+)"[\s\S]*?model:\s*"=\{\{\s*\$\('Universal Config'\)\.item\.json\.profiles\.(\w+)\.model/g;
let mm;
while (mm = modelRe.exec(src)) {
    profileMap[mm[1]] = mm[2];
}
Object.entries(profileMap).forEach(([node, profile]) => {
    console.log(`  ${node.padEnd(25)} → ${profile}`);
});

// ============================================================================
// 9. CONTEXT LENGTH VERIFICATION
// ============================================================================
console.log(`\n=== 9. CONTEXT LENGTHS ===`);
const ctxRe = /context_length:\s*(\d+)/g;
const ctxValues = {};
let cc;
while (cc = ctxRe.exec(src)) {
    const val = cc[1];
    ctxValues[val] = (ctxValues[val] || 0) + 1;
}
Object.entries(ctxValues).forEach(([val, count]) => {
    const status = parseInt(val) >= 16384 ? '✅' : '⚠️';
    console.log(`  ${status} context_length: ${val} (${count} profiles)`);
});

// ============================================================================
// 10. CRITIQUE NODE CAST INTEGRITY CHECKS
// ============================================================================
console.log(`\n=== 10. CRITIQUE CAST INTEGRITY ===`);
const critiqueNodes = ['Critique Characters', 'Critique Story Arc', 'Critique Worldbuilding', 'Critique Outline'];
critiqueNodes.forEach(cn => {
    const idx = src.indexOf(`name: "${cn}"`);
    if (idx === -1) { warn(cn, 'Not found'); return; }
    const block = src.substring(idx, idx + 8000);
    const nextN = block.indexOf('\n    @node(', 100);
    const nodeBlock = nextN > -1 ? block.substring(0, nextN) : block;

    const hasCastCheck = nodeBlock.includes('CAST INTEGRITY CHECK') || nodeBlock.includes('cast integrity');
    console.log(`  ${hasCastCheck ? '✅' : '❌'} ${cn}: ${hasCastCheck ? 'Has CAST INTEGRITY CHECK' : 'MISSING CAST INTEGRITY CHECK'}`);
    if (!hasCastCheck) fail(cn, 'Missing CAST INTEGRITY CHECK');
});

// ============================================================================
// 11. FORBIDDEN WORDS — verify loaded in Extract Seeds and passed to nodes
// ============================================================================
console.log(`\n=== 11. FORBIDDEN WORDS FLOW ===`);
const esIdx = src.indexOf('name: "Extract Seeds"');
if (esIdx > -1) {
    const esBlock = src.substring(esIdx, esIdx + 5000);
    const hasFW = esBlock.includes('forbiddenWords') || esBlock.includes('Forbidden Words');
    console.log(`  ${hasFW ? '✅' : '❌'} Extract Seeds: ${hasFW ? 'Loads forbidden words' : 'DOES NOT load forbidden words'}`);
}
// Check Universal Config for forbidden words
const ucIdx = src.indexOf('name: "Universal Config"');
if (ucIdx > -1) {
    const ucBlock = src.substring(ucIdx, ucIdx + 10000);
    const hasFW = ucBlock.includes('forbiddenWords') || ucBlock.includes('forbidden');
    console.log(`  ${hasFW ? '✅' : '❌'} Universal Config: ${hasFW ? 'References forbidden words' : 'DOES NOT reference forbidden words'}`);
}

// ============================================================================
// 12. ORPHAN NODE CHECK — every node should be in at least one routing connection
// ============================================================================
console.log(`\n=== 12. ORPHAN NODE CHECK ===`);
const routingSection = src.substring(src.indexOf('defineRouting()'));
const routedNodes = new Set();
const routeNodeRe = /this\.(\w+)\./g;
let rn;
while (rn = routeNodeRe.exec(routingSection)) {
    routedNodes.add(rn[1]);
}

// Get all class property names that are nodes (have @node decorator before them)
const nodeProps = new Set();
const nodePropRe = /@node\(\{[\s\S]*?\}\)\s*(\w+)\s*=/g;
let np;
while (np = nodePropRe.exec(src)) {
    nodeProps.add(np[1]);
}

// Ollama models connect via .uses(), not .out/.in
const ollamaProps = new Set();
const ollamaRe = /this\.(\w+)\.output/g;
let ol;
while (ol = ollamaRe.exec(routingSection)) {
    ollamaProps.add(ol[1]);
}

let orphans = [];
nodeProps.forEach(p => {
    if (!routedNodes.has(p) && !ollamaProps.has(p) && !p.includes('OllamaChat')) {
        orphans.push(p);
    }
});

if (orphans.length === 0) {
    console.log('  ✅ No orphan nodes');
} else {
    orphans.forEach(o => {
        warn('Orphan node', `${o} is not in any routing connection`);
        console.log(`  ⚠️  ${o}: Not in routing`);
    });
}

// ============================================================================
// SUMMARY
// ============================================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`AUDIT COMPLETE`);
console.log(`  Checks: ${checks}`);
console.log(`  Issues: ${issues.length}`);
if (issues.length > 0) {
    console.log(`\nISSUES:`);
    issues.forEach(i => console.log(`  ${i}`));
}
console.log('='.repeat(60));
