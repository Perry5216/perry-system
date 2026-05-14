const Database = require('better-sqlite3');
const db = new Database('d:/n8n/perry/workspace/.config/projects.db');

const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
console.log('Tables:', tables);

// Try to update steps table
try {
  const info = db.prepare(`UPDATE steps SET status = 'pending' WHERE label LIKE '%Pass 23: Action Sample%' AND status IN ('running', 'pending', 'started')`).run();
  console.log('Updated steps table:', info.changes);
} catch (e) {
  console.log(e.message);
}
