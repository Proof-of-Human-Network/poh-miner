---
id: sol_dflow
version: 1.0.0
description: Complete DFlow trading protocol SDK - the single source of truth for integrating DFlow on Solana. Covers spot trading, prediction markets, Swap API, Metadata API, WebSocket streaming, and all DFlow tools.
triggers:
  - dflow
---

## Context

# DFlow - Complete Integration Guide

The definitive guide for integrating DFlow - a trading protocol that enables traders to exchange value across spot and prediction markets natively on Solana.

## What is DFlow?

DFlow is a comprehensive trading infrastructure that provides:

- **Trading Applications & Wallets** - Token swaps with intelligent routing and 99.9% token coverage
- **Exchanges & Aggregators** - Access to billions in monthly routed volume across DEXes and Prop AMMs
- **Financial Institutions & Market Makers** - Programmable execution layers with CLPs and async trades
- **Prediction Market Platforms** - Discovery, pricing, routing, and settlement infrastructure

### Key Capabilities

| Feature | Description |
|---------|-------------|
| Token Coverage | 99.9% with millisecond detection |
| Infrastructure | Globally distributed, high-throughput optimization |
| Execution | Advanced algorithms with JIT routing for best-price execution |
| Markets | Support for both spot and prediction market trading |
| MEV Protection | Enhanced sandwich protection with Jito bundles |

## API Overview

DFlow provides two main API categories:

### 1. Swap API (Trading)
**Base URL:** `https://quote-api.dflow.net`

For executing trades:
- **Imperative Swaps** - Full control over route selection at signature time
- **Declarative Swaps** - Intent-based swaps with deferred route optimization
- **Trade API** - Unified interface for spot and prediction market trading
- **Order API** - Quote and transaction generation

### 2. Prediction Market Metadata API
**Base URL:** `https://api.prod.dflow.net`

For querying prediction market data:
- **Events API** - Query prediction events and forecasts
- **Markets API** - Get market details, orderbooks, outcome mints
- **Trades API** - Historical trade data
- **Live Data API** - Real-time milestones and updates
- **WebSocket** - Streaming price and orderbook updates

### Authentication
Most endpoints require an API key via the `x-api-key` header. Contact `hello@dflow.net` to obtain credentials.

## Quick Start

### Imperative Swap (3 Steps)

```typescript
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";

const API_BASE = "https://quote-api.dflow.net";
const API_KEY = process.env.DFLOW_API_KEY; // Optional but recommended

// Token addresses
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function imperativeSwap(keypair: Keypair, connection: Connection) {
  // Step 1: Get Quote
  const quoteParams = new URLSearchParams({
    inputMint: SOL,
    outputMint: USDC,
    amount: "1000000000", // 1 SOL
    slippageBps: "50",    // 0.5%
  });

  const quote = await fetch(`${API_BASE}/quote?${quoteParams}`, {
    headers: API_KEY ? { "x-api-key": API_KEY } : {},
  }).then(r => r.json());

  // Step 2: Get Swap Transaction
  const swapResponse = await fetch(`${API_BASE}/swap`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(API_KEY && { "x-api-key": API_KEY }),
    },
    body: JSON.stringify({
      userPublicKey: keypair.publicKey.toBase58(),
      quoteResponse: quote,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 150000,
    }),
  }).then(r => r.json());

  // Step 3: Sign and Send
  const tx = VersionedTransaction.deserialize(
    Buffer.from(swapResponse.swapTransaction, "base64")
  );
  tx.sign([keypair]);

  const signature = await connection.sendTransaction(tx);
  await connection.confirmTransaction(signature);

  return signature;
}
```

### Trade API (Unified - Recommended)

The Trade API provides a single endpoint that handles both sync and async execution:

```typescript
async function tradeTokens(keypair: Keypair, connection: Connection) {
  // Step 1: Get Order (quote + transaction in one call)
  const orderParams = new URLSearchParams({
    inputMint: SOL,
    outputMint: USDC,
    amount: "1000000000",
    slippageBps: "50",
    userPublicKey: keypair.publicKey.toBase58(),
  });

  const order = await fetch(`${API_BASE}/order?${orderParams}`, {
    headers: API_KEY ? { "x-api-key": API_KEY } : {},
  }).then(r => r.json());

  // Step 2: Sign and Send
  const tx = VersionedTransaction.deserialize(
    Buffer.from(order.transaction, "base64")
  );
  tx.sign([keypair]);
  const signature = await connection.sendTransaction(tx);

  // Step 3: Monitor (based on execution mode)
  if (order.executionMode === "async") {
    // Poll order status for async trades
    let status = "pending";
    while (status !== "closed" && status !== "failed") {
      await new Promise(r => setTimeout(r, 2000));
      const statusRes = await fetch(
        `${API_BASE}/order-status?signature=${signature}`,
        { headers: API_KEY ? { "x-api-key": API_KEY } : {} }
      ).then(r => r.json());
      status = statusRes.status;
    }
  } else {
    // Sync trades complete atomically
    await connection.confirmTransaction(signature);
  }

  return signature;
}
```

## API Reference

### Order API Endpoints

#### GET /order
Returns a quote and optionally a transaction for spot or prediction market trades.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `inputMint` | Yes | Base58 input token mint |
| `outputMint` | Yes | Base58 output token mint |
| `amount` | Yes | Amount as scaled integer (1 SOL = 1000000000) |
| `userPublicKey` | No | Include to receive signable transaction |
| `slippageBps` | No | Max slippage in basis points or "auto" |
| `platformFeeBps` | No | Platform fee in basis points |
| `prioritizationFeeLamports` | No | "auto", "medium", "high", "veryHigh", or lamport amount |

**Response:**
```json
{
  "outAmount": "150000000",
  "minOutAmount": "149250000",
  "priceImpactPct": "0.05",
  "executionMode": "sync",
  "transaction": "base64...",
  "computeUnitLimit": 200000,
  "lastValidBlockHeight": 123456789,
  "routePlan": [...]
}
```

#### GET /order-status
Check status of async orders.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `signature` | Yes | Base58 transaction signature |
| `lastValidBlockHeight` | No | Block height for expiry check |

**Status Values:**
- `pending` - Order submitted, awaiting processing
- `open` - Order opened, awaiting fill
- `pendingClose` - Filled, closing transaction pending
- `closed` - Order completed successfully
- `expired` - Transaction expired before landing
- `failed` - Order execution failed

### Imperative Swap Endpoints

#### GET /quote
Get a quote for an imperative swap.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `inputMint` | Yes | Base58 input mint |
| `outputMint` | Yes | Base58 output mint |
| `amount` | Yes | Input amount (scaled integer) |
| `slippageBps` | No | Slippage tolerance or "auto" |
| `dexes` | No | Comma-separated DEXes to include |
| `excludeDexes` | No | Comma-separated DEXes to exclude |
| `onlyDirectRoutes` | No | Single-leg routes only |
| `maxRouteLength` | No | Max number of route legs |
| `forJitoBundle` | No | Jito bundle compatible routes |
| `platformFeeBps` | No | Platform fee in basis points |

#### POST /swap
Generate swap transaction from quote.

**Request Body:**
```json
{
  "userPublicKey": "Base58...",
  "quoteResponse": { /* from /quote */ },
  "dynamicComputeUnitLimit": true,
  "prioritizationFeeLamports": 150000,
  "wrapAndUnwrapSol": true
}
```

**Response:**
```json
{
  "swapTransaction": "base64...",
  "computeUnitLimit": 200000,
  "lastValidBlockHeight": 123456789,
  "prioritizationFeeLamports": 150000
}
```

#### POST /swap-instructions
Returns individual instructions instead of a full transaction (for custom transaction building).

### Declarative Swap Endpoints

Declarative swaps use intent-based execution with deferred route optimization.

#### GET /intent
Get an intent quote for a declarative swap.

| Parameter | Required | Description |
|-----------|----------|--------

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/dflow for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/dflow
