/**
 * @perry/projects — NetworkClient
 *
 * Perry's single sanctioned door to the open internet. Every Perry service
 * that needs to reach out (book-planning research steps, future scouts,
 * fact-checking librarian, dashboard URL probes) goes through here so that:
 *
 *   1. Network policy lives in one place — "should this go via VPN?" is a
 *      single switch statement, not 6 scattered fetch() calls
 *   2. The same set of named paths (direct, gluetun-uk/us/de, future Tavily
 *      etc.) is available identically to TypeScript, MCP tools, and the
 *      dashboard's HTTP route
 *   3. Outbound traffic is auditable, centrally rate-limit-able, and
 *      independently swappable (residential proxy slot in without touching
 *      any caller)
 *
 * Path implementation: `direct` uses Node's default network egress;
 * gluetun-* paths route via the HTTP proxy each gluetun container publishes
 * on port 8888 inside the docker network (see compose.yaml + perry/scout/
 * README.md for the topology).
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { Logger } from '@perry/core';
import { NetworkCache } from './network-cache.js';

export type NetworkPath =
  | 'direct'
  | 'gluetun-uk'
  | 'gluetun-us'
  | 'gluetun-de'
  /** Route through perry-browser (Playwright + stealth). Use for anti-bot
   *  sites that CAPTCHA raw curl/undici (Amazon, Goodreads, Bookbub). The
   *  browser renders the page with full JS + realistic TLS, then returns
   *  the post-render HTML. ~1-3s per request, per-host rate-limited
   *  internally. Does NOT also go through a gluetun proxy — for that
   *  combination, use `browser-via-XX` or pass `proxy` in opts. */
  | 'browser';

export interface FetchOptions {
  /** Which exit to route through. Default: 'direct' (your home/server IP). */
  networkPath?: NetworkPath;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Request timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Convenience override for User-Agent (merged into headers). */
  userAgent?: string;
  /** Wait condition for the browser path. Default 'domcontentloaded'.
   *  Use 'networkidle' for SPAs that lazy-load critical data. */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** Selector to await before harvesting HTML on the browser path. */
  waitForSelector?: string;
  /** Cache TTL in ms. When > 0, NetworkClient checks the SQLite cache for
   *  this `(url, networkPath)` and serves from cache if the entry is fresher
   *  than the TTL. Successful fetches (status 2xx-3xx, ok: true) are stored
   *  back after the network call. Use 0 / undefined to bypass the cache. */
  cacheTtlMs?: number;
}

export interface FetchResult {
  status: number;
  ok: boolean;
  text: string;
  finalUrl: string;
  networkPath: NetworkPath;
  durationMs: number;
  contentType: string;
  byteCount: number;
}

export interface PathHealth {
  path: NetworkPath;
  available: boolean;
  exitIp?: string;
  lastCheckedAt: string;
  error?: string;
  latencyMs?: number;
}

const DEFAULT_TIMEOUT = 30_000;
const BROWSER_TIMEOUT = 60_000; // headless render needs more headroom
const DEFAULT_UA = 'Mozilla/5.0 (compatible; PerrySystem/1.0; +https://github.com/perry)';
const HEALTH_CACHE_MS = 30_000;
const IPIFY_URL = 'https://api.ipify.org';
const BROWSER_URL = process.env.PERRY_BROWSER_URL || 'http://perry-browser:3848';

// Reddit OAuth config. When REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET are set,
// Reddit fetches (any URL matching reddit.com/r/.../*.json or /search.json)
// auto-route through OAuth at oauth.reddit.com — Reddit blocks anonymous
// datacenter IPs since June 2024 (HTTP 500 / 403). Reddit OAuth user-agent
// MUST be globally unique per Reddit policy; set REDDIT_USER_AGENT to a
// descriptive identifier like "perry-bookbot/1.0 by /u/your_handle".
//
// Credentials resolve in this order: SecretsService vault → process.env
// fallback. NetworkClient.setSecrets() is called at boot from index.ts;
// until then, fallback handles dev / pre-bootstrap state.
const REDDIT_USER_AGENT = process.env.REDDIT_USER_AGENT || 'perry-bookbot/1.0';
function redditClientId(): string {
  return NetworkClient.peekSecret('reddit_client_id') || process.env.REDDIT_CLIENT_ID || '';
}
function redditClientSecret(): string {
  return NetworkClient.peekSecret('reddit_client_secret') || process.env.REDDIT_CLIENT_SECRET || '';
}
const REDDIT_OAUTH_HOST    = 'https://oauth.reddit.com';

// Fallback path when OAuth creds aren't set: route anonymous Reddit fetches
// through a residential-style HTTP proxy (TorGuard static IP via
// gluetun-torguard-uk by default). Same datacenter-block problem the OAuth
// route solves, different mechanism. Set in compose.yaml perry env.
// Round-robin pool of HTTP proxies for Reddit. REDDIT_PROXY_POOL takes
// precedence (comma-separated URLs); falls back to single REDDIT_PROXY.
// Multiple exits let us double effective rate-limit headroom — Reddit
// throttles per IP, so spreading requests across UK + US tunnels halves
// per-IP load during big mining runs.
const REDDIT_PROXY_URLS: string[] = (() => {
  const pool = (process.env.REDDIT_PROXY_POOL || '').split(',').map(s => s.trim()).filter(Boolean);
  if (pool.length) return pool;
  const single = (process.env.REDDIT_PROXY || '').trim();
  return single ? [single] : [];
})();
let _redditProxyDispatchers: ProxyAgent[] | null = null;
let _redditProxyIdx = 0;
function getRedditProxyDispatcher(): ProxyAgent | null {
  if (!REDDIT_PROXY_URLS.length) return null;
  if (!_redditProxyDispatchers) _redditProxyDispatchers = REDDIT_PROXY_URLS.map(u => new ProxyAgent(u));
  const d = _redditProxyDispatchers[_redditProxyIdx % _redditProxyDispatchers.length];
  _redditProxyIdx++;
  return d;
}

// Amazon proxy pool — passed through to perry-browser as the `proxy` field
// per request so Playwright spins up a context bound to that exit. Same
// rationale as Reddit: rotating between UK + US tunnels keeps any single
// IP off Amazon's anti-bot radar. Pool is a list of URLs, round-robin.
const AMAZON_PROXY_URLS: string[] = (() => {
  const pool = (process.env.AMAZON_PROXY_POOL || '').split(',').map(s => s.trim()).filter(Boolean);
  if (pool.length) return pool;
  const single = (process.env.AMAZON_PROXY || '').trim();
  return single ? [single] : [];
})();
let _amazonProxyIdx = 0;
function nextAmazonProxyUrl(): string | null {
  if (!AMAZON_PROXY_URLS.length) return null;
  const u = AMAZON_PROXY_URLS[_amazonProxyIdx % AMAZON_PROXY_URLS.length];
  _amazonProxyIdx++;
  return u;
}

// Proxy URL per gluetun container. Resolvable via docker DNS from the perry
// container. Overridable via env (e.g. if you rename gluetun services).
function proxyUrlFor(path: Exclude<NetworkPath, 'direct'>): string {
  const envKey = `${path.toUpperCase().replace(/-/g, '_')}_PROXY`; // GLUETUN_UK_PROXY
  return process.env[envKey] || `http://${path}:8888`;
}

/** Minimal interface NetworkClient needs from SecretsService. Avoids
 *  importing the @perry/core class directly (which would create a cycle). */
interface SecretsLookup {
  getSync(name: string): string | undefined;
}

export class NetworkClient {
  private static log = new Logger('network');
  private static healthCache = new Map<NetworkPath, PathHealth>();
  private static dispatchers = new Map<NetworkPath, ProxyAgent>();
  private static redditToken: { token: string; expiresAt: number } | null = null;
  /** Lazily-set SecretsService accessor for URL placeholder resolution.
   *  Set once at boot from index.ts. Without it, secret placeholders
   *  fall back to process.env (legacy behaviour). */
  private static secrets: SecretsLookup | null = null;

  /** Attach a SecretsService at boot so URLs containing
   *  `{{secret_name}}` placeholders resolve to encrypted values instead
   *  of having keys inlined into URL strings. */
  static setSecrets(secrets: SecretsLookup): void {
    NetworkClient.secrets = secrets;
  }

  /** Public synchronous secret read — used by other modules that need
   *  the same vault-first-then-env resolution order. Returns empty
   *  string if neither source has the secret (callers can fall through
   *  to "feature disabled" semantics). */
  static peekSecret(name: string): string {
    return NetworkClient.secrets?.getSync(name) || '';
  }

  /** Resolve `{{secret_name}}` placeholders in a URL. Returns null if any
   *  required placeholder is missing — caller should skip the request. */
  private static resolveSecretsInUrl(url: string): string | null {
    const re = /\{\{([a-z_][a-z0-9_]*)\}\}/gi;
    let resolved = url;
    let match: RegExpExecArray | null;
    const matches: Array<{ token: string; name: string }> = [];
    while ((match = re.exec(url)) !== null) {
      matches.push({ token: match[0], name: match[1] });
    }
    for (const m of matches) {
      // Secrets service takes precedence; env is the boot-time fallback
      // until SecretsService.bootstrapFromEnv has run for this secret.
      const value = NetworkClient.secrets?.getSync(m.name)
        || process.env[m.name.toUpperCase()]
        || '';
      if (!value) {
        NetworkClient.log.debug('skipping request — required secret missing', { name: m.name });
        return null;
      }
      resolved = resolved.split(m.token).join(encodeURIComponent(value));
    }
    return resolved;
  }

  /**
   * Fetch a URL through the chosen network path. Never throws — failures
   * return a result with `status: 0` and the error in `text`. Callers that
   * want exceptions should wrap manually.
   */
  static async fetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    // Resolve any `{{secret_name}}` placeholders BEFORE any logging or
    // cache lookup so the encrypted value never appears in either path.
    const resolvedUrl = NetworkClient.resolveSecretsInUrl(url);
    if (!resolvedUrl) {
      return {
        status: 0, ok: false,
        text: '[skipped: required secret placeholder not set]',
        finalUrl: url, networkPath: opts.networkPath || 'direct',
        durationMs: 0, contentType: '', byteCount: 0,
      };
    }
    // Cache key uses the resolved URL (key still gets hashed away in
    // network-cache.db since the cache table stores requests by URL).
    // To prevent the secret-bearing URL from landing in cache rows, we
    // cache by the *placeholder* URL instead.
    const cacheKey = url;
    url = resolvedUrl;
    const networkPath: NetworkPath = opts.networkPath || 'direct';

    // Cache lookup — only for GET-like requests (Reddit/OL/Amazon JSON+HTML
    // is all idempotent). Skip cache for non-GET methods.
    const cacheable = !opts.method || opts.method.toUpperCase() === 'GET';
    if (cacheable && opts.cacheTtlMs && opts.cacheTtlMs > 0) {
      const hit = NetworkCache.get(url, networkPath, opts.cacheTtlMs);
      if (hit) {
        NetworkClient.log.debug('cache hit', { url, networkPath, ageMs: Date.now() - hit.fetchedAt });
        return {
          status: hit.status,
          ok: hit.ok,
          text: hit.text,
          finalUrl: hit.finalUrl,
          networkPath,
          durationMs: 0,
          contentType: hit.contentType,
          byteCount: hit.byteCount,
        };
      }
    }

    const result = await NetworkClient.fetchUncached(url, opts, networkPath);

    // Store successful responses (NetworkCache itself drops failures).
    if (cacheable && opts.cacheTtlMs && opts.cacheTtlMs > 0 && result.ok) {
      NetworkCache.set(url, networkPath, {
        status: result.status,
        ok: result.ok,
        text: result.text,
        finalUrl: result.finalUrl,
        contentType: result.contentType,
        byteCount: result.byteCount,
      });
    }
    return result;
  }

  /** Internal: the actual network fetch path, sans cache. Kept private so
   *  callers always pass through the cache-aware `fetch()` entry point. */
  private static async fetchUncached(url: string, opts: FetchOptions, networkPath: NetworkPath): Promise<FetchResult> {
    // Auto-route Reddit fetches through OAuth when credentials are configured.
    // Reddit's free public JSON (www.reddit.com/r/X/top.json) blocks datacenter
    // IPs with HTTP 500 since June 2024. The OAuth endpoint (oauth.reddit.com)
    // has no such block — it just rate-limits per the docs (60 req/min for
    // client-credentials grant). Falls through to the configured networkPath
    // when credentials aren't set so the user gets a clear "Reddit blocked"
    // signal in the NO LIVE DATA report rather than a silent OAuth no-op.
    if (redditClientId() && redditClientSecret() &&
        /(?:^|\.)reddit\.com\/r\/[^/]+\/(?:top|search|comments)/i.test(url)) {
      return NetworkClient.fetchViaRedditOAuth(url, opts);
    }
    if (networkPath === 'browser') {
      return NetworkClient.fetchViaBrowser(url, opts);
    }
    const startedAt = Date.now();
    const headers: Record<string, string> = {
      'User-Agent': opts.userAgent || DEFAULT_UA,
      ...(opts.headers || {}),
    };

    // Reddit URLs from a Docker IP get 500/403 anonymously. When no OAuth
    // creds are configured but REDDIT_PROXY is set, transparently route
    // Reddit fetches through that HTTP proxy (TorGuard static IP exit) so
    // book-planning steps 3-4 actually return data instead of "STEP SKIPPED".
    const redditProxyDispatcher = /(?:^|\.)reddit\.com\//i.test(url) ? getRedditProxyDispatcher() : null;
    const dispatcher = redditProxyDispatcher ?? (networkPath === 'direct' ? undefined : NetworkClient.getDispatcher(networkPath as Exclude<NetworkPath, 'direct' | 'browser'>));

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
      let res: any;
      try {
        res = await undiciFetch(url, {
          method: opts.method || 'GET',
          headers,
          body: opts.body,
          signal: controller.signal,
          dispatcher,
        } as any);
      } finally {
        clearTimeout(timeoutId);
      }
      const text = await res.text();
      const result: FetchResult = {
        status: res.status,
        ok: res.ok,
        text,
        finalUrl: res.url || url,
        networkPath,
        durationMs: Date.now() - startedAt,
        contentType: res.headers.get('content-type') || '',
        byteCount: text.length,
      };
      NetworkClient.log.debug('fetch ok', { url, networkPath, status: res.status, ms: result.durationMs, bytes: result.byteCount });
      return result;
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? `timeout after ${opts.timeoutMs ?? DEFAULT_TIMEOUT}ms` : err?.message || String(err);
      NetworkClient.log.warn('fetch failed', { url, networkPath, error: msg });
      return {
        status: 0,
        ok: false,
        text: msg,
        finalUrl: url,
        networkPath,
        durationMs: Date.now() - startedAt,
        contentType: '',
        byteCount: 0,
      };
    }
  }

  /**
   * Report what network paths are currently reachable. Cached for 30s so
   * callers can poll cheaply. Each path is probed by hitting api.ipify.org
   * through it — the response IP is returned so you can verify the exit
   * country matches expectation.
   */
  static async availablePaths(): Promise<PathHealth[]> {
    const paths: NetworkPath[] = ['direct', 'gluetun-uk', 'gluetun-us', 'gluetun-de', 'browser'];
    const now = Date.now();
    const out: PathHealth[] = [];
    for (const path of paths) {
      const cached = NetworkClient.healthCache.get(path);
      if (cached && now - new Date(cached.lastCheckedAt).getTime() < HEALTH_CACHE_MS) {
        out.push(cached);
        continue;
      }
      const probe = await NetworkClient.fetch(IPIFY_URL, {
        networkPath: path,
        // Browser path needs more time on first probe (cold-start a Chromium context).
        timeoutMs: path === 'browser' ? 45_000 : 8_000,
      });
      // The browser path returns full HTML even for ipify, so extract the
      // first IP-shaped string instead of expecting an exact match.
      const ipMatch = probe.text.match(/\b\d+\.\d+\.\d+\.\d+\b/);
      const health: PathHealth = {
        path,
        available: probe.ok && !!ipMatch,
        exitIp: ipMatch?.[0],
        lastCheckedAt: new Date().toISOString(),
        latencyMs: probe.durationMs,
        error: probe.ok ? undefined : probe.text,
      };
      NetworkClient.healthCache.set(path, health);
      out.push(health);
    }
    return out;
  }

  /**
   * Strip HTML to plain text. Cheap regex-based — good enough for feeding
   * scraped pages into an LLM context, not a full DOM parse. Use this
   * before passing fetched HTML to a model so you don't waste tokens on
   * `<script>` and `<style>` blocks.
   */
  static stripHtml(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static getDispatcher(path: Exclude<NetworkPath, 'direct' | 'browser'>): ProxyAgent {
    let d = NetworkClient.dispatchers.get(path);
    if (!d) {
      const proxyUrl = proxyUrlFor(path);
      d = new ProxyAgent(proxyUrl);
      NetworkClient.dispatchers.set(path, d);
      NetworkClient.log.info('Proxy dispatcher created', { path, proxyUrl });
    }
    return d;
  }

  /**
   * Fetch a public Reddit listing via OAuth. Required since Reddit blocked
   * anonymous datacenter IPs in mid-2024 — even the free `*.json` endpoints
   * return HTTP 500 to non-authenticated requests.
   *
   * Uses the client-credentials grant (no user account, read-only public
   * listings) backed by REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET env vars.
   * Token is cached for its lifetime (typically 1h) to avoid re-auth on
   * every fetch. Rewrites the URL host from www.reddit.com → oauth.reddit.com
   * and drops any `.json` suffix (the OAuth endpoint always returns JSON).
   */
  private static async fetchViaRedditOAuth(url: string, opts: FetchOptions): Promise<FetchResult> {
    const startedAt = Date.now();
    try {
      const token = await NetworkClient.getRedditAccessToken();
      if (!token) {
        return {
          status: 0, ok: false,
          text: 'reddit oauth: failed to obtain access token (check REDDIT_CLIENT_ID/SECRET)',
          finalUrl: url, networkPath: 'direct',
          durationMs: Date.now() - startedAt, contentType: '', byteCount: 0,
        };
      }
      // Reddit OAuth endpoint expects oauth.reddit.com and drops the .json
      // suffix (it always returns JSON when Bearer-authed). The query string
      // (e.g. ?t=month&limit=20) carries over unchanged.
      const oauthUrl = url
        .replace(/^https?:\/\/(?:www|old|api)\.reddit\.com/i, REDDIT_OAUTH_HOST)
        .replace(/\.json(\?|$)/, '$1');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
      let res: any;
      try {
        res = await undiciFetch(oauthUrl, {
          method: opts.method || 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': REDDIT_USER_AGENT,
            'Accept': 'application/json',
            ...(opts.headers || {}),
          },
          body: opts.body,
          signal: controller.signal,
        } as any);
      } finally {
        clearTimeout(timeoutId);
      }
      const text = await res.text();
      // Invalidate token on 401 so the NEXT call re-auths. (Token may have
      // expired mid-flight or been revoked.)
      if (res.status === 401) NetworkClient.redditToken = null;
      return {
        status: res.status,
        ok: res.ok,
        text,
        finalUrl: oauthUrl,
        networkPath: 'direct',
        durationMs: Date.now() - startedAt,
        contentType: res.headers.get('content-type') || 'application/json',
        byteCount: text.length,
      };
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? `reddit oauth timeout` : err?.message || String(err);
      NetworkClient.log.warn('reddit oauth fetch failed', { url, error: msg });
      return {
        status: 0, ok: false, text: msg,
        finalUrl: url, networkPath: 'direct',
        durationMs: Date.now() - startedAt, contentType: '', byteCount: 0,
      };
    }
  }

  /** Get (and cache) a Reddit client-credentials OAuth token. Returns null
   *  on failure so callers can fall through to direct (which will fail with
   *  Reddit's HTTP 500 but at least surfaces a clear signal upstream). */
  private static async getRedditAccessToken(): Promise<string | null> {
    const now = Date.now();
    if (NetworkClient.redditToken && now < NetworkClient.redditToken.expiresAt) {
      return NetworkClient.redditToken.token;
    }
    try {
      const basic = Buffer.from(`${redditClientId()}:${redditClientSecret()}`).toString('base64');
      const res: any = await undiciFetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basic}`,
          'User-Agent': REDDIT_USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(10_000),
      } as any);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        NetworkClient.log.warn('reddit oauth token request failed', { status: res.status, body: body.slice(0, 200) });
        return null;
      }
      const json: any = await res.json();
      if (!json.access_token) {
        NetworkClient.log.warn('reddit oauth: missing access_token in response');
        return null;
      }
      // Renew 5 min before expiry to avoid mid-flight 401.
      const ttl = (json.expires_in || 3600) * 1000;
      NetworkClient.redditToken = {
        token: json.access_token,
        expiresAt: Date.now() + ttl - 5 * 60 * 1000,
      };
      NetworkClient.log.info('reddit oauth token acquired', { expiresInSec: json.expires_in });
      return json.access_token;
    } catch (err: any) {
      NetworkClient.log.warn('reddit oauth token exception', { error: err?.message || String(err) });
      return null;
    }
  }

  /**
   * Route a fetch through the perry-browser sidecar. Posts a small JSON
   * request to it and unpacks the rendered-page response into the standard
   * FetchResult shape so callers don't need to special-case browser paths.
   * Errors fall through to a status:0 FetchResult, matching the undici path.
   */
  private static async fetchViaBrowser(url: string, opts: FetchOptions): Promise<FetchResult> {
    const startedAt = Date.now();
    try {
      // Amazon URLs: round-robin through AMAZON_PROXY_POOL so Playwright
      // routes via a VPN exit (UK / US TorGuard). Other browser-path URLs
      // (Goodreads, Bookbub) stay on the shared direct context for cookie
      // warmth — they're less aggressively IP-blocked than Amazon.
      const amazonProxy = /(?:^|\.)amazon\.[a-z.]+\//i.test(url) ? nextAmazonProxyUrl() : null;
      const body = JSON.stringify({
        url,
        waitUntil: opts.waitUntil || 'domcontentloaded',
        waitForSelector: opts.waitForSelector,
        timeoutMs: opts.timeoutMs ?? BROWSER_TIMEOUT,
        ...(amazonProxy ? { proxy: amazonProxy } : {}),
      });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), (opts.timeoutMs ?? BROWSER_TIMEOUT) + 5_000);
      let res: any;
      try {
        res = await undiciFetch(`${BROWSER_URL}/fetch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        } as any);
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => 'unknown');
        return {
          status: res.status,
          ok: false,
          text: `perry-browser returned ${res.status}: ${errText}`,
          finalUrl: url,
          networkPath: 'browser',
          durationMs: Date.now() - startedAt,
          contentType: '',
          byteCount: 0,
        };
      }
      const out = await res.json() as { status: number; ok: boolean; text: string; finalUrl?: string; blocked?: string | null; ms?: number };
      NetworkClient.log.debug('browser fetch ok', { url, status: out.status, blocked: out.blocked, ms: out.ms, bytes: out.text?.length ?? 0 });
      return {
        status: out.status,
        ok: out.ok && !out.blocked,
        text: out.blocked ? `[blocked: ${out.blocked}]\n${out.text || ''}` : (out.text || ''),
        finalUrl: out.finalUrl || url,
        networkPath: 'browser',
        durationMs: Date.now() - startedAt,
        contentType: 'text/html',
        byteCount: (out.text || '').length,
      };
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? `browser timeout` : err?.message || String(err);
      NetworkClient.log.warn('browser fetch failed', { url, error: msg });
      return {
        status: 0,
        ok: false,
        text: msg,
        finalUrl: url,
        networkPath: 'browser',
        durationMs: Date.now() - startedAt,
        contentType: '',
        byteCount: 0,
      };
    }
  }
}
