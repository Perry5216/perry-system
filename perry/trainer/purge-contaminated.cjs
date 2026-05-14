const fs = require('fs');
const path = require('path');

const baseDir = 'd:/n8n/perry/workspace/training/project-project-77';

// 1. Purge mined_pairs.jsonl — remove any entries containing -- (double dash artifacts)
const minedPath = path.join(baseDir, 'mined_pairs.jsonl');
if (fs.existsSync(minedPath)) {
  const lines = fs.readFileSync(minedPath, 'utf-8').split('\n').filter(l => l.trim());
  const clean = lines.filter(line => {
    // Remove any training pair where the assistant response contains -- artifacts
    try {
      const data = JSON.parse(line);
      const assistantMsg = data.conversations?.find(c => c.role === 'assistant');
      if (assistantMsg && assistantMsg.content) {
        // Check for double-dash artifacts
        if (/(?<!-)--+(?!-)/.test(assistantMsg.content)) {
          return false; // Contaminated — remove
        }
      }
      return true;
    } catch {
      return true; // Keep non-JSON lines (shouldn't happen)
    }
  });
  
  const removed = lines.length - clean.length;
  fs.writeFileSync(minedPath, clean.join('\n') + '\n', 'utf-8');
  console.log(`mined_pairs.jsonl: ${lines.length} total, ${removed} contaminated pairs removed, ${clean.length} clean pairs kept`);
} else {
  console.log('mined_pairs.jsonl not found');
}

// 2. Purge training_data.jsonl — same filter
const trainingPath = path.join(baseDir, 'training_data.jsonl');
if (fs.existsSync(trainingPath)) {
  const lines = fs.readFileSync(trainingPath, 'utf-8').split('\n').filter(l => l.trim());
  const clean = lines.filter(line => {
    try {
      const data = JSON.parse(line);
      const assistantMsg = data.conversations?.find(c => c.role === 'assistant');
      if (assistantMsg && assistantMsg.content) {
        if (/(?<!-)--+(?!-)/.test(assistantMsg.content)) {
          return false;
        }
      }
      return true;
    } catch {
      return true;
    }
  });
  
  const removed = lines.length - clean.length;
  fs.writeFileSync(trainingPath, clean.join('\n') + '\n', 'utf-8');
  console.log(`training_data.jsonl: ${lines.length} total, ${removed} contaminated pairs removed, ${clean.length} clean pairs kept`);
} else {
  console.log('training_data.jsonl not found');
}

// 3. Purge scores.csv — remove passes 87+ entries
const scoresPath = path.join(baseDir, 'scores.csv');
if (fs.existsSync(scoresPath)) {
  const lines = fs.readFileSync(scoresPath, 'utf-8').split('\n');
  const header = lines[0];
  const dataLines = lines.slice(1).filter(l => l.trim());
  
  const clean = dataLines.filter(line => {
    // Format: timestamp,project_id,pass_number,...
    const parts = line.split(',');
    const passNum = parseInt(parts[2], 10);
    return passNum < 87; // Keep only pre-fine-tuned model passes
  });
  
  const removed = dataLines.length - clean.length;
  fs.writeFileSync(scoresPath, [header, ...clean].join('\n') + '\n', 'utf-8');
  console.log(`scores.csv: ${dataLines.length} entries, ${removed} from passes 87+ removed, ${clean.length} kept`);
}

console.log('\nPurge complete. Training data is now clean of fine-tuned model artifacts.');
