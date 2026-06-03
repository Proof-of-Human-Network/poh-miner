/**
 * PoH Miner Network - Verified Signals / Methods Manager
 *
 * Every miner MUST run with the exact same set of signals (methods).
 * This module ensures fault-tolerant synchronization of the canonical
 * verified signals list.
 *
 * Sources (in priority order):
 * 1. Published signals transactions received via the PoH chain / gossip
 * 2. Direct fetch from https://proofofhuman.ge/methods/verifyer (and fallbacks)
 * 3. Locally cached copy (~/.poh-miner/methods.json)
 *
 * All miners compute a deterministic `methodsHash` so the network can
 * detect and penalize results computed against stale method sets.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.poh-miner');
const METHODS_FILE = path.join(CONFIG_DIR, 'methods.json');

const PRIMARY_SOURCE = 'https://proofofhuman.ge/methods/verifyer';

// Robust list of HTTP gateways (in priority order)
const GATEWAYS = [
  'https://proofofhuman.ge/methods/verifyer',
];

// Public IPFS gateways used when lastKnownCID is set
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

// New: Sources for "signals that have live conviction curves" (the canonical set for miners)
const LIVE_SIGNALS_SOURCES = [
  'https://proofofhuman.ge/miner/signals/live',
  'https://proofofhuman.ge/miner/signals/transactions',
];

function computeMethodsHash(methods) {
  if (!Array.isArray(methods) || methods.length === 0) return 'empty';

  // Deterministic sort + minimal stable representation
  const stable = methods
    .map(m => ({
      id: m.id || m.methodId || '',
      type: m.type || '',
      description: (m.description || '').slice(0, 200),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const data = JSON.stringify(stable);
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

export class MethodsManager {
  constructor() {
    this.methods = [];
    this.hash = 'uninitialized';
    this.lastUpdated = 0;
    this.source = 'none';
    this.lastKnownCID = null;   // for future IPFS-published signals lists
    this._refreshInterval = null;
  }

  async init() {
    await this._ensureConfigDir();
    await this.loadFromDisk();

    // Do an initial sync (non-blocking for startup)
    this.sync().catch(err => {
      console.warn('[MethodsManager] Initial sync failed (will retry):', err.message);
    });

    // Periodic background re-sync (every 45 minutes)
    this._refreshInterval = setInterval(() => {
      this.sync().catch(() => {});
    }, 45 * 60 * 1000);

    return this;
  }

  async _ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  async loadFromDisk() {
    try {
      if (fs.existsSync(METHODS_FILE)) {
        const data = JSON.parse(fs.readFileSync(METHODS_FILE, 'utf8'));
        if (Array.isArray(data.methods) && data.methods.length > 0) {
          this.methods = data.methods;
          this.hash = data.hash || computeMethodsHash(this.methods);
          this.lastUpdated = data.lastUpdated || 0;
          this.source = data.source || 'disk';
          console.log(`[MethodsManager] Loaded ${this.methods.length} signals from disk (hash=${this.hash})`);
          return true;
        }
      }
    } catch (e) {
      console.warn('[MethodsManager] Failed to load cached methods:', e.message);
    }
    return false;
  }

  async saveToDisk() {
    try {
      const payload = {
        methods: this.methods,
        hash: this.hash,
        lastUpdated: this.lastUpdated,
        source: this.source,
        savedAt: Date.now(),
      };
      fs.writeFileSync(METHODS_FILE, JSON.stringify(payload, null, 2));
    } catch (e) {
      console.error('[MethodsManager] Failed to save methods cache:', e.message);
    }
  }

  /**
   * Fetch latest verified signals with robust gateway fallback + retry.
   */
  async fetchFromNetwork() {
    const maxRetries = 2;

    // Build the full gateway list: HTTP sources first, then IPFS if CID known
    const allSources = [...GATEWAYS];
    if (this.lastKnownCID) {
      for (const gw of IPFS_GATEWAYS) {
        allSources.push(`${gw}${this.lastKnownCID}/methods.json`);
      }
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      for (const url of allSources) {

        const isIPFS = url.includes('/ipfs/');
        try {
          console.log(`[MethodsManager] Fetching signals (attempt ${attempt + 1}) from ${isIPFS ? 'IPFS:' : ''}${url.slice(0, 60)}...`);

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 12000);

          const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json', 'User-Agent': 'poh-miner/0.1' },
          });
          clearTimeout(timeout);

          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const data = await res.json();

          if (!Array.isArray(data) || data.length === 0) {
            throw new Error('Invalid or empty methods array');
          }

          const newHash = computeMethodsHash(data);

          const changed = (newHash !== this.hash) || (data.length !== this.methods.length);

          if (changed) {
            console.log(`[MethodsManager] ✓ Updated signals: ${data.length} methods (hash=${newHash}) from ${url}`);
            this.methods = data;
            this.hash = newHash;
            this.lastUpdated = Date.now();
            this.source = url;
            await this.saveToDisk();
          } else {
            console.log(`[MethodsManager] Signals unchanged (hash=${this.hash}, ${data.length} methods)`);
          }

          return { success: true, count: data.length, hash: this.hash, source: url };
        } catch (err) {
          console.warn(`[MethodsManager] Failed ${url}: ${err.message}`);
        }
      }

      if (attempt < maxRetries) {
        const delay = 1500 * (attempt + 1);
        console.log(`[MethodsManager] Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return { success: false, error: 'All gateways failed after retries' };
  }

  /**
   * Main sync entrypoint. Tries network first, falls back to disk.
   */
  async sync() {
    const result = await this.fetchFromNetwork();

    // Also sync the "published with live conviction curves" set.
    // Per spec: miners only fully consider a signal once its curve pool is created.
    await this.syncPublishedWithCurves().catch(() => {});

    if (!result.success && this.methods.length === 0) {
      // Last resort: if we have nothing at all, try to load whatever the dev tree has
      // (only useful during development)
      try {
        const devPath = path.resolve(__dirname, '../../../../dev/data/methods.json');
        if (fs.existsSync(devPath)) {
          const devMethods = JSON.parse(fs.readFileSync(devPath, 'utf8'));
          if (Array.isArray(devMethods) && devMethods.length > 0) {
            this.methods = devMethods;
            this.hash = computeMethodsHash(this.methods);
            this.lastUpdated = Date.now();
            this.source = 'dev-fallback';
            console.warn('[MethodsManager] Using dev/ fallback methods.json (not recommended for production miners)');
            await this.saveToDisk();
          }
        }
      } catch {}
    }

    return this.getStatus();
  }

  /**
   * Fetch signals that have confirmed conviction curve pools.
   * This is the set the miner network treats as canonical.
   */
  async syncPublishedWithCurves() {
    for (const url of LIVE_SIGNALS_SOURCES) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) continue;

        const data = await res.json();

        let newMethods = [];

        if (Array.isArray(data?.signals)) {
          newMethods = data.signals;
        } else if (Array.isArray(data?.transactions)) {
          // From /miner/signals/transactions
          newMethods = data.transactions
            .filter(tx => tx.type === 'signal-published' && tx.method)
            .map(tx => tx.method);
        }

        if (newMethods.length > 0) {
          const newHash = computeMethodsHash(newMethods);
          if (newHash !== this.hash || newMethods.length !== this.methods.length) {
            console.log(`[MethodsManager] Synced ${newMethods.length} live signals with curves (hash=${newHash})`);
            this.methods = newMethods;
            this.hash = newHash;
            this.lastUpdated = Date.now();
            this.source = url;
            await this.saveToDisk();
          }
          return { success: true, count: newMethods.length, hash: this.hash };
        }
      } catch (e) {
        // try next source
      }
    }
    return { success: false };
  }

  getActiveMethods() {
    return this.methods;
  }

  getStatus() {
    return {
      count: this.methods.length,
      hash: this.hash,
      lastUpdated: this.lastUpdated,
      source: this.source,
      ageMinutes: this.lastUpdated ? Math.round((Date.now() - this.lastUpdated) / 60000) : null,
      lastKnownCID: this.lastKnownCID || null,
      hasCurveBacking: this.source?.includes('/miner/') || false,
    };
  }

  /**
   * For future on-chain published signals transactions
   */
  async applyPublishedUpdate(methods, meta = {}) {
    const newHash = computeMethodsHash(methods);
    if (newHash === this.hash) return false;

    console.log(`[MethodsManager] Applying on-chain signals update (hash=${newHash})`);
    this.methods = methods;
    this.hash = newHash;
    this.lastUpdated = Date.now();
    this.source = meta.source || 'on-chain';
    await this.saveToDisk();
    return true;
  }

  stop() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
    }
  }
}

// Singleton for convenience
let _instance = null;

export async function getMethodsManager() {
  if (!_instance) {
    _instance = new MethodsManager();
    await _instance.init();
  }
  return _instance;
}

export default MethodsManager;
