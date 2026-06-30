---
id: sol_metaplex
version: 1.0.0
description: Complete Metaplex Protocol guide for Solana NFTs and digital assets. Covers Core (next-gen NFTs), Token Metadata, Bubblegum (compressed NFTs), Candy Machine, Genesis (token launches), MPL-Hybrid, Inscriptions, DAS API, and the Umi framework. The single source of truth for all Metaplex integrations.
triggers:
  - metaplex
  - nft solana
  - mint nft solana
  - candy machine
  - bubblegum
  - compressed nft
  - token metadata solana
  - umi framework
  - metaplex core
  - nft collection solana
  - mpl-hybrid
---

## Context

# Metaplex Protocol Development Guide

A comprehensive guide for building NFTs, digital assets, and token launches on Solana using the Metaplex Protocol - the industry standard powering 99% of Solana NFTs and tokens.

## What is Metaplex?

Metaplex is the leading tokenization protocol on Solana, providing smart contracts and tools for creating, selling, and managing digital assets. From simple NFTs to compressed collections of billions, from fair token launches to hybrid token/NFT systems, Metaplex provides the infrastructure.

### Key Statistics

- **99%** of Solana NFTs use Metaplex standards
- **$10B+** in transaction value facilitated
- **78%** of Solana NFTs minted via Candy Machine (as of 2022)
- **Billions** of compressed NFTs possible at minimal cost

## Overview

Metaplex provides multiple products for different use cases:

### NFT Standards

| Product | Description | Cost per Mint |
|---------|-------------|---------------|
| **Core** | Next-gen single-account NFT standard | ~0.0029 SOL |
| **Token Metadata** | Original NFT standard with PDAs | ~0.022 SOL |
| **Bubblegum v2** | Compressed NFTs (cNFTs) | ~0.00009 SOL |

### Launch & Distribution

| Product | Description |
|---------|-------------|
| **Candy Machine** | NFT collection minting with guards |
| **Core Candy Machine** | Candy Machine for Core assets |
| **Genesis** | Token Generation Event (TGE) platform |

### Utilities

| Product | Description |
|---------|-------------|
| **MPL-Hybrid** | Swap between fungible and non-fungible |
| **Inscriptions** | On-chain data storage (up to 10MB) |
| **DAS API** | Unified API for fetching digital assets |
| **Umi** | JavaScript framework for Solana clients |

---

## Program IDs

### Core Programs (Mainnet & Devnet)

| Program | Address |
|---------|---------|
| **MPL Core** | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` |
| **Token Metadata** | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` |
| **Bubblegum** | `BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY` |
| **Candy Machine V3** | `CndyV3LdqHUfDLmE5naZjVN8rBZz4tqhdefbAnjHG3JR` |
| **Candy Guard** | `Guard1JwRhJkVH6XZhzoYxeBVQe872VH6QggF4BWmS9g` |
| **Core Candy Machine** | `CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J` |
| **Core Candy Guard** | `CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ` |
| **MPL Hybrid** | `MPL4o4wMzndgh8T1NVDxELQCj5UQfYTYEkabX3wNKtb` |
| **Inscription** | `1NSCRfGeyo7wPUazGbaPBUsTM49e1k2aXewHGARfzSo` |

### SPL Programs (Required)

| Program | Address |
|---------|---------|
| **SPL Token** | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| **Token 2022** | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| **Associated Token** | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |
| **Account Compression** | `cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK` |

---

## Quick Start

### Installation

```bash
# Core NFTs (Recommended for new projects)
npm install @metaplex-foundation/mpl-core \
  @metaplex-foundation/umi \
  @metaplex-foundation/umi-bundle-defaults

# Token Metadata NFTs
npm install @metaplex-foundation/mpl-token-metadata \
  @metaplex-foundation/umi \
  @metaplex-foundation/umi-bundle-defaults

# Compressed NFTs (Bubblegum)
npm install @metaplex-foundation/mpl-bubblegum \
  @metaplex-foundation/umi \
  @metaplex-foundation/umi-bundle-defaults

# Candy Machine
npm install @metaplex-foundation/mpl-candy-machine \
  @metaplex-foundation/umi \
  @metaplex-foundation/umi-bundle-defaults

# Core Candy Machine
npm install @metaplex-foundation/mpl-core-candy-machine \
  @metaplex-foundation/umi \
  @metaplex-foundation/umi-bundle-defaults

# Genesis (Token Launches)
npm install @metaplex-foundation/mpl-genesis \
  @metaplex-foundation/umi \
  @metaplex-foundation/umi-bundle-defaults

# File uploads (Arweave via Irys)
npm install @metaplex-foundation/umi-uploader-irys
```

### Umi Setup

All Metaplex SDKs use Umi, a modular Solana framework:

```typescript
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import {
  keypairIdentity,
  generateSigner
} from '@metaplex-foundation/umi';

// Create Umi instance
const umi = createUmi('https://api.mainnet-beta.solana.com')
  .use(mplCore());

// Option 1: Use generated keypair
const signer = generateSigner(umi);
umi.use(keypairIdentity(signer));

// Option 2: Use existing keypair
import { createSignerFromKeypair } from '@metaplex-foundation/umi';
const keypair = umi.eddsa.createKeypairFromSecretKey(secretKeyBytes);
const signer = createSignerFromKeypair(umi, keypair);
umi.use(keypairIdentity(signer));

// Option 3: Use wallet adapter (browser)
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
umi.use(walletAdapterIdentity(wallet));
```

---

## MPL Core (Recommended)

The next-generation NFT standard with single-account design, lower costs, and built-in plugins.

### Why Core?

| Feature | Core | Token Metadata |
|---------|------|----------------|
| Accounts per NFT | 1 | 4+ |
| Mint Cost | ~0.0029 SOL | ~0.022 SOL |
| Compute Units | ~17,000 | ~205,000 |
| Enforced Royalties | Yes | No |
| Plugin System | Yes | No |

### Create a Core NFT

```typescript
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCore,
  create,
  fetchAsset
} from '@metaplex-foundation/mpl-core';
import {
  generateSigner,
  keypairIdentity
} from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';

// Setup
const umi = createUmi('https://api.mainnet-beta.solana.com')
  .use(mplCore())
  .use(irysUploader());

// Upload metadata
const metadata = {
  name: 'My Core NFT',
  description: 'A next-gen NFT on Solana',
  image: 'https://arweave.net/your-image',
  attributes: [
    { trait_type: 'Background', value: 'Blue' },
    { trait_type: 'Rarity', value: 'Legendary' }
  ]
};
const metadataUri = await umi.uploader.uploadJson(metadata);

// Create NFT
const asset = generateSigner(umi);
await create(umi, {
  asset,
  name: 'My Core NFT',
  uri: metadataUri,
}).sendAndConfirm(umi);

console.log('Asset created:', asset.publicKey);

// Fetch the asset
const fetchedAsset = await fetchAsset(umi, asset.publicKey);
console.log('Asset data:', fetchedAsset);
```

### Core with Plugins

```typescript
import {
  create,
  ruleSet,
  plugin,
} from '@metaplex-foundation/mpl-core';

// Create with royalty enforcement
await create(umi, {
  asset,
  name: 'Royalty Enforced NFT',
  uri: metadataUri,
  plugins: [
    {
      type: 'Royalties',
      basisPoints: 500, // 5%
      creators: [
        { address: creatorAddress, percentage: 100 }
      ],
      ruleSet: ruleSet('None'), // or 'ProgramAllowList', 'ProgramDenyList'
    },
    {
      type: 'FreezeDelegate',
      frozen: false,
      authority: { type: 'Owner' },
    },
    {
      type: 'TransferDelegate',
      authority: { type: 'Owner' },
    },
  ],
}).sendAndConfirm(umi);
```

### Core Collections

```typescript
import {
  createCollection,
  create,
  fetchCollection,
} from '@metaplex-foundation/mpl-core';

// Create collection
const collection = generateSigner(umi);
await createCollection(umi, {
  collection,
  name: 'My Collection',
  uri: collectionUri,
}).sendAndConfirm(umi);

// Create asset in collection
const asset = generateSigner(umi);
await create(umi, {
  asset,
  name: 'Collection Item #1',
  uri: assetUri,
  collection: collection.publicKey,
}).sendAndConfirm(umi);
```

### Transfer & Burn

```typescript
import { transfer, burn } from '@metaplex-foundation/mpl-core';

// Transfer
await transfer(umi, {
  asset: assetPublicKey,
  newOwner: recipientPublicKey,
}).sendAndConfirm(umi);

// Burn
await burn(umi, {
  asset: assetPublicKey,
}).sendAndConfirm(umi);
```

---

## Token Metadata

The original Solana NFT standard using Program Derived Addresses (PDAs).

### Create NFT with Token Metadata

```typescript
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mp

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/metaplex for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/metaplex
