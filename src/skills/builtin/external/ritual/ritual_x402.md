---
id: ritual_x402
version: 1.0.0
description: X402 micropayment and paid API access patterns for Ritual dApps. Use when building dApps that need automatic paid API access, micropayment flows, per-call payment for premium APIs, budget-controlled data access, shared credential management via dKMS, or metered on-chain API usage. Do NOT use for free/public API calls — use ritual-dapp-http instead.
triggers:
  - x402
  - pay per request
  - http 402
---

## Context
# X402 Micropayments — Paid API Access Patterns

X402 (named after HTTP 402 Payment Required) enables pay-per-call access to premium APIs through Ritual's HTTP precompile. Instead of managing API subscriptions off-chain, dApps submit encrypted payment credentials with an HTTP request. The TEE executor decrypts them, makes the paid call, and returns the result — all in a single on-chain transaction.

### Why X402?

- **No API key management**: Users don't need accounts with premium APIs — the dApp holds encrypted credentials
- **Pay-per-call**: Only pay for what you use, no subscriptions or upfront commitments
- **On-chain auditability**: Payment and data delivery are both on-chain events
- **Composable**: Combine with any precompile that needs external paid data
- **Privacy**: Payment credentials never appear on-chain (ECIES encrypted to TEE)

### Payment Flow

1. **Encrypt credentials**: User/dApp encrypts payment info (API key with billing, payment token) to the executor's ECIES public key
2. **Submit with HTTP request**: Encrypted payment blob is included as `encryptedSecrets` in the HTTP precompile call
3. **Executor decrypts**: Inside the TEE, the executor decrypts payment credentials
4. **String replacement**: Executor replaces `SECRET_NAME` placeholders in URL, headers, and body with decrypted values
5. **Make paid call**: Executor calls the premium API with real credentials
6. **Return result**: Result is settled on-chain in the same transaction; payment credentials are never exposed

## When to Use vs When NOT to Use

| Scenario | Skill |
|----------|-------|
| Premium API requiring payment credentials (API keys with billing, tokens) | **This skill (X402)** |
| Free/public APIs, open endpoints, no credentials needed | `ritual-dapp-http` |
| Passing secrets that aren't payment-related (auth tokens, config) | `ritual-dapp-secrets` |
| Premium API that takes >30s to respond | **This skill** + `ritual-dapp-longrunning` |
| Multiple users sharing one paid API key (DAO pattern) | **This skill** + `ritual-dapp-secrets` (dKMS) |

## Architecture

```
┌──────────────┐   encrypt creds    ┌──────────────┐   HTTP + payment   ┌──────────────┐
│  User / dApp │ ─────────────────▶ │  Precompile  │ ────────────────▶  │  Premium API │
│              │  (executor pubkey)  │   0x0801     │                    │  (paid)      │
└──────────────┘                    └──────────────┘                    └──────────────┘
                                          │
                       TEE executor:      │
                       1. Decrypt creds   │
                       2. Substitute      │
                          SECRET_NAME     │
                       3. Make paid call  │
                       4. Return result   │
                          on-chain        │
```

**Key property:** Payment credentials never appear on-chain. They are ECIES-encrypted to the executor's public key and only decrypted inside the TEE enclave.

## Skill Dependencies

This skill is a **composition layer**. It combines patterns from other skills with payment-specific concerns. Before using this skill, the agent should be familiar with:

- **`ritual-dapp-secrets`** — ECIES encryption, secret string replacement syntax, SecretsAccessControl. All credential encryption in X402 follows the patterns defined there.
- **`ritual-dapp-http`** — HTTP precompile (0x0801) encoding format, executor selection, ABI parameter layout. X402 uses the same encoding with encrypted secrets added.
- **`ritual-dapp-wallet`** — RitualWallet deposit flows. The sender's wallet must be funded before any X402 call.
- **`ritual-dapp-longrunning`** — For premium APIs with response times >30s, use 0x0805 instead of 0x0801.
- **`ritual-dapp-frontend`** — For building UI around X402 flows. Use `walletClient.request({ method: "eth_sendTransaction" })` with explicit `gas` hex field (never `useWriteContract` or `useSendTransaction` for async precompiles — both trigger EVM simulation which fails).

---
---
Source: `ritual-foundation/ritual-dapp-skills` — The Clear BSD License, (c) 2026 Ritual Foundation.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/ritual-dapp-x402/SKILL.md` from `ritual-foundation/ritual-dapp-skills` with the `gitmcp` MCP.
