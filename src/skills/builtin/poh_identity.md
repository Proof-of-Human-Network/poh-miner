---
id: poh_identity
version: 1.0.0
description: Full proof-of-human identity scan using on-chain signals and AI brain
allowedEndpoints:
  - '*'
triggers:
  - human
  - bot
  - scan
  - identity
  - verify
  - verdict
  - humanness
  - proof of human
  - is this human
  - is this a bot
  - sybil
---

## Context

Full proof-of-human identity verification for any wallet address. Runs 100+ on-chain signals (EVM history, Solana activity, identity protocols, social presence) and produces an AI verdict.

Input: `{ address }` — EVM address, Solana address, ENS domain, or any supported format.

Returns: `{ verdict: "HUMAN"|"AI"|"UNCERTAIN", confidence: 0–1, reasoning: string, signalsUsed: [...] }`

Use when:
- User pastes a wallet address with no other context
- User asks whether an address is human, a bot, or Sybil
- User asks for identity verification, trust score, or humanity score
- User asks "is this wallet safe?" or "who owns this address?"

Do NOT use for: Farcaster-specific queries, social media lookups, or when user explicitly asks for a different skill.
