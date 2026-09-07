---
id: ritual_contracts
version: 1.0.0
description: Ritual chain precompile addresses, system contracts, ABI encoding, and callback security. Use when writing Solidity contracts that call Ritual precompiles, handle async callbacks, or interact with the Scheduler and RitualWallet.
triggers:
  - ritual contract
  - ritual solidity
  - ritual consumer contract
---

## Context
# Ritual Smart Contract Development

## Execution Models

Ritual precompiles use one of three execution models. The full precompile list is in the table below — this section covers how each model works so you know what your contract needs.

| | Synchronous | Async (short-running) | Async (long-running) |
|---|---|---|---|
| How it works | Call returns result in the same transaction | Transaction is deferred until the TEE executor's result is available, then re-executed with the result injected into the precompile (fulfilled replay) — looks synchronous from your contract's perspective | Phase 1: returns a task ID, settles fees, releases nonce. Phase 2: executor delivers result via callback in a separate tx |
| RitualWallet deposit | No | Yes — lock must cover `commit_block + ttl` | Yes — lock must cover `commit_block + ttl` |
| Executor from TEEServiceRegistry | No | Yes | Yes |
| Callback function | No | No | Yes — guarded by `msg.sender == ASYNC_DELIVERY` with sufficient `deliveryGasLimit` |
| Sender nonce lock | None | Until settlement | Until Phase 1 settlement |
| Output delivery | Same call | Transaction receipt `spcCalls` field | Separate callback tx |
| Output format | Precompile-specific | `abi.decode(raw, (bytes simmedInput, bytes actualOutput))` | Precompile-specific, delivered to your callback |

## System Contracts

| Contract | Address |
|---|---|
| RitualWallet | `0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948` |
| AsyncJobTracker | `0xC069FFCa0389f44eCA2C626e55491b0ab045AEF5` |
| AsyncDelivery | `0x5A16214fF555848411544b005f7Ac063742f39F6` |
| TEEServiceRegistry | `0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F` |
| Scheduler | `0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B` |
| SecretsAccessControl | `0xf9BF1BC8A3e79B9EBeD0fa2Db70D0513fecE32FD` |

## Agent Factory Contracts

| Contract | Address |
|---|---|
| SovereignAgentFactory | `0x9dC4C054e53bCc4Ce0A0Ff09E890A7a8e817f304` |
| PersistentAgentFactory | `0xD4AA9D55215dc8149Af57605e70921Ea16b73591` |

Preflight before launch:

```bash
cast code "0x9dC4C054e53bCc4Ce0A0Ff09E890A7a8e817f304" --rpc-url "$RPC_URL"
cast code "0xD4AA9D55215dc8149Af57605e70921Ea16b73591" --rpc-url "$RPC_URL"
```

## Precompile Addresses

| Address | Name | Type | ABI Fields | Skill |
|---|---|---|---|---|
| `0x0800` | ONNX ML Inference | Synchronous | 7 | `ritual-dapp-onnx` |
| `0x0801` | HTTP Call | Async (short-running) | 13 | `ritual-dapp-http` |
| `0x0802` | LLM Call | Async (short-running) | 30 | `ritual-dapp-llm` |
| `0x0803` | JQ JSON Query | Synchronous | 3 | `ritual-dapp-http` §7 |
| `0x0805` | Long-Running HTTP | Async (long-running) | 35 | `ritual-dapp-longrunning` |
| `0x0806` | ZK Long-Running | Async (long-running) | 14 | — |
| `0x0807` | FHE/CKKS Inference | Async (long-running) | 19 | — |
| `0x080C` | Sovereign Agent | Async (long-running) | 23 | `ritual-dapp-agents` |
| `0x0818` | Image Generation | Async (long-running) | 18 | `ritual-dapp-multimodal` |
| `0x0819` | Audio Generation | Async (long-running) | 18 | `ritual-dapp-multimodal` |
| `0x081A` | Video Generation | Async (long-running) | 18 | `ritual-dapp-multimodal` |
| `0x081B` | DKMS Key Derivation | Async | 8 | — |
| `0x0820` | Persistent Agent | Async (long-running) | 26 | `ritual-dapp-agents` |
| `0x0009` | Ed25519 Verify | Synchronous | 3 | `ritual-dapp-ed25519` |
| `0x0100` | SECP256R1/P-256 | Synchronous | 3 | `ritual-dapp-passkey` |
| `0x0830` | TX Hash | Synchronous | 0 (any input) | — |

---

## Interfaces

### IRitualWallet

```solidity
interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;
    function depositFor(address user, uint256 lockDuration) external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function lockUntil(address account) external view returns (uint256);
}
```

There is no `lockedBalanceOf`. There is no `emergencyWithdraw`. `lockUntil` returns a block number, not a balance. Lock is monotonic — new deposits only extend, never shorten. See `ritual-dapp-wallet` for deposit sizing, lock duration guidance, and EOA vs contract deposit semantics.

### IScheduler

```solidity
interface IScheduler {
    function schedule(
        bytes memory data,
        uint32 gas,
        uint32 startBlock,
        uint32 numCalls,
        uint32 frequency,
        uint32 ttl,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas,
        uint256 value,
        address payer
    ) external returns (uint256 callId);

    function schedule(
        bytes memory data,
        uint32 gas,
        uint32 numCalls,
        uint32 frequency
    ) external returns (uint256 callId);

    function cancel(uint256 callId) external;
    function getCallState(uint256 callId) external view returns (uint8);
    function approveScheduler(address schedulerContract) external;
    function revokeScheduler(address schedulerContract) external;
}
```

The Scheduler always calls back `msg.sender` — there is no `target` parameter. Only contracts can schedule (not EOAs). Returns `uint256`, not `bytes32`. The first `uint256` parameter of your callback (bytes 4–35) is overwritten with the real `executionIndex` at execution time. See `ritual-dapp-scheduler` for full usage patterns, predicate scheduling, and TTL sizing.

CallState: SCHEDULED=0, EXECUTING=1, COMPLETED=2, CANCELLED=3, EXPIRED=4.

### ITEEServiceRegistry

```solidity
interface ITEEServiceRegistry {
    struct TEEServiceNode {
        address paymentAddress;
        address teeAddress;
        uint8 teeType;
        bytes publicKey;
        string endpoint;
        bytes32 certPubKeyHash;
        uint8 capability;
    }

    struct TEEServiceContext {
        TEEServiceNode node;
        bool isValid;
        bytes32 workloadId;
    }

    function getServicesByCapability(
        uint8 capability,
        bool checkValidity
    ) external view returns (TEEServiceContext[] memory);

    function getService(address addr, bool checkValidity)
        external
        view
        returns (TEEServiceContext memory);

    function getCapabilityIndexStatus()
        external
        view
        returns (uint256 cursor, uint256 total, bool initialized, bool finalized);

    function getIndexedServiceCountByCapability(uint8 capability)
        external
        view
        returns (uint256 count);

    function getIndexedServiceByCapabilityAt(uint8 capability, uint256 index)
        external
        view
        returns (address teeAddress);

    function pickServiceByCapability(
        uint8 capability,
        bool checkValidity,
        uint256 seed,
        uint256 maxProbes
    ) external view returns (address teeAddress, bool found);
}
```

Capabilities: HTTP_CALL=0, LLM=1, WORMHOLE_QUERY=2, STREAMING=3, VLLM_PROXY=4, ZK_CALL=5, DKMS=6, IMAGE_CALL=7, AUDIO_CALL=8, VIDEO_CALL=9, FHE=10. Agent precompiles route through HTTP_CALL (0) — see `ritual-dapp-agents` for details.

**Executor selection pattern:** do **not** hardcode executor `teeAddress` constants as a default production pattern.

Use indexed capability APIs when `getCapabilityIndexStatus().finalized == true`:

1. `pickServiceByCapability(capability, true, seed, maxProbes)` for bounded random selection.
2. If needed, iterate with `getIndexedServiceCountByCapability` + `getIndexedServiceByCapabilityAt`.
3. Fallback to `getServicesByCapability(...)` only when indexed state is not finalized.

If your contract stores executor preferences, make them updatable and validate against registry results.
---
Source: `ritual-foundation/ritual-dapp-skills` — The Clear BSD License, (c) 2026 Ritual Foundation.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/ritual-dapp-contracts/SKILL.md` from `ritual-foundation/ritual-dapp-skills` with the `gitmcp` MCP.
