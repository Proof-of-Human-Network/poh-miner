#!/usr/bin/env node
/**
 * Demo: Multiple DAI miners racing on the same scan request.
 *
 * Run several instances of this (or the real miner-node) to see
 * first-come-first-serve in action.
 */

import { DAIMinerNode } from '../src/miner-node.js';

async function runDemoMiner(name, delayMs) {
  const node = new DAIMinerNode({
    wallet: `miner-${name}`,
    computeEnabled: true,
  });

  await node.start();

  // Simulate different compute speeds between miners
  const originalCompute = node.computeAndSubmit.bind(node);
  node.computeAndSubmit = async (req) => {
    await new Promise(r => setTimeout(r, delayMs));
    return originalCompute(req);
  };

  return node;
}

async function main() {
  console.log('=== DAI Miner Network - First Come First Serve Demo ===\n');

  const minerA = await runDemoMiner('Fast', 600);
  const minerB = await runDemoMiner('Medium', 1400);
  const minerC = await runDemoMiner('Slow', 2400);

  // Inject one scan request
  const request = {
    address: 'bc1qtestminingaddress',
    requesterWallet: 'user-paying-for-scan',
    fee: 10_000_000, // 10 DAI
  };

  console.log('\n>>> Broadcasting scan request for bc1qtestminingaddress\n');

  // All miners hear it at the same time
  minerA.injectScanRequest(request);
  minerB.injectScanRequest(request);
  minerC.injectScanRequest(request);
}

main();
