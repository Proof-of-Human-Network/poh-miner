/**
 * Bootnode write authentication — all state-changing bootnode endpoints require
 * a miner ed25519 signature bound to minerWallet.
 */

import crypto from 'crypto';
import { Wallet } from '../wallet/wallet.js';

export const WRITE_MAX_AGE_MS = 5 * 60 * 1000;
export const MAX_CHAIN_BLOCKS_RANGE = 500;
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_SUBMIT_BLOCK_BATCH = 200;

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

function isPrivateIPv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 0) return true;
  return false;
}

/** Returns true when host is suitable for public peer discovery. */
export function isPublicPeerHost(host, { allowLocal = false } = {}) {
  if (!host || typeof host !== 'string') return false;
  const h = host.trim().toLowerCase();
  if (BLOCKED_HOSTS.has(h)) return allowLocal;
  if (isPrivateIPv4(h)) return allowLocal;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return allowLocal;
  return h.length <= 253 && !/[\\/\s]/.test(h);
}

export function validatePeerPort(port) {
  const n = typeof port === 'number' ? port : parseInt(port, 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

export function buildPeerRegistrationMessage(peerInfo) {
  const ts = peerInfo.timestamp ?? peerInfo.ts ?? 0;
  const walletApiPort = peerInfo.walletApiPort ?? 3456;
  const p2pPort = peerInfo.p2pPort ?? null;
  const body = {
    wallet: peerInfo.wallet,
    host: peerInfo.host,
    timestamp: ts,
    methodsHash: peerInfo.methodsHash || '',
    walletApiPort,
    p2pPort,
  };
  // A follower (NAT'd) node signs an explicit reachable:false so it can't be
  // forged as directly dialable. Publicly-reachable peers keep the legacy
  // message shape (no reachable field) so their signatures stay compatible
  // with older miners and bootnodes.
  if (peerInfo.reachable === false) body.reachable = false;
  return JSON.stringify(body);
}

export function verifyPeerRegistration(peerInfo, { allowLocalHosts = false } = {}) {
  const { wallet, host, signature, signingPublicKey } = peerInfo;
  // Default true keeps legacy (pre-relay) registrations as public peers.
  const reachable = peerInfo.reachable !== false;
  if (!wallet) {
    return { ok: false, error: 'wallet is required' };
  }
  if (reachable && !host) {
    return { ok: false, error: 'wallet and host are required' };
  }
  if (!signature || !signingPublicKey) {
    return { ok: false, error: 'signature and signingPublicKey required' };
  }

  const ts = peerInfo.timestamp || 0;
  if (!ts || Math.abs(Date.now() - ts) > WRITE_MAX_AGE_MS) {
    return { ok: false, error: 'timestamp required and must be within 5 minutes' };
  }

  if (!Wallet.isAddressBoundToSigningKey(wallet, signingPublicKey)) {
    return { ok: false, error: 'wallet not bound to signing key' };
  }

  // A public peer must advertise a dialable host. A follower is reached via the
  // bootnode relay inbox instead, so it needs no publicly-reachable host.
  if (reachable && !isPublicPeerHost(host, { allowLocal: allowLocalHosts })) {
    return { ok: false, error: 'host must be a publicly reachable address' };
  }

  const walletApiPort = peerInfo.walletApiPort ?? 3456;
  const p2pPort = peerInfo.p2pPort ?? null;
  if (!validatePeerPort(walletApiPort)) {
    return { ok: false, error: 'invalid walletApiPort' };
  }
  if (p2pPort != null && !validatePeerPort(p2pPort)) {
    return { ok: false, error: 'invalid p2pPort' };
  }

  const msg = buildPeerRegistrationMessage({ ...peerInfo, timestamp: ts, walletApiPort, p2pPort });
  if (!Wallet.verifySignature(signingPublicKey, msg, signature)) {
    return { ok: false, error: 'invalid signature' };
  }

  return { ok: true, walletApiPort, p2pPort, ts, reachable };
}

export function verifySignedPayload(payload, signedFields, { requireWalletBinding = true } = {}) {
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
  if (!Wallet.isAddressBoundToSigningKey(minerWallet, signingPublicKey)) {
    return { ok: false, error: 'wallet not bound to signing key' };
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
  if (!Wallet.isAddressBoundToSigningKey(minerWallet, signingPublicKey)) {
    return { ok: false, error: 'wallet not bound to signing key' };
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

/** Read POST body with a hard byte cap (DoS protection). */
export function readLimitedBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    const onData = chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        req.removeListener('data', onData);
        req.destroy();
        reject(Object.assign(new Error('request body too large'), { code: 'BODY_TOO_LARGE' }));
        return;
      }
      body += chunk;
    };
    req.on('data', onData);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}