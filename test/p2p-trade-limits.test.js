import { describe, it, expect, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { OrderStore, quotePayoutAddress } from '../src/p2p/order-store.js';

/** A maker's advertised min/max are a control, not a hint — the node must hold them. */
describe('P2P trade limits', () => {
  let store;
  const base = { maker: 'daiMAKER', side: 'sell', daiAmount: 10e9, quoteCurrency: 'USDT-ERC20',
                 pricePerDAI: 10, paymentMethods: [{ network: 'erc20', address: '0x1' }] };
  // 10 DAI at 10 USDT/DAI = 100 USDT of value.

  beforeEach(() => {
    store = new OrderStore(fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-limits-')));
  });

  describe('creating an order', () => {
    it('rejects a minimum above the maximum', () => {
      const r = store.createOrder({ ...base, minTrade: 50, maxTrade: 20 });
      expect(r.error).toMatch(/minTrade .* cannot exceed maxTrade/);
    });

    it('rejects a maximum larger than the order can settle', () => {
      const r = store.createOrder({ ...base, minTrade: 1, maxTrade: 500 });
      expect(r.error).toMatch(/exceeds the order's total value/);
    });

    it('rejects a negative minimum and a non-positive maximum', () => {
      expect(store.createOrder({ ...base, minTrade: -1, maxTrade: 50 }).error).toBeTruthy();
      expect(store.createOrder({ ...base, minTrade: 0, maxTrade: 0 }).error).toBeTruthy();
    });

    it('accepts coherent limits and defaults max to the full order value', () => {
      expect(store.createOrder({ ...base, minTrade: 10, maxTrade: 50 }).order.maxTrade).toBe(50);
      const dflt = store.createOrder({ ...base, minTrade: 10 }).order;
      expect(dflt.maxTrade).toBeCloseTo(100, 6);   // must not be rejected by float slack
    });
  });

  describe('taking an order', () => {
    let orderId;
    beforeEach(() => {
      orderId = store.createOrder({ ...base, minTrade: 20, maxTrade: 60 }).order.id;
    });

    const take = (quoteAmount) =>
      store.selectOrder(orderId, { taker: 'daiTAKER', daiAmount: 1e9, quoteAmount });

    it('refuses an amount below the minimum', () => {
      expect(take(19.99).error).toMatch(/below the minimum trade of 20/);
    });

    it('refuses an amount above the maximum', () => {
      expect(take(60.01).error).toMatch(/above the maximum trade of 60/);
    });

    it('accepts the boundaries themselves', () => {
      expect(store.selectOrder(orderId, { taker: 'daiT1', daiAmount: 1e9, quoteAmount: 20 }).trade).toBeTruthy();
      const id2 = store.createOrder({ ...base, minTrade: 20, maxTrade: 60 }).order.id;
      expect(store.selectOrder(id2, { taker: 'daiT2', daiAmount: 1e9, quoteAmount: 60 }).trade).toBeTruthy();
    });

    it('accepts an amount inside the range', () => {
      expect(take(40).trade).toBeTruthy();
    });
  });
});

describe('P2P partial fills', () => {
  let store;
  const base = { maker: 'daiMAKER', side: 'sell', daiAmount: 100_000_000, quoteCurrency: 'USDT-ERC20',
                 pricePerDAI: 100, minTrade: 1, maxTrade: 10, paymentMethods: [{ network: 'erc20', address: '0x1' }] };
  // 0.1 DAI at 100 USDT/DAI = 10 USDT of value.

  beforeEach(() => {
    store = new OrderStore(fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-partial-')));
  });

  it('keeps leftover size open after a smaller take is released', () => {
    const { order } = store.createOrder(base);
    const { trade } = store.selectOrder(order.id, { taker: 'daiTAKER', daiAmount: 20_000_000, quoteAmount: 2 });
    expect(store.getOrder(order.id).status).toBe('locked');
    const done = store.completeTrade(trade.id);
    expect(done.trade.status).toBe('completed');
    const left = store.getOrder(order.id);
    expect(left.status).toBe('open');
    expect(left.daiAmount).toBe(80_000_000);
    expect(left.escrowLocked).toBe(true);
    expect(left.tradeId).toBeNull();
    expect(left.maxTrade).toBeCloseTo(8, 6);
  });

  it('closes the order only when the last slice is filled', () => {
    const { order } = store.createOrder(base);
    const a = store.selectOrder(order.id, { taker: 'daiT1', daiAmount: 20_000_000, quoteAmount: 2 }).trade;
    store.completeTrade(a.id);
    const b = store.selectOrder(order.id, { taker: 'daiT2', daiAmount: 80_000_000, quoteAmount: 8 }).trade;
    store.completeTrade(b.id);
    expect(store.getOrder(order.id).status).toBe('completed');
    expect(store.getOrder(order.id).daiAmount).toBe(0);
  });

  it('does not subtract twice when completeTrade is called again', () => {
    const { order } = store.createOrder(base);
    const { trade } = store.selectOrder(order.id, { taker: 'daiTAKER', daiAmount: 20_000_000, quoteAmount: 2 });
    store.completeTrade(trade.id);
    store.completeTrade(trade.id);
    expect(store.getOrder(order.id).daiAmount).toBe(80_000_000);
  });

  it('reopens a sell take-cancel without clearing escrowLocked', () => {
    const { order } = store.createOrder({ ...base, escrowLocked: true });
    store._patchOrder(order.id, { escrowLocked: true });
    const { trade } = store.selectOrder(order.id, { taker: 'daiTAKER', daiAmount: 20_000_000, quoteAmount: 2 });
    store.cancelTrade(trade.id);
    const left = store.getOrder(order.id);
    expect(left.status).toBe('open');
    expect(left.daiAmount).toBe(100_000_000);
    expect(left.escrowLocked).toBe(true);
  });

  it('does not mark the whole order completed from trade gossip', () => {
    const { order } = store.createOrder(base);
    const { trade } = store.selectOrder(order.id, { taker: 'daiTAKER', daiAmount: 20_000_000, quoteAmount: 2 });
    store.completeTrade(trade.id);
    const leftover = store.getOrder(order.id);
    store.ingestGossipTrade({ ...store.getTrade(trade.id), updatedAt: Date.now() + 1000 });
    expect(store.getOrder(order.id).status).toBe('open');
    expect(store.getOrder(order.id).daiAmount).toBe(leftover.daiAmount);
  });
});

describe('on-chain quote payout address', () => {
  let store;
  const payout = 'dai' + 'a'.repeat(40);
  const other  = 'dai' + 'b'.repeat(40);
  const atomic = {
    maker: 'daiMAKER', side: 'sell', daiAmount: 100_000_000,
    quoteCurrency: 'KGST', pricePerDAI: 1, minTrade: 0.01, maxTrade: 0.1,
  };

  beforeEach(() => {
    store = new OrderStore(fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-payout-')));
  });

  it('quotePayoutAddress returns the first dai… method, then maker', () => {
    expect(quotePayoutAddress({
      maker: 'daiMAKER',
      paymentMethods: [
        { network: 'USDT-TRC20', address: 'Txyz' },
        { network: 'KGST', address: payout },
      ],
    })).toBe(payout);
    expect(quotePayoutAddress({
      maker: 'daiMAKER',
      paymentMethods: [payout],
    })).toBe(payout);
    expect(quotePayoutAddress({ maker: 'daiMAKER', paymentMethods: [] })).toBe('daiMAKER');
    expect(quotePayoutAddress({ paymentMethods: [{ address: '  ' + other + '  ' }] })).toBe(other);
  });

  it('rejects an on-chain quote with no payment method', () => {
    expect(store.createOrder({ ...atomic, paymentMethods: [] }).error)
      .toMatch(/at least one payment method required/);
  });

  it('rejects an on-chain quote whose method is not a dai… address', () => {
    const r = store.createOrder({
      ...atomic,
      paymentMethods: [{ network: 'USDT-TRC20', address: 'Txyz' }],
    });
    expect(r.error).toMatch(/on-chain payment method must be a dai/);
  });

  it('keeps the dai… payout on an accepted on-chain sell', () => {
    const { order, error } = store.createOrder({
      ...atomic,
      paymentMethods: [{ network: 'KGST', address: payout }],
    });
    expect(error).toBeUndefined();
    expect(order.paymentMethods).toEqual([{ network: 'KGST', address: payout }]);
    expect(quotePayoutAddress(order)).toBe(payout);
  });
});
