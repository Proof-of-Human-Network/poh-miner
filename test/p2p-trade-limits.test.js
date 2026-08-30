import { describe, it, expect, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { OrderStore } from '../src/p2p/order-store.js';

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
