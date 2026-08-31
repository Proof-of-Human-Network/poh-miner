/**
 * Basic Wallet for DAI Miner Network
 *
 * Simple account model for now (can evolve to UTXO later).
 * Supports:
 * - Wallet creation
 * - Balance tracking
 * - Sending / receiving DAI
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { sealWalletData, unsealWalletData } from '../security/wallet-crypto.js';
import { deriveEncryptionKeypair } from '../security/chat-crypto.js';

const WALLETS_DIR = path.join(os.homedir(), '.dai-miner', 'wallets');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Recompute a transaction's canonical hash from its own fields. Must exactly match
// DAITransaction._computeHash() (core/transaction.js) — not imported directly to avoid
// a circular import (transaction.js already imports Wallet from this module).
//
// A transaction's txHash must NEVER be trusted as given: a signature only proves the
// signer signed *some* hash string, not that the hash matches the amount/recipient
// actually being applied. Without recomputing and comparing, an attacker could replay
// any previously-seen valid (txHash, signature) pair from a sender — e.g. from a tiny,
// publicly visible past transfer — with a forged `to`/`amount` and drain the account.
// KEEP IN SYNC with DAITransaction._computeHash (src/core/transaction.js), the
// mobile wallet signer (dev/wallet/src/services/signing.js) and sdk signers.
// `currency` enters the preimage ONLY when set and !== 'DAI' — every historical
// DAI tx keeps its exact hash and signature validity.
export function computeTxFieldsHash(tx) {
  const payload = JSON.stringify({
    from: tx.from, to: tx.to, amount: tx.amount,
    fee: tx.fee, nonce: tx.nonce, timestamp: tx.timestamp, memo: tx.memo,
    ...(tx.currency && tx.currency !== 'DAI' ? { currency: tx.currency } : {}),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export class Wallet {
  constructor({ address, privateKey, publicKey, createdAt = Date.now(), signingPublicKey, signingPrivateKey, encryptionPublicKey, balance = 0, nonce = 0, assets = null }) {
    this.address = address;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.createdAt = createdAt;
    this.signingPublicKey = signingPublicKey || null;
    this.signingPrivateKey = signingPrivateKey || null;
    // Raw 32-byte X25519 public key (base64) used to encrypt public-job chat records
    // to this wallet. The matching private scalar is never stored — it's derived on
    // demand from signingPrivateKey (see getEncryptionPrivateKey), so it's exactly as
    // protected as the signing key. For externally-registered wallets we only hold
    // this public key (the owner registered it).
    this.encryptionPublicKey = encryptionPublicKey || null;
    this.balance = (typeof balance === 'number') ? balance : 0;
    // Transaction nonce — incremented each time a tx from this address is mined.
    // Prevents replay attacks: a valid tx must have nonce === account.nonce + 1.
    // ONE nonce sequence per address, shared across every asset.
    this.nonce = (typeof nonce === 'number') ? nonce : 0;
    // Per-asset balances in raw integer units (stablecoins, 2dp → ×100).
    // DAI stays in the legacy scalar `balance` (μDAI). Empty map ⇒ omitted from
    // toJSON/state root so DAI-only wallets keep their historical shape.
    this.assets = (assets && typeof assets === 'object') ? { ...assets } : {};
  }

  /** True when this wallet holds any non-DAI asset. */
  hasAssets() {
    return Object.keys(this.assets).some(t => this.assets[t] > 0);
  }

  /** Sorted-key copy of non-zero asset balances (deterministic for hashing). */
  sortedAssets() {
    const out = {};
    for (const t of Object.keys(this.assets).sort()) {
      if (this.assets[t] > 0) out[t] = this.assets[t];
    }
    return out;
  }

  static generate() {
    // Legacy entropy fields kept for wallet file compatibility; the canonical dai
    // address is always derived from the ed25519 signing public key.
    const privateKey = crypto.randomBytes(32).toString('hex');
    const publicKey = crypto.createHash('sha256').update(privateKey).digest('hex').slice(0, 64);

    const { publicKey: spkPem, privateKey: spr } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Store signingPublicKey as the RAW 32-byte ed25519 key in base64 (not PEM), so the
    // address derives identically on the desktop node and the mobile wallet (which uses
    // nacl raw keys). verifySignature() already accepts raw-base64 keys. This makes every
    // new wallet cross-device: the same key/seed imports into the phone as the same dai… address.
    const spk = Wallet.rawBase64FromPubKey(spkPem);
    const address = Wallet.deriveAddressFromSigningKey(spk);

    const wallet = new Wallet({
      address,
      privateKey,
      publicKey,
      signingPublicKey: spk,
      signingPrivateKey: spr,
    });
    wallet.ensureEncryptionKeys();
    return wallet;
  }

  /** Raw 32-byte ed25519 public key (base64) from a PEM/DER/KeyObject or raw-base64 input. */
  static rawBase64FromPubKey(pub) {
    if (typeof pub === 'string' && !pub.includes('BEGIN')) return pub; // already raw base64
    return crypto.createPublicKey(pub).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
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
      encryptionPublicKey: this.encryptionPublicKey,
      balance: this.balance,
      nonce: this.nonce,
      // Omitted entirely when empty so legacy DAI-only wallet files are unchanged.
      ...(this.hasAssets() ? { assets: this.sortedAssets() } : {}),
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
    this.signingPublicKey = Wallet.rawBase64FromPubKey(publicKey); // raw base64 = cross-device
    this.signingPrivateKey = privateKey;
  }

  /**
   * Ensure this wallet's X25519 encryption public key is set. Derived deterministically
   * from the signing private key, so it's reproducible and needs no separate storage.
   * No-op for externally-registered wallets that already carry a registered public key.
   */
  ensureEncryptionKeys() {
    if (this.encryptionPublicKey) return;
    if (!this.signingPrivateKey) return; // watch-only / externally-registered wallet
    this.ensureSigningKeys();
    this.encryptionPublicKey = deriveEncryptionKeypair(this.signingPrivateKey).publicKeyB64;
  }

  /**
   * The raw X25519 private scalar (base64) for opening chat records sealed to this
   * wallet. Derived on demand from the signing private key; null if this node does not
   * hold the signing key (i.e. it can't decrypt this wallet's private chats).
   */
  getEncryptionPrivateKey() {
    if (!this.signingPrivateKey) return null;
    return deriveEncryptionKeypair(this.signingPrivateKey).privateKeyB64;
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
   * Derive the canonical dai address bound to an ed25519 signing public key.
   * A key may only control the address derived from itself.
   */
  static deriveAddressFromSigningKey(signingPublicKey) {
    if (!signingPublicKey || typeof signingPublicKey !== 'string') return null;
    const normalized = signingPublicKey.trim().replace(/\r\n/g, '\n');
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    return 'dai' + hash.slice(0, 40);
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
    // Auto-upgrade old *local* wallets (created before signing keys existed) that
    // still hold a legacy privateKey. Must not mint keys for balance-only stubs —
    // P2P escrow (`dai_p2p_escrow`) and remote-miner caches have no keys on purpose.
    // Generating a keypair here rebinds the file to a random dai… address via
    // ensureCanonicalAddress, so the original path then reads as 0 and release fails
    // with "escrow insufficient: have 0".
    // A wallet with only a signingPublicKey is an externally-registered key
    // (see /api/wallet/register-key): never regenerate that either.
    if (!w.signingPublicKey && !w.signingPrivateKey && w.privateKey) {
      w.ensureSigningKeys();
      this.saveWallet(w);
    }
    // Migrate wallets created before the X25519 encryption subkey existed. Derives from
    // the signing private key we already hold — safe no-op for externally-registered keys.
    if (!w.encryptionPublicKey && w.signingPrivateKey) {
      w.ensureEncryptionKeys();
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
  // Read {balance, nonce} from a wallet file WITHOUT unsealing (scrypt) the keys.
  rawBalanceNonce(address) {
    const file = path.join(this.walletsDir, `${address}.json`);
    if (!fs.existsSync(file)) return { balance: 0, nonce: 0, assets: null };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { balance: raw.balance || 0, nonce: raw.nonce || 0, assets: raw.assets || null };
    } catch { return { balance: 0, nonce: 0, assets: null }; }
  }

  // Pass assets=undefined to leave the assets map untouched; an object (or null
  // to clear) replaces it. Assets ride the same plaintext fast path as balance.
  setBalanceNonceRaw(address, balance, nonce = null, assets = undefined) {
    const file = path.join(this.walletsDir, `${address}.json`);
    if (!fs.existsSync(file)) return false;
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
    const newNonce = nonce == null ? (raw.nonce || 0) : nonce;
    const newAssets = assets === undefined ? (raw.assets || null) : assets;
    const assetsChanged = JSON.stringify(raw.assets || null) !== JSON.stringify(newAssets || null);
    if ((raw.balance || 0) === balance && (raw.nonce || 0) === newNonce && !assetsChanged) return false; // no change → no write
    raw.balance = balance;
    raw.nonce = newNonce;
    if (newAssets && Object.keys(newAssets).length) raw.assets = newAssets;
    else delete raw.assets;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2));
    fs.renameSync(tmp, file);
    return true;
  }

  // ── Asset routing helpers ──────────────────────────────────────────────────
  // DAI lives in the legacy scalar `balance` (μDAI); every other currency in
  // wallet.assets[ticker] (raw integer units). One nonce covers all assets.
  static _isDai(currency) { return !currency || currency === 'DAI'; }

  static _getBal(wallet, currency) {
    if (WalletManager._isDai(currency)) return wallet.balance || 0;
    return (wallet.assets && wallet.assets[currency]) || 0;
  }

  static _setBal(wallet, currency, value) {
    if (WalletManager._isDai(currency)) { wallet.balance = value; return; }
    if (!wallet.assets) wallet.assets = {};
    if (value > 0) wallet.assets[currency] = value;
    else delete wallet.assets[currency];   // drop zero balances → toJSON omits empty maps
  }

  // Credit balance (used when receiving rewards or transfers)
  // Auto-creates a stub wallet file for the address if none exists (so remote workerIds or
  // alternate identity addresses like solana addrs used as daiWallet still get balances recorded).
  credit(address, amount, currency = 'DAI') {
    return this._withLock(address, () => {
      let wallet = this.loadWallet(address);
      if (!wallet) {
        wallet = new Wallet({ address, privateKey: null, publicKey: null, createdAt: Date.now() });
      }
      WalletManager._setBal(wallet, currency, WalletManager._getBal(wallet, currency) + amount);
      this.saveWallet(wallet);
      return true;
    });
  }

  // Debit balance (for sending)
  debit(address, amount, currency = 'DAI') {
    return this._withLock(address, () => {
      const wallet = this.loadWallet(address);
      if (!wallet || WalletManager._getBal(wallet, currency) < amount) return false;
      WalletManager._setBal(wallet, currency, WalletManager._getBal(wallet, currency) - amount);
      this.saveWallet(wallet);
      return true;
    });
  }

  // Atomically validate nonce + balance and debit + bump nonce in one step.
  // Used for off-chain job fee payments authorized by a nonce-bound signature
  // (see miner-node.js job payment verification) — prevents the same signed
  // payment proof from being replayed against a second job.
  debitWithNonce(address, amount, expectedNonce, currency = 'DAI') {
    return this._withLock(address, () => {
      const wallet = this.loadWallet(address);
      if (!wallet) return { error: 'wallet not found' };
      if ((wallet.nonce || 0) !== expectedNonce) {
        return { error: `nonce mismatch: expected ${wallet.nonce || 0}, got ${expectedNonce}` };
      }
      if (WalletManager._getBal(wallet, currency) < amount) return { error: 'insufficient balance' };
      WalletManager._setBal(wallet, currency, WalletManager._getBal(wallet, currency) - amount);
      wallet.nonce = (wallet.nonce || 0) + 1;
      this.saveWallet(wallet);
      return true;
    });
  }

  // Transfer between two local wallets (for testing / future full tx system)
  transfer(fromAddress, toAddress, amount, currency = 'DAI') {
    if (!this.debit(fromAddress, amount, currency)) return false;
    if (!this.credit(toAddress, amount, currency)) {
      this.credit(fromAddress, amount, currency);
      return false;
    }
    return true;
  }

  /** Per-asset balance (currency='DAI' → legacy μDAI scalar). */
  getAssetBalance(address, currency = 'DAI') {
    const w = this.loadWallet(address);
    return w ? WalletManager._getBal(w, currency) : 0;
  }

  /** All non-DAI holdings for an address: { ticker: rawInt } (empty when none). */
  getAssetBalances(address) {
    const { assets } = this.rawBalanceNonce(address);
    return assets || {};
  }

  // ── Nonce helpers ─────────────────────────────────────────────────────────
  getNonce(address) {
    const w = this.loadWallet(address);
    return w ? (w.nonce || 0) : 0;
  }

  // SHA-256 over sorted wallet states — deterministic fingerprint of account ledger
  getStateRoot() {
    // Read balance/nonce raw (no scrypt-unseal). This runs on EVERY block production
    // over every wallet file; going through loadWallet pinned the event loop at 100%
    // and froze the API. The hashed data (address/balance/nonce) is identical, so the
    // state-root value is unchanged — validators recompute the same hash.
    const entries = this.listWallets()
      .map(address => {
        const { balance, nonce, assets } = this.rawBalanceNonce(address);
        // `assets` key included ONLY when non-empty (sorted keys) — DAI-only
        // wallets serialize exactly as before, keeping historical roots stable.
        const held = assets && Object.keys(assets).filter(t => assets[t] > 0).sort();
        return (held && held.length)
          ? { address, balance, nonce, assets: Object.fromEntries(held.map(t => [t, assets[t]])) }
          : { address, balance, nonce };
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
    const txCur = (!tx.currency || tx.currency === 'DAI') ? 'DAI' : tx.currency;
    const total = tx.amount + (tx.fee || 0);
    if (WalletManager._getBal(sender, txCur) < total) return 'insufficient balance';
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

    WalletManager._setBal(sender, txCur, WalletManager._getBal(sender, txCur) - total);
    sender.nonce   += 1;
    this.saveWallet(sender);

    // Credit recipient synchronously — applyTransaction is already serialized per block
    let recipient = this.loadWallet(tx.to);
    if (!recipient) {
      recipient = new Wallet({ address: tx.to, privateKey: null, publicKey: null, createdAt: Date.now() });
    }
    WalletManager._setBal(recipient, txCur, WalletManager._getBal(recipient, txCur) + tx.amount);
    this.saveWallet(recipient);
    // Fee goes to block proposer — caller handles this separately (same currency as the tx)
    return true;
  }

  // Reverse a previously applied transaction (used during reorg — Fix 6)
  revertTransaction(tx, proposerAddress) {
    const txCur = (!tx.currency || tx.currency === 'DAI') ? 'DAI' : tx.currency;
    // Undo debit on sender
    const sender = this.loadWallet(tx.from);
    if (sender) {
      WalletManager._setBal(sender, txCur, WalletManager._getBal(sender, txCur) + tx.amount + (tx.fee || 0));
      sender.nonce   = Math.max(0, (sender.nonce || 1) - 1);
      this.saveWallet(sender);
    }
    // Undo credit on recipient (synchronous — paired with applyTransaction)
    const recipient = this.loadWallet(tx.to);
    if (recipient) {
      WalletManager._setBal(recipient, txCur, Math.max(0, WalletManager._getBal(recipient, txCur) - tx.amount));
      this.saveWallet(recipient);
    }
    // Undo fee credit on proposer (fee was paid in the tx currency)
    if (proposerAddress && tx.fee > 0) {
      const proposer = this.loadWallet(proposerAddress);
      if (proposer) {
        WalletManager._setBal(proposer, txCur, Math.max(0, WalletManager._getBal(proposer, txCur) - tx.fee));
        this.saveWallet(proposer);
      }
    }
  }
}
