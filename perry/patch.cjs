const fs = require('fs');
const file = 'd:/n8n/perry/packages/projects/src/templates.ts';
let content = fs.readFileSync(file, 'utf-8');

const target = "const priorPassRef = pass > 1";
if (content.includes(target)) {
  const replacement = `const priorPassRef = (pass > 1
    ? \`\\n\\n## DIRECTIVES FROM PASS \${pass - 1}\\nThe Pass \${pass - 1} Summary step identified specific issues. \` +
      \`Your primary goal this pass is to FIX THOSE ISSUES. \` +
      \`The summary's improvement directives are available in your context — treat them as mandatory constraints.\\n\`
    : '') + \`\\n\\n## STRICT PROSE RULES\\n- NEVER use ellipses (..., ..) or trailing thoughts. End sentences with hard periods.\\n- NEVER use double-dashes (--) or triple-dashes (---). Use proper em-dashes (—) very sparingly, or use periods/commas. These artifacts are lazy and strictly forbidden.\\n\`;
    // Original definition bypassed`;
    
  // Replace just the first part of the definition
  content = content.replace(/const priorPassRef = pass > 1[\s\S]*?: '';/, replacement);
  fs.writeFileSync(file, content, 'utf-8');
  console.log('Replaced successfully.');
} else {
  console.log('Target not found.');
}
