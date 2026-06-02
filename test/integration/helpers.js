/**
 * Integration test helpers for PoH Miner Network.
 * These helpers are designed to spin up real miner instances
 * that use the actual POH checker/brain.
 */

import { PohMinerNode } from '../../src/miner-node.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Checks if the real POH dev environment is available.
 * This is required for "full miner with checker" tests.
 */
export function hasRealPohChecker() {
  try {
    // The real-poh adapter tries to load from here
    const devPath = path.resolve(__dirname, '../../../../dev/src/routes/checker.js');
    return fs.existsSync(devPath);
  } catch {
    return false;
  }
}

/**
 * Starts a test miner node configured for real computation.
 * 
 * @param {object} options
 * @param {string} options.wallet - Wallet address to use
 * @param {string} [options.inferenceMode='auto']
 * @param {boolean} [options.computeEnabled=true]
 */
export async function startTestMiner(options = {}) {
  const {
    wallet = `test-miner-${Date.now()}`,
    inferenceMode = 'auto',
    computeEnabled = true,
    ...extraConfig
  } = options;

  const miner = new PohMinerNode({
    wallet,
    computeEnabled,
    inferenceMode,
    // Force use of real POH path when possible
    ...extraConfig,
  });

  // Start the miner (this will try to load real checker)
  await miner.start();

  return miner;
}

/**
 * Stops a miner cleanly.
 */
export async function stopTestMiner(miner) {
  if (miner && typeof miner.stop === 'function') {
    await miner.stop();
  }
}

/**
 * Submits a test job directly into a miner's job queue.
 * Useful for controlled integration testing.
 */
export function submitTestJob(miner, jobData) {
  if (!miner.jobQueue) {
    throw new Error('Miner does not have a jobQueue attached');
  }

  return miner.jobQueue.addJob({
    id: `test-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'verdict',
    fee: 10000000,
    originCountry: 'US',
    payload: {
      address: 'bc1qtestaddressforintegration',
    },
    ...jobData,
  });
}

/**
 * Waits for a miner to produce at least one block.
 */
export function waitForBlock(miner, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (miner.chain && miner.chain.length > 0) {
        clearInterval(interval);
        resolve(miner.chain[miner.chain.length - 1]);
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('Timed out waiting for block production'));
      }
    }, 200);
  });
}

/**
 * Waits until a miner has processed at least one real (non-simulated) result.
 */
export function waitForRealResult(miner, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      // Look in submissionHistory or recent activity for realPohUsed === true
      const history = miner.submissionHistory || [];
      const realResult = history.find(r => r.realPohUsed === true);

      if (realResult) {
        clearInterval(interval);
        resolve(realResult);
      }

      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('Timed out waiting for real POH computation result'));
      }
    }, 300);
  });
}
