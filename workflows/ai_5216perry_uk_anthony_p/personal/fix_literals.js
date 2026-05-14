const fs = require('fs');
let code = fs.readFileSync('d:\\\\n8n\\\\workflows\\\\ai_5216perry_uk_anthony_p\\\\personal\\\\1 - Braindump to Dossier.workflow.ts', 'utf8');

code = code.replace(/\\n\s+this\.Scrub/g, '\n        this.Scrub');

fs.writeFileSync('d:\\\\n8n\\\\workflows\\\\ai_5216perry_uk_anthony_p\\\\personal\\\\1 - Braindump to Dossier.workflow.ts', code, 'utf8');
console.log('Fixed literal newlines');
