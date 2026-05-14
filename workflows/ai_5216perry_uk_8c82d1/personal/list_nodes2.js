const fs = require('fs');
const s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
const rx = /name:\s*[\"']([^\"']+)[\"']/g;
let match;
while ((match = rx.exec(s)) !== null) {
    console.log(match[1]);
}
