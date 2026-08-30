/**
 * P2P escrow transitions — identity, auth, and gossip verification.
 *
 * A lock/release updates the originating node's RAM immediately, but the
 * canonical ledger only moves when a *block* carries the transition. Gossiping
 * the signed transition lets any miner include it, so a non-mining node still
 * gets its escrow onto the chain.
 *
 * Receivers must verify the user's signature. The originating API already
 * checked it; other miners do not have the user's wallet file, so verification
 * is signature + address-binding only (no local wallet lookup).
 */

import { Wallet } from '../wallet/wallet.js';

export const P2P_TRANSITION_TYPES = new Set([
  'p2p-order-created',
  'p2p-order-cancelled',
  'p2p-trade-created',
  'p2p-trade-payment-sent',
  'p2p-trade-release',
  'p2p-trade-cancel',
  'p2p-trade-dispute',
  'p2p-swap-filled',
]);

/** Stable id used for queue / ledger / RAM dedup. Matches miner `_appliedP2PIds`. */
export function p2pTransitionKey(t) {
  if (!t || typeof t.type !== 'string') return null;
  switch (t.type) {
    case 'p2p-order-created': return t.id ? `order-${t.id}` : null;
    case 'p2p-order-cancelled': return t.orderId ? `order-cancel-${t.orderId}` : null;
    case 'p2p-trade-created': return t.id ? `trade-${t.id}` : null;
    case 'p2p-trade-payment-sent': return t.tradeId ? `trade-${t.tradeId}-payment-sent` : null;
    case 'p2p-trade-release': return t.tradeId ? `trade-${t.tradeId}-release` : null;
    case 'p2p-trade-cancel': return t.tradeId ? `trade-${t.tradeId}-cancel` : null;
    case 'p2p-trade-dispute': return t.tradeId ? `trade-${t.tradeId}-dispute` : null;
    case 'p2p-swap-filled': return t.tradeId ? `swap-${t.tradeId}` : null;
    default: return null;
  }
}

/** Record the exact payload the API signed, so a peer can re-verify it. */
export function makeP2PAuth(body, payload) {
  if (!body?.signingPublicKey || !body?.signature || !payload) return null;
  return {
    signingPublicKey: body.signingPublicKey,
    signature: body.signature,
    payload: { ...payload },
  };
}

/**
 * Verify a gossiped P2P transition. Does not require the user's wallet file
 * to live on this node — only that the signature binds to the address.
 */
export function verifyGossipedP2PTransition(t) {
  if (!t || !P2P_TRANSITION_TYPES.has(t.type)) return { ok: false, reason: 'unknown type' };
  if (!p2pTransitionKey(t)) return { ok: false, reason: 'unkeyed' };
  const auth = t._auth;
  if (!auth?.signature || !auth?.signingPublicKey || !auth?.payload || typeof auth.payload !== 'object') {
    return { ok: false, reason: 'missing auth' };
  }
  const bound = Wallet.deriveAddressFromSigningKey(auth.signingPublicKey);
  if (!bound) return { ok: false, reason: 'invalid key' };
  const primary = JSON.stringify({ ...auth.payload, address: bound });
  if (Wallet.verifySignature(auth.signingPublicKey, primary, auth.signature)) {
    return { ok: true, address: bound };
  }
  const sent = auth.payload.address;
  if (sent && sent !== bound) {
    const alt = JSON.stringify({ ...auth.payload, address: sent });
    if (Wallet.verifySignature(auth.signingPublicKey, alt, auth.signature)) {
      return { ok: true, address: bound };
    }
  }
  return { ok: false, reason: 'invalid signature' };
}
