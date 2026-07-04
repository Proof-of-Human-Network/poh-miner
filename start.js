#!/usr/bin/env node
/**
 * PoH Miner Network - One file to start everything
 *
 * Usage:
 *   node start.js
 *   or after npm link / global install: poh-miner start
 */

import { execSync, spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const http    = require('http');

console.log('\n====================================');
console.log('   PoH Miner Network');
console.log('   Serve compute → Earn POH');
console.log('====================================\n');

const DEFAULT_MODEL  = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';
const OLLAMA_URL     = process.env.OLLAMA_URL   || 'http://127.0.0.1:11434';
const OLLAMA_PORT    = parseInt(new URL(OLLAMA_URL).port || '11434', 10);
// Ollama binds IPv4 only on many Linux installs — "localhost" → ::1 causes false negatives.
const OLLAMA_HOST    = (() => {
  try {
    const h = new URL(OLLAMA_URL).hostname || '127.0.0.1';
    return h === 'localhost' ? '127.0.0.1' : h;
  } catch { return '127.0.0.1'; }
})();

function ollamaRunning() {
  return new Promise(resolve => {
    const req = http.request({ hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/tags', method: 'GET', timeout: 3000 }, res => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function ollamaModels() {
  return new Promise(resolve => {
    const req = http.request({ hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/tags', method: 'GET', timeout: 5000 }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve((JSON.parse(buf).models || []).map(m => m.name || m.model || '')); }
        catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

function hasModel(models, target) {
  const base = target.split(':')[0];
  return models.some(m => m === target || m.startsWith(base + ':'));
}

function ollamaInPath() {
  try { execSync('which ollama', { stdio: 'ignore' }); return true; } catch { return false; }
}

function startOllamaService() {
  return new Promise(resolve => {
    const proc = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', env: process.env });
    proc.unref();
    console.log('   Waiting for Ollama to start...');
    setTimeout(resolve, 3000);
  });
}

function pullModel(model) {
  return new Promise((resolve, reject) => {
    console.log(`   Pulling ${model} — this may take a few minutes on first run...`);
    const req = http.request(
      { hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/pull', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      res => {
        let buf = '';
        let lastPct = -1;
        res.on('data', chunk => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line);
              if (evt.total && evt.completed) {
                const pct = Math.round((evt.completed / evt.total) * 100);
                if (pct !== lastPct && pct % 10 === 0) { process.stdout.write(`\r   ${model}: ${pct}%`); lastPct = pct; }
              } else if (evt.status && evt.status !== 'pulling manifest') {
                process.stdout.write(`\r   ${evt.status}                    `);
              }
            } catch {}
          }
        });
        res.on('end', () => { console.log(`\r   ✓ ${model} ready.           `); resolve(); });
      }
    );
    req.on('error', reject);
    req.write(JSON.stringify({ name: model, stream: true }));
    req.end();
  });
}

async function ensureOllama() {
  console.log('Checking Ollama...');

  // 1. Install if missing
  if (!ollamaInPath()) {
    const platform = process.platform;
    if (platform === 'linux' || platform === 'darwin') {
      console.log('   Ollama not found — installing (requires sudo on some systems)...');
      try {
        execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit' });
        console.log('   ✓ Ollama installed.');
      } catch (e) {
        console.error('   ✗ Ollama install failed:', e.message);
        console.error('   Please install manually: https://ollama.com/download');
        process.exit(1);
      }
    } else {
      console.error('   ✗ Ollama not found. Download from https://ollama.com/download and re-run.');
      process.exit(1);
    }
  }

  // 2. Start service if not running
  if (!await ollamaRunning()) {
    console.log('   Ollama not running — starting service...');
    await startOllamaService();
    if (!await ollamaRunning()) {
      console.error('   ✗ Ollama did not start. Try running "ollama serve" in another terminal.');
      process.exit(1);
    }
    console.log('   ✓ Ollama running.');
  } else {
    console.log('   ✓ Ollama running.');
  }

  // 3. Pull model if missing
  const models = await ollamaModels();
  if (!hasModel(models, DEFAULT_MODEL)) {
    console.log(`   Model ${DEFAULT_MODEL} not found locally.`);
    // `ollama pull` resumes partial blobs across runs, so on a flaky connection
    // we retry until the model actually shows up in /api/tags.
    const maxAttempts = 12;
    let pulled = false;
    for (let i = 1; i <= maxAttempts; i++) {
      try {
        await pullModel(DEFAULT_MODEL);
      } catch (e) {
        console.error(`   Pull attempt ${i} failed: ${e.message}`);
      }
      if (hasModel(await ollamaModels(), DEFAULT_MODEL)) { pulled = true; break; }
      if (i < maxAttempts) {
        console.log(`   Download interrupted — retrying (resumes where it left off) [${i}/${maxAttempts}]...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!pulled) {
      console.error(`   ✗ Failed to pull ${DEFAULT_MODEL} after ${maxAttempts} attempts. Check your connection and re-run.`);
      process.exit(1);
    }
  } else {
    console.log(`   ✓ Model ${DEFAULT_MODEL} available.`);
  }

  console.log('');
}

async function startProject() {
  await ensureOllama();

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

  const node = new PohMinerNode(config);
  await node.start();

  process.stdin.resume();
}

startProject().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
