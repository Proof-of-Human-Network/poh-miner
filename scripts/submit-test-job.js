#!/usr/bin/env node
/**
 * Helper to submit a test job with a specific origin region.
 * Useful for testing geographic preference.
 *
 * Usage:
 *   node scripts/submit-test-job.js georgia
 *   node scripts/submit-test-job.js singapore
 */

const region = process.argv[2] || 'georgia';

const job = {
  id: `test-${Date.now()}`,
  type: 'verdict',
  payload: { address: 'bc1qtestaddress' },
  fee: 15_000_000,
  originRegion: region,
  createdAt: Date.now()
};

console.log('Submitting test job with origin:', region);
console.log(JSON.stringify(job, null, 2));
console.log('\nIn a real network this would be gossiped to all miners.');
console.log('\nFor actually running the checker, use:');
console.log('  node scripts/send-test-checker-job.js [optional-address]');
