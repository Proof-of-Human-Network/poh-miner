/**
 * chat-crypto — portable public-job chat encryption.
 *
 * Public compute jobs are raced by miners the requester doesn't control, so the
 * on-chain record of the prompt and reply must be unreadable to everyone except
 * the requester. This module seals content to the requester's X25519 public key
 * with a versioned ECIES:
 *
 *     X25519 (ECDH) → HKDF-SHA256 → AES-256-GCM
 *
 * Every primitive is native in Node, WebCrypto (Electron/browser) and available on
 * React Native, so the wire envelope is byte-identical across the API, SDK, Electron
 * app and mobile wallet — no libsodium dependency. The envelope is self-describing:
 *
 *     { v:1, alg:'x25519-hkdf-sha256-aes256gcm', epk, iv, ct }   (all base64)
 *
 * Anyone may seal to a published public key; only the holder of the matching private
 * scalar can open. See CHAT-CRYPTO.md for the exact byte layout used by other clients.
 */

import crypto from 'crypto';

// RFC 8410 DER prefixes that wrap a raw 32-byte X25519 key so Node's KeyObject API
// can import it. Mobile/SDK clients that use raw-key libs (noble, tweetnacl) skip these.
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex'); // + 32-byte scalar
const SPKI_X25519  = Buffer.from('302a300506032b656e032100', 'hex');         // + 32-byte point
const HKDF_INFO    = Buffer.from('poh-chat-seal-v1');
const SCALAR_INFO  = Buffer.from('poh-x25519-v1');

export function scalarToPrivateKey(raw32) {
  return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw32]), format: 'der', type: 'pkcs8' });
}
export function rawToPublicKey(raw32) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_X25519, raw32]), format: 'der', type: 'spki' });
}
function rawPublicOf(keyObj) {
  const pub = keyObj.type === 'private' ? crypto.createPublicKey(keyObj) : keyObj;
  return pub.export({ type: 'spki', format: 'der' }).subarray(-32);
}

/**
 * Deterministically derive a wallet's X25519 encryption keypair from a stable secret
 * (the wallet's ed25519 signing private key). Deterministic so the key is never stored
 * separately — it's exactly as protected as the signing key and reproducible on any
 * client holding the same wallet. Returns { publicKeyB64, privateKeyB64 } (raw 32B each).
 */
export function deriveEncryptionKeypair(stableSecret) {
  const ikm = Buffer.isBuffer(stableSecret) ? stableSecret : Buffer.from(String(stableSecret));
  const scalar = Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), SCALAR_INFO, 32));
  const publicKey = rawPublicOf(scalarToPrivateKey(scalar));
  return { publicKeyB64: publicKey.toString('base64'), privateKeyB64: scalar.toString('base64') };
}

/**
 * Seal a plaintext (string or Buffer) to a recipient's raw X25519 public key (base64).
 * Returns a compact self-describing envelope. Anonymous: the recipient learns nothing
 * about the sender from the envelope.
 */
export function seal(recipientPubB64, plaintext) {
  const recipientPub = Buffer.from(recipientPubB64, 'base64');
  if (recipientPub.length !== 32) throw new Error('recipient X25519 pubkey must be 32 bytes');

  const eph    = crypto.generateKeyPairSync('x25519');
  const ephPub = rawPublicOf(eph.publicKey);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: rawToPublicKey(recipientPub) });
  // Salt binds the derived key to both endpoints (recipient + ephemeral pubkey).
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([recipientPub, ephPub]), HKDF_INFO, 32));

  const iv     = crypto.randomBytes(12);
  const pt     = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct     = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag    = cipher.getAuthTag();

  return {
    v: 1,
    alg: 'x25519-hkdf-sha256-aes256gcm',
    epk: ephPub.toString('base64'),
    iv:  iv.toString('base64'),
    ct:  Buffer.concat([ct, tag]).toString('base64'), // ciphertext || 16-byte GCM tag
  };
}

/** Open an envelope with the recipient's raw X25519 private scalar (base64). Returns utf8. */
export function open(envelope, privateKeyB64) {
  if (!envelope || envelope.v !== 1) throw new Error('unsupported chat-crypto envelope');
  const scalar       = Buffer.from(privateKeyB64, 'base64');
  const priv         = scalarToPrivateKey(scalar);
  const recipientPub = rawPublicOf(priv);
  const ephPub       = Buffer.from(envelope.epk, 'base64');
  const shared       = crypto.diffieHellman({ privateKey: priv, publicKey: rawToPublicKey(ephPub) });
  const key          = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([recipientPub, ephPub]), HKDF_INFO, 32));

  const iv       = Buffer.from(envelope.iv, 'base64');
  const blob     = Buffer.from(envelope.ct, 'base64');
  const tag      = blob.subarray(-16);
  const ct       = blob.subarray(0, -16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function sealJSON(recipientPubB64, obj) { return seal(recipientPubB64, JSON.stringify(obj)); }
export function openJSON(envelope, privateKeyB64) { return JSON.parse(open(envelope, privateKeyB64)); }

/** True if `x` looks like a chat-crypto envelope (vs cleartext). */
export function isEnvelope(x) {
  return !!x && typeof x === 'object' && x.v === 1 && typeof x.epk === 'string' && typeof x.ct === 'string';
}
