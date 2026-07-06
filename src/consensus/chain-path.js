/** Stable block id — prefer stored blockHash (set at mining time). */
export function blockId(block) {
  if (!block) return null;
  return block.blockHash || (typeof block.getHashSync === 'function' ? block.getHashSync() : null);
}

/** Return blocks for [from, to] in ascending height order.
 *  Uses O(1) height-indexed lookup — the chain array is sequential. */
export function blocksOnTipPath(chain, from, to) {
  if (!chain?.length) return [];
  const offset = chain[0]?.height ?? 0;
  const out = [];
  for (let h = from; h <= to; h++) {
    const idx = h - offset;
    const block = (idx >= 0 && idx < chain.length && chain[idx]?.height === h)
      ? chain[idx]
      : chain.find(b => b.height === h);
    if (block) out.push(block);
  }
  return out;
}

/**
 * When a peer returns >1 block at the same height (stale fork entries in their array),
 * prefer the parent of block height+1 on the peer's tip branch.
 */
export function selectPeerBlockOnTip(rawBlocks, height, PohBlockCtor) {
  if (!rawBlocks?.length) return null;
  const atHeight = rawBlocks.filter(b => b.height === height);
  if (atHeight.length <= 1) return atHeight[0] ?? rawBlocks[0];
  const child = rawBlocks.find(b => b.height === height + 1);
  if (child?.previousHash) {
    for (const b of atHeight) {
      const parsed = b instanceof PohBlockCtor ? b : (PohBlockCtor.fromJSON ? PohBlockCtor.fromJSON(b) : new PohBlockCtor(b));
      if (blockId(parsed) === child.previousHash) return b;
    }
  }
  return atHeight[atHeight.length - 1];
}