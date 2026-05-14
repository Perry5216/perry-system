const { spawn } = require('child_process');

const mcpServer = spawn('node', ['dist/index.js'], {
  cwd: '/app/packages/mcp-server',
  env: { ...process.env, PERRY_WORKSPACE: '/app/workspace', PERRY_CONFIG: '/app/config' }
});

let messageId = 1;

mcpServer.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      console.log('RECV:', JSON.stringify(msg, null, 2));
      if (msg.id === 2) {
        // Exit after we get the tool response
        process.exit(0);
      }
    } catch (e) {
      console.log('RAW STDOUT:', line);
    }
  }
});

mcpServer.stderr.on('data', (data) => {
  console.error('STDERR:', data.toString());
});

mcpServer.on('close', (code) => {
  console.log(`Child process exited with code ${code}`);
});

function send(msg) {
  console.log('SEND:', msg);
  mcpServer.stdin.write(JSON.stringify(msg) + '\n');
}

// Wait a sec for startup
setTimeout(() => {
  // 1. Initialize
  send({
    jsonrpc: "2.0",
    id: messageId++,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
    }
  });

  // 2. Call tool
  setTimeout(() => {
    send({
      jsonrpc: "2.0",
      id: messageId++,
      method: "tools/call",
      params: {
        name: "get_project_context",
        arguments: {
          projectId: "project-83-the-digital-drift",
          compress: true
        }
      }
    });
  }, 1000);
}, 1000);
