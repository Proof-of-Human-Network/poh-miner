---
id: sol_solana_kit_migration
version: 1.0.0
description: Helps developers understand when to use @solana/kit vs @solana/web3.js (v1), provides migration guidance, API mappings, and handles edge cases for Solana JavaScript SDK transitions. Use specifically when migrating existing code FROM @solana/web3.js TO @solana/kit — for using @solana/kit fresh without migration, see sol_solana_kit.
triggers:
  - solana kit migration
  - solana-kit-migration
  - migration
  - migrate to kit
  - web3.js to kit
  - v1 to kit
  - web3.js migration
  - upgrade solana sdk
  - api mapping web3js
  - replace web3.js
  - solana sdk transition
---

## Context

# Solana Kit Migration Assistant

This skill helps you navigate the transition between `@solana/web3.js` (v1.x) and `@solana/kit` (formerly web3.js 2.0), providing guidance on when to use each library and how to migrate between them.

## Overview

The Solana JavaScript ecosystem has two major SDK options:

| Library | Status | Use Case |
|---------|--------|----------|
| `@solana/web3.js` (1.x) | Maintenance mode | Legacy projects, Anchor-dependent apps |
| `@solana/kit` | Active development | New projects, performance-critical apps |

**Key Decision**: `@solana/kit` is the future, but migration isn't always straightforward.

## When to Use Each Library

### Use @solana/kit When:

1. **Starting a new project** without Anchor dependencies
2. **Bundle size matters** - Kit is tree-shakeable (26% smaller bundles)
3. **Performance is critical** - ~200ms faster confirmation latency, 10x faster crypto ops
4. **Using standard programs** (System, Token, Associated Token)
5. **Building browser applications** where bundle size impacts load time
6. **Type safety is important** - Better TypeScript support catches errors at compile time
7. **Using modern JavaScript** - Native BigInt, WebCrypto, AsyncIterators

### Use @solana/web3.js (v1.x) When:

1. **Using Anchor** - Anchor doesn't support Kit out of the box yet
2. **Existing large codebase** - Migration cost outweighs benefits
3. **Dependencies require v1** - Check if your SDKs support Kit
4. **Rapid prototyping** - v1's OOP style may be more familiar
5. **Documentation/examples** - More community resources for v1

### Use Both (Hybrid Approach) When:

1. **Gradual migration** - Use `@solana/compat` for interoperability
2. **Mixed dependencies** - Some libs require v1, some support Kit
3. **Feature-by-feature migration** - Convert hot paths first

## Quick Decision Flowchart

```
START
  │
  ├─ New project? ─────────────────────────────────────────┐
  │     │                                                   │
  │     ├─ Using Anchor? ──► YES ──► Use @solana/web3.js   │
  │     │                                                   │
  │     └─ No Anchor? ──► Use @solana/kit                  │
  │                                                         │
  └─ Existing project? ────────────────────────────────────┤
        │                                                   │
        ├─ Performance issues? ──► Consider migration      │
        │                                                   │
        ├─ Bundle size issues? ──► Consider migration      │
        │                                                   │
        └─ Working fine? ──► Stay with current SDK         │
```

## Instructions for Migration Analysis

When a user asks about migration, follow these steps:

### Step 1: Analyze Current Codebase

Run the migration analysis script to detect:
- Which SDK version is currently used
- Anchor dependencies
- Third-party SDK dependencies
- Usage patterns that need migration

```bash
# Use the analyze-migration.sh script in scripts/
./scripts/analyze-migration.sh /path/to/project
```

### Step 2: Check Dependencies

Look for these blocking dependencies:
- `@coral-xyz/anchor` or `@project-serum/anchor` - Wait for Anchor Kit support
- SDKs that haven't migrated (check their package.json)

### Step 3: Assess Migration Complexity

Count occurrences of these patterns that need changes:
- `new Connection(...)` → `createSolanaRpc(...)`
- `Keypair.fromSecretKey(...)` → `createKeyPairSignerFromBytes(...)`
- `new PublicKey(...)` → `address(...)`
- `new Transaction()` → `createTransactionMessage(...)`
- Class-based patterns → Functional composition with `pipe()`

### Step 4: Recommend Strategy

Based on findings, recommend:
- **Full Migration**: If no blockers and < 50 migration points
- **Gradual Migration**: If 50-200 migration points, use `@solana/compat`
- **Wait**: If Anchor-dependent or critical SDKs don't support Kit
- **Hybrid**: If only specific modules need Kit performance

## API Migration Reference

See `resources/api-mappings.md` for complete mappings. Key conversions:

### Connection → RPC

```typescript
// v1
const connection = new Connection(url, 'confirmed');
const balance = await connection.getBalance(pubkey);

// Kit
const rpc = createSolanaRpc(url);
const { value: balance } = await rpc.getBalance(address).send();
```

### Keypair → KeyPairSigner

```typescript
// v1
const keypair = Keypair.fromSecretKey(secretKey);
console.log(keypair.publicKey.toBase58());

// Kit
const signer = await createKeyPairSignerFromBytes(secretKey);
console.log(signer.address);
```

### Transaction Building

```typescript
// v1
const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: sender.publicKey,
    toPubkey: recipient,
    lamports: amount,
  })
);
tx.recentBlockhash = blockhash;
tx.feePayer = sender.publicKey;

// Kit
const tx = pipe(
  createTransactionMessage({ version: 0 }),
  tx => setTransactionMessageFeePayer(sender.address, tx),
  tx => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
  tx => appendTransactionMessageInstruction(
    getTransferSolInstruction({
      source: sender,
      destination: address(recipient),
      amount: lamports(BigInt(amount)),
    }),
    tx
  ),
);
```

## Edge Cases & Gotchas

### 1. BigInt Conversion

Kit uses native BigInt everywhere. Watch for:
```typescript
// WRONG - will fail
const amount = 1000000000;

// CORRECT
const amount = 1_000_000_000n;
// or
const amount = BigInt(1000000000);
// or use helper
const amount = lamports(1_000_000_000n);
```

### 2. Base58 Encoding Errors

Kit may require explicit encoding:
```typescript
// If you see: "Encoded binary (base 58) data should be less than 128 bytes"
// Add encoding parameter:
await rpc.getAccountInfo(address, { encoding: 'base64' }).send();
```

### 3. Async Keypair Generation

Kit keypair creation is async (uses WebCrypto):
```typescript
// v1 - synchronous
const keypair = Keypair.generate();

// Kit - MUST await
const keypair = await generateKeyPairSigner();
```

### 4. RPC Method Chaining

Kit RPC calls require `.send()`:
```typescript
// v1
const balance = await connection.getBalance(pubkey);

// Kit - don't forget .send()!
const { value: balance } = await rpc.getBalance(address).send();
```

### 5. PublicKey vs Address

These are different types and not interchangeable:
```typescript
// Use @solana/compat for conversion
import { fromLegacyPublicKey, toLegacyPublicKey } from '@solana/compat';

const kitAddress = fromLegacyPublicKey(legacyPublicKey);
const legacyPubkey = toLegacyPublicKey(kitAddress);
```

### 6. Transaction Signing

Signing flow is different:
```typescript
// v1
transaction.sign(keypair);
// or
const signed = await connection.sendTransaction(tx, [keypair]);

// Kit - use signer pattern
const signedTx = await signTransactionMessageWithSigners(txMessage);
const signature = await sendAndConfirmTransaction(signedTx);
```

### 7. Anchor Incompatibility

Anchor generates v1 types. If using Anchor:
```typescript
// Keep @solana/web3.js for Anchor interactions
import { Connection, PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';

// Use Kit for non-Anchor parts if needed
// Bridge with @solana/compat
```

### 8. Subscription Handling

Kit uses AsyncIterators:
```typescript
// v1
const subscriptionId = connection.onAccountChange(pubkey, callback);
connection.removeAccountChangeListener(subscriptionId);

// Kit - use AbortController
const abortController = new AbortController();
const notifications = await rpcSubscriptions
  .accountNotifications(address)
  .subscribe({ abortSignal: abortController.signal });

for await (const notification of notifications) {
  // handle notification
}
// To unsubscribe:
abortController.abort();
```

### 9. VersionedTransaction Migration

```typescript
// v1
const versionedTx = new VersionedTransaction(messageV0);

// Kit - transactions are versioned by default
const tx = createTransactionMessage({ version: 

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/solana-kit-migration for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/solana-kit-migration
