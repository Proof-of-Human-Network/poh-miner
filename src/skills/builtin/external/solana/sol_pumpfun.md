---
id: sol_pumpfun
version: 1.0.0
description: Complete PumpFun Protocol guide for building token launches, bonding curves, and AMM integrations on Solana. Covers Pump Program (token creation, buy/sell on bonding curves), PumpSwap AMM (liquidity pools, swaps), fee structures, creator fees, and SDK integration.
triggers:
  - pumpfun
---

## Context

# PumpFun Protocol Integration Guide

A comprehensive guide for building applications with PumpFun - Solana's leading token launch and AMM protocol enabling instant trading without initial liquidity.

## Overview

PumpFun is a token launch and trading protocol on Solana offering:
- **Pump Program** - Create SPL tokens with instant trading on bonding curves
- **PumpSwap (AMM)** - Constant-product automated market maker for graduated tokens
- **Creator Fees** - Automatic fee distribution to token creators
- **Token2022 Support** - Modern token standard via `create_v2` instruction
- **Mayhem Mode** - Special mode for enhanced token launches

## Program IDs

| Program | Address |
|---------|---------|
| Pump Program | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| PumpSwap AMM | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| Pump Fees | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` |
| Mayhem Program | `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` |

## Quick Start

### Installation

```bash
# Install PumpFun SDKs
npm install @pump-fun/pump-sdk @pump-fun/pump-swap-sdk

# Or with pnpm
pnpm add @pump-fun/pump-sdk @pump-fun/pump-swap-sdk
```

### Basic Setup

```typescript
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

// Setup connection
const connection = new Connection('https://api.mainnet-beta.solana.com');
const wallet = Keypair.fromSecretKey(bs58.decode('YOUR_SECRET_KEY'));

// Program addresses
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const PUMP_FEES_PROGRAM_ID = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
```

## Pump Program (Bonding Curves)

The Pump program enables creation of SPL tokens with instant trading on a bonding curve without requiring initial liquidity.

### How Bonding Curves Work

1. **Token Creation** - Create a token with initial virtual reserves
2. **Trading** - Users buy/sell on the bonding curve using Uniswap V2 formula
3. **Graduation** - When market cap threshold is reached, liquidity migrates to PumpSwap
4. **LP Burn** - LP tokens are burned, making liquidity permanent

### Global Configuration

```typescript
interface Global {
  initialized: boolean;
  authority: PublicKey;
  feeRecipient: PublicKey;
  initialVirtualTokenReserves: bigint;  // Default: 1,073,000,000,000,000
  initialVirtualSolReserves: bigint;    // Default: 30,000,000,000 (30 SOL)
  initialRealTokenReserves: bigint;     // Default: 793,100,000,000,000
  tokenTotalSupply: bigint;             // Default: 1,000,000,000,000,000
  feeBasisPoints: bigint;               // Default: 100 (1%)
  creatorFeeBasisPoints: bigint;        // Creator fee percentage
}
```

### Bonding Curve Account

```typescript
interface BondingCurve {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: PublicKey;        // Token creator address
  isMayhemMode: boolean;     // Mayhem mode flag
}
```

### Deriving PDAs

```typescript
import { PublicKey } from '@solana/web3.js';

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

// Derive bonding curve PDA
function getBondingCurvePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
}

// Derive associated bonding curve (token account)
function getAssociatedBondingCurve(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('associated-bonding-curve'),
      mint.toBuffer()
    ],
    PUMP_PROGRAM_ID
  );
}

// Derive creator vault PDA
function getCreatorVaultPDA(creator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM_ID
  );
}

// Derive global account PDA
function getGlobalPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('global')],
    PUMP_PROGRAM_ID
  );
}
```

### Create Token (Legacy SPL)

```typescript
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

async function createToken(
  connection: Connection,
  payer: Keypair,
  name: string,
  symbol: string,
  uri: string
): Promise<string> {
  const mint = Keypair.generate();

  const [bondingCurve] = getBondingCurvePDA(mint.publicKey);
  const [associatedBondingCurve] = getAssociatedBondingCurve(mint.publicKey);
  const [global] = getGlobalPDA();

  // Metaplex metadata PDA
  const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.publicKey.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );

  // Build create instruction data
  const nameBuffer = Buffer.from(name);
  const symbolBuffer = Buffer.from(symbol);
  const uriBuffer = Buffer.from(uri);

  const data = Buffer.alloc(
    8 + 4 + nameBuffer.length + 4 + symbolBuffer.length + 4 + uriBuffer.length
  );

  // Write discriminator for 'create' instruction
  const discriminator = Buffer.from([0x18, 0x1e, 0xc8, 0x28, 0x05, 0x1c, 0x07, 0x77]);
  discriminator.copy(data, 0);

  let offset = 8;
  data.writeUInt32LE(nameBuffer.length, offset);
  offset += 4;
  nameBuffer.copy(data, offset);
  offset += nameBuffer.length;

  data.writeUInt32LE(symbolBuffer.length, offset);
  offset += 4;
  symbolBuffer.copy(data, offset);
  offset += symbolBuffer.length;

  data.writeUInt32LE(uriBuffer.length, offset);
  offset += 4;
  uriBuffer.copy(data, offset);

  const instruction = new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: mint.publicKey, isSigner: true, isWritable: true },
      { pubkey: payer.publicKey, isSigner: false, isWritable: true },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      { pubkey: global, isSigner: false, isWritable: false },
      { pubkey: METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(instruction);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(payer, mint);

  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature);

  return mint.publicKey.toBase58();
}
```

### Create Token V2 (Token2022)

```typescript
// create_v2 uses Token2022 program instead of legacy Metaplex
// Account structure (14 accounts):
const createV2Accounts = [
  'mint',                    // 0: New token mint (signer, writable)
  'mintAuthority',           // 1: Mint authority PDA
  'bondingCurve',            // 2: Bonding curve PDA (writable)
  'associatedBondingCurve',  // 3: Token account for bonding curve (writable)
  'global',                  // 4: Global config
  'user',                    // 5: Creator/payer (signer, writable)
  'systemProgram',           // 6: System program
  'token2022Program',        // 7: Token2022 pr

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/pumpfun for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/pumpfun
