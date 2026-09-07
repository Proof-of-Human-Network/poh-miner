---
id: ritual_precompiles
version: 1.0.0
description: Complete Ritual precompile ABI reference. Use when encoding/decoding precompile calls, understanding request/response formats, or debugging precompile interactions.
triggers:
  - ritual precompile
  - onchain inference
  - precompile address
---

## Context
# Ritual Precompile ABI Reference

This file is the ABI reference — field layouts, types, and output formats. For complete contract patterns (deposit, executor selection, callback handling, testing), see `ritual-dapp-contracts`. For wallet deposits and fund flows, see `ritual-dapp-wallet`.

> Deployment note for agents: `0x080C` and `0x0820` ABI calls in this file describe the raw precompile payloads. In production launch flows, prefer factory-backed contract harness mode (`SovereignAgentFactory/SovereignAgentHarness`, `PersistentAgentFactory/PersistentAgentLauncher`) as documented in `ritual-dapp-agents`.

## Address Map

| Precompile | Address | Fields | Execution Model |
|---|---|---|---|
| ONNX Inference | `0x0800` | 7 | Synchronous |
| HTTP Call | `0x0801` | 13 | Short-running async |
| LLM Call | `0x0802` | 30 | Short-running async |
| JQ | `0x0803` | 3 | Synchronous |
| Long-Running HTTP | `0x0805` | 35 | Long-running async |
| ZK Long-Running | `0x0806` | 14 | Long-running async |
| FHE Inference | `0x0807` | 19 | Long-running async |
| Sovereign Agent | `0x080C` | 23 | Long-running async |
| Image Call | `0x0818` | 18 | Long-running async |
| Audio Call | `0x0819` | 18 | Long-running async |
| Video Call | `0x081A` | 18 | Long-running async |
| DKMS Key | `0x081B` | 8 | Short-running async |
| Persistent Agent | `0x0820` | 26 | Long-running async |
| Ed25519 | `0x0009` | 3 | Synchronous |
| SECP256R1 | `0x0100` | 3 | Synchronous |
| TX Hash | `0x0830` | 0 | Synchronous |

**Synchronous**: inline execution, no executor, no limits on calls per tx.
**Short-running async**: One per tx. Builder simulates (fresh simulation), executor processes in TEE, builder re-executes deferred tx with result injected (fulfilled replay). Result in receipt `spcCalls`.
**Long-running async**: Phase 1 mined immediately (returns task ID). Phase 2 delivers result via callback from AsyncDelivery (`0x5A16214fF555848411544b005f7Ac063742f39F6`).

```typescript
const PRECOMPILES = {
  ONNX: '0x0000000000000000000000000000000000000800',
  HTTP_CALL: '0x0000000000000000000000000000000000000801',
  LLM: '0x0000000000000000000000000000000000000802',
  JQ: '0x0000000000000000000000000000000000000803',
  LONG_RUNNING_HTTP: '0x0000000000000000000000000000000000000805',
  ZK_TWO_PHASE: '0x0000000000000000000000000000000000000806',
  FHE_CALL: '0x0000000000000000000000000000000000000807',
  SOVEREIGN_AGENT: '0x000000000000000000000000000000000000080C',
  IMAGE_CALL: '0x0000000000000000000000000000000000000818',
  AUDIO_CALL: '0x0000000000000000000000000000000000000819',
  VIDEO_CALL: '0x000000000000000000000000000000000000081A',
  DKMS_KEY: '0x000000000000000000000000000000000000081B',
  PERSISTENT_AGENT: '0x0000000000000000000000000000000000000820',
  ED25519: '0x0000000000000000000000000000000000000009',
  SECP256R1: '0x0000000000000000000000000000000000000100',
  TX_HASH: '0x0000000000000000000000000000000000000830',
} as const;
```

---

## Output Unwrapping

Async precompiles return `abi.encode(bytes simmedInput, bytes actualOutput)`. Unwrap to get the real result:

```solidity
(, bytes memory actualOutput) = abi.decode(rawOutput, (bytes, bytes));
```

In `eth_call` simulation, `actualOutput` may be empty (`0x`). This is expected — decode the settled receipt for final data.

The `spcCalls` field is a Ritual extension to the transaction receipt:

```typescript
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const spcCalls = (receipt as any).spcCalls;
```

---

## Base Executor Fields (5 fields)

All executor-based precompiles start with these fields:

| Index | Type | Field | Description |
|---|---|---|---|
| 0 | `address` | executor | TEE executor address |
| 1 | `bytes[]` | encryptedSecrets | ECIES-encrypted secret blobs |
| 2 | `uint256` | ttl | Blocks until expiry |
| 3 | `bytes[]` | secretSignatures | Signatures over encrypted secrets |
| 4 | `bytes` | userPublicKey | User's ECIES public key (empty = no output encryption) |

Secrets use plain string replacement — the executor decrypts the secrets JSON and replaces matching key strings wherever they appear in URLs, headers, and body.

---

## HTTP Call (0x0801) — 13 fields

| Index | Type | Field |
|---|---|---|
| 0-4 | — | Base executor fields |
| 5 | `string` | url |
| 6 | `uint8` | method (GET=1, POST=2, PUT=3, DELETE=4, PATCH=5, HEAD=6, OPTIONS=7) |
| 7 | `string[]` | headersKeys |
| 8 | `string[]` | headersValues |
| 9 | `bytes` | body |
| 10 | `uint256` | dkmsKeyIndex (0 = not using dKMS) |
| 11 | `uint8` | dkmsKeyFormat |
| 12 | `bool` | piiEnabled |

**Output**: `(uint16 statusCode, string[] headerKeys, string[] headerValues, bytes body, string errorMessage)`

### Quick Encode

```typescript
// HTTP GET — all 13 fields
const encoded = encodeAbiParameters(
  [{type:'address'},{type:'bytes[]'},{type:'uint256'},{type:'bytes[]'},{type:'bytes'},
   {type:'string'},{type:'uint8'},{type:'string[]'},{type:'string[]'},{type:'bytes'},
   {type:'uint256'},{type:'uint8'},{type:'bool'}],
  [executor, [], 100n, [], '0x', url, 1, [], [], '0x', 0n, 0, false]
);
```

```solidity
// Solidity — decode output after unwrapping (simmedInput, actualOutput) pair
(, bytes memory out) = abi.decode(rawOutput, (bytes, bytes));
(uint16 status, , , bytes memory body, string memory err) =
    abi.decode(out, (uint16, string[], string[], bytes, string));
```

Rough deposit: 0.01 RITUAL.

---
---
Source: `ritual-foundation/ritual-dapp-skills` — The Clear BSD License, (c) 2026 Ritual Foundation.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/ritual-dapp-precompiles/SKILL.md` from `ritual-foundation/ritual-dapp-skills` with the `gitmcp` MCP.
