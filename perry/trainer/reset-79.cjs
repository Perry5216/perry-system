const Database = require('better-sqlite3');
const db = new Database('/app/workspace/.config/projects.db');

db.prepare(`UPDATE steps SET status='pending', result=NULL, completed_at=NULL WHERE project_id='project-79-cal-model-2'`).run();

const row = db.prepare(`SELECT data FROM projects WHERE id='project-79-cal-model-2'`).get();
if (row) {
  const project = JSON.parse(row.data);
  for (const step of project.steps) {
    step.status = 'pending';
    step.result = undefined;
    step.completedAt = undefined;
  }
  project.progress = 0;
  project.status = 'pending';
  db.prepare(`UPDATE projects SET data=? WHERE id='project-79-cal-model-2'`).run(JSON.stringify(project));
}
