import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { STABLE_TICKERS } from '../assets.js';

// Off-chain quote legs — external crypto/fiat the counterparty pays outside the
// PoH chain (settled manually with payment proof + release).
export const QUOTE_CURRENCIES = [
  'USDT-ERC20', 'USDT-TRC20', 'USDT-TON', 'USDT-SOL', 'USDT-BEP20',
  'USDC-ERC20', 'BTC', 'ETH', 'SOL',
  'Bank Transfer',
];

// On-chain assets — usable as the order's BASE asset (what the maker sells) and
// as a quote leg. When BOTH legs are on-chain the trade settles atomically
// (p2p-swap-filled), with no payment-sent/confirm step.
export const ONCHAIN_ASSETS = ['POH', ...STABLE_TICKERS];

export function isOnChainAsset(c) { return ONCHAIN_ASSETS.includes(c); }
export function isValidQuote(c)   { return QUOTE_CURRENCIES.includes(c) || ONCHAIN_ASSETS.includes(c); }

const ORDER_EXPIRY_MS    = 24 * 60 * 60 * 1000;  // 24 h
const PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;        // 15 min

export class OrderStore {
  constructor(dataDir) {
    const dir = dataDir || path.join(os.homedir(), '.poh-miner', 'p2p');
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

  createOrder({ maker, side, pohAmount, baseAsset = 'POH', quoteCurrency, pricePerPOH, minTrade = 0, maxTrade, paymentMethods = [], baseDecimals }) {
    if (!['buy', 'sell'].includes(side))            return { error: 'side must be buy or sell' };
    if (!isOnChainAsset(baseAsset))                 return { error: `unsupported base asset: ${baseAsset}` };
    if (!isValidQuote(quoteCurrency))               return { error: `unsupported currency: ${quoteCurrency}` };
    if (baseAsset === quoteCurrency)                return { error: 'base and quote must differ' };
    if (!(pohAmount > 0))                           return { error: 'pohAmount must be positive' };
    if (!(pricePerPOH > 0))                         return { error: 'pricePerPOH must be positive' };
    // Atomic on-chain/on-chain swaps settle automatically — no external payment
    // rail is involved, so payment methods are waived for them.
    const atomic = isOnChainAsset(quoteCurrency);
    if (!atomic && (!Array.isArray(paymentMethods) || paymentMethods.length === 0)) {
      return { error: 'at least one payment method required' };
    }

    const now = Date.now();
    const divisor = baseDecimals != null ? 10 ** baseDecimals : (baseAsset === 'POH' ? 1e9 : 100);
    const order = {
      id: crypto.randomUUID(),
      maker,
      side,
      pohAmount,        // BASE amount in raw units of baseAsset (μPOH for POH; ×100 for stables). Field name kept for wire compat.
      ...(baseAsset !== 'POH' ? { baseAsset } : {}),   // omitted for POH — legacy orders unchanged
      quoteCurrency,
      pricePerPOH,      // quote units per 1 DISPLAY unit of baseAsset
      minTrade,         // min quote amount per trade
      maxTrade: maxTrade ?? ((pohAmount / divisor) * pricePerPOH),
      paymentMethods: atomic ? [] : paymentMethods,   // [{ network, address, details }]
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
      if (baseAsset && (o.baseAsset || 'POH') !== baseAsset) return false;
      if (maker && o.maker !== maker) return false;
      return true;
    }).sort((a, b) => b.createdAt - a.createdAt);
  }

  listMyOrders(address) {
    return Object.values(this.orders)
      .filter(o => o.maker === address)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // POH has no fixed/oracle price — the ONLY reference is the best open P2P order.
  // For one currency: best bid = highest a buyer will pay, best ask = lowest a seller
  // will take; `price` is the mid when both sides exist, else the single best order.
  _priceFor(quoteCurrency, baseAsset = 'POH') {
    const open = this.listOrders({ quoteCurrency, baseAsset, status: 'open' });
    const buys  = open.filter(o => o.side === 'buy').sort((a, b) => b.pricePerPOH - a.pricePerPOH);
    const sells = open.filter(o => o.side === 'sell').sort((a, b) => a.pricePerPOH - b.pricePerPOH);
    const bestBid = buys[0] || null;
    const bestAsk = sells[0] || null;
    if (!bestBid && !bestAsk) return { price: null, quoteCurrency, baseAsset, source: 'none' };
    const price = (bestBid && bestAsk) ? (bestBid.pricePerPOH + bestAsk.pricePerPOH) / 2
                : bestAsk ? bestAsk.pricePerPOH : bestBid.pricePerPOH;
    return {
      price,
      quoteCurrency,
      baseAsset,
      bestBid: bestBid && { price: bestBid.pricePerPOH, orderId: bestBid.id, pohAmount: bestBid.pohAmount },
      bestAsk: bestAsk && { price: bestAsk.pricePerPOH, orderId: bestAsk.id, pohAmount: bestAsk.pohAmount },
      source: 'p2p-best-order',
      asOf: Date.now(),
    };
  }

  // Reference price for a (baseAsset, quoteCurrency) pair, derived only from the
  // best open P2P order(s). Pass a currency for a single quote (base defaults to
  // POH), or omit for a per-currency map of everything quoted against the base.
  getReferencePrice(quoteCurrency = null, baseAsset = 'POH') {
    if (quoteCurrency) return this._priceFor(quoteCurrency, baseAsset);
    const out = {};
    for (const c of [...QUOTE_CURRENCIES, ...ONCHAIN_ASSETS]) {
      if (c === baseAsset) continue;
      const r = this._priceFor(c, baseAsset);
      if (r.price != null) out[c] = r;
    }
    return out;
  }

  _patchOrder(id, patch) {
    if (!this.orders[id]) return null;
    Object.assign(this.orders[id], patch, { updatedAt: Date.now() });
    this._saveOrders();
    return this.orders[id];
  }

  cancelOrder(id) {
    const o = this.orders[id];
    if (!o) return { error: 'order not found' };
    if (!['open', 'locked'].includes(o.status)) return { error: `cannot cancel: order is ${o.status}` };
    return { order: this._patchOrder(id, { status: 'cancelled', escrowLocked: false }) };
  }

  // ─── Trades ──────────────────────────────────────────────────────────────

  selectOrder(orderId, { taker, pohAmount, quoteAmount }) {
    const order = this.orders[orderId];
    if (!order)                       return { error: 'order not found' };
    if (order.status !== 'open')      return { error: `order is ${order.status}` };
    if (taker === order.maker)        return { error: 'cannot trade with yourself' };
    if (!(pohAmount > 0))             return { error: 'pohAmount must be positive' };
    if (!(quoteAmount > 0))           return { error: 'quoteAmount must be positive' };
    if (pohAmount > order.pohAmount)  return { error: 'pohAmount exceeds order size' };

    const now = Date.now();
    const trade = {
      id: crypto.randomUUID(),
      orderId,
      taker,
      pohAmount,
      quoteAmount,
      status: 'selected',
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
    if (!['selected', 'payment_sent'].includes(t.status)) return { error: `trade is ${t.status}` };
    this._patchTrade(tradeId, { status: 'completed' });
    this._patchOrder(t.orderId, { status: 'completed', escrowLocked: false, tradeId: null });
    return { trade: this.trades[tradeId] };
  }

  cancelTrade(tradeId) {
    const t = this.trades[tradeId];
    if (!t) return { error: 'trade not found' };
    if (t.status === 'completed') return { error: 'trade already completed' };
    if (t.status === 'payment_sent') return { error: 'cannot cancel after payment sent; open a dispute instead' };
    this._patchTrade(tradeId, { status: 'cancelled' });
    this._patchOrder(t.orderId, { status: 'open', tradeId: null, escrowLocked: false });
    return { trade: this.trades[tradeId] };
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
      if (trade.orderId && this.orders[trade.orderId]) {
        if (trade.status === 'completed') {
          this._patchOrder(trade.orderId, { status: 'completed', escrowLocked: false });
        } else if (trade.status === 'cancelled') {
          this._patchOrder(trade.orderId, { status: 'open', tradeId: null, escrowLocked: false });
        }
      }
    }
  }
}
