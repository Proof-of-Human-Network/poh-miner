---
id: sol_quicknode
version: 1.0.0
description: Quicknode blockchain infrastructure for Solana — RPC endpoints, DAS API (Digital Asset Standard) for NFTs and compressed assets, Yellowstone gRPC streaming, Priority Fee API, Streams (real-time data pipelines), Webhooks, Metis Jupiter Swap integration, IPFS storage, Key-Value Store, Admin API, and x402 pay-per-request RPC. Supports 80+ chains including Ethereum, Polygon, Arbitrum, Base, and more. Use when setting up Solana RPC infrastructure, querying NFTs/tokens/compressed assets via DAS API, building real-time gRPC streams, configuring data pipelines, estimating priority fees, or integrating Jupiter swaps via Metis. Triggers on mentions of Quicknode, qn_ methods, DAS API, getAssetsByOwner, searchAssets, Yellowstone, gRPC, Geyser, Streams, IPFS, Key-Value Store, qnLib, Metis, x402, or Quicknode RPC.
triggers:
  - quicknode
---

## Context

# Quicknode Solana Infrastructure

Build high-performance Solana applications with Quicknode — blockchain infrastructure provider supporting 80+ chains with low-latency RPC endpoints, DAS API, Yellowstone gRPC streaming, real-time data pipelines, and developer-first APIs.

## Overview

Quicknode provides:
- **RPC Endpoints**: Low-latency Solana access with authentication embedded in the URL
- **DAS API**: Unified NFT and token queries — standard NFTs, compressed NFTs (cNFTs), fungible tokens, MPL Core Assets, Token 2022
- **Yellowstone gRPC**: Real-time Solana data streaming via Geyser plugin
- **Priority Fee API**: Fee estimation for transaction landing
- **Streams**: Real-time and historical data pipelines with JavaScript filtering
- **Webhooks**: Event-driven blockchain notifications
- **Metis**: Jupiter Swap API integration
- **IPFS**: Decentralized file storage
- **Key-Value Store**: Serverless state persistence for Streams
- **Admin API**: Programmatic endpoint management
- **x402**: Pay-per-request RPC via USDC micropayments (no API key needed)
- **Multi-Chain**: 80+ networks including Ethereum, Polygon, Arbitrum, Base, BSC, Avalanche, Bitcoin, and more

## Quick Start

### Get Your Endpoint

1. Visit [quicknode.com/endpoints](https://www.quicknode.com/endpoints)
2. Select **Solana** and your network (Mainnet / Devnet)
3. Create an endpoint
4. Copy the HTTP and WSS URLs

### Environment Setup

```bash
# .env file
QUICKNODE_RPC_URL=https://your-endpoint.solana-mainnet.quiknode.pro/your-token/
QUICKNODE_WSS_URL=wss://your-endpoint.solana-mainnet.quiknode.pro/your-token/
QUICKNODE_API_KEY=your_console_api_key  # Optional: for Admin API
```

### Basic Setup with @solana/kit

```typescript
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

const rpc = createSolanaRpc(process.env.QUICKNODE_RPC_URL!);
const rpcSubscriptions = createSolanaRpcSubscriptions(process.env.QUICKNODE_WSS_URL!);

// Make RPC calls
const slot = await rpc.getSlot().send();
const balance = await rpc.getBalance(address).send();
```

### Authentication

Quicknode endpoints include authentication in the URL:
```
https://{ENDPOINT_NAME}.solana-mainnet.quiknode.pro/{TOKEN}/
```

Enable JWT authentication or IP allowlisting in the Quicknode dashboard for additional security.

## RPC Endpoints

### Solana Endpoints

| Network | URL Pattern |
|---------|-------------|
| Mainnet | `https://{name}.solana-mainnet.quiknode.pro/{token}/` |
| Devnet | `https://{name}.solana-devnet.quiknode.pro/{token}/` |
| WebSocket | `wss://{name}.solana-mainnet.quiknode.pro/{token}/` |

### Using with @solana/kit

```typescript
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  address,
  lamports,
} from "@solana/kit";

const rpc = createSolanaRpc(process.env.QUICKNODE_RPC_URL!);
const rpcSubscriptions = createSolanaRpcSubscriptions(process.env.QUICKNODE_WSS_URL!);

// Account balance
const balance = await rpc.getBalance(address("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk")).send();

// Account info
const accountInfo = await rpc.getAccountInfo(address("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"), {
  encoding: "base64",
}).send();

// Recent blockhash
const { value: blockhash } = await rpc.getLatestBlockhash().send();

// Token accounts
const tokenAccounts = await rpc.getTokenAccountsByOwner(
  address("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"),
  { programId: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") },
  { encoding: "jsonParsed" },
).send();
```

### Using with Legacy web3.js

```typescript
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection(process.env.QUICKNODE_RPC_URL!);
const balance = await connection.getBalance(new PublicKey("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"));
```

### Rate Limits & Plans

| Plan | Requests/sec | Credits/month |
|------|-------------|---------------|
| Free Trial | 15 | 10M |
| Build | 50 | 80M |
| Accelerate | 125 | 450M |
| Scale | 250 | 950M |
| Business | 500 | 2B |

## DAS API (Digital Asset Standard)

Comprehensive API for querying Solana digital assets — standard NFTs, compressed NFTs (cNFTs), fungible tokens, MPL Core Assets, and Token 2022 Assets. Available as a Marketplace add-on (Metaplex DAS API).

### Get Assets by Owner

```typescript
const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getAssetsByOwner",
    params: {
      ownerAddress: "E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk",
      limit: 10,
      options: { showFungible: true, showCollectionMetadata: true },
    },
  }),
});

const { result } = await response.json();
// result.total — total assets
// result.items — array of asset metadata
// result.cursor — for pagination
```

### Search Assets

```typescript
const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "searchAssets",
    params: {
      ownerAddress: "E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk",
      tokenType: "fungible",
      limit: 50,
    },
  }),
});
```

### Get Asset Proof (Compressed NFTs)

```typescript
const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getAssetProof",
    params: { id: "compressed_nft_id" },
  }),
});
```

### DAS Method Reference

| Method | Description |
|--------|-------------|
| `getAsset` | Get metadata for a single asset |
| `getAssets` | Get metadata for multiple assets |
| `getAssetProof` | Get Merkle proof for a compressed asset |
| `getAssetProofs` | Get Merkle proofs for multiple assets |
| `getAssetsByAuthority` | List assets by authority |
| `getAssetsByCreator` | List assets by creator |
| `getAssetsByGroup` | List assets by group (e.g., collection) |
| `getAssetsByOwner` | List assets by wallet owner |
| `getAssetSignatures` | Transaction signatures for compressed assets |
| `getTokenAccounts` | Token accounts by mint or owner |
| `getNftEditions` | Edition details of a master NFT |
| `searchAssets` | Search assets with flexible filters |

## Yellowstone gRPC (Solana Geyser)

High-performance Solana Geyser plugin for real-time blockchain data streaming via gRPC. Available as a Marketplace add-on.

### Setup

```typescript
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";

// Derive gRPC URL from HTTP endpoint:
// HTTP:  https://example.solana-mainnet.quiknode.pro/TOKEN/
// gRPC:  https://example.solana-mainnet.quiknode.pro:10000
const client = new Client(
  "https://example.solana-mainnet.quiknode.pro:10000",
  "TOKEN",
  {}
);

const stream = await client.subscribe();

stream.on("data", (data) => {
  if (data.transaction) {
    console.log("Transaction:", data.transaction);
  }
  if (data.account) {
    console.log("Account update:", data.account);
  }
});

// Subscribe to transactions for a specific program
stream.write({
  transactions: {
    txn_filter: {
      vote: false,
      failed: false,
      accountInclude: ["PROGRAM_PUBKEY"],
      accountExclude: [],
      accountRequired: [],
    },
  },
  accounts: {},
  slots: {},
  blocks: {},
  blocksMeta: {},
  transactionsStatus: {},
  entry: {},
  accountsDataSlice: [],
  commitment: CommitmentLevel.CONFIRMED,
});
```

### Filter Types

| Filter | Description |
|--------|-------------|
| **accounts** | Account data changes by pubkey, owner, or data pattern |
| **transactions** | Transaction events with vote/failure/account filters |
| **transactionsStatus** | Lightweight transaction status updates |
| **slots** | Slot progression and status changes |
| **blocks** | Full block data with optional tx/account inclusion |
| **blocksMeta** | Block metadata without full content

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/quicknode for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/quicknode
