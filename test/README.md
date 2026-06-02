# Automated Tests for PoH Miner Network

This directory contains the automated test suite for the POH Miner Network.

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (recommended during development)
npm run test:watch
```

## Test Structure

- `wallet.test.js` — Tests for `Wallet` and `WalletManager` (balance, transfers, persistence)
- `job-queue.test.js` — Tests for job scoring, geo preference, load/reputation penalties
- `result-validator.test.js` — Tests for the work validation logic (signal coverage, methodsHash, etc.)

## Adding New Tests

1. Create a new file in `test/` ending with `.test.js`
2. Use Vitest's `describe` / `it` / `expect` API
3. Mock network-dependent modules when necessary (see `result-validator.test.js` for example)

## Integration / End-to-End Tests (Full Miner + Real Checker)

Located in `test/integration/`.

These tests are meant to exercise the **complete system**, including loading and running the real POH checker/brain from the sibling `dev/` directory (exactly as a production miner would).

### Running

```bash
yarn test:integration
```

The entry point is `run-integration.js`. It will automatically skip (with a message) if the real checker is not present.

This is the place to add the kind of extensive, "run full miner with checker" tests based on the README and Yellow Paper that you requested.

Current harness lives in `helpers.js`. You can expand `run-integration.js` with more scenarios (multi-miner racing, real result validation, block production with actual inference work, etc.).

## Philosophy

We prioritize testing the **pure logic** pieces that are critical for correctness and security:

- Wallet accounting
- Job routing / geo preference
- Result validation & anti-cheat rules
- Reputation mechanics

Heavy integration with the real POH brain (`dev/`) or live network calls are tested via the existing demo scripts (`scripts/demo-*.js`, `scripts/submit-test-job.js`) rather than unit tests.