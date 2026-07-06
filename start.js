#!/usr/bin/env node
/**
 * PoH Miner Network - One file to start everything
 *
 * Usage:
 *   node start.js
 *   or after npm link / global install: poh-miner start
 */

console.log('\n====================================');
console.log('   PoH Miner Network');
console.log('   Serve compute → Earn POH');
console.log('====================================\n');

// Inference runs in-process via the QVAC SDK — no Ollama, no external server.
// The model is fetched lazily on first use; we best-effort pre-warm it here so
// the first job isn't slow and download errors surface at boot (non-fatal).
async function warmUpQvac(model) {
  console.log(`Preparing QVAC model (${model})...`);
  try {
    process.env.QVAC_DEFAULT_MODEL = model;
    const { getQvacModels } = await import('./src/compute/adapters/real-poh.js');
    const qvac = await getQvacModels();
    if (!qvac || !qvac.ENABLED) {
      console.log('   QVAC disabled (QVAC_DISABLED=1) — skipping warm-up.');
      return;
    }
    await qvac.getModelId(model);
    console.log('   ✓ QVAC model ready.\n');
  } catch (e) {
    console.warn(`   ⚠️  QVAC warm-up failed (will retry on first job): ${e.message}\n`);
  }
}

async function startProject() {
  const { PohMinerNode } = await import('./src/miner-node.js');
  const { loadConfig }   = await import('./src/config.js');

  const { config, path: configPath, source } = loadConfig();

  if (!config.wallet || config.wallet.includes('YOUR_')) {
    console.log('⚠️  Please edit your wallet address in:');
    console.log('   ' + configPath + '\n');
    console.log('Then run this command again.\n');
    process.exit(0);
  }

  const locationNote = source.includes('local') ? ' (local project config)' : '';
  console.log(`Using config: ${configPath}${locationNote}\n`);

  await warmUpQvac(config.model || 'qwen3-1.7b');

  const node = new PohMinerNode(config);
  await node.start();

  process.stdin.resume();
}

startProject().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
