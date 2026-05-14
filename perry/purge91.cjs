const db = new (require('better-sqlite3'))('/app/workspace/memory/memory.db');

// Find project-91 entries
const rows = db.prepare("SELECT DISTINCT project_id FROM entries WHERE project_id LIKE '%91%' OR project_id LIKE '%cal%'").all();
console.log('Memory entries for project-91:', JSON.stringify(rows));

// Delete them
const del = db.prepare("DELETE FROM entries WHERE project_id LIKE '%91%' OR project_id LIKE '%cal%'");
const result = del.run();
console.log('Deleted rows:', result.changes);

db.close();
console.log('Done.');
