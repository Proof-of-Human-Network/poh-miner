/**
 * Blockchain chat history search — Meilisearch (required) + local NDJSON mirror.
 * Indexes promptPreview, replies, and skill results for autocomplete and repeat detection.
 * Clients query via miner HTTP API (/api/search/*), not Meilisearch port directly.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildAllSearchDocuments } from '../chain/chain-job-index.js';

const DEFAULT_INDEX = 'poh-chat-history';
const DEFAULT_HOST = 'http://127.0.0.1:7700';

function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(s) {
  return normalizeText(s).split(/[^a-z0-9@]+/).filter(t => t.length > 1);
}

function similarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;
  const ta = new Set(tokenize(na));
  const tb = new Set(tokenize(nb));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union ? inter / union : 0;
}

function prefixScore(query, prompt) {
  const q = normalizeText(query);
  const p = normalizeText(prompt);
  if (!q || !p) return 0;
  if (p.startsWith(q)) return 1;
  if (p.includes(q)) return 0.85;
  const qt = tokenize(q);
  const pt = tokenize(p);
  if (!qt.length) return 0;
  let hits = 0;
  for (const t of qt) if (pt.some(w => w.startsWith(t) || w.includes(t))) hits++;
  return hits / qt.length;
}

export class ChatHistorySearch {
  constructor(opts = {}) {
    this.enabled = opts.enabled !== false;
    this.requireMeilisearch = opts.requireMeilisearch !== false;
    this.host = opts.host || DEFAULT_HOST;
    this.apiKey = opts.apiKey || '';
    this.indexName = opts.indexName || DEFAULT_INDEX;
    this.dataDir = opts.dataDir || path.join(os.homedir(), '.poh-miner', 'search');
    this.storePath = path.join(this.dataDir, 'chat-history.ndjson');
    this.docs = new Map();
    this._meiliClient = null;
    this._meiliIndex = null;
    this._meiliReady = false;
    this._initPromise = null;
  }

  async init() {
    if (this._initPromise) return this._initPromise;
    // Cache only successful inits. A failed init (e.g. a gossip chat job arriving
    // while Meilisearch is still spawning) must not be cached forever — clear the
    // promise on rejection so the next caller retries against the live server.
    this._initPromise = this._doInit().catch(err => {
      this._initPromise = null;
      throw err;
    });
    return this._initPromise;
  }

  async _doInit() {
    if (!this.enabled) return;
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    this._loadLocalStore();
    await this._connectMeilisearch();
    if (this._meiliReady && this.docs.size) {
      try { await this._meiliIndex.addDocuments([...this.docs.values()]); } catch { /* best effort */ }
    }
  }

  _loadLocalStore() {
    if (!fs.existsSync(this.storePath)) return;
    try {
      const lines = fs.readFileSync(this.storePath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const doc = JSON.parse(line);
        if (doc?.id) this.docs.set(doc.id, doc);
      }
    } catch { /* corrupt store — will rebuild from chain */ }
  }

  _persistDoc(doc) {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      fs.appendFileSync(this.storePath, JSON.stringify(doc) + '\n');
    } catch { /* non-fatal */ }
  }

  async _connectMeilisearch() {
    const attempts = this.requireMeilisearch ? 40 : 1;
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const { MeiliSearch } = await import('meilisearch');
        this._meiliClient = new MeiliSearch({ host: this.host, apiKey: this.apiKey || undefined });
        try {
          await this._meiliClient.createIndex(this.indexName, { primaryKey: 'id' });
        } catch { /* exists */ }
        this._meiliIndex = this._meiliClient.index(this.indexName);
        await this._meiliIndex.updateSettings({
          searchableAttributes: ['promptPreview', 'replyText', 'replySnippet', 'skillId'],
          filterableAttributes: ['requesterAddress', 'mined', 'skillId', 'jobType'],
          sortableAttributes: ['submittedAt'],
        });
        this._meiliReady = true;
        console.log(`[PoH-Search] Meilisearch connected at ${this.host} (index: ${this.indexName})`);
        return;
      } catch (e) {
        lastErr = e;
        if (i < attempts - 1) await new Promise(r => setTimeout(r, 500));
      }
    }
    this._meiliReady = false;
    const msg = `[PoH-Search] Meilisearch unavailable (${lastErr?.message})`;
    if (this.requireMeilisearch) throw new Error(msg);
    console.log(`${msg} — using local index (${this.docs.size} docs)`);
  }

  async indexDocument(doc) {
    if (!this.enabled || !doc?.id) return;
    const prev = this.docs.get(doc.id);
    this.docs.set(doc.id, doc);
    if (!prev) this._persistDoc(doc);
    else {
      try {
        const lines = fs.existsSync(this.storePath)
          ? fs.readFileSync(this.storePath, 'utf8').split('\n').filter(Boolean)
          : [];
        const updated = lines.map(l => {
          try {
            const d = JSON.parse(l);
            return d.id === doc.id ? JSON.stringify(doc) : l;
          } catch { return l; }
        });
        if (!updated.some(l => { try { return JSON.parse(l).id === doc.id; } catch { return false; } })) {
          updated.push(JSON.stringify(doc));
        }
        fs.writeFileSync(this.storePath, updated.join('\n') + (updated.length ? '\n' : ''));
      } catch { /* non-fatal */ }
    }
    if (this._meiliReady) {
      try { await this._meiliIndex.addDocuments([doc]); } catch { /* non-fatal */ }
    }
  }

  async reindexAll(chain, localRecords = []) {
    if (!this.enabled) return { count: 0 };
    const docs = buildAllSearchDocuments(chain, localRecords);
    this.docs.clear();
    for (const doc of docs) this.docs.set(doc.id, doc);
    try {
      fs.writeFileSync(this.storePath, docs.map(d => JSON.stringify(d)).join('\n') + (docs.length ? '\n' : ''));
    } catch { /* non-fatal */ }
    if (this._meiliReady) {
      try {
        await this._meiliIndex.deleteAllDocuments();
        if (docs.length) await this._meiliIndex.addDocuments(docs);
      } catch (e) {
        console.warn('[PoH-Search] Meilisearch reindex failed:', e.message);
      }
    }
    console.log(`[PoH-Search] Indexed ${docs.length} chat history document(s)`);
    return { count: docs.length };
  }

  _filterWallet(docs, wallet) {
    if (!wallet) return docs;
    return docs.filter(d => !d.requesterAddress || d.requesterAddress === wallet);
  }

  async suggest({ q = '', wallet = null, limit = 8 } = {}) {
    if (!this.enabled) return { suggestions: [], engine: 'disabled' };
    const query = String(q).trim();
    if (query.length < 2) return { suggestions: [], engine: 'meilisearch' };

    if (!this._meiliReady && this.requireMeilisearch) {
      await this._connectMeilisearch();
    }

    if (this._meiliReady) {
      try {
        const res = await this._meiliIndex.search(query, {
          limit: limit * 2,
          filter: wallet ? `requesterAddress = "${wallet}"` : undefined,
          attributesToRetrieve: ['jobId', 'promptPreview', 'replySnippet', 'skillId', 'submittedAt', 'mined'],
        });
        let hits = res.hits || [];
        if (wallet) hits = hits.filter(h => !h.requesterAddress || h.requesterAddress === wallet);
        const suggestions = hits.slice(0, limit).map(h => ({
          jobId: h.jobId,
          prompt: h.promptPreview,
          replyPreview: h.replySnippet || '',
          skillId: h.skillId,
          score: 1,
          fromChain: !!h.mined,
        }));
        return { suggestions, engine: 'meilisearch' };
      } catch (e) {
        if (this.requireMeilisearch) throw e;
      }
    }

    if (this.requireMeilisearch && !this._meiliReady) {
      throw new Error('[PoH-Search] Meilisearch required but not connected');
    }

    const ranked = this._filterWallet([...this.docs.values()], wallet)
      .map(d => ({ d, score: prefixScore(query, d.promptPreview) }))
      .filter(x => x.score > 0.2)
      .sort((a, b) => b.score - a.score || (b.d.submittedAt || 0) - (a.d.submittedAt || 0))
      .slice(0, limit);

    return {
      suggestions: ranked.map(({ d, score }) => ({
        jobId: d.jobId,
        prompt: d.promptPreview,
        replyPreview: d.replySnippet || '',
        skillId: d.skillId,
        score,
        fromChain: !!d.mined,
      })),
      engine: 'local',
    };
  }

  async matchRepetitive({ q = '', wallet = null, minScore = 0.82 } = {}) {
    if (!this.enabled) return null;
    const query = String(q).trim();
    if (query.length < 4) return null;

    const { suggestions } = await this.suggest({ q: query, wallet, limit: 5 });
    let best = null;
    for (const s of suggestions) {
      const score = similarity(query, s.prompt);
      if (score >= minScore && s.replyPreview) {
        if (!best || score > best.score) best = { ...s, score };
      }
    }
    if (best) {
      const doc = this.docs.get(best.jobId);
      return {
        jobId: best.jobId,
        prompt: best.prompt,
        reply: doc?.replyText || best.replyPreview,
        replyPreview: best.replyPreview,
        score: best.score,
        fromChainHistory: true,
        skillId: best.skillId,
      };
    }

    const localBest = this._filterWallet([...this.docs.values()], wallet)
      .filter(d => d.replyText)
      .map(d => ({ d, score: similarity(query, d.promptPreview) }))
      .filter(x => x.score >= minScore)
      .sort((a, b) => b.score - a.score)[0];

    if (!localBest) return null;
    return {
      jobId: localBest.d.jobId,
      prompt: localBest.d.promptPreview,
      reply: localBest.d.replyText,
      replyPreview: localBest.d.replySnippet,
      score: localBest.score,
      fromChainHistory: !!localBest.d.mined,
      skillId: localBest.d.skillId,
    };
  }
}