/**
 * Simple persistent chain storage for PoH Miner.
 * Uses JSON for MVP (can be upgraded to LevelDB/RocksDB later).
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_CHAIN_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.poh-miner', 'chain');

export class ChainStore {
  constructor(dataDir = DEFAULT_CHAIN_DIR) {
    this.dataDir = dataDir;
    this.chainFile = path.join(dataDir, 'chain.json');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  loadChain() {
    if (!fs.existsSync(this.chainFile)) {
      return [];
    }
    try {
      const data = fs.readFileSync(this.chainFile, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.warn('[ChainStore] Failed to load chain, starting fresh:', err.message);
      return [];
    }
  }

  saveChain(chain) {
    try {
      // Only save the last N blocks to keep file size reasonable (MVP)
      const toSave = chain.slice(-10000); // keep last 10k blocks
      fs.writeFileSync(this.chainFile, JSON.stringify(toSave, null, 2));
    } catch (err) {
      console.error('[ChainStore] Failed to save chain:', err.message);
    }
  }

  saveBlock(block) {
    // For simplicity, we re-save the whole chain on new blocks in MVP
    // In real impl we'd append efficiently.
  }
}
