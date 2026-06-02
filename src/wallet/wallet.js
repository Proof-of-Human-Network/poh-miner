/**
 * Basic Wallet for PoH Miner Network
 *
 * Simple account model for now (can evolve to UTXO later).
 * Supports:
 * - Wallet creation
 * - Balance tracking
 * - Sending / receiving POH
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const WALLETS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.poh-miner', 'wallets');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class Wallet {
  constructor({ address, privateKey, publicKey, createdAt = Date.now() }) {
    this.address = address;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.createdAt = createdAt;
    this.balance = 0; // in smallest units (we'll treat 1 POH = 1_000_000 units later)
  }

  static generate() {
    // Very simple key generation for MVP (NOT production secure)
    const privateKey = crypto.randomBytes(32).toString('hex');
    const publicKey = crypto.createHash('sha256').update(privateKey).digest('hex').slice(0, 64);
    const address = 'poh' + publicKey.slice(0, 40); // fake address format

    return new Wallet({
      address,
      privateKey,
      publicKey,
    });
  }

  static fromJSON(data) {
    return new Wallet(data);
  }

  toJSON() {
    return {
      address: this.address,
      privateKey: this.privateKey,
      publicKey: this.publicKey,
      createdAt: this.createdAt,
    };
  }
}

export class WalletManager {
  constructor() {
    ensureDir(WALLETS_DIR);
  }

  createWallet() {
    const wallet = Wallet.generate();
    this.saveWallet(wallet);
    return wallet;
  }

  saveWallet(wallet) {
    const file = path.join(WALLETS_DIR, `${wallet.address}.json`);
    fs.writeFileSync(file, JSON.stringify(wallet.toJSON(), null, 2));
    return file;
  }

  loadWallet(address) {
    const file = path.join(WALLETS_DIR, `${address}.json`);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Wallet.fromJSON(data);
  }

  listWallets() {
    if (!fs.existsSync(WALLETS_DIR)) return [];
    return fs.readdirSync(WALLETS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  getBalance(address) {
    const wallet = this.loadWallet(address);
    return wallet ? (wallet.balance || 0) : 0;
  }

  // Credit balance (used when receiving rewards or transfers)
  credit(address, amount) {
    const wallet = this.loadWallet(address);
    if (!wallet) return false;
    wallet.balance = (wallet.balance || 0) + amount;
    this.saveWallet(wallet);
    return true;
  }

  // Debit balance (for sending)
  debit(address, amount) {
    const wallet = this.loadWallet(address);
    if (!wallet || (wallet.balance || 0) < amount) return false;
    wallet.balance = (wallet.balance || 0) - amount;
    this.saveWallet(wallet);
    return true;
  }

  // Transfer between two local wallets (for testing / future full tx system)
  transfer(fromAddress, toAddress, amount) {
    if (!this.debit(fromAddress, amount)) return false;
    if (!this.credit(toAddress, amount)) {
      // Rollback if credit fails (shouldn't happen for local wallets)
      this.credit(fromAddress, amount);
      return false;
    }
    return true;
  }
}
