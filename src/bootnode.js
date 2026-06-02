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

const argv = process.argv.slice(2);
const PORT = parseInt(argv.find(a => a.startsWith('--port='))?.split('=')[1] || '8080');
const DATA_DIR = argv.find(a => a.startsWith('--data-dir='))?.split('=')[1] || path.join(process.env.HOME || '.', '.poh-bootnode');

const chainStore = new ChainStore(DATA_DIR);
let chain = chainStore.loadChain().map(b => PohBlock.fromJSON ? PohBlock.fromJSON(b) : new PohBlock(b));

// Peer registry for node discovery
let peers = new Map(); // wallet -> peerInfo

const PEER_TTL_MS = 10 * 60 * 1000; // 10 minutes

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
    timestamp: Date.now(),
    minerWallet: 'bootnode-genesis',
    difficulty: 4,
  });
  chain.push(genesis);
  chainStore.saveChain(chain);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

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

          const peer = {
            wallet: peerInfo.wallet,
            host: peerInfo.host,
            walletApiPort: peerInfo.walletApiPort || 3456,
            p2pPort: peerInfo.p2pPort || null,
            region: peerInfo.region || null,
            lastSeen: Date.now(),
          };

          peers.set(peer.wallet, peer);
          console.log(`[Bootnode] Registered peer: ${peer.wallet} @ ${peer.host}:${peer.walletApiPort}`);
          res.statusCode = 200;
          res.end(JSON.stringify({ registered: true, peersKnown: peers.size }));
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
  console.log(`   POST /register          (miners announce themselves)`);
  console.log(`   GET  /peers             (list of known active miners)`);
});
