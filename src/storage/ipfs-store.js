/**
 * IPFSStore — layered IPFS persistence for chain snapshots and brain state.
 *
 * Write priority:
 *   1. Local Kubo daemon  (localhost:5001/api/v0)  — zero config, fastest
 *   2. Configured API     (IPFS_API_URL + IPFS_API_KEY env vars) — Pinata, etc.
 *   3. Skip write         — node still seeds content it receives from peers
 *
 * Read sources (tried in order until one responds):
 *   1. Local Kubo gateway (localhost:8080)
 *   2. ipfs.io
 *   3. cloudflare-ipfs.com
 *   4. gateway.pinata.cloud
 *
 * No npm dependency required — all I/O via the built-in fetch API (Node 18+).
 */

// Local Kubo gateway defaults to 8081 (NOT 8080 — the PoH bootnode owns 8080).
const DEFAULT_KUBO_API_BASE     = 'http://127.0.0.1:5001';
const DEFAULT_KUBO_GATEWAY_BASE = 'http://127.0.0.1:8081';
const REMOTE_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];
const TIMEOUT_MS = 10_000;

export class IPFSStore {
  constructor({ apiUrl, apiKey, kuboApiBase, kuboGatewayBase } = {}) {
    // Explicit override > env vars
    this.apiUrl = apiUrl || process.env.IPFS_API_URL || null;
    this.apiKey = apiKey || process.env.IPFS_API_KEY || null;
    // Local Kubo endpoints — kept in sync with the managed daemon's ports.
    const apiBase = (kuboApiBase || process.env.KUBO_API_BASE || DEFAULT_KUBO_API_BASE).replace(/\/$/, '');
    const gwBase  = (kuboGatewayBase || process.env.KUBO_GATEWAY_BASE || DEFAULT_KUBO_GATEWAY_BASE).replace(/\/$/, '');
    this.kuboApi   = `${apiBase}/api/v0`;
    this.gateways  = [`${gwBase}/ipfs/`, ...REMOTE_GATEWAYS];
    this._kuboAvailable = null; // null = unknown, true/false after first probe
  }

  // ── Probe ─────────────────────────────────────────────────────────────────

  async _probeKubo() {
    if (this._kuboAvailable !== null) return this._kuboAvailable;
    try {
      const res = await fetch(`${this.kuboApi}/version`, {
        method: 'POST',
        signal: AbortSignal.timeout(2000),
      });
      this._kuboAvailable = res.ok;
    } catch {
      this._kuboAvailable = false;
    }
    return this._kuboAvailable;
  }

  // ── Add (pin) ─────────────────────────────────────────────────────────────

  /**
   * Add and pin content. Returns the CID string, or null if no writable
   * IPFS endpoint is available.
   *
   * content: string | Buffer | object (auto-JSON-serialised)
   */
  async add(content, filename = 'data.json') {
    const body = typeof content === 'string' ? content
               : Buffer.isBuffer(content)    ? content
               : JSON.stringify(content, null, 2);

    // 1. Local Kubo
    if (await this._probeKubo()) {
      const cid = await this._kuboAdd(body, filename);
      if (cid) return cid;
    }

    // 2. Configured pinning API (Pinata-compatible)
    if (this.apiUrl) {
      const cid = await this._apiAdd(body, filename);
      if (cid) return cid;
    }

    return null;
  }

  async _kuboAdd(body, filename) {
    try {
      const form = new FormData();
      form.append('file', new Blob([body]), filename);
      const res = await fetch(`${this.kuboApi}/add?pin=true&quieter=true`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const lines = (await res.text()).trim().split('\n');
      const last  = JSON.parse(lines[lines.length - 1]);
      return last.Hash || null;
    } catch { return null; }
  }

  async _apiAdd(body, filename) {
    try {
      const form = new FormData();
      form.append('file', new Blob([body]), filename);
      const headers = {};
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers,
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const json = await res.json();
      // Pinata returns { IpfsHash }, web3.storage returns { cid }
      return json.IpfsHash || json.cid || json.Hash || null;
    } catch { return null; }
  }

  // ── Get (fetch) ───────────────────────────────────────────────────────────

  /**
   * Fetch content by CID from the first responsive gateway.
   * Returns the raw text, or null if unreachable.
   */
  async get(cid) {
    for (const gw of this.gateways) {
      try {
        const res = await fetch(`${gw}${cid}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) return await res.text();
      } catch { /* try next */ }
    }
    return null;
  }

  async getJSON(cid) {
    const text = await this.get(cid);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  // ── Convenience wrappers ──────────────────────────────────────────────────

  async addChainSnapshot(chain) {
    const snapshot = {
      height:    chain[chain.length - 1]?.height ?? 0,
      tipHash:   chain[chain.length - 1]?.getHashSync?.() ?? null,
      timestamp: Date.now(),
      blockCount: chain.length,
      // Store last 500 blocks — enough to verify and bootstrap a node
      blocks: chain.slice(-500).map(b => b.toJSON ? b.toJSON() : b),
    };
    return this.add(snapshot, 'chain-snapshot.json');
  }

  async addBrainState(brainDataDir) {
    const fs   = await import('fs');
    const path = await import('path');
    const read = f => {
      const p = path.join(brainDataDir, f);
      if (!fs.existsSync(p)) return null;
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
    };
    const weights  = read('weights.json')  || {};
    const feedback = read('feedback.json') || [];
    const pools    = read('pools.json')    || [];
    const snapshot = {
      weights,
      feedbackCount: feedback.length,
      poolCount:     pools.length,
      updatedAt:     Date.now(),
    };
    return this.add(snapshot, 'brain-state.json');
  }
}
