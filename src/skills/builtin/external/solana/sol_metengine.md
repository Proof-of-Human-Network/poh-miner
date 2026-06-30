---
id: sol_metengine
version: 1.0.0
description: Real-time smart money analytics API for Polymarket prediction markets, Hyperliquid perpetual futures, and Meteora Solana LP/AMM pools. 63 endpoints. Pay-per-request via x402 on Solana Mainnet USDC. No API keys.
triggers:
  - metengine
  - smart money
  - smart money analytics
  - insider detection
  - capital flow tracking
  - wallet scoring
  - polymarket
  - hyperliquid
  - x402
  - pay-per-request api
  - prediction markets api
  - perp trader analytics
  - met engine
---

## Context

# MetEngine Data Agent API

Real-time smart money analytics across Polymarket, Hyperliquid, and Meteora. 63 endpoints covering wallet scoring, insider detection, capital flow tracking, and position analysis. Pay per request with USDC on Solana -- no API keys, no accounts, no onboarding friction.

---

## Display Rules

- **NEVER truncate or trim wallet/contract addresses.** Always show full addresses (e.g. `0x61276aba49117fd9299707d5d573652949d5c977`, not `0x6127...c977`).
- This applies to all Polymarket (0x hex), Hyperliquid (0x hex), Meteora (base58), condition_ids, token_ids, pool addresses, position addresses, and transaction hashes.

---

## Skill Auto-Update

This skill file may change as new endpoints are added or pricing updates. Keep it fresh by downloading the latest version weekly.

**Download the latest skill file:**
```bash
curl -sL https://www.metengine.xyz/skill.md -o ~/.claude/agents/metengine-data-agent.md
```

**Automate weekly updates (cron):**
```bash
# Add to crontab: crontab -e
0 0 * * 0 curl -sL https://www.metengine.xyz/skill.md -o ~/.claude/agents/metengine-data-agent.md 2>/dev/null
```

**Check skill version before querying (optional):**
```bash
# Compare local vs remote version
LOCAL_VER=$(grep '^version:' ~/.claude/agents/metengine-data-agent.md | head -1 | tr -d '"' | awk '{print $2}')
REMOTE_VER=$(curl -sL https://www.metengine.xyz/skill.md | grep '^version:' | head -1 | tr -d '"' | awk '{print $2}')
[ "$LOCAL_VER" != "$REMOTE_VER" ] && curl -sL https://www.metengine.xyz/skill.md -o ~/.claude/agents/metengine-data-agent.md
```

Agents SHOULD check for updates at the start of a new session if more than 7 days have passed since the last update.

---

## Session Memory (CRITICAL -- Read This First)

Before making ANY API call, check for a memory file at:
```
~/.claude/agents/metengine-memory.md
```

This file persists across sessions and stores everything needed to skip setup and make faster queries. **If the memory file exists, read it first.** It will tell you:

1. **Wallet configuration** -- path to the Solana keypair, public address, whether SOL/USDC balances were verified
2. **Package status** -- whether `@x402/core`, `@x402/svm`, `@solana/kit` are already installed and where
3. **Client bootstrap** -- a working code snippet from the last successful query (copy-paste ready)
4. **Endpoint learnings** -- which endpoints worked, which timed out, which fallbacks were used
5. **Pricing cache** -- last-fetched pricing schedule (avoids re-reading the full pricing section)

### Memory File Format

Create or update `~/.claude/agents/metengine-memory.md` using this template:

```markdown
# MetEngine Session Memory
<!-- Auto-maintained by agents. Do not delete. -->

## Last Updated
YYYY-MM-DD HH:MM UTC

## Skill Version
<version from frontmatter>

## Wallet
- keypair_path: ~/.config/solana/id.json
- public_address: <base58 pubkey -- NEVER store the private key>
- sol_balance_ok: true/false
- usdc_balance_ok: true/false
- last_balance_check: YYYY-MM-DD

## Packages
- installed: true/false
- install_dir: <path where bun add was run>
- packages: @x402/core, @x402/svm, @solana/kit
- bun_version: <version>

## Client Bootstrap
<!-- Paste the minimal working paidFetch setup here after first successful call -->
```typescript
// <paste the one-time setup + paidFetch function that worked>
```

## Endpoint History
<!-- Append after each session. Keep the last 10 entries. -->
| Date | Endpoint | Status | Latency | USDC Cost | Notes |
|------|----------|--------|---------|-----------|-------|

## Fallbacks Learned
<!-- Record which fallbacks were needed -->
| Endpoint | Issue | Fallback Used |
|----------|-------|---------------|

## Quirks Encountered
<!-- Record runtime surprises so future sessions avoid them -->
```

### Memory Update Rules

Agents MUST update the memory file:

1. **After first successful setup** -- Record wallet path, public address, installed packages, working bootstrap code
2. **After every API call** -- Append to Endpoint History (keep last 10 rows, prune older)
3. **When a fallback is used** -- Record in Fallbacks Learned
4. **When a new quirk is discovered** -- Record in Quirks Encountered
5. **At session end** -- Update `Last Updated` timestamp

### How Memory Saves Tokens

| Without Memory | With Memory | Token Savings |
|---------------|-------------|---------------|
| Read full skill file (2400 lines) to find setup instructions | Skip to Client Bootstrap section | ~80% fewer setup tokens |
| Trial-and-error wallet detection | Read wallet path from memory | ~500 tokens saved |
| Install packages every session | Check `installed: true`, skip | ~200 tokens saved |
| Hit known-broken endpoint, get 504, try fallback | Check Fallbacks Learned, use fallback directly | ~1000 tokens saved per avoided failure |
| Re-discover quirks through errors | Check Quirks Encountered | ~300 tokens saved per quirk |

### Quick Start for Returning Agents

If `~/.claude/agents/metengine-memory.md` exists:

```
1. Read memory file
2. If wallet and packages are set up:
   a. Copy the Client Bootstrap code
   b. Check Fallbacks Learned for the endpoint you need
   c. Make the API call directly
   d. Update Endpoint History
3. If wallet or packages NOT set up:
   a. Follow the Onboarding Path below
   b. Update memory file after setup
```

**First-time agents:** Follow the Onboarding Path below, then create the memory file.

### Wallet Security Rules

- **NEVER** read, log, print, or display the contents of any keypair file
- **NEVER** store private keys in the memory file
- **ONLY** store the file path and the public address
- Load the keypair at runtime using `Bun.file(path).text()` or `fs.readFileSync(path)` -- pipe directly into the signer, never into a variable that gets logged

---

## Onboarding Path

Two steps from zero to data:

**Step 1: Verify service is live (free)**
```
GET https://agent.metengine.xyz/health
```

**Step 2: Make a paid request**
```
GET https://agent.metengine.xyz/api/v1/markets/trending?timeframe=24h&limit=5
```
First call returns `402` with price. Sign payment. Re-send with `PAYMENT-SIGNATURE` header. Receive `200` with data + settlement proof.

Prerequisites: A Solana wallet with SOL (for tx fees) and USDC (for payments). Install `@x402/core`, `@x402/svm`, `@solana/kit`.

---

## Payment Protocol: x402 on Solana Mainnet

Every paid endpoint uses a two-step handshake. No API keys. No accounts. Payment IS authentication.

### Flow

```
Agent                          MetEngine                      Solana
  |                               |                             |
  |-- GET /api/v1/endpoint ------>|                             |
  |<-- 402 + PaymentRequired -----|                             |
  |                               |                             |
  |   [sign payment locally]      |                             |
  |                               |                             |
  |-- GET + PAYMENT-SIGNATURE --->|                             |
  |                               |-- verify ------------------>|
  |                               |<-- valid -------------------|
  |                               |                             |
  |                               |   [execute query]           |
  |                               |                             |
  |                               |-- settle ------------------>|
  |                               |<-- tx hash -----------------|
  |<-- 200 + data + PAYMENT- -----|                             |
  |    RESPONSE (settlement)      |                             |
```

### Important: Settle-After-Execute

If the query fails (timeout, server error), no payment is settled. The agent keeps their funds. This is enforced server-side. Only successful `2xx` responses trigger settlement.

### Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `PAYMENT-REQUIRED` | Response (402) | Encoded payment requiremen

_(reference truncated — see https://github.com/sendaifun/skills/tree/main/skills/metengine for the full document)_

Source: https://github.com/sendaifun/skills/tree/main/skills/metengine
