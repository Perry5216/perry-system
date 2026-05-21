/**
 * PluginManager — discover, load, and manage workspace plugins.
 *
 * Plugins live as `*.js` or `*.cjs` files in `workspace/plugins/`. Each one
 * exports a `meta` object and a `register(api)` function. PluginManager
 * loads them at boot, wires their controlled API surface, and exposes
 * management endpoints (list / reload / unload).
 *
 * Routes the plugin registers are mounted under
 *   `/api/plugin/{plugin-name}/{route}`
 * on a single Express sub-router. PluginManager owns the router and rebuilds
 * it on reload.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { Router, type Request, type Response } from 'express';
import type { EventBus, Logger, PluginAPI, PluginMeta, PluginModule, PluginHandle, PluginRouteHandler } from '@perry/core';

interface LoadedPlugin {
  name: string;
  meta: PluginMeta;
  path: string;
  loadedAt: string;
  handle?: PluginHandle | void;
  unsubscribers: Array<() => void>;
  /** Sub-router for this plugin's registered routes (mounted at /api/plugin/{name}). */
  router: Router;
}

export class PluginManager {
  private readonly dir: string;
  private readonly loaded = new Map<string, LoadedPlugin>();
  /** Top-level router exposed to Express. Rebuilt on reload. */
  public readonly router = Router();

  constructor(
    private workspaceDir: string,
    private eventBus: EventBus,
    private log: Logger,
  ) {
    this.dir = join(workspaceDir, 'plugins');
    mkdirSync(this.dir, { recursive: true });
  }

  async loadAll(): Promise<{ loaded: number; failed: number }> {
    let loaded = 0;
    let failed = 0;
    try {
      const files = readdirSync(this.dir).filter(f => (f.endsWith('.js') || f.endsWith('.cjs')) && !f.startsWith('_'));
      for (const f of files) {
        try {
          await this.loadOne(f);
          loaded += 1;
        } catch (err: any) {
          this.log.warn('Plugin failed to load', { file: f, error: err.message });
          failed += 1;
        }
      }
    } catch (err: any) {
      this.log.warn('PluginManager.loadAll dir read failed', { error: err.message });
    }
    if (loaded + failed > 0) {
      this.log.info('PluginManager scanned plugins dir', { loaded, failed, dir: this.dir });
    }
    return { loaded, failed };
  }

  private async loadOne(filename: string): Promise<void> {
    const fullPath = join(this.dir, filename);
    // Dynamic import works for both ESM and CJS files. Cache-bust by appending
    // a unique query string — Node's import cache keys include the full URL,
    // so a new query → fresh load. (Documented pattern for hot-reload.)
    const url = pathToFileURL(fullPath).href + `?t=${Date.now()}`;
    const mod: any = await import(url);
    // Plugin shape: CJS files surface their `module.exports` as `mod.default`
    // (since Node's interop wraps it). ESM files expose named exports directly.
    // Resolve to the actual plugin object:
    let target: PluginModule;
    if (mod.default && (mod.default.register || mod.default.meta)) {
      target = mod.default;
    } else if (mod.register || mod.meta) {
      target = mod;
    } else if (mod.default) {
      target = mod.default;
    } else {
      target = mod;
    }
    const meta: PluginMeta = target.meta || { name: filename.replace(/\.[cm]?js$/, '') };
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(meta.name)) {
      throw new Error(`plugin name "${meta.name}" must be kebab-case 2-41 chars`);
    }
    if (this.loaded.has(meta.name)) {
      await this.unload(meta.name);
    }
    if (typeof target.register !== 'function') {
      throw new Error(`plugin ${meta.name} missing register() function`);
    }

    const pluginDataDir = join(this.dir, meta.name);
    mkdirSync(pluginDataDir, { recursive: true });

    const subRouter = Router();
    const unsubscribers: Array<() => void> = [];

    const api: PluginAPI = {
      log: this.log.child(`plugin:${meta.name}`),
      dataDir: pluginDataDir,
      workspaceDir: this.workspaceDir,
      eventBus: this.eventBus,
      onEvent: (event, handler) => {
        this.eventBus.on(event as any, handler as any);
        const off = () => this.eventBus.off(event as any, handler as any);
        unsubscribers.push(off);
        return off;
      },
      emit: (event, payload) => this.eventBus.emit(event as any, payload),
      registerRoute: (method, path, handler) => {
        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        const method_lower = method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';
        (subRouter as any)[method_lower](cleanPath, async (req: Request, res: Response) => {
          try { await handler(req, res); }
          catch (err: any) {
            api.log.warn(`route handler threw: ${method} ${path}`, { error: err.message });
            if (!res.headersSent) res.status(500).json({ error: err.message });
          }
        });
      },
    };

    let handle: PluginHandle | void;
    try {
      handle = await target.register(api);
    } catch (err: any) {
      // Roll back any subscriptions / routes the plugin added before failing.
      for (const off of unsubscribers) { try { off(); } catch {} }
      throw err;
    }

    const lp: LoadedPlugin = {
      name: meta.name,
      meta,
      path: fullPath,
      loadedAt: new Date().toISOString(),
      handle,
      unsubscribers,
      router: subRouter,
    };
    this.loaded.set(meta.name, lp);
    this.log.info('Plugin loaded', { name: meta.name, version: meta.version, file: filename });
    this.rebuildRouter();
  }

  async unload(name: string): Promise<boolean> {
    const lp = this.loaded.get(name);
    if (!lp) return false;
    for (const off of lp.unsubscribers) { try { off(); } catch (err: any) { this.log.warn('Plugin unsub failed', { name, error: err.message }); } }
    if (lp.handle && typeof lp.handle.onShutdown === 'function') {
      try { await lp.handle.onShutdown(); }
      catch (err: any) { this.log.warn('Plugin onShutdown threw', { name, error: err.message }); }
    }
    this.loaded.delete(name);
    this.log.info('Plugin unloaded', { name });
    this.rebuildRouter();
    return true;
  }

  async reload(): Promise<{ loaded: number; failed: number; activeBefore: number }> {
    const activeBefore = this.loaded.size;
    for (const n of [...this.loaded.keys()]) await this.unload(n);
    return { ...(await this.loadAll()), activeBefore };
  }

  list(): Array<{ name: string; meta: PluginMeta; loadedAt: string; routes: number }> {
    return Array.from(this.loaded.values()).map(lp => ({
      name: lp.name,
      meta: lp.meta,
      loadedAt: lp.loadedAt,
      // Express routers expose stack; each layer with a route is one registered handler.
      routes: ((lp.router as any).stack || []).filter((l: any) => l.route).length,
    }));
  }

  /**
   * Rebuild the top-level router by re-mounting each loaded plugin's sub-router
   * at `/{plugin-name}`. Called on every load/unload.
   */
  private rebuildRouter(): void {
    // Express doesn't let us hot-swap a router's middleware stack cleanly,
    // so we mutate the `.stack` array directly. This is a documented pattern
    // (see Express GitHub issues #1635, #2400). Safe because PluginManager
    // owns this router exclusively.
    (this.router as any).stack = [];
    for (const lp of this.loaded.values()) {
      (this.router as any).use(`/${lp.name}`, lp.router);
    }
  }
}
