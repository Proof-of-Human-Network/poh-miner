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
 * Minimum percentage of live signals a miner must evaluate.
 * 0.8 = 80%
 */
const MIN_SIGNALS_FRACTION = 0.75;

/**
 * Validates that a ScanResult represents honest, full work.
 */
export async function validateResultWork(result, request = {}) {
  const manager = await getManager();
  const liveSignals = manager.getActiveMethods();
  const liveCount = liveSignals.length;

  const errors = [];

  // 1. Must have used a recent methods set
  if (result.methodsHash && manager.hash && result.methodsHash !== manager.hash) {
    errors.push(`Stale methodsHash: ${result.methodsHash} (current: ${manager.hash})`);
  }

  // 2. Must have scanned a sufficient number of signals
  const signalsUsed = Array.isArray(result.signalsUsed) ? result.signalsUsed : [];
  const signalsEvaluated = signalsUsed.length || result.methodsCount || 0;

  if (liveCount > 0) {
    const fraction = signalsEvaluated / liveCount;

    if (fraction < MIN_SIGNALS_FRACTION) {
      errors.push(
        `Insufficient work: only evaluated ${signalsEvaluated}/${liveCount} signals ` +
        `(${(fraction * 100).toFixed(1)}%). Minimum required: ${(MIN_SIGNALS_FRACTION * 100)}%`
      );
    }

    // Stronger check: verify that the reported signalsUsed actually correspond to real live methods
    const liveMethodIds = new Set(liveSignals.map(m => m.id || m.methodId));
    const unknownSignals = signalsUsed.filter(s => {
      const id = s?.methodId || s?.id || s;
      return id && !liveMethodIds.has(id);
    });

    if (unknownSignals.length > 0) {
      errors.push(`Reported evaluation of ${unknownSignals.length} unknown/invalid signals`);
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
  const timeMs = result.computationTimeMs || 0;
  if (signalsEvaluated > 20 && timeMs < 300) {
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
