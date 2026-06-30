/**
 * Wallet-at-rest encryption for private/signing keys.
 *
 * Key is created automatically on first run at ~/.poh-miner/.wallet-key
 * (mode 0600). Binary / Electron users never need to set an env var.
 * Optional POH_WALLET_KEY env overrides for advanced / portable setups.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ALGO = 'aes-256-gcm';
const SALT = 'poh-miner-wallet-v1';
const KEY_FILE = path.join(os.homedir(), '.poh-miner', '.wallet-key');

let _cachedKey = null;

/** Clear cached key after POH_WALLET_KEY changes (e.g. onboarding backup setup). */
export function resetKeyCache() {
  _cachedKey = null;
}

function ensureKeyDir() {
  const dir = path.dirname(KEY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Legacy key used before auto-generated key file (kept for decrypt migration). */
function legacyMachineKey() {
  return crypto.scryptSync(`${os.hostname()}:${os.homedir()}`, SALT, 32);
}

function loadOrCreateKey() {
  if (_cachedKey) return _cachedKey;

  const envKey = process.env.POH_WALLET_KEY;
  if (envKey && envKey.length >= 16) {
    _cachedKey = crypto.createHash('sha256').update(envKey).digest();
    return _cachedKey;
  }

  ensureKeyDir();
  if (fs.existsSync(KEY_FILE)) {
    _cachedKey = fs.readFileSync(KEY_FILE);
    if (_cachedKey.length >= 32) {
      _cachedKey = _cachedKey.subarray(0, 32);
      return _cachedKey;
    }
  }

  _cachedKey = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, _cachedKey, { mode: 0o600 });
  try { fs.chmodSync(KEY_FILE, 0o600); } catch { /* windows */ }
  return _cachedKey;
}

function decryptWithKey(blob, key) {
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const data = Buffer.from(blob.data, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function encryptField(plaintext) {
  if (!plaintext) return null;
  const key = loadOrCreateKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  };
}

export function decryptField(blob) {
  if (!blob || typeof blob !== 'object' || !blob.data) return null;
  for (const key of [loadOrCreateKey(), legacyMachineKey()]) {
    try {
      return decryptWithKey(blob, key);
    } catch { /* try next key */ }
  }
  return null;
}

export function sealWalletData(data) {
  const out = { ...data, encrypted: true };
  if (data.privateKey) out.privateKeyEnc = encryptField(data.privateKey);
  if (data.signingPrivateKey) out.signingPrivateKeyEnc = encryptField(data.signingPrivateKey);
  delete out.privateKey;
  delete out.signingPrivateKey;
  return out;
}

export function unsealWalletData(data) {
  if (!data) return data;
  const out = { ...data };
  if (data.encrypted) {
    if (data.privateKeyEnc) out.privateKey = decryptField(data.privateKeyEnc);
    if (data.signingPrivateKeyEnc) out.signingPrivateKey = decryptField(data.signingPrivateKeyEnc);
  }
  delete out.privateKeyEnc;
  delete out.signingPrivateKeyEnc;
  return out;
}