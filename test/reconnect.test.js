import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PohMinerNode } from '../src/miner-node.js';

/**
 * Reconnect: after the internet drops and comes back, the node must rejoin the
 * network on its own — re-register with bootnodes, re-discover peers, and re-sync
 * the chain — without a restart. startConnectivityWatcher() drives this.
 */
describe('reconnect after connectivity loss', () => {
  let node, realFetch;

  beforeEach(() => {
    realFetch = global.fetch;
    // Build a bare node object with just what the watcher touches (avoids the
    // heavy full start()/mining/meili path).
    node = Object.create(PohMinerNode.prototype);
    node.config = { bootnodes: ['https://bootnode.test'] };
    node.peers = [{ wallet: 'p1' }];
    node._syncInProgress = false;
    node._abortMining = vi.fn();
    node.discoverAndRegisterWithBootnodes = vi.fn().mockResolvedValue();
    node._discoverPeersFromIPFS = vi.fn().mockResolvedValue();
    node.syncFromBootnodes = vi.fn().mockResolvedValue();
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (node._connectivityTimer) clearInterval(node._connectivityTimer);
    vi.useRealTimers();
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('re-registers, re-discovers peers, and re-syncs when the connection returns', async () => {
    // Start online, then go down, then come back up.
    let reachable = true;
    global.fetch = vi.fn(async () => {
      if (!reachable) throw new Error('network down');
      return { ok: true, json: async () => ({}) };
    });

    node.startConnectivityWatcher();
    expect(node._online).toBe(true);

    // --- internet drops ---
    reachable = false;
    await vi.advanceTimersByTimeAsync(30_000);           // one probe tick
    expect(node._online).toBe(false);
    expect(node.syncFromBootnodes).not.toHaveBeenCalled(); // no reconnect while down

    // stays down for a while — still no reconnect, loop survives repeated failures
    await vi.advanceTimersByTimeAsync(90_000);
    expect(node.discoverAndRegisterWithBootnodes).not.toHaveBeenCalled();

    // --- internet restored ---
    reachable = true;
    await vi.advanceTimersByTimeAsync(30_000);           // next probe sees it back
    // allow the async reconnect body to run
    await vi.runOnlyPendingTimersAsync?.();
    await Promise.resolve();

    expect(node._online).toBe(true);
    expect(node.discoverAndRegisterWithBootnodes).toHaveBeenCalledTimes(1);
    expect(node.syncFromBootnodes).toHaveBeenCalledTimes(1);
    expect(node._abortMining).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect while the connection stays up (no false triggers)', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    node.startConnectivityWatcher();
    await vi.advanceTimersByTimeAsync(120_000); // several healthy probes
    expect(node.discoverAndRegisterWithBootnodes).not.toHaveBeenCalled();
    expect(node.syncFromBootnodes).not.toHaveBeenCalled();
    expect(node._online).toBe(true);
  });
});
