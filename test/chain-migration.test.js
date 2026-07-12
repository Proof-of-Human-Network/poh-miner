import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PohMinerNode } from '../src/miner-node.js';
import { ChainStore } from '../src/storage/chain-store.js';
import { createGenesisBlock, buildMigrationGenesis, loadSnapshot, EXPECTED_GENESIS_HASH } from '../src/consensus/genesis.js';

const BUNDLED = path.join(process.cwd(), 'src/consensus/genesis-snapshot.json');

// Minimal node harness exercising only the migration methods (no heavy start()).
function makeNode(minerBase, chain) {
  const n = Object.create(PohMinerNode.prototype);
  n.config = {};
  n.currentDifficulty = 5;
  n.chainStore = new ChainStore(path.join(minerBase, 'chain'));
  n.chain = chain;
  return n;
}

describe('chain auto-migration', () => {
  let base;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'poh-mig-'));
    // Seed chain-derived caches + a wallets dir that must be preserved.
    fs.mkdirSync(path.join(base, 'chain'), { recursive: true });
    for (const d of ['meilisearch-data', 'rewards', 'p2p', 'data', 'wallets']) fs.mkdirSync(path.join(base, d), { recursive: true });
    fs.writeFileSync(path.join(base, 'ipfs_cid_cache.json'), '{"old":true}');
    fs.writeFileSync(path.join(base, 'wallets', 'w1.json'), 'WALLET');
    fs.writeFileSync(path.join(base, '.wallet-key'), 'KEY');
  });
  afterEach(() => { try { fs.rmSync(base, { recursive: true, force: true }); } catch {} });

  it('bundled snapshot builds exactly the pinned genesis hash', () => {
    const { genesis } = buildMigrationGenesis(loadSnapshot(BUNDLED));
    expect(genesis.getHashSync()).toBe(EXPECTED_GENESIS_HASH);
  });

  it('wipes a stale (pre-fork) chain and keeps wallets/keys', () => {
    const legacy = createGenesisBlock({ difficulty: 5 }).genesis;       // old genesis 534e…
    expect(legacy.getHashSync()).not.toBe(EXPECTED_GENESIS_HASH);
    const n = makeNode(base, [legacy]);
    fs.writeFileSync(path.join(base, 'chain', 'chain.ndjson'), JSON.stringify(legacy.toJSON()) + '\n');

    n._migrateChainIfStale();

    expect(n.chain).toEqual([]);                                        // cleared → new genesis will rebuild
    expect(fs.existsSync(path.join(base, 'chain', 'chain.ndjson'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'ipfs_cid_cache.json'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'meilisearch-data'))).toBe(false);
    // preserved:
    expect(fs.readFileSync(path.join(base, 'wallets', 'w1.json'), 'utf8')).toBe('WALLET');
    expect(fs.readFileSync(path.join(base, '.wallet-key'), 'utf8')).toBe('KEY');
  });

  it('is a no-op when the on-disk genesis already matches', () => {
    const current = buildMigrationGenesis(loadSnapshot(BUNDLED), { difficulty: 5 }).genesis; // 669db90…
    expect(current.getHashSync()).toBe(EXPECTED_GENESIS_HASH);
    const n = makeNode(base, [current]);
    fs.writeFileSync(path.join(base, 'chain', 'chain.ndjson'), JSON.stringify(current.toJSON()) + '\n');

    n._migrateChainIfStale();

    expect(n.chain).toHaveLength(1);                                    // untouched
    expect(fs.existsSync(path.join(base, 'chain', 'chain.ndjson'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'ipfs_cid_cache.json'))).toBe(true);
  });

  it('does NOT wipe when the snapshot builds a different genesis (safety guard)', () => {
    const legacy = createGenesisBlock({ difficulty: 5 }).genesis;
    const n = makeNode(base, [legacy]);
    fs.writeFileSync(path.join(base, 'chain', 'chain.ndjson'), JSON.stringify(legacy.toJSON()) + '\n');
    // A valid-but-WRONG snapshot (builds a genesis != EXPECTED_GENESIS_HASH).
    const wrong = path.join(base, 'wrong-snap.json');
    fs.writeFileSync(wrong, JSON.stringify({ balances: { pohdeadbeef: { balance: 1, nonce: 0 } } }));
    n.config.genesisSnapshot = wrong; // overrides bundled; target won't match the pin

    n._migrateChainIfStale();

    expect(n.chain).toHaveLength(1); // refused to wipe — genesis stays stale, no data loss
    expect(fs.existsSync(path.join(base, 'chain', 'chain.ndjson'))).toBe(true);
  });
});
