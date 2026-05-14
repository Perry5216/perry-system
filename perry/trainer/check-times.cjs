const Database = require('better-sqlite3');
const dbPath = process.env.PERRY_DB || '/app/workspace/.config/projects.db';
const db = new Database(dbPath);
const project = JSON.parse(db.prepare(`SELECT data FROM projects WHERE id = 'project-77'`).get().data);
const steps = project.steps.filter(s => s.id === 'step-1119' || s.id === 'step-1120' || s.id === 'step-1130' || s.id === 'step-1144');
for (const step of steps) {
  console.log(step.id, step.label, step.status, step.completedAt);
}
