/**
 * Live gas pricing — the fee for a job in an arbitrary currency comes from what
 * people are actually trading at, not a shipped table.
 */
import { describe, it, expect } from 'vitest';
import { feeForLive, daiPriceIn, TOKENS_PER_DAI, MAJORS } from '../src/jobs/gas-price.js';
import { ASSETS, FX_NO_MARKET } from '../src/assets.js';

/** Minimal order-store stand-in: a map of "base|quote" -> price. */
const book = pairs => ({
  getReferencePrice: (quote, base = 'DAI') => ({ price: pairs[`${base}|${quote}`] ?? null }),
});
const EMPTY = book({});

describe('gas price anchor', () => {
  it('prices DAI at exactly one μDAI per token', () => {
    expect(feeForLive(1000, 'DAI', { orderStore: EMPTY })).toMatchObject({ raw: 1000, source: 'anchor' });
    expect(feeForLive(TOKENS_PER_DAI, 'DAI', { orderStore: EMPTY }).display).toBe(1);
  });

  it('never charges less than one raw unit, even for zero tokens', () => {
    expect(feeForLive(0, 'DAI', { orderStore: EMPTY }).raw).toBe(1);
    expect(feeForLive(1, 'aiETB', { orderStore: book({ 'DAI|aiETB': 12 }) }).raw).toBeGreaterThanOrEqual(1);
  });

  it('rounds up, so rounding cannot undercut the μDAI floor', () => {
    // 1 token at 12 aiETB/DAI is 1.2e-8 aiETB — far below one raw unit.
    expect(feeForLive(1, 'aiETB', { orderStore: book({ 'DAI|aiETB': 12 }) }).raw).toBe(1);
  });
});

describe('gas price resolution order', () => {
  it('prefers a direct P2P quote', () => {
    const r = feeForLive(TOKENS_PER_DAI, 'aiETB', { orderStore: book({ 'DAI|aiETB': 12 }) });
    expect(r).toMatchObject({ source: 'p2p-direct', display: 12, raw: 1200 });
  });

  it('bridges through a major when the direct pair is empty', () => {
    // 0.5 USDT per DAI and 0.008 USDT per aiETB → 62.5 aiETB per DAI.
    const r = feeForLive(TOKENS_PER_DAI, 'aiETB', {
      orderStore: book({ 'DAI|USDT-ERC20': 0.5, 'aiETB|USDT-ERC20': 0.008 }),
    });
    expect(r).toMatchObject({ source: 'p2p-via-major', via: 'USDT-ERC20' });
    expect(r.display).toBeCloseTo(62.5, 9);
  });

  it('falls back to forex only when nobody quotes the currency', () => {
    const r = feeForLive(TOKENS_PER_DAI, 'aiETB', { orderStore: book({ 'DAI|USDT-ERC20': 0.5 }) });
    expect(r.source).toBe('forex');
    expect(r.display).toBeCloseTo(0.5 * ASSETS.aiETB.fxPerUSD, 9);
  });

  it('says the pair is unavailable rather than inventing a rate', () => {
    const r = feeForLive(1000, 'aiETB', { orderStore: EMPTY });
    expect(r.unavailable).toBe(true);
    expect(r.message).toMatch(/DAI\/aiETB/);
    expect(r.message).toMatch(/first to place an order/i);
    expect(r.raw).toBeUndefined();
  });

  it('lets an operator override outrank the market', () => {
    const r = feeForLive(1000, 'aiETB', {
      orderStore: book({ 'DAI|aiETB': 12 }),
      config: { gasPrices: { aiETB: 2 } },
    });
    expect(r).toMatchObject({ source: 'config-override', raw: 2000 });
  });
});

describe('daiPriceIn', () => {
  it('anchors DAI to itself', () => {
    expect(daiPriceIn('DAI', { orderStore: EMPTY })).toMatchObject({ perDAI: 1, source: 'anchor' });
  });

  it('returns null when no path exists', () => {
    expect(daiPriceIn('aiETB', { orderStore: EMPTY })).toBeNull();
  });

  it('only treats dollar-pegged majors as USD for the forex bridge', () => {
    // BTC is a major, but a BTC/DAI price is not a USD price, so forex must not
    // multiply a BTC rate by fxPerUSD.
    expect(daiPriceIn('aiETB', { orderStore: book({ 'DAI|BTC': 0.00001 }) })).toBeNull();
    expect(MAJORS).toContain('BTC');
  });
});

describe('currencies shipped without a rate', () => {
  it('refuses to quote a fee, even when the forex bridge is available', () => {
    // A USD price for DAI exists, so the forex path is reachable — but these
    // currencies have no fxPerUSD to convert with, and inventing one is the
    // whole thing we are avoiding.
    const usdBook = book({ 'DAI|USDT-ERC20': 0.5 });
    for (const iso of FX_NO_MARKET) {
      const ticker = iso === 'KGS' ? 'KGST' : `ai${iso}`;
      if (!ASSETS[ticker]) continue;
      expect(ASSETS[ticker].fxPerUSD, `${ticker} must ship no rate`).toBeNull();
      const q = feeForLive(1e9, ticker, { orderStore: usdBook });
      expect(q.unavailable, `${ticker} must not be priced`).toBe(true);
      expect(q.message).toMatch(/first to place an order/i);
    }
  });

  it('prices normally as soon as the first order exists', () => {
    const q = feeForLive(1e9, 'aiCUC', { orderStore: book({ 'DAI|aiCUC': 7 }) });
    expect(q).toMatchObject({ source: 'p2p-direct', display: 7, raw: 700 });
  });
});
