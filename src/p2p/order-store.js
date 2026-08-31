import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { STABLE_TICKERS } from '../assets.js';

// Off-chain quote legs — external crypto/fiat the counterparty pays outside the
// DAI chain (settled manually with payment proof + release).
export const QUOTE_CURRENCIES = [
  'USDT-ERC20', 'USDT-TRC20', 'USDT-TON', 'USDT-SOL', 'USDT-BEP20',
  'USDC-ERC20', 'BTC', 'ETH', 'SOL',
  'Bank Transfer',
];

// On-chain assets — usable as the order's BASE asset (what the maker sells) and
// as a quote leg. When BOTH legs are on-chain the trade settles atomically
// (p2p-swap-filled), with no payment-sent/confirm step.
export const ONCHAIN_ASSETS = ['DAI', ...STABLE_TICKERS];

export function isOnChainAsset(c) { return ONCHAIN_ASSETS.includes(c); }
export function isValidQuote(c)   { return QUOTE_CURRENCIES.includes(c) || ONCHAIN_ASSETS.includes(c); }

const DAI_ADDR = /^dai[0-9a-f]{40}$/i;

/** First dai… address on the order's payment methods — where the seller receives an on-chain quote. */
export function quotePayoutAddress(order) {
  for (const m of order?.paymentMethods || []) {
    const addr = typeof m === 'string' ? m : m?.address;
    if (typeof addr === 'string' && DAI_ADDR.test(addr.trim())) return addr.trim();
  }
  return order?.maker || null;
}

// Wire pair id is BASE-QUOTE (WP5 `?pair=`). Quotes like USDT-TRC20 contain
// hyphens — always parse with parsePair(), never split on the first '-'.
export function pairId(baseAsset, quoteCurrency) {
  return `${baseAsset}-${quoteCurrency}`;
}

export function parsePair(pair) {
  if (!pair || typeof pair !== 'string') return null;
  const bases = [...ONCHAIN_ASSETS].sort((a, b) => b.length - a.length);
  const quotes = new Set([...QUOTE_CURRENCIES, ...ONCHAIN_ASSETS]);
  for (const base of bases) {
    const prefix = `${base}-`;
    if (!pair.startsWith(prefix)) continue;
    const quote = pair.slice(prefix.length);
    if (quotes.has(quote) && quote !== base) return { baseAsset: base, quoteCurrency: quote };
  }
  return null;
}

const ORDER_EXPIRY_MS    = 24 * 60 * 60 * 1000;  // 24 h
const PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;        // 15 min

export class OrderStore {
  constructor(dataDir) {
    const dir = dataDir || path.join(os.homedir(), '.dai-miner', 'p2p');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.ordersFile = path.join(dir, 'orders.json');
    this.tradesFile  = path.join(dir, 'trades.json');
    this.orders = this._load(this.ordersFile);
    this.trades  = this._load(this.tradesFile);
  }

  _load(file) {
    if (!fs.existsSync(file)) return {};
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  }

  _saveOrders() {
    try {
      const tmp = this.ordersFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.orders, null, 2));
      fs.renameSync(tmp, this.ordersFile);
    } catch (e) { console.error('[P2P] Failed to save orders:', e.message); }
  }

  _saveTrades() {
    try {
      const tmp = this.tradesFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.trades, null, 2));
      fs.renameSync(tmp, this.tradesFile);
    } catch (e) { console.error('[P2P] Failed to save trades:', e.message); }
  }

  // ─── Orders ──────────────────────────────────────────────────────────────

  createOrder({ maker, side, daiAmount, baseAsset = 'DAI', quoteCurrency, pricePerDAI, minTrade = 0, maxTrade, paymentMethods = [], baseDecimals }) {
    if (!['buy', 'sell'].includes(side))            return { error: 'side must be buy or sell' };
    if (!isOnChainAsset(baseAsset))                 return { error: `unsupported base asset: ${baseAsset}` };
    if (!isValidQuote(quoteCurrency))               return { error: `unsupported currency: ${quoteCurrency}` };
    if (baseAsset === quoteCurrency)                return { error: 'base and quote must differ' };
    if (!(daiAmount > 0))                           return { error: 'daiAmount must be positive' };
    if (!(pricePerDAI > 0))                         return { error: 'pricePerDAI must be positive' };
    // Payment methods are always required. Off-chain: USDT/bank rails the buyer
    // pays. On-chain: a dai… address the seller receives the quote at — the
    // buyer pays from their DAI wallet and gets the sold asset in that same wallet.
    const atomic = isOnChainAsset(quoteCurrency);
    if (!Array.isArray(paymentMethods) || paymentMethods.length === 0) {
      return { error: 'at least one payment method required' };
    }
    if (atomic && !quotePayoutAddress({ paymentMethods, maker: null })) {
      return { error: 'on-chain payment method must be a dai… address (where you receive the quote)' };
    }

    // Trade limits have to be coherent before the order is published, or the
    // limits shown to takers are decorative: an order with min above max can
    // never be filled, and one whose max exceeds its own size promises more
    // than it can settle.
    const divisor = baseDecimals != null ? 10 ** baseDecimals : (baseAsset === 'DAI' ? 1e9 : 100);
    const orderValue = (daiAmount / divisor) * pricePerDAI;
    const min = Number(minTrade) || 0;
    const max = maxTrade == null ? orderValue : Number(maxTrade);
    if (!Number.isFinite(min) || min < 0)     return { error: 'minTrade must be zero or more' };
    if (!Number.isFinite(max) || !(max > 0))  return { error: 'maxTrade must be positive' };
    if (min > max)                            return { error: `minTrade (${min}) cannot exceed maxTrade (${max})` };
    // Tiny rounding slack so a max computed from the order's own size is not
    // rejected by float error.
    if (max > orderValue * (1 + 1e-9))        return { error: `maxTrade (${max}) exceeds the order's total value (${orderValue})` };

    const now = Date.now();
    const order = {
      id: crypto.randomUUID(),
      maker,
      side,
      daiAmount,        // BASE amount in raw units of baseAsset (μDAI for DAI; ×100 for stables). Field name kept for wire compat.
      ...(baseAsset !== 'DAI' ? { baseAsset } : {}),   // omitted for DAI — legacy orders unchanged
      quoteCurrency,
      pricePerDAI,      // quote units per 1 DISPLAY unit of baseAsset
      minTrade: min,    // min quote amount per trade
      maxTrade: max,
      paymentMethods,   // [{ network, address, details }] — dai… addr required when quote is on-chain
      status: 'open',
      escrowLocked: false,
      tradeId: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ORDER_EXPIRY_MS,
    };
    this.orders[order.id] = order;
    this._saveOrders();
    return { order };
  }

  getOrder(id) { return this.orders[id] || null; }

  listOrders({ side, quoteCurrency, baseAsset, maker, status } = {}) {
    const now = Date.now();
    return Object.values(this.orders).filter(o => {
      const effectiveStatus = status || 'open';
      if (effectiveStatus === 'open' && o.expiresAt < now && o.status === 'open') return false;
      if (o.status !== effectiveStatus) return false;
      if (side && o.side !== side) return false;
      if (quoteCurrency && o.quoteCurrency !== quoteCurrency) return false;
      if (baseAsset && (o.baseAsset || 'DAI') !== baseAsset) return false;
      if (maker && o.maker !== maker) return false;
      return true;
    }).sort((a, b) => b.createdAt - a.createdAt);
  }

  listMyOrders(address) {
    return Object.values(this.orders)
      .filter(o => o.maker === address)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // DAI has no fixed/oracle price — the ONLY reference is the best open P2P order.
  // For one currency: best bid = highest a buyer will pay, best ask = lowest a seller
  // will take; `price` is the mid when both sides exist, else the single best order.
  _priceFor(quoteCurrency, baseAsset = 'DAI') {
    const open = this.listOrders({ quoteCurrency, baseAsset, status: 'open' });
    const buys  = open.filter(o => o.side === 'buy').sort((a, b) => b.pricePerDAI - a.pricePerDAI);
    const sells = open.filter(o => o.side === 'sell').sort((a, b) => a.pricePerDAI - b.pricePerDAI);
    const bestBid = buys[0] || null;
    const bestAsk = sells[0] || null;
    if (!bestBid && !bestAsk) return { price: null, quoteCurrency, baseAsset, source: 'none' };
    const price = (bestBid && bestAsk) ? (bestBid.pricePerDAI + bestAsk.pricePerDAI) / 2
                : bestAsk ? bestAsk.pricePerDAI : bestBid.pricePerDAI;
    return {
      price,
      quoteCurrency,
      baseAsset,
      bestBid: bestBid && { price: bestBid.pricePerDAI, orderId: bestBid.id, daiAmount: bestBid.daiAmount },
      bestAsk: bestAsk && { price: bestAsk.pricePerDAI, orderId: bestAsk.id, daiAmount: bestAsk.daiAmount },
      source: 'p2p-best-order',
      asOf: Date.now(),
    };
  }

  // Reference price for a (baseAsset, quoteCurrency) pair, derived only from the
  // best open P2P order(s). Pass a currency for a single quote (base defaults to
  // DAI), or omit for a per-currency map of everything quoted against the base.
  getReferencePrice(quoteCurrency = null, baseAsset = 'DAI') {
    if (quoteCurrency) return this._priceFor(quoteCurrency, baseAsset);
    const out = {};
    for (const c of [...QUOTE_CURRENCIES, ...ONCHAIN_ASSETS]) {
      if (c === baseAsset) continue;
      const r = this._priceFor(c, baseAsset);
      if (r.price != null) out[c] = r;
    }
    return out;
  }

  // Every listed BASE-QUOTE pair plus last (book mid). change24h is filled in
  // by PriceHistory when the HTTP handler has a sampler.
  listMarkets({ pair } = {}) {
    let pairs;
    if (pair) {
      const parsed = parsePair(pair);
      if (!parsed) return { error: `unknown pair: ${pair}` };
      pairs = [parsed];
    } else {
      pairs = [];
      for (const baseAsset of ONCHAIN_ASSETS) {
        for (const quoteCurrency of [...QUOTE_CURRENCIES, ...ONCHAIN_ASSETS]) {
          if (quoteCurrency === baseAsset) continue;
          pairs.push({ baseAsset, quoteCurrency });
        }
      }
    }
    return {
      markets: pairs.map(({ baseAsset, quoteCurrency }) => {
        const ref = this._priceFor(quoteCurrency, baseAsset);
        return {
          pair: pairId(baseAsset, quoteCurrency),
          base: baseAsset,
          quote: quoteCurrency,
          last: ref.price,
          change24h: null,
          bestBid: ref.bestBid ? ref.bestBid.price : null,
          bestAsk: ref.bestAsk ? ref.bestAsk.price : null,
          source: ref.source,
          onchainQuote: isOnChainAsset(quoteCurrency),
        };
      }),
    };
  }

  _patchOrder(id, patch) {
    if (!this.orders[id]) return null;
    Object.assign(this.orders[id], patch, { updatedAt: Date.now() });
    this._saveOrders();
    return this.orders[id];
  }

  _baseDivisor(order) {
    return (order?.baseAsset || 'DAI') === 'DAI' ? 1e9 : 100;
  }

  _quoteValue(order, daiAmount) {
    return (daiAmount / this._baseDivisor(order)) * (order.pricePerDAI || 0);
  }

  /**
   * After a fill, keep leftover size on the order instead of closing it.
   * Idempotent: a second call for an already-applied fill (open + no tradeId,
   * or already completed) is a no-op so gossip cannot subtract twice.
   */
  _applyFillToOrder(orderId, filledDaiAmount) {
    const order = this.orders[orderId];
    if (!order) return null;
    if (order.status === 'completed' || order.status === 'cancelled' || order.status === 'disputed') {
      return order;
    }
    if (order.status === 'open' && !order.tradeId) return order;

    const remaining = Math.max(0, (order.daiAmount || 0) - (filledDaiAmount || 0));
    if (remaining <= 0) {
      return this._patchOrder(orderId, { status: 'completed', escrowLocked: false, tradeId: null, daiAmount: 0 });
    }
    const remainingValue = this._quoteValue(order, remaining);
    const min = Math.min(Number(order.minTrade) || 0, remainingValue);
    const max = remainingValue;
    return this._patchOrder(orderId, {
      status: 'open',
      daiAmount: remaining,
      minTrade: min,
      maxTrade: max,
      tradeId: null,
      escrowLocked: order.side === 'sell' ? true : false,
    });
  }

  cancelOrder(id) {
    const o = this.orders[id];
    if (!o) return { error: 'order not found' };
    if (!['open', 'locked'].includes(o.status)) return { error: `cannot cancel: order is ${o.status}` };
    return { order: this._patchOrder(id, { status: 'cancelled', escrowLocked: false }) };
  }

  // ─── Trades ──────────────────────────────────────────────────────────────

  selectOrder(orderId, { taker, daiAmount, quoteAmount, takerPayoutAddress }) {
    const order = this.orders[orderId];
    if (!order)                       return { error: 'order not found' };
    if (order.status !== 'open')      return { error: `order is ${order.status}` };
    if (taker === order.maker)        return { error: 'cannot trade with yourself' };
    if (!(daiAmount > 0))             return { error: 'daiAmount must be positive' };
    if (!(quoteAmount > 0))           return { error: 'quoteAmount must be positive' };
    if (daiAmount > order.daiAmount)  return { error: 'daiAmount exceeds order size' };

    // Enforce the maker's advertised limits. The mobile wallet checks these
    // before submitting, but a client-side check is a courtesy, not a control —
    // any other client, or curl, can ignore it. This is where it has to hold.
    const min = Number(order.minTrade) || 0;
    if (quoteAmount < min) {
      return { error: `below the minimum trade of ${min} ${order.quoteCurrency}` };
    }
    if (order.maxTrade != null && quoteAmount > Number(order.maxTrade)) {
      return { error: `above the maximum trade of ${order.maxTrade} ${order.quoteCurrency}` };
    }

    const now = Date.now();
    const payout = typeof takerPayoutAddress === 'string' ? takerPayoutAddress.trim() : '';
    const trade = {
      id: crypto.randomUUID(),
      orderId,
      taker,
      daiAmount,
      quoteAmount,
      status: 'selected',
      // Off-chain quote receive address when the taker is selling the base
      // (taking a buy). Atomic / sell-takes receive on-chain at `taker`.
      ...(payout ? { takerPayoutAddress: payout } : {}),
      // Atomic on-chain swap: both legs settle in one chain transition — no
      // payment-sent/confirm phase, no payment deadline.
      ...(isOnChainAsset(order.quoteCurrency) ? { atomic: true } : {}),
      paymentDeadline: now + PAYMENT_TIMEOUT_MS,
      disputeReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.trades[trade.id] = trade;
    this._saveTrades();
    this._patchOrder(orderId, { status: 'locked', tradeId: trade.id });
    return { trade };
  }

  getTrade(id) { return this.trades[id] || null; }

  listMyTrades(address) {
    return Object.values(this.trades).filter(t => {
      const o = this.orders[t.orderId];
      return t.taker === address || (o && o.maker === address);
    }).sort((a, b) => b.createdAt - a.createdAt);
  }

  _patchTrade(id, patch) {
    if (!this.trades[id]) return null;
    Object.assign(this.trades[id], patch, { updatedAt: Date.now() });
    this._saveTrades();
    return this.trades[id];
  }

  markPaymentSent(tradeId) {
    const t = this.trades[tradeId];
    if (!t) return { error: 'trade not found' };
    if (t.status !== 'selected') return { error: `trade is ${t.status}` };
    return { trade: this._patchTrade(tradeId, { status: 'payment_sent' }) };
  }

  completeTrade(tradeId) {
    const t = this.trades[tradeId];
    if (!t) return { error: 'trade not found' };
    if (t.status === 'completed') return { trade: t, order: this.orders[t.orderId] };
    if (!['selected', 'payment_sent'].includes(t.status)) return { error: `trade is ${t.status}` };
    this._patchTrade(tradeId, { status: 'completed' });
    const order = this._applyFillToOrder(t.orderId, t.daiAmount);
    return { trade: this.trades[tradeId], order };
  }

  cancelTrade(tradeId) {
    const t = this.trades[tradeId];
    if (!t) return { error: 'trade not found' };
    if (t.status === 'completed') return { error: 'trade already completed' };
    if (t.status === 'payment_sent') return { error: 'cannot cancel after payment sent; open a dispute instead' };
    const order = this.orders[t.orderId];
    this._patchTrade(tradeId, { status: 'cancelled' });
    // Sell orders locked the FULL remaining size at create — cancelling the
    // take must not refund escrow or the rest of the listing is unbacked.
    // Buy takes lock only this trade's amount; that refund is the API's job.
    this._patchOrder(t.orderId, {
      status: 'open',
      tradeId: null,
      escrowLocked: order?.side === 'sell' ? true : false,
    });
    return { trade: this.trades[tradeId], order: this.orders[t.orderId] };
  }

  disputeTrade(tradeId, { reason = '' } = {}) {
    const t = this.trades[tradeId];
    if (!t) return { error: 'trade not found' };
    if (t.status === 'completed') return { error: 'trade already completed' };
    this._patchTrade(tradeId, { status: 'disputed', disputeReason: reason });
    this._patchOrder(t.orderId, { status: 'disputed' });
    return { trade: this.trades[tradeId] };
  }

  // ─── Gossip sync ─────────────────────────────────────────────────────────

  ingestGossipOrder(order) {
    if (!order?.id) return;
    const existing = this.orders[order.id];
    if (!existing || order.updatedAt > (existing.updatedAt || 0)) {
      this.orders[order.id] = order;
      this._saveOrders();
    }
  }

  ingestGossipTrade(trade) {
    if (!trade?.id) return;
    const existing = this.trades[trade.id];
    if (!existing || trade.updatedAt > (existing.updatedAt || 0)) {
      this.trades[trade.id] = trade;
      this._saveTrades();
      // Order remainder is owned by completeTrade / the gossiped order object.
      // Do not force the whole listing to 'completed' here — a 0.02 fill of a
      // 0.1 order would close the leftover 0.08 and leave it stuck in escrow.
      if (trade.orderId && this.orders[trade.orderId] && trade.status === 'cancelled') {
        const o = this.orders[trade.orderId];
        if (o.status === 'locked' && o.tradeId === trade.id) {
          this._patchOrder(trade.orderId, {
            status: 'open',
            tradeId: null,
            escrowLocked: o.side === 'sell',
          });
        }
      }
    }
  }
}
