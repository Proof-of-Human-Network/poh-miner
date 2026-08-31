import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

export const REFERRAL_FEE_BPS = 30; // 0.3% per completed trade

/** Same code on every node — gossip only needs to carry the referred-by map. */
export function referralCodeFor(address) {
  return crypto.createHash('sha256').update(`dai-p2p-ref:${address}`).digest('hex').slice(0, 8).toUpperCase();
}

export class ReferralStore {
  constructor(dataDir) {
    const dir = dataDir || path.join(os.homedir(), '.dai-miner', 'p2p');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'referrals.json');
    this.data = this._load();
  }

  _load() {
    const empty = { codes: {}, referred: {}, stats: {}, credited: {} };
    if (!fs.existsSync(this.file)) return empty;
    try { return { ...empty, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch { return empty; }
  }

  _save() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('[P2P Referral] save failed:', e.message); }
  }

  // Get or create a referral code for an address (deterministic per address)
  getCode(address) {
    const code = referralCodeFor(address);
    if (this.data.codes[code] !== address) {
      this.data.codes[code] = address;
      this._save();
    }
    return code;
  }

  resolveCode(code) {
    return this.data.codes[(code || '').toUpperCase()] || null;
  }

  // Bind an address to a referrer via referral code (one-time per address)
  applyReferral(address, code) {
    if (this.data.referred[address]) return { error: 'already has a referrer' };
    const referrer = this.resolveCode(code);
    if (!referrer) return { error: 'invalid referral code' };
    if (referrer === address) return { error: 'cannot refer yourself' };
    this.data.referred[address] = referrer;
    this._save();
    return { referrer };
  }

  getReferrer(address) {
    return this.data.referred[address] || null;
  }

  /**
   * Who earns the 0.3%. Prefer the DAI *buyer's* referrer (they received the
   * coins); fall back to the seller's so a code entered on create-order still
   * pays. One referrer per trade — never 0.6%.
   */
  referrerForTrade({ buyer, seller } = {}) {
    return this.getReferrer(buyer) || this.getReferrer(seller) || null;
  }

  // Bind from gossip (already validated on the origin). No-op if set.
  applyReferralFromGossip(address, referrer) {
    if (!address || !referrer || address === referrer) return { error: 'invalid' };
    if (this.data.referred[address]) return { referrer: this.data.referred[address] };
    this.data.referred[address] = referrer;
    this._save();
    return { referrer };
  }

  // Compute and record referral fee; returns µDAI credited (0 if no referrer or below min)
  creditFee(referrer, daiAmount, tradeId = null) {
    if (tradeId && this.data.credited?.[tradeId] != null) return this.data.credited[tradeId];
    const fee = Math.floor((daiAmount * REFERRAL_FEE_BPS) / 10000);
    if (fee <= 0) return 0;
    this._recordFeeStats(referrer, fee);
    if (tradeId) {
      this.data.credited = this.data.credited || {};
      this.data.credited[tradeId] = fee;
      this._save();
    }
    return fee;
  }

  // Record a pre-computed fee (used during block replay to avoid double-computation)
  recordFee(referrer, fee, tradeId = null) {
    if (!referrer || fee <= 0) return;
    if (tradeId && this.data.credited?.[tradeId] != null) return;
    this._recordFeeStats(referrer, fee);
    if (tradeId) {
      this.data.credited = this.data.credited || {};
      this.data.credited[tradeId] = fee;
      this._save();
    }
  }

  _recordFeeStats(referrer, fee) {
    if (!this.data.stats[referrer]) this.data.stats[referrer] = { tradeCount: 0, earnedFees: 0 };
    this.data.stats[referrer].tradeCount += 1;
    this.data.stats[referrer].earnedFees += fee;
    this._save();
  }

  getStats(address) {
    const code = this.getCode(address);
    const referredAddresses = Object.entries(this.data.referred)
      .filter(([, ref]) => ref === address)
      .map(([addr]) => addr);
    return {
      code,
      referredCount: referredAddresses.length,
      earnedFees: this.data.stats[address]?.earnedFees || 0,
      tradeCount: this.data.stats[address]?.tradeCount || 0,
      referredBy: this.data.referred[address] || null,
    };
  }
}
