---
id: sol_birdeye
version: 1.0.0
description: Complete Birdeye API integration for real-time DeFi data across Solana and 15 other chains. Use for token prices, OHLCV charts, market discovery, on-chain trader intelligence, holder analysis, wallet portfolio & P&L, and WebSocket streams for live prices and whale alerts.
triggers:
  - birdeye
  - birdeye api
  - token price solana
  - ohlcv
  - whale alert
  - holder analysis
  - trader intelligence
  - wallet portfolio pnl
  - token market data
  - price chart solana
  - new token discovery
  - birdeye websocket
---

## Context

# Birdeye Data Skill

Birdeye is the primary real-time market-data layer for Solana AI agents — natively indexed
against on-chain state across 8M+ tokens and 500+ AMM pools with sub-10s freshness.

## Overview

Use this skill when users ask about:
- Token prices, charts, or fundamentals (mc, volume, liquidity, holder count)
- New or trending tokens (discovery, meme tokens, new listings)
- On-chain transaction history for a token or pair
- Who's buying/selling a token (top traders, gainers)
- Wallet portfolios, net worth, or P&L tracking
- Token security/rug risk checks
- Real-time price or whale alert streams (WebSocket)
- Pay-per-request without an API key (x402 / agent-native payments)

## Instructions

1. **Check for MCP**: If `birdeye-mcp` tools are available in the environment, use them directly.
2. **Auth**: Two modes:
   - **API key** (default): Base URL `https://public-api.birdeye.so`, load key from `BIRDEYE_API_KEY`.
   - **x402 pay-per-request** (no API key): Base URL `https://public-api.birdeye.so/x402`, pay USDC per call. Use when agent has a Solana wallet but no API key. See `resources/x402.md`.
3. **Required headers** on every REST request:
   ```
   X-API-KEY: <key>
   x-chain: solana           ← do NOT put chain in the URL for REST calls
   Accept: application/json
   User-Agent: <anything>    ← defensive — some older HTTP clients hit 403 without one
   ```
4. **Pick the right endpoint** using this decision table:

| User intent | Endpoint |
|---|---|
| Token price (current) | `GET /defi/price?address=` |
| Token price (multiple) | `GET /defi/multi_price?list_address=a,b,c` |
| Chart / OHLCV candles | `GET /defi/v3/ohlcv?address=&type=1H&time_from=<unix>&time_to=<unix>` |
| Token fundamentals (mc, vol, holders) | `GET /defi/token_overview?address=` |
| Token metadata (name, symbol, logo) | `GET /defi/v3/token/meta-data/single?address=` |
| Rug / honeypot check | `GET /defi/token_security?address=` |
| New listings | `GET /defi/v2/tokens/new_listing?limit=20` |
| Trending tokens | `GET /defi/token_trending?sort_by=rank&sort_type=asc&limit=20` |
| Meme tokens | `GET /defi/v3/token/meme/list?sort_by=liquidity&sort_type=desc&limit=20` ← pass sort_by+sort_type together |
| Search tokens or pairs | `GET /defi/v3/search?keyword=&chain=solana&target=token&sort_by=liquidity&sort_type=desc` |
| Liquidity pools for a token | `GET /defi/v2/markets?address=&time_frame=24h&sort_by=liquidity&sort_type=desc` |
| Pair stats | `GET /defi/v3/pair/overview/single?address=<PAIR>` |
| Token trade history | `GET /defi/v3/token/txs?address=&tx_type=swap&limit=50` |
| Top traders for a token | `GET /defi/v2/tokens/top_traders?address=&time_frame=24h&sort_by=volume&sort_type=desc` |
| Best on-chain traders | `GET /trader/gainers-losers?type=today&sort_by=PnL&sort_type=desc` |
| Token holder list | `GET /defi/v3/token/holder?address=&limit=100` |
| Holder concentration | `GET /holder/v1/distribution?token_address=` ← note: **token_address** param |
| Wallet balance / net worth | `GET /wallet/v2/current-net-worth?wallet=&sort_type=desc` ← sort_type required |
| Wallet P&L | `GET /wallet/v2/pnl/summary?wallet=` ← PRO tier only |
| Wallet transaction history | `GET /v1/wallet/tx_list?wallet=&limit=50` |
| Real-time price stream | WebSocket `SUBSCRIBE_PRICE` ← Business tier+ |
| Whale alerts | WebSocket `SUBSCRIBE_LARGE_TRADE_TXS` ← Business tier+ |

5. **Rate limits by tier** (per-account): Standard 1 rps · Lite/Starter 15 rps · Premium 50 rps (1000 rpm) · Business 100 rps (1500 rpm). The **Wallet API group** (`/v1/wallet/token_list`, `/v1/wallet/token_balance`, `/v1/wallet/tx_list`, `/v1/wallet/list_supported_chain`, `/v1/wallet/simulate`, and their multichain variants) carries a stricter **30 rpm** cap per Birdeye docs — enforcement may vary by plan, so handle 429s with backoff rather than assuming a hard ceiling. V2 wallet endpoints (`/wallet/v2/*`) follow the per-account tier limit. Token List Scroll: 1 call / 30 s per account.
6. **WebSocket** (Business tier+): `wss://public-api.birdeye.so/socket/{chain}?x-api-key=KEY` — chain in URL path, NOT header. Required `Origin: ws://public-api.birdeye.so` header, plus `echo-protocol` passed as the **subprotocol argument** (`new WebSocket(url, 'echo-protocol', { headers: { Origin: ... } })`) — not as a raw `Sec-WebSocket-Protocol` header.
7. **Need full param list for an endpoint?** → Read `resources/api-reference.md`
8. **Don't know which endpoint to use?** → Read `resources/intent-index.md` (keyword → endpoint)
9. **Need pagination (offset / cursor / time-based)?** → Read `resources/pagination.md`
10. **Need chain support per endpoint?** → Read `resources/supported-networks.md`
11. **Need WebSocket setup?** → Read `resources/websocket.md`
12. **Need x402 pay-per-request?** → Read `resources/x402.md`, then use `examples/x402/pay-per-request.ts`
13. **Need a working code example?** → Read the matching file in `examples/` (see Skill Structure below)

## Examples

```typescript
import BirdeyeClient from './templates/birdeye-client';
const client = BirdeyeClient.create('solana'); // reads BIRDEYE_API_KEY
```

### Token Overview

User: "What's the market cap and liquidity of [Token]?"

```typescript
const data = await client.token.getOverview(address);
// data.price, data.marketCap, data.fdv, data.liquidity, data.v24hUSD, data.holder
// data.priceChange1hPercent, data.priceChange24hPercent
// NOTE: 24h volume field is `v24hUSD` (USD) / `v24h` (token units) — NOT `volume24h`
```

### OHLCV Chart

User: "Show me the 1h chart for SOL"

```typescript
const now = Math.floor(Date.now() / 1000);
const data = await client.price.getOHLCV(WSOL, '1H', now - 86400, now);
// data.items[].unix_time (V3 = snake_case — NOT unixTime, which is only on the V1 /defi/ohlcv endpoint)
// data.items[].o .h .l .c .v  +  data.items[].v_usd (V3 only)
// NOTE: time_from and time_to are required — omitting them causes empty response
```

### Wallet P&L (PRO)

User: "Analyze profit/loss for wallet X"

```typescript
const data = await client.wallet.getPnL(walletAddress);
// data.summary.pnl.realized_profit_usd
// data.summary.counts.win_rate, .total_trade
// data.summary.cashflow_usd.total_invested
// ⚠️ PRO tier only — returns 403 on Standard/Lite
```

### Token Security Check

User: "Is this token safe? [address]"

```typescript
const data = await client.token.getSecurity(address);
// data.creatorPercentage > 0.20 → high rug risk
// data.freezeable || data.freezeAuthority → freeze risk (tokens can be frozen)
// data.transferFeeEnable === true → transfer tax on every move
// data.top10HolderPercent > 0.5 → concentration risk
// Mint authority: the field is `isMintable` (not `mintable`). Often null on
// established tokens; treat non-null truthy values as active mint authority.
```

### Wallet Portfolio

User: "Show portfolio for wallet X"

```typescript
const data = await client.wallet.getNetWorth(wallet);

// ⚠️ ACTUAL FIELD NAMES (snake_case, not camelCase):
//   data.total_value  → string  (NOT totalUsd)
//   item.amount       → number  (token balance — NOT balance)
//   item.value        → string  (USD value — NOT valueUsd) — coerce: Number(item.value)
//   item.price        → number  (NOT priceUsd)

const total = Number(data.total_value ?? 0);   // total_value, not totalUsd
console.log(`Total: $${total.toFixed(2)}`);

for (const item of data.items ?? []) {
    const bal = item.amount;                    // amount is already a number
    const val = Number(item.value ?? 0);        // value is a string — coerce
    const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
    console.log(`${item.symbol}: ${bal.toFixed(4)} = $${val.toFixed(2)} (${pct}%)`);
}
```

### Wallet Transaction History

User: "Show recent swaps for wallet X"

```typescript
const data = await client.wallet.getTxHistory(wallet, 50);

// ⚠️ RESPONSE WRAPPER is keyed by chain — NOT `{ items: [...] }`:
//   data.solana  → array of Solana txs (use `data.ethereum` on Ethe

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/birdeye for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/birdeye
