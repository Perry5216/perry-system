const fs = require('fs');

const FILE = 'd:/n8n/workflows/ai_5216perry_uk_8c82d1/personal/2 - Dossier to Full Outline.workflow.ts';
let src = fs.readFileSync(FILE, 'utf8');

const targetStr = `const rwWB = $('Rewrite Worldbuilding').first();
const rwCH = $('Rewrite Characters').first();
const rwSA = $('Rewrite Story Arc').first();
const worldbuildingDoc = (rwWB ? rwWB.json.text : null) || $('Worldbuilding').first().json.text || "[ERROR: No worldbuilding data]";
const characterDoc     = (rwCH ? rwCH.json.text : null) || $('Characters').first().json.text   || "[ERROR: No character data]";
const storySoFar       = (rwSA ? rwSA.json.text : null) || $('Story Arc').first().json.text    || "[ERROR: No story arc data]";`;

const replaceStr = `function getJsonText(nodeName) {
  try { return $(nodeName).first().json.text; } catch (e) { return null; }
}
const worldbuildingDoc = getJsonText('Rewrite Worldbuilding') || getJsonText('Worldbuilding') || "[ERROR: No worldbuilding data]";
const characterDoc     = getJsonText('Rewrite Characters') || getJsonText('Characters')   || "[ERROR: No character data]";
const storySoFar       = getJsonText('Rewrite Story Arc') || getJsonText('Story Arc')    || "[ERROR: No story arc data]";`;

if (src.includes(targetStr)) {
    src = src.replace(targetStr, replaceStr);
    fs.writeFileSync(FILE, src, 'utf8');
    console.log("✅ Successfully patched Outline Prompts to use safe try/catch for node fetching.");
} else {
    console.log("⚠️ Target string not found in file.");

    // Fallback: look for the start of the block
    const idx = src.indexOf("const rwWB = $('Rewrite Worldbuilding').first();");
    if (idx !== -1) {
        console.log("Found start. String in file is:");
        console.log(src.substring(idx, idx + 400));
    }
}
