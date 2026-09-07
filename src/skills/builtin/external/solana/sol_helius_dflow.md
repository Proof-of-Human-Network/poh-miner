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

**Helius**: If any Helius MCP tool returns an "API key not configured" error, See `helius onboarding` (reference not bundled) for setup paths (existing key, agentic signup, or CLI).

**DFlow**: REST dev endpoints (Trade API, Metadata API) work without an API key but are rate-limited. DFlow WebSockets always require a key. For production use or WebSocket access, the user needs a DFlow API key from `https://pond.dflow.net/build/api-key`.

## Routing

Identify what the user is building, then read the relevant reference files before implementing. Always read references BEFORE writing code.

### Quick Disambiguation

These intents overlap across DFlow and Helius. Route them correctly:

- **"swap" / "trade" / "exchange tokens"** — DFlow spot trading + Helius Sender: `dflow spot trading` (reference not bundled) + `helius sender` (reference not bundled) + `integration patterns` (reference not bundled). For priority fee control, also See `helius priority fees` (reference not bundled).
- **"prediction market" / "bet" / "polymarket"** — DFlow prediction markets: `dflow prediction markets` (reference not bundled) + `dflow proof kyc` (reference not bundled) + `helius sender` (reference not bundled) + `integration patterns` (reference not bundled).
- **"real-time prices" / "price feed" / "orderbook" / "market data"** — DFlow WebSocket streaming + can supplement with LaserStream: `dflow websockets` (reference not bundled) + `helius laserstream` (reference not bundled).
- **"monitor trades" / "track confirmation" / "real-time on-chain"** — Helius WebSockets for tx monitoring: `helius websockets` (reference not bundled). For shred-level latency: `helius laserstream` (reference not bundled).
- **"trading bot" / "HFT" / "liquidation" / "latency-critical"** — LaserStream + DFlow: `helius laserstream` (reference not bundled) + `dflow spot trading` (reference not bundled) + `helius sender` (reference not bundled) + `integration patterns` (reference not bundled).
- **"portfolio" / "balances" / "token list"** — Asset and wallet queries: `helius das` (reference not bundled) + `helius wallet api` (reference not bundled).
- **"send transaction" / "submit"** — Direct transaction submission: `helius sender` (reference not bundled) + `helius priority fees` (reference not bundled).
- **"KYC" / "identity verification" / "Proof"** — DFlow Proof KYC: `dflow proof kyc` (reference not bundled).
- **"onboarding" / "API key" / "setup"** — Account setup: `helius onboarding` (reference not bundled) + `dflow spot trading` (reference not bundled).

### Spot Crypto Swaps
**See** `dflow spot trading` (reference not bundled), `helius sender` (reference not bundled), `helius priority fees` (reference not bundled), `integration patterns` (reference not bundled)
**MCP tools**: Helius (`getPriorityFeeEstimate`, `getSenderInfo`, `parseTransactions`)

Use this when the user wants to:
- Swap tokens on Solana (SOL, USDC, any SPL token)
- Build a swap UI or trading terminal
- Integrate imperative or declarative trades
- Execute trades with optimal landing rates

### Prediction Markets
**See** `dflow prediction markets` (reference not bundled), `dflow proof kyc` (reference not bundled), `helius sender` (reference not bundled), `integration patterns` (reference not bundled)
**MCP tools**: Helius (`getPriorityFeeEstimate`, `parseTransactions`)

Use this when the user wants to:
- Trade on prediction markets (buy/sell YES/NO outcomes)
- Discover and browse prediction markets
- Build a prediction market trading UI
- Redeem settled positions
- Integrate KYC verification for prediction market access

### Real-Time Market Data (DFlow)
**See** `dflow websockets` (reference not bundled), `helius laserstream` (reference not bundled)

Use this when the user wants to:
- Stream real-time prediction market prices
- Display live orderbook data
- Build a live trade feed
- Monitor market activity

DFlow WebSockets provide market-level data (prices, orderbooks, trades). LaserStream can supplement this with shred-level on-chain data for lower-latency use cases.

### Real-Time On-Chain Monitoring (Helius)
**See** `helius websockets` (reference not bundled) OR `helius laserstream` (reference not bundled)
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
**See** `helius laserstream` (reference not bundled), `integration patterns` (reference not bundled)
**MCP tools**: Helius (`laserstreamSubscribe`, `getLaserstreamInfo`)

Use this when the user wants to:
- Build a high-frequency trading system
- Detect trading opportunities at shred-level latency
- Run a liquidation engine
- Build a DEX aggregator with the freshest on-chain data
- Monitor order fills at the lowest possible latency

DFlow themselves use LaserStream for improved quote speeds and transaction confirmations.

### Portfolio & Token Discovery
**See** `helius das` (reference not bundled), `helius wallet api` (reference not bundled)
**MCP tools**: Helius (`getAssetsByOwner`, `getAsset`, `searchAssets`, `getWalletBalances`, `getWalletHistory`, `getWalletIdentity`)

Use this when the user wants to:
- Build token lists for a swap UI (user's holdings as "From" tokens)
- Get wallet portfolio breakdowns
- Query token metadata, prices, or ownership
- Analyze wallet activity and fund flows

### Transaction Submission
**See** `helius sender` (reference not bundled), `helius priority fees` (reference not bundled)
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
