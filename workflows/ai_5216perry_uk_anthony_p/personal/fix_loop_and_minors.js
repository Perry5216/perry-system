// Fix 1: Replace ChapterRangeForm with SplitInBatches loop
// Fix 2: Expand minor characters and enforce forbidden words on them
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
let applied = [];

// ============================================================
// FIX 1A: Replace ChapterRangeForm with CreateBatches + LoopOverBatches
// ============================================================
const oldFormNode = s.indexOf('id: "chapter-range-form-001"');
if (oldFormNode > -1) {
    // Find the node block boundaries
    const nodeStart = s.lastIndexOf('@node({', oldFormNode);
    const afterNode = s.substring(nodeStart);
    // Find the end of this node's property (};)
    // Need to find the closing }; that ends the property assignment
    const nextNodeOrLinks = afterNode.indexOf('\n    @', 50);

    const newNodes = `@node({
        id: "create-batches-001",
        name: "Create Batches",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [1200, 688]
    })
    CreateBatches = {
        jsCode: \`
// Parse "Chapter Batches" from form into separate items for the loop
var form = $("On form submission").first().json || {};
var batchStr = (form["Chapter Batches"] || "").trim();
var totalChapters = parseInt(form["Total Chapters"], 10) || 20;

var batches = [];
if (batchStr) {
  var parts = batchStr.split(",").map(function(p) { return p.trim(); }).filter(Boolean);
  for (var i = 0; i < parts.length; i++) {
    var range = parts[i].split("-").map(function(r) { return r.trim(); });
    batches.push({
      batchIndex: i,
      chapterStart: range[0] || "1",
      chapterEnd: range[1] || range[0],
      totalBatches: parts.length
    });
  }
} else {
  // No batches — single batch with ALL chapters
  batches.push({
    batchIndex: 0,
    chapterStart: "Prologue",
    chapterEnd: "Epilogue",
    totalBatches: 1
  });
}

return batches.map(function(b) { return { json: b }; });
\`
    };

    @node({
        id: "loop-batches-001",
        name: "Loop Over Batches",
        type: "n8n-nodes-base.splitInBatches",
        version: 3,
        position: [1340, 688]
    })
    LoopOverBatches = {
        batchSize: 1,
        options: {}
    };

`;

    s = s.substring(0, nodeStart) + newNodes + s.substring(nodeStart + nextNodeOrLinks);
    applied.push('1a. Replaced ChapterRangeForm with CreateBatches + LoopOverBatches');
}

// ============================================================
// FIX 1B: Add "Chapter Batches" back to form
// ============================================================
const lockedProfilesField = `                {
                    fieldLabel: "Locked Profiles",
                    fieldType: "textarea"
                }`;

if (s.includes(lockedProfilesField) && !s.includes('"Chapter Batches"')) {
    const withBatchField = lockedProfilesField + `,
                {
                    fieldLabel: "Chapter Batches",
                    placeholder: "Prologue-3, 4-6, 7-9, 10-Epilogue  (leave blank for all chapters in one pass)"
                }`;
    s = s.replace(lockedProfilesField, withBatchField);
    applied.push('1b. Added "Chapter Batches" field back to main form');
}

// ============================================================
// FIX 1C: Update OutlinePrompts to read from LoopOverBatches
// ============================================================
const oldFormRead = `var formData = null;
try { formData = $("Chapter Range Form").first().json; } catch(e) {}

let chaptersToOutline;
if (formData && formData["Chapter Start"]) {
  // Running in manual batch loop mode — user specified range via form
  var chStart = formData["Chapter Start"].trim();
  var chEnd   = formData["Chapter End"].trim();`;

const newLoopRead = `var batchItem = null;
try { batchItem = $("Loop Over Batches").first().json; } catch(e) {}

let chaptersToOutline;
if (batchItem && batchItem.chapterStart) {
  // Running in batch loop mode
  var chStart = batchItem.chapterStart;
  var chEnd   = batchItem.chapterEnd;`;

if (s.includes(oldFormRead)) {
    s = s.replace(oldFormRead, newLoopRead);
    applied.push('1c. OutlinePrompts: reads from LoopOverBatches instead of Form');
}

// ============================================================
// FIX 1D: Update routing
// ============================================================
const oldFormRoute1 = 'this.SendToWorldbuildingDoc.out(0).to(this.ChapterRangeForm.in(0));';
const oldFormRoute2 = 'this.ChapterRangeForm.out(0).to(this.OutlinePrompts.in(0));';
const oldFormLoopBack = 'this.SendToOutlineDoc.out(0).to(this.ChapterRangeForm.in(0));';

const newRoute1 = 'this.SendToWorldbuildingDoc.out(0).to(this.CreateBatches.in(0));';
const newRoute2 = `this.CreateBatches.out(0).to(this.LoopOverBatches.in(0));
        this.LoopOverBatches.out(1).to(this.OutlinePrompts.in(0));`;
const newLoopBack = 'this.SendToOutlineDoc.out(0).to(this.LoopOverBatches.in(0));';

if (s.includes(oldFormRoute1)) {
    s = s.replace(oldFormRoute1, newRoute1);
    applied.push('1d-i. Routing: SendToWorldbuildingDoc → CreateBatches');
}
if (s.includes(oldFormRoute2)) {
    s = s.replace(oldFormRoute2, newRoute2);
    applied.push('1d-ii. Routing: CreateBatches → LoopOverBatches → OutlinePrompts');
}
if (s.includes(oldFormLoopBack)) {
    s = s.replace(oldFormLoopBack, newLoopBack);
    applied.push('1d-iii. Routing: SendToOutlineDoc → LoopOverBatches (loop back)');
}

// ============================================================
// FIX 2A: EXPAND minor characters from "4-6" to "6-8" in Characters prompt 
//         and fix the Rewrite cap from 3 to 8
// ============================================================
// Characters prompt: "4–6 minor characters" → "6–8 minor characters"
if (s.includes('5–7 major characters, 2–3 supporting characters, 4–6 minor characters')) {
    s = s.replace(
        '5–7 major characters, 2–3 supporting characters, 4–6 minor characters',
        '5–7 major characters, 2–3 supporting characters, 6–8 minor characters'
    );
    applied.push('2a-i. Characters prompt: minor chars 4-6 → 6-8');
}

if (s.includes('For minor characters (4–6):')) {
    s = s.replace('For minor characters (4–6):', 'For minor characters (6–8):');
    applied.push('2a-ii. Characters format section: 4-6 → 6-8');
}

// Cast size instruction
if (s.includes('and 4 minor characters')) {
    s = s.replace('and 4 minor characters', 'and 6 minor characters');
    applied.push('2a-iii. Cast size minimum: 4 → 6 minor characters');
}

// Rewrite hard constraint: "Maximum 3 minor characters" → "Maximum 8 minor characters"
if (s.includes('Maximum 3 minor characters')) {
    s = s.replace('Maximum 3 minor characters', 'Maximum 8 minor characters');
    applied.push('2a-iv. Rewrite: minor cap 3 → 8');
}

// ============================================================
// FIX 2B: Expand minor character template with forbidden words enforcement
// ============================================================
const oldMinorTemplate = `### Minor Characters:
* [NAME]: [single-line paragraph of 4–6 complete sentences — background, core desire, relationship to a major character, one PLOT_BEAT_TAGS citation — no dialogue, no quirk, no style]`;

const newMinorTemplate = `### Minor Characters:
Generate 6–8 minor characters. Each must:
- Have a name that does NOT appear in ENTITY_NAMES or FORBIDDEN WORDS
- NOT duplicate a name from your training data
- Have a distinct structural role (informant, gatekeeper, mirror, rival, trickster, messenger, obstacle, witness)
- Be connected to at least one major character

* [NAME]: [single-line paragraph of 4–6 complete sentences — physical detail, background, core desire, relationship to a major character, one PLOT_BEAT_TAGS citation, and the specific plot beat where they appear. No dialogue, no quirk, no style.]`;

// This appears twice (Characters prompt + Rewrite prompt)
let replaceCount = 0;
while (s.includes(oldMinorTemplate)) {
    s = s.replace(oldMinorTemplate, newMinorTemplate);
    replaceCount++;
}
if (replaceCount > 0) {
    applied.push('2b. Expanded minor character template with forbidden words enforcement + structural roles (' + replaceCount + ' instances)');
}

// Also fix the sparse one in Rewrite if different
const oldMinorRewrite = `### Minor Characters:
* [NAME]: [single-line full paragraph of 4`;
const newMinorRewrite = `### Minor Characters:
Generate 6-8 minor characters. Each must have a name not in ENTITY_NAMES or FORBIDDEN WORDS, a distinct structural role, and a connection to a major character.

* [NAME]: [single-line full paragraph of 4`;

if (s.includes(oldMinorRewrite)) {
    s = s.replace(oldMinorRewrite, newMinorRewrite);
    applied.push('2b-ii. Rewrite minor character template: added forbidden words + role enforcement');
}

// ============================================================
// FIX 2C: Add explicit forbidden words rule for minor characters
// ============================================================
// In the ANTI-HALLUCINATION section, add minor character specific rule
const antiHallucOld = `- Do NOT use any character name from your training data. Invent original names grounded in the world's culture.`;
const antiHallucNew = `- Do NOT use any character name from your training data. Invent original names grounded in the world's culture.
- MINOR CHARACTERS are subject to ALL the same naming rules: no ENTITY_NAMES, no FORBIDDEN WORDS, no training-data names. Every minor character name must be original and world-textured.`;

if (s.includes(antiHallucOld)) {
    s = s.replace(antiHallucOld, antiHallucNew);
    applied.push('2c. Added explicit minor character naming rule to anti-hallucination section');
}

// ============================================================
// SAVE
// ============================================================
console.log('\n=== APPLIED ===');
applied.forEach(a => console.log('  ✅ ' + a));
console.log('\nTotal: ' + applied.length);

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('Saved.');
