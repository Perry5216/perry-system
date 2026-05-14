const fs = require('fs');
const wf = JSON.parse(fs.readFileSync('2 - Dossier to Full Outline.workflow.ts', 'utf8'));

// Check Post Process node
const postProcess = wf.nodes.find(n => n.name === 'Post Process');
console.log('Post Process:', postProcess ? 'Found' : 'Not Found');

// Check Loop Over Batches node
const loop = wf.nodes.find(n => n.name === 'Loop Over Batches');
console.log('Loop:', loop ? 'Found. Type: ' + loop.type + ', Version: ' + loop.version : 'Not Found');

// Check connections
const loopConnections = wf.connections['Loop Over Batches'];
console.log('Loop Output Connections:', JSON.stringify(loopConnections, null, 2));

const postProcessConnections = wf.connections['Post Process'];
console.log('Post Process Output Connections:', JSON.stringify(postProcessConnections, null, 2));

const docsConnections = wf.connections['Send to Outline Doc'];
console.log('Send to Outline Doc Output Connections:', JSON.stringify(docsConnections, null, 2));
