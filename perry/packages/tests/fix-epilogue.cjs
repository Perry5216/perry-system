const fs = require('fs');
const file = 'd:/n8n/perry/packages/projects/src/templates.ts';
const src = fs.readFileSync(file, 'utf8');
const lines = src.split('\n');

lines.splice(608, 7,
'        `List all subplots: RESOLVED / SEQUEL HOOK / ⚠️ DROPPED\\n\\n` +',
'        `## F. Relationship Dynamics (ONLY pairs who interacted in the Epilogue)\\n` +',
'        `Update dynamic only if they had a scene together.\\n` +',
'        `Output: Character 1 | Character 2 | Old Dynamic | New Dynamic | Trigger Event\\n\\n` +',
'        `## G. NARRATIVE DIRECTIVES (SCOPED to Sequel hook ONLY)\\n` +',
'        `If there are direct sequel hooks, outline them here. Otherwise output NONE.`,\n        { chapterNumber: chapters + 1 }));'
);

fs.writeFileSync(file, lines.join('\n'), 'utf8');
