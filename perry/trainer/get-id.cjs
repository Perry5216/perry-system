const db=require('better-sqlite3')('/app/workspace/.config/projects.db');
const rows = db.prepare(`SELECT id FROM projects ORDER BY created_at DESC LIMIT 1`).get();
console.log(rows.id);
