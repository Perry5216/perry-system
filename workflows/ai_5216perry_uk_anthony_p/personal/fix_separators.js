const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

// Fix all remaining corrupted separator comments
// Pattern: // Ã¢â€â‚¬...LABEL...Ã¢â€â‚¬...
s = s.replace(/\/\/ [Ã][^\n]*/g, (match) => {
    // Extract the label text between the corrupted chars
    const cleaned = match.replace(/[Ã¢â€â‚¬]+/g, '').replace(/—/g, '-').trim();
    // The cleaned text after "//" gives us the label
    const label = cleaned.replace(/^\/\/\s*/, '').trim();
    if (!label) return '// ' + '-'.repeat(75);
    return '// --- ' + label + ' ' + '-'.repeat(Math.max(0, 71 - label.length));
});

const remaining = (s.match(/Ã/g) || []).length;
console.log('Remaining corrupted chars:', remaining);
fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('Done');
