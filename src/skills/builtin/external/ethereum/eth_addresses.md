---
id: eth_addresses
version: 1.0.0
description: Verified contract addresses for major Ethereum protocols across mainnet and L2s. Use this instead of guessing or hallucinating addresses. Includes Uniswap, Aave, Compound, Aerodrome, GMX, Pendle, Velodrome, Camelot, SyncSwap, Lido, Rocket Pool, 1inch, Permit2, MakerDAO/sDAI, EigenLayer, Across, Chainlink CCIP, Yearn V3, USDC, USDT, DAI, ENS, Safe, Chainlink, and more. Always verify addresses against a block explorer before sending transactions.
triggers:
  - ethereum contract address
  - verified contract address
  - uniswap address
  - aave address
  - token address ethereum
---

## Context

# Contract Addresses

> **CRITICAL:** Never hallucinate a contract address. Wrong addresses mean lost funds. If an address isn't listed here, look it up on the block explorer or the protocol's official docs before using it.

**Last Verified:** March 3, 2026 (all addresses verified onchain via `eth_getCode` + `eth_call` + `symbol()` + `latestAnswer()`)

---

## Stablecoins

### USDC (Circle) — Native
| Network | Address | Status |
|---------|---------|--------|
| Mainnet | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | ✅ Verified |
| Arbitrum | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | ✅ Verified |
| Optimism | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | ✅ Verified |
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | ✅ Verified |
| Polygon | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | ✅ Verified |
| zkSync Era | `0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4` | ✅ Verified |

### USDT (Tether)
| Network | Address | Status |
|---------|---------|--------|
| Mainnet | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | ✅ Verified |
| Arbitrum | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | ✅ Verified |
| Optimism | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | ✅ Verified |
| Base | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | ✅ Verified |

### DAI (MakerDAO)
| Network | Address | Status |
|---------|---------|--------|
| Mainnet | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | ✅ Verified |
| Arbitrum | `0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1` | ✅ Verified |
| Optimism | `0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1` | ✅ Verified |
| Base | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` | ✅ Verified |

---

## Wrapped ETH (WETH)

| Network | Address | Status |
|---------|---------|--------|
| Mainnet | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | ✅ Verified |
| Arbitrum | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | ✅ Verified |
| Optimism | `0x4200000000000000000000000000000000000006` | ✅ Verified |
| Base | `0x4200000000000000000000000000000000000006` | ✅ Verified |

---

## Liquid Staking

### Lido — wstETH (Wrapped stETH)
| Network | Address | Status |
|---------|---------|--------|
| Mainnet | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | ✅ Verified |
| Arbitrum | `0x5979D7b546E38E414F7E9822514be443A4800529` | ✅ Verified |
| Optimism | `0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb` | ✅ Verified |
| Base | `0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452` | ✅ Verified |

### Lido — Staking & Withdrawal
| Contract | Address | Status |
|----------|---------|--------|
| stETH / Lido (deposit ETH here) | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | ✅ Verified |
| Withdrawal Queue (unstETH NFT) | `0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1` | ✅ Verified |

### Rocket Pool
| Contract | Address | Status |
|----------|---------|--------|
| rETH Token | `0xae78736Cd615f374D3085123A210448E74Fc6393` | ✅ Verified |
| Deposit Pool v1.1 | `0x2cac916b2A963Bf162f076C0a8a4a8200BCFBfb4` | ✅ Verified |

---

## DeFi Protocols

### Uniswap

#### V2 (Mainnet)
| Contract | Address | Status |
|----------|---------|--------|
| Router | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | ✅ Verified |
| Factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` | ✅ Verified |

#### V3 (Mainnet)
| Contract | Address | Status |
|----------|---------|--------|
| SwapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | ✅ Verified |
| SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | ✅ Verified |
| Factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | ✅ Verified |
| Quoter V2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | ✅ Verified |
| Position Manager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | ✅ Verified |

#### V3 Multi-Chain
| Contract | Arbitrum | Optimism | Base |
|----------|----------|----------|------|
| SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` ✅ | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` ✅ | `0x2626664c2603336E57B271c5C0b26F421741e481` ✅ |
| Factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` ✅ | `0x1F98431c8aD98523631AE4a59f267346ea31F984` ✅ | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` ✅ |

#### V4 (Live Since January 31, 2025)

⚠️ **V4 addresses are DIFFERENT per chain** — unlike V3, they are NOT deterministic CREATE2 deploys. Do not assume the same address works cross-chain.

| Contract | Mainnet | Status |
|----------|---------|--------|
| PoolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` | ✅ Verified |
| PositionManager | `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` | ✅ Verified |
| Quoter | `0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203` | ✅ Verified |
| StateView | `0x7ffe42c4a5deea5b0fec41c94c136cf115597227` | ✅ Verified |

#### V4 Multi-Chain
| Contract | Arbitrum | Base | Optimism |
|----------|----------|------|----------|
| PoolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` ✅ | `0x498581ff718922c3f8e6a244956af099b2652b2b` ✅ | `0x9a13f98cb987694c9f086b1f5eb990eea8264ec3` ✅ |
| PositionManager | `0xd88f38f930b7952f2db2432cb002e7abbf3dd869` ✅ | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` ✅ | `0x3c3ea4b57a46241e54610e5f022e5c45859a1017` ✅ |

#### Universal Router (V4 — Current)
| Network | Address | Status |
|---------|---------|--------|
| Mainnet | `0x66a9893cc07d91d95644aedd05d03f95e1dba8af` | ✅ Verified |
| Arbitrum | `0xa51afafe0263b40edaef0df8781ea9aa03e381a3` | ✅ Verified |
| Base | `0x6ff5693b99212da76ad316178a184ab56d299b43` | ✅ Verified |
| Optimism | `0x851116d9223fabed8e56c0e6b8ad0c31d98b3507` | ✅ Verified |

#### Universal Router (V3 — Legacy)
| Contract | Address | Status |
|----------|---------|--------|
| Universal Router | `0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD` | ✅ Verified |

#### Permit2 (Universal Token Approval)

Used by Uniswap Universal Router and many other protocols. Same address on all chains (CREATE2).

| Network | Address | Status |
|---------|---------|--------|
| All chains | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | ✅ Verified |

Verified on: Mainnet, Arbitrum, Base, Optimism (identical bytecode on all).

#### UNI Token
| Network | Address | Status |
|---------|---------|--------|
| Mainnet | `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` | ✅ Verified |

### 1inch Aggregation Router

Use aggregators for best swap prices — they route across all DEXs.

#### V6 (Current — same address on all chains via CREATE2)
| Network | Address | Status |
|---------|---------|--------|
| Mainnet | `0x111111125421cA6dc452d289314280a0f8842A65` | ✅ Verified |
| Arbitrum | `0x111111125421cA6dc452d289314280a0f8842A65` | ✅ Verified |
| Base | `0x111111125421cA6dc452d289314280a0f8842A65` | ✅ Verified |

#### V5 (Legacy)
| Network | Address | Status |
|---------|---------|--------|
| Mainnet | `0x1111111254EEB25477B68fb85Ed929f73A960582` | ✅ Verified |

### MakerDAO / Sky

| Contract | Address | Status |
|----------|---------|--------|
| DAI Savings Rate (Pot) | `0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7` | ✅ Verified |
| sDAI (Savings Dai ERC-4626) | `0x83F20F44975D03b1b09e64809B757c47f942BEeA` | ✅ Verified |

sDAI is an ERC-4626 vault — deposit DAI, earn DSR automatically. Check current rate via `pot.dsr()`.

### Aave

#### V2 (Mainnet - Legacy)
| Contract | Address | Status |
|----------|---------|--------|
| LendingPool | `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9` | ✅ Verified |

#### V3 (Mainnet)
| Contract | Address | Status |
|----------|---------|--------|
| Pool | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | ✅ Verified |
| PoolAddressesProvider | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` | ✅ Verified |

#### V3 Multi-Chain
| Contract | Arbitrum | Optimism | Base |
|----------|----------|----------|------|
| Pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` ✅ | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` ✅ | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` ✅ |
| PoolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` ✅ | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` ✅ | `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D` ✅ |

### Compound

#### V2 (Mainnet

_(reference truncated — see https://github.com/austintgriffith/ethskills/tree/main/addresses for the full document)_

Source: https://github.com/austintgriffith/ethskills/tree/main/addresses
