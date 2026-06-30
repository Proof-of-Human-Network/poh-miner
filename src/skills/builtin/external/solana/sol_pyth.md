---
id: sol_pyth
version: 1.0.0
description: Complete guide for Pyth Network - decentralized oracle providing real-time price feeds for DeFi. Covers price feed integration, confidence intervals, EMA prices, on-chain CPI, off-chain fetching, and streaming updates for Solana applications. Use Pyth specifically (not Switchboard) when the user names Pyth, Hermes, or asks about pull-oracle price feeds with confidence intervals.
triggers:
  - pyth
  - pyth network
  - price feed
  - price oracle
  - oracle price feed
  - hermes
  - confidence interval
  - ema price
  - pull oracle
  - on-chain price data
---

## Context

# Pyth Network Development Guide

Pyth Network is a decentralized oracle providing real-time price feeds for cryptocurrencies, equities, forex, and commodities. This guide covers integrating Pyth price feeds into Solana applications.

## Overview

Pyth Network provides:

- **Real-Time Price Feeds** - 400ms update frequency with pull oracle model
- **Confidence Intervals** - Statistical uncertainty bounds for each price
- **EMA Prices** - Exponential moving average prices (~1 hour window)
- **Multi-Asset Support** - Crypto, equities, FX, commodities, indices
- **On-Chain Integration** - CPI for Solana programs
- **Off-Chain Integration** - HTTP and WebSocket APIs via Hermes

## Program IDs

| Program | Address | Description |
|---------|---------|-------------|
| Solana Receiver | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | Posts price updates to Solana |
| Price Feed | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` | Stores price feed data |

**Deployed on**: Solana Mainnet, Devnet, Eclipse Mainnet/Testnet, Sonic networks

## Popular Price Feed IDs

| Asset | Hex Feed ID |
|-------|-------------|
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |
| ETH/USD | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` |
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` |
| USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` |
| USDT/USD | `0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b` |

Full list: [https://pyth.network/developers/price-feed-ids](https://pyth.network/developers/price-feed-ids)

## Quick Start

### Installation

```bash
# TypeScript/JavaScript
npm install @pythnetwork/hermes-client @pythnetwork/pyth-solana-receiver

# Rust (add to Cargo.toml)
# pyth-solana-receiver-sdk = "0.3.0"
```

### Fetch Price (Off-Chain)

```typescript
import { HermesClient } from "@pythnetwork/hermes-client";

const client = new HermesClient("https://hermes.pyth.network");

const priceIds = [
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", // BTC/USD
];

const priceUpdates = await client.getLatestPriceUpdates(priceIds);

for (const update of priceUpdates.parsed) {
  const price = update.price;
  const displayPrice = Number(price.price) * Math.pow(10, price.expo);
  console.log(`Price: $${displayPrice.toFixed(2)}`);
  console.log(`Confidence: ±${Number(price.conf) * Math.pow(10, price.expo)}`);
}
```

### Use Price On-Chain (Rust/Anchor)

```rust
use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

#[derive(Accounts)]
pub struct UsePrice<'info> {
    pub price_update: Account<'info, PriceUpdateV2>,
}

pub fn use_price(ctx: Context<UsePrice>) -> Result<()> {
    let price_update = &ctx.accounts.price_update;
    let clock = Clock::get()?;

    // Get price no older than 60 seconds
    let price = price_update.get_price_no_older_than(
        &clock,
        60, // max age in seconds
    )?;

    msg!("Price: {} × 10^{}", price.price, price.exponent);
    msg!("Confidence: ±{}", price.conf);

    Ok(())
}
```

---

## Core Concepts

### Price Structure

Each Pyth price contains:

| Field | Type | Description |
|-------|------|-------------|
| `price` | i64 | Price value in fixed-point format |
| `conf` | u64 | Confidence interval (standard deviation) |
| `expo` | i32 | Exponent for scaling (e.g., -8 means divide by 10^8) |
| `publish_time` | i64 | Unix timestamp of price |

**Converting to display price:**
```typescript
const displayPrice = price * Math.pow(10, expo);
// Example: price=19405100, expo=-2 → $194,051.00
```

### Confidence Intervals

Confidence intervals represent the uncertainty in the reported price:

```typescript
// Price is $50,000 ± $50 means:
// - 68% chance true price is between $49,950 - $50,050
// - Use confidence for risk management

const price = 50000;
const confidence = 50;

// Safe lower bound (conservative)
const safeLowerBound = price - confidence;

// Safe upper bound (conservative)
const safeUpperBound = price + confidence;
```

**Best Practice**: Reject prices with confidence > 2% of price:

```typescript
const maxConfidenceRatio = 0.02; // 2%
const confidenceRatio = confidence / Math.abs(price);

if (confidenceRatio > maxConfidenceRatio) {
  throw new Error("Price confidence too wide");
}
```

### EMA Prices

Exponential Moving Average prices smooth out short-term volatility:

- ~1 hour averaging window (5921 Solana slots)
- Weighted by inverse confidence (tight confidence = more weight)
- Good for: liquidations, collateral valuation
- Available as `ema_price` and `ema_conf`

```typescript
// Use EMA for less volatile applications
const emaPrice = priceUpdate.emaPrice;
const emaConf = priceUpdate.emaConf;
```

---

## Off-Chain Integration

### Hermes Client

Hermes is the recommended way to fetch Pyth prices off-chain.

**Public Endpoint**: `https://hermes.pyth.network`

> For production, get a dedicated endpoint from a Pyth data provider.

### Fetching Latest Prices

```typescript
import { HermesClient } from "@pythnetwork/hermes-client";

const client = new HermesClient("https://hermes.pyth.network");

// Single price
const btcPrice = await client.getLatestPriceUpdates([
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"
]);

// Multiple prices in one request
const prices = await client.getLatestPriceUpdates([
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", // BTC
  "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", // ETH
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", // SOL
]);
```

### Streaming Real-Time Updates

```typescript
import { HermesClient } from "@pythnetwork/hermes-client";

const client = new HermesClient("https://hermes.pyth.network");

const priceIds = [
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"
];

// Subscribe to real-time updates via SSE
const eventSource = await client.getPriceUpdatesStream(priceIds, {
  parsed: true,
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("Price update:", data);
};

eventSource.onerror = (error) => {
  console.error("Stream error:", error);
  eventSource.close();
};

// Close when done
// eventSource.close();
```

### Posting Prices to Solana

```typescript
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { HermesClient } from "@pythnetwork/hermes-client";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const wallet = Keypair.fromSecretKey(/* your key */);

const hermesClient = new HermesClient("https://hermes.pyth.network");
const pythReceiver = new PythSolanaReceiver({ connection, wallet });

// Fetch price update data
const priceUpdateData = await hermesClient.getLatestPriceUpdates([
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"
]);

// Build transaction to post price
const transactionBuilder = pythReceiver.newTransactionBuilder();
await transactionBuilder.addPostPriceUpdates(priceUpdateData.binary.data);

// Add your program instruction that uses the price
// transactionBuilder.addInstruction(yourInstruction);

// Send transaction
const transactions = await transactionBuilder.buildVersionedTransactions({
  computeUnitPriceMicroLamports: 50000,
});

for (const tx of transactions) {
  const sig = await connection.sendTransaction(tx);
  console.log("Transaction:", sig);
}
```

---

## On-Chain Integration (Rust)

### Setup

Add to `Cargo.toml`:

```toml
[dependencies]
pyth-solana-receiver-sdk = "0.3.0"
anchor-lang = "0.30.1"
```

### Reading Price in Anchor Program

```rust
use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, get_feed_id_from_hex};

declare_id!("YourProgramId...");

// BTC/USD price feed ID
const BTC_USD_FEED_ID: &str = "0xe62df6c8b4a85fe1a67db44

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/pyth for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/pyth
