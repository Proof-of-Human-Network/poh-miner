import { describe, it, expect } from 'vitest';
import { TxIndex } from '../src/consensus/tx-index.js';

const block = (height, over = {}) => ({
  height, timestamp: 1000 + height, transactions: [], ...over,
});

describe('TxIndex', () => {
  it('records a transfer for BOTH sides', () => {
    // The bug this exists to fix: a recipient submits nothing, so a
    // submission-based history could never show them the incoming transfer.
    const ix = new TxIndex().rebuild([block(1, {
      transactions: [{ from: 'daiA', to: 'daiB', amount: 500, fee: 1, txHash: 'h1', timestamp: 9 }],
    })]);
    expect(ix.forAddress('daiA')).toHaveLength(1);
    expect(ix.forAddress('daiB')).toHaveLength(1);
    expect(ix.forAddress('daiB')[0]).toMatchObject({
      id: 'h1', from: 'daiA', to: 'daiB', amount: 500, blockHeight: 1, status: 'mined',
    });
  });

  it('looks a transaction up by hash', () => {
    const ix = new TxIndex().rebuild([block(2, {
      transactions: [{ from: 'daiA', to: 'daiB', amount: 7, txHash: 'hash-xyz' }],
    })]);
    expect(ix.get('hash-xyz')).toMatchObject({ amount: 7, blockHeight: 2 });
    expect(ix.get('nope')).toBeNull();
  });

  it('indexes coinbase rewards, which have no hash of their own', () => {
    const ix = new TxIndex().rebuild([block(3, {
      minerWallet: 'daiMINER',
      coinbaseReward: { proposerReward: 50, workerRewards: [{ workerId: 'daiW', amount: 10 }] },
    })]);
    const miner = ix.forAddress('daiMINER');
    expect(miner).toHaveLength(1);
    expect(miner[0]).toMatchObject({ type: 'reward', amount: 50, memo: 'proposer' });
    expect(ix.forAddress('daiW')[0]).toMatchObject({ type: 'reward', amount: 10, memo: 'worker' });
    // Synthetic ids must be stable and unique per (block, recipient, kind).
    expect(ix.get('coinbase-3-proposer-daiMINER')).toBeTruthy();
  });

  it('returns newest first', () => {
    const ix = new TxIndex().rebuild([
      block(1, { transactions: [{ from: 'daiA', to: 'daiB', amount: 1, txHash: 'a' }] }),
      block(2, { transactions: [{ from: 'daiA', to: 'daiB', amount: 2, txHash: 'b' }] }),
    ]);
    expect(ix.forAddress('daiA').map(e => e.id)).toEqual(['b', 'a']);
  });

  it('does not double-record a self-send', () => {
    const ix = new TxIndex().rebuild([block(1, {
      transactions: [{ from: 'daiA', to: 'daiA', amount: 1, txHash: 'self' }],
    })]);
    expect(ix.forAddress('daiA')).toHaveLength(1);
  });

  it('ignores malformed transactions rather than indexing junk', () => {
    const ix = new TxIndex().rebuild([block(1, {
      transactions: [{ to: 'daiB', amount: 1 }, { from: 'daiA', amount: 1 }, null],
    })]);
    expect(ix.stats().transactions).toBe(0);
  });

  it('caps history per address so a hot wallet cannot grow it without bound', () => {
    const blocks = [];
    for (let i = 1; i <= 600; i++) {
      blocks.push(block(i, { transactions: [{ from: 'daiA', to: 'daiB', amount: 1, txHash: `h${i}` }] }));
    }
    const ix = new TxIndex().rebuild(blocks);
    expect(ix.forAddress('daiA', 1000).length).toBeLessThanOrEqual(500);
  });

  it('rebuild clears prior state instead of accumulating', () => {
    const ix = new TxIndex();
    ix.rebuild([block(1, { transactions: [{ from: 'daiA', to: 'daiB', amount: 1, txHash: 'x' }] })]);
    ix.rebuild([block(1, { transactions: [{ from: 'daiC', to: 'daiD', amount: 1, txHash: 'y' }] })]);
    expect(ix.forAddress('daiA')).toHaveLength(0);
    expect(ix.get('x')).toBeNull();
    expect(ix.get('y')).toBeTruthy();
  });
});
