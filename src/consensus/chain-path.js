/** Stable block id — prefer stored blockHash (set at mining time). */
export function blockId(block) {
  if (!block) return null;
  return block.blockHash || (typeof block.getHashSync === 'function' ? block.getHashSync() : null);
}

/** Walk the active tip path; return blocks for [from, to] in ascending height order. */
export function blocksOnTipPath(chain, from, to) {
  if (!chain?.length) return [];
  let cur = chain[chain.length - 1];
  const path = new Map();
  while (cur && cur.height >= from) {
    path.set(cur.height, cur);
    if (cur.height === 0) break;
    cur = chain.find(b => blockId(b) === cur.previousHash) ?? null;
  }
  const out = [];
  for (let h = from; h <= to; h++) {
    if (path.has(h)) out.push(path.get(h));
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