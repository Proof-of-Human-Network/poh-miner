import { describe, it, expect } from 'vitest';
import { Wallet } from '../src/wallet/wallet.js';
import { TxLedgerState } from '../src/consensus/tx-ledger.js';
import { ESCROW_ADDRESS } from '../src/p2p/escrow.js';
import {
  p2pTransitionKey,
  makeP2PAuth,
  verifyGossipedP2PTransition,
} from '../src/p2p/transitions.js';

describe('p2pTransitionKey', () => {
  it('matches the RAM dedup ids used at the API', () => {
    expect(p2pTransitionKey({ type: 'p2p-order-created', id: 'o1' })).toBe('order-o1');
    expect(p2pTransitionKey({ type: 'p2p-order-cancelled', orderId: 'o1' })).toBe('order-cancel-o1');
    expect(p2pTransitionKey({ type: 'p2p-trade-created', id: 't1' })).toBe('trade-t1');
    expect(p2pTransitionKey({ type: 'p2p-trade-release', tradeId: 't1' })).toBe('trade-t1-release');
    expect(p2pTransitionKey({ type: 'p2p-swap-filled', tradeId: 't1' })).toBe('swap-t1');
    expect(p2pTransitionKey({ type: 'p2p-order-created' })).toBeNull();
    expect(p2pTransitionKey({ type: 'job-escrow', jobId: 'j' })).toBeNull();
  });
});

describe('verifyGossipedP2PTransition', () => {
  const wallet = Wallet.generate();
  const payload = { address: wallet.address, timestamp: Date.now(), action: 'release', tradeId: 't1' };
  const signed = JSON.stringify({ ...payload, address: wallet.address });
  const signature = wallet.sign(signed);
  const transition = {
    type: 'p2p-trade-release',
    tradeId: 't1',
    recipient: 'dai' + 'b'.repeat(40),
    daiAmount: 100,
    _auth: makeP2PAuth({ signingPublicKey: wallet.signingPublicKey, signature }, payload),
  };

  it('accepts a transition signed the same way as the API', () => {
    const v = verifyGossipedP2PTransition(transition);
    expect(v.ok).toBe(true);
    expect(v.address).toBe(wallet.address);
  });

  it('rejects a missing or forged signature', () => {
    expect(verifyGossipedP2PTransition({ ...transition, _auth: null }).ok).toBe(false);
    const forged = { ...transition, _auth: { ...transition._auth, signature: 'aaaa' } };
    expect(verifyGossipedP2PTransition(forged).ok).toBe(false);
  });

  it('rejects an unknown type even with a valid signature', () => {
    expect(verifyGossipedP2PTransition({ ...transition, type: 'job-escrow' }).ok).toBe(false);
  });
});

describe('ledger P2P apply is idempotent', () => {
  const A = 'dai' + 'a'.repeat(40);
  it('a second copy of the same lock does not debit twice', () => {
    const l = new TxLedgerState();
    l._credit(A, 1000);
    const t = { type: 'p2p-order-created', id: 'o1', side: 'sell', escrowLocked: true, maker: A, daiAmount: 400 };
    expect(l.applyP2PEscrowTransition(t)).toBe(true);
    expect(l.getBalance(A)).toBe(600);
    expect(l.getBalance(ESCROW_ADDRESS)).toBe(400);
    expect(l.applyP2PEscrowTransition(t)).toBe(true);
    expect(l.getBalance(A)).toBe(600);
    expect(l.getBalance(ESCROW_ADDRESS)).toBe(400);
  });

  it('clone() copies the applied-key set', () => {
    const l = new TxLedgerState();
    l._credit(A, 100);
    l.applyP2PEscrowTransition({ type: 'p2p-order-created', id: 'o9', side: 'sell', escrowLocked: true, maker: A, daiAmount: 10 });
    const c = l.clone();
    expect(c.applyP2PEscrowTransition({ type: 'p2p-order-created', id: 'o9', side: 'sell', escrowLocked: true, maker: A, daiAmount: 10 })).toBe(true);
    expect(c.getBalance(A)).toBe(90);
  });
});
