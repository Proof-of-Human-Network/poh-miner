'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ── Model config ──────────────────────────────────────────────────────────────
// Override per-role via env. All default to OLLAMA_MODEL so it works out-of-box.
const OLLAMA_URL       = process.env.OLLAMA_URL        || 'http://localhost:11434';
const BASE_MODEL       = process.env.OLLAMA_MODEL      || 'qwen2.5:1.5b';
const EVALUATOR_MODEL  = process.env.EVALUATOR_MODEL   || 'deepseek-r1:1.5b';
const LEARNER_MODEL    = process.env.LEARNER_MODEL     || 'qwen2.5:1.5b';
const COMPILER_MODEL   = process.env.COMPILER_MODEL    || BASE_MODEL; // Small reliable default (matches your main Ollama model) to avoid 500s. Set COMPILER_MODEL if you want something bigger for summarization.

// Cascade evaluator models (for brain verdicts)
// Use smaller/faster model by default, escalate to heavy reasoning model when needed.
const EVALUATOR_FAST_MODEL  = process.env.EVALUATOR_FAST_MODEL  || EVALUATOR_MODEL;
const EVALUATOR_HEAVY_MODEL = process.env.EVALUATOR_HEAVY_MODEL || EVALUATOR_MODEL; // set EVALUATOR_HEAVY_MODEL=deepseek-r1:32b if you have it

// ── QVAC SDK config ────────────────────────────────────────────────────────────
// Uses @qvac/sdk directly — no separate `qvac serve` process needed.
// Set QVAC_SDK_MODEL to any exported model constant name, e.g. QWEN3_8B_INST_Q4_K_M
const QVAC_SDK_MODEL_NAME = process.env.QVAC_SDK_MODEL || 'QWEN3_8B_INST_Q4_K_M';
const QVAC_ENABLED = process.env.QVAC_DISABLED !== '1'; // opt-out via env

console.log(`[brain] QVAC SDK: ${QVAC_ENABLED ? `enabled (model=${QVAC_SDK_MODEL_NAME})` : 'disabled — Ollama only'} | COMPILER_MODEL=${COMPILER_MODEL}`);

// BRAIN_DATA_DIR lets each miner (or test environment) have independent brain state.
// Set process.env.BRAIN_DATA_DIR before requiring this module to override.
const BRAIN_DATA_DIR   = process.env.BRAIN_DATA_DIR
  ? path.resolve(process.env.BRAIN_DATA_DIR)
  : path.join(process.env.HOME || process.env.USERPROFILE || '', '.poh-miner', 'brain');

const BRAIN_STATE_PATH = path.join(BRAIN_DATA_DIR, 'brain_state.md');
const DATASET_PATH     = path.join(BRAIN_DATA_DIR, 'dataset.json');
const WEIGHTS_PATH     = path.join(BRAIN_DATA_DIR, 'weights.json');
const FEEDBACK_PATH    = path.join(BRAIN_DATA_DIR, 'feedback.json');

// ── Ollama request queue (serializes all calls — Ollama is single-instance) ───
let _ollamaQueue = Promise.resolve();

function queueOllama(fn) {
  _ollamaQueue = _ollamaQueue.then(fn, fn);
  return _ollamaQueue;
}

// ── QVAC SDK request queue (serializes SDK calls — llama.cpp is single-threaded) ─
let _qvacQueue = Promise.resolve();

function queueQvac(fn) {
  _qvacQueue = _qvacQueue.then(fn, fn);
  return _qvacQueue;
}

// ── QVAC SDK lazy loader ──────────────────────────────────────────────────────
let _qvacSdk = null;
let _qvacModelId = null;
let _qvacModelLoadPromise = null;
let _qvacLoadFailed = false;

async function getQvacSdk() {
  if (_qvacSdk) return _qvacSdk;
  _qvacSdk = await import('@qvac/sdk');
  return _qvacSdk;
}

async function loadQvacModel() {
  if (_qvacModelId) return _qvacModelId;
  if (_qvacLoadFailed) return null;
  if (_qvacModelLoadPromise) return _qvacModelLoadPromise;

  _qvacModelLoadPromise = (async () => {
    try {
      const sdk = await getQvacSdk();
      const modelSrc = sdk[QVAC_SDK_MODEL_NAME];
      if (!modelSrc) throw new Error(`Unknown model constant: ${QVAC_SDK_MODEL_NAME}`);

      console.log(`[brain] Loading QVAC model ${QVAC_SDK_MODEL_NAME}...`);
      const id = await sdk.loadModel({
        modelSrc,
        modelType: 'llm',
        modelConfig: { ctx_size: 4096, verbosity: 0 },
        onProgress: (p) => {
          if (Math.round(p.percentage) % 25 === 0 && p.percentage > 0) {
            console.log(`[brain] QVAC model download: ${p.percentage.toFixed(0)}%`);
          }
        },
      });
      _qvacModelId = id;
      _qvacModelLoadPromise = null;
      console.log(`[brain] QVAC model ready (id=${id})`);
      return id;
    } catch (err) {
      _qvacLoadFailed = true;
      _qvacModelLoadPromise = null;
      console.warn(`[brain] QVAC model load failed: ${err.message} — falling back to Ollama`);
      return null;
    }
  })();

  return _qvacModelLoadPromise;
}

// Kept for the analyzeHumanness busy-check (prevents stacking verdict requests)
let ollamaBusy = false;

// ── Persistence helpers ───────────────────────────────────────────────────────

function getBrainState() {
  if (!fs.existsSync(BRAIN_STATE_PATH)) return '';
  return fs.readFileSync(BRAIN_STATE_PATH, 'utf-8');
}

function saveBrainState(content) {
  fs.writeFileSync(BRAIN_STATE_PATH, content, 'utf-8');
}

function getWeights() {
  if (!fs.existsSync(WEIGHTS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf-8')); }
  catch { return {}; }
}

function saveWeights(w) {
  const tmp = WEIGHTS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(w, null, 2));
  fs.renameSync(tmp, WEIGHTS_PATH);
}

function getFeedback() {
  if (!fs.existsSync(FEEDBACK_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf-8')); }
  catch { return []; }
}

function saveFeedback(list) {
  const tmp = FEEDBACK_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FEEDBACK_PATH);
}

// Returns the last N human corrections as a compact string for prompt injection
function recentCorrectionsStr(n = 5) {
  const corrections = getFeedback()
    .filter(f => f.correction)
    .slice(-n);
  if (!corrections.length) return '';
  return corrections
    .map(f => `- ${f.address?.slice(0, 8)}… AI said ${f.aiVerdict}, user says ${f.correction}${f.comment ? ': "' + f.comment.slice(0, 80) + '"' : ''}`)
    .join('\n');
}


// ── Ollama call (per model) ───────────────────────────────────────────────────

async function ollamaChat(prompt, { model = BASE_MODEL, maxTokens = 512, timeLimit = 120000, jsonMode = false } = {}) {
  return queueOllama(async () => {
    ollamaBusy = true;
    try {
      const body = {
        model,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: maxTokens },
      };
      if (jsonMode) body.format = 'json';
      const res = await axios.post(`${OLLAMA_URL}/api/generate`, body, { timeout: timeLimit });
      return res.data.response?.trim() || '';
    } catch (err) {
      console.error('[brain] Ollama call failed:', err.message);
      return null;
    } finally {
      ollamaBusy = false;
    }
  });
}

// ── JSON extraction ───────────────────────────────────────────────────────────
// Handles DeepSeek <think>...</think> blocks, markdown code fences, and bare JSON.

function extractJSON(text) {
  if (!text) return null;
  // Strip DeepSeek chain-of-thought tags
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Find the opening brace — grab everything from there
  const start = clean.indexOf('{');
  if (start === -1) return null;
  const fragment = clean.slice(start);

  // 1. Try direct parse (covers complete JSON)
  try { return JSON.parse(fragment); } catch { /* fall through */ }

  // 2. Try truncated-JSON recovery: walk back from end to find last valid `}`
  for (let i = fragment.length - 1; i >= 0; i--) {
    if (fragment[i] === '}') {
      try { return JSON.parse(fragment.slice(0, i + 1)); } catch { continue; }
    }
  }

  // 3. Handle case where JSON was cut mid-string value (no closing `}` at all).
  //    Re-assemble by stripping the incomplete last key-value pair and closing the object.
  try {
    // Remove everything from the last complete comma (or opening brace) onwards
    const trimmed = fragment.replace(/,?\s*"[^"]*"\s*:\s*"[^"]*$/, '').replace(/,\s*$/, '');
    const closed = trimmed.endsWith('}') ? trimmed : trimmed + '}';
    const parsed = JSON.parse(closed);
    // Only accept if it has at least one key
    if (Object.keys(parsed).length > 0) return parsed;
  } catch { /* fall through */ }

  return null;
}

async function ollamaChatJSON(prompt, requiredKeys, opts = {}) {
  const raw = await ollamaChat(prompt, { ...opts, jsonMode: true });
  let parsed = extractJSON(raw);

  if (!parsed || requiredKeys.some(k => !(k in parsed))) {
    console.warn('[brain] Invalid JSON output, retrying...');
    const retry = await ollamaChat(
      `${prompt}\n\nIMPORTANT: Respond with ONLY a valid JSON object. Required fields: ${requiredKeys.join(', ')}. No other text.`,
      { ...opts, jsonMode: true }
    );
    parsed = extractJSON(retry);
  }

  return parsed;
}

// ── QVAC SDK chat (native in-process inference) ───────────────────────────────

let _qvacSdkFailures = 0;
const QVAC_SDK_CIRCUIT_OPEN_AFTER = 3;
let _qvacSdkCircuitOpenAt = 0;
const QVAC_SDK_RETRY_AFTER_MS = 5 * 60 * 1000;

async function qvacChat(prompt, { maxTokens = 512, timeLimit = 120000, jsonMode = false, systemPrompt } = {}) {
  if (!QVAC_ENABLED) return null;

  // Circuit breaker
  if (_qvacSdkCircuitOpenAt) {
    if (Date.now() - _qvacSdkCircuitOpenAt < QVAC_SDK_RETRY_AFTER_MS) {
      if (!qvacChat._lastLog || Date.now() - qvacChat._lastLog > 60000) {
        console.warn('[brain] QVAC SDK circuit open — falling back to Ollama');
        qvacChat._lastLog = Date.now();
      }
      return null;
    }
    _qvacSdkCircuitOpenAt = 0;
    _qvacSdkFailures = 0;
    _qvacLoadFailed = false; // allow retry after cooldown
  }

  return queueQvac(async () => {
    try {
      const modelId = await Promise.race([
        loadQvacModel(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('QVAC model load timeout')), timeLimit)),
      ]);
      if (!modelId) return null;

      const sdk = await getQvacSdk();
      const sys = systemPrompt || (jsonMode
        ? 'You are a JSON-only responder. Output only valid JSON. No explanations, no markdown.'
        : 'You are a helpful, concise assistant.');

      const history = [
        { role: 'system', content: sys },
        // /no_think suppresses Qwen3 chain-of-thought tokens
        { role: 'user', content: prompt + '\n/no_think' },
      ];

      const run = sdk.completion({ modelId, history, stream: true });
      let text = '';
      for await (const token of run.tokenStream) {
        text += token;
      }

      // Strip any residual <think>...</think> blocks from the output
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

      _qvacSdkFailures = 0;
      return text || '';
    } catch (err) {
      _qvacSdkFailures++;
      if (_qvacSdkFailures >= QVAC_SDK_CIRCUIT_OPEN_AFTER) {
        _qvacSdkCircuitOpenAt = Date.now();
        console.warn(`[brain] QVAC SDK circuit open after ${_qvacSdkFailures} failures — will retry in 5 min`);
      } else {
        console.error('[brain] QVAC SDK call failed:', err.message);
      }
      return null;
    }
  });
}

// ── Role routers — Qvac if configured, Ollama otherwise ──────────────────────

async function evaluatorChat(prompt, opts = {}) {
  const model = opts.model || EVALUATOR_MODEL;

  // Try QVAC SDK first (in-process, no external server needed)
  if (QVAC_ENABLED) {
    const result = await qvacChat(prompt, opts);
    if (result !== null) return result;
    if (!_qvacSdkCircuitOpenAt) console.warn('[brain] QVAC SDK unavailable — falling back to Ollama');
  }
  return ollamaChat(prompt, { ...opts, model });
}

async function evaluatorChatJSON(prompt, requiredKeys, opts = {}) {
  const raw = await evaluatorChat(prompt, { ...opts, jsonMode: true });
  let parsed = extractJSON(raw);

  if (!parsed || requiredKeys.some(k => !(k in parsed))) {
    console.warn('[brain] Evaluator invalid JSON, retrying... raw:', (raw || '').slice(0, 200));
    const retry = await evaluatorChat(
      `Output ONLY a JSON object with fields ${requiredKeys.join(', ')}. Schema: {"verdict":"HUMAN|AI|UNCERTAIN","confidence":<float 0.0-1.0>,"reasoning":"<brief>"}\n\nNow output JSON for this task:\n${prompt}`,
      { ...opts, jsonMode: false }
    );
    console.warn('[brain] Retry raw:', (retry || '').slice(0, 200));
    parsed = extractJSON(retry);
  }

  return parsed;
}

async function learnerChat(prompt, opts = {}) {
  if (QVAC_ENABLED) {
    const result = await qvacChat(prompt, opts);
    if (result !== null) return result;
  }
  return ollamaChat(prompt, { ...opts, model: LEARNER_MODEL });
}

async function learnerChatJSON(prompt, requiredKeys, opts = {}) {
  const raw = await learnerChat(prompt, { ...opts, jsonMode: true });
  let parsed = extractJSON(raw);
  if (!parsed || requiredKeys.some(k => !(k in parsed))) {
    const retry = await learnerChat(
      `${prompt}\n\nIMPORTANT: Respond with ONLY a valid JSON object. Required fields: ${requiredKeys.join(', ')}. No other text.`,
      { ...opts, jsonMode: true }
    );
    parsed = extractJSON(retry);
  }
  return parsed;
}

async function compilerChat(prompt, opts = {}) {
  if (QVAC_ENABLED) {
    const result = await qvacChat(prompt, {
      ...opts,
      systemPrompt: 'You are a precise, technical summarizer for a decentralized Proof-of-Humanity detection system. Output only the requested summary text. Be concise, factual, and avoid speculation or JSON.'
    });
    if (result !== null) return result;
    if (!_qvacSdkCircuitOpenAt) {
      console.warn('[brain] QVAC unavailable — falling back to Ollama for compiler (consolidation)');
    }
  }
  console.log(`[brain] compiler → Ollama (${COMPILER_MODEL})`);
  return ollamaChat(prompt, { ...opts, model: COMPILER_MODEL });
}

// ── 1. EVALUATOR — analyzeHumanness ──────────────────────────────────────────

async function analyzeHumanness(address, methodResults, methods) {
  if (!QVAC_ENABLED && ollamaBusy) {
    console.log('[brain] Ollama busy — skipping verdict for', address);
    return { verdict: 'PENDING', confidence: 0, reasoning: 'Brain is busy, try again shortly' };
  }

  const weights = getWeights();
  const usingQvac = QVAC_ENABLED && !_qvacSdkCircuitOpenAt;

  // Sanitize external text before inserting into LLM prompt (prompt injection guard)
  function _sanitizeForPrompt(str) {
    if (!str || typeof str !== 'string') return 'unnamed';
    return str
      .slice(0, 80)
      .replace(/[<>]/g, '')
      .replace(/\bignore\b.{0,30}\binstruct/gi, '[filtered]')
      .replace(/\bsystem\s*prompt\b/gi, '[filtered]')
      .replace(/\b(forget|disregard|override)\b.{0,30}\b(above|previous|prior|rules)\b/gi, '[filtered]')
      .trim() || 'unnamed';
  }

  // Qvac 600M has ~2k token context — keep prompt tiny
  // Ollama: all passed + top-10 failed; Qvac: top-4 passed + top-4 failed
  // Sort by effective weight (base weight × graduation multiplier)
  const effectiveWeight = r => weights[r.methodId] ?? 1;

  const passed = methodResults
    .filter(r => r.result === true)
    .sort((a, b) => effectiveWeight(b) - effectiveWeight(a))
    .slice(0, usingQvac ? 4 : Infinity);
  const failed = methodResults
    .filter(r => r.result === false)
    .sort((a, b) => effectiveWeight(b) - effectiveWeight(a))
    .slice(0, usingQvac ? 4 : 10);

  // Build signals with negative flag awareness (Task 2)
  const signals = [...passed, ...failed].map(r => {
    const m = methods.find(x => x.id === r.methodId);
    const isNegative = !!(m && m.negative);
    return {
      name: _sanitizeForPrompt(r.description),
      pass: r.result,
      negative: isNegative,
      w: +((weights[r.methodId] ?? 1.0)).toFixed(2),
    };
  });

  const signalsStr = signals
    .map(s => {
      const label = s.negative ? (s.pass ? 'BLACKLIST' : 'PASS') : (s.pass ? 'PASS' : 'FAIL');
      return `[${label}] ${s.name} (w:${s.w})`;
    })
    .join('\n');

  const corrections = recentCorrectionsStr(5);
  const correctionBlock = corrections
    ? `\nRecent human corrections (learn from these mistakes):\n${corrections}\n`
    : '';

  // Stronger prompt for signal aggregation + negative signal awareness
  const basePrompt = `You are an expert Proof-of-Humanity evaluator for cryptocurrency wallet addresses.

Your job is to determine whether the address shows strong evidence of being controlled by a real human versus an AI/bot/Sybil.

You receive a list of signals. Each has:
- Label: PASS, FAIL, or BLACKLIST (BLACKLIST = strong negative — e.g. address frozen by Tether)
- Weight (higher = more important)
- Description

Rules:
- Weigh positive human signals vs negative ones (BLACKLIST hits are very strong evidence of non-human).
- Be conservative with "HUMAN" verdict — require multiple strong, diverse signals.
- "BLACKLIST" or OFAC hits should heavily push the verdict toward "AI".
- Output ONLY valid JSON.

Address: ${address}

<signals>
${signalsStr}
</signals>
${correctionBlock}
Return exactly this JSON (no extra text):
{"verdict":"HUMAN|AI|UNCERTAIN","confidence":<float 0.0-1.0>,"reasoning":"<2-4 sentences referencing specific signals and weights>"}`;

  // === CASCADE LOGIC (Fast model first, escalate to heavy when needed) ===
  const hasNegative = signals.some(s => s.negative && s.pass);

  const backend = usingQvac ? 'Qvac' : 'Ollama';
  console.log(`[brain] Evaluating ${address} via ${backend} (cascade mode)`);

  // Step 1: Fast model
  let result = await evaluatorChatJSON(
    basePrompt,
    ['verdict', 'confidence', 'reasoning'],
    { model: EVALUATOR_FAST_MODEL, maxTokens: 220, timeLimit: 120000 }
  );

  const fastConfidence = result?.confidence ? parseFloat(result.confidence) : 0;
  const shouldEscalate = !result ||
                         fastConfidence < 0.72 ||
                         result.verdict === 'UNCERTAIN' ||
                         hasNegative;

  if (shouldEscalate) {
    console.log(`[brain] Escalating to HEAVY model for ${address} (confidence=${fastConfidence}, negative=${hasNegative})`);
    const heavyResult = await evaluatorChatJSON(
      basePrompt + '\n\nYou are the HEAVY reasoning model. Think carefully and be precise with confidence.',
      ['verdict', 'confidence', 'reasoning'],
      { model: EVALUATOR_HEAVY_MODEL, maxTokens: 280, timeLimit: 180000 }
    );
    if (heavyResult) {
      result = heavyResult;
      result.escalated = true;
      result.fastVerdict = result.verdict; // keep original fast verdict for debugging
    }
  }

  if (!result) {
    // Heuristic fallback: score by pass ratio weighted by method weights
    const totalW = signals.reduce((s, x) => s + x.w, 0) || 1;
    const passW  = signals.filter(x => x.pass).reduce((s, x) => s + x.w, 0);
    const ratio  = passW / totalW;
    return {
      verdict:    ratio >= 0.55 ? 'HUMAN' : ratio <= 0.35 ? 'AI' : 'UNCERTAIN',
      confidence: Math.round(Math.abs(ratio - 0.5) * 2 * 100) / 100,
      reasoning:  `Heuristic fallback: ${signals.filter(x => x.pass).length}/${signals.length} signals passed`,
      escalated: false,
    };
  }

  return {
    verdict:    (result.verdict || 'UNKNOWN').toUpperCase(),
    confidence: Math.min(1, Math.max(0, parseFloat(result.confidence) || 0.5)),
    reasoning:  result.reasoning || '',
    escalated:  !!result.escalated,
    modelUsed:  result.escalated ? EVALUATOR_HEAVY_MODEL : EVALUATOR_FAST_MODEL,
  };
}

// ── 2. LEARNER — onVote (weight update) ──────────────────────────────────────

async function onVote(method, voteType, vote, stakeWeight, feedback = null) {
  const voteContext = {
    description: 'Is the description accurate?',
    method:      'Can this detect human behavior?',
    risk:        'Can an AI fake this?'
  }[voteType] || voteType;

  const currentWeights = getWeights();
  const currentWeight  = currentWeights[method.id] ?? 1.0;

  const feedbackLine = feedback
    ? `Voter reasoning: "${feedback.slice(0, 200)}"`
    : 'Voter reasoning: (none provided)';

  const prompt = `A detection method was voted on. Should its weight go up or down?

Method: ${method.description}
Current weight: ${currentWeight}
Vote question: ${voteContext}
Vote: ${vote ? 'YES (good signal)' : 'NO (bad signal)'}
Voter stake: ${stakeWeight.toFixed(3)}
${feedbackLine}

Reply with ONLY this JSON (new_weight must be within 0.05 of current weight ${currentWeight}):
{"new_weight": ${currentWeight}}`;

  const result = await learnerChatJSON(
    prompt,
    ['new_weight'],
    { maxTokens: 60, timeLimit: 20000 }
  );

  const updated = { ...currentWeights };
  if (result?.new_weight != null) {
    const proposed = parseFloat(result.new_weight) || currentWeight;
    // Hard-enforce ±0.05 drift cap regardless of what the LLM returned
    const clamped = Math.min(3.0, Math.max(0.1,
      Math.min(currentWeight + 0.05, Math.max(currentWeight - 0.05, proposed))
    ));
    updated[method.id] = clamped;
  } else {
    // LLM failed — apply a simple heuristic directly
    const delta = (vote ? 1 : -1) * 0.02 * Math.min(stakeWeight * 10, 1);
    updated[method.id] = Math.min(3.0, Math.max(0.1, currentWeight + delta));
  }
  saveWeights(updated);
  console.log(`[brain] Weight updated for "${method.description}": ${currentWeight} → ${updated[method.id].toFixed(3)}`);

  // Append compact note to brain state
  const voteLabel = vote ? 'YES' : 'NO';
  const current = getBrainState();
  const note = `\n\n### Vote: ${method.description} | ${voteContext} → ${voteLabel} (stake: ${stakeWeight.toFixed(3)}) — ${new Date().toISOString()}`;
  saveBrainState((current + note).trim());
}

// ── 3. onNewMethod — strict assessment ───────────────────────────────────────

async function onNewMethod(method) {
  const prompt = `SYSTEM:
You are evaluating a new detection method for a Proof of Human network.
Be technical and concise. Max 2 sentences.

METHOD:
Type: ${method.type}
Description: ${method.description}
Address/URL: ${method.address || 'N/A'}
Method: ${method.method || 'N/A'}
Expression: ${method.expression || 'N/A'}

TASK:
Assess: Is this a reliable human-vs-bot signal? What edge cases could fool it?

OUTPUT (STRICT JSON):
{
  "useful": true,
  "risk": "none | low | medium | high",
  "assessment": "one sentence"
}`;

  const result = await evaluatorChatJSON(
    prompt,
    ['useful', 'assessment'],
    { maxTokens: 250, timeLimit: 30000 }
  );

  const assessment = result?.assessment || '(no assessment)';
  const risk       = result?.risk || 'unknown';
  console.log(`[brain] New method "${method.description}" — risk: ${risk} — ${assessment}`);

  const current = getBrainState();
  const note = `\n\n### Method Added: ${method.description} (risk: ${risk}) — ${new Date().toISOString()}\n${assessment}`;
  saveBrainState((current + note).trim());

  return result;
}

// ── 4. COMPILER — consolidate ─────────────────────────────────────────────────

async function consolidate() {
  let dataset = [];
  try {
    if (fs.existsSync(DATASET_PATH))
      dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
  } catch (err) {
    console.error('[brain] Could not read dataset.json for consolidation:', err.message);
    return;
  }

  const scanRecords = dataset.filter(d => d.instruction.startsWith('Verification'));
  const voteRecords = dataset.filter(d => d.instruction.startsWith('Voter'));

  if (scanRecords.length === 0 && voteRecords.length === 0) {
    console.log('[brain] Consolidation skipped — no data yet');
    return;
  }

  const weights   = getWeights();
  const topMethods = Object.entries(weights)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([id, w]) => `${id}: weight ${w.toFixed(2)}`);

  const weakMethods = Object.entries(weights)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 3)
    .map(([id, w]) => `${id}: weight ${w.toFixed(2)}`);

  const recentScans = scanRecords.slice(-8)
    .map(r => `${r.instruction.replace('Verification response for ', '').slice(0, 50)} → ${r.output}`)
    .join('\n');

  const recentVotes = voteRecords.slice(-8)
    .map(r => `${r.instruction.slice(0, 40)} | ${r.input.slice(0, 30)} → ${r.output}`)
    .join('\n');

  const currentBrain = getBrainState();

  const prompt = `SYSTEM:
You are generating a compact system state.
You are NOT creative.
You ONLY summarize statistically supported facts.
Max 400 words.

INPUT:
Top Methods (by weight):
${topMethods.join('\n') || 'none'}

Weak Methods:
${weakMethods.join('\n') || 'none'}

Recent Scans:
${recentScans || 'none'}

Recent Votes:
${recentVotes || 'none'}

Previous State (truncated):
${currentBrain.slice(0, 300) || 'none'}

TASK:
Write a precise system summary.

STYLE:
- technical
- concise
- no repetition
- no speculation`;

  console.log('[brain] Consolidating knowledge...');
  try {
    const newBrainState = await compilerChat(prompt, {
      maxTokens: 700,
      timeLimit: 300000
    });

    const cleaned = (newBrainState || '').trim();
    if (cleaned.length > 20) {
      saveBrainState(`# Brain State — Last updated: ${new Date().toISOString()}\n\n${cleaned}`);
      console.log('[brain] Consolidation complete. (' + cleaned.length + ' chars)');
    } else {
      console.warn('[brain] Consolidation returned empty/short response (model may be unavailable or overloaded). Got:', JSON.stringify(cleaned.slice(0, 80)));
    }
  } catch (err) {
    console.error('[brain] Consolidation failed:', err.message);
    // Do not crash the whole process
  }
}

// ── 5. validateDescription ────────────────────────────────────────────────────
async function validateDescription(description) {
  const prompt = `You are validating a method description submitted to a Proof of Human detection network.
The description must clearly explain what on-chain or API signal is being checked and why it indicates human activity.

Description to evaluate: "${description.slice(0, 300)}"

Reject if: random characters, placeholder text (test, asdf, foo, hello world), too vague (< 5 meaningful words), no clear signal described, or clearly not about human detection.
Accept if: it describes a specific on-chain or off-chain signal, API endpoint, or behavior pattern relevant to distinguishing humans from bots.

Reply with ONLY this JSON:
{"valid": true, "reason": "one sentence"}
or
{"valid": false, "reason": "one sentence explaining what's wrong"}`;

  const result = await evaluatorChatJSON(
    prompt,
    ['valid', 'reason'],
    { maxTokens: 80, timeLimit: 20000 }
  );
  return result || { valid: false, reason: 'Validation unavailable — try again shortly' };
}

// ── 6. validateFeedback ───────────────────────────────────────────────────────
async function validateFeedback(feedback) {
  const prompt = `You are moderating a vote comment submitted to a Proof of Human detection network.
The comment explains why a voter thinks a detection method is or isn't valid for identifying humans.

Comment to evaluate: "${feedback.slice(0, 400)}"

Reject if: random characters, gibberish, profanity, spam (aaa, test, asdf), placeholder text, completely off-topic, or adds zero information about the method's validity.
Accept if: it gives any reasoning about why the method does or doesn't indicate human activity — even a short but genuine opinion counts.

Reply with ONLY this JSON:
{"valid": true, "reason": "one sentence"}
or
{"valid": false, "reason": "one sentence explaining what's wrong"}`;

  const result = await evaluatorChatJSON(
    prompt,
    ['valid', 'reason'],
    { maxTokens: 80, timeLimit: 20000 }
  );
  return result || { valid: true, reason: 'Validation unavailable — skipped' };
}

// ── 7. onVerdictFeedback — user corrects AI verdict ──────────────────────────

async function onVerdictFeedback(address, aiVerdict, correction, comment, signals = []) {
  // Persist the correction
  const list = getFeedback();
  list.push({
    address,
    aiVerdict,
    correction,   // 'HUMAN' | 'AI'
    comment: comment || null,
    signals: signals.map(s => ({ id: s.methodId, pass: s.result, desc: (s.description || '').slice(0, 60) })),
    ts: new Date().toISOString(),
  });
  saveFeedback(list);

  // Only adjust weights if there's a clear disagreement
  if (!correction || correction === aiVerdict) return;

  const weights = getWeights();
  // Signals that should have been weighted differently:
  // AI said HUMAN but user says AI → passed signals were misleading → reduce their weight
  // AI said AI but user says HUMAN → failed signals might be misleading → reduce failed, boost passed
  const misleading = correction === 'AI'
    ? signals.filter(s => s.result === true)   // passed but shouldn't count
    : signals.filter(s => s.result === false);  // failed but shouldn't disqualify

  const supportive = correction === 'HUMAN'
    ? signals.filter(s => s.result === true)
    : [];

  const updated = { ...weights };
  for (const s of misleading) {
    const cur = updated[s.methodId] ?? 1.0;
    updated[s.methodId] = Math.min(3.0, Math.max(0.1, +(cur - 0.03).toFixed(3)));
  }
  for (const s of supportive) {
    const cur = updated[s.methodId] ?? 1.0;
    updated[s.methodId] = Math.min(3.0, Math.max(0.1, +(cur + 0.02).toFixed(3)));
  }
  saveWeights(updated);

  // Ask the learner what it thinks about this mistake
  const signalsSummary = signals
    .slice(0, 8)
    .map(s => `[${s.result ? 'PASS' : 'FAIL'}] ${(s.description || s.methodId || '').slice(0, 50)}`)
    .join('\n');

  const prompt = `A verdict was wrong. Learn from this.

Wallet: ${address}
AI verdict: ${aiVerdict}
Correct verdict (user): ${correction}
${comment ? `User comment: "${comment.slice(0, 200)}"` : ''}

Signals:
${signalsSummary}

Which signal type was most misleading? One sentence max.
{"insight":"..."}`;

  const insight = await learnerChatJSON(prompt, ['insight'], {
    maxTokens: 80, timeLimit: 20000,
  });

  const note = `\n\n### Verdict Correction — ${new Date().toISOString()}\nAddress: ${address}\nAI said: ${aiVerdict} → User says: ${correction}\n${comment ? `Comment: "${comment}"\n` : ''}${insight?.insight ? `Insight: ${insight.insight}` : ''}`;
  saveBrainState((getBrainState() + note).trim());

  console.log(`[brain] Feedback recorded: ${aiVerdict}→${correction} for ${address}`);
}

// ── vibeCheck ─────────────────────────────────────────────────────────────────
// Reads Farcaster casts and Paragraph publications for an address and asks the
// LLM to characterise the person's topics, writing style, and human signals.
// Returns null (silently) if no social content is available.

async function vibeCheck(address, { farcasterData = null, paragraphData = null } = {}) {
  if (!farcasterData && !paragraphData) return null;

  const lines = [];

  if (farcasterData) {
    lines.push(`Farcaster @${farcasterData.username} (${farcasterData.followerCount} followers, ${farcasterData.followingCount} following)`);
    if (farcasterData.bio) lines.push(`Bio: "${farcasterData.bio}"`);
    if (farcasterData.casts.length) {
      lines.push('Recent casts:');
      farcasterData.casts.slice(0, 8).forEach(c => {
        const engage = [c.likes && `${c.likes}♥`, c.replies && `${c.replies} replies`].filter(Boolean).join(' ');
        lines.push(`  • "${c.text.slice(0, 200)}"${engage ? ` [${engage}]` : ''}`);
      });
    }
    if (farcasterData.following.length) {
      lines.push(`Follows: ${farcasterData.following.slice(0, 6).join(', ')}`);
    }
  }

  if (paragraphData) {
    lines.push(`\nParagraph blog: "${paragraphData.title}" (${paragraphData.subscriberCount} subscribers, ${paragraphData.postCount} posts)`);
    if (paragraphData.description) lines.push(`Description: "${paragraphData.description}"`);
    if (paragraphData.posts.length) {
      lines.push('Recent articles:');
      paragraphData.posts.forEach(p => {
        lines.push(`  • "${p.title}"${p.subtitle ? ` — ${p.subtitle}` : ''}`);
      });
    }
  }

  const context = lines.join('\n');

  const prompt = `You are analyzing public social media content to understand the person behind a crypto wallet.

Content:
${context}

Provide a brief, insightful vibe analysis. Focus on:
- What topics they care about (DeFi, governance, art, tech, community, etc.)
- Writing style and engagement patterns (builder, commenter, sharer, thought-leader)
- Signals this is a real, active human (not a bot or Sybil)

Return ONLY valid JSON, no extra text:
{"vibe":"<2-3 sentence personality and interest summary>","topics":["<topic1>","<topic2>","<topic3>"],"humanSignals":["<signal1>","<signal2>"]}`;

  const result = await learnerChatJSON(prompt, ['vibe', 'topics', 'humanSignals'], {
    maxTokens: 180,
    timeLimit: 30000,
  });

  if (!result) return null;

  return {
    vibe:         result.vibe         || '',
    topics:       Array.isArray(result.topics)       ? result.topics.slice(0, 5)       : [],
    humanSignals: Array.isArray(result.humanSignals) ? result.humanSignals.slice(0, 4) : [],
    sources: [
      farcasterData  ? `farcaster:${farcasterData.username}` : null,
      paragraphData  ? `paragraph:${paragraphData.title}`    : null,
    ].filter(Boolean),
  };
}

// ── Skill routing helpers ─────────────────────────────────────────────────────

function loadSkillContexts(skills) {
  return (skills || [])
    .filter(s => s.context)
    .map(s => ({ skillId: s.id, name: s.description || s.id, context: s.context }));
}

async function routeMessage(userMessage, skillContexts) {
  if (!skillContexts?.length) return { skillId: null, reason: 'No skills available' };

  const skillBlock = skillContexts.map(s => `[${s.skillId}] ${s.name}`).join('\n');

  const prompt = `You are a routing agent. Given a user message, decide which skill to invoke.

SKILLS:
${skillBlock}

USER MESSAGE: "${userMessage}"

If a skill should be invoked, respond with JSON:
{"skillId":"<id>","input":{"address":"<extracted wallet address if present, else null>"},"reason":"<one sentence>"}

If no skill applies (general conversation), respond with:
{"skillId":null,"reason":"<why not>"}

Output ONLY valid JSON.`;

  const result = await evaluatorChatJSON(prompt, ['skillId'], { maxTokens: 120, timeLimit: 15000 });
  return result || { skillId: null, reason: 'Routing failed' };
}

async function interpretSkillResult({ skillId, result, context, userMessage }) {
  const prompt = `Skill "${skillId}" returned data. Explain it to the user in 2-3 sentences.
User asked: "${userMessage}"
Skill context: ${(context || '').slice(0, 600)}
Result: ${JSON.stringify(result).slice(0, 800)}
Be direct. Name specific values. End with a one-sentence signal assessment.`;

  const reply = await learnerChat(prompt, { maxTokens: 150, timeLimit: 20000 });
  return reply || 'No interpretation available.';
}

module.exports = { analyzeHumanness, vibeCheck, onNewMethod, onVote, onVerdictFeedback, consolidate, getWeights, validateDescription, validateFeedback, loadSkillContexts, routeMessage, interpretSkillResult };
