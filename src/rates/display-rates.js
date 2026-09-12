/**
 * Balance display in a currency the user picked.
 *
 * The home screen shows what you hold. "16,111,095.00 сом" is a number; what
 * people actually want to know is what it is worth in the currency they think
 * in. This resolves that, for DAI and for every stablecoin, in one place so the
 * desktop app and the phone cannot disagree.
 *
 * Resolution, per the same principle as jobs/gas-price.js — traded rates first,
 * published rates second, and silence rather than invention:
 *
 *   1. P2P direct   — someone is quoting the asset against the display currency
 *   2. USD bridge   — asset -> USD on the book, then USD -> display via forex
 *   3. unavailable  — say nothing rather than show a made-up number
 *
 * The hard gate: if nothing on the book quotes DAI against USDT or USDC, there
 * is no anchor to the outside world at all, and NO balances are shown in the
 * display currency. A wallet full of confident-looking converted numbers with
 * no market behind them is worse than a wallet showing none.
 */
import { ASSETS, STABLE_TICKERS, normalizeCurrency } from '../assets.js';

/** Dollar-pegged quotes — a price in these is a price in USD. */
export const USD_QUOTES = [
  'USDT-ERC20', 'USDT-TRC20', 'USDT-TON', 'USDT-SOL', 'USDT-BEP20', 'USDC-ERC20',
];

const FOREX_URL = 'https://open.er-api.com/v6/latest/USD';
const FOREX_TTL_MS = 6 * 60 * 60 * 1000;   // rates move daily; six hours is generous

let _forex = null;         // { rates, asOf, fetchedAt }
let _forexInflight = null;

/** USD-based forex table, cached. Returns null when unreachable — never stale-guesses. */
export async function getForex({ now = Date.now(), fetchImpl = fetch } = {}) {
  if (_forex && now - _forex.fetchedAt < FOREX_TTL_MS) return _forex;
  if (_forexInflight) return _forexInflight;
  _forexInflight = (async () => {
    try {
      const r = await fetchImpl(FOREX_URL, { signal: AbortSignal.timeout(15000) });
      const d = await r.json();
      if (d?.result !== 'success' || !d.rates) return _forex;   // keep the last good table
      _forex = { rates: d.rates, asOf: d.time_last_update_utc, fetchedAt: now };
      return _forex;
    } catch {
      return _forex;
    } finally {
      _forexInflight = null;
    }
  })();
  return _forexInflight;
}

/** Test seam. */
export function _setForex(f) { _forex = f; }

const price = (store, quote, base) => {
  try { return store?.getReferencePrice?.(quote, base)?.price ?? null; }
  catch { return null; }
};

/** The ISO code a display currency settles to for forex purposes. */
export function isoForDisplay(display) {
  const d = String(display || '').trim();
  if (!d || d === 'USD') return 'USD';
  if (ASSETS[d]?.iso) return ASSETS[d].iso;        // aiBTN -> BTN, KGST -> KGS
  return d.toUpperCase();                          // already an ISO code
};

/** How many USD one DAI is worth, from the book. Null when nothing quotes it. */
export function daiUsd(orderStore) {
  for (const q of USD_QUOTES) {
    const p = price(orderStore, q, 'DAI');
    if (p > 0) return p;
  }
  return null;
}

/**
 * Value of one unit of every held asset, expressed in `display`.
 *
 * @returns {{ currency, iso, perUnit: Record<string, number>, sources: Record<string,string>, asOf }}
 *          or { unavailable: true, reason } when there is no anchor at all.
 */
export async function displayRates(display, { orderStore, forex = null } = {}) {
  const currency = String(display || 'USD').trim() || 'USD';
  const iso = isoForDisplay(currency);

  // The anchor. No DAI/USD market means no conversion is honest.
  const usdPerDai = daiUsd(orderStore);
  if (!(usdPerDai > 0)) {
    return { unavailable: true, reason: 'no-dai-usd-market', currency, iso };
  }

  const fx = forex || await getForex();
  const usdToDisplay = iso === 'USD' ? 1 : (fx?.rates?.[iso] ?? null);

  const perUnit = {};
  const sources = {};

  const assets = ['DAI', ...STABLE_TICKERS];
  for (const t of assets) {
    // 1. Traded directly against the display currency.
    const direct = t === currency ? 1 : price(orderStore, currency, t);
    if (direct > 0) { perUnit[t] = direct; sources[t] = t === currency ? 'identity' : 'p2p-direct'; continue; }

    // 2. Bridge through USD.
    if (usdToDisplay == null) continue;             // no forex leg for this currency
    let usd = null;
    if (t === 'DAI') usd = usdPerDai;
    else {
      const q = USD_QUOTES.map(x => price(orderStore, x, t)).find(v => v > 0);
      if (q > 0) { usd = q; sources[t] = 'p2p-usd'; }
      else {
        // Nothing quotes this stablecoin at all. It mirrors a real currency, so
        // forex can price it — but only if that currency has a published rate.
        const tIso = ASSETS[t]?.iso;
        const perUsd = tIso ? fx?.rates?.[tIso] : null;
        if (perUsd > 0) { usd = 1 / perUsd; sources[t] = 'forex'; }
      }
    }
    if (!(usd > 0)) continue;                       // 3. say nothing
    if (!sources[t]) sources[t] = 'p2p-usd';
    perUnit[t] = usd * usdToDisplay;
  }

  return { currency, iso, perUnit, sources, usdPerDai, asOf: fx?.asOf || null };
}

/** Convenience: convert a balance map to display-currency values. */
export function convertBalances(balances, rates) {
  if (!rates || rates.unavailable) return {};
  const out = {};
  for (const [t, amount] of Object.entries(balances || {})) {
    const per = rates.perUnit[normalizeCurrency(t)];
    const n = Number(amount) || 0;
    if (per > 0 && n > 0) out[t] = n * per;
  }
  return out;
}
