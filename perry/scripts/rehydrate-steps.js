#!/usr/bin/env node
/**
 * rehydrate-steps.js
 * 
 * Emergency recovery script: reads project markdown files from disk
 * and rehydrates the SQLite `steps` table with their content and
 * correct statuses from the `projects` blob (which has the truth
 * for status but not for results).
 * 
 * Run from inside the Perry container:
 *   node /app/scripts/rehydrate-steps.js
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = '/app/workspace/.config/projects.db';
const PROJECTS_DIR = '/app/workspace/projects';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// 1. Get all projects from the projects table (JSON blob has correct statuses)
const projectRows = db.prepare('SELECT id, data FROM projects').all();
console.log(`Found ${projectRows.length} projects in database\n`);

let totalRehydrated = 0;

const updateStep = db.prepare(`
  UPDATE steps SET status = @status, result = @result,
    completed_at = @completedAt
  WHERE id = @stepId AND project_id = @projectId
`);

const insertStep = db.prepare(`
  INSERT OR REPLACE INTO steps (id, project_id, label, phase, task_type, chapter_number, status, result, prompt, started_at, completed_at, error)
  VALUES (@id, @projectId, @label, @phase, @taskType, @chapterNumber, @status, @result, @prompt, @startedAt, @completedAt, @error)
`);

for (const row of projectRows) {
  const project = JSON.parse(row.data);
  console.log(`\n=== ${project.id}: ${project.title} ===`);
  
  // Find the project directory on disk
  const dirEntries = fs.readdirSync(PROJECTS_DIR).filter(d => d.startsWith(project.id + '-'));
  if (dirEntries.length === 0) {
    console.log('  No project directory found on disk, skipping');
    continue;
  }
  
  const projectDir = path.join(PROJECTS_DIR, dirEntries[0]);
  console.log(`  Directory: ${projectDir}`);
  
  // Collect all markdown files from all subdirectories
  const fileMap = new Map(); // stepId -> file content
  for (const subDir of ['analysis', 'planning', 'manuscript', 'revisions', 'exports']) {
    const dir = path.join(projectDir, subDir);
    if (!fs.existsSync(dir)) continue;
    
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      // File format: step-N-label-slug.md
      const stepIdMatch = file.match(/^(step-\d+)/);
      if (!stepIdMatch) continue;
      
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      // Strip the "# Label" header line that was prepended during save
      const stripped = content.replace(/^#\s+[^\n]+\n\n/, '');
      fileMap.set(stepIdMatch[1], stripped);
    }
  }
  
  console.log(`  Found ${fileMap.size} markdown files on disk`);
  
  // Now update the steps table using the project blob for status
  // and the disk files for result content
  db.transaction(() => {
    for (const step of project.steps) {
      const diskResult = fileMap.get(step.id);
      const status = step.status || 'pending';
      const result = diskResult || step.result || null;
      
      if (status === 'completed' && result) {
        insertStep.run({
          id: step.id,
          projectId: project.id,
          label: step.label,
          phase: step.phase || null,
          taskType: step.taskType,
          chapterNumber: step.chapterNumber || null,
          status: status,
          result: result,
          prompt: step.prompt || null,
          startedAt: step.startedAt || null,
          completedAt: step.completedAt || null,
          error: step.error || null,
        });
        console.log(`  ✓ Rehydrated: ${step.id} (${step.label}) — ${result.length} chars`);
        totalRehydrated++;
      } else if (status !== 'pending') {
        // Update status even if no disk result
        insertStep.run({
          id: step.id,
          projectId: project.id,
          label: step.label,
          phase: step.phase || null,
          taskType: step.taskType,
          chapterNumber: step.chapterNumber || null,
          status: status,
          result: result,
          prompt: step.prompt || null,
          startedAt: step.startedAt || null,
          completedAt: step.completedAt || null,
          error: step.error || null,
        });
        console.log(`  ~ Updated status: ${step.id} (${step.label}) → ${status}`);
      }
    }
  })();
}

console.log(`\n✅ Rehydrated ${totalRehydrated} steps total`);
console.log('Restart the Perry container to reload the cache.');

db.close();
