const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve('database/perry.sqlite');
const db = new Database(dbPath, { readonly: true });

const row = db.prepare(`SELECT prompt, messages FROM telemetry WHERE stepId = (SELECT id FROM steps WHERE label='Chapter 1 — POV Check' ORDER BY updatedAt DESC LIMIT 1) ORDER BY timestamp DESC LIMIT 1`).get();

if (row) {
  console.log('--- SYSTEM PROMPT ---');
  console.log(row.prompt.substring(0, 2000));
  console.log('--- SYSTEM PROMPT END ---\n');
  console.log('--- USER MESSAGE ---');
  console.log(row.messages.substring(0, 2000));
  console.log('--- USER MESSAGE END ---');
} else {
  console.log('No telemetry found');
}
