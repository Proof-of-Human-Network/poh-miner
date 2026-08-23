#!/usr/bin/env node
/**
 * DAI Miner Network - One file to start everything
 *
 * Usage:
 *   node start.js
 *   or after npm link / global install: dai-miner start
 */

console.log('\n====================================');
console.log('   DAI Miner Network');
console.log('   Serve compute → Earn DAI');
console.log('====================================\n');

// Inference runs in-process via the QVAC SDK — no Ollama, no external server.
// The model is fetched lazily on first use; we best-effort pre-warm it here so
// the first job isn't slow and download errors surface at boot (non-fatal).
// QVAC's llama.cpp backend links libvulkan.so.1. On GPU-less Linux hosts (e.g. a
// headless VPS) it is often missing and QVAC aborts at load. Best-effort ensure
// the Vulkan runtime is present before warming up — no-op when already installed
// or on non-Linux. Never fatal.
async function ensureVulkanRuntime() {
  if (process.platform !== 'linux') return;
  try {
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const { spawnSync } = await import('node:child_process');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const script = path.join(here, 'scripts', 'ensure-vulkan.sh');
    spawnSync('bash', [script], { stdio: 'inherit' });
  } catch (e) {
    console.warn(`   ⚠️  Vulkan runtime check failed (QVAC may need libvulkan.so.1): ${e.message}`);
  }
}

async function warmUpQvac(model, apiPort = 3456) {
  console.log(`Preparing QVAC model (${model})...`);
  try {
    await ensureVulkanRuntime();
    process.env.QVAC_DEFAULT_MODEL = model;
    const { getQvacModels } = await import('./src/compute/adapters/real-dai.js');
    const qvac = await getQvacModels();
    if (!qvac || !qvac.ENABLED) {
      console.log('   QVAC disabled (QVAC_DISABLED=1) — skipping warm-up.');
      return;
    }
    await qvac.getModelId(model);
    console.log('   ✓ QVAC model ready.\n');
  } catch (e) {
    // Non-fatal: the node keeps running without the model. Print the manual
    // recovery path — the lazy first-job retry has a short timeout, so a big
    // download realistically only succeeds via this endpoint or a restart.
    console.warn(`   ⚠️  QVAC model download/warm-up failed: ${e.message}`);
    console.warn('   The node keeps running. To download the model manually once connectivity is back:');
    console.warn(`     curl -X POST http://localhost:${apiPort}/api/models/download -H "Content-Type: application/json" -d "{\\"model\\":\\"${model}\\"}"`);
    console.warn(`     curl http://localhost:${apiPort}/api/models/status        # watch progress`);
    console.warn('   (or use the desktop app: Settings → Mining AI model → Download)\n');
  }
}

// First-run model picker: ask which LLM to download, with three options graded
// relative to the detected hardware (a "large" model on an 8 GB laptop differs
// from "large" on a 128 GB workstation). No-op once chosen or without a TTY.
async function chooseModelFirstRun(config, configPath) {
  if (config.modelSelected || !process.stdin.isTTY) return config.model || 'qwen3-1.7b';
  try {
    const readline = await import('node:readline');
    const { saveConfig } = await import('./src/config.js');
    const { getModelOptions, describeHardware } = await import('./src/setup/model-picker.js');
    const opts = getModelOptions();

    // Unique models, smallest → largest (tiers can collapse on small machines).
    const ordered = [opts.small, opts.medium, opts.large];
    const choices = [];
    const seen = new Set();
    for (const t of ordered) { if (!seen.has(t.name)) { seen.add(t.name); choices.push(t); } }
    const recIdx = Math.max(0, choices.findIndex(c => c.name === opts.recommended));

    console.log('\nWhich AI model should the miner download and run?');
    console.log('  Detected: ' + describeHardware(opts.hardware) + '\n');
    choices.forEach((c, i) => {
      const rec = i === recIdx ? '  ← recommended' : '';
      console.log(`  ${i + 1}) ${c.tier.toUpperCase().padEnd(6)} ${c.label.padEnd(12)} ~${c.approxDownloadGB} GB${rec}`);
      console.log(`       ${c.blurb}`);
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => rl.question(`\nSelect 1-${choices.length} [default ${recIdx + 1}]: `, r));
    rl.close();
    const pick = parseInt(answer.trim(), 10);
    const chosen = (pick >= 1 && pick <= choices.length) ? choices[pick - 1] : choices[recIdx];

    config.model = chosen.name;
    config.modelSelected = true;
    try { saveConfig(config, configPath); } catch { /* non-fatal */ }
    console.log(`\n✓ Using ${chosen.label} (${chosen.name}). Change it later in config.json ("model") or Settings.\n`);
    return chosen.name;
  } catch (e) {
    console.warn(`   ⚠️  Model picker skipped (${e.message}); using ${config.model || 'qwen3-1.7b'}.`);
    return config.model || 'qwen3-1.7b';
  }
}

async function startProject() {
  const { DAIMinerNode } = await import('./src/miner-node.js');
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

  const chosenModel = await chooseModelFirstRun(config, configPath);
  await warmUpQvac(chosenModel || config.model || 'qwen3-1.7b', config.walletApiPort || 3456);

  // Persist runtime-resolved fields (e.g. an auto-created wallet) back to the SAME
  // file we loaded — not a hardcoded ~/.dai-miner/config.json, which may be a
  // different file when running from a source tree (cwd/config.json wins). Writing
  // to the wrong file was silently re-minting a new mining wallet on every restart.
  config._configPath = configPath;

  const node = new DAIMinerNode(config);
  await node.start();

  process.stdin.resume();
}

startProject().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
