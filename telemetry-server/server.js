import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = process.env.PERRY_TELEMETRY_LOG_PATH || path.join(__dirname, 'telemetry_logs.jsonl');
const PORT = process.env.PORT || 4444;


// Helper to read and parse logs
function readLogs() {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    const data = fs.readFileSync(LOG_FILE, 'utf8');
    return data
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => JSON.parse(line))
      .reverse(); // Newest first
  } catch (err) {
    console.error('Error reading logs:', err);
    return [];
  }
}

// Helper to write logs
function saveLog(payload, clientIp) {
  try {
    const entry = {
      ...payload,
      ip: clientIp || 'unknown',
      serverTimestamp: new Date().toISOString(),
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing log:', err);
    return false;
  }
}

// Generate the HTML dashboard
function renderDashboard(logs) {
  const totalPings = logs.length;
  const uniqueInstalls = new Set(logs.map(l => l.anonymousId).filter(Boolean)).size;
  
  // OS Breakdown
  const osCount = {};
  logs.forEach(l => {
    if (l.platform) {
      osCount[l.platform] = (osCount[l.platform] || 0) + 1;
    }
  });
  const osBreakdown = Object.entries(osCount)
    .map(([os, count]) => `<span class="badge badge-os">${os}: ${count}</span>`)
    .join(' ') || '<span class="text-muted">None</span>';

  // Origins Breakdown
  const origins = new Set();
  logs.forEach(l => {
    if (l.corsOrigins) {
      l.corsOrigins.split(',').forEach(o => {
        const url = o.trim();
        if (url) origins.add(url);
      });
    }
  });
  const uniqueOrigins = origins.size;

  // Table rows
  const tableRows = logs
    .map(l => {
      const date = l.timestamp ? new Date(l.timestamp).toLocaleString() : 'N/A';
      const received = l.serverTimestamp ? new Date(l.serverTimestamp).toLocaleString() : 'N/A';
      const corsOriginsFormatted = l.corsOrigins
        ? l.corsOrigins.split(',').map(o => `<span class="badge badge-origin">${o.trim()}</span>`).join(' ')
        : '<span class="text-muted">Direct Only</span>';
      
      return `
        <tr>
          <td><code class="hash" title="${l.anonymousId}">${l.anonymousId ? l.anonymousId.substring(0, 12) + '...' : 'N/A'}</code></td>
          <td><span class="badge badge-platform">${l.platform || 'N/A'} (${l.arch || 'N/A'})</span></td>
          <td><code>${l.nodeVersion || 'N/A'}</code></td>
          <td><span class="badge badge-version">v${l.perryVersion || 'N/A'}</span></td>
          <td>${corsOriginsFormatted}</td>
          <td><code>${l.ip}</code></td>
          <td class="time" title="Server Received: ${received}">${date}</td>
        </tr>
      `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>P.E.R.R.Y. System — Telemetry Audit</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #09090e;
      --panel: rgba(18, 18, 29, 0.7);
      --border: rgba(255, 255, 255, 0.08);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #8b5cf6;
      --primary-glow: rgba(139, 92, 246, 0.15);
      --accent: #06b6d4;
      --accent-glow: rgba(6, 182, 212, 0.15);
      --gradient: linear-gradient(135deg, #a78bfa 0%, #06b6d4 100%);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Outfit', sans-serif;
      background-color: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(139, 92, 246, 0.1) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(6, 182, 212, 0.08) 0px, transparent 50%);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem;
      line-height: 1.5;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
    }

    h1 {
      font-size: 1.8rem;
      font-weight: 700;
      background: var(--gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.5px;
    }

    .subtitle {
      font-size: 0.9rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }

    .btn-refresh {
      background: var(--panel);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
      font-family: inherit;
    }

    .btn-refresh:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: var(--primary);
      box-shadow: 0 0 10px var(--primary-glow);
    }

    /* Cards */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2.5rem;
    }

    .card {
      background: var(--panel);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
    }

    .card-title {
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .card-value {
      font-size: 2rem;
      font-weight: 700;
      color: #fff;
    }

    .card-extra {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-os {
      background: rgba(6, 182, 212, 0.12);
      border: 1px solid rgba(6, 182, 212, 0.25);
      color: #22d3ee;
    }

    .badge-platform {
      background: rgba(139, 92, 246, 0.12);
      border: 1px solid rgba(139, 92, 246, 0.2);
      color: #c084fc;
      text-transform: lowercase;
    }

    .badge-version {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.25);
      color: #34d399;
    }

    .badge-origin {
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid rgba(251, 191, 36, 0.2);
      color: #fbbf24;
      text-transform: none;
      word-break: break-all;
    }

    /* Table */
    .table-container {
      background: var(--panel);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    th, td {
      padding: 1rem 1.25rem;
      font-size: 0.9rem;
      border-bottom: 1px solid var(--border);
    }

    th {
      font-weight: 600;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.02);
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.5px;
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background: rgba(255, 255, 255, 0.01);
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
      color: #e5e7eb;
      background: rgba(255, 255, 255, 0.05);
      padding: 0.1rem 0.3rem;
      border-radius: 4px;
    }

    code.hash {
      color: #a78bfa;
      border: 1px solid rgba(167, 139, 250, 0.15);
      cursor: help;
    }

    .time {
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    .text-muted {
      color: var(--text-muted);
    }

    .empty-state {
      padding: 3rem;
      text-align: center;
      color: var(--text-muted);
    }

    @media (max-width: 768px) {
      body {
        padding: 1rem;
      }
      th, td {
        padding: 0.75rem 0.85rem;
      }
      .stats-grid {
        grid-template-columns: 1fr;
      }
      header {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
      }
      .btn-refresh {
        width: 100%;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>P.E.R.R.Y. Telemetry Console</h1>
        <div class="subtitle">Real-time installation audits and licensing validation</div>
      </div>
      <button class="btn-refresh" onclick="window.location.reload()">Refresh Data</button>
    </header>

    <div class="stats-grid">
      <div class="card">
        <div class="card-title">Total Boot Pings</div>
        <div class="card-value">${totalPings}</div>
      </div>
      <div class="card">
        <div class="card-title">Unique Installations</div>
        <div class="card-value" style="color: var(--accent);">${uniqueInstalls}</div>
      </div>
      <div class="card">
        <div class="card-title">Unique Domain Exposures</div>
        <div class="card-value">${uniqueOrigins}</div>
      </div>
      <div class="card">
        <div class="card-title">OS Environment</div>
        <div class="card-value" style="font-size: 1.1rem; line-height: 1.5; font-weight: 500; min-height: 48px; display: flex; align-items: center; justify-content: flex-start;">
          <div class="card-extra">${osBreakdown}</div>
        </div>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Installation ID</th>
            <th>Platform</th>
            <th>Node Version</th>
            <th>Release Version</th>
            <th>Exposed CORS Domains</th>
            <th>Egress IP</th>
            <th>Pinged At (Local)</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows || `<tr><td colspan="7" class="empty-state">No boot pings recorded yet. Deploy the telemetry beacon to start collecting data!</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>
  `;
}

// Request dispatcher
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Endpoint: GET / (Dashboard)
  if (req.method === 'GET' && url.pathname === '/') {
    const logs = readLogs();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDashboard(logs));
    return;
  }

  // Endpoint: POST /ping (Telemetry ingestion)
  if (req.method === 'POST' && url.pathname === '/ping') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        
        // Grab IP behind Cloudflare Tunnel or standard forwarders
        const clientIp = 
          req.headers['cf-connecting-ip'] || 
          req.headers['x-forwarded-for'] || 
          req.socket.remoteAddress;

        const success = saveLog(payload, clientIp);
        if (success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', msg: 'telemetry logged' }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', msg: 'failed to save' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', msg: 'invalid payload' }));
      }
    });
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'error', msg: 'not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Telemetry Collector running on http://0.0.0.0:${PORT}`);
});
