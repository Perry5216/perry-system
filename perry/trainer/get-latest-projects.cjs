const db=require('better-sqlite3')('/app/workspace/.config/projects.db');
const rows = db.prepare('SELECT id, type, title, status FROM projects ORDER BY created_at DESC LIMIT 5').all();
console.log(JSON.stringify(rows, null, 2));
