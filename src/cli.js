#!/usr/bin/env node
/**
 * PoH Miner - Simple CLI for normal users
 *
 * Goal: Make it feel like a normal app, not a dev project.
 * Especially friendly for Mac Mini users and non-miners.
 */

import { PohMinerNode } from './miner-node.js';
import {
  loadConfig as loadConfigFromResolver,
  getConfigLocationInfo,
  saveConfig,
  getDefaultConfig,
  resolveConfigPath,
} from './config.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Legacy wrapper for commands that still expect a plain object.
 * New code should prefer loadConfigFromResolver() which returns {config, path, source}.
 */
function loadConfig() {
  const info = getConfigLocationInfo();
  if (!info.exists) {
    console.error('Config not found. Run "poh-miner init" or create a config file.');
    console.error('Checked:', info.path);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(info.path, 'utf8'));
}

/** Returns the resolved config path + metadata (used by multiple commands) */
function getConfigInfo() {
  return getConfigLocationInfo();
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'start';

  console.log('\n🚀 PoH Miner Network\n');

  if (cmd === 'start' || cmd === 'run') {
    const { config, path: configPath, source } = loadConfigFromResolver();

    if (config.wallet?.includes('YOUR_') || !config.wallet) {
      console.error('❌ Please set your real Solana wallet address in the config first:');
      console.error('   ' + configPath);
      console.log('   Run: poh-miner init   (recommended)');
      console.log('   Or set "wallet" directly in that file.');
      process.exit(1);
    }

    const locationNote = source.includes('local') ? ' (local project)' : '';
    console.log(`Config: ${configPath}${locationNote}\n`);

    const node = new PohMinerNode(config);
    try {
      await node.start();
    } catch (e) {
      if (e?.code === 'MINER_LOCK_CONFLICT') {
        console.error(`❌ ${e.message}`);
        process.exit(1);
      }
      throw e;
    }

    // Keep process alive
    process.stdin.resume();
  } 
  else if (cmd === 'init') {
    // Use the same smart resolution as everything else.
    // By default we create in the best location (local .poh-miner/ when inside source tree).
    const { path: targetPath, source } = resolveConfigPath({ allowCreate: true });

    // Allow forcing global even when in source tree: poh-miner init --global
    const forceGlobal = args.includes('--global') || args.includes('-g');
    let finalPath = targetPath;

    if (forceGlobal) {
      const home = os.homedir();
      finalPath = path.join(home, '.poh-miner', 'config.json');
    }

    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Only write if file does not already exist (init should be idempotent-ish)
    if (fs.existsSync(finalPath)) {
      console.log('Config already exists at:', finalPath);
      console.log('Use "poh-miner set-mode ..." or edit it manually.');
      return;
    }

    const defaultConfig = getDefaultConfig();
    // Add a couple of extra fields that the old init used to include
    defaultConfig.region = 'auto';

    saveConfig(defaultConfig, finalPath);

    const homeForMsg = os.homedir();
    const locationType = finalPath.includes('.poh-miner') && !finalPath.startsWith(homeForMsg)
      ? 'local project config'
      : forceGlobal ? 'global user config (forced)' : 'config';

    console.log(`✅ Created ${locationType} at:`, finalPath);
    console.log('   Edit it and replace YOUR_SOLANA_ADDRESS_HERE with your wallet.');
    console.log('   Add your bootnodes under the "bootnodes" array to sync with the real network.');
  } 
  else if (cmd === 'demo' || cmd === 'demo:geo') {
    console.log('Starting geographic preference demo...\n');
    const { execSync } = await import('child_process');
    execSync('node scripts/demo-geo-race.js', { stdio: 'inherit' });
  } 
  else if (cmd === 'landing' || cmd === 'serve') {
    console.log('Serving landing page at http://localhost:4321\n');
    const http = await import('http');
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const landingPath = path.resolve(__dirname, '../landing/index.html');

    http.createServer((req, res) => {
      fs.createReadStream(landingPath).pipe(res);
    }).listen(4321, () => {
      console.log('🌍 Open: http://localhost:4321');
    });
  } 
  else if (cmd === 'config') {
    const info = getConfigInfo();
    console.log('Config location:', info.path);
    console.log('Source / resolution:', info.source);
    console.log('Exists:', info.exists ? 'yes' : 'no');
    if (info.exists) {
      try {
        const cfg = JSON.parse(fs.readFileSync(info.path, 'utf8'));
        console.log('Bootnodes configured:', Array.isArray(cfg.bootnodes) ? cfg.bootnodes.length : 0);
      } catch {}
    }
  } 
  else if (cmd === 'set-mode') {
    const newMode = args[1];
    if (!['auto', 'gpu', 'cpu'].includes(newMode)) {
      console.error('Usage: poh-miner set-mode <auto|gpu|cpu>');
      process.exit(1);
    }

    const info = getConfigInfo();
    const targetPath = info.path;

    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let currentConfig = {};
    if (info.exists) {
      currentConfig = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    } else {
      currentConfig = getDefaultConfig();
    }

    currentConfig.inferenceMode = newMode;
    saveConfig(currentConfig, targetPath);

    console.log(`✅ inferenceMode set to "${newMode}" in ${targetPath}`);
    console.log('Restart the miner for the change to take effect.');
  } 
  else if (cmd === 'sync-methods' || cmd === 'sync-signals') {
    console.log('Syncing verified signals from the network...\n');
    (async () => {
      const { getMethodsManager } = await import('./signals/methods-manager.js');
      const mgr = await getMethodsManager();
      const before = mgr.getStatus();
      console.log(`Before: ${before.count} methods (hash=${before.hash})`);

      const result = await mgr.sync();
      const after = mgr.getStatus();

      console.log(`\n✅ Synced. Now using ${after.count} methods`);
      console.log(`   Hash: ${after.hash}`);
      console.log(`   Source: ${after.source}`);
      console.log(`   Age: ${after.ageMinutes ?? '?'} minutes`);
    })();
  } 
  else if (cmd === 'wallet') {
    const sub = args[1] || 'list';
    (async () => {
      const { WalletManager } = await import('./wallet/wallet.js');
      const wm = new WalletManager();

      if (sub === 'create' || sub === 'new') {
        const wallet = wm.createWallet();
        console.log('✅ New wallet created:');
        console.log(`   Address:    ${wallet.address}`);
        console.log(`   Private Key: ${wallet.privateKey}`);
        console.log(`   (Save the private key securely — it cannot be recovered!)`);
      } 
      else if (sub === 'list') {
        const wallets = wm.listWallets();
        if (wallets.length === 0) {
          console.log('No wallets found. Create one with: poh-miner wallet create');
        } else {
          console.log('Wallets:');
          wallets.forEach(w => {
            const balance = wm.getBalance(w);
            console.log(`  ${w} — Balance: ${balance}`);
          });
        }
      } 
      else if (sub === 'balance') {
        const addr = args[2];
        if (!addr) {
          console.error('Usage: poh-miner wallet balance <address>');
          return;
        }
        const bal = wm.getBalance(addr);
        console.log(`Balance for ${addr}: ${bal} POH`);
      } 
      else if (sub === 'send') {
        const [from, to, amt] = args.slice(2);
        if (!from || !to || !amt) {
          console.error('Usage: poh-miner wallet send <fromAddress> <toAddress> <amount>');
          return;
        }
        const success = wm.transfer(from, to, parseInt(amt));
        console.log(success ? '✅ Transfer successful' : '❌ Transfer failed (insufficient balance or invalid address)');
      } 
      else {
        console.log('Wallet subcommands: create, list, balance <addr>, send <from> <to> <amount>');
      }
    })();
  } 
  else if (cmd === 'bootnode') {
    console.log('Starting as PoH Bootnode...\n');
    (async () => {
      const { default: bootnode } = await import('./bootnode.js');
      // The bootnode.js has its own server when run directly
      // For CLI we can just exec it or import the server logic
      console.log('Use: node src/bootnode.js --port 8080 --data-dir ~/.poh-bootnode');
      console.log('Or run directly for now.');
    })();
  } 
  else if (cmd === 'status') {
    console.log('Fetching miner protection & status...\n');
    (async () => {
      try {
        const { PohMinerNode } = await import('./miner-node.js');
        // Minimal node just to read persisted state
        const node = new PohMinerNode({ wallet: 'status-check' });
        const status = node.getStatus();

        console.log('=== PoH Miner Protection Status ===');
        console.log(`Reputation:            ${status.reputation?.toFixed(2) ?? '1.00'} (reward multiplier: ${status.rewardMultiplier ?? '1.00'})`);
        console.log(`Strikes:               ${status.quality?.strikes ?? 0}`);
        console.log(`Temporarily restricted: ${status.isTemporarilyRestricted ? 'YES' : 'no'}`);
        console.log(`Valid submissions:     ${status.quality?.validSubmissions ?? 0}`);
        console.log(`Invalid submissions:   ${status.quality?.invalidSubmissions ?? 0}`);
        console.log(`Recent history size:   ${node.submissionHistory?.length ?? 0}`);

        // Show last few bad submissions if any
        const recentBad = (node.submissionHistory || []).filter(s => !s.isValid).slice(-5);
        if (recentBad.length > 0) {
          console.log('\nLast bad submissions:');
          recentBad.forEach(b => {
            const ageMin = Math.round((Date.now() - b.timestamp) / 60000);
            console.log(`  - ${ageMin} min ago | ${b.signalsEvaluated}/${b.liveCount} signals`);
          });
        }

        console.log(`Current signals:       ${status.methodsCount} (hash: ${status.methodsHash})`);
        console.log(`Chain height:          ${status.chainHeight}`);
      } catch (e) {
        console.error('Could not load status:', e.message);
      }
    })();
  }
  else if (cmd === 'help' || cmd === '--help') {
    console.log(`Usage:
  poh-miner start              Start the miner node
  poh-miner bootnode           Start a dedicated bootnode (see src/bootnode.js)
  poh-miner wallet <subcmd>    Wallet commands: create | list | balance <addr> | send <from> <to> <amt>
  poh-miner init [--global]    Create default config (local by default when in source tree)
  poh-miner status             Show protection stats, reputation, and submission history
  poh-miner sync-methods       Force refresh of verified signals from proofofhuman.ge
  poh-miner set-mode <mode>    Change inference mode (auto|gpu|cpu)
  poh-miner demo               Run geographic job preference demo
  poh-miner landing            Serve the promotional landing page
  poh-miner config             Show resolved config location and source
`);
  } 
  else {
    console.log('Unknown command. Try: poh-miner help');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
