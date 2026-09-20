/**
 * P2P escrow reads the per-wallet FILE; /api/wallet/balance reads the canonical
 * txLedger. On any node that has never credited an address — which is every node
 * a mobile wallet talks to — the file is absent or a stale stub at 0, so posting
 * an order with a funded wallet was rejected as "insufficient balance: have 0".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WalletManager } from '../src/wallet/wallet.js';
import { TxLedgerState } from '../src/consensus/tx-ledger.js';
import { EscrowManager, ESCROW_ADDRESS } from '../src/p2p/escrow.js';
import { DAIMinerNode } from '../src/miner-node.js';

const MAKER = 'dai' + '4'.repeat(40);
const reconcile = DAIMinerNode.prototype._reconcileWalletToLedger;

describe('P2P escrow error messages', () => {
  const escrow = new EscrowManager();
  const empty = { getBalance: () => 0, getAssetBalance: () => 0 };

  it('reports a stablecoin shortfall in display units, not raw', () => {
    // 100 αιIRR is 10 000 raw units; the old message said "need 10000 aiIRR",
    // which reads as the form having multiplied the amount by a hundred.
    const { error } = escrow.lock(empty, MAKER, 10_000, 'aiIRR');
    expect(error).toContain('need 100.00 αιIRR');
    expect(error).not.toContain('10000');
  });

  it('reports a DAI shortfall in DAI, not μDAI', () => {
    const { error } = escrow.lock(empty, MAKER, 2_500_000_000, 'DAI');
    expect(error).toContain('need 2.500 DAI');
  });
});

describe('_reconcileWalletToLedger', () => {
  let dir, wm, node;

  // credit/debit (and the reconcile) resolve on WalletManager's per-address
  // promise chain, so a file assertion has to wait for them to flush.
  const flush = () => new Promise(r => setTimeout(r, 0));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escrow-reconcile-'));
    wm = new WalletManager(dir);
    node = { walletManager: wm, txLedger: new TxLedgerState() };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('lets a wallet funded elsewhere lock a stablecoin it has never held locally', async () => {
    node.txLedger._credit(MAKER, 10_000, 'aiIRR');
    expect(wm.getAssetBalance(MAKER, 'aiIRR')).toBe(0);   // no file on this node at all

    await reconcile.call(node, MAKER, 'aiIRR');

    expect(wm.getAssetBalance(MAKER, 'aiIRR')).toBe(10_000);
    expect(new EscrowManager().lock(wm, MAKER, 10_000, 'aiIRR')).toBe(true);
    await flush();
    expect(wm.rawBalanceNonce(ESCROW_ADDRESS).assets.aiIRR).toBe(10_000);
  });

  it('does the same for DAI', async () => {
    node.txLedger._credit(MAKER, 5_000_000_000);
    await reconcile.call(node, MAKER, 'DAI');
    expect(wm.getBalance(MAKER)).toBe(5_000_000_000);
  });

  it('never re-bumps after a lock, which would recreate the escrowed amount', async () => {
    node.txLedger._credit(MAKER, 10_000, 'aiIRR');
    await reconcile.call(node, MAKER, 'aiIRR');
    new EscrowManager().lock(wm, MAKER, 10_000, 'aiIRR');

    // The ledger still shows 10 000 until the transition lands in a block.
    await reconcile.call(node, MAKER, 'aiIRR');
    await flush();
    expect(wm.getAssetBalance(MAKER, 'aiIRR')).toBe(0);
  });

  it('retries on a later call when the ledger had not synced yet', async () => {
    await reconcile.call(node, MAKER, 'aiIRR');      // ledger still empty — nothing to bump
    node.txLedger._credit(MAKER, 700, 'aiIRR');
    await reconcile.call(node, MAKER, 'aiIRR');
    expect(wm.getAssetBalance(MAKER, 'aiIRR')).toBe(700);
  });

  it('never lowers a file balance that is already ahead of the ledger', async () => {
    await wm.credit(MAKER, 900, 'aiIRR');
    node.txLedger._credit(MAKER, 500, 'aiIRR');
    await reconcile.call(node, MAKER, 'aiIRR');
    expect(wm.getAssetBalance(MAKER, 'aiIRR')).toBe(900);
  });

  it('is a no-op before the ledger exists (early startup)', async () => {
    node.txLedger = null;
    await expect(reconcile.call(node, MAKER, 'aiIRR')).resolves.toBeUndefined();
    expect(wm.walletExists(MAKER)).toBe(false);
  });
});
