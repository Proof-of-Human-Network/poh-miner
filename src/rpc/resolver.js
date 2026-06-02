/**
 * PoH Miner - RPC Config Resolver
 *
 * Converts the new friendly "rpc" config format into the legacy
 * `solanaRpc` + `rpcEndpoints` format that the checker/brain expects.
 *
 * This gives us nice UX in config + GUI while keeping full backward compatibility.
 */

import { NETWORKS } from './networks.js';
import { PROVIDERS, buildRpcUrl } from './providers.js';

/**
 * Main entry point.
 * Takes the user's full config and returns the old-style RPC config.
 */
export function resolveRpcConfig(userConfig = {}) {
  const result = {
    solanaRpc: null,
    rpcEndpoints: {},
  };

  const newRpc = userConfig.rpc || {};
  const overrides = userConfig.rpcOverrides || {};

  // 1. Process each network defined in the new format
  Object.entries(newRpc).forEach(([networkId, entry]) => {
    if (!entry || typeof entry !== 'object') return;

    let url = null;

    // Highest priority: manual override
    if (overrides[networkId]) {
      url = overrides[networkId];
    }
    // Second: provider + apiKey
    else if (entry.provider && entry.apiKey) {
      url = buildRpcUrl(networkId, entry.provider, entry.apiKey);
    }
    // Third: if user put a full url directly (advanced)
    else if (entry.url) {
      url = entry.url;
    }

    if (!url) return;

    // Map to legacy format
    if (networkId === 'solana') {
      result.solanaRpc = url;
    } else {
      result.rpcEndpoints[networkId] = url;
    }
  });

  // 2. Apply any remaining overrides that weren't covered above
  Object.entries(overrides).forEach(([networkId, url]) => {
    if (networkId === 'solana') {
      result.solanaRpc = url;
    } else {
      result.rpcEndpoints[networkId] = url;
    }
  });

  // 3. Backward compatibility: merge old-style config if new style is empty
  if (!result.solanaRpc && userConfig.solanaRpc) {
    result.solanaRpc = userConfig.solanaRpc;
  }

  if (userConfig.rpcEndpoints) {
    result.rpcEndpoints = {
      ...result.rpcEndpoints,
      ...userConfig.rpcEndpoints,
    };
  }

  return result;
}

/**
 * Helper used by the GUI to preview what URL will be generated.
 */
export function previewRpcUrl(networkId, providerId, apiKey) {
  if (!providerId || !apiKey) return null;
  return buildRpcUrl(networkId, providerId, apiKey);
}

/**
 * Applies one provider + key to multiple networks at once.
 * Very useful for EVM providers (Alchemy, QuickNode, Ankr...).
 *
 * @param {object} currentRpc - current "rpc" section of config
 * @param {string[]} networkIds - list of network ids to apply to
 * @param {string} providerId
 * @param {string} apiKey
 */
export function bulkApplyProvider(currentRpc = {}, networkIds = [], providerId, apiKey) {
  const updated = { ...currentRpc };

  networkIds.forEach((netId) => {
    updated[netId] = {
      provider: providerId,
      apiKey,
    };
  });

  return updated;
}
