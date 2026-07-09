/**
 * PoW mining worker thread. Grinds nonces off the main event loop so the node's
 * HTTP API / gossip stay responsive while mining (previously a single-threaded
 * hash loop starved every request at 100% CPU).
 *
 * Protocol:
 *   workerData: { block, difficulty, startNonce }
 *   → posts { found: true, nonce, attempts } when a valid nonce is found
 *   → posts { aborted: true } if the main thread sends 'abort'
 * The worker yields to its own event loop periodically so an 'abort' message
 * (e.g. a competing block arrived) can interrupt the grind.
 */

import { parentPort, workerData } from 'worker_threads';
import { blockHashOf } from './block-hash.js';

const YIELD_EVERY = 4000;
const { block, difficulty, startNonce = 0 } = workerData;
const prefix = '0'.repeat(difficulty);

let nonce = startNonce;
let attempts = 0;
let aborted = false;

parentPort.on('message', (m) => { if (m === 'abort') aborted = true; });

function grind() {
  const deadline = attempts + YIELD_EVERY;
  while (attempts < deadline) {
    if (aborted) { parentPort.postMessage({ aborted: true }); return; }
    block.nonce = nonce;
    if (blockHashOf(block).startsWith(prefix)) {
      parentPort.postMessage({ found: true, nonce, attempts });
      return;
    }
    nonce++;
    attempts++;
  }
  // Yield so a queued 'abort' message can be delivered, then continue.
  setImmediate(grind);
}

grind();
