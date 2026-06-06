const { app, BrowserWindow, ipcMain, Menu, globalShortcut } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

// Ubuntu 24.04+ tightens kernel user-namespace restrictions which breaks
// Electron's Zygote sandbox (CLONE_NEWUSER fails with EINVAL).
// Disabling the sandbox is safe for a local desktop app — there is no
// untrusted web content being rendered.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-setuid-sandbox');

let mainWindow;
let minerNode = null;
let isStartingMiner = false;
const logs = [];

function sendLog(message) {
  logs.push(message);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'PoH Miner',
  });

  // Also remove the window menu on Windows/Linux
  if (process.platform !== 'darwin') {
    mainWindow.setMenu(null);
  }

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Enable right-click "Inspect Element" (very useful during development)
  mainWindow.webContents.on('context-menu', (e, params) => {
    const { Menu, MenuItem } = require('electron');
    const menu = new Menu();

    menu.append(new MenuItem({
      label: 'Inspect Element',
      click: () => {
        mainWindow.webContents.inspectElement(params.x, params.y);
      }
    }));

    menu.popup({ window: mainWindow });
  });

  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const config = loadConfig();

      // Check wallet files on disk — existing wallets mean the user has already set up the miner.
      // Require onboarding ONLY for brand-new installs with no wallets at all.
      const { WalletManager } = await import(pathToFileURL(path.join(__dirname, '../src/wallet/wallet.js')).href);
      const _wm = new WalletManager();
      const existingWallets = _wm.listWallets();
      const hasPohWallet = !!(config.pohWallet || config.wallet || existingWallets.length > 0);

      // Auto-persist the wallet into config so startMiner() can read it
      if (!config.pohWallet && !config.wallet && existingWallets.length > 0) {
        const poh = existingWallets.find(w => w.startsWith('poh')) || existingWallets[0];
        saveConfig({ pohWallet: poh, wallet: poh });
        config.pohWallet = poh;
        config.wallet    = poh;
      }

      const isOnboarded = !!(config.onboarded && hasPohWallet) || hasPohWallet;

      sendLog(`[Startup] onboarded=${!!config.onboarded}, hasPohWallet=${hasPohWallet} → isOnboarded=${isOnboarded}`);

      if (isOnboarded) {
        // Silently ensure Ollama is running before starting the miner
        isOllamaRunning().then(async (running) => {
          if (!running) {
            sendLog('[Setup] Ollama not running — attempting to start...');
            const inPath = await ollamaInPath();
            if (inPath) {
              await startOllamaService();
              sendLog('[Setup] Ollama service started.');
            } else {
              sendLog('[Setup] WARNING: Ollama not installed. Brain inference will fail. Run: curl -fsSL https://ollama.com/install.sh | sh');
            }
          }
        }).catch(() => {});

        startMiner();
        // Tell the renderer to show the main miner UI (authoritative from main process)
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('show-main-app');
          }
        }, 150);
      } else {
        sendLog('Waiting for onboarding to complete...');
        // Tell the renderer to show the onboarding wizard
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('enter-onboarding-mode');
          }
        }, 300);
      }
    } catch (e) {
      // Do NOT blindly start the miner here — it can cause double-starts and port conflicts.
      // Just log and let the renderer decide (it will usually show onboarding).
      sendLog('Error during startup check: ' + e.message);
      console.error('Startup check failed:', e);
    }
  });
}

async function startMiner() {
  // Prevent double-start (this is the main guard)
  // Also guard while an async start is in progress (prevents races during dynamic import etc.)
  if (minerNode || isStartingMiner) {
    sendLog('Miner is already running or starting — ignoring duplicate start request.');
    return;
  }
  isStartingMiner = true;

  try {
    sendLog('Starting PoH Miner Node...');

    const fs = require('fs');
    const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.poh-miner', 'config.json');

    let config = {};
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } else {
      sendLog('No config found at ~/.poh-miner/config.json');
    }

    // Dynamically import the ESM miner module
    const minerModule = await import(pathToFileURL(path.join(__dirname, '../src/miner-node.js')).href);
    const { PohMinerNode } = minerModule;

    minerNode = new PohMinerNode(config);

    // Capture logs
    const originalLog = console.log;
    const originalError = console.error;

    // Patterns that are noisy and add no value for the user
    const SUPPRESS = [
      /common_init_result:.*logit bias/,   // llama.cpp token-suppression internals
      /^\[PoW\] Mining block #\d+ attempt/, // PoW progress (only final result matters)
    ];
    const shouldSuppress = (msg) => SUPPRESS.some(re => re.test(msg));

    console.log = (...args) => {
      const msg = args.join(' ');
      if (!shouldSuppress(msg)) sendLog(msg);
      originalLog.apply(console, args);
    };

    console.error = (...args) => {
      const msg = '[ERROR] ' + args.join(' ');
      if (!shouldSuppress(msg)) sendLog(msg);
      originalError.apply(console, args);
    };

    const originalWarn = console.warn;
    console.warn = (...args) => {
      const msg = '[WARN] ' + args.join(' ');
      if (!shouldSuppress(msg)) sendLog(msg);
      originalWarn.apply(console, args);
    };

    await minerNode.start();
    sendLog('Miner started successfully.');

    // Send periodic status
    setInterval(() => {
      sendStatusUpdate();
    }, 2500);

    sendStatusUpdate();

  } catch (err) {
    sendLog('Failed to start miner: ' + err.message);
    console.error(err);
    // Reset so a future retry can work (e.g. after killing the conflicting process)
    minerNode = null;
  } finally {
    isStartingMiner = false;
  }
}

function sendStatusUpdate() {
  if (!minerNode || !mainWindow || mainWindow.isDestroyed()) return;

  try {
    const pohWallet = minerNode.config?.pohWallet || minerNode.config?.wallet;
    let pohBalance = 0;

    if (pohWallet && minerNode.walletManager) {
      pohBalance = minerNode.walletManager.getBalance(pohWallet);
    }

    const solanaAddress = minerNode.config?.solanaAddress || null;

    const status = {
      wallet: pohWallet,
      pohWallet: pohWallet,
      pohBalance: pohBalance,
      solanaAddress: solanaAddress,
      balance: pohBalance,
      chainHeight: minerNode.chain ? minerNode.chain.length - 1 : 0,
      reputation: minerNode.reputation || 1.0,
      qualityStats: minerNode.qualityStats || {},
      walletApiPort: minerNode.config?.walletApiPort || 3456,
      peers: (minerNode.peers || []).length,
      model: minerNode.config?.model || null,
      inferenceMode: minerNode.config?.inferenceMode || 'AUTO',
      region: minerNode.myLocation?.country || minerNode.config?.region || null,
    };

    mainWindow.webContents.send('status', status);
  } catch (e) {}
}

app.whenReady().then(() => {
  // Remove the default application menu (File, Edit, View, Window, Help, etc.)
  Menu.setApplicationMenu(null);

  // Register DevTools shortcut (works even without menu bar)
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.webContents.toggleDevTools();
    }
  });

  // Also allow F12 as alternative
  globalShortcut.register('F12', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.webContents.toggleDevTools();
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up shortcuts when quitting
app.on('will-quit', () => {
  globalShortcut.unregisterAll();

  // Gracefully close the Wallet API server so the port is released
  if (minerNode && minerNode.walletApiServer) {
    try {
      minerNode.walletApiServer.close(() => {
        sendLog('Wallet API server closed.');
      });
    } catch (e) {
      console.error('Error closing Wallet API server:', e);
    }
    minerNode.walletApiServer = null;
  }
});

ipcMain.handle('get-logs', () => logs.slice(-300));

ipcMain.handle('generate-qr', async (_event, text, size = 220) => {
  const QRCode = require('qrcode');
  return QRCode.toDataURL(text, { width: size, margin: 2, color: { dark: '#000', light: '#fff' } });
});
ipcMain.handle('get-status', () => {
  if (!minerNode) return null;

  const wallet = minerNode.config?.wallet;
  let balance = 0;
  if (wallet && minerNode.walletManager) {
    balance = minerNode.walletManager.getBalance(wallet);
  }

  console.log(balance)

  return {
    wallet,
    balance,
    chainHeight: minerNode.chain ? minerNode.chain.length - 1 : 0,
    reputation: minerNode.reputation || 1.0,
    qualityStats: minerNode.qualityStats || {},
  };
});

// =====================================================
// RPC Configuration IPC (for Settings UI)
// =====================================================

async function getRpcModule() {
  const { pathToFileURL } = require('url');
  const rpcModule = await import(pathToFileURL(path.join(__dirname, '../src/rpc/index.js')).href);
  return rpcModule;
}

ipcMain.handle('rpc:get-networks-grouped', async () => {
  const rpc = await getRpcModule();
  return rpc.getNetworksGrouped();
});

ipcMain.handle('rpc:get-providers-for-network', async (_event, networkId) => {
  const rpc = await getRpcModule();
  return rpc.getProvidersForNetwork(networkId);
});

ipcMain.handle('rpc:preview-url', async (_event, { networkId, providerId, apiKey }) => {
  const rpc = await getRpcModule();
  return rpc.previewRpcUrl(networkId, providerId, apiKey);
});

ipcMain.handle('rpc:get-current-config', async () => {
  const fs = require('fs');
  const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.poh-miner', 'config.json');
  if (!fs.existsSync(CONFIG_PATH)) return { rpc: {}, rpcOverrides: {} };
  const fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return {
    rpc: fullConfig.rpc || {},
    rpcOverrides: fullConfig.rpcOverrides || {},
  };
});

ipcMain.handle('rpc:save-network-config', async (_event, { networkId, provider, apiKey }) => {
  const fs = require('fs');
  const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.poh-miner', 'config.json');
  
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  if (!config.rpc) config.rpc = {};

  config.rpc[networkId] = { provider, apiKey };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return { success: true };
});

ipcMain.handle('rpc:bulk-apply-evm', async (_event, { provider, apiKey }) => {
  const fs = require('fs');
  const { pathToFileURL } = require('url');
  const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.poh-miner', 'config.json');

  const rpcModule = await import(pathToFileURL(path.join(__dirname, '../src/rpc/index.js')).href);
  const { EVM_CHAIN_IDS, bulkApplyProvider } = rpcModule;

  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }

  config.rpc = bulkApplyProvider(config.rpc || {}, EVM_CHAIN_IDS, provider, apiKey);

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return { success: true, appliedTo: EVM_CHAIN_IDS.length };
});

// --- Etherscan API Key ---
ipcMain.handle('rpc:get-etherscan-key', async () => {
  const fs = require('fs');
  const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.poh-miner', 'config.json');
  if (!fs.existsSync(CONFIG_PATH)) return '';
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return config.etherscanApiKey || '';
});

ipcMain.handle('rpc:save-etherscan-key', async (_event, apiKey) => {
  const fs = require('fs');
  const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.poh-miner', 'config.json');

  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }

  config.etherscanApiKey = apiKey || '';

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return { success: true };
});

// =====================================================
// Onboarding IPC
// =====================================================

const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.poh-miner', 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

function saveConfig(partial) {
  const current = loadConfig();
  const updated = { ...current, ...partial };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
  return updated;
}

ipcMain.handle('onboarding:get-status', async () => {
  const config = loadConfig();

  // Load WalletManager to check for actual wallet files on disk
  const { WalletManager } = await import('../src/wallet/wallet.js');
  const wm = new WalletManager();
  const existingWallets = wm.listWallets();

  const hasPohWalletOnDisk = existingWallets.length > 0;
  const hasPohWalletInConfig = !!config.pohWallet;

  const hasPohWallet = hasPohWalletOnDisk || hasPohWalletInConfig;

  // If we have wallets on disk but none recorded in config, pick the first one
  // and persist it so future runs remember it.
  let pohWallet = config.pohWallet;
  if (!pohWallet && hasPohWalletOnDisk) {
    pohWallet = existingWallets[0];
    saveConfig({ pohWallet });
  }

  // Consider fully onboarded if config says so AND we have a poh wallet (in config or on disk)
  const isFullyOnboarded = !!(config.onboarded && hasPohWallet);

  return {
    onboarded: isFullyOnboarded,
    hasPohWallet,
    pohWallet: pohWallet || null,
    solanaAddress: config.solanaAddress || null,
  };
});

ipcMain.handle('onboarding:create-poh-wallet', async () => {
  // Dynamic import because src/wallet/wallet.js is an ES Module
  const { WalletManager } = await import('../src/wallet/wallet.js');
  const wm = new WalletManager();

  // Check if one already exists
  const existing = wm.listWallets();
  if (existing.length > 0) {
    const wallet = wm.loadWallet(existing[0]);
    return {
      address: wallet.address,
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      alreadyExisted: true,
    };
  }

  const wallet = wm.createWallet();
  return {
    address: wallet.address,
    publicKey: wallet.publicKey,
    privateKey: wallet.privateKey,
    alreadyExisted: false,
  };
});

ipcMain.handle('onboarding:complete', async (_event, data) => {
  const { pohWallet, solanaAddress, ...rest } = data || {};

  const updated = saveConfig({
    pohWallet: pohWallet || null,
    solanaAddress: solanaAddress || null,
    onboarded: true,
    wallet: solanaAddress || pohWallet, // keep backward compat for now
    ...rest,
  });

  return { success: true, config: updated };
});

// Developer helper: reset onboarding
ipcMain.handle('onboarding:reset', async () => {
  const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.poh-miner', 'config.json');
  
  if (fs.existsSync(CONFIG_PATH)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    delete config.onboarded;
    delete config.pohWallet;
    // Keep solanaAddress and rpc settings by default, but remove onboarded flag
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  }
  return { success: true, message: 'Onboarding reset. Restart the app.' };
});

ipcMain.handle('miner:start', async () => {
  // Always delegate to startMiner() — it has robust guards against duplicates and races
  startMiner();
  return { started: true };
});

// ── Ollama / AI setup IPC ────────────────────────────────────────────────────

const { execFile, spawn: spawnProc } = require('child_process');
const https = require('https');
const os = require('os');

function sendSetupProgress(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup:progress', msg);
  }
}

async function isOllamaRunning() {
  return new Promise((resolve) => {
    const req = require('http').request(
      { hostname: 'localhost', port: 11434, path: '/api/tags', method: 'GET', timeout: 3000 },
      (res) => resolve(res.statusCode === 200)
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function ollamaInPath() {
  return new Promise((resolve) => {
    execFile('which', ['ollama'], (err) => resolve(!err));
  });
}

function startOllamaService() {
  return new Promise((resolve) => {
    const proc = spawnProc('ollama', ['serve'], {
      detached: true, stdio: 'ignore',
      env: { ...process.env },
    });
    proc.unref();
    // Give it 3 seconds to start
    setTimeout(resolve, 3000);
  });
}

function installOllama() {
  return new Promise((resolve, reject) => {
    sendSetupProgress({ status: 'installing', message: 'Downloading Ollama...' });
    const platform = process.platform;
    if (platform === 'linux' || platform === 'darwin') {
      // Official one-liner installer
      const proc = spawnProc('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      proc.stdout.on('data', d => sendSetupProgress({ status: 'installing', message: d.toString().trim() }));
      proc.stderr.on('data', d => sendSetupProgress({ status: 'installing', message: d.toString().trim() }));
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Ollama install exited ${code}`));
      });
    } else {
      reject(new Error('Auto-install not supported on this OS. Download from https://ollama.com'));
    }
  });
}

// Check Ollama + model status without installing anything
ipcMain.handle('setup:check', async () => {
  const running = await isOllamaRunning();
  const inPath = await ollamaInPath();
  let models = [];
  if (running) {
    try {
      const res = await fetch('http://localhost:11434/api/tags');
      const data = await res.json();
      models = (data.models || []).map(m => m.name || m.model).filter(Boolean);
    } catch (_) {}
  }
  return { running, inPath, models };
});

// Install Ollama if missing, then start it
ipcMain.handle('setup:install', async () => {
  try {
    const inPath = await ollamaInPath();
    if (!inPath) {
      await installOllama();
      sendSetupProgress({ status: 'installed', message: 'Ollama installed.' });
    }
    const running = await isOllamaRunning();
    if (!running) {
      sendSetupProgress({ status: 'starting', message: 'Starting Ollama service...' });
      await startOllamaService();
    }
    const nowRunning = await isOllamaRunning();
    return { ok: nowRunning, error: nowRunning ? null : 'Ollama did not start — try running "ollama serve" manually' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Pull a model with streaming progress
ipcMain.handle('setup:pull-model', async (_event, model = 'qwen2.5:1.5b') => {
  return new Promise((resolve) => {
    sendSetupProgress({ status: 'pulling', message: `Pulling ${model}...`, model });
    const req = require('http').request(
      {
        hostname: 'localhost', port: 11434, path: '/api/pull',
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line);
              const pct = evt.total ? Math.round((evt.completed / evt.total) * 100) : null;
              sendSetupProgress({ status: 'pulling', message: evt.status, model, pct, total: evt.total, completed: evt.completed });
              if (evt.status === 'success') {
                resolve({ ok: true });
              }
            } catch (_) {}
          }
        });
        res.on('end', () => {
          sendSetupProgress({ status: 'ready', message: `${model} ready.`, model });
          resolve({ ok: true });
        });
      }
    );
    req.on('error', (e) => {
      sendSetupProgress({ status: 'error', message: e.message });
      resolve({ ok: false, error: e.message });
    });
    req.write(JSON.stringify({ name: model, stream: true }));
    req.end();
  });
});
