const Database = require('better-sqlite3');
const dbPath = process.env.PERRY_DB || '/app/workspace/.config/projects.db';
const db = new Database(dbPath);
const project = JSON.parse(db.prepare(`SELECT data FROM projects WHERE id = 'project-77'`).get().data);
console.log('Total Steps:', project.steps.length);
console.log('First 5 pending/active steps:');
const pending = project.steps.filter(s => s.status === 'pending' || s.status === 'active');
for (let i = 0; i < 5 && i < pending.length; i++) {
  console.log(pending[i].id, pending[i].label, pending[i].status);
}
