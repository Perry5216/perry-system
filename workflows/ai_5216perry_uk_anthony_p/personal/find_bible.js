const fs = require('fs');
const text = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
const lines = text.split('\n');

lines.forEach((line, i) => {
    if (line.includes('CONTINUITY BIBLE') || line.includes('APPENDIX')) {
        console.log(`Line ${i + 1}:`);
        console.log(lines.slice(Math.max(0, i - 15), Math.min(lines.length, i + 15)).join('\n'));
        console.log('--------------------------------------------------');
    }
});
