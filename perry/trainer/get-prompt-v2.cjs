const db=require('better-sqlite3')('/app/workspace/.config/projects.db');
const rows = db.prepare(`SELECT id, prompt FROM steps WHERE project_id = 'project-79-cal-model-2' LIMIT 5`).all();
console.log(JSON.stringify(rows.map(r => ({id: r.id, prompt: r.prompt.substring(0, 500) + '...'})), null, 2));
