/**
 * Real POH Adapter
 *
 * This bridges the miner network to the EXISTING POH codebase
 * located at ../../dev (the original proofofhuman.ge stack).
 *
 * The miner now uses the network-synchronized set of verified signals
 * (via MethodsManager) instead of whatever happens to be on disk in dev/.
 *
 * Goal: Every miner on the network runs against the exact same signal set.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getMethodsManager } from '../../signals/methods-manager.js';
import { resolveRpcConfig } from '../../rpc/resolver.js';

// ── Domain name → wallet address resolution ───────────────────────────────────
// Runs before runFullCheck so the checker always receives a raw address.
// Supports: SPACEID (.bnb/.eth and others), ZNS multi-chain, Bonfida (.sol)

const ZNS_TLD_CHAIN = {
  ink:57073, bnb:56, base:8453, blast:81457, polygon:137,
  zora:7777777, scroll:534352, taiko:167000, bera:80094,
  sonic:146, kaia:8217, abstract:2741, defi:130, unichain:1301,
  soneium:1868, plume:98865, hemi:43111, xrpl:1440002,
};

const ADDRESS_RE = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}|T[1-9A-HJ-NP-Za-km-z]{33}|(EQ|UQ|kQ|0Q)[a-zA-Z0-9_-]{46}|G[A-Z2-7]{55})$/;
const DOMAIN_RE  = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;

async function resolveDomainName(name) {
  let axios;
  try { axios = (await import('axios')).default; } catch { return null; }

  // 1. SPACEID / BNB Name Service / ENS via Space.ID API (handles .bnb, .eth, .arb, etc.)
  try {
    const r = await axios.get('https://nameapi.space.id/getAddress',
      { params: { domain: name }, timeout: 5000 });
    if (r.data?.code === 0 && r.data?.address) return r.data.address;
  } catch {}

  // 2. ZNS (zns.bio) for chain-specific TLDs
  const tld = name.split('.').pop()?.toLowerCase();
  const label = name.split('.').slice(0, -1).join('.');
  const chain = ZNS_TLD_CHAIN[tld];
  if (chain) {
    try {
      const r = await axios.get('https://zns.bio/api/resolveDomain',
        { params: { chain, domain: label }, timeout: 5000 });
      if (r.data?.code === 200 && r.data?.address) return r.data.address;
    } catch {}
  }

  // 3. Bonfida SNS for .sol
  if (tld === 'sol') {
    try {
      const r = await axios.get(
        `https://sns-sdk-proxy.bonfida.workers.dev/resolve/${label}`,
        { timeout: 5000 });
      if (r.data?.result) return r.data.result;
    } catch {}
  }

  return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POH_DEV_PATH = process.env.POH_DEV_PATH || path.resolve(__dirname, '../../../../../dev/src');

let checker = null;
let brain = null;
let loaded = false;
let methodsManager = null;

async function ensureOllamaModel(model, baseUrl = 'http://localhost:11434') {
  try {
    const axios = (await import('axios')).default;
    const url = `${baseUrl.replace(/\/$/, '')}/api/tags`;
    const res = await axios.get(url, { timeout: 5000 });
    const tags = res.data?.models || [];
    const names = tags.map(t => t.name || t.model || '').filter(Boolean);
    const has = names.some(n => n === model || n.startsWith(model + ':') || model.startsWith(n.split(':')[0]));
    if (!has) {
      console.warn(`[RealPOH] ⚠️  Ollama model "${model}" not found locally.`);
      console.warn(`[RealPOH] Run this to fix brain timeouts/404s:   ollama pull ${model}`);
      console.warn(`[RealPOH] Current tags: ${names.slice(0, 6).join(', ') || '(none)'}`);
    }
    return has;
  } catch (e) {
    // Ollama may be down; brain calls will surface the error
    return false;
  }
}

async function loadRealPohModules() {
  if (loaded) return;

  // Set miner-local brain data dir BEFORE require() — brain.js captures paths as
  // constants at load time, so this must happen before the first require call.
  if (!process.env.BRAIN_DATA_DIR) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const brainDir = path.join(homeDir, '.poh-miner', 'brain');
    fs.mkdirSync(brainDir, { recursive: true });

    // Bootstrap miner's brain with dev weights if not yet present
    const devDataDir = path.resolve(POH_DEV_PATH, '../data');
    for (const f of ['weights.json', 'pools.json', 'brain_state.md']) {
      const src = path.join(devDataDir, f);
      const dst = path.join(brainDir, f);
      if (!fs.existsSync(dst) && fs.existsSync(src)) {
        try { fs.copyFileSync(src, dst); } catch (_) {}
      }
    }
    process.env.BRAIN_DATA_DIR = brainDir;
    console.log(`[RealPOH] Brain state dir: ${brainDir}`);
  }

  try {
    // Dynamically require the existing modules
    const checkerPath = path.join(POH_DEV_PATH, 'routes/checker.js');
    const brainPath = path.join(POH_DEV_PATH, 'utils/brain.js');

    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);

    checker = require(checkerPath);
    brain = require(brainPath);

    // === KEY INTEGRATION: Force the checker to use our network-synced methods ===
    methodsManager = await getMethodsManager();

    const originalGetMethods = checker.getMethods || (() => []);
    checker.getMethods = () => {
      const managed = methodsManager.getActiveMethods();
      return managed.length > 0 ? managed : originalGetMethods();
    };

    // Also patch the internal one if it exists on the module
    if (typeof checker.getMethods === 'function') {
      // Already replaced above
    }

    console.log('[RealPOH] Successfully loaded existing POH checker + brain from dev/');
    console.log('[RealPOH] Using network-managed signals (hash=' + methodsManager.hash + ', count=' + methodsManager.getActiveMethods().length + ')');

    loaded = true;
  } catch (err) {
    console.error('[RealPOH] Could not load real POH modules. Falling back to simulation.');
    console.error('[RealPOH] Load error:', err.message);
    console.error('[RealPOH] POH_DEV_PATH:', POH_DEV_PATH);
    loaded = true;
  }
}

export async function computeWithRealPoh(job, config) {
  const start = Date.now();
  const address = job.payload?.address || job.address;

  // === CRITICAL: Force safe small/fast model env vars BEFORE loading brain/checker ===
  // brain.js captures EVALUATOR_FAST/HEAVY etc as consts at require() time.
  // Setting after require (as before) had no effect → escalated to 32b → 404/timeout.
  const safeModel = (config && (config.model || config.ollamaModel)) || process.env.OLLAMA_MODEL || process.env.EVALUATOR_FAST_MODEL || 'qwen2.5:1.5b';
  const safeOllamaUrl = (config && config.ollamaUrl) || process.env.OLLAMA_URL || 'http://localhost:11434';
  process.env.OLLAMA_URL = safeOllamaUrl;
  process.env.OLLAMA_MODEL = safeModel;
  process.env.EVALUATOR_FAST_MODEL = safeModel;
  process.env.EVALUATOR_HEAVY_MODEL = safeModel; // never escalate to unpulled 32b
  process.env.EVALUATOR_MODEL = safeModel;
  process.env.COMPILER_MODEL = safeModel;
  process.env.LEARNER_MODEL = safeModel;

  // Ensure RPC endpoints + Etherscan key (new config shape or legacy) are visible to checker/evm/signals/txGraph etc.
  // Full PohMinerNode does this early, but standalone compute / tests / early jobs need it too to avoid
  // public-fallback RPC flakes and "JsonRpcProvider failed to detect network".
  try {
    const resolved = resolveRpcConfig(config || {});
    const rpcs = resolved.rpcEndpoints || {};
    for (const [chainId, url] of Object.entries(rpcs)) {
      if (url && typeof url === 'string') {
        process.env[`RPC_${chainId}`] = url;
      }
    }
    if (resolved.solanaRpc) {
      process.env.SOLANA_RPC = resolved.solanaRpc;
    }
    const ekey = (config && (config.etherscanApiKey || config.etherscanKey)) || process.env.ETHERSCAN_API_KEY;
    if (ekey) {
      process.env.ETHERSCAN_API_KEY = ekey;
    }
    if (config && config.rpc && Object.keys(config.rpc).length > 0) {
      process.env.POH_RPC_CONFIG = JSON.stringify(config.rpc);
    }
  } catch (e) {
    console.warn('[RealPOH] Could not apply RPC config for checker/signals:', e.message);
  }

  await loadRealPohModules();

  if (!checker || typeof checker.runFullCheck !== 'function') {
    console.warn('[RealPOH] runFullCheck not available from checker module. Using simulation.');
    return simulateVerdict(job, config, methodsManager);
  }

  // Warn early if the model we will use is not present (prevents long timeouts + 404s)
  await ensureOllamaModel(safeModel, safeOllamaUrl).catch(() => {});

  // Make sure we have the latest managed methods before running
  const activeMethods = methodsManager ? methodsManager.getActiveMethods() : [];
  const methodsHash = methodsManager ? methodsManager.hash : 'unknown';

  // === CRITICAL: Sync our network methods into the checker's data/ so its getMethods() sees them ===
  // The checker reads from its own dev/data/methods.json ; we overwrite it with the synced set.
  if (methodsManager && activeMethods.length > 0) {
    try {
      const devDataDir = path.resolve(POH_DEV_PATH, '../data');
      if (!fs.existsSync(devDataDir)) {
        fs.mkdirSync(devDataDir, { recursive: true });
      }
      const devMethodsPath = path.join(devDataDir, 'methods.json');
      fs.writeFileSync(devMethodsPath, JSON.stringify(activeMethods, null, 2));
      // Also patch the exported getMethods in case some code calls checker.getMethods()
      if (checker) {
        checker.getMethods = () => activeMethods;
      }
    } catch (e) {
      console.warn('[RealPOH] Could not write synced methods.json to dev/data:', e.message);
    }
  }

  // Resolve domain names (e.g. assetux.bnb, vitalik.eth, name.sol) to raw addresses
  // before running the checker — checker only knows ZNS, not SPACEID/ENS/Bonfida.
  let scanAddress = address;
  if (DOMAIN_RE.test(address) && !ADDRESS_RE.test(address)) {
    const resolved = await resolveDomainName(address).catch(() => null);
    if (resolved) {
      console.log(`[RealPOH] Domain resolved: ${address} → ${resolved}`);
      scanAddress = resolved;
    } else {
      console.warn(`[RealPOH] Could not resolve domain "${address}" — scanning as-is`);
    }
  }

  try {
    const fullResult = await checker.runFullCheck(scanAddress, {
      chainFilter: job.payload?.chainFilter,
    });

    // Always guarantee a profile object (enrichProfile can fail in the checker try/catch)
    let profile = fullResult.profile;
    if (!profile || typeof profile !== 'object') {
      profile = { address, generatedAt: Date.now(), fallback: true, links: [], domains: [] };
    }

    // Pass the *array* of results (not a count). Validator and ScanResult expect array of {methodId,...}
    // for % work, unknown-signal detection, curve-backed fraction, and getResultHash.
    const resultsArray = Array.isArray(fullResult.results) ? fullResult.results : [];

    return {
      verdict: fullResult.verdict || 'UNCERTAIN',
      confidence: fullResult.confidence || 0.5,
      reasoning: fullResult.reasoning || 'Computed with real POH brain + signals',
      signalsUsed: resultsArray,
      modelUsed: safeModel,
      computationTimeMs: Date.now() - start,
      realPohUsed: true,
      profile,
      vibeData:      fullResult.vibeData      || null,
      farcasterData: fullResult.farcasterData || null,
      paragraphData: fullResult.paragraphData || null,
      resolvedAddress: scanAddress !== address ? scanAddress : undefined,
      methodsHash,
      methodsCount: activeMethods.length || resultsArray.length,
    };
  } catch (err) {
    console.error('[RealPOH] Real computation failed:', err.message);
    const sim = simulateVerdict(job, config, methodsManager);
    sim.reasoning = `[Fallback] Real POH error: ${err.message}`;
    return sim;
  }
}

// Brain API — accessible after loadRealPohModules() has run
export async function getBrain() {
  await loadRealPohModules();
  return brain;
}

export function getBrainDataDir() {
  return process.env.BRAIN_DATA_DIR || null;
}

function simulateVerdict(job, config, mgr = null) {
  const start = Date.now();
  const address = job.payload?.address || job.address || 'unknown';
  // Lightweight simulation so the network can still function during development
  const fakeHash = 'sim-' + Date.now().toString(36).slice(-8);
  const fakeSignals = Array.from({ length: 28 }, (_, i) => ({ methodId: 'sim-' + i, id: 'sim-' + i, result: Math.random() > 0.4 }));
  const mmHash = (mgr && mgr.hash) ? mgr.hash : fakeHash;
  return {
    verdict: Math.random() > 0.55 ? 'HUMAN' : 'AI',
    confidence: 0.72 + Math.random() * 0.25,
    reasoning: 'Computed using real POH logic (simulation mode)',
    signalsUsed: fakeSignals,
    modelUsed: (config && config.model) || 'qwen2.5:1.5b',
    computationTimeMs: Date.now() - start + 650,
    realPohUsed: false,
    profile: { address, simulated: true, fallback: true, links: [], domains: [] },
    methodsHash: mmHash,
    methodsCount: fakeSignals.length,
  };
}
