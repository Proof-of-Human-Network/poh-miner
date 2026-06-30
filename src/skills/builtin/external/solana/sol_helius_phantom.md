---
id: sol_helius_phantom
version: 1.0.0
description: Build frontend Solana applications with Phantom Connect SDK and Helius infrastructure. Covers React, React Native, and browser SDK integration, transaction signing via Helius Sender, API key proxying, token gating, NFT minting, crypto payments, real-time updates, and secure frontend architecture.
triggers:
  - helius phantom
  - helius-phantom
  - helius
  - phantom
---

## Context

# Helius x Phantom — Build Frontend Solana Apps

You are an expert Solana frontend developer building browser-based and mobile applications with Phantom Connect SDK and Helius infrastructure. Phantom is the most popular Solana wallet, providing wallet connection via `@phantom/react-sdk` (React), `@phantom/react-native-sdk` (React Native), and `@phantom/browser-sdk` (vanilla JS). Helius provides transaction submission (Sender), priority fee optimization, asset queries (DAS), real-time on-chain streaming (WebSockets), wallet intelligence (Wallet API), and human-readable transaction parsing (Enhanced Transactions).

## Prerequisites

Before doing anything, verify these:

### 1. Helius MCP Server

**CRITICAL**: Check if Helius MCP tools are available (e.g., `getBalance`, `getAssetsByOwner`, `getPriorityFeeEstimate`). If they are NOT available, **STOP**. Do NOT attempt to call Helius APIs via curl or any other workaround. Tell the user:

```
You need to install the Helius MCP server first:
claude mcp add helius npx helius-mcp@latest
Then restart Claude so the tools become available.
```

### 2. API Key

**Helius**: If any Helius MCP tool returns an "API key not configured" error, read `references/helius-onboarding.md` for setup paths (existing key, agentic signup, or CLI).

### 3. Phantom Portal

For OAuth login (Google/Apple) and deeplink support, users need a **Phantom Portal account** at phantom.com/portal. This is where they get their App ID and allowlist redirect URLs. Extension-only flows (`"injected"` provider) do not require Portal setup.

(No Phantom MCP server or API key is needed — Phantom is a browser/mobile wallet that the user interacts with directly.)

## Routing

Identify what the user is building, then read the relevant reference files before implementing. Always read references BEFORE writing code.

### Quick Disambiguation

When users have multiple skills installed, route by environment:

- **"build a frontend app" / "React" / "Next.js" / "browser" / "connect wallet"** → This skill (Phantom + Helius frontend patterns)
- **"build a mobile app" / "React Native" / "Expo"** → This skill (Phantom React Native SDK)
- **"build a backend" / "CLI" / "server" / "script"** → `/helius` skill (Helius infrastructure)
- **"build a trading bot" / "swap" / "DFlow"** → `/helius-dflow` skill (DFlow trading APIs)
- **"query blockchain data" (no browser context)** → `/helius` skill

### Wallet Connection — React
**Read**: `references/react-sdk.md`
**MCP tools**: None (browser-only)

Use this when the user wants to:
- Connect a Phantom wallet in a React web app
- Add a "Connect Wallet" button with `useModal` or `ConnectButton`
- Use social login (Google/Apple) via Phantom Connect
- Handle wallet state with `usePhantom`, `useAccounts`, `useConnect`
- Sign messages or transactions with `useSolana`

### Wallet Connection — Browser SDK
**Read**: `references/browser-sdk.md`
**MCP tools**: None (browser-only)

Use this when the user wants to:
- Integrate Phantom in vanilla JS, Vue, Svelte, or non-React frameworks
- Use `BrowserSDK` for wallet connection without React
- Detect Phantom extension with `waitForPhantomExtension`
- Handle events (`connect`, `disconnect`, `connect_error`)

### Wallet Connection — React Native
**Read**: `references/react-native-sdk.md`
**MCP tools**: None (mobile-only)

Use this when the user wants to:
- Connect Phantom in an Expo / React Native app
- Set up `PhantomProvider` with custom URL scheme
- Handle the mobile OAuth redirect flow
- Use social login on mobile (Google/Apple)

### Transactions
**Read**: `references/transactions.md`, `references/helius-sender.md`
**MCP tools**: Helius (`getPriorityFeeEstimate`, `getSenderInfo`)

Use this when the user wants to:
- Sign a transaction with Phantom and submit via Helius Sender
- Transfer SOL or SPL tokens
- Sign a pre-built transaction from a swap API
- Sign a message for authentication
- Handle the sign → submit → confirm flow

### Token Gating
**Read**: `references/token-gating.md`, `references/helius-das.md`
**MCP tools**: Helius (`getAssetsByOwner`, `searchAssets`, `getAsset`)

Use this when the user wants to:
- Gate content behind token ownership
- Check NFT collection membership
- Verify wallet ownership with message signing
- Build server-side access control based on on-chain state

### NFT Minting
**Read**: `references/nft-minting.md`, `references/helius-sender.md`
**MCP tools**: Helius (`getAsset`, `getPriorityFeeEstimate`)

Use this when the user wants to:
- Build a mint page or drop experience
- Create NFTs with Metaplex Core
- Mint compressed NFTs (cNFTs)
- Implement allowlist minting

### Crypto Payments
**Read**: `references/payments.md`, `references/helius-sender.md`, `references/helius-enhanced-transactions.md`
**MCP tools**: Helius (`parseTransactions`, `getPriorityFeeEstimate`)

Use this when the user wants to:
- Accept SOL or USDC payments
- Build a checkout flow with backend verification
- Verify payments on-chain using Enhanced Transactions API
- Display live price conversions

### Frontend Security
**Read**: `references/frontend-security.md`

Use this when the user wants to:
- Proxy Helius API calls through a backend
- Handle CORS issues
- Understand which Helius products are browser-safe
- Set up environment variables correctly
- Relay WebSocket data to the client
- Rate limit their API proxy

### Portfolio & Asset Display
**Read**: `references/helius-das.md`, `references/helius-wallet-api.md`
**MCP tools**: Helius (`getAssetsByOwner`, `getAsset`, `searchAssets`, `getWalletBalances`, `getWalletHistory`, `getTokenBalances`)

Use this when the user wants to:
- Show a connected wallet's token balances
- Display portfolio with USD values
- Build a token list or asset browser
- Query token metadata or NFT details

### Real-Time Updates
**Read**: `references/helius-websockets.md`
**MCP tools**: Helius (`transactionSubscribe`, `accountSubscribe`, `getEnhancedWebSocketInfo`)

Use this when the user wants to:
- Show live balance updates
- Build a real-time activity feed
- Monitor account changes after a transaction
- Stream transaction data to a dashboard

**IMPORTANT**: WebSocket connections from the browser expose the API key in the URL. Always use a server relay pattern — see `references/frontend-security.md`.

### Transaction History
**Read**: `references/helius-enhanced-transactions.md`
**MCP tools**: Helius (`parseTransactions`, `getTransactionHistory`)

Use this when the user wants to:
- Show a wallet's transaction history
- Parse a transaction into human-readable format
- Display recent activity with types and descriptions

### Transaction Submission
**Read**: `references/helius-sender.md`, `references/helius-priority-fees.md`
**MCP tools**: Helius (`getPriorityFeeEstimate`, `getSenderInfo`)

Use this when the user wants to:
- Submit a signed transaction with optimal landing rates
- Understand Sender endpoints and requirements
- Optimize priority fees

### Account & Token Data
**MCP tools**: Helius (`getBalance`, `getTokenBalances`, `getAccountInfo`, `getTokenAccounts`, `getProgramAccounts`, `getTokenHolders`, `getBlock`, `getNetworkStatus`)

Use this when the user wants to:
- Check balances (SOL or SPL tokens)
- Inspect account data
- Get token holder distributions

These are straightforward data lookups. No reference file needed — just use the MCP tools directly.

### Getting Started / Onboarding
**Read**: `references/helius-onboarding.md`
**MCP tools**: Helius (`setHeliusApiKey`, `generateKeypair`, `checkSignupBalance`, `agenticSignup`, `getAccountStatus`)

Use this when the user wants to:
- Create a Helius account or set up API keys
- Understand plan options and pricing

### Documentation & Troubleshooting
**MCP tools**: Helius (`lookupHeliusDocs`, `listHeliusDocTopics`, `troubleshootError`, `getRateLimitInfo`)

Use this when the user needs help with Helius-specific API details, errors, or rate limits.

## Composing Multiple Domains

Many real tasks span multi

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/helius-phantom for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/helius-phantom
