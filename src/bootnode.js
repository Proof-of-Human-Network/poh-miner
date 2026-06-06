#!/usr/bin/env node
/**
 * PoH Miner Network - Bootnode
 *
 * Production-ready bootnode that:
 * - Accepts incoming blocks from miners
 * - Serves the chain to other nodes for syncing
 * - Acts as a stable peer for discovery
 *
 * Run with: node src/bootnode.js --port 8080 --data-dir ~/.poh-bootnode
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { PohBlock } from './core/block.js';
import { ChainStore } from './storage/chain-store.js';
import { Wallet } from './wallet/wallet.js';
import { IPFSStore } from './storage/ipfs-store.js';

const ipfsStore = new IPFSStore();

const argv = process.argv.slice(2);
const PORT = parseInt(argv.find(a => a.startsWith('--port='))?.split('=')[1] || '8080');
const DATA_DIR = argv.find(a => a.startsWith('--data-dir='))?.split('=')[1] || path.join(process.env.HOME || '.', '.poh-bootnode');

const chainStore = new ChainStore(DATA_DIR);
let chain = chainStore.loadChain().map(b => PohBlock.fromJSON ? PohBlock.fromJSON(b) : new PohBlock(b));

// Peer registry for node discovery
let peers = new Map(); // wallet -> peerInfo

const PEER_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Brain event store ──────────────────────────────────────────────────────────
// Accumulates signed brain events (feedback, weight updates) from all miners.
// Miners pull events they haven't seen yet via GET /brain/events?since=<ts>.
const BRAIN_EVENTS_FILE = path.join(DATA_DIR, 'brain_events.json');
const MAX_BRAIN_EVENTS = 10000; // rolling window

let brainEvents = []; // { type, data, ts, minerWallet, eventHash, signature? }
let brainEventHashes = new Set();

function loadBrainEvents() {
  try {
    if (fs.existsSync(BRAIN_EVENTS_FILE)) {
      brainEvents = JSON.parse(fs.readFileSync(BRAIN_EVENTS_FILE, 'utf8'));
      brainEvents.forEach(e => brainEventHashes.add(e.eventHash));
      console.log(`[Bootnode] Loaded ${brainEvents.length} brain events`);
    }
  } catch { brainEvents = []; }
}

function saveBrainEvents() {
  try {
    fs.writeFileSync(BRAIN_EVENTS_FILE, JSON.stringify(brainEvents));
  } catch { /* non-fatal */ }
}

loadBrainEvents();

// ── IPFS CID registry ──────────────────────────────────────────────────────
// Miners push their latest pinned CIDs here; other miners and the wallet app
// pull them as a bootstrap / fallback source when the P2P network is sparse.
const IPFS_REGISTRY_FILE = path.join(DATA_DIR, 'ipfs_registry.json');

let ipfsRegistry = {
  chain: null,  // { cid, height, minerWallet, ts }
  brain: null,  // { cid, minerWallet, ts }
  history: [],  // last 20 entries for redundancy
};

function loadIPFSRegistry() {
  try {
    if (fs.existsSync(IPFS_REGISTRY_FILE))
      ipfsRegistry = JSON.parse(fs.readFileSync(IPFS_REGISTRY_FILE, 'utf8'));
  } catch { /* start fresh */ }
}

function saveIPFSRegistry() {
  try { fs.writeFileSync(IPFS_REGISTRY_FILE, JSON.stringify(ipfsRegistry, null, 2)); }
  catch { /* non-fatal */ }
}

loadIPFSRegistry();

// Debounced peer-directory pinner — fires at most once every 60 s to avoid
// hammering IPFS on rapid peer registrations.
let _pinDebounce = null;
function schedulePeerDirectoryPin() {
  if (_pinDebounce) return;
  _pinDebounce = setTimeout(async () => {
    _pinDebounce = null;
    try {
      pruneStalePeers();
      const peerList = Array.from(peers.values()).map(p => ({
        wallet:        p.wallet,
        host:          p.host,
        walletApiPort: p.walletApiPort,
        p2pPort:       p.p2pPort || null,
        region:        p.region  || null,
        verified:      !!p.signingPublicKey,
        methodsHash:   p.methodsHash || null,
        ts:            p.lastSeen,
      }));
      const directory = { peers: peerList, count: peerList.length, updatedAt: Date.now() };
      const cid = await ipfsStore.add(directory, 'peer-directory.json');
      if (!cid) return;
      ipfsRegistry.peers = { cid, count: peerList.length, ts: Date.now() };
      ipfsRegistry.history = [...(ipfsRegistry.history || []), { type: 'peers', cid, ts: Date.now() }].slice(-20);
      saveIPFSRegistry();
      console.log(`[Bootnode] Peer directory pinned to IPFS: ${cid.slice(0, 20)}… (${peerList.length} peers)`);
    } catch (e) {
      console.warn('[Bootnode] Peer directory IPFS pin failed:', e.message);
    }
  }, 60_000);
}

function pruneStalePeers() {
  const now = Date.now();
  let removed = 0;
  for (const [wallet, peer] of peers.entries()) {
    if (now - peer.lastSeen > PEER_TTL_MS) {
      peers.delete(wallet);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[Bootnode] Pruned ${removed} stale peers`);
  }
}

// Periodically prune
setInterval(pruneStalePeers, 2 * 60 * 1000);

if (chain.length === 0) {
  const genesis = new PohBlock({
    height: 0,
    previousHash: '0'.repeat(64),
    timestamp: 1780700000000,
    minerWallet: 'bootnode-genesis',
    difficulty: 4,
  });
  chain.push(genesis);
  chainStore.saveChain(chain);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS support (for frontend calls to /peers, /chain/* etc. from different origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json');

  try {
    if (url.pathname === '/chain/tip') {
      const tip = chain[chain.length - 1];
      res.end(JSON.stringify({
        height: tip.height,
        hash: await tip.getHash(),
        timestamp: tip.timestamp,
      }));
      return;
    }

    if (url.pathname === '/chain/blocks') {
      const from = parseInt(url.searchParams.get('from') || '0');
      const to = parseInt(url.searchParams.get('to') || chain.length - 1);

      const blocks = chain
        .filter(b => b.height >= from && b.height <= to)
        .map(b => b.toJSON ? b.toJSON() : b);

      res.end(JSON.stringify(blocks));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/submit-block') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const blockData = JSON.parse(body);
          const block = PohBlock.fromJSON ? PohBlock.fromJSON(blockData) : new PohBlock(blockData);

          // Reject blocks with invalid proposer signatures
          if (block.minerSignature && !block.verifySignature()) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: 'invalid block signature' }));
          }

          const tip = chain[chain.length - 1];
          const tipHash = await tip.getHash();

          if (block.height === chain.length && block.previousHash === tipHash) {
            chain.push(block);
            chainStore.saveChain(chain);
            console.log(`[Bootnode] Accepted block #${block.height} from miner`);
            res.statusCode = 200;
            res.end(JSON.stringify({ accepted: true }));
          } else {
            res.statusCode = 400;
            res.end(JSON.stringify({ accepted: false, reason: 'Invalid height or previous hash' }));
          }
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // === Node Discovery Endpoints ===
    // Protected: requires proof that requester is a real poh-miner-network node
    // (possesses the local wallet signing private key created by the miner software).
    if (req.method === 'POST' && url.pathname === '/register') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const peerInfo = JSON.parse(body);
          if (!peerInfo.wallet || !peerInfo.host) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'wallet and host are required' }));
            return;
          }

          const ts = peerInfo.timestamp || 0;
          const now = Date.now();
          if (!ts || Math.abs(now - ts) > 5 * 60 * 1000) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'timestamp required and must be within 5 minutes (replay protection)' }));
            return;
          }

          // Require signature proof for valid node
          if (!peerInfo.signature || !peerInfo.signingPublicKey) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'signature and signingPublicKey required (run a real poh-miner-network node to register)' }));
            return;
          }

          const msg = JSON.stringify({
            wallet: peerInfo.wallet,
            host: peerInfo.host,
            timestamp: ts,
            methodsHash: peerInfo.methodsHash || '',
          });
          const ok = Wallet.verifySignature(peerInfo.signingPublicKey, msg, peerInfo.signature);
          if (!ok) {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: 'invalid signature - proof of valid poh-miner node failed' }));
            return;
          }

          const peer = {
            wallet: peerInfo.wallet,
            host: peerInfo.host,
            walletApiPort: peerInfo.walletApiPort || 3456,
            p2pPort: peerInfo.p2pPort || null,
            region: peerInfo.region || null,
            lastSeen: Date.now(),
            signingPublicKey: peerInfo.signingPublicKey,
            methodsHash: peerInfo.methodsHash || null,
            registeredAt: ts,
          };

          peers.set(peer.wallet, peer);
          console.log(`[Bootnode] Registered VERIFIED peer: ${peer.wallet} @ ${peer.host}:${peer.walletApiPort} (methods=${peer.methodsHash?.slice(0,8)||'?'})`);
          schedulePeerDirectoryPin(); // debounced — pins updated directory to IPFS
          res.statusCode = 200;
          res.end(JSON.stringify({ registered: true, peersKnown: peers.size, verified: true, peersCid: ipfsRegistry.peers?.cid || null }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ── Brain event accumulation ──────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/brain/events') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const event = JSON.parse(body);
          if (!event.eventHash || !event.type || !event.data) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: 'eventHash, type, data required' }));
          }
          if (brainEventHashes.has(event.eventHash)) {
            return res.end(JSON.stringify({ ok: true, duplicate: true }));
          }
          brainEvents.push({ ...event, receivedAt: Date.now() });
          brainEventHashes.add(event.eventHash);
          // Rolling window
          if (brainEvents.length > MAX_BRAIN_EVENTS) {
            const trimmed = brainEvents.slice(-MAX_BRAIN_EVENTS);
            brainEventHashes = new Set(trimmed.map(e => e.eventHash));
            brainEvents = trimmed;
          }
          saveBrainEvents();
          res.end(JSON.stringify({ ok: true, total: brainEvents.length }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (url.pathname === '/brain/events') {
      const since = parseInt(url.searchParams.get('since') || '0');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '500'), 2000);
      const events = brainEvents.filter(e => (e.ts || 0) > since).slice(-limit);
      res.end(JSON.stringify({ events, count: events.length, total: brainEvents.length }));
      return;
    }

    if (url.pathname === '/brain/stats') {
      res.end(JSON.stringify({
        totalEvents: brainEvents.length,
        feedbackCount: brainEvents.filter(e => e.type === 'feedback').length,
        weightUpdates: brainEvents.filter(e => e.type === 'weight_update').length,
        oldestTs: brainEvents[0]?.ts || null,
        newestTs: brainEvents[brainEvents.length - 1]?.ts || null,
      }));
      return;
    }

    // ── IPFS CID registry ─────────────────────────────────────────────────────
    if (url.pathname === '/ipfs/latest') {
      res.end(JSON.stringify({
        chain:     ipfsRegistry.chain  || null,
        brain:     ipfsRegistry.brain  || null,
        peers:     ipfsRegistry.peers  || null,
        history:   (ipfsRegistry.history || []).slice(-5),
        updatedAt: ipfsRegistry.chain?.ts || ipfsRegistry.brain?.ts || ipfsRegistry.peers?.ts || null,
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ipfs/update') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const ts = data.ts || Date.now();

          for (const [type, cid] of [['chain', data.chain], ['brain', data.brain], ['selfPeer', data.selfPeer]]) {
            if (!cid) continue;
            const entry = { cid, minerWallet: data.minerWallet, ts };
            if (!ipfsRegistry[type] || ts > (ipfsRegistry[type].ts || 0)) {
              ipfsRegistry[type] = entry;
            }
            ipfsRegistry.history = [...(ipfsRegistry.history || []), { type, ...entry }].slice(-20);
          }
          saveIPFSRegistry();
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (url.pathname === '/peers') {
      pruneStalePeers(); // ensure fresh list
      const peerList = Array.from(peers.values()).map(p => ({
        wallet: p.wallet,
        host: p.host,
        walletApiPort: p.walletApiPort,
        p2pPort: p.p2pPort,
        region: p.region,
        lastSeen: p.lastSeen,
        // verification info (frontends / other nodes can use to pick trusted nodes)
        verified: !!p.signingPublicKey,
        signingPublicKey: p.signingPublicKey || null,
        methodsHash: p.methodsHash || null,
        registeredAt: p.registeredAt || p.lastSeen,
      }));
      res.end(JSON.stringify({ peers: peerList, count: peerList.length }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 PoH Bootnode running on port ${PORT}`);
  console.log(`   Data dir: ${DATA_DIR}`);
  console.log(`   Current chain height: ${chain.length - 1}`);
  console.log(`\nEndpoints:`);
  console.log(`   GET  /chain/tip`);
  console.log(`   GET  /chain/blocks?from=0&to=100`);
  console.log(`   POST /submit-block`);
  console.log(`   POST /register          (miners announce themselves - requires valid node signature proof)`);
  console.log(`   GET  /peers             (list of known active *verified* miners + their walletApiPort for direct connect)`);
  console.log(`   POST /brain/events      (miners push signed brain events — feedback, weight updates)`);
  console.log(`   GET  /brain/events?since=<ts>  (miners pull brain events since timestamp)`);
  console.log(`   GET  /brain/stats       (brain event accumulator stats)`);
  console.log(`   GET  /ipfs/latest       (latest pinned chain + brain CIDs)`);
  console.log(`   POST /ipfs/update       (miners push new IPFS CIDs)`);
});
