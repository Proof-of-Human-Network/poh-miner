/**
 * Bootnode write authentication — all state-changing bootnode endpoints require
 * a miner ed25519 signature bound to minerWallet.
 */

import crypto from 'crypto';
import { Wallet } from '../wallet/wallet.js';

export const WRITE_MAX_AGE_MS = 5 * 60 * 1000;

export function verifySignedPayload(payload, signedFields, { requireWalletBinding = false } = {}) {
  const { signature, signingPublicKey, minerWallet } = payload;
  if (!signature || !signingPublicKey || !minerWallet) {
    return { ok: false, error: 'signature, signingPublicKey, and minerWallet required' };
  }

  const ts = payload.ts ?? payload.timestamp ?? 0;
  if (!ts || Math.abs(Date.now() - ts) > WRITE_MAX_AGE_MS) {
    return { ok: false, error: 'timestamp required and must be within 5 minutes' };
  }

  if (requireWalletBinding && !Wallet.isAddressBoundToSigningKey(minerWallet, signingPublicKey)) {
    return { ok: false, error: 'wallet not bound to signing key' };
  }

  const body = {};
  for (const key of signedFields) {
    if (payload[key] !== undefined) body[key] = payload[key];
  }
  body.minerWallet = minerWallet;
  body.ts = ts;

  const msg = JSON.stringify(body);
  if (!Wallet.verifySignature(signingPublicKey, msg, signature)) {
    return { ok: false, error: 'invalid signature' };
  }

  return { ok: true };
}

export function verifyBrainEvent(event) {
  const { type, data, ts, minerWallet, eventHash, signature, signingPublicKey } = event;
  if (!type || !data || !eventHash) {
    return { ok: false, error: 'type, data, and eventHash required' };
  }
  if (!signature || !signingPublicKey || !minerWallet) {
    return { ok: false, error: 'signed brain event required' };
  }
  if (!ts || Math.abs(Date.now() - ts) > WRITE_MAX_AGE_MS) {
    return { ok: false, error: 'timestamp required and must be within 5 minutes' };
  }
  const canonical = JSON.stringify({ type, data, ts, minerWallet });
  const hash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24);
  if (hash !== eventHash) {
    return { ok: false, error: 'eventHash mismatch' };
  }
  if (!Wallet.verifySignature(signingPublicKey, canonical, signature)) {
    return { ok: false, error: 'invalid signature' };
  }
  return { ok: true };
}

export function verifyIpfsUpdate(data) {
  const { signature, signingPublicKey, minerWallet } = data;
  if (!signature || !signingPublicKey || !minerWallet) {
    return { ok: false, error: 'signature, signingPublicKey, and minerWallet required' };
  }
  const ts = data.ts ?? data.timestamp ?? 0;
  if (!ts || Math.abs(Date.now() - ts) > WRITE_MAX_AGE_MS) {
    return { ok: false, error: 'timestamp required and must be within 5 minutes' };
  }
  const body = {};
  for (const key of ['chain', 'brain', 'selfPeer']) {
    if (data[key] != null) body[key] = data[key];
  }
  body.minerWallet = minerWallet;
  body.ts = ts;
  if (!Wallet.verifySignature(signingPublicKey, JSON.stringify(body), signature)) {
    return { ok: false, error: 'invalid signature' };
  }
  return { ok: true };
}