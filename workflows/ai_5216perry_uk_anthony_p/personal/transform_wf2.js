/**
 * transform_wf2.js — One-shot combined rebuild + improvement script
 * 
 * Run on a FRESH copy of "2 - Dossier to Full Outline.workflow.ts"
 * 
 * SAFETY RULES:
 * - XML replacement only inside backtick template strings
 * - NEVER insert backtick characters into template literal segments
 * - Dossier key refs use [brackets] not backticks
 * - Pre/post-flight integrity checks
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '2 - Dossier to Full Outline.workflow.ts');
let src = fs.readFileSync(FILE, 'utf8');

// ── PRE-FLIGHT ──────────────────────────────────────────────────────────────
const pre = {
    agentCount: (src.match(/langchain\.agent/g) || []).length,
    hasCleanOutline: src.includes('CleanOutlineOutput'),
    hasSendOutline: src.includes('SendToOutlineDoc'),
    lines: src.split('\n').length,
};
console.log('PRE-FLIGHT:', JSON.stringify(pre));
if (!pre.hasCleanOutline || !pre.hasSendOutline) throw new Error('ABORT: integrity check');
if (pre.agentCount === 0) throw new Error('ABORT: file already transformed (0 agents)');

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: REBUILD (agent → chainLlm)
// ═══════════════════════════════════════════════════════════════════════════

// 1a. Agent type → chainLlm (both quote styles)
src = src.replace(/type:\s*"@n8n\/n8n-nodes-langchain\.agent"/g,
    'type: "@n8n/n8n-nodes-langchain.chainLlm"');
src = src.replace(/type:\s*'@n8n\/n8n-nodes-langchain\.agent'/g,
    "type: '@n8n/n8n-nodes-langchain.chainLlm'");

// 1b. Version 2.2 → 1.4 (only after chainLlm type)
src = src.replace(
    /(type:\s*["']@n8n\/n8n-nodes-langchain\.chainLlm["'],\s*\n\s*)version:\s*2\.2,/g,
    '$1version: 1.4,'
);

// 1c. Remove promptType: 'define'
src = src.replace(/\s*promptType:\s*['"]define['"],?\s*\n/g, '\n');

// 1d. Remove options: { systemMessage: ... } blocks
src = src.replace(
    /,?\s*options:\s*\{\s*\n?\s*systemMessage:\s*\n?\s*['"](?:[^'"\\]|\\.)*['"],?\s*\n?\s*\},?/g, ','
);

console.log('PHASE 1: agent → chainLlm complete');

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: FIX CORRUPTED UTF-8
// ═══════════════════════════════════════════════════════════════════════════
src = src.replace(/Ã¢â‚¬â€/g, '—');
src = src.replace(/Ã¢â‚¬â€œ/g, '–');
src = src.replace(/Ã¢â‚¬â„¢/g, "'");
src = src.replace(/Ã¢â‚¬Å"/g, '"');
src = src.replace(/Ã¢â‚¬Â/g, '"');
src = src.replace(/Ã‚Â§/g, '§');
src = src.replace(/ÃƒÂ©/g, 'é');
src = src.replace(/Ã‚Â/g, '');

console.log('PHASE 2: UTF-8 corruption repaired');

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: XML TAGS → PLAIN TEXT (backtick-scoped, NO backtick insertions)
// ═══════════════════════════════════════════════════════════════════════════

// Section headers
const sectionXml = {
    'context_variables': 'CONTEXT',
    'context': 'CONTEXT',
    'forbidden_words': 'FORBIDDEN WORDS',
    'dossier_source': 'DOSSIER SOURCE',
    'cast_manifest': 'CAST MANIFEST',
    'story_arc': 'STORY ARC',
    'story_arc_source': 'STORY ARC SOURCE',
    'worldbuilding_sheet': 'WORLDBUILDING',
    'worldbuilding': 'WORLDBUILDING',
    'worldbuilding_template': 'WORLDBUILDING TEMPLATE',
    'character_template': 'CHARACTER TEMPLATE',
    'character_emotion_template': 'CHARACTER EMOTION TEMPLATE',
    'genre_tropes': 'GENRE TROPES',
    'plot_template': 'PLOT TEMPLATE',
    'world_template': 'WORLD TEMPLATE',
    'voice_doctrine': 'VOICE DOCTRINE',
    'conflict_doctrine': 'CONFLICT DOCTRINE',
    'backstory_doctrine': 'BACKSTORY DOCTRINE',
    'faction_doctrine': 'FACTION DOCTRINE',
    'location_doctrine': 'LOCATION DOCTRINE',
    'author_notes': 'AUTHOR NOTES',
    'profile_instruction': 'PROFILE INSTRUCTION',
    'instructions': 'INSTRUCTIONS',
    'emotion_system_guardrails': 'EMOTION SYSTEM GUARDRAILS',
    'original_character_sheet': 'ORIGINAL CHARACTER SHEET',
    'improvement_plan': 'IMPROVEMENT PLAN',
    'character_sheet': 'CHARACTER SHEET',
    'current_outline': 'CURRENT OUTLINE',
    'revised_outline': 'REVISED OUTLINE',
    'original_outline': 'ORIGINAL OUTLINE',
    'original_worldbuilding_sheet': 'ORIGINAL WORLDBUILDING',
    'original_story_arc_sheet': 'ORIGINAL STORY ARC',
    'current_story_arc': 'CURRENT STORY ARC',
    'continuity_checked_outline': 'CONTINUITY CHECKED OUTLINE',
    'scene_breakdown': 'SCENE BREAKDOWN',
    'foreshadowing_plan': 'FORESHADOWING PLAN',
    'pov_voice_plan': 'POV VOICE PLAN',
    'emotional_analysis': 'EMOTIONAL ANALYSIS',
    'science_toolbox': 'SCIENCE TOOLBOX',
    'locked_characters': 'LOCKED CHARACTERS',
    'locked_profiles': 'LOCKED PROFILES',
    'extracted_constraints': 'EXTRACTED CONSTRAINTS',
    'clifton_strengths_reference': 'CLIFTON STRENGTHS REFERENCE',
    'dialogue_slot_guide': 'DIALOGUE SLOT GUIDE',
    'input_logic': 'INPUT LOGIC',
    'system_constraints': 'SYSTEM CONSTRAINTS',
    'prose_jail': 'PROSE JAIL',
    'world_context': 'WORLD CONTEXT',
    'doctrine_templates': 'DOCTRINE TEMPLATES',
    'narrative_spine': 'NARRATIVE SPINE',
    'task_constraints': 'TASK CONSTRAINTS',
    'total_chapters': 'TOTAL CHAPTERS',
    'target_chapters': 'TARGET CHAPTERS',
    'target_length': 'TARGET LENGTH',
    'story_so_far': 'STORY SO FAR',
    'plot_logic': 'PLOT LOGIC',
    'characters': 'CHARACTERS',
};

// Dossier key references — replace with [KEY] format (safe inside backticks)
const dossierKeys = [
    'economy', 'tech_magic', 'systemic_friction', 'arc_seed', 'world_seed',
    'core_wound', 'character_seed', 'world_arcs', 'everyday_texture',
    'built_environments',
];

function transformPromptSegment(str) {
    let result = str;
    // Section headers
    for (const [tag, heading] of Object.entries(sectionXml)) {
        result = result.replace(new RegExp(`<${tag}>\\s*`, 'g'), `${heading}:\n`);
        result = result.replace(new RegExp(`</${tag}>\\s*`, 'g'), '\n');
    }
    // Dossier keys — use [KEY] format (safe in template literals)
    for (const key of dossierKeys) {
        result = result.replace(new RegExp(`<${key}>`, 'g'), `[${key}]`);
        result = result.replace(new RegExp(`</${key}>`, 'g'), '');
    }
    return result;
}

// Apply only inside backtick template strings (odd-indexed segments)
const parts = src.split('`');
for (let i = 1; i < parts.length; i += 2) {
    if (parts[i].match(/<[a-z_]+>/)) {
        parts[i] = transformPromptSegment(parts[i]);
    }
}
src = parts.join('`');

// Also fix backtick-escaped XML in CritiqueStoryArc: \`<tag>\` → [tag]
src = src.replace(/\\`<([a-z_]+)>\\`/g, '[$1]');

console.log('PHASE 3: XML tags converted');

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: FIX OUTPUT FIELD REFERENCES (.output → .text)
// ═══════════════════════════════════════════════════════════════════════════
const llmNodes = [
    'Characters', 'Rewrite Characters', 'Critique Characters',
    'Story Arc', 'Rewrite Story Arc', 'Critique Story Arc',
    'Worldbuilding', 'Rewrite Worldbuilding', 'Critique Worldbuilding',
    'Outline', 'Rewrite Outline', 'Critique Outline',
    'Emotional Check', 'Science Plot Enrichment', 'Continuity Checker',
    'Scene Breakdown', 'Foreshadowing Planner', 'POV Planner',
    'Ghostwriter Brief'
];

for (const name of llmNodes) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    src = src.replace(
        new RegExp(`\\$\\(["']${esc}["']\\)\\.first\\(\\)\\?\\.json\\?\\.output`, 'g'),
        `$('${name}').first()?.json?.text`
    );
    src = src.replace(
        new RegExp(`\\$\\(["']${esc}["']\\)\\.first\\(\\)\\.json\\.output`, 'g'),
        `$('${name}').first().json.text`
    );
    src = src.replace(
        new RegExp(`\\$\\(["']${esc}["']\\)\\.item\\.json\\.output`, 'g'),
        `$('${name}').item.json.text`
    );
}

// Fix CleanOutlineOutput to check .text first
src = src.replace(
    "const raw = $input.first().json.output || '';",
    "const raw = $input.first().json.text || $input.first().json.output || '';"
);
src = src.replace(
    'const raw = $input.first().json.output || "";',
    'const raw = $input.first().json.text || $input.first().json.output || "";'
);

console.log('PHASE 4: Output field references fixed');

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: FIX ROLE LINES + XML REFERENCES IN INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════════════════
src = src.replace(
    'expand the world-logic for a single novel based on structured XML data',
    'expand the world-logic for a single novel based on structured dossier data'
);
src = src.replace(
    'synthesize the provided XML data into a unified narrative arc',
    'synthesize the provided dossier data into a unified narrative arc'
);
src = src.replace(/exact XML tags from the dossier/g, 'exact keys from the dossier');
src = src.replace(/exact XML tags/g, 'exact dossier keys');
src = src.replace(/Reference specific XML tags/g, 'Reference specific keys');
src = src.replace(/Do not reference XML tags outside/g, 'Do not reference tags outside');
src = src.replace(/Do not use any XML tag not in/g, 'Do not use any tag not in');

console.log('PHASE 5: XML references in instructions fixed');

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: ADD ANTI-CONSTRAINTS + NEGATIVE CONSTRAINTS
// ═══════════════════════════════════════════════════════════════════════════
const antiBlock = `\nNEGATIVE CONSTRAINTS:\n- DO NOT reproduce input data verbatim. Synthesize and transform.\n- DO NOT invent sections not in the instructions above.\n- DO NOT add marketing plans, adaptation pitches, or unsolicited content.\n- DO NOT use any language other than English. Standard Latin script only.\n`;

const parts2 = src.split('`');
for (let i = 1; i < parts2.length; i += 2) {
    if (parts2[i].includes('Hard Constraints:') && !parts2[i].includes('NEGATIVE CONSTRAINTS')) {
        parts2[i] = parts2[i].replace(/(\nHard Constraints:)/g, antiBlock + '\n$1');
    }
}
src = parts2.join('`');

console.log('PHASE 6: Anti-constraints added');

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: ADD MISSING EMOTION SYSTEM COMPLIANCE BLOCKS
// ═══════════════════════════════════════════════════════════════════════════
const emotionCompliance = `\n- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS. Do NOT invent stat names, emotion names, or voice registers not listed there.\n`;

// Function to add compliance to a specific node's Hard Constraints if missing
function addComplianceAfterDoctrineBlock(nodeName) {
    const nodeIdx = src.indexOf(`name: "${nodeName}"`);
    if (nodeIdx === -1) { console.log(`  SKIP: ${nodeName} not found`); return; }
    // Check if this node's section already has EMOTION SYSTEM COMPLIANCE
    const nextNode = src.indexOf('@node({', nodeIdx + 100);
    const nodeSection = src.substring(nodeIdx, nextNode > 0 ? nextNode : nodeIdx + 5000);
    if (nodeSection.includes('EMOTION SYSTEM COMPLIANCE')) {
        console.log(`  SKIP: ${nodeName} already has compliance`);
        return;
    }
    // Find the last Hard Constraint line in this node section 
    const hardIdx = src.indexOf('Hard Constraints:', nodeIdx);
    if (hardIdx === -1 || hardIdx > (nextNode > 0 ? nextNode : nodeIdx + 5000)) return;
    // Find the closing backtick for this node's text field
    const closingBacktick = src.indexOf('\n`,', hardIdx);
    if (closingBacktick === -1 || closingBacktick > (nextNode > 0 ? nextNode : hardIdx + 3000)) return;
    src = src.slice(0, closingBacktick) + emotionCompliance + src.slice(closingBacktick);
    console.log(`  ADDED: ${nodeName}`);
}

addComplianceAfterDoctrineBlock('Emotional Check');
addComplianceAfterDoctrineBlock('POV Planner');
addComplianceAfterDoctrineBlock('Science Plot Enrichment');

console.log('PHASE 7: Compliance blocks added');

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: INSERT POSTPROCESS NODE
// ═══════════════════════════════════════════════════════════════════════════
const postProcessNode = `

    @node({
        id: 'b2c3d4e5-f6a7-48b9-c0d1-e2f3a4b5c6d7',
        name: 'Post Process',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [4528, 688],
    })
    PostProcess = {
        jsCode: \`const raw = $input.first().json.output || $input.first().json.text || '';
const wordMap = {
  "delve": "examine", "delves": "examines", "delved": "examined", "delving": "examining",
  "tapestry": "weave", "tapestries": "weaves", "realm": "domain", "realms": "domains",
  "beacon": "signal", "beacons": "signals", "pivotal": "critical", "pivotally": "critically",
  "seamlessly": "smoothly", "seamless": "smooth", "myriad": "many",
  "resonate": "register", "resonates": "registers", "resonated": "registered",
  "captivate": "engage", "captivates": "engages", "captivated": "engaged", "captivating": "engaging",
  "unravel": "untangle", "unravels": "untangles", "unravelled": "untangled",
  "unleash": "release", "unleashes": "releases", "unleashed": "released",
  "navigate": "traverse", "navigates": "traverses", "navigated": "traversed",
  "embark": "begin", "embarks": "begins", "embarked": "began",
  "profound": "deep", "profoundly": "deeply", "palpable": "tangible",
  "visceral": "raw", "ethereal": "wispy", "enigmatic": "mysterious",
  "labyrinthine": "complex", "ubiquitous": "pervasive",
  "breathtaking": "striking", "vibrant": "vivid", "whimsical": "playful",
  "orchestrated": "arranged", "bespoke": "custom", "akin": "similar"
};
let output = raw;
for (const [w, r] of Object.entries(wordMap)) {
  const e = w.replace(/[-\\\\/\\\\\\\\^$*+?.()|[\\\\]]/g, '\\\\\\\\$&');
  output = output.replace(new RegExp('\\\\\\\\b' + e + '\\\\\\\\b', 'gi'), m =>
    m[0] === m[0].toUpperCase() ? r.charAt(0).toUpperCase() + r.slice(1) : r);
}
output = output.replace(/^(Based on|Given the|In conclusion|To summarize|Let's apply|This approach|This ensures).+$/gim, '');
output = output.replace(/^(This outline provides|This structured approach|This provides a|This narrative framework).+$/gim, '');
output = output.replace(/your (project|narrative|story|braindump)/gi, 'the $1');
output = output.replace(/[^ -~\\\\n\\\\r\\\\t]+/g, '');
output = output.replace(/\\\\n{4,}/g, '\\\\n\\\\n\\\\n').trim();
return [{ json: { output: output } }];\`,
    };
`;

// Insert after CleanOutlineOutput
const cleanIdx = src.indexOf("CleanOutlineOutput = {");
if (cleanIdx === -1) throw new Error('ABORT: CleanOutlineOutput not found');
let braceCount = 0;
let insertPos = -1;
for (let i = src.indexOf('{', cleanIdx); i < src.length; i++) {
    if (src[i] === '{') braceCount++;
    if (src[i] === '}') braceCount--;
    if (braceCount === 0) { insertPos = i + 2; break; }
}
if (insertPos === -1) throw new Error('ABORT: CleanOutlineOutput close not found');
src = src.slice(0, insertPos) + postProcessNode + src.slice(insertPos);

// Update routing
src = src.replace(
    'this.CleanOutlineOutput.out(0).to(this.SendToOutlineDoc.in(0))',
    'this.CleanOutlineOutput.out(0).to(this.PostProcess.in(0));\n        this.PostProcess.out(0).to(this.SendToOutlineDoc.in(0))'
);

// SendToOutlineDoc reads from PostProcess
src = src.replace(
    "$('Clean Outline Output').item.json.output",
    "$('Post Process').item.json.output"
);

console.log('PHASE 8: PostProcess node inserted');

// ═══════════════════════════════════════════════════════════════════════════
// POST-FLIGHT CHECKS
// ═══════════════════════════════════════════════════════════════════════════
const post = {
    chainCount: (src.match(/langchain\.chainLlm/g) || []).length,
    agentCount: (src.match(/langchain\.agent/g) || []).length,
    corruptedUtf8: (src.match(/Ã¢â‚¬/g) || []).length,
    corruptedSection: (src.match(/Ã‚Â§/g) || []).length,
    hasCleanOutline: src.includes('CleanOutlineOutput'),
    hasSendOutline: src.includes('SendToOutlineDoc'),
    hasPostProcess: src.includes('PostProcess'),
    xmlDataRefs: (src.match(/XML data/gi) || []).length,
    antiConstraints: (src.match(/NEGATIVE CONSTRAINTS:/g) || []).length,
    residualXmlInPrompts: (() => {
        const p = src.split('`');
        let c = 0;
        for (let i = 1; i < p.length; i += 2) c += (p[i].match(/<[a-z_]+>/g) || []).length;
        return c;
    })(),
};
console.log('\nPOST-FLIGHT:', JSON.stringify(post, null, 2));

if (post.agentCount > 0) console.warn('WARNING: ' + post.agentCount + ' agent refs remain');
if (post.corruptedUtf8 > 0) console.warn('WARNING: ' + post.corruptedUtf8 + ' UTF-8 corruptions remain');
if (!post.hasPostProcess) console.warn('WARNING: PostProcess not found');

fs.writeFileSync(FILE, src, 'utf8');
console.log('\n✅ WF2 fully transformed');
