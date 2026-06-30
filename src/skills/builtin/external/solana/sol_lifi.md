---
id: sol_lifi
version: 1.0.0
description: Integrate LI.FI for cross-chain swaps, bridging, payments, route discovery, and transfer status tracking across Solana, EVM, Bitcoin, and Sui. Use when building Solana applications or AI agents that need quotes, routes, executable transactions, supported chains/tokens/tools, or cross-chain transfer monitoring.
triggers:
  - lifi
---

## Context

# LI.FI Cross-Chain Integration Guide

Use LI.FI when a Solana app, wallet, backend, or AI agent needs cross-chain token transfers, bridge aggregation, same-chain swaps, payment flows, or transfer status tracking. LI.FI exposes the same routing engine through REST API, SDK, MCP server, CLI, and Widget surfaces.

## Overview

LI.FI is a multi-chain liquidity aggregation platform for swaps and bridging. For agent and backend integrations, the REST API is the lowest-dependency default. For frontend apps, prefer the SDK because it handles wallets, signing, execution tracking, and ecosystem-specific transaction handling. For MCP-compatible AI hosts, prefer the LI.FI MCP server for typed tool discovery.

Core capabilities:

- **Quotes**: Get a ready-to-sign transaction for the best route.
- **Routes**: Compare multiple route options and execute step-by-step.
- **Status tracking**: Track source and destination chain transfer progress.
- **Discovery**: Query supported chains, tokens, bridges, and exchanges at runtime.
- **Solana support**: Request Solana-specific chain/token data via `chainTypes=SVM` and use `SOL` as the Solana chain key in API examples.

## Product Surface Selection

Choose the smallest surface that matches the task:

- **REST API**: Backend services, scripts, and general AI agents. Simple HTTP calls, no runtime dependency.
- **SDK (`@lifi/sdk`)**: Frontend or full execution flows. Handles wallet connectors, signing, route execution, and update hooks.
- **MCP Server**: MCP-compatible AI hosts such as Claude, Cursor, or Windsurf. Use when typed tool discovery is available.
- **CLI**: Token-efficient agent workflows where compact human-readable output is preferable to raw JSON.
- **Widget**: Ready-made UI when the user wants embedded swap/bridge UX rather than custom integration.

Do not force every integration through the SDK. For quote lookup, route comparison, or status checks, the API is often simpler and easier to audit.

## Base URLs and Authentication

```text
Production API: https://li.quest/v1
Staging API:    https://staging.li.quest/v1
Docs:           https://docs.li.fi
OpenAPI:        https://docs.li.fi/openapi.yaml
LLM overview:   https://docs.li.fi/llms.txt
```

LI.FI APIs can be used without an API key. Use an API key for higher rate limits or authenticated partner usage. Register an integration in the LI.FI Partner Portal to get an API key: https://portal.li.fi/

For direct REST calls, pass the key in the `x-lifi-api-key` header:

```bash
curl 'https://li.quest/v1/chains?chainTypes=EVM,SVM' \
  --header 'accept: application/json' \
  --header 'x-lifi-api-key: YOUR_API_KEY_IF_AVAILABLE'
```

Test a key server-side before using it in production:

```bash
curl 'https://li.quest/v1/keys/test' \
  --header 'x-lifi-api-key: YOUR_API_KEY'
```

Never expose `x-lifi-api-key` in browser code, public repositories, or direct Widget configuration. If using the SDK from a backend or trusted runtime, pass the key through `createConfig({ apiKey: '...' })`; if using the Widget in a frontend, do not pass an API key.

## Integration Workflow

1. **Clarify the transfer intent**
   - Source chain, destination chain, source token, destination token.
   - Amount in the token's smallest unit.
   - Sender address and, when different, recipient address.
   - Whether the user wants a single best route or route comparison.

2. **Discover support instead of hardcoding**
   - Use `/chains` to verify chains.
   - Use `/tokens` or `/token` to verify token addresses and decimals.
   - Use `/tools` to list current bridges and exchanges.
   - Do not assume every token, bridge, or chain pair is available.

3. **Choose quote vs routes**
   - Use `GET /quote` for a simple transfer where the best executable route is enough.
   - Use `POST /advanced/routes` when comparing alternatives or when the user asks for route choice, cost, speed, tool allowlists, or multiple steps.
   - Use `POST /advanced/stepTransaction` to populate transaction data for individual route steps when executing advanced routes.

4. **Show the user what they will sign**
   - Summarize from-chain, to-chain, from-token, to-token, amount, estimated output, tool/bridge, fees, recipient, and slippage.
   - Never ask a user to sign opaque transaction data without a human-readable summary.

5. **Execute through the appropriate wallet path**
   - If using `GET /quote`, the response already includes `transactionRequest`; after allowance/permit handling, submit that transaction with the source-chain wallet.
   - If using `POST /advanced/routes`, first choose a route, then populate each step with `POST /advanced/stepTransaction` before execution.
   - EVM transaction requests usually include fields such as `to`, `data`, `value`, and gas fields.
   - Solana-originating transfers return Solana transaction data as base64 in `transactionRequest.data`; deserialize, sign, and send through the user's Solana wallet or SDK path.
   - Prefer SDK `executeRoute` for production multi-step execution because it manages allowance and balance checks, chain switching, transaction data retrieval, transaction submission, and status tracking.
   - Never mutate `transactionRequest.data`, calldata, recipient, refund, memo, or bridge-specific payloads after receiving them from LI.FI.

6. **Track status after source-chain submission**
   - Poll `/status` every 10-30 seconds until terminal status.
   - Include `fromChain`, `toChain`, and `bridge` from the quote when available to speed up lookup.
   - Treat source-chain confirmation as only the start of a cross-chain transfer, not proof of final delivery.

## Minimal Endpoint Set

### Get a quote

Use for a single best route with transaction data included.

```bash
curl --request GET \
  --url 'https://li.quest/v1/quote?fromChain=ARB&toChain=SOL&fromToken=0xaf88d065e77c8cC2239327C5EDb3A432268e5831&toToken=7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs&fromAddress=YOUR_EVM_WALLET&toAddress=YOUR_SOL_WALLET&fromAmount=1000000000' \
  --header 'accept: application/json'
```

Required parameters:

- `fromChain`: source chain ID or key.
- `toChain`: destination chain ID or key.
- `fromToken`: source token symbol or address.
- `toToken`: destination token symbol or address.
- `fromAmount`: amount in smallest unit.
- `fromAddress`: sender wallet address.
- `toAddress`: recipient wallet address when different from sender or when bridging across ecosystems.

### Get multiple routes

Use when the user asks to compare routes or when the application needs route selection.

```bash
curl --request POST \
  --url 'https://li.quest/v1/advanced/routes' \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data '{
    "fromChainId": "ARB",
    "toChainId": "SOL",
    "fromTokenAddress": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "toTokenAddress": "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    "fromAmount": "1000000000",
    "fromAddress": "YOUR_EVM_WALLET",
    "toAddress": "YOUR_SOL_WALLET"
  }'
```

### Check transfer status

```bash
curl --request GET \
  --url 'https://li.quest/v1/status?txHash=SOURCE_TX_HASH&fromChain=ARB&toChain=SOL&bridge=BRIDGE_KEY' \
  --header 'accept: application/json'
```

Status handling:

- `NOT_FOUND`: Transaction may not be indexed or mined yet. Retry with `fromChain` and bridge if known.
- `PENDING`: Continue polling.
- `DONE` + `COMPLETED`: Successful final delivery.
- `DONE` + `PARTIAL`: Successful but output token may differ while preserving value semantics.
- `DONE` + `REFUNDED`: Transfer failed but funds were refunded.
- `FAILED`: Stop polling and surface the error/substatus.

### List supported chains

```bash
curl --request GET \
  --url 'https://li.quest/v1/chains?chainTypes=EVM,SVM' \
  --header 'accept: application/json'
```

Solana-only:

```bash
curl --request GET \
  --url 'https://li.quest/v1/chains?chainTypes=SVM' \
  --header 'accept: application/json'
```

### List Solana tokens

```bash
curl --request

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/lifi for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/lifi
