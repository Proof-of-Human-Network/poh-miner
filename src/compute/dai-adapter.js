/**
 * Main DAI Adapter for the Miner Network
 * Delegates to the real implementation when available.
 */

import { computeWithRealDai } from './adapters/real-dai.js';

export async function computeVerdictWithExistingDai(job, config) {
  return computeWithRealDai(job, config);
}
