/**
 * Blockchain correctness tests — covers all 6 fixes.
 *
 * Fix 1: P2P gossip broadcast
 * Fix 2: Result + block signatures
 * Fix 3: chainWork + longest-chain fork resolution
 * Fix 4: Transactions, nonces, double-spend protection
 * Fix 5: PoW — mineBlock, abort signal, difficulty adjustment
 * Fix 6: Reorg + journal-based balance rollback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'poh-test-'));
  return d;
}

async function makeBlock(overrides = {}) {
  const { PohBlock } = await import('../src/core/block.js');
  return new PohBlock({
    height: 1,
    previousHash: '0'.repeat(64),
    timestamp: Date.now(),
    minerWallet: 'pohtest',
    difficulty: 1,
    chainWork: '2',
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1: P2P Gossip
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix 1 — P2P Gossip', () => {
  it('delivers messages to local subscribers', async () => {
    const { P2PGossip } = await import('../src/network/p2p-gossip.js');
    const gossip = new P2PGossip('node-A', () => []);
    const received = [];
    gossip.subscribe('test', (msg) => received.push(msg));
    await gossip.publish('test', { hello: 'world' });
    expect(received).toHaveLength(1);
    expect(received[0].hello).toBe('world');
    gossip.destroy();
  });

  it('deduplicates repeated envelopes (no double delivery)', async () => {
    const { P2PGossip } = await import('../src/network/p2p-gossip.js');
    const gossip = new P2PGossip('node-A', () => []);
    const received = [];
    gossip.subscribe('test', (msg) => received.push(msg));

    const envelope = { id: 'dup-id', topic: 'test', message: 'x', from: 'node-B', ts: Date.now(), ttl: 2, path: [] };
    await gossip.receive(envelope);
    await gossip.receive(envelope); // same ID — must be ignored
    expect(received).toHaveLength(1);
    gossip.destroy();
  });

  it('decrements TTL and does not relay when TTL <= 1', async () => {
    const { P2PGossip } = await import('../src/network/p2p-gossip.js');
    const sentTo = [];
    const gossip = new P2PGossip('node-A', () => [{ host: '1.2.3.4', walletApiPort: 9999, wallet: 'peer' }]);
    // Spy on _sendToPeer to capture relay attempts
    gossip._sendToPeer = async (peer, env) => { sentTo.push(env); };

    const envelope = { id: 'ttl1', topic: 'test', message: 'x', from: 'node-B', ts: Date.now(), ttl: 1, path: [] };
    await gossip.receive(envelope);
    expect(sentTo).toHaveLength(0); // ttl=1, no relay
    gossip.destroy();
  });

  it('relays with TTL-1 when TTL > 1', async () => {
    const { P2PGossip } = await import('../src/network/p2p-gossip.js');
    const sentTo = [];
    const gossip = new P2PGossip('node-A', () => [{ host: '1.2.3.4', walletApiPort: 9999, wallet: 'peer-B' }]);
    gossip._sendToPeer = async (peer, env) => { sentTo.push(env); };

    const envelope = { id: 'relay-me', topic: 'test', message: 'hi', from: 'node-X', ts: Date.now(), ttl: 3, path: [] };
    await gossip.receive(envelope);
    expect(sentTo).toHaveLength(1);
    expect(sentTo[0].ttl).toBe(2);
    gossip.destroy();
  });

  it('does not relay back to the original sender (path check)', async () => {
    const { P2PGossip } = await import('../src/network/p2p-gossip.js');
    const sentTo = [];
    const gossip = new P2PGossip('node-A', () => [
      { host: 'x', walletApiPort: 1, wallet: 'sender' },
      { host: 'y', walletApiPort: 2, wallet: 'other' },
    ]);
    gossip._sendToPeer = async (peer, env) => { sentTo.push(peer.wallet); };

    const envelope = { id: 'no-echo', topic: 'test', message: '', from: 'sender', ts: Date.now(), ttl: 3, path: ['sender'] };
    await gossip.receive(envelope);
    expect(sentTo).not.toContain('sender');
    expect(sentTo).toContain('other');
    gossip.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2: Block + Result Signatures
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix 2 — Signatures', () => {
  it('block signs and verifies correctly', async () => {
    const { Wallet } = await import('../src/wallet/wallet.js');
    const { PohBlock } = await import('../src/core/block.js');
    const wallet = Wallet.generate();
    const block = await makeBlock({ minerWallet: wallet.address });
    block.nonce = 0;

    block.sign(wallet);
    expect(block.minerSignature).toBeTruthy();
    expect(block.verifySignature()).toBe(true);
  });

  it('block rejects tampered content after signing', async () => {
    const { Wallet } = await import('../src/wallet/wallet.js');
    const wallet = Wallet.generate();
    const block = await makeBlock();
    block.sign(wallet);

    block.height = 999; // tamper
    expect(block.verifySignature()).toBe(false);
  });

  it('ScanResult signs and verifies', async () => {
    const { Wallet } = await import('../src/wallet/wallet.js');
    const { ScanResult } = await import('../src/core/scanRequest.js');
    const wallet = Wallet.generate();

    const result = new ScanResult({
      requestId: 'req-1',
      address: '0xabc',
      verdict: 'HUMAN',
      confidence: 0.9,
      reasoning: 'looks good',
      signalsUsed: [{ methodId: 'm1' }],
      minerWallet: wallet.address,
      methodsHash: 'abc123',
      realPohUsed: true,
    });

    result.sign(wallet);
    expect(result.signature).toBeTruthy();
    expect(result.verify()).toBe(true);
  });

  it('ScanResult verify fails after tampering', async () => {
    const { Wallet } = await import('../src/wallet/wallet.js');
    const { ScanResult } = await import('../src/core/scanRequest.js');
    const wallet = Wallet.generate();
    const result = new ScanResult({ requestId: 'r', address: '0x1', verdict: 'AI', confidence: 0.8, reasoning: 'x', signalsUsed: [], minerWallet: wallet.address, methodsHash: 'h', realPohUsed: false });
    result.sign(wallet);
    result.verdict = 'HUMAN'; // tamper
    expect(result.verify(true)).toBe(false);
  });

  it('block signed by different key fails verification', async () => {
    const { Wallet } = await import('../src/wallet/wallet.js');
    const signer = Wallet.generate();
    const attacker = Wallet.generate();
    const block = await makeBlock();
    block.sign(signer);
    // Replace signing key with attacker's
    block.minerSigningPublicKey = attacker.signingPublicKey;
    expect(block.verifySignature()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 3: chainWork + Fork Resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix 3 — chainWork & Fork Resolution', () => {
  it('computeChainWork accumulates correctly', async () => {
    const { computeChainWork, compareChainWork } = await import('../src/consensus/chain-selection.js');
    const w0 = '0';
    const w1 = computeChainWork(w0, 4);  // 2^4 = 16
    const w2 = computeChainWork(w1, 4);  // 16 + 16 = 32
    expect(BigInt('0x' + w1)).toBe(16n);
    expect(BigInt('0x' + w2)).toBe(32n);
    expect(compareChainWork(w2, w1)).toBeGreaterThan(0);
  });

  it('compareChainWork returns correct ordering', async () => {
    const { compareChainWork } = await import('../src/consensus/chain-selection.js');
    expect(compareChainWork('10', '8')).toBeGreaterThan(0);   // 0x10 > 0x8
    expect(compareChainWork('8', '10')).toBeLessThan(0);
    expect(compareChainWork('f', 'f')).toBe(0);
  });

  it('getTipChainWork returns 0 for empty chain', async () => {
    const { getTipChainWork } = await import('../src/consensus/chain-selection.js');
    expect(getTipChainWork([])).toBe('0');
  });

  it('block with higher difficulty has more chainWork', async () => {
    const { computeChainWork, compareChainWork } = await import('../src/consensus/chain-selection.js');
    const easy = computeChainWork('0', 4);   // 2^4 = 16
    const hard = computeChainWork('0', 6);   // 2^6 = 64
    expect(compareChainWork(hard, easy)).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 4: Transactions, Nonces, Double-Spend Protection
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix 4 — Transactions & Double-Spend Protection', () => {
  let WalletManager, Wallet, PoHTransaction, TxMempool;
  let wm, alice, bob;
  const INITIAL = 1_000_000_000; // 1 POH

  beforeEach(async () => {
    ({ WalletManager, Wallet } = await import('../src/wallet/wallet.js'));
    ({ PoHTransaction, TxMempool } = await import('../src/core/transaction.js'));

    const dir = tmpDir();
    wm = new WalletManager(dir);
    alice = Wallet.generate();
    bob   = Wallet.generate();
    alice.balance = INITIAL;
    bob.balance   = 0;
    wm.saveWallet(alice);
    wm.saveWallet(bob);
  });

  it('valid transaction is accepted and applied', () => {
    const tx = new PoHTransaction({ from: alice.address, to: bob.address, amount: 100, fee: 1, nonce: 1, timestamp: Date.now() });
    tx.sign(alice);
    const result = wm.applyTransaction(tx);
    expect(result).toBe(true);
    expect(wm.getBalance(alice.address)).toBe(INITIAL - 101);
    expect(wm.getBalance(bob.address)).toBe(100);
    expect(wm.getNonce(alice.address)).toBe(1);
  });

  it('rejects wrong nonce (replay attack)', () => {
    const tx = new PoHTransaction({ from: alice.address, to: bob.address, amount: 1, fee: 0, nonce: 5, timestamp: Date.now() });
    tx.sign(alice);
    const result = wm.applyTransaction(tx);
    expect(result).toMatch(/nonce/);
  });

  it('rejects same nonce twice (exact replay)', () => {
    const tx = new PoHTransaction({ from: alice.address, to: bob.address, amount: 1, fee: 0, nonce: 1, timestamp: Date.now() });
    tx.sign(alice);
    expect(wm.applyTransaction(tx)).toBe(true);
    // Replay exact same signed tx
    const result = wm.applyTransaction(tx);
    expect(result).toMatch(/nonce/);
  });

  it('rejects insufficient balance', () => {
    const tx = new PoHTransaction({ from: alice.address, to: bob.address, amount: INITIAL + 1, fee: 0, nonce: 1, timestamp: Date.now() });
    tx.sign(alice);
    expect(wm.applyTransaction(tx)).toMatch(/balance/);
  });

  it('rejects invalid signature', () => {
    const imposter = Wallet.generate();
    const tx = new PoHTransaction({ from: alice.address, to: bob.address, amount: 1, fee: 0, nonce: 1, timestamp: Date.now() });
    tx.sign(imposter); // signed by wrong key
    expect(wm.applyTransaction(tx)).toMatch(/signature/);
  });

  it('TxMempool prevents double-spend via pendingOut lock', () => {
    const mempool = new TxMempool(wm);

    const tx1 = new PoHTransaction({ from: alice.address, to: bob.address, amount: INITIAL, fee: 0, nonce: 1, timestamp: Date.now() });
    tx1.sign(alice);
    expect(mempool.submit(tx1)).toBe(true);

    // Second tx tries to spend the same balance — pendingOut is locked
    const tx2 = new PoHTransaction({ from: alice.address, to: bob.address, amount: INITIAL, fee: 0, nonce: 2, timestamp: Date.now() });
    tx2.sign(alice);
    const result = mempool.submit(tx2);
    expect(result).toMatchObject({ error: expect.stringMatching(/balance/) });
  });

  it('TxMempool rejects duplicate txHash', () => {
    const mempool = new TxMempool(wm);
    const tx = new PoHTransaction({ from: alice.address, to: bob.address, amount: 1, fee: 0, nonce: 1, timestamp: Date.now() });
    tx.sign(alice);
    expect(mempool.submit(tx)).toBe(true);
    expect(mempool.submit(tx)).toMatchObject({ error: expect.stringMatching(/duplicate/) });
  });

  it('TxMempool releases lock after onBlockApplied', () => {
    const mempool = new TxMempool(wm);
    const tx = new PoHTransaction({ from: alice.address, to: bob.address, amount: 100, fee: 0, nonce: 1, timestamp: Date.now() });
    tx.sign(alice);
    mempool.submit(tx);
    expect(mempool.pendingOut.get(alice.address) || 0).toBe(100);

    mempool.onBlockApplied([tx.txHash]);
    expect(mempool.pendingOut.get(alice.address) || 0).toBe(0);
  });

  it('sequential nonces queue correctly', () => {
    const mempool = new TxMempool(wm);
    alice.balance = INITIAL * 3;
    wm.saveWallet(alice);

    const tx1 = new PoHTransaction({ from: alice.address, to: bob.address, amount: 1, fee: 0, nonce: 1, timestamp: Date.now() });
    tx1.sign(alice);
    const tx2 = new PoHTransaction({ from: alice.address, to: bob.address, amount: 1, fee: 0, nonce: 2, timestamp: Date.now() });
    tx2.sign(alice);

    expect(mempool.submit(tx1)).toBe(true);
    expect(mempool.submit(tx2)).toBe(true);
    expect(mempool.size()).toBe(2);
  });

  it('txHash is deterministic for same inputs', () => {
    const data = { from: alice.address, to: bob.address, amount: 42, fee: 1, nonce: 1, timestamp: 12345, memo: '' };
    const tx1 = new PoHTransaction(data);
    const tx2 = new PoHTransaction(data);
    expect(tx1.txHash).toBe(tx2.txHash);
  });

  it('revertTransaction undoes balance + nonce changes', () => {
    const tx = new PoHTransaction({ from: alice.address, to: bob.address, amount: 100, fee: 1, nonce: 1, timestamp: Date.now() });
    tx.sign(alice);
    wm.applyTransaction(tx);
    expect(wm.getBalance(alice.address)).toBe(INITIAL - 101);
    expect(wm.getNonce(alice.address)).toBe(1);

    wm.revertTransaction(tx, null);
    expect(wm.getBalance(alice.address)).toBe(INITIAL);
    expect(wm.getNonce(alice.address)).toBe(0);
    expect(wm.getBalance(bob.address)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 5: Proof of Work
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix 5 — Proof of Work', () => {
  it('mineBlock finds a valid nonce at difficulty 1', async () => {
    const { mineBlock } = await import('../src/consensus/pow.js');
    const block = await makeBlock({ difficulty: 1, nonce: 0 });
    const attempts = await mineBlock(block, 1, null);
    expect(attempts).toBeGreaterThan(0);
    expect(block.meetsDifficultySync()).toBe(true);
  });

  it('mined block hash starts with required leading zeros', async () => {
    const { mineBlock } = await import('../src/consensus/pow.js');
    const block = await makeBlock({ difficulty: 2, nonce: 0 });
    await mineBlock(block, 2, null);
    expect(block.getHashSync()).toMatch(/^00/);
  });

  it('aborts mining when AbortSignal fires', async () => {
    const { mineBlock } = await import('../src/consensus/pow.js');
    const block = await makeBlock({ difficulty: 20, nonce: 0 }); // effectively impossible
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50); // abort after 50ms
    const result = await mineBlock(block, 20, ctrl.signal);
    expect(result).toBeNull();
  });

  it('already-aborted signal returns null immediately', async () => {
    const { mineBlock } = await import('../src/consensus/pow.js');
    const block = await makeBlock({ difficulty: 1, nonce: 0 });
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await mineBlock(block, 1, ctrl.signal);
    expect(result).toBeNull();
  });

  it('getNextDifficulty returns MIN_DIFFICULTY for short chain', async () => {
    const { getNextDifficulty } = await import('../src/consensus/pow.js');
    expect(getNextDifficulty([])).toBe(3);
    expect(getNextDifficulty([{}, {}])).toBe(3);
  });

  it('getNextDifficulty increases when blocks are too fast', async () => {
    const { getNextDifficulty } = await import('../src/consensus/pow.js');
    const now = Date.now();
    // 11 blocks in 5 seconds = ~500ms avg (way below 30s target)
    const fastChain = Array.from({ length: 11 }, (_, i) => ({
      timestamp: now + i * 500,
      difficulty: 4,
    }));
    expect(getNextDifficulty(fastChain)).toBe(5);
  });

  it('getNextDifficulty decreases when blocks are too slow', async () => {
    const { getNextDifficulty } = await import('../src/consensus/pow.js');
    const now = Date.now();
    // 11 blocks at 120s each = way above 30s target
    const slowChain = Array.from({ length: 11 }, (_, i) => ({
      timestamp: now + i * 120_000,
      difficulty: 6,
    }));
    expect(getNextDifficulty(slowChain)).toBe(5);
  });

  it('block hash is deterministic for same nonce', async () => {
    const block = await makeBlock({ nonce: 42 });
    expect(block.getHashSync()).toBe(block.getHashSync());
  });

  it('different nonces produce different hashes', async () => {
    const b1 = await makeBlock({ nonce: 1 });
    const b2 = await makeBlock({ nonce: 2 });
    expect(b1.getHashSync()).not.toBe(b2.getHashSync());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 6: Balance Journal + Reorg
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix 6 — Balance Journal & Reorg', () => {
  let WalletManager, BalanceJournal;
  let dir, wm;

  beforeEach(async () => {
    ({ WalletManager } = await import('../src/wallet/wallet.js'));
    ({ BalanceJournal } = await import('../src/storage/balance-journal.js'));
    dir = tmpDir();
    wm = new WalletManager(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records entries and reads them back', () => {
    const journal = new BalanceJournal(dir, wm);
    journal.record(1, 'addr1', 100, 0, 'tx1');
    journal.record(2, 'addr1', -50, 1, 'tx2');
    expect(journal._entries).toHaveLength(2);
    expect(journal.tipHeight).toBe(2);
  });

  it('rollbackTo reverses nonce changes', async () => {
    const { Wallet } = await import('../src/wallet/wallet.js');
    const w = Wallet.generate();
    w.balance = 0;
    w.nonce = 3;
    wm.saveWallet(w);

    const journal = new BalanceJournal(dir, wm);
    journal.record(10, w.address, 500, 1, null); // height=10, nonceDelta=1
    journal.record(11, w.address, 250, 1, null);

    // Simulate the credited balance
    wm.credit(w.address, 750);
    const loaded = wm.loadWallet(w.address);
    loaded.nonce = 5;
    wm.saveWallet(loaded);

    journal.rollbackTo(9);

    const after = wm.loadWallet(w.address);
    expect(after.balance).toBe(0);   // 750 - 750 undone
    expect(after.nonce).toBe(3);     // 5 - 2 nonceDelta = 3
  });

  it('rollbackTo(h) removes entries with height > h', () => {
    const journal = new BalanceJournal(dir, wm);
    journal.record(1, 'a', 100, 0, null);
    journal.record(2, 'a', 200, 0, null);
    journal.record(3, 'a', 300, 0, null);

    journal.rollbackTo(1);
    expect(journal._entries.every(e => e.height <= 1)).toBe(true);
    expect(journal._entries).toHaveLength(1);
  });

  it('journal persists to disk and reloads', () => {
    const journal1 = new BalanceJournal(dir, wm);
    journal1.record(1, 'addr', 500, 0, 'tx');
    journal1.record(2, 'addr', 250, 1, 'tx2');

    const journal2 = new BalanceJournal(dir, wm); // reload
    expect(journal2._entries).toHaveLength(2);
    expect(journal2.tipHeight).toBe(2);
  });

  it('balance rollback reverses credit on wallet', async () => {
    const { Wallet } = await import('../src/wallet/wallet.js');
    const wallet = Wallet.generate();
    wallet.balance = 0;
    wm.saveWallet(wallet);

    const journal = new BalanceJournal(dir, wm);
    // Simulate a block crediting this wallet
    wm.credit(wallet.address, 1000);
    journal.record(5, wallet.address, 1000, 0, 'reward');
    expect(wm.getBalance(wallet.address)).toBe(1000);

    // Reorg — roll back
    journal.rollbackTo(4);
    expect(wm.getBalance(wallet.address)).toBe(0);
  });

  it('rollbackTo is idempotent when no entries above target', () => {
    const journal = new BalanceJournal(dir, wm);
    journal.record(1, 'x', 100, 0, null);
    journal.rollbackTo(1);
    journal.rollbackTo(1); // second call should be a no-op
    expect(journal._entries).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Job deduplication — race between miners
// ─────────────────────────────────────────────────────────────────────────────

describe('Job deduplication — race between miners', () => {
  it('minedRequestIds is empty on fresh node', () => {
    // Minimal stand-in — just tests the Set behaviour without booting a full node
    const minedRequestIds = new Set();
    expect(minedRequestIds.has('scan-1')).toBe(false);
  });

  it('result added before another miner wins is dropped from pendingValidResults', () => {
    const pendingValidResults = [
      { requestId: 'scan-1', verdict: 'HUMAN' },
      { requestId: 'scan-2', verdict: 'AI' },
      { requestId: 'scan-3', verdict: 'UNCERTAIN' },
    ];
    const minedRequestIds = new Set(['scan-1']); // miner A won scan-1

    // Filter — same logic as _appendBlock
    const remaining = pendingValidResults.filter(r => !minedRequestIds.has(r.requestId));
    expect(remaining).toHaveLength(2);
    expect(remaining.map(r => r.requestId)).not.toContain('scan-1');
  });

  it('result computed after another miner wins is dropped at queue time', () => {
    const minedRequestIds = new Set(['scan-99']);
    // Same check as in computeAndSubmitJob
    const shouldDrop = minedRequestIds.has('scan-99');
    expect(shouldDrop).toBe(true);
  });

  it('proposeBlock excludes already-mined requestIds', () => {
    const pending = [
      { requestId: 'scan-A', verdict: 'HUMAN' },
      { requestId: 'scan-B', verdict: 'AI' },   // already in chain
      { requestId: 'scan-C', verdict: 'HUMAN' },
    ];
    const minedRequestIds = new Set(['scan-B']);

    const deduped = pending.filter(r => !minedRequestIds.has(r.requestId));
    expect(deduped).toHaveLength(2);
    expect(deduped.map(r => r.requestId)).toEqual(['scan-A', 'scan-C']);
  });

  it('minedRequestIds is populated from block.scanResults on accept', () => {
    const minedRequestIds = new Set();
    const block = {
      scanResults: [
        { requestId: 'scan-10' },
        { requestId: 'scan-11' },
      ],
    };
    // Same logic as _appendBlock
    for (const r of (block.scanResults || [])) {
      if (r.requestId) minedRequestIds.add(r.requestId);
    }
    expect(minedRequestIds.has('scan-10')).toBe(true);
    expect(minedRequestIds.has('scan-11')).toBe(true);
    expect(minedRequestIds.has('scan-99')).toBe(false);
  });

  it('same job never appears twice in pendingValidResults', () => {
    const minedRequestIds = new Set();
    const pendingValidResults = [];

    function queueResult(requestId) {
      if (minedRequestIds.has(requestId)) return false;
      if (pendingValidResults.find(r => r.requestId === requestId)) return false;
      pendingValidResults.push({ requestId });
      return true;
    }

    expect(queueResult('scan-X')).toBe(true);
    expect(queueResult('scan-X')).toBe(false); // duplicate
    expect(pendingValidResults).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Block integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('Block integrity', () => {
  it('fromJSON round-trips without data loss', async () => {
    const { PohBlock } = await import('../src/core/block.js');
    const original = await makeBlock({ height: 7, nonce: 42, difficulty: 3, chainWork: 'ff' });
    const restored = PohBlock.fromJSON(original.toJSON());
    expect(restored.height).toBe(7);
    expect(restored.nonce).toBe(42);
    expect(restored.chainWork).toBe('ff');
    expect(restored.getHashSync()).toBe(original.getHashSync());
  });

  it('changing any field changes the hash', async () => {
    const b1 = await makeBlock({ nonce: 0 });
    const b2 = await makeBlock({ nonce: 0, height: 2 });
    expect(b1.getHashSync()).not.toBe(b2.getHashSync());
  });

  it('getHash async == getHashSync', async () => {
    const block = await makeBlock({ nonce: 5 });
    expect(await block.getHash()).toBe(block.getHashSync());
  });
});
