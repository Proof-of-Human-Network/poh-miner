---
id: sol_lulo
version: 1.0.0
description: Complete guide for Lulo - Solana's premier lending aggregator. Covers API integration for deposits, withdrawals, balance queries, Protected/Boosted deposits, Custom deposits, and automated yield optimization across Kamino, Drift, MarginFi, and Jupiter.
triggers:
  - lulo
---

## Context

# Lulo Development Guide

A comprehensive guide for integrating Lulo, Solana's only lending aggregator, into your applications. Lulo automatically routes deposits to the highest-yielding DeFi protocols while providing optional smart contract protection.

## What is Lulo?

Lulo (formerly FlexLend) is a DeFi savings platform for stablecoins on Solana. It automatically allocates deposits across integrated protocols to maximize yields while maintaining desired risk exposure.

### Key Features

| Feature | Description |
|---------|-------------|
| **Yield Aggregation** | Automatically routes deposits to highest-yielding protocols |
| **Lulo Protect** | Built-in smart contract risk protection (Protected/Boosted deposits) |
| **Custom Deposits** | Full control over protocol allocation and risk parameters |
| **Instant Withdrawals** | No lock-up periods (except 48h cooldown for Boosted) |
| **Multi-Protocol** | Integrates Kamino, Drift, MarginFi, Jupiter |
| **No Custody** | Funds flow directly to integrated protocols, not held by Lulo |

### Why Use Lulo?

- **Automated Rebalancing**: Checks rates hourly, automatically moves funds to better yields
- **Risk Management**: Choose between Protected (insured), Boosted (higher yield), or Custom deposits
- **Zero Management Fees**: Only 0.005 SOL one-time initialization fee
- **Multi-Reward Accrual**: Earn rewards from multiple protocols from a single deposit
- **9,400+ Lifetime Depositors** with $34M+ in directed liquidity

## Overview

Lulo provides three deposit types:

- **Protected Deposits**: Stable yields with automatic coverage against protocol failures
- **Boosted Deposits**: Higher yields by providing insurance for Protected deposits
- **Custom Deposits**: Direct control over which protocols receive your funds

### Integrated Protocols

| Protocol | Description |
|----------|-------------|
| Kamino Finance | Lending and liquidity vaults |
| Drift Protocol | Perpetuals and lending |
| MarginFi | Lending and borrowing |
| Jupiter | Lending/earn features |

### Supported Tokens

- **Stablecoins**: USDC, USDT, USDS, PYUSD
- **Native**: SOL
- **LSTs**: bSOL, JitoSOL, mSOL
- **Other**: BONK, JUP, ORCA, COPE, CASH

**Minimum Deposits**: $100 for stablecoins, 1 SOL for native token

---

## Quick Start

### API Authentication

All API requests require a valid API key. Get your key from the [Lulo Developer Dashboard](https://dev.lulo.fi).

```typescript
const headers = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.LULO_API_KEY,
};
```

### Base URLs

| Environment | URL |
|-------------|-----|
| Production | `https://api.lulo.fi` |
| Blinks | `https://blink.lulo.fi` |
| Developer Portal | `https://dev.lulo.fi` |

---

## API Reference

### Generate Deposit Transaction

Creates a serialized transaction for depositing tokens into Lulo.

**Endpoint**: `POST /v1/generate.transactions.deposit`

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `priorityFee` | number | Priority fee in microlamports (e.g., 500000) |

**Request Body**:
```json
{
  "owner": "YourWalletPublicKey",
  "mintAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "depositType": "protected",
  "amount": 100000000
}
```

**Response**:
```json
{
  "transaction": "base64EncodedSerializedTransaction",
  "lastValidBlockHeight": 123456789
}
```

### Generate Withdrawal Transaction

Creates a serialized transaction for withdrawing tokens from Lulo.

**Endpoint**: `POST /v1/generate.transactions.withdraw`

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `priorityFee` | number | Priority fee in microlamports |

**Request Body**:
```json
{
  "owner": "YourWalletPublicKey",
  "mintAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "withdrawType": "protected",
  "amount": 50000000
}
```

### Get Account Data

Retrieves user balances, interest earned, and APY metrics.

**Endpoint**: `GET /v1/account/{walletAddress}`

**Response**:
```json
{
  "totalDeposited": 1000000000,
  "totalInterestEarned": 5000000,
  "currentApy": 8.5,
  "positions": [
    {
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "depositType": "protected",
      "balance": 500000000,
      "interestEarned": 2500000,
      "apy": 7.2
    }
  ]
}
```

### Get Pool Data

Returns current APY rates, liquidity amounts, and capacity metrics.

**Endpoint**: `GET /v1/pools`

**Response**:
```json
{
  "pools": [
    {
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "symbol": "USDC",
      "protectedApy": 6.5,
      "boostedApy": 9.2,
      "totalDeposited": 34000000000000,
      "availableCapacity": 10000000000000
    }
  ]
}
```

### Get Pending Withdrawals

Lists active withdrawal requests with cooldown periods.

**Endpoint**: `GET /v1/account/{walletAddress}/pending-withdrawals`

### Initialize Referrer

Sets up a referrer account for earning referral fees.

**Endpoint**: `POST /v1/referrer/initialize`

### Claim Referral Rewards

Processes referral fee claims.

**Endpoint**: `POST /v1/referrer/claim`

---

## Deposit Types Explained

### Protected Deposits

Designed for risk-averse users seeking stable yields with automatic coverage.

**How it works**:
1. Deposits earn interest from lending across integrated protocols
2. A portion of interest is shared with Boosted depositors (protection fee)
3. If a protocol fails, Boosted deposits cover Protected losses automatically

**Benefits**:
- Lower risk with priority coverage
- Stable, predictable yields
- No claims to file - protection is automatic
- Instant withdrawals

**Coverage includes**: Smart contract exploits, oracle failures, bad debt events

**Not covered**: Solana network failures, USDC depegging, Lulo contract failures

### Boosted Deposits

Higher yields in exchange for providing insurance to Protected depositors.

**How it works**:
1. Earn lending yields from integrated protocols
2. Receive additional yield from Protected deposit interest sharing
3. Act as first-loss layer if a protocol fails

**Benefits**:
- Higher APY (typically 1-2% more than Protected)
- Dual income streams (lending + protection fees)

**Risks**:
- First-loss position in case of protocol failures
- 48-hour withdrawal cooldown

### Custom Deposits

Full control over protocol allocation and risk parameters.

**Features**:
- Select specific protocols (Kamino, Drift, MarginFi, Jupiter)
- Set maximum exposure caps per protocol
- Automatic reallocation when yields change
- No protection coverage (direct protocol exposure)

**Example**: 50% max exposure with 3 protocols means no more than half your funds in any single protocol.

---

## Integration Examples

### TypeScript: Deposit to Lulo

```typescript
import { Connection, Transaction, VersionedTransaction, Keypair } from '@solana/web3.js';

const LULO_API_URL = 'https://api.lulo.fi';

interface DepositParams {
  owner: string;
  mintAddress: string;
  amount: number;
  depositType: 'protected' | 'boosted' | 'regular';
  priorityFee?: number;
}

async function generateDepositTransaction(params: DepositParams): Promise<string> {
  const { owner, mintAddress, amount, depositType, priorityFee = 500000 } = params;

  const response = await fetch(
    `${LULO_API_URL}/v1/generate.transactions.deposit?priorityFee=${priorityFee}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.LULO_API_KEY!,
      },
      body: JSON.stringify({
        owner,
        mintAddress,
        depositType,
        amount,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Deposit failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.transaction;
}

async function deposit(
  connection: Connection,
  wallet: Keypair,
  mintAddress: string,
  amount: number,
  depositType: 'protected' | 'boosted' | 'regular' = 'protected'
): Promise<string> {
  // Generate deposit t

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/lulo for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/lulo
