#!/usr/bin/env node
/**
 * READ-ONLY balance/nonce snapshot exporter for a genesis migration.
 *
 * Replays the canonical chain with the same ledger the node uses
 * (replayChainLedgerAsync, applyP2P:true) and emits a deterministic
 * { address: {balance, nonce} } map + a sha256 snapshotHash. Writes only the
 * --out file; never touches chain data.
 *
 * Usage:
 *   node scripts/genesis/export-snapshot.mjs --data-dir ~/.dai-bootnode \
 *        [--height H] [--out snap.json] [--exclude addr1,addr2] [--include-system] \
 *        [--genesis-timestamp <ms>] \
 *        [--mint-stables] [--treasury <daiAddr>] [--force-abandon-escrow]
 *
 * --mint-stables adds the initial stablecoin supply (INITIAL_STABLE_SUPPLY_RAW
 * from src/assets.js) to the treasury row (--treasury overrides the address).
 * Existing per-asset balances in the replayed ledger are always carried over.
 *
 * By default the finalized tip is used (reorg-safe) and known system addresses
 * (the audit vault and the P2P escrow pool) are dropped. Pass --include-system
 * to keep them.
 *
 * Exits 3 if the P2P escrow pool still holds funds — those belong to open trades
 * whose records reset-node.sh wipes, so they must be settled before exporting.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
const NODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { ChainStore }             = await import(path.join(NODE, 'src/storage/chain-store.js'));
const { DAIBlock }               = await import(path.join(NODE, 'src/core/block.js'));
const { replayChainLedgerAsync } = await import(path.join(NODE, 'src/consensus/tx-ledger.js'));
const { FINALITY_DEPTH }         = await import(path.join(NODE, 'src/consensus/finality.js'));
const { TREASURY_ADDRESS, INITIAL_STABLE_SUPPLY_RAW } = await import(path.join(NODE, 'src/assets.js'));

// System / non-user addresses excluded by default (kept with --include-system).
const SYSTEM_ADDRESSES = new Set([
  'daiaudit000000000000000000000000000000000001', // audit vault
  'dai_p2p_escrow',                               // P2P escrow pool — see the guard below
]);

// The escrow pool is a pseudo-address holding funds locked against open trades.
// reset-node.sh wipes $BASE/p2p (orders.json + trades.json) along with the chain,
// so carrying an escrow balance into the new genesis would mint funds that no
// remaining trade could ever release -- stranded permanently. Dropping it instead
// destroys whatever was locked. Neither is acceptable, so a non-empty escrow is a
// hard stop: settle or cancel the open trades first, then re-export.
const ESCROW_ADDRESS = 'dai_p2p_escrow';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const dataDir = arg('--data-dir', path.join(os.homedir(), '.dai-bootnode')).replace(/^~/, os.homedir());
const outFile = arg('--out', null);
const heightArg = arg('--height', null);
const genesisTs = arg('--genesis-timestamp', null);
const includeSystem = argv.includes('--include-system');
const exclude = new Set([
  ...(includeSystem ? [] : SYSTEM_ADDRESSES),
  ...String(arg('--exclude', '')).split(',').map(s => s.trim()).filter(Boolean),
]);

const DAI = 1e9;
const fmt = raw => `${raw} (${(raw / DAI).toFixed(4)} DAI)`;

async function main() {
  console.log(`[snapshot] Loading chain from ${dataDir} …`);
  const raw = new ChainStore(dataDir).loadChain();
  if (!raw.length) { console.error('[snapshot] empty chain — nothing to export'); process.exit(2); }

  let chain = raw.map(b => DAIBlock.fromJSON(b));
  const tipHeight = chain[chain.length - 1].height;
  const finalizedHeight = tipHeight - FINALITY_DEPTH;
  const H = heightArg != null ? Number(heightArg) : finalizedHeight;
  chain = chain.filter(b => b.height <= H);
  console.log(`[snapshot] tip=${tipHeight} finalized=${finalizedHeight} → snapshot height ${H} (${chain.length} blocks)`);
  if (exclude.size) console.log(`[snapshot] excluding ${exclude.size} address(es): ${[...exclude].join(', ')}`);

  const ledger = await replayChainLedgerAsync(chain, { applyP2P: true });

  const addrs = new Set([...ledger.balances.keys(), ...ledger.nonces.keys()]);
  if (ledger.assetBalances) for (const m of ledger.assetBalances.values()) for (const a of m.keys()) addrs.add(a);

  // Hard stop on locked escrow. Silently carrying it forward strands the funds
  // (the trades that would release them are wiped with the chain); silently
  // dropping it destroys them. Either way the operator must decide, so refuse.
  const escrowDai = ledger.balances.get(ESCROW_ADDRESS) || 0;
  const escrowAssets = ledger.getAssetBalances ? ledger.getAssetBalances(ESCROW_ADDRESS) : {};
  const escrowAssetTotal = Object.values(escrowAssets).reduce((a, b) => a + (Number(b) || 0), 0);
  if ((escrowDai > 0 || escrowAssetTotal > 0) && !argv.includes('--force-abandon-escrow')) {
    console.error(`[snapshot] REFUSING: P2P escrow (${ESCROW_ADDRESS}) still holds funds.`);
    console.error(`[snapshot]   DAI: ${escrowDai}${escrowAssetTotal ? `  assets: ${JSON.stringify(escrowAssets)}` : ''}`);
    console.error('[snapshot]   reset-node.sh wipes p2p/orders.json + trades.json with the chain, so');
    console.error('[snapshot]   these funds would have no trade left to release them.');
    console.error('[snapshot]   Settle or cancel every open trade first, then re-export.');
    console.error('[snapshot]   (--force-abandon-escrow discards them deliberately.)');
    process.exit(3);
  }

  // Optional stablecoin genesis mint to the treasury (fresh-reset only).
  const mintStables = argv.includes('--mint-stables');
  const treasury = arg('--treasury', TREASURY_ADDRESS);
  if (mintStables) {
    if (!treasury || treasury.includes('TODO')) {
      console.error('[snapshot] --mint-stables requires a real treasury address (set src/assets.js TREASURY_ADDRESS or pass --treasury)');
      process.exit(2);
    }
    addrs.add(treasury);
  }

  const entries = [];
  let sumBalances = 0, excludedRaw = 0;
  for (const a of addrs) {
    const balance = ledger.balances.get(a) || 0;
    const nonce = ledger.nonces.get(a) || 0;
    // Carry over any existing per-asset holdings; add the genesis mint on the treasury row.
    const held = ledger.getAssetBalances ? ledger.getAssetBalances(a) : {};
    if (mintStables && a === treasury) {
      for (const [t, v] of Object.entries(INITIAL_STABLE_SUPPLY_RAW)) held[t] = (held[t] || 0) + v;
    }
    const hasAssets = Object.keys(held).length > 0;
    if (balance === 0 && nonce === 0 && !hasAssets) continue;
    if (exclude.has(a)) { excludedRaw += balance; continue; }
    entries.push([a, { balance, nonce, ...(hasAssets ? { assets: Object.fromEntries(Object.keys(held).sort().map(t => [t, held[t]])) } : {}) }]);
    sumBalances += balance;
  }
  entries.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)); // canonical key order
  const balancesObj = Object.fromEntries(entries);

  // Canonical hash: [addr, balance, nonce] tuples, with assets appended ONLY for
  // rows that hold any — a DAI-only snapshot hashes exactly as it always did.
  const canonical = JSON.stringify(entries.map(([a, v]) =>
    v.assets ? [a, v.balance, v.nonce, v.assets] : [a, v.balance, v.nonce]));
  const snapshotHash = crypto.createHash('sha256').update(canonical).digest('hex');

  const totalMinted = ledger.totalMinted;
  const dust = ledger.coinbaseDust || 0;
  // Conservation on the FULL ledger (before exclusions): sum+dust+excluded == minted.
  const conserves = sumBalances + dust + excludedRaw === totalMinted;

  console.log('\n───────── SNAPSHOT SUMMARY ─────────');
  console.log(`height:             ${H}`);
  console.log(`addresses:          ${entries.length}`);
  console.log(`sum(balances):      ${fmt(sumBalances)}`);
  console.log(`excluded balance:   ${fmt(excludedRaw)}`);
  console.log(`totalMinted:        ${fmt(totalMinted)}`);
  console.log(`coinbaseDust:       ${dust}`);
  console.log(`conservation:       ${conserves ? '✓ OK (sum+dust+excluded == minted)' : `✗ MISMATCH delta=${sumBalances + dust + excludedRaw - totalMinted}`}`);
  console.log(`snapshotHash:       ${snapshotHash}`);

  if (outFile) {
    const out = {
      version: 1, sourceHeight: H, tipHeight, finalizedHeight,
      snapshotHash, totalMinted, coinbaseDust: dust, excludedBalance: excludedRaw,
      excluded: [...exclude], sumBalances, addressCount: entries.length,
      genesisTimestamp: genesisTs != null ? Number(genesisTs) : undefined,
      generatedAt: new Date().toISOString(), balances: balancesObj,
    };
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(`\n[snapshot] wrote ${outFile}  (sha256 of file: ${crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex')})`);
  } else {
    console.log('\n[snapshot] (no --out; nothing written)');
  }
}
main().catch(e => { console.error('[snapshot] error:', e); process.exit(1); });
