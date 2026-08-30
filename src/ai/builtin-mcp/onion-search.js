/**
 * Builtin Onion-Search pack — native port of maximilianromer/Onion-Search-MCP.
 *
 * Tools: get_sources, fetch_pages, fetch_specific_page.
 * Prefers Tor (SOCKS on 9050/9150) via curl --socks5-hostname when available;
 * falls back to clearnet DuckDuckGo so the skillset still works without Tor.
 */

import net from 'net';
import { spawn } from 'child_process';
import { UA, compact, str } from './fetch.js';

const SESSION = { results: [], via: null, at: 0 };

function portOpen(host, port, ms = 350) {
  return new Promise(resolve => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); resolve(false); }, ms);
    s.once('connect', () => { clearTimeout(t); s.destroy(); resolve(true); });
    s.once('error', () => { clearTimeout(t); resolve(false); });
  });
}

export async function detectTor() {
  if (await portOpen('127.0.0.1', 9050)) return { host: '127.0.0.1', port: 9050 };
  if (await portOpen('127.0.0.1', 9150)) return { host: '127.0.0.1', port: 9150 };
  return null;
}

function curlGet(url, { socks, timeoutMs = 25_000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-sL', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-A', UA];
    if (socks) args.push('--socks5-hostname', `${socks.host}:${socks.port}`);
    args.push(url);
    const p = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `curl exited ${code}`));
    });
  });
}

async function getPage(url, socks) {
  try {
    return await curlGet(url, { socks });
  } catch {
    if (socks) {
      // Tor failed — last-resort clearnet so the tool still answers.
      return curlGet(url, { socks: null });
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
}

function parseDdg(html) {
  const titleRe = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const titles = [...html.matchAll(titleRe)];
  const snippets = [...html.matchAll(snippetRe)];
  const out = [];
  for (let i = 0; i < Math.min(titles.length, 8); i++) {
    let url = titles[i][1] || '';
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    else if (url.startsWith('//')) url = 'https:' + url;
    const title = (titles[i][2] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const snippet = snippets[i]
      ? snippets[i][1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      : '';
    if (title && url) out.push({ title, snippet, url });
  }
  return out;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

export const ONION_SEARCH_CARDS = [
  {
    id: 'onion-search/get_sources',
    mcpId: 'onion-search',
    tool: 'get_sources',
    auth: 'none',
    summary: 'Anonymous web search via Tor (DuckDuckGo). Falls back to clearnet if Tor is down.',
    tags: ['search', 'tor', 'onion', 'web'],
    triggers: ['onion search', 'tor search', 'anonymous search', 'search via tor', 'dark web search'],
  },
  {
    id: 'onion-search/fetch_pages',
    mcpId: 'onion-search',
    tool: 'fetch_pages',
    auth: 'none',
    summary: 'Fetch pages from the last onion-search result list by index.',
    tags: ['search', 'tor', 'fetch'],
    triggers: ['fetch pages', 'open search result'],
  },
  {
    id: 'onion-search/fetch_specific_page',
    mcpId: 'onion-search',
    tool: 'fetch_specific_page',
    auth: 'none',
    summary: 'Fetch a specific URL through Tor when available.',
    tags: ['fetch', 'tor'],
    triggers: ['fetch this url', 'open this link via tor'],
  },
];

export const ONION_SEARCH_TOOLS = [
  {
    name: 'get_sources',
    description: 'Search the web anonymously through Tor (DuckDuckGo). Pass 1–3 queries. Returns numbered sources.',
    inputSchema: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' }, description: '1–3 search queries' },
        query: { type: 'string', description: 'Single query (alias)' },
      },
    },
    cardId: 'onion-search/get_sources',
    async run(args) {
      let queries = Array.isArray(args.queries) ? args.queries.map(str).filter(Boolean) : [];
      if (!queries.length && str(args.query || args.q || args.message)) {
        queries = [str(args.query || args.q || args.message)];
      }
      queries = queries.slice(0, 3);
      if (!queries.length) throw new Error('queries required');

      const socks = await detectTor();
      const via = socks ? `tor:${socks.host}:${socks.port}` : 'clearnet';
      const grouped = [];
      const flat = [];
      for (const q of queries) {
        const html = await getPage(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, socks);
        const hits = parseDdg(html);
        grouped.push({ query: q, results: hits });
        for (const h of hits) {
          if (!flat.find(x => x.url === h.url)) flat.push(h);
        }
      }
      SESSION.results = flat.slice(0, 15).map((h, i) => ({ index: i + 1, ...h }));
      SESSION.via = via;
      SESSION.at = Date.now();
      const numbered = SESSION.results.map(r =>
        `${r.index}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
      ).join('\n');
      return compact({
        via,
        note: socks ? 'routed through local Tor SOCKS' : 'Tor not detected on 9050/9150; used clearnet DuckDuckGo',
        results: numbered,
      });
    },
  },
  {
    name: 'fetch_pages',
    description: 'Fetch up to 5 pages by index from the most recent get_sources call.',
    inputSchema: {
      type: 'object',
      properties: {
        indexes: { type: 'array', items: { type: 'number' } },
      },
    },
    cardId: 'onion-search/fetch_pages',
    async run(args) {
      const indexes = (Array.isArray(args.indexes) ? args.indexes : [args.index])
        .map(n => Number(n))
        .filter(n => Number.isFinite(n));
      if (!indexes.length) throw new Error('indexes required');
      if (!SESSION.results.length) throw new Error('no prior get_sources results — search first');
      const socks = await detectTor();
      const pages = [];
      for (const idx of indexes.slice(0, 5)) {
        const hit = SESSION.results.find(r => r.index === idx);
        if (!hit) { pages.push({ index: idx, error: 'unknown index' }); continue; }
        try {
          const html = await getPage(hit.url, socks);
          pages.push({ index: idx, url: hit.url, title: hit.title, text: stripHtml(html) });
        } catch (e) {
          pages.push({ index: idx, url: hit.url, error: e.message });
        }
      }
      return compact({ via: socks ? 'tor' : 'clearnet', pages });
    },
  },
  {
    name: 'fetch_specific_page',
    description: 'Fetch a single URL directly, through Tor when available.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
    cardId: 'onion-search/fetch_specific_page',
    async run(args) {
      const url = str(args.url);
      if (!url || !/^https?:\/\//i.test(url)) throw new Error('http(s) url required');
      // Block obvious private/localhost targets.
      try {
        const u = new URL(url);
        if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1)/i.test(u.hostname)) {
          throw new Error('refusing private/loopback URL');
        }
      } catch (e) {
        if (/refusing/.test(e.message)) throw e;
        throw new Error('invalid url');
      }
      const socks = await detectTor();
      const html = await getPage(url, socks);
      return compact({ url, via: socks ? 'tor' : 'clearnet', text: stripHtml(html) });
    },
  },
];

export const ONION_SEARCH_PACK = {
  id: 'onion-search',
  name: 'Onion Search',
  summary: 'Anonymous web search and page fetch (Tor when available). Port of Onion-Search-MCP.',
  tools: ONION_SEARCH_TOOLS,
  cards: ONION_SEARCH_CARDS,
};
