import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const REFERRAL_FEE_BPS = 30; // 0.3% per completed trade

export class ReferralStore {
  constructor(dataDir) {
    const dir = dataDir || path.join(os.homedir(), '.poh-miner', 'p2p');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'referrals.json');
    this.data = this._load();
  }

  _load() {
    if (!fs.existsSync(this.file)) return { codes: {}, referred: {}, stats: {} };
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { codes: {}, referred: {}, stats: {} }; }
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
    const existing = Object.entries(this.data.codes).find(([, owner]) => owner === address);
    if (existing) return existing[0];
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    this.data.codes[code] = address;
    this._save();
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

  // Compute and record referral fee; returns µPOH credited (0 if no referrer or below min)
  creditFee(referrer, pohAmount) {
    const fee = Math.floor((pohAmount * REFERRAL_FEE_BPS) / 10000);
    if (fee <= 0) return 0;
    this._recordFeeStats(referrer, fee);
    return fee;
  }

  // Record a pre-computed fee (used during block replay to avoid double-computation)
  recordFee(referrer, fee) {
    if (!referrer || fee <= 0) return;
    this._recordFeeStats(referrer, fee);
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
