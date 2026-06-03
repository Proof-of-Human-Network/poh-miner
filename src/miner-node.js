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
import { P2PGossip } from './network/p2p-gossip.js';
import { validateResultWork } from './validation/result-validator.js';
import { calculateBlockRewards, BLOCK_REWARD_POH, POH_DECIMALS } from './rewards/reward.js';
import { computeChainWork, compareChainWork, getTipChainWork } from './consensus/chain-selection.js';
import { mineBlock, getNextDifficulty } from './consensus/pow.js';
import { computeVerdictWithExistingPoh } from './compute/poh-adapter.js';
import { getBrain, getBrainDataDir } from './compute/adapters/real-poh.js';
import { BrainSync } from './brain/brain-sync.js';
import { PoHTransaction, TxMempool } from './core/transaction.js';
import { BalanceJournal } from './storage/balance-journal.js';
import { IPFSSync } from './storage/ipfs-sync.js';
import fs from 'fs';
import path from 'path';
import { ChainStore } from './storage/chain-store.js';
import { WalletManager } from './wallet/wallet.js';
import { RewardClaimStore } from './storage/reward-claim-store.js';
import http from 'http';
import { resolveRpcConfig } from './rpc/resolver.js';

// Well-known production bootnodes. Used when no bootnodes are configured
// (e.g. fresh GUI onboarding). Individual users can override via config.bootnodes.
const DEFAULT_BOOTNODES = [
  // 'https://bootnode.proofofhuman.ge',
  'http://localhost:8080'
];

export class PohMinerNode {
  constructor(config) {
    // Resolve new friendly RPC format ("rpc" + providers) into legacy format
    const resolvedRpc = resolveRpcConfig(config);

    this.config = {
      // Spread raw config first so explicit defaults below take precedence
      ...config,
      wallet: config.wallet,
      ollamaUrl: config.ollamaUrl || 'http://localhost:11434',
      computeEnabled: config.computeEnabled !== false,
      inferenceMode: config.inferenceMode || 'auto',
      model: config.model || 'qwen2.5:1.5b',
      region: config.region || null,
      // Fall back to well-known bootnodes when none are configured (e.g. fresh GUI install)
      bootnodes: config.bootnodes?.length ? config.bootnodes : DEFAULT_BOOTNODES,
      rpcEndpoints: resolvedRpc.rpcEndpoints,
      solanaRpc: resolvedRpc.solanaRpc,
      rpc: config.rpc || {},
      rpcOverrides: config.rpcOverrides || {},
    };

    this.chain = [];
    this.peers = [];
    this.knownPeers = [];
    this.orphanPool = new Map();   // previousHash → PohBlock[]
    this.txMempool = null;         // initialized after walletManager is ready
    // Set of requestIds already included in a mined block. Used to prevent
    // the same scan job being computed and rewarded twice across the network.
    this.minedRequestIds = new Set();

    // Apply custom RPC endpoints from config into process.env so the loaded checker uses them
    this._applyRpcEndpoints();

    this.jobQueue = new JobQueue();
    // Per-job status + full results for the "search -> poll status -> get verdict/profile/evidence" flow
    // (enables any frontend to connect directly to a discovered node via its walletApiPort)
    this.jobResults = new Map(); // jobId -> {id, status:'queued'|'computing'|'done'|'error', job, result:ScanResult|null, error?:string, createdAt, updatedAt}
    this.myLatencyProfile = null; // populated on startup
    this.currentDifficulty = 5; // matches MIN_DIFFICULTY in pow.js
    this.gossip = new P2PGossip(
      this.config.wallet || 'unknown-miner',
      () => this.peers || []   // live peer list — updated by discoverAndRegisterWithBootnodes
    );
    this.chainStore = new ChainStore();
    this.walletManager = new WalletManager();
    this.txMempool = new TxMempool(this.walletManager);
    this.rewardClaimStore = new RewardClaimStore();
    const _homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    this.balanceJournal = new BalanceJournal(
      path.join(_homeDir, '.poh-miner', 'chain'),
      this.walletManager
    );

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

    // Ensure we have a local wallet with signing keys (for protected bootnode registration)
    const identityAddr = this.config.pohWallet || this.config.wallet;
    this.identityWallet = this.walletManager.loadWallet(identityAddr);
    if (!this.identityWallet) {
      this.identityWallet = this.walletManager.createWallet();
      // If no prior identity, adopt the created one (keeps old solana-as-wallet cases using separate signer)
      if (!this.config.pohWallet) {
        this.config.pohWallet = this.identityWallet.address;
      }
      if (!this.config.wallet) {
        this.config.wallet = this.identityWallet.address;
      }
    }

    // BrainSync initialized lazily after brain data dir is set (happens on first compute)
    this.brainSync = null; // populated in _initBrainSync()

    // IPFSSync — durability layer for chain + brain state
    this.ipfsSync = new IPFSSync({
      chain:          this.chain,          // live reference
      bootnodes:      this.config.bootnodes,
      identityWallet: this.identityWallet,
    });

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
      // CORS support for browser clients (e.g. dev frontend on :5173 calling miner :3456)
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
      }

      res.setHeader('Content-Type', 'application/json');

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

      // === Job endpoints: "search -> check status -> verdict/profile/evidence" ===
      // These are available on *every* poh-miner node. Frontend (or any client) can
      // discover nodes via bootnode /peers then talk directly to e.g. http://<host>:<walletApiPort>/job
      // for a self-contained verdict flow without going through central checker.

      const isJobPost = req.method === 'POST' && (url.pathname === '/job' || url.pathname === '/search' || url.pathname === '/verdict');
      if (isJobPost || (req.method === 'POST' && url.pathname === '/test/job')) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const rawJob = JSON.parse(body);

            // Normalize a bit
            const job = {
              id: rawJob.id || (url.pathname === '/test/job' ? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
              type: rawJob.type || 'verdict',
              payload: rawJob.payload || { address: rawJob.address },
              fee: rawJob.fee || 10_000_000,
              originCountry: rawJob.originCountry || rawJob.originRegion,
              ...rawJob,
            };

            if (!job.payload?.address) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'payload.address is required for verdict jobs' }));
            }

            console.log(`[PoH-Miner] Received job via ${url.pathname}: ${job.id} (${job.type}) for ${job.payload.address}`);

            // Record for status polling immediately (non-blocking)
            this._recordJob(job);

            // Respond fast with jobId + poll urls (key for "check job status" flow)
            const base = `http://${req.headers.host}`;
            const resp = {
              accepted: true,
              jobId: job.id,
              status: 'queued',
              statusUrl: `${base}/job/${job.id}/status`,
              resultUrl: `${base}/job/${job.id}/result`,
              message: 'Job accepted. Poll status or result URL.',
            };

            // Fire background compute (do not block the HTTP response)
            setImmediate(() => {
              this._processJobInBackground(job).catch(e => console.error('[job bg]', e));
            });

            // Also support legacy /test/job callers by including the old fields
            if (url.pathname === '/test/job') {
              resp.message = 'Job submitted. Use /job/' + job.id + '/result (or check logs).';
            }

            return res.end(JSON.stringify(resp));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // GET job status + result (the "check job status -> verdict" part)
      if (req.method === 'GET' && url.pathname.startsWith('/job/')) {
        const parts = url.pathname.split('/').filter(Boolean); // ['job', id, 'status'|'result' ?]
        const jobId = parts[1];
        const action = parts[2] || 'status';
        const rec = this._getJobRecord(jobId);

        if (!rec) {
          // Fallback: check submissionHistory for legacy test jobs (summary only)
          const hist = (this.submissionHistory || []).find(h => h.requestId === jobId);
          if (hist) {
            return res.end(JSON.stringify({
              jobId,
              status: hist.isValid ? 'done' : 'error',
              isValid: hist.isValid,
              realPohUsed: hist.realPohUsed,
              signalsEvaluated: hist.signalsEvaluated,
              liveCount: hist.liveCount,
              note: 'limited info from legacy history; full result may be in chain or logs'
            }));
          }
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'job not found', jobId }));
        }

        if (action === 'status') {
          return res.end(JSON.stringify({
            jobId: rec.id,
            status: rec.status,
            createdAt: rec.createdAt,
            updatedAt: rec.updatedAt,
            address: rec.job?.payload?.address,
            error: rec.error || undefined,
          }));
        }

        if (action === 'result') {
          if (rec.status !== 'done' || !rec.result) {
            res.statusCode = 202; // Accepted, still processing
            return res.end(JSON.stringify({
              jobId: rec.id,
              status: rec.status,
              message: 'not ready yet',
              poll: `/job/${jobId}/status`,
            }));
          }
          const r = rec.result; // ScanResult
          // Return shape friendly for frontends: verdict + profile + evidence (signals etc)
          return res.end(JSON.stringify({
            jobId: rec.id,
            address: r.address,
            verdict: r.verdict,
            confidence: r.confidence,
            reasoning: r.reasoning,
            profile: r.profile || null,
            evidence: {
              signalsUsed: r.signalsUsed,
              methodsHash: r.methodsHash,
              methodsCount: r.methodsCount,
              computationTimeMs: r.computationTimeMs,
              realPohUsed: r.realPohUsed,
              modelUsed: r.modelUsed,
              isValidWork: r.isValidWork,
            },
            minerWallet: r.minerWallet,
            deliveredAt: r.deliveredAt,
          }));
        }

        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'unknown job action', jobId, action }));
      }

      // Optional: list recent jobs on this node (useful for debug / frontend)
      if (req.method === 'GET' && url.pathname === '/jobs') {
        const list = this.jobResults ? Array.from(this.jobResults.values()).slice(-50).map(r => ({
          jobId: r.id,
          status: r.status,
          address: r.job?.payload?.address,
          verdict: r.result?.verdict || null,
          createdAt: r.createdAt,
        })) : [];
        return res.end(JSON.stringify({ jobs: list, count: list.length }));
      }

      // Lightweight node info (so frontends can introspect a chosen node)
      if (req.method === 'GET' && (url.pathname === '/status' || url.pathname === '/node')) {
        const s = typeof this.getStatus === 'function' ? this.getStatus() : {};
        const active = this.jobResults ? Array.from(this.jobResults.values()).filter(r => ['queued','computing'].includes(r.status)).length : 0;
        return res.end(JSON.stringify({
          ...s,
          activeJobs: active,
          walletApiPort: port,
          version: 'poh-miner-network',
        }));
      }

      // ── Transaction submission ────────────────────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/api/tx/submit') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const txData = JSON.parse(body);
            const tx = PoHTransaction.fromJSON(txData);
            const result = this.txMempool.submit(tx);
            if (result === true) {
              // Gossip to peers so all miners can include it
              this.gossip.publish('new-tx', tx.toJSON()).catch(() => {});
              return res.end(JSON.stringify({ ok: true, txHash: tx.txHash, queueSize: this.txMempool.size() }));
            }
            res.statusCode = 400;
            res.end(JSON.stringify({ error: result.error || result }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/tx/pending') {
        const txs = this.txMempool.getPending(200).map(t => ({ txHash: t.txHash, from: t.from, to: t.to, amount: t.amount, fee: t.fee, nonce: t.nonce }));
        return res.end(JSON.stringify({ txs, count: txs.length }));
      }

      // ── P2P gossip receive endpoint ───────────────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/gossip') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const envelope = JSON.parse(body);
            await this.gossip.receive(envelope);
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // ── Ollama chat/generate proxy (/api/chat, /api/generate, /api/models) ──
      // Restricted: localhost-only by default. Set config.llmApiKey to allow
      // external access authenticated with "Authorization: Bearer <key>".
      const ollamaBase = this.config.ollamaUrl || 'http://localhost:11434';
      const ollamaProxyPaths = ['/api/chat', '/api/generate', '/api/embeddings'];
      const isOllamaProxy = ollamaProxyPaths.includes(url.pathname) ||
        url.pathname === '/api/models';

      if (isOllamaProxy) {
        const remote = req.socket.remoteAddress || '';
        const isLocalRequest = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
        const llmApiKey = this.config.llmApiKey;
        if (!isLocalRequest) {
          if (!llmApiKey) {
            res.statusCode = 403;
            return res.end(JSON.stringify({ error: 'LLM proxy is restricted to localhost. Set llmApiKey in config to allow external access.' }));
          }
          const provided = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
          if (provided !== llmApiKey) {
            res.statusCode = 401;
            return res.end(JSON.stringify({ error: 'Invalid API key' }));
          }
        }
        const targetPath = url.pathname === '/api/models'
          ? '/api/tags'
          : url.pathname;
        const targetUrl = new URL(targetPath, ollamaBase);
        const proxyReq = http.request({
          hostname: targetUrl.hostname,
          port: parseInt(targetUrl.port) || 11434,
          path: targetUrl.pathname + (targetUrl.search || ''),
          method: req.method,
          headers: { 'Content-Type': 'application/json' },
        }, (proxyRes) => {
          res.removeHeader('Content-Type');
          Object.entries(proxyRes.headers).forEach(([k, v]) => res.setHeader(k, v));
          res.statusCode = proxyRes.statusCode;
          proxyRes.pipe(res);
        });
        proxyReq.on('error', (e) => {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Ollama unavailable: ' + e.message }));
        });
        req.pipe(proxyReq);
        return;
      }

      // ── Brain state API (/api/brain/*) ────────────────────────────────────────
      if (url.pathname === '/api/brain/state') {
        const brainDir = getBrainDataDir();
        try {
          const weights = brainDir && fs.existsSync(path.join(brainDir, 'weights.json'))
            ? JSON.parse(fs.readFileSync(path.join(brainDir, 'weights.json'), 'utf8'))
            : {};
          const feedbackCount = brainDir && fs.existsSync(path.join(brainDir, 'feedback.json'))
            ? JSON.parse(fs.readFileSync(path.join(brainDir, 'feedback.json'), 'utf8')).length
            : 0;
          const stateSummary = brainDir && fs.existsSync(path.join(brainDir, 'brain_state.md'))
            ? fs.readFileSync(path.join(brainDir, 'brain_state.md'), 'utf8').slice(0, 2000)
            : '';
          return res.end(JSON.stringify({
            dataDir: brainDir,
            weightsCount: Object.keys(weights).length,
            feedbackCount,
            stateSummary,
            model: this.config.model || process.env.OLLAMA_MODEL || 'qwen2.5:1.5b',
            ollamaUrl: ollamaBase,
          }));
        } catch (e) {
          res.statusCode = 500;
          return res.end(JSON.stringify({ error: e.message }));
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/brain/weights') {
        const brainDir = getBrainDataDir();
        const weightsPath = brainDir && path.join(brainDir, 'weights.json');
        if (weightsPath && fs.existsSync(weightsPath)) {
          return res.end(fs.readFileSync(weightsPath));
        }
        return res.end(JSON.stringify({}));
      }

      if (req.method === 'POST' && url.pathname === '/api/brain/feedback') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const { address, aiVerdict, correction, comment, signals } = JSON.parse(body);
            if (!address || !aiVerdict || !correction) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'address, aiVerdict, correction required' }));
            }
            const b = await getBrain();
            if (!b?.onVerdictFeedback) {
              res.statusCode = 503;
              return res.end(JSON.stringify({ error: 'Brain not loaded' }));
            }
            await b.onVerdictFeedback(address, aiVerdict, correction, comment || '', signals || []);

            // Pin updated brain state to IPFS (fire-and-forget)
            this.ipfsSync.onBrainUpdated().catch(() => {});

            // Broadcast to network
            if (!this.brainSync) this._initBrainSync();
            if (this.brainSync) {
              this.brainSync.publishFeedback(
                { address, aiVerdict, correction, comment, signals },
                this.peers,
                this.config.bootnodes
              ).catch(() => {});
            }

            return res.end(JSON.stringify({ ok: true, broadcast: !!this.brainSync }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/brain/vote') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const { method, voteType, vote, stakeWeight, feedback } = JSON.parse(body);
            if (!method || !voteType || !vote) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'method, voteType, vote required' }));
            }
            const b = await getBrain();
            if (!b?.onVote) {
              res.statusCode = 503;
              return res.end(JSON.stringify({ error: 'Brain not loaded' }));
            }
            await b.onVote(method, voteType, vote, stakeWeight || 1, feedback || null);

            // Pin updated brain state to IPFS (fire-and-forget)
            this.ipfsSync.onBrainUpdated().catch(() => {});

            // Broadcast to network
            if (!this.brainSync) this._initBrainSync();
            if (this.brainSync) {
              this.brainSync.publishWeightUpdate(
                { method, voteType, vote, stakeWeight, feedback },
                this.peers,
                this.config.bootnodes
              ).catch(() => {});
            }

            return res.end(JSON.stringify({ ok: true, broadcast: !!this.brainSync }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // Receive brain events pushed by other miners (real-time peer broadcast)
      if (req.method === 'POST' && url.pathname === '/api/brain/sync/event') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const event = JSON.parse(body);
            if (!this.brainSync) this._initBrainSync();
            if (!this.brainSync) return res.end(JSON.stringify({ ok: false, reason: 'brain sync not ready' }));

            const brain = await getBrain().catch(() => null);
            const applied = await this.brainSync.applyEvent(event, brain);
            return res.end(JSON.stringify({ ok: true, applied }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // ── Methods list (/methods) ───────────────────────────────────────────────
      // Returns the network-synced active methods merged with this node's weights.
      // Frontend uses this as the voting queue when routing through a peer.
      if (req.method === 'GET' && url.pathname === '/methods') {
        getMethodsManager().then(mm => {
          const methods = mm ? mm.getActiveMethods() : [];
          const brainDir = getBrainDataDir();
          const weights = brainDir && fs.existsSync(path.join(brainDir, 'weights.json'))
            ? JSON.parse(fs.readFileSync(path.join(brainDir, 'weights.json'), 'utf8'))
            : {};
          const result = methods.map(m => ({
            ...m,
            weight: weights[m.id] ?? 1.0,
            score: weights[m.id] ?? 1.0,
          }));
          res.end(JSON.stringify(result));
        }).catch(e => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        });
        return;
      }

      // ── Cached profile by address (/profile/:address) ─────────────────────────
      // Returns the enriched profile from the most recent completed job for this
      // address. Frontend calls this after a decentralized scan for the profile card.
      const profileMatch = url.pathname.match(/^\/profile\/([^/]+)$/);
      if (req.method === 'GET' && profileMatch) {
        const address = decodeURIComponent(profileMatch[1]);
        const jobs = this.jobResults ? Array.from(this.jobResults.values()) : [];
        const rec = jobs
          .filter(r => r.job?.payload?.address === address && r.status === 'done' && r.result?.profile)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        if (rec?.result?.profile) {
          return res.end(JSON.stringify(rec.result.profile));
        }
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'No profile cached for this address' }));
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
      console.log(`   Wallet: curl "http://localhost:${port}/api/wallet/balance?address=${this.config.wallet}"`);
      console.log(`   Submit job: curl -X POST http://localhost:${port}/job -d '{"payload":{"address":"bc1q..."}}'`);
      console.log(`   Check status: curl http://localhost:${port}/job/<jobId>/status`);
      console.log(`   Verdict+profile: curl http://localhost:${port}/job/<jobId>/result`);
      console.log(`   Node info: curl http://localhost:${port}/status`);
      console.log(`   Ollama chat: POST http://localhost:${port}/api/chat`);
      console.log(`   Ollama generate: POST http://localhost:${port}/api/generate`);
      console.log(`   Models: GET http://localhost:${port}/api/models`);
      console.log(`   Brain state: GET http://localhost:${port}/api/brain/state`);
      console.log(`   Brain weights: GET http://localhost:${port}/api/brain/weights`);
      console.log(`   Brain feedback: POST http://localhost:${port}/api/brain/feedback`);
      console.log(`   Brain vote: POST http://localhost:${port}/api/brain/vote`);
      console.log(`   Brain sync (peer push): POST http://localhost:${port}/api/brain/sync/event`);
      console.log(`   Methods list: GET http://localhost:${port}/methods`);
      console.log(`   Cached profile: GET http://localhost:${port}/profile/<address>`);
      console.log(`   (legacy still works: /test/job )`);
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
      // Rebuild minedRequestIds from the persisted chain so we never re-compute
      // a job that was already included in a block before a restart.
      for (const block of this.chain) {
        for (const r of (block.scanResults || [])) {
          if (r.requestId) this.minedRequestIds.add(r.requestId);
        }
      }
      console.log(`[PoH-Miner] Loaded ${this.chain.length} blocks from disk (${this.minedRequestIds.size} known request IDs)`);
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

    // 3. Apply IPFS chain snapshot if it extends our local chain
    if (this._pendingIPFSChainSnap) {
      const snap = this._pendingIPFSChainSnap;
      delete this._pendingIPFSChainSnap;
      const localHeight = this.chain.length ? this.chain[this.chain.length - 1].height : -1;
      if (snap.height > localHeight) {
        try {
          const blocks = snap.blocks.map(b => PohBlock.fromJSON(b));
          // Verify chain linkage before applying
          let valid = true;
          for (let i = 1; i < blocks.length; i++) {
            if (blocks[i].previousHash !== blocks[i - 1].getHashSync()) { valid = false; break; }
          }
          if (valid) {
            this.chain = blocks;
            this.chainStore.saveChain(this.chain);
            // Rebuild minedRequestIds from IPFS snapshot
            for (const b of this.chain) {
              for (const r of (b.scanResults || [])) {
                if (r.requestId) this.minedRequestIds.add(r.requestId);
              }
            }
            console.log(`[PoH-Miner] Applied IPFS chain snapshot: ${this.chain.length} blocks (height ${snap.height})`);
          }
        } catch (e) {
          console.warn('[PoH-Miner] Failed to apply IPFS chain snapshot:', e.message);
        }
      }
    }

    // 4. Sync from bootnodes (production-ready path)
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

    const walletAddr = this.config.pohWallet || this.config.wallet;
    const ts = Date.now();
    const methodsHash = this.methodsManager?.hash || 'unknown';

    const baseInfo = {
      wallet: walletAddr,
      host: this._getPublicHost(),
      walletApiPort: this.config.walletApiPort || 3456,
      p2pPort: this.config.p2pPort || null,
      region: this.myLocation?.country || null,
      timestamp: ts,
      methodsHash,
    };

    // Attach proof that we are a real running poh-miner node (possess local wallet privkey)
    let registerPayload = { ...baseInfo };
    if (this.identityWallet && typeof this.identityWallet.sign === 'function') {
      const toSign = JSON.stringify({
        wallet: baseInfo.wallet,
        host: baseInfo.host,
        timestamp: ts,
        methodsHash,
      });
      registerPayload.signingPublicKey = this.identityWallet.signingPublicKey;
      registerPayload.signature = this.identityWallet.sign(toSign);
    }

    console.log(`[PoH-Miner] Registering with bootnode(s): ${this.config.bootnodes.join(', ')}`);
    console.log(`[PoH-Miner] Register payload: wallet=${registerPayload.wallet} host=${registerPayload.host} signed=${!!registerPayload.signature}`);

    for (const bootnode of this.config.bootnodes) {
      const base = bootnode.endsWith('/') ? bootnode : bootnode + '/';

      try {
        const regRes = await fetch(`${base}register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(registerPayload),
        });
        const regBody = await regRes.json().catch(() => ({}));
        if (!regRes.ok) {
          console.warn(`[PoH-Miner] Bootnode rejected registration (${regRes.status}): ${regBody.error || JSON.stringify(regBody)}`);
        } else {
          console.log(`[PoH-Miner] Registered with bootnode ${bootnode} — ${regBody.peersKnown ?? '?'} peers known`);
        }

        // Fetch current peer list
        const res = await fetch(`${base}peers`);
        if (res.ok) {
          const data = await res.json();
          this.knownPeers = data.peers || [];

          // Filter out ourselves
          this.knownPeers = this.knownPeers.filter(p => p.wallet !== walletAddr);

          console.log(`[PoH-Miner] Discovered ${this.knownPeers.length} peers from ${bootnode}`);

          if (this.knownPeers.length > 0) {
            console.log('[PoH-Miner] Known peers:');
            this.knownPeers.forEach(p => {
              const v = p.signingPublicKey ? '✓verified' : 'unverified';
              console.log(`  - ${p.wallet?.slice(0,10)}... @ ${p.host}:${p.walletApiPort} (${p.region || 'unknown region'}) [${v}]`);
            });
          }
        }
      } catch (err) {
        console.warn(`[PoH-Miner] Failed peer discovery with ${bootnode}:`, err.message);
      }
    }

    // Store for later use
    this.peers = this.knownPeers || [];

    // Publish own peer record to IPFS after a successful registration so
    // other miners can discover us even when the bootnode is offline later.
    if (this.peers.length >= 0 && this.ipfsSync) {
      this.ipfsSync.publishPeerRecord({
        wallet:        walletAddr,
        host:          this._getPublicHost(),
        walletApiPort: this.config.walletApiPort || 3456,
        region:        this.myLocation?.country || null,
        methodsHash,
      }).catch(() => {});
    }
  }

  /**
   * IPFS peer discovery fallback — used when all bootnodes are unreachable.
   * Fetches the peer directory pinned to IPFS and merges it into this.peers.
   */
  async _discoverPeersFromIPFS() {
    if (!this.ipfsSync) return;
    const walletAddr = this.config.pohWallet || this.config.wallet;

    // Ensure we have the latest CIDs (reads from disk cache if bootnode is down)
    await this.ipfsSync.fetchLatestCIDs();

    const ipfsPeers = await this.ipfsSync.fetchPeerDirectory(walletAddr);
    if (!ipfsPeers.length) return;

    // Merge with existing peers — prefer IPFS entries for addresses we haven't seen
    const known = new Set(this.peers.map(p => p.wallet));
    const fresh = ipfsPeers.filter(p => !known.has(p.wallet));
    if (fresh.length) {
      this.peers = [...this.peers, ...fresh];
      console.log(`[PoH-Miner] Added ${fresh.length} peer(s) from IPFS directory (bootnode fallback)`);
    }
  }

  _getPublicHost() {
    // In production this should be the externally reachable IP/hostname.
    // For now we use a reasonable default that works in most LAN + cloud setups.
    return process.env.POH_PUBLIC_HOST || 'localhost';
  }

  _initBrainSync() {
    if (this.brainSync) return;
    const brainDataDir = getBrainDataDir();
    if (!brainDataDir) return;
    this.brainSync = new BrainSync({
      brainDataDir,
      identityWallet: this.identityWallet,
      walletApiPort: this.config.walletApiPort || 3456,
    });
    console.log('[PoH-Miner] BrainSync initialized');
  }

  async connectToNetwork() {
    // Real version: libp2p, gossipsub, or simple WebSocket mesh between miners
    console.log('[PoH-Miner] Connecting to network...');

    // Initialize brain sync (needs brain data dir set by first compute call,
    // but we do a best-effort init here — it will be re-tried on first API call)
    this._initBrainSync();

    if (this.config.bootnodes?.length > 0) {
      console.log(`[PoH-Miner] Bootnodes: ${JSON.stringify(this.config.bootnodes)}`);

      await this.discoverAndRegisterWithBootnodes();

      // If we got no peers from the bootnode, try the IPFS peer directory
      if (!this.peers.length) {
        console.log('[PoH-Miner] No peers from bootnode — trying IPFS peer directory fallback');
        await this._discoverPeersFromIPFS();
      }

      // Pull brain events accumulated on the bootnode since our last sync
      if (this.brainSync) {
        const brain = await getBrain().catch(() => null);
        await this.brainSync.pullFromBootnodes(this.config.bootnodes, brain);
      }

      // Bootstrap from IPFS if our chain is stale or we have no brain weights yet
      await this.ipfsSync.fetchLatestCIDs();
      const chainSnap = await this.ipfsSync.fetchChainSnapshot();
      if (chainSnap?.blocks?.length) {
        console.log(`[PoH-Miner] IPFS chain snapshot available (height ${chainSnap.height}) — will be applied during syncChain`);
        this._pendingIPFSChainSnap = chainSnap;
      }

      // Start periodic brain pinning
      this.ipfsSync.startPeriodicBrainSync();

      // Re-register every 8 minutes; fall back to IPFS if bootnode is down
      setInterval(async () => {
        const before = this.peers.length;
        await this.discoverAndRegisterWithBootnodes();
        if (!this.peers.length && before === 0) {
          await this._discoverPeersFromIPFS();
        }
      }, 8 * 60 * 1000);

      // Re-sync brain events every 5 minutes (picks up any events we missed)
      setInterval(async () => {
        if (!this.brainSync) this._initBrainSync();
        if (this.brainSync) {
          const brain = await getBrain().catch(() => null);
          await this.brainSync.pullFromBootnodes(this.config.bootnodes, brain);
        }
      }, 5 * 60 * 1000);
    } else {
      console.log('[PoH-Miner] No bootnodes configured — running in local/dev mode only');
    }

    // Accept transactions gossiped by peers
    this.gossip.subscribe('new-tx', (txData) => {
      try {
        const tx = PoHTransaction.fromJSON(txData);
        this.txMempool.submit(tx); // silently ignores duplicates / invalid
      } catch { /* malformed tx */ }
    });

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
      const newBlock = PohBlock.fromJSON(blockData);
      const currentHeight = this.chain.length - 1;
      const tipHash = this.chain[currentHeight].getHashSync();

      // Always reject invalid signatures
      if (newBlock.minerSignature && !newBlock.verifySignature()) {
        console.warn(`[PoH-Miner] Block #${newBlock.height} invalid signature — rejected`);
        return;
      }

      // Ensure incoming block has chainWork set
      if (!newBlock.chainWork || newBlock.chainWork === '0') {
        const parent = this.chain.find(b => b.getHashSync() === newBlock.previousHash);
        newBlock.chainWork = computeChainWork(parent?.chainWork, newBlock.difficulty);
      }

      if (newBlock.height === currentHeight + 1 && newBlock.previousHash === tipHash) {
        // ── Happy path: extends our current tip ─────────────────────────────
        this._appendBlock(newBlock, from);
        this._drainOrphans(newBlock.getHashSync());

      } else if (newBlock.height === currentHeight + 1 && newBlock.previousHash !== tipHash) {
        // ── Fork at same height: competing block ─────────────────────────────
        // Keep the block with more cumulative work (longest/heaviest chain rule)
        const ourWork  = getTipChainWork(this.chain);
        if (compareChainWork(newBlock.chainWork, ourWork) > 0) {
          console.log(`[PoH-Miner] Fork: incoming block #${newBlock.height} has more chainWork — switching`);
          // Roll back our tip and replace with the heavier block
          this.chain.pop();
          this._appendBlock(newBlock, from);
        } else {
          // Put in orphan pool; may become canonical if a longer chain follows
          this._storeOrphan(newBlock);
        }

      } else if (newBlock.height <= currentHeight) {
        // ── Old block: only consider if it anchors a heavier chain ───────────
        this._storeOrphan(newBlock);

      } else {
        // ── We're behind (gap) — add to orphan pool and sync ─────────────────
        this._storeOrphan(newBlock);
        console.log(`[PoH-Miner] Behind (peer at ${newBlock.height}, we at ${currentHeight}) — syncing`);
        this.requestBlockSync(newBlock.height);
      }
    } catch (err) {
      console.warn(`[PoH-Miner] Failed to process incoming block from ${from}:`, err.message);
    }
  }

  _appendBlock(block, from) {
    // Apply formal transactions in the block to wallet state
    const appliedTxHashes = [];
    for (const txData of (block.transactions || [])) {
      const tx = PoHTransaction.fromJSON(txData);
      const result = this.walletManager.applyTransaction(tx);
      if (result === true) {
        appliedTxHashes.push(tx.txHash);
        // Record journal entries for rollback capability
        this.balanceJournal.record(block.height, tx.from, -(tx.amount + tx.fee), 1, tx.txHash);
        this.balanceJournal.record(block.height, tx.to, tx.amount, 0, tx.txHash);
        if (tx.fee > 0 && block.minerWallet) {
          this.walletManager.credit(block.minerWallet, tx.fee);
          this.balanceJournal.record(block.height, block.minerWallet, tx.fee, 0, tx.txHash);
        }
      } else {
        console.warn(`[PoH-Miner] Tx ${tx.txHash.slice(0,12)} failed in block #${block.height}: ${result}`);
      }
    }
    if (appliedTxHashes.length) this.txMempool.onBlockApplied(appliedTxHashes);

    // Register all scan results in this block as mined — drop any pending
    // results for the same requestIds so miners don't re-mine them.
    let dropped = 0;
    for (const r of (block.scanResults || [])) {
      if (r.requestId) {
        if (this.minedRequestIds.has(r.requestId)) continue; // already known
        this.minedRequestIds.add(r.requestId);
      }
    }
    const before = this.pendingValidResults.length;
    this.pendingValidResults = this.pendingValidResults.filter(
      r => !this.minedRequestIds.has(r.requestId)
    );
    dropped = before - this.pendingValidResults.length;
    if (dropped > 0) {
      console.log(`[PoH-Miner] Dropped ${dropped} pending result(s) already mined in block #${block.height}`);
    }

    // Abort current mining immediately — we need to mine on the new tip
    this._abortMining();

    this.chain.push(block);
    this.chainStore.saveChain(this.chain);
    console.log(`[PoH-Miner] Accepted block #${block.height} chainWork=${block.chainWork} txs=${appliedTxHashes.length} [sig:${block.minerSignature ? '✓' : 'none'}] from ${from?.slice(0,8)}`);
    this.processIncomingBlockRewards(block);

    // Recalculate difficulty after each new block
    this.currentDifficulty = getNextDifficulty(this.chain);

    // Trigger IPFS chain snapshot every 100 blocks (fire-and-forget)
    this.ipfsSync.onBlockAppended(block).catch(() => {});
  }

  _storeOrphan(block) {
    const key = block.previousHash;
    if (!this.orphanPool.has(key)) this.orphanPool.set(key, []);
    const siblings = this.orphanPool.get(key);
    if (!siblings.find(b => b.getHashSync() === block.getHashSync())) {
      siblings.push(block);
    }
    // Prune orphan pool to avoid unbounded growth
    if (this.orphanPool.size > 200) {
      const oldest = this.orphanPool.keys().next().value;
      this.orphanPool.delete(oldest);
    }
  }

  // After accepting a block, check if any orphan was waiting for it as parent
  _drainOrphans(newTipHash) {
    const waiting = this.orphanPool.get(newTipHash);
    if (!waiting?.length) return;
    this.orphanPool.delete(newTipHash);

    // Sort by chainWork desc, pick heaviest
    waiting.sort((a, b) => compareChainWork(b.chainWork, a.chainWork));
    const best = waiting[0];
    if (compareChainWork(best.chainWork, getTipChainWork(this.chain)) > 0) {
      this._appendBlock(best, 'orphan-pool');
      this._drainOrphans(best.getHashSync());
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

        const blocksData = await res.json();
        const incoming = blocksData.map(b => PohBlock.fromJSON(b));

        // Check if incoming blocks represent a heavier chain (reorg needed)
        const incomingTip = incoming[incoming.length - 1];
        const ourWork = getTipChainWork(this.chain);
        if (incomingTip && compareChainWork(incomingTip.chainWork, ourWork) > 0) {
          await this.reorgTo(incoming);
          return;
        }

        // No reorg needed — append sequential blocks normally
        let added = 0;
        for (const block of incoming) {
          const prev = this.chain[this.chain.length - 1];
          if (block.height === this.chain.length && block.previousHash === prev.getHashSync()) {
            this._appendBlock(block, bootnode);
            added++;
          }
        }

        if (added > 0) {
          console.log(`[PoH-Miner] [Sync] Synced ${added} blocks from ${bootnode}`);
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
      this.balanceJournal.record(block.height, this.config.wallet, worker.amount, 0, claimKey);

      console.log(
        `[PoH-Miner] Credited ${(worker.amount / POH_DECIMALS).toFixed(4)} POH (worker) from block #${block.height} to ${this.config.wallet}`
      );
    });
  }

  /**
   * Reorganize to a different chain segment.
   *
   * Steps:
   *   1. Find common ancestor between current chain and newBlocks
   *   2. Roll back balance journal to common ancestor height
   *   3. Re-credit reward claims from rolled-back blocks (mark unclaimed)
   *   4. Replace chain from common ancestor with newBlocks
   *   5. Apply each new block
   *
   * Called when a sync reveals a heavier chain branch.
   */
  async reorgTo(newBlocks) {
    if (!newBlocks?.length) return;

    // Find common ancestor
    const newHashes = new Set(newBlocks.map(b => b.previousHash));
    let commonHeight = -1;
    for (let i = this.chain.length - 1; i >= 0; i--) {
      if (newHashes.has(this.chain[i].getHashSync())) {
        commonHeight = i;
        break;
      }
    }
    if (commonHeight < 0) {
      console.warn('[PoH-Miner] Reorg: no common ancestor found — ignoring');
      return;
    }

    const rolledBack = this.chain.splice(commonHeight + 1);
    console.log(`[PoH-Miner] Reorg: rolling back ${rolledBack.length} blocks to height ${commonHeight}`);

    // Undo balance changes for rolled-back blocks
    const undone = this.balanceJournal.rollbackTo(commonHeight);
    console.log(`[PoH-Miner] Reorg: reversed ${undone} journal entries`);

    // Unclaim reward claims so they can be re-earned on the new chain
    for (const block of rolledBack) {
      const coinbase = block.coinbaseReward;
      if (!coinbase?.workerRewards) continue;
      for (const w of coinbase.workerRewards) {
        if (w.workerId === this.config.wallet) {
          const key = RewardClaimStore.makeClaimKey(block.height, w.workProofHash);
          this.rewardClaimStore.unclaim(key);
        }
      }
    }

    // Apply the new branch blocks
    for (const block of newBlocks) {
      this._appendBlock(block, 'reorg');
    }
    this.chainStore.saveChain(this.chain);
    console.log(`[PoH-Miner] Reorg complete. New tip: #${this.chain[this.chain.length - 1].height}`);
  }

  startJobListener() {
    console.log('[PoH-Miner] Listening for jobs (with geo awareness)...');

    // In real network: subscribe to gossip topic "new-jobs"
    this.onNewJob = (rawJob) => {
      const job = this.jobQueue.addJob(rawJob);
      this._recordJob(job); // make status/result queryable even for network-originated jobs

      const minerInfo = {
        country: this.myLocation?.country,
        currentLoad: 0.25,
        reputation: this.reputation,
      };

      const score = this.jobQueue.scoreJobForMiner(job, minerInfo);

      if (score > 0 && this.config.computeEnabled) {
        const geoNote = job.originCountry ? ` [from: ${job.originCountry}]` : '';
        console.log(`[PoH-Miner] New job ${job.id} (${job.type})${geoNote} → score: ${score}`);
        // compute will update the jobResults rec
        this.computeAndSubmitJob(job);
      } else {
        const reason = score === 0 ? 'different continent / low priority' : 'compute disabled';
        console.log(`[PoH-Miner] Ignoring job ${job.id} (${reason})`);
        this._updateJob(job.id, { status: 'ignored', error: reason });
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
        profile: verdict.profile,
      });

      await this.submitResult(job, result);
      this.jobQueue.markCompleted(job.id);

      // Make full result available for /job/:id/result queries (verdict + profile + evidence)
      if (this.jobResults && this.jobResults.has(job.id)) {
        const rec = this.jobResults.get(job.id);
        rec.result = result;
        rec.status = 'done';
        rec.updatedAt = Date.now();
      } else if (this.jobResults) {
        // In case job was not pre-recorded (e.g. via gossip path)
        this.jobResults.set(job.id, {
          id: job.id,
          status: 'done',
          job,
          result,
          error: null,
          createdAt: start,
          updatedAt: Date.now(),
        });
      }

      return result;
    } catch (err) {
      console.error('[PoH-Miner] Job computation failed:', err.message);
      if (this.jobResults && this.jobResults.has(job.id)) {
        const rec = this.jobResults.get(job.id);
        rec.status = 'error';
        rec.error = err.message;
        rec.updatedAt = Date.now();
      }
      return null;
    }
  }

  /**
   * Record a job for status/result polling (used by direct /job API + internal paths).
   */
  _recordJob(job) {
    if (!this.jobResults) this.jobResults = new Map();
    if (this.jobResults.has(job.id)) return; // don't overwrite
    this.jobResults.set(job.id, {
      id: job.id,
      status: 'queued',
      job,
      result: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (this.jobQueue) {
      this.jobQueue.addJob(job);
    }
  }

  _updateJob(jobId, patch) {
    const rec = this.jobResults && this.jobResults.get(jobId);
    if (rec) {
      Object.assign(rec, patch);
      rec.updatedAt = Date.now();
    }
  }

  _getJobRecord(jobId) {
    return this.jobResults ? this.jobResults.get(jobId) : null;
  }

  async _processJobInBackground(job) {
    const jobId = job.id;
    this._updateJob(jobId, { status: 'computing' });
    try {
      await this.computeAndSubmitJob(job);
      // computeAndSubmitJob updates the rec to 'done' + result when successful
    } catch (e) {
      this._updateJob(jobId, { status: 'error', error: e.message });
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

      // Do not slash for simulation fallbacks (dev/testing) or non-realPoh
      const isSim = result.methodsHash && String(result.methodsHash).startsWith('sim-');
      const isReal = result.realPohUsed === true;
      if (!isSim) {
        // Apply slashing / reputation penalty for malicious or lazy submissions
        this.applySlashing(0.15);
      } else {
        console.log('[PoH-Miner] Simulation result (dev fallback) — skipping self-slash');
      }
      return; // Do not propagate bad work
    }

    result.isValidWork = true;
    this.qualityStats.validSubmissions++;

    // Sign the result with this miner's identity key so block validators
    // can verify who produced this work and reject forgeries.
    if (this.identityWallet) {
      try { result.sign(this.identityWallet); } catch { /* non-fatal */ }
    }

    // Another miner may have won this job while we were computing — drop it.
    if (this.minedRequestIds.has(request.id)) {
      console.log(`[PoH-Miner] Job ${request.id} already mined by another node — dropping result`);
      return;
    }

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
    // Every miner mines continuously. Mining is aborted when a new valid
    // block arrives from the network, then immediately restarted on the
    // new tip — same as Bitcoin's mining loop.
    this._miningController = null;
    this._miningActive = false;
    this._mineLoop();
  }

  async _mineLoop() {
    if (this._miningActive) return;
    this._miningActive = true;
    try {
      while (true) {
        this._miningController = new AbortController();
        const result = await this.proposeBlock(this._miningController.signal);
        if (!result) {
          // Aborted by incoming block — tiny pause, then restart on new tip
          await new Promise(r => setTimeout(r, 50));
        }
        // Block found or aborted — either way restart
      }
    } finally {
      this._miningActive = false;
    }
  }

  // Call this when a valid block arrives from the network to abort mining
  _abortMining() {
    if (this._miningController && !this._miningController.signal.aborted) {
      this._miningController.abort();
    }
  }

  async proposeBlock(abortSignal) {
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

    // When there's no compute work, share the 40% keepalive reward among
    // active peers (exclude self — proposer already gets the 60% share).
    const activePeersForReward = validWorkSubmissions.length === 0
      ? (this.peers || []).filter(p => p.wallet && p.wallet !== (this.config.pohWallet || this.config.wallet))
      : [];

    const coinbase = calculateBlockRewards(validWorkSubmissions, previous.height + 1, activePeersForReward);

    // Apply local reputation to this node's proposer share (simple slashing effect)
    if (coinbase.proposerReward > 0) {
      const reputationMultiplier = this.reputation || 1.0;
      coinbase.proposerReward = Math.floor(coinbase.proposerReward * reputationMultiplier);
    }

    // Final guard: exclude any result whose requestId is already in the chain.
    // This catches results that slipped through between _appendBlock and here.
    const dedupedResults = validResultsForBlock.filter(
      r => !this.minedRequestIds.has(r.requestId)
    );
    if (dedupedResults.length < validResultsForBlock.length) {
      console.log(`[PoH-Miner] Filtered ${validResultsForBlock.length - dedupedResults.length} duplicate result(s) before block inclusion`);
    }

    // Include pending transactions (fee-ordered, up to 100 per block)
    const pendingTxs = this.txMempool.getPending(100);

    const newBlock = new PohBlock({
      height: previous.height + 1,
      previousHash: await previous.getHash(),
      timestamp: Date.now(),
      minerWallet: this.config.wallet,
      scanResults: dedupedResults,
      transactions: pendingTxs.map(t => t.toJSON()),
      coinbaseReward: coinbase,
      difficulty: this.currentDifficulty,
      chainWork: computeChainWork(previous.chainWork, this.currentDifficulty),
    });

    const attempts = await mineBlock(newBlock, this.currentDifficulty, abortSignal);

    if (attempts === null) return null; // aborted by incoming block

    if (newBlock.meetsDifficultySync()) {
      // Sign the block with our identity key after PoW is solved
      if (this.identityWallet) newBlock.sign(this.identityWallet);

      // Mark these requestIds as mined so no peer or restart re-mines them
      for (const r of dedupedResults) {
        if (r.requestId) this.minedRequestIds.add(r.requestId);
      }

      this.chain.push(newBlock);
      this.chainStore.saveChain(this.chain);  // persist local blocks so they survive restart
      console.log(`[PoH-Miner] Produced block #${newBlock.height} (nonce ${newBlock.nonce}) — minted fixed ${BLOCK_REWARD_POH} POH | included ${validResultsForBlock.length} validated scan results`);

      // Credit the proposer reward (only the producer claims this)
      if (this.config.wallet && coinbase.proposerReward > 0) {
        this.walletManager.credit(this.config.wallet, coinbase.proposerReward);
        console.log(`[PoH-Miner] Credited ${(coinbase.proposerReward / POH_DECIMALS).toFixed(4)} POH (proposer) to ${this.config.wallet}`);
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
