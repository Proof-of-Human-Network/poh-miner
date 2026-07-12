import { describe, it, expect } from 'vitest';
import { PohBlock } from '../src/core/block.js';
import { blockHashOf, blockHashInput } from '../src/consensus/block-hash.js';
import { replayChainLedger } from '../src/consensus/tx-ledger.js';
import { buildMigrationGenesis, buildAllocations } from '../src/consensus/genesis.js';

// Fixture snapshot: a few balances, two with non-zero nonces.
const snapshot = {
  snapshotHash: 'deadbeef',
  balances: {
    poh0000000000000000000000000000000000000001: { balance: 450_000_000_000, nonce: 0 },
    poh0000000000000000000000000000000000000002: { balance: 1_500_000_000, nonce: 3 },
    poh0000000000000000000000000000000000000003: { balance: 999, nonce: 1 },
    pohzerozerozerozerozerozerozerozerozerozero1: { balance: 0, nonce: 0 }, // dropped (no state)
  },
};
const expectedTotal = 450_000_000_000 + 1_500_000_000 + 999;

describe('genesis migration', () => {
  it('builds a deterministic, sorted allocation set (drops empty accounts)', () => {
    const allocs = buildAllocations(snapshot.balances);
    expect(allocs.map(a => a.address)).toEqual([...allocs.map(a => a.address)].sort());
    expect(allocs).toHaveLength(3); // the zero-balance/zero-nonce account is dropped
    expect(allocs.reduce((s, a) => s + a.balance, 0)).toBe(expectedTotal);
  });

  it('replays balances AND nonces exactly, conserving supply', () => {
    const { genesis, total, count } = buildMigrationGenesis(snapshot, { difficulty: 4 });
    expect(total).toBe(expectedTotal);
    expect(count).toBe(3);

    const ledger = replayChainLedger([genesis]);
    expect(ledger.getBalance('poh0000000000000000000000000000000000000001')).toBe(450_000_000_000);
    expect(ledger.getBalance('poh0000000000000000000000000000000000000002')).toBe(1_500_000_000);
    expect(ledger.getNonce('poh0000000000000000000000000000000000000002')).toBe(3);
    expect(ledger.getNonce('poh0000000000000000000000000000000000000003')).toBe(1);

    const inv = ledger.checkSupplyInvariant();
    expect(inv.ok).toBe(true);                 // sum(balances) + dust === totalMinted
    expect(inv.totalMinted).toBe(expectedTotal);
    expect(ledger.coinbaseDust).toBe(0);
  });

  it('gives the migrated genesis a NEW hash but leaves ordinary blocks unchanged', () => {
    const { genesis } = buildMigrationGenesis(snapshot, { difficulty: 4 });

    // Same genesis params, no allocations → the legacy identity.
    const bare = new PohBlock({
      height: 0, previousHash: '0'.repeat(64), timestamp: genesis.timestamp,
      minerWallet: genesis.minerWallet, difficulty: 4,
    });
    expect(blockHashOf(genesis)).not.toBe(blockHashOf(bare)); // fresh chain identity

    // A normal block must hash exactly as before — no genesisAllocations key leaks in.
    const normal = new PohBlock({ height: 5, previousHash: 'ab'.repeat(32), timestamp: 1, minerWallet: 'm', difficulty: 4 });
    expect(blockHashInput(normal)).not.toContain('genesisAllocations');
  });

  it('round-trips through toJSON/fromJSON preserving allocations and hash', () => {
    const { genesis } = buildMigrationGenesis(snapshot, { difficulty: 4 });
    const revived = PohBlock.fromJSON(JSON.parse(JSON.stringify(genesis.toJSON())));
    expect(revived.genesisAllocations).toHaveLength(3);
    expect(blockHashOf(revived)).toBe(blockHashOf(genesis)); // hash survives serialization
  });

  it('is deterministic — same snapshot → same genesis hash', () => {
    const a = buildMigrationGenesis(snapshot, { difficulty: 4 }).genesis;
    const b = buildMigrationGenesis(snapshot, { difficulty: 4 }).genesis;
    expect(blockHashOf(a)).toBe(blockHashOf(b));
  });
});
