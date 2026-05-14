const fs = require('fs');

const fileContent = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

function extractNodeDecl(name) {
    const nameStr = `name: "${name}"`;
    const idx = fileContent.indexOf(nameStr);
    if (idx === -1) return null;

    // Find preceding @node
    const startIdx = fileContent.lastIndexOf('@node', idx);
    if (startIdx === -1) return null;

    // Find next @node or @links
    let endIdx = fileContent.indexOf('@node', startIdx + 10);
    const linkIdx = fileContent.indexOf('@links', startIdx + 10);
    if (endIdx === -1) endIdx = linkIdx;
    else if (linkIdx !== -1 && linkIdx < endIdx) endIdx = linkIdx;

    if (endIdx === -1) endIdx = fileContent.length - 2;

    return fileContent.substring(startIdx, endIdx).trim();
}

console.log("Outline matches:", extractNodeDecl("Outline")?.length);
console.log("Outline Prompts matches:", extractNodeDecl("Outline Prompts")?.length);
