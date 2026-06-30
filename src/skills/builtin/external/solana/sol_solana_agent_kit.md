---
id: sol_solana_agent_kit
version: 1.0.0
description: Comprehensive guide for building AI agents that interact with Solana blockchain using SendAI's Solana Agent Kit. Covers 60+ actions, LangChain/Vercel AI integration, MCP server setup, and autonomous agent patterns. This is SendAI's AI-agent toolkit (the package "solana-agent-kit") — a distinct product from @solana/kit (the Anza low-level RPC/transaction SDK, see sol_solana_kit) despite the similar name; use this one specifically for building autonomous AI agents.
triggers:
  - solana agent kit
  - solana-agent-kit
  - sendai
  - ai agent solana
  - autonomous agent solana
  - langchain solana
  - vercel ai solana
  - agent kit mcp
  - solana ai agent
  - 60+ actions
---

## Context

# Solana Agent Kit Development Guide

Build AI agents that autonomously execute **60+ Solana blockchain operations** using SendAI's open-source toolkit. Compatible with LangChain, Vercel AI SDK, and Claude via MCP.

## Overview

The Solana Agent Kit enables any AI model to:
- Deploy and manage tokens (SPL & Token-2022)
- Create and trade NFTs via Metaplex
- Execute DeFi operations (Jupiter, Raydium, Orca, Meteora)
- Stake SOL, bridge tokens, register domains
- Run in interactive or fully autonomous modes

### Key Features

| Feature | Description |
|---------|-------------|
| **60+ Actions** | Token, NFT, DeFi, staking, bridging operations |
| **Plugin Architecture** | Modular - use only what you need |
| **Multi-Framework** | LangChain, Vercel AI SDK, MCP, Eliza |
| **Model Agnostic** | Works with OpenAI, Claude, Llama, Gemini |
| **Autonomous Mode** | Hands-off execution with error recovery |

## Quick Start

### Installation

```bash
# Core package
npm install solana-agent-kit

# With plugins (recommended)
npm install solana-agent-kit \
  @solana-agent-kit/plugin-token \
  @solana-agent-kit/plugin-nft \
  @solana-agent-kit/plugin-defi \
  @solana-agent-kit/plugin-misc \
  @solana-agent-kit/plugin-blinks
```

### Environment Setup

```bash
# .env file
OPENAI_API_KEY=your_openai_api_key
RPC_URL=https://api.mainnet-beta.solana.com  # or devnet
SOLANA_PRIVATE_KEY=your_base58_private_key

# Optional API keys for enhanced features
COINGECKO_API_KEY=your_coingecko_key
HELIUS_API_KEY=your_helius_key
```

### Basic Agent Setup

```typescript
import {
  SolanaAgentKit,
  createVercelAITools,
  KeypairWallet,
} from "solana-agent-kit";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// Import plugins
import TokenPlugin from "@solana-agent-kit/plugin-token";
import NFTPlugin from "@solana-agent-kit/plugin-nft";
import DefiPlugin from "@solana-agent-kit/plugin-defi";
import MiscPlugin from "@solana-agent-kit/plugin-misc";
import BlinksPlugin from "@solana-agent-kit/plugin-blinks";

// Create wallet from private key
const privateKey = bs58.decode(process.env.SOLANA_PRIVATE_KEY!);
const keypair = Keypair.fromSecretKey(privateKey);
const wallet = new KeypairWallet(keypair);

// Initialize agent with plugins
const agent = new SolanaAgentKit(
  wallet,
  process.env.RPC_URL!,
  {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  }
)
  .use(TokenPlugin)
  .use(NFTPlugin)
  .use(DefiPlugin)
  .use(MiscPlugin)
  .use(BlinksPlugin);

// Create tools for AI framework
const tools = createVercelAITools(agent, agent.actions);
```

## Plugins & Actions

### Token Plugin (`@solana-agent-kit/plugin-token`)

| Action | Description |
|--------|-------------|
| `deployToken` | Deploy new SPL token or Token-2022 |
| `transfer` | Transfer SOL or SPL tokens |
| `getBalance` | Check token balances |
| `stake` | Stake SOL via Jupiter/Solayer |
| `bridge` | Bridge tokens via Wormhole |
| `rugCheck` | Analyze token safety |

```typescript
// Deploy a new token
const result = await agent.methods.deployToken({
  name: "My Token",
  symbol: "MTK",
  decimals: 9,
  initialSupply: 1000000,
});

// Transfer tokens
await agent.methods.transfer({
  to: "recipient_address",
  amount: 100,
  mint: "token_mint_address", // optional, defaults to SOL
});

// Check balance
const balance = await agent.methods.getBalance({
  tokenAddress: "token_mint_address", // optional
});
```

### NFT Plugin (`@solana-agent-kit/plugin-nft`)

| Action | Description |
|--------|-------------|
| `createCollection` | Create NFT collection via Metaplex |
| `mintNFT` | Mint NFT to collection |
| `listNFT` | List NFT on marketplaces |
| `updateMetadata` | Update NFT metadata |

```typescript
// Create collection
const collection = await agent.methods.createCollection({
  name: "My Collection",
  symbol: "MYCOL",
  uri: "https://arweave.net/metadata.json",
});

// Mint NFT to collection
const nft = await agent.methods.mintNFT({
  collectionMint: collection.collectionAddress,
  name: "NFT #1",
  uri: "https://arweave.net/nft1.json",
});
```

### DeFi Plugin (`@solana-agent-kit/plugin-defi`)

| Action | Description |
|--------|-------------|
| `trade` | Swap tokens via Jupiter |
| `createRaydiumPool` | Create Raydium AMM pool |
| `createOrcaPool` | Create Orca Whirlpool |
| `createMeteoraPool` | Create Meteora DLMM pool |
| `limitOrder` | Place limit order via Manifest |
| `lend` | Lend assets via Lulo |
| `perpetualTrade` | Trade perps via Adrena/Drift |

```typescript
// Swap tokens via Jupiter
const swap = await agent.methods.trade({
  outputMint: "target_token_mint",
  inputAmount: 1.0,
  inputMint: "So11111111111111111111111111111111111111112", // SOL
  slippageBps: 50, // 0.5%
});

// Create Raydium CPMM pool
const pool = await agent.methods.createRaydiumCpmm({
  mintA: "token_a_mint",
  mintB: "token_b_mint",
  configId: "config_id",
  mintAAmount: 1000,
  mintBAmount: 1000,
});
```

### Misc Plugin (`@solana-agent-kit/plugin-misc`)

| Action | Description |
|--------|-------------|
| `airdrop` | ZK-compressed airdrop via Helius |
| `getPrice` | Get token price via CoinGecko |
| `registerDomain` | Register .sol domain |
| `resolveDomain` | Resolve domain to address |
| `getTPS` | Get network TPS |

```typescript
// Compressed airdrop (cost-efficient)
const airdrop = await agent.methods.sendCompressedAirdrop({
  mintAddress: "token_mint",
  amount: 100,
  recipients: ["addr1", "addr2", "addr3"],
  priorityFeeInLamports: 10000,
});

// Get token price
const price = await agent.methods.getPrice({
  tokenId: "solana", // CoinGecko ID
});
```

### Blinks Plugin (`@solana-agent-kit/plugin-blinks`)

Execute Solana Actions/Blinks directly:

```typescript
// Execute a Blink
const result = await agent.methods.executeBlink({
  blinkUrl: "https://example.com/blink",
  params: { /* blink-specific params */ },
});
```

## Integration Patterns

### LangChain Integration

```typescript
import { SolanaAgentKit, createSolanaTools } from "solana-agent-kit";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";

async function createLangChainAgent() {
  // Initialize LLM
  const llm = new ChatOpenAI({
    modelName: "gpt-4-turbo-preview",
    temperature: 0.7,
  });

  // Initialize Solana Agent Kit
  const solanaKit = new SolanaAgentKit(
    wallet,
    process.env.RPC_URL!,
    { OPENAI_API_KEY: process.env.OPENAI_API_KEY! }
  )
    .use(TokenPlugin)
    .use(DefiPlugin);

  // Create LangChain tools
  const tools = createSolanaTools(solanaKit);

  // Create agent with memory
  const memory = new MemorySaver();
  const agent = createReactAgent({
    llm,
    tools,
    checkpointSaver: memory,
  });

  return agent;
}

// Run agent
async function chat(agent: any, message: string) {
  const config = { configurable: { thread_id: "solana-agent" } };

  const stream = await agent.stream(
    { messages: [new HumanMessage(message)] },
    config
  );

  for await (const chunk of stream) {
    if ("agent" in chunk) {
      console.log(chunk.agent.messages[0].content);
    }
  }
}
```

### Vercel AI SDK Integration

```typescript
import { SolanaAgentKit, createVercelAITools } from "solana-agent-kit";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

async function runVercelAgent(prompt: string) {
  const agent = new SolanaAgentKit(wallet, rpcUrl, options)
    .use(TokenPlugin)
    .use(DefiPlugin);

  const tools = createVercelAITools(agent, agent.actions);

  const result = await generateText({
    model: openai("gpt-4-turbo"),
    tools,
    maxSteps: 10,
    prompt,
  });

  return result.text;
}

// Usage
const response = await runVercelAgent(
  "Swap 0.1 SOL for USDC using the best rate"
);
```

### MCP Server for Claude

Install and configure the MCP server for Claude Desktop:

```bash
# Install globally
npm install -g

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/solana-agent-kit for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/solana-agent-kit
