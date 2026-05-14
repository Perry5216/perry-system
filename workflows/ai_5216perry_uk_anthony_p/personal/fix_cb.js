const fs = require('fs');

const FILE = '2 - Dossier to Full Outline.workflow.ts';
let src = fs.readFileSync(FILE, 'utf8');

const anchor1 = "output = output.replace(/\\\\n{4,}/g, '\\\\n\\\\n\\\\n').trim();";
const anchor2 = "return [{ json: { output: output } }];`";

const idx1 = src.indexOf(anchor1);
const idx2 = src.indexOf(anchor2);

if (idx1 !== -1 && idx2 !== -1 && idx2 > idx1) {
    const replaceStr = `output = output.replace(/\\\\n{4,}/g, '\\\\n\\\\n\\\\n').trim();

// --- CONTINUITY BIBLE EXTRACTION ---
// 1. Store accumulated Continuity Bibles in persistent static data
const staticData = $getWorkflowStaticData("global");
if (!staticData.continuityBibles) staticData.continuityBibles = [];

// 2. Find and extract Continuity Bible from current chunk
let cbIndex = output.indexOf('## CONTINUITY BIBLE');
if (cbIndex === -1 && output.toLowerCase().indexOf('## continuity bible') !== -1) {
    cbIndex = output.toLowerCase().indexOf('## continuity bible');
}

let bibleText = '';
if (cbIndex !== -1) {
    bibleText = output.substring(cbIndex);
    output = output.substring(0, cbIndex).trim(); // Remove it from the main chapter output
    if (bibleText.trim()) {
        staticData.continuityBibles.push(bibleText.trim());
    }
}

// 3. Determine if this is the final batch
const promptParams = $('Outline Prompts').first().json;
const targetChapters = promptParams.target_chapters || '';
const totalChapters = promptParams.total_chapters || 20;

const chaptersArr = targetChapters.toLowerCase().split(',').map(s => s.trim());
const isFinalBatch = chaptersArr.includes('epilogue') || chaptersArr.includes(String(totalChapters));

// 4. If final batch, append all accumulated Bibles to the output
if (isFinalBatch && staticData.continuityBibles.length > 0) {
    const combinedBible = staticData.continuityBibles.join('\\n\\n---\\n\\n');
    output = output + '\\n\\n' + combinedBible;
    // Clear static data for the next full book run
    staticData.continuityBibles = [];
}
// -----------------------------------

return [{ json: { output: output } }];\``;

    src = src.substring(0, idx1) + replaceStr + src.substring(idx2 + anchor2.length);
    fs.writeFileSync(FILE, src, 'utf8');
    console.log("✅ Successfully patched the Post Process node for Continuity Bible handling.");
} else if (src.includes("staticData.continuityBibles")) {
    console.log("⚠️ Patch was already applied.");
} else {
    console.log("⚠️ Could not find exact search string. idx1:", idx1, "idx2:", idx2);
}
