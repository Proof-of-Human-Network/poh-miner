'use strict';

/**
 * qvac-models.js — QVAC SDK model manager (single source of truth for inference).
 *
 * Replaces Ollama entirely. One process-wide singleton owns:
 *   - the @qvac/sdk instance (lazy dynamic import — the SDK is ESM-only)
 *   - a map of loaded models (friendly name → { modelId, lastUsed })
 *   - load-on-demand + LRU unload (QVAC keeps models resident in RAM, unlike
 *     Ollama which swaps them on disk, so we cap how many stay loaded)
 *   - a serialized completion queue (llama.cpp is single-threaded)
 *   - a circuit breaker so repeated failures don't stall every caller
 *
 * Both the CommonJS brain (require) and the ESM miner node (via real-poh's
 * createRequire bridge) resolve to THIS cached module, so they share one
 * SDK instance and one set of loaded weights.
 */

// ── Config (env-overridable) ────────────────────────────────────────────────
const DEFAULT_MODEL = process.env.QVAC_DEFAULT_MODEL || 'QWEN3_1_7B_INST_Q4';
const MAX_RESIDENT  = Math.max(1, parseInt(process.env.QVAC_MAX_RESIDENT || '2', 10));
const CTX_SIZE      = parseInt(process.env.QVAC_CTX_SIZE || '8192', 10);
const ENABLED       = process.env.QVAC_DISABLED !== '1';

// Friendly aliases → SDK constant names. Also maps legacy Ollama model ids
// (e.g. from an old config.json) onto the default so nothing 404s.
const ALIASES = {
  'qwen3-0.6b': 'QWEN3_600M_INST_Q4',
  'qwen3-600m': 'QWEN3_600M_INST_Q4',
  'qwen3-1.7b': 'QWEN3_1_7B_INST_Q4',
  'qwen3':      'QWEN3_1_7B_INST_Q4',
  'qwen3-4b':   'QWEN3_4B_INST_Q4_K_M',
  'qwen3-8b':   'QWEN3_8B_INST_Q4_K_M',
  'smollm2-360m': 'SMOLLM2_360M_INST_Q8',
  'llama3.2-1b':  'LLAMA_3_2_1B_INST_Q4_0',
  'llama-tool-1b': 'LLAMA_TOOL_CALLING_1B_INST_Q4_K',
  'gpt-oss-20b':  'GPT_OSS_20B_INST_Q4_K_M',
  'qwen3-27b':    'QWEN3_6_27B_MULTIMODAL_Q4_K_XL',
  'qwen3-35b':    'QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M',
  'gpt-oss-120b': 'GPT_OSS_120B_INST_Q4_K_M_SHARD',
  // Vision / multimodal (image attachments)
  'smolvlm2-500m': 'SMOLVLM2_500M_MULTIMODAL_Q8_0',
  'qwen3vl-2b':    'QWEN3VL_2B_MULTIMODAL_Q4_K',
  'qwen3.5-2b-mm': 'QWEN3_5_2B_MULTIMODAL_Q4_K_M',
  'qwen3.5-4b-mm': 'QWEN3_5_4B_MULTIMODAL_Q4_K_M',
  'gemma4-2b-mm':  'GEMMA4_2B_MULTIMODAL_Q4_K_M',
  // legacy Ollama names → default so old configs keep working
  'qwen2.5:1.5b': DEFAULT_MODEL,
  'qwen2.5':      DEFAULT_MODEL,
  'phi3:mini':    DEFAULT_MODEL,
  // Guard against UI bugs that send field names as the model id
  'model_used':   DEFAULT_MODEL,
  'modelused':    DEFAULT_MODEL,
};

// Curated list surfaced to the model picker (in addition to loaded + registry).
const BUILTIN_MODELS = [
  { name: 'smollm2-360m',  label: 'SmolLM2 360M (ultra-tiny)', constant: 'SMOLLM2_360M_INST_Q8' },
  { name: 'qwen3-0.6b',    label: 'Qwen3 0.6B (tiny)',         constant: 'QWEN3_600M_INST_Q4' },
  { name: 'llama3.2-1b',   label: 'Llama 3.2 1B',              constant: 'LLAMA_3_2_1B_INST_Q4_0' },
  { name: 'llama-tool-1b', label: 'Llama Tool-Calling 1B',     constant: 'LLAMA_TOOL_CALLING_1B_INST_Q4_K' },
  { name: 'qwen3-1.7b',    label: 'Qwen3 1.7B (default)',      constant: 'QWEN3_1_7B_INST_Q4' },
  { name: 'qwen3-4b',      label: 'Qwen3 4B',                  constant: 'QWEN3_4B_INST_Q4_K_M' },
  { name: 'qwen3-8b',      label: 'Qwen3 8B',                  constant: 'QWEN3_8B_INST_Q4_K_M' },
  { name: 'smolvlm2-500m', label: 'SmolVLM2 500M (vision)',    constant: 'SMOLVLM2_500M_MULTIMODAL_Q8_0' },
  { name: 'qwen3vl-2b',    label: 'Qwen3-VL 2B (vision)',      constant: 'QWEN3VL_2B_MULTIMODAL_Q4_K' },
  { name: 'qwen3.5-2b-mm', label: 'Qwen3.5 2B Multimodal',     constant: 'QWEN3_5_2B_MULTIMODAL_Q4_K_M' },
  { name: 'qwen3.5-4b-mm', label: 'Qwen3.5 4B Multimodal',     constant: 'QWEN3_5_4B_MULTIMODAL_Q4_K_M' },
  { name: 'gemma4-2b-mm',  label: 'Gemma4 2B Multimodal',      constant: 'GEMMA4_2B_MULTIMODAL_Q4_K_M' },
  { name: 'gpt-oss-20b',   label: 'GPT-OSS 20B',               constant: 'GPT_OSS_20B_INST_Q4_K_M' },
  { name: 'qwen3-27b',     label: 'Qwen3.6 27B',               constant: 'QWEN3_6_27B_MULTIMODAL_Q4_K_XL' },
  { name: 'qwen3-35b',     label: 'Qwen3.6 35B-A3B (MoE)',     constant: 'QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M' },
  { name: 'gpt-oss-120b',  label: 'GPT-OSS 120B',              constant: 'GPT_OSS_120B_INST_Q4_K_M_SHARD' },
];

// ── Singleton state ─────────────────────────────────────────────────────────
let _sdk = null;
const _loaded = new Map();        // canonicalName → { modelId, lastUsed }
const _loadPromises = new Map();  // canonicalName → Promise<modelId>

let _queue = Promise.resolve();
function enqueue(fn) {
  _queue = _queue.then(fn, fn);
  return _queue;
}

// Download/warm-up tracker — canonicalName → { model, requested, state, pct,
// error, startedAt, finishedAt }. state: 'downloading' | 'ready' | 'error'.
// Queried by /api/models/status and the Electron setup screen so a failed
// first-start download can be seen and retried manually from the UI.
const _downloads = new Map();

function _trackDownload(name, patch) {
  const cur = _downloads.get(name) || { model: name, state: 'downloading', pct: null, error: null, startedAt: Date.now(), finishedAt: null };
  _downloads.set(name, Object.assign(cur, patch));
}

// Status for one model (alias-resolved) or all tracked downloads.
function downloadStatus(name) {
  if (name) {
    const canonical = ALIASES[(name || '').toLowerCase()] || name;
    return _downloads.get(canonical) || _downloads.get(name) || null;
  }
  return [..._downloads.values()];
}

// Circuit breaker
let _failures = 0;
const CIRCUIT_OPEN_AFTER = 3;
const RETRY_AFTER_MS = 5 * 60 * 1000;
let _circuitOpenAt = 0;

function circuitOpen() {
  if (!_circuitOpenAt) return false;
  if (Date.now() - _circuitOpenAt < RETRY_AFTER_MS) return true;
  _circuitOpenAt = 0;
  _failures = 0;
  return false;
}

async function getSdk() {
  if (_sdk) return _sdk;
  _sdk = await import('@qvac/sdk');
  return _sdk;
}

// ── Model name resolution ───────────────────────────────────────────────────
// Returns { name, modelSrc, fallbackSrc? } where modelSrc is either an SDK
// descriptor (constant value), a raw string (path / URL / HuggingFace GGUF),
// or — when the blob is already fully cached on disk — the local file path.

// Look up an already-downloaded blob for an SDK model constant. loadModel with
// a registry:// descriptor re-resolves through the P2P registry even when the
// blob is cached, which hangs indefinitely on flaky networks; a plain local
// path skips the network entirely. Returns null when not cached.
function localBlobPath(descriptor) {
  const modelId = descriptor && descriptor.modelId;
  if (!modelId) return null;
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const dir = path.join(os.homedir(), '.qvac', 'models');
    const hit = fs.readdirSync(dir).find(f => f.endsWith(`_${modelId}`) || f === modelId);
    if (!hit) return null;
    const full = path.join(dir, hit);
    if (fs.statSync(full).size < 1024 * 1024) return null; // ignore stubs
    return full;
  } catch {
    return null;
  }
}

// Model descriptors read straight from the SDK's static registry data file
// (dist/models/registry/models.js) — pure `export const` data with NO native
// imports. This lets us map a constant → { modelId } for on-disk detection even
// when the full SDK (native inference addon) fails to load, which is exactly the
// case on a Windows box missing Vulkan/MSVC runtime: inference is dead, but a
// model may still be downloaded from an earlier run and should be detectable.
let _registryDescriptors = null;   // null = not tried; {} = tried, unavailable
async function getRegistryDescriptors() {
  if (_registryDescriptors) return _registryDescriptors;
  try {
    const fs = require('fs');
    const path = require('path');
    const url = require('url');
    // Find node_modules/@qvac/sdk by walking up from this file (the package's
    // `exports` map blocks subpath imports, so we import the file by absolute
    // URL, which bypasses the map entirely).
    let dir = __dirname, root = null;
    for (let i = 0; i < 8 && !root; i++) {
      const cand = path.join(dir, 'node_modules', '@qvac', 'sdk');
      if (fs.existsSync(path.join(cand, 'package.json'))) root = cand;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!root) { _registryDescriptors = {}; return _registryDescriptors; }
    const file = path.join(root, 'dist', 'models', 'registry', 'models.js');
    if (!fs.existsSync(file)) { _registryDescriptors = {}; return _registryDescriptors; }
    const mod = await import(url.pathToFileURL(file).href);
    // Named exports are the constants (QWEN3_… = { modelId, … }); drop the
    // aggregate `models` array so it doesn't masquerade as a descriptor.
    const out = {};
    for (const [k, v] of Object.entries(mod)) {
      if (v && typeof v === 'object' && v.modelId) out[k] = v;
    }
    _registryDescriptors = out;
  } catch {
    _registryDescriptors = {};
  }
  return _registryDescriptors;
}

// Resolve a model constant to a { modelId } descriptor for on-disk detection.
// Order matters: an already-resident SDK first (free), then the static registry
// data (fast, no native), and only as a last resort a fresh getSdk() — which can
// hang or throw when the native addon is broken. Detection must never hang, so
// the registry path is what carries Windows-without-inference.
async function descriptorFor(constant) {
  if (!constant) return null;
  if (_sdk && _sdk[constant]) return _sdk[constant];
  const reg = await getRegistryDescriptors();
  if (reg[constant]) return reg[constant];
  try { const sdk = await getSdk(); if (sdk && sdk[constant]) return sdk[constant]; } catch { /* addon dead */ }
  return null;
}

function resolveModel(sdk, requested) {
  const raw = (requested || '').trim() || DEFAULT_MODEL;

  // Raw path / URL / HuggingFace GGUF — passed straight to loadModel.
  if (/^(https?:|pear:|\/|\.\/|~\/)/.test(raw) || raw.endsWith('.gguf')) {
    return { name: raw, modelSrc: raw };
  }

  // Alias (case-insensitive) → SDK constant name.
  const aliased = ALIASES[raw.toLowerCase()] || raw;

  // Exact SDK exported constant — prefer the cached local blob when present,
  // keeping the registry descriptor as fallback (e.g. truncated cache file).
  if (sdk[aliased]) {
    const local = localBlobPath(sdk[aliased]);
    if (local) return { name: aliased, modelSrc: local, fallbackSrc: sdk[aliased] };
    return { name: aliased, modelSrc: sdk[aliased] };
  }

  // Fall back to the default constant.
  if (sdk[DEFAULT_MODEL]) {
    const local = localBlobPath(sdk[DEFAULT_MODEL]);
    if (local) return { name: DEFAULT_MODEL, modelSrc: local, fallbackSrc: sdk[DEFAULT_MODEL] };
    return { name: DEFAULT_MODEL, modelSrc: sdk[DEFAULT_MODEL] };
  }

  throw new Error(`Unknown model "${requested}" and default ${DEFAULT_MODEL} is not exported by @qvac/sdk`);
}

// ── Load-on-demand + LRU unload ─────────────────────────────────────────────
async function evictIfNeeded(keepName) {
  while (_loaded.size >= MAX_RESIDENT) {
    // pick least-recently-used, excluding the model we're about to (re)use
    let lruName = null, lruTime = Infinity;
    for (const [name, e] of _loaded) {
      if (name === keepName) continue;
      if (e.lastUsed < lruTime) { lruTime = e.lastUsed; lruName = name; }
    }
    if (!lruName) break;
    const entry = _loaded.get(lruName);
    _loaded.delete(lruName);
    try {
      const sdk = await getSdk();
      await sdk.unloadModel({ modelId: entry.modelId });
      console.log(`[qvac] Unloaded LRU model ${lruName} to free memory`);
    } catch (e) {
      console.warn(`[qvac] Unload of ${lruName} failed: ${e.message}`);
    }
  }
}

async function getModelId(requested) {
  const sdk = await getSdk();
  const { name, modelSrc, fallbackSrc } = resolveModel(sdk, requested);

  const existing = _loaded.get(name);
  if (existing) { existing.lastUsed = Date.now(); return existing.modelId; }

  if (_loadPromises.has(name)) return _loadPromises.get(name);

  const loadOnce = async (src, label) => {
    console.log(`[qvac] Loading model ${name}${label ? ` (${label})` : ''}...`);
    return sdk.loadModel({
      modelSrc: src,
      modelType: 'llm',
      modelConfig: { ctx_size: CTX_SIZE, verbosity: 0 },
      onProgress: (pr) => {
        const pct = pr && pr.percentage;
        if (pct == null) return;
        _trackDownload(name, { state: 'downloading', pct: Math.min(100, Math.round(pct)), requested });
        if (pct > 0 && Math.round(pct) % 25 === 0) {
          console.log(`[qvac] ${name} download: ${pct.toFixed(0)}%`);
        }
      },
    });
  };

  const p = (async () => {
    _trackDownload(name, { state: 'downloading', pct: null, error: null, startedAt: Date.now(), finishedAt: null, requested });
    await evictIfNeeded(name);
    let modelId;
    try {
      modelId = await loadOnce(modelSrc, fallbackSrc ? 'local blob' : '');
    } catch (err) {
      // Local blob unusable (truncated/corrupt) — re-fetch via the registry.
      if (!fallbackSrc) throw err;
      console.warn(`[qvac] Local blob load failed (${err.message}) — retrying via registry`);
      modelId = await loadOnce(fallbackSrc, 'registry');
    }
    _loaded.set(name, { modelId, lastUsed: Date.now() });
    _loadPromises.delete(name);
    _trackDownload(name, { state: 'ready', pct: 100, error: null, finishedAt: Date.now() });
    console.log(`[qvac] Model ready: ${name} (id=${modelId})`);
    return modelId;
  })();

  _loadPromises.set(name, p);
  try {
    return await p;
  } catch (err) {
    _loadPromises.delete(name);
    _trackDownload(name, { state: 'error', error: err.message || String(err), finishedAt: Date.now() });
    throw err;
  }
}

// Explicit, manually-triggered download + load of a model (POST /api/models/download,
// Electron "Download"/"Retry" buttons). Unlike a lazy first-job load there is no
// race timeout here — a multi-GB fetch is allowed to take as long as it takes —
// and a success clears the circuit breaker so chat recovers immediately.
async function downloadModel(requested) {
  if (!ENABLED) throw new Error('QVAC is disabled (QVAC_DISABLED=1)');
  const modelId = await getModelId(requested);
  _failures = 0;
  _circuitOpenAt = 0;
  return modelId;
}

// Rough prompt-token count for metering. QVAC's completion addon does not expose
// a tokenizer, so we approximate at ~4 chars/token (ceil) plus a small per-message
// role overhead. Conservative for billing: it never undercounts a real prompt by
// much, and the output side is metered exactly from the stream.
function estimatePromptTokens(history) {
  let chars = 0;
  for (const m of (history || [])) chars += (m?.content?.length || 0) + 4;
  return Math.ceil(chars / 4);
}

// Same approximation over a raw messages[] payload (before history assembly) —
// used by the fee pre-flight, where we only have the request body.
function estimateMessagesTokens(messages, systemPrompt) {
  const rows = [...(messages || [])];
  if (systemPrompt) rows.push({ content: systemPrompt });
  return estimatePromptTokens(rows);
}

// ── Chat completion (generic messages[] interface) ──────────────────────────
// messages: [{ role: 'system'|'user'|'assistant', content: string }, ...]
// Returns the assistant text, or null when QVAC is disabled/unavailable so
// callers can decide their own fallback.
async function chat(messages, opts = {}) {
  if (!ENABLED) return null;
  if (circuitOpen()) return null;

  const {
    model,
    maxTokens = 512,          // reserved; token cap enforced by ctx + stream length
    timeLimit = 120000,
    jsonMode = false,
    noThink = true,           // Qwen3: suppress chain-of-thought tokens
    systemPrompt,
    withUsage = false,        // when true, return { text, promptTokens, completionTokens, totalTokens }
    hardTokenCap = 0,         // stop generation after this many OUTPUT tokens (0 = uncapped)
    onToken = null,           // optional callback(token) for live streaming to a client
    shouldStop = null,        // optional () => bool, checked per token: true → cancel early
  } = opts;

  return enqueue(async () => {
    try {
      const modelId = await Promise.race([
        getModelId(model),
        new Promise((_, rej) => setTimeout(() => rej(new Error('QVAC model load timeout')), timeLimit)),
      ]);

      const sdk = await getSdk();

      // Build history; inject/override a system prompt when provided.
      const history = [];
      const sys = systemPrompt || (jsonMode
        ? 'You are a JSON-only responder. Output only valid JSON. No explanations, no markdown.'
        : null);
      if (sys) history.push({ role: 'system', content: sys });

      for (const m of (messages || [])) {
        if (m && m.role && m.content != null && ['system', 'user', 'assistant'].includes(m.role)) {
          const entry = { role: m.role, content: String(m.content) };
          // Multimodal: QVAC expects attachments: [{ path }] with a real filesystem path
          // (see @qvac/sdk completion-stream transformMessage → type:'media').
          if (Array.isArray(m.attachments) && m.attachments.length) {
            entry.attachments = m.attachments
              .filter(a => a && typeof a.path === 'string' && a.path.length)
              .map(a => ({ path: a.path }));
            if (!entry.attachments.length) delete entry.attachments;
          }
          history.push(entry);
        }
      }
      // Append /no_think to the last user turn for Qwen3 fast responses.
      if (noThink) {
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === 'user') { history[i] = { ...history[i], content: history[i].content + '\n/no_think' }; break; }
        }
      }

      const run = sdk.completion({ modelId, history, stream: true });
      let text = '';
      let completionTokens = 0;           // exact: one stream chunk == one output token
      for await (const token of run.tokenStream) {
        text += token;
        completionTokens++;
        if (onToken) { try { onToken(token); } catch { /* client hung up — keep counting */ } }
        // Cooperative cancel: a peer already published the winning result, so stop
        // burning compute on a job we've lost (see miner-node first-result-wins).
        if (shouldStop) { let stop = false; try { stop = !!shouldStop(); } catch { /* ignore */ } if (stop) { try { run.cancel?.(); } catch { /* */ } break; } }
        // No-refund hard cap: budget bounds output, so stop once we've generated
        // every token the requester paid for (see gas-estimator.outputTokenCap).
        if (hardTokenCap > 0 && completionTokens >= hardTokenCap) {
          try { run.cancel?.(); } catch { /* best-effort — loop break is enough */ }
          break;
        }
      }

      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      _failures = 0;
      if (withUsage) {
        const promptTokens = estimatePromptTokens(history);
        return { text, promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
      }
      return text;
    } catch (err) {
      _failures++;
      if (_failures >= CIRCUIT_OPEN_AFTER) {
        _circuitOpenAt = Date.now();
        console.warn(`[qvac] Circuit open after ${_failures} failures — retry in 5 min`);
      } else {
        console.error('[qvac] completion failed:', err.message);
      }
      return null;
    }
  });
}

// Convenience: single-prompt chat (matches the old brain.qvacChat shape).
async function complete(prompt, opts = {}) {
  return chat([{ role: 'user', content: String(prompt) }], opts);
}

// True when the model's weights are actually downloaded on this machine (≥1 MB
// blob under ~/.qvac/models). Needs the SDK to map the friendly/constant name to
// a modelId descriptor; returns false when the backend can't be loaded so the
// private-mode picker never advertises a model that can't run here. A currently
// loaded model is installed by definition (it came off disk).
async function isInstalled(name) {
  if (!ENABLED) return false;              // explicitly disabled (QVAC_DISABLED=1)
  if (_loaded.has(name)) return true;
  const aliased = ALIASES[(name || '').toLowerCase()] || name;
  if (_loaded.has(aliased)) return true;
  // Detect the on-disk blob via a descriptor sourced from the static registry
  // when needed — so a model downloaded by an earlier run is still found even if
  // the native inference addon can't load on this machine (Windows w/o Vulkan).
  const descriptor = (await descriptorFor(aliased)) || (await descriptorFor(name));
  return descriptor ? !!localBlobPath(descriptor) : false;
}

// ── Model listing (for the picker / /api/models) ────────────────────────────
// Returns [{ name, label, loaded, installed }] — built-ins + currently loaded +
// registry. `loaded` = resident in RAM right now; `installed` = weights are on
// disk. Private/local mode must filter on `installed`, not `loaded`.
async function listModels() {
  const out = new Map();
  let sdk = null;
  if (ENABLED) { try { sdk = await getSdk(); } catch { /* backend unavailable — fall back to registry data */ } }
  // Descriptor source that survives a dead native addon: live SDK if present,
  // else the static registry data file (see getRegistryDescriptors).
  const reg = (sdk && Object.keys(sdk).length) ? null : await getRegistryDescriptors();
  const installedFor = (constant) => {
    const descriptor = (sdk && sdk[constant]) || (reg && reg[constant]);
    return descriptor ? !!localBlobPath(descriptor) : false;
  };
  for (const m of BUILTIN_MODELS) {
    out.set(m.name, {
      name: m.name, label: m.label,
      loaded: _loaded.has(m.constant),
      installed: _loaded.has(m.constant) || installedFor(m.constant),
    });
  }
  for (const name of _loaded.keys()) {
    if (!out.has(name)) out.set(name, { name, label: name, loaded: true, installed: true });
  }
  // Best-effort: enrich with the distributed registry (non-fatal if offline).
  try {
    if (sdk && typeof sdk.modelRegistrySearch === 'function') {
      const entries = await sdk.modelRegistrySearch({ addon: 'llamacpp-completion' });
      for (const e of (entries || [])) {
        const name = e.id || e.name;
        if (name && !out.has(name)) out.set(name, { name, label: e.label || name, loaded: false, installed: false });
      }
    }
  } catch { /* registry offline — built-ins are enough */ }
  return [...out.values()];
}

function status() {
  return {
    enabled: ENABLED,
    defaultModel: DEFAULT_MODEL,
    maxResident: MAX_RESIDENT,
    loaded: [..._loaded.keys()],
    circuitOpen: !!_circuitOpenAt && circuitOpen(),
  };
}

module.exports = {
  chat,
  complete,
  listModels,
  isInstalled,
  getModelId,
  downloadModel,
  downloadStatus,
  status,
  estimatePromptTokens,
  estimateMessagesTokens,
  DEFAULT_MODEL,
  ENABLED,
};
