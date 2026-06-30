---
id: sol_orca
version: 1.0.0
description: Complete guide for Orca - Solana's leading concentrated liquidity AMM (CLMM). Covers Whirlpools SDK for swaps, liquidity provision, pool creation, position management, and fee harvesting on Solana and Eclipse networks.
triggers:
  - orca
---

## Context

# Orca Whirlpools Development Guide

Orca is the most trusted DEX on Solana and Eclipse, built on a concentrated liquidity automated market maker (CLMM) called Whirlpools. This guide covers the Whirlpools SDK for building trading, liquidity provision, and pool management applications.

## Overview

Orca Whirlpools provides:

- **Token Swaps** - Efficient token exchanges with low slippage and competitive rates
- **Concentrated Liquidity** - Provide liquidity within custom price ranges for higher capital efficiency
- **Splash Pools** - Simple full-range liquidity provision for beginners
- **Position Management** - Open, increase, decrease, and close liquidity positions
- **Fee Harvesting** - Collect trading fees and rewards from positions
- **Pool Creation** - Permissionless creation of new liquidity pools

## Program IDs

| Network | Program ID |
|---------|------------|
| Solana Mainnet | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| Solana Devnet | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| Eclipse Mainnet | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| Eclipse Testnet | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |

## Quick Start

### Installation

**New SDK (Solana Web3.js v2):**
```bash
npm install @orca-so/whirlpools @solana/kit
```

**Legacy SDK (Solana Web3.js v1):**
```bash
npm install @orca-so/whirlpools-sdk @orca-so/common-sdk @coral-xyz/anchor@0.29.0 @solana/web3.js @solana/spl-token decimal.js
```

**Core Utilities (optional):**
```bash
npm install @orca-so/whirlpools-core @orca-so/whirlpools-client
```

### Basic Setup (New SDK)

```typescript
import {
  setWhirlpoolsConfig,
  setRpc,
  setPayerFromBytes
} from "@orca-so/whirlpools";
import { createSolanaRpc, devnet } from "@solana/kit";
import fs from "fs";

// Configure for Solana Devnet
await setWhirlpoolsConfig("solanaDevnet");
await setRpc("https://api.devnet.solana.com");

// Load wallet from keypair file
const keyPairBytes = new Uint8Array(
  JSON.parse(fs.readFileSync("./keypair.json", "utf8"))
);
const wallet = await setPayerFromBytes(keyPairBytes);

// Create RPC connection
const rpc = createSolanaRpc(devnet("https://api.devnet.solana.com"));

console.log("Wallet:", wallet.address);
```

### Basic Setup (Legacy SDK)

```typescript
import { WhirlpoolContext, buildWhirlpoolClient, ORCA_WHIRLPOOL_PROGRAM_ID } from "@orca-so/whirlpools-sdk";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import fs from "fs";

// Setup connection
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

// Load wallet
const secretKey = JSON.parse(fs.readFileSync("./keypair.json", "utf8"));
const wallet = new Wallet(Keypair.fromSecretKey(new Uint8Array(secretKey)));

// Create provider and context
const provider = new AnchorProvider(connection, wallet, {});
const ctx = WhirlpoolContext.from(connection, wallet, ORCA_WHIRLPOOL_PROGRAM_ID);
const client = buildWhirlpoolClient(ctx);

console.log("Wallet:", wallet.publicKey.toString());
```

---

## Token Swaps

### Swap with New SDK

```typescript
import { swap, swapInstructions, setWhirlpoolsConfig } from "@orca-so/whirlpools";
import { address } from "@solana/kit";

await setWhirlpoolsConfig("solanaMainnet");

const poolAddress = address("POOL_ADDRESS_HERE");
const inputMint = address("INPUT_TOKEN_MINT");
const amount = 1_000_000n; // Amount in smallest units
const slippageTolerance = 100; // 100 bps = 1%

// Option 1: Use the simple swap function (builds and sends)
const txId = await swap(
  rpc,
  { inputAmount: amount, mint: inputMint },
  poolAddress,
  slippageTolerance,
  wallet
);

console.log("Swap transaction:", txId);

// Option 2: Get instructions for custom transaction building
const { instructions, quote } = await swapInstructions(
  rpc,
  { inputAmount: amount, mint: inputMint },
  poolAddress,
  slippageTolerance,
  wallet
);

console.log("Expected output:", quote.tokenEstOut);
console.log("Minimum output:", quote.tokenMinOut);
console.log("Price impact:", quote.priceImpact);
```

### Exact Output Swap

```typescript
// Swap to get exact output amount
const { instructions, quote } = await swapInstructions(
  rpc,
  { outputAmount: 1_000_000n, mint: outputMint },
  poolAddress,
  slippageTolerance,
  wallet
);

console.log("Max input required:", quote.tokenMaxIn);
```

### Swap with Legacy SDK

```typescript
import { WhirlpoolContext, swapQuoteByInputToken, buildWhirlpoolClient } from "@orca-so/whirlpools-sdk";
import { DecimalUtil, Percentage } from "@orca-so/common-sdk";
import Decimal from "decimal.js";

// Get the pool
const whirlpool = await client.getPool(poolAddress);
const whirlpoolData = whirlpool.getData();

// Get swap quote
const inputAmount = new Decimal("1.0"); // 1 token
const quote = await swapQuoteByInputToken(
  whirlpool,
  whirlpoolData.tokenMintA,
  DecimalUtil.toBN(inputAmount, 9), // 9 decimals
  Percentage.fromFraction(1, 100), // 1% slippage
  ctx.program.programId,
  ctx.fetcher
);

console.log("Estimated output:", quote.estimatedAmountOut.toString());

// Execute swap
const tx = await whirlpool.swap(quote);
const signature = await tx.buildAndExecute();
console.log("Swap signature:", signature);
```

---

## Liquidity Provision

### Position Types

**Concentrated Liquidity Position**: Provide liquidity within a specific price range for higher capital efficiency.

**Full Range Position (Splash Pool)**: Provide liquidity across the entire price range, similar to traditional AMMs.

### Open Concentrated Liquidity Position

```typescript
import { openPosition, openPositionInstructions } from "@orca-so/whirlpools";
import { address } from "@solana/kit";

const poolAddress = address("POOL_ADDRESS");
const lowerPrice = 0.001;  // Lower bound of price range
const upperPrice = 100.0;  // Upper bound of price range
const slippageTolerance = 100; // 1%

// Specify liquidity by token amount
const param = { tokenA: 1_000_000_000n }; // 1 token with 9 decimals

// Option 1: Simple function that builds and sends
const txId = await openPosition(
  rpc,
  poolAddress,
  param,
  lowerPrice,
  upperPrice,
  slippageTolerance,
  wallet
);

// Option 2: Get instructions for custom transaction
const {
  instructions,
  quote,
  positionMint,
  initializationCost
} = await openPositionInstructions(
  rpc,
  poolAddress,
  param,
  lowerPrice,
  upperPrice,
  slippageTolerance,
  wallet
);

console.log("Position mint:", positionMint);
console.log("Token A required:", quote.tokenEstA);
console.log("Token B required:", quote.tokenEstB);
console.log("Initialization cost:", initializationCost);
```

### Open Full Range Position

```typescript
import { openFullRangePosition, openFullRangePositionInstructions } from "@orca-so/whirlpools";

const poolAddress = address("POOL_ADDRESS");
const param = { tokenA: 1_000_000_000n };
const slippageTolerance = 100;

const {
  instructions,
  quote,
  positionMint,
  callback: sendTx
} = await openFullRangePositionInstructions(
  rpc,
  poolAddress,
  param,
  slippageTolerance,
  wallet
);

console.log("Position mint:", positionMint);
console.log("Token max B:", quote.tokenMaxB);

// Send the transaction
const txId = await sendTx();
console.log("Transaction:", txId);
```

### Increase Position Liquidity

```typescript
import { increaseLiquidity, increaseLiquidityInstructions } from "@orca-so/whirlpools";

const positionMint = address("POSITION_MINT");
const param = { tokenA: 500_000_000n }; // Add 0.5 tokens
const slippageTolerance = 100;

const { instructions, quote } = await increaseLiquidityInstructions(
  rpc,
  positionMint,
  param,
  slippageTolerance,
  wallet
);

console.log("Additional Token A:", quote.tokenEstA);
console.log("Additional Token B:", quote.tokenEstB);
```

### Decrease Position Liquidity

```typescript
import { decreaseLiquidity, decreaseLiquidityInstructions } from "@orca-so/whirlpools";

const positionMint = address("POSITION_MINT");
const param = { liquidi

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/orca for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/orca
