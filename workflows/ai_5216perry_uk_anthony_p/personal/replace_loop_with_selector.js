// Replace CreateBatches + LoopOverBatches with a single Chapter Selector code node
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
let applied = [];

// ============================================================
// 1. REPLACE CreateBatches + LoopOverBatches with ChapterSelector
// ============================================================
// Find CreateBatches node
const cbMarker = 'id: "create-batches-001"';
const cbIdx = s.indexOf(cbMarker);
if (cbIdx > -1) {
    const nodeStart = s.lastIndexOf('@node({', cbIdx);
    // Find the end of LoopOverBatches (the next node after it)
    const loopMarker = 'id: "loop-batches-001"';
    const loopIdx = s.indexOf(loopMarker);
    if (loopIdx > -1) {
        // Find end of LoopOverBatches node block
        const afterLoop = s.substring(loopIdx);
        const nextSection = afterLoop.indexOf('\n    @');
        const loopEnd = loopIdx + nextSection;

        // New single code node
        const chapterSelector = `@node({
        id: "chapter-selector-001",
        name: "Chapter Selector",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [1280, 688]
    })
    ChapterSelector = {
        jsCode: \`
// ╔════════════════════════════════════════════════════════════════╗
// ║  CHAPTER SELECTOR — Edit the values below to control         ║
// ║  which chapters the enrichment pipeline processes.           ║
// ║                                                               ║
// ║  Examples:                                                    ║
// ║    "Prologue,1,2,3,4"        → Prologue through Chapter 4   ║
// ║    "5,6,7,8"                  → Chapters 5 through 8         ║
// ║    "9,10,11,12,Epilogue"      → Chapters 9-12 + Epilogue    ║
// ║    ""                         → ALL chapters (full run)      ║
// ╚════════════════════════════════════════════════════════════════╝

var CHAPTERS = "Prologue,1,2,3,4";    // ← EDIT THIS LINE

// Pass everything through to OutlinePrompts
return [{ json: {
  selectedChapters: CHAPTERS
}}];
\`
    };

`;

        s = s.substring(0, nodeStart) + chapterSelector + s.substring(loopEnd);
        applied.push('1. Replaced CreateBatches + LoopOverBatches with ChapterSelector code node');
    }
}

// ============================================================
// 2. UPDATE OutlinePrompts to read from ChapterSelector
// ============================================================
const oldLoopRead = `var batchItem = null;
try { batchItem = $("Loop Over Batches").first().json; } catch(e) {}

let chaptersToOutline;
if (batchItem && batchItem.chapterStart) {
  // Running in batch loop mode
  var chStart = batchItem.chapterStart;
  var chEnd   = batchItem.chapterEnd;
  var startNum = chStart.toLowerCase() === "prologue" ? 0 : parseInt(chStart, 10);
  var endNum   = chEnd.toLowerCase() === "epilogue" ? totalChapters + 1 : parseInt(chEnd, 10);
  var chapters = [];
  if (startNum === 0) chapters.push("Prologue");
  for (var ci = Math.max(1, startNum); ci <= Math.min(totalChapters, endNum); ci++) {
    chapters.push(String(ci));
  }
  if (endNum > totalChapters) chapters.push("Epilogue");
  chaptersToOutline = chapters.join(",");
} else {
  // Legacy mode: read from form "Chapters to Outline" or outline all
  var rawChapters = (form["Chapters to Outline"] || "").trim();
  if (rawChapters) {
    var custom = rawChapters;
    if (!custom.toLowerCase().includes("prologue")) custom = "Prologue," + custom;
    if (!custom.toLowerCase().includes("epilogue")) custom = custom + ",Epilogue";
    chaptersToOutline = custom;
  } else {
    var chapterList = ["Prologue"];
    for (var j = 1; j <= totalChapters; j++) chapterList.push(String(j));
    chapterList.push("Epilogue");
    chaptersToOutline = chapterList.join(",");
  }
}`;

const newSelectorRead = `// --- READ CHAPTER RANGE FROM CHAPTER SELECTOR --------------------------------
var selectorData = null;
try { selectorData = $("Chapter Selector").first().json; } catch(e) {}

let chaptersToOutline;
if (selectorData && selectorData.selectedChapters && selectorData.selectedChapters.trim()) {
  // Chapter Selector specified which chapters to outline
  chaptersToOutline = selectorData.selectedChapters.trim();
} else {
  // Fallback: read from form "Chapters to Outline" or outline all
  var rawChapters = (form["Chapters to Outline"] || "").trim();
  if (rawChapters) {
    var custom = rawChapters;
    if (!custom.toLowerCase().includes("prologue")) custom = "Prologue," + custom;
    if (!custom.toLowerCase().includes("epilogue")) custom = custom + ",Epilogue";
    chaptersToOutline = custom;
  } else {
    var chapterList = ["Prologue"];
    for (var j = 1; j <= totalChapters; j++) chapterList.push(String(j));
    chapterList.push("Epilogue");
    chaptersToOutline = chapterList.join(",");
  }
}`;

if (s.includes(oldLoopRead)) {
    s = s.replace(oldLoopRead, newSelectorRead);
    applied.push('2. OutlinePrompts: reads from ChapterSelector (with form fallback)');
}

// ============================================================
// 3. UPDATE ROUTING
// ============================================================
// Old: CreateBatches → LoopOverBatches → OutlinePrompts, SendToOutlineDoc → LoopOverBatches
// New: ChapterSelector → OutlinePrompts, SendToOutlineDoc is terminal (no loop)

const oldRoute1 = 'this.SendToWorldbuildingDoc.out(0).to(this.CreateBatches.in(0));';
const newRoute1 = 'this.SendToWorldbuildingDoc.out(0).to(this.ChapterSelector.in(0));';
if (s.includes(oldRoute1)) {
    s = s.replace(oldRoute1, newRoute1);
    applied.push('3a. Routing: SendToWorldbuildingDoc → ChapterSelector');
}

const oldRoute2 = `this.CreateBatches.out(0).to(this.LoopOverBatches.in(0));
        this.LoopOverBatches.out(1).to(this.OutlinePrompts.in(0));`;
const newRoute2 = 'this.ChapterSelector.out(0).to(this.OutlinePrompts.in(0));';
if (s.includes(oldRoute2)) {
    s = s.replace(oldRoute2, newRoute2);
    applied.push('3b. Routing: ChapterSelector → OutlinePrompts');
}

// Remove the loop-back
const oldLoopBack = `this.SendToOutlineDoc.out(0).to(this.LoopOverBatches.in(0));`;
if (s.includes(oldLoopBack)) {
    s = s.replace(oldLoopBack, '// No loop — pipeline runs once per execution for the selected chapters');
    applied.push('3c. Removed loop-back (pipeline runs once, re-run workflow for next batch)');
}

// ============================================================
// 4. REMOVE "Chapter Batches" form field (not needed anymore)
// ============================================================
const batchField = `,
                {
                    fieldLabel: "Chapter Batches",
                    placeholder: "Prologue-3, 4-6, 7-9, 10-Epilogue  (leave blank for all chapters in one pass)"
                }`;
if (s.includes(batchField)) {
    s = s.replace(batchField, '');
    applied.push('4. Removed "Chapter Batches" form field');
}

// ============================================================
// SAVE
// ============================================================
console.log('\n=== APPLIED ===');
applied.forEach(a => console.log('  ✅ ' + a));
console.log('\nTotal: ' + applied.length);

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('Saved.');
