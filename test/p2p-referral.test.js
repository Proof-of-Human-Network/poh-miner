import { describe, it, expect, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  ReferralStore,
  REFERRAL_FEE_BPS,
  referralCodeFor,
} from '../src/p2p/referral-store.js';

describe('P2P referral', () => {
  let store;
  const A = 'dai' + 'a'.repeat(40);
  const B = 'dai' + 'b'.repeat(40);
  const C = 'dai' + 'c'.repeat(40);

  beforeEach(() => {
    store = new ReferralStore(fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-ref-')));
  });

  it('derives the same code for an address on every node', () => {
    const code = store.getCode(A);
    expect(code).toBe(referralCodeFor(A));
    expect(code).toMatch(/^[0-9A-F]{8}$/);
    const other = new ReferralStore(fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-ref2-')));
    expect(other.getCode(A)).toBe(code);
  });

  it('binds once and rejects self-referral', () => {
    const code = store.getCode(A);
    expect(store.applyReferral(B, code).referrer).toBe(A);
    expect(store.applyReferral(B, code).error).toMatch(/already/);
    expect(store.applyReferral(A, code).error).toMatch(/yourself/);
  });

  it('prefers the DAI buyer\'s referrer, then the seller\'s', () => {
    store.applyReferral(B, store.getCode(A)); // buyer B referred by A
    expect(store.referrerForTrade({ buyer: B, seller: C })).toBe(A);
    expect(store.referrerForTrade({ buyer: C, seller: B })).toBe(A);
    expect(store.referrerForTrade({ buyer: C, seller: C })).toBeNull();
  });

  it('charges 30 bps and floors', () => {
    expect(REFERRAL_FEE_BPS).toBe(30);
    const fee = store.creditFee(A, 20_000_000, 't1'); // 0.02 DAI
    expect(fee).toBe(60_000); // 0.00006 DAI
    expect(store.getStats(A).earnedFees).toBe(60_000);
    expect(store.getStats(A).tradeCount).toBe(1);
  });

  it('does not double-count the same trade on replay', () => {
    store.creditFee(A, 20_000_000, 't1');
    store.recordFee(A, 60_000, 't1');
    store.creditFee(A, 20_000_000, 't1');
    expect(store.getStats(A).earnedFees).toBe(60_000);
    expect(store.getStats(A).tradeCount).toBe(1);
  });

  it('accepts a gossiped binding without a code', () => {
    expect(store.applyReferralFromGossip(B, A).referrer).toBe(A);
    expect(store.getReferrer(B)).toBe(A);
  });
});
