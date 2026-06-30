---
id: sol_solana_kit
version: 1.0.0
description: Complete guide for @solana/kit - the modern, tree-shakeable, zero-dependency JavaScript SDK from Anza. Covers RPC connections, signers, transaction building with pipe, signing, sending, and account fetching with full TypeScript support.
triggers:
  - solana kit
  - solana-kit
---

## Context

# Solana Kit Development Guide

A comprehensive guide for building Solana applications with `@solana/kit` - the modern, tree-shakeable, zero-dependency JavaScript SDK from Anza.

## Overview

Solana Kit (formerly web3.js 2.0) is a complete rewrite of the Solana JavaScript SDK with:
- **Tree-shakeable**: Only ship code you use (-78% bundle size)
- **Zero dependencies**: No third-party packages
- **Functional design**: Composable, no classes
- **10x faster crypto**: Native Ed25519 support
- **TypeScript-first**: Full type safety

## Quick Start

### Installation

```bash
npm install @solana/kit
```

For specific program interactions:
```bash
npm install @solana-program/system @solana-program/token
```

### Minimal Example

```typescript
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  lamports,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

const LAMPORTS_PER_SOL = BigInt(1_000_000_000);

async function transferSol() {
  // 1. Connect to RPC
  const rpc = createSolanaRpc("https://api.devnet.solana.com");
  const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.devnet.solana.com");

  // 2. Create signers
  const sender = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();

  // 3. Get blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // 4. Build transaction with pipe
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(sender.address, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstruction(
      getTransferSolInstruction({
        amount: lamports(LAMPORTS_PER_SOL / BigInt(10)), // 0.1 SOL
        destination: recipient.address,
        source: sender,
      }),
      tx
    )
  );

  // 5. Sign
  const signedTx = await signTransactionMessageWithSigners(transactionMessage);

  // 6. Send and confirm
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(signedTx, { commitment: "confirmed" });

  console.log("Signature:", getSignatureFromTransaction(signedTx));
}
```

## Core Concepts

### 1. RPC Connections

Kit separates HTTP and WebSocket connections:

```typescript
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

// HTTP for requests
const rpc = createSolanaRpc("https://api.devnet.solana.com");

// WebSocket for subscriptions
const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.devnet.solana.com");

// Make RPC calls
const slot = await rpc.getSlot().send();
const balance = await rpc.getBalance(address).send();
const { value: blockhash } = await rpc.getLatestBlockhash().send();
```

### 2. Signers

Kit uses signer interfaces instead of keypairs directly:

```typescript
import {
  generateKeyPairSigner,
  createKeyPairSignerFromBytes,
  address,
} from "@solana/kit";

// Generate new signer
const signer = await generateKeyPairSigner();
console.log("Address:", signer.address);

// From existing secret key (Uint8Array)
const existing = await createKeyPairSignerFromBytes(secretKeyBytes);

// Create address from string
const addr = address("11111111111111111111111111111111");
```

### 3. Transaction Building with Pipe

Kit uses functional composition via `pipe`:

```typescript
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  prependTransactionMessageInstructions,
} from "@solana/kit";

const tx = pipe(
  createTransactionMessage({ version: 0 }),             // Create v0 message
  (tx) => setTransactionMessageFeePayer(payer.address, tx),  // Set fee payer
  (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx), // Set lifetime
  (tx) => appendTransactionMessageInstruction(instruction1, tx),      // Add instruction
  (tx) => appendTransactionMessageInstructions([instruction2, instruction3], tx), // Add multiple
);
```

### 4. Signing Transactions

```typescript
import {
  signTransactionMessageWithSigners,
  partiallySignTransactionMessageWithSigners,
  getSignatureFromTransaction,
} from "@solana/kit";

// Sign with all signers in the transaction
const signedTx = await signTransactionMessageWithSigners(transactionMessage);

// Partial signing (for multisig)
const partiallySignedTx = await partiallySignTransactionMessageWithSigners(
  transactionMessage
);

// Get signature before sending
const signature = getSignatureFromTransaction(signedTx);
```

### 5. Sending Transactions

```typescript
import {
  sendAndConfirmTransactionFactory,
  sendTransactionWithoutConfirmingFactory,
  getBase64EncodedWireTransaction,
} from "@solana/kit";

// Send with confirmation (recommended)
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
await sendAndConfirm(signedTx, { commitment: "confirmed" });

// Send without waiting for confirmation
const send = sendTransactionWithoutConfirmingFactory({ rpc });
await send(signedTx, { commitment: "confirmed" });

// Manual encoding (low-level)
const encoded = getBase64EncodedWireTransaction(signedTx);
await rpc.sendTransaction(encoded, { encoding: "base64" }).send();
```

### 6. Fetching Accounts

```typescript
import {
  fetchEncodedAccount,
  fetchEncodedAccounts,
  assertAccountExists,
} from "@solana/kit";

// Fetch single account
const account = await fetchEncodedAccount(rpc, address);
if (account.exists) {
  console.log("Lamports:", account.lamports);
  console.log("Owner:", account.programAddress);
  console.log("Data:", account.data);
}

// Fetch multiple accounts
const accounts = await fetchEncodedAccounts(rpc, [addr1, addr2, addr3]);

// Assert account exists (throws if not)
assertAccountExists(account);
```

## Package Reference

### Core Package

| Import | Description |
|--------|-------------|
| `@solana/kit` | Main package - includes everything below |

### Individual Packages

| Package | Purpose |
|---------|---------|
| `@solana/rpc` | RPC client creation |
| `@solana/rpc-subscriptions` | WebSocket subscriptions |
| `@solana/signers` | Signing interfaces |
| `@solana/addresses` | Address utilities |
| `@solana/keys` | Key generation |
| `@solana/transactions` | Transaction compilation |
| `@solana/transaction-messages` | Message building |
| `@solana/accounts` | Account fetching |
| `@solana/codecs` | Data encoding/decoding |
| `@solana/errors` | Error handling |

### Program Packages

| Package | Program |
|---------|---------|
| `@solana-program/system` | System Program |
| `@solana-program/token` | SPL Token |
| `@solana-program/token-2022` | Token Extensions |
| `@solana-program/memo` | Memo Program |
| `@solana-program/compute-budget` | Compute Budget |
| `@solana-program/address-lookup-table` | Lookup Tables |

## Common Patterns

### Pattern 1: Helper Function for Send & Confirm

```typescript
import {
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  CompilableTransactionMessage,
  TransactionMessageWithBlockhashLifetime,
  Commitment,
} from "@solana/kit";

function createTransactionSender(rpc: Rpc, rpcSubscriptions: RpcSubscriptions) {
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  return async (
    txMessage: CompilableTransactionMessage & TransactionMessageWithBlockhashLifetime,
    commitment: Commitment = "confirmed"
  ) => {
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    await sendAndConfirm(signedTx, { commitment, skipPref

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/solana-kit for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/solana-kit
