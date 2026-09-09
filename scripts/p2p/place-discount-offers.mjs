#!/usr/bin/env node
/**
 * Place discounted sell offers for every stablecoin the wallet holds.
 *
 * Splits each currency's amount across four payment rails (25% USDT-TRC20,
 * 25% USDT-ERC20, 20% ETH, 30% BTC) and prices every order at a fixed discount
 * to the market rate.
 *
 * PRICING — the direction matters and is easy to invert.
 * `pricePerDAI` is quote units per ONE unit of the base asset; the order store
 * computes value as (daiAmount / divisor) * pricePerDAI. So for a stablecoin
 * with fxPerUSD F, one unit is worth 1/F USD, and an 80% discount is
 *
 *     price = (1 / F) * 0.2        (divide by F -- NOT multiply)
 *
 * KGST at F=87.5 is 0.011429 USD; discounted, 0.002286 USDT. Multiplying
 * instead would ask 17.5 USDT per KGST, ~1,500x market, and nothing would ever
 * fill. The --discount value is the fraction of market price charged, so 0.2
 * means "sell at 20% of market", i.e. an 80% discount.
 *
 * Dry-run by default: prints every order it would create and writes nothing.
 * --place signs with the node's own wallet (unsealed locally, never sent) and
 * creates the orders for real.
 *
 *   node scripts/p2p/place-discount-offers.mjs --amount 1000
 *   node scripts/p2p/place-discount-offers.mjs --amount 1000 --place
 */
import { ASSETS, STABLE_TICKERS } from '../../src/assets.js';
import { identityFromWallet, registerKey } from '../pair-signer.js';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

// pair-signer exposes the identity's secretKey but keeps its signer private, so
// sign here with the same vendored nacl it uses — one implementation of the
// signature, not two.
const nacl = createRequire(import.meta.url)('../vendor/nacl-fast.cjs');
const signString = (str, secretKey) =>
  Buffer.from(nacl.sign.detached(new TextEncoder().encode(str), secretKey)).toString('base64');

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const has = k => process.argv.includes(k);

const NODE = arg('--node', 'http://127.0.0.1:3456');
const DISCOUNT = Number(arg('--discount', '0.2'));      // fraction of market charged
const AMOUNT = arg('--amount', null);                    // display units per currency
const PCT = Number(arg('--pct', '0'));                   // or % of held balance
const PLACE = has('--place');

// Where each rail pays out. A sell order's payout address is signed as part of
// paymentMethods, so a wrong address here is not silently correctable later.
const RAILS = [
  { quote: 'USDT-TRC20', share: 0.25, network: 'TRC20', address: 'TVsva4xU4Mnwm5RutJUarfRd7cV7zgpA4Z', usd: 1 },
  { quote: 'USDT-ERC20', share: 0.25, network: 'ERC20', address: '0x7A29b404c6E64438caf52cb7Ad21C3B1F83CdD0F', usd: 1 },
  { quote: 'ETH',        share: 0.20, network: 'ETH',   address: '0x7A29b404c6E64438caf52cb7Ad21C3B1F83CdD0F', usd: null },
  { quote: 'BTC',        share: 0.30, network: 'BTC',   address: 'bc1qqrw0klnaju0c6gyhgycgjqxj4fxq45xzrq5ttv', usd: null },
];

const sum = RAILS.reduce((a, r) => a + r.share, 0);
if (Math.abs(sum - 1) > 1e-9) throw new Error(`rail shares must total 1, got ${sum}`);
if (!(DISCOUNT > 0 && DISCOUNT <= 1)) throw new Error(`--discount must be in (0,1]; got ${DISCOUNT}`);
if (!AMOUNT && !PCT) throw new Error('give --amount <per-currency units> or --pct <share of balance>');

const j = async (url, opts) => {
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    try { return { ok: r.ok, status: r.status, body: JSON.parse(t) }; }
    catch { return { ok: r.ok, status: r.status, body: t }; }
  } catch (e) {
    // The node being down must not stop a dry run: pricing comes from
    // assets.js, and only balances and placement need the node.
    return { ok: false, status: 0, body: null, error: e.message };
  }
};

// BTC/ETH in USD from CoinGecko's public endpoint (no key), so ETH and BTC
// orders are priced off the same market the USDT ones are.
async function cryptoUsd() {
  const r = await j('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd');
  const btc = r.body?.bitcoin?.usd, eth = r.body?.ethereum?.usd;
  // Never fall back to a stale or invented price: a wrong BTC rate misprices
  // 30% of every order.
  if (!btc || !eth) throw new Error('could not source BTC/ETH USD price — refusing to guess');
  return { BTC: btc, ETH: eth };
}

const info = await j(`${NODE}/api/miner/info`);
const address = arg('--address', null) || info.body?.minerAddress;
if (!address) throw new Error(`node unreachable at ${NODE} and no --address given`);
if (PLACE && !info.ok) throw new Error(`--place needs the node; ${NODE} is unreachable`);

const id = await identityFromWallet(address);
const balRes = await j(`${NODE}/api/wallet/balance?address=${id.address}`);
if (!balRes.ok && PCT) throw new Error(`--pct needs balances; node unreachable at ${NODE}`);
const held = balRes.body?.assets || {};
if (!balRes.ok) console.log(`note: node unreachable at ${NODE} — balances unknown, pricing still exact\n`);
const px = await cryptoUsd();

console.log(`maker      ${id.address}`);
console.log(`discount   ${((1 - DISCOUNT) * 100).toFixed(0)}% off market (charging ${DISCOUNT}x)`);
console.log(`BTC/ETH    $${px.BTC.toLocaleString()} / $${px.ETH.toLocaleString()}`);
console.log(`mode       ${PLACE ? 'PLACE (writes orders)' : 'dry run'}\n`);

const plan = [];
for (const ticker of STABLE_TICKERS) {
  const a = ASSETS[ticker];
  const heldRaw = Number(held[ticker]?.raw ?? held[ticker] ?? 0);
  const heldDisp = heldRaw / 10 ** a.decimals;
  const total = AMOUNT ? Number(AMOUNT) : heldDisp * (PCT / 100);
  if (!(total > 0)) continue;

  const usdPerUnit = 1 / a.fxPerUSD;
  for (const rail of RAILS) {
    const quoteUsd = rail.usd ?? px[rail.quote];
    const price = (usdPerUnit * DISCOUNT) / quoteUsd;   // quote units per 1 base unit
    const amount = total * rail.share;
    if (!(amount > 0) || !Number.isFinite(price) || price <= 0) continue;
    plan.push({
      ticker, quote: rail.quote, amount: Number(amount.toFixed(a.decimals)),
      price: Number(price.toPrecision(9)),
      paymentMethods: [{ network: rail.network, address: rail.address }],
    });
  }
}

if (!plan.length) {
  console.log('Nothing to offer: the wallet holds no stablecoins.');
  console.log('Stablecoins are minted in the genesis snapshot, so this needs the fork first.');
  process.exit(0);
}

const w = { t: 8, q: 12, a: 14, p: 16 };
console.log(`${'ASSET'.padEnd(w.t)}${'QUOTE'.padEnd(w.q)}${'AMOUNT'.padStart(w.a)}${'PRICE/UNIT'.padStart(w.p)}`);
for (const o of plan) {
  console.log(`${o.ticker.padEnd(w.t)}${o.quote.padEnd(w.q)}${String(o.amount).padStart(w.a)}${String(o.price).padStart(w.p)}`);
}
console.log(`\n${plan.length} orders across ${new Set(plan.map(p => p.ticker)).size} currencies`);

if (!PLACE) {
  console.log('\nDry run — nothing written. Re-run with --place to create these.');
  process.exit(0);
}

await registerKey(NODE, id);
let ok = 0, failed = 0;
for (const o of plan) {
  const timestamp = Date.now();
  // Key order is load-bearing: the node rebuilds this object and re-serialises
  // it, so the fields and defaults must match miner-node.js exactly.
  const payload = {
    address: id.address, timestamp, action: 'create-order',
    side: 'sell', baseAsset: o.ticker, quoteCurrency: o.quote,
    daiAmount: o.amount, pricePerDAI: o.price, paymentMethods: o.paymentMethods,
  };
  const signature = signString(JSON.stringify(payload), id.secretKey);
  const res = await j(`${NODE}/api/p2p/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: id.address, signingPublicKey: id.signingPublicKey, signature, timestamp,
      side: 'sell', baseAsset: o.ticker, baseDecimals: ASSETS[o.ticker].decimals,
      quoteCurrency: o.quote, daiAmount: o.amount, pricePerDAI: o.price,
      paymentMethods: o.paymentMethods,
    }),
  });
  if (res.ok && !res.body?.error) { ok++; }
  else { failed++; console.log(`  ✗ ${o.ticker}/${o.quote}: ${res.body?.error || res.status}`); }
}
console.log(`\nplaced ${ok}, failed ${failed}`);
