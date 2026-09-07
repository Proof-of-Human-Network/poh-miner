---
id: ritual_deploy
version: 1.0.0
description: Deployment and chain configuration for Ritual dApps. Use when deploying contracts, configuring chain connection, or setting up development environment.
triggers:
  - ritual deploy
  - deploy to ritual
  - ritual testnet
---

## Context
# Ritual Chain — Deployment & Configuration Guide

## Chain Configuration

### Core Parameters

| Parameter | Value |
|-----------|-------|
| Chain ID | `1979` |
| Chain Name | `Ritual` |
| Native Currency | RITUAL (18 decimals, testnet, no real value) |
| RPC (HTTP) | `https://rpc.ritualfoundation.org` |
| RPC (WebSocket) | `wss://rpc.ritualfoundation.org/ws` |
| Block Explorer | `https://explorer.ritualfoundation.org` |

> **EIP-1559 only.** Ritual Chain requires EIP-1559 (type-2) transactions. Legacy (type-0) transactions are rejected with `transaction type not supported`. Do NOT use `--legacy` flag with forge/cast, and ensure your web3 library sends EIP-1559 transactions (viem does this by default; web3.py and ethers.js may need explicit configuration).

### viem Chain & Client Setup

Create viem clients configured for Ritual Chain:

```typescript
import { createPublicClient, createWalletClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ritualChain = defineChain({
  id: 1979,
  name: 'Ritual',
  nativeCurrency: { name: 'RITUAL', symbol: 'RITUAL', decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.RITUAL_RPC_URL || 'https://rpc.ritualfoundation.org'],
      webSocket: [process.env.RITUAL_WS_URL || 'wss://rpc.ritualfoundation.org/ws'],
    },
  },
  blockExplorers: {
    default: { name: 'Ritual Explorer', url: 'https://explorer.ritualfoundation.org' },
  },
  contracts: {
    multicall3: { address: '0x5577Ea679673Ec7508E9524100a188E7600202a3' },
  },
});

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: ritualChain, transport: http() });
const walletClient = createWalletClient({ account, chain: ritualChain, transport: http() });
```

### viem Chain Definition (Standalone)

A standalone chain definition for use in wagmi config or other contexts:

```typescript
import { defineChain } from 'viem';

export const ritualChain = defineChain({
  id: 1979,
  name: 'Ritual',
  nativeCurrency: {
    decimals: 18,
    name: 'Ritual',
    symbol: 'RITUAL',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.ritualfoundation.org'],
      webSocket: ['wss://rpc.ritualfoundation.org/ws'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Ritual Explorer',
      url: 'https://explorer.ritualfoundation.org',
    },
  },
  contracts: {
    multicall3: {
      address: '0x5577Ea679673Ec7508E9524100a188E7600202a3',
    },
  },
});
```

## wagmi Configuration

### Basic wagmi Setup

```typescript
import { http, createConfig } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import { defineChain } from 'viem';

const ritualChain = defineChain({
  id: 1979,
  name: 'Ritual',
  nativeCurrency: {
    decimals: 18,
    name: 'Ritual',
    symbol: 'RITUAL',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.ritualfoundation.org'],
      webSocket: ['wss://rpc.ritualfoundation.org/ws'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Ritual Explorer',
      url: 'https://explorer.ritualfoundation.org',
    },
  },
  contracts: {
    multicall3: {
      address: '0x5577Ea679673Ec7508E9524100a188E7600202a3',
    },
  },
});

export const config = createConfig({
  chains: [ritualChain],
  connectors: [
    injected(),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!,
    }),
  ],
  transports: {
    [ritualChain.id]: http('https://rpc.ritualfoundation.org'),
  },
});
```

### wagmi with RainbowKit

```typescript
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain } from 'viem';

const ritualChain = defineChain({
  id: 1979,
  name: 'Ritual',
  nativeCurrency: { decimals: 18, name: 'Ritual', symbol: 'RITUAL' },
  rpcUrls: {
    default: {
      http: ['https://rpc.ritualfoundation.org'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Ritual Explorer',
      url: 'https://explorer.ritualfoundation.org',
    },
  },
});

export const config = getDefaultConfig({
  appName: 'My Ritual dApp',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!,
  chains: [ritualChain],
});
```

### Next.js App Layout with wagmi

```typescript
// app/providers.tsx
'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from './wagmi';

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

## Contract Deployment with Foundry

### foundry.toml Configuration

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.20"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
ritual = "${RITUAL_RPC_URL}"

[etherscan]
ritual = { key = "unused", url = "${RITUAL_VERIFIER_URL}" }
```

### Deploy Script

```solidity
// script/Deploy.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MyRitualConsumer} from "../src/MyRitualConsumer.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        MyRitualConsumer consumer = new MyRitualConsumer();
        console.log("MyRitualConsumer deployed to:", address(consumer));

        vm.stopBroadcast();
    }
}
```

### Deploy Commands

```bash
# Load environment
source .env

# Deploy to Ritual Chain
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $RITUAL_RPC_URL \
  --broadcast \
  -vvvv

# Verify an already-deployed contract
forge verify-contract \
  --chain 1979 \
  --watch \
  --verifier custom \
  --verifier-url "$RITUAL_VERIFIER_URL" \
  --verifier-api-key unused \
  <CONTRACT_ADDRESS> \
  src/MyRitualConsumer.sol:MyRitualConsumer
```

### Deploy with `forge create` (Single Contract)

`forge create` deploys a single contract without needing a deploy script. This is useful for quick deployments and testing.

```bash
# Basic deployment
forge create src/MyRitualConsumer.sol:MyRitualConsumer \
  --rpc-url $RITUAL_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast

# With constructor arguments
forge create src/MyRitualConsumer.sol:MyRitualConsumer \
  --rpc-url $RITUAL_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --constructor-args 0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948 100

# Deploy + verify in one command
forge create src/MyRitualConsumer.sol:MyRitualConsumer \
  --rpc-url $RITUAL_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --verifier custom \
  --verifier-url "$RITUAL_VERIFIER_URL" \
  --verifier-api-key unused
```

> **Warning**: Without `--broadcast`, `forge create` only simulates the deployment — the contract will NOT actually be deployed on-chain. Always include `--broadcast` for real deployments.
>
> **Verification note**: Use `--verifier custom` with the chain's verification service URL. Do NOT use Sourcify (chain 1979 is not registered). Do NOT point at the scanner UI hostname — use the RPC domain's `/api/verify/` path.
---
Source: `ritual-foundation/ritual-dapp-skills` — The Clear BSD License, (c) 2026 Ritual Foundation.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/ritual-dapp-deploy/SKILL.md` from `ritual-foundation/ritual-dapp-skills` with the `gitmcp` MCP.
