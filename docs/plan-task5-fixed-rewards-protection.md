# Task 5 Plan: Fixed 1 POH per Block + Work Validation & Slashing

## Goal
Implement a simple, fixed-reward blockchain for the PoH Miner Network while adding strong protections against lazy or malicious miners.

## Core Decisions
- **Reward Model**: Fixed 1 POH per block (as confirmed by user — Option A).
- **Protection**: Miners must demonstrate they performed proper, full inference work. Insufficient work = malicious response → slashing.

## Key Requirements

### 1. Fixed Block Reward
- Every valid block produces exactly **1 POH** (or a small fixed amount to be decided).
- Reward is minted as a coinbase-style output in the block.
- Simple distribution: e.g. 70% to block producer, 30% split among contributors in the block (or 100% to producer for MVP).

### 2. Work Validation Rules (Anti-Malicious Protection)
A submitted `ScanResult` is considered **valid work** only if it meets minimum quality thresholds:

- `methodsCount` >= `MIN_METHODS_THRESHOLD` (e.g. 80% of current live signals with curves)
- `signalsUsed.length` >= `MIN_SIGNALS_THRESHOLD` (same as above)
- `methodsHash` matches the network's current published signals hash (already partially implemented)
- `computationTimeMs` is within reasonable bounds (not suspiciously fast for the number of signals)
- Includes both `verdict` + `profile` (or at least the full result shape from `runFullCheck`)
- Optional future: Statistical sampling / cross-check by other miners

**Malicious Response Examples (Slash triggers):**
- Only 1 signal scanned when 150+ live signals exist
- Wrong `methodsHash`
- Missing profile or reasoning
- Computation time too low for claimed signal count

### 3. Slashing Mechanism (MVP)
- On block inclusion, the network (or majority of miners) can flag invalid results.
- Slashing can be:
  - Temporary reputation penalty (affects future job scoring)
  - Burning a small stake (if we introduce minimal staking later)
  - Exclusion from reward distribution for that block

### 4. Implementation Phases

**Phase 1: Basic Fixed Reward (Low complexity)**
- Define fixed reward constant (e.g. `BLOCK_REWARD = 1_000_000` smallest units)
- Update `PohBlock` and reward generation to always mint fixed amount
- Simple balance tracking (in-memory + file persistence for now)

**Phase 2: Work Validation at Result Submission**
- Add validation function in `miner-node.js` or new `src/validation/result-validator.js`
- Enforce `methodsCount` and `signalsUsed` thresholds using current `MethodsManager`
- Reject or mark as "low-quality" results that don't meet criteria

**Phase 3: Slashing / Penalty System**
- Add `qualityScore` or `validWork` flag to `ScanResult`
- Track per-miner statistics (valid vs invalid submissions)
- Implement basic slashing logic (e.g. skip reward for that result, reduce future priority)

**Phase 4: Cross-Validation (Future)**
- Other miners can submit challenges against suspicious results
- Majority vote on result quality

## Open Questions for User
- What should the exact fixed reward be? (1 POH? 0.1 POH? etc.)
- Should the full block reward only be paid if the block contains a minimum number of *valid* scan results?
- Do we want a small minimum stake for miners to participate in block production (to make slashing meaningful)?

## Files to Modify / Create
- `src/rewards/reward.js`
- `src/core/scanRequest.js` (add quality fields)
- New: `src/validation/result-validator.js`
- `src/miner-node.js` (integrate validation before accepting results)
- `docs/reward-mechanics-design.md` (update with new simple model)

## Success Criteria
- Blocks always produce exactly the same fixed reward.
- A miner scanning only a tiny fraction of signals gets their result rejected or penalized.
- Honest miners running full inference on current live signals are protected and rewarded.

## Progress (Current Session)
- [x] Fixed reward of exactly **1 POH per block** implemented (`BLOCK_REWARD_POH`)
- [x] Robust `result-validator.js` with protection against low-effort responses (requires ≥75% of live signals)
- [x] Validator integrated into result submission and block production paths
- [x] `ScanResult` now carries `isValidWork` + `validationErrors`
- [x] `proposeBlock` and reward calculation updated to use fixed model + valid work only

**Next priorities for full A completion:**
- Persistent per-miner quality tracking + actual slashing
- Only allow `isValidWork === true` results into blocks
- Basic balance tracking that respects the fixed rewards

**Latest Progress (this continuation):**
- [x] `proposeBlock` now collects and only includes validated (`isValidWork=true`) ScanResults
- [x] Basic reputation/slashing system added (`applySlashing`, reputation affects proposer reward share)
- [x] File persistence for quality stats + reputation in `~/.poh-miner/quality.json`
- Reputation now directly reduces the miner's cut of the fixed 1 POH block reward when they submit bad work

**Protection items completed (this session):**
- [x] Strike system + permanent/harsher slashing for repeat offenders (strikes counter, temporary restriction after 3 strikes)
- [x] On-disk submission history (for pattern detection over time)
- [x] High-value signals requirement (validator now requires meaningful % of curve-backed signals)
- [x] Basic challenge/flag mechanism (`flagSuspiciousResult`)
- [x] Rich `poh-miner status` command showing strikes, restriction status, recent bad submissions, etc.

All core software protection items from the list are now implemented.

**Block Sync + Bootnodes (Production-Ready Improvements):**
- Added persistent chain storage (`src/storage/chain-store.js`)
- Created dedicated Bootnode server (`src/bootnode.js`) with HTTP endpoints.
- Nodes now do real HTTP catch-up sync from bootnodes + block gossip.
- Bootnode support in config + CLI.

**Wallets & Balances Progress:**
- Basic `Wallet` + `WalletManager` implemented (`src/wallet/wallet.js`).
- Auto wallet creation on first run (true miner-app like onboarding).
- Automatic crediting of block rewards (proposer + worker shares) directly to the configured wallet.
- Basic send/transfer between local wallets.
- Full CLI support: `poh-miner wallet create | list | balance <addr> | send <from> <to> <amt>`

**Future Protection Layer (TEE)**
See new document: `docs/tee-protection-architecture.md`
- TEE (Nitro Enclaves, SEV-SNP, etc.) was evaluated as a stronger protection mechanism.
- Feasible for high-trust operators but not practical as a requirement for all miners due to hardware diversity (RPi, Mac Mini, mini-PC, VPS, gaming PCs, servers, etc.).
- Recommended as an **optional** path: miners running in attested confidential environments can get higher reputation / priority.
