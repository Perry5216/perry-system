const fs = require('fs');
const s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
const idx = s.indexOf('Chapter Selector');
if (idx !== -1) {
    console.log(s.substring(idx - 100, idx + 500));
} else {
    console.log('not found');
}
