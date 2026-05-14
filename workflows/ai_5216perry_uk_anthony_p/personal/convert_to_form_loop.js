// Replace auto-loop with manual stop-resume Form node
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
let applied = [];

// ============================================================
// 1. REPLACE CreateBatches code node with ChapterRangeForm
// ============================================================
const oldCreateBatches = `    @node({
        id: "create-batches-001",
        name: "Create Batches",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [1240, 688]
    })
    CreateBatches = {`;

// Find the end of the CreateBatches node (next @node or @links)
const cbIdx = s.indexOf(oldCreateBatches);
if (cbIdx > -1) {
    // Find the closing of this node's property (};)
    // We need to find the end of the jsCode backtick block then };
    const afterCB = s.substring(cbIdx);
    // Find the next @node or @links after CreateBatches
    const nextNodeIdx = afterCB.indexOf('\n    @node({', 10);
    const nextLinksIdx = afterCB.indexOf('\n    @links()', 10);
    let endIdx;
    if (nextNodeIdx > -1 && (nextLinksIdx === -1 || nextNodeIdx < nextLinksIdx)) {
        endIdx = nextNodeIdx;
    } else {
        endIdx = nextLinksIdx;
    }

    const newFormNode = `    @node({
        id: "chapter-range-form-001",
        name: "Chapter Range Form",
        type: "n8n-nodes-base.form",
        version: 1,
        position: [1240, 688]
    })
    ChapterRangeForm = {
        formTitle: "Select Chapter Range",
        formDescription: "Which chapters should be outlined in this batch? After processing, the workflow will pause again for your next batch.",
        formFields: {
            values: [
                {
                    fieldLabel: "Chapter Start",
                    fieldType: "text",
                    requiredField: true,
                    placeholder: "Prologue or 1"
                },
                {
                    fieldLabel: "Chapter End",
                    fieldType: "text",
                    requiredField: true,
                    placeholder: "4 or Epilogue"
                }
            ]
        },
        options: {}
    };
`;

    s = s.substring(0, cbIdx) + newFormNode + s.substring(cbIdx + endIdx);
    applied.push('1. Replaced CreateBatches with ChapterRangeForm (mid-workflow Form node)');
}

// ============================================================
// 2. REPLACE LoopOverBatches SplitInBatches → REMOVE
//    (the Form node IS the pause point — no SplitInBatches needed)
// ============================================================
const oldLoop = `    @node({
        id: "loop-batches-001",
        name: "Loop Over Batches",
        type: "n8n-nodes-base.splitInBatches",
        version: 3,
        position: [1340, 688]
    })
    LoopOverBatches = {
        batchSize: 1,
        options: {}
    };`;

if (s.includes(oldLoop)) {
    s = s.replace(oldLoop, '');
    applied.push('2. Removed LoopOverBatches (SplitInBatches) — Form node handles the pause');
}

// ============================================================
// 3. UPDATE OutlinePrompts: read from ChapterRangeForm instead of LoopOverBatches
// ============================================================
const oldBatchRead = `var batchItem = null;
try { batchItem = $("Loop Over Batches").first().json; } catch(e) {}

let chaptersToOutline;
if (batchItem && batchItem.chapterStart) {
  // Running in batch loop mode
  var chStart = batchItem.chapterStart;
  var chEnd   = batchItem.chapterEnd;`;

const newBatchRead = `var formData = null;
try { formData = $("Chapter Range Form").first().json; } catch(e) {}

let chaptersToOutline;
if (formData && formData["Chapter Start"]) {
  // Running in manual batch loop mode — user specified range via form
  var chStart = formData["Chapter Start"].trim();
  var chEnd   = formData["Chapter End"].trim();`;

if (s.includes(oldBatchRead)) {
    s = s.replace(oldBatchRead, newBatchRead);
    applied.push('3. OutlinePrompts: reads from ChapterRangeForm instead of LoopOverBatches');
}

// ============================================================
// 4. UPDATE ROUTING
// ============================================================
// Old routing:
//   SendToWorldbuildingDoc → CreateBatches → LoopOverBatches
//   LoopOverBatches.out(1) → OutlinePrompts
//   SendToOutlineDoc → LoopOverBatches (loop back)
//
// New routing:
//   SendToWorldbuildingDoc → ChapterRangeForm → OutlinePrompts
//   SendToOutlineDoc → ChapterRangeForm (loop back — form shows again)

const oldRoute1 = `this.SendToWorldbuildingDoc.out(0).to(this.CreateBatches.in(0));
        this.CreateBatches.out(0).to(this.LoopOverBatches.in(0));
        this.LoopOverBatches.out(1).to(this.OutlinePrompts.in(0));`;
const newRoute1 = `this.SendToWorldbuildingDoc.out(0).to(this.ChapterRangeForm.in(0));
        this.ChapterRangeForm.out(0).to(this.OutlinePrompts.in(0));`;

if (s.includes(oldRoute1)) {
    s = s.replace(oldRoute1, newRoute1);
    applied.push('4a. Routing: SendToWorldbuildingDoc → ChapterRangeForm → OutlinePrompts');
}

const oldLoopBack = `this.SendToOutlineDoc.out(0).to(this.LoopOverBatches.in(0));`;
const newLoopBack = `this.SendToOutlineDoc.out(0).to(this.ChapterRangeForm.in(0));`;

if (s.includes(oldLoopBack)) {
    s = s.replace(oldLoopBack, newLoopBack);
    applied.push('4b. Routing: SendToOutlineDoc → ChapterRangeForm (loop back — pauses for next batch)');
}

// ============================================================
// 5. REMOVE "Chapter Batches" field from the main form (no longer needed)
// ============================================================
const batchField = `,
                {
                    fieldLabel: "Chapter Batches",
                    placeholder: "Prologue-3, 4-6, 7-9, 10-Epilogue (each batch runs separately in a loop)"
                }`;

if (s.includes(batchField)) {
    s = s.replace(batchField, '');
    applied.push('5. Removed "Chapter Batches" from main form (now handled by mid-workflow form)');
}

// ============================================================
// SAVE
// ============================================================
console.log('\n=== APPLIED ===');
applied.forEach(a => console.log('  ✅ ' + a));
console.log('\nTotal: ' + applied.length);

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('Saved.');
