#!/usr/bin/env node
/**
 * Start a small local PoH Miner Network simulation
 * 
 * Spins up 3 miners in different "regions" and injects jobs.
 * Great for testing the geo + job queue system locally.
 */

import { PohMinerNode } from '../src/miner-node.js';
import { JobQueue } from '../src/jobs/job-queue.js';

console.log('\n🌍 Starting Local PoH Miner Network Simulation\n');

const jobQueue = new JobQueue();

// Create miners in different regions
const miners = [
  new PohMinerNode({ wallet: 'miner-georgia', computeEnabled: true }),
  new PohMinerNode({ wallet: 'miner-singapore', computeEnabled: true }),
  new PohMinerNode({ wallet: 'miner-europe', computeEnabled: true }),
];

// Assign real countries
miners[0].myLocation = { country: 'GE', countryName: 'Georgia' };
miners[1].myLocation = { country: 'SG', countryName: 'Singapore' };
miners[2].myLocation = { country: 'DE', countryName: 'Germany' };

for (const m of miners) {
  m.jobQueue = jobQueue; // share the queue for demo
  m.start().then(() => {
    console.log(`  ✓ ${m.config.wallet} online in ${m.myLatencyProfile.region}`);
  });
}

// Simulate incoming jobs with different origins
setTimeout(() => {
  console.log('\n📨 New job from Georgia user...');
  jobQueue.addJob({
    id: 'job-georgia-1',
    type: 'verdict',
    payload: { address: 'bc1qgeorgiauser' },
    fee: 22000000,
    originCountry: 'GE'
  });
}, 3000);

setTimeout(() => {
  console.log('\n📨 New job from Singapore user...');
  jobQueue.addJob({
    id: 'job-singapore-1',
    type: 'verdict',
    payload: { address: 'bc1qsingaporeuser' },
    fee: 18000000,
    originCountry: 'SG'
  });
}, 8000);

setTimeout(() => {
  console.log('\n✅ Simulation running. Press Ctrl+C to stop.\n');
}, 12000);

process.stdin.resume();
