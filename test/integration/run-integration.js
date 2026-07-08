#!/usr/bin/env node
/**
 * Integration test runner for PoH Miner (full system with real checker).
 *
 * Extensive tests covering all requested areas:
 * 1. Assert on realPohUsed (after propagating the field)
 * 2. Multiple miners racing on jobs
 * 3. Reputation / slashing behavior on bad results
 * 4. Low-quality result rejection test
 *
 * Run with:
 *   yarn test:integration
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

console.log('\n🧪 PoH Miner Integration Test Runner (Full)\n');

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1';

if (!RUN_INTEGRATION) {
  console.log('Skipping integration tests (set RUN_INTEGRATION=1 to run).\n');
  process.exit(0);
}

const checkerPath = path.resolve(ROOT, '../../dev/src/routes/checker.js');
if (!fs.existsSync(checkerPath)) {
  console.log('⚠️  Real POH checker not found at ../dev/src/routes/checker.js');
  console.log('   Skipping full integration tests.\n');
  process.exit(0);
}

console.log('✅ Real POH checker detected.');
console.log('   Running extensive integration tests with real checker...\n');

const { PohMinerNode } = await import('../../src/miner-node.js');
const { JobQueue } = await import('../../src/jobs/job-queue.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitFor(predicate, timeoutMs = 45000, interval = 400) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await sleep(interval);
  }
  return false;
}

async function runTests() {
  const jobQueue = new JobQueue();

  // === Start 3 miners in different regions for racing + bad result tests ===
  const miners = [
    new PohMinerNode({ wallet: 'int-miner-us',   computeEnabled: true, inferenceMode: 'cpu' }),
    new PohMinerNode({ wallet: 'int-miner-eu',   computeEnabled: true, inferenceMode: 'cpu' }),
    new PohMinerNode({ wallet: 'int-miner-asia', computeEnabled: true, inferenceMode: 'cpu' }),
  ];

  miners[0].myLocation = { country: 'US' };
  miners[1].myLocation = { country: 'DE' };
  miners[2].myLocation = { country: 'SG' };

  for (const m of miners) {
    m.jobQueue = jobQueue;
    await m.start();
  }
  console.log('Started 3 test miners (US, EU, Asia).\n');

  // === Test 1 & 2: Real computation (realPohUsed) + multiple miners racing ===
  console.log('Test: Real computation + racing...');
  const raceJob = jobQueue.addJob({
    id: 'int-race-1',
    type: 'verdict',
    payload: { address: 'bc1qracejob' },
    fee: 50000000,
    originCountry: 'US',
  });

  // 120s: the first verdict pays QVAC's cold model load (~30s into RAM) on top
  // of the multi-signal evaluation itself.
  const gotRealResult = await waitFor(() => {
    return miners.some(m => (m.submissionHistory || []).some(r =>
      r.requestId === raceJob.id && r.realPohUsed === true
    ));
  }, 120000);

  assert(gotRealResult, 'At least one miner produced a result with realPohUsed === true');

  const anyRealInHistory = miners.some(m =>
    (m.submissionHistory || []).some(r => r.realPohUsed === true)
  );
  assert(anyRealInHistory, 'Real POH computation results appeared in submissionHistory');

  // === Test 3 & 4: Bad result rejection + reputation slashing ===
  console.log('\nTest: Low-quality result rejection and reputation impact...');

  const badJob = jobQueue.addJob({
    id: 'int-bad-1',
    type: 'verdict',
    payload: { address: 'bc1qbadjob' },
    fee: 40000000,
    originCountry: 'DE',
  });

  // Temporarily make one miner return garbage (simulate lazy/malicious)
  const badMiner = miners[1];
  const originalCompute = badMiner.computeAndSubmitJob.bind(badMiner);

  badMiner.computeAndSubmitJob = async function (job) {
    if (job.id === badJob.id) {
      // Inject a deliberately bad result (wrong hash + very few signals)
      const fakeResult = {
        requestId: job.id,
        address: job.payload?.address,
        verdict: 'HUMAN',
        confidence: 0.99,
        reasoning: 'short',
        signalsUsed: ['fake-signal-1'],
        methodsHash: 'wrong-hash-xxx',
        methodsCount: 1,
        realPohUsed: true,
      };
      await this.submitResult(job, fakeResult);
      this.jobQueue.markCompleted(job.id);
      return;
    }
    return originalCompute(job);
  };

  const initialRep = badMiner.reputation;

  const badProcessed = await waitFor(() => {
    const hist = badMiner.submissionHistory || [];
    return hist.some(r => r.requestId === badJob.id && r.isValid === false);
  }, 30000);

  assert(badProcessed, 'Bad result was recorded as invalid (isValid === false)');

  const finalRep = badMiner.reputation;
  assert(finalRep < initialRep, `Reputation was slashed (was ${initialRep.toFixed(2)}, now ${finalRep.toFixed(2)})`);

  const badInValidQueue = (badMiner.pendingValidResults || []).some(r => r.requestId === badJob.id);
  assert(!badInValidQueue, 'Bad result was correctly rejected from valid results queue');

  // Cleanup override
  badMiner.computeAndSubmitJob = originalCompute;

  // Final block check
  const anyBlockWithValidRealWork = miners.some(m =>
    m.chain?.some(block =>
      Array.isArray(block.scanResults) &&
      block.scanResults.some(r => r.isValidWork === true && r.realPohUsed === true)
    )
  );
  assert(anyBlockWithValidRealWork, 'At least one block contains a realPohUsed + isValidWork result');

  // Cleanup
  for (const m of miners) {
    if (typeof m.stop === 'function') await m.stop();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('❌ Integration tests failed.\n');
    process.exit(1);
  } else {
    console.log('✅ All integration assertions passed.\n');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Integration test runner crashed:', err);
  process.exit(1);
});
