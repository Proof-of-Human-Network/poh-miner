#!/usr/bin/env node
/**
 * PoH Miner Node
 *
 * This is the main software that Bitcoin miners run on their companion hardware.
 *
 * Responsibilities:
 * - Sync the PoH chain
 * - Listen for ScanRequests broadcast on the network
 * - Use the EXISTING POH software (checker + brain) to compute verdicts
 * - Race to deliver the first correct result → earn POH
 * - Participate in block production (useful compute + PoW)
 */

import { ScanRequest, ScanResult } from './core/scanRequest.js';
import { PohBlock } from './core/block.js';
import { JobQueue } from './jobs/job-queue.js';
import { detectMyCountry, getCountryProximityMultiplier } from './jobs/geo.js';
import { getMethodsManager } from './signals/methods-manager.js';
import { SimpleGossip } from './network/gossip.js';
import { validateResultWork } from './validation/result-validator.js';
import { calculateBlockRewards, BLOCK_REWARD_POH } from './rewards/reward.js';
import fs from 'fs';
import path from 'path';
import { ChainStore } from './storage/chain-store.js';
import { WalletManager } from './wallet/wallet.js';
import { RewardClaimStore } from './storage/reward-claim-store.js';
import http from 'http';
import { resolveRpcConfig } from './rpc/resolver.js';

export class PohMinerNode {
  constructor(config) {
    // Resolve new friendly RPC format ("rpc" + providers) into legacy format
    const resolvedRpc = resolveRpcConfig(config);

    this.config = {
      wallet: config.wallet,
      ollamaUrl: config.ollamaUrl || 'http://localhost:11434',
      computeEnabled: config.computeEnabled !== false,
      inferenceMode: config.inferenceMode || 'auto',
      model: config.model || 'qwen2.5:1.5b',
      region: config.region || null,
      bootnodes: config.bootnodes || [],   // List of bootnode addresses for block sync
      rpcEndpoints: resolvedRpc.rpcEndpoints,
      solanaRpc: resolvedRpc.solanaRpc,
      // Keep raw new-style config for GUI / debugging
      rpc: config.rpc || {},
      rpcOverrides: config.rpcOverrides || {},
      ...config,
    };

    this.chain = [];
    this.peers = [];          // discovered miners from bootnodes
    this.knownPeers = [];     // alias for compatibility

    // Apply custom RPC endpoints from config into process.env so the loaded checker uses them
    this._applyRpcEndpoints();

    this.jobQueue = new JobQueue();
    this.myLatencyProfile = null; // populated on startup
    this.currentDifficulty = 4;
    this.gossip = new SimpleGossip(this.config.wallet || 'unknown-miner');
    this.chainStore = new ChainStore();
    this.walletManager = new WalletManager();
    this.rewardClaimStore = new RewardClaimStore();

    // Simple quality tracking + reputation for slashing
    this.qualityStats = {
      validSubmissions: 0,
      invalidSubmissions: 0,
      strikes: 0,                    // cumulative bad behavior count
    };
    this.reputation = 1.0; // 1.0 = perfect, goes down on bad submissions
    this.isTemporarilyRestricted = false;

    // Future: TEE attestation could further strengthen these guarantees
    // (see docs/tee-protection-architecture.md)

    // Queue of high-quality ScanResults ready to be included in the next block
    this.pendingValidResults = [];

    // Submission history for pattern detection and strike system (software protection)
    this.submissionHistory = [];

    // Load persisted quality/reputation + history if available
    this._loadQualityState();

    // Use dedicated PoH wallet if available (new onboarding flow)
    const pohWallet = this.config.pohWallet || this.config.wallet;

    if (!pohWallet) {
      const existing = this.walletManager.listWallets();
      if (existing.length === 0) {
        const newWallet = this.walletManager.createWallet();
        this.config.pohWallet = newWallet.address;
        this.config.wallet = newWallet.address; // backward compat
        console.log(`[PoH-Miner] First run — created PoH wallet: ${newWallet.address}`);
      } else {
        this.config.pohWallet = existing[0];
        this.config.wallet = existing[0];
      }
    } else {
      this.config.pohWallet = pohWallet;
      this.config.wallet = pohWallet; // keep both in sync for now
    }

    console.log(`[PoH-Miner] Starting node for wallet ${this.config.wallet}`);

    const mode = this.config.inferenceMode;
    const model = this.config.model;
    console.log(`[PoH-Miner] Inference mode: ${mode.toUpperCase()} | Model: ${model}`);

    // Run GPU detection asynchronously so it doesn't block startup
    this.detectGpuCapability().then(actualGpu => {
      if (mode === 'cpu') {
        console.log(`[PoH-Miner] → Running in CPU-only mode (good for VPS without GPU)`);
        if (actualGpu.available) {
          console.log(`[PoH-Miner] ⚠️  WARNING: A ${actualGpu.type} GPU was detected, but you are forcing CPU mode.`);
        }
      } else if (mode === 'gpu') {
        console.log(`[PoH-Miner] → GPU acceleration requested`);
        if (!actualGpu.available) {
          console.log(`[PoH-Miner] ⚠️  WARNING: No GPU detected. Ollama will fall back to CPU.`);
        } else {
          console.log(`[PoH-Miner] → Detected: ${actualGpu.type}`);
        }
      } else {
        console.log(`[PoH-Miner] → Auto mode: Ollama will use GPU if available`);
        if (actualGpu.available) {
          console.log(`[PoH-Miner] → Detected GPU: ${actualGpu.type}`);
        }
      }
    });
  }

  _applyRpcEndpoints() {
    const rpcs = this.config.rpcEndpoints || {};
    for (const [chainId, url] of Object.entries(rpcs)) {
      if (url && typeof url === 'string') {
        const envKey = `RPC_${chainId}`;
        process.env[envKey] = url;
        console.log(`[PoH-Miner] Custom RPC for chain ${chainId} → ${url}`);
      }
    }
    if (this.config.solanaRpc) {
      process.env.SOLANA_RPC = this.config.solanaRpc;
      console.log(`[PoH-Miner] Custom Solana RPC → ${this.config.solanaRpc}`);
    }

    // Etherscan (and Etherscan-family) API key — used by many signals
    if (this.config.etherscanApiKey) {
      process.env.ETHERSCAN_API_KEY = this.config.etherscanApiKey;
      console.log(`[PoH-Miner] Etherscan API key configured`);
    }

    // Also expose the new-style config for the GUI / external tools
    if (this.config.rpc && Object.keys(this.config.rpc).length > 0) {
      process.env.POH_RPC_CONFIG = JSON.stringify(this.config.rpc);
    }
  }

  async detectGpuCapability() {
    // Simple runtime detection (works on most systems)
    const { execSync } = await import('child_process');

    try {
      // NVIDIA
      execSync('nvidia-smi --query-gpu=name --format=csv,noheader', { stdio: 'ignore' });
      return { available: true, type: 'NVIDIA' };
    } catch {}

    // Apple Silicon (Metal)
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      return { available: true, type: 'Apple Silicon (Metal)' };
    }

    try {
      // AMD ROCm
      execSync('rocm-smi --showproductname', { stdio: 'ignore' });
      return { available: true, type: 'AMD ROCm' };
    } catch {}

    return { available: false, type: null };
  }

  /**
   * Ensures the miner has the minimum required RPC / API keys configured.
   * Without these, many signals in the real POH checker will fail or return poor data.
   */
  _validateRequiredApiKeys() {
    const solanaRpc = this.config.solanaRpc || process.env.SOLANA_RPC;
    const rpcEndpoints = this.config.rpcEndpoints || {};

    const hasSolana = !!solanaRpc;
    const hasAnyEvm = Object.keys(rpcEndpoints).length > 0;

    if (!hasSolana) {
      const msg =
        '❌ Missing required Solana RPC endpoint.\n\n' +
        'Many critical POH signals (especially those using Meteora conviction curves and Solana on-chain data) ' +
        'require a reliable Solana RPC.\n\n' +
        'Please set one of the following:\n' +
        '  • "solanaRpc" field in ~/.poh-miner/config.json\n' +
        '  • SOLANA_RPC environment variable\n\n' +
        'Example:\n' +
        '  "solanaRpc": "https://api.mainnet-beta.solana.com"\n' +
        '  or a paid RPC like Helius, QuickNode, etc. for better reliability.\n\n' +
        'You can disable this check by setting "requireRpcs": false in your config (not recommended).';

      throw new Error(msg);
    }

    if (!hasAnyEvm) {
      console.warn(
        '⚠️  No EVM RPC endpoints configured (rpcEndpoints).\n' +
        '   Signals that rely on Ethereum, Base, Arbitrum, etc. may fail or return incomplete data.\n' +
        '   It is strongly recommended to add at least one good RPC, for example:\n' +
        '     "rpcEndpoints": { "1": "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY" }\n'
      );
    }

    // Allow opting out (advanced users)
    if (this.config.requireRpcs === false) {
      console.warn('⚠️  RPC requirement validation is disabled (requireRpcs: false).');
      return;
    }
  }

  async start() {
    console.log('[PoH-Miner] Initializing...');

    // Validate that required API keys / RPCs are present before doing anything heavy.
    // Many signals in the real POH checker require paid or reliable RPC endpoints.
    this._validateRequiredApiKeys();

    // 1. Detect real geographic location using IP (for all countries)
    await this.detectLocation();

    // 2. Synchronize verified signals (CRITICAL - all miners must use the same set)
    console.log('[PoH-Miner] Synchronizing verified signals...');
    this.methodsManager = await getMethodsManager();
    const status = this.methodsManager.getStatus();
    console.log(`[PoH-Miner] Active signals: ${status.count} (hash=${status.hash}, source=${status.source})`);

    // 3. Bootstrap / sync the chain
    await this.syncChain();

    // 3. Connect to the P2P network
    await this.connectToNetwork();

    // 4. Start listening for jobs (now using the smart JobQueue)
    this.startJobListener();

    // 5. Start block production
    this.startBlockProduction();

    console.log('[PoH-Miner] Node is live and ready to compute.');
    console.log(`[PoH-Miner] Signals: ${this.methodsManager?.getStatus().hash} (${this.methodsManager?.getStatus().count} methods) | Region:`, this.myLatencyProfile?.region);
    console.log(`[PoH-Miner] Discovered peers: ${this.peers.length}`);

    // Start lightweight wallet API server so external apps (mobile wallet) can query balances & txs
    const apiPort = this.config.walletApiPort || 3456;
    this.startWalletApiServer(apiPort);

    // Periodic reputation recovery for good behavior (software protection)
    setInterval(() => this.decayReputation(), 10 * 60 * 1000); // every 10 minutes
  }

  /**
   * Starts a simple HTTP API for the mobile wallet / external tools.
   * Endpoints:
   *   GET /api/wallet/balance?address=xxx
   *   GET /api/wallet/transactions?address=xxx
   */
  startWalletApiServer(port = 3456) {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname === '/api/wallet/balance') {
        const address = url.searchParams.get('address');
        if (!address) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'address required' }));
        }
        const balance = this.walletManager.getBalance(address);
        return res.end(JSON.stringify({ address, balance }));
      }

      if (url.pathname === '/api/wallet/transactions') {
        const address = url.searchParams.get('address');
        const history = (this.submissionHistory || [])
          .filter(tx => {
            if (!address) return true;
            // Support both mining submissions (have .address) and send/transfer records (have from/to)
            if (tx.address === address) return true;
            if (tx.from === address || tx.to === address) return true;
            return false;
          })
          .slice(-50);

        return res.end(JSON.stringify({
          address,
          transactions: history
        }));
      }

      // Simple send endpoint (demo for wallet)
      if (req.method === 'POST' && url.pathname === '/api/wallet/send') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { from, to, amount } = JSON.parse(body);
            const amt = parseFloat(amount);

            if (!from || !to || !amt || amt <= 0) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'Invalid parameters' }));
            }

            const success = this.walletManager.transfer(from, to, amt);
            if (success) {
              // Record as transaction for history
              this.submissionHistory.push({
                id: 'tx-' + Date.now(),
                type: 'send',
                from,
                to,
                amount: amt,
                timestamp: Date.now(),
                status: 'confirmed'
              });
              this._saveQualityState(); // reuse the file for simplicity

              return res.end(JSON.stringify({ success: true, message: 'Transaction sent' }));
            } else {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'Insufficient balance or invalid sender' }));
            }
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    // Handle listen errors gracefully (prevents hard crash on EADDRINUSE etc.)
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[PoH-Miner] ❌ Wallet API port ${port} is already in use.`);
        console.error('   Another PoH Miner instance (Electron or CLI) is probably still running.');
        console.error('   Kill it or change walletApiPort in your config to use a different port.');
      } else {
        console.error('[PoH-Miner] Wallet API server error:', err.message);
      }
      this.walletApiServer = null;
    });

    server.listen(port, () => {
      console.log(`[PoH-Miner] Wallet API listening on http://localhost:${port}`);
      console.log(`   Try: curl "http://localhost:${port}/api/wallet/balance?address=${this.config.wallet}"`);
    });

    this.walletApiServer = server;
  }

  async detectLocation() {
    try {
      const location = await detectMyCountry();
      this.myLocation = location;

      console.log(`[PoH-Miner] Detected location: ${location.countryName || location.country} (${location.continent})`);
      console.log(`[PoH-Miner] → You will get strong preference on jobs from ${location.country}.`);
    } catch (e) {
      this.myLocation = { country: 'XX', countryName: 'Unknown', continent: 'Unknown' };
      console.warn('[PoH-Miner] Could not detect location. Using global scoring.');
    }
  }

  async syncChain() {
    console.log('[PoH-Miner] Syncing chain...');

    // 1. Load persisted chain from disk
    const persisted = this.chainStore.loadChain();
    if (persisted.length > 0) {
      this.chain = persisted.map(b => PohBlock.fromJSON ? PohBlock.fromJSON(b) : new PohBlock(b));
      console.log(`[PoH-Miner] Loaded ${this.chain.length} blocks from disk`);
    }

    // 2. If still empty, create genesis
    if (this.chain.length === 0) {
      const genesis = new PohBlock({
        height: 0,
        previousHash: '0'.repeat(64),
        timestamp: Date.now(),
        minerWallet: 'genesis',
        difficulty: this.currentDifficulty,
      });
      this.chain.push(genesis);
      this.chainStore.saveChain(this.chain);
    }

    // 3. Sync from bootnodes (production-ready path)
    if (this.config.bootnodes && this.config.bootnodes.length > 0) {
      await this.syncFromBootnodes();
    }

    console.log(`[PoH-Miner] Synced to height ${this.chain.length - 1}`);
  }

  async syncFromBootnodes() {
    console.log('[PoH-Miner] Attempting to sync from bootnodes...');

    for (const bootnode of this.config.bootnodes) {
      try {
        const url = bootnode.endsWith('/') ? bootnode : bootnode + '/';
        const tipRes = await fetch(`${url}chain/tip`);
        if (!tipRes.ok) continue;

        const tip = await tipRes.json();
        const localHeight = this.chain.length - 1;

        if (tip.height > localHeight) {
          console.log(`[PoH-Miner] Bootnode ${bootnode} is at height ${tip.height}, we are at ${localHeight}. Fetching blocks...`);

          const from = localHeight + 1;
          const to = tip.height;

          const blocksRes = await fetch(`${url}chain/blocks?from=${from}&to=${to}`);
          if (!blocksRes.ok) continue;

          const newBlocks = await blocksRes.json();

          for (const blockData of newBlocks) {
            const block = PohBlock.fromJSON ? PohBlock.fromJSON(blockData) : new PohBlock(blockData);
            // Basic validation before appending
            const prev = this.chain[this.chain.length - 1];
            const prevHash = await prev.getHash();
            if (block.previousHash === prevHash && block.height === this.chain.length) {
              this.chain.push(block);
            }
          }

          this.chainStore.saveChain(this.chain);
          console.log(`[PoH-Miner] Synced ${newBlocks.length} new blocks from ${bootnode}`);
          break; // success, stop trying other bootnodes
        }
      } catch (err) {
        console.warn(`[PoH-Miner] Failed to sync from bootnode ${bootnode}:`, err.message);
      }
    }
  }

  /**
   * Node Discovery: Register with bootnodes and fetch list of active peers.
   * This allows miners to discover each other without hardcoding IPs.
   */
  async discoverAndRegisterWithBootnodes() {
    if (!this.config.bootnodes || this.config.bootnodes.length === 0) return;

    const myInfo = {
      wallet: this.config.pohWallet || this.config.wallet,
      host: this._getPublicHost(),
      walletApiPort: this.config.walletApiPort || 3456,
      p2pPort: this.config.p2pPort || null,
      region: this.myLocation?.country || null,
    };

    console.log('[PoH-Miner] Registering with bootnodes for peer discovery...');

    for (const bootnode of this.config.bootnodes) {
      const base = bootnode.endsWith('/') ? bootnode : bootnode + '/';

      try {
        // Register ourselves
        await fetch(`${base}register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(myInfo),
        });

        // Fetch current peer list
        const res = await fetch(`${base}peers`);
        if (res.ok) {
          const data = await res.json();
          this.knownPeers = data.peers || [];

          // Filter out ourselves
          this.knownPeers = this.knownPeers.filter(p => p.wallet !== myInfo.wallet);

          console.log(`[PoH-Miner] Discovered ${this.knownPeers.length} peers from ${bootnode}`);

          if (this.knownPeers.length > 0) {
            console.log('[PoH-Miner] Known peers:');
            this.knownPeers.forEach(p => {
              console.log(`  - ${p.wallet?.slice(0,10)}... @ ${p.host}:${p.walletApiPort} (${p.region || 'unknown region'})`);
            });
          }
        }
      } catch (err) {
        console.warn(`[PoH-Miner] Failed peer discovery with ${bootnode}:`, err.message);
      }
    }

    // Store for later use (e.g. future direct gossip)
    this.peers = this.knownPeers || [];
  }

  _getPublicHost() {
    // In production this should be the externally reachable IP/hostname.
    // For now we use a reasonable default that works in most LAN + cloud setups.
    return process.env.POH_PUBLIC_HOST || 'localhost';
  }

  async connectToNetwork() {
    // Real version: libp2p, gossipsub, or simple WebSocket mesh between miners
    console.log('[PoH-Miner] Connecting to network...');

    if (this.config.bootnodes?.length > 0) {
      console.log(`[PoH-Miner] Configured with ${this.config.bootnodes.length} bootnode(s)`);

      // === Node Discovery via Bootnodes (NEW) ===
      await this.discoverAndRegisterWithBootnodes();
    } else {
      console.log('[PoH-Miner] No bootnodes configured — running in local/dev mode only');
    }

    // Subscribe to node status updates
    this.gossip.subscribe('node-status', (status, from) => {
      if (status.methodsHash && status.methodsHash !== this.methodsManager?.hash) {
        console.log(`[PoH-Miner] Peer ${from?.slice(0,8)} is on different signals hash: ${status.methodsHash} (we have ${this.methodsManager?.hash})`);
      }
    });

    // Subscribe to new blocks from the network
    this.gossip.subscribe('new-block', (blockData, from) => {
      this.handleIncomingBlock(blockData, from);
    });

    // Periodically broadcast our current signals status
    setInterval(() => {
      if (this.methodsManager) {
        const status = {
          wallet: this.config.wallet,
          methodsHash: this.methodsManager.hash,
          methodsCount: this.methodsManager.getActiveMethods().length,
          region: this.myLocation?.country,
          load: 0.25,
        };
        this.gossip.publish('node-status', status);
      }
    }, 45000);
  }

  /**
   * Handle a block received from the network (basic syncing logic)
   */
  async handleIncomingBlock(blockData, from) {
    try {
      const newBlock = PohBlock.fromJSON ? PohBlock.fromJSON(blockData) : new PohBlock(blockData);

      const currentHeight = this.chain.length - 1;
      if (newBlock.height === currentHeight + 1) {
        // Simple append if it's the next block
        const prevHash = await this.chain[currentHeight].getHash();
        if (newBlock.previousHash === prevHash) {
          this.chain.push(newBlock);
          console.log(`[PoH-Miner] Accepted block #${newBlock.height} from ${from?.slice(0,8)}`);

          // Credit any worker rewards this node earned in the received block
          this.processIncomingBlockRewards(newBlock);
        }
      } else if (newBlock.height > currentHeight + 1) {
        // We're behind - request sync from peers / bootnodes
        console.log(`[PoH-Miner] Detected we're behind (peer at ${newBlock.height}, we are at ${currentHeight}). Requesting sync...`);
        this.requestBlockSync(newBlock.height);
      }
    } catch (err) {
      console.warn(`[PoH-Miner] Failed to process incoming block from ${from}:`, err.message);
    }
  }

  /**
   * Request missing blocks from bootnodes (production path)
   */
  async requestBlockSync(targetHeight) {
    if (!this.config.bootnodes || this.config.bootnodes.length === 0) {
      console.log(`[PoH-Miner] [Sync] No bootnodes configured. Cannot catch up.`);
      return;
    }

    const currentHeight = this.chain.length - 1;
    console.log(`[PoH-Miner] [Sync] Requesting blocks ${currentHeight + 1} → ${targetHeight} from bootnodes...`);

    for (const bootnode of this.config.bootnodes) {
      try {
        const url = bootnode.endsWith('/') ? bootnode : bootnode + '/';
        const res = await fetch(`${url}chain/blocks?from=${currentHeight + 1}&to=${targetHeight}`);

        if (!res.ok) continue;

        const blocks = await res.json();
        let added = 0;

        for (const blockData of blocks) {
          const block = PohBlock.fromJSON ? PohBlock.fromJSON(blockData) : new PohBlock(blockData);
          const prev = this.chain[this.chain.length - 1];
          const prevHash = await prev.getHash();

          if (block.height === this.chain.length && block.previousHash === prevHash) {
            this.chain.push(block);
            added++;

            // Credit worker rewards this node earned in synced blocks
            this.processIncomingBlockRewards(block);
          }
        }

        if (added > 0) {
          this.chainStore.saveChain(this.chain);
          console.log(`[PoH-Miner] [Sync] Successfully synced ${added} blocks from ${bootnode}`);
          return;
        }
      } catch (err) {
        console.warn(`[PoH-Miner] [Sync] Failed to fetch from ${bootnode}:`, err.message);
      }
    }
  }

  /**
   * Credit this node for any worker rewards it earned in a received/synced block.
   * The proposer reward is only claimed by the node that actually produced the block.
   */
  processIncomingBlockRewards(block) {
    if (!block || !block.coinbaseReward || !this.config.wallet) return;

    const coinbase = block.coinbaseReward;

    if (!Array.isArray(coinbase.workerRewards)) return;

    coinbase.workerRewards.forEach(worker => {
      if (worker.workerId !== this.config.wallet) return;

      const claimKey = RewardClaimStore.makeClaimKey(block.height, worker.workProofHash);

      // Only credit if we haven't claimed this reward before (prevents double-crediting on re-sync)
      if (!this.rewardClaimStore.claimIfNotAlready(claimKey)) {
        return;
      }

      this.walletManager.credit(this.config.wallet, worker.amount);

      console.log(
        `[PoH-Miner] Credited ${worker.amount} POH (worker) from block #${block.height} to ${this.config.wallet}`
      );
    });
  }

  startJobListener() {
    console.log('[PoH-Miner] Listening for jobs (with geo awareness)...');

    // In real network: subscribe to gossip topic "new-jobs"
    this.onNewJob = (rawJob) => {
      const job = this.jobQueue.addJob(rawJob);

      const minerInfo = {
        country: this.myLocation?.country,
        currentLoad: 0.25,
        reputation: this.reputation,
      };

      const score = this.jobQueue.scoreJobForMiner(job, minerInfo);

      if (score > 0 && this.config.computeEnabled) {
        const geoNote = job.originCountry ? ` [from: ${job.originCountry}]` : '';
        console.log(`[PoH-Miner] New job ${job.id} (${job.type})${geoNote} → score: ${score}`);
        this.computeAndSubmitJob(job);
      } else {
        const reason = score === 0 ? 'different continent / low priority' : 'compute disabled';
        console.log(`[PoH-Miner] Ignoring job ${job.id} (${reason})`);
      }
    };
  }

  async computeAndSubmitJob(job) {
    const start = Date.now();

    try {
      console.log(`[PoH-Miner] Computing ${job.type} for job ${job.id} using real POH brain (geo-aware)`);

      // This now calls the real existing POH checker + brain when available
      const verdict = await computeVerdictWithExistingPoh(job, this.config);

      // Quick local validation that we used current signals
      if (verdict.methodsHash && !this._validateResultMethods(verdict)) {
        console.warn(`[PoH-Miner] Computed result used stale signals (hash=${verdict.methodsHash}). Re-syncing...`);
        await this.methodsManager?.sync();
      }

      // === NEW: Enforce proper inference work (protection against lazy/malicious miners) ===
      const workValidation = await validateResultWork(verdict, job);
      if (!workValidation.isValid) {
        console.warn(`[PoH-Miner] Rejecting own low-quality result for ${job.id}:`, workValidation.errors);
        // For now we still submit (for testing), but mark it
        verdict.lowQuality = true;
        verdict.validationErrors = workValidation.errors;
      } else {
        console.log(`[PoH-Miner] Work quality OK for ${job.id} (${workValidation.signalsEvaluated}/${workValidation.liveCount} signals)`);
      }

      const result = new ScanResult({
        requestId: job.id,
        address: job.payload?.address || 'unknown',
        verdict: verdict.verdict,
        confidence: verdict.confidence,
        reasoning: verdict.reasoning,
        signalsUsed: verdict.signalsUsed,
        modelUsed: verdict.modelUsed,
        computationTimeMs: Date.now() - start,
        minerWallet: this.config.wallet,
        methodsHash: verdict.methodsHash,
        methodsCount: verdict.methodsCount,
        realPohUsed: verdict.realPohUsed ?? false,
      });

      await this.submitResult(job, result);
      this.jobQueue.markCompleted(job.id);

    } catch (err) {
      console.error('[PoH-Miner] Job computation failed:', err.message);
    }
  }

  async submitResult(request, result) {
    // 1. Basic methods hash check (already existed)
    if (!this._validateResultMethods(result)) {
      console.warn(`[PoH-Miner] Rejecting result for ${request.id} — used stale methodsHash`);
      return;
    }

    // 2. Deep work quality validation (new protection against lazy/malicious miners)
    const workValidation = await validateResultWork(result, request);

    if (!workValidation.isValid) {
      console.warn(`[PoH-Miner] ⚠️  LOW QUALITY / MALICIOUS result for ${request.id}:`, workValidation.errors);
      result.isValidWork = false;
      result.validationErrors = workValidation.errors;

      this.qualityStats.invalidSubmissions++;

      // Record for history and strike detection
      this._recordSubmission(false, request.id, { ...workValidation, realPohUsed: result.realPohUsed });

      // Apply slashing / reputation penalty for malicious or lazy submissions
      this.applySlashing(0.15);
      return; // Do not propagate bad work
    }

    result.isValidWork = true;
    this.qualityStats.validSubmissions++;

    // Record successful submission
    this._recordSubmission(true, request.id, { ...workValidation, realPohUsed: result.realPohUsed });

    // Add to the queue for block inclusion (only valid work goes into blocks)
    this.pendingValidResults.push(result);

    this._saveQualityState();

    // In real network: broadcast the result + signature
    console.log(`[PoH-Miner] ✓ Submitting VALID result for ${request.id} (${workValidation.signalsEvaluated}/${workValidation.liveCount} signals) — queued for block`);

    // TODO: Sign the result with this miner's key
    // TODO: Gossip the result
    // TODO: If we are first and it gets accepted → we get paid + share in block reward
  }

  /**
   * Fault tolerance check: ensure the result was computed with the current signals set.
   */
  _validateResultMethods(result) {
    if (!this.methodsManager) return true; // during early bootstrap
    if (!result.methodsHash) return false;

    const currentHash = this.methodsManager.hash;

    // Allow simulation results in dev, but flag them
    if (result.methodsHash.startsWith('sim-')) {
      console.warn('[PoH-Miner] Result used simulation (no real signals). This will be rejected on mainnet.');
      return true; // still accept for local testing
    }

    return result.methodsHash === currentHash;
  }

  startBlockProduction() {
    // Miners produce blocks containing accepted scan results + state changes
    setInterval(async () => {
      // In reality only selected miners produce blocks in their slot
      if (Math.random() < 0.25) {
        console.log('[PoH-Miner] Attempting to produce block...');
        await this.proposeBlock();
      }
    }, 15000);
  }

  async proposeBlock() {
    const previous = this.chain[this.chain.length - 1];

    // === Fixed 1 POH per block + Strict Work Quality Filter ===
    // Only results that passed validateResultWork are allowed in blocks.
    const validResultsForBlock = this.pendingValidResults.splice(0, 20); // take up to 20 recent valid ones

    // Build work submissions only from validated results
    const validWorkSubmissions = validResultsForBlock.map(r => ({
      nodeId: r.minerWallet,
      requestId: r.requestId,
      proofHash: r.getResultHash ? r.getResultHash() : `result-${r.requestId}`,
    }));

    const coinbase = calculateBlockRewards(validWorkSubmissions, previous.height + 1);

    // Apply local reputation to this node's proposer share (simple slashing effect)
    if (coinbase.proposerReward > 0) {
      const reputationMultiplier = this.reputation || 1.0;
      coinbase.proposerReward = Math.floor(coinbase.proposerReward * reputationMultiplier);
    }

    const newBlock = new PohBlock({
      height: previous.height + 1,
      previousHash: await previous.getHash(),
      timestamp: Date.now(),
      minerWallet: this.config.wallet,
      scanResults: validResultsForBlock, // Only high-quality, validated results
      coinbaseReward: coinbase,
      difficulty: this.currentDifficulty,
    });

    // Do a small PoW (this can be made useful later)
    let attempts = 0;
    while (!(await newBlock.meetsDifficulty()) && attempts < 100000) {
      newBlock.nonce++;
      attempts++;
    }

    if (await newBlock.meetsDifficulty()) {
      this.chain.push(newBlock);
      console.log(`[PoH-Miner] Produced block #${newBlock.height} (nonce ${newBlock.nonce}) — minted fixed ${BLOCK_REWARD_POH} POH | included ${validResultsForBlock.length} validated scan results`);

      // Credit the proposer reward (only the producer claims this)
      if (this.config.wallet && coinbase.proposerReward > 0) {
        this.walletManager.credit(this.config.wallet, coinbase.proposerReward);
        console.log(`[PoH-Miner] Credited ${coinbase.proposerReward} POH (proposer) to ${this.config.wallet}`);
      }

      // Credit any worker rewards this node earned (works for both produced and received blocks)
      this.processIncomingBlockRewards(newBlock);

      // Broadcast the new block to the network
      this.gossip.publish('new-block', newBlock.toJSON());

      // Process any signals updates in this block
      if (newBlock.stateTransitions?.length) {
        for (const tx of newBlock.stateTransitions) {
          await this.processStateTransition(tx);
        }
      }
    }
  }

  // For testing / external control
  injectScanRequest(request) {
    if (this.onScanRequest) this.onScanRequest(request);
  }

  /**
   * Public status for monitoring / other miners / dashboards
   */
  getStatus() {
    const sig = this.methodsManager?.getStatus() || {};
    return {
      wallet: this.config.wallet,
      methodsHash: sig.hash,
      methodsCount: sig.count,
      signalsSource: sig.source,
      signalsAgeMin: sig.ageMinutes,
      region: this.myLocation?.country,
      chainHeight: this.chain.length - 1,
      computeEnabled: this.config.computeEnabled,
      quality: this.qualityStats,
      reputation: this.reputation,
      rewardMultiplier: (this.reputation || 1.0).toFixed(2),
    };
  }

  /**
   * Apply penalty for submitting low-quality / malicious work.
   * Graduated slashing + strike system for repeat offenders.
   */
  applySlashing(penalty = 0.1) {
    const recentInvalid = this.submissionHistory
      .filter(s => !s.isValid && Date.now() - s.timestamp < 1000 * 60 * 60 * 24)
      .length;

    let effectivePenalty = penalty;
    let newStrikes = false;

    // Strike system
    if (recentInvalid >= 3) {
      this.qualityStats.strikes = (this.qualityStats.strikes || 0) + 1;
      newStrikes = true;

      if (this.qualityStats.strikes >= 3) {
        this.isTemporarilyRestricted = true;
        console.warn(`[PoH-Miner] ⚠️  TEMPORARILY RESTRICTED due to repeated low-quality submissions.`);
      }

      effectivePenalty = Math.max(effectivePenalty, 0.20 + (this.qualityStats.strikes * 0.05));
    }

    const previous = this.reputation;
    this.reputation = Math.max(0.05, this.reputation - effectivePenalty);

    if (newStrikes) {
      console.warn(`[PoH-Miner] Strike #${this.qualityStats.strikes} recorded. Reputation: ${previous.toFixed(2)} → ${this.reputation.toFixed(2)}`);
    } else {
      console.warn(`[PoH-Miner] Reputation slashed by ${effectivePenalty}. ${previous.toFixed(2)} → ${this.reputation.toFixed(2)}`);
    }

    this._saveQualityState();
  }

  /**
   * Slowly recover reputation over time for miners that behave well.
   * Called periodically.
   */
  decayReputation() {
    if (this.reputation < 1.0 && !this.isTemporarilyRestricted) {
      const recovery = 0.015;
      this.reputation = Math.min(1.0, this.reputation + recovery);
      this._saveQualityState();
    }
  }

  /**
   * Simple challenge mechanism (software protection).
   * Other miners (or the node itself) can flag a suspicious result.
   * If many flags accumulate against a miner, it triggers slashing.
   */
  flagSuspiciousResult(targetMinerWallet, reason = 'suspicious low-quality result') {
    if (!this.flaggedResults) this.flaggedResults = {};

    if (!this.flaggedResults[targetMinerWallet]) {
      this.flaggedResults[targetMinerWallet] = [];
    }

    this.flaggedResults[targetMinerWallet].push({
      timestamp: Date.now(),
      reason,
      flaggedBy: this.config.wallet,
    });

    const flags = this.flaggedResults[targetMinerWallet].length;

    if (flags >= 3) {
      console.warn(`[PoH-Miner] Multiple flags received for ${targetMinerWallet}. Applying defensive slash.`);
      // Self-protective measure: if we're the one being flagged a lot, we can react (in real network this would be gossip-based)
      if (targetMinerWallet === this.config.wallet) {
        this.applySlashing(0.10);
      }
    }
  }

  _getQualityStatePath() {
    const home = process.env.HOME || process.env.USERPROFILE || '.';
    const dir = path.join(home, '.poh-miner');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'quality.json');
  }

  _loadQualityState() {
    try {
      const file = this._getQualityStatePath();
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (data.qualityStats) this.qualityStats = data.qualityStats;
        if (typeof data.reputation === 'number') this.reputation = data.reputation;
        if (Array.isArray(data.submissionHistory)) this.submissionHistory = data.submissionHistory;
      }
    } catch (e) {
      console.warn('[PoH-Miner] Could not load quality state:', e.message);
    }
  }

  _saveQualityState() {
    try {
      const file = this._getQualityStatePath();
      const data = {
        qualityStats: this.qualityStats,
        reputation: this.reputation,
        submissionHistory: this.submissionHistory.slice(-200), // keep last 200 entries
        lastUpdated: Date.now(),
      };
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn('[PoH-Miner] Could not save quality state:', e.message);
    }
  }

  _recordSubmission(isValid, requestId, validationData = {}) {
    this.submissionHistory.push({
      timestamp: Date.now(),
      requestId,
      isValid,
      signalsEvaluated: validationData.signalsEvaluated || 0,
      liveCount: validationData.liveCount || 0,
      realPohUsed: validationData.realPohUsed ?? false,
    });

    // Trim history to last 500 entries in memory
    if (this.submissionHistory.length > 500) {
      this.submissionHistory = this.submissionHistory.slice(-500);
    }
  }

  /**
   * Handle on-chain published signals / methods updates.
   * Called when a block contains relevant stateTransitions.
   */
  async processStateTransition(transition) {
    if (!transition || !this.methodsManager) return;

    if (transition.type === 'methods-update' || transition.type === 'signals-update') {
      console.log(`[PoH-Miner] Received on-chain signals update (hash=${transition.hash})`);

      if (transition.methods && Array.isArray(transition.methods)) {
        const updated = await this.methodsManager.applyPublishedUpdate(transition.methods, {
          source: 'on-chain',
          hash: transition.hash,
        });

        if (updated) {
          console.log('[PoH-Miner] ✓ Applied on-chain methods update. New hash:', this.methodsManager.hash);
        }
      } else if (transition.cid) {
        // Future: fetch full list from IPFS using the CID in the transition
        this.methodsManager.lastKnownCID = transition.cid;
        console.log('[PoH-Miner] Saw on-chain CID for signals list:', transition.cid);
        await this.methodsManager.sync(); // will try IPFS path if configured
      }
    }
  }
}

// Allow direct execution for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const node = new PohMinerNode({
    wallet: process.env.POH_WALLET || 'test-miner-wallet',
  });
  node.start();
}
