// Fix ALL special characters inside {{ }} expressions
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

let fixCount = 0;
s = s.replace(/\{\{([\s\S]*?)\}\}/g, (match, inner) => {
    let fixed = inner;

    // Replace em-dash — with --
    fixed = fixed.replace(/\u2014/g, '--');
    // Replace en-dash – with -
    fixed = fixed.replace(/\u2013/g, '-');
    // Replace ellipsis … with ...
    fixed = fixed.replace(/\u2026/g, '...');
    // Replace smart double quotes
    fixed = fixed.replace(/[\u201c\u201d]/g, '"');
    // Replace smart single quotes  
    fixed = fixed.replace(/[\u2018\u2019]/g, "'");
    // Replace corrupted em-dash â€"
    fixed = fixed.replace(/â€"/g, '--');
    fixed = fixed.replace(/â€"/g, '--');
    // Replace corrupted en-dash â€"
    fixed = fixed.replace(/â€"/g, '-');
    // Replace any remaining â€ pattern
    fixed = fixed.replace(/â€˜/g, "'");
    fixed = fixed.replace(/â€™/g, "'");
    fixed = fixed.replace(/â€œ/g, '"');
    fixed = fixed.replace(/â€\u009d/g, '"');
    // em-dash œ pattern leftover (from corrupted —)
    fixed = fixed.replace(/\u0153/g, '-');

    if (fixed !== inner) fixCount++;
    return '{{' + fixed + '}}';
});

console.log(`Fixed ${fixCount} expressions`);

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('Saved. Running deep audit...');
