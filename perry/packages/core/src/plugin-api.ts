/**
 * @perry/core — Plugin API contract.
 *
 * Plugins are JS files dropped into `workspace/plugins/*.js`. On Perry boot
 * (and on `/api/plugins/reload`), the PluginManager scans the dir and calls
 * each plugin's `register(api)` function with a controlled `PluginAPI`
 * object.
 *
 * Trust model: plugins run in the main Perry process. Operator-trusted only.
 * No sandbox. For single-user dev boxes (Perry's target), this is fine.
 * Multi-user scenarios would need vm2 / isolates.
 *
 * Plugin shape (CommonJS or ES module both supported):
 *
 *   exports.meta = {
 *     name: 'my-plugin',           // required, kebab-case
 *     version: '0.1.0',
 *     description: 'What it does',
 *     author: 'you',
 *   };
 *
 *   exports.register = function(api) {
 *     api.log.info('my-plugin loaded');
 *
 *     api.onEvent('project:created', (project) => {
 *       api.log.info(`new project: ${project.id}`);
 *     });
 *
 *     api.registerRoute('GET', '/hello', (req, res) => {
 *       res.json({ greeting: 'Hello from my-plugin!' });
 *     });
 *
 *     return { onShutdown: () => api.log.info('my-plugin unloading') };
 *   };
 *
 * The plugin's routes mount under `/api/plugin/<plugin-name>/<route>`.
 * Auth applies the same as core routes (PERRY_API_KEY Bearer).
 */

import type { Request, Response } from 'express';
import type { EventBus } from './event-bus.js';
import type { Logger } from './logger.js';

export interface PluginMeta {
  /** Required. Kebab-case identifier — used for route prefix + dashboard display. */
  name: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
}

export type PluginRouteHandler = (req: Request, res: Response) => Promise<void> | void;

export interface PluginAPI {
  /** Logger scoped to the plugin's name. Use this — direct console.log won't carry the scope. */
  log: Logger;
  /** Plugin's persistent data dir at workspace/plugins/{name}/. Created lazily. */
  dataDir: string;
  /** Subscribe to an event. Returns an unsubscribe function. */
  onEvent: (event: string, handler: (payload: any) => void) => () => void;
  /** Emit an event on the bus. Use a `plugin:{name}:*` prefix as convention. */
  emit: (event: string, payload?: any) => void;
  /**
   * Register an HTTP route. Mounted under `/api/plugin/{plugin-name}/{path}`.
   * Method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'.
   */
  registerRoute: (method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', path: string, handler: PluginRouteHandler) => void;
  /**
   * Direct access to the EventBus if you need patterns the wrappers don't cover.
   * Use sparingly — onEvent is preferred for the auto-cleanup it provides.
   */
  eventBus: EventBus;
  /** Top-level workspace dir (for read-only reference; plugins should write only to their `dataDir`). */
  workspaceDir: string;
}

/**
 * What a plugin returns from `register()` (optional). Lets the plugin opt
 * into cleanup on reload/unload.
 */
export interface PluginHandle {
  /** Called when the plugin is unloaded (manual or on reload). */
  onShutdown?: () => void | Promise<void>;
}

export interface PluginModule {
  meta?: PluginMeta;
  register?: (api: PluginAPI) => PluginHandle | void | Promise<PluginHandle | void>;
  /** Alternative for ESM default export. */
  default?: PluginModule;
}
