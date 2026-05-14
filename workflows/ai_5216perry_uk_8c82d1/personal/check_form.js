const fs = require('fs');
const s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
const idx = s.indexOf('OnFormSubmission = {');
console.log(s.substring(idx - 100, idx + 1500));
