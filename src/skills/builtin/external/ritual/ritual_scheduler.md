---
id: ritual_scheduler
version: 1.0.0
description: Scheduled operations for Ritual dApps. Use when building dApps with time-delayed execution, recurring tasks, or automated workflows.
triggers:
  - ritual scheduler
  - scheduled transaction
  - cron onchain
---

## Context
# Scheduled Operations — Ritual dApp Patterns

## Overview

The Scheduler contract (`0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B`) enables time-delayed and recurring execution of on-chain calls. Any contract call can be scheduled to run at a future block, repeat at fixed intervals, or execute as a one-shot delayed action. The Scheduler works with all precompiles — synchronous (ONNX, JQ, Ed25519, SECP256R1) and async (HTTP, LLM, Agent, Long-Running HTTP, Image, Audio, Video).

Only **contracts** can schedule — not EOAs. The Scheduler always calls back `msg.sender`, so your contract must call `schedule()` directly.

When a scheduled call triggers an async precompile, the system automatically detects it during simulation, creates a commitment, routes to an executor, and settles. Each recurrence independently triggers a new async lifecycle.

**Scheduler**: `0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B`
**RitualWallet**: `0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948`
**Chain ID**: 1979

---

## Call States

```
enum CallState {
    SCHEDULED,   // 0 — registered, waiting for trigger block
    EXECUTING,   // 1 — trigger block reached, callback running
    COMPLETED,   // 2 — all executions finished (terminal)
    CANCELLED,   // 3 — user cancelled (terminal)
    EXPIRED      // 4 — overall deadline passed (terminal)
}
```

For recurring calls, the cycle is: `SCHEDULED → EXECUTING → SCHEDULED → EXECUTING → ... → EXECUTING → COMPLETED`. The call stays in the `SCHEDULED ↔ EXECUTING` loop until all `numCalls` are done, then transitions to `COMPLETED`.

Individual executions can be skipped (TTL drift exceeded, insufficient funds) without killing the whole schedule. The schedule only dies when it reaches COMPLETED, CANCELLED, or EXPIRED.

Fees are **not** deducted at schedule time — only at execution time. If a call is cancelled or expires, no fees were ever taken. The balance stays in RitualWallet.

---

## Execution Index Injection

The Scheduler overwrites bytes 4-35 of your calldata with the real `executionIndex` at execution time. Your callback's first parameter (after the 4-byte selector) must be `uint256 executionIndex`. When encoding the schedule data, put a dummy `0` there:

```solidity
bytes memory data = abi.encodeWithSelector(
    this.myCallback.selector,
    uint256(0),     // placeholder — Scheduler overwrites with real executionIndex
    myArg
);
```

---

## Scheduler ABI

```typescript
const SCHEDULER = '0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B' as const;

const schedulerAbi = [
  {
    name: 'schedule',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'data', type: 'bytes' },
      { name: 'gas', type: 'uint32' },
      { name: 'startBlock', type: 'uint32' },
      { name: 'numCalls', type: 'uint32' },
      { name: 'frequency', type: 'uint32' },
      { name: 'ttl', type: 'uint32' },
      { name: 'maxFeePerGas', type: 'uint256' },
      { name: 'maxPriorityFeePerGas', type: 'uint256' },
      { name: 'value', type: 'uint256' },
      { name: 'payer', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'schedule',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'data', type: 'bytes' },
      { name: 'gas', type: 'uint32' },
      { name: 'numCalls', type: 'uint32' },
      { name: 'frequency', type: 'uint32' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'cancel',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'callId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'approveScheduler',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'schedulerContract', type: 'address' }],
    outputs: [],
  },
  {
    name: 'calls',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'callId', type: 'uint256' }],
    outputs: [
      { name: 'to', type: 'address' },
      { name: 'caller', type: 'address' },
      { name: 'startBlock', type: 'uint32' },
      { name: 'numCalls', type: 'uint32' },
      { name: 'frequency', type: 'uint32' },
      { name: 'gas', type: 'uint32' },
      { name: 'ttl', type: 'uint32' },
      { name: 'state', type: 'uint8' },
      { name: 'maxFeePerGas', type: 'uint256' },
      { name: 'maxPriorityFeePerGas', type: 'uint256' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
  },
  {
    name: 'getCallState',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'callId', type: 'uint256' }],
    outputs: [{ name: 'state', type: 'uint8' }],
  },
] as const;
```

The 4-param minimal overload auto-sets: `startBlock = block.number + frequency`, `ttl = 0`, `maxFeePerGas = block.basefee`, `maxPriorityFeePerGas = 0`, `value = 0`, `payer = msg.sender`.

---

## TypeScript: Schedule a Single Delayed Execution

```typescript
import {
  createPublicClient, createWalletClient, defineChain, http,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ritualChain = defineChain({
  id: 1979,
  name: 'Ritual Chain',
  nativeCurrency: { name: 'RITUAL', symbol: 'RITUAL', decimals: 18 },
  rpcUrls: { default: { http: [process.env.RITUAL_RPC_URL!] } },
});

const account = privateKeyToAccount(process.env.PRIVATE_KEY! as `0x${string}`);
const publicClient = createPublicClient({ chain: ritualChain, transport: http() });
const walletClient = createWalletClient({ account, chain: ritualChain, transport: http() });

const currentBlock = await publicClient.getBlockNumber();
const gasPrice = await publicClient.getGasPrice();

const callData = encodeFunctionData({
  abi: myContractAbi,
  functionName: 'myCallback',
  args: [0n, myArg], // 0 = dummy executionIndex, Scheduler overwrites it
});

const hash = await walletClient.writeContract({
  address: SCHEDULER,
  abi: schedulerAbi,
  functionName: 'schedule',
  args: [
    callData,
    300_000,                            // gas
    Number(currentBlock) + 150,         // startBlock
    1,                                  // numCalls
    1,                                  // frequency
    100,                                // ttl
    gasPrice,                           // maxFeePerGas
    0n,                                 // maxPriorityFeePerGas
    0n,                                 // value per call
    account.address,                    // payer
  ],
});
```

## TypeScript: Schedule Recurring Execution

```typescript
const hash = await walletClient.writeContract({
  address: SCHEDULER,
  abi: schedulerAbi,
  functionName: 'schedule',
  args: [
    callData,
    300_000,                            // gas
    Number(currentBlock) + 150,         // startBlock
    24,                                 // numCalls — 24 total
    50,                                 // frequency — every 50 blocks (~17.5s at ~350ms baseline)
    200,                                // ttl
    gasPrice,
    0n,
    0n,
    account.address,
  ],
});
```

## TypeScript: Query and Monitor

```typescript
const callInfo = await publicClient.readContract({
  address: SCHEDULER,
  abi: schedulerAbi,
  functionName: 'calls',
  args: [callId],
});

// State enum: 0=SCHEDULED, 1=EXECUTING, 2=COMPLETED, 3=CANCELLED, 4=EXPIRED
console.log('State:', callInfo.state);

const state = await publicClient.readContract({
  address: SCHEDULER,
  abi: schedulerAbi,
  functionName: 'getCallState',
  args: [callId],
});

// Terminal states: 2 (COMPLETED), 3 (CANCELLED), 4 (EXPIRED)
if (state >= 2) {
  console.log('Schedule is done');
}
```

---
---
Source: `ritual-foundation/ritual-dapp-skills` — The Clear BSD License, (c) 2026 Ritual Foundation.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/ritual-dapp-scheduler/SKILL.md` from `ritual-foundation/ritual-dapp-skills` with the `gitmcp` MCP.
