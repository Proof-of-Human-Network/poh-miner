/**
 * PoH Miner - RPC Providers Registry
 *
 * This is the source of truth for:
 * - Which providers exist
 * - Which networks they support
 * - How to construct their RPC URLs from an API key
 *
 * Used by both the config resolver and the GUI.
 */

import { EVM_CHAIN_IDS } from './networks.js';

/**
 * Provider definitions.
 *
 * supportedNetworks can contain:
 *   - specific network ids (e.g. "solana", "btc", "1", "tron")
 *   - "evm" → means this provider supports all EVM chains
 */
export const PROVIDERS = {
  alchemy: {
    id: 'alchemy',
    name: 'Alchemy',
    description: 'Excellent EVM + good Solana support',
    supportedNetworks: ['evm', 'solana'],
    requiresKey: true,
    buildUrl: (networkId, apiKey) => {
      if (networkId === 'solana') {
        return `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`;
      }
      // Alchemy uses network slugs for EVM
      const slug = getAlchemyEvmSlug(networkId);
      return `https://${slug}.g.alchemy.com/v2/${apiKey}`;
    },
  },

  helius: {
    id: 'helius',
    name: 'Helius',
    description: 'Best-in-class Solana RPC and webhooks',
    supportedNetworks: ['solana'],
    requiresKey: true,
    buildUrl: (networkId, apiKey) => {
      return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    },
  },

  quicknode: {
    id: 'quicknode',
    name: 'QuickNode',
    description: 'Very broad coverage (EVM + Solana + BTC + Tron)',
    supportedNetworks: ['evm', 'solana', 'btc', 'tron'],
    requiresKey: true,
    // QuickNode uses different endpoints per chain. User usually pastes full endpoint.
    // For simplicity we use a placeholder pattern — user often overrides.
    buildUrl: (networkId, apiKey) => {
      // QuickNode endpoints are usually like https://xxx.quiknode.pro/KEY/
      // We return a template the user can adjust
      return `https://YOUR-ENDPOINT.quiknode.pro/${apiKey}/`;
    },
  },

  ankr: {
    id: 'ankr',
    name: 'Ankr',
    description: 'Good multi-chain RPC (strong on EVM)',
    supportedNetworks: ['evm', 'solana', 'btc'],
    requiresKey: true,
    buildUrl: (networkId, apiKey) => {
      if (networkId === 'solana') {
        return `https://rpc.ankr.com/solana/${apiKey}`;
      }
      if (networkId === 'btc') {
        return `https://rpc.ankr.com/btc/${apiKey}`;
      }
      const slug = getAnkrEvmSlug(networkId);
      return `https://rpc.ankr.com/${slug}/${apiKey}`;
    },
  },

  getblock: {
    id: 'getblock',
    name: 'GetBlock',
    description: 'Wide chain support including many non-EVM',
    supportedNetworks: ['evm', 'solana', 'btc', 'tron'],
    requiresKey: true,
    buildUrl: (networkId, apiKey) => {
      const slug = getGetBlockSlug(networkId);
      return `https://${slug}.getblock.io/${apiKey}/mainnet/`;
    },
  },

  // === Specialized Providers ===

  trongrid: {
    id: 'trongrid',
    name: 'TronGrid (Official)',
    description: 'Official TRON RPC',
    supportedNetworks: ['tron'],
    requiresKey: true,
    buildUrl: (networkId, apiKey) => {
      return `https://api.trongrid.io/jsonrpc?api_key=${apiKey}`;
    },
  },

  toncenter: {
    id: 'toncenter',
    name: 'TON Center',
    description: 'Popular TON RPC provider',
    supportedNetworks: ['ton'],
    requiresKey: true,
    buildUrl: (networkId, apiKey) => {
      return `https://toncenter.com/api/v2/jsonRPC?api_key=${apiKey}`;
    },
  },

  blockchair: {
    id: 'blockchair',
    name: 'Blockchair',
    description: 'Good Bitcoin + multi-chain data',
    supportedNetworks: ['btc'],
    requiresKey: true,
    buildUrl: (networkId, apiKey) => {
      return `https://api.blockchair.com/bitcoin?key=${apiKey}`;
    },
  },

  mempool: {
    id: 'mempool',
    name: 'Mempool.space',
    description: 'Popular open Bitcoin explorer + API',
    supportedNetworks: ['btc'],
    requiresKey: false,
    buildUrl: () => {
      return 'https://mempool.space/api';
    },
  },

  stellar: {
    id: 'stellar',
    name: 'Stellar Horizon (Official)',
    description: 'Official Stellar network RPC',
    supportedNetworks: ['xlm'],
    requiresKey: false,
    buildUrl: () => {
      return 'https://horizon.stellar.org';
    },
  },

  // Allow fully manual configuration
  custom: {
    id: 'custom',
    name: 'Custom / Self-hosted',
    description: 'Provide your own full RPC URL',
    supportedNetworks: ['*'], // supports everything
    requiresKey: false,
    buildUrl: () => null, // User will use overrides instead
  },
};

/**
 * Returns whether a provider supports a given network.
 */
export function providerSupportsNetwork(providerId, networkId) {
  const provider = PROVIDERS[providerId];
  if (!provider) return false;

  const supported = provider.supportedNetworks;

  if (supported.includes('*')) return true;
  if (supported.includes(networkId)) return true;

  // Special case: "evm" means all EVM chains
  if (supported.includes('evm')) {
    // Check if networkId is an EVM chain id
    return EVM_CHAIN_IDS.includes(networkId);
  }

  return false;
}

/**
 * Get list of providers that support a specific network (for dropdown).
 */
export function getProvidersForNetwork(networkId) {
  return Object.values(PROVIDERS)
    .filter((p) => providerSupportsNetwork(p.id, networkId))
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      requiresKey: p.requiresKey,
    }));
}

/**
 * Build RPC URL from provider + apiKey for a network.
 */
export function buildRpcUrl(networkId, providerId, apiKey) {
  const provider = PROVIDERS[providerId];
  if (!provider) return null;

  if (!providerSupportsNetwork(providerId, networkId)) {
    return null;
  }

  return provider.buildUrl(networkId, apiKey);
}

// === Internal slug helpers ===

function getAlchemyEvmSlug(chainId) {
  const map = {
    '1': 'eth-mainnet',
    '8453': 'base-mainnet',
    '42161': 'arb-mainnet',
    '56': 'bnb-mainnet',
    '137': 'polygon-mainnet',
    '10': 'opt-mainnet',
    '5000': 'mantle-mainnet',
    '43114': 'avax-mainnet',
    '324': 'zksync-mainnet',
    '59144': 'linea-mainnet',
    '143': 'monad-mainnet', // may not exist yet
    '534352': 'scroll-mainnet',
    '25': 'cronos-mainnet',
    '480': 'worldchain-mainnet',
  };
  return map[chainId] || 'eth-mainnet';
}

function getAnkrEvmSlug(chainId) {
  const map = {
    '1': 'eth',
    '8453': 'base',
    '42161': 'arbitrum',
    '56': 'bsc',
    '137': 'polygon',
    '10': 'optimism',
    '5000': 'mantle',
    '43114': 'avalanche',
    '324': 'zksync',
    '59144': 'linea',
    '534352': 'scroll',
    '25': 'cronos',
  };
  return map[chainId] || 'eth';
}

function getGetBlockSlug(networkId) {
  const map = {
    solana: 'sol',
    btc: 'btc',
    tron: 'tron',
    '1': 'eth',
    '8453': 'base',
    '42161': 'arbitrum',
    '56': 'bsc',
    '137': 'polygon',
  };
  return map[networkId] || 'eth';
}
