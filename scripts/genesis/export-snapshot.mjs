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
 *   node scripts/genesis/export-snapshot.mjs --data-dir ~/.poh-bootnode \
 *        [--height H] [--out snap.json] [--exclude addr1,addr2] [--include-system] \
 *        [--genesis-timestamp <ms>]
 *
 * By default the finalized tip is used (reorg-safe) and known system addresses
 * (e.g. the audit vault) are dropped. Pass --include-system to keep them.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
const NODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { ChainStore }             = await import(path.join(NODE, 'src/storage/chain-store.js'));
const { PohBlock }               = await import(path.join(NODE, 'src/core/block.js'));
const { replayChainLedgerAsync } = await import(path.join(NODE, 'src/consensus/tx-ledger.js'));
const { FINALITY_DEPTH }         = await import(path.join(NODE, 'src/consensus/finality.js'));

// System / non-user addresses excluded by default (kept with --include-system).
const SYSTEM_ADDRESSES = new Set([
  'pohaudit000000000000000000000000000000000001', // audit vault
]);

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const dataDir = arg('--data-dir', path.join(os.homedir(), '.poh-bootnode')).replace(/^~/, os.homedir());
const outFile = arg('--out', null);
const heightArg = arg('--height', null);
const genesisTs = arg('--genesis-timestamp', null);
const includeSystem = argv.includes('--include-system');
const exclude = new Set([
  ...(includeSystem ? [] : SYSTEM_ADDRESSES),
  ...String(arg('--exclude', '')).split(',').map(s => s.trim()).filter(Boolean),
]);

const POH = 1e9;
const fmt = raw => `${raw} (${(raw / POH).toFixed(4)} POH)`;

async function main() {
  console.log(`[snapshot] Loading chain from ${dataDir} …`);
  const raw = new ChainStore(dataDir).loadChain();
  if (!raw.length) { console.error('[snapshot] empty chain — nothing to export'); process.exit(2); }

  let chain = raw.map(b => PohBlock.fromJSON(b));
  const tipHeight = chain[chain.length - 1].height;
  const finalizedHeight = tipHeight - FINALITY_DEPTH;
  const H = heightArg != null ? Number(heightArg) : finalizedHeight;
  chain = chain.filter(b => b.height <= H);
  console.log(`[snapshot] tip=${tipHeight} finalized=${finalizedHeight} → snapshot height ${H} (${chain.length} blocks)`);
  if (exclude.size) console.log(`[snapshot] excluding ${exclude.size} address(es): ${[...exclude].join(', ')}`);

  const ledger = await replayChainLedgerAsync(chain, { applyP2P: true });

  const addrs = new Set([...ledger.balances.keys(), ...ledger.nonces.keys()]);
  const entries = [];
  let sumBalances = 0, excludedRaw = 0;
  for (const a of addrs) {
    const balance = ledger.balances.get(a) || 0;
    const nonce = ledger.nonces.get(a) || 0;
    if (balance === 0 && nonce === 0) continue;
    if (exclude.has(a)) { excludedRaw += balance; continue; }
    entries.push([a, { balance, nonce }]);
    sumBalances += balance;
  }
  entries.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)); // canonical key order
  const balancesObj = Object.fromEntries(entries);

  const canonical = JSON.stringify(entries.map(([a, v]) => [a, v.balance, v.nonce]));
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
