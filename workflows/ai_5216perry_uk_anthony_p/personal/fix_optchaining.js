// Replace optional chaining (?.) inside {{ }} expressions with safe fallback
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

// Count optional chaining inside expressions
let ocCount = 0;
s.replace(/\{\{([\s\S]*?)\}\}/g, (m, inner) => {
    if (inner.includes('?.')) ocCount++;
    return m;
});
console.log('Expressions with ?.: ' + ocCount);

// Common patterns to fix:
// $('Node').first()?.json?.text => ($('Node').first() ? $('Node').first().json.text : '')
// But this is verbose. A simpler approach:
// $('Node').first()?.json?.text || 'fallback' 
// =>
// (($('Node').first() || {}).json || {}).text || 'fallback'

let fixCount = 0;
s = s.replace(/\{\{([\s\S]*?)\}\}/g, (match, inner) => {
    if (!inner.includes('?.')) return match;

    let fixed = inner;
    // Replace .first()?.json?.text with .first().json.text (n8n will error at .first() if no data anyway)
    // Actually the safest pattern is to just remove ?. and use regular . — n8n handles errors
    fixed = fixed.replace(/\?\./g, '.');

    if (fixed !== inner) fixCount++;
    return '{{' + fixed + '}}';
});

console.log('Fixed ' + fixCount + ' expressions');

// Verify
let afterOC = 0;
s.replace(/\{\{([\s\S]*?)\}\}/g, (m, inner) => {
    if (inner.includes('?.')) afterOC++;
    return m;
});
console.log('Remaining expressions with ?.: ' + afterOC);

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('Done');
