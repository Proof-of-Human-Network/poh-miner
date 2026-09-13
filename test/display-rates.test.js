/**
 * Balance display in a user-chosen currency.
 *
 * The rule that matters most is the last one: with no DAI/USD market there is
 * no honest anchor, so nothing is converted at all. A wallet full of
 * confident-looking numbers with no market behind them is worse than one
 * showing none.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { displayRates, convertBalances, daiUsd, isoForDisplay, _setForex } from '../src/rates/display-rates.js';

const book = pairs => ({ getReferencePrice: (quote, base = 'DAI') => ({ price: pairs[`${base}|${quote}`] ?? null }) });
const FOREX = { rates: { USD: 1, RUB: 80, KGS: 87.5, BTN: 84, EUR: 0.92 }, asOf: 'test', fetchedAt: Date.now() };

beforeEach(() => _setForex(FOREX));

describe('the DAI/USD anchor', () => {
  it('converts nothing when no USD market exists', async () => {
    const r = await displayRates('RUB', { orderStore: book({}), forex: FOREX });
    expect(r.unavailable).toBe(true);
    expect(r.reason).toBe('no-dai-usd-market');
    expect(convertBalances({ DAI: 100, KGST: 5000 }, r)).toEqual({});
  });

  it('accepts any dollar-pegged quote as the anchor', () => {
    expect(daiUsd(book({ 'DAI|USDT-TRC20': 0.5 }))).toBe(0.5);
    expect(daiUsd(book({ 'DAI|USDC-ERC20': 0.4 }))).toBe(0.4);
    // BTC is a major but not a dollar quote — it must not anchor USD.
    expect(daiUsd(book({ 'DAI|BTC': 0.00001 }))).toBeNull();
  });
});

describe('rate resolution', () => {
  it('prefers a direct P2P quote against the display currency', async () => {
    // DAI/USD exists as the anchor, and DAI is also quoted directly in KGST.
    const r = await displayRates('KGST', { orderStore: book({ 'DAI|USDT-ERC20': 0.5, 'DAI|KGST': 44 }), forex: FOREX });
    expect(r.perUnit.DAI).toBe(44);
    expect(r.sources.DAI).toBe('p2p-direct');
  });

  it('bridges through USD and forex when there is no direct pair', async () => {
    const r = await displayRates('RUB', { orderStore: book({ 'DAI|USDT-ERC20': 0.5 }), forex: FOREX });
    // 1 DAI = 0.5 USD, 1 USD = 80 RUB → 40 RUB.
    expect(r.perUnit.DAI).toBeCloseTo(40, 9);
    expect(r.iso).toBe('RUB');
  });

  it('prices a stablecoin nobody quotes off its own currency', async () => {
    const r = await displayRates('USD', { orderStore: book({ 'DAI|USDT-ERC20': 0.5 }), forex: FOREX });
    // aiBTN mirrors BTN at 84/USD → 1 aiBTN ≈ 0.0119 USD.
    expect(r.perUnit.aiBTN).toBeCloseTo(1 / 84, 9);
    expect(r.sources.aiBTN).toBe('forex');
  });

  it('omits a stablecoin with no market and no forex rate', async () => {
    // aiKPW ships with no rate and is not in the forex table.
    const r = await displayRates('USD', { orderStore: book({ 'DAI|USDT-ERC20': 0.5 }), forex: FOREX });
    expect(r.perUnit.aiKPW).toBeUndefined();
  });

  it('maps a chain ticker to the ISO code forex knows', () => {
    expect(isoForDisplay('KGST')).toBe('KGS');
    expect(isoForDisplay('aiBTN')).toBe('BTN');
    expect(isoForDisplay('USD')).toBe('USD');
    expect(isoForDisplay('rub')).toBe('RUB');
  });

  it('finds a P2P quote booked under the chain ticker when display is the ISO', async () => {
    const r = await displayRates('KGS', { orderStore: book({ 'DAI|USDT-ERC20': 0.5, 'DAI|KGST': 44 }), forex: FOREX });
    expect(r.perUnit.DAI).toBe(44);
    expect(r.sources.DAI).toBe('p2p-direct');
    expect(r.perUnit.KGST).toBe(1);
    expect(r.sources.KGST).toBe('identity');
  });
});

describe('convertBalances', () => {
  it('multiplies held amounts by the resolved rate', async () => {
    const r = await displayRates('RUB', { orderStore: book({ 'DAI|USDT-ERC20': 0.5 }), forex: FOREX });
    const out = convertBalances({ DAI: 10, aiBTN: 84 }, r);
    expect(out.DAI).toBeCloseTo(400, 6);        // 10 × 40
    expect(out.aiBTN).toBeCloseTo(80, 6);       // 84 BTN = 1 USD = 80 RUB
  });

  it('skips zero and unknown holdings', async () => {
    const r = await displayRates('USD', { orderStore: book({ 'DAI|USDT-ERC20': 0.5 }), forex: FOREX });
    expect(convertBalances({ DAI: 0, aiKPW: 5, nope: 3 }, r)).toEqual({});
  });
});
