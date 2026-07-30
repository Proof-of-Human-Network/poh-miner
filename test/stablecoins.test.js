/**
 * Multi-stablecoin support — ledger, tx hashing, genesis, fees, atomic swaps.
 *
 * The critical invariants:
 *   1. POH-only txs/wallets/state hash EXACTLY as before (currency omitted).
 *   2. Stablecoin supply enters ONLY via genesis allocations; per-asset
 *      conservation holds independently of the POH pot.
 *   3. p2p-swap-filled moves both legs atomically or not at all.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { TxLedgerState } from '../src/consensus/tx-ledger.js';
import { PoHTransaction } from '../src/core/transaction.js';
import { computeTxFieldsHash } from '../src/wallet/wallet.js';
import { buildAllocations, buildMigrationGenesis } from '../src/consensus/genesis.js';
import { blockHashOf } from '../src/consensus/block-hash.js';
import { ESCROW_ADDRESS } from '../src/p2p/escrow.js';
import { gasPriceFor, feeFor, outputTokenCap, GAS_PRICES } from '../src/jobs/gas-estimator.js';
import { ASSETS, STABLE_TICKERS, normalizeCurrency, isKnownAsset, toRaw, fromRaw } from '../src/assets.js';

const A = 'poh' + 'a'.repeat(40);
const B = 'poh' + 'b'.repeat(40);
const T = 'poh' + 'c'.repeat(40); // treasury

describe('assets registry', () => {
  it('exposes POH + 5 stablecoins with correct decimals', () => {
    expect(Object.keys(ASSETS)).toEqual(['POH', ...STABLE_TICKERS]);
    expect(ASSETS.POH.decimals).toBe(9);
    for (const t of STABLE_TICKERS) expect(ASSETS[t].decimals).toBe(2);
  });
  it('normalize + raw conversions', () => {
    expect(normalizeCurrency(undefined)).toBe('POH');
    expect(normalizeCurrency('POH')).toBe('POH');
    expect(normalizeCurrency('aiGEL')).toBe('aiGEL');
    expect(isKnownAsset('aiKGS')).toBe(true);
    expect(isKnownAsset('DOGE')).toBe(false);
    expect(toRaw('aiGEL', 12.5)).toBe(1250);
    expect(fromRaw('aiGEL', 1250)).toBe(12.5);
    expect(toRaw('POH', 1)).toBe(1e9);
  });
});

describe('tx hashing backward compatibility', () => {
  const fields = { from: A, to: B, amount: 1000, fee: 5, nonce: 1, timestamp: 1700000000000, memo: '' };

  it('POH tx hash is byte-identical to the historical preimage', () => {
    const legacy = crypto.createHash('sha256').update(JSON.stringify({
      from: fields.from, to: fields.to, amount: fields.amount,
      fee: fields.fee, nonce: fields.nonce, timestamp: fields.timestamp, memo: fields.memo,
    })).digest('hex');
    expect(new PoHTransaction({ ...fields }).txHash).toBe(legacy);
    expect(new PoHTransaction({ ...fields, currency: 'POH' }).txHash).toBe(legacy); // POH normalizes away
    expect(computeTxFieldsHash(fields)).toBe(legacy);
  });

  it('non-POH currency changes the hash and round-trips through JSON', () => {
    const poh = new PoHTransaction({ ...fields });
    const gel = new PoHTransaction({ ...fields, currency: 'aiGEL' });
    expect(gel.txHash).not.toBe(poh.txHash);
    expect(gel.txHash).toBe(computeTxFieldsHash({ ...fields, currency: 'aiGEL' }));
    const revived = PoHTransaction.fromJSON(JSON.parse(JSON.stringify(gel.toJSON())));
    expect(revived.txHash).toBe(gel.txHash);
    expect(revived.currency).toBe('aiGEL');
    // POH tx serializes WITHOUT a currency key at all
    expect('currency' in JSON.parse(JSON.stringify(poh.toJSON()))).toBe(false);
  });
});

describe('multi-asset ledger', () => {
  function seeded() {
    const l = new TxLedgerState();
    l.applyGenesisAllocations({ genesisAllocations: [
      { address: A, balance: 5_000_000_000, nonce: 0, assets: { aiGEL: 10_000, aiKGS: 500 } },
      { address: T, balance: 0, nonce: 0, assets: Object.fromEntries(STABLE_TICKERS.map(t => [t, 100_000])) },
    ] });
    return l;
  }

  it('genesis credits per-asset balances and mints per-asset supply', () => {
    const l = seeded();
    expect(l.getBalance(A)).toBe(5_000_000_000);
    expect(l.getBalance(A, 'aiGEL')).toBe(10_000);
    expect(l.getBalance(T, 'aiBTN')).toBe(100_000);
    const audit = l.checkSupplyInvariant();
    expect(audit.ok).toBe(true);
    expect(audit.assets.aiGEL.totalMinted).toBe(110_000);
  });

  it('trusted currency tx moves the right asset and pays the fee in it', () => {
    const l = seeded();
    const tx = new PoHTransaction({ from: A, to: B, amount: 1_000, fee: 10, nonce: 1, timestamp: 1, currency: 'aiGEL' });
    const r = l.applyBlock({ height: 1, minerWallet: B, transactions: [tx.toJSON()] }, { strict: true, skipVerify: true });
    expect(r.valid).toBe(true);
    expect(l.getBalance(A, 'aiGEL')).toBe(10_000 - 1_010);
    expect(l.getBalance(B, 'aiGEL')).toBe(1_000 + 10);  // amount + fee, both in aiGEL
    expect(l.getBalance(B)).toBe(0);                     // no POH moved
    expect(l.checkSupplyInvariant().ok).toBe(true);
  });

  it('rejects unknown currency and insufficient asset balance (POH balance irrelevant)', () => {
    const l = seeded();
    const bad = new PoHTransaction({ from: A, to: B, amount: 1, fee: 0, nonce: 1, timestamp: 1, currency: 'DOGE' });
    expect(l.validateAndApplyTransaction(bad.toJSON()).reason).toMatch(/unknown currency/);
    // A has 5 POH but only 500 aiKGS — an aiKGS overdraft must fail despite POH funds
    const over = new PoHTransaction({ from: A, to: B, amount: 501, fee: 0, nonce: 1, timestamp: 1, currency: 'aiKGS' });
    const r = l._applyTransactionTrusted(over.toJSON());
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/insufficient/);
  });

  it('clone() deep-copies asset maps', () => {
    const l = seeded();
    const c = l.clone();
    c._debit(A, 5_000, 'aiGEL');
    expect(l.getBalance(A, 'aiGEL')).toBe(10_000);
    expect(c.getBalance(A, 'aiGEL')).toBe(5_000);
  });
});

describe('atomic p2p-swap-filled', () => {
  function swapLedger() {
    const l = new TxLedgerState();
    l.applyGenesisAllocations({ genesisAllocations: [
      { address: A, balance: 0, nonce: 0, assets: { aiKGS: 10_000 } },   // maker sells aiKGS
      { address: B, balance: 0, nonce: 0, assets: { aiGEL: 2_000 } },    // taker pays aiGEL
    ] });
    // Maker's sell order escrowed the base
    l.applyP2PEscrowTransition({ type: 'p2p-order-created', side: 'sell', escrowLocked: true, maker: A, pohAmount: 8_700, baseAsset: 'aiKGS' });
    return l;
  }

  it('success: both legs move, conservation holds per asset', () => {
    const l = swapLedger();
    const ok = l.applyP2PEscrowTransition({
      type: 'p2p-swap-filled', tradeId: 't1', orderId: 'o1', maker: A, taker: B,
      baseAsset: 'aiKGS', baseAmount: 8_700, quoteAsset: 'aiGEL', quoteAmount: 270,
      baseRecipient: B, quoteRecipient: A, referrer: null, referralFee: 0, updatedAt: 1,
    });
    expect(ok).toBe(true);
    expect(l.getBalance(B, 'aiKGS')).toBe(8_700);
    expect(l.getBalance(A, 'aiGEL')).toBe(270);
    expect(l.getBalance(B, 'aiGEL')).toBe(2_000 - 270);
    expect(l.getBalance(ESCROW_ADDRESS, 'aiKGS')).toBe(0);
    expect(l.checkSupplyInvariant().ok).toBe(true);
  });

  it('insufficient quote leaves escrow + taker untouched (atomicity)', () => {
    const l = swapLedger();
    const ok = l.applyP2PEscrowTransition({
      type: 'p2p-swap-filled', tradeId: 't1', orderId: 'o1', maker: A, taker: B,
      baseAsset: 'aiKGS', baseAmount: 8_700, quoteAsset: 'aiGEL', quoteAmount: 99_999, // > taker balance
      baseRecipient: B, quoteRecipient: A, referralFee: 0, updatedAt: 1,
    });
    expect(ok).toBe(false);
    expect(l.getBalance(ESCROW_ADDRESS, 'aiKGS')).toBe(8_700); // untouched
    expect(l.getBalance(B, 'aiGEL')).toBe(2_000);
    expect(l.getBalance(A, 'aiGEL')).toBe(0);
  });

  it('referral fee comes out of the base leg', () => {
    const l = swapLedger();
    const R = 'poh' + 'd'.repeat(40);
    l.applyP2PEscrowTransition({
      type: 'p2p-swap-filled', tradeId: 't1', orderId: 'o1', maker: A, taker: B,
      baseAsset: 'aiKGS', baseAmount: 8_700, quoteAsset: 'aiGEL', quoteAmount: 270,
      baseRecipient: B, quoteRecipient: A, referrer: R, referralFee: 26, updatedAt: 1,
    });
    expect(l.getBalance(B, 'aiKGS')).toBe(8_700 - 26);
    expect(l.getBalance(R, 'aiKGS')).toBe(26);
    expect(l.checkSupplyInvariant().ok).toBe(true);
  });
});

describe('genesis with assets', () => {
  it('allocations carry assets deterministically; POH-only rows keep legacy shape', () => {
    const allocs = buildAllocations({
      [A]: { balance: 100, nonce: 2 },
      [T]: { balance: 0, nonce: 0, assets: { aiKGS: 5, aiGEL: 7 } },
    });
    const plain = allocs.find(a => a.address === A);
    expect('assets' in plain).toBe(false);
    const treas = allocs.find(a => a.address === T);
    expect(Object.keys(treas.assets)).toEqual(['aiGEL', 'aiKGS']); // sorted
  });

  it('two genesis builds from the same snapshot hash identically; assets change the hash', () => {
    const snap = { balances: { [A]: { balance: 100, nonce: 0 } }, genesisTimestamp: 1_800_000_000_000 };
    const g1 = buildMigrationGenesis(snap).genesis;
    const g2 = buildMigrationGenesis(snap).genesis;
    expect(blockHashOf(g1)).toBe(blockHashOf(g2));
    const withAssets = buildMigrationGenesis({
      balances: { [A]: { balance: 100, nonce: 0, assets: { aiGEL: 1 } } },
      genesisTimestamp: 1_800_000_000_000,
    }).genesis;
    expect(blockHashOf(withAssets)).not.toBe(blockHashOf(g1));
  });
});

describe('per-currency gas', () => {
  it('stablecoin rates anchor at $0.05 per 1M tokens via fx (fixed rate, not POH-derived)', () => {
    // raw/token = 0.05 × fx × 100 ÷ 1e6 — verify against the registry fx rates
    for (const t of STABLE_TICKERS) {
      const expected = 0.05 * ASSETS[t].fxPerUSD * 100 / 1e6;
      expect(GAS_PRICES[t]).toBeCloseTo(expected, 10);
    }
    // aiGEL: 1M tokens = 13.5 raw = ₾0.135 ≈ $0.05 (feeFor ceils to whole raw units)
    expect(feeFor(1_000_000, 'aiGEL')).toBe(14);
  });

  it('$50 of aiGEL buys ~1B tokens (the $200-client / $0.05-miner scenario)', () => {
    // $50 in GEL = 135 GEL = 13_500 raw units of aiGEL
    const budgetRaw = 13_500;
    const tokens = budgetRaw / GAS_PRICES.aiGEL;
    expect(tokens).toBeCloseTo(1e9, -3);   // ≈ 1 billion AI tokens
  });

  it('gasPriceFor honours config overrides; feeFor floors at 1 raw unit', () => {
    expect(gasPriceFor('POH')).toBe(1);
    expect(gasPriceFor('aiGEL')).toBe(GAS_PRICES.aiGEL);
    expect(gasPriceFor('aiGEL', { gasPrices: { aiGEL: 0.5 } })).toBe(0.5);
    expect(feeFor(1000, 'aiGEL')).toBe(1);        // fractional price → floor 0.01 GEL
    expect(feeFor(1000, 'POH')).toBe(1000);
  });

  it('outputTokenCap handles fractional stablecoin gas prices', () => {
    // 100 raw aiGEL (1 GEL) at 2.7e-7/token would allow ~370M tokens — clamped by the hard ceiling.
    const cap = outputTokenCap(100, gasPriceFor('aiGEL'), 0);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(4096);
  });
});
