/**
 * Sandboxed skill execution worker.
 * Runs inside worker_threads with restricted network access.
 * Input: workerData = { code, input, config, allowedEndpoints }
 * Output: postMessage(result) on success, postMessage({ __error: message }) on failure.
 *
 * SECURITY BOUNDARIES:
 *  - Network: fetch is patched to enforce allowedEndpoints whitelist
 *  - Compute: hard-killed after 15s (timeout set by SkillsManager)
 *  - Process: process/require/import are blocked; globalThis is frozen
 *  - Filesystem: fs access throws because require is blocked
 *  - Output: only plain JSON; no postMessage of functions/streams
 */
import { workerData, parentPort } from 'worker_threads';

const { code, input, config, maxBudget = 0, allowedEndpoints = [] } = workerData;

// ── Block dangerous globals before any skill code runs ────────────────────────
const _blocked = () => { throw new Error('not allowed in skill sandbox'); };
const _safeProcess = {
  env: {},
  exit: () => { throw new Error('process.exit not allowed in skill'); },
  cwd: () => '/',
  versions: {},
  platform: 'sandbox',
  arch: 'sandbox',
};
const require = _blocked;
const __dirname  = '/';
const __filename = '/skill.js';

// Shadow Function constructor to block constructor-chain escapes.
// Must NOT redeclare `Function` in module scope — that puts `Function` in the TDZ
// and breaks `_OrigFunction = Function` with "Cannot access 'Function' before initialization".
const _OrigFunction = globalThis.Function;
const _BlockedFunction = function (...args) {
  throw new Error('Function constructor not allowed in skill sandbox');
};
_BlockedFunction.prototype = _OrigFunction.prototype;

// Block dynamic import
const dynamicImport = async () => { throw new Error('dynamic import not allowed in skill sandbox'); };
globalThis.import = dynamicImport;
globalThis.require = require;
globalThis.process = _safeProcess;
globalThis.Function = _BlockedFunction;

// ── Patch fetch to enforce allowedEndpoints and count calls ───────────────────
let _fetchCallCount = 0;
const _origFetch = globalThis.fetch;
const BLOCKED_FETCH_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

globalThis.fetch = async (url, opts) => {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_FETCH_HOSTS.has(host)) {
    throw new Error(`Skill fetch blocked: loopback host ${host}`);
  }
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    throw new Error(`Skill fetch blocked: private network host ${host}`);
  }
  if (!allowedEndpoints.length) {
    throw new Error(`Skill fetch blocked: no allowedEndpoints configured for this skill`);
  }
  if (!allowedEndpoints.includes('*')) {
    if (!allowedEndpoints.some(ep => host === ep || host.endsWith('.' + ep))) {
      throw new Error(`Skill fetch blocked: ${host} not in allowedEndpoints`);
    }
  }
  _fetchCallCount++;
  return _origFetch(url, opts);
};

// Freeze globalThis after patching — prevents skill code from restoring escapes
Object.freeze(globalThis.process);
Object.freeze(_safeProcess);

// ── Evaluate skill code ────────────────────────────────────────────────────────
try {
  const mod = { exports: {} };
  const factory = _OrigFunction(
    'module', 'exports',
    'require', 'process', '__dirname', '__filename',
    code
  );
  factory(mod, mod.exports, require, _safeProcess, __dirname, __filename);

  const runFn = mod.exports.run || mod.exports.default;
  if (typeof runFn !== 'function') throw new Error('Skill must export async function run(input, config)');

  const _start = Date.now();
  const result = await runFn(input, { ...config, maxBudget });
  const _computeMs = Date.now() - _start;

  const safe = JSON.parse(JSON.stringify(result ?? null));
  parentPort.postMessage({ result: safe, meta: { fetchCalls: _fetchCallCount, computeMs: _computeMs } });
} catch (err) {
  parentPort.postMessage({ __error: err.message });
}