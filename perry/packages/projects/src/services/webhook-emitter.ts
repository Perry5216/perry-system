/**
 * @perry/projects — Outbound Webhook Emitter
 *
 * Fires Perry lifecycle events to a configurable HTTP endpoint (typically an
 * n8n webhook on a Cloudflare Tunnel). Designed for fire-and-forget — emit()
 * never throws, never blocks the caller for more than a few hundred ms, and
 * retries 5xx / network errors up to 3 times in the background.
 *
 * Reads N8N_WEBHOOK_URL from env at call time so the user can rotate the URL
 * without restarting Perry. If unset, emit() is a no-op (logged once at first
 * call to avoid spam).
 *
 * Payload shape posted to the receiver:
 *   { event: string, emittedAt: ISO string, source: 'perry', payload: {...} }
 *
 * To add a new event, just call WebhookEmitter.emit('event-name', { ... }).
 */

import { Logger } from '@perry/core';

export class WebhookEmitter {
  private static log = new Logger('webhook:emit');
  private static warnedMissing = false;

  static emit(event: string, payload: Record<string, unknown> = {}): void {
    const url = process.env.N8N_WEBHOOK_URL;
    if (!url) {
      if (!WebhookEmitter.warnedMissing) {
        WebhookEmitter.log.info('N8N_WEBHOOK_URL not set — outbound webhooks disabled');
        WebhookEmitter.warnedMissing = true;
      }
      return;
    }
    const body = JSON.stringify({
      event,
      emittedAt: new Date().toISOString(),
      source: 'perry',
      payload,
    });
    // Fire-and-forget — never blocks the caller, retries on 5xx/network errors.
    void WebhookEmitter.send(url, body, event, 0);
  }

  private static async send(url: string, body: string, event: string, attempt: number): Promise<void> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (res.status >= 500 && attempt < 3) {
        const delay = 500 * (attempt + 1);
        WebhookEmitter.log.warn(`Webhook ${event} returned ${res.status}, retry ${attempt + 1}/3 in ${delay}ms`);
        setTimeout(() => void WebhookEmitter.send(url, body, event, attempt + 1), delay);
      } else if (!res.ok) {
        WebhookEmitter.log.warn(`Webhook ${event} returned ${res.status} — giving up`);
      } else {
        WebhookEmitter.log.debug(`Webhook ${event} delivered (${res.status})`);
      }
    } catch (err: any) {
      if (attempt < 3) {
        const delay = 500 * (attempt + 1);
        WebhookEmitter.log.warn(`Webhook ${event} failed: ${err.message}, retry ${attempt + 1}/3 in ${delay}ms`);
        setTimeout(() => void WebhookEmitter.send(url, body, event, attempt + 1), delay);
      } else {
        WebhookEmitter.log.warn(`Webhook ${event} failed after 3 retries: ${err.message}`);
      }
    }
  }
}
