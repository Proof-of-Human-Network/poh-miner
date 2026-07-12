# Genesis migration — reset chain history, keep balances

Discards all block history and starts a fresh chain from a new genesis that
**mints the current balances + nonces**. Users keep their keys; balances carry
over. This is a coordinated hard fork.

## Why it works this way

Balances aren't stored — they're *derived* by replaying coinbase mints +
transfers (`replayChainLedger`; `_rebuildBalancesFromChain` overwrites all
balances from that replay). So:

- `config.genesisAlloc` is **not enough** — it credits outside the ledger and is
  wiped on the next rebuild. Balances must be minted **inside the chain**.
- The migration bakes the snapshot into the genesis block as
  `genesisAllocations`, which the ledger credits as canonical state and which is
  part of the block hash → the new genesis has a **distinct hash**, so old-chain
  peers are genesis-mismatch-rejected instead of out-competing the fresh chain on
  chainWork.

## Artifacts

| File | Purpose |
|---|---|
| `export-snapshot.mjs` | READ-ONLY. Replays the canonical chain → `{address:{balance,nonce}}` + `snapshotHash`. |
| `reset-node.sh` | Backs up + wipes ONE node's chain state (dry-run by default). Never touches keys. |
| `src/consensus/genesis.js` | `createGenesisBlock({snapshot})` — builds the migration genesis. |

The genesis source is config/arg-gated (absent → legacy empty genesis, unchanged):
- **bootnode:** `--genesis-snapshot=<path>` or `POH_GENESIS_SNAPSHOT=<path>`
- **miner:** `config.json` → `"genesisSnapshot": "<path>"`

## Runbook

**Do a full backup of every node's data dir before starting. This is irreversible.**

1. **Pause production.** Stop mining on all miners so no block lands after the snapshot height.

2. **Snapshot** (on the node with the canonical chain, e.g. the bootnode host):
   ```sh
   node scripts/genesis/export-snapshot.mjs --data-dir ~/.poh-bootnode \
     --out /root/genesis-snapshot.json
   # audit vault + other system addresses are excluded by default; --include-system to keep
   ```
   Record the printed `snapshotHash` and publish `genesis-snapshot.json` for audit.
   Verify: conservation ✓, sum(balances) matches expected circulating supply, spot-check known wallets.

3. **Distribute** the identical `genesis-snapshot.json` to every node (same bytes → identical genesis).

4. **Wipe** each node (backs up first; run dry, then `--apply`):
   ```sh
   scripts/genesis/reset-node.sh --role bootnode --home /root            # dry-run
   scripts/genesis/reset-node.sh --role bootnode --home /root --apply
   # on each miner host:
   scripts/genesis/reset-node.sh --role miner --home /root --apply
   ```

5. **Set the genesis source** on every node (snapshot path per the table above).

6. **Start bootnode first**, confirm it logs `Migration genesis created … New genesis hash: <H_new>`.
   Then start miners — each logs `Migration genesis: … <hash>` and rebuilds balances from the chain.

7. **Verify:**
   - bootnode height climbing from 1; genesis hash == `H_new` on every node.
   - `sum(balances)` on a miner == the snapshot sum (conservation).
   - Spot-check wallets; miners log `Genesis hash verified ✓` with `H_new`.

8. **Stragglers** (offline/desktop miners still on the old genesis): they are
   genesis-mismatch-rejected by the new network (the safety net — the old heavy
   chain can never win). They rejoin only after: `reset-node.sh --role miner
   --apply`, adding `genesisSnapshot` to config, and restarting.

## Rollback

Before `--apply`, everything is reversible (services just restart on the old
data). After `--apply`, restore from the `genesis-backup-*` tarballs the script
wrote (and re-remove the `genesisSnapshot` config/arg) to return to the old chain.
