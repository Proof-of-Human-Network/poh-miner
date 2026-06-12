const logContent = document.getElementById('log-content');
const chainHeightEl = document.getElementById('chain-height');
const reputationEl = document.getElementById('reputation');
const validSubEl = document.getElementById('valid-submissions');
const invalidSubEl = document.getElementById('invalid-submissions');

// Legacy elements (may not exist after UI updates)
const walletAddressEl = document.getElementById('wallet-address');
const walletBalanceEl = document.getElementById('wallet-balance');

function addLog(message) {
  const div = document.createElement('div');
  div.className = 'log-line';
  if (message.includes('[ERROR]') || message.includes('ERROR')) {
    div.classList.add('error');
  }
  div.textContent = message;
  logContent.appendChild(div);

  // Auto-scroll the panel (not the inner div — the panel has overflow:auto)
  const logsPanel = document.getElementById('logs');
  if (logsPanel) logsPanel.scrollTop = logsPanel.scrollHeight;

  // Keep only last 300 lines
  while (logContent.children.length > 300) {
    logContent.removeChild(logContent.firstChild);
  }
}

function clearLogs() {
  logContent.innerHTML = '';
}

function updateStatus(status) {
  if (!status) return;

  const POH_DECIMALS = 1_000_000_000;
  const addr   = status.pohWallet || status.wallet || '';
  const rawBal = typeof status.pohBalance === 'number' ? status.pohBalance
               : typeof status.balance    === 'number' ? status.balance : null;
  const poh    = rawBal !== null ? rawBal / POH_DECIMALS : null;
  const pohStr = poh !== null ? poh.toFixed(poh < 1 ? 4 : 2) + ' POH' : null;

  // Left sidebar
  const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.textContent = val; };
  if (addr) {
    const short = addr.length > 16 ? addr.slice(0, 8) + '…' + addr.slice(-6) : addr;
    set('poh-wallet-address', short);
    window._localWallet = addr;
  } else {
    // Clear "Loading..." once we've received at least one status update
    const el = document.getElementById('poh-wallet-address');
    if (el && el.textContent === 'Loading...') el.textContent = '—';
  }
  if (pohStr) set('poh-wallet-balance', pohStr);
  // Home panel
  if (poh !== null) {
    const numEl = document.getElementById('home-balance-num');
    if (numEl) numEl.textContent = poh.toFixed(poh < 1 ? 4 : 2);
  }
  if (addr) {
    const addrEl = document.getElementById('home-balance-addr');
    if (addrEl) addrEl.textContent = addr.length > 16 ? addr.slice(0, 8) + '…' + addr.slice(-6) : addr;
  }
  if (typeof status.chainHeight === 'number') { set('chain-height', status.chainHeight.toLocaleString()); if (chainHeightEl) chainHeightEl.textContent = status.chainHeight; }
  if (typeof status.reputation  === 'number') { set('reputation', status.reputation.toFixed(2)); if (reputationEl) reputationEl.textContent = status.reputation.toFixed(2); }
  if (status.qualityStats) {
    set('valid-submissions',   status.qualityStats.validSubmissions   || 0);
    set('invalid-submissions', status.qualityStats.invalidSubmissions || 0);
    if (validSubEl)   validSubEl.textContent   = status.qualityStats.validSubmissions   || 0;
    if (invalidSubEl) invalidSubEl.textContent = status.qualityStats.invalidSubmissions || 0;
  }
  if (status.solanaAddress) {
    const short = status.solanaAddress.length > 14 ? status.solanaAddress.slice(0, 6) + '…' + status.solanaAddress.slice(-4) : status.solanaAddress;
    set('solana-address', short);
  }
  if (status.model || status.inferenceMode) {
    const mode  = (status.inferenceMode || 'AUTO').toUpperCase();
    const model = status.model || 'qwen2.5:1.5b';
    set('sidebar-inference', `${mode} · ${model}`);
    set('brain-model', model);
  }
  if (typeof status.peers === 'number' || status.peerCount != null) {
    const count = status.peers ?? status.peerCount ?? status.activeJobs;
    if (count != null) set('sidebar-peers', count + ' online');
  }
  if (status.region) set('sidebar-region', status.region);

  // Mining active indicator
  const isActive = (status.activeJobs ?? 0) > 0 || (status.qualityStats?.validSubmissions ?? 0) > 0;
  const dot = document.getElementById('mining-dot');
  const lbl = document.getElementById('mining-label');
  if (dot) dot.className = 'mining-dot' + (isActive ? ' active' : '');
  if (lbl) { lbl.textContent = isActive ? 'MINING ACTIVE' : 'WAITING'; lbl.className = 'sb-mining-label' + (isActive ? ' active' : ''); }

  // Keep port in sync
  if (status?.walletApiPort) window._minerApiPort = status.walletApiPort;

  // Onboarding gate
  if (status && status.waitingForOnboarding) {
    const od = document.getElementById('onboarding');
    const ma = document.getElementById('main-app');
    if (ma) ma.classList.add('hidden');
    if (od) { od.classList.remove('hidden'); showOnboardingStep('welcome'); }
  }
}

// Listen for live logs
if (window.pohMinerAPI) {
  window.pohMinerAPI.onLog((message) => {
    addLog(message);
  });

  window.pohMinerAPI.onStatus((status) => {
    // Keep port in sync so chat always hits the right endpoint
    if (status?.walletApiPort) window._minerApiPort = status.walletApiPort;
    updateStatus(status);

    // If main process tells us we're not onboarded, force the wizard
    if (status && status.waitingForOnboarding) {
      const onboardingDiv = document.getElementById('onboarding');
      const mainAppDiv = document.getElementById('main-app');
      if (mainAppDiv) mainAppDiv.classList.add('hidden');
      if (onboardingDiv) {
        onboardingDiv.classList.remove('hidden');
        showOnboardingStep('welcome');
      }
    }
  });

  // Listen for explicit command from main process to enter onboarding
  if (window.pohMinerAPI?.onEnterOnboardingMode) {
    window.pohMinerAPI.onEnterOnboardingMode(async () => {
      console.log('[Onboarding] Received force enter onboarding from main process');
      const onboardingDiv = document.getElementById('onboarding');
      const mainAppDiv = document.getElementById('main-app');
      if (mainAppDiv) mainAppDiv.classList.add('hidden');
      if (onboardingDiv) {
        onboardingDiv.classList.remove('hidden');
        // Run AI setup check first; skip to welcome if setup not available
        if (window.pohMinerAPI?.setup?.check) {
          await runAiSetupStep();
        } else {
          showOnboardingStep('welcome');
        }
      }
    });
  }

  // Listen for command from main process (authoritative) to show the main miner UI
  if (window.pohMinerAPI?.onShowMainApp) {
    window.pohMinerAPI.onShowMainApp(() => {
      console.log('[Onboarding] Received show-main-app from main process');
      const onboardingDiv = document.getElementById('onboarding');
      const mainAppDiv = document.getElementById('main-app');
      if (onboardingDiv) onboardingDiv.classList.add('hidden');
      if (mainAppDiv) mainAppDiv.classList.remove('hidden');
    });
  }

  // Load initial logs and status
  window.pohMinerAPI.getLogs().then((initialLogs) => {
    if (Array.isArray(initialLogs)) {
      initialLogs.forEach(entry => {
        const msg = typeof entry === 'string' ? entry : entry.message || JSON.stringify(entry);
        addLog(msg);
      });
    }
  });

  window.pohMinerAPI.getStatus().then(status => {
    updateStatus(status);
    setTimeout(loadBrainState, 1500);
  });
} else {
  // Preload IPC unavailable — poll the miner HTTP API directly for status and brain state
  setTimeout(pollNodeStatus, 500);
  setTimeout(loadBrainState, 1500);
}

// Initial state - safely set if elements exist
if (walletAddressEl) walletAddressEl.textContent = 'Loading...';
if (walletBalanceEl) walletBalanceEl.textContent = '0.00 POH';

// =====================================================
// RPC Providers UI Logic
// =====================================================

const networkSelect = document.getElementById('rpc-network');
const providerSelect = document.getElementById('rpc-provider');
const apiKeyInput = document.getElementById('rpc-apikey');
const previewEl = document.getElementById('rpc-preview');
const saveBtn = document.getElementById('rpc-save-btn');
const bulkBtn = document.getElementById('rpc-bulk-evm-btn');
const statusEl = document.getElementById('rpc-status');

let currentNetworksGrouped = null;

async function initRpcUI() {
  if (!window.pohMinerAPI?.rpc) {
    statusEl.textContent = 'RPC API not available (running outside Electron)';
    statusEl.style.color = '#f87171';
    return;
  }

  try {
    // Load grouped networks
    currentNetworksGrouped = await window.pohMinerAPI.rpc.getNetworksGrouped();

    // Populate network dropdown with optgroups
    networkSelect.innerHTML = '<option value="">Select network...</option>';

    Object.entries(currentNetworksGrouped).forEach(([category, networks]) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = category;

      networks.forEach(net => {
        const option = document.createElement('option');
        option.value = net.id;
        option.textContent = net.label;
        optgroup.appendChild(option);
      });

      networkSelect.appendChild(optgroup);
    });

    // Load current config (optional: could prefill if we want)
    // For now we keep the form clean for adding new entries

    // Event listeners
    networkSelect.addEventListener('change', onNetworkChange);
    providerSelect.addEventListener('change', () => {
      updatePreview();
      updateBulkButtonState();
    });
    apiKeyInput.addEventListener('input', updatePreview);

    saveBtn.addEventListener('click', saveCurrentNetwork);
    bulkBtn.addEventListener('click', bulkApplyToEvm);

  } catch (err) {
    console.error('Failed to init RPC UI:', err);
    statusEl.textContent = 'Failed to load RPC settings';
    statusEl.style.color = '#f87171';
  }
}

async function onNetworkChange() {
  const networkId = networkSelect.value;
  providerSelect.innerHTML = '<option value="">Loading providers...</option>';
  providerSelect.disabled = true;
  previewEl.textContent = '';
  statusEl.textContent = '';

  if (!networkId) {
    providerSelect.innerHTML = '<option value="">Select network first</option>';
    bulkBtn.disabled = true;
    bulkBtn.style.opacity = '0.5';
    return;
  }

  try {
    const providers = await window.pohMinerAPI.rpc.getProvidersForNetwork(networkId);

    providerSelect.innerHTML = '<option value="">Select provider...</option>';

    if (providers.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'No providers support this network';
      opt.disabled = true;
      providerSelect.appendChild(opt);
      return;
    }

    providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.description ? ` — ${p.description}` : '');
      providerSelect.appendChild(opt);
    });

    providerSelect.disabled = false;
    updateBulkButtonState();

  } catch (err) {
    console.error(err);
    providerSelect.innerHTML = '<option value="">Error loading providers</option>';
  }
}

function updateBulkButtonState() {
  const providerId = providerSelect.value;
  // Only enable bulk EVM button for providers that support EVM (alchemy, quicknode, ankr, etc.)
  const evmFriendly = ['alchemy', 'quicknode', 'ankr', 'getblock'];
  bulkBtn.disabled = !evmFriendly.includes(providerId);
  bulkBtn.style.opacity = bulkBtn.disabled ? '0.5' : '1';
}

async function updatePreview() {
  const networkId = networkSelect.value;
  const providerId = providerSelect.value;
  const apiKey = apiKeyInput.value.trim();

  previewEl.textContent = '';

  if (!networkId || !providerId || !apiKey) {
    return;
  }

  try {
    const url = await window.pohMinerAPI.rpc.previewUrl({ networkId, providerId, apiKey });
    if (url) {
      previewEl.innerHTML = `<span style="color:#888">Preview:</span> <span style="color:#22c55e">${url}</span>`;
    } else {
      previewEl.textContent = 'Could not generate preview URL';
      previewEl.style.color = '#f87171';
    }
  } catch (err) {
    previewEl.textContent = 'Preview error';
  }
}

async function saveCurrentNetwork() {
  const networkId = networkSelect.value;
  const provider = providerSelect.value;
  const apiKey = apiKeyInput.value.trim();

  if (!networkId || !provider || !apiKey) {
    statusEl.textContent = 'Please select network, provider and enter API key';
    statusEl.style.color = '#f87171';
    return;
  }

  statusEl.textContent = 'Saving...';
  statusEl.style.color = '#888';

  try {
    await window.pohMinerAPI.rpc.saveNetworkConfig({ networkId, provider, apiKey });
    statusEl.textContent = `Saved ${networkId} → ${provider}`;
    statusEl.style.color = '#22c55e';

    // Clear key for safety after saving
    apiKeyInput.value = '';
    previewEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'Failed to save: ' + err.message;
    statusEl.style.color = '#f87171';
  }
}

async function bulkApplyToEvm() {
  const provider = providerSelect.value;
  const apiKey = apiKeyInput.value.trim();

  if (!provider || !apiKey) {
    statusEl.textContent = 'Select a provider and enter API key first';
    statusEl.style.color = '#f87171';
    return;
  }

  if (!confirm('Apply this provider + key to ALL EVM chains? (Ethereum, Base, Arbitrum, etc.)')) {
    return;
  }

  statusEl.textContent = 'Applying to all EVM chains...';
  statusEl.style.color = '#888';

  try {
    const result = await window.pohMinerAPI.rpc.bulkApplyEvm({ provider, apiKey });
    statusEl.textContent = `Applied to ${result.appliedTo} EVM chains`;
    statusEl.style.color = '#22c55e';

    apiKeyInput.value = '';
    previewEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'Bulk apply failed: ' + err.message;
    statusEl.style.color = '#f87171';
  }
}

// Initialize RPC UI when the script loads
initRpcUI();

// =====================================================
// ONBOARDING FLOW
// =====================================================

let currentOnboardingData = {
  pohWallet: null,
  privateKey: null,
};

async function checkAndStartOnboarding() {
  const onboardingDiv = document.getElementById('onboarding');
  const mainAppDiv = document.getElementById('main-app');

  // Always start with both hidden
  if (onboardingDiv) onboardingDiv.classList.add('hidden');
  if (mainAppDiv) mainAppDiv.classList.add('hidden');

  if (!window.pohMinerAPI?.onboarding) {
    console.warn('Running outside Electron — showing main UI as fallback');
    if (mainAppDiv) mainAppDiv.classList.remove('hidden');
    return;
  }

  try {
    const status = await window.pohMinerAPI.onboarding.getStatus();

    console.log('[Onboarding] Status check:', status);

    if (status.onboarded || status.hasPohWallet) {
      // User already has a PoH wallet on disk or in config, or onboarding was completed.
      // Go straight to main app.
      // (Solana address and RPC can still be configured later in Settings)
      if (mainAppDiv) mainAppDiv.classList.remove('hidden');
      if (onboardingDiv) onboardingDiv.classList.add('hidden');

      // Make sure the miner is running
      if (window.pohMinerAPI?.miner?.start) {
        window.pohMinerAPI.miner.start().catch(() => {});
      }
      return;
    }

    // No PoH wallet yet and not marked onboarded → show the full onboarding wizard
    if (onboardingDiv) {
      onboardingDiv.classList.remove('hidden');
      showOnboardingStep('welcome');
    }

  } catch (err) {
    console.error('Onboarding check failed:', err);
    // Last resort: show main UI
    if (mainAppDiv) mainAppDiv.classList.remove('hidden');
  }
}

// ── AI Setup step ─────────────────────────────────────────────────────────────
async function runAiSetupStep() {
  showOnboardingStep('ai-setup');

  const ollamaIcon   = document.getElementById('setup-ollama-icon');
  const ollamaStatus = document.getElementById('setup-ollama-status');
  const modelIcon    = document.getElementById('setup-model-icon');
  const modelStatus  = document.getElementById('setup-model-status');
  const progressWrap = document.getElementById('setup-progress-wrap');
  const progressBar  = document.getElementById('setup-progress-bar');
  const progressPct  = document.getElementById('setup-progress-pct');
  const logEl        = document.getElementById('setup-log');
  const continueBtn  = document.getElementById('setup-continue-btn');
  const MODEL        = 'qwen2.5:1.5b';

  // Listen for streaming progress from main process
  window.pohMinerAPI.setup.onProgress((msg) => {
    if (logEl) logEl.textContent = msg.message || '';
    if (msg.status === 'pulling' && msg.pct != null) {
      if (progressWrap) progressWrap.classList.remove('hidden');
      if (progressBar) progressBar.style.width = msg.pct + '%';
      if (progressPct) progressPct.textContent = msg.pct + '%';
      if (modelStatus) modelStatus.textContent = `Downloading… ${msg.pct}%`;
    }
    if (msg.status === 'ready') {
      if (modelIcon) modelIcon.textContent = '✅';
      if (modelStatus) modelStatus.textContent = 'Ready';
      if (progressWrap) progressWrap.classList.add('hidden');
      if (continueBtn) continueBtn.disabled = false;
    }
    if (msg.status === 'error') {
      if (modelIcon) modelIcon.textContent = '❌';
      if (modelStatus) modelStatus.textContent = msg.message;
    }
  });

  // 1. Check current state
  const state = await window.pohMinerAPI.setup.check();

  // Ollama status
  if (state.running) {
    if (ollamaIcon) ollamaIcon.textContent = '✅';
    if (ollamaStatus) ollamaStatus.textContent = 'Running';
  } else if (state.inPath) {
    if (ollamaIcon) ollamaIcon.textContent = '⚙️';
    if (ollamaStatus) ollamaStatus.textContent = 'Installed but not running — starting...';
  } else {
    if (ollamaIcon) ollamaIcon.textContent = '⬇️';
    if (ollamaStatus) ollamaStatus.textContent = 'Not installed — installing...';
  }

  // Model status
  const hasModel = state.models && state.models.some(m => m.startsWith('qwen2.5:1.5b') || m === MODEL);
  if (hasModel) {
    if (modelIcon) modelIcon.textContent = '✅';
    if (modelStatus) modelStatus.textContent = 'Ready';
  } else {
    if (modelIcon) modelIcon.textContent = '⬇️';
    if (modelStatus) modelStatus.textContent = 'Will download (~900 MB)';
  }

  // If everything is fine, skip to welcome
  if (state.running && hasModel) {
    if (continueBtn) continueBtn.disabled = false;
    showOnboardingStep('welcome');
    return;
  }

  // 2. Install / start Ollama if needed
  if (!state.running) {
    const result = await window.pohMinerAPI.setup.install();
    if (result.ok) {
      if (ollamaIcon) ollamaIcon.textContent = '✅';
      if (ollamaStatus) ollamaStatus.textContent = 'Running';
    } else {
      if (ollamaIcon) ollamaIcon.textContent = '❌';
      if (ollamaStatus) ollamaStatus.textContent = result.error || 'Failed';
      if (logEl) logEl.textContent = 'Install Ollama manually from https://ollama.com then restart.';
      if (continueBtn) continueBtn.disabled = false;
      return;
    }
  }

  // 3. Pull model if missing
  if (!hasModel) {
    if (modelStatus) modelStatus.textContent = 'Downloading qwen2.5:1.5b (~900 MB)...';
    if (progressWrap) progressWrap.classList.remove('hidden');
    await window.pohMinerAPI.setup.pullModel(MODEL);
  } else {
    if (continueBtn) continueBtn.disabled = false;
    showOnboardingStep('welcome');
  }
}

function showOnboardingStep(step) {
  // Hide all steps
  document.querySelectorAll('#onboarding .onboarding-step').forEach(el => el.classList.add('hidden'));
  
  // Show requested step
  const stepEl = document.getElementById(`step-${step}`);
  if (stepEl) stepEl.classList.remove('hidden');
}

window.goToStep = function(step) {
  showOnboardingStep(step);
  if (step === 'evm') initOnboardEvmStep();
  else if (step === 'solana-rpc') initOnboardSolanaRpcStep();
  else if (step === 'other-chains') initOnboardOtherChainsStep();
};

window.createPohWallet = async function() {
  if (!window.pohMinerAPI?.onboarding?.createPohWallet) {
    console.error('Onboarding API not available yet. Try refreshing or restarting the app.');
    alert('Error: Could not reach the backend. Please restart the app.');
    return;
  }

  try {
    const result = await window.pohMinerAPI.onboarding.createPohWallet();
    
    currentOnboardingData.pohWallet = result.address;
    currentOnboardingData.privateKey = result.privateKey;

    document.getElementById('poh-address').textContent = result.address;
    document.getElementById('poh-private-key').textContent = result.privateKey;

    document.getElementById('wallet-creation-ui').classList.add('hidden');
    document.getElementById('wallet-display').classList.remove('hidden');
  } catch (err) {
    console.error('Failed to create PoH wallet:', err);
    alert('Failed to create wallet. Check the console for details.');
  }
};

window.copyPrivateKey = function() {
  if (!currentOnboardingData.privateKey) return;
  navigator.clipboard.writeText(currentOnboardingData.privateKey);
  
  const buttons = document.querySelectorAll('#wallet-display button');
  buttons.forEach(btn => {
    if (btn.innerText.includes('Copy')) {
      const original = btn.innerText;
      btn.innerText = 'Copied!';
      setTimeout(() => {
        if (btn) btn.innerText = original;
      }, 1600);
    }
  });
};

window.checkBackupConfirmation = function() {
  const input = document.getElementById('backup-confirm-input');
  const btn = document.getElementById('wallet-continue-btn');
  
  if (!input || !btn) return;

  const expected = "I have backed up my private key";
  if (input.value.trim() === expected) {
    btn.disabled = false;
    btn.classList.remove('bg-zinc-800', 'hover:bg-zinc-700');
    btn.classList.add('bg-[#22c55e]', 'hover:bg-[#16a34a]', 'text-black');
  } else {
    btn.disabled = true;
    btn.classList.add('bg-zinc-800', 'hover:bg-zinc-700');
    btn.classList.remove('bg-[#22c55e]', 'hover:bg-[#16a34a]', 'text-black');
  }
};

window.saveSolanaAndContinue = function() {
  const input = document.getElementById('solana-address-input').value.trim();
  if (!input) {
    alert('Please enter your Solana address');
    return;
  }
  currentOnboardingData.solanaAddress = input;
  goToStep('etherscan');
};

window.completeOnboarding = async function() {
  const payload = {
    pohWallet: currentOnboardingData.pohWallet,
    solanaAddress: currentOnboardingData.solanaAddress,
  };

  await window.pohMinerAPI.onboarding.complete(payload);

  try {
    window.location.reload();
  } catch (e) {
    document.getElementById('onboarding').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    try {
      await window.pohMinerAPI.miner.start();
    } catch (_) {}
  }
};

window.openFullRpcSettings = function() {
  document.getElementById('onboarding').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  if (typeof showSettings === 'function') {
    showSettings();
  }
};

// =====================================================
// Onboarding Step: Etherscan API Key
// =====================================================

window.saveEtherscanAndContinue = async function() {
  const key = document.getElementById('ob-etherscan-key')?.value.trim() || '';
  const statusEl = document.getElementById('ob-etherscan-status');

  if (key && window.pohMinerAPI?.rpc?.saveEtherscanKey) {
    try {
      await window.pohMinerAPI.rpc.saveEtherscanKey(key);
      if (statusEl) { statusEl.textContent = 'Key saved.'; statusEl.style.color = '#22c55e'; }
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Failed to save key — try again.'; statusEl.style.color = '#f87171'; }
      return;
    }
  }

  goToStep('evm');
};

// =====================================================
// Onboarding Step: EVM Provider
// =====================================================

async function initOnboardEvmStep() {
  if (window._obEvmInited) return;
  window._obEvmInited = true;

  if (!window.pohMinerAPI?.rpc) return;

  const netSel = document.getElementById('ob-evm-network');
  const provSel = document.getElementById('ob-evm-provider');
  const apiKeyIn = document.getElementById('ob-evm-apikey');
  const previewEl = document.getElementById('ob-evm-preview');
  const saveBtn = document.getElementById('ob-evm-save-btn');
  const bulkBtn = document.getElementById('ob-evm-bulk-btn');
  const statusEl = document.getElementById('ob-evm-status');

  try {
    const grouped = await window.pohMinerAPI.rpc.getNetworksGrouped();
    const evmNets = grouped['EVM'] || [];

    netSel.innerHTML = '<option value="">Select EVM network...</option>';
    evmNets.forEach(net => {
      const opt = document.createElement('option');
      opt.value = net.id;
      opt.textContent = net.label;
      netSel.appendChild(opt);
    });

    netSel.addEventListener('change', async () => {
      const networkId = netSel.value;
      provSel.innerHTML = '<option value="">Loading...</option>';
      provSel.disabled = true;
      previewEl.textContent = '';
      statusEl.textContent = '';

      if (!networkId) {
        provSel.innerHTML = '<option value="">Select network first</option>';
        updateObEvmBulkBtn();
        return;
      }

      const providers = await window.pohMinerAPI.rpc.getProvidersForNetwork(networkId);
      provSel.innerHTML = '<option value="">Select provider...</option>';
      providers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + (p.description ? ` — ${p.description}` : '');
        provSel.appendChild(opt);
      });
      provSel.disabled = false;
      updateObEvmBulkBtn();
    });

    provSel.addEventListener('change', () => { updateObEvmPreview(); updateObEvmBulkBtn(); });
    apiKeyIn.addEventListener('input', updateObEvmPreview);
    saveBtn.addEventListener('click', saveObEvmNetwork);
    bulkBtn.addEventListener('click', bulkObEvmApply);

  } catch (err) {
    console.error('Failed to init onboard EVM step:', err);
  }

  async function updateObEvmPreview() {
    const networkId = netSel.value;
    const providerId = provSel.value;
    const apiKey = apiKeyIn.value.trim();
    previewEl.textContent = '';
    if (!networkId || !providerId || !apiKey) return;
    try {
      const url = await window.pohMinerAPI.rpc.previewUrl({ networkId, providerId, apiKey });
      if (url) previewEl.innerHTML = `<span style="color:#666">Preview:</span> <span style="color:#22c55e">${url}</span>`;
    } catch {}
  }

  function updateObEvmBulkBtn() {
    const evmFriendly = ['alchemy', 'quicknode', 'ankr', 'getblock'];
    bulkBtn.disabled = !evmFriendly.includes(provSel.value);
    bulkBtn.style.opacity = bulkBtn.disabled ? '0.4' : '1';
  }

  async function saveObEvmNetwork() {
    const networkId = netSel.value;
    const provider = provSel.value;
    const apiKey = apiKeyIn.value.trim();

    if (!networkId || !provider || !apiKey) {
      statusEl.textContent = 'Select network, provider and enter key';
      statusEl.style.color = '#f87171';
      return;
    }

    statusEl.textContent = 'Saving...';
    statusEl.style.color = '#888';

    try {
      await window.pohMinerAPI.rpc.saveNetworkConfig({ networkId, provider, apiKey });
      const netLabel = netSel.options[netSel.selectedIndex].text;
      statusEl.textContent = `Saved: ${netLabel} → ${provider}`;
      statusEl.style.color = '#22c55e';
      apiKeyIn.value = '';
      previewEl.textContent = '';
    } catch (err) {
      statusEl.textContent = 'Save failed: ' + err.message;
      statusEl.style.color = '#f87171';
    }
  }

  async function bulkObEvmApply() {
    const provider = provSel.value;
    const apiKey = apiKeyIn.value.trim();
    if (!provider || !apiKey) {
      statusEl.textContent = 'Select provider and enter key first';
      statusEl.style.color = '#f87171';
      return;
    }
    if (!confirm('Apply this provider + key to ALL EVM chains?')) return;

    statusEl.textContent = 'Applying to all EVM chains...';
    statusEl.style.color = '#888';

    try {
      const result = await window.pohMinerAPI.rpc.bulkApplyEvm({ provider, apiKey });
      statusEl.textContent = `Applied to ${result.appliedTo} EVM chains`;
      statusEl.style.color = '#22c55e';
      apiKeyIn.value = '';
      previewEl.textContent = '';
    } catch (err) {
      statusEl.textContent = 'Failed: ' + err.message;
      statusEl.style.color = '#f87171';
    }
  }
}

// =====================================================
// Onboarding Step: Solana RPC Provider
// =====================================================

async function initOnboardSolanaRpcStep() {
  if (window._obSolRpcInited) return;
  window._obSolRpcInited = true;

  if (!window.pohMinerAPI?.rpc) return;

  const provSel = document.getElementById('ob-sol-provider');
  const apiKeyIn = document.getElementById('ob-sol-apikey');
  const previewEl = document.getElementById('ob-sol-preview');
  const saveBtn = document.getElementById('ob-sol-save-btn');
  const statusEl = document.getElementById('ob-sol-status');

  try {
    const providers = await window.pohMinerAPI.rpc.getProvidersForNetwork('solana');
    provSel.innerHTML = '<option value="">Select provider...</option>';
    providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.description ? ` — ${p.description}` : '');
      opt.dataset.requiresKey = p.requiresKey ? '1' : '0';
      provSel.appendChild(opt);
    });

    const updatePreview = async () => {
      const providerId = provSel.value;
      const apiKey = apiKeyIn.value.trim();
      previewEl.textContent = '';
      if (!providerId || !apiKey) return;
      try {
        const url = await window.pohMinerAPI.rpc.previewUrl({ networkId: 'solana', providerId, apiKey });
        if (url) previewEl.innerHTML = `<span style="color:#666">Preview:</span> <span style="color:#22c55e">${url}</span>`;
      } catch {}
    };

    provSel.addEventListener('change', updatePreview);
    apiKeyIn.addEventListener('input', updatePreview);

    saveBtn.addEventListener('click', async () => {
      const provider = provSel.value;
      const apiKey = apiKeyIn.value.trim();

      if (!provider) {
        statusEl.textContent = 'Select a provider first';
        statusEl.style.color = '#f87171';
        return;
      }

      statusEl.textContent = 'Saving...';
      statusEl.style.color = '#888';

      try {
        await window.pohMinerAPI.rpc.saveNetworkConfig({ networkId: 'solana', provider, apiKey });
        statusEl.textContent = `Saved: ${provider}`;
        statusEl.style.color = '#22c55e';
        apiKeyIn.value = '';
        previewEl.textContent = '';
      } catch (err) {
        statusEl.textContent = 'Save failed';
        statusEl.style.color = '#f87171';
      }
    });

  } catch (err) {
    console.error('Failed to init onboard Solana RPC step:', err);
  }
}

// =====================================================
// Onboarding Step: Other Chains (BTC, TON, TRON, XLM)
// =====================================================

async function initOnboardOtherChainsStep() {
  if (window._obOtherChainsInited) return;
  window._obOtherChainsInited = true;

  if (!window.pohMinerAPI?.rpc) return;

  for (const chainId of ['btc', 'ton', 'tron', 'xlm']) {
    try {
      const provSel = document.getElementById(`ob-${chainId}-provider`);
      if (!provSel) continue;

      const providers = await window.pohMinerAPI.rpc.getProvidersForNetwork(chainId);
      provSel.innerHTML = '<option value="">Select provider...</option>';
      providers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + (p.description ? ` — ${p.description}` : '');
        opt.dataset.requiresKey = p.requiresKey ? '1' : '0';
        provSel.appendChild(opt);
      });

      provSel.addEventListener('change', () => {
        const selected = provSel.options[provSel.selectedIndex];
        const requiresKey = selected?.dataset.requiresKey === '1';
        const wrap = document.getElementById(`ob-${chainId}-apikey-wrap`);
        if (wrap) wrap.style.display = requiresKey ? '' : 'none';
      });

    } catch (err) {
      console.error(`Failed to load providers for ${chainId}:`, err);
    }
  }
}

window.saveOtherChain = async function(chainId) {
  const provSel = document.getElementById(`ob-${chainId}-provider`);
  const apiKeyIn = document.getElementById(`ob-${chainId}-apikey`);
  const statusEl = document.getElementById(`ob-${chainId}-status`);
  const badge = document.getElementById(`ob-${chainId}-badge`);

  const provider = provSel?.value;
  const selected = provSel?.options[provSel?.selectedIndex];
  const requiresKey = selected?.dataset.requiresKey === '1';
  const apiKey = apiKeyIn?.value.trim() || '';

  if (!provider) {
    if (statusEl) { statusEl.textContent = 'Select a provider'; statusEl.style.color = '#f87171'; }
    return;
  }
  if (requiresKey && !apiKey) {
    if (statusEl) { statusEl.textContent = 'Enter your API key'; statusEl.style.color = '#f87171'; }
    return;
  }

  try {
    await window.pohMinerAPI.rpc.saveNetworkConfig({ networkId: chainId, provider, apiKey });
    if (statusEl) { statusEl.textContent = 'Saved!'; statusEl.style.color = '#22c55e'; }
    if (badge) {
      badge.textContent = 'Configured';
      badge.className = 'text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400';
    }
    if (apiKeyIn) apiKeyIn.value = '';
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed'; statusEl.style.color = '#f87171'; }
  }
};

window.skipOtherChain = function(chainId) {
  const badge = document.getElementById(`ob-${chainId}-badge`);
  const statusEl = document.getElementById(`ob-${chainId}-status`);
  const card = document.getElementById(`ob-${chainId}-card`);

  if (badge) {
    badge.textContent = 'Skipped';
    badge.className = 'text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-600';
  }
  if (statusEl) statusEl.textContent = '';
  if (card) card.style.opacity = '0.5';
};

// =====================================================
// Settings Modal
// =====================================================

window.showSettings = async function() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  modal.classList.remove('hidden');

  // Try to get latest status
  let status = null;
  try {
    status = await window.pohMinerAPI.getStatus?.();
    if (status) {
      const addrEl = document.getElementById('settings-poh-address');
      const solInput = document.getElementById('settings-solana');

      if (addrEl) addrEl.textContent = status.pohWallet || status.wallet || '—';
      if (solInput) solInput.value = status.solanaAddress || '';
    }
  } catch (e) {}

  // Populate mining model dropdown
  const miningModelSel = document.getElementById('settings-mining-model');
  if (miningModelSel) {
    try {
      const port = window._minerApiPort || 3456;
      const res = await fetch(`http://localhost:${port}/api/models`);
      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map(m => m.name || m.model).filter(Boolean);
        if (models.length) {
          miningModelSel.innerHTML = '';
          for (const m of models) {
            const opt = document.createElement('option');
            opt.value = opt.textContent = m;
            miningModelSel.appendChild(opt);
          }
          if (status?.model && models.includes(status.model)) {
            miningModelSel.value = status.model;
          } else {
            const qwen = models.find(m => m.includes('qwen'));
            if (qwen) miningModelSel.value = qwen;
          }
        } else {
          miningModelSel.innerHTML = '<option value="">No models installed</option>';
        }
      }
    } catch { miningModelSel.innerHTML = '<option value="">Ollama not running</option>'; }
  }
};

window.hideSettings = function() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hidden');
};

window.saveSettings = async function() {
  const solInput = document.getElementById('settings-solana');
  if (!solInput || !window.pohMinerAPI?.onboarding) return;

  const miningModelSel = document.getElementById('settings-mining-model');
  const model = miningModelSel?.value?.trim() || undefined;

  try {
    await window.pohMinerAPI.onboarding.complete({
      solanaAddress: solInput.value.trim(),
      ...(model ? { model } : {}),
    });
    hideSettings();
    // Refresh status
    const newStatus = await window.pohMinerAPI.getStatus?.();
    if (newStatus) updateStatus(newStatus);
  } catch (err) {
    alert('Failed to save settings');
  }
};

window.showPrivateKeyWarning = function() {
  const confirmed = confirm(
    "⚠️ WARNING: Never share your private key.\n\n" +
    "This will display your PoH private key. Only do this in a secure environment.\n\n" +
    "Are you sure you want to continue?"
  );

  if (!confirmed) return;

  // For safety, we don't auto-expose the key from main process easily.
  // In a real version we'd have a dedicated secure reveal flow.
  alert("Private key reveal is not implemented for security reasons in this build.\n\n" +
        "Your key is stored at: ~/.poh-miner/wallets/");
  hideSettings();
};

// Boot the app - ensure DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkAndStartOnboarding);
} else {
  checkAndStartOnboarding();
}

// Safety net: after 3 seconds, double-check the onboarding status.
// If the user actually has a wallet / is onboarded, make sure we show the main app
// (prevents stale UI state or race conditions).
setTimeout(async () => {
  const onboardingDiv = document.getElementById('onboarding');
  const mainAppDiv = document.getElementById('main-app');

  try {
    if (!window.pohMinerAPI?.onboarding?.getStatus) return;

    const status = await window.pohMinerAPI.onboarding.getStatus();

    if (status.onboarded || status.hasPohWallet) {
      // User should be in the main app
      if (onboardingDiv) onboardingDiv.classList.add('hidden');
      if (mainAppDiv) mainAppDiv.classList.remove('hidden');

      // Try to ensure miner is running
      if (window.pohMinerAPI?.miner?.start) {
        window.pohMinerAPI.miner.start().catch(() => {});
      }
    } else if (mainAppDiv && mainAppDiv.classList.contains('hidden') && onboardingDiv && onboardingDiv.classList.contains('hidden')) {
      // Nothing visible — show onboarding as fallback
      onboardingDiv.classList.remove('hidden');
      showOnboardingStep('welcome');
    }
  } catch (e) {
    // ignore
  }
}, 3000);

// === Dev helper: reset onboarding ===
// You can run this in DevTools console:  resetOnboarding()
window.resetOnboarding = async function() {
  if (!window.pohMinerAPI?.onboarding?.reset) {
    console.error('Onboarding reset not available');
    return;
  }
  const result = await window.pohMinerAPI.onboarding.reset();
  console.log(result.message || 'Onboarding has been reset.');
  console.log('Please restart the app (or reload with Cmd/Ctrl+R) to see the onboarding flow again.');
};

// Emergency helper - forces the onboarding screen to appear right now (no restart needed)
window.forceShowOnboarding = function() {
  const onboardingDiv = document.getElementById('onboarding');
  const mainAppDiv = document.getElementById('main-app');

  if (mainAppDiv) mainAppDiv.classList.add('hidden');
  if (onboardingDiv) {
    onboardingDiv.classList.remove('hidden');
    // Try to show the first step
    const welcome = document.getElementById('step-welcome');
    if (welcome) {
      document.querySelectorAll('#onboarding .onboarding-step').forEach(s => s.classList.add('hidden'));
      welcome.classList.remove('hidden');
    }
  }
  console.log('%c[Dev] Onboarding screen forced visible. You can now go through the wizard.', 'color:#22c55e');
};

// Helper to force the main miner UI (useful for recovery)
window.showMainApp = function() {
  const onboardingDiv = document.getElementById('onboarding');
  const mainAppDiv = document.getElementById('main-app');

  if (onboardingDiv) onboardingDiv.classList.add('hidden');
  if (mainAppDiv) mainAppDiv.classList.remove('hidden');
  console.log('%c[Dev] Main app UI forced visible.', 'color:#22c55e');
};

// If we're stuck on startup, expose a quick way to recover
window.stuckInWaiting = function() {
  console.log('Running forceShowOnboarding() to recover...');
  window.forceShowOnboarding();
};

// =====================================================
// Etherscan API Key (separate from per-network RPCs)
// =====================================================

const etherscanInput = document.getElementById('etherscan-key');
const etherscanSaveBtn = document.getElementById('etherscan-save-btn');
const etherscanStatus = document.getElementById('etherscan-status');

async function initEtherscanUI() {
  if (!window.pohMinerAPI?.rpc?.getEtherscanKey) return;

  try {
    const currentKey = await window.pohMinerAPI.rpc.getEtherscanKey();
    if (currentKey) {
      etherscanInput.placeholder = '•••••••••••••••••••••••• (key saved)';
    }

    etherscanSaveBtn.addEventListener('click', async () => {
      const key = etherscanInput.value.trim();

      etherscanStatus.textContent = 'Saving...';
      etherscanStatus.style.color = '#888';

      try {
        await window.pohMinerAPI.rpc.saveEtherscanKey(key);
        etherscanStatus.textContent = key ? 'Etherscan key saved' : 'Etherscan key cleared';
        etherscanStatus.style.color = '#22c55e';

        if (key) {
          etherscanInput.value = '';
          etherscanInput.placeholder = '•••••••••••••••••••••••• (key saved)';
        }
      } catch (err) {
        etherscanStatus.textContent = 'Failed to save key';
        etherscanStatus.style.color = '#f87171';
      }
    });

  } catch (err) {
    console.error('Failed to load Etherscan key:', err);
  }
}

initEtherscanUI();

// Sidebar resizer removed — layout now uses fixed 3-column flex

// ── Tab switching ──────────────────────────────────────────────────────────────

const TAB_PANELS = { home: 'home-panel', logs: 'logs', chat: 'chat-panel', search: 'search-panel', send: 'send-panel', skills: 'skills-panel' };
const TAB_BTNS   = { home: 'tab-home-btn', logs: 'tab-logs-btn', chat: 'tab-chat-btn', search: 'tab-search-btn', send: 'tab-send-btn', skills: 'tab-skills-btn' };

function switchTab(name) {
  Object.entries(TAB_PANELS).forEach(([key, panelId]) => {
    const panel = document.getElementById(panelId);
    const btn   = document.getElementById(TAB_BTNS[key]);
    if (panel) panel.classList.toggle('active', key === name);
    if (btn)   btn.classList.toggle('active', key === name);
  });
  if (name === 'home')   { syncHomeBalance(); }
  if (name === 'chat')   { loadChatModels(); loadChatBrainContext(true); document.getElementById('chat-input')?.focus(); }
  if (name === 'send')   { syncSendWallet(); showSendView(); }
  if (name === 'skills') { loadSkills(); }
}

// ── Chat state ─────────────────────────────────────────────────────────────────

const chatHistory = []; // { role: 'user'|'assistant', content: string }
let chatStreaming = false;
let chatAbortController = null;
let _brainSystemPrompt = null; // full brain state injected as system msg on every chat send

function _setBrainIndicator(state) {
  const el = document.getElementById('chat-brain-pill');
  if (!el) return;
  if (state === 'loaded') {
    el.textContent = '🧠 brain loaded';
    el.style.display = 'inline-flex';
    el.style.color = '#22c55e';
    el.style.borderColor = 'rgba(34,197,94,0.3)';
  } else if (state === 'loading') {
    el.textContent = '🧠 loading…';
    el.style.display = 'inline-flex';
    el.style.color = '#6b7280';
    el.style.borderColor = '#2a2a2a';
  } else {
    el.textContent = '🧠 no context';
    el.style.display = 'inline-flex';
    el.style.color = '#ef4444';
    el.style.borderColor = 'rgba(239,68,68,0.3)';
  }
}

async function loadChatBrainContext(force = false) {
  if (_brainSystemPrompt && !force) return;
  _setBrainIndicator('loading');
  const port = window._minerApiPort || 3456;
  try {
    // Manual timeout via Promise.race for broad compatibility
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000));
    const fetchP  = fetch(`http://localhost:${port}/api/brain/state`);
    const r = await Promise.race([fetchP, timeout]);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const stateText = (d.stateSummary || '').slice(0, 3000);
    if (!stateText.trim()) throw new Error('brain_state.md is empty');

    _brainSystemPrompt =
      `You are the AI assistant for the PoH Miner desktop app and the Proof of Human (POH) protocol. ` +
      `Answer all questions about POH, the miner network, the wallet, staking, Conviction Curves, ` +
      `signals, the AI brain, token economics, and anything else in your knowledge base below. ` +
      `Never say you cannot discuss POH topics.\n\n` +
      `=== KNOWLEDGE BASE (brain_state.md) ===\n\n${stateText}`;

    console.log(`[chat] ✓ Brain context loaded — ${_brainSystemPrompt.length} chars from ${port}`);
    _setBrainIndicator('loaded');
  } catch (e) {
    _brainSystemPrompt = null;
    console.warn('[chat] Brain context failed:', e.message);
    _setBrainIndicator('error');
  }
}

// ── Social context injection ──────────────────────────────────────────────────
// Populated after a scan; prepended as system message to every chat send.
let _chatSocialContext = null; // { address, system, label, farcasterData, paragraphData }
let _lastScannedAddress = null;

async function _fetchSocialContextForAddress(address) {
  if (!address || !/^0x[0-9a-fA-F]{40}$/i.test(address)) return;
  _lastScannedAddress = address;

  const WARPCAST  = 'https://api.warpcast.com/v2';
  const PARAGRAPH = 'https://paragraph.xyz/api';
  const systemParts = [];
  let label = address.slice(0, 8) + '…';
  let farcasterData = null;
  let paragraphData = null;

  // ── Farcaster ───────────────────────────────────────────────────────────────
  try {
    const userRes = await fetch(`${WARPCAST}/user-by-verification?address=${address.toLowerCase()}`)
      .then(r => r.ok ? r.json() : null).catch(() => null);
    const user = userRes?.result?.user;

    if (user?.fid) {
      label = `@${user.username}`;
      const castsRes = await fetch(`${WARPCAST}/casts?fid=${user.fid}&limit=15`)
        .then(r => r.ok ? r.json() : null).catch(() => null);
      const rawCasts = castsRes?.result?.casts || [];

      farcasterData = {
        fid:           user.fid,
        username:      user.username      || '',
        displayName:   user.displayName   || user.username || '',
        bio:           user.profile?.bio?.text || '',
        followerCount: user.followerCount || 0,
        followingCount:user.followingCount|| 0,
        casts: rawCasts.slice(0, 12).map(c => ({
          text:    c.text || '',
          likes:   c.reactions?.count || 0,
          replies: c.replies?.count   || 0,
          recasts: c.recasts?.count   || 0,
        })).filter(c => c.text.length > 2),
      };

      const sysLines = [`FARCASTER — @${user.username} (${user.followerCount?.toLocaleString()} followers)`];
      if (farcasterData.bio) sysLines.push(`Bio: "${farcasterData.bio}"`);
      if (farcasterData.casts.length) {
        sysLines.push('Recent posts:');
        farcasterData.casts.forEach(c => {
          const m = [c.likes && `♥${c.likes}`, c.replies && `${c.replies} replies`].filter(Boolean).join(' · ');
          sysLines.push(`  • "${c.text}"${m ? ` [${m}]` : ''}`);
        });
      }
      systemParts.push(sysLines.join('\n'));
    }
  } catch {}

  // ── Paragraph ───────────────────────────────────────────────────────────────
  try {
    const blogsRes = await fetch(`${PARAGRAPH}/blogs?address=${address.toLowerCase()}`)
      .then(r => r.ok ? r.json() : null).catch(() => null);
    const blogs = Array.isArray(blogsRes) ? blogsRes : (blogsRes?.blogs || []);
    const blog  = blogs[0];

    if (blog?.id) {
      const postsRes = await fetch(`${PARAGRAPH}/blogs/${blog.id}/posts?limit=8`)
        .then(r => r.ok ? r.json() : null).catch(() => null);
      const rawPosts = Array.isArray(postsRes) ? postsRes : (postsRes?.posts || []);

      paragraphData = {
        blogId:          blog.id,
        title:           blog.title || blog.name || '',
        description:     blog.description || blog.subtitle || '',
        subscriberCount: blog.subscriberCount || 0,
        postCount:       rawPosts.length,
        posts: rawPosts.slice(0, 8).map(p => ({ title: p.title||'', subtitle: p.subtitle||'' })),
      };

      const sysLines = [`PARAGRAPH — "${paragraphData.title}" (${paragraphData.subscriberCount} subscribers)`];
      if (paragraphData.description) sysLines.push(`Description: "${paragraphData.description}"`);
      if (paragraphData.posts.length) {
        sysLines.push('Articles:');
        paragraphData.posts.forEach(p => sysLines.push(`  • "${p.title}"${p.subtitle ? ` — ${p.subtitle}` : ''}`));
      }
      systemParts.push(sysLines.join('\n'));
    }
  } catch {}

  if (!farcasterData && !paragraphData) return;

  _chatSocialContext = {
    address, label,
    farcasterData,
    paragraphData,
    system: `You have access to real-time social activity for wallet address ${address}.\nUse this context to answer questions about this person's views, interests, and recent activity.\n\n${systemParts.join('\n\n')}`,
  };
  _updateChatContextIndicator();

  // ── Inject raw social data into result immediately ──────────────────────────
  _injectSocialIntoResult(null, farcasterData, paragraphData);

  // ── Ask local LLM to summarise vibe, then update ───────────────────────────
  _generateVibeAndUpdate(farcasterData, paragraphData);
}

// Inject (or replace) the social characteristic section inside the rendered result.
function _injectSocialIntoResult(vibeData, farcasterData, paragraphData) {
  console.log(vibeData, farcasterData, paragraphData)

  const root = document.querySelector('#search-result .wp-root');
  if (!root) return;
  root.querySelector('.wp-social-inject')?.remove();
  const html = _socialChar(vibeData, farcasterData, paragraphData);
  if (!html) return;
  const wrap = document.createElement('div');
  wrap.className = 'wp-social-inject';
  wrap.innerHTML = html;
  const fb = root.querySelector('.feedback-row');
  fb ? root.insertBefore(wrap, fb) : root.appendChild(wrap);
}

// Call local Ollama for a fast vibe JSON, then update the injected section.
async function _generateVibeAndUpdate(farcasterData, paragraphData) {
  try {
    const port = window._minerApiPort || 3456;
    const contextLines = [];
    if (farcasterData) {
      contextLines.push(`Farcaster @${farcasterData.username} (${farcasterData.followerCount} followers, bio: "${farcasterData.bio}")`);
      farcasterData.casts.slice(0, 6).forEach(c => contextLines.push(`- "${c.text}"`));
    }
    if (paragraphData) {
      contextLines.push(`Paragraph "${paragraphData.title}" (${paragraphData.subscriberCount} subscribers)`);
      paragraphData.posts.slice(0, 4).forEach(p => contextLines.push(`- "${p.title}"`));
    }

    const prompt = `Analyze this social media content and return ONLY valid JSON with no other text:
{"vibe":"<2-3 sentence personality and interests summary>","topics":["topic1","topic2","topic3"],"humanSignals":["signal1","signal2"]}

Content:
${contextLines.join('\n')}`;

    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:   document.getElementById('chat-model-select')?.value || 'qwen2.5:1.5b',
        messages:[{ role: 'user', content: prompt }],
        stream:  false,
        options: { temperature: 0.4 },
      }),
    });
    if (!res.ok) return;
    const d = await res.json();
    const text = d.message?.content || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return;
    const vibeData = JSON.parse(m[0]);
    // Update displayed section with vibe
    _injectSocialIntoResult(vibeData, farcasterData, paragraphData);
    // Also store vibe in context for chat
    if (_chatSocialContext) _chatSocialContext.vibeData = vibeData;
  } catch {}
}

// Fetch enriched profile (including tx graph) from dev backend and inject graph section.
async function _enrichResultWithGraph(address) {
  try {
    // Try dev backend on its default port (3000 → 3001 → 3456 as fallback)
    const ports = [3000, 3001, 3002];
    let profile = null;
    for (const p of ports) {
      try {
        const r = await fetch(`http://localhost:${p}/checker/profile/${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) { profile = await r.json(); break; }
      } catch {}
    }
    if (!profile?.graph?.nodes?.length || profile.graph.nodes.length < 2) return;

    const root = document.querySelector('#search-result .wp-root');
    if (!root) return;
    // Remove any existing injected graph (avoid duplicate on re-scan)
    root.querySelector('.wp-graph-inject')?.remove();
    // Also stop any running simulation in the old SVG
    root.querySelectorAll('.txg-svg').forEach(s => { if (s._sim) s._sim.stop(); });

    const html = _txGraph(profile);
    if (!html) return;
    const wrap = document.createElement('div');
    wrap.className = 'wp-graph-inject';
    wrap.innerHTML = html;
    // Insert before feedback row
    const fb = root.querySelector('.feedback-row');
    const socialInject = root.querySelector('.wp-social-inject');
    const anchor = socialInject || fb;
    anchor ? root.insertBefore(wrap, anchor) : root.appendChild(wrap);

    // SVG elements are now in the DOM — draw
    _drawPendingTxGraphs();
  } catch {}
}

function _updateChatContextIndicator() {
  const pill    = document.getElementById('chat-context-pill');
  const clearBtn = document.getElementById('chat-ctx-clear-btn');
  const active  = !!_chatSocialContext;
  if (pill) {
    pill.textContent    = active ? `📡 ${_chatSocialContext.label}` : '';
    pill.style.display  = active ? 'inline-flex' : 'none';
  }
  if (clearBtn) clearBtn.style.display = active ? 'inline-block' : 'none';
}

function clearChatContext() {
  _chatSocialContext = null;
  _updateChatContextIndicator();
}

function setChatStreaming(active) {
  chatStreaming = active;
  document.getElementById('chat-send-btn').disabled = active;
  const stopBtn = document.getElementById('chat-stop-btn');
  if (stopBtn) stopBtn.style.display = active ? 'block' : 'none';
}

function stopChatStream() {
  if (chatAbortController) chatAbortController.abort();
}

// ── Model loader ───────────────────────────────────────────────────────────────

async function loadChatModels() {
  const sel = document.getElementById('chat-model-select');
  if (!sel || sel.dataset.loaded) return;
  try {
    const port = window._minerApiPort || 3456;
    const res  = await fetch(`http://localhost:${port}/api/models`);
    if (!res.ok) return;
    const data = await res.json();
    const models = (data.models || []).map(m => m.name || m.model).filter(Boolean);
    sel.innerHTML = '';
    if (!models.length) {
      sel.innerHTML = '<option value="">No models found</option>';
      return;
    }
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = opt.textContent = m;
      sel.appendChild(opt);
    }
    // Default to qwen if available
    const qwen = models.find(m => m.includes('qwen'));
    if (qwen) sel.value = qwen;
    sel.dataset.loaded = '1';
  } catch { /* Ollama not running */ }
}

// ── Markdown + Math rendering ─────────────────────────────────────────────────

function _mdParse(text) {
  if (typeof marked === 'undefined') {
    // Fallback: escape HTML and convert newlines
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  }

  // Protect math expressions from the markdown parser by replacing them
  // with unique placeholders, then restoring after marked runs.
  const math = [];
  const protect = (src) =>
    src
      // Display math: \[ ... \] and $$ ... $$
      .replace(/\\\[([\s\S]*?)\\\]/g,  m => { math.push(m); return `\x02MATH${math.length-1}\x03`; })
      .replace(/\$\$([\s\S]*?)\$\$/g,  m => { math.push(m); return `\x02MATH${math.length-1}\x03`; })
      // Inline math: \( ... \) and $ ... $
      .replace(/\\\(([\s\S]*?)\\\)/g,  m => { math.push(m); return `\x02IMATH${math.length-1}\x03`; })
      .replace(/(?<!\$)\$(?!\$)((?:[^$\n]|\\.)+?)\$/g, m => { math.push(m); return `\x02IMATH${math.length-1}\x03`; });

  const restore = (html) =>
    html
      .replace(/\x02MATH(\d+)\x03/g,  (_, i) => `<span class="math-display">${math[i]}</span>`)
      .replace(/\x02IMATH(\d+)\x03/g, (_, i) => `<span class="math-inline">${math[i]}</span>`);

  marked.setOptions({ breaks: true, gfm: true });
  return restore(marked.parse(protect(text)));
}

function _renderMath(el) {
  if (typeof renderMathInElement === 'undefined') return;
  renderMathInElement(el, {
    delimiters: [
      { left: '$$',   right: '$$',   display: true  },
      { left: '\\[',  right: '\\]',  display: true  },
      { left: '$',    right: '$',    display: false },
      { left: '\\(',  right: '\\)',  display: false },
    ],
    throwOnError: false,
    output: 'html',
  });
}

// ── Message rendering ──────────────────────────────────────────────────────────

function renderMessage(role, content, streaming = false) {
  const empty = document.getElementById('chat-empty');
  if (empty) empty.style.display = 'none';

  const msgs = document.getElementById('chat-messages');
  const wrap = document.createElement('div');
  wrap.className = `chat-msg ${role}`;
  wrap.dataset.role = role;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble._rawText = content || '';

  if (role === 'assistant') {
    bubble.innerHTML = _mdParse(bubble._rawText);
    if (!streaming && content) _renderMath(bubble);
  } else {
    // User messages: plain text (preserve newlines, no markdown)
    bubble.style.whiteSpace = 'pre-wrap';
    bubble.textContent = content;
  }

  if (streaming) {
    const cursor = document.createElement('span');
    cursor.className = 'chat-cursor';
    cursor.id = 'chat-cursor';
    bubble.appendChild(cursor);
  }

  const meta = document.createElement('div');
  meta.className = 'chat-meta';
  meta.textContent = role === 'user' ? 'You' : 'AI';

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return bubble;
}

function appendToLastBubble(token) {
  const msgs = document.getElementById('chat-messages');
  const last = msgs.querySelector('.chat-msg.assistant:last-child .chat-bubble');
  if (!last) return;

  last._rawText = (last._rawText || '') + token;
  last.innerHTML = _mdParse(last._rawText);

  // Re-attach blinking cursor
  const cur = document.createElement('span');
  cur.className = 'chat-cursor';
  cur.id = 'chat-cursor';
  const lastEl = last.lastElementChild;
  if (lastEl && ['P','LI','H1','H2','H3','H4','TD','BLOCKQUOTE'].includes(lastEl.tagName)) {
    lastEl.appendChild(cur);
  } else {
    last.appendChild(cur);
  }

  msgs.scrollTop = msgs.scrollHeight;
}

function finalizeLastBubble() {
  const msgs = document.getElementById('chat-messages');
  const last = msgs.querySelector('.chat-msg.assistant:last-child .chat-bubble');
  if (!last) return;

  document.getElementById('chat-cursor')?.remove();

  // Final render: full markdown + math
  if (last._rawText) {
    last.innerHTML = _mdParse(last._rawText);
    _renderMath(last);
  }
}

// ── Send + stream ──────────────────────────────────────────────────────────────

async function sendChatMessage() {
  if (chatStreaming) return;
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = '';
  input.disabled = true;
  setChatStreaming(true);

  chatHistory.push({ role: 'user', content: text });
  renderMessage('user', text);

  const sel   = document.getElementById('chat-model-select');
  const model = sel?.value || 'qwen2.5:1.5b';
  const port  = window._minerApiPort || 3456;

  renderMessage('assistant', '', true); // empty bubble with cursor

  chatAbortController = new AbortController();

  try {
    // Merge brain + social context into a SINGLE system message
    // (some models handle multiple system messages poorly)
    const systemParts = [];
    if (_brainSystemPrompt)         systemParts.push(_brainSystemPrompt);
    if (_chatSocialContext?.system) systemParts.push('\n\n=== CURRENT ADDRESS SOCIAL CONTEXT ===\n\n' + _chatSocialContext.system);
    const messagesWithContext = systemParts.length
      ? [{ role: 'system', content: systemParts.join('\n\n') }, ...chatHistory]
      : chatHistory;

    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: chatAbortController.signal,
      body: JSON.stringify({
        model,
        messages: messagesWithContext,
        stream: true,
        options: { temperature: 0.7 },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      appendToLastBubble(`[Error: ${err}]`);
      finalizeLastBubble();
      chatHistory.push({ role: 'assistant', content: `[Error: ${err}]` });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete line
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.error) {
            appendToLastBubble(`[Ollama error: ${evt.error}]`);
            fullResponse += `[Error: ${evt.error}]`;
            break;
          }
          const token = evt.message?.content || '';
          if (token) {
            appendToLastBubble(token);
            fullResponse += token;
          }
          if (evt.done) break;
        } catch { /* partial JSON */ }
      }
    }

    if (!fullResponse) appendToLastBubble('[No response — is Ollama running with the selected model?]');
    finalizeLastBubble();
    chatHistory.push({ role: 'assistant', content: fullResponse || '[no response]' });
  } catch (err) {
    if (err.name === 'AbortError') {
      // User interrupted — finalize whatever was streamed so far
      const msgs = document.getElementById('chat-messages');
      const last = msgs?.querySelector('.chat-msg.assistant:last-child .chat-bubble');
      const partial = last?._rawText || '';
      finalizeLastBubble();
      if (partial) chatHistory.push({ role: 'assistant', content: partial });
    } else {
      appendToLastBubble(`[Connection error: ${err.message}]`);
      finalizeLastBubble();
      chatHistory.push({ role: 'assistant', content: `[Error]` });
    }
  } finally {
    chatAbortController = null;
    setChatStreaming(false);
    input.disabled = false;
    input.focus();
  }
}

function clearChat() {
  chatHistory.length = 0;
  const msgs = document.getElementById('chat-messages');
  msgs.innerHTML = `
    <div class="chat-empty" id="chat-empty">
      <div class="chat-empty-icon">◈</div>
      <div>Chat with your local LLM</div>
      <div style="font-size:11px;color:#2a2a2a">Powered by Ollama · running on this machine</div>
    </div>`;
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Brain state (right panel) ──────────────────────────────────────────────────

let _brainLastLoaded = 0;

async function loadBrainState() {
  const port = window._minerApiPort || 3456;
  const now  = Date.now();
  if (now - _brainLastLoaded < 8000) return; // throttle
  _brainLastLoaded = now;

  try {
    const [stateRes, weightsRes, methodsRes] = await Promise.allSettled([
      fetch(`http://localhost:${port}/api/brain/state`, { timeout: 5000 }),
      fetch(`http://localhost:${port}/api/brain/weights`, { timeout: 5000 }),
      fetch(`http://localhost:${port}/methods`, { timeout: 5000 }),
    ]);

    if (stateRes.status === 'fulfilled' && stateRes.value.ok) {
      const s = await stateRes.value.json();
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.textContent = v; };
      // Active signals = live method count from /methods, not weights.json count
      set('brain-corrections', s.feedbackCount ?? '—');
      set('brain-model',       s.model || 'qwen2.5:1.5b');
      {
        const summary = (s.stateSummary || '').replace(/^#.*\n/m, '').trim().slice(0, 200);
        set('brain-state-summary', summary || '(no state yet)');
      }
      // Consolidation countdown (brain consolidates every 60 min)
      const minsLeft = Math.max(0, 60 - Math.floor((Date.now() % (60 * 60 * 1000)) / 60000));
      set('brain-consolidation', minsLeft + ' min');

      // Ollama status
      const dot = document.getElementById('brain-ollama-dot');
      const lbl = document.getElementById('brain-ollama-status');
      if (dot) dot.className = 'bdot on';
      if (lbl) lbl.textContent = 'Ollama running';
      const sdot = document.getElementById('brain-sync-dot');
      if (sdot) sdot.className = 'bdot on';
    }

    if (weightsRes.status === 'fulfilled' && weightsRes.value.ok) {
      const weights = await weightsRes.value.json();
      const top5 = Object.entries(weights)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);
      const container = document.getElementById('brain-top-signals');
      if (container) {
        container.innerHTML = top5.map(([id, w]) => `
          <div class="brain-signal-row">
            <span>${id.slice(0, 22)}</span>
            <span class="brain-weight">${w.toFixed(2)}</span>
          </div>`).join('') || '<div class="brain-signal-row" style="color:#374151;">No weights yet</div>';
      }
    }

    if (methodsRes.status === 'fulfilled' && methodsRes.value.ok) {
      const methods = await methodsRes.value.json();
      if (Array.isArray(methods)) {
        const el = document.getElementById('brain-signals');
        if (el) el.textContent = methods.length;
        // If weights are empty, show top methods by built-in score/weight
        const container = document.getElementById('brain-top-signals');
        if (container && container.textContent.includes('No weights yet') && methods.length > 0) {
          const top5 = methods
            .filter(m => m.score || m.weight)
            .sort((a, b) => (b.score || b.weight || 0) - (a.score || a.weight || 0))
            .slice(0, 5);
          if (top5.length) {
            container.innerHTML = top5.map(m => `
              <div class="brain-signal-row">
                <span>${(m.description || m.id || '').slice(0, 24)}</span>
                <span class="brain-weight">${(m.score || m.weight || 1).toFixed(2)}</span>
              </div>`).join('');
          }
        }
      }
    }
  } catch { /* Ollama / miner offline */ }
}

// Poll brain state every 15s
setInterval(loadBrainState, 15000);

// Poll live node status — updates all sidebar fields (wallet, peers, chain height, etc.)
// This is the primary data source when running without IPC (e.g. web mode or sandbox preload).
async function pollNodeStatus() {
  const port = window._minerApiPort || 3456;
  try {
    const res  = await fetch(`http://localhost:${port}/status`, { timeout: 4000 });
    if (!res.ok) return;
    const data = await res.json();
    updateStatus(data);
  } catch {}
}
setInterval(pollNodeStatus, 10000);

// ── Search (identity scanner) ──────────────────────────────────────────────────

let _searchPollTimer = null;

// Raw address patterns
const RAW_ADDR_RE = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}|T[1-9A-HJ-NP-Za-km-z]{33}|(EQ|UQ|kQ|0Q)[a-zA-Z0-9_-]{46}|G[A-Z2-7]{55})$/;
const DOMAIN_INPUT_RE = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;
// platform:handle or @handle — will be resolved via IdentityHub
const HANDLE_INPUT_RE = /^(@[a-zA-Z0-9_.-]{1,64}|[a-zA-Z]{2,15}:[a-zA-Z0-9_.-]{1,64})$/;

async function runSearch() {
  const input = document.getElementById('search-input');
  const address = (input?.value || '').trim();
  if (!address) { input?.focus(); return; }

  const isAddress = RAW_ADDR_RE.test(address);
  const isDomain  = DOMAIN_INPUT_RE.test(address) && !isAddress;
  const isHandle  = HANDLE_INPUT_RE.test(address) && !isAddress;

  if (isDomain || isHandle) {
    const resultEl = document.getElementById('search-result');
    if (resultEl) {
      const hint = isDomain
        ? 'Trying SPACEID · ZNS · Bonfida · IdentityHub.'
        : 'Looking up via IdentityHub (telegram, discord, twitter, farcaster…).';
      resultEl.style.display = 'block';
      resultEl.innerHTML = `<div class="result-card" style="border-color:#374151;">
        <div style="font-family:monospace;font-size:11px;color:#9ca3af;margin-bottom:8px;">
          🔍 Resolving <strong>${escHtml(address)}</strong>…
        </div>
        <div style="font-family:monospace;font-size:10px;color:#4b5563;">
          ${hint}
        </div>
      </div>`;
    }
  }

  const btn      = document.getElementById('search-btn');
  const loading  = document.getElementById('search-loading');
  const resultEl = document.getElementById('search-result');
  const statusTx = document.getElementById('search-status-text');

  if (_searchPollTimer) { clearInterval(_searchPollTimer); _searchPollTimer = null; }

  btn.disabled = true;
  loading.style.display = 'flex';
  resultEl.style.display = 'none';
  resultEl.innerHTML = '';

  const port = window._minerApiPort || 3456;

  try {
    statusTx.textContent = 'Submitting job…';
    const jobRes = await fetch(`http://localhost:${port}/job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'verdict', payload: { address } }),
    });

    if (!jobRes.ok) {
      const err = await jobRes.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${jobRes.status}`);
    }

    const { jobId } = await jobRes.json();
    if (!jobId) throw new Error('No jobId returned');

    statusTx.textContent = 'Scanning…';
    let attempts = 0;

    _searchPollTimer = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch(`http://localhost:${port}/job/${jobId}/result`, { timeout: 6000 });
        if (r.status === 202) { statusTx.textContent = `Scanning… (${attempts * 2}s)`; return; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!data.verdict) return;

        clearInterval(_searchPollTimer); _searchPollTimer = null;
        loading.style.display = 'none';
        btn.disabled = false;
        // Fetch social context + tx graph enrichment in background
        _fetchSocialContextForAddress(address);
        // Only try graph enrichment if profile graph is empty/missing
        if (!data.profile?.graph?.nodes?.length || data.profile.graph.nodes.length < 2) {
          _enrichResultWithGraph(address);
        }
        // Fetch brain weights for evidence map tile sizing (fast local read)
        let weightsMap = {};
        try {
          const wr = await fetch(`http://localhost:${port}/api/brain/weights`, { signal: AbortSignal.timeout(2000) });
          if (wr.ok) weightsMap = await wr.json();
        } catch {}
        try {
          renderSearchResult(resultEl, data, address, weightsMap);
        } catch (renderErr) {
          console.error('[Search] renderSearchResult threw:', renderErr);
          resultEl.style.display = 'block';
          resultEl.innerHTML = `<div class="result-card"><span style="color:#f87171;font-family:monospace;font-size:11px;">Render error: ${renderErr.message}</span></div>`;
        }
      } catch (pollErr) {
        if (attempts > 60) {
          clearInterval(_searchPollTimer); _searchPollTimer = null;
          loading.style.display = 'none';
          btn.disabled = false;
          resultEl.style.display = 'block';
          resultEl.innerHTML = `<div class="result-card"><span style="color:#f87171;font-family:monospace;font-size:11px;">Timed out — ${pollErr.message}</span></div>`;
        }
      }
    }, 2000);

  } catch (err) {
    loading.style.display = 'none';
    btn.disabled = false;
    resultEl.style.display = 'block';
    resultEl.innerHTML = `<div class="result-card"><span style="color:#f87171;font-family:monospace;font-size:11px;">Error: ${err.message}</span></div>`;
  }
}

// ── Profile rendering helpers ─────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtAddr(addr) {
  if (!addr || addr.length < 12) return addr || '—';
  return addr.slice(0, 8) + '…' + addr.slice(-6);
}

function fmtDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
}

function profileInitials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
}

function platformFavicon(platform, url) {
  const map = { farcaster:'https://warpcast.com/favicon.ico', lens:'https://hey.xyz/favicon.ico',
    ens:'https://app.ens.domains/favicon.ico', twitter:'https://x.com/favicon.ico',
    x:'https://x.com/favicon.ico', github:'https://github.com/favicon.ico',
    discord:'https://discord.com/favicon.ico', telegram:'https://telegram.org/favicon.ico' };
  if (map[platform?.toLowerCase()]) return map[platform.toLowerCase()];
  if (url) { try { return new URL(url).origin + '/favicon.ico'; } catch {} }
  return null;
}

function platformEmoji(platform) {
  const map = { farcaster:'🟣', lens:'🌿', ens:'🔷', twitter:'✖', x:'✖', github:'🐙',
    discord:'💬', telegram:'✈', website:'🌐', linkedin:'💼', snapshot:'🗳️' };
  return map[platform?.toLowerCase()] || '🔗';
}

// ── Section builders ──────────────────────────────────────────────────────────

function _profileHeader(p, address) {
  const name = p.displayName || fmtAddr(p.address || address);
  const initials = profileInitials(p.displayName || '');
  const avatar = p.avatar
    ? `<img src="${escHtml(p.avatar)}" class="wp-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  return `
    <div class="wp-header">
      <div class="wp-avatar-wrap">
        ${avatar}
        <div class="wp-avatar-fallback" ${p.avatar ? 'style="display:none"' : ''}>${escHtml(initials)}</div>
      </div>
      <div class="wp-header-info">
        <div class="wp-name">${escHtml(name)}</div>
        ${p.displayName ? `<div class="wp-addr-sub">${escHtml(fmtAddr(p.address || address))}</div>` : ''}
        ${p.bio ? `<div class="wp-bio">${escHtml(p.bio)}</div>` : ''}
      </div>
    </div>`;
}

function _profileBadges(p, verdict, conf, ofac, eu, uk) {
  const b = [];
  const badge = (cls, txt) => `<span class="wp-badge wp-badge-${cls}">${txt}</span>`;

  if (ofac?.sanctioned)       b.push(badge('danger', `⛔ OFAC — ${escHtml(ofac.name || '')}`));
  else if (ofac)              b.push(badge('ok', '✓ OFAC Clear'));
  if (eu?.sanctioned)         b.push(badge('danger', `⛔ EU — ${escHtml(eu.name || '')}`));
  else if (eu)                b.push(badge('ok', '✓ EU Clean'));
  if (uk?.sanctioned)         b.push(badge('danger', `⛔ UK — ${escHtml(uk.name || '')}`));
  else if (uk)                b.push(badge('ok', '✓ UK Clean'));

  const ensLink = p.links?.find(l => l.platform?.toLowerCase() === 'ens');
  const ensDom  = p.domains?.find(d => d.platform === 'ENS' || d.name?.endsWith('.eth'));
  const ensName = ensLink?.identity || ensDom?.name;
  if (ensName) b.push(badge('ok', `ENS: ${escHtml(ensName.slice(0, 14))}${ensName.length > 14 ? '…' : ''}`));

  const fc = p.links?.find(l => l.platform?.toLowerCase() === 'farcaster');
  if (fc) b.push(badge('ok', `🟣 ${escHtml(fc.identity || fc.displayName || '')}`));

  const ip = p.identityProtocols || {};
  if (ip.worldId)   b.push(badge('ok',   '🌍 World ID'));
  if (ip.poh)       b.push(badge('ok',   '⚖️ PoH'));
  if (ip.brightid)  b.push(badge('ok',   '🔆 BrightID'));
  if (ip.bab)       b.push(badge('ok',   '🏦 BAB KYC'));

  const ih = p.identityHub;
  if (ih) {
    const ihHuman = ih.identityHubHumanSignal;
    const ihStatus = ih.identityHubStatus;
    const ihLabel = ih.identityHubUsername ? `@${ih.identityHubUsername}` : 'IdentityHub';
    if (ihHuman) b.push(badge('ok', `🪪 ${escHtml(ihLabel)} · Human`));
    else if (ihStatus) b.push(badge('warn', `🪪 ${escHtml(ihLabel)} · ${escHtml(ihStatus)}`));
    else b.push(badge('warn', `🪪 ${escHtml(ihLabel)}`));
  }
  if (p.gitcoin)    b.push(badge(p.gitcoin.passing ? 'ok' : 'warn',
    `${p.gitcoin.passing ? '✓' : '⚠'} Gitcoin ${(p.gitcoin.score || 0).toFixed(1)}`));

  const vCls = verdict === 'HUMAN' ? 'human' : verdict === 'UNCERTAIN' ? 'warn' : 'danger';
  const vLbl = verdict === 'HUMAN' ? '✓ Verified Human' : verdict === 'UNCERTAIN' ? '? Uncertain' : '✗ Suspected Bot';
  b.push(`<span class="wp-badge wp-badge-${vCls}">${vLbl} <span class="wp-badge-conf">${conf}</span></span>`);

  return b.length ? `<div class="wp-badges">${b.join('')}</div>` : '';
}

function _identityProtocols(p) {
  const ip = p.identityProtocols || {};
  const cards = [];
  const card = (icon, name, status, ok, score) => `
    <div class="wp-id-card ${ok ? 'wp-id-ok' : score != null ? 'wp-id-warn' : 'wp-id-none'}">
      <div class="wp-id-icon">${icon}</div>
      <div class="wp-id-body">
        <div class="wp-id-name">${name}</div>
        <div class="wp-id-status">${status}</div>
        ${score != null ? `<div class="wp-score-bar"><div class="wp-score-fill" style="width:${Math.min(100,score)}%;background:${score>=50?'#22c55e':'#eab308'}"></div></div>` : ''}
      </div>
      ${ok ? '<span class="wp-id-check">✓</span>' : ''}
    </div>`;

  if (ip.worldId  != null) cards.push(card('🌍', 'World ID',          ip.worldId  ? 'Verified human' : 'Not verified',   ip.worldId,  null));
  if (ip.poh      != null) cards.push(card('⚖️', 'Proof of Humanity', ip.poh      ? 'Registered'     : 'Not registered', ip.poh,      null));
  if (ip.humanity != null) cards.push(card('🖐️', 'Humanity Protocol', ip.humanity ? 'Palm verified'  : 'Not verified',   ip.humanity, null));
  if (ip.brightid != null) cards.push(card('🔆', 'BrightID',          ip.brightid ? 'Verified unique' : 'Not verified',  ip.brightid, null));
  if (ip.bab      != null) cards.push(card('🏦', 'BAB Token',         ip.bab      ? 'Binance KYC'    : 'No BAB token',   ip.bab,      null));
  if (ip.humanTech!= null) cards.push(card('🤖', 'Human Protocol',    `Score: ${ip.humanTech?.score?.toFixed(0) ?? '—'}`, (ip.humanTech?.score||0)>=50, ip.humanTech?.score));
  if (ip.nomis    != null) cards.push(card('📊', 'Nomis',             `Score: ${ip.nomis?.score?.toFixed(0) ?? '—'}`,     (ip.nomis?.score||0)>=50,     ip.nomis?.score));

  if (!cards.length) return '';
  return `<div class="wp-section"><div class="wp-section-title">Identity Protocols</div><div class="wp-id-grid">${cards.join('')}</div></div>`;
}

function _domains(p) {
  if (!p.domains?.length) return '';
  const chips = p.domains.map(d => `
    <a class="wp-domain-chip" href="${escHtml(d.url || '#')}" target="_blank" rel="noopener">
      <span class="wp-domain-platform">${escHtml(d.platform)}</span>
      <span class="wp-domain-name">${escHtml(d.name)}</span>
    </a>`).join('');
  return `<div class="wp-section"><div class="wp-section-title">Web3 Domains</div><div class="wp-domains">${chips}</div></div>`;
}

function _socialLinks(p) {
  if (!p.links?.length) return '';
  const chips = p.links.map(l => {
    const fav = platformFavicon(l.platform, l.url);
    const icon = fav
      ? `<img src="${escHtml(fav)}" class="wp-social-logo" alt="${escHtml(l.platform)}" onerror="this.style.display='none'">`
      : `<span class="wp-social-emoji">${platformEmoji(l.platform)}</span>`;
    const av = l.avatar ? `<img src="${escHtml(l.avatar)}" class="wp-social-av" onerror="this.style.display='none'">` : '';
    return `<a class="wp-social-chip" href="${escHtml(l.url || '#')}" target="_blank" rel="noopener" title="${escHtml(l.description || l.displayName || '')}">
      ${icon}${av}<span class="wp-social-id">${escHtml(l.identity || l.displayName || '')}</span>
    </a>`;
  }).join('');
  return `<div class="wp-section"><div class="wp-section-title">Profiles</div><div class="wp-socials">${chips}</div></div>`;
}

function _activity(p) {
  if (!p.txStats) return '';
  const s = p.txStats;
  const box = (label, val, link) => `
    <div class="wp-stat-box">
      <div class="wp-stat-label">${label}</div>
      <div class="wp-stat-val">${escHtml(String(val ?? '—'))}</div>
      ${link ? `<a href="${escHtml(link)}" target="_blank" rel="noopener" class="wp-stat-link">↗</a>` : ''}
    </div>`;
  return `<div class="wp-section"><div class="wp-section-title">Activity</div>
    <div class="wp-stats-row">
      ${box('Total Txs', s.total?.toLocaleString())}
      ${box('First Tx', fmtDate(s.firstTx?.ts), s.firstTx?.hash ? `https://etherscan.io/tx/${s.firstTx.hash}` : null)}
      ${box('Last Tx',  fmtDate(s.lastTx?.ts),  s.lastTx?.hash  ? `https://etherscan.io/tx/${s.lastTx.hash}`  : null)}
    </div>
  </div>`;
}

function _associatedWallets(p) {
  if (!p.associatedWallets?.length) return '';
  const rows = p.associatedWallets.map(w => `
    <div class="wp-assoc-row">
      <span>🔐</span>
      <a href="https://app.safe.global/home?safe=eth:${escHtml(w)}" target="_blank" rel="noopener" class="wp-assoc-addr">${escHtml(fmtAddr(w))}</a>
      <a href="https://etherscan.io/address/${escHtml(w)}" target="_blank" rel="noopener" class="wp-stat-link">↗</a>
    </div>`).join('');
  return `<div class="wp-section"><div class="wp-section-title">Associated Wallets <span class="wp-section-hint">Safe multisig signer</span></div>${rows}</div>`;
}

function _crossChain(p) {
  const cards = [];
  if (p.bitcoin) cards.push(`<div class="wp-cc-card"><div class="wp-cc-head">₿ Bitcoin</div>
    <div class="wp-cc-row">Txs: <b>${p.bitcoin.txCount?.toLocaleString() ?? '—'}</b></div>
    <div class="wp-cc-row">Balance: <b>${((p.bitcoin.balance||0)/1e8).toFixed(8)} BTC</b></div>
    ${p.bitcoin.explorer ? `<a href="${escHtml(p.bitcoin.explorer)}" target="_blank" class="wp-cc-link">mempool.space ↗</a>` : ''}</div>`);
  if (p.tron) cards.push(`<div class="wp-cc-card"><div class="wp-cc-head">⚡ TRON</div>
    <div class="wp-cc-row">TRX: <b>${p.tron.trxBalance?.toFixed(2) ?? '—'}</b></div>
    <div class="wp-cc-row">USDT: <b>${p.tron.usdtBalance?.toFixed(2) ?? '—'}</b></div>
    ${p.tron.explorer ? `<a href="${escHtml(p.tron.explorer)}" target="_blank" class="wp-cc-link">tronscan ↗</a>` : ''}</div>`);
  if (p.ton) cards.push(`<div class="wp-cc-card"><div class="wp-cc-head">◆ TON</div>
    <div class="wp-cc-row">Balance: <b>${p.ton.balance?.toFixed(2) ?? '—'} TON</b></div>
    ${p.ton.hasDomain ? '<div class="wp-cc-row">.ton domain ✓</div>' : ''}
    ${p.ton.explorer ? `<a href="${escHtml(p.ton.explorer)}" target="_blank" class="wp-cc-link">tonscan ↗</a>` : ''}</div>`);
  if (p.xlm) cards.push(`<div class="wp-cc-card"><div class="wp-cc-head">✦ Stellar</div>
    <div class="wp-cc-row">XLM: <b>${p.xlm.xlmBalance?.toFixed(2) ?? '—'}</b></div>
    ${p.xlm.homeDomain ? `<div class="wp-cc-row">Domain: ${escHtml(p.xlm.homeDomain)}</div>` : ''}
    ${p.xlm.explorer ? `<a href="${escHtml(p.xlm.explorer)}" target="_blank" class="wp-cc-link">stellarchain ↗</a>` : ''}</div>`);
  if (!cards.length) return '';
  return `<div class="wp-section"><div class="wp-section-title">Cross-chain Activity</div><div class="wp-cc-grid">${cards.join('')}</div></div>`;
}

let _txGraphSeq = 0;
const _txGraphPending = new Map(); // svgId → graph data

function _txGraph(p) {
  if (!p.graph?.nodes?.length || p.graph.nodes.length < 2) return '';
  const all   = p.graph.nodes;
  const edges = p.graph.edges || [];
  const id    = 'txg-' + (++_txGraphSeq);
  const hop2Count = all.filter(n => n.hop === 2).length;
  const hint  = `2-hop · ${all.length} nodes · ${edges.length} edges`;

  // Store graph data so _drawPendingTxGraphs can pick it up after innerHTML is set
  _txGraphPending.set(id, p.graph);

  return `<div class="wp-section">
    <div class="wp-section-title">Transaction Graph <span class="wp-section-hint">${escHtml(hint)}</span></div>
    <div class="txg-wrap" id="${id}-wrap">
      <svg class="txg-svg" id="${id}"></svg>
      <div class="txg-legend">
        <span class="txg-legend-dot" style="background:#22c55e;box-shadow:0 0 0 1.5px #4ade80"></span>center
        <span class="txg-legend-dot" style="background:#111827;box-shadow:0 0 0 1.5px #374151;margin-left:6px"></span>1-hop
        ${hop2Count ? `<span class="txg-legend-dot" style="background:#0a0a0a;box-shadow:0 0 0 1px #1f2937;width:5px;height:5px;margin-left:6px"></span>2-hop` : ''}
      </div>
      <div class="txg-tooltip" id="${id}-tip" style="display:none">
        <span class="txg-tooltip-addr" id="${id}-tip-addr"></span>
        <button class="txg-tooltip-scan" onclick="_txGraphScan('${id}')">Scan</button>
      </div>
    </div>
  </div>`;
}

// Call after any innerHTML assignment that may contain a tx graph
function _drawPendingTxGraphs() {
  for (const [id, graph] of _txGraphPending) {
    if (document.getElementById(id)) {
      _drawTxGraphD3(id, graph);
      _txGraphPending.delete(id);
    }
  }
}

// Called after _txGraph HTML is inserted into the DOM.
function _drawTxGraphD3(svgId, graph) {
  if (typeof d3 === 'undefined' || !graph?.nodes?.length) return;

  const svgEl  = document.getElementById(svgId);
  const wrapEl = document.getElementById(svgId + '-wrap');
  const tipEl  = document.getElementById(svgId + '-tip');
  const tipAddr = document.getElementById(svgId + '-tip-addr');
  if (!svgEl || !wrapEl) return;

  const W = wrapEl.clientWidth  || 520;
  const H = wrapEl.clientHeight || 300;

  const nodes = graph.nodes.map(n => ({ ...n }));
  const edges = (graph.edges || []).map(e => ({ ...e }));

  const svg = d3.select(svgEl).attr('width', W).attr('height', H);

  // Arrow marker
  svg.append('defs').append('marker')
    .attr('id', svgId + '-arrow')
    .attr('viewBox', '0 -4 8 8').attr('refX', 16).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', '#1f2937');

  const g = svg.append('g');

  svg.call(d3.zoom().scaleExtent([0.25, 4]).on('zoom', e => g.attr('transform', e.transform)));

  // Close tooltip when clicking background
  svg.on('click', () => { if (tipEl) tipEl.style.display = 'none'; });

  const isHop2Edge = e => {
    const srcId = e.source?.id ?? e.source;
    const src   = nodes.find(n => n.id === srcId);
    return src?.hop === 1;
  };

  const hop1Edges = edges.filter(e => !isHop2Edge(e));
  const hop2Edges = edges.filter(isHop2Edge);

  // Draw edges (hop2 dashed, below hop1)
  const linkHop2 = g.append('g').selectAll('line').data(hop2Edges).join('line')
    .attr('class', 'txg-edge txg-edge-hop2').attr('marker-end', `url(#${svgId}-arrow)`);
  const linkHop1 = g.append('g').selectAll('line').data(hop1Edges).join('line')
    .attr('class', 'txg-edge').attr('marker-end', `url(#${svgId}-arrow)`);

  // Draw nodes
  const nodeG = g.append('g').selectAll('g').data(nodes).join('g').style('cursor', d => d.hop === 0 ? 'default' : 'pointer');

  nodeG.append('circle')
    .attr('r', d => d.hop === 0 ? 14 : d.hop === 2 ? 5 : 8)
    .attr('class', d => d.hop === 0 ? 'txg-node-center' : d.hop === 2 ? 'txg-node-hop2' : 'txg-node-hop1');

  nodeG.append('text')
    .attr('dy', d => d.hop === 0 ? 26 : d.hop === 2 ? 14 : 18)
    .attr('text-anchor', 'middle')
    .attr('class', d => d.hop === 0 ? 'txg-label-center' : d.hop === 2 ? 'txg-label-hop2' : 'txg-label')
    .text(d => {
      const addr = d.id || '';
      if (d.hop === 2) return addr.slice(0, 5) + '…';
      if (addr.length > 10) return addr.slice(0, 6) + '…' + addr.slice(-4);
      return addr;
    });

  // Drag
  nodeG.call(d3.drag()
    .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag',  (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
    .on('end',   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
  );

  // Click → tooltip
  nodeG.filter(d => d.hop !== 0).on('click', (ev, d) => {
    ev.stopPropagation();
    if (!tipEl || !tipAddr) return;
    const rect   = wrapEl.getBoundingClientRect();
    const svgRect = svgEl.getBoundingClientRect();
    tipAddr.textContent = d.id;
    tipEl.dataset.addr  = d.id;
    tipEl.style.display = 'flex';
    tipEl.style.left    = (ev.clientX - svgRect.left + 12) + 'px';
    tipEl.style.top     = (ev.clientY - svgRect.top  - 10) + 'px';
  });

  // Force simulation
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id)
      .distance(d => {
        const srcId = d.source?.id ?? d.source;
        const src   = nodes.find(n => n.id === srcId);
        return src?.hop === 1 ? 65 : 105;
      }))
    .force('charge', d3.forceManyBody().strength(d => d.hop === 2 ? -60 : -180))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(d => d.hop === 2 ? 14 : 22));

  sim.on('tick', () => {
    const setLine = sel => sel
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    setLine(linkHop1);
    setLine(linkHop2);
    nodeG.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // Store sim handle for cleanup if the section is replaced
  svgEl._sim = sim;
}

// Called by the Scan button inside the tooltip
function _txGraphScan(svgId) {
  const tip  = document.getElementById(svgId + '-tip');
  const addr = tip?.dataset?.addr;
  if (!addr) return;
  tip.style.display = 'none';
  const inp = document.getElementById('search-input');
  if (inp) { inp.value = addr; inp.dispatchEvent(new Event('input')); }
  // Trigger scan if doSearch exists
  if (typeof doSearch === 'function') doSearch();
}

// ── Evidence market map ───────────────────────────────────────────────────────

function _treemap(items, x, y, w, h) {
  if (!items.length) return [];
  if (items.length === 1) return [{ ...items[0], x, y, w, h }];
  const total = items.reduce((s, i) => s + i.value, 0);
  let acc = 0, split = 1;
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].value / total;
    split = i + 1;
    if (acc >= 0.5) break;
  }
  const ratio = items.slice(0, split).reduce((s, i) => s + i.value, 0) / total;
  if (w >= h) {
    const lw = w * ratio;
    return [
      ..._treemap(items.slice(0, split), x, y, lw, h),
      ..._treemap(items.slice(split), x + lw, y, w - lw, h),
    ];
  } else {
    const th = h * ratio;
    return [
      ..._treemap(items.slice(0, split), x, y, w, th),
      ..._treemap(items.slice(split), x, y + th, w, h - th),
    ];
  }
}

function _evidenceMap(signals, weights = {}) {
  if (!signals.length) return '';
  const real = signals.filter(s => s.methodId !== 'ofac_check');
  if (!real.length) return '';
  const items = real
    .map(s => ({ ...s, value: Math.max(+(weights[s.methodId] ?? s.weight ?? 1), 0.1) }))
    .sort((a, b) => b.value - a.value);
  const tiles  = _treemap(items, 0, 0, 100, 100);
  const passed = real.filter(s => s.result !== false).length;
  const tileHtml = tiles.map(t => {
    const cls  = t.result !== false ? 'em-pass' : 'em-fail';
    const wt   = +(weights[t.methodId] ?? t.weight ?? 1).toFixed(2);
    const tip  = escHtml(`${t.description || t.methodId} | ${t.result !== false ? 'PASS' : 'FAIL'} | weight ${wt}`);
    const lbl  = (t.w > 11 && t.h > 22)
      ? `<span class="em-lbl">${escHtml(t.methodId)}</span>` : '';
    return `<div class="em-tile ${cls}" title="${tip}"
      style="left:${t.x.toFixed(2)}%;top:${t.y.toFixed(2)}%;width:${t.w.toFixed(2)}%;height:${t.h.toFixed(2)}%">${lbl}</div>`;
  }).join('');
  return `
    <div class="em-section">
      <div class="em-hdr"><span class="em-title">Evidence</span><span class="em-ct">${passed}/${real.length} passed</span></div>
      <div class="em-map">${tileHtml}</div>
    </div>`;
}

function _socialChar(vibeData, farcasterData, paragraphData) {
  if (!vibeData && !farcasterData && !paragraphData) return '';
  const vd = vibeData || {};
  const topics = (vd.topics || []).map(t => `<span class="char-topic">${escHtml(t)}</span>`).join('');
  const sigs   = (vd.humanSignals || []).map(s => `<li>${escHtml(s)}</li>`).join('');
  const casts  = (farcasterData?.casts || []).slice(0, 4).map(c => `
    <div class="char-cast">
      <span class="char-cast-text">${escHtml(c.text)}</span>
      ${c.likes||c.replies ? `<span class="char-cast-meta">${c.likes?`♥${c.likes}`:''}${c.replies?` ·${c.replies}r`:''}</span>` : ''}
    </div>`).join('');
  const arts = (paragraphData?.posts || []).slice(0, 4).map(p => `
    <div class="char-article"><span class="char-article-title">${escHtml(p.title)}</span>${p.subtitle?`<span class="char-article-sub"> — ${escHtml(p.subtitle)}</span>`:''}</div>`).join('');

  return `
    <div class="wp-section">
      <div class="wp-section-title">Social Characteristic</div>
      ${vd.vibe ? `<p class="char-text">${escHtml(vd.vibe)}</p>` : ''}
      ${topics  ? `<div class="char-topics">${topics}</div>` : ''}
      ${sigs    ? `<ul class="char-signals">${sigs}</ul>` : ''}
      ${farcasterData ? `
        <div class="char-source">
          <div class="char-source-label">🟣 Farcaster — @${escHtml(farcasterData.username||'')}
            <span class="char-follow-meta">${(farcasterData.followerCount||0).toLocaleString()} followers</span></div>
          ${farcasterData.bio ? `<div class="char-bio">"${escHtml(farcasterData.bio)}"</div>` : ''}
          ${casts}
        </div>` : ''}
      ${paragraphData ? `
        <div class="char-source">
          <div class="char-source-label">✍️ Paragraph — ${escHtml(paragraphData.title||'')}
            <span class="char-follow-meta">${(paragraphData.subscriberCount||0).toLocaleString()} subscribers</span></div>
          ${paragraphData.description ? `<div class="char-bio">"${escHtml(paragraphData.description)}"</div>` : ''}
          ${arts}
        </div>` : ''}
    </div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderSearchResult(container, data, address, weights = {}) {
  const v       = (data.verdict || 'UNCERTAIN').toUpperCase();
  const cls     = v === 'HUMAN' ? 'human' : v === 'AI' ? 'ai' : 'uncertain';
  const cardCls = v === 'HUMAN' ? 'human-result' : v === 'AI' ? 'ai-result' : '';
  const conf    = data.confidence != null ? Math.round(data.confidence * 100) + '%' : '—';
  const signals = data.evidence?.signalsUsed || data.signalsUsed || [];
  const profile = data.profile || {};
  const model   = data.evidence?.modelUsed || data.modelUsed || '';

  // Unresolvable domain/username / no-signal fallback
  const tooFew = signals.length <= 1 && (data.evidence?.methodsCount > 10 || 0);
  if (tooFew || (signals.length === 1 && !signals[0]?.methodId)) {
    const isAddr = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}|(EQ|UQ)[A-Za-z0-9+/=_-]{46})/i.test(address);
    const isDomain   = !isAddr && address.includes('.') && !address.startsWith('@') && !address.includes(':');
    const isHandle   = !isAddr && !isDomain && (address.startsWith('@') || /^[a-zA-Z]{2,15}:/.test(address));
    const isUsername = !isAddr && !isDomain && !isHandle;
    const hint = isDomain
      ? `Domain <b>${escHtml(address)}</b> could not be resolved.<br>Try the raw wallet address.`
      : isHandle
        ? `Handle <b>${escHtml(address)}</b> not found in IdentityHub.<br>Try telegram:username, @username, or the raw wallet address.`
        : isUsername
          ? `Username <b>${escHtml(address)}</b> not found in IdentityHub.<br>Try the raw wallet address.`
          : 'Address format not recognised.';
    container.style.display = 'block';
    container.innerHTML = `<div class="result-card" style="border-color:#374151;">
      <div style="font-family:monospace;font-size:12px;color:#f59e0b;margin-bottom:8px;">⚠ Could not evaluate query</div>
      <div style="font-family:monospace;font-size:11px;color:#6b7280;line-height:1.6;">${hint}</div></div>`;
    return;
  }

  const ofac = data.ofac || signals.find(s => s.methodId === 'ofac_check')?.ofac || null;
  const eu   = data.eu  || null;
  const uk   = data.uk  || null;
  const label = v === 'HUMAN' ? 'VERIFIED HUMAN' : v === 'AI' ? 'SUSPECTED BOT' : 'UNCERTAIN';

  container.style.display = 'block';
  container.innerHTML = `
    <div class="wp-root">

      ${_profileHeader(profile, address)}

      ${_profileBadges(profile, v, conf, ofac, eu, uk)}

      <!-- AI reasoning + model -->
      <div class="wp-reasoning-block ${cardCls}">
        <p class="brain-reasoning">${escHtml(data.reasoning || '—')}</p>
        ${model ? `<div class="wp-model-line">Powered by ${escHtml(model)}</div>` : ''}
        ${data.resolvedAddress ? `<div class="wp-model-line">↳ resolved from ${escHtml(fmtAddr(data.resolvedAddress))}</div>` : ''}
      </div>

      ${_identityProtocols(profile)}
      ${_domains(profile)}
      ${_socialLinks(profile)}
      ${_activity(profile)}
      ${_associatedWallets(profile)}
      ${_crossChain(profile)}
      ${_txGraph(profile)}
      ${_evidenceMap(signals, weights)}
      ${_socialChar(data.vibeData, data.farcasterData, data.paragraphData)}

      <div class="feedback-row">
        <button class="feedback-btn" onclick="submitFeedback('correct')">👍 Correct</button>
        <button class="feedback-btn" onclick="submitFeedback('dispute')">👎 Dispute</button>
      </div>
    </div>`;

  // Draw D3 tx graph(s) now that the SVG elements exist in the DOM
  _drawPendingTxGraphs();
}

function submitFeedback(type) {
  const btn = event.currentTarget;
  btn.textContent = type === 'correct' ? '✓ Logged' : '✓ Dispute sent';
  btn.style.color = '#22c55e';
  btn.style.borderColor = 'rgba(34,197,94,0.4)';
}

// ── Send / Receive ─────────────────────────────────────────────────────────────

let _sendWalletAddr = '';
let _sendWalletPoh  = 0;

function syncSendWallet() {
  const addr = window._localWallet || '';
  _sendWalletAddr = addr;
  const fromEl = document.getElementById('send-from-addr');
  if (fromEl) fromEl.textContent = addr || 'Not available';

  // Fetch current balance
  const port = window._minerApiPort || 3456;
  if (!addr) return;
  fetch(`http://localhost:${port}/api/wallet/balance?address=${encodeURIComponent(addr)}`)
    .then(r => r.json())
    .then(data => {
      const POH_DECIMALS = 1_000_000_000;
      _sendWalletPoh = (data.balance || 0) / POH_DECIMALS;
      const str = _sendWalletPoh.toFixed(4) + ' POH';
      const el = document.getElementById('send-balance');
      if (el) el.textContent = str;
      const rel = document.getElementById('receive-balance');
      if (rel) rel.textContent = str;
    })
    .catch(() => {});
}

function setSendAmount(n) {
  const el = document.getElementById('send-amount');
  if (el) { el.value = n; updateSendSummary(); }
}

function setSendMax() {
  const el = document.getElementById('send-amount');
  if (el) { el.value = Math.max(0, _sendWalletPoh - 0.001).toFixed(4); updateSendSummary(); }
}

function updateSendSummary() {
  const amount = parseFloat(document.getElementById('send-amount')?.value || '0') || 0;
  const to = (document.getElementById('send-to')?.value || '').trim();
  const dispEl = document.getElementById('amount-display');
  if (dispEl) dispEl.textContent = amount > 0 ? amount.toFixed(2) : '0.00';
  const sumAmt = document.getElementById('summary-amount');
  const sumTo  = document.getElementById('summary-to');
  if (sumAmt) sumAmt.textContent = amount > 0 ? amount.toFixed(4) + ' POH' : '—';
  if (sumTo)  sumTo.textContent  = to.length > 16 ? to.slice(0, 8) + '…' + to.slice(-6) : (to || '—');
}

function syncHomeBalance() {
  const bal = document.getElementById('poh-wallet-balance')?.textContent || '';
  const addr = window._localWallet || '';
  const numEl = document.getElementById('home-balance-num');
  const addrEl = document.getElementById('home-balance-addr');
  if (numEl && bal) numEl.textContent = bal.replace(' POH', '');
  if (addrEl && addr) addrEl.textContent = addr.length > 16 ? addr.slice(0, 8) + '…' + addr.slice(-6) : addr;
}

async function executeSend() {
  const to     = (document.getElementById('send-to')?.value || '').trim();
  const amount = parseFloat(document.getElementById('send-amount')?.value || '0');
  const btn    = document.getElementById('send-btn');
  const res    = document.getElementById('send-result');

  const isValidAddr = a => /^poh[0-9a-f]{40}$/i.test(a) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  if (!_sendWalletAddr)  { showSendResult(res, false, 'No wallet loaded — start the miner first'); return; }
  if (!to)               { showSendResult(res, false, 'Enter a recipient address'); return; }
  if (!isValidAddr(to))  { showSendResult(res, false, 'Invalid address — must be a PoH or Solana wallet address'); return; }
  if (!(amount > 0))     { showSendResult(res, false, 'Enter a valid amount'); return; }
  if (amount > _sendWalletPoh) { showSendResult(res, false, `Insufficient balance (${_sendWalletPoh.toFixed(4)} POH available)`); return; }

  btn.disabled = true;
  btn.textContent = 'Sending…';
  res.style.display = 'none';

  const port = window._minerApiPort || 3456;
  try {
    // On-chain send: node builds + signs the PoHTransaction using the wallet's stored signing key,
    // submits to mempool, and gossips to all peers. Returns txHash + status:'pending'.
    const r = await fetch(`http://localhost:${port}/api/wallet/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: _sendWalletAddr, to, amount }),
    });
    const data = await r.json();
    if (r.ok && data.success) {
      const hashShort = data.txHash ? data.txHash.slice(0, 12) + '…' : '';
      showSendResult(res, true, `Submitted ${amount} POH → ${to.slice(0, 12)}… ${hashShort ? '(tx: ' + hashShort + ')' : ''} — pending block`);
      document.getElementById('send-to').value = '';
      document.getElementById('send-amount').value = '';
      updateSendSummary();
      // Refresh balance after expected block time
      setTimeout(syncSendWallet, 12000);
    } else {
      showSendResult(res, false, data.error || 'Transaction failed');
    }
  } catch (err) {
    if (err.message.includes('fetch') || err.message.includes('Failed')) {
      showSendResult(res, false, 'Cannot connect to miner — make sure it is running');
    } else {
      showSendResult(res, false, err.message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm & Send';
  }
}

function showSendResult(el, ok, msg) {
  if (!el) return;
  el.className = 'send-result ' + (ok ? 'ok' : 'err');
  el.textContent = (ok ? '✓ ' : '✗ ') + msg;
  el.style.display = 'block';
}

// ── Send / Receive toggle ──────────────────────────────────────────────────────

function showSendView() {
  document.getElementById('send-view')?.classList.remove('hidden');
  document.getElementById('receive-view')?.classList.remove('active');
  document.getElementById('sr-send-btn')?.classList.add('active');
  document.getElementById('sr-recv-btn')?.classList.remove('active');
}

function showReceiveView() {
  document.getElementById('send-view')?.classList.add('hidden');
  document.getElementById('receive-view')?.classList.add('active');
  document.getElementById('sr-recv-btn')?.classList.add('active');
  document.getElementById('sr-send-btn')?.classList.remove('active');
  populateReceiveView();
}

function populateReceiveView() {
  const addr = window._localWallet || '';
  const addrEl = document.getElementById('receive-addr-text');
  if (addrEl) addrEl.textContent = addr || 'Wallet address not available';

  // Sync balance
  const balEl = document.getElementById('receive-balance');
  if (balEl) balEl.textContent = document.getElementById('send-balance')?.textContent || '0 POH';

  // Draw QR code
  if (addr) drawQR('receive-qr', addr);
}

function copyReceiveAddr() {
  const addr = window._localWallet || '';
  if (!addr) return;
  navigator.clipboard.writeText(addr).catch(() => {
    // Electron fallback
    const el = document.createElement('textarea');
    el.value = addr;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  });
  const btn = document.getElementById('receive-copy-btn');
  if (!btn) return;
  btn.textContent = '✓ COPIED';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = 'COPY ADDRESS'; btn.classList.remove('copied'); }, 2000);
}

// ── QR code rendering ─────────────────────────────────────────────────────────
// Uses the Node.js `qrcode` library via contextBridge (preload.js).
// Falls back to showing the address text if generation fails.

async function drawQR(canvasId, text) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !text) return;
  try {
    const dataUrl = await window.pohMinerAPI.generateQR(text, canvas.width || 220);
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = dataUrl;
  } catch (e) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.font = '11px monospace';
    ctx.fillText('QR error', 10, 110);
  }
}

// ── Skills tab ─────────────────────────────────────────────────────────────────

function skillsView(view) {
  document.getElementById('skills-browse-view').style.display = view === 'browse' ? 'block' : 'none';
  document.getElementById('skills-submit-view').style.display = view === 'submit' ? 'flex' : 'none';
  document.getElementById('skills-browse-btn').style.color   = view === 'browse' ? '#22c55e' : '#aaa';
  document.getElementById('skills-submit-btn').style.color   = view === 'submit' ? '#22c55e' : '#aaa';
  if (view === 'browse') loadSkills();
}

async function loadSkills() {
  const port = window._minerApiPort || 3456;
  try {
    const res = await fetch(`http://localhost:${port}/api/skills`);
    if (!res.ok) return;
    const { skills } = await res.json();
    const activeEl   = document.getElementById('skills-active-list');
    const proposedEl = document.getElementById('skills-proposed-list');
    const emptyEl    = document.getElementById('skills-empty');
    activeEl.innerHTML = '';
    proposedEl.innerHTML = '';

    const active   = skills.filter(s => s.status === 'active');
    const proposed = skills.filter(s => s.status !== 'active' && s.status !== 'deprecated');

    if (!active.length && !proposed.length) { emptyEl.style.display = 'block'; return; }
    emptyEl.style.display = 'none';

    const card = (s) => `
      <div style="background:#0c0c0c;border:1px solid #1e1e1e;border-radius:6px;padding:10px 12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:12px;font-weight:600;color:#fff;">${s.id}</span>
          <span style="font-size:10px;color:${s.status === 'active' ? '#22c55e' : '#666'};border:1px solid;border-color:${s.status === 'active' ? '#1a3a27' : '#252525'};border-radius:3px;padding:1px 6px;">${s.status || 'proposed'}</span>
        </div>
        <div style="font-size:11px;color:#555;">${s.description || ''}</div>
        ${s.author ? `<div style="font-size:10px;color:#333;margin-top:4px;">by ${s.author.slice(0, 20)}…</div>` : ''}
      </div>`;
    active.forEach(s => { activeEl.innerHTML += card(s); });
    proposed.forEach(s => { proposedEl.innerHTML += card(s); });
  } catch (e) {
    document.getElementById('skills-empty').style.display = 'block';
    document.getElementById('skills-empty').textContent = 'Could not reach miner API';
  }
}

async function submitSkill() {
  const port    = window._minerApiPort || 3456;
  const id      = document.getElementById('skill-id-input').value.trim();
  const desc    = document.getElementById('skill-desc-input').value.trim();
  const ep      = document.getElementById('skill-endpoints-input').value.trim();
  const code    = document.getElementById('skill-code-input').value.trim();
  const context = document.getElementById('skill-context-input').value.trim();
  const resultEl = document.getElementById('skill-submit-result');

  if (!id) { resultEl.style.display = 'block'; resultEl.style.color = '#ef4444'; resultEl.textContent = 'Skill ID required'; return; }
  resultEl.style.display = 'none';

  const manifest = {
    id,
    version: '1.0.0',
    description: desc,
    allowedEndpoints: ep ? ep.split(',').map(s => s.trim()) : [],
    stateId: null,
  };

  try {
    const res = await fetch(`http://localhost:${port}/api/skills/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest, code: code || null, context: context || null }),
    });
    const data = await res.json();
    resultEl.style.display = 'block';
    if (data.ok) {
      resultEl.style.color = '#22c55e';
      resultEl.textContent = `Proposed: ${id}`;
    } else {
      resultEl.style.color = '#ef4444';
      resultEl.textContent = data.error || 'Failed';
    }
  } catch (e) {
    resultEl.style.display = 'block';
    resultEl.style.color = '#ef4444';
    resultEl.textContent = e.message;
  }
}

