const db=require('better-sqlite3')('/app/workspace/.config/projects.db');
console.log(db.prepare(`SELECT result FROM steps WHERE id='step-1'`).get().result);
