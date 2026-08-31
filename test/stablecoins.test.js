/**
 * Multi-stablecoin support — ledger, tx hashing, genesis, fees, atomic swaps.
 *
 * The critical invariants:
 *   1. DAI-only txs/wallets/state hash EXACTLY as before (currency omitted).
 *   2. Stablecoin supply enters ONLY via genesis allocations; per-asset
 *      conservation holds independently of the DAI pot.
 *   3. p2p-swap-filled moves both legs atomically or not at all.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { TxLedgerState } from '../src/consensus/tx-ledger.js';
import { DAITransaction } from '../src/core/transaction.js';
import { computeTxFieldsHash } from '../src/wallet/wallet.js';
import { buildAllocations, buildMigrationGenesis } from '../src/consensus/genesis.js';
import { blockHashOf } from '../src/consensus/block-hash.js';
import { ESCROW_ADDRESS } from '../src/p2p/escrow.js';
import { gasPriceFor, feeFor, outputTokenCap, GAS_PRICES } from '../src/jobs/gas-estimator.js';
import { ASSETS, STABLE_TICKERS, normalizeCurrency, isKnownAsset, toRaw, fromRaw } from '../src/assets.js';

const A = 'dai' + 'a'.repeat(40);
const B = 'dai' + 'b'.repeat(40);
const T = 'dai' + 'c'.repeat(40); // treasury

describe('assets registry', () => {
  it('exposes DAI + 5 stablecoins with correct decimals', () => {
    expect(Object.keys(ASSETS)).toEqual(['DAI', ...STABLE_TICKERS]);
    expect(ASSETS.DAI.decimals).toBe(9);
    for (const t of STABLE_TICKERS) expect(ASSETS[t].decimals).toBe(2);
  });
  it('normalize + raw conversions', () => {
    expect(normalizeCurrency(undefined)).toBe('DAI');
    expect(normalizeCurrency('DAI')).toBe('DAI');
    expect(normalizeCurrency('aiBDT')).toBe('aiBDT');
    expect(isKnownAsset('KGST')).toBe(true);
    expect(isKnownAsset('DOGE')).toBe(false);
    expect(toRaw('aiBDT', 12.5)).toBe(1250);
    expect(fromRaw('aiBDT', 1250)).toBe(12.5);
    expect(toRaw('DAI', 1)).toBe(1e9);
  });
});

describe('tx hashing backward compatibility', () => {
  const fields = { from: A, to: B, amount: 1000, fee: 5, nonce: 1, timestamp: 1700000000000, memo: '' };

  it('DAI tx hash is byte-identical to the historical preimage', () => {
    const legacy = crypto.createHash('sha256').update(JSON.stringify({
      from: fields.from, to: fields.to, amount: fields.amount,
      fee: fields.fee, nonce: fields.nonce, timestamp: fields.timestamp, memo: fields.memo,
    })).digest('hex');
    expect(new DAITransaction({ ...fields }).txHash).toBe(legacy);
    expect(new DAITransaction({ ...fields, currency: 'DAI' }).txHash).toBe(legacy); // DAI normalizes away
    expect(computeTxFieldsHash(fields)).toBe(legacy);
  });

  it('non-DAI currency changes the hash and round-trips through JSON', () => {
    const dai = new DAITransaction({ ...fields });
    const bdt = new DAITransaction({ ...fields, currency: 'aiBDT' });
    expect(bdt.txHash).not.toBe(dai.txHash);
    expect(bdt.txHash).toBe(computeTxFieldsHash({ ...fields, currency: 'aiBDT' }));
    const revived = DAITransaction.fromJSON(JSON.parse(JSON.stringify(bdt.toJSON())));
    expect(revived.txHash).toBe(bdt.txHash);
    expect(revived.currency).toBe('aiBDT');
    // DAI tx serializes WITHOUT a currency key at all
    expect('currency' in JSON.parse(JSON.stringify(dai.toJSON()))).toBe(false);
  });
});

describe('multi-asset ledger', () => {
  function seeded() {
    const l = new TxLedgerState();
    l.applyGenesisAllocations({ genesisAllocations: [
      { address: A, balance: 5_000_000_000, nonce: 0, assets: { aiBDT: 10_000, KGST: 500 } },
      { address: T, balance: 0, nonce: 0, assets: Object.fromEntries(STABLE_TICKERS.map(t => [t, 100_000])) },
    ] });
    return l;
  }

  it('genesis credits per-asset balances and mints per-asset supply', () => {
    const l = seeded();
    expect(l.getBalance(A)).toBe(5_000_000_000);
    expect(l.getBalance(A, 'aiBDT')).toBe(10_000);
    expect(l.getBalance(T, 'aiBTN')).toBe(100_000);
    const audit = l.checkSupplyInvariant();
    expect(audit.ok).toBe(true);
    expect(audit.assets.aiBDT.totalMinted).toBe(110_000);
  });

  it('trusted currency tx moves the right asset and pays the fee in it', () => {
    const l = seeded();
    const tx = new DAITransaction({ from: A, to: B, amount: 1_000, fee: 10, nonce: 1, timestamp: 1, currency: 'aiBDT' });
    const r = l.applyBlock({ height: 1, minerWallet: B, transactions: [tx.toJSON()] }, { strict: true, skipVerify: true });
    expect(r.valid).toBe(true);
    expect(l.getBalance(A, 'aiBDT')).toBe(10_000 - 1_010);
    expect(l.getBalance(B, 'aiBDT')).toBe(1_000 + 10);  // amount + fee, both in aiBDT
    expect(l.getBalance(B)).toBe(0);                     // no DAI moved
    expect(l.checkSupplyInvariant().ok).toBe(true);
  });

  it('rejects unknown currency and insufficient asset balance (DAI balance irrelevant)', () => {
    const l = seeded();
    const bad = new DAITransaction({ from: A, to: B, amount: 1, fee: 0, nonce: 1, timestamp: 1, currency: 'DOGE' });
    expect(l.validateAndApplyTransaction(bad.toJSON()).reason).toMatch(/unknown currency/);
    // A has 5 DAI but only 500 KGST — an KGST overdraft must fail despite DAI funds
    const over = new DAITransaction({ from: A, to: B, amount: 501, fee: 0, nonce: 1, timestamp: 1, currency: 'KGST' });
    const r = l._applyTransactionTrusted(over.toJSON());
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/insufficient/);
  });

  it('clone() deep-copies asset maps', () => {
    const l = seeded();
    const c = l.clone();
    c._debit(A, 5_000, 'aiBDT');
    expect(l.getBalance(A, 'aiBDT')).toBe(10_000);
    expect(c.getBalance(A, 'aiBDT')).toBe(5_000);
  });
});

describe('atomic p2p-swap-filled', () => {
  function swapLedger() {
    const l = new TxLedgerState();
    l.applyGenesisAllocations({ genesisAllocations: [
      { address: A, balance: 0, nonce: 0, assets: { KGST: 10_000 } },   // maker sells KGST
      { address: B, balance: 0, nonce: 0, assets: { aiBDT: 2_000 } },    // taker pays aiBDT
    ] });
    // Maker's sell order escrowed the base
    l.applyP2PEscrowTransition({ type: 'p2p-order-created', side: 'sell', escrowLocked: true, maker: A, daiAmount: 8_700, baseAsset: 'KGST' });
    return l;
  }

  it('success: both legs move, conservation holds per asset', () => {
    const l = swapLedger();
    const ok = l.applyP2PEscrowTransition({
      type: 'p2p-swap-filled', tradeId: 't1', orderId: 'o1', maker: A, taker: B,
      baseAsset: 'KGST', baseAmount: 8_700, quoteAsset: 'aiBDT', quoteAmount: 270,
      baseRecipient: B, quoteRecipient: A, referrer: null, referralFee: 0, updatedAt: 1,
    });
    expect(ok).toBe(true);
    expect(l.getBalance(B, 'KGST')).toBe(8_700);
    expect(l.getBalance(A, 'aiBDT')).toBe(270);
    expect(l.getBalance(B, 'aiBDT')).toBe(2_000 - 270);
    expect(l.getBalance(ESCROW_ADDRESS, 'KGST')).toBe(0);
    expect(l.checkSupplyInvariant().ok).toBe(true);
  });

  it('insufficient quote leaves escrow + taker untouched (atomicity)', () => {
    const l = swapLedger();
    const ok = l.applyP2PEscrowTransition({
      type: 'p2p-swap-filled', tradeId: 't1', orderId: 'o1', maker: A, taker: B,
      baseAsset: 'KGST', baseAmount: 8_700, quoteAsset: 'aiBDT', quoteAmount: 99_999, // > taker balance
      baseRecipient: B, quoteRecipient: A, referralFee: 0, updatedAt: 1,
    });
    expect(ok).toBe(false);
    expect(l.getBalance(ESCROW_ADDRESS, 'KGST')).toBe(8_700); // untouched
    expect(l.getBalance(B, 'aiBDT')).toBe(2_000);
    expect(l.getBalance(A, 'aiBDT')).toBe(0);
  });

  it('credits quote to quoteRecipient when that is not the maker', () => {
    const l = swapLedger();
    const P = 'dai' + 'e'.repeat(40);
    const ok = l.applyP2PEscrowTransition({
      type: 'p2p-swap-filled', tradeId: 't1', orderId: 'o1', maker: A, taker: B,
      baseAsset: 'KGST', baseAmount: 8_700, quoteAsset: 'aiBDT', quoteAmount: 270,
      baseRecipient: B, quoteRecipient: P, referrer: null, referralFee: 0, updatedAt: 1,
    });
    expect(ok).toBe(true);
    expect(l.getBalance(A, 'aiBDT')).toBe(0);
    expect(l.getBalance(P, 'aiBDT')).toBe(270);
    expect(l.getBalance(B, 'KGST')).toBe(8_700);
    expect(l.checkSupplyInvariant().ok).toBe(true);
  });

  it('referral fee comes out of the base leg', () => {
    const l = swapLedger();
    const R = 'dai' + 'd'.repeat(40);
    l.applyP2PEscrowTransition({
      type: 'p2p-swap-filled', tradeId: 't1', orderId: 'o1', maker: A, taker: B,
      baseAsset: 'KGST', baseAmount: 8_700, quoteAsset: 'aiBDT', quoteAmount: 270,
      baseRecipient: B, quoteRecipient: A, referrer: R, referralFee: 26, updatedAt: 1,
    });
    expect(l.getBalance(B, 'KGST')).toBe(8_700 - 26);
    expect(l.getBalance(R, 'KGST')).toBe(26);
    expect(l.checkSupplyInvariant().ok).toBe(true);
  });
});

describe('genesis with assets', () => {
  it('allocations carry assets deterministically; DAI-only rows keep legacy shape', () => {
    const allocs = buildAllocations({
      [A]: { balance: 100, nonce: 2 },
      [T]: { balance: 0, nonce: 0, assets: { KGST: 5, aiBDT: 7 } },
    });
    const plain = allocs.find(a => a.address === A);
    expect('assets' in plain).toBe(false);
    const treas = allocs.find(a => a.address === T);
    expect(Object.keys(treas.assets)).toEqual(['KGST', 'aiBDT']); // default JS sort (K < a)
  });

  it('two genesis builds from the same snapshot hash identically; assets change the hash', () => {
    const snap = { balances: { [A]: { balance: 100, nonce: 0 } }, genesisTimestamp: 1_800_000_000_000 };
    const g1 = buildMigrationGenesis(snap).genesis;
    const g2 = buildMigrationGenesis(snap).genesis;
    expect(blockHashOf(g1)).toBe(blockHashOf(g2));
    const withAssets = buildMigrationGenesis({
      balances: { [A]: { balance: 100, nonce: 0, assets: { aiBDT: 1 } } },
      genesisTimestamp: 1_800_000_000_000,
    }).genesis;
    expect(blockHashOf(withAssets)).not.toBe(blockHashOf(g1));
  });
});

describe('per-currency gas', () => {
  it('stablecoin rates anchor at $0.05 per 1M tokens via fx (fixed rate, not DAI-derived)', () => {
    // raw/token = 0.05 × fx × 100 ÷ 1e6 — verify against the registry fx rates
    for (const t of STABLE_TICKERS) {
      const expected = 0.05 * ASSETS[t].fxPerUSD * 100 / 1e6;
      expect(GAS_PRICES[t]).toBeCloseTo(expected, 10);
    }
    // aiBDT: 1M tokens = 610 raw = ৳6.10 ≈ $0.05 (feeFor ceils to whole raw units)
    expect(feeFor(1_000_000, 'aiBDT')).toBe(610);
  });

  it('$50 of aiBDT buys ~1B tokens (the $200-client / $0.05-miner scenario)', () => {
    // $50 in BDT = ৳6,100 = 610_000 raw units of aiBDT
    const budgetRaw = 610_000;
    const tokens = budgetRaw / GAS_PRICES.aiBDT;
    expect(tokens).toBeCloseTo(1e9, -3);   // ≈ 1 billion AI tokens
  });

  it('gasPriceFor honours config overrides; feeFor floors at 1 raw unit', () => {
    expect(gasPriceFor('DAI')).toBe(1);
    expect(gasPriceFor('aiBDT')).toBe(GAS_PRICES.aiBDT);
    expect(gasPriceFor('aiBDT', { gasPrices: { aiBDT: 0.5 } })).toBe(0.5);
    expect(feeFor(1000, 'aiBDT')).toBe(1);        // fractional price → floor ৳0.01
    expect(feeFor(1000, 'DAI')).toBe(1000);
  });

  it('outputTokenCap handles fractional stablecoin gas prices', () => {
    // 100 raw aiBDT (৳1) at 6.1e-4/token would allow ~164k tokens — clamped by the hard ceiling.
    const cap = outputTokenCap(100, gasPriceFor('aiBDT'), 0);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(4096);
  });
});
