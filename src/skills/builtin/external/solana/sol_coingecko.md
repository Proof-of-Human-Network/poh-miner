---
id: sol_coingecko
version: 1.0.0
description: Complete CoinGecko Solana API integration for token prices, DEX pool data, OHLCV charts, trades, and market analytics. Use for building trading bots, portfolio trackers, price feeds, and on-chain data applications.
triggers:
  - coingecko
---

## Context

# CoinGecko Solana API Development Guide

A comprehensive guide for integrating CoinGecko's on-chain API for Solana. Access real-time token prices, DEX pool data, OHLCV charts, trade history, and market analytics across 1,700+ decentralized exchanges.

## Overview

CoinGecko's Solana API provides:
- **Token Prices**: Real-time prices by contract address (single or batch)
- **Pool Data**: Liquidity pool information, trending pools, top pools
- **OHLCV Charts**: Candlestick data for technical analysis
- **Trade History**: Recent trades for any pool
- **DEX Discovery**: List all DEXes operating on Solana
- **Search**: Find pools by token name, symbol, or address
- **Megafilter**: Advanced filtering across pools, tokens, and DEXes

### Key Features

| Feature | Description |
|---------|-------------|
| **250+ Networks** | Multi-chain support including Solana |
| **1,700+ DEXes** | Raydium, Orca, Jupiter, Meteora, Pump.fun, etc. |
| **15M+ Tokens** | Comprehensive token coverage |
| **Real-time Data** | Updates every 10-30 seconds |
| **Historical Data** | OHLCV charts and trade history |

---

## Quick Start

### Get Your API Key

1. **Demo API (Free)**: Visit [coingecko.com/en/api](https://www.coingecko.com/en/api)
2. **Pro API (Paid)**: Visit [coingecko.com/en/api/pricing](https://www.coingecko.com/en/api/pricing)

### Environment Setup

```bash
# .env file
COINGECKO_API_KEY=your_api_key_here
COINGECKO_API_TYPE=demo  # or 'pro'
```

### API Configuration

```typescript
// Configuration for both Demo and Pro APIs
const CONFIG = {
  demo: {
    baseUrl: 'https://api.coingecko.com/api/v3/onchain',
    headerKey: 'x-cg-demo-api-key',
    rateLimit: 30, // calls per minute
  },
  pro: {
    baseUrl: 'https://pro-api.coingecko.com/api/v3/onchain',
    headerKey: 'x-cg-pro-api-key',
    rateLimit: 500, // calls per minute (varies by plan)
  },
};

const apiType = process.env.COINGECKO_API_TYPE || 'demo';
const apiKey = process.env.COINGECKO_API_KEY;

const BASE_URL = CONFIG[apiType].baseUrl;
const HEADER_KEY = CONFIG[apiType].headerKey;

// Solana network identifier
const NETWORK = 'solana';
```

### Basic Token Price Fetch

```typescript
async function getTokenPrice(tokenAddress: string): Promise<number | null> {
  const url = `${BASE_URL}/simple/networks/${NETWORK}/token_price/${tokenAddress}`;

  const response = await fetch(url, {
    headers: {
      [HEADER_KEY]: apiKey,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data?.attributes?.token_prices?.[tokenAddress] ?? null;
}

// Usage
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const price = await getTokenPrice(USDC);
console.log(`USDC Price: $${price}`);
```

---

## API Endpoints Reference

### Simple Token Price

Get token prices by contract address.

**Endpoint**: `GET /simple/networks/{network}/token_price/{addresses}`

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `network` | string | Yes | Network ID (`solana`) |
| `addresses` | string | Yes | Comma-separated token addresses (max 30 Demo, 100 Pro) |
| `include_market_cap` | boolean | No | Include market cap data |
| `include_24hr_vol` | boolean | No | Include 24h volume |
| `include_24hr_price_change` | boolean | No | Include 24h price change % |

```typescript
async function getTokenPrices(addresses: string[]): Promise<Record<string, TokenPriceData>> {
  const addressList = addresses.join(',');
  const url = `${BASE_URL}/simple/networks/${NETWORK}/token_price/${addressList}`;

  const params = new URLSearchParams({
    include_market_cap: 'true',
    include_24hr_vol: 'true',
    include_24hr_price_change: 'true',
  });

  const response = await fetch(`${url}?${params}`, {
    headers: { [HEADER_KEY]: apiKey },
  });

  const data = await response.json();
  return data.data?.attributes || {};
}
```

---

### Token Data by Address

Get detailed token information.

**Endpoint**: `GET /networks/{network}/tokens/{address}`

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `network` | string | Yes | Network ID |
| `address` | string | Yes | Token contract address |
| `include` | string | No | Include `top_pools` for liquidity data |

```typescript
interface TokenData {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  image_url: string;
  price_usd: string;
  fdv_usd: string;
  market_cap_usd: string;
  total_supply: string;
  volume_usd: {
    h24: string;
  };
  price_change_percentage: {
    h24: string;
  };
}

async function getTokenData(address: string): Promise<TokenData> {
  const url = `${BASE_URL}/networks/${NETWORK}/tokens/${address}?include=top_pools`;

  const response = await fetch(url, {
    headers: { [HEADER_KEY]: apiKey },
  });

  const data = await response.json();
  return data.data?.attributes;
}
```

---

### Multi-Token Data

Batch fetch multiple tokens.

**Endpoint**: `GET /networks/{network}/tokens/multi/{addresses}`

```typescript
async function getMultipleTokens(addresses: string[]): Promise<TokenData[]> {
  const addressList = addresses.join(',');
  const url = `${BASE_URL}/networks/${NETWORK}/tokens/multi/${addressList}`;

  const response = await fetch(url, {
    headers: { [HEADER_KEY]: apiKey },
  });

  const data = await response.json();
  return data.data?.map((item: any) => item.attributes) || [];
}
```

---

### Pool Data by Address

Get detailed pool information.

**Endpoint**: `GET /networks/{network}/pools/{address}`

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `include` | string | No | `base_token`, `quote_token`, `dex` |
| `include_volume_breakdown` | boolean | No | Volume breakdown by timeframe |

```typescript
interface PoolData {
  address: string;
  name: string;
  pool_created_at: string;
  base_token_price_usd: string;
  quote_token_price_usd: string;
  base_token_price_native_currency: string;
  fdv_usd: string;
  market_cap_usd: string;
  reserve_in_usd: string;
  price_change_percentage: {
    m5: string;
    h1: string;
    h6: string;
    h24: string;
  };
  transactions: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume_usd: {
    m5: string;
    h1: string;
    h6: string;
    h24: string;
  };
}

async function getPoolData(poolAddress: string): Promise<PoolData> {
  const url = `${BASE_URL}/networks/${NETWORK}/pools/${poolAddress}`;

  const params = new URLSearchParams({
    include: 'base_token,quote_token,dex',
  });

  const response = await fetch(`${url}?${params}`, {
    headers: { [HEADER_KEY]: apiKey },
  });

  const data = await response.json();
  return data.data?.attributes;
}
```

---

### Trending Pools

Get trending pools across all networks or filtered by network.

**Endpoint**: `GET /networks/trending_pools`

**Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `include` | string | `base_token` | Attributes to include |
| `page` | integer | 1 | Page number |
| `duration` | string | `24h` | `5m`, `1h`, `6h`, `24h` |

```typescript
async function getTrendingPools(duration: '5m' | '1h' | '6h' | '24h' = '24h'): Promise<PoolData[]> {
  const url = `${BASE_URL}/networks/trending_pools`;

  const params = new URLSearchParams({
    include: 'base_token,quote_token,dex,network',
    duration,
    page: '1',
  });

  const response = await fetch(`${url}?${params}`, {
    headers: { [HEADER_KEY]: apiKey },
  });

  const data = await response.json();
  return data.data?.map((item: any) => item.attributes) || [];
}

// Filter for Solana pools
async function getSolanaTrendingPools(): Promise<PoolData[]> {
  const allPools = await getTrendingPools();
  return allPools.filter(pool => po

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/coingecko for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/coingecko
