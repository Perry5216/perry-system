const fs = require('fs');
const path = require('path');

const baseDir = 'd:/n8n/perry/workspace/training/project-project-77';

function purgeArtifacts(filename) {
  const filePath = path.join(baseDir, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`${filename} not found`);
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
  const clean = lines.filter(line => {
    try {
      const data = JSON.parse(line);
      const assistantMsg = data.conversations?.find(c => c.role === 'assistant');
      if (assistantMsg && assistantMsg.content) {
        // Check for double-dash artifacts
        if (/-{2,}/.test(assistantMsg.content)) {
          return false; // Contaminated
        }
        // Check for ellipsis artifacts
        if (/\.{3,}/.test(assistantMsg.content)) {
          return false; // Contaminated
        }
      }
      return true;
    } catch {
      return true;
    }
  });
  
  const removed = lines.length - clean.length;
  fs.writeFileSync(filePath, clean.join('\n') + '\n', 'utf-8');
  console.log(`${filename}: ${lines.length} total, ${removed} contaminated pairs removed, ${clean.length} clean pairs kept`);
}

purgeArtifacts('mined_pairs.jsonl');
purgeArtifacts('training_data.jsonl');
