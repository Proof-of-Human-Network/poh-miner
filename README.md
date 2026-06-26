# PoH Miner Network

Decentralized compute layer for the Proof of Human network. Miners race to evaluate wallet identity using the existing PoH checker + AI brain, earn POH token for valid work, and collectively maintain an immutable record of every verified identity on a shared blockchain.

---

## Quick Start

### GUI (recommended for non-technical users)

Download the latest `.deb` / `.AppImage` / Windows installer from [miner.proofofhuman.ge](https://miner.proofofhuman.ge).

On all platforms, Ollama and the `qwen2.5:1.5b` model are downloaded and started automatically on first launch.

> **No Ollama?** The miner still works — chat and skill queries fall back to peer miners on the network that have Ollama running.

### CLI

```bash
# Install dependencies once
npm install

# Copy example config and fill in your wallet + bootnodes
cp config.example.json config.json

# Start mining
npm start
# or: node src/cli.js start
```

### Docker

```bash
docker run -v ~/.poh-miner:/root/.poh-miner ghcr.io/poh/miner:latest
```

---

## Configuration

Config file is loaded from the first location that exists (in order):

1. `POH_CONFIG` env var (full path)
2. `./.poh-miner/config.json`
3. `./config.json`
4. `~/.poh-miner/config.json`

Minimal example:

```json
{
  "bootnodes": ["https://bootnode.proofofhuman.ge"],
  "inferenceMode": "auto",
  "model": "qwen2.5:1.5b",
  "walletApiPort": 3456
}
```

The miner creates a PoH wallet automatically on first run and stores it in `~/.poh-miner/wallets/`. To use an existing wallet, set `pohWallet` to its PoH address.

| Field | Default | Description |
|---|---|---|
| `pohWallet` | auto-created | PoH address that earns rewards (created on first run if not set) |
| `bootnodes` | production bootnode | Peer discovery + chain sync entry points |
| `inferenceMode` | `auto` | `cpu` / `gpu` / `auto` |
| `model` | `qwen2.5:1.5b` | Ollama model used by the brain |
| `ollamaUrl` | `http://localhost:11434` | Ollama API base URL |
| `walletApiPort` | `3456` | Port for the local API server |
| `computeEnabled` | `true` | Set `false` to run as relay-only |
| `region` | `auto` | Geographic region tag for job routing |
| `autoStart` | `true` | Start mining immediately on launch |

RPC endpoints can be configured per-chain under the `rpc` key — see `config.example.json`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                   App Layer  (proofofhuman.ge)                   │
│   Frontend  ·  Profiles  ·  Voting  ·  Feedback        │
└───────────────────────────┬──────────────────────────────────────┘
                            │  submits scan jobs  ▼  reads results
┌───────────────────────────▼──────────────────────────────────────┐
│                    PoH Miner Network  (this repo)                │
│                                                                  │
│   ┌──────────────┐  P2P gossip (blocks, txs, status)            │
│   │  Miner Node  │◄────────────────────────────►  Miner Node   │
│   │              │                                              │
│   │ • PoW mining │  ← race to compute first valid verdict →    │
│   │ • LLM brain  │                                              │
│   │ • Skills     │  ← publish/run on-demand agent logic →      │
│   │ • P2P market │  ← peer-to-peer POH/fiat exchange →         │
│   │ • Chain sync │  ← bootnode for peer discovery / catch-up → │
│   │ • Wallet API │                                              │
│   └──────────────┘                                              │
│                                                                  │
│   IPFS durability layer (chain snapshots, brain state, peers)   │
└──────────────────────────────────────────────────────────────────┘
```

### Block Contents

Each block contains:

- `height`, `previousHash`, `timestamp`, `minerWallet`
- `scanResults[]` — verified wallet verdicts (requestId, address, verdict, confidence, reasoning, signalsUsed, minerWallet, signature)
- `transactions[]` — signed POH token transfers with nonces
- `coinbaseReward` — 1 POH per block: 60% to proposer, 40% split among workers
- `nonce`, `difficulty`, `chainWork` — PoW fields (cumulative)
- `minerSignature`, `minerSigningPublicKey` — ed25519 block authentication

---

## What Syncs Between Nodes

| Data | How |
|---|---|
| New blocks | P2P gossip `new-block` (flood-fill, TTL=4) |
| Pending transactions | P2P gossip `new-tx` |
| Node status (methodsHash, region, load) | P2P gossip `node-status` |
| Chain history (cold start) | HTTP pull from bootnode `/chain/blocks` |
| Verified signals (canonical set + hash) | HTTP from proofofhuman.ge + IPFS fallback |
| Brain feedback events | Peer-to-peer push + bootnode `/brain/events` |
| Signal weight updates | Same as brain feedback |
| Peer records (host:port) | Bootnode `/peers` + IPFS peer directory |
| IPFS CIDs (chain, brain, peers) | Bootnode `/ipfs/latest` + `/ipfs/update` |

---

## Blockchain Properties

| Property | Implementation |
|---|---|
| **Consensus** | Longest-chain (heaviest chainWork) |
| **PoW** | SHA-256, target N leading zeros, auto-adjusts to 30 s/block |
| **Fork resolution** | Orphan pool + chainWork comparison; reorg with journal rollback |
| **Transactions** | Account model with nonces (replay protection) + ed25519 signatures |
| **Double-spend** | Pending balance lock in mempool + nonce validation at application |
| **Block signatures** | Proposer signs block hash with ed25519 identity key |
| **Result signatures** | Every scan result signed by computing miner |

---

## Wallet API (port 3456 by default)

Every miner exposes an HTTP API for the mobile wallet and external tools. Amounts are in **μPOH** (1 POH = 1 000 000 000 μPOH).

### Chain & Wallet

| Endpoint | Description |
|---|---|
| `GET /status` | Node status, chain height, reputation |
| `GET /api/miner/info` | Detailed miner info (version, uptime, peers) |
| `GET /api/wallet/balance?address=<addr>` | Balance in μPOH |
| `GET /api/wallet/nonce?address=<addr>` | Current nonce for transaction signing |
| `GET /api/wallet/transactions?address=<addr>` | Transaction history |
| `GET /api/wallet/history?address=<addr>` | Full history with block confirmations |
| `POST /api/wallet/send` | Transfer POH (`{from, to, amount, privateKey}`) |
| `POST /api/wallet/register-key` | Register an ed25519 signing key for an address |
| `POST /api/tx/submit` | Submit a pre-signed `PoHTransaction` |
| `GET /api/tx/pending` | Inspect mempool |

### Jobs (scan requests)

| Endpoint | Description |
|---|---|
| `POST /job` | Submit a scan job, returns `{jobId, statusUrl, resultUrl}` |
| `GET /job/:id/status` | Poll: `queued / computing / done / error` |
| `GET /job/:id/result` | Full verdict + profile + evidence when done |
| `GET /jobs` | List active jobs |
| `POST /gossip` | Receive P2P gossip envelopes from peers |

### Skills

Skills are on-demand agent modules that extend what miners can compute. Builtin skills include `poh_identity`, `read_farcaster`, `read_zora`, `read_paragraph`, and `code_audit`.

| Endpoint | Description |
|---|---|
| `GET /api/skills` | List available skills with context summaries |
| `GET /api/skills/prefs` | Skill staking preferences for an address |
| `POST /api/skills/propose` | Propose a new skill `{manifest, code, private}` |

### Chat & Skill Routing

| Endpoint | Description |
|---|---|
| `POST /chat/route` | Route a message to the best matching skill `{message, budget, wallet}` |
| `POST /chat/ask` | Full AI reply — routes to a skill or falls back to free chat `{message, wallet}` |

### LLM & Brain

| Endpoint | Description |
|---|---|
| `POST /api/chat` | Streaming chat with local Ollama (proxied) |
| `POST /api/generate` | Ollama generate (proxied) |
| `GET /api/models` | List models available on this node's Ollama |
| `GET /api/brain/state` | Current weights count, feedback count, model info |
| `GET /api/brain/weights` | Full `weights.json` |
| `POST /api/brain/feedback` | Submit human correction `{address, aiVerdict, correction, comment, signals}` |
| `POST /api/brain/vote` | Submit signal weight vote `{method, voteType, vote, stakeWeight}` |
| `POST /api/brain/sync/event` | Receive brain event pushed by a peer |

### P2P Exchange

Peer-to-peer POH trading with on-chain escrow. Orders are matched locally; escrow is settled on the PoH chain.

| Endpoint | Description |
|---|---|
| `GET /api/p2p/currencies` | List supported quote currencies |
| `GET /api/p2p/orders` | Open order book (filters: `side`, `quoteCurrency`) |
| `GET /api/p2p/orders/my?address=<addr>` | Orders created by this address |
| `GET /api/p2p/orders/:id` | Single order detail |
| `POST /api/p2p/orders` | Create a new order `{side, baseCurrency, quoteCurrency, amount, price, address}` |
| `POST /api/p2p/orders/:id/cancel` | Cancel an open order |
| `POST /api/p2p/orders/:id/select` | Taker selects an order to trade |
| `GET /api/p2p/trades/my?address=<addr>` | Active and past trades for an address |
| `GET /api/p2p/trades/:id` | Single trade detail |
| `POST /api/p2p/trades/:id/:action` | Advance trade state (`confirm`, `release`, `dispute`) |
| `POST /api/p2p/local-auth` | Sign a P2P auth payload with the node's local wallet |

### Push Notifications

| Endpoint | Description |
|---|---|
| `POST /api/push/register` | Register an Expo push token `{address, token}` |
| `POST /api/push/send` | Send a push notification to a registered address |
| `GET /api/push/tokens` | List registered tokens (admin) |

---

## IPFS Durability Layer

Miners automatically pin data to IPFS and share CIDs via the bootnode.

| What | When | CID shared as |
|---|---|---|
| Chain snapshot (last 500 blocks) | Every 100 blocks | `chain` |
| Brain state (weights + pools) | After every feedback/vote + every 30 min | `brain` |
| Own peer record (host:port signed) | After every bootnode registration | `selfPeer` |
| Peer directory (all known peers) | Bootnode pins every 60 s after changes | `peers` |

CIDs are cached locally in `~/.poh-miner/ipfs_cid_cache.json`. If the bootnode is unreachable at startup, the node uses cached CIDs to discover peers from IPFS directly.

Configure a pinning service via env vars:

```bash
IPFS_API_URL=https://api.pinata.cloud/pinning/pinFileToIPFS
IPFS_API_KEY=yourPinataJWT
```

Without configuration, the node uses a local Kubo daemon if one is running.

---

## Bootnode Endpoints

```
GET  /chain/tip
GET  /chain/blocks?from=0&to=100
POST /submit-block
POST /register          (signed peer registration)
GET  /peers             (verified peer list with host:port)
POST /brain/events      (receive signed brain events)
GET  /brain/events?since=<ts>
GET  /brain/stats
GET  /ipfs/latest       (latest chain, brain, peers CIDs)
POST /ipfs/update       (miners push new CIDs)
```

Running your own bootnode:

```bash
node src/bootnode.js --port 8080 --data-dir ~/.poh-bootnode
```

---

## Running Tests

```bash
npm test                  # unit tests (vitest)
npm run test:watch        # watch mode
npm run test:integration  # end-to-end (requires dev/ checker)
```

Tests cover: P2P gossip, block/result signatures, chainWork fork resolution, transactions + nonces, double-spend protection, PoW mining + abort, balance journal rollback, and job deduplication.

---

## Building

```bash
npm run build:bin              # standalone binaries (pkg)
npm run build:deb              # .deb package (requires fpm)
npm run build:electron         # Electron desktop app (current platform)
npm run build:electron:linux   # Linux: AppImage + .deb (x64 + arm64)
npm run build:electron:win     # Windows: NSIS installer + portable
npm run build:electron:mac     # macOS: .dmg (x64 + arm64)
npm run build:electron:all     # all platforms
```

The `.deb` postinst script installs Ollama and pulls `qwen2.5:1.5b` automatically on first install.

---

## Project Layout

```
src/
  core/           block.js, scanRequest.js, transaction.js
  consensus/      pow.js, chain-selection.js
  network/        p2p-gossip.js
  signals/        methods-manager.js (canonical signal set sync)
  compute/        poh-adapter.js → delegates to dev/src checker + brain
  brain/          brain-sync.js (network-wide brain state sync)
  storage/        chain-store.js, balance-journal.js, ipfs-store.js,
                  ipfs-sync.js, dataset-sync.js
  wallet/         wallet.js (ed25519 keys, nonces, balances)
  rewards/        reward.js (1 POH/block, 60/40 split)
  jobs/           job-queue.js, geo.js, gas-estimator.js
  validation/     result-validator.js
  rpc/            resolver.js, networks.js
  p2p/            order-store.js, escrow.js  ← P2P exchange
  skills/
    manager.js       skill lifecycle (install, stake, run)
    loader.js        load builtin + user skills at startup
    sandbox/         skill-runner.js (sandboxed execution)
    builtin/         poh_identity.md, read_farcaster.md, read_zora.md,
                     read_paragraph.md, code_audit.md
  miner-node.js   main orchestrator
  bootnode.js     peer discovery + chain relay + IPFS registry
  cli.js

electron/         GUI desktop app (Electron 31)
  renderer/
    index.html    main UI (Dashboard, Logs, Chat, P2P tabs)
    renderer.js   frontend logic
    i18n.js       internationalization strings
  main.cjs        IPC + Ollama auto-install + window management
  preload.js      context bridge

landing/          Promotional landing page + binary downloads
  binaries/       poh-miner-linux-x64.deb / .AppImage / windows-x64.exe

test/             vitest unit tests
scripts/          build and dev helper scripts
```
