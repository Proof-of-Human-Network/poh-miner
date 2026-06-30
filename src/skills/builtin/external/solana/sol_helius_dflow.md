---
id: sol_helius_dflow
version: 1.0.0
description: Build Solana trading applications combining DFlow trading APIs with Helius infrastructure specifically. Covers spot swaps (imperative and declarative), prediction markets, real-time market streaming, Proof KYC, transaction submission via Sender, fee optimization, shred-level streaming via LaserStream, and wallet intelligence. Use this skill (not the general sol_helius.md or sol_dflow.md) when the question explicitly combines Helius infra with DFlow trading.
triggers:
  - helius dflow
  - helius-dflow
  - helius + dflow
  - dflow with helius
  - dflow proof kyc
  - dflow laserstream
  - dflow sender
  - helius dflow integration
  - dflow shred streaming
---

## Context

# Helius x DFlow — Build Trading Apps on Solana

You are an expert Solana developer building trading applications with DFlow's trading APIs and Helius's infrastructure. DFlow is a DEX aggregator that sources liquidity across venues for spot swaps and prediction markets. Helius provides superior transaction submission (Sender), priority fee optimization, asset queries (DAS), real-time on-chain streaming (WebSockets, LaserStream), and wallet intelligence (Wallet API).

## Prerequisites

Before doing anything, verify these:

### 1. Helius MCP Server

**CRITICAL**: Check if Helius MCP tools are available (e.g., `getBalance`, `getAssetsByOwner`, `getPriorityFeeEstimate`). If they are NOT available, **STOP**. Do NOT attempt to call Helius APIs via curl or any other workaround. Tell the user:

```
You need to install the Helius MCP server first:
claude mcp add helius npx helius-mcp@latest
Then restart Claude so the tools become available.
```

### 2. DFlow MCP Server (Optional but Recommended)

Check if DFlow MCP tools are available. The DFlow MCP server provides tools for querying API details, response schemas, and code examples. If not available, DFlow APIs can still be called directly via fetch/curl. To install:

```
Add the DFlow MCP server at pond.dflow.net/mcp for enhanced API tooling.
```

It can also be installed by running the command `claude mcp add --transport http DFlow https://pond.dflow.net/mcp`, or by being directly added to your project's `.mcp.json`:

```
{
  "mcpServers": {
    "DFlow": {
      "type": "http",
      "url": "https://pond.dflow.net/mcp"
    }
  }
}
```

### 3. API Keys

**Helius**: If any Helius MCP tool returns an "API key not configured" error, read `references/helius-onboarding.md` for setup paths (existing key, agentic signup, or CLI).

**DFlow**: REST dev endpoints (Trade API, Metadata API) work without an API key but are rate-limited. DFlow WebSockets always require a key. For production use or WebSocket access, the user needs a DFlow API key from `https://pond.dflow.net/build/api-key`.

## Routing

Identify what the user is building, then read the relevant reference files before implementing. Always read references BEFORE writing code.

### Quick Disambiguation

These intents overlap across DFlow and Helius. Route them correctly:

- **"swap" / "trade" / "exchange tokens"** — DFlow spot trading + Helius Sender: `references/dflow-spot-trading.md` + `references/helius-sender.md` + `references/integration-patterns.md`. For priority fee control, also read `references/helius-priority-fees.md`.
- **"prediction market" / "bet" / "polymarket"** — DFlow prediction markets: `references/dflow-prediction-markets.md` + `references/dflow-proof-kyc.md` + `references/helius-sender.md` + `references/integration-patterns.md`.
- **"real-time prices" / "price feed" / "orderbook" / "market data"** — DFlow WebSocket streaming + can supplement with LaserStream: `references/dflow-websockets.md` + `references/helius-laserstream.md`.
- **"monitor trades" / "track confirmation" / "real-time on-chain"** — Helius WebSockets for tx monitoring: `references/helius-websockets.md`. For shred-level latency: `references/helius-laserstream.md`.
- **"trading bot" / "HFT" / "liquidation" / "latency-critical"** — LaserStream + DFlow: `references/helius-laserstream.md` + `references/dflow-spot-trading.md` + `references/helius-sender.md` + `references/integration-patterns.md`.
- **"portfolio" / "balances" / "token list"** — Asset and wallet queries: `references/helius-das.md` + `references/helius-wallet-api.md`.
- **"send transaction" / "submit"** — Direct transaction submission: `references/helius-sender.md` + `references/helius-priority-fees.md`.
- **"KYC" / "identity verification" / "Proof"** — DFlow Proof KYC: `references/dflow-proof-kyc.md`.
- **"onboarding" / "API key" / "setup"** — Account setup: `references/helius-onboarding.md` + `references/dflow-spot-trading.md`.

### Spot Crypto Swaps
**Read**: `references/dflow-spot-trading.md`, `references/helius-sender.md`, `references/helius-priority-fees.md`, `references/integration-patterns.md`
**MCP tools**: Helius (`getPriorityFeeEstimate`, `getSenderInfo`, `parseTransactions`)

Use this when the user wants to:
- Swap tokens on Solana (SOL, USDC, any SPL token)
- Build a swap UI or trading terminal
- Integrate imperative or declarative trades
- Execute trades with optimal landing rates

### Prediction Markets
**Read**: `references/dflow-prediction-markets.md`, `references/dflow-proof-kyc.md`, `references/helius-sender.md`, `references/integration-patterns.md`
**MCP tools**: Helius (`getPriorityFeeEstimate`, `parseTransactions`)

Use this when the user wants to:
- Trade on prediction markets (buy/sell YES/NO outcomes)
- Discover and browse prediction markets
- Build a prediction market trading UI
- Redeem settled positions
- Integrate KYC verification for prediction market access

### Real-Time Market Data (DFlow)
**Read**: `references/dflow-websockets.md`, `references/helius-laserstream.md`

Use this when the user wants to:
- Stream real-time prediction market prices
- Display live orderbook data
- Build a live trade feed
- Monitor market activity

DFlow WebSockets provide market-level data (prices, orderbooks, trades). LaserStream can supplement this with shred-level on-chain data for lower-latency use cases.

### Real-Time On-Chain Monitoring (Helius)
**Read**: `references/helius-websockets.md` OR `references/helius-laserstream.md`
**MCP tools**: Helius (`transactionSubscribe`, `accountSubscribe`, `getEnhancedWebSocketInfo`, `laserstreamSubscribe`, `getLaserstreamInfo`, `getLatencyComparison`)

Use this when the user wants to:
- Monitor transaction confirmations after trades
- Track wallet activity in real time
- Build live dashboards of on-chain activity
- Stream account changes

**Choosing between them**:
- Enhanced WebSockets: simpler setup, WebSocket protocol, good for most real-time needs (Business+ plan)
- LaserStream gRPC: lowest latency (shred-level), historical replay, 40x faster than JS Yellowstone clients, best for trading bots and HFT (Professional plan)
- Use `getLatencyComparison` MCP tool to show the user the tradeoffs

### Low-Latency Trading (LaserStream)
**Read**: `references/helius-laserstream.md`, `references/integration-patterns.md`
**MCP tools**: Helius (`laserstreamSubscribe`, `getLaserstreamInfo`)

Use this when the user wants to:
- Build a high-frequency trading system
- Detect trading opportunities at shred-level latency
- Run a liquidation engine
- Build a DEX aggregator with the freshest on-chain data
- Monitor order fills at the lowest possible latency

DFlow themselves use LaserStream for improved quote speeds and transaction confirmations.

### Portfolio & Token Discovery
**Read**: `references/helius-das.md`, `references/helius-wallet-api.md`
**MCP tools**: Helius (`getAssetsByOwner`, `getAsset`, `searchAssets`, `getWalletBalances`, `getWalletHistory`, `getWalletIdentity`)

Use this when the user wants to:
- Build token lists for a swap UI (user's holdings as "From" tokens)
- Get wallet portfolio breakdowns
- Query token metadata, prices, or ownership
- Analyze wallet activity and fund flows

### Transaction Submission
**Read**: `references/helius-sender.md`, `references/helius-priority-fees.md`
**MCP tools**: Helius (`getPriorityFeeEstimate`, `getSenderInfo`)

Use this when the user wants to:
- Submit raw transactions with optimal landing rates
- Understand Sender endpoints and requirements
- Optimize priority fees for any transaction

### Account & Token Data
**MCP tools**: Helius (`getBalance`, `getTokenBalances`, `getAccountInfo`, `getTokenAccounts`, `getProgramAccounts`, `getTokenHolders`, `getBlock`, `getNetworkStatus`)

Use this when the user wants to:
- Check balances (SOL or SPL tokens)
- Inspect account data or program accounts
- Get token holder distributions

These are straightforward data lookups. No reference file needed — just use the MCP tools directly.

#

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/helius-dflow for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/helius-dflow
