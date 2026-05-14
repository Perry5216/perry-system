const fs = require('fs');
const file = 'd:/n8n/perry/packages/projects/src/templates.ts';
let src = fs.readFileSync(file, 'utf8');

// Fix 1: Bad garbled characters -> encode cleanly
src = src.replace(/â€”/g, '—');
src = src.replace(/â€™/g, '\'');
src = src.replace(/â€˜/g, '\'');
src = src.replace(/â†’/g, '→');
src = src.replace(/â”€/g, '─');
src = src.replace(/Ã©/g, 'é');

// Fix 2: Novel Pipeline POV Check Verdict
src = src.replace(
  /(- \*\*Issues\*\*: \[list any POV breaks, head-hopping, or other problems\])/g,
  '$1\\n- **Verdict**: PASS / REVISE / REWRITE'
);

// Fix 3: Revision Execution POV Check Verdict
src = src.replace(
  /(- \*\*AI-Isms Found\*\*: \[list any Rule of Three, explicit dialogue tags, nominalization, adjective stacking, or participles, or \"None\"\])/g,
  '$1\\n- **Verdict**: PASS / REVISE / REWRITE'
);

// Fix 4: Deep Revision Verdict string
src = src.replace(
  /\*\*Verdict:\*\* PASS \/ REVISE \/ REWRITE/g,
  'Verdict: PASS / REVISE / REWRITE'
);

// Fix 5: Epilogue Stat Update
src = src.replace(
  /(## E\. Subplot Tracker \(Final Audit\)\\n` \+\r?\n\s*`List all subplots: RESOLVED \/ SEQUEL HOOK \/ [^\n]+\r?\n)/g,
  '$1' +
  '        `## F. Relationship Dynamics (ONLY pairs who interacted in the Epilogue)\\n` +\\n' +
  '        `Update dynamic only if they had a scene together.\\n` +\\n' +
  '        `Output: Character 1 | Character 2 | Old Dynamic | New Dynamic | Trigger Event\\n\\n` +\\n' +
  '        `## G. NARRATIVE DIRECTIVES (SCOPED to Sequel hook ONLY)\\n` +\\n' +
  '        `If there are direct sequel hooks, outline them here. Otherwise output NONE.`,\n'
);

// Remove the erroneous comma that was in the original epilogue prompt
src = src.replace(
  /(## E\. Subplot Tracker \(Final Audit\)\\n` \+\r?\n\s*`List all subplots: RESOLVED \/ SEQUEL HOOK \/ [^\`]+`),\r?\n/g,
  '$1 +\n'
);

// Fix 6: Book Cover key
src = src.replace(
  /const bookCover: ProjectTemplate = {\r?\n\s*type: 'custom',/g,
  'const bookCover: ProjectTemplate = {\n  type: \'book-cover\','
);

fs.writeFileSync(file, src, 'utf8');
console.log('Template fixes applied.');
