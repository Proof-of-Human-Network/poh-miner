/**
 * Main POH Adapter for the Miner Network
 * Delegates to the real implementation when available.
 */

import { computeWithRealPoh } from './adapters/real-poh.js';

export async function computeVerdictWithExistingPoh(job, config) {
  return computeWithRealPoh(job, config);
}
