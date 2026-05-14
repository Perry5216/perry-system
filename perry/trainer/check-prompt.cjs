const db = require('better-sqlite3')('/app/workspace/.config/projects.db');
const project = JSON.parse(db.prepare(`SELECT data FROM projects WHERE id='project-77'`).get().data);
console.log(project.steps.find(s=>s.id==='step-1119').prompt.includes('STRICT PROSE RULES'));
