import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * A P2P escrow lock or release updates balances immediately, but the ledger is
 * replayed from the chain — so the movement only becomes real once a block
 * carries its transition. Losing the queue to a restart silently reverts the
 * balance change, which is how a completed trade paid out in memory and left
 * the taker with nothing.
 */
describe('durable pending-transition queue', () => {
  let dir, file, node;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-tx-'));
    file = path.join(dir, 'pending-transitions.json');
    // Exercise the persistence pair directly; constructing a full miner would
    // drag in benchmarks, IPFS and the network.
    node = {
      _pendingTransitionsPath: file,
      pendingBrainTransitions: [],
      _persistPendingTransitions() {
        fs.mkdirSync(path.dirname(this._pendingTransitionsPath), { recursive: true });
        const tmp = this._pendingTransitionsPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.pendingBrainTransitions));
        fs.renameSync(tmp, this._pendingTransitionsPath);
      },
      _loadPendingTransitions() {
        try {
          if (!fs.existsSync(this._pendingTransitionsPath)) return [];
          const raw = JSON.parse(fs.readFileSync(this._pendingTransitionsPath, 'utf8'));
          if (!Array.isArray(raw)) return [];
          return raw.filter(t => t && typeof t.type === 'string');
        } catch { return []; }
      },
    };
  });

  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

  it('survives a restart before the transition is mined', () => {
    node.pendingBrainTransitions.push({ type: 'p2p-trade-release', tradeId: 't1', daiAmount: 100000 });
    node._persistPendingTransitions();

    const restarted = { ...node, pendingBrainTransitions: [] };
    restarted.pendingBrainTransitions = node._loadPendingTransitions.call(restarted);
    expect(restarted.pendingBrainTransitions).toHaveLength(1);
    expect(restarted.pendingBrainTransitions[0]).toMatchObject({ type: 'p2p-trade-release', daiAmount: 100000 });
  });

  it('reflects a drain, so a mined transition is not replayed after a restart', () => {
    node.pendingBrainTransitions.push({ type: 'p2p-order-created', orderId: 'o1' });
    node.pendingBrainTransitions.push({ type: 'p2p-trade-release', tradeId: 't1' });
    node._persistPendingTransitions();

    node.pendingBrainTransitions.splice(0, 1);   // first one made it into a block
    node._persistPendingTransitions();

    expect(node._loadPendingTransitions()).toEqual([{ type: 'p2p-trade-release', tradeId: 't1' }]);
  });

  it('treats a corrupt or truncated queue as empty rather than throwing', () => {
    fs.writeFileSync(file, '{"not":"an array"}');
    expect(node._loadPendingTransitions()).toEqual([]);
    fs.writeFileSync(file, 'not json at all');
    expect(node._loadPendingTransitions()).toEqual([]);
  });

  it('drops malformed entries instead of queueing junk for a block', () => {
    fs.writeFileSync(file, JSON.stringify([{ type: 'p2p-trade-release' }, null, { noType: 1 }, 'x']));
    expect(node._loadPendingTransitions()).toEqual([{ type: 'p2p-trade-release' }]);
  });

  it('starts empty when nothing was ever persisted', () => {
    expect(node._loadPendingTransitions()).toEqual([]);
  });
});
