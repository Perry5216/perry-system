const fs = require('fs');
let code = fs.readFileSync('d:\\\\n8n\\\\workflows\\\\ai_5216perry_uk_anthony_p\\\\personal\\\\1 - Braindump to Dossier.workflow.ts', 'utf8');

const mapping = [
    { oldPath: 'BuildDossierWorld', newId: 'ScrubWorld', newName: 'Scrub Dossier: World', targetName: 'Build Dossier: World', posX: 800, posY: 0 },
    { oldPath: 'BuildDossierCharacters', newId: 'ScrubCharacters', newName: 'Scrub Dossier: Characters', targetName: 'Build Dossier: Characters', posX: 800, posY: 64 },
    { oldPath: 'BuildDossierPlotArcs', newId: 'ScrubPlotArcs', newName: 'Scrub Dossier: Plot & Arcs', targetName: 'Build Dossier: Plot & Arcs', posX: 800, posY: 128 },
    { oldPath: 'BuildDossierTropes', newId: 'ScrubTropes', newName: 'Scrub Dossier: Tropes', targetName: 'Build Dossier: Tropes', posX: 800, posY: 192 },
    { oldPath: 'BuildDossierSubplot', newId: 'ScrubSubplot', newName: 'Scrub Dossier: Subplot', targetName: 'Build Dossier: Subplot', posX: 800, posY: 256 }
];

let nodeObjects = '';
mapping.forEach(m => {
    nodeObjects += `
    @node({
        name: '${m.newName}',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [${m.posX}, ${m.posY}]
    })
    ${m.newId} = {
        jsCode: \`let raw = $input.item.json.text || "";
let clean = raw;
let match = raw.match(/\\{[\\\\s\\\\S]*\\}/);
if (match) {
    clean = match[0];
}
return [{ json: { text: clean } }];\`
    };
`;
});

// 1. Inject the nodes before the final closing brace
let lastBraceIdx = code.lastIndexOf('}');
code = code.substring(0, lastBraceIdx) + nodeObjects + code.substring(lastBraceIdx);

// 2. Change the routing map
// From: this.BuildDossierWorld.out(0).to(this.MergeDossier.in(0));
// To: this.BuildDossierWorld.out(0).to(this.ScrubWorld.in(0));
//     this.ScrubWorld.out(0).to(this.MergeDossier.in(0));
mapping.forEach(m => {
    const oldRoute = `this.${m.oldPath}.out(0).to(this.MergeDossier.in(0));`;
    const newRoute = `this.${m.oldPath}.out(0).to(this.${m.newId}.in(0));\\n        this.${m.newId}.out(0).to(this.MergeDossier.in(0));`;
    // Also handle possible whitespace differences
    const regex = new RegExp(`this\\.${m.oldPath}\\.out\\(0\\)\\.to\\(this\\.MergeDossier\\.in\\(0\\)\\);`, 'g');
    code = code.replace(regex, newRoute);
});

// 3. Update MergeDossier references
mapping.forEach(m => {
    const oldRef = `$("BUILD DOSSIER: ${m.targetName.split(': ')[1].toUpperCase()}").item.json.text`; // Wait, JS properties are case sensitive inside $() inside MergeDossier.
    // The previous script showed it was `$("Build Dossier: World").item.json.text`
    let safeTargetName = m.targetName.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\\\$&');
    let regex = new RegExp(`\\$\\("${safeTargetName}"\\)\\.item\\.json\\.text`, 'g');
    code = code.replace(regex, `\\$("${m.newName}").item.json.text`);
});

fs.writeFileSync('d:\\\\n8n\\\\workflows\\\\ai_5216perry_uk_anthony_p\\\\personal\\\\1 - Braindump to Dossier.workflow.ts', code);
console.log('Scrubbers injected successfully!');
