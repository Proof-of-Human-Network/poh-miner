---
id: ritual_wallet
version: 1.0.0
description: RitualWallet integration for Ritual dApps. Use when depositing fees, checking balances, managing lock durations, or withdrawing funds.
triggers:
  - ritual wallet
  - ritual account
  - ritual signing
---

## Context
# RitualWallet Integration

## What It Is

RitualWallet (`0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948`) is the escrow contract through which all fees flow in the Ritual system. Users and contracts deposit RITUAL with a time lock. The system deducts fees from these balances during scheduled and async execution.

## Interface

```solidity
interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;
    function depositFor(address user, uint256 lockDuration) external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address user) external view returns (uint256);
    function lockUntil(address user) external view returns (uint256);
}
```

| Function | What It Does |
|---|---|
| `deposit(lockDuration)` | Deposit RITUAL, locked for `lockDuration` blocks from now |
| `depositFor(user, lockDuration)` | Deposit RITUAL for someone else |
| `withdraw(amount)` | Withdraw after lock expires. Reverts with `FundsLocked` if locked. |
| `balanceOf(user)` | Returns the user's balance in wei |
| `lockUntil(user)` | Returns the block number when the lock expires |

### Key behaviors:

- **Lock is monotonic** — new deposits only extend the lock, never shorten it. If you deposit with `lockDuration = 100` and later deposit with `lockDuration = 50`, the lock stays at the first value.
- **No minimum lock duration** — the contract accepts any value including 0. But the reth commitment validator checks `lockUntil >= commit_block + ttl` when accepting async commitments, so in practice you need a lock that covers your async operation window.
- **Direct RITUAL transfer** — sending raw RITUAL to the contract (no function call) credits your balance with 0 lock extension via `receive()`.
- **Fees are never deducted at schedule/submit time** — only during system transaction execution. If you schedule a call and your balance is insufficient when it fires, the execution is skipped, not reverted.

### Who needs the deposit: EOA vs Contract

For **two-phase async precompiles** (image, audio, video, Sovereign Agent, Persistent Agent, long-running HTTP), the RitualWallet balance check at commitment time is performed against the **EOA that signs the transaction**, not the contract that calls the precompile. The chain recovers the signer from the original transaction and checks `balanceOf(signer)`.

This means:
- If your contract calls `WALLET.deposit{value: ...}(lockDuration)`, the deposit goes to `address(this)` (the contract). This is correct for **scheduled transactions** where the Scheduler is the payer.
- For **async precompiles called from an EOA** (or from a contract where the EOA is the signer), the EOA must have its own deposit. Depositing only into the contract's balance will fail with `insufficient wallet balance (user: <EOA address>)`.
- Use `depositFor(eoaAddress, lockDuration)` to deposit for a specific EOA from a contract, or have the EOA call `deposit()` directly.

## TypeScript ABI

```typescript
const RITUAL_WALLET = '0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948' as const;

const ritualWalletAbi = [
  {
    name: 'deposit', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'lockDuration', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'depositFor', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'lockDuration', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'lockUntil', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;
```

## TypeScript: Deposit and Check Balance

```typescript
import {
  createPublicClient, createWalletClient, defineChain, http, parseEther, formatEther,
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

// Check current balance and lock
const balance = await publicClient.readContract({
  address: RITUAL_WALLET, abi: ritualWalletAbi,
  functionName: 'balanceOf', args: [account.address],
});
const lockExpiry = await publicClient.readContract({
  address: RITUAL_WALLET, abi: ritualWalletAbi,
  functionName: 'lockUntil', args: [account.address],
});
const currentBlock = await publicClient.getBlockNumber();

console.log(`Balance: ${formatEther(balance)} RITUAL`);
console.log(`Lock expires at block ${lockExpiry} (current: ${currentBlock})`);
console.log(`Locked: ${currentBlock < lockExpiry}`);

// Deposit 0.5 RITUAL with 10,000 block lock
const depositHash = await walletClient.writeContract({
  address: RITUAL_WALLET, abi: ritualWalletAbi,
  functionName: 'deposit',
  args: [10000n],
  value: parseEther('0.5'),
});
await publicClient.waitForTransactionReceipt({ hash: depositHash });
```

## TypeScript: Withdraw After Lock Expires

```typescript
const lockExpiry = await publicClient.readContract({
  address: RITUAL_WALLET, abi: ritualWalletAbi,
  functionName: 'lockUntil', args: [account.address],
});
const currentBlock = await publicClient.getBlockNumber();

if (currentBlock >= lockExpiry) {
  const balance = await publicClient.readContract({
    address: RITUAL_WALLET, abi: ritualWalletAbi,
    functionName: 'balanceOf', args: [account.address],
  });

  const hash = await walletClient.writeContract({
    address: RITUAL_WALLET, abi: ritualWalletAbi,
    functionName: 'withdraw',
    args: [balance], // withdraw everything
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Withdrew ${formatEther(balance)} RITUAL`);
} else {
  console.log(`Funds locked until block ${lockExpiry} (${lockExpiry - currentBlock} blocks remaining)`);
}
```

## Solidity: Contract Integration

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;
    function balanceOf(address user) external view returns (uint256);
    function lockUntil(address user) external view returns (uint256);
    function withdraw(uint256 amount) external;
}

contract MyDApp {
    IRitualWallet constant WALLET = IRitualWallet(0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948);

    function depositFees(uint256 lockBlocks) external payable {
        WALLET.deposit{value: msg.value}(lockBlocks);
    }

    function checkFeeBalance() external view returns (uint256 balance, uint256 lockExpiry, bool isLocked) {
        balance = WALLET.balanceOf(address(this));
        lockExpiry = WALLET.lockUntil(address(this));
        isLocked = block.number < lockExpiry;
    }

    function withdrawFees(uint256 amount) external {
        require(block.number >= WALLET.lockUntil(address(this)), "still locked");
        WALLET.withdraw(amount);
    }

    receive() external payable {}
}
```
---
Source: `ritual-foundation/ritual-dapp-skills` — The Clear BSD License, (c) 2026 Ritual Foundation.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/ritual-dapp-wallet/SKILL.md` from `ritual-foundation/ritual-dapp-skills` with the `gitmcp` MCP.
