// Phase 1: Apply all prompt-level grounding fixes
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
const original = s;
let applied = [];

// ============================================================
// HELPER: Insert text BEFORE the first occurrence of `anchor` within
//         a substring starting at `searchFrom`
// ============================================================
function insertBefore(text, anchor, insertion, searchFrom = 0) {
    const idx = text.indexOf(anchor, searchFrom);
    if (idx === -1) return { text, ok: false };
    return { text: text.substring(0, idx) + insertion + text.substring(idx), ok: true };
}

// ============================================================
// 1. CHARACTERS — Ban angle brackets, fix Core Motivation format
// ============================================================
// Find the Characters node
const charNodeIdx = s.indexOf('name: "Characters"');
if (charNodeIdx > -1) {
    // Find "NEGATIVE CONSTRAINTS:" within the Characters block
    const charBlock = s.substring(charNodeIdx, charNodeIdx + 15000);
    const charNegIdx = charBlock.indexOf('NEGATIVE CONSTRAINTS:');

    if (charNegIdx > -1) {
        const absCharNeg = charNodeIdx + charNegIdx;

        // Insert grounding rules BEFORE NEGATIVE CONSTRAINTS
        const charGrounding = `CRITICAL ANTI-HALLUCINATION RULES:
- The CONSTRAINT_TAG in Core Motivation must use SQUARE BRACKETS only: [tag_name]. NEVER use angle brackets <tag_name> or XML-style <tag_name>. If you catch yourself writing < or >, stop and replace with [ and ].
- Core Motivation format is EXACTLY: "[Character] wants [X], which the [CONSTRAINT_TAG] makes impossible because [Y -- specific dossier mechanism]"
- Every character name you generate must NOT appear in ENTITY_NAMES or FORBIDDEN WORDS.
- Do NOT use any character name from your training data. Invent original names grounded in the world's culture.

QUIRK ENFORCEMENT:
- A quirk MUST name a specific system, material, location, or world element from DOSSIER SOURCE.
- FAILING EXAMPLES (do NOT produce anything like these):
  1. "fidgets with a data chip" -- generic object, not world-textured
  2. "taps fingers on the desk" -- universal gesture, not world-specific
  3. "gestures with hands as if manipulating invisible controls" -- vague mime, no world anchor
  4. "adjusts glasses nervously" -- real-world object, not from dossier
  5. "smooths attire before speaking" -- generic grooming, no world texture
- PASSING EXAMPLES:
  1. "traces the cooling vents with a fingertip whenever she enters a new sector, reading temperature differentials by touch"
  2. "whispers status codes from the Helix uptime log before making any decision, like a private countdown"
  3. "collects fragments of decommissioned substrate crystal and arranges them by decay stage on her workstation"

ACT TRAJECTORY REQUIREMENT:
- For each MAJOR character (protagonist, antagonist, deuteragonist), you MUST include an Act Trajectory field:
  * Act Trajectory: Act 1 [stat snapshot + dominant emotion] -> Midpoint [shift trigger + new stats] -> Act 3 [crisis stats + cascade risk] -> Resolution [final emotional state]

`;
        s = s.substring(0, absCharNeg) + charGrounding + s.substring(absCharNeg);
        applied.push('#1 Characters: anti-hallucination grounding + quirk enforcement + act trajectory requirement');
    }
}

// ============================================================
// 2. STORY ARC — Force protagonist from CAST MANIFEST
// ============================================================
const saNodeIdx = s.indexOf('name: "Story Arc"');
if (saNodeIdx > -1) {
    const saBlock = s.substring(saNodeIdx, saNodeIdx + 15000);
    const saNegIdx = saBlock.indexOf('NEGATIVE CONSTRAINTS:');

    if (saNegIdx > -1) {
        const absSANeg = saNodeIdx + saNegIdx;
        const saGrounding = `CRITICAL CAST GROUNDING (MANDATORY):
- Your PROTAGONIST must be a character from CAST MANIFEST above. Use their EXACT NAME.
- Your ANTAGONIST must be a character from CAST MANIFEST above. Use their EXACT NAME.
- ALL named characters in the story arc MUST come from CAST MANIFEST. Do NOT invent ANY new characters.
- If CAST MANIFEST has 5 characters, your story arc uses those 5 characters and NO OTHERS.
- Before finalising, cross-check every name in your output against CAST MANIFEST. If a name is not in the manifest, REMOVE IT and replace with a character from the manifest.
- Do NOT use names from your training data (Ava, Luna, Marcus from other stories, etc.). Use ONLY the specific names in CAST MANIFEST.

`;
        s = s.substring(0, absSANeg) + saGrounding + s.substring(absSANeg);
        applied.push('#2 Story Arc: cast grounding — protagonist/antagonist from CAST MANIFEST');
    }
}

// ============================================================
// 3. WORLDBUILDING — Ground locations to CAST MANIFEST characters
// ============================================================
const wbNodeIdx = s.indexOf('name: "Worldbuilding"');
if (wbNodeIdx > -1) {
    const wbBlock = s.substring(wbNodeIdx, wbNodeIdx + 15000);
    const wbNegIdx = wbBlock.indexOf('NEGATIVE CONSTRAINTS:');

    if (wbNegIdx > -1) {
        const absWBNeg = wbNodeIdx + wbNegIdx;
        const wbGrounding = `CRITICAL CAST GROUNDING (MANDATORY):
- Reference characters by name ONLY — use EXACT names from CAST MANIFEST.
- Do NOT invent any new characters. Do NOT reference characters not in CAST MANIFEST.
- When describing how a location serves a plot beat, use the character names from CAST MANIFEST.
- Do NOT include a Characters section or character profiles. This document is for WORLD SYSTEMS only.

`;
        s = s.substring(0, absWBNeg) + wbGrounding + s.substring(absWBNeg);
        applied.push('#3 Worldbuilding: cast grounding — reference names from CAST MANIFEST only');
    }
}

// ============================================================
// 4. OUTLINE PROMPTS — Ground characters to CAST MANIFEST
// ============================================================
// The OutlinePrompts node generates the prompt in JS. Find the instruction section.
const opNodeIdx = s.indexOf('name: "Outline Prompts"');
if (opNodeIdx > -1) {
    // Find the CHAPTER DETAIL LEVEL section and add before it
    const detailIdx = s.indexOf('### CHAPTER DETAIL LEVEL', opNodeIdx);
    if (detailIdx > -1) {
        const opGrounding = `### CRITICAL CAST GROUNDING
- EVERY character name in your outline MUST come from the CHARACTERS section above.
- Your PROTAGONIST is the character with role "protagonist" in CHARACTERS. Use their EXACT NAME.
- Do NOT invent any new characters. If you need a minor character, use one from CHARACTERS.
- Before finalising, cross-check ALL names against CHARACTERS. Remove any name not found there.

`;
        s = s.substring(0, detailIdx) + opGrounding + s.substring(detailIdx);
        applied.push('#4 OutlinePrompts: cast grounding instructions');
    }
}

// ============================================================
// 5. GHOSTWRITER BRIEF — Anti-hallucination grounding
// ============================================================
const gbNodeIdx = s.indexOf('name: "Ghostwriter Brief"');
if (gbNodeIdx > -1) {
    const gbBlock = s.substring(gbNodeIdx, gbNodeIdx + 15000);
    const gbAntiIdx = gbBlock.indexOf('ANTI-HALLUCINATION RULES');

    if (gbAntiIdx > -1) {
        const absGBAnti = gbNodeIdx + gbAntiIdx;
        // Replace the existing anti-hallucination section with a stronger one
        const oldAntiHalluc = `ANTI-HALLUCINATION RULES (MANDATORY):
- Every character name, location, world mechanic, faction, score system, and plot beat in this brief must be traceable to one of the input sources above. Do NOT invent characters, locations, events, world rules, or foreshadowing plants that are not present in the source documents.
- If an input source is empty or errored, mark that chapter section with [DATA MISSING: source name] rather than filling in invented content.
- Do not import terminology, proper nouns, or world mechanics from your training data. This brief must contain only elements from THIS story's documents.`;

        const newAntiHalluc = `ANTI-HALLUCINATION RULES (MANDATORY):
- EVERY character name in this brief MUST appear in CAST MANIFEST. Cross-check before finalising.
- Do NOT invent new characters. If CAST MANIFEST has 5 characters, use ONLY those 5.
- Do NOT use generic character names from your training data (Ava, Luna, Kira, Eli, etc.).
- Every location must come from WORLDBUILDING. Every plot beat from CONTINUITY CHECKED OUTLINE.
- Every faction from WORLDBUILDING. Every foreshadowing seed from FORESHADOWING PLAN.
- If an input source is empty or errored, mark that section with [DATA MISSING: source name].
- Do not import terminology, proper nouns, or world mechanics from your training data.
- This brief must contain ONLY elements from THIS story's documents.`;

        if (s.includes(oldAntiHalluc)) {
            s = s.replace(oldAntiHalluc, newAntiHalluc);
            applied.push('#5 Ghostwriter Brief: strengthened anti-hallucination with CAST MANIFEST cross-check');
        } else {
            console.log('#5 WARN: Could not find exact anti-hallucination text');
        }
    }
}

// ============================================================
// 6. ALL ENRICHMENT NODES — Add anti-hallucination header
// ============================================================
// Add to: Emotional Check, Science Plot Enrichment, Continuity Checker,
// Scene Breakdown, Foreshadowing Planner, POV Planner
const enrichmentNodes = [
    'name: "Emotional Check"',
    'name: "Science Plot Enrichment"',
    'name: "Continuity Checker"',
    'name: "Scene Breakdown"',
    'name: "Foreshadowing Planner"',
    'name: "POV Planner"',
];

const enrichGrounding = `
CRITICAL: ALL character names in your output MUST come from CAST MANIFEST above. Do NOT invent new characters or use names from your training data. Cross-check every name before finalising.
`;

enrichmentNodes.forEach(nodeName => {
    const nodeIdx = s.indexOf(nodeName);
    if (nodeIdx > -1) {
        const nodeBlock = s.substring(nodeIdx, nodeIdx + 10000);
        const negIdx = nodeBlock.indexOf('NEGATIVE CONSTRAINTS:');
        if (negIdx > -1) {
            const absNeg = nodeIdx + negIdx;
            s = s.substring(0, absNeg) + enrichGrounding + s.substring(absNeg);
            applied.push(`#6 ${nodeName.replace('name: "', '').replace('"', '')}: cast grounding`);
        }
    }
});

// ============================================================
// 7. CRITIQUE NODES — Add character cross-check criterion
// ============================================================
const critiqueNodes = [
    'name: "Critique Characters"',
    'name: "Critique Story Arc"',
    'name: "Critique Outline"',
];

critiqueNodes.forEach(nodeName => {
    const nodeIdx = s.indexOf(nodeName);
    if (nodeIdx > -1) {
        const nodeBlock = s.substring(nodeIdx, nodeIdx + 10000);
        const negIdx = nodeBlock.indexOf('NEGATIVE CONSTRAINTS:');
        if (negIdx > -1) {
            const absNeg = nodeIdx + negIdx;
            const critiqueCheck = `
CAST INTEGRITY CHECK: Flag ANY character name that does NOT appear in CAST MANIFEST. Every named character must originate from the Characters output. This is a BLOCKING error -- if found, the rewrite MUST fix it.
`;
            s = s.substring(0, absNeg) + critiqueCheck + s.substring(absNeg);
            applied.push(`#7 ${nodeName.replace('name: "', '').replace('"', '')}: cast integrity check`);
        }
    }
});

// ============================================================
// SAVE AND REPORT
// ============================================================
console.log('\n=== APPLIED ===');
applied.forEach(a => console.log('  ✅ ' + a));
console.log('\nTotal: ' + applied.length);

if (s !== original) {
    fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
    console.log('\nSaved.');
} else {
    console.log('\nWARNING: No changes made!');
}
