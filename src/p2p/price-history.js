import fs from 'fs';
import path from 'path';
import os from 'os';
import { ONCHAIN_ASSETS, QUOTE_CURRENCIES, pairId } from './order-store.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_PAIRS = 500;

function pairKey(baseAsset, quoteCurrency) {
  return pairId(baseAsset, quoteCurrency);
}

export class PriceHistory {
  constructor(dataDir) {
    const dir = dataDir || path.join(os.homedir(), '.poh-miner', 'p2p');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'price-history.json');
    this.pairs = this._load();
  }

  _load() {
    if (!fs.existsSync(this.file)) return {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return raw.pairs && typeof raw.pairs === 'object' ? raw.pairs : {};
    } catch {
      return {};
    }
  }

  _save() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ pairs: this.pairs }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[P2P] Failed to save price history:', e.message);
    }
  }

  _ensure(pair) {
    if (!this.pairs[pair]) this.pairs[pair] = { m1: [], h1: [], d1: [] };
    return this.pairs[pair];
  }

  _upsert(arr, t, price, bucketMs) {
    const bucket = Math.floor(t / bucketMs) * bucketMs;
    const last = arr[arr.length - 1];
    if (last && last.t === bucket) {
      last.h = Math.max(last.h, price);
      last.l = Math.min(last.l, price);
      last.c = price;
      last.n += 1;
      return;
    }
    arr.push({ t: bucket, o: price, h: price, l: price, c: price, n: 1 });
  }

  sample(orderStore) {
    if (!orderStore) return 0;
    const now = Date.now();
    let n = 0;
    const pairCount = Object.keys(this.pairs).length;
    for (const baseAsset of ONCHAIN_ASSETS) {
      for (const quoteCurrency of [...QUOTE_CURRENCIES, ...ONCHAIN_ASSETS]) {
        if (quoteCurrency === baseAsset) continue;
        const key = pairKey(baseAsset, quoteCurrency);
        if (!this.pairs[key] && pairCount + n >= MAX_PAIRS) continue;
        const ref = orderStore.getReferencePrice(quoteCurrency, baseAsset);
        if (ref == null || ref.price == null) continue;
        const rec = this._ensure(key);
        this._upsert(rec.m1, now, ref.price, MINUTE);
        this._upsert(rec.h1, now, ref.price, HOUR);
        this._upsert(rec.d1, now, ref.price, DAY);
        n += 1;
      }
    }
    this._prune(now);
    if (n > 0) this._save();
    return n;
  }

  _prune(now) {
    for (const key of Object.keys(this.pairs)) {
      const rec = this.pairs[key];
      rec.m1 = (rec.m1 || []).filter(c => now - c.t < DAY);
      rec.h1 = (rec.h1 || []).filter(c => now - c.t < 90 * DAY);
      rec.d1 = rec.d1 || [];
    }
  }

  candles(pair, interval = '1h', limit = 200) {
    const rec = this.pairs[pair];
    if (!rec) return [];
    const src = interval === '1m' ? rec.m1 : interval === '1d' ? rec.d1 : rec.h1;
    const cap = Math.min(Math.max(1, limit | 0), 1000);
    return (src || []).slice(-cap);
  }

  // Fraction change vs close ~24h ago. Null if we have no older sample.
  change24h(pair, currentPrice) {
    if (currentPrice == null || !Number.isFinite(Number(currentPrice))) return null;
    const rec = this.pairs[pair];
    if (!rec) return null;
    const ago = Date.now() - DAY;
    const series = (rec.h1 && rec.h1.length ? rec.h1 : rec.m1) || [];
    let older = null;
    for (const c of series) {
      if (c.t <= ago) older = c;
    }
    if (!older) return null;
    const prev = older.c;
    if (!(prev > 0)) return null;
    return (Number(currentPrice) - prev) / prev;
  }
}
