# PoH Miner Network — Proof of Human Compute Layer

**This is the new base layer.**

## 🚀 Getting Started as a Miner (Production Flow)

### 1. One-time Setup

```bash
cd Desktop/poh/poh-miner-network
npm install
```

### 2. Create or use a wallet

The node will automatically create a wallet on first run if none is configured.

To manage wallets manually:

```bash
poh-miner wallet create          # creates a new wallet
poh-miner wallet list
poh-miner wallet balance <addr>
```

### 3. Configure bootnodes (important for real network use)

After cloning the repo, the easiest way is to use a **local config** next to the code:

```bash
cd poh-miner-network
cp config.example.json config.json
# or: cp config.example.json .poh-miner/config.json
```

Then edit `config.json` (or `.poh-miner/config.json`) and add your bootnodes + wallet:

```json
{
  "wallet": "your-solana-address-here",
  "bootnodes": [
    "http://your-bootnode-ip:8080",
    "http://backup-bootnode-ip:8080"
  ],
  "inferenceMode": "auto",
  "solanaRpc": "https://api.mainnet-beta.solana.com"
}
```

**Config file locations (in order of precedence):**

1. `POH_CONFIG` env var (full path)
2. `./.poh-miner/config.json` (local)
3. `./config.json` (project root — recommended after `git clone`)
4. `~/.poh-miner/config.json` (global, for installed use)

`poh-miner init` will create the most appropriate location automatically (local when inside the source tree).

### 4. Start the miner

```bash
poh-miner start
```

The node will:
- Use the nearest config it finds (local `config.json` or `.poh-miner/config.json` is preferred after cloning)
- Auto-create a wallet if needed
- Sync the chain from your bootnodes (if any are configured)
- Start participating in the network (job racing + block production)

### Running a Bootnode (for operators)

```bash
node src/bootnode.js --port 8080 --data-dir ~/.poh-bootnode
```

Then tell other miners to use your IP in their `bootnodes` list.

---

**This is the new base layer.**

The original POH application (signals, checker, profiles, voting, conviction curves, frontend) becomes the **"App Layer"** that runs **on top of** this decentralized Proof-of-Work network operated by Bitcoin miners (and other hardware operators).

## Core Idea

- **Miners and compute operators** run this software on companion hardware (Raspberry Pi, mini-PC, Mac Mini, gaming PC, VPS, etc.).
- They are rewarded in **POH tokens** for two things:
  1. Producing blocks (via useful compute + lightweight PoW).
  2. Being the **first** to correctly compute and deliver a scan/verdict/profile result when requested (first-come-first-serve).
- Every miner syncs the same chain (blocks contain state transitions, verified verdicts, new methods, weight updates, etc.).
- On a user scan request (from the existing POH frontend or direct API), the request is broadcast to the miner network.
- All participating miners race to run the existing POH software (`checker` + `brain.analyzeHumanness` + signal evaluation) and return the result.
- The first valid, correctly formatted response wins the fee + block reward share.

This turns expensive, always-on mining hardware + electricity into a **decentralized, economically aligned inference + verification compute network** for Proof of Humanity.

## Why This Makes Sense

- Operators with reliable always-on hardware and cheap electricity have natural advantages.
- LLM inference + complex signal evaluation is "useful work".
- First-come-first-serve + cryptographic verification creates a natural market for fast, correct answers.
- Existing POH logic (all the signal types, the brain, profiles, etc.) becomes the workload instead of being re-written.

## Accessibility: Designed to Run on *Any* Device

**Goal**: Anyone with spare compute should be able to participate — not just Bitcoin miners.

Examples of target users:
- Operator with reliable hardware (Raspberry Pi 5, mini-PC, Mac Mini, gaming PC, VPS, etc.)
- Person who bought a **Mac Mini** (M1/M2/M3/M4) for local AI work
- Someone with an old gaming PC or server sitting idle
- Tech-savvy user on Windows or Linux

See **[README-EASY-INSTALL.md](./README-EASY-INSTALL.md)** for the current easiest way to get running.

### Current Ease of Installation

| Platform       | Method                              | Difficulty |
|----------------|-------------------------------------|------------|
| macOS / Linux  | `curl ... \| bash` (easy-start.sh)  | Very Easy  |
| Windows        | PowerShell installer                | Easy       |
| Any device     | Docker                              | Easy       |

We are actively working toward native installers and single binaries.

**Mac Mini users** are a first-class target. The system is optimized for Apple Silicon.

## Geographic & Latency-Aware Job Routing

Not all compute is equal when it comes to user experience.

- A scan request coming from a user in **Georgia** (country) should prefer miners with low ping to Georgia.
- A user in Singapore should not have to wait for a slow response from a node in Europe.

### How it will work

1. **Job Mempool / Global Job Queue**
   - Scan requests enter a shared "mempool" (broadcast across the PoH miner network).
   - Jobs are not immediately assigned — miners can see pending jobs.

2. **Miner Self-Reporting**
   - Every miner periodically reports:
     - Approximate region (or coordinates)
     - Measured ping/latency to a set of global anchor points (or to major cities)
     - Current load / queue depth

3. **Smart Job Selection (First-Come-First-Serve with preference)**
   - When a new job appears, miners can decide whether to compete based on:
     - Their estimated latency to the requester
     - Job fee size
     - Their current load
   - Low-latency miners have a natural advantage (they can start computing earlier and submit faster).

4. **Implementation options** (we will start simple):
   - Early versions: Optional `preferred_region` or `max_latency_ms` on the job.
   - Later: Fully decentralized scoring where each miner calculates a "suitability score" = `fee / (latency + compute_time_estimate)`.

This creates a natural, market-driven geographic distribution of compute without central assignment.

## How to Start the Project

### Easiest way (recommended)

The preferred distribution method is **IPFS** (decentralized).

#### Option 1: Script (curl)
```bash
# Mac / Linux
curl -fsSL https://ipfs.io/ipfs/<LATEST_CID>/scripts/easy-start.sh | bash
```

#### Option 2: Pre-built Packages (Double-click to start)
We publish ready-made binaries and packages to IPFS:

- `.deb` (Debian/Ubuntu) — install with double-click or `dpkg -i`
- `.AppImage` (Universal Linux) — just make executable and run
- Standalone binaries for macOS and Windows

See the latest binary CID in `ipfs/binaries.txt`.

**Build commands:**
```bash
npm run build:bin     # Create standalone executables
npm run build:deb     # Create .deb package
npm run build:all
```

Then run `./scripts/publish-to-ipfs.sh` to publish everything (scripts + binaries) and update the CID files.

End users can download the latest binary directly with:
```bash
./scripts/download-latest.sh --install
```

You can switch between GPU and CPU mode at any time:

```bash
poh-miner set-mode cpu     # Force CPU (great for VPS)
poh-miner set-mode gpu     # Force GPU
poh-miner set-mode auto    # Let Ollama decide
```

### Other useful commands

```bash
npm run demo          # Run geographic job preference demo
npm run serve:landing # View the promotional landing page at http://localhost:4321
npm run easy          # One-command installer for new machines
```

### Quick start for developers

```bash
npm install
npm start
```

### Running Automated Tests

```bash
npm test                    # Run unit tests
npm run test:watch          # Watch mode for unit tests
npm run test:integration    # Run heavy integration tests (requires real POH dev/ checker)
```

See [test/README.md](./test/README.md) for details, including how to run full end-to-end tests with the real checker and brain.

See `start.js` for the main entry point.

---

**Current Status**

Core racing, block production, and geographic job preference are working and demonstrated.

**New promotional landing page** (matching proofofhuman.ge style):  
→ [landing/index.html](./landing/index.html)

See also:
- [README-EASY-INSTALL.md](./README-EASY-INSTALL.md)
- [README-JOB-SYSTEM.md](./README-JOB-SYSTEM.md)

Next priorities:
1. Production-grade easy install experience (binaries + one-click)
2. Real P2P job broadcasting + persistent mempool
3. Full integration with the existing POH checker + AI brain as the workload

See `docs/reward-mechanics-design.md` for current thinking on native token production, quantum resistance, and Tendermint-based consensus.

## Architecture Overview (Target)

```
┌─────────────────────────────────────────────────────────────┐
│                    App Layer (existing POH)                 │
│  Frontend, Profiles, Voting, Conviction Curves, Listing...  │
└───────────────────────────────┬─────────────────────────────┘
                                │ talks to
┌───────────────────────────────▼─────────────────────────────┐
│              PoH Miner Network (this repo)                  │
│                                                             │
│  • Block production (PoW + useful compute)                  │
│  • On-demand scan/verdict racing (first valid response)     │
│  • State sync across all miner nodes                        │
│  • POH token issuance + distribution to compute providers   │
│                                                             │
│  Miners run:                                                │
│  - Existing POH checker + brain (as compute workload)       │
│  - Lightweight chain client                                 │
│  - Optional future: hardware attestation for reputation     │
└─────────────────────────────────────────────────────────────┘
```

## Block Contents (High Level)

Each block contains:
- Previous block hash + height
- Timestamp
- List of **executed scan requests** (with winning miner's signature + result hash)
- State transitions (new methods, weight updates, profile changes, brain state deltas)
- Miner rewards distribution
- Optional future: hardware attestation data in blocks
- Small PoW nonce / difficulty target (to prevent spam / enable classic Sybil resistance)

## Verified Signals Synchronization

All miners on the network **must** evaluate verdicts using the exact same set of signals.

- On startup and periodically, the miner fetches the latest verified signals from `https://proofofhuman.ge/methods/verifyer`.
- The list is cached in `~/.poh-miner/methods.json`.
- Every `ScanResult` now includes the `methodsHash` that was used.
- Future: New methods will be published as on-chain state transitions so the network converges without relying on the HTTP endpoint.

You can force a refresh anytime with:

```bash
poh-miner sync-methods
```

## Current Status

This is the **initial scaffolding** for the PoH Miner Network.

We are building the miner node software that:
- Can be run on a wide variety of always-on hardware (Raspberry Pi, mini-PC, Mac Mini, gaming PC, VPS, servers)
- Re-uses the existing POH `checker` and `brain` code as the actual computation engine
- Participates in block production and request racing

See `TODO.md` for the immediate roadmap.

## Running as a Miner (Future)

The long-term target is one-command installers + binaries (see the "Easiest way (recommended)" section above and the installers in `installers/`).

For now, the practical way after cloning is:

```bash
cd poh-miner-network
cp config.example.json config.json   # or use .poh-miner/config.json
# Edit wallet + bootnodes + RPCs
npm start
```

---

**This is the foundation.** The existing POH dev/ folder becomes the "application logic" that these miners execute as their Proof of Work.

---

**This is the foundation.** The existing POH dev/ folder becomes the "application logic" that these miners execute as their Proof of Work.
