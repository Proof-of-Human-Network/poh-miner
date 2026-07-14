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
import os from 'os';
import { sealWalletData, unsealWalletData } from '../security/wallet-crypto.js';

const WALLETS_DIR = path.join(os.homedir(), '.poh-miner', 'wallets');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Recompute a transaction's canonical hash from its own fields. Must exactly match
// PoHTransaction._computeHash() (core/transaction.js) — not imported directly to avoid
// a circular import (transaction.js already imports Wallet from this module).
//
// A transaction's txHash must NEVER be trusted as given: a signature only proves the
// signer signed *some* hash string, not that the hash matches the amount/recipient
// actually being applied. Without recomputing and comparing, an attacker could replay
// any previously-seen valid (txHash, signature) pair from a sender — e.g. from a tiny,
// publicly visible past transfer — with a forged `to`/`amount` and drain the account.
export function computeTxFieldsHash(tx) {
  const payload = JSON.stringify({
    from: tx.from, to: tx.to, amount: tx.amount,
    fee: tx.fee, nonce: tx.nonce, timestamp: tx.timestamp, memo: tx.memo,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
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
    // Legacy entropy fields kept for wallet file compatibility; the canonical poh
    // address is always derived from the ed25519 signing public key.
    const privateKey = crypto.randomBytes(32).toString('hex');
    const publicKey = crypto.createHash('sha256').update(privateKey).digest('hex').slice(0, 64);

    const { publicKey: spk, privateKey: spr } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const address = Wallet.deriveAddressFromSigningKey(spk);

    return new Wallet({
      address,
      privateKey,
      publicKey,
      signingPublicKey: spk,
      signingPrivateKey: spr,
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
   * Verify a signature produced by a Wallet.sign.
   * Accepts a PEM string OR a raw 32-byte ed25519 public key in base64.
   */
  /**
   * Derive the canonical poh address bound to an ed25519 signing public key.
   * A key may only control the address derived from itself.
   */
  static deriveAddressFromSigningKey(signingPublicKey) {
    if (!signingPublicKey || typeof signingPublicKey !== 'string') return null;
    const normalized = signingPublicKey.trim().replace(/\r\n/g, '\n');
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    return 'poh' + hash.slice(0, 40);
  }

  static isAddressBoundToSigningKey(address, signingPublicKey) {
    return address === Wallet.deriveAddressFromSigningKey(signingPublicKey);
  }

  static verifySignature(publicKeyPem, data, signatureBase64) {
    try {
      const msg = Buffer.isBuffer(data) ? data : Buffer.from(
        typeof data === 'string' ? data : JSON.stringify(data)
      );
      const sig = Buffer.from(signatureBase64, 'base64');
      let key = publicKeyPem;
      // If it's a raw base64 public key (32 bytes = 44 base64 chars, no PEM header)
      if (typeof publicKeyPem === 'string' && !publicKeyPem.startsWith('-----')) {
        const rawBytes = Buffer.from(publicKeyPem, 'base64');
        // Wrap in ed25519 SPKI DER and import as KeyObject
        const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
        const der = Buffer.concat([SPKI_PREFIX, rawBytes]);
        key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
      }
      return crypto.verify(null, msg, key, sig);
    } catch (e) {
      return false;
    }
  }
}

export class WalletManager {
  constructor(walletsDir) {
    this.walletsDir = walletsDir || WALLETS_DIR;
    ensureDir(this.walletsDir);
    this._locks = new Map(); // address → Promise chain (per-address mutex)
  }

  // Serialize all read-modify-write ops per address to prevent concurrent double-spend.
  _withLock(address, fn) {
    const prev = this._locks.get(address) || Promise.resolve();
    const next = prev.then(fn).catch(() => {});
    this._locks.set(address, next);
    return next;
  }

  createWallet() {
    const wallet = Wallet.generate();
    this.saveWallet(wallet);
    return wallet;
  }

  /**
   * Migrate a legacy wallet whose display address was not derived from its signing
   * public key. Merges balance into the canonical file and removes the old path.
   * Returns the wallet object (possibly with a new address).
   */
  ensureCanonicalAddress(wallet) {
    if (!wallet?.signingPublicKey) return wallet;
    const canonical = Wallet.deriveAddressFromSigningKey(wallet.signingPublicKey);
    if (!canonical || wallet.address === canonical) return wallet;

    const oldAddress = wallet.address;
    wallet.address = canonical;

    const canonicalPath = path.join(this.walletsDir, `${canonical}.json`);
    const oldPath = path.join(this.walletsDir, `${oldAddress}.json`);

    if (fs.existsSync(canonicalPath)) {
      const raw = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
      const existing = Wallet.fromJSON(unsealWalletData(raw));
      existing.balance = (existing.balance || 0) + (wallet.balance || 0);
      existing.nonce = Math.max(existing.nonce || 0, wallet.nonce || 0);
      if (wallet.signingPrivateKey && !existing.signingPrivateKey) {
        existing.signingPrivateKey = wallet.signingPrivateKey;
        existing.signingPublicKey = wallet.signingPublicKey;
        existing.privateKey = wallet.privateKey || existing.privateKey;
        existing.publicKey = wallet.publicKey || existing.publicKey;
      } else if (!existing.signingPublicKey) {
        existing.signingPublicKey = wallet.signingPublicKey;
      }
      this.saveWallet(existing);
      wallet = existing;
    } else {
      this.saveWallet(wallet);
    }

    if (oldAddress !== canonical && fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch { /* ignore */ }
    }

    console.log(`[WalletManager] Migrated wallet ${oldAddress} → ${canonical}`);
    return wallet;
  }

  saveWallet(wallet) {
    const file = path.join(this.walletsDir, `${wallet.address}.json`);
    const tmp  = file + '.tmp';
    const sealed = sealWalletData(wallet.toJSON());
    fs.writeFileSync(tmp, JSON.stringify(sealed, null, 2));
    fs.renameSync(tmp, file);
    return file;
  }

  /** Resolve a wallet by address and/or signing public key (handles legacy address migration). */
  resolveWallet(address, signingPublicKey = null) {
    if (address) {
      const w = this.loadWallet(address);
      if (w) {
        if (!signingPublicKey || w.signingPublicKey === signingPublicKey) return w;
        const canonical = Wallet.deriveAddressFromSigningKey(signingPublicKey);
        if (canonical && w.address === canonical) return w;
      }
    }
    if (signingPublicKey) {
      const canonical = Wallet.deriveAddressFromSigningKey(signingPublicKey);
      if (canonical) {
        const w = this.loadWallet(canonical);
        if (w) return w;
      }
      for (const addr of this.listWallets()) {
        const w = this.loadWallet(addr);
        if (w?.signingPublicKey === signingPublicKey) return w;
      }
    }
    return null;
  }

  loadWallet(address) {
    const file = path.join(this.walletsDir, `${address}.json`);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const data = unsealWalletData(raw);
    const w = Wallet.fromJSON(data);
    // Auto-upgrade old local wallets (created before signing keys existed, so they're
    // missing BOTH halves) to have a signing keypair. Must check both — a wallet with
    // only a signingPublicKey is an externally registered key (see /api/wallet/register-key):
    // the node never holds that private key by design, so regenerating here would silently
    // overwrite the registered public key and break signature verification for that wallet.
    if (!w.signingPublicKey && !w.signingPrivateKey) {
      w.ensureSigningKeys();
      this.saveWallet(w);
    }
    return this.ensureCanonicalAddress(w);
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

  // Cheap existence check — no unseal.
  walletExists(address) {
    return fs.existsSync(path.join(this.walletsDir, `${address}.json`));
  }

  // Update ONLY the plaintext balance/nonce fields of a sealed wallet file, WITHOUT
  // unsealing (scrypt-decrypting) the keys. The balance rebuild touches thousands of
  // wallets; routing that through loadWallet runs scrypt per wallet and pins the event
  // loop at 100% for minutes (frozen HTTP API). balance/nonce live top-level in plaintext
  // (sealWalletData only encrypts the key fields), so they can be edited in place.
  // Returns true if the file changed. Pass nonce=null to leave nonce untouched.
  setBalanceNonceRaw(address, balance, nonce = null) {
    const file = path.join(this.walletsDir, `${address}.json`);
    if (!fs.existsSync(file)) return false;
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
    const newNonce = nonce == null ? (raw.nonce || 0) : nonce;
    if ((raw.balance || 0) === balance && (raw.nonce || 0) === newNonce) return false; // no change → no write
    raw.balance = balance;
    raw.nonce = newNonce;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2));
    fs.renameSync(tmp, file);
    return true;
  }

  // Credit balance (used when receiving rewards or transfers)
  // Auto-creates a stub wallet file for the address if none exists (so remote workerIds or
  // alternate identity addresses like solana addrs used as pohWallet still get balances recorded).
  credit(address, amount) {
    return this._withLock(address, () => {
      let wallet = this.loadWallet(address);
      if (!wallet) {
        wallet = new Wallet({ address, privateKey: null, publicKey: null, createdAt: Date.now() });
      }
      wallet.balance = (wallet.balance || 0) + amount;
      this.saveWallet(wallet);
      return true;
    });
  }

  // Debit balance (for sending)
  debit(address, amount) {
    return this._withLock(address, () => {
      const wallet = this.loadWallet(address);
      if (!wallet || (wallet.balance || 0) < amount) return false;
      wallet.balance = (wallet.balance || 0) - amount;
      this.saveWallet(wallet);
      return true;
    });
  }

  // Atomically validate nonce + balance and debit + bump nonce in one step.
  // Used for off-chain job fee payments authorized by a nonce-bound signature
  // (see miner-node.js job payment verification) — prevents the same signed
  // payment proof from being replayed against a second job.
  debitWithNonce(address, amount, expectedNonce) {
    return this._withLock(address, () => {
      const wallet = this.loadWallet(address);
      if (!wallet) return { error: 'wallet not found' };
      if ((wallet.nonce || 0) !== expectedNonce) {
        return { error: `nonce mismatch: expected ${wallet.nonce || 0}, got ${expectedNonce}` };
      }
      if ((wallet.balance || 0) < amount) return { error: 'insufficient balance' };
      wallet.balance -= amount;
      wallet.nonce = (wallet.nonce || 0) + 1;
      this.saveWallet(wallet);
      return true;
    });
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

  // SHA-256 over sorted wallet states — deterministic fingerprint of account ledger
  getStateRoot() {
    const entries = this.listWallets()
      .map(address => {
        const w = this.loadWallet(address);
        return { address, balance: w?.balance || 0, nonce: w?.nonce || 0 };
      })
      .sort((a, b) => a.address.localeCompare(b.address));
    return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  }

  // Apply a signed transaction: validate nonce + balance, then mutate state.
  // Returns true on success, or an error string on failure.
  applyTransaction(tx) {
    const sender = this.loadWallet(tx.from);
    if (!sender) return 'sender not found';
    if ((sender.nonce || 0) + 1 !== tx.nonce) {
      return `nonce mismatch: expected ${sender.nonce + 1}, got ${tx.nonce}`;
    }
    if (!tx.txHash || tx.txHash !== computeTxFieldsHash(tx)) {
      return 'txHash does not match transaction fields';
    }
    const total = tx.amount + (tx.fee || 0);
    if ((sender.balance || 0) < total) return 'insufficient balance';
    // Verify signature against the sender's STORED public key — not the key
    // claimed inside the transaction. This prevents an attacker from signing
    // with their own key while claiming to spend from someone else's address.
    if (!tx.signature) return 'invalid signature';
    if (!sender.signingPublicKey) {
      // Key not yet registered — auto-register only when address is cryptographically
      // bound to the signing key (prevents remote key substitution on stub wallets).
      if (!tx.signingPublicKey) return 'sender has no registered signing key';
      if (!Wallet.isAddressBoundToSigningKey(tx.from, tx.signingPublicKey)) {
        return 'address does not match signing public key';
      }
      if (!Wallet.verifySignature(tx.signingPublicKey, tx.txHash, tx.signature)) {
        return 'invalid signature';
      }
      sender.signingPublicKey = tx.signingPublicKey;
    } else {
      if (tx.signingPublicKey && tx.signingPublicKey !== sender.signingPublicKey) {
        return 'invalid signature';
      }
      if (!Wallet.verifySignature(sender.signingPublicKey, tx.txHash, tx.signature)) {
        return 'invalid signature';
      }
    }

    sender.balance -= total;
    sender.nonce   += 1;
    this.saveWallet(sender);

    // Credit recipient synchronously — applyTransaction is already serialized per block
    let recipient = this.loadWallet(tx.to);
    if (!recipient) {
      recipient = new Wallet({ address: tx.to, privateKey: null, publicKey: null, createdAt: Date.now() });
    }
    recipient.balance = (recipient.balance || 0) + tx.amount;
    this.saveWallet(recipient);
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
    // Undo credit on recipient (synchronous — paired with applyTransaction)
    const recipient = this.loadWallet(tx.to);
    if (recipient) {
      recipient.balance = Math.max(0, (recipient.balance || 0) - tx.amount);
      this.saveWallet(recipient);
    }
    // Undo fee credit on proposer
    if (proposerAddress && tx.fee > 0) {
      const proposer = this.loadWallet(proposerAddress);
      if (proposer) {
        proposer.balance = Math.max(0, (proposer.balance || 0) - tx.fee);
        this.saveWallet(proposer);
      }
    }
  }
}
