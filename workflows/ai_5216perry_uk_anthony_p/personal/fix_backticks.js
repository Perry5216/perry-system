const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');
const lines = s.split('\n');

// L3710: warnings.push(`WARN: profile_override...`) → warnings.push(\`WARN: profile_override...\`)
lines[3709] = '  warnings.push(\\`WARN: profile_override "\\${profileOverride}" not recognised \\u2014 used creative_max.\\`);';

// L3714-3715: warnings.push(`WARN: braindump short...`) → single-line escaped
lines[3713] = '  warnings.push(\\`WARN: braindump short (\\${braindumpRaw.length} chars) \\u2014 results may be generic.\\`);';
lines[3714] = ''; // remove continuation line

s = lines.join('\n');
// Clean up any double blank lines created
s = s.replace(/\n\n\n+/g, '\n\n');

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('Fixed: escaped backticks in warnings.push');

// Verify
const after = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8').split('\n');
console.log('L3710:', after[3709].trim().substring(0, 100));
console.log('L3714:', after[3713].trim().substring(0, 100));
