# PoH Miner Network — Roadmap

## Completed

### Core Blockchain
- [x] Real P2P gossip — HTTP flood-fill with TTL, deduplication, loop prevention
- [x] Block + result signatures — ed25519 identity keys, verified on receive
- [x] chainWork — cumulative difficulty, heaviest-chain fork resolution
- [x] Orphan pool — buffers out-of-order blocks, drains when parent arrives
- [x] Formal transactions — PoHTransaction with nonces, ed25519 sigs, fee priority
- [x] Double-spend protection — pending balance lock in mempool + nonce validation
- [x] Competitive PoW — all miners mine continuously, AbortSignal on new block, 30 s target
- [x] Reorg + balance journal — rollback wallet state and reward claims on chain switch

### Sync & Durability
- [x] Per-miner brain state — each miner has `~/.poh-miner/brain/` independent of dev/
- [x] Brain event sync — signed feedback/vote events gossiped to peers + accumulated at bootnode
- [x] IPFS chain snapshots — pinned every 100 blocks, used for cold-start bootstrap
- [x] IPFS brain state — pinned after every learning event + every 30 min
- [x] IPFS peer directory — bootnode pins host:port directory, miners cache for bootnode fallback
- [x] CID cache — persists across restarts so IPFS fallback works immediately

### Application
- [x] Job deduplication — `minedRequestIds` set prevents double-mining across competing nodes
- [x] Ollama auto-install — `.deb` postinst + Electron onboarding setup screen
- [x] LLM chat panel — streaming chatbot tab in the Electron app
- [x] qvac SDK migration — brain uses `@qvac/sdk` native `loadModel`/`completion`, no subprocess

### Wallet (poh-miner-wallet)
- [x] AI Screen — full PoH scanner with sanctions check, QR scan, profile view
- [x] Multi-node failover — connects to first available, retries all on failure
- [x] IPFS peer discovery — fetches peer directory when all configured nodes are offline
- [x] Signed transactions — formal PoHTransaction with nonce sent to node

## Next Priorities

### P2P (replace HTTP gossip with libp2p)
- [ ] Replace HTTP gossip with **libp2p + GossipSub** — no bootnode needed for block propagation
- [ ] DHT-based peer discovery (Kademlia) — remove single-point-of-failure bootnode

### Consensus
- [ ] Slot-based block production — replace probabilistic PoW with VRF-selected proposers
- [ ] Finality gadget — mark blocks irreversible after 2/3 validator confirmation

### Economic
- [ ] On-chain fee market — variable fees, miner tip, base fee burn
- [ ] Stake-weighted reputation — stake POH to increase reputation cap
- [ ] Method conviction curves — on-chain signal staking via Solana Meteora pools

### Developer Experience
- [ ] Published testnet — stable bootnode + faucet
- [ ] REST API docs (OpenAPI spec)
- [ ] Docker Compose for full local network (2 miners + bootnode + dev server)
