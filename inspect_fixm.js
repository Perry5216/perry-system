const fs = require('fs');
const content = fs.readFileSync('d:/n8n/workflows/ai_5216perry_uk_anthony_p/personal/1 - Braindump to Dossier.workflow.ts', 'utf8');
const idx = content.indexOf('Fix M:');
// Show the full Fix M block raw (no JSON.stringify so we see actual chars)
const chunk = content.slice(idx, idx + 800);
// Print char by char for the regex lines
let inLine = false;
let lineStart = idx;
for (let i = idx; i < idx + 800; i++) {
  if (content[i] === '\n' || (content.charCodeAt(i) === 92 && content.charCodeAt(i+1) === 110)) {
    // end of line
  }
}
// Just show the raw content with JSON.stringify
console.log(JSON.stringify(chunk));
