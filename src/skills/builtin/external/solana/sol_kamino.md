---
id: sol_kamino
version: 1.0.0
description: Complete guide for Kamino Finance - Solana's leading DeFi protocol for lending, borrowing, liquidity management, and leverage trading. Covers klend-sdk (lending), kliquidity-sdk (automated liquidity strategies), scope-sdk (oracle aggregator), multiply/leverage operations, vaults, and obligation orders.
triggers:
  - kamino
  - kamino finance
  - klend
  - kliquidity
  - kamino lending
  - kamino vault
  - kamino multiply
  - kamino leverage
  - kamino borrow
  - obligation order
  - scope oracle
---

## Context

# Kamino Finance Development Guide

Build sophisticated DeFi applications on Solana with Kamino Finance - the comprehensive DeFi protocol offering lending, borrowing, automated liquidity management, leverage trading, and oracle aggregation.

## Overview

Kamino Finance provides:
- **Kamino Lend (K-Lend)**: Lending and borrowing protocol with isolated markets
- **Kamino Liquidity (K-Liquidity)**: Automated CLMM liquidity management strategies
- **Scope Oracle**: Oracle price aggregator for reliable pricing
- **Multiply/Leverage**: Leveraged long/short positions on assets
- **Vaults**: Yield-generating vault strategies
- **Obligation Orders**: Automated LTV-based and price-based order execution

## Quick Start

### Installation

```bash
# Lending SDK
npm install @kamino-finance/klend-sdk

# Liquidity SDK
npm install @kamino-finance/kliquidity-sdk

# Oracle SDK
npm install @kamino-finance/scope-sdk

# Required peer dependencies
npm install @solana/web3.js @coral-xyz/anchor decimal.js
```

### Environment Setup

```bash
# .env file
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
WALLET_KEYPAIR_PATH=./keypair.json
```

## Kamino Lending (klend-sdk)

The lending SDK enables interaction with Kamino's lending markets for deposits, borrows, repayments, and liquidations.

### Core Classes

| Class | Purpose |
|-------|---------|
| `KaminoMarket` | Load and interact with lending markets |
| `KaminoAction` | Build lending transactions (deposit, borrow, repay, withdraw) |
| `KaminoObligation` | Manage user obligations (positions) |
| `KaminoReserve` | Access reserve configurations and stats |
| `VanillaObligation` | Standard obligation type |

### Initialize Market

```typescript
import { KaminoMarket } from "@kamino-finance/klend-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");

// Main lending market address
const MAIN_MARKET = new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");

// Load market with basic data
const market = await KaminoMarket.load(connection, MAIN_MARKET);

// Load reserves for detailed data
await market.loadReserves();

// Get specific reserve
const usdcReserve = market.getReserve("USDC");
console.log("Total Deposits:", usdcReserve?.stats.totalDepositsWads.toString());
console.log("LTV:", usdcReserve?.stats.loanToValueRatio);
console.log("Borrow APY:", usdcReserve?.stats.borrowInterestAPY);
console.log("Supply APY:", usdcReserve?.stats.supplyInterestAPY);

// Refresh all data including obligations
await market.refreshAll();
```

### Deposit Collateral

```typescript
import { KaminoAction, VanillaObligation, PROGRAM_ID } from "@kamino-finance/klend-sdk";
import { Keypair, sendAndConfirmTransaction } from "@solana/web3.js";
import Decimal from "decimal.js";

async function deposit(
  market: KaminoMarket,
  wallet: Keypair,
  tokenSymbol: string,
  amount: Decimal
) {
  // Build deposit transaction
  const kaminoAction = await KaminoAction.buildDepositTxns(
    market,
    amount.toString(),           // Amount in base units
    tokenSymbol,                  // e.g., "USDC", "SOL"
    wallet.publicKey,
    new VanillaObligation(PROGRAM_ID),
    0,                            // Additional compute budget (optional)
    true,                         // Include Ata init instructions
    undefined,                    // Referrer (optional)
    undefined,                    // Current slot (optional)
    "finalized"                   // Commitment
  );

  // Get all instructions
  const instructions = [
    ...kaminoAction.setupIxs,
    ...kaminoAction.lendingIxs,
    ...kaminoAction.cleanupIxs,
  ];

  // Create and send transaction
  const tx = new Transaction().add(...instructions);
  const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);

  return signature;
}
```

### Borrow Assets

```typescript
async function borrow(
  market: KaminoMarket,
  wallet: Keypair,
  tokenSymbol: string,
  amount: Decimal
) {
  const kaminoAction = await KaminoAction.buildBorrowTxns(
    market,
    amount.toString(),
    tokenSymbol,
    wallet.publicKey,
    new VanillaObligation(PROGRAM_ID),
    0,
    true,
    false,                        // Include deposit for fees (optional)
    undefined,
    undefined,
    "finalized"
  );

  const instructions = [
    ...kaminoAction.setupIxs,
    ...kaminoAction.lendingIxs,
    ...kaminoAction.cleanupIxs,
  ];

  const tx = new Transaction().add(...instructions);
  return await sendAndConfirmTransaction(connection, tx, [wallet]);
}
```

### Repay Loan

```typescript
async function repay(
  market: KaminoMarket,
  wallet: Keypair,
  tokenSymbol: string,
  amount: Decimal | "max"
) {
  const repayAmount = amount === "max" ? "max" : amount.toString();

  const kaminoAction = await KaminoAction.buildRepayTxns(
    market,
    repayAmount,
    tokenSymbol,
    wallet.publicKey,
    new VanillaObligation(PROGRAM_ID),
    0,
    true,
    undefined,
    "finalized"
  );

  const instructions = [
    ...kaminoAction.setupIxs,
    ...kaminoAction.lendingIxs,
    ...kaminoAction.cleanupIxs,
  ];

  const tx = new Transaction().add(...instructions);
  return await sendAndConfirmTransaction(connection, tx, [wallet]);
}
```

### Withdraw Collateral

```typescript
async function withdraw(
  market: KaminoMarket,
  wallet: Keypair,
  tokenSymbol: string,
  amount: Decimal | "max"
) {
  const withdrawAmount = amount === "max" ? "max" : amount.toString();

  const kaminoAction = await KaminoAction.buildWithdrawTxns(
    market,
    withdrawAmount,
    tokenSymbol,
    wallet.publicKey,
    new VanillaObligation(PROGRAM_ID),
    0,
    true,
    undefined,
    "finalized"
  );

  const instructions = [
    ...kaminoAction.setupIxs,
    ...kaminoAction.lendingIxs,
    ...kaminoAction.cleanupIxs,
  ];

  const tx = new Transaction().add(...instructions);
  return await sendAndConfirmTransaction(connection, tx, [wallet]);
}
```

### Get User Obligations

```typescript
// Get single vanilla obligation for user
const obligation = await market.getUserVanillaObligation(wallet.publicKey);

if (obligation) {
  console.log("Deposits:", obligation.state.deposits);
  console.log("Borrows:", obligation.state.borrows);
  console.log("Health Factor:", obligation.refreshedStats.borrowLimit);
}

// Get all obligations for user
const allObligations = await market.getAllUserObligations(wallet.publicKey);

// Get obligations for specific reserve
const reserveObligations = await market.getAllUserObligationsForReserve(
  wallet.publicKey,
  usdcReserve
);

// Check if reserve is part of obligation
const isReserveInObligation = market.isReserveInObligation(
  obligation,
  usdcReserve
);
```

### Liquidation

```typescript
async function liquidate(
  market: KaminoMarket,
  liquidator: Keypair,
  obligationOwner: PublicKey,
  repayTokenSymbol: string,
  withdrawTokenSymbol: string,
  repayAmount: Decimal
) {
  const kaminoAction = await KaminoAction.buildLiquidateTxns(
    market,
    repayAmount.toString(),
    repayTokenSymbol,
    withdrawTokenSymbol,
    obligationOwner,
    liquidator.publicKey,
    new VanillaObligation(PROGRAM_ID),
    0,
    true,
    "finalized"
  );

  const instructions = [
    ...kaminoAction.setupIxs,
    ...kaminoAction.lendingIxs,
    ...kaminoAction.cleanupIxs,
  ];

  const tx = new Transaction().add(...instructions);
  return await sendAndConfirmTransaction(connection, tx, [liquidator]);
}
```

## Leverage/Multiply Operations

Kamino supports leveraged positions through the multiply feature.

### Open Leveraged Position

```typescript
import {
  getLeverageDepositIxns,
  getLeverageWithdrawIxns,
  calculateLeverageMultiplier
} from "@kamino-finance/klend-sdk/leverage";

async function openLeveragedPosition(
  market: KaminoMarket,
  wallet: Keypair,
  collateralToken: string,
  borrowToken: string,
  depositAmount: Decimal,
  targetLeverage: number  // e.g., 2x, 3x
) {
  // Calculate parameters for ta

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/kamino for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/kamino
