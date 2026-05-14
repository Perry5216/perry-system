const fs = require('fs');
const db = require('better-sqlite3')('d:/n8n/perry/workspace/.config/projects.db');
const row = db.prepare(`SELECT data FROM projects WHERE id='project-77'`).get();
const steps = JSON.parse(row.data).steps;
console.log(steps.find(s => s.id === 'step-1119').status);
