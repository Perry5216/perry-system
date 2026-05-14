// Fix PROFILE INSTRUCTION ternary expressions:
// Change the ternary pattern to use single quotes for the outer strings
// so that double quotes inside don't break parsing.
//
// Pattern: {{ $("...").first().json.active_profile.label === "heavy" ? "content with \"quotes\"" : "other content" }}
// Fix:     {{ $("...").first().json.active_profile.label === "heavy" ? 'content with "quotes"' : 'other content' }}

const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

// First let me extract all problematic ternaries and understand their structure
const vm = require('vm');
const exprRegex = /\{\{([\s\S]*?)\}\}/g;
let match;
let problemExprs = [];
let exprCount = 0;

while ((match = exprRegex.exec(s)) !== null) {
    exprCount++;
    const expr = match[1].trim();

    if (!expr.includes('=== "heavy"') && !expr.includes("=== 'heavy'")) continue;

    try {
        new Function('$', 'return ' + expr);
    } catch (e) {
        problemExprs.push({
            index: match.index,
            length: match[0].length,
            full: match[0],
            inner: match[1]
        });
    }
}

console.log(`Total expressions: ${exprCount}`);
console.log(`Problem ternaries: ${problemExprs.length}`);

// For each problem ternary, I need to:
// 1. Find the ? and : that separate the branches
// 2. Wrap each branch in single quotes instead of double quotes
// But this is tricky because the branches contain both ' and " characters.

// Simpler approach: extract the two branches and escape properly.
// Actually the simplest fix: the issue is that these expressions have embedded " 
// inside ternary " strings. The solution is to use backtick ` template literals
// for the ternary branches — but n8n might not support those either.

// Alternative: Since these expressions are SO long (the ternary string branches 
// contain entire paragraphs), the cleanest fix is to REMOVE the ternary from 
// the expression entirely, and move the profile branching to the text itself.
//
// Instead of: {{ expr ? "long text A" : "long text B" }}
// Use:
// {{ $(\"Universal Config\").first().json.active_profile.label }}
// And put the conditional text OUTSIDE the expression with an IF construct
// that n8n supports: {{ $if(condition, "a", "b") }}
//
// But actually, the BEST approach is to keep it simple: Just remove all " from
// inside the ternary branches. Use ' (which is safe inside " delimiters):

let fixCount = 0;
let newS = s;

for (const pe of problemExprs.reverse()) { // reverse to not shift indices
    let inner = pe.inner;

    // Strategy: Find the ternary pattern and escape the inner double quotes
    // The pattern is: condition ? "branch1 text" : "branch2 text"
    // Each branch may contain e.g. "Midpoint" which breaks parsing

    // Replace the OUTER double quotes of the ternary branches with single quotes
    // Pattern: ? "..." : "..."
    // The ? is followed by optional whitespace then "
    // The : is preceded by " and optional whitespace

    // Actually let me just convert all double quotes INSIDE the ternary branches 
    // (not the comparison "heavy") to escaped \" or use ' instead

    // Find the ternary split point:
    // after === "heavy"\n  ? "
    // The first " after ? is the start of branch 1
    // Then we need to find the matching " that ends branch 1 (tricky with unescaped " inside)

    // Simplest fix: Convert the entire ternary to use backtick-wrapped branches
    // But n8n might not support template literals inside {{ }}

    // Actually, let me try: swap the outer quotes of each branch to single quotes,
    // and inside each branch convert single quotes to escaped \' 
    // BUT — does n8n support \' inside expressions?

    // There's a much cleaner approach. Since the ternary branches are just TEXT
    // (instructions the LLM reads), I can:
    // 1. Remove all literal " from inside the branches (replace with ')
    // 2. Then the structure ? "..." : "..." will parse correctly

    // Actually THE issue is that `new Function()` (and n8n's parser) sees the " 
    // inside the string and thinks the string ended. So I need to find all " inside
    // the ternary branches and replace them with '.

    // The ternary is: 
    //   $(...) === "heavy"\n  ? "BRANCH1"\n  : "BRANCH2"
    // I need to find BRANCH1 and BRANCH2 text and replace " with ' inside them.

    // Since this is complex, let me parse manually:
    const heavyIdx = inner.indexOf('=== "heavy"');
    if (heavyIdx === -1) continue;

    const afterHeavy = inner.substring(heavyIdx + '=== "heavy"'.length);

    // Find ? "
    const qMarkMatch = afterHeavy.match(/\?\s*"/);
    if (!qMarkMatch) continue;

    const branch1Start = heavyIdx + '=== "heavy"'.length + qMarkMatch.index + qMarkMatch[0].length;

    // Now I need to find the matching " for branch 1 — but there are unescaped " inside.
    // This is the core problem. I can't reliably find the end.
    // 
    // But I know the structure ends with: "..."\n  : "..."\n  }}
    // So the colon : is preceded by a newline and whitespace.
    // Let me find the pattern: "\n  : " (end of branch 1, start of branch 2)

    const colonPattern = /"\s*\n\s*:\s*"/;
    const colonMatch = inner.substring(branch1Start).match(colonPattern);
    if (!colonMatch) {
        console.log(`Could not find colon separator for ternary`);
        continue;
    }

    const branch1EndRel = colonMatch.index;
    const branch1Text = inner.substring(branch1Start, branch1Start + branch1EndRel);

    // Branch 2 starts after the colon match
    const branch2Start = branch1Start + branch1EndRel + colonMatch[0].length;
    // Branch 2 ends at the last " before end of inner
    const branch2EndRel = inner.lastIndexOf('"');
    const branch2Text = inner.substring(branch2Start, branch2EndRel);

    // Now replace " with ' inside both branches
    const fixedBranch1 = branch1Text.replace(/"/g, "'");
    const fixedBranch2 = branch2Text.replace(/"/g, "'");

    // Reconstruct
    const fixedInner = inner.substring(0, branch1Start)
        + fixedBranch1
        + inner.substring(branch1Start + branch1EndRel, branch2Start)
        + fixedBranch2
        + inner.substring(branch2EndRel);

    // Verify it parses now
    try {
        new Function('$', 'return ' + fixedInner.trim());
        console.log(`FIXED ternary (now parses OK)`);
        fixCount++;
    } catch (e) {
        console.log(`STILL BROKEN after fix: ${e.message}`);
        console.log(`  First 200 chars: ${fixedInner.trim().substring(0, 200)}`);
        continue; // Don't apply broken fix
    }

    // Replace in the full string
    const fullFixed = '{{' + fixedInner + '}}';
    newS = newS.substring(0, pe.index) + fullFixed + newS.substring(pe.index + pe.length);
}

console.log(`\nFixed ${fixCount} ternaries`);

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', newS, 'utf8');
console.log('Saved');
