const Database = require('better-sqlite3');
const dbPath = process.env.PERRY_DB || '/app/workspace/.config/projects.db';
const db = new Database(dbPath);

const steps = db.prepare(`SELECT id, prompt, label FROM steps WHERE project_id = 'project-77' AND (label LIKE '%Pass 8%' OR label LIKE '%Pass 9%')`).all();

let updated = 0;
const updateStmt = db.prepare(`UPDATE steps SET prompt = ? WHERE project_id = 'project-77' AND id = ?`);

const rules = `\n\n## STRICT PROSE RULES\n- NEVER use ellipses (..., ..) or trailing thoughts. End sentences with hard periods.\n- NEVER use double-dashes (--) or triple-dashes (---). Use proper em-dashes (—) very sparingly, or use periods/commas. These artifacts are lazy and strictly forbidden.\n`;

const tx = db.transaction(() => {
  for (const step of steps) {
    if (step.prompt && !step.prompt.includes('STRICT PROSE RULES')) {
      let newPrompt = step.prompt.replace(
        /## DIRECTIVES FROM PASS \d+[\s\S]*?mandatory constraints\.\n/,
        match => match + rules
      );
      if (newPrompt === step.prompt) {
        newPrompt = step.prompt.replace(
          /## SCENE TYPE:/,
          rules.trim() + `\n\n## SCENE TYPE:`
        );
      }
      if (newPrompt !== step.prompt) {
        updateStmt.run(newPrompt, step.id);
        updated++;
      }
    }
  }
});
tx();

const row = db.prepare(`SELECT data FROM projects WHERE id = 'project-77'`).get();
if (row) {
  const project = JSON.parse(row.data);
  let blobUpdated = 0;
  for (const step of project.steps) {
    if (step.prompt && !step.prompt.includes('STRICT PROSE RULES') && (step.label.includes('Pass 8') || step.label.includes('Pass 9'))) {
      let newPrompt = step.prompt.replace(
        /## DIRECTIVES FROM PASS \d+[\s\S]*?mandatory constraints\.\n/,
        match => match + rules
      );
      if (newPrompt === step.prompt) {
        newPrompt = step.prompt.replace(
          /## SCENE TYPE:/,
          rules.trim() + `\n\n## SCENE TYPE:`
        );
      }
      if (newPrompt !== step.prompt) {
        step.prompt = newPrompt;
        blobUpdated++;
      }
    }
  }
  if (blobUpdated > 0) {
    db.prepare(`UPDATE projects SET data = ? WHERE id = 'project-77'`).run(JSON.stringify(project));
  }
}

console.log(`Patched ${updated} steps in DB with strict prose rules.`);
