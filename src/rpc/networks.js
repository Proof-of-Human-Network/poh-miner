/**
 * PoH Miner - RPC Networks Definition
 *
 * Centralized list of all networks we care about for signals.
 * This powers both config resolution and the GUI dropdowns.
 */

export const NETWORKS = {
  // === Non-EVM / Special Chains ===
  solana: {
    id: 'solana',
    label: 'Solana',
    type: 'solana',
    category: 'Solana',
  },
  btc: {
    id: 'btc',
    label: 'Bitcoin',
    type: 'bitcoin',
    category: 'Bitcoin',
  },
  tron: {
    id: 'tron',
    label: 'TRON',
    type: 'tron',
    category: 'TRON',
  },
  ton: {
    id: 'ton',
    label: 'TON',
    type: 'ton',
    category: 'TON',
  },
  xlm: {
    id: 'xlm',
    label: 'Stellar (XLM)',
    type: 'stellar',
    category: 'Stellar',
  },

  // === Major EVM Chains (as requested) ===
  '1': {
    id: '1',
    label: 'Ethereum',
    type: 'evm',
    category: 'EVM',
    chainId: 1,
  },
  '8453': {
    id: '8453',
    label: 'Base',
    type: 'evm',
    category: 'EVM',
    chainId: 8453,
  },
  '42161': {
    id: '42161',
    label: 'Arbitrum One',
    type: 'evm',
    category: 'EVM',
    chainId: 42161,
  },
  '56': {
    id: '56',
    label: 'BNB Smart Chain',
    type: 'evm',
    category: 'EVM',
    chainId: 56,
  },
  '137': {
    id: '137',
    label: 'Polygon',
    type: 'evm',
    category: 'EVM',
    chainId: 137,
  },
  '10': {
    id: '10',
    label: 'OP Mainnet (Optimism)',
    type: 'evm',
    category: 'EVM',
    chainId: 10,
  },
  '5000': {
    id: '5000',
    label: 'Mantle',
    type: 'evm',
    category: 'EVM',
    chainId: 5000,
  },
  '43114': {
    id: '43114',
    label: 'Avalanche C-Chain',
    type: 'evm',
    category: 'EVM',
    chainId: 43114,
  },
  '324': {
    id: '324',
    label: 'zkSync Era',
    type: 'evm',
    category: 'EVM',
    chainId: 324,
  },
  '59144': {
    id: '59144',
    label: 'Linea',
    type: 'evm',
    category: 'EVM',
    chainId: 59144,
  },
  '143': {
    id: '143',
    label: 'Monad',
    type: 'evm',
    category: 'EVM',
    chainId: 143,
  },
  '534352': {
    id: '534352',
    label: 'Scroll',
    type: 'evm',
    category: 'EVM',
    chainId: 534352,
  },
  '25': {
    id: '25',
    label: 'Cronos',
    type: 'evm',
    category: 'EVM',
    chainId: 25,
  },
  '480': {
    id: '480',
    label: 'World Chain',
    type: 'evm',
    category: 'EVM',
    chainId: 480,
  },
};

/** All EVM chain IDs as an array (useful for bulk operations) */
export const EVM_CHAIN_IDS = Object.keys(NETWORKS).filter(
  (id) => NETWORKS[id].type === 'evm'
);

/** Human-friendly list for dropdowns */
export function getNetworkList() {
  return Object.values(NETWORKS).map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    category: n.category,
  }));
}

/** Get networks grouped by category (nice for GUI) */
export function getNetworksGrouped() {
  const groups = {};

  Object.values(NETWORKS).forEach((net) => {
    const cat = net.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({
      id: net.id,
      label: net.label,
      type: net.type,
    });
  });

  return groups;
}
