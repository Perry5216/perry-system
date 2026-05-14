const fs = require('fs');
let code = fs.readFileSync('d:\\\\n8n\\\\workflows\\\\ai_5216perry_uk_anthony_p\\\\personal\\\\1 - Braindump to Dossier.workflow.ts', 'utf8');

// The issue is ```json inside template literals. We can just change it to 'json' to be absolutely safe across all quotes.
code = code.replace(/```json/g, "'json'").replace(/```/g, "'''");

fs.writeFileSync('d:\\\\n8n\\\\workflows\\\\ai_5216perry_uk_anthony_p\\\\personal\\\\1 - Braindump to Dossier.workflow.ts', code, 'utf8');
console.log('Fixed backticks!');
