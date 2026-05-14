// Fix corrupted em-dashes and ternary quote issues inside {{ }} expressions
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

let fixCount = 0;
let emDashCount = 0;

// Fix all {{ }} expressions that have issues
s = s.replace(/\{\{([\s\S]*?)\}\}/g, (match, inner) => {
    let fixed = inner;

    // Fix 1: Corrupted em-dash â€" (UTF-8 mojibake for —)
    if (fixed.includes('\u00e2\u0080\u201c') || fixed.includes('â€"') || fixed.includes('â€"')) {
        fixed = fixed.replace(/â€"/g, '--');
        fixed = fixed.replace(/â€"/g, '--');
        emDashCount++;
    }

    // Fix 2: Actual em-dash — inside expressions (replace with --)
    if (fixed.includes('\u2014')) {
        fixed = fixed.replace(/\u2014/g, '--');
        emDashCount++;
    }

    // Fix 3: En-dash – inside expressions  
    if (fixed.includes('\u2013')) {
        fixed = fixed.replace(/\u2013/g, '-');
        emDashCount++;
    }

    if (fixed !== inner) fixCount++;
    return '{{' + fixed + '}}';
});

console.log(`Fixed ${fixCount} expressions (${emDashCount} with em-dash issues)`);

// Now check: the ternary PROFILE INSTRUCTION expressions have double quotes inside double quotes.
// Pattern: {{ $("...").first().json.active_profile.label === "heavy" ? "You are..." : "You are..." }}
// The outer {{ }} makes this a JS expression. The \" inside JS strings should work IF 
// the n8n template engine doesn't get confused by them.
// Actually the issue is that the text field uses backticks ` so the " inside are fine for JS—  
// but n8n's expression parser might not handle multi-line ternary with all the embedded quotes.
// Let me check if the ternary expressions actually have unmatched quotes.

const ternaryRegex = /\{\{[\s\S]*?===\s*"heavy"[\s\S]*?\}\}/g;
const ternaries = s.match(ternaryRegex) || [];
console.log(`\nFound ${ternaries.length} ternary PROFILE INSTRUCTION expressions`);

ternaries.forEach((t, i) => {
    // Count quotes to see if balanced
    const doubleQuotes = (t.match(/"/g) || []).length;
    const singleQuotes = (t.match(/'/g) || []).length;
    console.log(`  Ternary #${i + 1}: ${doubleQuotes} double quotes, ${singleQuotes} single quotes, length=${t.length}`);
    // Check for em-dashes
    if (t.includes('—') || t.includes('–')) {
        console.log(`    WARNING: Contains em/en-dash`);
    }
});

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('\nDone');
