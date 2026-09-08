/**
 * Live gas pricing — what one AI compute token costs in an arbitrary currency.
 *
 * The anchor is fixed and not a market question: 1 AI token = 1 μDAI, and μDAI
 * is the smallest unit, so that is also the floor. A job paid in DAI always
 * costs exactly `tokens` μDAI.
 *
 * Paying in anything else is a conversion, and the network already knows the
 * only rate that matters — the one people are actually trading at. So the price
 * comes from the P2P book first, forex second, and if neither can bridge the
 * pair we say so rather than inventing a number. A static per-currency table
 * (the old GAS_PRICES) is a fourth answer: a rate nobody quoted, going stale
 * from the moment it shipped.
 *
 * Resolution order for "how much of C is one DAI worth":
 *   1. direct     — an open P2P book on DAI/C
 *   2. via major  — DAI/M and C/M from the book, for M in USDT/USDC/BTC/ETH/SOL
 *   3. forex      — USD/DAI from the book, then USD→C from the currency table
 *   4. unavailable — no path; the caller is told to open the market themselves
 *
 * Nothing here is consensus. The accepting miner enforces its own floor, and
 * settlement pays whatever was escrowed, in exactly the currency escrowed.
 */
import { ASSETS, normalizeCurrency, decimalsOf } from '../assets.js';

/** Quote currencies liquid enough to bridge two thin pairs. */
export const MAJORS = [
  'USDT-ERC20', 'USDT-TRC20', 'USDT-TON', 'USDT-SOL', 'USDT-BEP20',
  'USDC-ERC20', 'BTC', 'ETH', 'SOL',
];

/** Dollar-pegged majors — a price in these is a price in USD. */
const USD_MAJORS = new Set(['USDT-ERC20', 'USDT-TRC20', 'USDT-TON', 'USDT-SOL', 'USDT-BEP20', 'USDC-ERC20']);

/** 1 AI token = 1 μDAI; 1 DAI = 1e9 μDAI. */
export const TOKENS_PER_DAI = 1e9;

const price = (store, quote, base) => {
  try { return store?.getReferencePrice?.(quote, base)?.price ?? null; }
  catch { return null; }
};

/**
 * How many units of `currency` one DAI is worth.
 * @returns {{ perDAI: number, source: string, via?: string }|null}
 */
export function daiPriceIn(currency, { orderStore } = {}) {
  const cur = normalizeCurrency(currency);
  if (cur === 'DAI') return { perDAI: 1, source: 'anchor' };

  // 1. Someone is quoting DAI against it directly.
  const direct = price(orderStore, cur, 'DAI');
  if (direct > 0) return { perDAI: direct, source: 'p2p-direct' };

  // 2. Bridge through a major both sides are quoted against.
  //    DAI/M gives M per DAI; C/M gives M per C; so C per DAI = (M/DAI) / (M/C).
  for (const m of MAJORS) {
    if (m === cur) continue;
    const mPerDai = price(orderStore, m, 'DAI');
    if (!(mPerDai > 0)) continue;
    const mPerCur = price(orderStore, m, cur);
    if (!(mPerCur > 0)) continue;
    return { perDAI: mPerDai / mPerCur, source: 'p2p-via-major', via: m };
  }

  // 3. Forex: the book prices DAI in dollars, the currency table converts.
  //    Only reached when nobody quotes C at all -- an official rate is a worse
  //    answer than a traded one, which is why it is third and labelled.
  const fx = ASSETS[cur]?.fxPerUSD;
  if (fx > 0) {
    for (const m of MAJORS) {
      if (!USD_MAJORS.has(m)) continue;
      const usdPerDai = price(orderStore, m, 'DAI');
      if (usdPerDai > 0) return { perDAI: usdPerDai * fx, source: 'forex', via: m };
    }
  }

  return null;
}

/**
 * Minimum acceptable fee for `tokens` compute tokens, paid in `currency`.
 *
 * Returns raw integer units of that currency, or an `unavailable` result naming
 * the pair that nobody is making a market in.
 *
 * @returns {{ raw: number, display: number, source: string, via?: string }
 *          | { unavailable: true, currency: string, message: string }}
 */
export function feeForLive(tokens, currency = 'DAI', { orderStore, config = {} } = {}) {
  const cur = normalizeCurrency(currency);
  const n = Math.max(0, Number(tokens) || 0);

  // An operator override is a deliberate local policy and outranks the market.
  const override = config?.gasPrices?.[cur];
  if (override > 0) {
    return { raw: Math.max(1, Math.ceil(n * override)), display: null, source: 'config-override' };
  }

  // DAI is the anchor: tokens map 1:1 to μDAI, and μDAI is the floor unit.
  if (cur === 'DAI') return { raw: Math.max(1, Math.ceil(n)), display: n / TOKENS_PER_DAI, source: 'anchor' };

  const p = daiPriceIn(cur, { orderStore });
  if (!p) {
    return {
      unavailable: true,
      currency: cur,
      message: `No DAI/${cur} rate: nothing is quoted on the P2P book and no forex rate is available. `
             + `Be the first to place an order on DAI/${cur}, or pay the fee in another currency.`,
    };
  }

  // tokens → DAI → currency → raw units, rounded up so rounding never
  // undercuts the tokens-in-μDAI floor.
  const inCurrency = (n / TOKENS_PER_DAI) * p.perDAI;
  const raw = Math.max(1, Math.ceil(inCurrency * 10 ** decimalsOf(cur)));
  return { raw, display: inCurrency, source: p.source, via: p.via };
}
