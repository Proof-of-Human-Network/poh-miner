/**
 * OpenAI-compatible chat API, mounted at /openai/v1.
 *
 * A self-contained surface for OpenAI SDKs and tools (base_url = http://host:3456/openai/v1).
 * It deliberately shares nothing with the legacy /v1/* and /api/chat handlers in
 * miner-node.js — those keep their behaviour and their (quirky) shapes; this one
 * follows the OpenAI wire format: object types, SSE streaming, error envelope.
 *
 *   GET  /openai/v1/models            list
 *   GET  /openai/v1/models/{id}       retrieve
 *   POST /openai/v1/chat/completions  chat (JSON or SSE with stream:true)
 *   POST /openai/v1/completions       legacy prompt completion
 *   POST /openai/v1/embeddings        501 (no embedding backend), OpenAI-shaped
 *
 * Access mirrors /v1: a local caller is free; a remote caller pays with a signed
 * bid (body.dai or X-DAI-* headers, see Node._runPaidCompute) and is billed for
 * the tokens actually used. Additionally, `Authorization: Bearer <config.llmApiKey>`
 * grants free access, the same trust the Ollama-style /api/chat endpoints give it —
 * so a stock OpenAI client can use a remote node with nothing but an api_key.
 *
 * The inference backend (QVAC) has no tool-calling, logprobs or multi-choice
 * support, so those request fields are refused with a clear 400 rather than
 * accepted and ignored. Sampling knobs (temperature, top_p, seed, ...) are
 * accepted and have no effect.
 */

import crypto from 'crypto';

export const OPENAI_PREFIX = '/openai/v1';

// Fields QVAC cannot honour. Sending them is an error, not a hint: silently
// dropping `tools` would make an agent loop spin waiting for a call that never comes.
const UNSUPPORTED = {
  n:               (v) => v != null && Number(v) !== 1,
  logprobs:        (v) => v === true,
  top_logprobs:    (v) => v != null && Number(v) > 0,
  tools:           (v) => Array.isArray(v) && v.length > 0,
  functions:       (v) => Array.isArray(v) && v.length > 0,
  audio:           (v) => v != null,
  modalities:      (v) => Array.isArray(v) && v.some(m => m !== 'text'),
};

const MAX_IMAGES_PER_REQUEST = 8;
const DEFAULT_MAX_TOKENS = 512;   // mirrors qvac.chat's default output ceiling

function newId(prefix) { return `${prefix}-${crypto.randomBytes(12).toString('hex')}`; }
const nowSec = () => Math.floor(Date.now() / 1000);

const TYPE_FOR_STATUS = (status) =>
  status === 401 ? 'authentication_error'
    : status === 402 ? 'payment_required'
    : status === 403 ? 'permission_error'
    : status === 429 ? 'rate_limit_error'
    : status >= 500 ? 'server_error'
    : 'invalid_request_error';

class ApiError extends Error {
  constructor(status, message, { code = null, param = null, type, extra } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.param = param;
    this.type = type || TYPE_FOR_STATUS(status);
    this.extra = extra || {};
  }
}

function sendJson(res, status, obj) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function sendError(res, err) {
  const e = err instanceof ApiError ? err : new ApiError(500, err?.message || 'Internal error');
  sendJson(res, e.status, { error: { message: e.message, type: e.type, param: e.param, code: e.code, ...e.extra } });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('error', () => reject(new ApiError(400, 'Request body could not be read')));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        const v = JSON.parse(raw);
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch {
        reject(new ApiError(400, 'Request body must be a JSON object', { code: 'invalid_json' }));
      }
    });
  });
}

/**
 * OpenAI message content (string | null | parts[]) → { text, images: [dataUrl] }.
 * Only inline data: images are accepted; fetching arbitrary http(s) URLs on behalf
 * of a remote caller would make this node an SSRF proxy.
 */
function flattenContent(content, where) {
  if (content == null) return { text: '', images: [] };
  if (typeof content === 'string') return { text: content, images: [] };
  if (!Array.isArray(content)) throw new ApiError(400, `${where}.content must be a string or an array of content parts`, { param: `${where}.content` });
  const texts = [];
  const images = [];
  content.forEach((part, i) => {
    const at = `${where}.content[${i}]`;
    if (typeof part === 'string') { texts.push(part); return; }
    if (part?.type === 'text' || part?.type === 'input_text') { texts.push(String(part.text ?? '')); return; }
    if (part?.type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      if (typeof url !== 'string' || !url.startsWith('data:')) {
        throw new ApiError(400, 'Only inline base64 data: image URLs are supported (remote image URLs are not fetched)', { param: at, code: 'unsupported_image_url' });
      }
      images.push(url);
      return;
    }
    throw new ApiError(400, `Unsupported content part type "${part?.type}"`, { param: at, code: 'unsupported_content_part' });
  });
  return { text: texts.join('\n'), images };
}

/**
 * Validate + convert OpenAI messages[] to the {role, content, attachments?} shape
 * qvac.chat takes. Returns { messages, hasImages }.
 */
function normalizeMessages(rawMessages, { materializeAttachments, maxBytes }) {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new ApiError(400, "'messages' is required and must be a non-empty array", { param: 'messages' });
  }
  const messages = [];
  let imageCount = 0;
  rawMessages.forEach((m, i) => {
    const where = `messages[${i}]`;
    if (!m || typeof m !== 'object') throw new ApiError(400, `${where} must be an object`, { param: where });
    let role = m.role;
    if (role === 'developer') role = 'system';   // newer OpenAI name for the system role
    if (role === 'tool' || role === 'function') {
      throw new ApiError(400, `Role "${m.role}" is not supported: this endpoint has no tool calling`, { param: `${where}.role`, code: 'tools_not_supported' });
    }
    if (!['system', 'user', 'assistant'].includes(role)) {
      throw new ApiError(400, `Invalid role "${m.role}" — expected system, user or assistant`, { param: `${where}.role` });
    }
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      throw new ApiError(400, 'tool_calls in message history are not supported', { param: `${where}.tool_calls`, code: 'tools_not_supported' });
    }
    const { text, images } = flattenContent(m.content, where);
    const entry = { role, content: text };
    if (images.length) {
      if (role !== 'user') throw new ApiError(400, 'Images are only allowed in user messages', { param: `${where}.content` });
      imageCount += images.length;
      if (imageCount > MAX_IMAGES_PER_REQUEST) throw new ApiError(400, `At most ${MAX_IMAGES_PER_REQUEST} images per request`, { param: 'messages' });
      const { files, errors } = materializeAttachments(
        images.map((dataUrl, k) => ({ name: `image-${i}-${k}.png`, dataUrl })),
        { maxBytes },
      );
      if (errors.length) throw new ApiError(400, errors.join('; '), { param: `${where}.content`, code: 'invalid_image' });
      const paths = files.filter(f => f.kind === 'image').map(f => ({ path: f.path }));
      if (paths.length !== images.length) throw new ApiError(400, 'image_url data must be an image (png/jpg/webp/gif)', { param: `${where}.content`, code: 'invalid_image' });
      entry.attachments = paths;
    }
    messages.push(entry);
  });
  return { messages, hasImages: imageCount > 0 };
}

/** stop: string | string[] → up to 4 non-empty strings. */
function normalizeStop(stop) {
  if (stop == null) return [];
  const arr = Array.isArray(stop) ? stop : [stop];
  if (arr.length > 4 || arr.some(s => typeof s !== 'string')) {
    throw new ApiError(400, "'stop' must be a string or an array of up to 4 strings", { param: 'stop' });
  }
  return arr.filter(s => s.length > 0);
}

function applyStop(text, stops) {
  let cut = -1;
  for (const s of stops) {
    const at = text.indexOf(s);
    if (at !== -1 && (cut === -1 || at < cut)) cut = at;
  }
  return cut === -1 ? { text, stopped: false } : { text: text.slice(0, cut), stopped: true };
}

/**
 * Streaming filter that drops <think>…</think> blocks. qvac.chat strips reasoning
 * from its final text, but hands raw tokens to onToken — without this, a reasoning
 * model would leak its chain of thought into streamed `content`. Tags can be split
 * across tokens, so a possible partial tag at the tail is held back.
 */
function makeThinkFilter(emit) {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let buf = '';
  let inThink = false;
  let justClosed = false;
  // Longest suffix of `b` that is a proper prefix of `tag` — must wait for more input.
  const partial = (b, tag) => {
    for (let n = Math.min(tag.length - 1, b.length); n > 0; n--) if (tag.startsWith(b.slice(b.length - n))) return n;
    return 0;
  };
  const out = (t) => {
    if (justClosed) { t = t.replace(/^\s+/, ''); if (!t) return; justClosed = false; }
    if (t) emit(t);
  };
  const drain = (final) => {
    for (;;) {
      if (inThink) {
        const at = buf.indexOf(CLOSE);
        if (at === -1) { buf = final ? '' : buf.slice(buf.length - partial(buf, CLOSE)); return; }
        buf = buf.slice(at + CLOSE.length); inThink = false; justClosed = true;
      } else {
        const at = buf.indexOf(OPEN);
        if (at === -1) {
          const keep = final ? 0 : partial(buf, OPEN);
          out(buf.slice(0, buf.length - keep)); buf = buf.slice(buf.length - keep); return;
        }
        out(buf.slice(0, at)); buf = buf.slice(at + OPEN.length); inThink = true;
      }
    }
  };
  return { push(t) { buf += t; drain(false); }, flush() { drain(true); } };
}

/**
 * Incremental stop-sequence filter for streaming: holds back just enough of the
 * tail that a stop sequence split across tokens is still caught, and never emits
 * text that turns out to be part of one.
 */
function makeStopStream(stops, emit) {
  if (!stops.length) return { push: emit, flush() {}, get stopped() { return false; } };
  const hold = Math.max(...stops.map(s => s.length)) - 1;
  let buf = '';
  let stopped = false;
  return {
    push(t) {
      if (stopped) return;
      buf += t;
      const r = applyStop(buf, stops);
      if (r.stopped) { if (r.text) emit(r.text); buf = ''; stopped = true; return; }
      if (buf.length > hold) { emit(buf.slice(0, buf.length - hold)); buf = buf.slice(buf.length - hold); }
    },
    flush() { if (!stopped && buf) emit(buf); buf = ''; },
    get stopped() { return stopped; },
  };
}

/** max_completion_tokens (preferred) / max_tokens → positive int, or 0 for "server default". */
function normalizeMaxTokens(payload) {
  const v = payload.max_completion_tokens ?? payload.max_tokens;
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, "'max_tokens' must be a positive integer", { param: 'max_tokens' });
  return n;
}

/**
 * @param {object} node  DAIMinerNode (uses config, _resolveRequestModel, _runPaidCompute)
 * @param {object} deps  { getQvacModels, isTrulyLocalRequest, materializeAttachments, maxAttachmentBytes }
 * @returns {(req, res, url) => Promise<boolean>} true when the request belonged to /openai/v1
 */
export function createOpenAIHandler(node, deps) {
  const { getQvacModels, isTrulyLocalRequest, materializeAttachments, maxAttachmentBytes } = deps;

  async function backend() {
    const qvac = await getQvacModels();
    if (!qvac || !qvac.ENABLED) throw new ApiError(503, 'Inference backend (QVAC) is unavailable', { code: 'backend_unavailable' });
    return qvac;
  }

  const modelObject = (m) => ({
    id: m.name, object: 'model', created: 0, owned_by: 'dai',
    // DAI extras — OpenAI clients ignore unknown fields.
    label: m.label, loaded: !!m.loaded, installed: !!m.installed,
  });

  /** Known model ids, or a 404 that lists what would have worked. */
  async function resolveModel(qvac, requested, { hasImages }) {
    const asked = typeof requested === 'string' ? requested.trim() : '';
    if (!asked) return node._resolveRequestModel(null, { hasImages });
    const known = await qvac.listModels();
    if (!known.some(m => m.name === asked)) {
      throw new ApiError(404, `The model '${asked}' does not exist on this node. GET ${OPENAI_PREFIX}/models lists the available ids.`, { param: 'model', code: 'model_not_found' });
    }
    return node._resolveRequestModel(asked, { hasImages });
  }

  /** Who is calling and how they pay. */
  function resolveAccess(req, payload) {
    const dai = payload.dai || {};
    let paymentTx = dai.paymentTx || null;
    if (!paymentTx && req.headers['x-dai-payment']) {
      try { paymentTx = JSON.parse(req.headers['x-dai-payment']); } catch { /* malformed → treated as missing proof */ }
    }
    const access = {
      jobId:            dai.jobId            || req.headers['x-dai-job-id'] || null,
      requesterAddress: dai.requesterAddress || req.headers['x-dai-requester'] || null,
      maxBudget:        Number(dai.maxBudget != null ? dai.maxBudget : req.headers['x-dai-max-budget']) || 0,
      paymentTx,
      free: false,
    };
    if (access.requesterAddress) return access;             // an explicit bid always bills

    if (isTrulyLocalRequest(req)) { access.free = true; return access; }

    const key = node.config.llmApiKey;
    if (key) {
      const provided = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      const a = Buffer.from(provided);
      const b = Buffer.from(String(key));
      // Constant-time: a caller must not recover the key byte-by-byte via timing.
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) { access.free = true; return access; }
    }
    return access;                                           // remote, unauthenticated → must pay
  }

  /** Common validation for chat + completions bodies. */
  function checkUnsupported(payload) {
    for (const [field, isBad] of Object.entries(UNSUPPORTED)) {
      if (isBad(payload[field])) {
        throw new ApiError(400, `'${field}' is not supported by this endpoint`, { param: field, code: 'unsupported_parameter' });
      }
    }
    const tc = payload.tool_choice;
    if (tc != null && tc !== 'none' && tc !== 'auto') {
      throw new ApiError(400, "'tool_choice' is not supported by this endpoint", { param: 'tool_choice', code: 'unsupported_parameter' });
    }
    const rf = payload.response_format;
    if (rf != null && !['text', 'json_object'].includes(rf.type)) {
      throw new ApiError(400, `response_format.type "${rf.type}" is not supported (use "text" or "json_object")`, { param: 'response_format', code: 'unsupported_parameter' });
    }
  }

  /**
   * Run one generation. Streaming and non-streaming share this: `onText` receives
   * text as it is produced; the promise resolves to { text, usage, finishReason, fee, model }.
   * Paid calls go through _runPaidCompute, which owns escrow/metering/settlement.
   */
  async function generate({ res, payload, qvac, messages, model, access, stops, maxTokens, onText }) {
    const jsonMode = payload.response_format?.type === 'json_object';
    const stopFilter = makeStopStream(stops, (t) => onText && onText(t));
    const filter = makeThinkFilter((t) => stopFilter.push(t));
    let cancelled = false;
    const onToken = (t) => { filter.push(t); if (stopFilter.stopped) cancelled = true; };
    // Client hung up before we finished writing → stop burning compute on it.
    res.on('close', () => { if (!res.writableFinished) cancelled = true; });

    let usage;
    let fee = 0;
    if (access.free) {
      usage = await qvac.chat(messages, {
        model, timeLimit: 90_000, withUsage: true, jsonMode,
        maxTokens: maxTokens || undefined,
        onToken, shouldStop: () => cancelled,
      });
      if (usage == null || usage.text == null) throw new ApiError(503, `Model "${model}" produced no output`, { code: 'no_output' });
    } else {
      const r = await node._runPaidCompute({
        jobId: access.jobId, requesterAddress: access.requesterAddress, maxBudget: access.maxBudget,
        paymentTx: access.paymentTx, messages, model, maxTokens: maxTokens || undefined, onToken,
      });
      if (r.error) {
        throw new ApiError(r.status || 402, r.error, { code: (r.code || 'payment_required').toLowerCase(), extra: { minFee: r.minFee, minTokens: r.minTokens } });
      }
      usage = r.usage; usage.text = r.text; fee = r.fee;
    }
    filter.flush();
    stopFilter.flush();

    const { text, stopped } = applyStop(usage.text, stops);
    // qvac.chat applies a 512-token ceiling when the caller sets none, so "hit the
    // cap" is measured against that, not just an explicit max_tokens.
    const capped = usage.completionTokens >= (maxTokens || DEFAULT_MAX_TOKENS);
    return {
      text, model, fee,
      usage: { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, total_tokens: usage.totalTokens },
      finishReason: stopped ? 'stop' : capped ? 'length' : 'stop',
    };
  }

  /** Begin an SSE response. Called lazily so pre-flight failures can still be JSON errors. */
  function openSse(res, model, fee) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');            // nginx: do not buffer the stream
    res.setHeader('X-DAI-Model', model);
    if (fee != null) res.setHeader('X-DAI-Fee', String(fee));
    res.flushHeaders?.();
  }
  const sse = (res, obj) => { try { res.write(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`); } catch { /* client gone */ } };

  async function chatCompletions(req, res) {
    const payload = await readJsonBody(req);
    checkUnsupported(payload);
    const access = resolveAccess(req, payload);
    // Decoding images writes files to disk, and payment is only verified later inside
    // _runPaidCompute — so an unauthenticated remote caller must not reach that step.
    const imageParts = JSON.stringify(payload.messages ?? []).includes('"image_url"');
    if (imageParts && !access.free) {
      throw new ApiError(400, 'Image input is only available to local or API-key callers', { param: 'messages', code: 'images_not_available_for_paid' });
    }
    const { messages, hasImages } = normalizeMessages(payload.messages, { materializeAttachments, maxBytes: maxAttachmentBytes });
    const stops = normalizeStop(payload.stop);
    const maxTokens = normalizeMaxTokens(payload);
    const stream = payload.stream === true;
    const includeUsage = stream && payload.stream_options?.include_usage === true;

    const qvac = await backend();
    const model = await resolveModel(qvac, payload.model, { hasImages });
    if (qvac.isInstalled && !(await qvac.isInstalled(model))) {
      throw new ApiError(503, `Model "${model}" is not installed on this device.`, { code: 'model_not_installed', param: 'model' });
    }
    const id = newId('chatcmpl');
    const created = nowSec();
    const chunk = (delta, finish = null, extra = {}) => ({
      id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta, finish_reason: finish }], ...extra,
    });

    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      openSse(res, model, access.free ? 0 : null);
      sse(res, chunk({ role: 'assistant', content: '' }));
    };

    let result;
    try {
      result = await generate({
        res, payload, qvac, messages, model, access, stops, maxTokens,
        onText: stream ? (t) => { if (t) { start(); sse(res, chunk({ content: t })); } } : null,
      });
    } catch (e) {
      // Failed after the stream opened (e.g. a paid run that died mid-way): the
      // status line is already sent, so report in-band the way OpenAI does.
      if (stream && started) {
        sse(res, { error: { message: e.message, type: e.type || 'server_error', code: e.code || null } });
        sse(res, '[DONE]');
        return res.end();
      }
      throw e;
    }

    if (!stream) {
      res.setHeader('X-DAI-Model', result.model);
      res.setHeader('X-DAI-Fee', String(result.fee));
      return sendJson(res, 200, {
        id, object: 'chat.completion', created, model,
        choices: [{ index: 0, message: { role: 'assistant', content: result.text, refusal: null }, logprobs: null, finish_reason: result.finishReason }],
        usage: result.usage,
      });
    }

    start();   // zero-token replies still owe the client a well-formed stream
    sse(res, chunk({}, result.finishReason, includeUsage ? { usage: null } : {}));
    if (includeUsage) sse(res, { id, object: 'chat.completion.chunk', created, model, choices: [], usage: result.usage });
    sse(res, '[DONE]');
    res.end();
  }

  async function completions(req, res) {
    const payload = await readJsonBody(req);
    checkUnsupported(payload);
    if (payload.stream) throw new ApiError(400, "stream:true is only supported on /chat/completions", { param: 'stream', code: 'unsupported_parameter' });
    if (payload.best_of != null && Number(payload.best_of) > 1) throw new ApiError(400, "'best_of' is not supported", { param: 'best_of', code: 'unsupported_parameter' });
    let prompt = payload.prompt;
    if (Array.isArray(prompt)) {
      if (prompt.length !== 1 || typeof prompt[0] !== 'string') throw new ApiError(400, "'prompt' must be a string (batched prompts are not supported)", { param: 'prompt' });
      prompt = prompt[0];
    }
    if (typeof prompt !== 'string' || !prompt) throw new ApiError(400, "'prompt' is required and must be a non-empty string", { param: 'prompt' });

    const stops = normalizeStop(payload.stop);
    const maxTokens = normalizeMaxTokens(payload);
    const qvac = await backend();
    const model = await resolveModel(qvac, payload.model, { hasImages: false });
    if (qvac.isInstalled && !(await qvac.isInstalled(model))) {
      throw new ApiError(503, `Model "${model}" is not installed on this device.`, { code: 'model_not_installed', param: 'model' });
    }
    const access = resolveAccess(req, payload);
    const r = await generate({ res, payload, qvac, messages: [{ role: 'user', content: prompt }], model, access, stops, maxTokens, onText: null });
    res.setHeader('X-DAI-Model', r.model);
    res.setHeader('X-DAI-Fee', String(r.fee));
    return sendJson(res, 200, {
      id: newId('cmpl'), object: 'text_completion', created: nowSec(), model,
      choices: [{ index: 0, text: r.text, logprobs: null, finish_reason: r.finishReason }],
      usage: r.usage,
    });
  }

  async function listModels(res) {
    const qvac = await backend().catch((e) => { throw new ApiError(502, `QVAC unavailable: ${e.message}`); });
    const list = await qvac.listModels();
    return sendJson(res, 200, { object: 'list', data: list.map(modelObject) });
  }

  async function retrieveModel(res, id) {
    const qvac = await backend();
    const m = (await qvac.listModels()).find(x => x.name === id);
    if (!m) throw new ApiError(404, `The model '${id}' does not exist on this node.`, { param: 'model', code: 'model_not_found' });
    return sendJson(res, 200, modelObject(m));
  }

  return async function handleOpenAI(req, res, url) {
    const p = url.pathname;
    if (p !== '/openai' && !p.startsWith('/openai/')) return false;

    try {
      if (p !== OPENAI_PREFIX && !p.startsWith(OPENAI_PREFIX + '/')) {
        throw new ApiError(404, `Unknown route ${req.method} ${p}. This API lives under ${OPENAI_PREFIX}.`, { code: 'unknown_route' });
      }
      const sub = p.slice(OPENAI_PREFIX.length).replace(/\/+$/, '');      // '' | '/models' | ...

      const need = (method) => {
        if (req.method !== method) {
          res.setHeader('Allow', method);
          throw new ApiError(405, `${req.method} is not allowed on ${p}; use ${method}`, { code: 'method_not_allowed' });
        }
      };

      if (sub === '/models') { need('GET'); await listModels(res); }
      else if (sub.startsWith('/models/')) { need('GET'); await retrieveModel(res, decodeURIComponent(sub.slice('/models/'.length))); }
      else if (sub === '/chat/completions') { need('POST'); await chatCompletions(req, res); }
      else if (sub === '/completions') { need('POST'); await completions(req, res); }
      else if (sub === '/embeddings') {
        need('POST');
        throw new ApiError(501, 'Embeddings are not available on this node (no embedding backend)', { code: 'not_implemented' });
      } else {
        throw new ApiError(404, `Unknown route ${req.method} ${p}`, { code: 'unknown_route' });
      }
    } catch (e) {
      if (!(e instanceof ApiError)) console.error('[openai-compat]', e);
      else if (e.status >= 500) console.warn(`[openai-compat] ${e.code || e.status}: ${e.message}`);
      if (res.headersSent) { try { res.end(); } catch { /* already closed */ } }
      else sendError(res, e);
    }
    return true;
  };
}
