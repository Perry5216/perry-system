const fs = require('fs');

const fileContent = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

const lines = fileContent.split(/\r?\n/);
const nodes = [];

let insideNode = false;
let currentNodeLines = [];
let currentNodeName = "";
let currentNodeVar = "";

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '@node({') {
        insideNode = true;
        currentNodeLines = [line];
        currentNodeName = "";
        currentNodeVar = "";
        continue;
    }

    if (insideNode) {
        currentNodeLines.push(line);

        const nameMatch = line.match(/\bname:\s*["']([^"']+)["']/);
        if (nameMatch && !currentNodeName) {
            currentNodeName = nameMatch[1];
        }

        if (line.match(/^\s+[A-Za-z0-9_]+\s*=\s*\{\s*$/) || line.match(/^\s+[A-Za-z0-9_]+\s*=\s*.*\[$/)) {
            currentNodeVar = line.trim().split(' ')[0];
        }

        if (line.trim() === '};') {
            insideNode = false;
            nodes.push({
                name: currentNodeName,
                varName: currentNodeVar
            });
        }
    }
}

console.log("Parsed Nodes:");
console.log(nodes.map(n => n.name).join(', '));
