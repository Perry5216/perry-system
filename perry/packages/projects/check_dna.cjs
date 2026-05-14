const fs = require('fs');
const db = require('better-sqlite3')('d:/n8n/perry/workspace/.config/projects.db');
const row = db.prepare("SELECT value FROM meta WHERE key='style_dna_v2'").get();
const data = JSON.parse(row.value);
console.log(JSON.stringify(data.globalRules.generalDirectives || "NO GENERAL DIRECTIVES", null, 2));
console.log("\n\nBANNED PHRASES TAIL:");
console.log(data.globalRules.bannedPhrases.slice(-10));
console.log("\n\nFILTER WORDS TAIL:");
console.log(data.globalRules.bannedFilterWords.slice(-10));
