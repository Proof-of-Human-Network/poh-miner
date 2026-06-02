# PoH Miner Network — Technical Yellow Paper (Draft v0.1)

## Abstract

The PoH Miner Network is a specialized Proof-of-Work blockchain designed to provide decentralized, economically incentivized compute for the Proof of Human (POH) identity verification system.

Instead of wasting energy on pure hash puzzles, miners perform real, useful work: executing the full POH checker + brain on user-submitted scan requests. The network produces blocks containing verified scan results and distributes fixed POH rewards plus job fees to participants who perform high-quality work.

## 1. Motivation

- Current mining hardware has massive stranded capacity once difficulty adjusts.
- Generic "decentralized compute" networks often devolve into low-value or fake workloads.
- Proof of Human requires high-integrity, real-time AI inference at global scale.
- We need a chain where the *only* way to earn is by doing the actual hard work the protocol needs.

## 2. Architecture Overview

### 2.1 Block Production
- Fixed subsidy: **1 POH per block** (subject to future governance).
- Blocks contain:
  - Validated `ScanResult`s from the job mempool.
  - State transitions (new signals, weight updates, etc.).
  - Coinbase reward outputs.

### 2.2 Job Mempool & Racing
- Users submit scan requests (via proofofhuman.ge or directly).
- Requests enter a geo-aware job queue.
- Miners compete on latency + speed of correct inference.
- First valid, high-quality result wins the associated fee.

### 2.3 Work Verification (Software Protection Layer)
A result is only considered valid if it meets strict criteria:
- Used the current canonical set of live signals (methodsHash match).
- Evaluated a minimum percentage (currently ≥75%) of live curve-backed signals.
- Returned full required output (verdict + profile + reasoning).
- Computation time is plausible for the claimed work.

Low-quality submissions are rejected and trigger reputation penalties / slashing.

### 2.4 Reward Distribution
- Fixed 1 POH block subsidy split between block producer and nodes that contributed validated work.
- Additional job fees go to the winner of each individual scan race.

## 3. Consensus & Networking

- Currently uses a hybrid model:
  - Useful work + lightweight PoW for block production.
  - Bootnode-assisted HTTP sync for reliable chain catch-up.
  - Gossip for fast propagation of new blocks and jobs.
- Future: Move toward BFT finality or hybrid useful-PoW + BFT (see earlier reward design doc).

## 4. Wallet & Token Model

- Simple account-based model for MVP.
- Rewards are credited directly to the miner's configured wallet upon block production / valid work inclusion.
- Basic send/receive supported in both CLI and mobile wallet.

## 5. Threat Model & Defenses

- Lazy miners (running few signals) → Rejected + slashed via reputation system.
- Malicious results → Multiple independent validation layers + economic penalties.
- Long-range / nothing-at-stake → Fixed subsidy + work quality requirements + future BFT elements.
- Sybil → Geographic scoring + reputation + (future) hardware attestation.

## 6. Roadmap Highlights

- Full on-chain reward claiming + mature balances.
- Stronger cross-validation / challenge system.
- Optional TEE / confidential compute tier for high-trust operators.
- ZK-friendly components for future verifiability.
- Native mobile wallet with direct node connection.

## 7. Comparison to Existing Systems

Unlike Bitcoin (pure hash), Filecoin (storage proofs), or generic AI compute chains, PoH Miner is purpose-built around one extremely high-value, hard-to-fake workload: real-time, multi-signal human verification using the live production POH system.

---

*This is a living draft. Major updates will be versioned.*
