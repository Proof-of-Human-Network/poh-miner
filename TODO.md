# PoH Miner Network - Immediate Implementation Roadmap

## Top Priorities (from latest feedback)

1. **Make it stupidly easy to install and run on ANY device**
   - Mac Mini (Apple Silicon) users are a first-class target
   - Windows users with old PCs / gaming rigs
   - One-click / one-command experience
   - Auto model download + best inference backend selection

2. **Job Queue + Mempool with geographic / ping awareness**
   - Requests should prefer low-latency miners
   - "Mempool of jobs" that miners can browse and intelligently select from
   - Latency self-measurement + scoring

## Current Progress (Parallel Work on Both Priorities)

**Easy Install Track:**
- [x] `scripts/easy-start.sh` — one-command setup for normal humans (Mac Mini friendly)
- [x] `src/cli.js` — simple `poh-miner` command
- [x] Updated package.json with proper `bin`
- [x] Documentation rewritten to target Mac Mini / non-miner users

**Geo + Job Queue Track:**
- [x] Full `JobQueue` with originRegion + latency scoring (Georgia miner gets ~3x score vs far miners)
- [x] `latency.js` helpers + automatic miner region detection on startup
- [x] Miner node now intelligently filters/competes on jobs using geo data
- [x] Working `demo-geo-race.js` proving the preference logic

**Next for Easy Install:**
- Pre-built binaries + real installers (.pkg for Mac, .exe for Windows)
- Auto model selection + progress bars during first setup
- Simple status UI (even a basic web dashboard on localhost: port would help)

**Next for Job System:**
- Broadcast new jobs over real gossip
- Allow jobs to declare `originRegion` or `requesterIp` for geo routing
- Persist job mempool across restarts

## Phase 1 (Now - Working Skeleton)
- [x] Core block + scan request/result types
- [x] Basic miner node that can race on requests
- [x] Lightweight PoW + block production
- [x] Simple gossip stub
- [ ] Real P2P networking (libp2p or simple WS mesh between miners)
- [ ] Actual integration: call real `checker` + `brain.analyzeHumanness` from the existing `dev/` codebase when a request arrives

## Phase 2 (Make it Real)
- [ ] Broadcast scan requests from the existing POH frontend / API into the miner network
- [ ] Verification of submitted results (multiple miners + majority, or fraud proofs)
- [ ] Proper reward claiming (on-chain or via the existing Solana staking contract)
- [ ] Optional hardware attestation + reputation scoring that affects reward weight
- [ ] Difficulty adjustment based on useful work, not just hash

## Key Open Questions to Decide
1. How do we verify a miner's result without every other miner re-running the entire (expensive) LLM + signal evaluation?
   - Options: 
     - Re-execution by a small committee
     - zkML / proof of inference (very hard right now)
     - Staking + slashing based on later human feedback (most POH-native)

2. What exactly is the "Proof of Work"?
   - Useful work only (verdicts)?
   - Useful work + small hash PoW?
   - (Future) Hardware attestation as an optional reputation boost?

3. Block time target? (15s? 1min? 10min like BTC?)

4. How does the "App Layer" (current POH) pay for computation? Direct fees in POH to the winning miner?

## Next Concrete Coding Tasks
1. Make `miner-node.js` actually import and call logic from `../dev/src/routes/checker.js` and `../dev/src/utils/brain.js`
2. Add WebSocket-based simple mesh networking
3. Create a small test harness that sends scan requests and sees miners race
