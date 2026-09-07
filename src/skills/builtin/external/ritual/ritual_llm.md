---
id: ritual_llm
version: 1.0.0
description: LLM inference patterns for Ritual dApps. Use when building dApps with LLM text generation, conversation history (GCS, HuggingFace, or Pinata), and streaming.
triggers:
  - ritual llm
  - onchain llm
  - onchain inference
  - llm precompile
---

## Context
# LLM Inference — Ritual dApp Patterns

## Overview

The LLM precompile (`0x0802`) enables on-chain AI inference via TEE-verified executors. For current production usage, pin model selection to `zai-org/GLM-4.7-FP8`. Conversation history is stored as plaintext JSONL on the DA provider (GCS, HuggingFace, or Pinata) — see `ritual-dapp-da` for StorageRef format and credential encoding.

> **Execution Model: Short-running async.** LLM Call (0x0802) is async. The builder simulates your tx (fresh simulation) and creates a commitment, the executor performs inference off-chain, and the builder re-executes your deferred tx with the settled output injected in `spcCalls` (fulfilled replay). You do not register a callback function; you read settled output from the transaction receipt. See `ritual-dapp-overview` for the full transaction lifecycle.
>
> **At most one short-running async call per transaction.** You cannot make two async precompile calls in one transaction. You can still combine one async call with synchronous precompiles (JQ, ONNX, etc.).

**Precompile address**: `0x0000000000000000000000000000000000000802`
**Chain ID**: 1979 (Ritual Chain)
**Transaction type**: Short-running async (commitment → executor processes → your tx + settlement in same block)

### How It Works

```
┌──────────┐   call           ┌──────────────┐     inference     ┌─────────────┐
│  User Tx │ ──────────────▶ │  Precompile  │ ───────────────▶  │  LLM Model  │
│          │                 │   0x0802     │                   │  (in TEE)   │
└──────────┘                 └──────────────┘                   └─────────────┘
     │                             │                                  │
     │ commitment on-chain         │  executor runs inference         │ tokens
     │                             │◀─────────────────────────────────│
     │                             │                                  
     │ completion settled          │
     │◀────────────────────────────│
```

For streaming, a separate SSE service delivers tokens in real-time while the on-chain settlement happens asynchronously.

### Execution Prerequisites (Early)

- **Registry + capability:** select executors from `TEEServiceRegistry` using LLM capability (`Capability.LLM = 1`).
- **What to use from registry:** use executor address (`teeAddress`) and `publicKey`.
- **What not to use:** do **not** read/use the registry `endpoint` field in this dapp flow.
- **Wallet funding:** deposit in `RitualWallet` before inference so async settlement can complete.
- **Model policy:** for current production, pin to `zai-org/GLM-4.7-FP8`.

---

## ABI Context (Read First)

Before any example, lock these in:

- Always call precompile `0x0802` with the full **30-field** ABI tuple. Submitting any other field count returns RPC `-32602 invalid async payload` and the tx never lands. See "Error Reference" for the full surface.
- For current production, use **`zai-org/GLM-4.7-FP8`** only. It is a reasoning model with a hardcoded `<think>...</think>` chain-of-thought, which has two practical consequences:
  - Set `maxCompletionTokens` to **at least 4096**. The `<think>` block typically consumes 500–1500 tokens before the final answer is emitted; smaller caps risk returning empty `content` with `finish_reason: "length"`. 4096 is the recommended baseline for any substantive reply on this model.
  - Set `ttl` to **at least 60 blocks** (300 is a safe default). Reasoning inference can take 10–40 seconds wall-clock; the default `30` blocks risks expiration.
- `convoHistory` is a **StorageRef tuple**. See **`ritual-dapp-da`** for the full StorageRef contract — supported platforms (`gcs`, `hf`, `pinata`), path conventions per platform, credential JSON formats, the meaning of an empty `('', '', '')` tuple, and end-to-end DA debugging. Do not improvise from this skill alone — DA has its own surface area and `ritual-dapp-da` is the source of truth.
- Conversation history is stored as **plaintext JSONL** — not DKMS-encrypted (unlike agent precompiles).
- `piiEnabled` enables PII redaction mode and has extra requirements.
- `userPublicKey` can stay `0x` unless your request flow explicitly needs user-key encryption behavior.

The full request/response ABI layouts are listed in the "Request ABI Layout" and "Response ABI Layout" sections below.

### Three different "limits" — do not confuse them

This is the single most common source of mysterious LLM call failures on Ritual. There are three distinct caps and they fail independently:

| Cap | Where it lives | What it controls | What happens when you hit it |
|-----|---------------|------------------|--------------------|
| `max_completion_tokens` (ABI field 10, `int256`) | Your precompile input | **Output** generation budget only — caps the number of tokens the model is allowed to *produce*, not the input prompt size. Sent through to the upstream model as OpenAI-style `max_completion_tokens`. | The model stops generating early; you get a successful response with `finish_reason: "length"`. Not an error. |
| `ttl` (ABI field 2, `uint256`) | Your precompile input | **On-chain** wait budget — the executor must produce a result within `ttl` blocks of the commitment, otherwise the tx expires. | `Request expired` error in the response envelope. |
| Upstream **context window** (a.k.a. `max_seq_len`) | The **model**, registered on chain in `ModelPricingRegistry` and *separately* configured on whatever inference endpoint the executor actually talks to | Total prompt + completion tokens the upstream model will accept. Examples: `zai-org/GLM-4.7-FP8` is registered with `max_seq_length: 128000`. | The upstream call returns a **non-200 HTTP error**; the precompile envelope comes back with `has_error=true` and a freeform `error_message` string like `HTTP request failed with status 400: ... context length exceeded ...`. The precompile execution itself is still considered "successful" at the chain layer (still pays the `LLM_ERROR_EXECUTOR_FEE_WEI = 5×10¹¹ wei` error fee). |

> **The on-chain `max_seq_length` is the model's nominal capability, not the operational deployed cap.** The actual inference endpoint behind a model can be configured with a smaller `--max-model-len` (or equivalent) than the registered max. As of writing, the live Ritual gateway caps `zai-org/GLM-4.7-FP8` at **64K = 65,536 tokens** despite its 128K registration. Always treat the **smaller of the two** as your real budget — registered max gets you past chain-level validation, but the upstream endpoint can still reject at runtime. If you don't know the operational cap for a deployment, assume 64K for hosted GLM until you've measured it.

**The executor does NOT preflight token counts.** Oversized prompts only fail when the upstream model rejects them — the executor doesn't count tokens before sending the call. You cannot rely on `max_completion_tokens` to protect you from context-window overflow; it is a separate cap.

### Always treat the precompile envelope as "may have failed even if the tx settled"

The chain considers an LLM precompile execution **successful** as long as the executor returned an ABI-encoded response — even if the response carries an error. Inside that envelope:

```
(bool has_error, bytes completion_data, bytes model_metadata, string error_message, (string, string, string) updated_convo_history)
```
---
Source: `ritual-foundation/ritual-dapp-skills` — The Clear BSD License, (c) 2026 Ritual Foundation.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/ritual-dapp-llm/SKILL.md` from `ritual-foundation/ritual-dapp-skills` with the `gitmcp` MCP.
