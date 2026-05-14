const db=require('better-sqlite3')('/app/workspace/.config/projects.db');
const row = db.prepare(`SELECT prompt, result FROM steps WHERE project_id='project-79' AND id='step-5'`).get();
if (row) {
  console.log("PROMPT HAS PREFLIGHT:", row.prompt.includes('<pre_flight>'));
  console.log("RESULT HAS PREFLIGHT:", row.result.includes('<pre_flight>'));
} else {
  console.log("step-5 not found");
}
