// Perry headless-browser fetcher
//
// Tiny Express service that renders pages through a stealth-patched Chromium
// so anti-bot sites (Amazon, Goodreads, Bookbub) see something that looks
// like a real browser. Exposes:
//
//   POST /fetch    { url, waitUntil?, waitForSelector?, timeoutMs?, proxy? }
//                  → { status, ok, text, finalUrl, title, ms, blocked? }
//
//   GET  /health   → { ok, browser: 'ready' | 'starting' | 'down' }
//
// Stealth posture (anti-detection):
//   - playwright-extra + puppeteer-extra-plugin-stealth (overrides webdriver,
//     plugin enumeration, languages, permission queries, etc.)
//   - Random viewport from a fixed pool of common desktop resolutions
//   - Realistic UA from a small rotating pool
//   - `headless: false`-style ARGS even though we run headful via xvfb-less
//   - A tiny humaniser: random scroll + mouse move before harvesting HTML
//
// Per-host rate limit: 1 request per 25s with jitter (Amazon is grumpy with
// burst traffic even from a clean fingerprint). Cache layer is upstream in
// Perry — this service is dumb.
//
// Single shared browser context, lazy-loaded on first request. If a request
// errors mid-flight we DON'T kill the context — playwright will recycle the
// page. The context is recycled hourly to clear cookie buildup.

import express from 'express';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

const PORT = Number(process.env.PORT) || 3848;
const CONTEXT_TTL_MS = 60 * 60 * 1000; // 1h

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Browser lifecycle ────────────────────────────────────────────────────
let browser = null;
let context = null;
let contextStartedAt = 0;
let browserState = 'down';

async function ensureBrowser() {
  if (browser && context && Date.now() - contextStartedAt < CONTEXT_TTL_MS) return;

  if (context) {
    try { await context.close(); } catch {}
    context = null;
  }
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
  }

  browserState = 'starting';
  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  context = await browser.newContext({
    userAgent: pick(USER_AGENTS),
    viewport: pick(VIEWPORTS),
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  contextStartedAt = Date.now();
  browserState = 'ready';
}

// ── Per-host rate limit ──────────────────────────────────────────────────
const lastHitByHost = new Map();
const MIN_GAP_MS = 25_000; // 25s base
const JITTER_MS = 8_000;   // + up to 8s random

async function rateLimit(url) {
  const host = new URL(url).host;
  const now = Date.now();
  const last = lastHitByHost.get(host) ?? 0;
  const gap = MIN_GAP_MS + Math.random() * JITTER_MS;
  const wait = (last + gap) - now;
  if (wait > 0) {
    await sleep(wait);
  }
  lastHitByHost.set(host, Date.now());
}

// ── Humaniser ────────────────────────────────────────────────────────────
async function humanise(page) {
  try {
    await page.mouse.move(200 + Math.random() * 600, 200 + Math.random() * 400);
    await sleep(300 + Math.random() * 700);
    await page.mouse.wheel(0, 400 + Math.random() * 600);
    await sleep(400 + Math.random() * 800);
  } catch { /* page may have navigated away */ }
}

// ── Block detector ───────────────────────────────────────────────────────
function detectBlock(html, url) {
  const lower = (html || '').toLowerCase();
  if (/captcha|enter the characters you see|robot check|automated traffic/.test(lower)) {
    return 'captcha';
  }
  if (url.includes('amazon.') && !/data-asin=|dp\//.test(html) && html.length < 30000) {
    return 'amazon-empty';
  }
  return null;
}

// ── Fetch handler ────────────────────────────────────────────────────────
async function fetchOne({ url, waitUntil = 'domcontentloaded', waitForSelector, timeoutMs = 30_000, proxy }) {
  const started = Date.now();
  await ensureBrowser();
  await rateLimit(url);

  // Per-request page; share context for cookie warmth.
  // If a proxy is supplied, we need a one-shot context override since
  // Playwright context proxy is fixed at creation. Use a new context per
  // request when proxied — slower but necessary for VPN routing.
  let pageCtx = context;
  let disposablePageCtx = null;
  if (proxy) {
    disposablePageCtx = await browser.newContext({
      userAgent: pick(USER_AGENTS),
      viewport: pick(VIEWPORTS),
      locale: 'en-US',
      timezoneId: 'America/New_York',
      proxy: { server: proxy },
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    pageCtx = disposablePageCtx;
  }

  const page = await pageCtx.newPage();
  let response;
  let text = '';
  let blocked = null;
  let status = 0;
  let finalUrl = url;
  let title = '';

  try {
    response = await page.goto(url, { waitUntil, timeout: timeoutMs });
    status = response?.status() ?? 0;
    finalUrl = page.url();

    if (waitForSelector) {
      try { await page.waitForSelector(waitForSelector, { timeout: Math.max(2000, timeoutMs / 3) }); } catch {}
    }

    await humanise(page);
    title = await page.title().catch(() => '');
    text = await page.content();
    blocked = detectBlock(text, finalUrl);
  } catch (e) {
    text = `[playwright error: ${e.message}]`;
    status = status || 599;
  } finally {
    await page.close().catch(() => {});
    if (disposablePageCtx) await disposablePageCtx.close().catch(() => {});
  }

  return {
    status,
    ok: status >= 200 && status < 400 && !blocked,
    text,
    finalUrl,
    title,
    blocked,
    ms: Date.now() - started,
  };
}

// ── HTTP layer ───────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: browserState === 'ready' || browserState === 'down', browser: browserState });
});

app.post('/fetch', async (req, res) => {
  const { url, waitUntil, waitForSelector, timeoutMs, proxy } = req.body || {};
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    res.status(400).json({ error: 'url must be an absolute http(s) URL' });
    return;
  }
  try {
    const result = await fetchOne({ url, waitUntil, waitForSelector, timeoutMs, proxy });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`perry-browser listening on :${PORT}`);
  // Pre-warm browser so first real request isn't slow.
  ensureBrowser().catch(err => console.warn('pre-warm failed:', err.message));
});
