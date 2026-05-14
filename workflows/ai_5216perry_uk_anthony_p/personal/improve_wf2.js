/**
 * improve_wf2.js — Deep-dive fixes for WF2 prompts
 * 
 * Fix categories:
 * 1. Corrupted UTF-8 (em-dash, section sign, accented chars)
 * 2. Residual XML tags in prompt strings (safe: backtick-scoped only)
 * 3. Role lines referencing "XML data"
 * 4. Missing EMOTION SYSTEM COMPLIANCE blocks
 * 5. OutlinePrompts code node XML → plain text
 * 6. CritiqueStoryArc backtick-escaped XML
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '2 - Dossier to Full Outline.workflow.ts');
let src = fs.readFileSync(FILE, 'utf8');

// ── PRE-FLIGHT ──────────────────────────────────────────────────────────────
const pre = {
    corruptedUtf8: (src.match(/Ã¢â‚¬â€/g) || []).length,
    sectionSign: (src.match(/Ã‚Â§/g) || []).length,
    residualXmlInPrompts: (() => {
        const p = src.split('`');
        let c = 0;
        for (let i = 1; i < p.length; i += 2) c += (p[i].match(/<[a-z_]+>/g) || []).length;
        return c;
    })(),
    xmlDataRefs: (src.match(/XML data/gi) || []).length,
    hasCleanOutline: src.includes('CleanOutlineOutput'),
    hasSendOutline: src.includes('SendToOutlineDoc'),
};
console.log('PRE-FLIGHT:', JSON.stringify(pre));
if (!pre.hasCleanOutline || !pre.hasSendOutline) throw new Error('ABORT: integrity check failed');

// ═══════════════════════════════════════════════════════════════════════════
// FIX 1: CORRUPTED UTF-8
// ═══════════════════════════════════════════════════════════════════════════
// Em-dash: Ã¢â‚¬â€ → —
src = src.replace(/Ã¢â‚¬â€/g, '—');
// Also handle alternate corruption patterns for em-dash
src = src.replace(/Ã¢â‚¬â€œ/g, '–');  // en-dash
src = src.replace(/Ã¢â‚¬â„¢/g, "'");  // right single quote
src = src.replace(/Ã¢â‚¬Å"/g, '"');   // left double quote  
src = src.replace(/Ã¢â‚¬Â/g, '"');    // right double quote

// Section sign: Ã‚Â§ → §
src = src.replace(/Ã‚Â§/g, '§');

// Accented e: ÃƒÂ© → é
src = src.replace(/ÃƒÂ©/g, 'é');

// Other common corruptions
src = src.replace(/Ã‚Â/g, '');  // stray Ã‚Â prefix

console.log('FIX 1: UTF-8 corruption repaired');

// ═══════════════════════════════════════════════════════════════════════════
// FIX 2: RESIDUAL XML TAGS IN PROMPT STRINGS (backtick-scoped only)
// ═══════════════════════════════════════════════════════════════════════════

// 2a. Structural section markers → HEADING: format
const structuralXml = {
    'clifton_strengths_reference': 'CLIFTON STRENGTHS REFERENCE',
    'dialogue_slot_guide': 'DIALOGUE SLOT GUIDE',
    'input_logic': 'INPUT LOGIC',
    'context': 'CONTEXT',
    'story_arc_source': 'STORY ARC SOURCE',
    'worldbuilding_template': 'WORLDBUILDING TEMPLATE',
};

function replaceStructuralXml(str) {
    let result = str;
    for (const [tag, heading] of Object.entries(structuralXml)) {
        result = result.replace(new RegExp(`<${tag}>\\s*`, 'g'), `${heading}:\n`);
        result = result.replace(new RegExp(`</${tag}>\\s*`, 'g'), '\n');
    }
    return result;
}

// 2b. Dossier key references → backtick format
// These are used in instruction text to reference JSON keys from the dossier
const dossierKeyXml = [
    'economy', 'tech_magic', 'systemic_friction', 'arc_seed', 'world_seed',
    'core_wound', 'character_seed', 'world_arcs', 'everyday_texture',
    'built_environments', 'plot_template', 'conflict_doctrine',
    'backstory_doctrine', 'faction_doctrine', 'location_doctrine',
    'world_context', 'voice_doctrine',
];

function replaceDossierKeyXml(str) {
    let result = str;
    for (const key of dossierKeyXml) {
        // <key> → `key`  (but not when it's a section header we already converted)
        result = result.replace(new RegExp(`<${key}>`, 'g'), `\`${key}\``);
        result = result.replace(new RegExp(`</${key}>`, 'g'), '');
    }
    return result;
}

// Apply both passes only inside backtick template strings
const parts = src.split('`');
for (let i = 1; i < parts.length; i += 2) {
    if (parts[i].match(/<[a-z_]+>/)) {
        parts[i] = replaceStructuralXml(parts[i]);
        parts[i] = replaceDossierKeyXml(parts[i]);
    }
}
src = parts.join('`');

console.log('FIX 2: Residual XML tags in prompts converted');

// ═══════════════════════════════════════════════════════════════════════════
// FIX 3: ROLE LINES REFERENCING "XML DATA"
// ═══════════════════════════════════════════════════════════════════════════
src = src.replace(
    'expand the world-logic for a single novel based on structured XML data',
    'expand the world-logic for a single novel based on structured dossier data'
);
src = src.replace(
    'synthesize the provided XML data into a unified narrative arc',
    'synthesize the provided dossier data into a unified narrative arc'
);
// "reference exact XML tags from the dossier" → "reference exact keys from the dossier"
src = src.replace(/exact XML tags from the dossier/g, 'exact keys from the dossier');
// "reference the exact XML tags" → "reference the exact keys"
src = src.replace(/exact XML tags/g, 'exact dossier keys');
// "Reference specific XML tags from the dossier" 
src = src.replace(/Reference specific XML tags/g, 'Reference specific keys');
// "Do not reference XML tags outside CANONICAL_TAGS"
src = src.replace(/Do not reference XML tags outside/g, 'Do not reference tags outside');
// "Do not use any XML tag not in CANONICAL_TAGS"
src = src.replace(/Do not use any XML tag not in/g, 'Do not use any tag not in');

console.log('FIX 3: XML data references updated');

// ═══════════════════════════════════════════════════════════════════════════
// FIX 4: MISSING EMOTION SYSTEM COMPLIANCE BLOCKS
// ═══════════════════════════════════════════════════════════════════════════
const emotionCompliance = `
- EMOTION SYSTEM COMPLIANCE: When generating or referencing character stats, emotion values, cascade rules, voice registers, or scene resolutions, you MUST use ONLY the vocabularies declared in EMOTION SYSTEM GUARDRAILS:
. Do NOT invent stat names, emotion names, or voice registers not listed there. If the block is empty, use the character emotion template sections as your vocabulary reference.
`;

// EmotionalCheck — add after its Hard Constraints closing line
// Find the EmotionalCheck node's closing backtick and add compliance before it
const emotionalCheckEnd = src.indexOf("- Follow PROFILE INSTRUCTION:\nfor depth level.\n\n`,\n    };\n\n    @node({\n        id: \"e39c9d45");
if (emotionalCheckEnd !== -1) {
    const insertPoint = src.indexOf('for depth level.', emotionalCheckEnd) + 'for depth level.'.length;
    if (!src.substring(emotionalCheckEnd, emotionalCheckEnd + 500).includes('EMOTION SYSTEM COMPLIANCE')) {
        src = src.slice(0, insertPoint) + '\n' + emotionCompliance + src.slice(insertPoint);
        console.log('FIX 4a: Added EMOTION SYSTEM COMPLIANCE to EmotionalCheck');
    }
}

// POV Planner — add after its Hard Constraints
const povEnd = src.indexOf("- DOCTRINE COMPLIANCE: POV voice consistency must conform to VOICE DOCTRINE:");
if (povEnd !== -1) {
    const nextLineEnd = src.indexOf('\n\n`', povEnd);
    if (nextLineEnd !== -1 && !src.substring(povEnd, nextLineEnd + 100).includes('EMOTION SYSTEM COMPLIANCE')) {
        src = src.slice(0, nextLineEnd) + '\n' + emotionCompliance + src.slice(nextLineEnd);
        console.log('FIX 4b: Added EMOTION SYSTEM COMPLIANCE to POV Planner');
    }
}

// SciencePlotEnrichment — check if missing
const scienceNode = src.indexOf('name: "Science Plot Enrichment"');
if (scienceNode !== -1) {
    // Find the end of this node's prompt
    const sciencePromptArea = src.substring(scienceNode, scienceNode + 3000);
    if (!sciencePromptArea.includes('EMOTION SYSTEM COMPLIANCE')) {
        // Find the last Hard Constraint line
        const scienceEndIdx = src.indexOf("- Follow PROFILE INSTRUCTION:\nfor depth level.\n- All character names", scienceNode);
        if (scienceEndIdx !== -1) {
            const scienceInsert = src.indexOf('\n\n`', scienceEndIdx);
            if (scienceInsert !== -1) {
                src = src.slice(0, scienceInsert) + '\n' + emotionCompliance + src.slice(scienceInsert);
                console.log('FIX 4c: Added EMOTION SYSTEM COMPLIANCE to SciencePlotEnrichment');
            }
        }
    }
}

console.log('FIX 4: Compliance blocks checked');

// ═══════════════════════════════════════════════════════════════════════════
// FIX 5: OUTLINEPROMPTS CODE NODE — XML → PLAIN TEXT
// ═══════════════════════════════════════════════════════════════════════════
// The OutlinePrompts node builds a prompt string with XML tags inside a 
// template literal within a jsCode string. These XML tags are inside nested
// backticks (template literal inside jsCode backtick string).
// We need to be careful — these are in the code node, not LLM prompt strings.

// Replace the XML structure in the OutlinePrompts template literal
const outlineReplacements = [
    // Outer structure
    ['<system_constraints>', 'SYSTEM CONSTRAINTS:'],
    ['</system_constraints>', ''],
    ['<prose_jail>', 'PROSE JAIL:\n'],
    ['</prose_jail>', ''],
    ['<world_context>', 'WORLD CONTEXT:'],
    ['</world_context>', ''],
    ['<dossier_source>', 'DOSSIER SOURCE:\n'],
    ['</dossier_source>', ''],
    ['<characters>', 'CHARACTERS:\n'],
    ['</characters>', ''],
    ['<worldbuilding>', 'WORLDBUILDING:\n'],
    ['</worldbuilding>', ''],
    ['<genre_tropes>', 'GENRE TROPES:\n'],
    ['</genre_tropes>', ''],
    ['<doctrine_templates>', 'DOCTRINE TEMPLATES:'],
    ['</doctrine_templates>', ''],
    ['<conflict_doctrine>', 'CONFLICT DOCTRINE:\n'],
    ['</conflict_doctrine>', ''],
    ['<location_doctrine>', 'LOCATION DOCTRINE:\n'],
    ['</location_doctrine>', ''],
    ['<faction_doctrine>', 'FACTION DOCTRINE:\n'],
    ['</faction_doctrine>', ''],
    ['<narrative_spine>', 'NARRATIVE SPINE:'],
    ['</narrative_spine>', ''],
    ['<story_so_far>', 'STORY SO FAR:\n'],
    ['</story_so_far>', ''],
    ['<author_notes>', 'AUTHOR NOTES:\n'],
    ['</author_notes>', ''],
    ['<plot_logic>', 'PLOT LOGIC:\n'],
    ['</plot_logic>', ''],
    ['<task_constraints>', 'TASK CONSTRAINTS:'],
    ['</task_constraints>', ''],
    ['<total_chapters>', 'TOTAL CHAPTERS: '],
    ['</total_chapters>', ''],
    ['<target_chapters>', 'TARGET CHAPTERS: '],
    ['</target_chapters>', ''],
    ['<target_length>', 'TARGET LENGTH: '],
    ['</target_length>', ''],
];

// Find the OutlinePrompts jsCode section
const outlineStart = src.indexOf("name: \"Outline Prompts\"");
if (outlineStart !== -1) {
    const jsCodeStart = src.indexOf('jsCode:', outlineStart);
    const jsCodeEnd = src.indexOf('`\n    };', jsCodeStart);
    if (jsCodeStart !== -1 && jsCodeEnd !== -1) {
        let section = src.substring(jsCodeStart, jsCodeEnd + 8);
        for (const [find, replace] of outlineReplacements) {
            section = section.split(find).join(replace);
        }
        // Also fix the XML references in the GUIDELINES section
        section = section.replace(/<dossier_source>/g, 'DOSSIER SOURCE');
        section = section.replace(/<characters>/g, 'CHARACTERS');
        section = section.replace(/<worldbuilding>/g, 'WORLDBUILDING');
        section = section.replace(/<story_so_far>/g, 'STORY SO FAR');
        section = section.replace(/<plot_logic>/g, 'PLOT LOGIC');
        section = section.replace(/<prose_jail>/g, 'PROSE JAIL');
        section = section.replace(/<economy>/g, '`economy`');
        section = section.replace(/<tech_magic>/g, '`tech_magic`');
        section = section.replace(/<conflict_doctrine>/g, 'CONFLICT DOCTRINE');
        section = section.replace(/<location_doctrine>/g, 'LOCATION DOCTRINE');
        section = section.replace(/<faction_doctrine>/g, 'FACTION DOCTRINE');
        section = section.replace(/<target_chapters>/g, 'TARGET CHAPTERS');
        src = src.substring(0, jsCodeStart) + section + src.substring(jsCodeEnd + 8);
        console.log('FIX 5: OutlinePrompts XML converted to plain text');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 6: CRITIQUESTORYARC BACKTICK-ESCAPED XML
// ═══════════════════════════════════════════════════════════════════════════
// Convert \`<tech_magic>\` → `tech_magic` etc.
src = src.replace(/\\`<([a-z_]+)>\\`/g, '`$1`');

console.log('FIX 6: Backtick-escaped XML converted');

// ═══════════════════════════════════════════════════════════════════════════
// POST-FLIGHT CHECKS
// ═══════════════════════════════════════════════════════════════════════════
const post = {
    corruptedUtf8: (src.match(/Ã¢â‚¬/g) || []).length,
    sectionSign: (src.match(/Ã‚Â§/g) || []).length,
    residualXmlInPrompts: (() => {
        const p = src.split('`');
        let c = 0;
        for (let i = 1; i < p.length; i += 2) c += (p[i].match(/<[a-z_]+>/g) || []).length;
        return c;
    })(),
    xmlDataRefs: (src.match(/XML data/gi) || []).length,
    hasCleanOutline: src.includes('CleanOutlineOutput'),
    hasSendOutline: src.includes('SendToOutlineDoc'),
    hasPostProcess: src.includes('PostProcess'),
    emDashCount: (src.match(/—/g) || []).length,
    sectionSignClean: (src.match(/§/g) || []).length,
};
console.log('\nPOST-FLIGHT:', JSON.stringify(post, null, 2));

fs.writeFileSync(FILE, src, 'utf8');
console.log('\n✅ All improvements applied successfully');
