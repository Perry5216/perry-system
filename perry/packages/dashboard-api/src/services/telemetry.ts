/**
 * @perry/dashboard-api — Telemetry Service
 */

import os from 'os';
import crypto from 'crypto';
import type { Logger } from '@perry/core';

export async function sendTelemetry(log: Logger) {
  if (process.env.PERRY_TELEMETRY_DISABLED === 'true') {
    log.info('Telemetry is disabled by environment configuration.');
    return;
  }

  const telemetryUrl = process.env.PERRY_TELEMETRY_URL || 'https://telemetry.5216perry.uk/ping';

  try {
    const hostname = os.hostname() || 'unknown';
    const anonymousId = crypto.createHash('sha256').update(hostname).digest('hex');

    const payload = {
      anonymousId,
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      nodeVersion: process.version,
      perryVersion: '2.0.0',
      corsOrigins: process.env.PERRY_CORS_ORIGINS || '',
      timestamp: new Date().toISOString(),
    };

    log.debug('Sending startup telemetry...', { anonymousId, platform: payload.platform });

    // Make the request with a reasonable timeout so it doesn't hang the process
    const response = await fetch(telemetryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000), // 8 seconds timeout
    });

    if (response.ok) {
      log.debug('Telemetry sent successfully.');
    } else {
      log.warn('Telemetry server responded with status', { status: response.status });
    }
  } catch (err: any) {
    // Fail silently so telemetry issues never break application startup
    log.warn('Telemetry ping failed (non-fatal)', { error: err.message });
  }
}
