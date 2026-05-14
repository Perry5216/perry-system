const fs = require('fs');
let code = fs.readFileSync('d:\\\\n8n\\\\workflows\\\\ai_5216perry_uk_anthony_p\\\\personal\\\\1 - Braindump to Dossier.workflow.ts', 'utf8');

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        let r = Math.random() * 16 | 0;
        let v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const scrubbers = ['World', 'Characters', 'Plot & Arcs', 'Tropes', 'Subplot'];

scrubbers.forEach(cleanName => {
    let searchPattern = new RegExp(`(@node\\(\\{\\s+)(name: 'Scrub Dossier: ${cleanName}',)`, 'g');
    code = code.replace(searchPattern, `$1id: '${uuid()}',\\n        $2`);
});

fs.writeFileSync('d:\\\\n8n\\\\workflows\\\\ai_5216perry_uk_anthony_p\\\\personal\\\\1 - Braindump to Dossier.workflow.ts', code, 'utf8');
console.log('Injected IDs');
