import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PohMinerNode } from '../src/miner-node.js';
import { ScanResult } from '../src/core/scanRequest.js';

/**
 * Durable pending-reward queue: compute results queued for a block must survive
 * a node restart so the worker still gets paid, instead of being dropped from the
 * in-memory array.
 */
describe('durable pending-reward queue', () => {
  let dir, node;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-rewards-'));
    node = Object.create(PohMinerNode.prototype);
    node._pendingResultsPath = path.join(dir, 'pending-results.json');
    node.pendingValidResults = [];
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const mkResult = (jobId, worker) => {
    const sr = new ScanResult({
      requestId: jobId, address: '0xabc', verdict: 'HUMAN', confidence: 0.9,
      reasoning: 'ok', signalsUsed: ['a', 'b', 'c'], minerWallet: worker,
      methodsCount: 3, computationTimeMs: 4200, realPohUsed: true, profile: { x: 1 },
    });
    sr.isValidWork = true;
    sr.signingPublicKey = 'PUB';
    return sr;
  };

  it('persists queued rewards and restores them on the next startup', () => {
    node.pendingValidResults.push(mkResult('job-1', 'pohworkerA'));
    node.pendingValidResults.push(mkResult('job-2', 'pohworkerB'));
    node._persistPendingResults();

    // Simulate a restart: a fresh node loads from the same path.
    const restarted = Object.create(PohMinerNode.prototype);
    restarted._pendingResultsPath = node._pendingResultsPath;
    const loaded = restarted._loadPendingResults();

    expect(loaded).toHaveLength(2);
    expect(loaded.map(r => r.requestId).sort()).toEqual(['job-1', 'job-2']);
    // reward attribution + anti-fraud fields survive
    const a = loaded.find(r => r.requestId === 'job-1');
    expect(a.minerWallet).toBe('pohworkerA');
    expect(a.computationTimeMs).toBe(4200);
    expect(a.isValidWork).toBe(true);
    // still a usable ScanResult (methods intact) for block inclusion
    expect(typeof a.getResultHash).toBe('function');
    expect(a.getResultHash().length).toBeGreaterThan(0);
  });

  it('returns an empty queue when no file exists (first run)', () => {
    expect(node._loadPendingResults()).toEqual([]);
  });

  it('a persisted removal (reward mined) is reflected after restart', () => {
    node.pendingValidResults.push(mkResult('job-1', 'w'));
    node.pendingValidResults.push(mkResult('job-2', 'w'));
    node._persistPendingResults();
    // job-1 got mined → filtered out → persisted
    node.pendingValidResults = node.pendingValidResults.filter(r => r.requestId !== 'job-1');
    node._persistPendingResults();

    const restarted = Object.create(PohMinerNode.prototype);
    restarted._pendingResultsPath = node._pendingResultsPath;
    expect(restarted._loadPendingResults().map(r => r.requestId)).toEqual(['job-2']);
  });
});
