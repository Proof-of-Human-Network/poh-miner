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
import { blocksOnTipPath } from './consensus/chain-path.js';
import { FINALITY_DEPTH, signCheckpoint } from './consensus/finality.js';
import {
  verifyBrainEvent,
  verifyIpfsUpdate,
  verifyPeerRegistration,
  isPublicPeerHost,
  validatePeerPort,
  readLimitedBody,
  MAX_BODY_BYTES,
  MAX_CHAIN_BLOCKS_RANGE,
  MAX_SUBMIT_BLOCK_BATCH,
} from './security/bootnode-auth.js';
import { applyBootnodeCors } from './security/api-security.js';
import { envelopeSignPayload } from './network/p2p-gossip.js';
import { Wallet } from './wallet/wallet.js';
import { IPFSStore } from './storage/ipfs-store.js';
import { JobBoard } from './jobs/job-board.js';

const ipfsStore = new IPFSStore();

const argv = process.argv.slice(2);
const PORT = parseInt(argv.find(a => a.startsWith('--port='))?.split('=')[1] || '8080');
const BIND_HOST = argv.find(a => a.startsWith('--bind='))?.split('=')[1]
  || process.env.POH_BOOTNODE_BIND
  || '127.0.0.1';
const DATA_DIR = argv.find(a => a.startsWith('--data-dir='))?.split('=')[1] || path.join(process.env.HOME || '.', '.poh-bootnode');
const PEER_SYNC_URL = argv.find(a => a.startsWith('--peer='))?.split('=').slice(1).join('=') || null;
const ALLOW_LOCAL_HOSTS = argv.includes('--allow-local-hosts')
  || process.env.POH_BOOTNODE_ALLOW_LOCAL === '1';

const chainStore = new ChainStore(DATA_DIR);
let chain = chainStore.loadChain().map(b => PohBlock.fromJSON ? PohBlock.fromJSON(b) : new PohBlock(b));

// ── Finality checkpoint signer ──────────────────────────────────────────────
// A stable ed25519 identity the bootnode uses to sign its finalized tip. Miners
// pin its public key (config.checkpointPublicKey) and refuse any chain that
// contradicts a checkpoint it signs. Persisted so restarts keep the same key.
const CHECKPOINT_KEY_FILE = path.join(DATA_DIR, 'checkpoint-signer.json');
const checkpointSigner = (() => {
  try {
    const saved = JSON.parse(fs.readFileSync(CHECKPOINT_KEY_FILE, 'utf8'));
    return Wallet.fromJSON(saved);
  } catch {
    const w = Wallet.generate();
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CHECKPOINT_KEY_FILE, JSON.stringify(w.toJSON()), { mode: 0o600 });
    } catch (e) { console.warn('[Bootnode] Could not persist checkpoint signer key:', e.message); }
    return w;
  }
})();
console.log(`[Bootnode] Finality checkpoint signer address: ${checkpointSigner.address} ` +
  `(pin this as "checkpointPublicKey" in miner config)`);

// Caller's real public IP. Behind nginx the socket address is 127.0.0.1, so honor
// X-Real-IP ($remote_addr — set by nginx, not client-spoofable) first; fall back to
// the last X-Forwarded-For hop, then the socket. Used by /whoami + /probe so a node
// can learn its own address and self-test reachability (SSRF-guarded: probes only
// public IPs, the caller's own address, fixed /status path).
function callerIp(req) {
  let ip = (req.headers['x-real-ip'] || '').trim();
  if (!ip) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    ip = xff.length ? xff[xff.length - 1] : '';
  }
  if (!ip) ip = req.socket?.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7); // IPv4-mapped IPv6
  return ip;
}

// Peer registry for node discovery
let peers = new Map(); // wallet -> peerInfo

const PEER_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── NAT relay inboxes ────────────────────────────────────────────────────────
// A follower (reachable:false) can't be dialed, so gossip destined for it is
// queued here and drained via the follower's authenticated long-poll GET /inbox.
// In-memory + bounded + dropped when the follower goes stale, so it can never
// grow without bound (ephemeral, like the job board).
const inboxes = new Map(); // wallet -> { queue: [envelope], seen: Set<id> }
const MAX_INBOX = 500;     // per-follower cap; oldest dropped past this

/** Fan a gossip envelope into every eligible follower's inbox. Returns count queued. */
function enqueueForFollowers(envelope) {
  const path = new Set(envelope.path || []);
  let queued = 0;
  for (const [wallet, peer] of peers.entries()) {
    if (peer.reachable !== false) continue;             // only NAT'd followers use the relay
    if (wallet === envelope.from || path.has(wallet)) continue; // don't echo to origin/relayers
    let box = inboxes.get(wallet);
    if (!box) { box = { queue: [], seen: new Set() }; inboxes.set(wallet, box); }
    if (box.seen.has(envelope.id)) continue;            // dedupe per follower
    box.seen.add(envelope.id);
    box.queue.push(envelope);
    if (box.queue.length > MAX_INBOX) {
      const dropped = box.queue.shift();
      box.seen.delete(dropped.id);
    }
    queued++;
  }
  return queued;
}

// ── Brain event store ──────────────────────────────────────────────────────────
// Accumulates signed brain events (feedback, weight updates) from all miners.
// Miners pull events they haven't seen yet via GET /brain/events?since=<ts>.
const BRAIN_EVENTS_FILE = path.join(DATA_DIR, 'brain_events.json');
const MAX_BRAIN_EVENTS = 10000; // rolling window

// NAT-friendly pull-based compute job distribution (see job-board.js).
const jobBoard = new JobBoard();

/** Verify a signed board action. Returns { wallet } (canonical) or { error }. */
function verifyBoardAuth({ wallet, signingPublicKey, signature, timestamp }, action, extraFields = {}) {
  if (!signingPublicKey || !signature) return { error: 'missing auth fields' };
  const canonical = Wallet.deriveAddressFromSigningKey(signingPublicKey);
  if (!canonical) return { error: 'invalid signing public key' };
  if (Math.abs(Date.now() - (timestamp || 0)) > 5 * 60 * 1000) return { error: 'request expired' };
  const payload = JSON.stringify({ action, wallet: canonical, timestamp, ...extraFields });
  if (!Wallet.verifySignature(signingPublicKey, payload, signature)) {
    const alt = JSON.stringify({ action, wallet: wallet || canonical, timestamp, ...extraFields });
    if (!Wallet.verifySignature(signingPublicKey, alt, signature)) return { error: 'invalid signature' };
  }
  return { wallet: canonical };
}

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
    tflops: Math.round(pts.reduce((s, p) => s + p.tflops, 0) / pts.length * 1000) / 1000,
  };
}

function snapshotNetwork() {
  pruneStalePeers();
  const peerList = Array.from(peers.values());
  const now    = Date.now();
  const nodes  = peerList.length;
  const tflops = Math.round(peerList.reduce((s, p) => s + (p.tflops || 0), 0) * 1000) / 1000;
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
      const peerList = Array.from(peers.values())
        .filter(p => p.signingPublicKey && Wallet.isAddressBoundToSigningKey(p.wallet, p.signingPublicKey))
        .map(p => ({
        wallet:        p.wallet,
        host:          p.host,
        walletApiPort: p.walletApiPort,
        p2pPort:       p.p2pPort || null,
        region:        p.region  || null,
        verified:      true,
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
      inboxes.delete(wallet); // drop the follower's relay inbox with it
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
    // Local height must come from the tip block's own height, not the array
    // length: the chain array may be a windowed tail (chain[0].height > 0),
    // in which case chain.length - 1 is NOT the block height.
    const localHeight = chain.length ? (chain[chain.length - 1].height ?? chain.length - 1) : -1;
    if (peerHeight <= localHeight) {
      console.log(`[Bootnode] Peer at height ${peerHeight}, we have ${localHeight} — nothing to sync`);
      return;
    }
    console.log(`[Bootnode] Syncing chain from ${peerUrl} (peer height ${peerHeight}, local ${localHeight})…`);
    const BATCH = 200;
    let from = localHeight + 1;
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
    console.log(`[Bootnode] Sync complete — chain height now ${chain[chain.length - 1]?.height ?? chain.length - 1}`);
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
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      res.end(JSON.stringify({ status: 'ok', service: 'poh-bootnode', height: chain[chain.length - 1]?.height ?? chain.length - 1 }));
      return;
    }

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

    // Signed finality checkpoint: the block FINALITY_DEPTH below the tip, signed by
    // the bootnode's checkpoint key. Miners pin the key and refuse any chain that
    // rewrites at/below this height. Deep double-spend protection anchored to the
    // trusted bootnode.
    if (url.pathname === '/checkpoint') {
      const tipHeight = chain[chain.length - 1]?.height ?? (chain.length - 1);
      if (tipHeight < 0) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'no chain' })); }
      const cpHeight = Math.max(0, tipHeight - FINALITY_DEPTH);
      const cpBlock = chain.find(b => (b.height ?? -1) === cpHeight) ?? chain[chain.length - 1];
      const cpHash = cpBlock.blockHash || await cpBlock.getHash();
      res.end(JSON.stringify(signCheckpoint(checkpointSigner, { height: cpBlock.height, hash: cpHash })));
      return;
    }

    // Tell a caller its observed public IP (for zero-config public-host detection).
    if (url.pathname === '/whoami') {
      res.end(JSON.stringify({ ip: callerIp(req) }));
      return;
    }

    // Reachability self-test: dial the caller's own IP:port /status and report
    // whether it answers. Lets a node decide if it can be a public peer or must
    // stay a follower — without advertising an unreachable (NAT'd) address.
    if (url.pathname === '/probe') {
      const ip = callerIp(req);
      const port = parseInt(url.searchParams.get('port') || '3456', 10);
      if (!isPublicPeerHost(ip) || !validatePeerPort(port)) {
        return res.end(JSON.stringify({ reachable: false, ip, port, reason: 'non-public host or invalid port' }));
      }
      let reachable = false;
      try {
        const r = await fetch(`http://${ip}:${port}/status`, { signal: AbortSignal.timeout(3000) });
        reachable = r.ok;
      } catch { reachable = false; }
      res.end(JSON.stringify({ reachable, ip, port }));
      return;
    }

    // ── Pull-based compute job board (NAT-friendly job distribution) ────────────
    if (url.pathname === '/jobboard/stats') {
      res.end(JSON.stringify(jobBoard.stats()));
      return;
    }

    // Submit a compute job to the board. Open to clients (same as gossiping a job).
    if (req.method === 'POST' && url.pathname === '/jobboard/submit') {
      const raw = await readLimitedBody(req, MAX_BODY_BYTES);
      const job = JSON.parse(raw || 'null');
      const r = jobBoard.submit(job);
      if (r.error) { res.statusCode = 400; return res.end(JSON.stringify(r)); }
      return res.end(JSON.stringify(r));
    }

    // Poll for claimable jobs.
    if (req.method === 'GET' && url.pathname === '/jobboard/open') {
      const limit  = Math.min(50, parseInt(url.searchParams.get('limit') || '10', 10));
      const region = url.searchParams.get('region') || null;
      return res.end(JSON.stringify({ jobs: jobBoard.listOpen({ limit, region }) }));
    }

    // Claim a job (signed). Only a real wallet can claim so results are attributable.
    if (req.method === 'POST' && url.pathname === '/jobboard/claim') {
      const body = JSON.parse((await readLimitedBody(req, MAX_BODY_BYTES)) || '{}');
      const { jobId } = body;
      if (!jobId) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'jobId required' })); }
      const auth = verifyBoardAuth(body, 'claim-job', { jobId });
      if (auth.error) { res.statusCode = 401; return res.end(JSON.stringify(auth)); }
      const r = jobBoard.claim(jobId, auth.wallet);
      if (r.error) { res.statusCode = 409; return res.end(JSON.stringify(r)); }
      return res.end(JSON.stringify(r));
    }

    // Post a result for a claimed job (signed by the claimer).
    if (req.method === 'POST' && url.pathname === '/jobboard/result') {
      const body = JSON.parse((await readLimitedBody(req, MAX_BODY_BYTES)) || '{}');
      const { jobId, result } = body;
      if (!jobId || result == null) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'jobId and result required' })); }
      const auth = verifyBoardAuth(body, 'job-result', { jobId });
      if (auth.error) { res.statusCode = 401; return res.end(JSON.stringify(auth)); }
      const r = jobBoard.postResult(jobId, auth.wallet, result);
      if (r.error) { res.statusCode = 409; return res.end(JSON.stringify(r)); }
      return res.end(JSON.stringify(r));
    }

    // Block proposers pull completed results to include in a block and reward the
    // worker. Handing them out leases them (re-offered if not confirmed included).
    if (req.method === 'GET' && url.pathname === '/jobboard/pending-results') {
      const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10));
      return res.end(JSON.stringify({ results: jobBoard.takePendingResults(limit) }));
    }

    // A proposer confirms it included these results in a mined block.
    if (req.method === 'POST' && url.pathname === '/jobboard/mark-included') {
      const body = JSON.parse((await readLimitedBody(req, MAX_BODY_BYTES)) || '{}');
      jobBoard.markResultsIncluded(Array.isArray(body.jobIds) ? body.jobIds : []);
      return res.end(JSON.stringify({ ok: true }));
    }

    // Poll a job's status/result (for the original submitter).
    if (req.method === 'GET' && url.pathname === '/jobboard/status') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'jobId required' })); }
      const s = jobBoard.get(jobId);
      if (!s) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'job not found' })); }
      return res.end(JSON.stringify(s));
    }

    if (url.pathname === '/chain/blocks') {
      const from = parseInt(url.searchParams.get('from') || '0', 10);
      let to = parseInt(url.searchParams.get('to') || String(chain[chain.length - 1]?.height ?? chain.length - 1), 10);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid from/to range' }));
        return;
      }
      if (to - from + 1 > MAX_CHAIN_BLOCKS_RANGE) {
        to = from + MAX_CHAIN_BLOCKS_RANGE - 1;
      }

      const blocks = blocksOnTipPath(chain, from, to)
        .map(b => b.toJSON ? b.toJSON() : b);

      res.end(JSON.stringify(blocks));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/submit-block') {
      try {
        const raw = await readLimitedBody(req, MAX_BODY_BYTES);
        const payload = JSON.parse(raw || 'null');
        const blocks = Array.isArray(payload) ? payload : [payload];
        if (blocks.length > MAX_SUBMIT_BLOCK_BATCH) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: `batch exceeds ${MAX_SUBMIT_BLOCK_BATCH} blocks` }));
          return;
        }
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
            chainStore.saveBlock(block); // O(1) append; never rewrite the full ndjson on the hot path
            txLedger.applyBlock(block, { strict: false });
            accepted++;
            console.log(`[Bootnode] Accepted block #${block.height} from miner`);
          } else if (block.height <= tip.height) {
            // Already have this block — skip silently
          } else {
            break;
          }
        }

        res.statusCode = 200;
        res.end(JSON.stringify({ accepted, height: chain[chain.length - 1]?.height ?? chain.length - 1 }));
      } catch (e) {
        if (e.code === 'BODY_TOO_LARGE') {
          res.statusCode = 413;
          res.end(JSON.stringify({ error: 'request body too large' }));
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // === Node Discovery Endpoints ===
    if (req.method === 'POST' && url.pathname === '/register') {
      try {
        const raw = await readLimitedBody(req, 64 * 1024);
        const peerInfo = JSON.parse(raw || '{}');
        const auth = verifyPeerRegistration(peerInfo, { allowLocalHosts: ALLOW_LOCAL_HOSTS });
        if (!auth.ok) {
          res.statusCode = auth.error.includes('signature') ? 403 : 400;
          res.end(JSON.stringify({ error: auth.error }));
          return;
        }

        const peer = {
          wallet: peerInfo.wallet,
          host: peerInfo.host,
          walletApiPort: auth.walletApiPort,
          p2pPort: auth.p2pPort,
          region: peerInfo.region || null,
          lastSeen: Date.now(),
          signingPublicKey: peerInfo.signingPublicKey,
          methodsHash: peerInfo.methodsHash || null,
          tflops: typeof peerInfo.tflops === 'number' ? peerInfo.tflops : null,
          reachable: auth.reachable !== false, // followers (NAT'd) are reached via /inbox relay
          registeredAt: auth.ts,
        };

        peers.set(peer.wallet, peer);
        const kind = peer.reachable ? 'peer' : 'follower (relay)';
        console.log(`[Bootnode] Registered VERIFIED ${kind}: ${peer.wallet} @ ${peer.host}:${peer.walletApiPort} (methods=${peer.methodsHash?.slice(0,8)||'?'})`);
        schedulePeerDirectoryPin();
        res.statusCode = 200;
        res.end(JSON.stringify({ registered: true, peersKnown: peers.size, verified: true, peersCid: ipfsRegistry.peers?.cid || null }));
      } catch (e) {
        if (e.code === 'BODY_TOO_LARGE') {
          res.statusCode = 413;
          res.end(JSON.stringify({ error: 'request body too large' }));
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── Brain event accumulation ──────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/brain/events') {
      try {
        const raw = await readLimitedBody(req, 512 * 1024);
        const event = JSON.parse(raw || '{}');
        if (!event.eventHash || !event.type || !event.data) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'eventHash, type, data required' }));
          return;
        }
        const auth = verifyBrainEvent(event);
        if (!auth.ok) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: auth.error }));
          return;
        }
        if (brainEventHashes.has(event.eventHash)) {
          res.end(JSON.stringify({ ok: true, duplicate: true }));
          return;
        }
        brainEvents.push({ ...event, receivedAt: Date.now() });
        brainEventHashes.add(event.eventHash);
        if (brainEvents.length > MAX_BRAIN_EVENTS) {
          const trimmed = brainEvents.slice(-MAX_BRAIN_EVENTS);
          brainEventHashes = new Set(trimmed.map(e => e.eventHash));
          brainEvents = trimmed;
        }
        saveBrainEvents();
        res.end(JSON.stringify({ ok: true, total: brainEvents.length }));
      } catch (e) {
        if (e.code === 'BODY_TOO_LARGE') {
          res.statusCode = 413;
          res.end(JSON.stringify({ error: 'request body too large' }));
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
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
      try {
        const raw = await readLimitedBody(req, 64 * 1024);
        const data = JSON.parse(raw || '{}');
        const auth = verifyIpfsUpdate(data);
        if (!auth.ok) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: auth.error }));
          return;
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
        if (e.code === 'BODY_TOO_LARGE') {
          res.statusCode = 413;
          res.end(JSON.stringify({ error: 'request body too large' }));
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── NAT relay: reachable peers push gossip here; the bootnode fans it into
    // the inboxes of followers that can't be dialed directly. Verified so the
    // relay can't be spammed with junk followers would only reject anyway.
    if (req.method === 'POST' && url.pathname === '/gossip') {
      const raw = await readLimitedBody(req, 256 * 1024);
      let envelope;
      try { envelope = JSON.parse(raw || '{}'); }
      catch { res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid json' })); }
      if (!envelope?.id || !envelope?.topic) {
        res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid envelope' }));
      }
      if (!envelope.signature || !envelope.signingPublicKey
          || !Wallet.verifySignature(envelope.signingPublicKey, envelopeSignPayload(envelope), envelope.signature)) {
        res.statusCode = 403; return res.end(JSON.stringify({ error: 'invalid or missing signature' }));
      }
      const queued = enqueueForFollowers(envelope);
      res.end(JSON.stringify({ ok: true, queued }));
      return;
    }

    // ── NAT relay: a follower drains its queued gossip here. Authenticated with
    // the same signed-action scheme as the job board (action='inbox-poll'), so a
    // node can only read its own inbox. Polling also proves liveness.
    if (req.method === 'GET' && url.pathname === '/inbox') {
      const auth = verifyBoardAuth({
        wallet: url.searchParams.get('wallet'),
        signingPublicKey: url.searchParams.get('signingPublicKey'),
        signature: url.searchParams.get('signature'),
        timestamp: Number(url.searchParams.get('timestamp')),
      }, 'inbox-poll');
      if (auth.error) { res.statusCode = 403; return res.end(JSON.stringify({ error: auth.error })); }
      const peer = peers.get(auth.wallet);
      if (peer) peer.lastSeen = Date.now(); // a poll keeps the follower alive
      const box = inboxes.get(auth.wallet);
      const envelopes = box ? box.queue.splice(0, box.queue.length) : [];
      if (box) box.seen.clear();
      res.end(JSON.stringify({ envelopes }));
      return;
    }

    if (url.pathname === '/peers') {
      pruneStalePeers(); // ensure fresh list
      const verified = Array.from(peers.values())
        .filter(p => p.signingPublicKey && Wallet.isAddressBoundToSigningKey(p.wallet, p.signingPublicKey));
      // Only directly-dialable peers go in the peer list; followers participate
      // via the relay and must never be handed out as a dial target.
      const peerList = verified
        .filter(p => p.reachable !== false)
        .map(p => ({
        wallet: p.wallet,
        host: p.host,
        walletApiPort: p.walletApiPort,
        p2pPort: p.p2pPort,
        region: p.region,
        lastSeen: p.lastSeen,
        verified: true,
        reachable: true,
        signingPublicKey: p.signingPublicKey || null,
        methodsHash: p.methodsHash || null,
        tflops: p.tflops || null,
        registeredAt: p.registeredAt || p.lastSeen,
      }));
      const followerCount = verified.length - peerList.length;
      // Round to 3 decimals, not 1 — CPU-only nodes contribute sub-0.05 TFLOPS
      // each, which 1-decimal rounding collapses to 0 and hides the whole network.
      // Count follower compute too — they pull and process jobs like anyone else.
      const totalTflops = verified.reduce((s, p) => s + (p.tflops || 0), 0);
      res.end(JSON.stringify({ peers: peerList, count: peerList.length, followerCount, totalTflops: Math.round(totalTflops * 1000) / 1000 }));
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

server.listen(PORT, BIND_HOST, () => {
  console.log(`\n🚀 PoH Bootnode running on ${BIND_HOST}:${PORT}`);
  console.log(`   Data dir: ${DATA_DIR}`);
  console.log(`   Local hosts: ${ALLOW_LOCAL_HOSTS ? 'allowed' : 'rejected'}`);
  console.log(`   Current chain height: ${chain[chain.length - 1]?.height ?? chain.length - 1}`);
  console.log(`\nEndpoints:`);
  console.log(`   GET  /health`);
  console.log(`   GET  /chain/tip`);
  console.log(`   GET  /chain/blocks?from=0&to=100`);
  console.log(`   POST /submit-block`);
  console.log(`   POST /register          (miners announce themselves - requires valid node signature proof)`);
  console.log(`   GET  /peers             (list of known active *verified* dialable miners + their walletApiPort for direct connect)`);
  console.log(`   POST /gossip            (reachable peers relay gossip for NAT'd followers)`);
  console.log(`   GET  /inbox             (a follower drains its relayed gossip - signed, action=inbox-poll)`);
  console.log(`   POST /brain/events      (miners push signed brain events — feedback, weight updates)`);
  console.log(`   GET  /brain/events?since=<ts>  (miners pull brain events since timestamp)`);
  console.log(`   GET  /brain/stats       (brain event accumulator stats)`);
  console.log(`   GET  /ipfs/latest       (latest pinned chain + brain CIDs)`);
  console.log(`   POST /ipfs/update       (miners push new IPFS CIDs)`);
});
