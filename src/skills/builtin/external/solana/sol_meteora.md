---
id: sol_meteora
version: 1.0.0
description: Complete Meteora DeFi SDK suite for building liquidity pools, AMMs, bonding curves, vaults, token launches, and zap operations on Solana. Use when integrating DLMM, DAMM v2, DAMM v1, Dynamic Bonding Curves, Alpha Vaults, Zap, or Stake-for-Fee functionality.
triggers:
  - meteora
---

## Context

# Meteora Protocol Development Guide

A comprehensive guide for building Solana DeFi applications with Meteora's suite of SDKs - the leading liquidity infrastructure on Solana.

## What is Meteora?

Meteora is Solana's premier liquidity layer, powering the infrastructure that connects liquidity providers (LPs), token launchers, and traders. It offers:

- **$2B+ Total Value Locked** across all protocols
- **Multiple AMM Types** - DLMM (concentrated), DAMM v2/v1 (constant product)
- **Token Launch Infrastructure** - Dynamic Bonding Curves, Alpha Vault anti-bot protection
- **Yield Optimization** - Dynamic Vaults, Stake-for-Fee (M3M3)
- **Developer Tools** - TypeScript/Go SDKs, CLI tools, Zap for single-token entry

### Why Use Meteora?

| Feature | Benefit |
|---------|---------|
| **Low Pool Creation Cost** | 0.022 SOL (vs 0.25+ SOL on competitors) |
| **Dynamic Fees** | Volatility-adjusted fees maximize LP returns |
| **Anti-Snipe Protection** | Fee schedulers and Alpha Vault prevent bot exploitation |
| **Token-2022 Support** | Full Token Extensions compatibility |
| **Permissionless** | Create pools, farms, and launches without approval |
| **Auto-Graduation** | Bonding curves auto-migrate to AMM pools |

## Overview

Meteora provides a complete DeFi infrastructure stack on Solana:

- **DLMM (Dynamic Liquidity Market Maker)**: Concentrated liquidity with dynamic fees
- **DAMM v2 (Dynamic AMM)**: Next-generation constant product AMM with position NFTs
- **DAMM v1 (Legacy AMM)**: Original constant product AMM with stable/weighted pools
- **Dynamic Bonding Curve**: Customizable token launch curves with auto-graduation
- **Dynamic Vault**: Yield-optimized token vaults
- **Alpha Vault**: Anti-bot protection for token launches
- **Stake-for-Fee (M3M3)**: Staking rewards from trading fees
- **Zap SDK**: Single-token entry/exit for liquidity positions
- **Presale Vault** *(Beta)*: Token presale infrastructure

## Quick Start

### Installation

```bash
# DLMM SDK - Concentrated liquidity
npm install @meteora-ag/dlmm @coral-xyz/anchor @solana/web3.js

# DAMM v2 SDK - Next-gen constant product AMM
npm install @meteora-ag/cp-amm-sdk @solana/web3.js

# DAMM v1 SDK - Legacy AMM (stable pools, weighted pools)
npm install @meteora-ag/dynamic-amm @solana/web3.js @coral-xyz/anchor

# Dynamic Bonding Curve SDK - Token launches
npm install @meteora-ag/dynamic-bonding-curve-sdk

# Vault SDK - Yield optimization
npm install @meteora-ag/vault-sdk @coral-xyz/anchor @solana/web3.js @solana/spl-token

# Alpha Vault SDK - Anti-bot protection
npm install @meteora-ag/alpha-vault

# Stake-for-Fee (M3M3) SDK - Fee staking
npm install @meteora-ag/m3m3 @coral-xyz/anchor @solana/web3.js @solana/spl-token

# Zap SDK - Single-token entry/exit (requires Jupiter API key)
npm install @meteora-ag/zap-sdk

# Pool Farms SDK - Farm creation and staking
npm install @meteora-ag/farming
```

### Program Addresses

| Program | Mainnet/Devnet Address |
|---------|------------------------|
| DLMM | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` |
| DAMM v2 | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` |
| DAMM v1 | `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB` |
| Dynamic Bonding Curve | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` |
| Dynamic Vault | `24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi` |
| Stake-for-Fee | `FEESngU3neckdwib9X3KWqdL7Mjmqk9XNp3uh5JbP4KP` |
| Zap | `zapvX9M3uf5pvy4wRPAbQgdQsM1xmuiFnkfHKPvwMiz` |

---

## DLMM SDK (Dynamic Liquidity Market Maker)

The DLMM SDK provides programmatic access to Meteora's concentrated liquidity protocol with dynamic fees based on volatility.

### Basic Setup

```typescript
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const poolAddress = new PublicKey('POOL_ADDRESS');

// Create DLMM instance for existing pool
const dlmm = await DLMM.create(connection, poolAddress);

// Create multiple pools
const dlmmPools = await DLMM.createMultiple(connection, [pool1, pool2, pool3]);
```

### Core Operations

#### Get Active Bin (Current Price)

```typescript
const activeBin = await dlmm.getActiveBin();
console.log('Active Bin ID:', activeBin.binId);
console.log('Price:', activeBin.price);
console.log('X Amount:', activeBin.xAmount.toString());
console.log('Y Amount:', activeBin.yAmount.toString());
```

#### Price and Bin Conversions

```typescript
// Get price from bin ID
const price = dlmm.getPriceOfBinByBinId(binId);

// Get bin ID from price
const binId = dlmm.getBinIdFromPrice(price, true); // true = round down

// Convert to/from lamport representation
const lamportPrice = dlmm.toPricePerLamport(21.23);
const realPrice = dlmm.fromPricePerLamport(lamportPrice);

// Get bins in a range
const bins = await dlmm.getBinsBetweenLowerAndUpperBound(minBinId, maxBinId);

// Get bins around active bin
const surroundingBins = await dlmm.getBinsAroundActiveBin(10); // 10 bins each side
```

#### Swap Operations

```typescript
import { BN } from '@coral-xyz/anchor';

// Get swap quote
const swapAmount = new BN(1_000_000); // 1 USDC (6 decimals)
const swapForY = true; // Swap X for Y
const slippageBps = 100; // 1% slippage

const binArrays = await dlmm.getBinArrayForSwap(swapForY);
const swapQuote = dlmm.swapQuote(swapAmount, swapForY, slippageBps, binArrays);

console.log('Amount In:', swapQuote.consumedInAmount.toString());
console.log('Amount Out:', swapQuote.outAmount.toString());
console.log('Min Amount Out:', swapQuote.minOutAmount.toString());
console.log('Price Impact:', swapQuote.priceImpact);
console.log('Fee:', swapQuote.fee.toString());

// Execute swap
const swapTx = await dlmm.swap({
  inToken: tokenXMint,
  outToken: tokenYMint,
  inAmount: swapAmount,
  minOutAmount: swapQuote.minOutAmount,
  lbPair: dlmm.pubkey,
  user: wallet.publicKey,
  binArraysPubkey: swapQuote.binArraysPubkey,
});

const txHash = await sendAndConfirmTransaction(connection, swapTx, [wallet]);
```

#### Liquidity Management

```typescript
import { StrategyType } from '@meteora-ag/dlmm';

// Get user positions
const positions = await dlmm.getPositionsByUserAndLbPair(wallet.publicKey);

// Initialize position and add liquidity with strategy
const newPositionTx = await dlmm.initializePositionAndAddLiquidityByStrategy({
  positionPubKey: newPositionKeypair.publicKey,
  user: wallet.publicKey,
  totalXAmount: new BN(100_000_000), // 100 tokens
  totalYAmount: new BN(100_000_000),
  strategy: {
    maxBinId: activeBin.binId + 10,
    minBinId: activeBin.binId - 10,
    strategyType: StrategyType.SpotBalanced,
  },
});

// Add liquidity to existing position
const addLiquidityTx = await dlmm.addLiquidityByStrategy({
  positionPubKey: existingPosition.publicKey,
  user: wallet.publicKey,
  totalXAmount: new BN(50_000_000),
  totalYAmount: new BN(50_000_000),
  strategy: {
    maxBinId: activeBin.binId + 5,
    minBinId: activeBin.binId - 5,
    strategyType: StrategyType.SpotBalanced,
  },
});

// Remove liquidity
const removeLiquidityTx = await dlmm.removeLiquidity({
  position: position.publicKey,
  user: wallet.publicKey,
  binIds: position.positionData.positionBinData.map(b => b.binId),
  bps: new BN(10000), // 100% (basis points)
  shouldClaimAndClose: true,
});
```

#### Claim Fees and Rewards

```typescript
// Get claimable fees
const claimableFees = await DLMM.getClaimableSwapFee(connection, position.publicKey);
console.log('Claimable Fee X:', claimableFees.feeX.toString());
console.log('Claimable Fee Y:', claimableFees.feeY.toString());

// Get claimable LM rewards
const claimableRewards = await DLMM.getClaimableLMReward(connection, position.publicKey);

// Claim swap fees
const claimFeeTx = await dlmm.claimSwapFee({
  owner: wallet.publicKey,
  position: position.publicKey,
});

// Claim all fees from multiple positions
const claimAllFeesTx = await dlmm.claimAllSwapFee({
  owner: wallet.publicKey,
  positions: positions.map(p => p.publicKey)

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/meteora for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/meteora
