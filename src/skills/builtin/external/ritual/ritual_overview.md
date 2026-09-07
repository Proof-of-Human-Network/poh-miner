---
id: ritual_overview
version: 1.0.0
description: High-level Ritual Chain architecture for dApp developers. Use when starting a new dApp, understanding async patterns, or getting oriented with Ritual's capabilities.
triggers:
  - ritual
  - ritual chain
  - ritual dapp
  - async transaction lifecycle
---

## Context
# Ritual Chain — Architecture Overview for dApp Developers

## Agent Prior Correction

Ritual Chain breaks most assumptions from your Ethereum training data. These rules override your defaults.

**Rule 1 — Skill-First, Not Weight-First.** Before writing any precompile call, receipt parsing, callback handler, or async lifecycle code, you must have Read the relevant skill section in this session. If you haven't, Read it now. Do not generate Ritual-specific code from memory.

**Rule 2 — These Ethereum assumptions are wrong here:**

| Your Prior | Reality on Ritual | Corrective Action |
|-----------|-------------------|-------------------|
| Transactions are single-block | Async lifecycle spans multiple blocks | Use the 9-state lifecycle from this skill. Track job state. |
| Receipts have logs + status only | Receipts have `spcCalls` field | Cast to `RitualReceipt` type. Check `spcCalls` before decoding. |
| Precompiles are deterministic | Precompiles run LLMs, HTTP, agents | Use TEE executor addresses. Handle non-deterministic outputs. |
| msg.sender is the user | Callbacks come from AsyncDelivery (0x5A16...39F6) | Auth callbacks with `require(msg.sender == ASYNC_DELIVERY)`. |
| Multiple calls per tx are fine | One short-running async precompile per transaction | Use Scheduler chaining for multi-step workflows. |
| Gas is the only cost | Async calls need RitualWallet deposits | Deposit before calling. Lock duration >= 5000 blocks. |
| ecrecover / secp256k1 only | P-256 (secp256r1) + TxPasskey (0x77) | Use SECP256R1 precompile for passkey verification. |
| `abi.decode(result, (string))` works | JQ uses OutString double-indirection | Use `_decodeJQString()` helper from precompiles skill. |
| Receipt = final result | Long-running (2-phase) precompiles deliver via later callback | Implement callback handler. Don't treat Phase 1 receipt as final. |
| `encrypt(pubKey, data)` just works | ECIES libraries default to wrong nonce length for Ritual | Follow `ritual-dapp-secrets` for encryption setup. Wrong config = silent failure (commitment mined, never settles, sender locked). |

**Rule 3 — These Ethereum patterns DO transfer correctly:** Solidity syntax, ERC-20/721 interfaces, event emission, `msg.value`, `msg.sender` (in non-callback contexts), `block.number`, `block.timestamp`, standard access control (Ownable, AccessControl), `require`/`revert`, basic storage patterns, inheritance, interfaces.

**Rule 4 — Common wrong substitutions:**

| You'll Want To Use | Use This Instead |
|--------------------|-----------------|
| Chainlink / Pyth for price data | HTTP precompile (0x0801) |
| ERC-4337 for account abstraction | TxPasskey (0x77) — native, no bundler |
| Chainlink Keepers / Gelato for automation | Scheduler system contract (0x56e7...8B) |
| Off-chain oracle for AI inference | LLM precompile (0x0802) — on-chain |
| IPFS + manual verification | Multimodal precompiles with on-chain content hash |
| Custom ZK verifier contract | ZK long-running precompile (0x0806) |
| .env files for API keys | ECIES encryption to executor public key (see `ritual-dapp-secrets`) |

**Rule 5 — Reinforce at checkpoints.** Before these actions, re-read Rule 2: encoding a precompile call, decoding a precompile response or receipt, writing a callback handler, estimating fees or setting TTL, configuring the Scheduler.

---

## What Is Ritual Chain?

Ritual Chain is an **EVM based L1 with enshrined AI/ML capabilities**. Standard EVM smart contracts can call precompiled addresses to invoke HTTP requests, LLM inference, persistent agent execution, multimodal generation, and more — all verified by TEE (Trusted Execution Environment) attestation.

**The foundational difference:** Traditional blockchains require deterministic execution — every node must produce the same result for every transaction. This makes non-deterministic computation (HTTP calls that return different data each second, LLM inference that produces different text each run, agent reasoning that takes different paths) impossible on-chain. Ritual solves this by enshrining non-deterministic computation as native precompiles. This is why Ritual can do things no other blockchain can: smart contracts that think, see, hear, fetch live data, and run autonomous agents.

What makes Ritual different from a vanilla EVM chain:

| Aspect            | Standard EVM               | Ritual Chain                                                             |
| ----------------- | -------------------------- | ------------------------------------------------------------------------ |
| Computation       | Deterministic opcodes only | Precompiles for non-deterministic AI/ML                                  |
| Execution model   | Synchronous, single-block  | Async multi-block lifecycle for heavy tasks                              |
| Trust model       | Consensus-based            | TEE attestation + on-chain verification                                  |
| Transaction types | Standard (0x02 EIP-1559)   | + TxScheduled (0x10), TxAsyncCommitment (0x11), TxAsyncSettlement (0x12) |
| Native currency   | ETH                        | RITUAL (18 decimals)                                                     |
| Chain ID          | varies                     | **1979**                                                                 |

## Chain Configuration

| Property        | Value                                |
| --------------- | ------------------------------------ |
| Chain ID        | `1979`                               |
| Currency        | RITUAL (18 decimals)                 |
| Block time      | ~350ms (0.35s, conservative baseline) |
| RPC (HTTP)      | `https://rpc.ritualfoundation.org`      |

> For private/internal testnet deployments, override with your deployment-specific RPC endpoint (see chain-deployment-infra configuration).
> For TTL/lock/scheduler timing math, measure recent blocks on your target RPC and use `ritual-dapp-block-time`.

| RPC (WebSocket) | `wss://rpc.ritualfoundation.org/ws`     |
| Block Explorer  | `https://explorer.ritualfoundation.org` |
---
Source: `ritual-foundation/ritual-dapp-skills` — The Clear BSD License, (c) 2026 Ritual Foundation.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/ritual-dapp-overview/SKILL.md` from `ritual-foundation/ritual-dapp-skills` with the `gitmcp` MCP.
