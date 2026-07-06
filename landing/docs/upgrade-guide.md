# PoH Miner Upgrade Guide (macOS, Windows, Linux)

This guide covers upgrading an **existing** PoH Miner install after the security release **and** the v0.4.3 / v0.4.4 updates (chat, explorer, wallet fixes, signed job payments, and sync improvements).

**Short answer:** you do **not** need to wipe your blockchain for a normal upgrade. Keep your data folder, install the new version, and restart.

---

## Do I need to dump the whole blockchain?

| Situation | Wipe chain? |
|-----------|-------------|
| Routine upgrade on the same machine | **No** — keep `chain/` and restart |
| Sync works after upgrade | **No** |
| Sync fails / fork / corrupt chain files | **Maybe** — delete only `chain/` and re-sync from bootnodes |
| Brand-new install | N/A — empty data dir, sync from network |

On startup the miner **loads your local chain from disk** without re-scanning every old block. Your height and balances stay until you explicitly re-sync or delete chain data.

A full “blockchain dump” (export/import of state) is **not** required.

---

## Before you upgrade — back up these files

All platforms store miner data under a **`.poh-miner`** folder in your user home directory.

| What | Why |
|------|-----|
| `chain/` (`chain.ndjson`, `chain.json`) | Your local copy of the blockchain |
| `wallets/` | Balances and keys (encrypted on disk) |
| `config.json` | Wallet address, bootnodes, `walletBackupKey` (Electron) |
| `.wallet-key` | Auto encryption key (if you never set `POH_WALLET_KEY`) |
| **Private key** (64-char hex) | Identity key — only shown once at wallet creation |
| **POH_WALLET_KEY** | Wallet-file encryption passphrase — shown once in new Electron onboarding |

### Data directory by platform

| Platform | Path |
|----------|------|
| **macOS** | `/Users/<you>/.poh-miner/` |
| **Linux** | `/home/<you>/.poh-miner/` |
| **Windows** | `C:\Users\<you>\.poh-miner\` |

**Bootnode operators** use a separate folder, usually `~/.poh-bootnode/` (same layout on all OSes, under your home directory).

### Quick backup commands

**macOS / Linux**

```bash
cp -a ~/.poh-miner ~/.poh-miner-backup-$(date +%Y%m%d)
```

**Windows (PowerShell)**

```powershell
Copy-Item -Recurse "$env:USERPROFILE\.poh-miner" "$env:USERPROFILE\.poh-miner-backup-$(Get-Date -Format yyyyMMdd)"
```

---

## What changed in this release (upgrade-relevant)

- **Consensus:** Incoming blocks must pass real PoW, valid coinbase, and signatures — fake `chainWork` is ignored.
- **Wallets:** Private/signing keys encrypted at rest; Electron onboarding adds a **POH_WALLET_KEY** backup step.
- **API:** Remote peer access on by default (`0.0.0.0`); set `"localOnly": true` in config to bind localhost only.
- **Bootnode:** Signed writes required for `/brain/events`, `/ipfs/update`, and stricter `/submit-block`.
- **New blocks** use an updated block hash (full coinbase in hash). **Old blocks already on your disk still load.**

Existing users who **skip onboarding** keep using the auto-generated `~/.poh-miner/.wallet-key` — no manual env var needed on the same machine.

---

## What changed in v0.4.3 / v0.4.4 (upgrade-relevant)

These landed **after** the security release. You still **do not** need to wipe your chain for any of them.

### Wallet & sync

- **Balance replay fix:** Startup no longer double-counts mined transactions. If your balance looked inflated after a long run `POST /api/wallet/rebuild` on localhost.
- **Incremental chain sync:** On restart the node pulls **only missing blocks**, not the full chain from genesis — faster catch-up after downtime.
- **Wallet address stability:** Fixed cases where the app could mint a new address on restart instead of reopening the existing wallet file.
- **Signing key normalization:** PEM-encoded ed25519 keys in wallet files are normalized — fixes P2P auth errors like `address does not match signing public key` after moving wallets between machines.

### Chat & jobs

- **Private vs Public are different modes now:**
  - **Private** — synchronous chat on this device; context stays in local session memory.
  - **Public** — paid jobs are **queued asynchronously**; a queue pill appears in Chat while work is pending.
- **On-chain job history (Public):** Submissions are recorded as `job-submitted` state transitions (`promptPreview`, model, dataset). Completed verdict work appears in `scanResults`. Public follow-ups (e.g. "give me the link") can use chain-stored outputs via `GET /api/wallet/jobs?address=...`.
- **Signed payments required** for `skill` and `compute` jobs — no unverified fee fallback. API/SDK callers must sign `paymentTx` bound to `jobId + miner wallet + maxBudget + nonce`. Register your signing key first: `POST /api/wallet/register-key`.
- **Hugging Face datasets:** Install datasets under **Settings → Datasets**; compute jobs can reference them by id. Chat can suggest installs when a dataset is missing.

### Desktop app (Electron)

- **Blockchain Explorer tab** — browse blocks, search addresses / tx hashes / heights, view **completed jobs** on wallet search and block detail.
- **Settings split into subpages:** General, Network, AI Providers, MCP Servers, Datasets, Wallet.
- **MCP servers** use standard `mcpServers` JSON (`command`, `args`, `env`) — same shape as Claude Desktop / Cursor. Old flat entries in `config.json` are migrated on load.
- **Single-instance lock:** Opening the app twice focuses the existing window instead of starting a second miner (avoids port 3456 conflicts and chain/wallet file races). Headless CLI also refuses a second process against the same data dir.
- **Home page** shows recent POH activity (mining rewards, sends, receives).
- **P2P referral codes** — optional 8-char code when creating orders; 0.3% referral fee on completed trades.
- **Chat history autocomplete** — while typing in Chat, past on-chain questions and answer snippets appear above the input; repetitive prompts can reuse a cached blockchain reply (**Use reply** / automatic on send).

### Chat history search (Meilisearch — auto-starts with the node)

**Meilisearch is mandatory** — the miner downloads and starts it automatically (binary in `~/.poh-miner/bin/`, data in `~/.poh-miner/meilisearch-data`). No separate Docker step required unless you already run Meilisearch on port 7700 (the node will reuse it).

Indexes `promptPreview`, assistant replies, and skill outputs. Rebuilt from `chain/` on startup. **Wallet / desktop clients** search via `GET /api/search/suggest` on the miner API port (3456), not port 7700 directly.

| What you see | When |
|--------------|------|
| **Suggestion list** above the chat input | After 2+ characters; click a row to fill the question |
| **“Similar question on blockchain”** banner | Top match is close to what you typed and has a stored answer |
| **Use reply** | Inserts the cached answer without calling the AI again |

Default `~/.poh-miner/config.json` (auto-merged on upgrade):

```json
"meilisearch": {
  "mandatory": true,
  "autoStart": true,
  "port": 7700,
  "bindHost": "127.0.0.1",
  "indexJobs": "poh-chat-history"
}
```

### API additions (port 3456)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/explorer/blocks` | Paginated block list (`jobCount` when block has mined results) |
| `GET /api/explorer/block/:height` | Full block (`scanResults`, `stateTransitions`, `transactions`) |
| `GET /api/explorer/search?q=` | Address, tx hash, or block height lookup |
| `GET /api/wallet/jobs?address=` | Wallet job history + `latestSkillMemory` + `chatTurns` |
| `GET /api/search/suggest?q=&wallet=` | Chat autocomplete from indexed job history |
| `GET /api/search/history-match?q=&wallet=` | Cached reply for a repetitive prompt |
| `POST /api/wallet/rebuild` | Rebuild balance from chain + journal (localhost) |

### Nothing to migrate manually

| Item | Action on upgrade |
|------|-------------------|
| `chain/` | Keep as-is |
| `wallets/` | Keep as-is |
| `config.json` | Keep; MCP entries auto-normalized to `mcpServers` object |
| HF datasets | Optional; stored under `~/.poh-miner/brain/hf-datasets/` when installed |
| Chat search index | Auto-built on startup; optional Meilisearch on port 7700 |
| API clients submitting paid jobs | **Update** to signed `paymentTx` if still using unsigned fees |

---

## What changed — faster, leaner AI (QVAC in-process)

The biggest optimization in this release: **inference now runs in-process via QVAC** — the model executes inside the miner itself. This replaces the old external LLM server, and it is a straight upgrade in speed and simplicity.

**Why it's better:**

- **One less moving part.** No separate AI server to install, launch, keep running, or update. The miner *is* the inference engine now — fewer processes, less RAM sitting idle, faster cold start.
- **Auto model download.** The model is fetched and cached on first run — no manual model pulls. Nothing to configure to get chat, verdicts, and jobs working.
- **Right-sized for your machine.** First run now asks **which model to download**, showing three options — **Small / Medium / Large** — *graded to your actual hardware*. "Large" on an 8 GB laptop is not the same as "Large" on a 128 GB workstation with a big GPU, so each machine gets choices that actually fit and run fast. Pick once; change it anytime in **Settings** or `config.json` (`"model"`).
- **Runs anywhere, including GPU-less servers.** On a headless Linux box or VPS with no GPU, the required Vulkan runtime is **installed automatically** at setup, so QVAC works out of the box on CPU — no manual driver wrangling.

**What you need to do on upgrade:** nothing. QVAC takes over automatically and your existing chat / verdict / job features keep working — just leaner and faster. If you previously ran a separate LLM server only for the miner, you can retire it.

| AI setup | Before | Now |
|----------|--------|-----|
| Engine | External LLM server (separate install + process) | **In-process QVAC** (nothing to install) |
| Model | Manual pull | **Auto-downloaded**, hardware-graded picker |
| GPU-less Linux / VPS | Manual setup | **Vulkan auto-installed**, runs on CPU |
| Moving parts | Miner + AI server | **Miner only** |

---

## Upgrade steps

### 1. Desktop app (Electron) — macOS & Windows

1. **Quit** PoH Miner completely (check system tray on Windows).
2. **Back up** `.poh-miner` (see above).
3. **Download and install** the latest build from [proofofhuman.ge](https://proofofhuman.ge).
4. **Open** the app.

**Existing wallet:** App should resume with the same address and chain. You will **not** see onboarding again if `onboarded` is already set in `config.json`.

**New install only:** Onboarding now has two backup steps:

1. Private key (controls POH identity and funds)
2. **POH_WALLET_KEY** (unlocks encrypted wallet files if you reinstall or move machines)

Write both down. The app stores `walletBackupKey` in `config.json` for convenience on that PC.

---

### 2. Linux — binary or `npm` / CLI

1. Stop the miner: `pkill -f poh-miner` or stop your systemd service.
2. Back up `~/.poh-miner`.
3. Update the binary or pull latest source and rebuild.
4. Start again:

```bash
# Headless
node start.js
# or
poh-miner start
```

Config is read from `~/.poh-miner/config.json` (see README for search order).

**Optional — restrict API to localhost**

Edit `~/.poh-miner/config.json`:

```json
{
  "localOnly": true
}
```

---

### 3. macOS — CLI / developer install

Same as Linux; data path is `~/.poh-miner/`.

If macOS firewall prompts for incoming connections, allow it if you want peers and the mobile wallet to reach your node on the LAN.

---

### 4. Windows — CLI / binary

1. Stop the miner (Task Manager or `Stop-Process` if running headless).
2. Back up `%USERPROFILE%\.poh-miner`.
3. Replace the `.exe` or reinstall.
4. Run from the new build.

Firewall: the miner may add a rule for the API port (default **3456**) when not in `localOnly` mode.

---

### 5. Bootnode operators

1. Back up `~/.poh-bootnode/` (chain + brain events + IPFS registry).
2. Upgrade bootnode binary.
3. Restart.

Miners must run a version that **signs** brain events and IPFS updates. Unsigned posts to the bootnode will return **403**.

If the bootnode chain contains blocks that fail new validation, consider syncing from a trusted peer or resetting **only** the bootnode `chain/` after coordinating with the network.

---

## After upgrade — sanity checks

1. **Status:** `GET http://localhost:3456/status` — chain height increases over time.
2. **Balance:** `GET http://localhost:3456/api/wallet/balance?address=<your-poh-address>` — if it looks wrong, run **Rebuild Balance** once in Settings → Wallet.
3. **Logs:** No repeated “rejected” / “invalid proof of work” for your own tip.
4. **Peers:** Node registers and gossip connects (if bootnodes are configured).
5. **Explorer:** Open the **Explorer** tab (or `GET /api/explorer/blocks`) — blocks load; search your wallet address shows balance + completed jobs (if any).
6. **Chat modes:** Toggle **Private** — reply is immediate. Toggle **Public** with a paid question — queue pill appears, then result arrives.
6b. **Chat autocomplete:** Type a few characters of a question you asked before — suggestions should appear if that wallet has job history.
7. **Single instance:** Launching the app a second time should focus the first window, not start a duplicate miner.
8. **P2P (if used):** Create/select trade still works; referral tab loads without errors.

---

## Moving to another computer

Copy:

- `wallets/`
- `config.json` (includes `walletBackupKey` if you used Electron onboarding)
- Optionally `chain/` (or delete it and let the new node sync)

On the **new** machine:

- **Same OS user + full `.poh-miner` copy:** Usually works as-is (`.wallet-key` travels with the folder).
- **Wallets only + lost config:** Set environment variable before starting:

**macOS / Linux**

```bash
export POH_WALLET_KEY='your-saved-wallet-encryption-key'
node start.js
```

**Windows (PowerShell)**

```powershell
$env:POH_WALLET_KEY = "your-saved-wallet-encryption-key"
node start.js
```

You still need the **private key** if you recreate the wallet from scratch — the encryption key only unlocks the wallet **file**, it does not replace the PoH private key.

---

## Troubleshooting — when to reset chain only

Try this **only** if the node is stuck, sync errors persist, or height never catches up.

1. Stop the miner.
2. Back up `wallets/` and `config.json`.
3. Delete **only** the chain folder:

**macOS / Linux**

```bash
rm -rf ~/.poh-miner/chain
```

**Windows**

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.poh-miner\chain"
```

4. Start the miner with bootnodes configured in `config.json`.

The node re-downloads the canonical chain from bootnodes and **rebuilds balances** from that chain. You do **not** need to delete `wallets/` unless balances look wrong after a successful full sync (then use **Rebuild Balance from History** in Settings, or `POST /api/wallet/rebuild` on localhost).

---

## FAQ

**Q: Will my testnet POH balance disappear?**  
A: Not on a normal upgrade. Balances live in `wallets/` and are replayed from `chain/`. Only a bad sync or manual wallet delete changes that.

**Q: Do I need `POH_WALLET_KEY` if I never wrote it down?**  
A: On the **same machine**, usually no — `~/.poh-miner/.wallet-key` handles decryption. Write down `POH_WALLET_KEY` when onboarding offers it, or when moving machines.

**Q: Mobile wallet stopped connecting?**  
A: Ensure the miner is running, firewall allows port **3456**, and you use `http://<miner-lan-ip>:3456`. API is on all interfaces by default unless `localOnly: true`.

**Q: I’m a solo miner with no bootnodes — do I need to wipe?**  
A: No. Your local `chain/` is authoritative. You only need bootnodes to catch up with the wider network.

**Q: My balance jumped after many days of mining — is my POH gone?**  
A: Likely a replay-counting bug fixed in v0.4.3+. Upgrade, then **Rebuild Balance from History** in Settings → Wallet. Your chain and wallet files are still the source of truth.

**Q: Public chat says “queued” and nothing happens.**  
A: Public mode submits a paid job to the network. Ensure you have POH balance, a registered signing key, and bootnodes/peers reachable. Check **Explorer** or `GET /job/<id>/status` for the job state.

**Q: Skill/compute job rejected with 402 or PAYMENT_FAILED.**  
A: v0.4.3+ requires a signed `paymentTx` for paid job types. Use the latest SDK (`runCompute()` / `submitJob()`) or register your key via `POST /api/wallet/register-key` and sign the payment hash the API expects.

**Q: I pasted MCP config from Cursor — wrong format?**  
A: Use the `mcpServers` object in **Settings → MCP Servers** (paste full JSON) or add servers one-by-one with `command` / `args` / `env`. The app migrates older config shapes automatically.

**Q: Second miner window won’t open — is that a bug?**  
A: No. Only one miner per data directory is allowed by design. Quit the running instance or use a separate `POH_CONFIG` / data folder if you truly need two nodes.

**Q: Where do I see jobs I paid for on-chain?**  
A: **Explorer** → search your PoH address, or `GET /api/wallet/jobs?address=<addr>`. Block detail shows `scanResults` (completed verdict work) and `job-submitted` transitions in that block.

**Q: Chat suggestions never appear — why?**  
A: You need indexed history first (public/paid jobs with `promptPreview` on chain, or local completed jobs). Type at least 2 characters. Check `GET /api/search/suggest?q=test&wallet=<your-address>`. Meilisearch is optional; local index works without Docker.

**Q: Do I need to install Meilisearch separately?**  
A: No. The miner downloads and starts it on first run. Ensure port **7700** is free, or leave your existing Meilisearch/Docker on that port — the node detects and reuses it. Mobile/desktop apps search via **`/api/search/*` on port 3456**, not 7700.

---

## Summary

| Action | Required? |
|--------|-----------|
| Back up `.poh-miner` | **Recommended** |
| Wipe full blockchain state | **No** (normal upgrade) |
| Delete `chain/` only | **Only if sync is broken** |
| Re-enter private key | **No** (same install) |
| Save POH_WALLET_KEY | **Yes** (new onboarding / machine moves) |
| Rebuild balance once | **Only if balance looks wrong after upgrade** |
| Update API clients for paid jobs | **Yes** if you submit `skill`/`compute` jobs outside the app |
| Reconfigure MCP servers | **Optional** — paste standard `mcpServers` JSON if imports fail |
| Free port 7700 for Meilisearch | **Yes** on first run (or keep existing instance on 7700) |

[Get the latest PoH Miner →](https://proofofhuman.ge)
