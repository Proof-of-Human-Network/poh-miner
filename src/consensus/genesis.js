/**
 * Genesis construction — the original empty genesis, and a "migration genesis"
 * that carries a balance/nonce snapshot forward from a prior chain.
 *
 * The migration genesis mints exactly sum(balances) via block.genesisAllocations,
 * which replayChainLedger credits as canonical ledger state. Because the
 * allocations are part of blockHashInput, the genesis hash is distinct from any
 * chain without them — giving the reset chain a clean identity so old-chain peers
 * are genesis-mismatch-rejected instead of out-competing it on chainWork.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PohBlock } from '../core/block.js';
import { computeChainWork } from './chain-selection.js';

// ── Active network genesis (migration pin) ───────────────────────────────────
// After the balance-preserving hard fork, this is the canonical genesis hash.
// A node whose on-disk chain has a DIFFERENT genesis is running the pre-fork
// chain and auto-migrates to this one (see miner-node _migrateChainIfStale).
// Set to null to disable the pin (dev / pre-migration builds).
export const EXPECTED_GENESIS_HASH = 'caa42785e80e106b4477f99a1443247a718af6c7899de85cf98b658bb2c9d2ae';

/** Path to the snapshot bundled with the app (ships in the build), or null. */
export function defaultMigrationSnapshot() {
  if (!EXPECTED_GENESIS_HASH) return null;
  try {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), 'genesis-snapshot.json');
    return fs.existsSync(p) ? p : null;
  } catch { return null; }
}

// The original mainnet genesis parameters (kept so an un-migrated chain is
// byte-identical to today's).
export const LEGACY_GENESIS_TIMESTAMP = 1780700000000;
export const GENESIS_MINER = 'bootnode-genesis';

/** Canonical, deterministic allocation array from a snapshot's balances map. */
export function buildAllocations(balances) {
  return Object.entries(balances)
    .map(([address, v]) => ({
      address,
      balance: typeof v === 'object' ? Number(v.balance) || 0 : Number(v) || 0,
      nonce: typeof v === 'object' ? Number(v.nonce) || 0 : 0,
    }))
    .filter(a => a.balance > 0 || a.nonce > 0)
    .sort((x, y) => (x.address < y.address ? -1 : x.address > y.address ? 1 : 0));
}

/**
 * Build the migration genesis block.
 * @param snapshot  { balances: { addr: {balance,nonce} | rawBalance } , snapshotHash? }
 * @param opts      { timestamp, difficulty }
 */
export function buildMigrationGenesis(snapshot, { timestamp, difficulty = 4 } = {}) {
  if (!snapshot || !snapshot.balances) throw new Error('snapshot.balances required');
  const genesisAllocations = buildAllocations(snapshot.balances);
  const total = genesisAllocations.reduce((s, a) => s + a.balance, 0);

  const genesis = new PohBlock({
    height: 0,
    previousHash: '0'.repeat(64),
    // Timestamp order of precedence: explicit opt → the value stamped into the
    // snapshot (so every node derives the identical genesis from one file) →
    // the legacy timestamp. A distinct timestamp isn't strictly required (the
    // allocations already change the hash) but makes the reset epoch explicit.
    // NOTE: difficulty is NOT part of the block hash, so it can differ per node
    // without changing the genesis hash — the allocations + timestamp fully
    // determine identity.
    timestamp: timestamp ?? snapshot.genesisTimestamp ?? LEGACY_GENESIS_TIMESTAMP,
    minerWallet: GENESIS_MINER,
    difficulty,
    chainWork: computeChainWork('0', difficulty),
    genesisAllocations,
  });
  return { genesis, total, count: genesisAllocations.length };
}

/** Load a snapshot from a path (or pass through an object). Returns null when falsy. */
export function loadSnapshot(pathOrObj) {
  if (!pathOrObj) return null;
  if (typeof pathOrObj === 'object') return pathOrObj;
  try {
    return JSON.parse(fs.readFileSync(pathOrObj, 'utf8'));
  } catch (e) {
    throw new Error(`genesis snapshot unreadable at ${pathOrObj}: ${e.message}`);
  }
}

/**
 * Create the height-0 block for a node: a migration genesis when a snapshot is
 * provided, otherwise the legacy empty genesis (fully backward compatible — an
 * un-migrated chain stays byte-identical to today's).
 */
export function createGenesisBlock({ snapshot = null, timestamp, difficulty = 4 } = {}) {
  const snap = loadSnapshot(snapshot);
  if (snap) {
    const { genesis, total, count } = buildMigrationGenesis(snap, { timestamp, difficulty });
    return { genesis, migration: true, total, count, snapshotHash: snap.snapshotHash || null };
  }
  const genesis = new PohBlock({
    height: 0,
    previousHash: '0'.repeat(64),
    timestamp: timestamp ?? LEGACY_GENESIS_TIMESTAMP,
    minerWallet: GENESIS_MINER,
    difficulty,
    chainWork: computeChainWork('0', difficulty),
  });
  return { genesis, migration: false };
}
