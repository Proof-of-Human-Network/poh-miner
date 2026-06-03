# Tests

## Running

```bash
npm test                   # all unit tests (vitest)
npm run test:watch         # watch mode
npm run test:integration   # integration tests (requires dev/ checker)
```

## Unit Tests

| File | Tests | What's covered |
|---|---|---|
| `blockchain.test.js` | 49 | All 6 blockchain fixes + job deduplication + block integrity |
| `wallet.test.js` | 2 | Wallet generation, JSON round-trip |
| `job-queue.test.js` | — | Job scoring, geo preference, reputation |
| `result-validator.test.js` | — | Signal coverage, methodsHash consensus, work validation |

### blockchain.test.js suites

| Suite | Tests | What |
|---|---|---|
| Fix 1 — P2P Gossip | 5 | Local delivery, dedup by ID, TTL relay, path loop prevention |
| Fix 2 — Signatures | 5 | Block sign/verify, result sign/verify, tamper detection, wrong-key rejection |
| Fix 3 — chainWork | 4 | BigInt accumulation, ordering, empty chain, difficulty scaling |
| Fix 4 — Transactions & Double-Spend | 9 | Apply, nonce replay, double-spend mempool lock, forgery rejection, dedup, lock release, sequential nonces, deterministic hash, revert |
| Fix 5 — Proof of Work | 8 | Nonce found, leading zeros, AbortSignal, pre-aborted, difficulty adjust up/down, hash determinism |
| Fix 6 — Balance Journal | 6 | Record, entry pruning, disk persistence, balance reversal, idempotent rollback |
| Job deduplication | 6 | minedRequestIds, pendingValidResults filter, post-compute drop, proposeBlock guard, populate from block, queue-time dedup |
| Block integrity | 3 | JSON round-trip, field change changes hash, async == sync hash |

Each test uses isolated temp directories — no interference with `~/.poh-miner`.

## Integration Tests (`test/integration/`)

Exercise the complete system with the real dev/ checker + brain:

```bash
RUN_INTEGRATION=1 npm run test:integration
```

Skips automatically if `dev/` is not present.

## Adding Tests

Tests use **vitest** with ESM. Use dynamic `import()` inside each `it()` to keep module caches isolated:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import fs from 'fs';

describe('My feature', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(os.tmpdir() + '/poh-test-'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('does something', async () => {
    const { MyClass } = await import('../src/my-module.js');
    expect(new MyClass()).toBeDefined();
  });
});
```
