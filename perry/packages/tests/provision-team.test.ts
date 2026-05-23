import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const workspaceDir = 'd:/perry-system/perry/workspace';

async function run() {
  console.log('─── Hacking Domain Provision Team Smoke Test ───');
  
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

  // 1. Send POST request to provision team for "hacking" domain
  const res = await fetch('http://localhost:3847/api/domains/provision-team', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      domainId: 'hacking',
      teamRoles: [
        { role: 'Security Auditor', description: 'Audits script security' },
        { role: 'Exploit Developer', description: 'Develops proofs of concept' }
      ],
      recommendedAbilities: ['audit-security', 'exploit-dev'],
      suggestedNewAbilities: ['fuzz-testing']
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

  // 2. Verify custom_agents.json was updated
  const customAgentsPath = join(workspaceDir, '.config', 'custom_agents.json');
  if (!existsSync(customAgentsPath)) {
    throw new Error('custom_agents.json was not created/updated');
  }

  const customAgents = JSON.parse(readFileSync(customAgentsPath, 'utf-8'));
  console.log('Custom Agents keys:', Object.keys(customAgents));

  const auditorKey = 'hacking.security-auditor';
  const devKey = 'hacking.exploit-developer';

  if (!customAgents[auditorKey]) {
    throw new Error(`Agent ${auditorKey} was not added to custom_agents.json`);
  }
  if (!customAgents[devKey]) {
    throw new Error(`Agent ${devKey} was not added to custom_agents.json`);
  }

  // Verify Agent soul files
  for (const agentId of [auditorKey, devKey]) {
    const soulDir = join(workspaceDir, 'souls', 'agents', agentId);
    if (!existsSync(soulDir)) {
      throw new Error(`Soul directory for ${agentId} does not exist`);
    }
    if (!existsSync(join(soulDir, 'CONFIG.json'))) {
      throw new Error(`CONFIG.json for ${agentId} does not exist`);
    }
    if (!existsSync(join(soulDir, 'SOUL.md'))) {
      throw new Error(`SOUL.md for ${agentId} does not exist`);
    }
    if (!existsSync(join(soulDir, 'LESSONS.md'))) {
      throw new Error(`LESSONS.md for ${agentId} does not exist`);
    }
    console.log(`✓ Agent ${agentId} soul files created successfully.`);
  }

  console.log('✓ Provision Team Smoke Test passed successfully!');
}

run().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
