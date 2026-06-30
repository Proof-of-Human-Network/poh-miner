---
id: sol_switchboard
version: 1.0.0
description: Complete Switchboard Oracle Protocol SDK for Solana - the permissionless oracle solution for price feeds, on-demand data, VRF randomness, and real-time streaming via Surge. Covers TypeScript SDK, Rust integration, Oracle Quotes, and all Switchboard tools. Use Switchboard specifically (not Pyth) when the user names Switchboard, VRF randomness, Oracle Quotes, or Surge streaming.
triggers:
  - switchboard
  - switchboard oracle
  - vrf
  - vrf randomness
  - oracle quotes
  - surge streaming
  - on-demand oracle
  - permissionless oracle
  - random number solana
  - switchboard sdk
---

## Context

# Switchboard Oracle Protocol - Complete Integration Guide

The definitive guide for integrating Switchboard - the fastest, most customizable, and only permissionless oracle protocol on Solana.

## What is Switchboard?

Switchboard is a permissionless oracle protocol enabling developers to bring custom data on-chain with industry-leading performance:

- **Price Feeds** - Real-time asset pricing with pull-based efficiency
- **Oracle Quotes** - Sub-second latency without on-chain storage (90% cost reduction)
- **Surge** - WebSocket streaming with sub-100ms latency
- **VRF Randomness** - Cryptographically secure verifiable random functions
- **Prediction Markets** - Market-based forecasting data

### Key Statistics
- Secures **$1B+** in on-chain volume
- Used by Kamino, Jito, MarginFi, Drift Protocol
- **2-5ms latency** with Surge pricing
- **90% cost reduction** vs traditional oracles

## Core Principles

| Principle | Description |
|-----------|-------------|
| **Speed** | 2-5ms with Surge, 400ms standard - industry-leading for DeFi |
| **Cost Efficiency** | Pull-based feeds eliminate constant streaming costs |
| **Permissionless** | Deploy feeds instantly without approvals |
| **Security** | TEE (Trusted Execution Environments) prevent data manipulation |

## Integration Approaches

### 1. Oracle Quotes (Recommended)
Direct oracle-to-program data flow without on-chain storage:
- Sub-second latency
- 90% cost reduction
- No write locks (parallel reads)
- Stateless design

### 2. Traditional Feeds
Classic pull-based feed updates:
- Feed account maintenance
- Cranking operations
- Good for simple use cases

### 3. Surge (Real-Time)
WebSocket streaming for high-frequency applications:
- Sub-100ms latency
- Persistent connections
- Ideal for trading interfaces

## Program IDs

| Program | Mainnet | Devnet |
|---------|---------|--------|
| Oracle Program | `SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f` | `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2` |
| Quote Program | `orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz` | - |

### Default Queues

| Network | Queue Address |
|---------|---------------|
| Mainnet | `A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w` |
| Devnet | `EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7` |

## Quick Start

### Installation

```bash
# TypeScript SDK
npm install @switchboard-xyz/on-demand @switchboard-xyz/common

# Rust (Cargo.toml)
# switchboard-on-demand = "0.8.0"
```

### Basic Setup

```typescript
import { web3, AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  PullFeed,
  CrossbarClient,
  ON_DEMAND_MAINNET_PID,
  ON_DEMAND_DEVNET_PID
} from "@switchboard-xyz/on-demand";

// Setup connection and provider
const connection = new web3.Connection("https://api.mainnet-beta.solana.com");
const wallet = useWallet(); // or Keypair
const provider = new AnchorProvider(connection, wallet);

// Load Switchboard program
const sbProgram = await Program.at(ON_DEMAND_MAINNET_PID, provider);

// Initialize Crossbar client for oracle communication
const crossbar = new CrossbarClient("https://crossbar.switchboard.xyz");
```

## Price Feeds

### Fetch and Update Feed

```typescript
import { PullFeed, asV0Tx } from "@switchboard-xyz/on-demand";

// Create feed account reference
const feedPubkey = new web3.PublicKey("YOUR_FEED_PUBKEY");
const feedAccount = new PullFeed(sbProgram, feedPubkey);

// Fetch update instruction with oracle signatures
const { pullIx, responses, numSuccess, luts } = await feedAccount.fetchUpdateIx({
  crossbarClient: crossbar,
  chain: "solana",
  network: "mainnet", // or "devnet"
});

// Build and send transaction
const tx = await asV0Tx({
  connection,
  ixs: [pullIx],
  signers: [payer],
  computeUnitPrice: 200_000,
  computeUnitLimitMultiple: 1.3,
  lookupTables: luts,
});

const signature = await connection.sendTransaction(tx);
console.log("Feed updated:", signature);
```

### Read Feed Value

```typescript
// Get current feed value
const feedData = await feedAccount.loadData();
const value = feedData.value.toNumber();
const lastUpdated = feedData.lastUpdatedSlot;

console.log(`Price: ${value}, Last Updated: ${lastUpdated}`);
```

## Oracle Quotes (Recommended)

Oracle Quotes provide the most efficient way to consume oracle data:

```typescript
import { OracleQuote } from "@switchboard-xyz/on-demand";

// Feed hashes (64-char hex strings)
const feedHashes = [
  "0x...", // SOL/USD
  "0x...", // BTC/USD
];

// Derive canonical quote account
const queueKey = new web3.PublicKey("A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w");
const quotePubkey = OracleQuote.getCanonicalPubkey(queueKey, feedHashes);

// Fetch quote instruction
const sigVerifyIx = await queue.fetchQuoteIx(crossbar, feedHashes, {
  numSignatures: 1,
  variableOverrides: {},
});
```

### Rust Integration (Oracle Quotes)

```rust
use anchor_lang::prelude::*;
use switchboard_on_demand::{default_queue, SwitchboardQuoteExt, SwitchboardQuote};

#[program]
pub mod my_program {
    use super::*;

    pub fn read_oracle_data(ctx: Context<ReadOracleData>) -> Result<()> {
        let feeds = &ctx.accounts.quote_account.feeds;
        let current_slot = ctx.accounts.sysvars.clock.slot;
        let quote_slot = ctx.accounts.quote_account.slot;

        // Check staleness
        let staleness = current_slot.saturating_sub(quote_slot);
        require!(staleness < 100, ErrorCode::StaleFeed);

        for feed in feeds.iter() {
            msg!("Feed {}: Value = {}", feed.hex_id(), feed.value());
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct ReadOracleData<'info> {
    #[account(address = quote_account.canonical_key(&default_queue()))]
    pub quote_account: Box<Account<'info, SwitchboardQuote>>,
    pub sysvars: Sysvars<'info>,
}

#[derive(Accounts)]
pub struct Sysvars<'info> {
    pub clock: Sysvar<'info, Clock>,
}
```

## Surge (Real-Time Streaming)

For applications requiring real-time price updates:

```typescript
import { SwitchboardSurge } from "@switchboard-xyz/on-demand";

// Initialize Surge client
const surge = new SwitchboardSurge({
  apiKey: "YOUR_API_KEY", // Optional
  gatewayUrl: "wss://surge.switchboard.xyz",
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
});

// Subscribe to feeds
surge.subscribe(["SOL/USD", "BTC/USD"]);

// Handle events
surge.on("connected", () => {
  console.log("Connected to Surge");
});

surge.on("data", (data) => {
  console.log(`${data.symbol}: ${data.price}`);
});

surge.on("error", (error) => {
  console.error("Surge error:", error);
});

surge.on("disconnected", () => {
  console.log("Disconnected from Surge");
});
```

## VRF Randomness

Cryptographically secure on-chain randomness:

### TypeScript Client

```typescript
import { RandomnessService } from "@switchboard-xyz/on-demand";

// Request randomness
const randomnessAccount = await RandomnessService.create(sbProgram, {
  queue: queuePubkey,
  callback: {
    programId: myProgramId,
    accounts: [...],
    ixData: Buffer.from([...]),
  },
});

// Reveal randomness (after oracle fulfillment)
const randomValue = await randomnessAccount.reveal();
console.log("Random value:", randomValue);
```

### Rust Integration

```rust
use switchboard_on_demand::RandomnessAccountData;

pub fn consume_randomness(ctx: Context<ConsumeRandomness>) -> Result<()> {
    let randomness_data = RandomnessAccountData::parse(
        ctx.accounts.randomness_account.to_account_info()
    )?;

    // Use the random value
    let random_value = randomness_data.get_value(&ctx.accounts.clock)?;

    // Example: coin flip
    let is_heads = random_value[0] % 2 == 0;

    Ok(())
}
```

## Creating Custom Feeds

### Using Feed Builder UI

1. Visit [ondemand.switchboard.xyz](https://ondemand.switchboard.xyz)
2. Click "Create Feed"
3. Configure data sources and aggregation
4. Deploy to mainnet/devnet
5. Copy feed hash for integration

### Using TypeScript SDK

```typescript
import { FeedBuilder } from "@switchboard-xyz/on-demand";

const feedConfig

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/switchboard for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/switchboard
