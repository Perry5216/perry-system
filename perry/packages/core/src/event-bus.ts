/**
 * @perry/core — Typed Event Bus
 *
 * The spine of the V2 architecture. Services communicate through events
 * instead of direct method calls. This eliminates the V4 problem where
 * every service needed a reference to every other service.
 *
 * Usage:
 *   eventBus.on('step:completed', ({ projectId, stepId, result }) => { ... });
 *   eventBus.emit('step:completed', { projectId: 'p1', stepId: 's1', result: '...' });
 */

import { EventEmitter } from 'events';
import type { EventMap } from './types.js';

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many listeners — each service registers its own handlers.
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void | Promise<void>): void {
    this.emitter.on(event, handler as (...args: any[]) => void);
  }

  once<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void | Promise<void>): void {
    this.emitter.once(event, handler as (...args: any[]) => void);
  }

  off<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void | Promise<void>): void {
    this.emitter.off(event, handler as (...args: any[]) => void);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    try {
      this.emitter.emit(event, payload);
    } catch (err) {
      console.error(`[EventBus] Handler error on "${String(event)}":`, err);
    }
  }

  /** Number of listeners for an event — useful for health checks. */
  listenerCount<K extends keyof EventMap>(event: K): number {
    return this.emitter.listenerCount(event);
  }

  /** Remove all listeners — used during shutdown. */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
