---
id: sol_debridge
version: 1.0.0
description: Complete deBridge Protocol SDK for building cross-chain bridges, message passing, and token transfers on Solana. Use when building cross-chain applications, bridging assets between Solana and EVM chains, or implementing trustless external calls. Distinct from sol_lifi.md (LI.FI aggregator) — use this skill specifically for the deBridge SDK/DLN.
triggers:
  - debridge
  - debridge protocol
  - dln
  - cross-chain bridge solana
  - bridge solana to evm
  - cross-chain message passing
  - trustless external call
  - bridge assets solana
  - debridge finance
---

## Context

# deBridge Solana SDK Development Guide

A comprehensive guide for building Solana programs with the deBridge Solana SDK - enabling decentralized cross-chain transfers of arbitrary messages and value between blockchains.

## Overview

deBridge is a cross-chain infrastructure protocol enabling:
- **Cross-Chain Transfers**: Bridge assets between Solana and 20+ EVM chains
- **Message Passing**: Send arbitrary messages across blockchains
- **External Calls**: Execute smart contract calls on destination chains
- **Sub-Second Settlement**: ~2 second median settlement time
- **Capital Efficiency**: Intent-based architecture with 4bps lowest spreads

### Key Features
- 26+ security audits (Halborn, Zokyo, Ackee Blockchain)
- $200K bug bounty on Immunefi
- 100% uptime since launch
- Zero security incidents

## Quick Start

### Installation

Add the SDK to your Anchor/Solana program:

```bash
cargo add --git ssh://git@github.com/debridge-finance/debridge-solana-sdk.git debridge-solana-sdk
```

Or add to `Cargo.toml`:

```toml
[dependencies]
debridge-solana-sdk = { git = "ssh://git@github.com/debridge-finance/debridge-solana-sdk.git" }
```

### Basic Setup (Anchor)

```rust
use anchor_lang::prelude::*;
use debridge_solana_sdk::prelude::*;

declare_id!("YourProgramId11111111111111111111111111111");

#[program]
pub mod my_bridge_program {
    use super::*;

    pub fn send_cross_chain(
        ctx: Context<SendCrossChain>,
        target_chain_id: [u8; 32],
        receiver: Vec<u8>,
        amount: u64,
    ) -> Result<()> {
        // Invoke deBridge send
        debridge_sending::invoke_debridge_send(
            debridge_sending::SendIx {
                target_chain_id,
                receiver,
                is_use_asset_fee: false,  // Use native SOL for fees
                amount,
                submission_params: None,
                referral_code: None,
            },
            ctx.remaining_accounts,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct SendCrossChain<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    // Additional accounts passed via remaining_accounts
}
```

## Core Concepts

### 1. Chain IDs

deBridge uses 32-byte chain identifiers for all supported networks:

```rust
use debridge_solana_sdk::chain_ids::*;

// Solana
let solana = SOLANA_CHAIN_ID;  // Solana mainnet

// EVM Chains
let ethereum = ETHEREUM_CHAIN_ID;     // Chain ID: 1
let polygon = POLYGON_CHAIN_ID;       // Chain ID: 137
let bnb = BNB_CHAIN_CHAIN_ID;         // Chain ID: 56
let arbitrum = ARBITRUM_CHAIN_ID;     // Chain ID: 42161
let avalanche = AVALANCHE_CHAIN_ID;   // Chain ID: 43114
let fantom = FANTOM_CHAIN_ID;         // Chain ID: 250
let heco = HECO_CHAIN_ID;             // Chain ID: 128
```

### 2. Program IDs

```rust
use debridge_solana_sdk::{DEBRIDGE_ID, SETTINGS_ID};

// Main deBridge program for sending/claiming
let debridge_program = DEBRIDGE_ID;

// Settings and confirmation storage program
let settings_program = SETTINGS_ID;
```

### 3. Fee Structure

deBridge supports multiple fee payment methods:

```rust
// Native Fee (SOL)
is_use_asset_fee: false  // Pay fees in SOL

// Asset Fee
is_use_asset_fee: true   // Pay fees in the bridged token

// Fee Constants
const BPS_DENOMINATOR: u64 = 10000;  // Basis points divisor
```

### 4. Flags

Control transfer behavior with flags:

```rust
use debridge_solana_sdk::flags::*;

// Available flags (bit positions)
const UNWRAP_ETH: u8 = 0;              // Unwrap to native ETH on destination
const REVERT_IF_EXTERNAL_FAIL: u8 = 1; // Revert if external call fails
const PROXY_WITH_SENDER: u8 = 2;       // Include sender in proxy call
const SEND_HASHED_DATA: u8 = 3;        // Send data as hash
const DIRECT_WALLET_FLOW: u8 = 31;     // Use direct wallet flow

// Setting flags on submission params
let mut flags = [0u8; 32];
flags.set_reserved_flag(UNWRAP_ETH);
flags.set_reserved_flag(REVERT_IF_EXTERNAL_FAIL);
```

## Sending Cross-Chain Transfers

### Basic Token Transfer

```rust
use debridge_solana_sdk::prelude::*;

pub fn send_tokens(
    ctx: Context<SendTokens>,
    amount: u64,
) -> Result<()> {
    debridge_sending::invoke_debridge_send(
        debridge_sending::SendIx {
            target_chain_id: chain_ids::ETHEREUM_CHAIN_ID,
            receiver: recipient_eth_address.to_vec(),
            is_use_asset_fee: false,
            amount,
            submission_params: None,
            referral_code: Some(12345),  // Optional referral
        },
        ctx.remaining_accounts,
    )?;

    Ok(())
}
```

### Transfer with Fixed Native Fee

```rust
pub fn send_with_native_fee(
    ctx: Context<Send>,
    target_chain_id: [u8; 32],
    receiver: Vec<u8>,
    amount: u64,
) -> Result<()> {
    // Get the fixed fee for the target chain
    let fee = debridge_sending::get_chain_native_fix_fee(
        &target_chain_id,
        ctx.remaining_accounts,
    )?;

    debridge_sending::invoke_debridge_send(
        debridge_sending::SendIx {
            target_chain_id,
            receiver,
            is_use_asset_fee: false,
            amount,
            submission_params: None,
            referral_code: None,
        },
        ctx.remaining_accounts,
    )?;

    Ok(())
}
```

### Transfer with Asset Fee

```rust
pub fn send_with_asset_fee(
    ctx: Context<Send>,
    target_chain_id: [u8; 32],
    receiver: Vec<u8>,
    amount: u64,
) -> Result<()> {
    // Check if asset fee is available for this chain
    let is_available = debridge_sending::is_asset_fee_available(
        &target_chain_id,
        ctx.remaining_accounts,
    )?;

    if !is_available {
        return Err(error!(ErrorCode::AssetFeeNotAvailable));
    }

    debridge_sending::invoke_debridge_send(
        debridge_sending::SendIx {
            target_chain_id,
            receiver,
            is_use_asset_fee: true,  // Use asset for fees
            amount,
            submission_params: None,
            referral_code: None,
        },
        ctx.remaining_accounts,
    )?;

    Ok(())
}
```

### Transfer with Exact Amount

```rust
pub fn send_exact_amount(
    ctx: Context<Send>,
    target_chain_id: [u8; 32],
    receiver: Vec<u8>,
    exact_receive_amount: u64,
) -> Result<()> {
    // Calculate total amount including fees
    let total_with_fees = debridge_sending::add_all_fees(
        exact_receive_amount,
        &target_chain_id,
        ctx.remaining_accounts,
    )?;

    debridge_sending::invoke_debridge_send(
        debridge_sending::SendIx {
            target_chain_id,
            receiver,
            is_use_asset_fee: true,
            amount: total_with_fees,
            submission_params: None,
            referral_code: None,
        },
        ctx.remaining_accounts,
    )?;

    Ok(())
}
```

### Transfer from PDA (Signed)

```rust
pub fn send_from_pda(
    ctx: Context<SendFromPda>,
    target_chain_id: [u8; 32],
    receiver: Vec<u8>,
    amount: u64,
    pda_seeds: Vec<Vec<u8>>,
) -> Result<()> {
    // Use signed variant for PDA-owned tokens
    debridge_sending::invoke_debridge_send_signed(
        debridge_sending::SendIx {
            target_chain_id,
            receiver,
            is_use_asset_fee: false,
            amount,
            submission_params: None,
            referral_code: None,
        },
        ctx.remaining_accounts,
        &pda_seeds,
    )?;

    Ok(())
}
```

## Message Passing

Send messages without token transfers:

```rust
use debridge_solana_sdk::prelude::*;

pub fn send_message(
    ctx: Context<SendMessage>,
    target_chain_id: [u8; 32],
    receiver: Vec<u8>,
    message_data: Vec<u8>,
) -> Result<()> {
    // Create submission params with message
    let submission_params = debridge_sending::SendSubmissionParamsInput {
        execution_fee: 0,
        flags: [0u8; 32],
        fallback_address: receiver.clone(),
        external_call_shortcut: compute_keccak256(&message_data),
    };

    // Send message (zero amount)
    debridge_sending::in

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/debridge for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/debridge
