# PoH Miner Network — Reward Mechanics Design

## Goals
- Tokens (POH) are **produced** as part of block creation, similar to Bitcoin coinbase rewards. Not "sent" from a central treasury.
- Rewards are earned by providing **useful work** (running AI inference / signal verification for the POH identity system).
- Strong security properties, including resistance to common blockchain attacks.
- Path toward **quantum resistance**.
- Minimize traditional "blockchain accounting" complexity for the core reward issuance (ideally the token exists natively in blocks).

## Core Model: Useful Proof-of-Work + BFT Finality

We propose a **hybrid** system:

1. **Block Production via Useful Work**
   - Nodes compete to include and solve batches of inference jobs (from the job mempool).
   - A valid "work proof" for a block includes:
     - A set of completed inference results (verdicts + signals).
     - Cryptographic commitments / proofs that the work was done (future: zkML or reproducible execution).
     - A lightweight PoW puzzle over the block header + work commitments (to prevent spam and add Sybil resistance).

2. **Consensus Layer**
   - Use a Tendermint/CometBFT-style BFT consensus (or a fork) for fast finality and safety.
   - This protects against long-range attacks, nothing-at-stake, etc.
   - Only nodes that have demonstrated recent useful work (or staked POH earned from work) can participate as validators/proposers.

3. **Reward Issuance (Native Production)**
   - Every finalized block contains a **coinbase-like reward output**.
   - The block producer + contributing workers receive newly minted POH.
   - Rewards are recorded directly in the block as "UTXO-like" outputs or simple state updates.
   - No need for complex transfer mechanics for the *issuance* itself.

## Quantum Resistance Strategy

### Short/Medium Term
- Use **post-quantum signature schemes** for accounts and work proofs:
  - Dilithium (lattice-based, good performance)
  - Falcon
  - SPHINCS+ (hash-based, very conservative)
- Use quantum-resistant hash functions for block headers (SHA-3, BLAKE3, Poseidon for zk-friendliness).

### Long Term Vision: "Quantum-Resistant Proof Block Hashes"
- Instead of (or in addition to) traditional signatures, use **proof-of-work over block hashes** combined with verifiable computation.
- The "ownership" of a reward output is proven by providing a valid solution to a puzzle tied to that output's hash.
- This is closer to Bitcoin's model: you don't "send" coins with a signature in the same way; you prove you can spend by providing the right preimage/solution.

This is hard for general transfers but very interesting for **reward outputs**.

## Why Not Just Use Existing Chains?

- **Solana / Cosmos / Ethereum**: Good for now, but the user wants native production + minimal traditional mechanics.
- Forking Tendermint/CometBFT is a strong starting point because:
  - Mature BFT implementation.
  - ABCI allows custom application logic (perfect for job mempool + work verification).
  - Can be extended with custom proposer selection based on useful work.

## Proposed Architecture

### Layer 1: Consensus (Fork of CometBFT or custom BFT)
- Tendermint-style voting for block finality.
- Custom proposer selection: weighted by recent useful work + stake (if we add staking later).

### Layer 2: Application (Custom ABCI or Rust/Go app)
Modules:
- **Job Mempool**: Handles incoming inference requests.
- **Work Verification**: Validates submitted inference results (initially via reputation + sampling, later with zk proofs).
- **Reward Minting**: On every finalized block, mint new POH to:
  - Block proposer
  - Nodes whose work was included and verified
- **Native Token State**: Simple account balances or UTXO set for the POH token.
  - For maximum "produced not transferred" feel on issuance: Reward outputs are special "mined" UTXOs that can only be spent after a maturity period (like Bitcoin coinbase).

### Quantum-Resistant Elements (Phased)
Phase 1: Use Dilithium for signatures + standard hashes.
Phase 2: Add hash-based puzzles for reward claiming.
Phase 3: Explore full zk-friendly post-quantum schemes.

## Security Considerations

- **Sybil Resistance**: Useful work + (optional) stake required to propose blocks or submit work.
- **Nothing-at-Stake**: BFT finality + slashing for equivocation.
- **Long-Range Attacks**: Use checkpoints or social consensus for very old blocks (common in BFT chains).
- **Work Quality**: Cross-validation by other nodes + economic slashing based on later human feedback or majority disagreement.
- **Quantum Attacks**: Move to post-quantum crypto before large quantum computers arrive.

## Implementation Path Recommendations

### Option A (Fastest to Production)
- Fork Cosmos SDK + CometBFT.
- Build custom modules for jobs + work proofs.
- Use existing post-quantum signature libraries (e.g., via CosmWasm or Go bindings).

### Option B (More Custom, Closer to Vision)
- Use CometBFT as consensus engine.
- Write a custom Rust application (using `tendermint-rs` or ABCI++).
- Implement a minimal UTXO or account model focused on reward outputs.
- Start with Dilithium signatures.

### Option C (Experimental)
- Research building on a "Proof of Useful Work" base layer (some academic projects exist in this space).
- Combine with BFT for finality.

## Open Questions

1. How do we make LLM inference *verifiable* at scale without massive overhead? (Current best: sampling + reputation + future zkML).
2. Should reward outputs be claimable only by providing a post-quantum proof-of-work solution tied to the block hash?
3. Do we want a separate "work token" or just one POH token?

## Next Steps

- Prototype a minimal Tendermint ABCI application that mints tokens based on submitted work.
- Define the exact data structures for "WorkProof" and "RewardOutput".
- Research current state of post-quantum signature libraries in Go/Rust.

A basic folder structure for a Tendermint prototype has been started at `tendermint-prototype/`.

This design tries to stay true to the Bitcoin "found in blocks" spirit while adding the useful work component and BFT safety that a compute network needs.