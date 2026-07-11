import { describe, it, expect } from 'vitest';
import {
  FINALITY_DEPTH,
  evaluateReorg,
  signCheckpoint,
  verifyCheckpoint,
  chainHonorsCheckpoint,
} from '../src/consensus/finality.js';
import { Wallet } from '../src/wallet/wallet.js';

/**
 * Finality: rolling checkpoints + max-reorg-depth. These rules make deep
 * double-spends impossible on a small SHA-256 PoW chain regardless of attacker
 * hashrate — a synced node refuses to rewrite history buried deeper than
 * FINALITY_DEPTH, and no node adopts a chain that contradicts the bootnode's
 * signed checkpoint.
 */
describe('max-reorg-depth', () => {
  const D = 100;

  it('allows a shallow reorg on a mature chain', () => {
    // tip #1000, fork keeps up to #995 → depth 5 (< 100)
    const r = evaluateReorg({ localTipHeight: 1000, forkHeight: 995, finalityDepth: D });
    expect(r.allowed).toBe(true);
  });

  it('rejects a reorg deeper than the finality depth', () => {
    // tip #1000, fork keeps up to #800 → depth 200 (> 100)
    const r = evaluateReorg({ localTipHeight: 1000, forkHeight: 800, finalityDepth: D });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/exceeds finality depth/);
  });

  it('rejects a full-chain replacement (fork keeps nothing) on a mature chain', () => {
    // forkHeight -1 = replace from genesis; tip #1000 → depth 1001
    const r = evaluateReorg({ localTipHeight: 1000, forkHeight: -1, finalityDepth: D });
    expect(r.allowed).toBe(false);
  });

  it('exempts a fresh/short node so bootstrap-from-genesis still works', () => {
    // tip below the finality depth: no constraint even for a full replacement
    expect(evaluateReorg({ localTipHeight: 40, forkHeight: -1, finalityDepth: D }).allowed).toBe(true);
    expect(evaluateReorg({ localTipHeight: 99, forkHeight: 0, finalityDepth: D }).allowed).toBe(true);
  });

  it('treats being merely behind (append, depth 0) as always allowed', () => {
    // forkHeight === localTipHeight → not abandoning anything, just extending
    const r = evaluateReorg({ localTipHeight: 5000, forkHeight: 5000, finalityDepth: D });
    expect(r.allowed).toBe(true);
  });

  it('honors the operator escape hatch for recovery', () => {
    const r = evaluateReorg({ localTipHeight: 1000, forkHeight: -1, finalityDepth: D, allowDeep: true });
    expect(r.allowed).toBe(true);
    expect(r.reason).toMatch(/explicitly allowed/);
  });

  it('boundary: depth exactly == finalityDepth is allowed, +1 is rejected', () => {
    expect(evaluateReorg({ localTipHeight: 1000, forkHeight: 900, finalityDepth: D }).allowed).toBe(true);  // depth 100
    expect(evaluateReorg({ localTipHeight: 1000, forkHeight: 899, finalityDepth: D }).allowed).toBe(false); // depth 101
  });

  it('exports a sane default depth', () => {
    expect(FINALITY_DEPTH).toBeGreaterThan(0);
  });
});

describe('signed checkpoint', () => {
  const signer = Wallet.generate();
  const cpData = { height: 900, hash: 'a'.repeat(64) };

  it('signs and verifies a checkpoint round-trip', () => {
    const cp = signCheckpoint(signer, cpData);
    expect(cp.height).toBe(900);
    expect(cp.signingPublicKey).toBe(signer.signingPublicKey);
    expect(verifyCheckpoint(cp).ok).toBe(true);
  });

  it('accepts a checkpoint from the pinned signer, rejects an impostor', () => {
    const cp = signCheckpoint(signer, cpData);
    expect(verifyCheckpoint(cp, { pinnedPublicKey: signer.signingPublicKey }).ok).toBe(true);

    const impostor = Wallet.generate();
    const forged = signCheckpoint(impostor, cpData);
    const v = verifyCheckpoint(forged, { pinnedPublicKey: signer.signingPublicKey });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/pinned key/);
  });

  it('accepts a checkpoint pinned by the signer poh… address (log-friendly form)', () => {
    const cp = signCheckpoint(signer, cpData);
    expect(verifyCheckpoint(cp, { pinnedPublicKey: signer.address }).ok).toBe(true);

    const impostor = Wallet.generate();
    const forged = signCheckpoint(impostor, cpData);
    expect(verifyCheckpoint(forged, { pinnedPublicKey: signer.address }).ok).toBe(false);
  });

  it('rejects a tampered height/hash (signature no longer matches)', () => {
    const cp = signCheckpoint(signer, cpData);
    expect(verifyCheckpoint({ ...cp, height: 901 }).ok).toBe(false);
    expect(verifyCheckpoint({ ...cp, hash: 'b'.repeat(64) }).ok).toBe(false);
  });

  it('rejects malformed checkpoints', () => {
    expect(verifyCheckpoint(null).ok).toBe(false);
    expect(verifyCheckpoint({ height: 1 }).ok).toBe(false);
  });
});

describe('checkpoint inclusion (chainHonorsCheckpoint)', () => {
  const cp = { height: 900, hash: 'good-hash' };
  const hashOf = b => b.hash;

  it('accepts a chain that contains the checkpointed block with the right hash', () => {
    const blocks = [{ height: 899, hash: 'x' }, { height: 900, hash: 'good-hash' }, { height: 901, hash: 'y' }];
    expect(chainHonorsCheckpoint(blocks, cp, hashOf)).toBe(true);
  });

  it('rejects a chain that spans the checkpoint height with a DIFFERENT hash (forged history)', () => {
    const blocks = [{ height: 900, hash: 'FORGED' }, { height: 901, hash: 'y' }];
    expect(chainHonorsCheckpoint(blocks, cp, hashOf)).toBe(false);
  });

  it('does not constrain a segment that does not reach the checkpoint height (still catching up)', () => {
    const blocks = [{ height: 950, hash: 'z' }, { height: 951, hash: 'w' }];
    expect(chainHonorsCheckpoint(blocks, cp, hashOf)).toBe(true);
  });

  it('no checkpoint → always honored', () => {
    expect(chainHonorsCheckpoint([{ height: 900, hash: 'anything' }], null, hashOf)).toBe(true);
  });
});
