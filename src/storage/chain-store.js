/**
 * Persistent chain storage for PoH Miner.
 *
 * Two-tier storage:
 *   chain.ndjson  — append-only, one block per line (O(1) write per block)
 *   chain.json    — full rewrite, used for reorgs and initial batch saves
 *
 * loadChain() prefers ndjson; saveBlock() appends; saveChain() rewrites both.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const DEFAULT_CHAIN_DIR = path.join(os.homedir(), '.poh-miner', 'chain');

export class ChainStore {
  constructor(dataDir = DEFAULT_CHAIN_DIR) {
    this.dataDir    = dataDir;
    this.chainFile  = path.join(dataDir, 'chain.json');
    this.appendFile = path.join(dataDir, 'chain.ndjson');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  loadChain() {
    // ndjson is the live append-only log — prefer it when it exists and has content
    if (fs.existsSync(this.appendFile)) {
      try {
        const lines = fs.readFileSync(this.appendFile, 'utf8').split('\n').filter(Boolean);
        if (lines.length > 0) return lines.map(l => JSON.parse(l));
      } catch (err) {
        console.warn('[ChainStore] chain.ndjson unreadable, falling back to chain.json:', err.message);
      }
    }
    // Fall back to legacy full-JSON file
    if (!fs.existsSync(this.chainFile)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.chainFile, 'utf8'));
    } catch (err) {
      console.warn('[ChainStore] Failed to load chain, starting fresh:', err.message);
      return [];
    }
  }

  // Append a single block — O(1), the hot path for every accepted block
  saveBlock(block) {
    try {
      const line = JSON.stringify(block.toJSON ? block.toJSON() : block) + '\n';
      fs.appendFileSync(this.appendFile, line);
    } catch (err) {
      console.error('[ChainStore] Failed to append block:', err.message);
    }
  }

  // Full rewrite — used for reorgs, batch sync saves, and genesis init
  saveChain(chain) {
    try {
      const toSave = chain;
      // Rewrite ndjson (canonical source)
      const lines = toSave.map(b => JSON.stringify(b.toJSON ? b.toJSON() : b)).join('\n');
      fs.writeFileSync(this.appendFile, lines + (lines ? '\n' : ''));
      // Keep chain.json as a human-readable backup
      fs.writeFileSync(this.chainFile, JSON.stringify(toSave, null, 2));
    } catch (err) {
      console.error('[ChainStore] Failed to save chain:', err.message);
    }
  }
}
