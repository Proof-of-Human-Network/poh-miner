import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WalletManager, Wallet } from '../src/wallet/wallet.js';
import { PoHTransaction, TxMempool } from '../src/core/transaction.js';

/**
 * Send idempotency: a retried /api/wallet/send (client timed out but the tx was
 * accepted) must not create a SECOND transfer at the next nonce. The keyless path
 * suppresses a resend when an identical (from,to,amount,memo) tx is already pending
 * in the mempool — this test covers that mempool query + the duplicate-hash guard.
 */
describe('send idempotency', () => {
  let wm, mempool, alice, bob;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-idem-'));
    wm = new WalletManager(dir);
    mempool = new TxMempool(wm);
    alice = Wallet.generate(); bob = Wallet.generate();
    alice.balance = 10_000_000_000; bob.balance = 0;   // 10 POH
    wm.saveWallet(alice); wm.saveWallet(bob);
  });

  const send = (nonce) => {
    const tx = new PoHTransaction({ from: alice.address, to: bob.address, amount: 1_000_000, fee: 0, nonce, timestamp: Date.now() });
    tx.sign(alice);
    return tx;
  };

  // The exact query the send handler uses to detect a retry-while-pending.
  const findPendingDup = (from, to, amount, memo = '') =>
    mempool.getPending(1000).find(t => t.from === from && t.to === to && t.amount === amount && (t.memo || '') === (memo || ''));

  it('detects an identical transfer already pending (so a retry is suppressed)', () => {
    const tx1 = send(1);
    expect(mempool.submit(tx1)).toBe(true);

    // A retried send would run this lookup first and find the pending tx → return it.
    const dup = findPendingDup(alice.address, bob.address, 1_000_000);
    expect(dup).toBeTruthy();
    expect(dup.txHash).toBe(tx1.txHash);

    // Without the guard the retry builds a NEW tx at the next nonce → a second transfer.
    const tx2 = send(2);
    expect(tx2.txHash).not.toBe(tx1.txHash);
    expect(mempool.submit(tx2)).toBe(true); // both would mine = double-send (the bug)
    // With the guard, tx2 is never built because findPendingDup returned tx1.
  });

  it('re-submitting the exact same signed tx is a no-op (duplicate hash)', () => {
    const tx = send(1);
    expect(mempool.submit(tx)).toBe(true);
    expect(mempool.submit(tx)).toEqual({ error: 'duplicate tx' });
    expect(mempool.size()).toBe(1);
  });

  it('allows an intentional repeat once nothing identical is pending', () => {
    const tx1 = send(1);
    mempool.submit(tx1);
    // Simulate the first being mined + cleared from the mempool.
    mempool.onBlockApplied([tx1.txHash]);
    expect(findPendingDup(alice.address, bob.address, 1_000_000)).toBeUndefined(); // nothing pending → repeat allowed
  });
});
