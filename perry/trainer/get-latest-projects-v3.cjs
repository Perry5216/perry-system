const db=require('better-sqlite3')('/app/workspace/.config/projects.db');
const rows = db.prepare('SELECT id, data FROM projects ORDER BY created_at DESC LIMIT 5').all();
const out = rows.map(r => { const p = JSON.parse(r.data); return { id: r.id, title: p.title, type: p.type }; });
console.log(JSON.stringify(out, null, 2));
