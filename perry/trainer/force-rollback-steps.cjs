const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.PERRY_DB || '/app/workspace/.config/projects.db';
const db = new Database(dbPath);

// Find ANY steps from passes 87+ in project-77 and reset them to pending, regardless of status
const steps = db.prepare(`
  SELECT id, label, status FROM steps 
  WHERE project_id = 'project-77' 
  AND (label LIKE '%Pass 87%' OR label LIKE '%Pass 88%' OR label LIKE '%Pass 89%' OR label LIKE '%Pass 90%')
`).all();

console.log(`Found ${steps.length} steps from contaminated passes to force-rollback:`);

const resetStmt = db.prepare(`
  UPDATE steps SET status = 'pending', result = NULL, completed_at = NULL, started_at = NULL, error = NULL
  WHERE project_id = 'project-77' AND id = ?
`);

const tx = db.transaction(() => {
  for (const step of steps) {
    if (step.status !== 'pending') {
      resetStmt.run(step.id);
      console.log(`  Reset: ${step.id} (${step.label}) - was ${step.status}`);
    }
  }
});
tx();

const projectRow = db.prepare(`SELECT data FROM projects WHERE id = 'project-77'`).get();
if (projectRow) {
  const project = JSON.parse(projectRow.data);
  for (const step of project.steps) {
    if (step.label && (step.label.includes('Pass 87') || step.label.includes('Pass 88') || step.label.includes('Pass 89') || step.label.includes('Pass 90'))) {
      step.status = 'pending';
      step.result = undefined;
      step.completedAt = undefined;
      step.startedAt = undefined;
      step.error = undefined;
    }
  }
  
  const completed = project.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
  project.progress = Math.round((completed / project.steps.length) * 100);
  project.status = 'pending';
  
  db.prepare(`UPDATE projects SET data = ? WHERE id = 'project-77'`).run(JSON.stringify(project));
  console.log(`\nProject progress recalculated: ${project.progress}%`);
}

db.close();
console.log('Force rollback complete.');
