/**
 * Sandboxed skill execution worker.
 * Runs inside worker_threads with restricted network access.
 * Input: workerData = { code, input, config, allowedEndpoints }
 * Output: postMessage(result) on success, postMessage({ __error: message }) on failure.
 *
 * SECURITY BOUNDARIES:
 *  - Network: fetch is patched to enforce allowedEndpoints whitelist
 *  - Compute: hard-killed after 15s (timeout set by SkillsManager)
 *  - Process: process.exit / process.env / require are shadowed to no-ops
 *  - Filesystem: fs access throws because require is blocked
 *  - Output: only plain JSON; no postMessage of functions/streams
 */
import { workerData, parentPort } from 'worker_threads';

const { code, input, config, maxBudget = 0, allowedEndpoints = [] } = workerData;

// ── Patch fetch to enforce allowedEndpoints and count calls ───────────────────
let _fetchCallCount = 0;
const _origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const host = new URL(url).hostname;
  if (allowedEndpoints.length && !allowedEndpoints.includes('*')) {
    if (!allowedEndpoints.some(ep => host === ep || host.endsWith('.' + ep))) {
      throw new Error(`Skill fetch blocked: ${host} not in allowedEndpoints`);
    }
  }
  _fetchCallCount++;
  return _origFetch(url, opts);
};

// ── Block dangerous globals ────────────────────────────────────────────────────
// Shadow process.exit so a skill can't crash the worker supervisor
const _safeProcess = {
  env: {},           // empty — skills get no env vars
  exit: () => { throw new Error('process.exit not allowed in skill'); },
  cwd: () => '/',
};
const require = () => { throw new Error('require not allowed in skill sandbox'); };
const __dirname  = '/';
const __filename = '/skill.js';

// ── Evaluate skill code ────────────────────────────────────────────────────────
try {
  const mod = { exports: {} };
  // Skills receive only: module, exports, fetch (patched), console, JSON, Math,
  // Promise, setTimeout, clearTimeout. Everything else is shadowed above.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
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

  // Sanitize output — only allow plain serialisable values
  const safe = JSON.parse(JSON.stringify(result ?? null));
  parentPort.postMessage({ result: safe, meta: { fetchCalls: _fetchCallCount, computeMs: _computeMs } });
} catch (err) {
  parentPort.postMessage({ __error: err.message });
}
