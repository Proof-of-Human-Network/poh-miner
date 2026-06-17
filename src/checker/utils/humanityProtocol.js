'use strict';

// Humanity Protocol verification oracle — https://docs.humanity.org/
// Permissionless on-chain check on Humanity's own L2 (chain 6985385).
// Returns true if the wallet has completed palm biometric verification.

const { ethers } = require('ethers');

// rpc.humanity.org returns 403 (Cloudflare blocks server-side requests).
// Thirdweb hosts the same chain (id 6985385) publicly without restrictions.
const HUMANITY_RPC      = 'https://6985385.rpc.thirdweb.com';
const ORACLE_ADDRESS    = '0x8D71D8bD47860bd0381b272AE42162c3692c4F3a';
const MAX_AGE_SECONDS   = 86400 * 30; // accept verifications up to 30 days old

// Minimal ABI — only isUserVerified is needed
const ORACLE_ABI = [
  'function isUserVerified(address user, string[] calldata requiredClaims, uint256 maxAge) external view returns (bool verified, bytes32 uid, uint256 expiresAt)',
];

let _provider = null;
let _oracle   = null;

function getOracle() {
  if (!_oracle) {
    _provider = new ethers.JsonRpcProvider(HUMANITY_RPC);
    _oracle   = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, _provider);
  }
  return _oracle;
}

async function checkHumanityVerified(address) {
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null; // Solana — skip
    const oracle = getOracle();
    const [verified] = await oracle.isUserVerified(address, ['is_human'], MAX_AGE_SECONDS);
    console.log(`[humanity] ${address}: verified=${verified}`);
    return {
      methodId:    'humanity_protocol',
      description: 'Humanity Protocol: palm biometric verification (on-chain oracle)',
      result:      verified,
      input:       address,
    };
  } catch (err) {
    console.error('[humanity] oracle call failed:', err.message);
    return null;
  }
}

module.exports = { checkHumanityVerified };
