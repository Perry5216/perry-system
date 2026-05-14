const fs = require('fs');
const s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

function printNode(name) {
    const nodeStart = s.indexOf(`name: "${name}"`);
    if (nodeStart === -1) {
        console.log(`Node ${name} not found`);
        return;
    }
    const declStart = s.lastIndexOf('@node({', nodeStart);
    const nextNode = s.indexOf('@node({', nodeStart + 50);
    const end = nextNode !== -1 ? nextNode : s.length;
    console.log(s.substring(declStart, end).trim() + "\\n");
}

printNode("Get BLANK Character Doc");
printNode("Get BLANK Worldbuilding Doc");
printNode("Get BLANK Outline Doc");
printNode("Get BLANK Story Doc");
