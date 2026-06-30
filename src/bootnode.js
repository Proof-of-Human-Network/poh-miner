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
import { validateBlockExtended } from './consensus/block-validator.js';
import { replayChainLedger } from './consensus/tx-ledger.js';
import { computeChainWork } from './consensus/chain-selection.js';
import { verifyBrainEvent, verifyIpfsUpdate } from './security/bootnode-auth.js';
import { applyBootnodeCors } from './security/api-security.js';
import { Wallet } from './wallet/wallet.js';
import { IPFSStore } from './storage/ipfs-store.js';

const ipfsStore = new IPFSStore();

const argv = process.argv.slice(2);
const PORT = parseInt(argv.find(a => a.startsWith('--port='))?.split('=')[1] || '8080');
const DATA_DIR = argv.find(a => a.startsWith('--data-dir='))?.split('=')[1] || path.join(process.env.HOME || '.', '.poh-bootnode');
const PEER_SYNC_URL = argv.find(a => a.startsWith('--peer='))?.split('=').slice(1).join('=') || null;

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

// ── Network history (nodes + tflops over time) — tiered storage ──────────
// minutely: last 24 h at 1-min resolution  (1 440 points max)
// hourly:   last 30 d at 1-h  resolution  (  720 points max)
// daily:    all-time  at 1-d  resolution  (  unbounded, ~1/day)
const NETWORK_HISTORY_FILE = path.join(DATA_DIR, 'network_history.json');

let nhMinutely = []; // { t, nodes, tflops }
let nhHourly   = [];
let nhDaily    = [];

function loadNetworkHistory() {
  try {
    if (!fs.existsSync(NETWORK_HISTORY_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(NETWORK_HISTORY_FILE, 'utf8'));
    if (Array.isArray(raw)) {
      // Migrate legacy flat array → minutely tier
      nhMinutely = raw.slice(-1440);
    } else {
      nhMinutely = raw.minutely || [];
      nhHourly   = raw.hourly   || [];
      nhDaily    = raw.daily    || [];
    }
  } catch { nhMinutely = []; nhHourly = []; nhDaily = []; }
}

function saveNetworkHistory() {
  try { fs.writeFileSync(NETWORK_HISTORY_FILE, JSON.stringify({ minutely: nhMinutely, hourly: nhHourly, daily: nhDaily })); } catch {}
}

function avgBucket(pts) {
  if (!pts.length) return null;
  return {
    t:      pts[0].t,
    nodes:  Math.round(pts.reduce((s, p) => s + p.nodes, 0) / pts.length),
    tflops: Math.round(pts.reduce((s, p) => s + p.tflops, 0) / pts.length * 10) / 10,
  };
}

function snapshotNetwork() {
  pruneStalePeers();
  const peerList = Array.from(peers.values());
  const now    = Date.now();
  const nodes  = peerList.length;
  const tflops = Math.round(peerList.reduce((s, p) => s + (p.tflops || 0), 0) * 10) / 10;
  const entry  = { t: now, nodes, tflops };

  // Minutely (last 24 h)
  nhMinutely.push(entry);
  if (nhMinutely.length > 1440) nhMinutely.shift();

  // Hourly rollup: when the hour turns, average the previous hour's minutely points
  const prevHour = Math.floor(now / 3_600_000) - 1;
  if (!nhHourly.length || Math.floor(nhHourly[nhHourly.length - 1].t / 3_600_000) < prevHour) {
    const pts = nhMinutely.filter(p => Math.floor(p.t / 3_600_000) === prevHour);
    const avg = avgBucket(pts);
    if (avg) { avg.t = prevHour * 3_600_000; nhHourly.push(avg); }
    if (nhHourly.length > 720) nhHourly.shift();
  }

  // Daily rollup: when the UTC day turns, average the previous day's minutely points
  const prevDay = Math.floor(now / 86_400_000) - 1;
  if (!nhDaily.length || Math.floor(nhDaily[nhDaily.length - 1].t / 86_400_000) < prevDay) {
    const pts = nhMinutely.filter(p => Math.floor(p.t / 86_400_000) === prevDay);
    const avg = avgBucket(pts);
    if (avg) { avg.t = prevDay * 86_400_000; nhDaily.push(avg); }
  }

  saveNetworkHistory();
}

loadNetworkHistory();
setInterval(snapshotNetwork, 60_000); // snapshot every minute

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
    chainWork: computeChainWork('0', 4),
  });
  chain.push(genesis);
  chainStore.saveChain(chain);
}

let txLedger = replayChainLedger(chain);

function refreshTxLedger() {
  txLedger = replayChainLedger(chain);
}

async function syncFromPeer(peerUrl) {
  try {
    const tipRes = await fetch(`${peerUrl}/chain/tip`, { signal: AbortSignal.timeout(10000) });
    if (!tipRes.ok) throw new Error(`tip fetch failed: ${tipRes.status}`);
    const tip = await tipRes.json();
    const peerHeight = tip.height ?? tip.block?.height ?? 0;
    if (peerHeight <= chain.length - 1) {
      console.log(`[Bootnode] Peer at height ${peerHeight}, we have ${chain.length - 1} — nothing to sync`);
      return;
    }
    console.log(`[Bootnode] Syncing chain from ${peerUrl} (peer height ${peerHeight}, local ${chain.length - 1})…`);
    const BATCH = 200;
    let from = chain.length;
    while (from <= peerHeight) {
      const to = Math.min(from + BATCH - 1, peerHeight);
      const r = await fetch(`${peerUrl}/chain/blocks?from=${from}&to=${to}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`blocks fetch failed: ${r.status}`);
      const blocks = await r.json();
      if (!Array.isArray(blocks) || blocks.length === 0) break;
      for (const b of blocks) {
        const block = PohBlock.fromJSON ? PohBlock.fromJSON(b) : new PohBlock(b);
        const parent = chain[chain.length - 1];
        const check = validateBlockExtended(block, {
          parent, chainPrefix: chain, ledger: txLedger, strictTx: false,
        });
        if (!check.valid) {
          console.warn(`[Bootnode] Peer sync rejected block #${block.height} (${check.reason})`);
          break;
        }
        chain.push(block);
        txLedger.applyBlock(block, { strict: false });
      }
      from = to + 1;
    }
    chainStore.saveChain(chain);
    refreshTxLedger();
    console.log(`[Bootnode] Sync complete — chain height now ${chain.length - 1}`);
  } catch (e) {
    console.warn(`[Bootnode] Peer sync failed: ${e.message}`);
  }
}

if (PEER_SYNC_URL) {
  syncFromPeer(PEER_SYNC_URL);
  setInterval(() => syncFromPeer(PEER_SYNC_URL), 30_000);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  applyBootnodeCors(req, res);

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
        chainWork: tip.chainWork || '0',
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
          const payload = JSON.parse(body);
          // Accept either a single block or an array (batch catch-up)
          const blocks = Array.isArray(payload) ? payload : [payload];
          let accepted = 0;

          for (const blockData of blocks) {
            const block = PohBlock.fromJSON ? PohBlock.fromJSON(blockData) : new PohBlock(blockData);

            const tip = chain[chain.length - 1];
            const tipHash = tip.blockHash || await tip.getHash();

            if (block.height === tip.height + 1 && block.previousHash === tipHash) {
              const check = validateBlockExtended(block, {
                parent: tip, chainPrefix: chain, ledger: txLedger, strictTx: true,
              });
              if (!check.valid) {
                console.warn(`[Bootnode] Rejected block #${block.height} (${check.reason})`);
                break;
              }
              chain.push(block);
              txLedger.applyBlock(block, { strict: false });
              accepted++;
              console.log(`[Bootnode] Accepted block #${block.height} from miner`);
            } else if (block.height <= chain.length - 1) {
              // Already have this block — skip silently
            } else {
              // Gap or fork — stop processing this batch
              break;
            }
          }

          if (accepted > 0) chainStore.saveChain(chain);
          res.statusCode = 200;
          res.end(JSON.stringify({ accepted, height: chain.length - 1 }));
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
            tflops: typeof peerInfo.tflops === 'number' ? peerInfo.tflops : null,
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
          const auth = verifyBrainEvent(event);
          if (!auth.ok) {
            res.statusCode = 403;
            return res.end(JSON.stringify({ error: auth.error }));
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
          const auth = verifyIpfsUpdate(data);
          if (!auth.ok) {
            res.statusCode = 403;
            return res.end(JSON.stringify({ error: auth.error }));
          }
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
        verified: !!p.signingPublicKey,
        signingPublicKey: p.signingPublicKey || null,
        methodsHash: p.methodsHash || null,
        tflops: p.tflops || null,
        registeredAt: p.registeredAt || p.lastSeen,
      }));
      const totalTflops = peerList.reduce((s, p) => s + (p.tflops || 0), 0);
      res.end(JSON.stringify({ peers: peerList, count: peerList.length, totalTflops: Math.round(totalTflops * 10) / 10 }));
      return;
    }

    if (url.pathname === '/network/history') {
      // Return all three tiers so the client can auto-select granularity
      res.end(JSON.stringify({ minutely: nhMinutely, hourly: nhHourly, daily: nhDaily }));
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
