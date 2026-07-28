/**
 * assets.js — single source of truth for every on-chain asset.
 *
 * POH is the native asset (9 decimals, mined). The five regional stablecoins
 * (2 decimals, fiat-style) are minted once at genesis to the treasury address;
 * future supply changes happen via coordinated network upgrades — there is NO
 * runtime mint transition.
 *
 * Tickers are ASCII on-chain (aiGEL …) — they appear in tx hashes, APIs and
 * SDKs, so they must never contain non-ASCII. UIs render `display` (αιGEL) and
 * `sign` (₾) instead. fxPerUSD values mirror landing/regions/src/data.mjs and
 * are ONLY used to derive default per-currency gas prices — never for on-chain
 * conversion (fees settle in exactly the currency paid).
 */

export const ASSETS = {
  POH:   { ticker: 'POH',   decimals: 9, display: 'POH',   sign: '',    native: true },
  aiGEL: { ticker: 'aiGEL', decimals: 2, display: 'αιGEL', sign: '₾',   iso: 'GEL', country: 'Georgia',    fxPerUSD: 2.7 },
  aiKGS: { ticker: 'aiKGS', decimals: 2, display: 'αιKGS', sign: 'som', iso: 'KGS', country: 'Kyrgyzstan', fxPerUSD: 87 },
  aiAMD: { ticker: 'aiAMD', decimals: 2, display: 'αιAMD', sign: '֏',   iso: 'AMD', country: 'Armenia',    fxPerUSD: 385 },
  aiETB: { ticker: 'aiETB', decimals: 2, display: 'αιETB', sign: 'Br',  iso: 'ETB', country: 'Ethiopia',   fxPerUSD: 128 },
  aiBTN: { ticker: 'aiBTN', decimals: 2, display: 'αιBTN', sign: 'Nu.', iso: 'BTN', country: 'Bhutan',     fxPerUSD: 84 },
};

export const STABLE_TICKERS = ['aiGEL', 'aiKGS', 'aiAMD', 'aiETB', 'aiBTN'];

// ── Genesis supply (owner fills in before executing the reset) ───────────────
// The treasury receives the entire initial stablecoin supply in the migration
// genesis. Placeholder values: 1,000,000.00 of each (2-decimal raw units).
export const TREASURY_ADDRESS = 'poh_TODO_OWNER_TREASURY';
export const INITIAL_STABLE_SUPPLY_RAW = Object.fromEntries(
  STABLE_TICKERS.map(t => [t, 100_000_000]),   // 1,000,000.00 in raw (×100)
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Canonical currency: undefined/null/'POH' → 'POH'; anything else unchanged. */
export function normalizeCurrency(c) {
  return (!c || c === 'POH') ? 'POH' : String(c);
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

/** Human string like "12.50 αιGEL" / "0.001 POH". */
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
