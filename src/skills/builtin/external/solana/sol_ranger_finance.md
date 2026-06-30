---
id: sol_ranger_finance
version: 1.0.0
description: Ranger Finance SDK for building perpetual futures trading applications on Solana. The first Solana Perps Aggregator - aggregates liquidity across multiple perp protocols (Drift, Flash, Adrena, Jupiter). Use when integrating perps trading, smart order routing, position management, or building AI trading agents. Distinct from Phoenix, which is a single perps exchange rather than an aggregator across venues.
triggers:
  - ranger finance
  - ranger-finance
  - ranger
  - perps aggregator
  - smart order routing
  - perps trading solana
  - ranger sdk
  - aggregate perp liquidity
  - drift flash adrena
  - ai trading agent perps
---

## Context

# Ranger Finance SDK Development Guide

A comprehensive guide for building Solana applications with Ranger Finance - the first perpetual futures aggregator on Solana.

## Overview

Ranger Finance is a Smart Order Router (SOR) that aggregates perpetual futures trading across multiple Solana protocols:

- **Drift Protocol**: Leading perps DEX on Solana
- **Flash Trade**: High-performance perpetuals
- **Adrena**: Leverage trading protocol
- **Jupiter Perps**: Jupiter's perpetuals platform

### Key Benefits

- **Best Execution**: Automatically routes orders to venues with best pricing
- **Unified API**: Single interface for all supported perp protocols
- **Position Aggregation**: View and manage positions across all venues
- **AI Agent Support**: Built-in MCP server for AI trading agents

## Quick Start

### Installation (TypeScript)

```bash
# Clone the SDK demo
git clone https://github.com/ranger-finance/sor-ts-demo.git
cd sor-ts-demo
npm install
```

### Environment Setup

Create a `.env` file:

```bash
RANGER_API_KEY=your_api_key_here
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
WALLET_PRIVATE_KEY=your_base58_private_key  # Optional, for signing
```

### Basic Setup

```typescript
import { SorApi, TradeSide } from 'ranger-sor-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Initialize the SOR API client
const sorApi = new SorApi({
  apiKey: process.env.RANGER_API_KEY!,
  solanaRpcUrl: process.env.SOLANA_RPC_URL,
});

// Your wallet public key
const walletAddress = 'YOUR_WALLET_PUBLIC_KEY';
```

## Core Concepts

### 1. Trade Sides

```typescript
type TradeSide = 'Long' | 'Short';
```

### 2. Adjustment Types

```typescript
type AdjustmentType =
  | 'Quote'           // Get a quote only
  | 'Increase'        // Open or increase position
  | 'DecreaseFlash'   // Decrease via Flash
  | 'DecreaseJupiter' // Decrease via Jupiter
  | 'DecreaseDrift'   // Decrease via Drift
  | 'DecreaseAdrena'  // Decrease via Adrena
  | 'CloseFlash'      // Close via Flash
  | 'CloseJupiter'    // Close via Jupiter
  | 'CloseDrift'      // Close via Drift
  | 'CloseAdrena'     // Close via Adrena
  | 'CloseAll';       // Close entire position
```

### 3. Position Interface

```typescript
interface Position {
  id: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  entry_price: number;
  liquidation_price: number;
  position_leverage: number;
  real_collateral: number;
  unrealized_pnl: number;
  borrow_fee: number;
  funding_fee: number;
  open_fee: number;
  close_fee: number;
  created_at: string;
  opened_at: string;
  platform: string;  // 'DRIFT', 'FLASH', 'ADRENA', 'JUPITER'
}
```

### 4. Quote Response

```typescript
interface Quote {
  base: number;
  fee: number;
  total: number;
  fee_breakdown: {
    base_fee: number;
    spread_fee: number;
    volatility_fee: number;
    margin_fee: number;
    close_fee: number;
    other_fees: number;
  };
}

interface VenueAllocation {
  venue_name: string;
  collateral: number;
  size: number;
  quote: Quote;
  order_available_liquidity: number;
  venue_available_liquidity: number;
}

interface OrderMetadataResponse {
  venues: VenueAllocation[];
  total_collateral: number;
  total_size: number;
}
```

## Trading Operations

### Get a Quote

Before executing a trade, get a quote to see pricing across venues:

```typescript
import { SorApi, OrderMetadataRequest, TradeSide } from 'ranger-sor-sdk';

const sorApi = new SorApi({ apiKey: process.env.RANGER_API_KEY! });

async function getQuote() {
  const request: OrderMetadataRequest = {
    fee_payer: walletAddress,
    symbol: 'SOL',
    side: 'Long' as TradeSide,
    size: 1.0,                        // 1 SOL position size
    collateral: 10.0,                 // 10 USDC collateral (10x leverage)
    size_denomination: 'SOL',
    collateral_denomination: 'USDC',
    adjustment_type: 'Quote',
  };

  const quote = await sorApi.getOrderMetadata(request);

  console.log('Available venues:');
  quote.venues.forEach(venue => {
    console.log(`  ${venue.venue_name}: ${venue.quote.total} USDC`);
  });

  return quote;
}
```

### Open/Increase a Position

```typescript
async function openLongPosition() {
  const request = {
    fee_payer: walletAddress,
    symbol: 'SOL',
    side: 'Long' as TradeSide,
    size: 1.0,
    collateral: 10.0,
    size_denomination: 'SOL',
    collateral_denomination: 'USDC',
    adjustment_type: 'Increase' as const,
  };

  // Get transaction instructions
  const response = await sorApi.increasePosition(request);

  console.log('Transaction message (base64):', response.message);

  if (response.meta) {
    console.log('Executed price:', response.meta.executed_price);
    console.log('Venues used:', response.meta.venues_used);
  }

  return response;
}

// Open a short position
async function openShortPosition() {
  const request = {
    fee_payer: walletAddress,
    symbol: 'ETH',
    side: 'Short' as TradeSide,
    size: 0.5,
    collateral: 100.0,
    size_denomination: 'ETH',
    collateral_denomination: 'USDC',
    adjustment_type: 'Increase' as const,
  };

  return await sorApi.increasePosition(request);
}
```

### Decrease a Position

```typescript
async function decreasePosition() {
  const request = {
    fee_payer: walletAddress,
    symbol: 'SOL',
    side: 'Long' as TradeSide,
    size: 0.5,                        // Decrease by 0.5 SOL
    collateral: 5.0,                  // Withdraw 5 USDC collateral
    size_denomination: 'SOL',
    collateral_denomination: 'USDC',
    adjustment_type: 'DecreaseFlash' as const,  // Route through Flash
  };

  return await sorApi.decreasePosition(request);
}
```

### Close a Position

```typescript
// Close entire position on a specific venue
async function closePosition() {
  const request = {
    fee_payer: walletAddress,
    symbol: 'SOL',
    side: 'Long' as TradeSide,
    adjustment_type: 'CloseFlash' as const,
  };

  return await sorApi.closePosition(request);
}

// Close all positions across all venues
async function closeAllPositions() {
  const request = {
    fee_payer: walletAddress,
    symbol: 'SOL',
    side: 'Long' as TradeSide,
    adjustment_type: 'CloseAll' as const,
  };

  return await sorApi.closePosition(request);
}
```

### Sign and Execute Transaction

```typescript
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

async function executeTradeWithSigning() {
  // Get transaction instructions
  const txResponse = await sorApi.increasePosition({
    fee_payer: walletAddress,
    symbol: 'SOL',
    side: 'Long',
    size: 1.0,
    collateral: 10.0,
    size_denomination: 'SOL',
    collateral_denomination: 'USDC',
    adjustment_type: 'Increase',
  });

  // Create keypair from private key
  const privateKeyBytes = bs58.decode(process.env.WALLET_PRIVATE_KEY!);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);

  // Define signing function
  const signTransaction = async (tx: VersionedTransaction) => {
    tx.sign([keypair]);
    return tx;
  };

  // Execute the transaction
  const result = await sorApi.executeTransaction(txResponse, signTransaction);

  console.log('Transaction signature:', result.signature);
  return result;
}
```

## Position Management

### Fetch All Positions

```typescript
async function getAllPositions() {
  const positions = await sorApi.getPositions(walletAddress);

  positions.positions.forEach(pos => {
    console.log(`${pos.symbol} ${pos.side}: ${pos.quantity} @ ${pos.entry_price}`);
    console.log(`  Platform: ${pos.platform}`);
    console.log(`  PnL: ${pos.unrealized_pnl}`);
    console.log(`  Liquidation: ${pos.liquidation_price}`);
  });

  return positions;
}
```

### Filter Positions by Platform

```typescript
async function getDriftPositions() {
  const positions = await sorApi.getPositions(walletAddress, {
    platforms: ['DRIFT'],
  });

  return positions;
}

async function getFlashAndAdrenaPositions() {
  const positions = await sorApi.getPositions(walletAddres

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/ranger-finance for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/ranger-finance
