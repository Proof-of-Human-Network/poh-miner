import { describe, it, expect, beforeEach } from 'vitest';
import { TxLedgerState, replayChainLedger, validateBlockLedger } from '../src/consensus/tx-ledger.js';

import { BLOCK_REWARD_UPOH } from '../src/rewards/reward.js';
import { PohBlock } from '../src/core/block.js';
import { PoHTransaction, TxMempool } from '../src/core/transaction.js';
import { Wallet, WalletManager } from '../src/wallet/wallet.js';
import os from 'os';
import fs from 'fs';
import path from 'path';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'poh-ledger-'));
}

function coinbaseBlock(height, minerWallet, prevHash = '0'.repeat(64)) {
  return new PohBlock({
    height,
    previousHash: prevHash,
    timestamp: Date.now() + height,
    minerWallet,
    coinbaseReward: {
      blockHeight: height,
      proposerReward: BLOCK_REWARD_UPOH,
      workerRewards: [],
      totalNewSupply: BLOCK_REWARD_UPOH,
    },
    transactions: [],
    difficulty: 4,
    chainWork: String(height),
  });
}

describe('TxLedgerState — spent-tx dedup', () => {
  let wm, alice, bob;
  const INITIAL = 5_000_000_000;

  beforeEach(() => {
    wm = new WalletManager(tmpDir());
    alice = Wallet.generate();
    bob = Wallet.generate();
    alice.balance = INITIAL;
    wm.saveWallet(alice);
    wm.saveWallet(bob);
  });

  it('rejects replaying the same txHash in strict mode', () => {
    const tx = new PoHTransaction({
      from: alice.address, to: bob.address, amount: 1_000_000_000, fee: 0, nonce: 1, timestamp: Date.now(),
    });
    tx.sign(alice);

    const ledger = new TxLedgerState();
    ledger._credit(alice.address, INITIAL);

    const b1 = coinbaseBlock(1, alice.address);
    b1.transactions = [tx.toJSON()];

    expect(ledger.applyBlock(b1, { strict: true }).valid).toBe(true);
    expect(ledger.getBalance(bob.address)).toBe(1_000_000_000);

    const b2 = coinbaseBlock(2, alice.address, 'prev2hash');
    b2.transactions = [tx.toJSON()];

    const replay = ledger.applyBlock(b2, { strict: true });
    expect(replay.valid).toBe(false);
    expect(replay.reason).toMatch(/already spent/);
    expect(ledger.getBalance(bob.address)).toBe(1_000_000_000);
  });

  it('lenient mode skips replayed txs (first inclusion wins)', () => {
    const tx = new PoHTransaction({
      from: alice.address, to: bob.address, amount: 2_000_000_000, fee: 0, nonce: 1, timestamp: Date.now(),
    });
    tx.sign(alice);

    const ledger = new TxLedgerState();
    ledger._credit(alice.address, INITIAL);

    const b1 = coinbaseBlock(1, alice.address);
    b1.transactions = [tx.toJSON()];
    ledger.applyBlock(b1, { strict: false });

    const b2 = coinbaseBlock(2, alice.address);
    b2.transactions = [tx.toJSON()];
    ledger.applyBlock(b2, { strict: false });

    expect(ledger.getBalance(bob.address)).toBe(2_000_000_000);
    expect(ledger.spentTxHashes.size).toBe(1);
  });

  it('supply invariant: total balances === total minted', () => {
    const miner = Wallet.generate().address;
    const chain = [coinbaseBlock(1, miner), coinbaseBlock(2, miner), coinbaseBlock(3, miner)];
    const ledger = replayChainLedger(chain);
    const inv = ledger.checkSupplyInvariant();
    expect(inv.ok).toBe(true);
    expect(inv.totalMinted).toBe(BLOCK_REWARD_UPOH * 3);
    expect(inv.totalBalances).toBe(BLOCK_REWARD_UPOH * 3);
    expect(inv.coinbaseDust).toBe(0);
  });

  it('supply invariant accounts for historical coinbase rounding dust', () => {
    const miner = Wallet.generate().address;
    const dusty = coinbaseBlock(1, miner);
    dusty.coinbaseReward = {
      blockHeight: 1,
      proposerReward: Math.floor(BLOCK_REWARD_UPOH * 0.6),
      workerRewards: [{ workerId: Wallet.generate().address, amount: Math.floor((BLOCK_REWARD_UPOH * 0.4) / 2), workProofHash: 'w0' }],
      totalNewSupply: BLOCK_REWARD_UPOH,
    };
    const ledger = replayChainLedger([dusty]);
    const inv = ledger.checkSupplyInvariant();
    expect(inv.ok).toBe(true);
    expect(inv.coinbaseDust).toBeGreaterThan(0);
    expect(inv.totalBalances + inv.coinbaseDust).toBe(inv.totalMinted);
  });

  it('validateBlockLedger rejects blocks with replayed txs at tip', () => {
    const tx = new PoHTransaction({
      from: alice.address, to: bob.address, amount: 500_000_000, fee: 0, nonce: 1, timestamp: Date.now(),
    });
    tx.sign(alice);

    const b1 = coinbaseBlock(1, alice.address);
    b1.transactions = [tx.toJSON()];
    const ledger = replayChainLedger([b1], { applyP2P: false });

    const b2 = coinbaseBlock(2, alice.address);
    b2.transactions = [tx.toJSON()];

    const check = validateBlockLedger(b2, ledger, { strict: true });
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/already spent/);
  });

  it('TxMempool rejects and purges already-spent txHashes', () => {
    const mempool = new TxMempool(wm);
    const tx = new PoHTransaction({
      from: alice.address, to: bob.address, amount: 100, fee: 0, nonce: 1, timestamp: Date.now(),
    });
    tx.sign(alice);

    mempool.setSpentTxHashes([tx.txHash]);
    expect(mempool.submit(tx)).toMatchObject({ error: expect.stringMatching(/already mined/) });

    mempool.txs.set(tx.txHash, tx);
    mempool.setSpentTxHashes([tx.txHash]);
    expect(mempool.getPending(10)).toHaveLength(0);
  });
});