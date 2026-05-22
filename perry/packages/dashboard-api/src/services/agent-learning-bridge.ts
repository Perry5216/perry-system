/**
 * AgentLearningBridge — translates already-existing agent invocation
 * events into the standardised learning:* taxonomy so EVERY agent (and
 * every new agent added to the registry) gets the self-learning loop
 * without writing a line of producer code.
 *
 * This is the "Perry-wide as a feature" piece: a new `hacking.recon`
 * agent shows up in the registry → its successes/failures automatically
 * flow into LearningCore → patterns get proposed as `service: hacking`
 * skills in the dashboard. No new wiring needed per domain.
 *
 * Resolution: we look up the agent's `domain` from the registry so the
 * proposed skill's `service` field matches the actual subsystem name
 * ("code", "hacking", "meta") rather than the cryptic agent id
 * ("code.review", "hacking.recon"). One skill catalog per domain.
 *
 * Fingerprint policy:
 *   - On success: fingerprint is the agentId. Tracks "agent X completed
 *     normally" — used for duration percentiles and the "this agent is
 *     well-exercised, consider auto-promoting its trajectories to
 *     training data" signal.
 *   - On failure: fingerprint is `{agentId}::{shortErrorHash}` so the
 *     same agent failing with two DIFFERENT errors counts as two
 *     patterns, not one. Same error recurring across calls is what we
 *     want to flag.
 */

import crypto from 'crypto';
import type { EventBus, Logger } from '@perry/core';
import { getAgent } from '@perry/projects';

function shortErrorHash(err: string): string {
  // Normalise before hashing so "Timeout: 30s" and "Timeout: 31s" collide.
  const norm = String(err).toLowerCase().replace(/\d+/g, 'N').slice(0, 200);
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 8);
}

export class AgentLearningBridge {
  constructor(private eventBus: EventBus, private log: Logger) {
    this.eventBus.on('agent:invocation:completed', (p) => {
      try {
        const agent = getAgent(p.agentId);
        const source = agent?.domain || 'meta';
        this.eventBus.emit('learning:success', {
          source,
          kind: 'agent-invocation',
          fingerprint: p.agentId,
          metadata: { invocationId: p.invocationId, sessionId: p.sessionId, durationMs: p.durationMs },
        });
        this.eventBus.emit('learning:duration', {
          source,
          kind: 'agent-invocation',
          fingerprint: p.agentId,
          durationMs: p.durationMs,
          metadata: { invocationId: p.invocationId },
        });
      } catch (err: any) {
        this.log.warn('agent-learning bridge (completed) failed', { error: err.message });
      }
    });

    this.eventBus.on('agent:invocation:failed', (p) => {
      try {
        const agent = getAgent(p.agentId);
        const source = agent?.domain || 'meta';
        const errFp = shortErrorHash(p.error || 'unknown');
        this.eventBus.emit('learning:failure', {
          source,
          kind: 'agent-invocation-fail',
          fingerprint: `${p.agentId}::${errFp}`,
          error: p.error,
          metadata: { invocationId: p.invocationId, sessionId: p.sessionId, agentId: p.agentId },
        });
      } catch (err: any) {
        this.log.warn('agent-learning bridge (failed) failed', { error: err.message });
      }
    });

    this.log.info('AgentLearningBridge subscribed to agent:invocation:* events');
  }
}
