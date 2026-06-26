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
import { execSync as _execSync } from 'child_process';
import { ChainStore } from './storage/chain-store.js';
import { WalletManager, Wallet } from './wallet/wallet.js';
import { RewardClaimStore } from './storage/reward-claim-store.js';
import { skillsManager } from './skills/manager.js';
import { loadAllSkills, writeSkillFile } from './skills/loader.js';
import { estimateTokens, settleFee, timeoutFee, GAS } from './jobs/gas-estimator.js';
import { feedbackStore } from './jobs/feedback-store.js';
import http from 'http';
import { resolveRpcConfig } from './rpc/resolver.js';
import crypto from 'crypto';
import { buildManifest, serveDataset, pullDataset } from './storage/dataset-sync.js';
import { OrderStore, QUOTE_CURRENCIES } from './p2p/order-store.js';
import { EscrowManager, ESCROW_ADDRESS } from './p2p/escrow.js';

function computeBrainStateRoot(brainDir) {
  if (!brainDir) return null;
  try {
    const h = crypto.createHash('sha256');
    let hasAny = false;
    for (const f of ['weights.json', 'pools.json', 'skill_prefs.json', 'skill_stake_vault.json']) {
      const p = path.join(brainDir, f);
      if (fs.existsSync(p)) { h.update(fs.readFileSync(p)); hasAny = true; }
    }
    const labeledDir = path.join(brainDir, 'labeled');
    if (fs.existsSync(labeledDir)) {
      for (const f of fs.readdirSync(labeledDir).sort()) {
        try { h.update(f); h.update(fs.readFileSync(path.join(labeledDir, f))); hasAny = true; } catch {}
      }
    }
    return hasAny ? h.digest('hex') : null;
  } catch { return null; }
}

// Markdown fallback renderer for skill output when LLM is unavailable or returns nothing.
function _formatSkillOutputFallback(skillId, output) {
  if (!output) return '_No data returned by skill._';
  if (output.error) return `**Error:** ${output.error}`;

  if (skillId === 'web_search') {
    const lines = [`## Search results: ${output.query || ''}`];
    if (output.summary) lines.push(`\n${output.summary}`);
    if (output.results?.length) {
      lines.push('\n### Results');
      for (const r of output.results) {
        const src = r.url ? ` ([source](${r.url}))` : '';
        lines.push(`- **${r.title || 'Result'}** — ${r.snippet || ''}${src}`);
      }
    } else {
      lines.push('\n_No results found. Try a different search query._');
    }
    lines.push(`\n*Source: ${output.source || 'DuckDuckGo'}*`);
    return lines.join('\n');
  }

  if (skillId === 'read_farcaster') {
    if (!output.fid) return '_No Farcaster account found for this address._';
    const lines = [
      `## ${output.displayName || output.username}`,
      `**@${output.username}** · ${output.followerCount?.toLocaleString() || 0} followers`,
    ];
    if (output.bio) lines.push(`\n> ${output.bio}`);
    if (output.analysis?.summary) lines.push(`\n${output.analysis.summary}`);
    return lines.join('\n');
  }

  // Generic: convert top-level string/number fields to a readable list
  const lines = [];
  for (const [k, v] of Object.entries(output)) {
    if (typeof v === 'string' || typeof v === 'number') lines.push(`- **${k}:** ${v}`);
  }
  return lines.length ? lines.join('\n') : '_Skill returned data with no displayable summary._';
}

// Builtin skills that are ON by default for every node.
// All other skills (community-proposed) start disabled until the node operator enables them.
const DEFAULT_ENABLED_SKILLS = new Set([
  'poh_identity',
  'read_farcaster',
  'read_paragraph',
  'read_zora',
  'code_audit',
  'web_search',
]);

// Well-known production bootnodes. Used when no bootnodes are configured
// (e.g. fresh GUI onboarding). Individual users can override via config.bootnodes.
const DEFAULT_BOOTNODES = [
  "https://miner.proofofhuman.ge",
  "https://bootnode.proofofhuman.ge",
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
      () => this.peers || [],   // live peer list — updated by discoverAndRegisterWithBootnodes
      () => this.config.bootnodes || DEFAULT_BOOTNODES,
    );
    this.chainStore = new ChainStore();
    this.walletManager = new WalletManager();
    this.txMempool = new TxMempool(this.walletManager);
    this.p2pOrderStore = new OrderStore();
    this.p2pEscrow = new EscrowManager();
    // push token registry: address → { token, platform, registeredAt }
    this.pushTokens = new Map();
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
    this.escrow = new Map(); // jobId → { amount, requesterAddress, minerAddress }
    this._appliedEscrowJobIds = new Set(); // prevents double-debit when block replay re-runs job-escrow
    this._appliedP2PIds = new Set(); // prevents double-apply of p2p-order/trade transitions during block replay
    this._appliedStateTransitionHeights = new Set(); // prevents double-apply of brain/skill transitions on self-mined blocks
    this._gossipedJobTransitions = new Set(); // jobId:type keys — prevents duplicate pendingBrainTransitions from gossip
    this._activeJobId    = null; // job currently being computed (null = idle)
    this._pendingJobQueue = [];  // jobs waiting for the active slot, sorted by priority
    this._pendingProposals = new Map(); // auditJobId → { manifest, code, context, proposerAddress }

    // Future: TEE attestation could further strengthen these guarantees
    // (see docs/tee-protection-architecture.md)

    // Queue of high-quality ScanResults ready to be included in the next block
    this.pendingValidResults = [];

    // Submission history for pattern detection and strike system (software protection)
    this.submissionHistory = [];

    // Load persisted quality/reputation + history if available
    this._loadQualityState();

    // Resolve mining wallet — must be a PoH-native wallet (poh... address with a local private key).
    // solanaAddress in config is for future bridge/withdrawal only, never used as rewards recipient.
    const isNativePoH = addr => addr && addr.startsWith('poh');
    const candidateAddr = isNativePoH(this.config.pohWallet) ? this.config.pohWallet
                        : isNativePoH(this.config.wallet)    ? this.config.wallet
                        : null;

    // Try to load an existing native wallet; fall through to create if missing or stub (no privateKey).
    let resolvedWallet = candidateAddr ? this.walletManager.loadWallet(candidateAddr) : null;
    if (resolvedWallet && !resolvedWallet.privateKey) resolvedWallet = null; // stub wallet — no signing power

    if (!resolvedWallet) {
      // Look for any existing native wallet on disk
      const existing = this.walletManager.listWallets().filter(a => a.startsWith('poh'));
      if (existing.length > 0) {
        resolvedWallet = this.walletManager.loadWallet(existing[0]);
        if (resolvedWallet && !resolvedWallet.privateKey) resolvedWallet = null;
      }
    }

    if (!resolvedWallet) {
      resolvedWallet = this.walletManager.createWallet();
      console.log(`[PoH-Miner] Created new PoH wallet: ${resolvedWallet.address}`);
    }

    this.config.pohWallet = resolvedWallet.address;
    this.config.wallet    = resolvedWallet.address;
    this.identityWallet   = resolvedWallet;

    console.log(`[PoH-Miner] Mining wallet: ${resolvedWallet.address}`);

    // BrainSync initialized lazily after brain data dir is set (happens on first compute)
    this.brainSync = null; // populated in _initBrainSync()

    // Brain mutations buffered since last block — flushed into block.stateTransitions at mining time
    this.pendingBrainTransitions = [];

    // Skill staking: skillId → { total: number (μPOH), stakers: Map(address → amount) }
    this._skillStakes = new Map();
    this._appliedStakeTxs = new Set(); // txHashes of applied skill-staked/skill-unstaked transitions (prevents double-apply)
    this.SKILL_STAKE_VAULT = null; // address of stake vault wallet, set in _initStakeVault()

    // Per-node skill enable/disable: skills are disabled by default until explicitly enabled.
    // The four builtin skills below are enabled by default; everything else starts off.
    this._skillPrefs         = new Set(); // explicitly enabled skillIds
    this._explicitDisabled   = new Set(); // user-turned-off skills from the default-on set

    // IPFSSync — durability layer for chain + brain state
    this.ipfsSync = new IPFSSync({
      chain:          this.chain,          // live reference
      bootnodes:      this.config.bootnodes,
      identityWallet: this.identityWallet,
    });

    // Load built-in skills from src/skills/builtin/ and user skills from brain data dir
    loadAllSkills(getBrainDataDir());
    this._initStakeVault();
    this._loadSkillStakes();
    this._loadSkillPrefs();

    console.log(`[PoH-Miner] Starting node for wallet ${this.config.wallet}`);

    const mode = this.config.inferenceMode;
    const model = this.config.model;
    console.log(`[PoH-Miner] Inference mode: ${mode.toUpperCase()} | Model: ${model}`);

    // Benchmark compute speed (non-blocking)
    this.tflops = null;
    this._tflopsPromise = this.benchmarkTflops().then(t => { this.tflops = t; return t; }).catch(() => null);

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

  // Probe nvidia-smi across common install locations on Linux/Windows/Mac.
  // Quotes the path so Windows paths with spaces work.
  _runNvidiaSmi(args, opts = {}) {
    const candidates = [
      'nvidia-smi',
      '/usr/bin/nvidia-smi',
      '/usr/local/bin/nvidia-smi',
      '/opt/cuda/bin/nvidia-smi',
      'C:\\Windows\\System32\\nvidia-smi.exe',
      'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
    ];
    for (const p of candidates) {
      try {
        const cmd = p.includes(' ') ? `"${p}" ${args}` : `${p} ${args}`;
        return _execSync(cmd, { timeout: 6000, ...opts });
      } catch {}
    }
    return null;
  }

  // Query display adapters via wmic (Windows-only, works for NVIDIA/AMD/Intel).
  _wmicGpuNames() {
    if (process.platform !== 'win32') return [];
    try {
      const out = _execSync('wmic path win32_VideoController get Name /value', { timeout: 5000, encoding: 'utf8' });
      return out.split(/\r?\n/).filter(l => l.startsWith('Name=')).map(l => l.slice(5).trim().toLowerCase()).filter(Boolean);
    } catch { return []; }
  }

  // Detect GPU name on macOS using system_profiler (works on Intel + Apple Silicon).
  _macGpuName() {
    if (process.platform !== 'darwin') return null;
    try {
      // Apple Silicon — chip name from system_profiler
      if (process.arch === 'arm64') {
        const out = _execSync('system_profiler SPHardwareDataType', { timeout: 6000, encoding: 'utf8' });
        const m = out.match(/Chip:\s*Apple\s+(M\d+(?:\s+(?:Ultra|Max|Pro))?)/i);
        if (m) return `apple ${m[1].toLowerCase()}`; // e.g. "apple m2 pro"
        return 'apple m1'; // fallback if system_profiler format differs
      }
      // Intel Mac — GPU from display info
      const out = _execSync('system_profiler SPDisplaysDataType', { timeout: 6000, encoding: 'utf8' });
      const m = out.match(/Chipset Model:\s*(.+)/i);
      return m ? m[1].trim().toLowerCase() : null;
    } catch { return process.arch === 'arm64' ? 'apple m1' : null; }
  }

  async benchmarkTflops() {
    const GPU_TFLOPS = {
      // NVIDIA data-center
      'h200': 141.0, 'h100': 134.0, 'a100': 77.6,
      'l40s': 91.6, 'l40': 90.5, 'l4': 30.3, 'a40': 37.4, 'a10g': 31.2, 'a10': 31.2,
      'v100': 14.0, 't4': 8.1,
      // NVIDIA RTX 40xx (longer key first to avoid partial match)
      'rtx 4090': 82.6, 'rtx 4080 super': 52.2, 'rtx 4080': 48.7,
      'rtx 4070 ti super': 44.1, 'rtx 4070 ti': 40.1, 'rtx 4070 super': 35.5, 'rtx 4070': 29.1,
      'rtx 4060 ti': 22.1, 'rtx 4060': 15.1,
      // NVIDIA RTX 30xx
      'rtx 3090 ti': 40.0, 'rtx 3090': 35.6, 'rtx 3080 ti': 34.1, 'rtx 3080': 29.8,
      'rtx 3070 ti': 21.7, 'rtx 3070': 20.4, 'rtx 3060 ti': 16.2, 'rtx 3060': 12.7,
      // NVIDIA RTX 20xx / GTX
      'rtx 2080 ti': 13.4, 'rtx 2080 super': 11.2, 'rtx 2080': 10.6, 'rtx 2070': 7.5,
      'gtx 1080 ti': 11.3, 'gtx 1080': 8.9, 'gtx 1070': 6.5,
      // AMD Radeon RX 7xxx / 6xxx (longer key first)
      'rx 7900 xtx': 61.4, 'rx 7900 xt': 51.6, 'rx 7800 xt': 37.3, 'rx 7700 xt': 27.0,
      'rx 6950 xt': 23.7, 'rx 6900 xt': 23.0, 'rx 6800 xt': 20.7, 'rx 6800': 16.2,
      'rx 6750 xt': 13.9, 'rx 6700 xt': 13.2, 'rx 6700': 11.4,
      // Apple Silicon (GPU cores × peak TFLOPS FP32)
      'apple m3 ultra': 28.0, 'apple m3 max': 14.2, 'apple m3 pro': 7.4, 'apple m3': 3.6,
      'apple m2 ultra': 27.2, 'apple m2 max': 13.6, 'apple m2 pro': 6.8, 'apple m2': 3.4,
      'apple m1 ultra': 21.2, 'apple m1 max': 10.6, 'apple m1 pro': 5.3, 'apple m1': 2.6,
    };

    const lookupName = (name) => {
      for (const [key, tflops] of Object.entries(GPU_TFLOPS)) {
        if (name.includes(key)) return tflops;
      }
      return null;
    };

    // 1. NVIDIA via nvidia-smi (Linux / Windows / Mac with eGPU)
    const nvidiaRaw = this._runNvidiaSmi('--query-gpu=name --format=csv,noheader', { encoding: 'utf8' });
    if (nvidiaRaw) {
      const name = nvidiaRaw.trim().split('\n')[0].trim().toLowerCase();
      const found = lookupName(name);
      if (found) { console.log(`[PoH-Miner] TFLOPS: GPU "${name}" → ${found} TFLOPS`); return found; }
      // Unknown NVIDIA model — estimate from VRAM
      const vramRaw = this._runNvidiaSmi('--query-gpu=memory.total --format=csv,noheader,nounits', { encoding: 'utf8' });
      const vramMb = vramRaw ? parseInt(vramRaw.trim()) : 0;
      const est = vramMb >= 40000 ? 60 : vramMb >= 20000 ? 35 : vramMb >= 10000 ? 20 : vramMb >= 6000 ? 12 : 8;
      console.log(`[PoH-Miner] TFLOPS: GPU "${name}" (~${Math.round(vramMb/1024)}GB VRAM) → ~${est} TFLOPS`);
      return est;
    }

    // 2. macOS — Apple Silicon or Intel dGPU
    if (process.platform === 'darwin') {
      const macName = this._macGpuName();
      if (macName) {
        const found = lookupName(macName);
        if (found) { console.log(`[PoH-Miner] TFLOPS: Mac GPU "${macName}" → ${found} TFLOPS`); return found; }
      }
      if (process.arch === 'arm64') return 2.6; // conservative Apple Silicon fallback
    }

    // 3. Windows — AMD / Intel via wmic
    if (process.platform === 'win32') {
      for (const name of this._wmicGpuNames()) {
        const found = lookupName(name);
        if (found) { console.log(`[PoH-Miner] TFLOPS: GPU "${name}" → ${found} TFLOPS`); return found; }
      }
    }

    // 4. Linux AMD via rocm-smi
    try {
      const rocmOut = _execSync('rocm-smi --showproductname', { timeout: 5000, encoding: 'utf8' });
      const name = (rocmOut.match(/GPU\[\d+\]\s*:\s*Card series:\s*(.+)/i) || [])[1]?.trim().toLowerCase() || '';
      const found = lookupName(name);
      if (found) { console.log(`[PoH-Miner] TFLOPS: AMD GPU "${name}" → ${found} TFLOPS`); return found; }
      if (name) { console.log(`[PoH-Miner] TFLOPS: AMD GPU "${name}" (unknown model) → ~10 TFLOPS`); return 10; }
    } catch {}

    // 5. Linux Intel GPU via lspci (Iris Xe integrated + Arc discrete)
    if (process.platform === 'linux') {
      try {
        const INTEL_TFLOPS = {
          // Intel Arc discrete (longer keys first)
          'arc a770': 17.2, 'arc a750': 14.7, 'arc a580': 11.8, 'arc a380': 7.0, 'arc a310': 3.5,
          // Intel Iris Xe integrated (Alder Lake / Tiger Lake / Raptor Lake)
          'iris xe': 2.1,
          // Older Intel integrated
          'iris plus': 0.8, 'uhd 770': 0.9, 'uhd 750': 0.8, 'uhd 730': 0.7,
          'uhd 720': 0.6, 'uhd 710': 0.5, 'uhd graphics': 0.5,
        };
        const lspciOut = _execSync('lspci', { timeout: 4000, encoding: 'utf8' });
        const gpuLine = lspciOut.split('\n').find(l =>
          (l.includes('VGA') || l.includes('3D controller') || l.includes('Display controller')) &&
          l.toLowerCase().includes('intel')
        );
        if (gpuLine) {
          const gpuName = gpuLine.toLowerCase();
          for (const [key, tflops] of Object.entries(INTEL_TFLOPS)) {
            if (gpuName.includes(key)) {
              console.log(`[PoH-Miner] TFLOPS: Intel GPU "${gpuLine.trim()}" → ${tflops} TFLOPS`);
              return tflops;
            }
          }
          // Unknown Intel GPU — report minimal compute
          console.log(`[PoH-Miner] TFLOPS: Intel GPU detected (unknown model) → ~0.5 TFLOPS`);
          return 0.5;
        }
      } catch {}
    }

    // 6. CPU FP benchmark fallback
    const N = 512;
    const a = new Float64Array(N * N).fill(1.5);
    const b = new Float64Array(N * N).fill(0.7);
    const c = new Float64Array(N * N);
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < N; k++) {
        const aik = a[i * N + k];
        for (let j = 0; j < N; j++) c[i * N + j] += aik * b[k * N + j];
      }
    }
    const elapsed = (performance.now() - t0) / 1000;
    const tflops = Math.round((2 * N * N * N) / elapsed / 1e12 * 1000) / 1000;
    console.log(`[PoH-Miner] TFLOPS: CPU matmul → ${tflops} TFLOPS`);
    return tflops || 0.001;
  }

  async detectGpuCapability() {
    // NVIDIA — probe multiple paths (PATH may be stripped in pm2/systemd)
    const nvidiaRaw = this._runNvidiaSmi('--query-gpu=name --format=csv,noheader', { encoding: 'utf8' });
    if (nvidiaRaw) {
      return { available: true, type: `NVIDIA ${nvidiaRaw.trim().split('\n')[0].trim()}` };
    }

    // Apple Silicon (always has GPU)
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      const chip = this._macGpuName() || 'Apple Silicon';
      return { available: true, type: chip };
    }

    // Windows — AMD/Intel/other via wmic
    if (process.platform === 'win32') {
      const names = this._wmicGpuNames().filter(n => !n.includes('microsoft') && !n.includes('basic display'));
      if (names.length) return { available: true, type: names[0] };
    }

    // Linux AMD via rocm-smi
    try {
      _execSync('rocm-smi --showproductname', { stdio: 'ignore', timeout: 5000 });
      return { available: true, type: 'AMD ROCm' };
    } catch {}

    // Linux Intel GPU via lspci
    if (process.platform === 'linux') {
      try {
        const lspciOut = _execSync('lspci', { timeout: 4000, encoding: 'utf8' });
        const gpuLine = lspciOut.split('\n').find(l =>
          (l.includes('VGA') || l.includes('3D controller') || l.includes('Display controller')) &&
          l.toLowerCase().includes('intel')
        );
        if (gpuLine) {
          const match = gpuLine.match(/\[([^\]]+)\]$/) || gpuLine.match(/Intel[^:]*:(.*)/i);
          const gpuName = match ? match[1].trim() : 'Intel GPU';
          return { available: true, type: gpuName };
        }
      } catch {}
    }

    return { available: false, type: null };
  }

  /**
   * Ensures the miner has the minimum required RPC / API keys configured.
   * Without these, many signals in the real POH checker will fail or return poor data.
   */
  _validateRequiredApiKeys() {
    // All signals have public-endpoint fallbacks; missing keys are fine at startup.
    // We just log what's configured so it's visible in the debug log, nothing more.
    const hasSolanaRpc = !!(this.config.solanaRpc || process.env.SOLANA_RPC ||
      this.config.rpc?.solana?.apiKey);
    const hasEvmRpc    = Object.keys(this.config.rpcEndpoints || {}).length > 0 ||
      Object.keys(this.config.rpc || {}).some(k => k !== 'solana' && this.config.rpc[k]?.apiKey);
    const hasEtherscan = !!(this.config.etherscanApiKey || process.env.ETHERSCAN_API_KEY);

    console.log(
      `[PoH-Miner] API keys: solana=${hasSolanaRpc ? 'configured' : 'public fallback'} ` +
      `evm=${hasEvmRpc ? 'configured' : 'public fallback'} ` +
      `etherscan=${hasEtherscan ? 'configured' : 'not set (enrichment signals disabled)'}`
    );
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

    // 3b. Sync brain datasets from peers (non-blocking — best effort)
    {
      const brainDir = getBrainDataDir();
      if (brainDir && this.peers?.length) {
        pullDataset(this.peers, brainDir).catch(e => console.warn('[PoH-Miner] Dataset sync failed:', e.message));
      }
    }

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

  // ── Shared routing logic used by /chat/route and /chat/ask ───────────────
  //
  // Segment-based routing: split message at conjunctions ("and", "also", etc.),
  // match each segment to skills independently, cascade when multiple skills found.
  // web_search is the catch-all for informational segments with no specific skill match.
  // No LLM call needed — O(segments × skills) trigger matching scales to hundreds of skills.
  _routeMessage(message) {
    const allSkills = skillsManager.getAllSkills().filter(s => s.context && (s.status === 'active' || s.status === 'proposed'));
    if (!allSkills.length) return Promise.resolve({ type: 'chat' });

    // Extract global inputs (address / username present anywhere in the full message)
    const ADDR_RE   = /0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}/;
    const ENS_RE    = /\b([\w-]+\.eth)\b/i;
    const HANDLE_RE = /@([\w.-]+)/;
    const addrMatch   = message.match(ADDR_RE);
    const ensMatch    = message.match(ENS_RE);
    const handleMatch = message.match(HANDLE_RE);
    const globalInput = { message };
    if (addrMatch)   globalInput.address  = addrMatch[0];
    if (ensMatch)    globalInput.username  = ensMatch[1].replace(/\.eth$/i, '');
    else if (handleMatch) globalInput.username = handleMatch[1].replace(/\.eth$/i, '');

    // Split at conjunctions so each clause can be routed independently
    const SPLIT_RE = /\s*\b(?:and also|as well as|as well|and|also|plus|additionally)\b\s*[,;]?\s*/i;
    const segments = message.split(SPLIT_RE).map(s => s.trim()).filter(Boolean);

    // Short conversational filler — don't web-search these
    const CONVERSATIONAL_RE = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great|cool|got it|makes sense|sounds good|nice|perfect|good|bye|see you|lol|haha|awesome|interesting|are you|what is your|what's your|how are you)\b/i;

    const webSearchSkill = allSkills.find(s => s.id === 'web_search');
    const usedSkillIds   = new Set();
    const jobs           = [];

    for (const segment of segments) {
      const segLower = segment.toLowerCase();

      // Score every skill against this segment.
      // Multi-word triggers score proportional to their word count so
      // "blog posts" (2) beats "posts" (1) when both appear in the segment.
      const hits = allSkills
        .map(s => {
          let score = 0;
          for (const t of (s.triggers || [])) {
            if (segLower.includes(t.toLowerCase())) score += t.trim().split(/\s+/).length;
          }
          return { skill: s, score };
        })
        .filter(h => h.score > 0)
        .sort((a, b) => b.score - a.score);

      // Per-segment input — each segment gets its own query string
      const segInput = { ...globalInput, query: segment, message: segment };

      if (hits.length > 0) {
        // Pick the highest-scoring skill not already in this cascade
        const best = hits.find(h => !usedSkillIds.has(h.skill.id))?.skill;
        if (best) {
          usedSkillIds.add(best.id);
          // For social skills (farcaster, paragraph, zora, poh_identity): if no username
          // was extracted from the full message (no @handle), try the last bare word in
          // this segment as a username — covers "blog posts assetux" → username: "assetux"
          const SOCIAL_SKILLS = new Set(['read_farcaster','read_paragraph','read_zora','poh_identity']);
          const segJob = { skillId: best.id, input: { ...segInput }, skillContext: best.context || null };
          if (SOCIAL_SKILLS.has(best.id) && !segJob.input.username && !segJob.input.address) {
            const triggerWords = new Set((best.triggers || []).map(t => t.toLowerCase().split(/\s+/)).flat());
            const words = segment.split(/\s+/).filter(w => w.length >= 2 && !triggerWords.has(w.toLowerCase()));
            const candidate = words[words.length - 1]?.replace(/[^a-zA-Z0-9_.-]/g, '');
            if (candidate && candidate.length >= 2) {
              segJob.input.username = candidate.replace(/^@/, '');
              segJob.input.query    = candidate;
            }
          }
          jobs.push(segJob);
        }
      } else if (webSearchSkill && !usedSkillIds.has('web_search')
                 && !CONVERSATIONAL_RE.test(segment)
                 && segment.trim().split(/\s+/).length >= 2) {
        // Any substantive multi-word segment that no skill claimed → web_search catch-all
        usedSkillIds.add('web_search');
        jobs.push({ skillId: 'web_search', input: segInput, skillContext: webSearchSkill.context || null });
      }
    }

    if (jobs.length === 0)  return Promise.resolve({ type: 'chat' });
    if (jobs.length === 1)  return Promise.resolve({ type: 'skill', skillId: jobs[0].skillId, input: jobs[0].input, skillContext: jobs[0].skillContext, reason: 'segment match' });
    return Promise.resolve({ type: 'cascade', jobs, reason: `segment cascade: ${jobs.map(j => j.skillId).join(', ')}` });
  }

  _openFirewallPort(port) {
    const p = process.platform;
    const bin = process.execPath;
    try {
      if (p === 'darwin') {
        const fw = '/usr/libexec/ApplicationFirewall/socketfilterfw';
        _execSync(`"${fw}" --add "${bin}"`, { stdio: 'ignore', timeout: 5000 });
        _execSync(`"${fw}" --unblockapp "${bin}"`, { stdio: 'ignore', timeout: 5000 });
      } else if (p === 'linux') {
        try { _execSync(`ufw allow ${port}/tcp comment poh-miner`, { stdio: 'ignore', timeout: 5000 }); } catch {}
        try { _execSync(`iptables -C INPUT -p tcp --dport ${port} -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport ${port} -j ACCEPT`, { stdio: 'ignore', timeout: 5000 }); } catch {}
      } else if (p === 'win32') {
        _execSync(`netsh advfirewall firewall add rule name="PoH Miner API" dir=in action=allow protocol=TCP localport=${port}`, { stdio: 'ignore', timeout: 5000 });
      }
    } catch { /* no firewall access — OS may still allow it */ }
  }

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

      // Health probe used by SDK node-discovery (HEAD or GET /healthz)
      if (url.pathname === '/healthz') {
        return res.end(JSON.stringify({ status: 'ok', node: 'poh-miner' }));
      }

      if (req.method === 'GET' && url.pathname === '/api/miner/info') {
        const queueLength = this.jobResults
          ? Array.from(this.jobResults.values()).filter(r => ['queued', 'computing'].includes(r.status)).length
          : 0;
        const rep = feedbackStore.getReputation(this.config.wallet);
        return res.end(JSON.stringify({
          minerAddress:  this.config.wallet,
          gasPrice:      this.config.gasPrice || GAS.DEFAULT_GAS_PRICE,
          model:         this.config.model || 'qwen2.5:1.5b',
          queueLength,
          reputation:    rep,
        }));
      }

      if (url.pathname === '/api/wallet/balance') {
        const address = url.searchParams.get('address');
        if (!address) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'address required' }));
        }
        const balance = this.walletManager.getBalance(address);
        return res.end(JSON.stringify({ address, balance }));
      }

      if (url.pathname === '/api/wallet/nonce') {
        const address = url.searchParams.get('address');
        if (!address) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'address required' }));
        }
        const nonce = this.walletManager.getNonce(address);
        const pendingNonce = this.txMempool.accountPendingNonce.get(address) ?? nonce;
        return res.end(JSON.stringify({ address, nonce, pendingNonce }));
      }

      // Register an ed25519 signing public key for a wallet address.
      // Authenticated via a self-signature: proof = sign(address, signingPrivateKey).
      if (req.method === 'POST' && url.pathname === '/api/wallet/register-key') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const { address, signingPublicKey, proof } = JSON.parse(body);
            if (!address || !signingPublicKey || !proof) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'address, signingPublicKey, and proof required' }));
            }
            if (!Wallet.verifySignature(signingPublicKey, address, proof)) {
              res.statusCode = 403;
              return res.end(JSON.stringify({ error: 'invalid proof' }));
            }
            let wallet = this.walletManager.loadWallet(address);
            if (!wallet) {
              wallet = new Wallet({ address, privateKey: null, publicKey: null, createdAt: Date.now() });
            }
            wallet.signingPublicKey = signingPublicKey;
            this.walletManager.saveWallet(wallet);
            return res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
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

      // Balance journal history for the sidebar transaction feed
      if (url.pathname === '/api/wallet/history') {
        const address = url.searchParams.get('address') || (this.config.pohWallet || this.config.wallet);
        const limit   = parseInt(url.searchParams.get('limit') || '30', 10);
        const entries = (this.balanceJournal?._entries || [])
          .filter(e => !address || e.address === address)
          .slice(-limit)
          .reverse()
          .map(e => ({
            height:    e.height,
            delta:     e.delta,
            txHash:    e.txHash,
            ts:        e.ts,
            label:     e.delta > 0 ? (e.txHash?.startsWith('reward-') || e.txHash?.startsWith('coinbase') ? 'Mining reward' : 'Received') : 'Sent',
          }));
        return res.end(JSON.stringify({ address, entries }));
      }

      // Send endpoint — builds, signs, and submits a proper on-chain PoHTransaction.
      // For local wallets (created by this node) the signing key is on disk; for external
      // wallets that registered a key via /api/wallet/register-key this also works.
      if (req.method === 'POST' && url.pathname === '/api/wallet/send') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const { from, to, amount, fee = 0, memo = '' } = JSON.parse(body);
            const amt = Math.round(parseFloat(amount) * POH_DECIMALS);

            if (!from || !to || !amt || amt <= 0) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'Invalid parameters' }));
            }

            const senderWallet = this.walletManager.loadWallet(from);
            if (!senderWallet?.signingPublicKey || !senderWallet?.signingPrivateKey) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'Sender wallet has no signing key on this node. Use /api/wallet/register-key first.' }));
            }

            const confirmedNonce = this.walletManager.getNonce(from);
            const pendingNonce   = this.txMempool.accountPendingNonce.get(from) ?? confirmedNonce;
            const nonce = pendingNonce + 1;
            const tx = new PoHTransaction({ from, to, amount: amt, fee, nonce, memo });
            tx.sign(senderWallet);

            const submitResult = this.txMempool.submit(tx);
            if (submitResult !== true) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: submitResult.error || 'Transaction rejected by mempool' }));
            }

            // Gossip to peers so all miners can include it
            this.gossip.publish('new-tx', tx.toJSON()).catch(() => {});

            // Also relay directly to bootnodes — gossip peer records use "localhost"
            // (no POH_PUBLIC_HOST set), so P2P gossip stays local. Direct bootnode
            // relay ensures active miners on the public network see the tx.
            const txJSON = tx.toJSON();
            for (const bootnode of (this.config.bootnodes || [])) {
              fetch(`${bootnode}/api/tx/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(txJSON),
                signal: AbortSignal.timeout(5000),
              }).catch(() => {});
            }

            return res.end(JSON.stringify({ success: true, txHash: tx.txHash, status: 'pending', message: 'Transaction submitted to mempool' }));
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
            const parsed = JSON.parse(body);
            const { paymentTx, ...rawJob } = parsed;

            // Skill jobs must have a non-zero budget — the network charges for AI execution.
            // The default LLM chat is free, but skills (real-time data fetching) require a
            // fee that goes to the skill developer (20%) and the miner running it (80%).
            if (rawJob.type === 'skill' && !(rawJob.maxBudget > 0)) {
              res.statusCode = 402;
              return res.end(JSON.stringify({
                error: 'Skills require a fee (maxBudget > 0). The default LLM chat is free, but skill execution tips the developer and miner.',
                code: 'SKILL_FEE_REQUIRED',
              }));
            }

            // Payment validation (Phase 1: unverified allowed when no key registered)
            if (!rawJob.requesterAddress && rawJob.maxBudget > 0) {
              res.statusCode = 402;
              return res.end(JSON.stringify({ error: 'requesterAddress is required when maxBudget > 0' }));
            }

            if (rawJob.requesterAddress && rawJob.maxBudget > 0) {
              // Signature check
              let unverified = false;
              if (paymentTx?.txHash && paymentTx?.signature) {
                const senderWallet = this.walletManager.loadWallet(rawJob.requesterAddress);
                if (senderWallet?.signingPublicKey) {
                  const sigOk = Wallet.verifySignature(senderWallet.signingPublicKey, paymentTx.txHash, paymentTx.signature);
                  if (!sigOk) {
                    res.statusCode = 403;
                    return res.end(JSON.stringify({ error: 'Invalid payment signature' }));
                  }
                } else {
                  unverified = true; // key not registered yet
                }
              } else {
                unverified = true; // no sig provided
              }

              // Balance check
              const balance = this.walletManager.getBalance(rawJob.requesterAddress);
              if (balance < rawJob.maxBudget) {
                res.statusCode = 402;
                return res.end(JSON.stringify({ error: 'Insufficient balance', balance, required: rawJob.maxBudget }));
              }

              rawJob._paymentTxHash = paymentTx?.txHash || null;
              rawJob._unverified    = unverified;
            }

            // Normalize a bit
            const job = {
              id: rawJob.id || (url.pathname === '/test/job' ? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
              type: rawJob.type || 'verdict',
              payload: rawJob.payload || { address: rawJob.address },
              originCountry: rawJob.originCountry || rawJob.originRegion,
              source: 'api', // marks as local UI job — skip network slashing
              ...rawJob,
            };
            // Use maxBudget as fee when no explicit fee provided (budget slider → job priority)
            if (!job.fee) job.fee = job.maxBudget || 10_000_000;

            if (!job.payload?.address && job.type !== 'skill') {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'payload.address is required for verdict jobs' }));
            }

            // Skill jobs may not have an address — skip address-specific processing
            if (job.type !== 'skill' && job.payload?.address) {
              // Allow username/handle queries (e.g. "KsaRedFx") — real-poh adapter will
              // resolve via IdentityHub. Skip chain detection for non-address queries.
              const queryLooksLikeAddress = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}|(EQ|UQ)[A-Za-z0-9+/=_-]{46}|poh[0-9a-f]{40})$/i.test(job.payload.address.trim());
              const queryLooksLikeDomain = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(job.payload.address.trim()) && !queryLooksLikeAddress;

              // Auto-detect chain type from address format if no chainFilter was specified.
              if (!job.payload.chainFilter && queryLooksLikeAddress) {
                const addr = job.payload.address.trim();
                if (/^0x[0-9a-fA-F]{40}$/.test(addr)) job.payload.chainFilter = 'evm';
                else if (/^(1|3)[a-km-zA-HJ-NP-Z1-9]{24,33}$/.test(addr) || /^bc1[a-z0-9]{6,87}$/.test(addr)) job.payload.chainFilter = 'bitcoin';
                else if (/^(EQ|UQ)[A-Za-z0-9+/=_-]{46}$/.test(addr)) job.payload.chainFilter = 'ton';
                else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) job.payload.chainFilter = 'solana';
              }
            }

            console.log(`[PoH-Miner] Received job via ${url.pathname}: ${job.id} (${job.type}) for ${job.payload?.address || job.skillId || 'skill-job'}` + (job.payload?.chainFilter ? ` [chain:${job.payload.chainFilter}]` : ''));

            // Record for status polling immediately (non-blocking)
            this._recordJob(job);

            // Commit job submission to chain so all nodes have the full job history
            const jobSubmittedTransition = {
              type: 'job-submitted',
              jobId: job.id,
              jobType: job.type,
              address: job.payload?.address || null,
              skillId: job.skillId || null,
              requesterAddress: job.requesterAddress || null,
              maxBudget: job.maxBudget || 0,
              timestamp: Date.now(),
            };
            this.pendingBrainTransitions.push(jobSubmittedTransition);
            this._gossipedJobTransitions.add(`${job.id}:job-submitted`);
            // Gossip the transition so any node that wins the next block can include it
            this.gossip.publish('job-transition', jobSubmittedTransition).catch(() => {});

            // Emit escrow transition if this is a paid job
            if (job.requesterAddress && job.maxBudget > 0) {
              const activeSignals = this.methodsManager?.getActiveMethods().length || 0;
              const estTokens = job.estimatedTokens || estimateTokens(activeSignals, job.payload.address);
              const escrowTransition = {
                type:              'job-escrow',
                jobId:             job.id,
                requesterAddress:  job.requesterAddress,
                minerAddress:      this.config.wallet,
                amount:            job.maxBudget,
                maxWait:           job.maxWait,
                gasPrice:          this.config.gasPrice || GAS.DEFAULT_GAS_PRICE,
                estimatedTokens:   estTokens,
                paymentTxHash:     job._paymentTxHash || null,
                unverified:        job._unverified || false,
                timestamp:         Date.now(),
              };
              this.pendingBrainTransitions.push(escrowTransition);
              this._applyEscrow(escrowTransition);
            }

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

            // Broadcast all jobs to the network so miners can compete for compute.
            this.gossip.publish('new-job', job).catch(() => {});

            // Relay to peer miners via HTTP (gossip is in-process only, not P2P).
            // Skip when this job was already forwarded from a peer (_relayed flag)
            // to prevent relay loops.
            if (!job._relayed) {
              this._relayJobToPeers(job).catch(() => {});
            }

            // Enqueue — runs immediately if idle, queues otherwise
            this._enqueueJob(job);

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
          // Audit-rejected jobs are done but have no ScanResult — return rejection details directly
          if (rec.status === 'done' && rec.rejected) {
            return res.end(JSON.stringify({
              jobId: rec.id,
              status: 'done',
              verdict: 'REJECTED',
              rejected: true,
              reason: rec.reason || 'Dangerous code detected',
              issues: rec.issues || [],
            }));
          }
          if (rec.status !== 'done' || !rec.result) {
            // Check if a peer miner has already computed this job
            this._fetchJobResultFromPeers(jobId).then(peerResult => {
              if (peerResult) {
                rec.result = peerResult;
                rec.status = 'done';
                rec.updatedAt = Date.now();
                res.end(JSON.stringify({ jobId, ...peerResult, _fromPeer: true }));
              } else {
                res.statusCode = 202;
                res.end(JSON.stringify({
                  jobId: rec.id,
                  status: rec.status,
                  message: 'not ready yet',
                  poll: `/job/${jobId}/status`,
                }));
              }
            }).catch(() => {
              res.statusCode = 202;
              res.end(JSON.stringify({ jobId: rec.id, status: rec.status, message: 'not ready yet' }));
            });
            return;
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
            farcasterData: r.profile?.farcasterData || null,
            paragraphData: r.profile?.paragraphData || null,
            zoraData:      r.profile?.zoraData      || null,
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

      // ── Job Feedback endpoints ────────────────────────────────────────────────
      if (req.method === 'POST' && url.pathname.match(/^\/api\/jobs\/[^/]+\/feedback$/)) {
        const jobId = url.pathname.split('/')[3];
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const { rating, comment, requesterAddress, signature } = JSON.parse(body);
            if (!jobId || !rating || !['positive', 'negative'].includes(rating)) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'jobId and rating (positive|negative) required' }));
            }
            const rec = this._getJobRecord(jobId);
            if (!rec) {
              res.statusCode = 404;
              return res.end(JSON.stringify({ error: 'job not found' }));
            }
            if (comment && comment.length > 500) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'comment exceeds 500 chars' }));
            }
            if (feedbackStore.getByJob(jobId)) {
              res.statusCode = 409;
              return res.end(JSON.stringify({ error: 'feedback already recorded for this job' }));
            }
            const transition = {
              type:             'job-feedback',
              jobId,
              jobTxHash:        rec.job?.paymentTxHash || rec.job?._paymentTxHash || null,
              minerAddress:     this.config.wallet,
              requesterAddress: requesterAddress || rec.job?.requesterAddress || null,
              originalVerdict:  rec.result?.verdict || null,
              rating,
              comment:          (comment || '').slice(0, 500),
              timestamp:        Date.now(),
              signature:        signature || null,
              unverified:       !signature,
            };
            feedbackStore.apply(transition);
            this.pendingBrainTransitions.push(transition);
            // Immediately propagate to peers so reputation updates are near-real-time
            this.gossip.publish('job-feedback', transition).catch(() => {});
            // Slash own reputation if the negative feedback targets this node's work
            if (transition.rating === 'negative' && transition.minerAddress === this.config.wallet) {
              this.applySlashing(0.05);
              console.log(`[PoH-Miner] Reputation slashed (dislike on job ${jobId}): ${this.reputation.toFixed(3)}`);
            }
            return res.end(JSON.stringify({ ok: true, jobId, rating }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      if (req.method === 'GET' && url.pathname.match(/^\/api\/jobs\/[^/]+\/feedback$/)) {
        const jobId = url.pathname.split('/')[3];
        const fb = feedbackStore.getByJob(jobId);
        if (!fb) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'no feedback for this job' }));
        }
        return res.end(JSON.stringify(fb));
      }

      if (req.method === 'GET' && url.pathname.match(/^\/api\/miners\/[^/]+\/reputation$/)) {
        const minerAddr = url.pathname.split('/')[3];
        return res.end(JSON.stringify({ minerAddress: minerAddr, ...feedbackStore.getReputation(minerAddr) }));
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

      // ── Push notifications ────────────────────────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/api/push/register') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const { address, token, platform } = JSON.parse(body);
            if (!address || !token) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'address and token required' }));
            }
            this.pushTokens.set(address, { token, platform: platform || 'unknown', registeredAt: Date.now() });
            console.log(`[PoH-Miner] Push token registered for ${address.slice(0, 12)}… (${platform})`);
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // POST /api/push/send  { title, body, address? }
      // address omitted → broadcast to all registered wallets
      if (req.method === 'POST' && url.pathname === '/api/push/send') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const { title, body: msgBody, address, data } = JSON.parse(body);
            if (!title || !msgBody) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'title and body required' }));
            }

            // Pick target tokens
            const targets = address
              ? [this.pushTokens.get(address)?.token].filter(Boolean)
              : [...this.pushTokens.values()].map(r => r.token);

            if (!targets.length) {
              return res.end(JSON.stringify({ ok: true, sent: 0, reason: 'no registered tokens' }));
            }

            // Expo push API — sends up to 100 per request
            const messages = targets.map(t => ({
              to: t, title, body: msgBody,
              sound: 'default',
              data: data || {},
            }));

            let sent = 0;
            // Batch in chunks of 100 (Expo limit)
            for (let i = 0; i < messages.length; i += 100) {
              const chunk = messages.slice(i, i + 100);
              try {
                const r = await fetch('https://exp.host/--/api/v2/push/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                  body: JSON.stringify(chunk),
                  signal: AbortSignal.timeout(15000),
                });
                if (r.ok) sent += chunk.length;
              } catch { /* skip failed batch */ }
            }

            console.log(`[PoH-Miner] Push sent: "${title}" → ${sent}/${targets.length} tokens`);
            res.end(JSON.stringify({ ok: true, sent, total: targets.length }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/push/tokens') {
        const list = [...this.pushTokens.entries()].map(([addr, r]) => ({
          address: addr, platform: r.platform, registeredAt: r.registeredAt,
        }));
        return res.end(JSON.stringify({ tokens: list, count: list.length }));
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
          const fullState = brainDir && fs.existsSync(path.join(brainDir, 'brain_state.md'))
            ? fs.readFileSync(path.join(brainDir, 'brain_state.md'), 'utf8')
            : '';
          // ?full=1 returns complete state; default returns first 2000 chars for sidebar display
          const wantFull = url.searchParams?.get('full') === '1';
          const stateSummary = wantFull ? fullState : fullState.slice(0, 2000);
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

            // Buffer for inclusion in the next mined block
            this.pendingBrainTransitions.push({ type: 'brain-feedback', address, aiVerdict, correction, comment, signals });

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

            // Buffer for inclusion in the next mined block
            this.pendingBrainTransitions.push({ type: 'brain-weight', method, voteType, vote, stakeWeight, feedback });

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

      // ── Skills API (/api/skills/*) ────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/api/skills') {
        const walletParam = url.searchParams?.get('wallet') || null;
        const skills = skillsManager.getAllSkills().map(s => {
          const stakeInfo = this._skillStakes.get(s.id) || { total: 0, stakers: new Map() };
          const myStake = walletParam ? (stakeInfo.stakers?.get(walletParam) || 0) : 0;
          return { ...s, totalStaked: stakeInfo.total || 0, myStake, enabled: this.isSkillEnabled(s.id) };
        });
        return res.end(JSON.stringify({ skills, stakeVault: this.SKILL_STAKE_VAULT }));
      }

      // ── Skill prefs: GET /api/skills/prefs ───────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/api/skills/prefs') {
        return res.end(JSON.stringify({ enabled: [...this._skillPrefs] }));
      }

      // ── Skill enable/disable: POST /api/skills/:skillId/enable|disable ───────
      const skillToggleMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/(enable|disable)$/);
      if (req.method === 'POST' && skillToggleMatch) {
        const skillId = decodeURIComponent(skillToggleMatch[1]);
        const action  = skillToggleMatch[2];
        if (action === 'enable') {
          this._skillPrefs.add(skillId);
          this._explicitDisabled.delete(skillId); // un-mark any explicit disable
        } else {
          this._skillPrefs.delete(skillId);
          if (DEFAULT_ENABLED_SKILLS.has(skillId)) {
            this._explicitDisabled.add(skillId);  // remember this default was turned off
          }
        }
        this._saveSkillPrefs();
        return res.end(JSON.stringify({ ok: true, skillId, enabled: this.isSkillEnabled(skillId) }));
      }

      // ── Chat skill routing: POST /chat/route ─────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/chat/route') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const { message, budget = 0 } = JSON.parse(body);
            if (!message) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'message required' })); }
            const route = await this._routeMessage(message);
            return res.end(JSON.stringify({ ...route, budget }));
          } catch (err) {
            res.end(JSON.stringify({ type: 'chat', error: err.message }));
          }
        });
        return;
      }

      // ── Free chat + skill dispatch: POST /chat/ask ────────────────────────────
      // Routes the message; if a skill matches returns { type:'skill', skillId, input };
      // otherwise calls the local LLM and returns { type:'chat', message } — no fee.
      if (req.method === 'POST' && url.pathname === '/chat/ask') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const { message, history = [], model: reqModel } = JSON.parse(body);
            if (!message) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'message required' })); }

            const route = await this._routeMessage(message);

            if (route.type === 'skill') {
              const skillEntry = skillsManager.getSkill(route.skillId);
              // Builtin (private) skills run inline — no job queue, no fee required
              if (skillEntry?.private === true && skillEntry?.code) {
                try {
                  const { output } = await skillsManager.runSkill(route.skillId, route.input, this.config);
                  const ollamaBase = this.config.ollamaUrl || 'http://localhost:11434';
                  const selModel   = reqModel || this.config.model || 'qwen2.5:1.5b';
                  const systemContent = [
                    'You are a helpful assistant. Answer the user\'s question using the real-time data provided.',
                    'Rules:',
                    '- Write in clear, human-readable Markdown (use ## headings, **bold**, bullet points).',
                    '- NEVER output raw JSON, code blocks, or data structures in your answer.',
                    '- For search results: write a short summary paragraph, then list the top results as "- **Title** — snippet" bullets.',
                    '- For social/profile data: write a short natural-language summary.',
                    '- Be specific — mention names, numbers, sources from the data.',
                    '- If the data is empty or has no results, say so clearly and suggest rephrasing.',
                    skillEntry.context ? `\nSkill context (how to interpret the data):\n${skillEntry.context}` : '',
                  ].filter(Boolean).join('\n');
                  const dataStr = JSON.stringify(output, null, 2).slice(0, 6000);
                  const userContent = `Fetched data:\n${dataStr}\n\nUser question: ${message}`;
                  const llmRes = await fetch(`${ollamaBase}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: selModel, messages: [{ role: 'system', content: systemContent }, { role: 'user', content: userContent }], stream: false, options: { temperature: 0.7 } }),
                    signal: AbortSignal.timeout(40_000),
                  });
                  const llmData = await llmRes.json();
                  const llmReply = llmData.message?.content || '';
                  const reply = llmReply.trim() || _formatSkillOutputFallback(route.skillId, output);
                  return res.end(JSON.stringify({ type: 'chat', message: reply, skill: route.skillId }));
                } catch (e) {
                  console.warn('[chat/ask] inline skill error:', e.message);
                  // fall through to job routing
                }
              }
              return res.end(JSON.stringify({ type: 'skill', skillId: route.skillId, input: route.input, skillContext: route.skillContext }));
            }

            if (route.type === 'cascade') {
              // Run all cascade skills in parallel, then synthesize with LLM
              const jobResults = await Promise.allSettled(
                route.jobs.map(async job => {
                  const { output } = await skillsManager.runSkill(job.skillId, job.input, this.config);
                  return { skillId: job.skillId, output };
                })
              );
              const results = jobResults.map((r, i) => ({
                skillId: route.jobs[i].skillId,
                output: r.status === 'fulfilled' ? r.value.output : { error: r.reason?.message || 'skill failed' },
              }));

              const ollamaBase = this.config.ollamaUrl || 'http://localhost:11434';
              const selModel   = reqModel || this.config.model || 'qwen2.5:1.5b';
              const resultsBlock = results.map(r =>
                `[${r.skillId}]:\n${JSON.stringify(r.output, null, 2).slice(0, 1500)}`
              ).join('\n\n---\n\n');
              const synthPrompt = `The user asked: "${message.slice(0, 400)}"\n\nYou ran ${results.length} parallel skill lookups. Results:\n\n${resultsBlock}\n\nSynthesize all results into a clear, complete answer. Be concise and direct.`;
              try {
                const synthRes = await fetch(`${ollamaBase}/api/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ model: selModel, messages: [{ role: 'user', content: synthPrompt }], stream: false, options: { temperature: 0.7 } }),
                  signal: AbortSignal.timeout(40_000),
                });
                const synthData = await synthRes.json();
                const reply = synthData.message?.content || results.map(r => JSON.stringify(r.output)).join('\n\n');
                return res.end(JSON.stringify({ type: 'chat', message: reply, cascade: true, jobs: results }));
              } catch {
                return res.end(JSON.stringify({ type: 'chat', message: results.map(r => JSON.stringify(r.output, null, 2)).join('\n\n'), cascade: true, jobs: results }));
              }
            }

            // Free LLM answer (non-streaming so any client can use it)
            const ollamaBase = this.config.ollamaUrl || 'http://localhost:11434';
            const selModel   = reqModel || this.config.model || 'qwen2.5:1.5b';
            const messages   = [...history, { role: 'user', content: message }];
            const ollamaRes  = await fetch(`${ollamaBase}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: selModel, messages, stream: false, options: { temperature: 0.7 } }),
              signal: AbortSignal.timeout(40_000),
            });
            const data  = await ollamaRes.json();
            const reply = data.message?.content || '';
            return res.end(JSON.stringify({ type: 'chat', message: reply }));
          } catch (err) {
            const isUnavailable = err.name === 'AbortError' || err.name === 'TimeoutError'
              || (err.message || '').toLowerCase().includes('timeout')
              || (err.message || '').toLowerCase().includes('abort')
              || (err.message || '').toLowerCase().includes('connect');
            if (isUnavailable) {
              // Local Ollama unavailable — try a peer miner that has one
              try {
                const peerReply = await this._relayToPeerChat(message, history);
                if (peerReply) {
                  return res.end(JSON.stringify({ type: 'chat', message: peerReply, _fromPeer: true }));
                }
              } catch { /* ignore */ }
            }
            const fallback = isUnavailable
              ? 'Local LLM is unavailable and no peer miner could be reached. Try again shortly.'
              : 'Something went wrong. Please try again.';
            res.end(JSON.stringify({ type: 'chat', message: fallback }));
          }
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/skills/propose') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body);
            const { manifest, code, context, authorSignature, requesterAddress } = payload;
            const isPrivate = !!payload.private;
            if (!manifest?.id) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'manifest.id required' })); }

            // Public proposals cost 1,000 POH
            const PROPOSE_FEE = 1_000 * 1_000_000_000; // 1000 POH (9 decimals: 1 POH = 1e9)
            if (!isPrivate) {
              if (!requesterAddress) {
                res.statusCode = 402;
                return res.end(JSON.stringify({ error: 'requesterAddress required to pay the 1,000 POH proposal fee' }));
              }
              const balance = this.walletManager.getBalance(requesterAddress);
              if (balance < PROPOSE_FEE) {
                res.statusCode = 402;
                return res.end(JSON.stringify({ error: 'Insufficient balance', balance, required: PROPOSE_FEE }));
              }
              const ok = this.walletManager.debit(requesterAddress, PROPOSE_FEE);
              if (!ok) {
                res.statusCode = 402;
                return res.end(JSON.stringify({ error: 'Balance deduction failed' }));
              }
            }

            if (isPrivate) {
              // Private: store locally only — no gossip, no fee, no audit
              skillsManager.addPrivateSkill(manifest, code, context);
              return res.end(JSON.stringify({ ok: true, skillId: manifest.id, private: true }));
            }

            // Public proposal with code: publish as a code_audit network job so any miner can
            // run the audit and earn the 1,000 POH fee.  The skill is only broadcast after the
            // auditing miner returns a safe verdict.
            if (code) {
              const auditJobId = `audit-${manifest.id}-${Date.now()}`;
              const auditJob = {
                id:               auditJobId,
                type:             'skill',
                skillId:          'code_audit',
                payload:          { manifest, code, context, _isProposalAudit: true, proposerAddress: requesterAddress, authorSignature },
                fee:              PROPOSE_FEE,
                maxBudget:        PROPOSE_FEE,
                requesterAddress,
                source:           'network',
                createdAt:        Date.now(),
              };
              this._recordJob(auditJob); // also adds to jobQueue internally
              // Fee already debited above — set escrow manually so settlement can credit the auditing miner
              this.escrow.set(auditJobId, { amount: PROPOSE_FEE, requesterAddress, minerAddress: this.config.wallet });
              this._appliedEscrowJobIds.add(auditJobId); // prevent replay double-debit
              // Gossip the audit job so network miners compete (unlike ordinary skill jobs)
              this.gossip.publish('new-job', auditJob).catch(() => {});
              // Store pending proposal — completed by the auditing miner (possibly this node)
              this._pendingProposals.set(auditJobId, { manifest, code, context, authorSignature, proposerAddress: requesterAddress });
              // Fire local compute in background (this node competes too)
              setImmediate(() => this._processJobInBackground(auditJob).catch(() => {}));
              return res.end(JSON.stringify({ pending: true, jobId: auditJobId, skillId: manifest.id, message: 'Skill submitted for network security audit. 1,000 POH escrowed. Result will be broadcast once an auditing miner completes the job.' }));
            }

            // No sandboxed code (context-only skill) — publish immediately
            const transition = { type: 'skill-proposed', manifest, code, context, authorSignature, proposerAddress: requesterAddress || null, txHash: `skill-${manifest.id}-${Date.now()}` };
            // Audit fee goes to this miner since we're approving instantly (no LLM work required)
            this.walletManager.credit(this.config.wallet, PROPOSE_FEE);
            this.pendingBrainTransitions.push(transition);
            skillsManager.processTransition(transition);
            this.gossip.publish('skill-proposed', transition).catch(() => {});
            return res.end(JSON.stringify({ ok: true, skillId: manifest.id, private: false }));
          } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
        });
        return;
      }

      // ── Publish a private skill: POST /api/skills/:skillId/publish ────────────
      const skillPublishMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/publish$/);
      if (req.method === 'POST' && skillPublishMatch) {
        const skillId = decodeURIComponent(skillPublishMatch[1]);
        try {
          const transition = skillsManager.publishSkill(skillId);
          this.pendingBrainTransitions.push(transition);
          this.gossip.publish('skill-proposed', transition).catch(() => {});
          return res.end(JSON.stringify({ ok: true, skillId }));
        } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
        return;
      }

      // ── Skill stakes: GET /api/skills/:skillId/stakes ────────────────────────
      const skillStakesMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/stakes$/);
      if (req.method === 'GET' && skillStakesMatch) {
        const skillId = decodeURIComponent(skillStakesMatch[1]);
        const info = this._skillStakes.get(skillId) || { total: 0, stakers: new Map() };
        const stakers = Array.from((info.stakers || new Map()).entries()).map(([address, amount]) => ({ address, amount }));
        return res.end(JSON.stringify({ skillId, total: info.total || 0, stakers }));
      }

      // ── Skill stake: POST /api/skills/:skillId/stake ─────────────────────────
      const skillStakeMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/stake$/);
      if (req.method === 'POST' && skillStakeMatch) {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const skillId = decodeURIComponent(skillStakeMatch[1]);
            const { amount } = JSON.parse(body || '{}');
            if (!amount || amount <= 0) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'amount must be positive' })); }

            // Staker is always this node's own wallet — staking is a local-node action
            const stakerAddress = this.config.pohWallet || this.config.wallet;
            if (!stakerAddress) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'node wallet not initialized' })); }

            const amountRaw = Math.round(parseFloat(amount) * POH_DECIMALS);

            // Debit node wallet → credit stake vault. Balance change is immediate;
            // the on-chain record is the skill-staked stateTransition in the next block.
            if (!this.walletManager.debit(stakerAddress, amountRaw)) {
              res.statusCode = 400; return res.end(JSON.stringify({ error: 'insufficient balance' }));
            }
            if (this.SKILL_STAKE_VAULT) this.walletManager.credit(this.SKILL_STAKE_VAULT, amountRaw);
            const txHash = crypto.createHash('sha256')
              .update(`stake:${skillId}:${stakerAddress}:${amountRaw}:${Date.now()}`)
              .digest('hex');

            if (!this._skillStakes.has(skillId)) this._skillStakes.set(skillId, { total: 0, stakers: new Map() });
            const entry = this._skillStakes.get(skillId);
            entry.stakers.set(stakerAddress, (entry.stakers.get(stakerAddress) || 0) + amountRaw);
            entry.total = (entry.total || 0) + amountRaw;

            const GRADUATION_THRESHOLD = 10000 * POH_DECIMALS;
            if (entry.total >= GRADUATION_THRESHOLD) {
              const skill = skillsManager.getAllSkills().find(s => s.id === skillId);
              if (skill && skill.status !== 'active') {
                const transition = { type: 'skill-graduated', skillId };
                this.pendingBrainTransitions.push(transition);
                skillsManager.processTransition(transition);
              }
            }

            this._saveSkillStakes();
            const stakeTransition = { type: 'skill-staked', skillId, staker: stakerAddress, amount: amountRaw, txHash, ts: Date.now() };
            this.pendingBrainTransitions.push(stakeTransition);
            this._appliedStakeTxs.add(txHash);
            this.gossip.publish('skill-staked', { skillId, stakerAddress, amount: amountRaw, total: entry.total, txHash }).catch(() => {});
            console.log(`[PoH-Miner] Skill stake: ${(amountRaw / POH_DECIMALS).toFixed(2)} POH → ${skillId} (staker=${stakerAddress.slice(0,10)}…)`);
            return res.end(JSON.stringify({ ok: true, total: entry.total, myStake: entry.stakers.get(stakerAddress), txHash }));
          } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
        });
        return;
      }

      // ── Skill unstake: POST /api/skills/:skillId/unstake ─────────────────────
      const skillUnstakeMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/unstake$/);
      if (req.method === 'POST' && skillUnstakeMatch) {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const skillId = decodeURIComponent(skillUnstakeMatch[1]);
            const { amount } = JSON.parse(body || '{}');
            if (!amount || amount <= 0) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'amount must be positive' })); }

            const stakerAddress = this.config.pohWallet || this.config.wallet;
            if (!stakerAddress) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'node wallet not initialized' })); }

            const amountRaw = Math.round(parseFloat(amount) * POH_DECIMALS);
            const entry = this._skillStakes.get(skillId);
            const currentStake = entry?.stakers?.get(stakerAddress) || 0;
            if (currentStake < amountRaw) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'insufficient stake' })); }

            // Debit vault → credit node wallet back
            if (this.SKILL_STAKE_VAULT) this.walletManager.debit(this.SKILL_STAKE_VAULT, amountRaw);
            this.walletManager.credit(stakerAddress, amountRaw);
            const txHash = crypto.createHash('sha256')
              .update(`unstake:${skillId}:${stakerAddress}:${amountRaw}:${Date.now()}`)
              .digest('hex');

            entry.stakers.set(stakerAddress, currentStake - amountRaw);
            entry.total = Math.max(0, (entry.total || 0) - amountRaw);

            this._saveSkillStakes();
            const unstakeTransition = { type: 'skill-unstaked', skillId, staker: stakerAddress, amount: amountRaw, txHash, ts: Date.now() };
            this.pendingBrainTransitions.push(unstakeTransition);
            this._appliedStakeTxs.add(txHash);
            this.gossip.publish('skill-unstaked', { skillId, stakerAddress, amount: amountRaw, total: entry.total, txHash }).catch(() => {});
            console.log(`[PoH-Miner] Skill unstake: ${(amountRaw / POH_DECIMALS).toFixed(2)} POH returned from ${skillId} (staker=${stakerAddress.slice(0,10)}…)`);
            return res.end(JSON.stringify({ ok: true, total: entry.total, myStake: entry.stakers.get(stakerAddress), txHash }));
          } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
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

      // ── Chain serving (peer-to-peer sync) ────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/chain/tip') {
        const tip = this.chain[this.chain.length - 1];
        if (!tip) { res.statusCode = 404; res.end(JSON.stringify({ error: 'no chain' })); return; }
        res.end(JSON.stringify({ height: tip.height, hash: tip.getHashSync(), timestamp: tip.timestamp, chainWork: tip.chainWork || '0' }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/chain/blocks') {
        const from  = Math.max(0, parseInt(url.searchParams.get('from') || '0'));
        const to    = Math.min(this.chain.length - 1, parseInt(url.searchParams.get('to') || String(this.chain.length - 1)));
        const limit = 500; // cap per request to avoid OOM
        const slice = this.chain.slice(from, Math.min(to + 1, from + limit));
        res.end(JSON.stringify(slice.map(b => b.toJSON ? b.toJSON() : b)));
        return;
      }

      // ── Dataset serving (/api/dataset, /api/dataset/:file) ───────────────────
      {
        const brainDir = getBrainDataDir();
        if (brainDir && serveDataset(req, res, brainDir)) return;
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

      // ── P2P Exchange API (/api/p2p/*) ─────────────────────────────────────────

      // Helper: read + parse body
      const readBody = () => new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', c => raw += c);
        req.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
      });

      // Helper: verify that caller owns `address` by checking their ed25519 signature
      // over JSON.stringify({address, timestamp, ...actionFields}) using signingPublicKey.
      const verifyP2PAuth = (address, signingPublicKey, signature, payloadObj) => {
        if (!address || !signingPublicKey || !signature) return { error: 'missing auth fields' };
        if (Math.abs(Date.now() - (payloadObj.timestamp || 0)) > 5 * 60 * 1000) return { error: 'request expired' };
        const payloadStr = JSON.stringify(payloadObj);
        if (!Wallet.verifySignature(signingPublicKey, payloadStr, signature)) return { error: 'invalid signature' };
        const stored = this.walletManager.loadWallet(address);
        if (!stored) return { error: 'wallet not found on this node; connect your wallet first' };
        if (stored.signingPublicKey && stored.signingPublicKey !== signingPublicKey) {
          return { error: 'signing key mismatch' };
        }
        return true;
      };

      // GET /api/p2p/currencies — list supported quote currencies
      if (req.method === 'GET' && url.pathname === '/api/p2p/currencies') {
        return res.end(JSON.stringify({ currencies: QUOTE_CURRENCIES }));
      }

      // GET /api/p2p/orders — list open orders (filters: side, quoteCurrency)
      if (req.method === 'GET' && url.pathname === '/api/p2p/orders') {
        const side         = url.searchParams.get('side') || undefined;
        const quoteCurrency= url.searchParams.get('quoteCurrency') || undefined;
        const status       = url.searchParams.get('status') || 'open';
        const orders = this.p2pOrderStore.listOrders({ side, quoteCurrency, status });
        return res.end(JSON.stringify({ orders }));
      }

      // GET /api/p2p/orders/my?address=xxx — my orders
      if (req.method === 'GET' && url.pathname === '/api/p2p/orders/my') {
        const address = url.searchParams.get('address');
        if (!address) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'address required' })); }
        return res.end(JSON.stringify({ orders: this.p2pOrderStore.listMyOrders(address) }));
      }

      // GET /api/p2p/orders/:id
      const orderDetailMatch = url.pathname.match(/^\/api\/p2p\/orders\/([^/]+)$/);
      if (req.method === 'GET' && orderDetailMatch) {
        const order = this.p2pOrderStore.getOrder(orderDetailMatch[1]);
        if (!order) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'not found' })); }
        return res.end(JSON.stringify({ order }));
      }

      // POST /api/p2p/orders — create order
      if (req.method === 'POST' && url.pathname === '/api/p2p/orders') {
        readBody().then(body => {
          const { address, signingPublicKey, signature, timestamp, ...orderFields } = body;
          const auth = verifyP2PAuth(address, signingPublicKey, signature,
            { address, timestamp, action: 'create-order', side: orderFields.side, pohAmount: orderFields.pohAmount });
          if (auth !== true) { res.statusCode = 401; return res.end(JSON.stringify(auth)); }

          // For sell orders: lock POH in escrow now
          if (orderFields.side === 'sell') {
            const lockResult = this.p2pEscrow.lock(this.walletManager, address, orderFields.pohAmount);
            if (lockResult !== true) { res.statusCode = 400; return res.end(JSON.stringify(lockResult)); }
          }

          const result = this.p2pOrderStore.createOrder({ maker: address, ...orderFields });
          if (result.error) {
            // Refund escrow if order creation failed after locking
            if (orderFields.side === 'sell') this.p2pEscrow.release(this.walletManager, address, orderFields.pohAmount);
            res.statusCode = 400; return res.end(JSON.stringify(result));
          }

          result.order.escrowLocked = (orderFields.side === 'sell');
          this.p2pOrderStore._patchOrder(result.order.id, { escrowLocked: result.order.escrowLocked });
          this._appliedP2PIds.add(`order-${result.order.id}`);
          this.pendingBrainTransitions.push({ type: 'p2p-order-created', ...result.order });
          this.gossip.publish('p2p-order', result.order).catch(() => {});
          return res.end(JSON.stringify(result));
        }).catch(e => { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); });
        return;
      }

      // POST /api/p2p/orders/:id/cancel
      const orderActionMatch = url.pathname.match(/^\/api\/p2p\/orders\/([^/]+)\/([^/]+)$/);
      if (req.method === 'POST' && orderActionMatch) {
        const [, orderId, action] = orderActionMatch;

        if (action === 'cancel') {
          readBody().then(body => {
            const { address, signingPublicKey, signature, timestamp } = body;
            const auth = verifyP2PAuth(address, signingPublicKey, signature,
              { address, timestamp, action: 'cancel-order', orderId });
            if (auth !== true) { res.statusCode = 401; return res.end(JSON.stringify(auth)); }

            const order = this.p2pOrderStore.getOrder(orderId);
            if (!order) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'order not found' })); }
            if (order.maker !== address) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'not your order' })); }

            // Capture before cancelOrder mutates the object in-place via Object.assign
            const { side: orderSide, escrowLocked: wasEscrowLocked, pohAmount: orderPohAmount } = order;

            const result = this.p2pOrderStore.cancelOrder(orderId);
            if (result.error) { res.statusCode = 400; return res.end(JSON.stringify(result)); }

            // Refund escrow for sell orders
            if (orderSide === 'sell' && wasEscrowLocked) {
              this.p2pEscrow.release(this.walletManager, address, orderPohAmount);
            }
            // Refund escrow for buy orders where taker locked (handled in trade cancel)
            this._appliedP2PIds.add(`order-cancel-${orderId}`);
            this.pendingBrainTransitions.push({ type: 'p2p-order-cancelled', orderId, maker: address, side: orderSide, escrowLocked: wasEscrowLocked, pohAmount: orderPohAmount, updatedAt: Date.now() });
            this.gossip.publish('p2p-order', result.order).catch(() => {});
            return res.end(JSON.stringify(result));
          }).catch(e => { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); });
          return;
        }

        // POST /api/p2p/orders/:id/select — taker selects order
        if (action === 'select') {
          readBody().then(body => {
            const { address, signingPublicKey, signature, timestamp, pohAmount, quoteAmount } = body;
            const auth = verifyP2PAuth(address, signingPublicKey, signature,
              { address, timestamp, action: 'select-order', orderId, pohAmount, quoteAmount });
            if (auth !== true) { res.statusCode = 401; return res.end(JSON.stringify(auth)); }

            const order = this.p2pOrderStore.getOrder(orderId);
            if (!order) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'order not found' })); }

            // For buy orders: taker is selling POH, so lock taker's POH in escrow
            if (order.side === 'buy') {
              const lockResult = this.p2pEscrow.lock(this.walletManager, address, pohAmount);
              if (lockResult !== true) { res.statusCode = 400; return res.end(JSON.stringify(lockResult)); }
            }

            const result = this.p2pOrderStore.selectOrder(orderId, { taker: address, pohAmount, quoteAmount });
            if (result.error) {
              if (order.side === 'buy') this.p2pEscrow.release(this.walletManager, address, pohAmount);
              res.statusCode = 400; return res.end(JSON.stringify(result));
            }

            this._appliedP2PIds.add(`trade-${result.trade.id}`);
            this.pendingBrainTransitions.push({ type: 'p2p-trade-created', ...result.trade, orderSide: order.side });
            this.gossip.publish('p2p-order', this.p2pOrderStore.getOrder(orderId)).catch(() => {});
            this.gossip.publish('p2p-trade', result.trade).catch(() => {});
            return res.end(JSON.stringify(result));
          }).catch(e => { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); });
          return;
        }
      }

      // GET /api/p2p/trades/my?address=xxx
      if (req.method === 'GET' && url.pathname === '/api/p2p/trades/my') {
        const address = url.searchParams.get('address');
        if (!address) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'address required' })); }
        const trades = this.p2pOrderStore.listMyTrades(address).map(t => ({
          ...t,
          order: this.p2pOrderStore.getOrder(t.orderId),
        }));
        return res.end(JSON.stringify({ trades }));
      }

      // GET /api/p2p/trades/:id
      const tradeDetailMatch = url.pathname.match(/^\/api\/p2p\/trades\/([^/]+)$/);
      if (req.method === 'GET' && tradeDetailMatch) {
        const trade = this.p2pOrderStore.getTrade(tradeDetailMatch[1]);
        if (!trade) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'not found' })); }
        const order = this.p2pOrderStore.getOrder(trade.orderId);
        return res.end(JSON.stringify({ trade, order }));
      }

      // POST /api/p2p/trades/:id/:action
      const tradeActionMatch = url.pathname.match(/^\/api\/p2p\/trades\/([^/]+)\/([^/]+)$/);
      if (req.method === 'POST' && tradeActionMatch) {
        const [, tradeId, action] = tradeActionMatch;

        readBody().then(body => {
          const { address, signingPublicKey, signature, timestamp, reason } = body;
          const auth = verifyP2PAuth(address, signingPublicKey, signature,
            { address, timestamp, action, tradeId });
          if (auth !== true) { res.statusCode = 401; return res.end(JSON.stringify(auth)); }

          const trade = this.p2pOrderStore.getTrade(tradeId);
          if (!trade) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'trade not found' })); }
          const order = this.p2pOrderStore.getOrder(trade.orderId);

          if (action === 'payment-sent') {
            // Only the taker (for sell orders) or maker (for buy orders) marks payment sent
            const payer = order?.side === 'sell' ? trade.taker : order?.maker;
            if (address !== payer) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'not the payer' })); }
            const result = this.p2pOrderStore.markPaymentSent(tradeId);
            if (result.error) { res.statusCode = 400; return res.end(JSON.stringify(result)); }
            this._appliedP2PIds.add(`trade-${tradeId}-payment-sent`);
            this.pendingBrainTransitions.push({ type: 'p2p-trade-payment-sent', tradeId, updatedAt: Date.now() });
            this.gossip.publish('p2p-trade', result.trade).catch(() => {});
            return res.end(JSON.stringify(result));
          }

          if (action === 'release') {
            // Seller releases escrow → POH goes to buyer
            // Sell order: maker is seller, taker is buyer. Maker releases to taker.
            // Buy order: taker is seller, maker is buyer. Taker releases to maker.
            const releaser = order?.side === 'sell' ? order?.maker : trade.taker;
            const recipient = order?.side === 'sell' ? trade.taker : order?.maker;
            if (address !== releaser) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'not authorized to release' })); }

            const releaseResult = this.p2pEscrow.release(this.walletManager, recipient, trade.pohAmount);
            if (releaseResult !== true) { res.statusCode = 400; return res.end(JSON.stringify(releaseResult)); }

            const result = this.p2pOrderStore.completeTrade(tradeId);
            if (result.error) { res.statusCode = 400; return res.end(JSON.stringify(result)); }
            this._appliedP2PIds.add(`trade-${tradeId}-release`);
            this.pendingBrainTransitions.push({ type: 'p2p-trade-release', tradeId, recipient, pohAmount: trade.pohAmount, updatedAt: Date.now() });
            this.gossip.publish('p2p-trade', result.trade).catch(() => {});
            this.gossip.publish('p2p-order', this.p2pOrderStore.getOrder(trade.orderId)).catch(() => {});
            return res.end(JSON.stringify(result));
          }

          if (action === 'cancel') {
            const canCancel = address === trade.taker || (order && address === order.maker);
            if (!canCancel) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'not a trade participant' })); }

            // Refund escrow to the party who locked.
            // Sell orders: maker locked at order creation (escrowLocked flag).
            // Buy orders: taker locked at selectOrder time (no flag on order).
            const locker = order?.side === 'sell' ? order?.maker : trade.taker;
            const lockAmt = trade.pohAmount;
            const hadEscrow = order?.side === 'sell' ? !!order?.escrowLocked : true;
            if (hadEscrow) {
              this.p2pEscrow.release(this.walletManager, locker, lockAmt);
            }
            const result = this.p2pOrderStore.cancelTrade(tradeId);
            if (result.error) { res.statusCode = 400; return res.end(JSON.stringify(result)); }
            this._appliedP2PIds.add(`trade-${tradeId}-cancel`);
            this.pendingBrainTransitions.push({ type: 'p2p-trade-cancel', tradeId, locker, pohAmount: lockAmt, escrowLocked: hadEscrow, updatedAt: Date.now() });
            this.gossip.publish('p2p-trade', result.trade).catch(() => {});
            this.gossip.publish('p2p-order', this.p2pOrderStore.getOrder(trade.orderId)).catch(() => {});
            return res.end(JSON.stringify(result));
          }

          if (action === 'dispute') {
            const canDispute = address === trade.taker || (order && address === order.maker);
            if (!canDispute) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'not a trade participant' })); }
            const result = this.p2pOrderStore.disputeTrade(tradeId, { reason });
            if (result.error) { res.statusCode = 400; return res.end(JSON.stringify(result)); }
            this._appliedP2PIds.add(`trade-${tradeId}-dispute`);
            this.pendingBrainTransitions.push({ type: 'p2p-trade-dispute', tradeId, reason: reason || '', updatedAt: Date.now() });
            this.gossip.publish('p2p-trade', result.trade).catch(() => {});
            return res.end(JSON.stringify(result));
          }

          res.statusCode = 400;
          res.end(JSON.stringify({ error: `unknown action: ${action}` }));
        }).catch(e => { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); });
        return;
      }

      // POST /api/p2p/local-auth — sign a P2P auth payload using the local node wallet
      // Renderer calls this to get a signed auth token without needing the private key.
      if (req.method === 'POST' && url.pathname === '/api/p2p/local-auth') {
        readBody().then(body => {
          const wallet = this.identityWallet;
          if (!wallet?.signingPublicKey || !wallet?.sign) {
            res.statusCode = 503;
            return res.end(JSON.stringify({ error: 'signing key not available' }));
          }
          const { action, ...extraFields } = body;
          if (!action) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'action required' })); }
          const timestamp = Date.now();
          const address = wallet.address;
          const payloadObj = { address, timestamp, action, ...extraFields };
          const signature = wallet.sign(JSON.stringify(payloadObj));
          return res.end(JSON.stringify({
            address,
            signingPublicKey: wallet.signingPublicKey,
            signature,
            timestamp,
          }));
        }).catch(e => { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); });
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
      this._openFirewallPort(port);
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
        timestamp: 1780700000000,
        minerWallet: 'bootnode-genesis',
        difficulty: this.currentDifficulty,
      });
      this.chain.push(genesis);
      this.chainStore.saveChain(this.chain);

      // Apply genesis allocations from config: { genesisAlloc: { "poh123...": 1000000000 } }
      // Amounts are in raw POH units (1 POH = 1e9 raw).
      const alloc = this.config.genesisAlloc;
      if (alloc && typeof alloc === 'object') {
        for (const [address, amount] of Object.entries(alloc)) {
          const raw = Number(amount);
          if (raw > 0) {
            this.walletManager.credit(address, raw);
            console.log(`[PoH-Miner] Genesis alloc: ${address} +${raw} (${(raw / 1e9).toFixed(4)} POH)`);
          }
        }
      }
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

    // 5. Layer 4: cold-start brain sync — find latest state-snapshot in chain and apply
    await this._applyColdStartBrainSnapshot();

    console.log(`[PoH-Miner] Synced to height ${this.chain.length - 1}`);
  }

  async _applyColdStartBrainSnapshot() {
    // Walk chain backwards to find the most recent state-snapshot stateTransition
    let snapshotCID = null;
    let snapshotHeight = -1;
    for (let i = this.chain.length - 1; i >= 0; i--) {
      const block = this.chain[i];
      const snap = (block.stateTransitions || []).find(t => t.type === 'state-snapshot' && t.brainCID);
      if (snap) { snapshotCID = snap.brainCID; snapshotHeight = block.height; break; }
    }
    if (!snapshotCID) return;

    const brainDir = getBrainDataDir();
    if (!brainDir) return;

    try {
      const snap = await this.ipfsSync.store.getJSON(snapshotCID);
      if (!snap?.weights) return;
      // Write weights (and pools if present) from snapshot
      fs.writeFileSync(path.join(brainDir, 'weights.json'), JSON.stringify(snap.weights, null, 2));
      if (snap.pools) fs.writeFileSync(path.join(brainDir, 'pools.json'), JSON.stringify(snap.pools, null, 2));
      console.log(`[PoH-Miner] Cold-start: applied brain snapshot from height ${snapshotHeight} (CID ${snapshotCID.slice(0, 16)}…)`);

      // Replay any stateTransitions from snapshotHeight+1 to tip
      const brain = await getBrain().catch(() => null);
      if (brain && this.brainSync) {
        for (let i = snapshotHeight + 1; i < this.chain.length; i++) {
          for (const t of (this.chain[i].stateTransitions || [])) {
            if (t.type === 'brain-feedback' || t.type === 'brain-weight') {
              await this.processStateTransition(t).catch(() => {});
            }
          }
        }
      }
    } catch (e) {
      console.warn('[PoH-Miner] Cold-start brain sync failed:', e.message);
    }
  }

  async syncFromBootnodes() {
    // Build a candidate list: registered peers first, then bootnodes
    const candidates = [];

    // 1. Query bootnode(s) for known peers — they expose host:walletApiPort
    for (const bootnode of (this.config.bootnodes || [])) {
      try {
        const base = bootnode.endsWith('/') ? bootnode : bootnode + '/';
        const r = await fetch(`${base}peers`, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) continue;
        const { peers } = await r.json();
        for (const p of (peers || [])) {
          if (p.host && p.walletApiPort && p.host !== 'localhost' && p.host !== '127.0.0.1') {
            candidates.push({ label: p.wallet?.slice(0, 8) ?? p.host, base: `http://${p.host}:${p.walletApiPort}` });
          }
        }
      } catch { /* bootnode unreachable */ }
    }

    // 2. Also try bootnodes directly (they accumulate blocks via /submit-block)
    for (const bootnode of (this.config.bootnodes || [])) {
      const base = bootnode.endsWith('/') ? bootnode : bootnode + '/';
      candidates.push({ label: bootnode, base: bootnode.replace(/\/$/, '') });
    }

    if (!candidates.length) {
      console.log('[PoH-Miner] No sync candidates found');
      return;
    }
    console.log(`[PoH-Miner] [Sync] ${candidates.length} candidates — querying tips…`);

    // 3. Find the candidate with the most chainWork (heaviest chain) across the whole network
    let bestHeight = -1;
    let bestBase   = null;
    let bestLabel  = null;
    let bestWork   = '0';

    await Promise.allSettled(candidates.map(async c => {
      try {
        const r = await fetch(`${c.base}/chain/tip`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) { console.log(`[PoH-Miner] [Sync] ${c.base} tip → non-ok ${r.status}`); return; }
        const tip = await r.json();
        const work = tip.chainWork || '0';
        console.log(`[PoH-Miner] [Sync] ${c.label ?? c.base} height=${tip.height} work=${work}`);
        if (compareChainWork(work, bestWork) > 0) {
          bestHeight = tip.height ?? -1;
          bestBase   = c.base;
          bestLabel  = c.label;
          bestWork   = work;
        }
      } catch (e) { console.log(`[PoH-Miner] [Sync] ${c.base} tip fail: ${e.message}`); }
    }));
    const localWork = getTipChainWork(this.chain);
    console.log(`[PoH-Miner] [Sync] best=${bestLabel} height=${bestHeight} work=${bestWork} | local work=${localWork}`);

    // 3b. Fork detection: compare our block at min(local, peer) height against the peer's.
    // Covers two cases:
    //   - local LONGER than peer: compare peer's tip against our block at same height
    //   - local SHORTER than peer: compare our current tip against peer's block at same height
    // A hash mismatch in either case means we're on a stale fork and must reset.
    let isFork = false;
    let forkCheckHeight = -1;
    // Use actual block height, not array index — chain may be truncated to last N blocks on disk
    const chainOffset    = this.chain[0]?.height ?? 0;
    const localChainHeight = this.chain.length > 0 ? this.chain[this.chain.length - 1].height : -1;
    if (bestBase && bestHeight >= 1 && localChainHeight >= 1) {
      forkCheckHeight = Math.min(localChainHeight, bestHeight);
      try {
        const r = await fetch(`${bestBase}/chain/blocks?from=${forkCheckHeight}&to=${forkCheckHeight}`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const blocks = await r.json();
          if (Array.isArray(blocks) && blocks.length > 0) {
            const peerBlock  = PohBlock.fromJSON ? PohBlock.fromJSON(blocks[0]) : new PohBlock(blocks[0]);
            const peerHash   = peerBlock.getHashSync();
            const localBlock = this.chain[forkCheckHeight - chainOffset];
            const localHash  = localBlock?.getHashSync();
            if (localHash && peerHash !== localHash) {
              isFork = true;
              console.warn(`[PoH-Miner] Fork detected at block ${forkCheckHeight} (local: ${localHash.slice(0, 8)}… vs peer: ${peerHash.slice(0, 8)}…) — wiping local chain and resyncing`);
            }
          }
        }
      } catch { /* ignore — proceed without fork flag */ }
    }

    // 3c. Genesis check: if the peer's block 0 hash differs from ours, it's a completely
    // different network — never sync from it, regardless of chainWork.
    if (bestBase && this.chain.length > 0) {
      const localGenesis     = this.chain.find(b => b.height === 0) ?? this.chain[0];
      const localGenesisHash = localGenesis?.getHashSync();
      if (localGenesisHash) {
        try {
          const r = await fetch(`${bestBase}/chain/blocks?from=0&to=0`, { signal: AbortSignal.timeout(5000) });
          if (r.ok) {
            const blocks = await r.json();
            if (Array.isArray(blocks) && blocks.length > 0) {
              const peerGenesis     = PohBlock.fromJSON ? PohBlock.fromJSON(blocks[0]) : new PohBlock(blocks[0]);
              const peerGenesisHash = peerGenesis.getHashSync();
              if (peerGenesisHash !== localGenesisHash) {
                console.error(`[PoH-Miner] ⛔ GENESIS MISMATCH — peer ${bestLabel} is on a different network!`);
                console.error(`[PoH-Miner]    local genesis: ${localGenesisHash}`);
                console.error(`[PoH-Miner]    peer  genesis: ${peerGenesisHash}`);
                console.error(`[PoH-Miner]    Refusing to sync. Wipe ~/.poh-miner/chain if you intend to join a new network.`);
                return;
              }
              console.log(`[PoH-Miner] [Sync] Genesis hash verified ✓ (${localGenesisHash.slice(0, 12)}…)`);
            }
          }
        } catch (e) {
          console.warn(`[PoH-Miner] [Sync] Could not verify genesis hash against ${bestLabel}: ${e.message}`);
        }
      }
    }

    // 4. IPFS fallback if no live peer has a longer chain
    if (!bestBase && this.ipfsSync) {
      const snap = await this.ipfsSync.fetchChainSnapshot();
      if (snap?.blocks?.length && snap.height > localChainHeight) {
        console.log(`[PoH-Miner] Applying IPFS chain snapshot (height ${snap.height})`);
        try {
          let valid = true;
          const blocks = snap.blocks.map(b => PohBlock.fromJSON ? PohBlock.fromJSON(b) : new PohBlock(b));
          for (let i = 1; i < blocks.length; i++) {
            if (blocks[i].previousHash !== blocks[i - 1].getHashSync()) { valid = false; break; }
          }
          if (valid) {
            this.chain = blocks;
            this.chainStore.saveChain(this.chain);
            for (const b of this.chain) {
              for (const r of (b.scanResults || [])) {
                if (r.requestId) this.minedRequestIds.add(r.requestId);
              }
            }
            console.log(`[PoH-Miner] IPFS sync: now at height ${snap.height}`);
          }
        } catch (e) { console.warn('[PoH-Miner] IPFS chain apply failed:', e.message); }
      }
      return;
    }

    if (!bestBase) { console.log('[PoH-Miner] [Sync] no reachable peer found — aborting'); return; }

    // 5. Download blocks in chunks of 500
    // On a fresh start (only genesis locally) download from 0 and replace the whole
    // chain — this handles any genesis-hash divergence from previous runs cleanly.
    const CHUNK = 500;
    // Heaviest-chain rule: only sync if the best peer has strictly more chainWork.
    // Height alone is misleading — a fork with lower difficulty can have more blocks but less work.
    if (compareChainWork(bestWork, localWork) <= 0 && !isFork) {
      console.log(`[PoH-Miner] [Sync] local chain has equal or more chainWork — keeping`);
      return;
    }

    // Determine sync mode:
    //   - incremental: peer is simply ahead, append new blocks
    //   - partial reorg: competing tip (fork at local tip only), keep common prefix and download tail
    //   - full fresh start: deep fork or genesis-only local chain
    const isFreshStart = this.chain.length <= 1 || isFork;
    let localHeight = -1;
    if (!isFreshStart) {
      localHeight = localChainHeight;  // incremental from actual tip height
    } else if (isFork && (bestHeight - localChainHeight) <= 50 && localChainHeight > 0) {
      // Short fork (peer at most 50 blocks ahead): try partial reorg from the fork point.
      // If the anchor check fails (fork is deeper than expected), the mismatch handler
      // re-downloads the full chain from genesis as a fallback.
      localHeight = forkCheckHeight - 1;
    }
    // else: full fresh start (localHeight stays -1, downloads from genesis)
    // Save before the download loop mutates localHeight — used for anchor lookup after download.
    const anchorHeight = localHeight;

    // Nothing to do: peer not taller and not a fork
    if (bestHeight <= localChainHeight && !isFork && compareChainWork(bestWork, localWork) <= 0) return;

    const syncModeLabel = !isFreshStart ? '' : localHeight >= 0 ? ` [fork reorg from ${localHeight + 1}]` : ' [fresh start — replacing chain from 0]';
    console.log(`[PoH-Miner] Syncing from ${bestLabel} (peer height ${bestHeight}, local ${localChainHeight})${syncModeLabel}`);

    const downloadedBlocks = [];
    while (localHeight < bestHeight) {
      const from = localHeight + 1;
      const to   = Math.min(from + CHUNK - 1, bestHeight);
      try {
        const r = await fetch(`${bestBase}/chain/blocks?from=${from}&to=${to}`, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) break;
        const blocks = await r.json();
        if (!Array.isArray(blocks) || blocks.length === 0) break;
        if (isFreshStart) {
          downloadedBlocks.push(...blocks);
        } else {
          let added = 0;
          for (const bd of blocks) {
            const block = PohBlock.fromJSON ? PohBlock.fromJSON(bd) : new PohBlock(bd);
            const prev  = this.chain[this.chain.length - 1];
            // Use block.height (not array index) so truncated chains work correctly
            if (block.previousHash === prev.getHashSync() && block.height === prev.height + 1) {
              this._applyBlockState(block);
              this.chain.push(block);
              this.currentDifficulty = getNextDifficulty(this.chain);
              added++;
            }
          }
          if (!added) break;
        }
        localHeight = to;
      } catch (e) {
        console.warn(`[PoH-Miner] Chunk fetch failed:`, e.message);
        break;
      }
    }

    if (isFreshStart && downloadedBlocks.length > 0) {
      const parsed = downloadedBlocks.map(b => PohBlock.fromJSON ? PohBlock.fromJSON(b) : new PohBlock(b));
      // Verify internal linkage of downloaded segment
      let valid = true;
      for (let i = 1; i < parsed.length; i++) {
        if (parsed[i].previousHash !== parsed[i - 1].getHashSync()) { valid = false; break; }
      }
      // effectiveAnchorHeight: where to splice. Starts as anchorHeight (fork anchor),
      // overridden to -1 if anchor check fails (full replacement).
      let effectiveAnchorHeight = anchorHeight;
      // For partial reorg: also verify the first downloaded block links to our anchor.
      // If it doesn't, the fork is deeper than expected — fall back to full fresh start.
      if (valid && anchorHeight >= 0) {
        const anchorIdx = anchorHeight - chainOffset;
        const anchor = this.chain[anchorIdx];
        if (!anchor || parsed[0].previousHash !== anchor.getHashSync()) {
          console.warn(`[PoH-Miner] Partial reorg anchor mismatch at ${anchorHeight} — falling back to full resync`);
          // Re-download the full chain from genesis
          downloadedBlocks.length = 0;
          let h = -1;
          while (h < bestHeight) {
            const from = h + 1;
            const to   = Math.min(from + CHUNK - 1, bestHeight);
            try {
              const r2 = await fetch(`${bestBase}/chain/blocks?from=${from}&to=${to}`, { signal: AbortSignal.timeout(30000) });
              if (!r2.ok) break;
              const bs = await r2.json();
              if (!Array.isArray(bs) || bs.length === 0) break;
              downloadedBlocks.push(...bs);
              h = to;
            } catch (e) { console.warn('[PoH-Miner] Full resync chunk failed:', e.message); break; }
          }
          // Re-parse for the outer apply block below
          parsed.length = 0;
          parsed.push(...downloadedBlocks.map(b => PohBlock.fromJSON ? PohBlock.fromJSON(b) : new PohBlock(b)));
          // Re-verify linkage on the freshly downloaded full chain
          valid = true;
          for (let i = 1; i < parsed.length; i++) {
            if (parsed[i].previousHash !== parsed[i - 1].getHashSync()) { valid = false; break; }
          }
          // Force full replacement (no anchor)
          effectiveAnchorHeight = -1;
        }
      }
      if (valid) {
        // Splice downloaded tail onto the common prefix (or replace entirely for full fresh start)
        const anchorIdx = effectiveAnchorHeight >= 0 ? effectiveAnchorHeight - chainOffset : -1;
        this.chain = effectiveAnchorHeight >= 0
          ? [...this.chain.slice(0, anchorIdx + 1), ...parsed]
          : parsed;
        for (const b of parsed) {
          for (const r of (b.scanResults || [])) {
            if (r.requestId) this.minedRequestIds.add(r.requestId);
          }
        }
        this.currentDifficulty = getNextDifficulty(this.chain);
        this._rebuildBalancesFromChain();
      } else {
        console.warn('[PoH-Miner] Downloaded chain failed linkage check — keeping local chain');
      }
    }

    this.chainStore.saveChain(this.chain);
    console.log(`[PoH-Miner] Chain sync complete — height ${this.chain[this.chain.length - 1]?.height ?? this.chain.length - 1}`);
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

    // Wait for the benchmark if it hasn't resolved yet (started in constructor in parallel
    // with start() steps; usually done by now but not guaranteed on slow GPU probes).
    if (this.tflops == null && this._tflopsPromise) {
      this.tflops = await Promise.race([
        this._tflopsPromise,
        new Promise(r => setTimeout(() => r(null), 8000)),
      ]);
    }

    const baseInfo = {
      wallet: walletAddr,
      host: this._getPublicHost(),
      walletApiPort: this.config.walletApiPort || 3456,
      p2pPort: this.config.p2pPort || null,
      region: this.myLocation?.country || null,
      timestamp: ts,
      methodsHash,
      tflops: this.tflops || null,
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
    fs.mkdirSync(brainDataDir, { recursive: true });
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

      // Periodic chain re-sync: catch forks and missing blocks that accumulate at runtime
      this._syncInProgress = false;
      setInterval(async () => {
        if (this._syncInProgress) return;
        this._syncInProgress = true;
        this._abortMining();
        try { await this.syncFromBootnodes(); } catch { /* ignore */ }
        this._syncInProgress = false;
      }, 10 * 60 * 1000);
    } else {
      console.log('[PoH-Miner] No bootnodes configured — running in local/dev mode only');
    }

    // Drop in-progress work when another miner wins a job
    this.gossip.subscribe('new-result', ({ requestId }) => {
      if (requestId) this.minedRequestIds.add(requestId);
    });

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

    // Layer 6: relay and apply skill proposals from peers
    this.gossip.subscribe('skill-proposed', (transition) => {
      if (transition?.manifest?.id) {
        skillsManager.processTransition(transition);
        this.pendingBrainTransitions.push(transition);
        // Persist to disk so the skill survives restart
        try {
          const brainDir = getBrainDataDir();
          const skillsDir = path.join(brainDir, 'skills');
          writeSkillFile(skillsDir, transition.manifest, transition.code || null, transition.context || '');
          console.log(`[PoH-Miner] Persisted skill ${transition.manifest.id} to ${skillsDir}`);
        } catch (err) {
          console.warn('[PoH-Miner] Failed to persist skill to disk:', err.message);
        }
      }
    });

    // Audit result from a peer miner — proposer's node finalizes balance + skill broadcast
    this.gossip.subscribe('skill-audit-result', (verdict) => {
      this._applySkillAuditResult(verdict, null);
    });

    // A peer completed this job — drop it from our pending queue and move on
    this.gossip.subscribe('job-claimed', ({ jobId }) => {
      if (!jobId) return;
      this.jobQueue.completed.add(jobId);
      this.jobQueue.removeJob(jobId);
      const idx = this._pendingJobQueue.findIndex(j => j.id === jobId);
      if (idx !== -1) {
        this._pendingJobQueue.splice(idx, 1);
        console.log(`[PoH-Miner] Job ${jobId} claimed by peer — removed from pending queue (${this._pendingJobQueue.length} remaining)`);
      }
    });

    // Job lifecycle transitions gossiped by the node that ran the job — any winner includes them
    this.gossip.subscribe('job-transition', (t) => {
      if (!t?.type || !t?.jobId) return;
      const key = `${t.jobId}:${t.type}`;
      if (this._gossipedJobTransitions.has(key)) return;
      this._gossipedJobTransitions.add(key);
      this.pendingBrainTransitions.push(t);
    });

    // Skill result hash from any miner — include in chain for audit trail
    this.gossip.subscribe('skill-result-hash', (t) => {
      if (!t?.jobId) return;
      const key = `${t.jobId}:skill-result-hash`;
      if (this._gossipedJobTransitions.has(key)) return;
      this._gossipedJobTransitions.add(key);
      this.pendingBrainTransitions.push({ type: 'skill-result-hash', ...t });
    });

    // Peer feedback — sync reputation across all nodes; slash if this node was the miner
    this.gossip.subscribe('job-feedback', (transition) => {
      if (!transition?.jobId || !transition?.rating) return;
      if (feedbackStore.getByJob(transition.jobId)) return; // already applied
      feedbackStore.apply(transition);
      if (transition.rating === 'negative' && transition.minerAddress === this.config.wallet) {
        this.applySlashing(0.05);
        console.log(`[PoH-Miner] Reputation slashed via peer feedback (job ${transition.jobId}): ${this.reputation.toFixed(3)}`);
      }
    });

    // Skill stake events from peers — apply immediately for UX, mark txHash so
    // block replay (processStateTransition) skips the same event to prevent double-apply.
    this.gossip.subscribe('skill-staked', ({ skillId, stakerAddress, amount, total, txHash }) => {
      if (!skillId || !stakerAddress || !amount) return;
      if (!this._skillStakes.has(skillId)) this._skillStakes.set(skillId, { total: 0, stakers: new Map() });
      const entry = this._skillStakes.get(skillId);
      entry.stakers.set(stakerAddress, (entry.stakers.get(stakerAddress) || 0) + amount);
      entry.total = (total !== undefined) ? total : (entry.total || 0) + amount;
      if (txHash) this._appliedStakeTxs.add(txHash);
      this._saveSkillStakes();
      const GRADUATION_THRESHOLD = 10000 * POH_DECIMALS;
      if (entry.total >= GRADUATION_THRESHOLD) {
        const skill = skillsManager.getAllSkills().find(s => s.id === skillId);
        if (skill && skill.status !== 'active') {
          const transition = { type: 'skill-graduated', skillId };
          skillsManager.processTransition(transition);
          this.pendingBrainTransitions.push(transition);
        }
      }
    });

    this.gossip.subscribe('skill-unstaked', ({ skillId, stakerAddress, amount, total, txHash }) => {
      if (!skillId || !stakerAddress || !amount) return;
      const entry = this._skillStakes.get(skillId);
      if (!entry) return;
      entry.stakers.set(stakerAddress, Math.max(0, (entry.stakers.get(stakerAddress) || 0) - amount));
      entry.total = (total !== undefined) ? total : Math.max(0, (entry.total || 0) - amount);
      if (txHash) this._appliedStakeTxs.add(txHash);
      this._saveSkillStakes();
    });

    // P2P exchange order/trade sync
    this.gossip.subscribe('p2p-order', (order) => {
      try { this.p2pOrderStore.ingestGossipOrder(order); } catch { /* ignore malformed */ }
    });
    this.gossip.subscribe('p2p-trade', (trade) => {
      try { this.p2pOrderStore.ingestGossipTrade(trade); } catch { /* ignore malformed */ }
    });

    // Layer 3: P2P block requests — serve block ranges to any peer that asks
    this.gossip.subscribe('block-request', ({ fromHeight, toHeight, requesterId }) => {
      if (!fromHeight || !toHeight || requesterId === this.config.wallet) return;
      const blocks = this.chain
        .filter(b => b.height >= fromHeight && b.height <= toHeight)
        .map(b => b.toJSON());
      if (blocks.length) {
        this.gossip.publish('block-response', { blocks, requesterId }).catch(() => {});
      }
    });

    this.gossip.subscribe('block-response', ({ blocks, requesterId }) => {
      if (requesterId !== this.config.wallet) return;
      if (!Array.isArray(blocks)) return;
      for (const blockData of blocks) {
        this.handleIncomingBlock(blockData, 'peer-block-response');
      }
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
      const currentHeight = this.chain[this.chain.length - 1]?.height ?? this.chain.length - 1;
      const tipHash = this.chain[this.chain.length - 1].getHashSync();

      // Reject blocks whose genesis ancestor can't possibly match ours.
      // A block at height 0 from a peer is only valid if its hash matches our genesis.
      if (newBlock.height === 0) {
        const localGenesis = this.chain.find(b => b.height === 0);
        if (localGenesis && newBlock.getHashSync() !== localGenesis.getHashSync()) {
          console.warn(`[PoH-Miner] Rejected genesis block from ${from} — different network (hash mismatch)`);
          return;
        }
      }

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
        if (newBlock.stateRoot) {
          const localRoot = this.walletManager.getStateRoot();
          if (localRoot !== newBlock.stateRoot) {
            console.warn(`[PoH-Miner] Block #${newBlock.height} stateRoot mismatch — peer=${newBlock.stateRoot.slice(0,12)} local=${localRoot.slice(0,12)} — rejected`);
            return;
          }
        }
        this._appendBlock(newBlock, from);
        this._drainOrphans(newBlock.getHashSync());

      } else if (newBlock.height === currentHeight + 1 && newBlock.previousHash !== tipHash) {
        // ── Fork at same height: competing block ─────────────────────────────
        // Keep the block with more cumulative work (longest/heaviest chain rule)
        const ourWork  = getTipChainWork(this.chain);
        if (compareChainWork(newBlock.chainWork, ourWork) > 0) {
          console.log(`[PoH-Miner] Fork: incoming block #${newBlock.height} has more chainWork — switching`);
          await this.reorgTo([newBlock]);
        } else {
          // Put in orphan pool; may become canonical if a longer chain follows
          this._storeOrphan(newBlock);
        }

      } else if (newBlock.height <= currentHeight) {
        // ── Old block: only consider if it anchors a heavier chain ───────────
        this._storeOrphan(newBlock);

      } else {
        // ── We're behind (gap) — add to orphan pool and sync via peers + bootnodes
        this._storeOrphan(newBlock);
        // Debounce: don't spam sync requests for the same gap (e.g. fast miner flooding blocks)
        const now = Date.now();
        if (!this._lastBlockSyncAt || now - this._lastBlockSyncAt > 30_000) {
          this._lastBlockSyncAt = now;
          console.log(`[PoH-Miner] Behind (peer at ${newBlock.height}, we at ${currentHeight}) — syncing`);
          this.gossip.publish('block-request', {
            fromHeight: currentHeight + 1,
            toHeight: newBlock.height - 1,
            requesterId: this.config.wallet,
          }).catch(() => {});
          this.requestBlockSync(newBlock.height);
        }
      }
    } catch (err) {
      console.warn(`[PoH-Miner] Failed to process incoming block from ${from}:`, err.message);
    }
  }

  // Apply all state mutations from a block (transactions, rewards, state transitions).
  // Called by _appendBlock (live path) and syncFromBootnodes (batch sync path).
  // Does NOT push to this.chain or touch difficulty — caller handles those.
  _applyBlockState(block) {
    const appliedTxHashes = [];
    for (const txData of (block.transactions || [])) {
      const tx = PoHTransaction.fromJSON(txData);
      const result = this.walletManager.applyTransaction(tx);
      if (result === true) {
        appliedTxHashes.push(tx.txHash);
        this.balanceJournal.record(block.height, tx.from, -(tx.amount + tx.fee), 1, tx.txHash);
        this.balanceJournal.record(block.height, tx.to, tx.amount, 0, tx.txHash);
        if (tx.fee > 0 && block.minerWallet) {
          this.walletManager.credit(block.minerWallet, tx.fee);
          this.balanceJournal.record(block.height, block.minerWallet, tx.fee, 0, tx.txHash);
        }
        this.submissionHistory.push({
          id: tx.txHash, type: 'send', from: tx.from, to: tx.to,
          amount: tx.amount, fee: tx.fee || 0, timestamp: tx.timestamp,
          blockHeight: block.height, status: 'mined',
        });
      } else {
        console.warn(`[PoH-Miner] Tx ${tx.txHash.slice(0,12)} failed in block #${block.height}: ${result}`);
      }
    }
    if (appliedTxHashes.length) this.txMempool.onBlockApplied(appliedTxHashes);

    for (const r of (block.scanResults || [])) {
      if (r.requestId) this.minedRequestIds.add(r.requestId);
    }
    const before = this.pendingValidResults.length;
    this.pendingValidResults = this.pendingValidResults.filter(r => !this.minedRequestIds.has(r.requestId));
    const dropped = before - this.pendingValidResults.length;
    if (dropped > 0) console.log(`[PoH-Miner] Dropped ${dropped} pending result(s) already mined in block #${block.height}`);

    this.processIncomingBlockRewards(block);

    // Credit coinbase rewards globally so every node tracks every wallet's balance.
    // processIncomingBlockRewards only credits this node's own wallet; this block
    // credits ALL miners/workers using the claim store to prevent double-crediting.
    const coinbase = block.coinbaseReward;
    if (coinbase && block.minerWallet) {
      if (coinbase.proposerReward > 0) {
        const key = `proposer-${block.height}`;
        if (this.rewardClaimStore.claimIfNotAlready(key)) {
          this.walletManager.credit(block.minerWallet, coinbase.proposerReward);
          this.balanceJournal.record(block.height, block.minerWallet, coinbase.proposerReward, 0, key);
        }
      }
      for (const worker of (coinbase.workerRewards || [])) {
        if (worker.workerId && worker.amount > 0) {
          const key = RewardClaimStore.makeClaimKey(block.height, worker.workProofHash);
          if (this.rewardClaimStore.claimIfNotAlready(key)) {
            this.walletManager.credit(worker.workerId, worker.amount);
            this.balanceJournal.record(block.height, worker.workerId, worker.amount, 0, key);
          }
        }
      }
    }

    if (block.stateTransitions?.length && !this._appliedStateTransitionHeights.has(block.height)) {
      this._appliedStateTransitionHeights.add(block.height);
      for (const tx of block.stateTransitions) {
        this.processStateTransition(tx).catch(() => {});
      }
    }
  }

  // Rebuild all wallet balances from scratch by replaying the current chain.
  // Called after fork recovery (fresh-start sync) to discard stale-fork balances.
  // Uses an in-memory accumulator to avoid O(blocks × wallets) synchronous disk writes.
  _rebuildBalancesFromChain() {
    console.log(`[PoH-Miner] Rebuilding wallet balances from ${this.chain.length} canonical blocks…`);

    // Accumulate all balance deltas in memory: address → total amount
    const balances = new Map(); // address → accumulated balance (number)
    const addBalance = (addr, amount) => {
      if (!addr || amount <= 0) return;
      balances.set(addr, (balances.get(addr) || 0) + amount);
    };
    const subBalance = (addr, amount) => {
      if (!addr || amount <= 0) return;
      balances.set(addr, Math.max(0, (balances.get(addr) || 0) - amount));
    };

    // Clear claim store so replayed rewards aren't skipped
    this.rewardClaimStore.reset();
    const claimKeys = [];

    for (const block of this.chain) {
      const coinbase = block.coinbaseReward;
      if (coinbase && block.minerWallet) {
        if (coinbase.proposerReward > 0) {
          addBalance(block.minerWallet, coinbase.proposerReward);
          claimKeys.push(`proposer-${block.height}`);
        }
        for (const worker of (coinbase.workerRewards || [])) {
          if (worker.workerId && worker.amount > 0) {
            addBalance(worker.workerId, worker.amount);
            claimKeys.push(RewardClaimStore.makeClaimKey(block.height, worker.workProofHash));
          }
        }
      }
      // Apply transactions
      for (const txData of (block.transactions || [])) {
        try {
          const tx = PoHTransaction.fromJSON(txData);
          subBalance(tx.from, tx.amount + (tx.fee || 0));
          addBalance(tx.to, tx.amount);
          if (tx.fee > 0 && block.minerWallet) addBalance(block.minerWallet, tx.fee);
        } catch { /* skip malformed tx */ }
      }
      // Apply P2P escrow movements from stateTransitions so poh_p2p_escrow
      // balance survives a fresh-start rebuild (escrow is off-chain state).
      for (const t of (block.stateTransitions || [])) {
        if (t.type === 'p2p-order-created' && t.side === 'sell' && t.escrowLocked) {
          subBalance(t.maker, t.pohAmount);
          addBalance(ESCROW_ADDRESS, t.pohAmount);
        } else if (t.type === 'p2p-order-cancelled' && t.side === 'sell' && t.escrowLocked) {
          subBalance(ESCROW_ADDRESS, t.pohAmount);
          addBalance(t.maker, t.pohAmount);
        } else if (t.type === 'p2p-trade-created' && t.orderSide === 'buy') {
          subBalance(t.taker, t.pohAmount);
          addBalance(ESCROW_ADDRESS, t.pohAmount);
        } else if (t.type === 'p2p-trade-release') {
          subBalance(ESCROW_ADDRESS, t.pohAmount);
          addBalance(t.recipient, t.pohAmount);
        } else if (t.type === 'p2p-trade-cancel' && t.escrowLocked) {
          subBalance(ESCROW_ADDRESS, t.pohAmount);
          addBalance(t.locker, t.pohAmount);
        }
      }
    }
    // Persist all claim keys in one write
    this.rewardClaimStore.markClaimedMany(claimKeys);

    // Flush accumulated balances to disk in one pass (one file read+write per address)
    for (const [addr, balance] of balances) {
      const existing = this.walletManager.loadWallet(addr);
      if (existing) {
        existing.balance = balance;
        this.walletManager.saveWallet(existing);
      } else {
        // New address — use credit() which creates a stub wallet
        this.walletManager.credit(addr, balance);
      }
    }
    // Zero wallets that earned nothing (so stale balances from old forks are cleared)
    for (const addr of this.walletManager.listWallets()) {
      if (!balances.has(addr)) {
        const w = this.walletManager.loadWallet(addr);
        if (w && (w.balance || 0) !== 0) { w.balance = 0; this.walletManager.saveWallet(w); }
      }
    }

    // Clear dedup sets so gossip/stateTransitions for pre-existing orders
    // are re-applied correctly on the new canonical chain.
    this._appliedP2PIds.clear();
    this._appliedEscrowJobIds.clear();
    this._appliedStateTransitionHeights.clear();

    console.log(`[PoH-Miner] Balance rebuild complete — processed ${this.chain.length} blocks`);
  }

  _appendBlock(block, from) {
    this._applyBlockState(block);

    // Abort current mining immediately — we need to mine on the new tip
    this._abortMining();

    this.chain.push(block);
    this.chainStore.saveBlock(block);
    this.currentDifficulty = getNextDifficulty(this.chain);
    console.log(`[PoH-Miner] Accepted block #${block.height} chainWork=${block.chainWork} txs=${(block.transactions||[]).length} [sig:${block.minerSignature ? '✓' : 'none'}] from ${from?.slice(0,8)}`);

    // Trigger IPFS chain snapshot every 100 blocks (fire-and-forget)
    this.ipfsSync.onBlockAppended(block).catch(() => {});

    // Every 500 blocks, pin brain to IPFS and queue CID for next block's stateTransitions
    if (block.height % 500 === 0) {
      this.ipfsSync._snapBrain().then(cid => {
        if (cid) this.pendingBrainTransitions.push({ type: 'state-snapshot', brainCID: cid, height: block.height });
      }).catch(() => {});
    }
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

    if (this._syncInProgress) return;
    this._syncInProgress = true;
    this._abortMining();

    try {
      const currentHeight = this.chain[this.chain.length - 1]?.height ?? this.chain.length - 1;
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
            const reorgDone = await this.reorgTo(incoming);
            if (reorgDone) return;
            // Common ancestor not in the fetched segment — deep fork, need full resync.
            // Release the lock first so syncFromBootnodes can run.
            this._syncInProgress = false;
            this.syncFromBootnodes().catch(() => {});
            return;
          }

          // No reorg needed — append sequential blocks normally
          let added = 0;
          for (const block of incoming) {
            const prev = this.chain[this.chain.length - 1];
            if (block.height === prev.height + 1 && block.previousHash === prev.getHashSync()) {
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
    } finally {
      this._syncInProgress = false;
    }
  }

  // ── Peer compute relay ──────────────────────────────────────────────────────

  // Fetch the list of reachable miner peers (from bootnode /peers).
  // Returns array of base URLs like ['http://1.2.3.4:3456', ...]
  async _getComputePeers() {
    const peers = [];
    for (const bootnode of (this.config.bootnodes || [])) {
      try {
        const base = bootnode.endsWith('/') ? bootnode : bootnode + '/';
        const r = await fetch(`${base}peers`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) continue;
        const { peers: list } = await r.json();
        for (const p of (list || [])) {
          if (p.host && p.walletApiPort && p.host !== 'localhost' && p.host !== '127.0.0.1') {
            peers.push(`http://${p.host}:${p.walletApiPort}`);
          }
        }
        if (peers.length) break;
      } catch { /* bootnode unreachable */ }
    }
    return peers;
  }

  // Relay a job to all known peer miners (non-blocking best-effort).
  // Peers receiving it will compute and store the result under the same jobId.
  async _relayJobToPeers(job) {
    try {
      const peers = await this._getComputePeers();
      const jobJson = JSON.stringify({ ...job, _relayed: true });
      await Promise.allSettled(peers.map(base =>
        fetch(`${base}/job`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jobJson,
          signal: AbortSignal.timeout(8000),
        }).catch(() => {})
      ));
    } catch { /* ignore — best effort */ }
  }

  // Poll peer miners for a job result (used when local compute is unavailable).
  async _fetchJobResultFromPeers(jobId) {
    try {
      const peers = await this._getComputePeers();
      for (const base of peers) {
        try {
          const r = await fetch(`${base}/job/${jobId}/result`, { signal: AbortSignal.timeout(6000) });
          if (r.status === 200) {
            const data = await r.json();
            if (data.verdict || data.profile) return data;
          }
        } catch { /* try next peer */ }
      }
    } catch { /* ignore */ }
    return null;
  }

  // Send a chat message to the best available peer and return the reply text.
  async _relayToPeerChat(message, history = []) {
    try {
      const peers = await this._getComputePeers();
      for (const base of peers) {
        try {
          const r = await fetch(`${base}/chat/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history }),
            signal: AbortSignal.timeout(45000),
          });
          if (r.ok) {
            const data = await r.json();
            if (data.message) return data.message;
          }
        } catch { /* try next peer */ }
      }
    } catch { /* ignore */ }
    return null;
  }

  // Pull any pending transactions from bootnodes that this node missed via gossip
  // (e.g. submitted while this node was down). Called once before each block proposal
  // so that every tx eventually gets included even without a live gossip connection.
  async _syncMempoolFromBootnodes() {
    if (!this.config.bootnodes?.length) return;
    for (const bootnode of this.config.bootnodes) {
      try {
        const base = bootnode.endsWith('/') ? bootnode : bootnode + '/';
        const res = await fetch(`${base}api/tx/pending`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) continue;
        const { txs } = await res.json();
        if (!Array.isArray(txs)) continue;
        for (const txData of txs) {
          try {
            const tx = PoHTransaction.fromJSON(txData);
            this.txMempool.submit(tx); // silently ignores duplicates / invalid nonce / insufficient balance
          } catch { /* malformed */ }
        }
        return; // one bootnode is enough
      } catch { /* bootnode unreachable */ }
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
      console.warn('[PoH-Miner] Reorg: no common ancestor in fetched segment — triggering full resync');
      return false;
    }

    const rolledBack = this.chain.splice(commonHeight + 1);
    console.log(`[PoH-Miner] Reorg: rolling back ${rolledBack.length} blocks to height ${commonHeight}`);

    // Undo balance changes for rolled-back blocks
    const undone = this.balanceJournal.rollbackTo(commonHeight);

    // Clear mempool nonce tracking so senders whose txs were in rolled-back
    // blocks can resubmit with the correct (reverted) nonces.
    this.txMempool.accountPendingNonce.clear();
    if (this.txMempool.pendingOut) this.txMempool.pendingOut.clear();
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
    return true;
  }

  startJobListener() {
    console.log('[PoH-Miner] Listening for jobs (with geo awareness)...');

    this.onNewJob = (rawJob) => {
      // Skip if we already completed or are computing this job (prevents duplicate runs
      // when our own gossip echoes back through bootnodes)
      const existing = this.jobResults?.get(rawJob.id);
      if (existing && (existing.status === 'done' || existing.status === 'computing')) return;

      const job = this.jobQueue.addJob(rawJob);
      this._recordJob(job); // make status/result queryable even for network-originated jobs

      const minerInfo = {
        country: this.myLocation?.country,
        currentLoad: this._activeJobId ? 1.0 : 0.0, // real load based on active slot
        reputation: this.reputation,
      };

      const score = this.jobQueue.scoreJobForMiner(job, minerInfo);

      if (score > 0 && this.config.computeEnabled) {
        const geoNote = job.originCountry ? ` [from: ${job.originCountry}]` : '';
        console.log(`[PoH-Miner] New job ${job.id} (${job.type})${geoNote} → score: ${score}`);
        this._enqueueJob(job);
      } else {
        const reason = score === 0 ? 'different continent / low priority' : 'compute disabled';
        console.log(`[PoH-Miner] Ignoring job ${job.id} (${reason})`);
        this._updateJob(job.id, { status: 'ignored', error: reason });
      }
    };

    this.gossip.subscribe('new-job', this.onNewJob);
  }

  _enqueueJob(job) {
    if (this._activeJobId) {
      if (!this._pendingJobQueue.some(j => j.id === job.id)) {
        this._pendingJobQueue.push(job);
        this._pendingJobQueue.sort((a, b) =>
          ((b.maxBudget || 0) - (a.maxBudget || 0)) || ((b.fee || 0) - (a.fee || 0))
        );
        console.log(`[PoH-Miner] Job ${job.id} queued (slot busy with ${this._activeJobId}, queue depth: ${this._pendingJobQueue.length})`);
      }
    } else {
      this._startJob(job);
    }
  }

  _startJob(job) {
    this._activeJobId = job.id;
    this._processJobInBackground(job).catch(e => {
      console.error('[job bg]', e.message);
    });
  }

  _drainJobQueue() {
    while (this._pendingJobQueue.length > 0) {
      const next = this._pendingJobQueue.shift();
      if (this.jobQueue.completed.has(next.id)) {
        console.log(`[PoH-Miner] Skipping ${next.id} — already claimed by a peer`);
        continue;
      }
      const existing = this.jobResults?.get(next.id);
      if (existing && (existing.status === 'done' || existing.status === 'computing')) {
        console.log(`[PoH-Miner] Skipping ${next.id} — already processed`);
        continue;
      }
      this._startJob(next);
      return;
    }
    console.log('[PoH-Miner] Job queue drained — idle');
  }

  async computeAndSubmitJob(job) {
    const start = Date.now();

    // ── Skill job path ────────────────────────────────────────────────────────
    if (job.type === 'skill' && job.skillId) {
      // Gate: skill must be enabled on this node
      if (!this.isSkillEnabled(job.skillId)) {
        console.log(`[PoH-Miner] Skipping skill job ${job.id} — skill ${job.skillId} is disabled on this node`);
        this._updateJob(job.id, { status: 'ignored', error: 'skill disabled by miner' });
        return;
      }
      // poh_identity has no sandboxed code — delegate to the full verdict pipeline
      if (job.skillId === 'poh_identity') {
        return this.computeAndSubmitJob({ ...job, type: 'verdict' });
      }
      try {
        console.log(`[PoH-Miner] Running skill ${job.skillId} for job ${job.id}`);
        const { output, tokensUsed } = await skillsManager.runSkill(job.skillId, job.payload, this.config, job.maxBudget);

        // If the job carries a user question, generate a natural-language LLM response
        // before marking the job done so the fee is only released after full LLM work.
        let nlResponse = null;
        const userQuestion = job.payload?.question;
        if (userQuestion && output !== null && output !== undefined && !job.payload?._isProposalAudit) {
          try {
            const ollamaBase = this.config.ollamaUrl || 'http://localhost:11434';
            const skillEntry = skillsManager.getSkill(job.skillId);
            const skillCtx = skillEntry?.context || '';
            const systemContent = [
              'You are an AI assistant with access to real-time data fetched by a skill.',
              'Answer the user\'s question using only the provided data. Be concise and specific.',
              skillCtx ? `\n\nSkill context (how to interpret this data):\n${skillCtx}` : '',
            ].join('');
            const dataStr = JSON.stringify(output, null, 2).slice(0, 10000);
            const userContent = `Fetched data:\n\`\`\`json\n${dataStr}\n\`\`\`\n\nUser question: ${userQuestion}`;
            const ollamaRes = await fetch(`${ollamaBase}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: this.config.model || 'qwen2.5:1.5b',
                messages: [
                  { role: 'system', content: systemContent },
                  { role: 'user', content: userContent },
                ],
                stream: false,
                options: { temperature: 0.5 },
              }),
              signal: AbortSignal.timeout(30000),
            });
            if (ollamaRes.ok) {
              const d = await ollamaRes.json();
              nlResponse = d.message?.content || d.response || null;
              if (nlResponse) console.log(`[PoH-Miner] LLM analysis done for job ${job.id} (${nlResponse.length} chars)`);
            }
          } catch (e) {
            console.warn(`[PoH-Miner] LLM analysis skipped for job ${job.id}:`, e.message);
          }
        }

        const result = new ScanResult({
          requestId:        job.id,
          address:          job.payload?.address || 'skill-job',
          verdict:          'SKILL_RESULT',
          confidence:       1,
          reasoning:        `Skill ${job.skillId} executed successfully`,
          signalsUsed:      [],
          modelUsed:        'skill-runner',
          computationTimeMs: Date.now() - start,
          minerWallet:      this.config.wallet,
          methodsHash:      this.methodsManager?.getStatus().hash || 'skill',
          methodsCount:     0,
          realPohUsed:      false,
          profile:          { skillOutput: output, skillId: job.skillId, tokensUsed, nlResponse },
        });
        // ── Proposal audit post-processing ── runs BEFORE submitResult so the renderer
        // never sees a SKILL_RESULT for a rejected audit (race between submitResult and
        // _applySkillAuditResult setting rec.rejected would show "audit passed" incorrectly)
        if (job.payload?._isProposalAudit) {
          const safe = output?.safe !== false;
          const auditVerdict = {
            type:             'skill-audit-result',
            jobId:            job.id,
            skillId:          job.payload.manifest?.id,
            safe,
            reason:           output?.reason,
            issues:           output?.issues || [],
            proposerAddress:  job.payload.proposerAddress,
            auditorAddress:   this.config.wallet,
            fee:              job.maxBudget,
            ts:               Date.now(),
          };
          this.gossip.publish('skill-audit-result', auditVerdict).catch(() => {});
          this.pendingBrainTransitions.push({ type: 'skill-audit-result', ...auditVerdict });
          this._applySkillAuditResult(auditVerdict, job);
          if (!safe) {
            // Ensure rejected status is set even if _applySkillAuditResult returned early
            this._updateJob(job.id, { status: 'done', verdict: 'REJECTED', reason: output?.reason, issues: output?.issues || [], rejected: true });
            this.jobQueue.markCompleted(job.id);
            // Fall through to settlement — miner gets paid for the audit even on rejection
          }
        }

        if (!job.payload?._isProposalAudit || output?.safe !== false) {
          await this.submitResult(job, result);

          // Broadcast skill result hash on-chain for audit trail
          try {
            const resultHash = crypto.createHash('sha256')
              .update(JSON.stringify(output ?? ''))
              .digest('hex')
              .slice(0, 32);
            this.gossip.publish('skill-result-hash', { jobId: job.id, skillId: job.skillId, hash: resultHash, miner: this.config.wallet, ts: Date.now() }).catch(() => {});
          } catch {}
        }

        if (!this.jobQueue.completed.has(job.id)) this.jobQueue.markCompleted(job.id);

        if (job.requesterAddress && job.maxBudget > 0 && this.escrow.has(job.id)) {
          const gasPrice = this.config.gasPrice || GAS.DEFAULT_GAS_PRICE;
          // For proposal audits pay the full fee flat (not per-token) — it's a governance fee
          const fee   = job.payload?._isProposalAudit ? job.maxBudget : settleFee(tokensUsed, gasPrice, job.maxBudget).fee;
          const refund = job.maxBudget - fee;
          // 80% to miner, 20% to skill proposer (if proposer exists; builtins go 100% to miner)
          const skillEntry = skillsManager.getSkill(job.skillId);
          const proposerAddress = (!job.payload?._isProposalAudit && skillEntry?.proposerAddress) ? skillEntry.proposerAddress : null;
          const proposerFee = proposerAddress ? Math.floor(fee * 0.2) : 0;
          const minerFee    = fee - proposerFee;
          const settled = { type: 'job-settled', jobId: job.id, requesterAddress: job.requesterAddress, minerAddress: this.config.wallet, actualTokens: tokensUsed, actualFee: minerFee, proposerAddress, proposerFee, refund, gasPrice, completedAt: Date.now() };
          this.pendingBrainTransitions.push(settled);
          this._gossipedJobTransitions.add(`${job.id}:job-settled`);
          this.gossip.publish('job-transition', settled).catch(() => {});
          this._applySettlement(settled);
        }
        return result;
      } catch (err) {
        console.error(`[PoH-Miner] Skill job ${job.id} failed:`, err.message);
        this._updateJob(job.id, { status: 'error', error: err.message });
        if (job.requesterAddress && job.maxBudget > 0 && this.escrow.has(job.id)) {
          const timeout = { type: 'job-timeout', jobId: job.id, requesterAddress: job.requesterAddress, minerAddress: this.config.wallet, reservationFee: 0, refund: job.maxBudget, completedAt: Date.now() };
          this.pendingBrainTransitions.push(timeout);
          this._applySettlement(timeout);
        }
        return null;
      }
    }

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

      // Settle payment if this was a paid job
      if (job.requesterAddress && job.maxBudget > 0) {
        const activeSignals  = this.methodsManager?.getActiveMethods().length || 0;
        const actualTokens   = verdict.actualTokens || estimateTokens(activeSignals, job.payload?.address);
        const gasPrice       = this.config.gasPrice || GAS.DEFAULT_GAS_PRICE;
        const { fee, refund } = settleFee(actualTokens, gasPrice, job.maxBudget);
        const settledTransition = {
          type:             'job-settled',
          jobId:            job.id,
          requesterAddress: job.requesterAddress,
          minerAddress:     this.config.wallet,
          actualTokens,
          actualFee:        fee,
          refund,
          gasPrice,
          completedAt:      Date.now(),
        };
        this.pendingBrainTransitions.push(settledTransition);
        this._applySettlement(settledTransition);
      }

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
      if (job.requesterAddress && job.maxBudget > 0 && this.escrow.has(job.id)) {
        const timeout = { type: 'job-timeout', jobId: job.id, requesterAddress: job.requesterAddress, minerAddress: this.config.wallet, reservationFee: 0, refund: job.maxBudget, completedAt: Date.now() };
        this.pendingBrainTransitions.push(timeout);
        this._applySettlement(timeout);
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

  _applyEscrow(transition) {
    const { jobId, requesterAddress, amount, minerAddress } = transition;
    if (!requesterAddress || !amount) return;
    if (this._appliedEscrowJobIds.has(jobId)) return; // block replay — already debited locally
    this._appliedEscrowJobIds.add(jobId);
    this.walletManager.debit(requesterAddress, amount);
    this.escrow.set(jobId, { amount, requesterAddress, minerAddress });
  }

  _applySettlement(transition) {
    const entry = this.escrow.get(transition.jobId);
    if (!entry) return;
    this.escrow.delete(transition.jobId);
    if (transition.type === 'job-settled') {
      if (transition.actualFee > 0)  this.walletManager.credit(transition.minerAddress, transition.actualFee);
      if (transition.proposerFee > 0 && transition.proposerAddress)
        this.walletManager.credit(transition.proposerAddress, transition.proposerFee);
      if (transition.refund > 0)     this.walletManager.credit(transition.requesterAddress, transition.refund);
    } else if (transition.type === 'job-timeout') {
      if (transition.reservationFee > 0) this.walletManager.credit(transition.minerAddress, transition.reservationFee);
      if (transition.refund > 0)         this.walletManager.credit(transition.requesterAddress, transition.refund);
    }
  }

  /**
   * Finalize a skill proposal audit result — called on both the auditing node and the proposer's
   * node (via skill-audit-result gossip).  Only acts if this node holds the pending proposal.
   */
  _applySkillAuditResult(verdict, job) {
    const pending = this._pendingProposals.get(verdict.jobId);
    if (!pending) return; // not our proposal — nothing to do
    this._pendingProposals.delete(verdict.jobId);

    if (!verdict.safe) {
      // Miner earned the fee by doing the audit — DO NOT refund the proposer.
      // Settlement in computeAndSubmitJob will credit the miner from escrow.
      if (job) {
        this._updateJob(job.id, { status: 'done', verdict: 'REJECTED', reason: verdict.reason, issues: verdict.issues, rejected: true });
      }
      console.log(`[PoH-Miner] Skill proposal ${verdict.skillId} REJECTED: ${verdict.reason}`);
      if (typeof this.onSkillRejectedHook === 'function') {
        this.onSkillRejectedHook({ skillId: verdict.skillId, reason: verdict.reason, issues: verdict.issues || [] });
      }
    } else {
      // Publish the skill to the network
      const transition = { type: 'skill-proposed', manifest: pending.manifest, code: pending.code, context: pending.context, authorSignature: pending.authorSignature, proposerAddress: pending.proposerAddress || null, txHash: `skill-${pending.manifest.id}-${Date.now()}` };
      this.pendingBrainTransitions.push(transition);
      skillsManager.processTransition(transition);
      this.gossip.publish('skill-proposed', transition).catch(() => {});
      console.log(`[PoH-Miner] Skill proposal ${verdict.skillId} APPROVED — broadcasting`);
    }
  }

  async _processJobInBackground(job) {
    const jobId = job.id;
    this._updateJob(jobId, { status: 'computing' });
    try {
      await this.computeAndSubmitJob(job);
      // Notify peers that this job is claimed so they drop it from their pending queues
      const rec = this.jobResults?.get(jobId);
      if (rec?.status === 'done') {
        this.gossip.publish('job-claimed', { jobId, miner: this.config.wallet, ts: Date.now() }).catch(() => {});
      }
    } catch (e) {
      this._updateJob(jobId, { status: 'error', error: e.message });
    } finally {
      this._activeJobId = null;
      this._drainJobQueue();
    }
  }

  async submitResult(request, result) {
    // 1. Basic methods hash check (already existed)
    if (!this._validateResultMethods(result)) {
      console.warn(`[PoH-Miner] Rejecting result for ${request.id} — used stale methodsHash`);
      return;
    }

    // Skill results are local-only — no network validation, just store for polling
    if (result.verdict === 'SKILL_RESULT') {
      result.isValidWork = true;
      if (this.jobResults && this.jobResults.has(request.id)) {
        const rec = this.jobResults.get(request.id);
        rec.result = result;
        rec.status = 'done';
        rec.updatedAt = Date.now();
      } else if (this.jobResults) {
        this.jobResults.set(request.id, { id: request.id, status: 'done', job: request, result, error: null, createdAt: Date.now(), updatedAt: Date.now() });
      }
      console.log(`[PoH-Miner] ✓ Skill result stored for polling: ${request.id} (skill: ${result.profile?.skillId})`);
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

      // Do not slash for simulation fallbacks, local API jobs, or dev/testing
      const isSim    = result.methodsHash && String(result.methodsHash).startsWith('sim-');
      const isApiJob = request.source === 'api'; // submitted via local /job endpoint
      // Skip slash when the input was fundamentally unresolvable (e.g. @handle not in IdentityHub):
      // signalsEvaluated ≤ 1 with universal-chain detection means nothing could be fetched — not lazy mining.
      const isUnresolvable = workValidation.signalsEvaluated <= 1 && workValidation.liveCount > 10;
      if (!isSim && !isApiJob && !isUnresolvable) {
        // Only slash for network-originated work (gossip jobs) — not local UI searches
        this.applySlashing(0.15);
      } else {
        const reason = isApiJob ? 'local API job' : isSim ? 'simulation fallback' : 'unresolvable input';
        console.log(`[PoH-Miner] Skipping self-slash — ${reason}`);
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

    console.log(`[PoH-Miner] ✓ Submitting VALID result for ${request.id} (${workValidation.signalsEvaluated}/${workValidation.liveCount} signals) — queued for block`);

    // Announce completion so other miners can drop in-progress work for this job
    this.gossip.publish('new-result', {
      requestId: request.id,
      minerWallet: this.config.wallet,
      resultHash: result.getResultHash(),
    }).catch(() => {});
  }

  /**
   * Fault tolerance check: ensure the result was computed with the current signals set.
   */
  _validateResultMethods(result) {
    // Skill results don't use signal methods — bypass validation
    if (result.verdict === 'SKILL_RESULT') return true;

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
        // Wait for any in-progress sync to complete before mining on a new tip
        while (this._syncInProgress) {
          await new Promise(r => setTimeout(r, 200));
        }
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
    if (this._syncInProgress) return null;
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

    // Pull any pending txs from bootnodes that we missed via gossip (e.g. after a restart)
    await this._syncMempoolFromBootnodes();

    // Include pending transactions (fee-ordered, up to 100 per block)
    const pendingTxs = this.txMempool.getPending(100);

    const stateRoot      = this.walletManager.getStateRoot();
    const brainStateRoot = computeBrainStateRoot(getBrainDataDir());
    // Snapshot transitions now but only consume them if PoW succeeds.
    const brainTransitions = [...this.pendingBrainTransitions];
    if (brainStateRoot) brainTransitions.push({ type: 'brain-state-root', hash: brainStateRoot });

    const newBlock = new PohBlock({
      height: previous.height + 1,
      previousHash: await previous.getHash(),
      timestamp: Date.now(),
      minerWallet: this.config.wallet,
      scanResults: dedupedResults,
      stateTransitions: brainTransitions,
      transactions: pendingTxs.map(t => t.toJSON()),
      coinbaseReward: coinbase,
      difficulty: this.currentDifficulty,
      chainWork: computeChainWork(previous.chainWork, this.currentDifficulty),
      stateRoot,
      brainStateRoot,
    });

    const attempts = await mineBlock(newBlock, this.currentDifficulty, abortSignal);

    if (attempts === null) return null; // aborted by incoming block

    if (newBlock.meetsDifficultySync()) {
      // PoW succeeded — now safe to consume the transitions we snapshotted above.
      this.pendingBrainTransitions.splice(0, brainTransitions.filter(t => t.type !== 'brain-state-root').length);

      // Sign the block with our identity key after PoW is solved
      if (this.identityWallet) newBlock.sign(this.identityWallet);

      // Mark these requestIds as mined so no peer or restart re-mines them
      for (const r of dedupedResults) {
        if (r.requestId) this.minedRequestIds.add(r.requestId);
      }

      this.chain.push(newBlock);
      this.chainStore.saveBlock(newBlock);
      console.log(`[PoH-Miner] Produced block #${newBlock.height} (nonce ${newBlock.nonce})`);

      // Apply transactions from self-mined block — _applyBlockState is only called
      // for received blocks; we must do it here so balances/nonces update and the
      // mempool clears when this node is the block producer.
      const appliedTxHashes = [];
      for (const txData of (newBlock.transactions || [])) {
        const tx = PoHTransaction.fromJSON(txData);
        if (this.walletManager.applyTransaction(tx) === true) {
          appliedTxHashes.push(tx.txHash);
          this.balanceJournal.record(newBlock.height, tx.from, -(tx.amount + tx.fee), 1, tx.txHash);
          this.balanceJournal.record(newBlock.height, tx.to, tx.amount, 0, tx.txHash);
          if (tx.fee > 0) {
            this.walletManager.credit(newBlock.minerWallet, tx.fee);
            this.balanceJournal.record(newBlock.height, newBlock.minerWallet, tx.fee, 0, tx.txHash);
          }
          this.submissionHistory.push({
            id: tx.txHash, type: 'send', from: tx.from, to: tx.to,
            amount: tx.amount, fee: tx.fee || 0, timestamp: tx.timestamp,
            blockHeight: newBlock.height, status: 'mined',
          });
        }
      }
      if (appliedTxHashes.length) this.txMempool.onBlockApplied(appliedTxHashes);

      // Credit the proposer reward via claim store so gossip echo doesn't double-credit.
      if (this.config.wallet && coinbase.proposerReward > 0) {
        const proposerKey = `proposer-${newBlock.height}`;
        if (this.rewardClaimStore.claimIfNotAlready(proposerKey)) {
          this.walletManager.credit(this.config.wallet, coinbase.proposerReward);
          this.balanceJournal.record(newBlock.height, this.config.wallet, coinbase.proposerReward, 0, proposerKey);
          console.log(`[PoH-Miner] Credited ${(coinbase.proposerReward / POH_DECIMALS).toFixed(4)} POH (proposer) to ${this.config.wallet}`);
        }
      }

      // Credit any worker rewards this node earned (works for both produced and received blocks)
      this.processIncomingBlockRewards(newBlock);

      // Broadcast the new block to the network
      this.gossip.publish('new-block', newBlock.toJSON());

      // Submit to bootnodes — send a batch if the bootnode fell behind (crash/restart recovery)
      this._pushBlocksToBootnodes(newBlock).catch(() => {});

      // Process stateTransitions for this self-mined block and mark the height so
      // _applyBlockState skips them when the block echoes back via gossip.
      if (newBlock.stateTransitions?.length) {
        this._appliedStateTransitionHeights.add(newBlock.height);
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

  // Push a newly produced block to all bootnodes.
  // If a bootnode is behind (returned lower height or rejected), send it the missing batch.
  async _pushBlocksToBootnodes(newBlock) {
    const bootnodes = this.config.bootnodes || [];
    if (!bootnodes.length) return;

    const newBlockJson = newBlock.toJSON ? newBlock.toJSON() : newBlock;

    await Promise.allSettled(bootnodes.map(async (bootnode) => {
      const base = bootnode.endsWith('/') ? bootnode : bootnode + '/';
      try {
        // First, check what height the bootnode is at
        const tipRes = await fetch(`${base}chain/tip`, { signal: AbortSignal.timeout(5000) });
        if (!tipRes.ok) return;
        const tip = await tipRes.json();
        const bootnodeHeight = tip.height ?? 0;
        const localHeight = newBlock.height;

        if (bootnodeHeight >= localHeight) {
          // Bootnode is ahead of us — our new block is orphaned. Trigger a catch-up sync.
          if (!this._syncInProgress) {
            console.log(`[PoH-Miner] Bootnode ${bootnode} is ahead (${bootnodeHeight} vs ${localHeight}) — triggering sync`);
            this._syncInProgress = true;
            this._abortMining();
            this.syncFromBootnodes().catch(() => {}).finally(() => { this._syncInProgress = false; });
          }
          return;
        }

        let payload;
        if (bootnodeHeight < localHeight - 1 && localHeight - bootnodeHeight <= 200) {
          // Bootnode is behind — send the full missing range as a batch
          const missing = this.chain
            .filter(b => b.height > bootnodeHeight && b.height <= localHeight)
            .map(b => b.toJSON ? b.toJSON() : b);
          payload = JSON.stringify(missing);
          console.log(`[PoH-Miner] Bootnode ${bootnode} is behind (${bootnodeHeight} vs ${localHeight}), sending ${missing.length} missing blocks`);
        } else {
          payload = JSON.stringify(newBlockJson);
        }

        await fetch(`${base}submit-block`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(10000),
        });
      } catch { /* unreachable bootnode — silently skip */ }
    }));
  }

  /**
   * Public status for monitoring / other miners / dashboards
   */
  getStatus() {
    const sig = this.methodsManager?.getStatus() || {};
    return {
      wallet: this.config.pohWallet || this.config.wallet,
      pohWallet: this.config.pohWallet || this.config.wallet,
      methodsHash: sig.hash,
      methodsCount: sig.count,
      signalsSource: sig.source,
      signalsAgeMin: sig.ageMinutes,
      region: this.myLocation?.country,
      chainHeight: this.chain.length - 1,
      peers: (this.peers || []).length,
      computeEnabled: this.config.computeEnabled,
      quality: this.qualityStats,
      reputation: this.reputation,
      rewardMultiplier: (this.reputation || 1.0).toFixed(2),
      tflops: this.tflops || null,
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
    if (!transition) return;

    // Brain mutations — replayed on all nodes so brain state stays deterministic
    if (transition.type === 'brain-feedback' || transition.type === 'brain-weight') {
      if (!this.brainSync) this._initBrainSync();
      if (this.brainSync) {
        const brain = await getBrain().catch(() => null);
        if (brain) {
          const eventType = transition.type === 'brain-feedback' ? 'feedback' : 'weight_update';
          const eventData = transition.type === 'brain-feedback'
            ? { address: transition.address, aiVerdict: transition.aiVerdict, correction: transition.correction, comment: transition.comment, signals: transition.signals }
            : { method: transition.method, voteType: transition.voteType, vote: transition.vote, stakeWeight: transition.stakeWeight, feedback: transition.feedback };
          const syntheticEvent = { type: eventType, data: eventData, ts: Date.now(), eventHash: crypto.createHash('sha256').update(JSON.stringify({ eventType, eventData })).digest('hex').slice(0, 24) };
          await this.brainSync.applyEvent(syntheticEvent, brain);
        }
      }
      return;
    }

    if (transition.type === 'brain-state-root') return; // informational only

    // Job submission history — reconstruct job record on new nodes
    if (transition.type === 'job-submitted') {
      if (this.jobResults && !this.jobResults.has(transition.jobId)) {
        this.jobResults.set(transition.jobId, {
          id: transition.jobId,
          status: 'archived',
          job: { id: transition.jobId, type: transition.jobType, payload: { address: transition.address }, skillId: transition.skillId, requesterAddress: transition.requesterAddress, maxBudget: transition.maxBudget },
          result: null,
          createdAt: transition.timestamp,
          updatedAt: transition.timestamp,
        });
      }
      return;
    }

    // P2P order/trade lifecycle — rebuild order book from chain on new nodes
    if (transition.type === 'p2p-order-created') {
      if (this._appliedP2PIds.has(`order-${transition.id}`)) return;
      this.p2pOrderStore.ingestGossipOrder(transition);
      if (transition.side === 'sell' && transition.escrowLocked) {
        this.p2pEscrow.lock(this.walletManager, transition.maker, transition.pohAmount);
      }
      return;
    }
    if (transition.type === 'p2p-order-cancelled') {
      if (this._appliedP2PIds.has(`order-cancel-${transition.orderId}`)) return;
      const cancelOrder = this.p2pOrderStore.getOrder(transition.orderId);
      if (cancelOrder && cancelOrder.status !== 'cancelled') {
        this.p2pOrderStore.cancelOrder(transition.orderId);
        if (transition.side === 'sell' && transition.escrowLocked) {
          this.p2pEscrow.release(this.walletManager, transition.maker, transition.pohAmount);
        }
      }
      return;
    }
    if (transition.type === 'p2p-trade-created') {
      if (this._appliedP2PIds.has(`trade-${transition.id}`)) return;
      this.p2pOrderStore.ingestGossipTrade(transition);
      if (transition.orderSide === 'buy') {
        this.p2pEscrow.lock(this.walletManager, transition.taker, transition.pohAmount);
      }
      return;
    }
    if (transition.type === 'p2p-trade-payment-sent') {
      if (this._appliedP2PIds.has(`trade-${transition.tradeId}-payment-sent`)) return;
      this.p2pOrderStore.markPaymentSent(transition.tradeId);
      return;
    }
    if (transition.type === 'p2p-trade-release') {
      if (this._appliedP2PIds.has(`trade-${transition.tradeId}-release`)) return;
      const releaseTrade = this.p2pOrderStore.getTrade(transition.tradeId);
      if (releaseTrade) {
        this.p2pEscrow.release(this.walletManager, transition.recipient, transition.pohAmount);
        this.p2pOrderStore.completeTrade(transition.tradeId);
      }
      return;
    }
    if (transition.type === 'p2p-trade-cancel') {
      if (this._appliedP2PIds.has(`trade-${transition.tradeId}-cancel`)) return;
      const cancelTrade = this.p2pOrderStore.getTrade(transition.tradeId);
      if (cancelTrade) {
        if (transition.escrowLocked) {
          this.p2pEscrow.release(this.walletManager, transition.locker, transition.pohAmount);
        }
        this.p2pOrderStore.cancelTrade(transition.tradeId);
      }
      return;
    }
    if (transition.type === 'p2p-trade-dispute') {
      if (this._appliedP2PIds.has(`trade-${transition.tradeId}-dispute`)) return;
      this.p2pOrderStore.disputeTrade(transition.tradeId, { reason: transition.reason });
      return;
    }

    // Skill audit verdict — replayed on proposer node to finalize the proposal
    if (transition.type === 'skill-audit-result') {
      this._applySkillAuditResult(transition, null);
      return;
    }

    // Job payment lifecycle transitions
    if (transition.type === 'job-feedback') {
      if (!feedbackStore.getByJob(transition.jobId)) {
        feedbackStore.apply(transition);
        if (transition.rating === 'negative' && transition.minerAddress === this.config.wallet) {
          this.applySlashing(0.05);
        }
      }
      return;
    }
    if (transition.type === 'job-escrow') {
      this._applyEscrow(transition);
      return;
    }
    if (transition.type === 'job-settled' || transition.type === 'job-timeout') {
      this._applySettlement(transition);
      return;
    }

    // Layer 6: skill lifecycle transitions
    if (transition.type === 'skill-proposed' || transition.type === 'skill-graduated' || transition.type === 'skill-deprecated') {
      skillsManager.processTransition(transition);
      return;
    }

    // Skill stake tally — replayed on all nodes so stake state is deterministic.
    // txHash dedup prevents double-apply when both gossip and block carry the same event.
    if (transition.type === 'skill-staked') {
      const { skillId, staker, amount, txHash } = transition;
      if (!skillId || !staker || !amount) return;
      if (txHash && this._appliedStakeTxs.has(txHash)) return;
      if (!this._skillStakes.has(skillId)) this._skillStakes.set(skillId, { total: 0, stakers: new Map() });
      const entry = this._skillStakes.get(skillId);
      entry.stakers.set(staker, (entry.stakers.get(staker) || 0) + amount);
      entry.total = (entry.total || 0) + amount;
      if (txHash) this._appliedStakeTxs.add(txHash);
      const GRADUATION_THRESHOLD = 10000 * POH_DECIMALS;
      if (entry.total >= GRADUATION_THRESHOLD) {
        const skill = skillsManager.getAllSkills().find(s => s.id === skillId);
        if (skill && skill.status !== 'active') {
          const grad = { type: 'skill-graduated', skillId };
          skillsManager.processTransition(grad);
          this.pendingBrainTransitions.push(grad);
        }
      }
      this._saveSkillStakes();
      return;
    }

    if (transition.type === 'skill-unstaked') {
      const { skillId, staker, amount, txHash } = transition;
      if (!skillId || !staker || !amount) return;
      if (txHash && this._appliedStakeTxs.has(txHash)) return;
      const entry = this._skillStakes.get(skillId);
      if (!entry) return;
      entry.stakers.set(staker, Math.max(0, (entry.stakers.get(staker) || 0) - amount));
      entry.total = Math.max(0, (entry.total || 0) - amount);
      if (txHash) this._appliedStakeTxs.add(txHash);
      this._saveSkillStakes();
      return;
    }

    if (!this.methodsManager) return;

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

  // ── Skill staking helpers ───────────────────────────────────────────────────

  _getStakeDir() {
    const brainDir = getBrainDataDir();
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return brainDir || path.join(homeDir, '.poh-miner', 'brain');
  }

  _initStakeVault() {
    try {
      const stakeDir = this._getStakeDir();
      fs.mkdirSync(stakeDir, { recursive: true });
      const vaultRefPath = path.join(stakeDir, 'skill_stake_vault.json');
      if (fs.existsSync(vaultRefPath)) {
        const { address } = JSON.parse(fs.readFileSync(vaultRefPath, 'utf8'));
        // Verify the vault wallet exists in walletManager (has signing keys)
        if (this.walletManager.loadWallet(address)) {
          this.SKILL_STAKE_VAULT = address;
        } else {
          // Vault reference exists but wallet file missing — recreate
          const vault = this.walletManager.createWallet();
          fs.writeFileSync(vaultRefPath, JSON.stringify({ address: vault.address }));
          this.SKILL_STAKE_VAULT = vault.address;
          console.log(`[PoH-Miner] Skill stake vault recreated: ${vault.address}`);
        }
      } else {
        const vault = this.walletManager.createWallet();
        fs.writeFileSync(vaultRefPath, JSON.stringify({ address: vault.address }));
        this.SKILL_STAKE_VAULT = vault.address;
        console.log(`[PoH-Miner] Skill stake vault created: ${vault.address}`);
      }
    } catch (e) {
      console.warn('[PoH-Miner] Skill stake vault init failed:', e.message);
    }
  }

  _loadSkillStakes() {
    try {
      const stakesPath = path.join(this._getStakeDir(), 'skill_stakes.json');
      if (!fs.existsSync(stakesPath)) return;
      const data = JSON.parse(fs.readFileSync(stakesPath, 'utf8'));
      this._skillStakes = new Map();
      for (const [skillId, entry] of Object.entries(data)) {
        this._skillStakes.set(skillId, {
          total: entry.total || 0,
          stakers: new Map(Object.entries(entry.stakers || {})),
        });
      }
      console.log(`[PoH-Miner] Loaded skill stakes: ${this._skillStakes.size} skills`);
    } catch (e) {
      console.warn('[PoH-Miner] Failed to load skill stakes:', e.message);
    }
  }

  _saveSkillStakes() {
    try {
      const stakesPath = path.join(this._getStakeDir(), 'skill_stakes.json');
      const data = {};
      for (const [skillId, entry] of this._skillStakes) {
        data[skillId] = {
          total: entry.total || 0,
          stakers: Object.fromEntries(entry.stakers || new Map()),
        };
      }
      fs.writeFileSync(stakesPath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn('[PoH-Miner] Failed to save skill stakes:', e.message);
    }
  }

  // Returns true if the skill is active on this node.
  // DEFAULT_ENABLED_SKILLS are on unless the user explicitly toggled them off.
  // All other skills are off unless the user explicitly enabled them.
  isSkillEnabled(skillId) {
    if (DEFAULT_ENABLED_SKILLS.has(skillId)) {
      return !this._explicitDisabled.has(skillId);
    }
    return this._skillPrefs.has(skillId);
  }

  _loadSkillPrefs() {
    try {
      const prefsPath = path.join(this._getStakeDir(), 'skill_prefs.json');
      if (!fs.existsSync(prefsPath)) {
        // First run: start with all defaults enabled
        for (const id of DEFAULT_ENABLED_SKILLS) this._skillPrefs.add(id);
        this._saveSkillPrefs();
        console.log(`[PoH-Miner] Initialized skill prefs with ${DEFAULT_ENABLED_SKILLS.size} default skills`);
        return;
      }
      const data = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      const enabled  = Array.isArray(data.enabled)  ? data.enabled  : [];
      const disabled = Array.isArray(data.disabled)  ? data.disabled  : [];
      this._skillPrefs       = new Set(enabled);
      this._explicitDisabled = new Set(disabled);
      // Auto-enable any new default skills not yet seen in this node's prefs
      const seenDefaults = new Set(data.seenDefaults || []);
      let changed = false;
      for (const id of DEFAULT_ENABLED_SKILLS) {
        if (!seenDefaults.has(id) && !this._explicitDisabled.has(id)) {
          this._skillPrefs.add(id);
          changed = true;
        }
      }
      if (changed) this._saveSkillPrefs();
      console.log(`[PoH-Miner] Loaded skill prefs: ${this._skillPrefs.size} enabled, ${this._explicitDisabled.size} explicitly disabled`);
    } catch (e) {
      console.warn('[PoH-Miner] Failed to load skill prefs:', e.message);
    }
  }

  _saveSkillPrefs() {
    try {
      const prefsPath = path.join(this._getStakeDir(), 'skill_prefs.json');
      fs.writeFileSync(prefsPath, JSON.stringify({
        enabled:       [...this._skillPrefs],
        disabled:      [...this._explicitDisabled],
        seenDefaults:  [...DEFAULT_ENABLED_SKILLS],
      }, null, 2));
    } catch (e) {
      console.warn('[PoH-Miner] Failed to save skill prefs:', e.message);
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
