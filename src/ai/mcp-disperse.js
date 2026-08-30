/**
 * Disperse MCP execution across live peers.
 *
 * Catalog is replicated on every node; what we shard is *who runs* a given
 * mcpId. Goal: N picked tools → up to N distinct peers, so 20 tools can run
 * on 20 machines in parallel instead of serially on the chatting node.
 *
 * Assignment is a consistent hash of mcpId onto the peer list, then a greedy
 * pass that prefers unused peers so we actually spread.
 */

import { createHash } from 'crypto';

function hashHex(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

function rankPeers(mcpId, peers) {
  return [...peers].sort((a, b) => hashHex(mcpId + '\0' + a).localeCompare(hashHex(mcpId + '\0' + b)));
}

/**
 * @param {string[]} mcpIds
 * @param {string[]} peerUrls  base URLs of other miners
 * @param {{ local?: string }} [opts]
 * @returns {Map<string, string>} mcpId → peer URL or 'local'
 */
export function assignMcpToPeers(mcpIds, peerUrls = [], { local = 'local' } = {}) {
  const assigned = new Map();
  const used = new Set();
  const pool = [...new Set((peerUrls || []).filter(Boolean))];
  const ids = [...new Set((mcpIds || []).filter(Boolean))];

  for (const id of ids) {
    if (!pool.length) {
      assigned.set(id, local);
      continue;
    }
    const ranked = rankPeers(id, pool);
    const unused = ranked.find(p => !used.has(p));
    const pick = unused || ranked[0];
    used.add(pick);
    assigned.set(id, pick);
  }
  return assigned;
}

/** Stable replica set (RF=3) for a single mcpId — who is "hot" for it. */
export function replicasFor(mcpId, peerUrls = [], rf = 3) {
  const pool = [...new Set((peerUrls || []).filter(Boolean))];
  if (!pool.length) return [];
  return rankPeers(mcpId, pool).slice(0, Math.min(rf, pool.length));
}

export async function callPeerMcp(peerBase, { server, tool, arguments: args, timeoutMs = 20_000 } = {}) {
  const base = String(peerBase).replace(/\/+$/, '');
  const res = await fetch(`${base}/api/mcp/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server, tool, arguments: args || {}, _dispersed: true }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `peer MCP HTTP ${res.status}`);
  return data.result ?? data.text ?? JSON.stringify(data);
}
