#!/usr/bin/env node
/**
 * Demo: Geographic + Latency aware job competition
 *
 * Shows how a job from Georgia is much more attractive
 * to a miner in Georgia than to one in Singapore.
 */

import { PohMinerNode } from '../src/miner-node.js';
import { JobQueue } from '../src/jobs/job-queue.js';

async function main() {
  console.log('=== PoH Miner Network - Geographic Job Preference Demo ===\n');

  // Miner in Georgia
  const georgiaMiner = new PohMinerNode({
    wallet: 'georgia-miner-001',
    computeEnabled: true,
  });
  georgiaMiner.myLocation = { country: 'GE', countryName: 'Georgia' };

  // Miner in Singapore
  const singaporeMiner = new PohMinerNode({
    wallet: 'singapore-miner-007',
    computeEnabled: true,
  });
  singaporeMiner.myLocation = { country: 'SG', countryName: 'Singapore' };

  await georgiaMiner.start();
  await singaporeMiner.start();

  const jobQueue = new JobQueue();

  // A job originating from Georgia (real ISO country code)
  const georgiaJob = {
    id: 'scan-georgia-user-123',
    type: 'verdict',
    payload: { address: 'bc1qgeorgiauser' },
    fee: 25_000_000,           // 25 POH
    originCountry: 'GE',
    maxLatencyMs: 800,
  };

  console.log('\n>>> A user in Georgia just submitted a scan request (25 POH fee)\n');

  jobQueue.addJob(georgiaJob);

  // Both miners evaluate the same job
  const gInfo = { country: 'GE', currentLoad: 0.2 };
  const sInfo = { country: 'SG', currentLoad: 0.2 };

  const gScore = jobQueue.scoreJobForMiner(georgiaJob, gInfo);
  const sScore = jobQueue.scoreJobForMiner(georgiaJob, sInfo);

  console.log(`Georgia miner attractiveness score:   ${gScore}`);
  console.log(`Singapore miner attractiveness score: ${sScore}`);
  console.log('');

  if (gScore > sScore * 1.5) {
    console.log('→ Result: Georgia miner has massive advantage and will almost certainly win the race.');
    console.log('   This is the desired geographic / low-latency behavior.');
  }
}

main();
