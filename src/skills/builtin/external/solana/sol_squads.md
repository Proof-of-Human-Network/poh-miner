---
id: sol_squads
version: 1.0.0
description: Complete guide for Squads Protocol - Solana's leading smart account and multisig infrastructure. Covers Squads V4 Multisig for team treasury management, Smart Account Program for account abstraction and programmable wallets, and Grid for stablecoin rails and fintech infrastructure.
triggers:
  - squads
---

## Context

# Squads Protocol Development Guide

Squads Protocol is Solana's premier smart account infrastructure, securing over $10 billion in digital assets. This guide covers all three main products: Squads V4 Multisig, Smart Account Program, and Grid.

## Overview

Squads Protocol provides:

- **Squads V4 Multisig** - Multi-signature wallet for teams with proposals, voting, time locks, spending limits, and program upgrade management
- **Smart Account Program** - Account abstraction infrastructure with session keys, passkeys, programmable policies, and direct debits
- **Grid** - Open finance infrastructure for stablecoin rails, neobank platforms, and enterprise payment systems

## Program IDs

| Program | Mainnet | Devnet |
|---------|---------|--------|
| Squads V4 Multisig | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` |
| Smart Account | `SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG` | `SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG` |
| External Signature (Grid) | `ExtSgUPtP3JyKUysFw2S5fpL5fWfUPzGUQLd2bTwftXN` | `ExtSgUPtP3JyKUysFw2S5fpL5fWfUPzGUQLd2bTwftXN` |

**Eclipse Mainnet:**
| Program | Address |
|---------|---------|
| Squads V4 Multisig | `eSQDSMLf3qxwHVHeTr9amVAGmZbRLY2rFdSURandt6f` |

## Quick Start

### Installation

```bash
# Squads V4 Multisig SDK
npm install @sqds/multisig @solana/web3.js

# Grid SDK
npm install @sqds/grid

# Grid React Native SDK
npm install @sqds/grid-react-native
```

### Basic Setup

```typescript
import * as multisig from "@sqds/multisig";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

// Setup connection
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

// Load wallet
const wallet = Keypair.fromSecretKey(/* your secret key */);

// Program ID constant
const SQUADS_PROGRAM_ID = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
```

---

## Squads V4 Multisig

Squads V4 is the latest version of the multisig protocol, featuring enhanced security, time locks, spending limits, and batch transactions.

### Core Concepts

**Multisig Account**: The main account that holds configuration (members, threshold, time lock settings).

**Vault**: A PDA controlled by the multisig where assets are stored. Each multisig can have multiple vaults (indexed 0, 1, 2...).

**Proposal**: A request to execute a transaction that requires approval from multisig members.

**Transaction**: The actual instruction(s) to be executed once a proposal is approved.

### Permission System

Members can have different permissions:

```typescript
import { Permission, Permissions } from "@sqds/multisig/lib/types";

// All permissions (can initiate, vote, and execute)
const fullPermissions = Permissions.all();

// Specific permissions
const voteOnly = Permissions.fromPermissions([Permission.Vote]);
const initiateAndVote = Permissions.fromPermissions([Permission.Initiate, Permission.Vote]);
const executeOnly = Permissions.fromPermissions([Permission.Execute]);
```

| Permission | Description |
|------------|-------------|
| `Initiate` | Can create new proposals |
| `Vote` | Can approve or reject proposals |
| `Execute` | Can execute approved proposals |

### Creating a Multisig

```typescript
import * as multisig from "@sqds/multisig";

const { Permissions } = multisig.types;

// Generate a unique create key (one-time use)
const createKey = Keypair.generate();

// Derive the multisig PDA
const [multisigPda] = multisig.getMultisigPda({
  createKey: createKey.publicKey,
});

// Create a 2-of-3 multisig
const signature = await multisig.rpc.multisigCreateV2({
  connection,
  createKey,
  creator: wallet,
  multisigPda,
  configAuthority: null, // Immutable config
  threshold: 2,
  members: [
    { key: member1.publicKey, permissions: Permissions.all() },
    { key: member2.publicKey, permissions: Permissions.all() },
    { key: member3.publicKey, permissions: Permissions.fromPermissions([Permission.Vote]) },
  ],
  timeLock: 0, // No time lock (in seconds)
  rentCollector: null,
});

console.log("Multisig created:", multisigPda.toString());
console.log("Transaction:", signature);
```

### Vault Operations

Vaults are PDAs that hold the multisig's assets:

```typescript
// Derive vault PDA (index 0 is the default vault)
const [vaultPda] = multisig.getVaultPda({
  multisigPda,
  index: 0,
});

console.log("Vault address:", vaultPda.toString());

// Check vault balance
const balance = await connection.getBalance(vaultPda);
console.log("Vault balance:", balance / 1e9, "SOL");
```

**Important**: Always send funds to the vault PDA, not the multisig account itself.

### Creating a Vault Transaction

```typescript
import { SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

// Get current transaction index
const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
  connection,
  multisigPda
);
const transactionIndex = BigInt(Number(multisigAccount.transactionIndex) + 1);

// Derive transaction PDA
const [transactionPda] = multisig.getTransactionPda({
  multisigPda,
  index: transactionIndex,
});

// Create a transfer instruction
const transferIx = SystemProgram.transfer({
  fromPubkey: vaultPda,
  toPubkey: recipientPubkey,
  lamports: 0.1 * LAMPORTS_PER_SOL,
});

// Create the vault transaction
const signature = await multisig.rpc.vaultTransactionCreate({
  connection,
  feePayer: wallet,
  multisigPda,
  transactionIndex,
  creator: wallet.publicKey,
  vaultIndex: 0,
  ephemeralSigners: 0,
  transactionMessage: new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [transferIx],
  }),
});

console.log("Vault transaction created:", transactionPda.toString());
```

### Creating and Managing Proposals

```typescript
// Derive proposal PDA
const [proposalPda] = multisig.getProposalPda({
  multisigPda,
  transactionIndex,
});

// Create proposal for the transaction
const createProposalSig = await multisig.rpc.proposalCreate({
  connection,
  feePayer: wallet,
  multisigPda,
  transactionIndex,
  creator: wallet,
});

console.log("Proposal created:", proposalPda.toString());
```

### Voting on Proposals

```typescript
// Approve the proposal
const approveSig = await multisig.rpc.proposalApprove({
  connection,
  feePayer: wallet,
  multisigPda,
  transactionIndex,
  member: wallet,
});

console.log("Proposal approved");

// Or reject the proposal
const rejectSig = await multisig.rpc.proposalReject({
  connection,
  feePayer: wallet,
  multisigPda,
  transactionIndex,
  member: wallet,
  memo: "Reason for rejection",
});
```

### Executing Approved Transactions

```typescript
// Check if proposal is approved and ready
const proposal = await multisig.accounts.Proposal.fromAccountAddress(
  connection,
  proposalPda
);

if (proposal.status.__kind === "Approved") {
  // Execute the vault transaction
  const executeSig = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: wallet,
    multisigPda,
    transactionIndex,
    member: wallet.publicKey,
  });

  console.log("Transaction executed:", executeSig);
}
```

### Spending Limits

Spending limits allow members to execute transactions up to a certain amount without full multisig approval:

```typescript
// Create a spending limit
const createSpendingLimitSig = await multisig.rpc.configTransactionCreate({
  connection,
  feePayer: wallet,
  multisigPda,
  transactionIndex,
  creator: wallet.publicKey,
  actions: [{
    __kind: "AddSpendingLimit",
    createKey: spendingLimitCreateKey.publicKey,
    vaultIndex: 0,
    mint: SOL_MINT, // or token mint
    amount: BigInt(1 * LAMPORTS_PER_SOL), // 1 SOL
    period: multisig.types.Period.Day,
    members: [trustedMember.publicKey],
    destinations: [allowedDestination],
  }],
});

// Use spending limit (no proposal needed)
const useSpendingLimitSig = await multisig.rpc.spendingLimitUse({
  connection,
  feePayer: wallet,
  multisigPda,
  m

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/squads for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/squads
