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

  // Auto-scroll
  logContent.scrollTop = logContent.scrollHeight;

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

  // PoH Wallet (primary)
  const pohAddrEl = document.getElementById('poh-wallet-address');
  const pohBalEl = document.getElementById('poh-wallet-balance');

  if (status.pohWallet || status.wallet) {
    const addr = status.pohWallet || status.wallet;
    if (pohAddrEl) pohAddrEl.textContent = addr;
  }

  const POH_DECIMALS = 1_000_000_000;
  const rawBal = typeof status.pohBalance === 'number' ? status.pohBalance
               : typeof status.balance === 'number'    ? status.balance
               : null;
  if (rawBal !== null && pohBalEl) {
    const poh = rawBal / POH_DECIMALS;
    pohBalEl.textContent = poh.toFixed(poh < 1 ? 4 : 2) + ' POH';
  }

  // Solana identity
  const solEl = document.getElementById('solana-address');
  if (solEl && status.solanaAddress) {
    solEl.textContent = status.solanaAddress;
  }

  // Legacy elements (keep for compatibility)
  const walletAddressEl = document.getElementById('wallet-address');
  const walletBalanceEl = document.getElementById('wallet-balance');
  if (walletAddressEl && status.wallet) walletAddressEl.textContent = status.wallet;
  if (walletBalanceEl && rawBal !== null) {
    walletBalanceEl.textContent = (rawBal / POH_DECIMALS).toFixed(4) + ' POH';
  }

  if (typeof status.chainHeight === 'number') {
    chainHeightEl.textContent = status.chainHeight;
  }

  if (typeof status.reputation === 'number') {
    reputationEl.textContent = status.reputation.toFixed(2);
  }

  if (status.qualityStats) {
    validSubEl.textContent = status.qualityStats.validSubmissions || 0;
    invalidSubEl.textContent = status.qualityStats.invalidSubmissions || 0;
  }
}

// Listen for live logs
if (window.pohMinerAPI) {
  window.pohMinerAPI.onLog((message) => {
    addLog(message);
  });

  window.pohMinerAPI.onStatus((status) => {
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

  window.pohMinerAPI.getStatus().then(updateStatus);
} else {
  // Fallback for development
  addLog('[UI] Running outside Electron. IPC not available.');
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
  try {
    const status = await window.pohMinerAPI.getStatus?.();
    if (status) {
      const addrEl = document.getElementById('settings-poh-address');
      const solInput = document.getElementById('settings-solana');

      if (addrEl) addrEl.textContent = status.pohWallet || status.wallet || '—';
      if (solInput) solInput.value = status.solanaAddress || '';
    }
  } catch (e) {}
};

window.hideSettings = function() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hidden');
};

window.saveSettings = async function() {
  const solInput = document.getElementById('settings-solana');
  if (!solInput || !window.pohMinerAPI?.onboarding) return;

  try {
    await window.pohMinerAPI.onboarding.complete({
      solanaAddress: solInput.value.trim(),
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

// =====================================================
// Sidebar Resizer (Drag to resize)
// =====================================================

const resizer = document.getElementById('sidebar-resizer');
const sidebar = document.querySelector('.sidebar');

let isResizing = false;

if (resizer && sidebar) {
  // Restore previous width if saved
  const savedWidth = localStorage.getItem('sidebarWidth');
  if (savedWidth) {
    sidebar.style.width = savedWidth + 'px';
  }

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    // Calculate new sidebar width based on mouse position from right edge
    const newWidth = window.innerWidth - e.clientX;

    // Clamp between min and max
    const minW = 200;
    const maxW = 520;
    const clamped = Math.max(minW, Math.min(maxW, newWidth));

    sidebar.style.width = clamped + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      // Persist the width
      const currentWidth = parseInt(sidebar.style.width, 10);
      if (currentWidth) {
        localStorage.setItem('sidebarWidth', currentWidth);
      }
    }
  });

  // Double-click to reset to default width
  resizer.addEventListener('dblclick', () => {
    sidebar.style.width = '280px';
    localStorage.setItem('sidebarWidth', 280);
  });
}
