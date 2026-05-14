const fs = require('fs');
const configPath = process.argv[2] || '/app/config/user.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
config.ai.ollama.model = 'perry-writer-project-project-77:latest';
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
console.log('Updated model to:', config.ai.ollama.model);
console.log(JSON.stringify(config, null, 2));
