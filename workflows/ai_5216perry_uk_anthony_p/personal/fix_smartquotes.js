// Fix smart quotes and optional chaining inside {{ }} expressions
const fs = require('fs');
let s = fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8');

// Count issues before
const smartDoubleL = (s.match(/\u201c/g) || []).length;
const smartDoubleR = (s.match(/\u201d/g) || []).length;
const smartSingleL = (s.match(/\u2018/g) || []).length;
const smartSingleR = (s.match(/\u2019/g) || []).length;
console.log('Before fix:');
console.log(`  Smart double quotes: ${smartDoubleL} left + ${smartDoubleR} right = ${smartDoubleL + smartDoubleR}`);
console.log(`  Smart single quotes: ${smartSingleL} left + ${smartSingleR} right = ${smartSingleL + smartSingleR}`);

// Replace smart quotes with straight quotes ONLY inside {{ }} expressions
// But actually, smart quotes can appear in prompt TEXT (outside {{ }}) and those are fine.
// The issue is smart quotes INSIDE expressions where JS evaluates them.

// Strategy: Replace all {{ }} blocks, fixing quotes inside them
let fixCount = 0;
s = s.replace(/\{\{([\s\S]*?)\}\}/g, (match, inner) => {
    let fixed = inner;
    // Replace smart double quotes with straight
    fixed = fixed.replace(/[\u201c\u201d]/g, '"');
    // Replace smart single quotes with straight
    fixed = fixed.replace(/[\u2018\u2019]/g, "'");
    // Replace optional chaining with safe fallback pattern
    // $('Node').first()?.json?.text => ($('Node').first() || {}).json?.text is NOT simpler
    // Actually n8n supports ?. in newer versions. Let's NOT touch it unless it's the actual cause.

    if (fixed !== inner) {
        fixCount++;
    }
    return '{{' + fixed + '}}';
});

console.log(`\nFixed ${fixCount} expressions with smart quotes`);

// Verify
const afterSmartDoubleL = (s.match(/\u201c/g) || []).length;
const afterSmartDoubleR = (s.match(/\u201d/g) || []).length;
const afterSmartSingleL = (s.match(/\u2018/g) || []).length;
const afterSmartSingleR = (s.match(/\u2019/g) || []).length;
console.log('\nAfter fix:');
console.log(`  Smart double quotes: ${afterSmartDoubleL} left + ${afterSmartDoubleR} right = ${afterSmartDoubleL + afterSmartDoubleR}`);
console.log(`  Smart single quotes: ${afterSmartSingleL} left + ${afterSmartSingleR} right = ${afterSmartSingleL + afterSmartSingleR}`);

// Check that regular prompt text still has the original smart quotes (outside {{ }})
// (They may or may not exist outside expressions — just reporting)
console.log(`\n  Remaining smart quotes are in prompt text (not inside expressions) — those are fine.`);

fs.writeFileSync('2 - Dossier to Full Outline.workflow.ts', s, 'utf8');
console.log('Done - file saved');
