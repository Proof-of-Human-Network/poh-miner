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
  'llama3.2-1b':'LLAMA_3_2_1B_INST_Q4_0',
  // legacy Ollama names → default so old configs keep working
  'qwen2.5:1.5b': DEFAULT_MODEL,
  'qwen2.5':      DEFAULT_MODEL,
  'phi3:mini':    DEFAULT_MODEL,
};

// Curated list surfaced to the model picker (in addition to loaded + registry).
const BUILTIN_MODELS = [
  { name: 'qwen3-0.6b', label: 'Qwen3 0.6B (tiny)',  constant: 'QWEN3_600M_INST_Q4' },
  { name: 'qwen3-1.7b', label: 'Qwen3 1.7B (default)', constant: 'QWEN3_1_7B_INST_Q4' },
  { name: 'qwen3-4b',   label: 'Qwen3 4B',           constant: 'QWEN3_4B_INST_Q4_K_M' },
  { name: 'qwen3-8b',   label: 'Qwen3 8B (best)',    constant: 'QWEN3_8B_INST_Q4_K_M' },
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
        if (pct != null && pct > 0 && Math.round(pct) % 25 === 0) {
          console.log(`[qvac] ${name} download: ${pct.toFixed(0)}%`);
        }
      },
    });
  };

  const p = (async () => {
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
    console.log(`[qvac] Model ready: ${name} (id=${modelId})`);
    return modelId;
  })();

  _loadPromises.set(name, p);
  try {
    return await p;
  } catch (err) {
    _loadPromises.delete(name);
    throw err;
  }
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
          history.push({ role: m.role, content: String(m.content) });
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

// ── Model listing (for the picker / /api/models) ────────────────────────────
// Returns [{ name, label, loaded }] — built-ins + currently loaded + registry.
async function listModels() {
  const out = new Map();
  for (const m of BUILTIN_MODELS) {
    out.set(m.name, { name: m.name, label: m.label, loaded: _loaded.has(m.constant) });
  }
  for (const name of _loaded.keys()) {
    if (!out.has(name)) out.set(name, { name, label: name, loaded: true });
  }
  // Best-effort: enrich with the distributed registry (non-fatal if offline).
  try {
    const sdk = await getSdk();
    if (typeof sdk.modelRegistrySearch === 'function') {
      const entries = await sdk.modelRegistrySearch({ addon: 'llamacpp-completion' });
      for (const e of (entries || [])) {
        const name = e.id || e.name;
        if (name && !out.has(name)) out.set(name, { name, label: e.label || name, loaded: false });
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
  getModelId,
  status,
  estimatePromptTokens,
  estimateMessagesTokens,
  DEFAULT_MODEL,
  ENABLED,
};
