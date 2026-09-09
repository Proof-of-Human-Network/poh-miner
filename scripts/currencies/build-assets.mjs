#!/usr/bin/env node
/**
 * Generate src/assets.js for all 155 tender currencies.
 *
 * Naming and country metadata come from the CLDR-derived table in
 * ~/Desktop/AIST/js/currencies.js, so the node, the wallet and the exchange
 * cannot disagree about which currencies exist.
 *
 * fxPerUSD is the part that must not be guessed. It only ever prices gas, never
 * converts on-chain value, but a wrong number badly misprices compute for that
 * currency. Three rules:
 *
 *   1. Currencies already on-chain keep the fxPerUSD they launched with. Those
 *      values were reviewed, and several are deliberately PARALLEL/street rates
 *      -- for VES, IRR, SDG and CUP the official rate is nowhere near what
 *      people transact at. Today's official CUP is 24; the file says 400. Taking
 *      the feed would misprice Cuban gas ~17x.
 *   2. New currencies take today's official rate from open.er-api.com, recorded
 *      with the feed's own timestamp.
 *   3. New currencies that are known to be managed or to run a parallel market
 *      are emitted with the official rate AND listed in FX_NEEDS_REVIEW, because
 *      an official rate for those is a placeholder wearing a suit. A human signs
 *      them off before the fork; the generator refuses to invent a street rate.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TABLE_JS = path.join(os.homedir(), 'Desktop/AIST/js/currencies.js');
const OUT = path.join(ROOT, 'src/assets.js');

// Reviewed values already on-chain. Deliberately parallel where noted.
const LAUNCHED = {
  KGS: 87, ETB: 128, BTN: 84,
  VES: 250,       // parallel
  PYG: 7300, BDT: 122, PKR: 282, EGP: 48, IQD: 1310, AOA: 915,
  CUP: 400,       // parallel — official peg is ~24
  LYD: 5.5,
  SDG: 2600,      // parallel
  IRR: 1000000,   // parallel — official is ~42,000
};

/**
 * Currencies we deliberately ship with NO rate.
 *
 * Every number here would be a claim about a price, and for these there is no
 * traded price to claim. CUC was abolished in 2021 and has only its old peg;
 * KPW's official 900/USD is roughly 9x from the street. The unrecognised
 * currencies below are not quoted by any feed at all.
 *
 * fxPerUSD is null for these, which means the forex fallback in
 * jobs/gas-price.js never fires and a fee quote returns "no market -- be the
 * first to place an order". The rate arrives when someone opens the book.
 */
const NO_MARKET_RATE = new Set(['CUC', 'KPW', 'PRB', 'SLS', 'APS', 'KID', 'TVD', 'FOK']);

// Managed / multiple-rate / active parallel market. Official feed rate is not
// what people transact at, so these need a human before launch.
const MANAGED = new Set([
  'ARS', 'LBP', 'SYP', 'ZWG', 'ZWL', 'MMK', 'BOB', 'NGN', 'ETB', 'AOA',
  'VES', 'IRR', 'SDG', 'CUP', 'YER', 'AFN', 'SSP', 'HTG', 'LRD', 'CDF',
  'KPW',
]);

const tickerFor = iso => (iso === 'KGS' ? 'KGST' : `ai${iso}`);
const displayFor = iso => (iso === 'KGS' ? 'KGST' : `\u03b1\u03b9${iso}`);

function readTable() {
  const src = fs.readFileSync(TABLE_JS, 'utf8');
  const out = [];
  const re = /\[\s*'([A-Z]{3})'\s*,\s*'((?:\\'|[^'])*)'\s*,\s*'((?:\\'|[^'])*)'\s*,\s*'((?:\\'|[^'])*)'\s*\]/g;
  let m;
  while ((m = re.exec(src))) {
    out.push({
      iso: m[1],
      sign: m[2].replace(/\\'/g, "'"),
      name: m[3].replace(/\\'/g, "'"),
      countries: m[4].replace(/\\'/g, "'"),
    });
  }
  return out;
}

const rates = await (await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(30000) })).json();
if (rates.result !== 'success') throw new Error('FX feed failed');
const asOf = rates.time_last_update_utc;

// Every row, including the six with no ISO code, comes from the CLDR-derived
// table in AIST. Keeping a second copy here is what lets the node and the
// exchange disagree about which currencies exist.
const rows = readTable();
const EXPECTED = 161;
if (rows.length !== EXPECTED) console.warn(`[assets] expected ${EXPECTED} rows, table has ${rows.length}`);

const missing = [], review = [], drift = [], noRate = [];
const out = [];
for (const r of rows) {
  const launched = LAUNCHED[r.iso];
  const official = NO_MARKET_RATE.has(r.iso) ? null : rates.rates[r.iso];
  let fx = launched ?? official;
  // No rate is a deliberate state, not a failure: the currency still ships and
  // its price comes from the first orders on its book.
  if (fx == null && !NO_MARKET_RATE.has(r.iso)) { missing.push(r.iso); continue; }
  if (fx == null) noRate.push(r.iso);
  // Keep launched precision; round feed rates so the file stays readable.
  if (launched == null && fx != null) fx = fx >= 1000 ? Math.round(fx) : Number(fx.toPrecision(6));
  if (launched != null && official != null) {
    const ratio = official / launched;
    if (ratio > 1.15 || ratio < 0.87) drift.push(`${r.iso}: on-chain ${launched} vs official ${official.toFixed(2)}`);
  }
  if (launched == null && fx != null && MANAGED.has(r.iso)) review.push(r.iso);
  out.push({ ...r, ticker: tickerFor(r.iso), display: displayFor(r.iso), fx, launched: launched != null });
}

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const pad = (s, n) => String(s).padEnd(n);
const lines = out.map(a => {
  const note = a.fx == null ? '  // no market yet — price comes from the first orders'
             : (a.launched ? '' : (MANAGED.has(a.iso) ? '  // official rate — NEEDS REVIEW' : ''));
  return `  ${pad(a.ticker + ':', 9)}{ ticker: '${a.ticker}', decimals: 2, display: '${a.display}', sign: '${esc(a.sign)}', iso: '${a.iso}', name: '${esc(a.name)}', country: '${esc(a.countries)}', fxPerUSD: ${a.fx == null ? 'null' : a.fx} },${note}`;
});

const file = `/**
 * assets.js — single source of truth for every on-chain asset.
 *
 * GENERATED by scripts/currencies/build-assets.mjs. Do not hand-edit: the
 * wallet mirrors this file, and the drift between two hand-maintained copies is
 * exactly how ten currencies ended up formatted at the wrong decimals.
 *
 * DAI is the native asset (9 decimals, mined). The ${out.length} regional stablecoins
 * (2 decimals, fiat-style) are minted once at genesis to the treasury address;
 * future supply changes happen via coordinated network upgrades — there is NO
 * runtime mint transition.
 *
 * decimals is 2 for every stablecoin regardless of what the real currency uses.
 * IQD, PYG, IRR and ~30 others are 0-decimal in the real world and are still 2
 * here; the raw-unit maths across node, wallet and SDK assumes it.
 *
 * Tickers are ASCII on-chain (aiETB …) — they appear in tx hashes, APIs and
 * SDKs, so they must never contain non-ASCII. UIs render \`display\` (αιETB) and
 * \`sign\` (Br) instead. KGS is the one exception: it shipped as KGST before the
 * convention existed and keeps that name on-chain.
 *
 * fxPerUSD is ONLY used to derive default per-currency gas prices — never for
 * on-chain conversion (fees settle in exactly the currency paid).
 *
 * fxPerUSD basis:
 *   • Currencies already on-chain keep their reviewed launch values. VES, IRR,
 *     SDG and CUP are deliberately PARALLEL / street rates — the official rate
 *     is far from what people transact at, and pricing gas off the peg would
 *     badly misprice compute.
 *   • Everything else is the official USD rate from open.er-api.com as of
 *     ${asOf}.
 *   • Rows marked NEEDS REVIEW are managed or run a parallel market, so the
 *     official rate is a placeholder. See FX_NEEDS_REVIEW — sign these off
 *     before the fork.
 *   • fxPerUSD null means there is no traded price to ship. The forex fallback
 *     never fires for these and a fee quote says so, inviting the first order.
 *     See FX_NO_MARKET.
 *
 * These move. Re-check before launch and override per node with config.gasPrices.
 */

export const ASSETS = {
  DAI:     { ticker: 'DAI',   decimals: 9, display: 'DAI',   sign: '',    native: true },
${lines.join('\n')}
};

export const STABLE_TICKERS = Object.keys(ASSETS).filter(t => t !== 'DAI');

/**
 * Managed or parallel-market currencies whose official rate is not the rate
 * people transact at. Emitted with the official rate so the chain is complete;
 * a human must confirm or replace each before the genesis snapshot is built.
 */
export const FX_NEEDS_REVIEW = ${JSON.stringify(review)};

/**
 * Currencies shipped with no rate. Their price is discovered from the first
 * P2P orders; until then a fee quote in one of these reports no market rather
 * than converting through an invented number.
 */
export const FX_NO_MARKET = ${JSON.stringify(noRate)};
`;

const tail = fs.readFileSync(OUT, 'utf8');
const marker = '// ── Genesis supply ──';
const keep = tail.slice(tail.indexOf(marker));
fs.writeFileSync(OUT, file + '\n' + keep);

console.log(`assets.js: ${out.length} stablecoins + DAI, rates as of ${asOf}`);
if (missing.length) console.log(`  no rate (omitted): ${missing.join(', ')}`);
if (noRate.length) console.log(`  no rate by design (${noRate.length}), price from first orders: ${noRate.join(', ')}`);
console.log(`  NEEDS REVIEW (${review.length}): ${review.join(', ')}`);
if (drift.length) { console.log('  on-chain rates that have drifted from official:'); drift.forEach(d => console.log(`    ${d}`)); }
