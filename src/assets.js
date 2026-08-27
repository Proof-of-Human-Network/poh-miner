/**
 * assets.js — single source of truth for every on-chain asset.
 *
 * DAI is the native asset (9 decimals, mined). The regional stablecoins
 * (2 decimals, fiat-style) are minted once at genesis to the treasury address;
 * future supply changes happen via coordinated network upgrades — there is NO
 * runtime mint transition.
 *
 * Tickers are ASCII on-chain (aiETB …) — they appear in tx hashes, APIs and
 * SDKs, so they must never contain non-ASCII. UIs render `display` (αιETB) and
 * `sign` (Br) instead. fxPerUSD is ONLY used to derive default per-currency gas
 * prices — never for on-chain conversion (fees settle in exactly the currency
 * paid).
 *
 * fxPerUSD basis: PARALLEL / street rates, not official pegs. For VES, IRR, SDG
 * and CUP the official rate is far from what people actually transact at, and
 * pricing gas off the peg would badly misprice compute. These move fast —
 * re-check before launch and override per node with config.gasPrices.
 */

export const ASSETS = {
  DAI:   { ticker: 'DAI',   decimals: 9, display: 'DAI',   sign: '',    native: true },
  KGST:  { ticker: 'KGST',  decimals: 2, display: 'KGST',  sign: 'som', iso: 'KGS', country: 'Kyrgyzstan', fxPerUSD: 87 },
  aiETB: { ticker: 'aiETB', decimals: 2, display: 'αιETB', sign: 'Br',  iso: 'ETB', country: 'Ethiopia',   fxPerUSD: 128 },
  aiBTN: { ticker: 'aiBTN', decimals: 2, display: 'αιBTN', sign: 'Nu.', iso: 'BTN', country: 'Bhutan',     fxPerUSD: 84 },
  aiVES: { ticker: 'aiVES', decimals: 2, display: 'αιVES', sign: 'Bs.', iso: 'VES', country: 'Venezuela',  fxPerUSD: 250 },
  aiPYG: { ticker: 'aiPYG', decimals: 2, display: 'αιPYG', sign: '₲',   iso: 'PYG', country: 'Paraguay',   fxPerUSD: 7300 },
  aiBDT: { ticker: 'aiBDT', decimals: 2, display: 'αιBDT', sign: '৳',   iso: 'BDT', country: 'Bangladesh', fxPerUSD: 122 },
  aiPKR: { ticker: 'aiPKR', decimals: 2, display: 'αιPKR', sign: '₨',   iso: 'PKR', country: 'Pakistan',   fxPerUSD: 282 },
  aiEGP: { ticker: 'aiEGP', decimals: 2, display: 'αιEGP', sign: 'E£',  iso: 'EGP', country: 'Egypt',      fxPerUSD: 48 },
  aiIQD: { ticker: 'aiIQD', decimals: 2, display: 'αιIQD', sign: 'ع.د', iso: 'IQD', country: 'Iraq',       fxPerUSD: 1310 },
  aiAOA: { ticker: 'aiAOA', decimals: 2, display: 'αιAOA', sign: 'Kz',  iso: 'AOA', country: 'Angola',     fxPerUSD: 915 },
  aiCUP: { ticker: 'aiCUP', decimals: 2, display: 'αιCUP', sign: 'MN$', iso: 'CUP', country: 'Cuba',       fxPerUSD: 400 },
  aiLYD: { ticker: 'aiLYD', decimals: 2, display: 'αιLYD', sign: 'ل.د', iso: 'LYD', country: 'Libya',      fxPerUSD: 5.5 },
  aiSDG: { ticker: 'aiSDG', decimals: 2, display: 'αιSDG', sign: 'ج.س', iso: 'SDG', country: 'Sudan',      fxPerUSD: 2600 },
  aiIRR: { ticker: 'aiIRR', decimals: 2, display: 'αιIRR', sign: '﷼',   iso: 'IRR', country: 'Iran',       fxPerUSD: 1000000 },
};

export const STABLE_TICKERS = [
  'KGST', 'aiETB', 'aiBTN', 'aiVES', 'aiPYG', 'aiBDT', 'aiPKR',
  'aiEGP', 'aiIQD', 'aiAOA', 'aiCUP', 'aiLYD', 'aiSDG', 'aiIRR',
];

// ── Genesis supply (owner fills in before executing the reset) ───────────────
// The treasury receives the entire initial stablecoin supply in the migration
// genesis. Placeholder values: 1,000,000.00 of each (2-decimal raw units).
export const TREASURY_ADDRESS = 'dai_TODO_OWNER_TREASURY';
export const INITIAL_STABLE_SUPPLY_RAW = Object.fromEntries(
  STABLE_TICKERS.map(t => [t, 100_000_000]),   // 1,000,000.00 in raw (×100)
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Canonical currency: undefined/null/'DAI' → 'DAI'; anything else unchanged. */
export function normalizeCurrency(c) {
  return (!c || c === 'DAI') ? 'DAI' : String(c);
}

export function isKnownAsset(c) {
  return Object.prototype.hasOwnProperty.call(ASSETS, normalizeCurrency(c));
}

export function isStable(c) {
  return STABLE_TICKERS.includes(normalizeCurrency(c));
}

export function decimalsOf(c) {
  const a = ASSETS[normalizeCurrency(c)];
  return a ? a.decimals : 9;
}

/** Display amount → integer raw units (rounds to nearest raw unit). */
export function toRaw(ticker, displayAmt) {
  return Math.round(Number(displayAmt) * 10 ** decimalsOf(ticker));
}

/** Integer raw units → display amount (number). */
export function fromRaw(ticker, raw) {
  return Number(raw || 0) / 10 ** decimalsOf(ticker);
}

/** Human string like "12.50 αιGEL" / "0.001 DAI". */
export function formatAmount(ticker, raw) {
  const cur = normalizeCurrency(ticker);
  const a = ASSETS[cur] || { decimals: 9, display: cur };
  const v = fromRaw(cur, raw);
  const digits = a.decimals === 2 ? 2 : (v >= 1 ? 3 : 6);
  return `${v.toFixed(digits)} ${a.display}`;
}

/** Public listing shape served by GET /api/assets (safe for UIs/SDKs). */
export function listAssets() {
  return Object.values(ASSETS).map(({ ticker, decimals, display, sign, iso, country, native }) => ({
    ticker, decimals, display, sign: sign || '', iso: iso || null, country: country || null, native: !!native,
  }));
}
