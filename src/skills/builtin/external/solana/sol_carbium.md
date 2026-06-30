---
id: sol_carbium
version: 1.0.0
description: Build on Solana with Carbium infrastructure — bare-metal RPC, Standard WebSocket pubsub, gRPC Full Block streaming (~22ms), DEX aggregation via CQ1 engine (sub-ms quotes), gasless swaps, and MEV-protected execution via Jito bundling. Drop-in replacement for Helius, QuickNode, Triton, or Jupiter Swap API.
triggers:
  - carbium
  - carbium rpc
  - cq1 engine
  - bare-metal rpc solana
  - gasless swap solana
  - jito bundling
  - mev-protected execution
  - grpc block streaming
  - low-latency rpc solana
  - carbium dex aggregation
---

## Context

# Carbium — Full-Stack Solana Infrastructure

Carbium is bare-metal Solana infrastructure — Swiss-engineered, no cloud middlemen. One platform covering the full transaction lifecycle.

## Overview

| Product | Endpoint | Purpose |
|---|---|---|
| **RPC** | `https://rpc.carbium.io` | Standard JSON-RPC for reads, writes, subscriptions |
| **Standard WebSocket** | `wss://wss-rpc.carbium.io` | Native Solana pubsub (account changes, slots, logs, signatures) |
| **gRPC / Stream** | `wss://grpc.carbium.io` | Yellowstone Full Block streaming (~22ms latency) |
| **Swap API** | `https://api.carbium.io` | DEX aggregation and execution powered by CQ1 engine |
| **DEX App** | `https://app.carbium.io` | Consumer-facing trading interface |
| **Docs** | `https://docs.carbium.io` | Full documentation |

**Key differentiators:**
- **Sub-millisecond DEX quotes** via CQ1 routing engine with binary-native state
- **~22ms Full Block gRPC** — atomic, complete blocks (no shred reassembly)
- **Gasless swaps** — users trade without holding SOL
- **MEV protection** — Jito bundling built into Swap API
- **Swiss bare-metal servers** — sub-50ms RPC latency, 99.99% uptime

---

## When to Use This Skill

| I want to... | Use | Key needed |
|---|---|---|
| Read account data / balances | RPC | RPC key |
| Send a transaction | RPC | RPC key |
| Monitor a wallet in real time | Standard WebSocket | RPC key |
| Confirm a transaction without polling | Standard WebSocket | RPC key |
| Watch program account changes | Standard WebSocket | RPC key |
| Build a wallet app | RPC + Swap API | Both |
| Get a token swap quote | Swap API | API key |
| Execute a swap programmatically | Swap API | API key |
| Execute a swap with Jito bundling | Swap API (bundle endpoint) | API key |
| Compare quotes across all DEX providers | Swap API (quote/all) | API key |
| Swap without users holding SOL | Swap API (gasless flag) | API key |
| Snipe pump.fun tokens (pre-graduation) | gRPC + direct bonding curve tx | RPC key (Business+) |
| React to on-chain events in real time | gRPC (streaming) | RPC key (Business+) |
| Index transactions for a program | gRPC (streaming) | RPC key (Business+) |
| Build an arbitrage / MEV bot | gRPC + Swap API | Both |

---

## Quick Start

### 1. Get API Keys

| Product | Signup | Notes |
|---|---|---|
| RPC + gRPC + WebSocket | [rpc.carbium.io/signup](https://rpc.carbium.io/signup) | One key covers RPC, WebSocket, and gRPC |
| Swap API | [api.carbium.io/login](https://api.carbium.io/login) | Separate key, free account, instant |

Programmatic key provisioning is not yet available. Keys must be created via the dashboards.

### 2. Set Environment Variables

```bash
export CARBIUM_RPC_KEY="your-rpc-key"
export CARBIUM_API_KEY="your-swap-api-key"
```

### 3. Security Rules (Non-Negotiable)

- Never embed keys in frontend/client-side code
- Never commit keys to version control
- Use environment variables: `CARBIUM_RPC_KEY`, `CARBIUM_API_KEY`
- Rotate immediately if exposed
- Keep keys server-side only

---

## Pricing Tiers

| Tier | Price | Credits/mo | Max RPS | gRPC | WebSocket |
|---|---|---|---|---|---|
| Free | $0 | 500K | 10 | No | Yes |
| Developer | $32/mo | 10M | 50 | No | Yes |
| Business | $320/mo | 100M | 200 | Yes | Yes |
| Professional | $640/mo | 200M | 500 | Yes | Yes |

gRPC streaming requires Business tier or above.

---

## RPC

Standard Solana JSON-RPC. Any Solana SDK works: `@solana/web3.js`, `solana-py`, `solana` Rust crate.

**Endpoint:**

```
https://rpc.carbium.io/?apiKey=YOUR_RPC_KEY
```

### TypeScript

```typescript
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const connection = new Connection(
  `https://rpc.carbium.io/?apiKey=${process.env.CARBIUM_RPC_KEY}`,
  "confirmed"
);

// Read balance
const pubkey = new PublicKey("YOUR_WALLET_ADDRESS");
const balance = await connection.getBalance(pubkey);
console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

// Send transaction
const sig = await connection.sendRawTransaction(transaction.serialize(), {
  skipPreflight: false,
  maxRetries: 3,
});
await connection.confirmTransaction(sig, "confirmed");
```

### Python

```python
from solana.rpc.api import Client
from solders.pubkey import Pubkey
import os

rpc = Client(f"https://rpc.carbium.io/?apiKey={os.environ['CARBIUM_RPC_KEY']}")
pubkey = Pubkey.from_string("YOUR_WALLET_ADDRESS")
resp = rpc.get_balance(pubkey)
print(f"Balance: {resp.value / 1e9} SOL")
```

### Rust

```rust
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

let url = format!(
    "https://rpc.carbium.io/?apiKey={}",
    std::env::var("CARBIUM_RPC_KEY").unwrap()
);
let client = RpcClient::new(url);
let pubkey = Pubkey::from_str("YOUR_WALLET_ADDRESS").unwrap();
let balance = client.get_balance(&pubkey).unwrap();
println!("Balance: {} lamports", balance);
```

### Commitment Levels

| Level | Speed | Guarantee | Use for |
|---|---|---|---|
| `processed` | ~400ms | May roll back | Price feeds, low-stakes UX |
| `confirmed` | ~2s | Supermajority voted | **Default — best balance** |
| `finalized` | ~32s | Fully finalized | Irreversible confirmations, high-value ops |

---

## Standard WebSocket (Solana Pubsub)

Native Solana WebSocket pubsub — any SDK built for Solana WebSocket works with zero modifications.

**Endpoint:**

```
wss://wss-rpc.carbium.io/?apiKey=YOUR_RPC_KEY
```

Auth: same RPC key as query parameter. Available on all tiers (Developer and above recommended for production).

### WSS vs gRPC — When to Use Which

| | Standard WSS | gRPC / Yellowstone |
|---|---|---|
| **Protocol** | JSON-RPC over WebSocket | Binary protobuf over WebSocket (or HTTP/2) |
| **What you get** | Account changes, slot updates, logs, signatures | Full atomic blocks, all transactions |
| **SDK support** | Any Solana SDK (`@solana/web3.js`, `solana-py`) | Yellowstone client or raw WS with JSON filter |
| **Latency** | Sub-100ms subscription ack | ~22ms full block delivery |
| **Tier required** | Developer+ | Business+ |
| **Best for** | Wallets, dApps, monitoring specific accounts | MEV bots, indexers, full-block processing |

**Rule of thumb:** watching specific accounts or signatures → WSS. Processing all transactions or need full block data → gRPC.

### Subscription Methods

| Method | What it streams | Typical use case |
|---|---|---|
| `slotSubscribe` | New slot numbers | Block clock, liveness checks |
| `rootSubscribe` | Finalized slots | Finality tracking |
| `accountSubscribe` | Account data changes | Wallet balance updates, PDA state changes |
| `programSubscribe` | All accounts owned by a program | DEX pool state, staking updates |
| `signatureSubscribe` | Transaction confirmation status | Confirm sent transactions in real time |
| `logsSubscribe` | Transaction logs matching filter | Program event monitoring |
| `blockSubscribe` | Full block data | Block explorers, indexers |
| `slotsUpdatesSubscribe` | Detailed slot lifecycle events | Advanced timing, validator monitoring |
| `voteSubscribe` | Vote transactions | Validator monitoring |

### TypeScript — Watch a Wallet

```typescript
import WebSocket from "ws";

const ws = new WebSocket(
  `wss://wss-rpc.carbium.io/?apiKey=${process.env.CARBIUM_RPC_KEY}`
);

ws.on("open", () => {
  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "accountSubscribe",
    params: [
      "YOUR_WALLET_ADDRESS",
      { encoding: "base64", commitment: "confirmed" },
    ],
  }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.result !== undefined) {
    console.log(`Subscribed, id: ${msg.result}`);
    return;
  }
  if (msg.method === "accountNotification") {
    const { lamports } = msg.params.result.value;
    console.log(`Balance changed: ${lamports / 1e9} SOL`);
  }
});
```

### TypeScript — Confirm Transaction via WSS

```typescript
ws.send(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "signatureSubscribe",
  params: ["YO

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/carbium for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/carbium
