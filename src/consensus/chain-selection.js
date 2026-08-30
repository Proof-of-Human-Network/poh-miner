/**
 * Chain Selection — longest (heaviest) chain rule.
 *
 * chainWork for a block = previous.chainWork + 2^difficulty
 * The canonical chain is always the one with the highest total chainWork.
 * This matches Bitcoin's heaviest-chain rule.
 *
 * On equal work (the normal state of any same-height fork), the lower
 * block hash wins. That tie-break is arbitrary but deterministic, so every
 * node converges without waiting for the next block or trusting a signer.
 *
 * chainWork is stored as a hex string so it survives JSON serialisation
 * without precision loss (BigInt can be arbitrarily large).
 */

export function computeChainWork(prevChainWork, difficulty) {
  const prev = BigInt('0x' + (prevChainWork || '0'));
  const added = BigInt(2) ** BigInt(Math.max(0, difficulty));
  return (prev + added).toString(16);
}

// Compare two chainWork hex strings. Returns:
//  > 0  if a has more work than b
//  = 0  if equal
//  < 0  if b has more work
export function compareChainWork(a, b) {
  const wa = BigInt('0x' + (a || '0'));
  const wb = BigInt('0x' + (b || '0'));
  return wa > wb ? 1 : wa < wb ? -1 : 0;
}

/** Pull { chainWork, hash } from a block, a /chain/tip payload, or a pair. */
export function normalizeTip(x) {
  if (!x) return { chainWork: '0', hash: '' };
  const chainWork = x.chainWork || '0';
  let hash = x.hash || x.blockHash || '';
  if (!hash && typeof x.getHashSync === 'function') {
    try { hash = x.getHashSync(); } catch { /* ignore */ }
  }
  return { chainWork, hash: String(hash).toLowerCase() };
}

/**
 * Compare two chain tips. Returns:
 *   > 0  if a should be preferred over b
 *   = 0  if they are the same, or equal work with no hashes to break the tie
 *   < 0  if b should be preferred over a
 *
 * Heavier chainWork wins. On equal work, the lower block hash wins.
 */
export function compareChains(a, b) {
  const ta = normalizeTip(a);
  const tb = normalizeTip(b);
  const workCmp = compareChainWork(ta.chainWork, tb.chainWork);
  if (workCmp !== 0) return workCmp;
  if (!ta.hash || !tb.hash) return 0;
  if (ta.hash === tb.hash) return 0;
  return ta.hash < tb.hash ? 1 : -1;
}

export function getTipChainWork(chain) {
  return chain.length ? (chain[chain.length - 1].chainWork || '0') : '0';
}
