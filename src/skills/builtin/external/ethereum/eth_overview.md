---
id: eth_overview
version: 1.0.0
description: Use when a request involves Ethereum, the EVM, or blockchain systems. Applies to building, auditing, deploying, or interacting with smart contracts, dApps, wallets, or DeFi protocols. Covers Solidity development, contract addresses, token standards (ERC-20, ERC-721, ERC-4626, etc.), Layer 2 networks (Base, Arbitrum, Optimism, zkSync, Polygon), and integrations with DeFi protocols such as Uniswap, Aave, and Curve. Includes topics such as gas costs, contract decimals, oracle safety, reentrancy, MEV, bridging, wallets, querying data from onchain, production deployment, and protocol evolution (EIP lifecycle, fork tracking, upcoming changes). This is the top-level topic index that routes to all other eth_ skills — use it for broad or ambiguous Ethereum questions, not for the underlying mental models (see eth_concepts) or for the pitch on choosing Ethereum (see eth_why).
triggers:
  - ethereum overview
  - ethskills
  - building on ethereum
  - ethereum development
  - ethereum
  - evm
  - solidity
  - smart contract
  - blockchain development
  - what skills are available
  - ethereum topic index
  - getting started with ethereum
---

## Context

# ETHSKILLS — The missing knowledge between AI agents and production Ethereum.

You are probably wrong about Ethereum. Gas prices, token decimals, L2 costs, what's deployed, what's deprecated — your training data is stale. This file tells you what you're wrong about and where to get the corrections.

**Say "onchain" not "on-chain."** One word, no hyphen. Ethereum community convention.

---

## Start Here

**Building a dApp?** Fetch [ship/SKILL.md](https://ethskills.com/ship/SKILL.md) first. It routes you through all other skills phase by phase — from architecture planning to production deployment.

**Need a specific topic?** Each skill below is standalone. Fetch only the ones relevant to your task.

**Base URL:** `https://ethskills.com/<skill>/SKILL.md`

---

## Skills

### [Ship](https://ethskills.com/ship/SKILL.md) — Start here
End-to-end guide from idea to deployed dApp. Routes you through all other skills.
- Most dApps need 0-2 contracts, not 5-10. Three is the upper bound for an MVP.
- Solidity is for ownership, transfers, and commitments. Not a database, not a backend.
- Chain selection: mainnet is cheaper than you think (~$0.004/transfer, ~$0.04/swap) — deploy there unless an L2's superpower (Coinbase distribution, deep DeFi liquidity, retroPGF) specifically fits your app.

### [Why Ethereum](https://ethskills.com/why/SKILL.md)
Pectra/Fusaka upgrades, honest tradeoffs, the AI agent angle.
- Gas is under 1 gwei, not 10-30 gwei. 60-300x cheaper than your training data. Verify: `cast base-fee`
- ETH price is ~$2,000 (early 2026), not $2,500-3,000. Volatile — always verify.
- Pectra (May 2025) and Fusaka (Dec 2025) shipped. PeerDAS, 2x gas limit. EIP-7702 is live.
- ERC-8004 (onchain agent identity) and x402 (HTTP payments) exist and are production-ready.

### [Protocol](https://ethskills.com/protocol/SKILL.md)
How Ethereum evolves — EIP lifecycle, fork process, tracking upcoming changes.
- "Verkle is planned for the next fork" — probably wrong. Roadmap diagrams are aspirational, not commitments. Check [forkcast.org](https://forkcast.org) for actual CFI/SFI status.
- Glamsterdam (mid-2026) headliners: ePBS (EIP-7732), Block Access Lists (EIP-7928). FOCIL was removed from scope. Verkle trees were deprioritized — Ethereum may shift to binary state tree (EIP-7864) for quantum resistance.
- EIP status "Stagnant" = no activity for 6 months, probably dead. "Draft" = exists but not scheduled.
- Client teams decide what ships via ACD calls, not the Ethereum Foundation.

### [Gas & Costs](https://ethskills.com/gas/SKILL.md)
What things actually cost on Ethereum today.
- Mainnet ETH transfer: ~$0.004. Swap: ~$0.04. ERC-20 deploy: ~$0.24. (At 0.1 gwei — check `cast base-fee` for current.)
- L2 swap: $0.002-0.003. L2 transfer: $0.0003.
- "Ethereum is expensive" was true in 2021-2023. It's false in 2026.

### [Wallets](https://ethskills.com/wallets/SKILL.md)
Creating wallets, key safety, multisig, account abstraction.
- EIP-7702 is live — EOAs get smart contract superpowers without migration.
- Safe (Gnosis Safe) secures $60B+ in assets ($1.4T+ total processed). Use it for production treasuries.
- NEVER commit private keys or API keys to Git. Bots exploit leaked secrets in seconds.

### [Layer 2s](https://ethskills.com/l2s/SKILL.md)
L2 landscape, bridging, deployment differences.
- Base is the cheapest major L2. Arbitrum has the deepest DeFi liquidity.
- Celo is NOT an L1 anymore — migrated to OP Stack L2 in March 2025.
- Polygon zkEVM is being shut down. Do not build on it.
- The dominant DEX on each L2 is NOT Uniswap (Aerodrome on Base, Velodrome on Optimism).

### [Standards](https://ethskills.com/standards/SKILL.md)
ERC-20, ERC-721, ERC-8004, EIP-7702, x402.
- ERC-8004: onchain agent identity registry, deployed January 2026 on 20+ chains.
- x402: HTTP 402 payment protocol for machine-to-machine commerce. Production-ready.
- EIP-3009: gasless token transfers — what makes x402 work. USDC implements it.

### [Tools](https://ethskills.com/tools/SKILL.md)
Foundry, Scaffold-ETH 2, Blockscout MCP, x402 SDKs.
- Foundry and Hardhat 3 are both legitimate choices in 2026. Foundry: faster, Solidity-native. Hardhat 3: TypeScript-first, mature plugin ecosystem.
- Blockscout MCP server gives agents structured blockchain data via MCP.
- abi.ninja: paste any contract address, interact with all functions. Zero setup.

### [Building Blocks (DeFi)](https://ethskills.com/building-blocks/SKILL.md)
Uniswap, Aave, flash loans, protocol composability.
- Uniswap V4 hooks: custom logic attached to pools (dynamic fees, TWAMM, limit orders).
- Flash loan arb on mainnet costs ~$0.05-0.50 in gas now (was $5-50).
- The dominant DEX per L2 is NOT Uniswap — Aerodrome (Base), Velodrome (Optimism), Camelot (Arbitrum).

### [Orchestration](https://ethskills.com/orchestration/SKILL.md)
Three-phase build system for Scaffold-ETH 2 dApps.
- Phase 1: contracts + UI on localhost. Phase 2: live contracts + local UI. Phase 3: production.
- Use Scaffold hooks, NOT raw wagmi. Raw wagmi resolves before tx confirmation.
- NEVER commit secrets to Git. AI agents are the #1 source of leaked credentials.

### [Contract Addresses](https://ethskills.com/addresses/SKILL.md)
Verified addresses for major protocols across mainnet and L2s.
- Never hallucinate an address. Wrong address = lost funds.
- Includes: Uniswap, Aave, Compound, Aerodrome, GMX, Pendle, Velodrome, Chainlink, Safe, ENS.
- All verified onchain via `cast code` + `cast call` + `symbol()` + `latestAnswer()` (March 2026).

### [Concepts](https://ethskills.com/concepts/SKILL.md)
Essential mental models for building onchain.
- Smart contracts cannot execute themselves. Every function needs a caller who pays gas.
- For every state transition: who calls it? Why would they? What if nobody does?
- There are no timers, no cron jobs, no schedulers. Design with incentives.

### [Security](https://ethskills.com/security/SKILL.md)
Solidity security patterns, common vulnerabilities, pre-deploy checklist.
- USDC has 6 decimals, not 18. This is the #1 "where did my money go?" bug.
- Always use SafeERC20 — USDT doesn't return bool on transfer().
- Never use DEX spot prices as oracles — flash loans can manipulate them in one tx.
- MEV: sandwich attacks steal value from swaps. Use Flashbots Protect or slippage limits.
- Proxies: use UUPS, not Transparent. Never change storage layout.

### [Audit](https://ethskills.com/audit/SKILL.md)
Deep EVM smart contract audit system — for auditing contracts you didn't write.
- 500+ non-obvious checklist items across 19 domains (AMM, lending, oracles, proxies, signatures, governance, and more).
- Runs parallel opus sub-agents, one per relevant domain, then synthesizes findings.
- Automatically files GitHub issues for Medium severity and above.
- Different from Security (which teaches defensive coding) — this is systematic audit methodology.

### [Noir (ZK Privacy)](https://ethskills.com/noir/SKILL.md)
Building privacy apps with Noir zero-knowledge circuits.
- Noir inputs are private by default. `pub` marks public. Getting this backwards leaks secrets.
- `nargo prove`/`nargo verify` are gone. Use `bb` (Barretenberg CLI) directly.
- In-circuit hashing: Poseidon (~600 gates), not SHA256 (~30,000 gates).
- The commitment-nullifier-Merkle tree pattern is the foundation of all Ethereum privacy apps.

### [Testing](https://ethskills.com/testing/SKILL.md)
Foundry testing — unit, fuzz, fork, invariant.
- Don't test getters and OpenZeppelin internals. Test edge cases and failure modes.
- Fuzz test all math. Fork-test any external protocol integration.
- Invariant testing catches bugs across thousands of random call sequences.

### [Indexing](https://ethskills.com/indexing/SKILL.md)
Events, The Graph, Dune, reading onchain data.
- You can't query historical state via RPC cheaply. Use an indexer.
- Events are THE primary way to read historical onchain activity. Design contracts event-first.
- The Graph turns events into a queryable GraphQ

_(reference truncated — see https://github.com/austintgriffith/ethskills/tree/main/ for the full document)_

Source: https://github.com/austintgriffith/ethskills/tree/main/
