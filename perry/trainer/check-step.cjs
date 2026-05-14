const Database = require('better-sqlite3');
const dbPath = process.env.PERRY_DB || '/app/workspace/.config/projects.db';
const db = new Database(dbPath);

const row = db.prepare(`SELECT status, prompt FROM steps WHERE id='step-1119'`).get();
console.log('Status:', row.status);
console.log('Prompt contains strict rules:', row.prompt.includes('STRICT PROSE RULES'));
