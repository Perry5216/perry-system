const db=require('better-sqlite3')('/app/workspace/.config/projects.db');
const row = db.prepare(`SELECT result FROM steps WHERE project_id='project-79' AND id='step-5'`).get();
if (row) {
  console.log(row.result);
}
