---
id: sol_pinocchio_development
version: 1.0.0
description: Comprehensive guide for building high-performance Solana programs using Pinocchio - the zero-dependency, zero-copy framework. Covers account validation, CPI patterns, optimization techniques, and migration from Anchor.
triggers:
  - pinocchio development
  - pinocchio-development
  - pinocchio
  - development
---

## Context

# Pinocchio Development Guide

Build blazing-fast Solana programs with Pinocchio - a zero-dependency, zero-copy framework that delivers **88-95% compute unit reduction** and **40% smaller binaries** compared to traditional approaches.

## Overview

Pinocchio is Anza's minimalist Rust library for writing Solana programs without the heavyweight `solana-program` crate. It treats incoming transaction data as a single byte slice, reading it in-place via zero-copy techniques.

### Performance Comparison

| Metric | Anchor | Native (solana-program) | Pinocchio |
|--------|--------|------------------------|-----------|
| Token Transfer CU | ~6,000 | ~4,500 | ~600-800 |
| Binary Size | Large | Medium | Small (-40%) |
| Heap Allocation | Required | Required | Optional |
| Dependencies | Many | Several | Zero* |

*Only Solana SDK types for on-chain execution

### When to Use Pinocchio

**Use Pinocchio When:**
- Building high-throughput programs (DEXs, orderbooks, games)
- Compute units are a bottleneck
- Binary size matters (program deployment costs)
- You need maximum control over memory
- Building infrastructure (tokens, vaults, escrows)

**Consider Anchor Instead When:**
- Rapid prototyping / MVPs
- Team unfamiliar with low-level Rust
- Complex account relationships
- Need extensive ecosystem tooling
- Audit timeline is tight (more auditors know Anchor)

## Quick Start

### 1. Project Setup

```toml
# Cargo.toml
[package]
name = "my-program"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[features]
default = []
bpf-entrypoint = []

[dependencies]
pinocchio = "0.10"
pinocchio-system = "0.4"      # System Program CPI helpers
pinocchio-token = "0.4"       # Token Program CPI helpers
bytemuck = { version = "1.14", features = ["derive"] }

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
opt-level = 3
```

### 2. Basic Program Structure

```rust
use pinocchio::{
    account_info::AccountInfo,
    entrypoint,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

// Declare entrypoint
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Route instructions by discriminator (first byte)
    match instruction_data.first() {
        Some(0) => initialize(accounts, &instruction_data[1..]),
        Some(1) => execute(accounts, &instruction_data[1..]),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
```

### 3. Account Definition with Bytemuck

```rust
use bytemuck::{Pod, Zeroable};

// Single-byte discriminator for account type
pub const VAULT_DISCRIMINATOR: u8 = 1;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Vault {
    pub discriminator: u8,
    pub owner: [u8; 32],      // Pubkey as bytes
    pub balance: u64,
    pub bump: u8,
    pub _padding: [u8; 6],    // Align to 8 bytes
}

impl Vault {
    pub const LEN: usize = std::mem::size_of::<Self>();

    pub fn from_account(account: &AccountInfo) -> Result<&Self, ProgramError> {
        let data = account.try_borrow_data()?;
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != VAULT_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(bytemuck::from_bytes(&data[..Self::LEN]))
    }

    pub fn from_account_mut(account: &AccountInfo) -> Result<&mut Self, ProgramError> {
        let mut data = account.try_borrow_mut_data()?;
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(bytemuck::from_bytes_mut(&mut data[..Self::LEN]))
    }
}
```

## Instructions

### Step 1: Define Account Validation

Create a struct to hold validated accounts:

```rust
pub struct InitializeAccounts<'a> {
    pub vault: &'a AccountInfo,
    pub owner: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
}

impl<'a> InitializeAccounts<'a> {
    pub fn parse(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        let [vault, owner, system_program, ..] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        // Validate owner is signer
        if !owner.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Validate system program
        if system_program.key() != &pinocchio_system::ID {
            return Err(ProgramError::IncorrectProgramId);
        }

        Ok(Self {
            vault,
            owner,
            system_program,
        })
    }
}
```

### Step 2: Implement Instruction Handler

```rust
use pinocchio_system::instructions::CreateAccount;

pub fn initialize(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let ctx = InitializeAccounts::parse(accounts)?;

    // Derive PDA
    let (pda, bump) = Pubkey::find_program_address(
        &[b"vault", ctx.owner.key().as_ref()],
        &crate::ID,
    );

    // Verify PDA matches
    if ctx.vault.key() != &pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create account via CPI
    let space = Vault::LEN as u64;
    let rent = pinocchio::sysvar::rent::Rent::get()?;
    let lamports = rent.minimum_balance(space as usize);

    CreateAccount {
        from: ctx.owner,
        to: ctx.vault,
        lamports,
        space,
        owner: &crate::ID,
    }
    .invoke_signed(&[&[b"vault", ctx.owner.key().as_ref(), &[bump]]])?;

    // Initialize account data
    let vault = Vault::from_account_mut(ctx.vault)?;
    vault.discriminator = VAULT_DISCRIMINATOR;
    vault.owner = ctx.owner.key().to_bytes();
    vault.balance = 0;
    vault.bump = bump;

    Ok(())
}
```

## Entrypoint Options

Pinocchio provides three entrypoint macros with different trade-offs:

### 1. Standard Entrypoint (Recommended for most cases)

```rust
use pinocchio::entrypoint;

entrypoint!(process_instruction);
```

- Sets up heap allocator
- Configures panic handler
- Deserializes accounts automatically

### 2. Lazy Entrypoint (Best for single-instruction programs)

```rust
use pinocchio::lazy_entrypoint;

lazy_entrypoint!(process_instruction);

pub fn process_instruction(mut context: InstructionContext) -> ProgramResult {
    // Accounts parsed on-demand
    let account = context.next_account()?;
    let data = context.instruction_data();
    Ok(())
}
```

- Defers parsing until needed
- Best CU savings for simple programs
- **80-87% CU reduction** in memo program benchmarks

### 3. No Allocator (Maximum optimization)

```rust
use pinocchio::{entrypoint, no_allocator};

no_allocator!();
entrypoint!(process_instruction);
```

- Disables heap entirely
- Cannot use `String`, `Vec`, `Box`
- Best for statically-sized operations

## CPI Patterns

### System Program CPI

```rust
use pinocchio_system::instructions::{CreateAccount, Transfer};

// Create account
CreateAccount {
    from: payer,
    to: new_account,
    lamports: rent_lamports,
    space: account_size,
    owner: &program_id,
}.invoke()?;

// Transfer SOL
Transfer {
    from: source,
    to: destination,
    lamports: amount,
}.invoke()?;

// Transfer with PDA signer
Transfer {
    from: pda_account,
    to: destination,
    lamports: amount,
}.invoke_signed(&[&[b"vault", owner.as_ref(), &[bump]]])?;
```

### Token Program CPI

```rust
use pinocchio_token::instructions::{Transfer, MintTo, Burn};

// Transfer tokens
Transfer {
    source: from_token_account,
    destination: to_token_account,
    authority: owner,
    amount: token_amount,
}.invoke()?;

// Mint tokens (with PDA authority)
MintTo {
    mint: mint_account,
    token_account: destination,
    authority: mint_authority_pda,
    amount: mint_amount,
}.invoke_signed(&[&[b"mint_auth", &[bump]]])?;
```

### Custom CPI (Third-party programs)

```rust
use pinocchio::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};

// Build instruction manually
let ac

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/pinocchio-development for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/pinocchio-development
