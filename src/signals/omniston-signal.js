/**
 * Signal: omniston_ton_swap_activity
 *
 * Fetches TON transactions for a wallet via Toncenter v3 REST API,
 * filters for messages to/from Omniston/STON.fi router contracts, and
 * computes a human-likelihood score from:
 *   - Swap frequency (>100 swaps/30d → bot-like)
 *   - Inter-swap interval variance (low variance + high count → bot-like)
 *
 * Configuration:
 *   config.rpcOverrides.ton  — Toncenter endpoint (default: toncenter.com/api/v3)
 *   config.toncenterApiKey   — API key for higher rate limits (optional)
 *
 * Returns: { methodId, result: boolean, details: {...} }
 */

const STON_ROUTER_V1 = 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTDSDg_eo7BVBo-CNL';
const STON_ROUTER_V2 = 'EQCVxuYqoidMNJnr_jCEq0ITRZ04DIn5ffrIpXSvIFUPWBNP';

export async function runOmnistonSignal(address, { toncenterUrl, apiKey } = {}) {
  const base = (toncenterUrl || 'https://toncenter.com/api/v3').replace(/\/$/, '');
  const headers = apiKey ? { 'X-Api-Key': apiKey } : {};

  const res = await fetch(
    `${base}/transactions?account=${encodeURIComponent(address)}&limit=100&sort=desc`,
    { headers, signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) throw new Error(`Toncenter ${res.status}: ${await res.text().catch(() => '')}`);
  const { transactions = [] } = await res.json();

  const swaps = transactions.filter(tx => {
    const destinations = [
      ...(tx.out_msgs || []).map(m => m.destination),
      tx.in_msg?.source,
    ].filter(Boolean);
    return destinations.some(d => d === STON_ROUTER_V1 || d === STON_ROUTER_V2);
  });

  const now = Date.now();
  const swapLast30d = swaps.filter(tx => {
    const ts = ((tx.now || tx.utime || 0) * 1000);
    return now - ts < 30 * 86400 * 1000;
  }).length;

  const timestamps = swaps
    .map(tx => tx.now || tx.utime || 0)
    .filter(Boolean)
    .sort((a, b) => b - a);

  let variance = 0;
  if (timestamps.length >= 2) {
    const intervals = timestamps.slice(0, -1).map((t, i) => t - timestamps[i + 1]);
    const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
  }

  // Bot pattern: many swaps, very regular timing (low variance)
  const botLike = swapLast30d > 100 || (variance < 100 && swapLast30d > 10);
  const isHuman = swaps.length === 0 || !botLike;

  return {
    methodId: 'omniston_ton_swap_activity',
    chain: 'ton',
    result: isHuman,
    details: {
      swapCount: swaps.length,
      swapLast30d,
      varianceSeconds: Math.round(variance),
      routersChecked: [STON_ROUTER_V1.slice(0, 8) + '…', STON_ROUTER_V2.slice(0, 8) + '…'],
    },
  };
}
