import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const userConfigPath = 'd:/perry-system/perry/config/user.json';

async function run() {
  console.log('─── Dynamic MCP Server Registration Integration Test ───');
  
  // Read PERRY_API_KEY from .env
  let apiKey = '';
  try {
    const envContent = readFileSync('d:/perry-system/.env', 'utf-8');
    const match = envContent.match(/^PERRY_API_KEY=(.+)$/m);
    if (match) {
      apiKey = match[1].trim();
    }
  } catch (e) {
    console.warn('Could not read .env file for PERRY_API_KEY:', e);
  }

  // Backup existing user.json if it exists
  let originalConfig: string | null = null;
  if (existsSync(userConfigPath)) {
    originalConfig = readFileSync(userConfigPath, 'utf-8');
  }

  try {
    // 1. Send POST request to provision team for "hacking" domain with mcp server
    const res = await fetch('http://localhost:3847/api/domains/provision-team', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        domainId: 'hacking',
        teamRoles: [
          { role: 'Security Auditor', description: 'Audits script security' }
        ],
        recommendedMcpServers: {
          'dynamic-mock-server-test': {
            type: 'sse',
            url: 'http://localhost:9999/mcp-test-sse'
          }
        }
      })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    console.log('Response:', data);

    if (!data.success) {
      throw new Error('Provision failed: success is false');
    }

    // 2. Verify config/user.json was updated with 'dynamic-mock-server-test'
    if (!existsSync(userConfigPath)) {
      throw new Error('user.json does not exist');
    }

    const userConfig = JSON.parse(readFileSync(userConfigPath, 'utf-8'));
    console.log('user.json ai.mcpServers keys:', Object.keys(userConfig?.ai?.mcpServers || {}));

    const mockServerConfig = userConfig?.ai?.mcpServers?.['dynamic-mock-server-test'];
    if (!mockServerConfig) {
      throw new Error('dynamic-mock-server-test was not added to user.json config');
    }

    if (mockServerConfig.type !== 'sse' || mockServerConfig.url !== 'http://localhost:9999/mcp-test-sse') {
      throw new Error(`Invalid registered config: ${JSON.stringify(mockServerConfig)}`);
    }

    console.log('✓ Dynamic MCP Server Registration Integration Test passed successfully!');
  } finally {
    // Restore user.json backup
    if (originalConfig !== null) {
      const { writeFileSync } = await import('fs');
      writeFileSync(userConfigPath, originalConfig, 'utf-8');
      console.log('Restore: user.json restored to its original state.');
    }
  }
}

run().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
