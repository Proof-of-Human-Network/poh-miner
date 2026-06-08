/**
 * PoH Miner Network - Result Validator
 *
 * Enforces that miners performed proper inference work.
 * Used for both local acceptance and future slashing / reward qualification.
 *
 * Note on stronger protection:
 * For even higher assurance (against compromised host OS), see
 * `docs/tee-protection-architecture.md` (Nitro Enclaves, SEV-SNP, etc.).
 * This is considered an optional future path for high-trust miners.
 */

import { getMethodsManager } from '../signals/methods-manager.js';

let methodsManager = null;

async function getManager() {
  if (!methodsManager) {
    methodsManager = await getMethodsManager();
  }
  return methodsManager;
}

/**
 * Minimum percentage of applicable live signals a miner must evaluate.
 * "Applicable" = signals that match the address's chain type.
 * A Bitcoin address has no Solana signals applicable to it; counting all 148
 * as the denominator would always fail BTC/TON/etc. addresses.
 */
const MIN_SIGNALS_FRACTION = 0.50;

/**
 * Detect which blockchain chains an address belongs to.
 * Returns an array of chain tags: 'evm', 'solana', 'bitcoin', 'ton', 'poh'
 */
function detectAddressChains(address) {
  if (!address || typeof address !== 'string') return ['universal'];
  const a = address.trim();

  if (/^0x[0-9a-fA-F]{40}$/.test(a))  return ['evm'];
  if (/^(1|3)[a-km-zA-HJ-NP-Z1-9]{24,33}$/.test(a) || /^bc1[a-z0-9]{6,87}$/.test(a)) return ['bitcoin'];
  if (/^(EQ|UQ)[A-Za-z0-9+/=_-]{46}$/.test(a)) return ['ton'];
  if (/^poh[0-9a-f]{40}$/i.test(a)) return ['poh'];
  // Solana: base58, 32-44 chars, no 0 or O or l or I
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return ['solana'];
  return ['universal'];
}

/**
 * Filter live signals to only those applicable to the detected chain(s).
 * Falls back to the full set if the signal metadata has no chain info.
 */
function filterApplicableSignals(liveSignals, chains) {
  if (chains.includes('universal')) return liveSignals;

  return liveSignals.filter(m => {
    const id = (m.id || m.methodId || '').toLowerCase();
    const chainField = (m.chain || m.chains || m.network || '');
    const chainStr = Array.isArray(chainField) ? chainField.join(',') : String(chainField || '').toLowerCase();

    // If signal has explicit chain metadata, use it
    if (chainStr) {
      return chains.some(c => chainStr.includes(c)) || chainStr.includes('universal') || chainStr.includes('all');
    }

    // Infer from signal ID naming convention
    if (chains.includes('evm') &&
      (id.includes('evm') || id.includes('eth') || id.includes('_1_') || id.includes('arbitrum') || id.includes('base') || id.includes('polygon')))
      return true;
    if (chains.includes('solana') && (id.includes('solana') || id.includes('sol') || id.includes('spl'))) return true;
    if (chains.includes('bitcoin') && (id.includes('bitcoin') || id.includes('btc'))) return true;
    if (chains.includes('ton') && (id.includes('ton') || id.includes('toncenter') || id.includes('ston') || id.includes('omniston'))) return true;
    if (chains.includes('poh') && (id.includes('poh'))) return true;

    // Cross-chain / universal signals — always count regardless of address type
    const universalKeywords = ['ofac', 'identity', 'ens', 'onchain', 'social', 'nft', 'defi', 'web3'];
    if (universalKeywords.some(k => id.includes(k))) return true;

    // Unknown convention: include to avoid false negatives
    return true;
  });
}

/**
 * Validates that a ScanResult represents honest, full work.
 */
export async function validateResultWork(result, request = {}) {
  const manager = await getManager();
  const allLiveSignals = manager.getActiveMethods();

  // Filter to signals applicable for this address's chain type
  const address = result.address || request?.payload?.address || '';
  const chains = detectAddressChains(address);
  const liveSignals = filterApplicableSignals(allLiveSignals, chains);
  const liveCount = liveSignals.length;

  if (liveCount < allLiveSignals.length) {
    console.log(`[validator] Chain filter for ${address} (${chains.join('+')}): ${liveCount}/${allLiveSignals.length} applicable signals`);
  }

  const errors = [];

  // 1. Must have used a recent methods set
  // Tolerate small staleness: the live curve-backed set can be updated by the network (or manager background sync)
  // while a job is being computed (60s+ window with RPCs + brain). A result computed against a set that was
  // current at job start is still honest high-quality work.
  if (result.methodsHash && manager.hash && result.methodsHash !== manager.hash) {
    // Only hard-fail on completely bogus/empty hash. Otherwise just note it (other nodes will verify the
    // declared methodsHash against what they consider canonical at block inclusion time).
    if (!result.methodsHash || result.methodsHash === 'unknown' || result.methodsHash.startsWith('sim-')) {
      errors.push(`Stale methodsHash: ${result.methodsHash} (current: ${manager.hash})`);
    } else {
      console.warn(`[validator] Result methodsHash ${result.methodsHash} != current live ${manager.hash} (update raced during compute). Accepting as long as signal ids are mostly valid.`);
    }
  }

  // 2. Must have scanned a sufficient number of signals
  const signalsUsed = Array.isArray(result.signalsUsed) ? result.signalsUsed : [];
  const signalsEvaluated = signalsUsed.length || result.methodsCount || 0;

  // Fast-path: sim fallbacks are intentionally low-effort (dev only)
  if (result.methodsHash && String(result.methodsHash).startsWith('sim-')) {
    // Still require profile for shape, but do not spam "insufficient" for sims
    if (!result.profile) {
      errors.push('Missing profile (miners must return full POH output including profile)');
    }
    return {
      isValid: errors.length === 0,
      errors,
      signalsEvaluated: signalsEvaluated || 28,
      liveCount,
      fraction: 1,
    };
  }

  if (liveCount > 0) {
    const fraction = signalsEvaluated / liveCount;

    if (fraction < MIN_SIGNALS_FRACTION) {
      errors.push(
        `Insufficient work: only evaluated ${signalsEvaluated}/${liveCount} signals ` +
        `(${(fraction * 100).toFixed(1)}%). Minimum required: ${(MIN_SIGNALS_FRACTION * 100).toFixed(0)}%`
      );
    }

    // Stronger check: verify that the reported signalsUsed actually correspond to real live methods
    const liveMethodIds = new Set(liveSignals.map(m => m.id || m.methodId));
    const unknownSignals = signalsUsed.filter(s => {
      const id = s?.methodId || s?.id || s;
      return id && !liveMethodIds.has(id);
    });

    if (unknownSignals.length > 0) {
      const unknownPct = unknownSignals.length / Math.max(1, signalsEvaluated);
      if (unknownPct > 0.05) {
        errors.push(`Reported evaluation of ${unknownSignals.length} unknown/invalid signals (${(unknownPct*100).toFixed(1)}%)`);
      } else {
        console.warn(`[validator] ${unknownSignals.length} signals in result were not in the absolute latest live set (small drift during update ok).`);
      }
    }

    // High-value signals requirement: At least 20% of evaluated signals should come from the current curve-backed live set
    const curveBackedCount = signalsUsed.filter(s => {
      const id = s?.methodId || s?.id || s;
      return id && liveMethodIds.has(id);
    }).length;

    const highValueFraction = curveBackedCount / Math.max(1, signalsEvaluated);
    if (highValueFraction < 0.20 && liveCount > 10) {
      errors.push(`Insufficient high-value (curve-backed) signals: only ${(highValueFraction * 100).toFixed(1)}% of evaluated work. Minimum 20% required.`);
    }
  } else {
    // No live signals yet — be lenient during bootstrap
    if (signalsEvaluated < 5) {
      errors.push('Too few signals evaluated during bootstrap phase');
    }
  }

  // 3. Must include verdict + profile (as required for proper POH work)
  if (!result.verdict) {
    errors.push('Missing verdict');
  }
  if (!result.profile) {
    errors.push('Missing profile (miners must return full POH output including profile)');
  }
  if (!result.reasoning) {
    errors.push('Missing reasoning');
  }

  // 4. Computation time sanity check (very rough)
  // Real work (RPCs + brain LLM) takes seconds; allow very fast local-only runs in dev.
  const timeMs = result.computationTimeMs || 0;
  if (signalsEvaluated > 20 && timeMs < 50) {
    errors.push(`Suspiciously fast: claimed ${signalsEvaluated} signals in only ${timeMs}ms`);
  }

  const isValid = errors.length === 0;

  return {
    isValid,
    errors,
    signalsEvaluated,
    liveCount,
    fraction: liveCount > 0 ? signalsEvaluated / liveCount : 1,
  };
}

/**
 * Convenience helper — throws on invalid work (useful in strict paths).
 */
export async function assertValidWork(result, request) {
  const validation = await validateResultWork(result, request);
  if (!validation.isValid) {
    const err = new Error('Invalid work submitted: ' + validation.errors.join(' | '));
    err.validation = validation;
    throw err;
  }
  return validation;
}
