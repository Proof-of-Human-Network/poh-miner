/**
 * Chain Selection — longest (heaviest) chain rule.
 *
 * chainWork for a block = previous.chainWork + 2^difficulty
 * The canonical chain is always the one with the highest total chainWork.
 * This matches Bitcoin's heaviest-chain rule.
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

export function getTipChainWork(chain) {
  return chain.length ? (chain[chain.length - 1].chainWork || '0') : '0';
}
