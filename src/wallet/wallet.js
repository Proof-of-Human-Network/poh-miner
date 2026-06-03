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
  constructor({ address, privateKey, publicKey, createdAt = Date.now(), signingPublicKey, signingPrivateKey, balance = 0, nonce = 0 }) {
    this.address = address;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.createdAt = createdAt;
    this.signingPublicKey = signingPublicKey || null;
    this.signingPrivateKey = signingPrivateKey || null;
    this.balance = (typeof balance === 'number') ? balance : 0;
    // Transaction nonce — incremented each time a tx from this address is mined.
    // Prevents replay attacks: a valid tx must have nonce === account.nonce + 1.
    this.nonce = (typeof nonce === 'number') ? nonce : 0;
  }

  static generate() {
    // Very simple key generation for MVP (NOT production secure)
    const privateKey = crypto.randomBytes(32).toString('hex');
    const publicKey = crypto.createHash('sha256').update(privateKey).digest('hex').slice(0, 64);
    const address = 'poh' + publicKey.slice(0, 40); // fake address format

    // Generate real ed25519 signing keypair for node registration proof + future result sigs
    const { publicKey: spk, privateKey: spr } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const w = new Wallet({
      address,
      privateKey,
      publicKey,
    });
    w.signingPublicKey = spk;
    w.signingPrivateKey = spr;
    return w;
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
      signingPublicKey: this.signingPublicKey,
      signingPrivateKey: this.signingPrivateKey,
      balance: this.balance,
      nonce: this.nonce,
    };
  }

  /**
   * Ensure this wallet has an ed25519 signing keypair (for register proof etc).
   * If missing (upgrading old wallet file), generate + caller should save.
   */
  ensureSigningKeys() {
    if (this.signingPublicKey && this.signingPrivateKey) return;
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    this.signingPublicKey = publicKey;
    this.signingPrivateKey = privateKey;
  }

  /**
   * Sign arbitrary data (stringified if object). Returns base64 signature.
   */
  sign(data) {
    this.ensureSigningKeys();
    const msg = Buffer.isBuffer(data) ? data : Buffer.from(
      typeof data === 'string' ? data : JSON.stringify(data)
    );
    const sig = crypto.sign(null, msg, this.signingPrivateKey);
    return sig.toString('base64');
  }

  /**
   * Verify a signature produced by a Wallet.sign using the provided public PEM.
   */
  static verifySignature(publicKeyPem, data, signatureBase64) {
    try {
      const msg = Buffer.isBuffer(data) ? data : Buffer.from(
        typeof data === 'string' ? data : JSON.stringify(data)
      );
      const sig = Buffer.from(signatureBase64, 'base64');
      return crypto.verify(null, msg, publicKeyPem, sig);
    } catch (e) {
      return false;
    }
  }
}

export class WalletManager {
  constructor(walletsDir) {
    this.walletsDir = walletsDir || WALLETS_DIR;
    ensureDir(this.walletsDir);
  }

  createWallet() {
    const wallet = Wallet.generate();
    this.saveWallet(wallet);
    return wallet;
  }

  saveWallet(wallet) {
    const file = path.join(this.walletsDir, `${wallet.address}.json`);
    fs.writeFileSync(file, JSON.stringify(wallet.toJSON(), null, 2));
    return file;
  }

  loadWallet(address) {
    const file = path.join(this.walletsDir, `${address}.json`);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const w = Wallet.fromJSON(data);
    // Auto-upgrade old wallets to have signing keys (for register protection etc)
    if (!w.signingPublicKey || !w.signingPrivateKey) {
      w.ensureSigningKeys();
      this.saveWallet(w);
    }
    return w;
  }

  listWallets() {
    if (!fs.existsSync(this.walletsDir)) return [];
    return fs.readdirSync(this.walletsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  getBalance(address) {
    const wallet = this.loadWallet(address);
    return wallet ? (wallet.balance || 0) : 0;
  }

  // Credit balance (used when receiving rewards or transfers)
  // Auto-creates a stub wallet file for the address if none exists (so remote workerIds or
  // alternate identity addresses like solana addrs used as pohWallet still get balances recorded).
  credit(address, amount) {
    let wallet = this.loadWallet(address);
    if (!wallet) {
      // Create a minimal stub so this address can hold balance/rewards.
      // (Real signing keys etc. not needed for pure balance accounting.)
      wallet = new Wallet({
        address: address,
        privateKey: null,
        publicKey: null,
        createdAt: Date.now(),
      });
      // Note: this will be saved below after balance update.
    }
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
      this.credit(fromAddress, amount);
      return false;
    }
    return true;
  }

  // ── Nonce helpers ─────────────────────────────────────────────────────────
  getNonce(address) {
    const w = this.loadWallet(address);
    return w ? (w.nonce || 0) : 0;
  }

  // Apply a signed transaction: validate nonce + balance, then mutate state.
  // Returns true on success, or an error string on failure.
  applyTransaction(tx) {
    const sender = this.loadWallet(tx.from);
    if (!sender) return 'sender not found';
    if ((sender.nonce || 0) + 1 !== tx.nonce) {
      return `nonce mismatch: expected ${sender.nonce + 1}, got ${tx.nonce}`;
    }
    const total = tx.amount + (tx.fee || 0);
    if ((sender.balance || 0) < total) return 'insufficient balance';
    // Verify signature against the sender's STORED public key — not the key
    // claimed inside the transaction. This prevents an attacker from signing
    // with their own key while claiming to spend from someone else's address.
    if (!tx.signature) return 'invalid signature';
    if (!sender.signingPublicKey) return 'sender has no registered signing key';
    if (tx.signingPublicKey && tx.signingPublicKey !== sender.signingPublicKey) {
      return 'invalid signature';
    }
    if (!Wallet.verifySignature(sender.signingPublicKey, tx.txHash, tx.signature)) {
      return 'invalid signature';
    }

    sender.balance -= total;
    sender.nonce   += 1;
    this.saveWallet(sender);

    // Credit recipient (auto-create if missing)
    this.credit(tx.to, tx.amount);
    // Fee goes to block proposer — caller handles this separately
    return true;
  }

  // Reverse a previously applied transaction (used during reorg — Fix 6)
  revertTransaction(tx, proposerAddress) {
    // Undo debit on sender
    const sender = this.loadWallet(tx.from);
    if (sender) {
      sender.balance = (sender.balance || 0) + tx.amount + (tx.fee || 0);
      sender.nonce   = Math.max(0, (sender.nonce || 1) - 1);
      this.saveWallet(sender);
    }
    // Undo credit on recipient
    this.debit(tx.to, tx.amount);
    // Undo fee credit on proposer
    if (proposerAddress && tx.fee > 0) this.debit(proposerAddress, tx.fee);
  }
}
