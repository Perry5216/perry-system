// Fix newlines inside double-quoted strings in ternary expressions
// The pattern is:
// {{ $("...").first().json.active_profile.label === "heavy"
//   ? "You are in HIGH DEPTH mode ... CAST MANIFEST:
// and specific dossier mechanisms..."
//   : "You are in FAST mode..." }}
//
// The newline between CAST MANIFEST: and "and specific..." is INSIDE
// the double-quoted string, which is illegal in JavaScript.
// Fix: join lines within the ternary string so there are no newlines 
// between opening " and closing " of each branch.

const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

// Strategy: Find each {{ ... "heavy" ... ? "..." : "..." }}
// and ensure no newlines inside the " " strings of the branches.

// Approach: Find the PROFILE INSTRUCTION pattern and fix each occurrence
// Pattern:  {{ $("Universal Config")...label === "heavy"\n  ? "BRANCH1"\n  : "BRANCH2" }}

// The pattern in the file is:
// {{ $(...) === "heavy"
//   ? "text that may wrap
// across lines"
//   : "text" }}

// Let's use a targeted approach: find each occurrence of '? "' after 'heavy"' 
// and then collect characters until we find '"' followed by newline+spaces+':', 
// removing any newlines within.

let fixCount = 0;

// Find all PROFILE INSTRUCTION blocks
const piRegex = /(\{\{\s*\$\(["']Universal Config["']\)\.(?:first\(\)|item)\.json\.active_profile\.label\s*===\s*"heavy"\s*\n\s*\?\s*")([\s\S]*?)("\s*\n\s*:\s*")([\s\S]*?)("\s*\}\})/g;

let match;
while ((match = piRegex.exec(s)) !== null) {
    const [full, prefix, branch1, separator, branch2, suffix] = match;

    // Check if branches contain newlines
    const b1HasNL = branch1.includes('\n');
    const b2HasNL = branch2.includes('\n');

    if (b1HasNL || b2HasNL) {
        // Fix: replace newlines with spaces in both branches
        const fixedB1 = branch1.replace(/\n\s*/g, ' ');
        const fixedB2 = branch2.replace(/\n\s*/g, ' ');
        const fixedFull = prefix + fixedB1 + separator + fixedB2 + suffix;

        s = s.substring(0, match.index) + fixedFull + s.substring(match.index + full.length);

        // Adjust regex lastIndex since string length may have changed
        piRegex.lastIndex = match.index + fixedFull.length;

        fixCount++;
        console.log(`Fixed ternary at index ${match.index} (branch1 lines: ${branch1.split('\n').length}, branch2 lines: ${branch2.split('\n').length})`);
    }
}

console.log(`\nTotal fixed: ${fixCount}`);

// Verify with deep_audit
const vm = require('vm');
const exprRegex2 = /\{\{([\s\S]*?)\}\}/g;
let m2;
let errors = 0;
while ((m2 = exprRegex2.exec(s)) !== null) {
    const expr = m2[1].trim();
    if (!expr.includes('heavy')) continue;
    try {
        new Function('$', 'return ' + expr);
    } catch (e) {
        errors++;
        console.log(`STILL BROKEN: ${e.message}: ${expr.substring(0, 100)}`);
    }
}
console.log(`\nRemaining broken ternaries: ${errors}`);

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('Saved');
