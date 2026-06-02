#!/usr/bin/env node
/**
 * PoH Miner Network - One file to start everything
 * 
 * This is the easiest entry point for new users.
 * 
 * Usage:
 *   node start.js
 *   or after npm link / global install: poh-miner start
 */

import { PohMinerNode } from './src/miner-node.js';
import { loadConfig } from './src/config.js';

console.log('\n====================================');
console.log('   PoH Miner Network');
console.log('   Serve compute → Earn POH');
console.log('====================================\n');

async function startProject() {
  const { config, path: configPath, source } = loadConfig();

  if (!config.wallet || config.wallet.includes('YOUR_')) {
    console.log('\n⚠️  Please edit your wallet address in:');
    console.log('   ' + configPath + '\n');
    console.log('Then run this command again.\n');
    process.exit(0);
  }

  const locationNote = source.includes('local') ? ' (local project config)' : '';
  console.log(`Using config: ${configPath}${locationNote}\n`);

  const node = new PohMinerNode(config);
  await node.start();

  // Keep alive
  process.stdin.resume();
}

startProject().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
