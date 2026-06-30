---
id: sol_jupiter
version: 1.0.0
description: Comprehensive guidance for integrating Jupiter APIs (Ultra Swap, Lend, Perps, Trigger, Recurring, Tokens, Price, Portfolio, Prediction Markets, Send, Studio, Lock, Routing). Use for endpoint selection, integration flows, error handling, and production hardening.
triggers:
  - jupiter
  - jup-ag
  - ultra-swap
  - jupiter-lend
  - jupiter-perps
  - jupiter-trigger
  - jupiter-recurring
  - jupiter-portfolio
  - jupiter-prediction
  - jupiter-send
  - jupiter-studio
  - jupiter-lock
---

## Context

# Jupiter API Integration

Single skill for all Jupiter APIs, optimized for fast routing and deterministic execution.

**Base URL**: `https://api.jup.ag`
**Auth**: `x-api-key` from [portal.jup.ag](https://portal.jup.ag/) (**required for Jupiter REST endpoints**)

## Use/Do Not Use

Use when:
- The task requires choosing or calling Jupiter endpoints.
- The task involves swap, lending, perps, orders, pricing, portfolio, send, studio, lock, or routing.
- The user needs debugging help for Jupiter API calls.

Do not use when:
- The task is generic Solana setup with no Jupiter API usage.
- The task is UI-only with no API behavior decisions.

**Triggers**: `swap`, `quote`, `gasless`, `best route`, `lend`, `borrow`, `earn`, `liquidation`, `perps`, `leverage`, `long`, `short`, `position`, `limit order`, `trigger`, `price condition`, `dca`, `recurring`, `scheduled swaps`, `token metadata`, `token search`, `verification`, `shield`, `price`, `valuation`, `price feed`, `portfolio`, `positions`, `holdings`, `prediction markets`, `market odds`, `event market`, `invite transfer`, `send`, `clawback`, `create token`, `studio`, `claim fee`, `vesting`, `distribution lock`, `unlock schedule`, `dex integration`, `rfq integration`, `routing engine`

## Developer Quickstart

```typescript
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';

const API_KEY = process.env.JUPITER_API_KEY!;  // from portal.jup.ag
if (!API_KEY) throw new Error('Missing JUPITER_API_KEY');
const BASE = 'https://api.jup.ag';
const headers = { 'x-api-key': API_KEY };

async function jupiterFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
  if (res.status === 429) throw { code: 'RATE_LIMITED', retryAfter: 10 };
  if (!res.ok) {
    const raw = await res.text();
    let body: any = { message: raw || `HTTP_${res.status}` };
    try {
      body = raw ? JSON.parse(raw) : body;
    } catch {
      // keep text fallback body
    }
    throw { status: res.status, ...body };
  }
  return res.json();
}

// Sign and send any Jupiter transaction
async function signAndSend(
  txBase64: string,
  wallet: Keypair,
  connection: Connection,
  additionalSigners: Keypair[] = []
): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
  tx.sign([wallet, ...additionalSigners]);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    maxRetries: 0,
    skipPreflight: true,
  });
  return sig;
}
```

## Intent Router (first step)

| User intent | API family | First action |
|---|---|---|
| Swap/quote | [Ultra Swap](#ultra-swap) | `GET /ultra/v1/order` -> sign -> `POST /ultra/v1/execute` |
| Lend/borrow/yield | [Lend](#lend) | `POST /lend/v1/earn/deposit` or `/withdraw` |
| Leverage/perps | [Perps](#perps) | On-chain via Anchor IDL (no REST API yet) |
| Limit orders | [Trigger](#trigger-limit-orders) | `POST /trigger/v1/createOrder` -> sign -> `POST /trigger/v1/execute` |
| DCA/recurring buys | [Recurring](#recurring-dca) | `POST /recurring/v1/createOrder` -> sign -> `POST /recurring/v1/execute` |
| Token search/verification | [Tokens](#tokens) | `GET /tokens/v2/search?query={mint}` |
| Price lookup | [Price](#price) | `GET /price/v3?ids={mints}` |
| Portfolio/positions | [Portfolio](#portfolio) | `GET /portfolio/v1/positions/{address}` |
| Prediction market integration | [Prediction Markets](#prediction-markets) | `GET /prediction/v1/events` -> `POST /prediction/v1/orders` |
| Invite send/clawback | [Send](#send) | `POST /send/v1/craft-send` -> sign -> send to RPC |
| Token creation/fees | [Studio](#studio) | `POST /studio/v1/dbc-pool/create-tx` -> upload -> submit |
| Vesting/distribution | [Lock](#lock) | On-chain program `LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn` |
| DEX/RFQ integration | [Routing](#routing) | Choose DEX (AMM trait) vs RFQ (webhook) path |

## API Playbooks

Use each block as a minimal execution contract. Fetch the linked refs for full request/response shapes, TypeScript interfaces, and parameter details.

### Ultra Swap

- **Base URL**: `https://api.jup.ag/ultra/v1`
- **Triggers**: `swap`, `quote`, `gasless`, `best route`
- **Fee**: 5-10 bps (standard) or 20% of integrator fees when custom fees configured
- **Rate Limit**: 50 req/10s base, scales with 24h execute volume (see [Rate Limits](#rate-limits))
- **Endpoints**: `/order` (GET), `/execute` (POST), `/holdings/{account}` (GET), `/shield` (GET), `/search` (GET), `/routers` (GET)
- **Gotchas**: Signed payloads have ~2 min TTL. Transactions are immutable after receipt. Split order/execute in code and logging. Re-quote before execution when conditions may have changed.
- Refs: [Overview](https://developers.jup.ag/docs/ultra/index.md) | [Order](https://developers.jup.ag/docs/ultra/get-order.md) | [Execute](https://developers.jup.ag/docs/ultra/execute-order.md) | [Responses](https://developers.jup.ag/docs/ultra/response.md)

---

### Lend

- **Base URL**: `https://api.jup.ag/lend/v1`
- **Triggers**: `lend`, `borrow`, `earn`, `liquidation`
- **Programs**: Earn `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9`, Borrow `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`
- **SDK**: `@jup-ag/lend` (TypeScript)
- **Endpoints**: `/earn/deposit` (POST), `/earn/withdraw` (POST), `/earn/mint` (POST), `/earn/redeem` (POST), `/earn/deposit-instructions` (POST), `/earn/withdraw-instructions` (POST), `/earn/tokens` (GET), `/earn/positions` (GET), `/earn/earnings` (GET)
- **Gotchas**: Recompute account state before each state-changing action. Encode risk checks (health factors, liquidation boundaries) as preconditions. All deposit/withdraw/mint/redeem return base64 unsigned `VersionedTransaction`.
- Refs: [Overview](https://developers.jup.ag/docs/lend/index.md) | [Earn](https://developers.jup.ag/docs/lend/earn.md) | [SDK](https://developers.jup.ag/docs/lend/sdk.md)

---

### Perps

- **Status**: API is **work-in-progress**. No REST endpoints yet. Interact on-chain via Anchor IDL.
- **Triggers**: `perps`, `leverage`, `long`, `short`, `position`
- **Community SDK**: [github.com/julianfssen/jupiter-perps-anchor-idl-parsing](https://github.com/julianfssen/jupiter-perps-anchor-idl-parsing)
- **Gotchas**: Max 9 simultaneous positions: 3 long (SOL, wETH, wBTC) + 6 short (3 tokens x 2 collateral USDC/USDT). Validate margin/leverage against account model.
- Refs: [Overview](https://developers.jup.ag/docs/perps/index.md) | [Position account](https://developers.jup.ag/docs/perps/position-account.md) | [Position request](https://developers.jup.ag/docs/perps/position-request-account.md)

---

### Trigger (Limit Orders)

- **Base URL**: `https://api.jup.ag/trigger/v1`
- **Triggers**: `limit order`, `trigger`, `price condition`
- **Fee**: 0.1% (non-stable), 0.03% (stable pairs)
- **Pagination**: 10 orders per page
- **Endpoints**: `/createOrder` (POST), `/cancelOrder` (POST), `/cancelOrders` (POST, max 5 per tx), `/execute` (POST), `/getTriggerOrders` (GET)
- **Gotchas**: Frontend enforces 5 USD min; on-chain has no minimum. Program does NOT validate if rates are favorable — validate target price before create. Token-2022 disabled. Default zero slippage ("Exact" mode); set `slippageBps` for "Ultra" mode with higher fill rate.
- Refs: [Overview](https://developers.jup.ag/docs/trigger/index.md) | [Create](https://developers.jup.ag/docs/trigger/create-order.md) | [Get orders](https://developers.jup.ag/docs/trigger/order-history) | [Best Practices](https://developers.jup.ag/docs/trigger/best-practices)

---

### Recurring (DCA)

- **Base URL**: `https://api.jup.ag/recurring/v1`
- **Triggers**: `dca`, `recurring`, `scheduled swaps`
- **Fee**: 0.1% on all recurring orders
- **Constraints**: Min 100 USD total, min 2 orders, min 50 USD per order
- **Pagination**: 10 orders per page
- **Endpoints**: `/createOrder` (POST), `/cancelOrder` (POST), `/execute` (POST), `/getRecurringOrders` (GET)
-

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/jupiter for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/jupiter
