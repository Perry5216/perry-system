// Add chapter batch loop to WF2
// Adds: CreateBatches code node, SplitInBatches node
// Modifies: Form (add Chapter Batches field), OutlinePrompts (read current batch),
//           Routing (add loop-back), SendToOutlineDoc (no change needed — insert already appends)
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
let applied = [];

// ============================================================
// 1. ADD "Chapter Batches" field to form
// ============================================================
const formFieldsEnd = `                {
                    fieldLabel: "Locked Profiles",
                    fieldType: "textarea"
                }`;

const formFieldsNew = `                {
                    fieldLabel: "Locked Profiles",
                    fieldType: "textarea"
                },
                {
                    fieldLabel: "Chapter Batches",
                    placeholder: "Prologue-3, 4-6, 7-9, 10-Epilogue (each batch runs separately in a loop)"
                }`;

if (s.includes(formFieldsEnd)) {
    s = s.replace(formFieldsEnd, formFieldsNew);
    applied.push('1. Added "Chapter Batches" field to form');
}

// ============================================================
// 2. ADD CreateBatches code node + LoopOverBatches SplitInBatches node
//    Insert BEFORE the routing section
// ============================================================
const newNodes = `
    // =====================================================================
    // CHAPTER BATCH LOOP INFRASTRUCTURE
    // =====================================================================
    @node({
        id: "create-batches-001",
        name: "Create Batches",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [1240, 688]
    })
    CreateBatches = {
        jsCode: \`
// Parse "Chapter Batches" from form into separate items for SplitInBatches
var form = $("On form submission").first().json || {};
var batchStr = (form["Chapter Batches"] || "").trim();
var totalChapters = parseInt(form["Total Chapters"], 10) || 20;

var batches = [];
if (batchStr) {
  // User specified batches like "Prologue-3, 4-6, 7-9, 10-Epilogue"
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
  // No batches specified — single batch with ALL chapters
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

// Insert before the routing section
const routingMarker = '    @links()\n    defineRouting() {';
if (s.includes(routingMarker)) {
    s = s.replace(routingMarker, newNodes + routingMarker);
    applied.push('2. Added CreateBatches + LoopOverBatches nodes');
}

// ============================================================
// 3. MODIFY OutlinePrompts code to read from current batch item
// ============================================================
// Replace the chaptersToOutline logic to use the batch item
const oldChapterLogic = `const rawChapters     = (form["Chapters to Outline"] || "").trim();

// If user left "Chapters to Outline" blank, auto-generate full range
// Always includes Prologue and Epilogue bookending the numbered chapters
let chaptersToOutline;
if (rawChapters) {
  // If user specified chapters, still bookend with Prologue/Epilogue if not present
  let custom = rawChapters;
  if (!custom.toLowerCase().includes("prologue")) custom = "Prologue," + custom;
  if (!custom.toLowerCase().includes("epilogue")) custom = custom + ",Epilogue";
  chaptersToOutline = custom;
} else {
  const chapterList = ["Prologue"];
  for (let i = 1; i <= totalChapters; i++) chapterList.push(String(i));
  chapterList.push("Epilogue");
  chaptersToOutline = chapterList.join(",");
}`;

const newChapterLogic = `// --- BATCH-AWARE CHAPTER RANGE -----------------------------------------------
// Read from the current Loop Over Batches item if running in batch mode.
// Falls back to form "Chapters to Outline" or full range if no batch data.
var batchItem = null;
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

if (s.includes(oldChapterLogic)) {
    s = s.replace(oldChapterLogic, newChapterLogic);
    applied.push('3. Modified OutlinePrompts: reads from batch loop item (with legacy fallback)');
} else {
    console.log('WARN: Could not find exact chapter logic in OutlinePrompts');
}

// ============================================================
// 4. MODIFY ROUTING: Add batch loop
// ============================================================
// Current: SendToWorldbuildingDoc → OutlinePrompts
// New:     SendToWorldbuildingDoc → CreateBatches → LoopOverBatches
//          LoopOverBatches.out(1) → OutlinePrompts  (batch item output)
//          SendToOutlineDoc → LoopOverBatches       (loop back)

// Replace the old direct connection
const oldRoute = 'this.SendToWorldbuildingDoc.out(0).to(this.OutlinePrompts.in(0));';
const newRoute = `this.SendToWorldbuildingDoc.out(0).to(this.CreateBatches.in(0));
        this.CreateBatches.out(0).to(this.LoopOverBatches.in(0));
        this.LoopOverBatches.out(1).to(this.OutlinePrompts.in(0));`;
if (s.includes(oldRoute)) {
    s = s.replace(oldRoute, newRoute);
    applied.push('4a. Routing: SendToWorldbuildingDoc → CreateBatches → LoopOverBatches → OutlinePrompts');
}

// Add loop-back: SendToOutlineDoc → LoopOverBatches
const oldPostRoute = 'this.PostProcess.out(0).to(this.SendToOutlineDoc.in(0));';
const newPostRoute = `this.PostProcess.out(0).to(this.SendToOutlineDoc.in(0));
        this.SendToOutlineDoc.out(0).to(this.LoopOverBatches.in(0));`;
if (s.includes(oldPostRoute)) {
    s = s.replace(oldPostRoute, newPostRoute);
    applied.push('4b. Routing: SendToOutlineDoc → LoopOverBatches (loop back)');
}

// ============================================================
// SAVE
// ============================================================
console.log('\n=== APPLIED ===');
applied.forEach(a => console.log('  ✅ ' + a));
console.log('\nTotal: ' + applied.length);

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('Saved.');
