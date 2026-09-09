/**
 * The genesis treasury wallet must be usable from BOTH sides: the node signs
 * with it, and the same private key typed into the DAI Wallet app must land on
 * the same address. If those two derivations ever drift, the key silently
 * controls a different wallet than the one holding the funds.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { deriveFromPrivateKeyHex } from '../scripts/genesis/make-genesis-wallet.mjs';
import { Wallet } from '../src/wallet/wallet.js';

const nacl = createRequire(import.meta.url)('../scripts/vendor/nacl-fast.cjs');

/** The mobile wallet's derivation (src/services/wallet.js + signing.js). */
function phoneDerive(privateKeyHex) {
  const seedHex = crypto.createHash('sha256')
    .update(privateKeyHex + ':dai-ed25519-signing-v1').digest('hex');
  const kp = nacl.sign.keyPair.fromSeed(Uint8Array.from(Buffer.from(seedHex, 'hex')));
  const signingPublicKey = Buffer.from(kp.publicKey).toString('base64');
  return 'dai' + crypto.createHash('sha256').update(signingPublicKey).digest('hex').slice(0, 40);
}

const KEYS = ['11'.repeat(32), '00'.repeat(31) + '01', 'de'.repeat(32), crypto.randomBytes(32).toString('hex')];

describe('genesis wallet derivation', () => {
  it('derives the same address as the mobile wallet would', () => {
    for (const k of KEYS) {
      expect(deriveFromPrivateKeyHex(k).address, `key ${k.slice(0, 8)}…`).toBe(phoneDerive(k));
    }
  });

  it('agrees with the node address rule', () => {
    for (const k of KEYS) {
      const w = deriveFromPrivateKeyHex(k);
      expect(Wallet.deriveAddressFromSigningKey(w.signingPublicKey)).toBe(w.address);
      expect(Wallet.isAddressBoundToSigningKey(w.address, w.signingPublicKey)).toBe(true);
    }
  });

  it('produces a signing key the node can verify', () => {
    const w = deriveFromPrivateKeyHex(KEYS[0]);
    const sig = crypto.sign(null, Buffer.from('probe'), crypto.createPrivateKey(w.signingPrivateKey));
    expect(Wallet.verifySignature(w.signingPublicKey, 'probe', sig.toString('base64'))).toBe(true);
  });

  it('is deterministic', () => {
    expect(deriveFromPrivateKeyHex(KEYS[0]).address).toBe(deriveFromPrivateKeyHex(KEYS[0]).address);
  });
});
