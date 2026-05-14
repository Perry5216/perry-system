const fs = require('fs');
const path = 'd:/n8n/perry/packages/projects/src/templates.ts';
const content = fs.readFileSync(path, 'utf-8');

// Step 1: Undo the previous broken edit by reverting the renumbering
// Current state: steps 6,7,8,9,10 were renamed to 11,12,13,14,15 AND the new steps 7,8,9,10 also got renamed
// We need to fix: restore step(12 -> step(7, step(13 -> step(8, etc in the OLD steps section

// Actually, easier approach: the content is now broken. Let me find the original content pattern.
// The new steps use 'voice_profile' as taskType; the old steps use 'outline' or 'book_bible'.
// Let me find and fix the World Building step which should be step(11) but got mangled.

// Find all step calls and their line positions
const lines = content.split('\n');
const stepPattern = /step\((\d+),\s*'([^']+)'/;

let stepMap = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(stepPattern);
  if (m) {
    stepMap.push({ line: i, num: parseInt(m[1]), label: m[2] });
  }
}

console.log('Current steps:');
stepMap.forEach(s => console.log(`  Line ${s.line}: step(${s.num}, '${s.label}')`));

// The correct numbering should be:
// 1: Market & Genre Analysis
// 2: Develop Premise  
// 3: Faction Bible
// 4: Character Bible
// 5: Voice Profile
// 6: Influence Map (NEW)
// 7: Vocabulary Fingerprint (NEW)
// 8: Structural Habits (NEW)
// 9: Dialogue Fingerprint (NEW)
// 10: Thematic Obsessions (NEW)
// 11: World Building
// 12: Subplots & Faction Arcs
// 13: Chapter-by-Chapter Outline
// 14: Tension Blueprint
// 15: Foreshadowing & Payoff Map

// Fix each step number based on its label
const labelToNum = {
  'Market & Genre Analysis': 1,
  'Develop Premise': 2,
  'Faction Bible': 3,
  'Character Bible': 4,
  'Voice Profile': 5,
  'Influence Map': 6,
  'Vocabulary Fingerprint': 7,
  'Structural Habits': 8,
  'Dialogue Fingerprint': 9,
  'Thematic Obsessions': 10,
  'World Building': 11,
  'Subplots & Faction Arcs': 12,
  'Chapter-by-Chapter Outline': 13,
  'Tension Blueprint': 14,
  'Foreshadowing & Payoff Map': 15,
};

let result = content;
for (const s of stepMap) {
  const correctNum = labelToNum[s.label];
  if (correctNum && correctNum !== s.num) {
    // Replace only this specific occurrence
    const oldPattern = `step(${s.num}, '${s.label}'`;
    const newPattern = `step(${correctNum}, '${s.label}'`;
    result = result.replace(oldPattern, newPattern);
    console.log(`Fixed: step(${s.num} -> step(${correctNum}, '${s.label}'`);
  }
}

fs.writeFileSync(path, result, 'utf-8');
console.log('\nDone! Verifying...');

// Verify
const verify = fs.readFileSync(path, 'utf-8');
const verifySteps = [];
verify.split('\n').forEach((line, i) => {
  const m = line.match(stepPattern);
  if (m) verifySteps.push({ num: parseInt(m[1]), label: m[2] });
});
verifySteps.forEach(s => console.log(`  step(${s.num}, '${s.label}')`));
