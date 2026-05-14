// Implement all 8 strategic enhancements
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
const original = s;
let applied = [];

// ============================================================
// #1: SCENE BREAKDOWN — Word budgets, pacing tags, scene weight
// ============================================================
const sbOldFormat = `**Scene [N]:**
- Setting: [specific location]
- Characters: [names from cast]
- Goal: [what the focal character wants in this scene]
- Conflict: [what opposes the goal]
- Beat Sequence: [2-4 micro-beats]
- Exit Hook: [how the scene ends / what propels us forward]`;

const sbNewFormat = `**Scene [N]:**
- Setting: [specific location from WORLDBUILDING]
- Characters: [names from cast manifest]
- Goal: [what the focal character wants in this scene]
- Conflict: [what opposes the goal]
- Beat Sequence: [2-4 micro-beats]
- Exit Hook: [how the scene ends / what propels us forward]
- Word Budget: [estimated word count for this scene, e.g. 800-1200]
- Pacing: [action / tension / reflection / transition]
- Scene Weight: [major / supporting / transitional]`;

if (s.includes(sbOldFormat)) {
    s = s.replace(sbOldFormat, sbNewFormat);
    applied.push('#1 Scene Breakdown: word budgets, pacing, scene weight');
} else {
    console.log('#1 WARN: Could not find Scene Breakdown format block');
}

// ============================================================
// #2: GHOSTWRITER BRIEF — Chapter-to-chapter handoff section
// ============================================================
const gbOldRepeat = `### Prose Directives
[constraints]
---

[Repeat the full block for every chapter.]`;

const gbNewRepeat = `### Prose Directives
[constraints]

### Handoff to Next Chapter
- Open threads: [unresolved plot or character threads the next chapter MUST address]
- Character positions: [where each character physically is at chapter end]
- Knowledge states: [what each character knows or has learned by chapter end]
- Time position: [when this chapter ends relative to story timeline]
- Props and McGuffins: [any objects introduced, moved, or used in this chapter]
- Emotional carryover: [dominant unresolved emotion each POV character carries into next chapter]
---

[Repeat the full block for every chapter.]`;

if (s.includes(gbOldRepeat)) {
    s = s.replace(gbOldRepeat, gbNewRepeat);
    applied.push('#2 Ghostwriter Brief: chapter-to-chapter handoff section');
} else {
    console.log('#2 WARN: Could not find Ghostwriter Brief repeat block');
}

// ============================================================
// #3: CHARACTERS — Per-act emotion trajectory
// ============================================================
// Add after the Emotion Profile field (field 0) in the format template
const charOldField0 = `* Emotion Profile -- [initial stat cluster (rate each stat named in EMOTION SYSTEM GUARDRAILS:
: high/medium/low)]. [§8 Internal Voice Map default register at story start]. [§4 Act 1 Baseline].`;

const charNewField0 = `* Emotion Profile -- [initial stat cluster (rate each stat named in EMOTION SYSTEM GUARDRAILS:
: high/medium/low)]. [§8 Internal Voice Map default register at story start]. [§4 Act 1 Baseline].
* Act Trajectory -- Act 1: [stat snapshot + dominant emotion] -> Midpoint: [shift trigger from story arc + new stats] -> Act 3: [crisis stats + cascade risk] -> Resolution: [final emotional state]. One line.`;

if (s.includes(charOldField0)) {
    s = s.replace(charOldField0, charNewField0);
    applied.push('#3 Characters: per-act emotion trajectory field');
} else {
    console.log('#3 WARN: Could not find Characters emotion profile field');
}

// ============================================================
// #4: WORLDBUILDING — Structured sensory card format
// ============================================================
// Find the Worldbuilding node and add sensory card format requirement
// The Worldbuilding node is a long prompt so we need to find its specific structure
const wbFormatIdx = s.indexOf('name: "Worldbuilding"');
if (wbFormatIdx > -1) {
    // Find the ADDITIONAL REQUIREMENTS we already added
    const afterWB = s.substring(wbFormatIdx, wbFormatIdx + 15000);
    const sensoryGridIdx = afterWB.indexOf('**Sensory Texture Grid:**');
    if (sensoryGridIdx > -1) {
        const oldSensory = '**Sensory Texture Grid:** Each location must include at minimum three sensory details: visual, auditory, and one additional sense (smell, touch, or temperature). No two locations may share the same sensory descriptors.';
        const newSensory = `**Sensory Texture Grid:** Each location must use this exact card format:
  **[Location Name]**
  - Visual: [what you see first]
  - Auditory: [dominant sound]
  - Tactile/Temperature: [what you feel on skin]
  - Smell: [if distinctive]
  - Mood: [emotional register of the space -- ominous, clinical, warm, etc.]
  No two locations may share the same sensory descriptors.`;
        if (s.includes(oldSensory)) {
            s = s.replace(oldSensory, newSensory);
            applied.push('#4 Worldbuilding: structured sensory card format');
        } else {
            console.log('#4 WARN: Could not find exact Sensory Texture Grid text');
        }
    } else {
        console.log('#4 WARN: Could not find Sensory Texture Grid in Worldbuilding');
    }
} else {
    console.log('#4 WARN: Could not find Worldbuilding node');
}

// ============================================================
// #5: CONTINUITY BIBLE — will be added as a code node later
// ============================================================
// This requires adding a new node definition, which is complex.
// We will handle this separately.

// ============================================================
// #6: OUTLINE PROMPTS — First/last line anchors
// ============================================================
// The Outline Prompts code node generates the prompt. 
// Find where the chapter format is defined and add anchors.
const outlineFormatOld = `### CHAPTER [N]: [Title]`;
// Find the one in the OutlinePrompts code node (around line 2970+)
const opNodeIdx = s.indexOf('name: "Outline Prompts"');
if (opNodeIdx > -1) {
    const opBlock = s.substring(opNodeIdx, opNodeIdx + 5000);
    if (opBlock.includes('### CHAPTER [N]: [Title]')) {
        // Find the exact context — the format section
        const formatSectionOld = `### CHAPTER [N]: [Title]
[4-6 narrative beats per chapter. Each beat is a single line.]`;
        const formatSectionNew = `### CHAPTER [N]: [Title]
**Opening Image:** [The first visual or sensory moment the reader encounters in this chapter]
[4-6 narrative beats per chapter. Each beat is a single line.]
**Closing Hook:** [The exact tension point, question, or emotional cliffhanger that propels into the next chapter]`;

        if (s.includes(formatSectionOld)) {
            s = s.replace(formatSectionOld, formatSectionNew);
            applied.push('#6 Outline Prompts: opening image + closing hook anchors');
        } else {
            console.log('#6 WARN: Could not find exact format section in Outline Prompts');
            // Try a more targeted replacement
            const opStart = s.indexOf('### CHAPTER [N]: [Title]', opNodeIdx);
            if (opStart > -1) {
                const lineEnd = s.indexOf('\n', opStart);
                const nextLine = s.substring(lineEnd + 1, s.indexOf('\n', lineEnd + 1));
                console.log('#6 DEBUG: next line after format is:', nextLine.trim().substring(0, 80));
            }
        }
    } else {
        console.log('#6 WARN: CHAPTER format not found in Outline Prompts node');
    }
}

// Also add anchors to the Prologue/Epilogue format
const prologueOld = `### PROLOGUE: [Title]`;
const prologueNew = `### PROLOGUE: [Title]
**Opening Image:** [The very first visual or sensory moment that sets the world]`;
if (s.includes(prologueOld)) {
    // Only replace the one in the OutlinePrompts block (there might be multiple)
    const opIdx2 = s.indexOf('name: "Outline Prompts"');
    const prologueIdxInOP = s.indexOf(prologueOld, opIdx2);
    if (prologueIdxInOP > -1 && prologueIdxInOP < opIdx2 + 5000) {
        s = s.substring(0, prologueIdxInOP) + prologueNew + s.substring(prologueIdxInOP + prologueOld.length);
        applied.push('#6b Outline Prompts: prologue opening image anchor');
    }
}

// ============================================================
// #7: GHOSTWRITER BRIEF — Dialogue distribution map
// ============================================================
const voiceLayerOld = `### Voice Layer
[POV directives]`;

const voiceLayerNew = `### Voice Layer
[POV directives]

### Dialogue Map
- Speaking characters: [names in order of dialogue screen-time]
- Dialogue ratio: [heavy (60%+) / balanced (30-60%) / narration-heavy (less than 30%)]
- Key exchange: [the single most important dialogue beat -- who says what to whom about what]`;

if (s.includes(voiceLayerOld)) {
    s = s.replace(voiceLayerOld, voiceLayerNew);
    applied.push('#7 Ghostwriter Brief: dialogue distribution map');
} else {
    console.log('#7 WARN: Could not find Voice Layer block in Ghostwriter Brief');
}

// ============================================================
// #8: FORESHADOWING PLANNER — Mirror/echo pattern
// ============================================================
const fhOldInstr = `Analyse CONTINUITY CHECKED OUTLINE:
and identify the 5-10 most impactful revelations, reversals, or emotional payoffs. For each, design 1-2 foreshadowing seeds to plant in earlier chapters.`;

const fhNewInstr = `Analyse CONTINUITY CHECKED OUTLINE:
and identify the 5-10 most impactful revelations, reversals, or emotional payoffs. For each, design 1-2 foreshadowing seeds to plant in earlier chapters.

ECHO PATTERN SEEDS (in addition to plot foreshadowing):
For each major theme from DOSSIER SOURCE, identify one recurring image, phrase, or sensory detail that echoes across at least 3 chapters -- appearing in different contexts to build thematic resonance without being plot-functional.
Example: If the theme is "loss of identity" -- a mirror appearing in Ch 2 (clear reflection), Ch 8 (cracked mirror), Ch 14 (no reflection at all).
Output echo patterns in this format:
**Echo: [Theme]** -- [image/detail] -- appears in Ch [N] as [context], Ch [N] as [context], Ch [N] as [context].`;

if (s.includes(fhOldInstr)) {
    s = s.replace(fhOldInstr, fhNewInstr);
    applied.push('#8 Foreshadowing Planner: mirror/echo pattern seeds');
} else {
    console.log('#8 WARN: Could not find foreshadowing instruction block');
}

// ============================================================
// SAVE AND REPORT
// ============================================================
console.log('\n=== APPLIED ===');
applied.forEach(a => console.log('  ✅ ' + a));
console.log('\nTotal: ' + applied.length + '/8');

if (s !== original) {
    fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
    console.log('\nSaved.');
} else {
    console.log('\nWARNING: No changes made!');
}
