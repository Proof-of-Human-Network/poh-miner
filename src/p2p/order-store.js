import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

export const QUOTE_CURRENCIES = [
  'USDT-ERC20', 'USDT-TRC20', 'USDT-TON', 'USDT-SOL', 'USDT-BEP20',
  'USDC-ERC20', 'BTC', 'ETH', 'SOL',
];

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

  createOrder({ maker, side, pohAmount, quoteCurrency, pricePerPOH, minTrade = 0, maxTrade, paymentMethods = [] }) {
    if (!['buy', 'sell'].includes(side))            return { error: 'side must be buy or sell' };
    if (!QUOTE_CURRENCIES.includes(quoteCurrency))  return { error: `unsupported currency: ${quoteCurrency}` };
    if (!(pohAmount > 0))                           return { error: 'pohAmount must be positive' };
    if (!(pricePerPOH > 0))                         return { error: 'pricePerPOH must be positive' };
    if (!Array.isArray(paymentMethods) || paymentMethods.length === 0) {
      return { error: 'at least one payment method required' };
    }

    const now = Date.now();
    const order = {
      id: crypto.randomUUID(),
      maker,
      side,
      pohAmount,        // μPOH
      quoteCurrency,
      pricePerPOH,      // price per 1 display POH in quoteCurrency
      minTrade,         // min quote amount per trade
      maxTrade: maxTrade ?? ((pohAmount / 1e9) * pricePerPOH),
      paymentMethods,   // [{ network, address, details }]
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

  listOrders({ side, quoteCurrency, maker, status } = {}) {
    const now = Date.now();
    return Object.values(this.orders).filter(o => {
      const effectiveStatus = status || 'open';
      if (effectiveStatus === 'open' && o.expiresAt < now && o.status === 'open') return false;
      if (o.status !== effectiveStatus) return false;
      if (side && o.side !== side) return false;
      if (quoteCurrency && o.quoteCurrency !== quoteCurrency) return false;
      if (maker && o.maker !== maker) return false;
      return true;
    }).sort((a, b) => b.createdAt - a.createdAt);
  }

  listMyOrders(address) {
    return Object.values(this.orders)
      .filter(o => o.maker === address)
      .sort((a, b) => b.createdAt - a.createdAt);
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
