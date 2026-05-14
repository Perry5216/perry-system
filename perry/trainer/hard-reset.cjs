const Database = require('better-sqlite3');
const db = new Database('/app/workspace/.config/projects.db');

// Update steps table
db.prepare(`UPDATE steps SET status = 'pending', result = NULL, completed_at = NULL, started_at = NULL, error = NULL WHERE project_id = 'project-77' AND id >= 'step-1119'`).run();

// Update projects table blob
const row = db.prepare(`SELECT data FROM projects WHERE id = 'project-77'`).get();
const project = JSON.parse(row.data);
let changed = 0;
for (const step of project.steps) {
  const stepIdNum = parseInt(step.id.replace('step-', ''), 10);
  if (stepIdNum >= 1119) {
    step.status = 'pending';
    step.result = null;
    step.completedAt = null;
    step.startedAt = null;
    step.error = null;
    changed++;
  }
}
const completed = project.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
project.progress = Math.round((completed / project.steps.length) * 100);
project.status = 'pending';

db.prepare(`UPDATE projects SET data = ? WHERE id = 'project-77'`).run(JSON.stringify(project));

console.log(`Hard reset complete. Changed ${changed} steps in project blob.`);
