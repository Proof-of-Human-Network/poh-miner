/**
 * Finality — rolling checkpoints + max-reorg-depth.
 *
 * A pure-SHA256 PoW chain accepts whatever fork carries the most cumulative work.
 * On a small network that means an attacker with enough hashrate (a single
 * SHA-256 ASIC dwarfs a handful of CPU/GPU miners) can mine a heavier *private*
 * chain that forks far back and, on release, silently rewrites confirmed history
 * — a deep double-spend.
 *
 * Finality closes this off with two independent rules, applied at every chain-
 * replacement choke point (reorgTo + the full-resync path):
 *
 *  1) Max-reorg-depth (local, no infra): once a node holds a chain of at least
 *     FINALITY_DEPTH blocks, it refuses to rewrite anything buried deeper than
 *     FINALITY_DEPTH below its own tip. A synced node can therefore never be made
 *     to abandon its deep history, regardless of how much work an attacker shows.
 *     Fresh/short nodes are exempt so bootstrap-from-genesis still works.
 *
 *  2) Signed checkpoint (anchored, trusted bootnode): the bootnode signs its
 *     finalized tip (tip - FINALITY_DEPTH). Nodes pin the bootnode's key, fetch
 *     the checkpoint, and refuse to adopt any chain that does not contain the
 *     checkpointed block at its height. This protects even a freshly-started or
 *     eclipsed node — which has no deep history of its own to defend — from being
 *     fed a forged history that omits the finalized block.
 *
 * Rule 1 needs nothing new and is the high-leverage core; rule 2 layers a trust
 * anchor on top and degrades gracefully (skipped when no checkpoint is known).
 */

import { Wallet } from '../wallet/wallet.js';

/**
 * Blocks buried deeper than this below the tip are FINAL. At the 60 s block
 * cadence, 100 ≈ ~100 minutes of confirmations. Override with POH_FINALITY_DEPTH.
 */
export const FINALITY_DEPTH = (() => {
  const n = parseInt(process.env.POH_FINALITY_DEPTH || '', 10);
  return Number.isInteger(n) && n > 0 ? n : 100;
})();

/** Canonical bytes a checkpoint signature covers. */
export function checkpointMessage({ height, hash }) {
  return JSON.stringify({ kind: 'poh-checkpoint', height, hash });
}

/** Sign a finalized (height, hash) with a Wallet. Returns the wire checkpoint. */
export function signCheckpoint(wallet, { height, hash }) {
  const signature = wallet.sign(checkpointMessage({ height, hash }));
  return {
    height,
    hash,
    timestamp: Date.now(),
    signingPublicKey: wallet.signingPublicKey,
    signature,
  };
}

/**
 * Verify a checkpoint's signature and, when a key is pinned, that it was signed
 * by that exact key. Returns { ok, reason? }.
 */
export function verifyCheckpoint(cp, { pinnedPublicKey = null } = {}) {
  if (!cp || typeof cp.height !== 'number' || !cp.hash || !cp.signature || !cp.signingPublicKey) {
    return { ok: false, reason: 'malformed checkpoint' };
  }
  if (pinnedPublicKey) {
    // Accept either the short poh… address (log-friendly to pin) or the full PEM.
    const pin = String(pinnedPublicKey).trim();
    const matches = pin.startsWith('poh')
      ? Wallet.deriveAddressFromSigningKey(cp.signingPublicKey) === pin
      : cp.signingPublicKey.trim() === pin;
    if (!matches) return { ok: false, reason: 'checkpoint not signed by pinned key' };
  }
  const ok = Wallet.verifySignature(
    cp.signingPublicKey,
    checkpointMessage({ height: cp.height, hash: cp.hash }),
    cp.signature,
  );
  return ok ? { ok: true } : { ok: false, reason: 'invalid checkpoint signature' };
}

/**
 * Decide whether a chain replacement that keeps blocks up to `forkHeight` and
 * rewrites forkHeight+1 … localTipHeight is permitted by the max-reorg-depth rule.
 *
 *  - `forkHeight` is the height of the last block KEPT; -1 = replace from genesis.
 *  - Fresh/short nodes (tip below finalityDepth) are never constrained.
 *  - A reorg deeper than finalityDepth below the local tip is refused.
 *  - `allowDeep` (operator recovery escape hatch) bypasses the rule.
 *
 * Note: simply being *behind* and appending new blocks is not a reorg
 * (forkHeight === localTipHeight → depth 0), so catch-up is always allowed.
 */
export function evaluateReorg({
  localTipHeight,
  forkHeight,
  finalityDepth = FINALITY_DEPTH,
  allowDeep = false,
}) {
  if (allowDeep) return { allowed: true, reason: 'deep reorg explicitly allowed (POH_ALLOW_DEEP_REORG)' };

  const kept = typeof forkHeight === 'number' ? forkHeight : -1;

  if (localTipHeight >= finalityDepth) {
    const depth = localTipHeight - kept; // blocks rewritten
    if (depth > finalityDepth) {
      return {
        allowed: false,
        reason: `reorg depth ${depth} exceeds finality depth ${finalityDepth} ` +
                `(local tip #${localTipHeight}, fork keeps up to #${kept})`,
      };
    }
  }
  return { allowed: true };
}

/**
 * True if `blocks` does not contradict a finalized checkpoint: either the block
 * set does not reach the checkpoint height (still catching up — no conflict yet),
 * or it contains a block at that height whose hash matches. A block set that
 * spans the checkpoint height with a DIFFERENT hash there is a forged/forked
 * history and must be rejected.
 *
 * `hashOf(block)` extracts a block's hash (caller supplies it so this stays pure).
 */
export function chainHonorsCheckpoint(blocks, checkpoint, hashOf) {
  if (!checkpoint || typeof checkpoint.height !== 'number' || !checkpoint.hash) return true;
  if (!Array.isArray(blocks) || blocks.length === 0) return true;
  const at = blocks.find(b => (b?.height ?? -1) === checkpoint.height);
  if (!at) return true; // checkpoint height not covered by this segment — no conflict
  return hashOf(at) === checkpoint.hash;
}
