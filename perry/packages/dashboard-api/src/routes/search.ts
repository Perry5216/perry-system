/**
 * @perry/dashboard-api — Generic web search routes.
 *
 * Wraps multiple search-API backends behind one endpoint. Env-keyed; the
 * backend is selected by query param (?backend=tavily) or by which API key
 * is configured (falls back to the first available).
 *
 *   GET /api/search?q=query&backend=tavily&limit=10
 *
 * Supported backends:
 *   tavily    — TAVILY_API_KEY              (https://tavily.com)
 *   exa       — EXA_API_KEY                 (https://exa.ai)
 *   firecrawl — FIRECRAWL_API_KEY           (https://firecrawl.dev)
 *
 * Used by any domain that needs generic web research. Perry's existing
 * NetworkClient handles book-specific scrapers (Reddit, Goodreads, etc.);
 * this is for general-purpose search.
 */

import { Router } from 'express';
import type { Logger } from '@perry/core';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  source?: string;
}

export function setupSearchRoutes(log: Logger) {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) return res.status(400).json({ error: 'q (query) required' });
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10));
      const requested = String(req.query.backend || '').toLowerCase();

      // Auto-pick available backend if none specified.
      const tavilyKey = process.env.TAVILY_API_KEY;
      const exaKey = process.env.EXA_API_KEY;
      const fcKey = process.env.FIRECRAWL_API_KEY;
      const backend = requested
        || (tavilyKey ? 'tavily' : exaKey ? 'exa' : fcKey ? 'firecrawl' : '');
      if (!backend) {
        return res.status(503).json({
          error: 'no search backend configured',
          hint: 'set TAVILY_API_KEY, EXA_API_KEY, or FIRECRAWL_API_KEY',
        });
      }

      let results: SearchResult[] = [];
      switch (backend) {
        case 'tavily':
          if (!tavilyKey) return res.status(503).json({ error: 'TAVILY_API_KEY not set' });
          results = await searchTavily(q, limit, tavilyKey, log);
          break;
        case 'exa':
          if (!exaKey) return res.status(503).json({ error: 'EXA_API_KEY not set' });
          results = await searchExa(q, limit, exaKey, log);
          break;
        case 'firecrawl':
          if (!fcKey) return res.status(503).json({ error: 'FIRECRAWL_API_KEY not set' });
          results = await searchFirecrawl(q, limit, fcKey, log);
          break;
        default:
          return res.status(400).json({ error: `unknown backend "${backend}". supported: tavily, exa, firecrawl` });
      }

      res.json({ query: q, backend, count: results.length, results });
    } catch (err: any) {
      log.error('GET /search failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/backends', (_req, res) => {
    res.json({
      available: [
        { id: 'tavily', configured: !!process.env.TAVILY_API_KEY },
        { id: 'exa', configured: !!process.env.EXA_API_KEY },
        { id: 'firecrawl', configured: !!process.env.FIRECRAWL_API_KEY },
      ],
    });
  });

  return router;
}

async function searchTavily(q: string, limit: number, apiKey: string, log: Logger): Promise<SearchResult[]> {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query: q, max_results: limit, search_depth: 'basic' }),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data: any = await r.json();
  return (data.results || []).map((x: any) => ({
    title: x.title || '',
    url: x.url || '',
    snippet: x.content || x.snippet || '',
    score: x.score,
    source: 'tavily',
  }));
}

async function searchExa(q: string, limit: number, apiKey: string, log: Logger): Promise<SearchResult[]> {
  const r = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query: q, num_results: limit }),
  });
  if (!r.ok) throw new Error(`Exa ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data: any = await r.json();
  return (data.results || []).map((x: any) => ({
    title: x.title || '',
    url: x.url || '',
    snippet: x.text || x.snippet || '',
    score: x.score,
    source: 'exa',
  }));
}

async function searchFirecrawl(q: string, limit: number, apiKey: string, log: Logger): Promise<SearchResult[]> {
  const r = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ query: q, limit }),
  });
  if (!r.ok) throw new Error(`Firecrawl ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data: any = await r.json();
  return (data.data || data.results || []).map((x: any) => ({
    title: x.title || x.metadata?.title || '',
    url: x.url || '',
    snippet: x.description || x.markdown?.slice(0, 200) || '',
    source: 'firecrawl',
  }));
}
