const fs = require('fs');
const content = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

const regex = /name: "([^"]+)"/g;
let match;
const names = [];

while ((match = regex.exec(content)) !== null) {
    names.push(match[1]);
}

console.log('Nodes found:', names.length);
console.log(names.join('\n'));
