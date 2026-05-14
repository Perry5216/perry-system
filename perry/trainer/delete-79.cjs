const db=require('better-sqlite3')('/app/workspace/.config/projects.db');
db.prepare(`DELETE FROM steps WHERE project_id='project-79'`).run();
db.prepare(`DELETE FROM projects WHERE id='project-79'`).run();
console.log('Deleted project-79');
