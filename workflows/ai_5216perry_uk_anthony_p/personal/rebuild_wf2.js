/**
 * rebuild_wf2.js — Transform WF2: agents → chains, XML → plain text
 * 
 * SAFETY: XML replacement is limited to backtick template strings only.
 * Node names, property names, and code outside prompts are never touched.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '2 - Dossier to Full Outline.workflow.ts');
let src = fs.readFileSync(FILE, 'utf8');

// ── PRE-FLIGHT CHECKS ───────────────────────────────────────────────────────
const preflight = {
    hasCleanOutline: src.includes('CleanOutlineOutput'),
    hasSendOutline: src.includes('SendToOutlineDoc'),
    agentCount: (src.match(/langchain\.agent/g) || []).length,
    xmlTagCount: (src.match(/<[a-z_]+>/g) || []).length,
};
console.log('PRE-FLIGHT:', JSON.stringify(preflight));
if (!preflight.hasCleanOutline || !preflight.hasSendOutline) {
    throw new Error('ABORT: file integrity check failed');
}

// ── 1. AGENT → CHAINLLM (double-quote aware) ────────────────────────────────
// The file uses double quotes: type: "@n8n/n8n-nodes-langchain.agent",
src = src.replace(
    /type:\s*"@n8n\/n8n-nodes-langchain\.agent"/g,
    'type: "@n8n/n8n-nodes-langchain.chainLlm"'
);

// Also handle single-quoted variant just in case
src = src.replace(
    /type:\s*'@n8n\/n8n-nodes-langchain\.agent'/g,
    "type: '@n8n/n8n-nodes-langchain.chainLlm'"
);

// Replace version 2.2 with 1.4 for chainLlm nodes only
// Match version line that follows a chainLlm type line
src = src.replace(
    /(type:\s*["']@n8n\/n8n-nodes-langchain\.chainLlm["'],\s*\n\s*)version:\s*2\.2,/g,
    '$1version: 1.4,'
);

// Remove promptType: 'define' lines
src = src.replace(/\s*promptType:\s*['"]define['"],?\s*\n/g, '\n');

// Remove options: { systemMessage: '...' } blocks
// Handle multi-line systemMessage with single quotes
src = src.replace(
    /,?\s*options:\s*\{\s*\n?\s*systemMessage:\s*\n?\s*'(?:[^'\\]|\\.)*',?\s*\n?\s*\},?/g,
    ','
);
// Handle double-quoted systemMessage
src = src.replace(
    /,?\s*options:\s*\{\s*\n?\s*systemMessage:\s*\n?\s*"(?:[^"\\]|\\.)*",?\s*\n?\s*\},?/g,
    ','
);

// ── 2. XML TAGS → PLAIN TEXT (SAFE: only inside backtick strings) ────────────
// Strategy: find backtick template strings and replace XML tags only within them.
// We process the file by splitting on backticks and only transforming odd-indexed segments.

const xmlMap = {
    'context_variables': 'CONTEXT',
    'forbidden_words': 'FORBIDDEN WORDS',
    'dossier_source': 'DOSSIER SOURCE',
    'cast_manifest': 'CAST MANIFEST',
    'story_arc': 'STORY ARC',
    'worldbuilding_sheet': 'WORLDBUILDING',
    'worldbuilding': 'WORLDBUILDING',
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
    'extracted_constraints': 'EXTRACTED CONSTRAINTS',
};

function replaceXmlInPromptString(str) {
    let result = str;
    for (const [tag, heading] of Object.entries(xmlMap)) {
        // Opening tag <tag_name> → HEADING:\n
        result = result.replace(new RegExp(`<${tag}>\\s*`, 'g'), `${heading}:\n`);
        // Closing tag </tag_name> → (remove)
        result = result.replace(new RegExp(`</${tag}>\\s*`, 'g'), '\n');
    }
    return result;
}

// Split on backticks — odd-indexed segments are inside template literals
const parts = src.split('`');
for (let i = 1; i < parts.length; i += 2) {
    // Only process segments that look like prompt text (contain XML tags)
    if (parts[i].match(/<[a-z_]+>/)) {
        parts[i] = replaceXmlInPromptString(parts[i]);
    }
}
src = parts.join('`');

// ── 3. FIX OUTPUT FIELD REFERENCES ───────────────────────────────────────────
// chainLlm outputs .json.text not .json.output
// But only fix references INSIDE prompt expressions (backtick strings)
// and in Google Docs send node expressions
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
    // .first()?.json?.output → .first()?.json?.text
    src = src.replace(
        new RegExp(`\\$\\(["']${esc}["']\\)\\.first\\(\\)\\?\\.json\\?\\.output`, 'g'),
        `$('${name}').first()?.json?.text`
    );
    // .first().json.output → .first().json.text
    src = src.replace(
        new RegExp(`\\$\\(["']${esc}["']\\)\\.first\\(\\)\\.json\\.output`, 'g'),
        `$('${name}').first().json.text`
    );
    // .item.json.output → .item.json.text
    src = src.replace(
        new RegExp(`\\$\\(["']${esc}["']\\)\\.item\\.json\\.output`, 'g'),
        `$('${name}').item.json.text`
    );
}

// ── 4. FIX CleanOutlineOutput to read .text ──────────────────────────────────
src = src.replace(
    "const raw = $input.first().json.output || '';",
    "const raw = $input.first().json.text || $input.first().json.output || '';"
);
// Also check alternate quote format
src = src.replace(
    'const raw = $input.first().json.output || "";',
    'const raw = $input.first().json.text || $input.first().json.output || "";'
);

// ── 5. ADD ANTI-CONSTRAINTS before Hard Constraints ─────────────────────────
// Only add inside backtick strings (prompt text)
const antiBlock = `\nNEGATIVE CONSTRAINTS:\n- DO NOT reproduce input data verbatim. Synthesize and transform.\n- DO NOT invent sections not in the instructions above.\n- DO NOT add marketing plans, adaptation pitches, or unsolicited content.\n- DO NOT use any language other than English. Standard Latin script only.\n\n`;

const parts2 = src.split('`');
for (let i = 1; i < parts2.length; i += 2) {
    // Only add if this segment has "Hard Constraints:" and doesn't already have "NEGATIVE CONSTRAINTS"
    if (parts2[i].includes('Hard Constraints:') && !parts2[i].includes('NEGATIVE CONSTRAINTS')) {
        parts2[i] = parts2[i].replace(/(\nHard Constraints:)/g, antiBlock + '$1');
    }
}
src = parts2.join('`');

// ── 6. INSERT POSTPROCESS NODE ───────────────────────────────────────────────
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

// Find CleanOutlineOutput definition end and insert PostProcess after it
const cleanIdx = src.indexOf("CleanOutlineOutput = {");
if (cleanIdx === -1) throw new Error('ABORT: CleanOutlineOutput not found');
// Find the closing }; for this node
let braceCount = 0;
let insertPos = -1;
for (let i = src.indexOf('{', cleanIdx); i < src.length; i++) {
    if (src[i] === '{') braceCount++;
    if (src[i] === '}') braceCount--;
    if (braceCount === 0) {
        insertPos = i + 2; // past };
        break;
    }
}
if (insertPos === -1) throw new Error('ABORT: could not find CleanOutlineOutput closing brace');
src = src.slice(0, insertPos) + postProcessNode + src.slice(insertPos);

// ── 7. UPDATE ROUTING FOR POSTPROCESS ────────────────────────────────────────
src = src.replace(
    'this.CleanOutlineOutput.out(0).to(this.SendToOutlineDoc.in(0))',
    'this.CleanOutlineOutput.out(0).to(this.PostProcess.in(0));\n        this.PostProcess.out(0).to(this.SendToOutlineDoc.in(0))'
);

// Update SendToOutlineDoc to read from PostProcess
src = src.replace(
    "$('Clean Outline Output').item.json.output",
    "$('Post Process').item.json.output"
);

// ── 8. UPDATE WORKFLOW MAP COMMENT ───────────────────────────────────────────
src = src.replace(/\/\/\s*Nodes\s*:\s*66/g, '// Nodes   : 67');

// ── POST-FLIGHT CHECKS ──────────────────────────────────────────────────────
const postflight = {
    hasCleanOutline: src.includes('CleanOutlineOutput'),
    hasSendOutline: src.includes('SendToOutlineDoc'),
    hasPostProcess: src.includes('PostProcess'),
    chainCount: (src.match(/langchain\.chainLlm/g) || []).length,
    agentCount: (src.match(/langchain\.agent/g) || []).length,
    xmlTagsRemaining: (() => {
        // Count XML tags only inside backtick strings
        const p = src.split('`');
        let count = 0;
        for (let i = 1; i < p.length; i += 2) {
            count += (p[i].match(/<[a-z_]+>/g) || []).length;
        }
        return count;
    })(),
    antiConstraints: (src.match(/NEGATIVE CONSTRAINTS:/g) || []).length,
};
console.log('POST-FLIGHT:', JSON.stringify(postflight, null, 2));

if (postflight.agentCount > 0) console.warn('WARNING: ' + postflight.agentCount + ' agent references remain');
if (!postflight.hasPostProcess) console.warn('WARNING: PostProcess node not found');

fs.writeFileSync(FILE, src, 'utf8');
console.log('\n✅ Workflow 2 rebuilt successfully');
