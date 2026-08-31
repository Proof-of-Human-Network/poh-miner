/**
 * Shared HTTP helper for builtin MCP tools.
 * Allowlisted hosts only — builtins never take a free-form URL from the model.
 */

export const UA = 'dai-miner/0.4.33 (+https://iamai.kg)';
export const TIMEOUT_MS = 12_000;
export const MAX_CHARS = 24_000;

export async function fetchJson(url, { timeoutMs = TIMEOUT_MS, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

export async function fetchText(url, { timeoutMs = TIMEOUT_MS, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/plain, text/html, */*', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.text()).slice(0, MAX_CHARS);
}

export function compact(value, max = MAX_CHARS) {
  const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return s.length > max ? s.slice(0, max) + '\n…(truncated)' : s;
}

export function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function str(v) {
  return v == null ? '' : String(v).trim();
}
