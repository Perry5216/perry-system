// Apply all output audit fixes to Characters, Story Arc, and Worldbuilding prompts
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
const original = s;

// ============================================================
// 1. CHARACTERS NODE FIXES
// ============================================================

// 1a. Core Motivation: change <[CONSTRAINT_TAG]> to [CONSTRAINT_TAG]
s = s.replace(/<\[CONSTRAINT_TAG\]>/g, '[CONSTRAINT_TAG]');
console.log('1a. Replaced <[CONSTRAINT_TAG]> with [CONSTRAINT_TAG]');

// 1b. Stronger dialogue dedup (find the line and expand it)
s = s.replace(
    /— generate original lines only\. No cross-character duplicates\./,
    '-- generate original lines only. No cross-character duplicates. Before finalising, cross-check ALL dialogue lines across every character -- no two characters may share any sentence or near-identical phrasing.'
);
console.log('1b. Enhanced dialogue dedup enforcement');

// 1c. Negative quirk examples (find the Quirk Rule line and expand)
s = s.replace(
    /13\. \*\*Quirk Rule:\*\* A quirk is a single observable behaviour tied to the world's texture — not a device, not a tool, not a plot action, not inner state commentary\. No "reveals their" or "a habit that shows\." No "carries a device" or "checks a device\."/,
    '13. **Quirk Rule:** A quirk is a single observable behaviour tied to the world\'s texture -- not a device, not a tool, not a plot action, not inner state commentary. No "reveals their" or "a habit that shows." No "carries a device" or "checks a device." FAILING examples: "adjusts glasses", "taps fingers on desk", "smooths attire" -- these are generic gestures, not world-textured. A passing quirk MUST name a specific system, material, or environment from DOSSIER SOURCE.'
);
console.log('1c. Added negative quirk examples');

// 1d. Fix Role list in format template
s = s.replace(
    '* Role in Story: [protagonist / antagonist / foil — no duplicates]',
    '* Role in Story: [protagonist / antagonist / deuteragonist / mentor / foil / catalyst / ally -- no duplicates]'
);
if (!s.includes('protagonist / antagonist / deuteragonist / mentor / foil / catalyst / ally')) {
    // Try without em-dash
    s = s.replace(
        '* Role in Story: [protagonist / antagonist / foil',
        '* Role in Story: [protagonist / antagonist / deuteragonist / mentor / foil / catalyst / ally'
    );
}
console.log('1d. Expanded Role list in format template');

// 1e. Fix Core Motivation in field list (line 333) 
s = s.replace(
    /4\. Core Motivation — "[^"]*\[Character\] wants \[X\], which the \[CONSTRAINT_TAG\] makes impossible because \[Y — specific dossier mechanism\]"/,
    '4. Core Motivation -- "[Character] wants [X], which the [CONSTRAINT_TAG] makes impossible because [Y -- specific dossier mechanism]"'
);
console.log('1e. Fixed Core Motivation format in field list');

// 1f. Fix Core Motivation in format template (the * bullet version)
s = s.replace(
    /\* Core Motivation: \[Character\] wants \[X\], which the \[CONSTRAINT_TAG\] makes impossible because \[Y — specific dossier mechanism\]/,
    '* Core Motivation: [Character] wants [X], which the [CONSTRAINT_TAG] makes impossible because [Y -- specific dossier mechanism]'
);
console.log('1f. Fixed Core Motivation format in template');

// ============================================================
// 2. STORY ARC NODE FIXES  
// ============================================================
// Find the Story Arc node text
const storyArcMatch = s.match(/name: "Story Arc"[\s\S]*?text: `=([\s\S]*?)`\s*\n\s*\};/);
if (storyArcMatch) {
    let saText = storyArcMatch[1];
    const saOriginal = saText;

    // Find where INSTRUCTIONS section is and add new requirements
    // Add after the last instruction item
    const instructionsEnd = saText.indexOf('NEGATIVE CONSTRAINTS:');
    if (instructionsEnd > -1) {
        const insertion = `
ADDITIONAL REQUIREMENTS:
- **Beat Detail:** Each beat must include: WHO is present (named cast members), WHERE it happens (named location from DOSSIER SOURCE), WHAT systemic mechanism creates the friction, and WHAT the character does in response.
- **Chapter Mapping:** Map each beat to a specific chapter number. Distribute beats evenly across the total chapter count.
- **Subplot Arcs:** Each subplot must have its own 3-beat arc: setup, complication, payoff. Name the chapter where each beat lands.
- **Cast Integrity:** Every named character in the story arc MUST appear in the CAST MANIFEST. Do NOT introduce any new characters not already in the cast.
- **Resolution Specificity:** Resolution must name the specific mechanism of change -- what tool, system, or action resolves the conflict.

BANNED PHRASES (in addition to PROSE JAIL):
- "navigate", "landscape", "ever-shifting", "unveiling", "dawning realization"
- "things come to a head", "everything changes", "forced to confront"
- "turning point" (use the specific plot template beat name instead)
- "at its core", "in many ways", "it is worth noting", "speaks to"

`;
        saText = saText.substring(0, instructionsEnd) + insertion + saText.substring(instructionsEnd);
        s = s.replace(saOriginal, saText);
        console.log('2. Added Story Arc requirements (beat detail, chapter mapping, subplot arcs, cast integrity, banned phrases)');
    } else {
        console.log('2. WARNING: Could not find NEGATIVE CONSTRAINTS in Story Arc');
    }
} else {
    console.log('2. WARNING: Could not find Story Arc node text');
}

// ============================================================
// 3. WORLDBUILDING NODE FIXES
// ============================================================
// The Worldbuilding node may have a very long prompt - find it
const wbNameIdx = s.indexOf('name: "Worldbuilding"');
if (wbNameIdx > -1) {
    // Find the text field for this node
    const wbBlockStart = s.lastIndexOf('@node({', wbNameIdx);
    const afterWbName = s.indexOf('};', wbNameIdx + 500); // skip past the text field

    // Find NEGATIVE CONSTRAINTS in worldbuilding
    const wbText = s.substring(wbNameIdx, afterWbName);
    const wbNegIdx = wbText.indexOf('NEGATIVE CONSTRAINTS:');

    if (wbNegIdx > -1) {
        const absNegIdx = wbNameIdx + wbNegIdx;
        const wbInsertion = `
ADDITIONAL REQUIREMENTS:
- **Sensory Texture Grid:** Each location must include at minimum three sensory details: visual, auditory, and one additional sense (smell, touch, or temperature). No two locations may share the same sensory descriptors.
- **No Character Profiles:** Do not reproduce character descriptions or profiles. Reference characters by name only. This document is for WORLD systems, not character profiles. Do NOT include a Characters section.
- **Faction Power Dynamics:** For each faction, state: who they oppose, who they ally with, what resource or system they control, and their power rank relative to other factions.
- **Technology Limitations:** Each technology or system must include: one hard limitation (what it cannot do) and one exploitable vulnerability (how it can fail or be abused).
- **Governance Enforcement:** Each governance system must include: who enforces it, what the penalty for violation is, and one known loophole or gray area.
- **Unique Descriptors:** No two entries in the same category may share the same descriptive phrases. If you catch yourself reusing "pulsating energy" or "holographic interfaces", stop and invent a fresh detail from DOSSIER SOURCE.

BANNED PHRASES (in addition to PROSE JAIL):
- "highlights the tension between", "showcases the interconnectedness", "underscores the need for"
- "adds layers of complexity", "adds depth to", "reflecting the", "embodying the"
- "creating a sense of", "illustrating the power of"
- Replace ALL such structural commentary with concrete cause-effect statements from the dossier.

`;
        s = s.substring(0, absNegIdx) + wbInsertion + s.substring(absNegIdx);
        console.log('3. Added Worldbuilding requirements (sensory grid, no character profiles, faction dynamics, tech limits, banned phrases)');
    } else {
        console.log('3. WARNING: Could not find NEGATIVE CONSTRAINTS in Worldbuilding');
    }
} else {
    console.log('3. WARNING: Could not find Worldbuilding node');
}

// ============================================================
// 4. CRITIQUE STORY ARC FIXES (add cast integrity check)
// ============================================================
const csaIdx = s.indexOf('name: "Critique Story Arc"');
if (csaIdx > -1) {
    const csaText = s.substring(csaIdx, csaIdx + 5000);
    const csaNegIdx = csaText.indexOf('NEGATIVE CONSTRAINTS:');
    if (csaNegIdx > -1) {
        const absCSANeg = csaIdx + csaNegIdx;
        const csaInsertion = `9. **Cast Integrity:** Flag any character mentioned in the story arc that does NOT appear in CAST MANIFEST. Every named character must originate from the Characters output.
10. **Beat Specificity:** Flag any beat that lacks: a named location, a named systemic mechanism, or a specific character action. Generic beats like "things escalate" must be called out.

`;
        s = s.substring(0, absCSANeg) + csaInsertion + s.substring(absCSANeg);
        console.log('4. Added Critique Story Arc checks (cast integrity, beat specificity)');
    }
}

// ============================================================
// 5. CRITIQUE WORLDBUILDING FIXES (add new checks)
// ============================================================
const cwbIdx = s.indexOf('name: "Critique Worldbuilding"');
if (cwbIdx > -1) {
    const cwbText = s.substring(cwbIdx, cwbIdx + 5000);
    const cwbNegIdx = cwbText.indexOf('NEGATIVE CONSTRAINTS:');
    if (cwbNegIdx > -1) {
        const absCWBNeg = cwbIdx + cwbNegIdx;
        const cwbInsertion = `9. **Character Duplication:** Flag any section that reproduces character profiles. Worldbuilding docs should reference characters by name only.
10. **Sensory Coverage:** Flag any location missing visual, auditory, or tactile details. Each location needs at least 3 distinct sensory details.
11. **Tech Completeness:** Flag any technology or system that lacks stated limitations or vulnerabilities.
12. **Faction Dynamics:** Flag any faction entry missing: opposition, alliances, controlled resources, or power rank.

`;
        s = s.substring(0, absCWBNeg) + cwbInsertion + s.substring(absCWBNeg);
        console.log('5. Added Critique Worldbuilding checks (char duplication, sensory coverage, tech completeness, faction dynamics)');
    }
}

// ============================================================
// SAVE AND REPORT
// ============================================================
const changed = s !== original;
if (changed) {
    fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
    console.log('\nAll fixes applied and saved.');
} else {
    console.log('\nWARNING: No changes were made!');
}

// Quick verify
console.log('\nVerification:');
console.log('  <[CONSTRAINT_TAG]> remaining:', (s.match(/<\[CONSTRAINT_TAG\]>/g) || []).length);
console.log('  [CONSTRAINT_TAG] present:', (s.match(/\[CONSTRAINT_TAG\]/g) || []).length);
console.log('  "ADDITIONAL REQUIREMENTS" in Story Arc:', s.substring(s.indexOf('name: "Story Arc"')).includes('ADDITIONAL REQUIREMENTS'));
console.log('  "Sensory Texture Grid" in Worldbuilding:', s.includes('Sensory Texture Grid'));
console.log('  "Cast Integrity" in Critique Story Arc:', s.substring(s.indexOf('name: "Critique Story Arc"')).includes('Cast Integrity'));
