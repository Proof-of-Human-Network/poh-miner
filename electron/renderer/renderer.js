const logContent = document.getElementById('log-content');
const chainHeightEl = document.getElementById('chain-height');
const reputationEl = document.getElementById('reputation');
const validSubEl = document.getElementById('valid-submissions');

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
    const total = (status.qualityStats.validSubmissions || 0) + (status.qualityStats.invalidSubmissions || 0);
    set('valid-submissions', total);
    if (validSubEl) validSubEl.textContent = total;
  }
  if (status.solanaAddress) {
    const short = status.solanaAddress.length > 14 ? status.solanaAddress.slice(0, 6) + '…' + status.solanaAddress.slice(-4) : status.solanaAddress;
    set('solana-address', short);
  }
  if (status.model || status.inferenceMode) {
    const mode  = (status.inferenceMode || 'AUTO').toUpperCase();
    const model = status.model || 'qwen2.5:1.5b';
    set('sidebar-inference', `${mode} · ${model}`);
    // Seed the active model from miner config on first load (before user picks one)
    if (!window._modelUserPicked) setActiveModel(model);
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
  if (lbl) { lbl.textContent = isActive ? (window.t ? t('sidebar.mining') : 'MINING ACTIVE') : (window.t ? t('sidebar.waiting') : 'WAITING'); lbl.className = 'sb-mining-label' + (isActive ? ' active' : ''); }

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

  // Show rejection modal whenever a skill audit fails (local or gossip path)
  if (window.pohMinerAPI?.onSkillRejected) {
    window.pohMinerAPI.onSkillRejected(({ reason, issues }) => {
      showAuditRejectionModal(reason, issues);
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

window.saveSolanaAndFinish = function() {
  const input = document.getElementById('solana-address-input').value.trim();
  currentOnboardingData.solanaAddress = input || '';
  completeOnboarding();
};

// Close API-key setup steps (kept for any legacy references)
window.closeApiKeySetup = function() { closeRpcConfig(); };

// =====================================================
// RPC Configuration Overlay (separate from onboarding)
// =====================================================

function showRpcStep(name) {
  document.querySelectorAll('#rpc-config .rpc-step').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById('rpc-step-' + name);
  if (target) target.classList.remove('hidden');
}

window.goToRpcStep = function(name) {
  showRpcStep(name);
  if (name === 'evm')          initOnboardEvmStep();
  else if (name === 'solana-rpc') initOnboardSolanaRpcStep();
  else if (name === 'other-chains') initOnboardOtherChainsStep();
};

window.openRpcConfig = function() {
  // Reset init guards so forms re-initialize each time the overlay opens
  window._obEvmInited      = false;
  window._obSolRpcInited   = false;
  window._obOtherInited    = false;
  const rpcDiv = document.getElementById('rpc-config');
  if (rpcDiv) rpcDiv.classList.remove('hidden');
  showRpcStep('etherscan');
};

function closeRpcConfig() {
  const rpcDiv = document.getElementById('rpc-config');
  if (rpcDiv) rpcDiv.classList.add('hidden');
}
window.closeRpcConfig = closeRpcConfig;

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
  switchTab('settings');
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

  goToRpcStep('evm');
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
// Settings Page
// =====================================================

async function loadSettingsPanel() {
  // Build language selector
  if (window.buildLangSelector) {
    buildLangSelector(document.getElementById('settings-language'));
  }

  // Populate fields from status
  let status = null;
  try {
    status = await window.pohMinerAPI?.getStatus?.();
    if (status) {
      const addrEl  = document.getElementById('settings-poh-address');
      const solInput = document.getElementById('settings-solana');
      if (addrEl)  addrEl.textContent = status.pohWallet || status.wallet || '—';
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
}

window.showSettings = function() {
  switchTab('settings');
};

window.hideSettings = function() {
  switchTab('home');
};

window.saveSettings = async function() {
  const solInput = document.getElementById('settings-solana');
  if (!solInput || !window.pohMinerAPI?.onboarding) return;

  const miningModelSel = document.getElementById('settings-mining-model');
  const model = miningModelSel?.value?.trim() || undefined;
  const statusEl = document.getElementById('settings-save-status');

  try {
    await window.pohMinerAPI.onboarding.complete({
      solanaAddress: solInput.value.trim(),
      ...(model ? { model } : {}),
    });
    if (statusEl) { statusEl.textContent = 'Saved ✓'; statusEl.style.color = '#22c55e'; }
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
    const newStatus = await window.pohMinerAPI.getStatus?.();
    if (newStatus) updateStatus(newStatus);
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Failed to save'; statusEl.style.color = '#f87171'; }
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

// ── Skill audit rejection modal ───────────────────────────────────────────────

function showAuditRejectionModal(reason, issues) {
  let modal = document.getElementById('audit-rejection-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'audit-rejection-modal';
    modal.className = 'fixed inset-0 bg-black/80 z-[200] flex items-center justify-center';
    modal.innerHTML = `
      <div class="glass w-full max-w-sm rounded-3xl p-6 border border-red-900/50 text-center">
        <div class="text-3xl mb-3">🚫</div>
        <h3 class="font-display text-lg mb-2 text-red-400">Skill Rejected</h3>
        <p class="text-xs text-zinc-400 mb-3" id="audit-rejection-reason"></p>
        <ul id="audit-rejection-issues" class="text-left text-xs text-zinc-500 mb-5 space-y-1 pl-4 list-disc"></ul>
        <button onclick="document.getElementById('audit-rejection-modal').remove()"
                class="w-full py-2.5 border border-white/20 rounded-2xl text-sm">Dismiss</button>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('audit-rejection-reason').textContent = reason;
  const ul = document.getElementById('audit-rejection-issues');
  ul.innerHTML = (issues || []).map(i => `<li>${escHtml(i)}</li>`).join('');
}

// ── Skill-disabled modal ──────────────────────────────────────────────────────

let _skillDisabledResolve = null;

function showSkillDisabledModal(skillId) {
  return new Promise(resolve => {
    _skillDisabledResolve = resolve;
    const nameEl = document.getElementById('skill-disabled-name');
    if (nameEl) nameEl.textContent = `Skill: ${skillId}`;
    document.getElementById('skill-disabled-modal')?.classList.remove('hidden');
  });
}

window.hideSkillDisabledModal = function() {
  document.getElementById('skill-disabled-modal')?.classList.add('hidden');
  if (_skillDisabledResolve) { _skillDisabledResolve(false); _skillDisabledResolve = null; }
};

window.skillDisabledGoEnable = function() {
  document.getElementById('skill-disabled-modal')?.classList.add('hidden');
  if (_skillDisabledResolve) { _skillDisabledResolve(false); _skillDisabledResolve = null; }
  switchTab('skills');
};

window.skillDisabledProceedCommunity = function() {
  document.getElementById('skill-disabled-modal')?.classList.add('hidden');
  if (_skillDisabledResolve) { _skillDisabledResolve(true); _skillDisabledResolve = null; }
};

window.restartApp = async function() {
  if (!confirm('Restart the app now? This will reload the miner and clear any stuck transactions.')) return;
  try {
    await window.pohMinerAPI?.app?.restart();
  } catch (e) {
    alert('Restart failed: ' + e.message);
  }
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

const TAB_PANELS = { home: 'home-panel', logs: 'logs', chat: 'chat-panel', search: 'search-panel', send: 'send-panel', skills: 'skills-panel', settings: 'settings-panel', p2p: 'p2p-panel' };
const TAB_BTNS   = { home: 'tab-home-btn', logs: 'tab-logs-btn', chat: 'tab-chat-btn', search: 'tab-search-btn', send: 'tab-send-btn', skills: 'tab-skills-btn', settings: null, p2p: 'tab-p2p-btn' };

function switchTab(name) {
  Object.entries(TAB_PANELS).forEach(([key, panelId]) => {
    const panel = document.getElementById(panelId);
    const btnId = TAB_BTNS[key];
    const btn   = btnId ? document.getElementById(btnId) : null;
    if (panel) panel.classList.toggle('active', key === name);
    if (btn)   btn.classList.toggle('active', key === name);
  });
  if (name === 'home')     { syncHomeBalance(); }
  if (name === 'chat')     { loadChatModels(); loadChatBrainContext(true); document.getElementById('chat-input')?.focus(); }
  if (name === 'send')     { syncSendWallet(); showSendView(); }
  if (name === 'skills')   { loadSkills(); }
  if (name === 'settings') { loadSettingsPanel(); }
  if (name === 'p2p')      { p2pInit(); }
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
  const port = window._minerApiPort || 3456;

  // Show loading placeholder
  const root = document.querySelector('#search-result .wp-root');
  if (root) {
    root.querySelector('.wp-social-inject')?.remove();
    const ph = document.createElement('div');
    ph.className = 'wp-social-inject';
    ph.innerHTML = `<div class="wp-section"><div class="wp-section-title">Social Activity</div><div style="font-size:11px;color:#555;padding:6px 0;">Fetching social data via skills…</div></div>`;
    const fb = root.querySelector('.feedback-row');
    fb ? root.insertBefore(ph, fb) : root.appendChild(ph);
  }

  // Submit a skill job and poll until result is ready (30 s timeout)
  async function runSkill(skillId, payload) {
    try {
      const jobRes = await fetch(`http://localhost:${port}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'skill', skillId, payload }),
      });
      if (!jobRes.ok) return null;
      const { jobId } = await jobRes.json();
      if (!jobId) return null;

      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const r = await fetch(`http://localhost:${port}/job/${jobId}/result`);
          if (r.status === 202) continue;
          if (!r.ok) return null;
          const data = await r.json();
          // Skill results are stored in profile.skillOutput
          if (data?.profile?.skillOutput !== undefined) return data.profile.skillOutput;
        } catch { /* keep polling */ }
      }
    } catch {}
    return null;
  }

  // Run read_farcaster first (resolves by EVM address)
  const farcasterData = await runSkill('read_farcaster', { address });

  // Run read_paragraph using the Farcaster username as the handle
  let paragraphData = null;
  if (farcasterData?.username) {
    paragraphData = await runSkill('read_paragraph', { username: farcasterData.username });
  }

  if (!farcasterData && !paragraphData) {
    document.querySelector('#search-result .wp-social-inject')?.remove();
    return;
  }

  // Build chat system context from skill summaries
  const systemParts = [];
  let label = address.slice(0, 8) + '…';
  if (farcasterData) {
    label = `@${farcasterData.username}`;
    systemParts.push([
      `FARCASTER — @${farcasterData.username} (${(farcasterData.followerCount || 0).toLocaleString()} followers)`,
      farcasterData.bio ? `Bio: "${farcasterData.bio}"` : '',
      farcasterData.analysis?.summary || '',
    ].filter(Boolean).join('\n'));
  }
  if (paragraphData) {
    const authorName = paragraphData.author?.displayName || paragraphData.author?.handle || '';
    systemParts.push([
      `PARAGRAPH — ${authorName}`,
      paragraphData.analysis?.summary || '',
    ].filter(Boolean).join('\n'));
  }

  _chatSocialContext = {
    address, label,
    farcasterData,
    paragraphData,
    system: `You have access to real-time social activity for wallet address ${address}.\nUse this context to answer questions about this person's views, interests, and recent activity.\n\n${systemParts.join('\n\n')}`,
  };
  _updateChatContextIndicator();
  _injectSocialIntoResult(farcasterData, paragraphData);
}

// Inject (or replace) the social characteristic section inside the rendered result.
function _injectSocialIntoResult(farcasterData, paragraphData) {
  const root = document.querySelector('#search-result .wp-root');
  if (!root) return;
  root.querySelector('.wp-social-inject')?.remove();
  const html = _socialChar(farcasterData, paragraphData);
  if (!html) return;
  const wrap = document.createElement('div');
  wrap.className = 'wp-social-inject';
  wrap.innerHTML = html;
  const fb = root.querySelector('.feedback-row');
  fb ? root.insertBefore(wrap, fb) : root.appendChild(wrap);
}

// Fetch enriched profile (including tx graph) from the local miner node and inject graph section.
async function _enrichResultWithGraph(address) {
  try {
    // Use the miner's own cached profile endpoint (populated after scan completes)
    const port = window._minerApiPort || 3456;
    let profile = null;
    try {
      const r = await fetch(`http://localhost:${port}/profile/${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) profile = await r.json();
    } catch {}
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

// ── Global active model ────────────────────────────────────────────────────────
// Single source of truth for the model used by scan, chat, and skills.

window._activeModel  = 'qwen2.5:1.5b';
window._cachedModels = [];

function getActiveModel() {
  return window._activeModel || 'qwen2.5:1.5b';
}

function setActiveModel(name) {
  window._activeModel = name;
  // Keep hidden select in sync (used by legacy code that still reads it)
  const sel = document.getElementById('chat-model-select');
  if (sel) sel.value = name;
  // Update sidebar button label
  const btn = document.getElementById('brain-model');
  if (btn) btn.textContent = name;
}

// ── Model picker modal ─────────────────────────────────────────────────────────

window.openModelPicker = async function() {
  document.getElementById('model-picker-backdrop')?.classList.remove('hidden');
  await _renderModelList();
};

window.closeModelPicker = function() {
  document.getElementById('model-picker-backdrop')?.classList.add('hidden');
};

async function _renderModelList() {
  const listEl = document.getElementById('mp-list');
  if (!listEl) return;

  // Use cache if fresh, otherwise re-fetch
  if (!window._cachedModels.length) {
    listEl.innerHTML = '<div class="mp-empty">Loading…</div>';
    try {
      const port = window._minerApiPort || 3456;
      const res  = await fetch(`http://localhost:${port}/api/models`);
      if (res.ok) {
        const data = await res.json();
        window._cachedModels = (data.models || []).map(m => m.name || m.model).filter(Boolean);
      }
    } catch {}
  }

  const models = window._cachedModels;
  if (!models.length) {
    listEl.innerHTML = '<div class="mp-empty">No models found.<br>Make sure Ollama is running and has models installed.</div>';
    return;
  }

  const icons = { qwen: '🧠', llama: '🦙', mistral: '🌪', gemma: '💎', phi: '🔬', deepseek: '🔍', default: '⚡' };
  function modelIcon(name) {
    const n = name.toLowerCase();
    for (const [k, v] of Object.entries(icons)) if (n.includes(k)) return v;
    return icons.default;
  }

  listEl.innerHTML = models.map(m => {
    const active = m === window._activeModel;
    return `<div class="mp-item${active ? ' active' : ''}" onclick="pickModel('${m.replace(/'/g,"\\'")}')">
      <div class="mp-item-icon">${modelIcon(m)}</div>
      <span class="mp-item-name">${m}</span>
      ${active ? '<span class="mp-item-badge">ACTIVE</span>' : ''}
    </div>`;
  }).join('');
}

window.pickModel = function(name) {
  window._modelUserPicked = true;
  setActiveModel(name);
  closeModelPicker();
};

// ── Model loader (for backward compat + hidden select population) ──────────────

async function loadChatModels() {
  const sel = document.getElementById('chat-model-select');
  if (!sel || sel.dataset.loaded) return;
  try {
    const port = window._minerApiPort || 3456;
    const res  = await fetch(`http://localhost:${port}/api/models`);
    if (!res.ok) return;
    const data = await res.json();
    const models = (data.models || []).map(m => m.name || m.model).filter(Boolean);
    window._cachedModels = models;
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
    // Default to qwen if available, else first model
    const qwen = models.find(m => m.includes('qwen')) || models[0];
    if (qwen) setActiveModel(qwen);
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

  if (role === 'assistant') {
    const label = document.createElement('span');
    label.textContent = 'AI';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'chat-copy-btn';
    copyBtn.textContent = '⎘';
    copyBtn.title = 'Copy response';
    copyBtn.onclick = () => {
      const text = bubble._rawText || bubble.innerText || '';
      navigator.clipboard.writeText(text).catch(() => {});
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = '⎘'; }, 1500);
    };
    meta.appendChild(label);
    meta.appendChild(copyBtn);
  } else {
    meta.textContent = 'You';
  }

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

function getChatBudget() {
  const slider = document.getElementById('chat-budget-slider');
  const n = parseInt(slider?.value || '0', 10);
  return n > 0 ? n * BUDGET_DECIMALS : 0;
}

window.updateChatBudgetDisplay = function(val) {
  const n = parseInt(val, 10);
  const el = document.getElementById('chat-budget-display');
  if (!el) return;
  el.textContent = n <= 0 ? 'No limit' : `${n} POH`;
  const slider = document.getElementById('chat-budget-slider');
  if (slider) slider.style.setProperty('--fill', `${(n / 500) * 100}%`);
};

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

  const model = getActiveModel();
  const port  = window._minerApiPort || 3456;

  // ── Skill routing ──────────────────────────────────────────────────────────
  const ADDR_RE = /0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}(?=[\s,!?"]|$)|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}|(EQ|UQ)[A-Za-z0-9+/_-]{46}|[\w-]+\.eth\b|[\w-]+\.sol\b|[\w-]+\.bnb\b/;
  const addrMatch = text.match(ADDR_RE);

  async function _submitSkillJob(skillId, payload) {
    const budget = getChatBudget();
    const body = { type: 'skill', skillId, payload };
    if (budget > 0) { body.maxBudget = budget; body.requesterAddress = window._localWallet; }
    const r = await fetch(`http://localhost:${port}/job`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`job submit HTTP ${r.status}`);
    return (await r.json()).jobId;
  }

  function _appendFeedbackButtons(jobId) {
    const msgs = document.getElementById('chat-messages');
    if (!msgs || !jobId) return;
    const fb = document.createElement('div');
    fb.className = 'chat-feedback';
    fb.dataset.jobId = jobId;
    fb.innerHTML = `<span class="chat-feedback-label">Was this helpful?</span>
      <button class="chat-fb-btn" data-rating="positive" onclick="window._sendJobFeedback('${jobId}','positive',this.closest('.chat-feedback'))">👍</button>
      <button class="chat-fb-btn" data-rating="negative" onclick="window._sendJobFeedback('${jobId}','negative',this.closest('.chat-feedback'))">👎</button>`;
    msgs.appendChild(fb);
    msgs.scrollTop = msgs.scrollHeight;
  }

  window._sendJobFeedback = async function(jobId, rating, container) {
    try {
      const r = await fetch(`http://localhost:${port}/api/jobs/${jobId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, requesterAddress: window._localWallet }),
      });
      if (r.ok && container) {
        container.innerHTML = `<span class="chat-feedback-label">${rating === 'positive' ? '👍 Thanks!' : '👎 Noted — miner penalised'}</span>`;
      }
    } catch {}
  };

  // Phase 1: poll job until verdict is ready, return raw job result object
  async function _waitForSkillRawOutput(jobId) {
    let attempts = 0;
    return new Promise(resolve => {
      const t = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch(`http://localhost:${port}/job/${jobId}/result`);
          const data = await r.json();
          if (r.status === 202) {
            // Still processing — but bail early if job errored or is stuck
            if (data.status === 'error' || data.status === 'ignored') {
              clearInterval(t);
              resolve({ _jobError: data.status, error: data.message || data.error });
              return;
            }
            if (attempts % 5 === 0) appendToLastBubble('.');
            if (attempts > 30) { clearInterval(t); resolve(null); } // 60s hard timeout
            return;
          }
          if (!r.ok || !data.verdict) return;
          clearInterval(t);
          resolve(data);
        } catch { if (attempts > 30) { clearInterval(t); resolve(null); } }
      }, 2000);
    });
  }

  // Phase 2: inject skill output as context, stream LLM answer
  async function _streamSkillAnalysis(skillContext, skillOutput, userQuestion) {
    const dataStr = JSON.stringify(skillOutput, null, 2);
    const systemContent = [
      'You are an AI assistant with access to real-time data fetched by a skill.',
      'Answer the user\'s question using only the provided data. Be concise and specific.',
      skillContext ? `\n\nSkill context (how to interpret this data):\n${skillContext}` : '',
    ].join('');

    const userContent = `Fetched data:\n\`\`\`json\n${dataStr.slice(0, 12000)}\n\`\`\`\n\nUser question: ${userQuestion}`;

    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: chatAbortController.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemContent }, { role: 'user', content: userContent }],
        stream: true,
        options: { temperature: 0.5 },
      }),
    });

    if (!res.ok) throw new Error(`Ollama ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', fullReply = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          const token = evt.message?.content || '';
          if (token) { appendToLastBubble(token); fullReply += token; }
          if (evt.done) break;
        } catch {}
      }
    }
    finalizeLastBubble();
    chatHistory.push({ role: 'assistant', content: fullReply || '[no response]' });
  }

  let _skillDone = false;

  // Route message to a skill via backend (keyword fast path + LLM fallback)
  try {
    const routeRes = await fetch(`http://localhost:${port}/chat/route`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, budget: getChatBudget() }),
      signal: AbortSignal.timeout(8000),
    });
    if (routeRes.ok) {
      const route = await routeRes.json();
      if (route.type === 'skill' && route.skillId) {
        // Skills are not free — require a budget tip to the developer and miner
        if (getChatBudget() === 0) {
          document.getElementById('skill-fee-modal')?.classList.remove('hidden');
          setChatStreaming(false);
          document.getElementById('chat-input').disabled = false;
          return;
        }

        // Check if skill is enabled locally before submitting
        const skillInfo = window._skillsData?.[route.skillId];
        if (skillInfo && skillInfo.enabled === false) {
          const proceed = await showSkillDisabledModal(route.skillId);
          if (!proceed) {
            setChatStreaming(false);
            document.getElementById('chat-input').disabled = false;
            return;
          }
          // User chose to proceed via community — continue (miner gate will skip, community picks up)
        }

        // Show fetching indicator
        renderMessage('assistant', `Fetching data via \`${route.skillId}\`…`, true);
        chatAbortController = new AbortController();

        // Include the user's question so the miner can run LLM analysis server-side.
        // Fee is only settled after the miner submits both the skill output and nlResponse.
        const jobId = await _submitSkillJob(route.skillId, { ...(route.input || {}), question: text });
        const jobResult = await _waitForSkillRawOutput(jobId);
        finalizeLastBubble();

        if (jobResult?._jobError) {
          const msg = `Skill failed (${jobResult.error || jobResult._jobError}).`;
          renderMessage('assistant', msg);
          chatHistory.push({ role: 'assistant', content: msg });
          _skillDone = true;
        } else if (jobResult && jobResult.verdict && jobResult.verdict !== 'SKILL_RESULT') {
          // Verdict result (poh_identity) — display directly, no LLM needed
          const pct = jobResult.confidence != null ? ` · ${(jobResult.confidence * 100).toFixed(0)}% confidence` : '';
          const reply = `**${jobResult.verdict}${pct}**\n\n${jobResult.reasoning || ''}`;
          renderMessage('assistant', reply);
          chatHistory.push({ role: 'assistant', content: reply });
          _skillDone = true;
        } else if (jobResult) {
          const skillOutput  = jobResult.profile?.skillOutput;
          const nlResponse   = jobResult.profile?.nlResponse;

          if (skillOutput === null && !nlResponse) {
            const msg = 'No data found for this query.';
            renderMessage('assistant', msg);
            chatHistory.push({ role: 'assistant', content: msg });
          } else if (nlResponse) {
            // Miner already ran LLM analysis server-side — display directly
            renderMessage('assistant', nlResponse);
            chatHistory.push({ role: 'assistant', content: nlResponse });
            _appendFeedbackButtons(jobId);
          } else if (skillOutput?.analysis?.summary) {
            // Summary field from the skill — natural language without LLM round-trip
            const reply = skillOutput.analysis.summary;
            renderMessage('assistant', reply);
            chatHistory.push({ role: 'assistant', content: reply });
            _appendFeedbackButtons(jobId);
          } else {
            // Fallback: stream Ollama analysis client-side
            renderMessage('assistant', '', true);
            await _streamSkillAnalysis(route.skillContext || '', skillOutput, text);
            _appendFeedbackButtons(jobId);
          }
          _skillDone = true;
        }
      }
    }
  } catch { /* fall through to Ollama */ }

  if (_skillDone) {
    chatAbortController = null;
    setChatStreaming(false);
    input.disabled = false;
    input.focus();
    return;
  }
  // ── End skill routing ─────────────────────────────────────────────────────

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
      <div>Chat with your Artificial Intelligence</div>
      <div style="font-size:11px;color:#2a2a2a">Powered by local, free to use inference and community skills.</div>
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
      if (s.model && !window._modelUserPicked) setActiveModel(s.model);
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

async function pollTxHistory() {
  const port = window._minerApiPort || 3456;
  const addr = window._localWallet;
  if (!addr) return;
  try {
    const res = await fetch(`http://localhost:${port}/api/wallet/history?address=${encodeURIComponent(addr)}&limit=5`);
    if (!res.ok) return;
    const { entries } = await res.json();
    const el = document.getElementById('sidebar-tx-history');
    if (!el || !entries?.length) return;
    const POH = 1_000_000_000;
    el.innerHTML = entries.map(e => {
      const sign  = e.delta > 0 ? '+' : '';
      const amt   = (e.delta / POH).toFixed(3);
      const color = e.delta > 0 ? '#22c55e' : '#ef4444';
      const ts    = e.ts ? new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `<div style="display:flex;justify-content:space-between;"><span>${e.label}</span><span style="color:${color}">${sign}${amt} POH${ts ? ' · ' + ts : ''}</span></div>`;
    }).join('');
  } catch {}
}
setInterval(pollTxHistory, 15000);

// ── Scanner welcome overlay ────────────────────────────────────────────────────

function hasScannerWelcomeSeen() {
  return localStorage.getItem('scannerWelcomeSeen') === '1';
}

function markScannerWelcomeSeen() {
  localStorage.setItem('scannerWelcomeSeen', '1');
}

// Called when user clicks SCAN button or presses Enter in the search input
window.handleScanClick = function() {
  if (!hasScannerWelcomeSeen()) {
    document.getElementById('scanner-welcome')?.classList.remove('hidden');
    return;
  }
  runSearch();
};

window.scannerWelcomeSkip = function() {
  markScannerWelcomeSeen();
  document.getElementById('scanner-welcome')?.classList.add('hidden');
  runSearch();
};

window.scannerWelcomeSetup = function() {
  markScannerWelcomeSeen();
  document.getElementById('scanner-welcome')?.classList.add('hidden');
  openRpcConfig();
};

// ── Budget slider ──────────────────────────────────────────────────────────────

// POH token has 9 decimals; slider value is in whole POH
const BUDGET_DECIMALS = 1_000_000_000;

window.updateBudgetDisplay = function(val) {
  const n = parseInt(val, 10);
  const display = document.getElementById('budget-display');
  if (!display) return;
  if (n <= 0) {
    display.textContent = 'No limit';
  } else {
    display.textContent = `${n} POH`;
  }
  // Update slider fill colour via CSS custom property
  const slider = document.getElementById('budget-slider');
  if (slider) {
    const pct = (n / parseInt(slider.max, 10)) * 100;
    slider.style.setProperty('--fill', pct + '%');
  }
};

function getBudgetValue() {
  const slider = document.getElementById('budget-slider');
  if (!slider) return 0;
  const n = parseInt(slider.value, 10);
  return n > 0 ? n * BUDGET_DECIMALS : 0;
}

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
    statusTx.textContent = window.t ? t('scanner.submitting') : 'Submitting job…';
    const budget = getBudgetValue();
    const jobBody = { type: 'verdict', payload: { address } };
    if (budget > 0) {
      jobBody.maxBudget = budget;
      jobBody.requesterAddress = window._localWallet;
    }
    const jobRes = await fetch(`http://localhost:${port}/job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jobBody),
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
  handleScanClick();
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

// ── Social sections: Articles / Social Activity / Zora ────────────────────────

function _articleSection(d) {
  if (!d?.posts?.length) return '';
  const rows = d.posts.slice(0, 6).map(p => {
    const date = p.publishedAt ? new Date(p.publishedAt * 1000).toLocaleDateString('en-US', { year:'numeric', month:'short' }) : '';
    return `<div style="padding:5px 0;border-bottom:1px solid #111;display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
      <a href="${escHtml(p.url || '#')}" target="_blank" rel="noopener"
         style="font-size:12px;color:#d1d5db;text-decoration:none;flex:1;line-height:1.4;" onmouseover="this.style.color='#818cf8'" onmouseout="this.style.color='#d1d5db'">${escHtml(p.title)}</a>
      ${date ? `<span style="font-size:10px;color:#374151;flex-shrink:0;">${date}</span>` : ''}
    </div>`;
  }).join('');
  const author = d.author?.displayName || d.author?.handle || '';
  return `<div class="wp-section">
    <div class="wp-section-title">Articles${author ? ` · <span style="font-weight:400;color:#4b5563;">${escHtml(author)}</span>` : ''}</div>
    <div style="display:flex;flex-direction:column;">${rows}</div>
  </div>`;
}

function _farcasterSection(d) {
  if (!d?.casts?.length) return '';
  const casts = d.casts.slice(0, 4).map(c => `
    <div style="padding:5px 0;border-bottom:1px solid #111;font-size:12px;color:#6b7280;line-height:1.45;display:flex;justify-content:space-between;gap:8px;">
      <span style="flex:1;">${escHtml(c.text.slice(0, 200))}${c.text.length > 200 ? '…' : ''}</span>
      ${(c.likes || c.replies) ? `<span style="font-size:10px;color:#374151;flex-shrink:0;font-family:monospace;">${c.likes ? `♥${c.likes}` : ''}${c.replies ? ` ${c.replies}r` : ''}</span>` : ''}
    </div>`).join('');
  const meta = [
    d.followerCount ? `${d.followerCount.toLocaleString()} followers` : '',
    d.followingCount ? `${d.followingCount.toLocaleString()} following` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="wp-section">
    <div class="wp-section-title">Social Activity · <span style="font-weight:400;color:#4b5563;">@${escHtml(d.username || '')} on Farcaster</span>${meta ? ` <span style="font-size:10px;color:#374151;">${escHtml(meta)}</span>` : ''}</div>
    ${d.bio ? `<div style="font-size:11px;color:#6b7280;font-style:italic;margin-bottom:6px;">"${escHtml(d.bio)}"</div>` : ''}
    <div>${casts}</div>
  </div>`;
}

function _zoraSection(d) {
  if (!d?.createdCoins?.length) return '';
  const coins = d.createdCoins.slice(0, 5).map(c => {
    const mc = parseFloat(c.marketCap || 0);
    const mcStr = mc > 1000 ? `$${(mc / 1000).toFixed(1)}k` : mc > 0 ? `$${mc.toFixed(0)}` : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #111;font-size:12px;">
      <span style="color:#d1d5db;flex:1;">${escHtml(c.name)}${c.symbol ? ` <span style="color:#4b5563;font-family:monospace;">${escHtml(c.symbol)}</span>` : ''}</span>
      ${mcStr ? `<span style="color:#22c55e;font-family:monospace;font-size:10px;">${mcStr}</span>` : ''}
      ${c.uniqueHolders ? `<span style="color:#374151;font-size:10px;">${c.uniqueHolders} holders</span>` : ''}
    </div>`;
  }).join('');
  const handle = d.profile?.handle || d.profile?.displayName || '';
  return `<div class="wp-section">
    <div class="wp-section-title">Zora${handle ? ` · <span style="font-weight:400;color:#4b5563;">${escHtml(handle)}</span>` : ''} <span style="font-weight:400;color:#4b5563;">${d.totalCreated} coin${d.totalCreated !== 1 ? 's' : ''} created</span></div>
    <div>${coins}</div>
  </div>`;
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

function _socialChar(farcasterData, paragraphData) {
  if (!farcasterData && !paragraphData) return '';
  let inner = '';

  if (farcasterData) {
    const meta = [
      farcasterData.followerCount  ? `${farcasterData.followerCount.toLocaleString()} followers`  : '',
      farcasterData.followingCount ? `${farcasterData.followingCount.toLocaleString()} following` : '',
    ].filter(Boolean).join(' · ');
    const topics = (farcasterData.analysis?.keyTopics || [])
      .map(t => `<span class="char-topic">${escHtml(t)}</span>`).join('');
    const casts = (farcasterData.casts || []).slice(0, 4).map(c => `
      <div class="char-cast">
        <span class="char-cast-text">${escHtml((c.text || '').slice(0, 200))}${(c.text||'').length > 200 ? '…' : ''}</span>
        ${(c.likes || c.replies) ? `<span class="char-cast-meta">${c.likes ? `♥${c.likes}` : ''}${c.replies ? ` · ${c.replies}r` : ''}</span>` : ''}
      </div>`).join('');
    inner += `
      <div class="char-source">
        <div class="char-source-label">🟣 Farcaster — @${escHtml(farcasterData.username || '')}
          ${meta ? `<span class="char-follow-meta">${escHtml(meta)}</span>` : ''}</div>
        ${farcasterData.bio ? `<div class="char-bio">"${escHtml(farcasterData.bio)}"</div>` : ''}
        ${farcasterData.analysis?.summary ? `<p class="char-text">${escHtml(farcasterData.analysis.summary)}</p>` : ''}
        ${topics ? `<div class="char-topics">${topics}</div>` : ''}
        ${casts}
      </div>`;
  }

  if (paragraphData) {
    const author = paragraphData.author || {};
    const authorName = author.displayName || author.handle || '';
    const subs = author.followerCount ? `${author.followerCount.toLocaleString()} subscribers` : '';
    const topics = (paragraphData.analysis?.keyTopics || [])
      .map(t => `<span class="char-topic">${escHtml(t)}</span>`).join('');
    const posts = (paragraphData.posts || []).slice(0, 4).map(p => {
      const date = p.publishedAt
        ? new Date(p.publishedAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '';
      const excerpt = (p.excerpt || '').slice(0, 80);
      return `<div class="char-article">
        <span class="char-article-title">${escHtml(p.title || '')}</span>
        ${excerpt ? `<span class="char-article-sub"> — ${escHtml(excerpt)}${(p.excerpt||'').length > 80 ? '…' : ''}</span>` : ''}
        ${date ? `<span style="font-size:9px;color:#374151;margin-left:4px;">${date}</span>` : ''}
      </div>`;
    }).join('');
    inner += `
      <div class="char-source">
        <div class="char-source-label">✍️ Paragraph${authorName ? ` — ${escHtml(authorName)}` : ''}
          ${subs ? `<span class="char-follow-meta">${escHtml(subs)}</span>` : ''}</div>
        ${author.bio ? `<div class="char-bio">"${escHtml(author.bio)}"</div>` : ''}
        ${paragraphData.analysis?.summary ? `<p class="char-text">${escHtml(paragraphData.analysis.summary)}</p>` : ''}
        ${topics ? `<div class="char-topics">${topics}</div>` : ''}
        ${posts}
      </div>`;
  }

  return `<div class="wp-section"><div class="wp-section-title">Social Activity</div>${inner}</div>`;
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
      ${_articleSection(profile.paragraphData)}
      ${_farcasterSection(profile.farcasterData)}
      ${_zoraSection(profile.zoraData)}
      ${_evidenceMap(signals, weights)}
      ${_socialChar(data.farcasterData, data.paragraphData)}

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
  document.getElementById('skills-detail-view').style.display = view === 'detail' ? 'flex' : 'none';
  document.getElementById('skills-submit-view').style.display = view === 'submit' ? 'flex' : 'none';
  document.getElementById('skills-browse-btn').style.color   = view === 'browse' ? '#22c55e' : '#aaa';
  document.getElementById('skills-submit-btn').style.color   = view === 'submit' ? '#22c55e' : '#aaa';
  if (view === 'browse') loadSkills();
}

window._skillsData = {};

function showSkillDetail(id) {
  const s = window._skillsData[id];
  if (!s) return;

  document.getElementById('skill-detail-id').textContent    = s.id;
  document.getElementById('skill-detail-desc').innerHTML    = _mdParse(s.description || '');
  document.getElementById('skill-detail-version').textContent = s.version || '1.0.0';

  const badge = document.getElementById('skill-detail-badge');
  badge.textContent    = (s.status || 'proposed').toUpperCase();
  badge.style.color    = s.status === 'active' ? '#22c55e' : '#666';
  badge.style.borderColor = s.status === 'active' ? '#1a3a27' : '#252525';

  const endpoints = (s.allowedEndpoints || []);
  const epWrap = document.getElementById('skill-detail-endpoints-wrap');
  if (endpoints.length) {
    document.getElementById('skill-detail-endpoints').textContent = endpoints.join(', ');
    epWrap.style.display = 'flex';
  } else {
    epWrap.style.display = 'none';
  }

  const triggers = (s.triggers || []);
  const trWrap = document.getElementById('skill-detail-triggers-wrap');
  if (triggers.length) {
    document.getElementById('skill-detail-triggers').innerHTML = triggers
      .map(t => `<span style="background:#0c0c0c;border:1px solid #1e1e1e;border-radius:3px;padding:2px 7px;font-size:10px;color:#555;">${t}</span>`)
      .join('');
    trWrap.style.display = 'flex';
  } else {
    trWrap.style.display = 'none';
  }

  const ctxWrap = document.getElementById('skill-detail-context-wrap');
  if (s.context) {
    document.getElementById('skill-detail-context').innerHTML = _mdParse(s.context);
    ctxWrap.style.display = 'flex';
  } else {
    ctxWrap.style.display = 'none';
  }

  // Staking section
  const STAKE_THRESHOLD = 10000 * 1e9;
  const staked    = s.totalStaked || 0;
  const myStake   = s.myStake || 0;
  const pct       = Math.min(100, Math.round((staked / STAKE_THRESHOLD) * 100));
  const stakedPoh = (staked / 1e9).toFixed(2);
  const myPoh     = (myStake / 1e9).toFixed(2);

  document.getElementById('skill-detail-stake-bar').style.width = `${pct}%`;
  document.getElementById('skill-detail-stake-pct').textContent = pct > 0 ? `${pct}%` : '';
  document.getElementById('skill-detail-stake-info').textContent =
    `${stakedPoh} / 10,000 POH staked${myStake > 0 ? ` · yours: ${myPoh} POH` : ''}`;
  document.getElementById('skill-stake-amount').value = '';
  const resultEl = document.getElementById('skill-stake-result');
  resultEl.style.display = 'none';
  resultEl.textContent = '';

  window._currentSkillId = id;
  skillsView('detail');
}

async function stakeSkill() {
  const port       = window._minerApiPort || 3456;
  const skillId    = window._currentSkillId;
  const amount     = parseFloat(document.getElementById('skill-stake-amount').value);
  const resultEl   = document.getElementById('skill-stake-result');
  resultEl.style.display = 'none';
  if (!skillId || !amount || amount <= 0) { _stakeMsg('Enter a valid amount', '#ef4444'); return; }
  if (!window._localWallet) { _stakeMsg('Wallet not loaded', '#ef4444'); return; }
  try {
    const res = await fetch(`http://localhost:${port}/api/skills/${encodeURIComponent(skillId)}/stake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, stakerAddress: window._localWallet }),
    });
    const data = await res.json();
    if (!res.ok || data.error) { _stakeMsg(data.error || 'Stake failed', '#ef4444'); return; }
    const totalPoh = (data.total / 1e9).toFixed(2);
    const myPoh    = (data.myStake / 1e9).toFixed(2);
    _stakeMsg(`Staked! Total: ${totalPoh} POH · yours: ${myPoh} POH${data.txHash ? ` · tx: ${data.txHash.slice(0,12)}…` : ''}`, '#22c55e');
    // Refresh skill data
    loadSkills().then(() => {
      if (window._skillsData[skillId]) showSkillDetail(skillId);
    });
  } catch (e) { _stakeMsg(e.message, '#ef4444'); }
}

async function unstakeSkill() {
  const port       = window._minerApiPort || 3456;
  const skillId    = window._currentSkillId;
  const amount     = parseFloat(document.getElementById('skill-stake-amount').value);
  if (!skillId || !amount || amount <= 0) { _stakeMsg('Enter a valid amount', '#ef4444'); return; }
  if (!window._localWallet) { _stakeMsg('Wallet not loaded', '#ef4444'); return; }
  try {
    const res = await fetch(`http://localhost:${port}/api/skills/${encodeURIComponent(skillId)}/unstake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, stakerAddress: window._localWallet }),
    });
    const data = await res.json();
    if (!res.ok || data.error) { _stakeMsg(data.error || 'Unstake failed', '#ef4444'); return; }
    const totalPoh = (data.total / 1e9).toFixed(2);
    const myPoh    = ((data.myStake || 0) / 1e9).toFixed(2);
    _stakeMsg(`Unstaked! Total: ${totalPoh} POH · yours: ${myPoh} POH${data.txHash ? ` · tx: ${data.txHash.slice(0,12)}…` : ''}`, '#22c55e');
    loadSkills().then(() => {
      if (window._skillsData[skillId]) showSkillDetail(skillId);
    });
  } catch (e) { _stakeMsg(e.message, '#ef4444'); }
}

function _stakeMsg(msg, color) {
  const el = document.getElementById('skill-stake-result');
  el.textContent = msg;
  el.style.color = color || '#22c55e';
  el.style.display = 'block';
}

async function loadSkills() {
  const port = window._minerApiPort || 3456;
  try {
    const wallet = window._localWallet || '';
    const res = await fetch(`http://localhost:${port}/api/skills?wallet=${encodeURIComponent(wallet)}`);
    if (!res.ok) return;
    const { skills, stakeVault } = await res.json();
    if (stakeVault) window._stakeVault = stakeVault;
    const activeEl   = document.getElementById('skills-active-list');
    const proposedEl = document.getElementById('skills-proposed-list');
    const emptyEl    = document.getElementById('skills-empty');
    activeEl.innerHTML = '';
    proposedEl.innerHTML = '';

    const active   = skills.filter(s => s.status === 'active');
    const proposed = skills.filter(s => s.status !== 'active' && s.status !== 'deprecated');

    if (!active.length && !proposed.length) { emptyEl.style.display = 'block'; return; }
    emptyEl.style.display = 'none';

    // Store for detail view
    window._skillsData = {};
    skills.forEach(s => { window._skillsData[s.id] = s; });

    const STAKE_THRESHOLD = 10000 * 1e9; // 10,000 POH in μPOH
    const card = (s) => {
      const staked = s.totalStaked || 0;
      const pct = Math.min(100, Math.round((staked / STAKE_THRESHOLD) * 100));
      const enabled = s.enabled || false;
      const toggleId = `skill-toggle-${s.id.replace(/[^a-z0-9]/gi, '_')}`;
      return `
      <div onclick="showSkillDetail('${s.id}')"
           style="position:relative;overflow:hidden;background:#0c0c0c;border:1px solid ${enabled ? '#1a3a27' : '#1e1e1e'};border-radius:6px;padding:10px 12px;cursor:pointer;transition:border-color 0.15s;"
           onmouseenter="this.style.borderColor='#333'" onmouseleave="this.style.borderColor='${enabled ? '#1a3a27' : '#1e1e1e'}'">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:rgba(34,197,94,0.08);pointer-events:none;"></div>
        <div style="position:relative;display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:12px;font-weight:600;color:#fff;">${s.id}</span>
          <span style="font-size:10px;color:${s.status === 'active' ? '#22c55e' : '#666'};border:1px solid;border-color:${s.status === 'active' ? '#1a3a27' : '#252525'};border-radius:3px;padding:1px 6px;">${s.status || 'proposed'}</span>
          ${pct > 0 ? `<span style="font-size:10px;color:#22c55e;font-family:monospace;">${pct}%</span>` : ''}
          <label onclick="event.stopPropagation()" style="margin-left:auto;display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none;">
            <input id="${toggleId}" type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleSkill('${s.id}', this.checked, event)" style="accent-color:#22c55e;cursor:pointer;">
            <span style="font-size:10px;color:${enabled ? '#22c55e' : '#444'};">${enabled ? 'enabled' : 'disabled'}</span>
          </label>
        </div>
        <div style="position:relative;font-size:11px;color:#555;">${s.description || ''}</div>
        ${s.author ? `<div style="position:relative;font-size:10px;color:#333;margin-top:4px;">by ${s.author.slice(0, 20)}…</div>` : ''}
      </div>`;
    };
    active.forEach(s => { activeEl.innerHTML += card(s); });
    proposed.forEach(s => { proposedEl.innerHTML += card(s); });
  } catch (e) {
    document.getElementById('skills-empty').style.display = 'block';
    document.getElementById('skills-empty').textContent = 'Could not reach miner API';
  }
}

async function toggleSkill(skillId, enable, event) {
  if (event) event.stopPropagation();
  const port = window._minerApiPort || 3456;
  const action = enable ? 'enable' : 'disable';
  try {
    await fetch(`http://localhost:${port}/api/skills/${encodeURIComponent(skillId)}/${action}`, { method: 'POST' });
    // Update cached skill state and refresh label/border in place
    if (window._skillsData[skillId]) window._skillsData[skillId].enabled = enable;
    const toggleId = `skill-toggle-${skillId.replace(/[^a-z0-9]/gi, '_')}`;
    const label = document.getElementById(toggleId)?.nextElementSibling;
    if (label) { label.textContent = enable ? 'enabled' : 'disabled'; label.style.color = enable ? '#22c55e' : '#444'; }
    const card = document.getElementById(toggleId)?.closest('div[onclick]');
    if (card) { card.style.borderColor = enable ? '#1a3a27' : '#1e1e1e'; }
  } catch (e) {
    console.error('toggleSkill failed:', e.message);
  }
}

async function pollSkillAuditResult(jobId, skillId, resultEl, attempt = 0) {
  const port = window._minerApiPort || 3456;
  const MAX_ATTEMPTS = 60; // 2 min at 2s intervals
  if (attempt >= MAX_ATTEMPTS) {
    resultEl.style.color = '#ef4444';
    resultEl.textContent = 'Audit timed out — job may still be processing on the network';
    return;
  }
  await new Promise(r => setTimeout(r, 2000));
  try {
    const r = await fetch(`http://localhost:${port}/job/${jobId}/result`);
    if (!r.ok) { pollSkillAuditResult(jobId, skillId, resultEl, attempt + 1); return; }
    const data = await r.json();
    const stillPending = !data || ['queued', 'running', 'computing', 'ignored'].includes(data.status);
    if (stillPending) {
      const dots = '.'.repeat((attempt % 3) + 1);
      resultEl.textContent = `Auditing skill code on network${dots} (1,000 POH escrowed)`;
      pollSkillAuditResult(jobId, skillId, resultEl, attempt + 1);
      return;
    }
    if (data.rejected || data.verdict === 'REJECTED') {
      showAuditRejectionModal(data.reason || 'Dangerous code detected', data.issues || []);
      resultEl.style.color = '#ef4444';
      resultEl.textContent = 'Skill rejected by network audit · 1,000 POH refunded';
    } else if (data.status === 'done' || data.verdict === 'SKILL_RESULT') {
      resultEl.style.color = '#22c55e';
      resultEl.textContent = `Proposed: ${skillId} · audit passed · 1,000 POH paid to auditing miner`;
      skillsView('browse');
    } else {
      // Error or unexpected state
      resultEl.style.color = '#ef4444';
      resultEl.textContent = `Audit ended with status: ${data.status || 'unknown'}`;
    }
  } catch { pollSkillAuditResult(jobId, skillId, resultEl, attempt + 1); }
}

async function submitSkill() {
  const port    = window._minerApiPort || 3456;
  const id      = document.getElementById('skill-id-input').value.trim();
  const desc    = document.getElementById('skill-desc-input').value.trim();
  const code    = document.getElementById('skill-code-input').value.trim();
  const context = document.getElementById('skill-context-input').value.trim();
  const resultEl = document.getElementById('skill-submit-result');

  if (!id) { resultEl.style.display = 'block'; resultEl.style.color = '#ef4444'; resultEl.textContent = 'Skill ID required'; return; }
  if (!window._localWallet) { resultEl.style.display = 'block'; resultEl.style.color = '#ef4444'; resultEl.textContent = 'Wallet not loaded — wait for miner to start'; return; }
  resultEl.style.display = 'none';

  const manifest = { id, version: '1.0.0', description: desc };

  try {
    const res = await fetch(`http://localhost:${port}/api/skills/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest, code: code || null, context: context || null, requesterAddress: window._localWallet }),
    });
    const data = await res.json();
    resultEl.style.display = 'block';
    if (res.status === 402) {
      resultEl.style.color = '#ef4444';
      const bal = data.balance != null ? ` (balance: ${(data.balance / 1_000_000_000).toFixed(2)} POH)` : '';
      resultEl.textContent = (data.error || 'Insufficient balance') + bal;
    } else if (res.status === 422 || data.rejected) {
      // Synchronous rejection (context-only skills with no code aren't possible, but keep as fallback)
      showAuditRejectionModal(data.reason || data.error || 'Dangerous code detected', data.issues || []);
      resultEl.style.color = '#ef4444';
      resultEl.textContent = 'Skill rejected by security audit';
    } else if (data.pending && data.jobId) {
      // Skill submitted for network audit — poll until the auditing miner returns a result
      resultEl.style.color = '#f59e0b';
      resultEl.textContent = 'Auditing skill code on network… 1,000 POH escrowed';
      pollSkillAuditResult(data.jobId, id, resultEl);
    } else if (data.ok) {
      resultEl.style.color = '#22c55e';
      resultEl.textContent = `Proposed: ${id} · 1,000 POH deducted`;
      skillsView('browse');
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


// ── P2P Exchange ───────────────────────────────────────────────────────────────

const QUOTE_CURRENCIES = ['USDT-ERC20','USDT-TRC20','USDT-TON','USDT-SOL','USDT-BEP20','BTC','ETH','SOL','USDC'];
const POH_DECIMALS_P2P = 1_000_000_000;

let _p2pCurrency = '';
let _p2pOrders = [];
let _p2pActivityTab = 'orders';
let _p2pPollTimer = null;

function _p2pPort() { return window._minerApiPort || 3456; }

function _p2pFmt(uPOH) {
  const n = uPOH / 1e9;
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 4 });
}

function _p2pTimeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  return Math.floor(d / 3600000) + 'h ago';
}

async function _p2pLocalAuth(action, extraFields = {}) {
  const port = _p2pPort();
  const r = await fetch(`http://localhost:${port}/api/p2p/local-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extraFields }),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'auth failed'); }
  return r.json();
}

async function _p2pApiFetch(path, opts = {}) {
  const port = _p2pPort();
  const r = await fetch(`http://localhost:${port}${path}`, opts);
  return r.json();
}

function p2pInit() {
  p2pShowBook();
  p2pLoadOrders();
  if (_p2pPollTimer) clearInterval(_p2pPollTimer);
  _p2pPollTimer = setInterval(() => {
    if (document.getElementById('p2p-panel')?.classList.contains('active')) p2pLoadOrders(true);
  }, 10000);
}

function p2pShowBook() {
  document.getElementById('p2p-book-view').style.display = 'flex';
  document.getElementById('p2p-detail-view').style.display = 'none';
  document.getElementById('p2p-create-view').style.display = 'none';
  document.getElementById('p2p-activity-view').style.display = 'none';
}

function p2pShowDetail() {
  document.getElementById('p2p-book-view').style.display = 'none';
  document.getElementById('p2p-detail-view').style.display = 'flex';
  document.getElementById('p2p-create-view').style.display = 'none';
  document.getElementById('p2p-activity-view').style.display = 'none';
}

function p2pShowCreateOrder() {
  const currSel = document.getElementById('p2p-form-currency');
  if (currSel && !currSel.options.length) {
    QUOTE_CURRENCIES.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; currSel.appendChild(o); });
  }
  document.getElementById('p2p-book-view').style.display = 'none';
  document.getElementById('p2p-detail-view').style.display = 'none';
  document.getElementById('p2p-create-view').style.display = 'flex';
  document.getElementById('p2p-activity-view').style.display = 'none';
  document.getElementById('p2p-create-result').style.display = 'none';
}

function p2pShowMyActivity() {
  document.getElementById('p2p-book-view').style.display = 'none';
  document.getElementById('p2p-detail-view').style.display = 'none';
  document.getElementById('p2p-create-view').style.display = 'none';
  document.getElementById('p2p-activity-view').style.display = 'flex';
  p2pLoadActivity();
}

function p2pBuildCurrencyPills() {
  const container = document.getElementById('p2p-currency-pills');
  if (!container) return;
  container.innerHTML = '';
  const all = ['', ...QUOTE_CURRENCIES];
  all.forEach(c => {
    const btn = document.createElement('button');
    btn.textContent = c || 'ALL';
    const active = _p2pCurrency === c;
    btn.style.cssText = `font-size:9px;padding:2px 7px;border-radius:10px;border:1px solid ${active ? '#22c55e' : '#2a2a2a'};background:${active ? '#052e16' : '#0a0a0a'};color:${active ? '#22c55e' : '#555'};cursor:pointer;font-family:monospace;`;
    btn.onclick = () => { _p2pCurrency = c; p2pBuildCurrencyPills(); p2pRenderOrders(); };
    container.appendChild(btn);
  });
}

async function p2pLoadOrders(silent = false) {
  if (!silent) {
    const list = document.getElementById('p2p-order-list');
    if (list) list.innerHTML = '<div style="color:#444;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">Loading…</div>';
  }
  try {
    const data = await _p2pApiFetch('/api/p2p/orders');
    _p2pOrders = data.orders || [];
  } catch { _p2pOrders = []; }
  p2pBuildCurrencyPills();
  p2pRenderOrders();
}

function p2pRenderOrders() {
  const list = document.getElementById('p2p-order-list');
  if (!list) return;
  let orders = _p2pOrders.filter(o => o.status === 'open' && o.side === 'sell');
  if (_p2pCurrency) orders = orders.filter(o => o.quoteCurrency === _p2pCurrency);
  list.innerHTML = '';
  if (!orders.length) {
    list.innerHTML = '<div style="color:#374151;font-size:11px;text-align:center;padding:24px 0;font-family:monospace;">No orders available</div>';
    return;
  }
  orders.forEach(order => {
    const card = document.createElement('div');
    card.style.cssText = 'background:#111;border:1px solid #1e1e1e;border-radius:6px;padding:10px;cursor:pointer;';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <span style="font-size:12px;color:#fff;font-family:monospace;">${_p2pFmt(order.pohAmount)} POH</span>
        <span style="font-size:9px;padding:2px 6px;border-radius:3px;background:#7f1d1d22;color:#fca5a5;font-family:monospace;">SELL</span>
      </div>
      <div style="font-size:11px;color:#22c55e;font-family:monospace;margin-bottom:3px;">${order.pricePerPOH} ${order.quoteCurrency}/POH</div>
      <div style="font-size:10px;color:#555;font-family:monospace;">Limit ${order.minTrade}–${(order.maxTrade||0).toFixed(2)} ${order.quoteCurrency}</div>
      ${order.paymentMethods?.length ? `<div style="font-size:10px;color:#444;font-family:monospace;margin-top:2px;">${order.paymentMethods.join(', ')}</div>` : ''}
      <div style="font-size:9px;color:#374151;font-family:monospace;margin-top:4px;">${_p2pTimeAgo(order.createdAt)} · ${order.maker.slice(0,10)}…</div>
    `;
    card.onclick = () => p2pOpenOrder(order);
    list.appendChild(card);
  });
}

async function p2pOpenOrder(order) {
  document.getElementById('p2p-detail-title').textContent = `ORDER ${order.id.slice(0,8)}`;
  const body = document.getElementById('p2p-detail-body');
  body.innerHTML = '<div style="color:#444;font-size:11px;font-family:monospace;">Loading…</div>';
  p2pShowDetail();
  try {
    const data = await _p2pApiFetch(`/api/p2p/orders/${order.id}`);
    if (!data.error) order = data.order;
  } catch { /* use cached */ }

  const isMine = order.maker === window._localWallet;
  const isOpen = order.status === 'open';

  body.innerHTML = `
    <div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;justify-content:space-between;">
        <span style="font-size:10px;color:#555;font-family:monospace;">AMOUNT</span>
        <span style="font-size:12px;color:#fff;font-family:monospace;">${_p2pFmt(order.pohAmount)} POH</span>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="font-size:10px;color:#555;font-family:monospace;">PRICE</span>
        <span style="font-size:12px;color:#22c55e;font-family:monospace;">${order.pricePerPOH} ${order.quoteCurrency}/POH</span>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="font-size:10px;color:#555;font-family:monospace;">LIMIT</span>
        <span style="font-size:11px;color:#aaa;font-family:monospace;">${order.minTrade}–${(order.maxTrade||0).toFixed(2)} ${order.quoteCurrency}</span>
      </div>
      ${order.paymentMethods?.length ? `<div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">PAYMENT</span><span style="font-size:11px;color:#aaa;font-family:monospace;">${order.paymentMethods.join(', ')}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;">
        <span style="font-size:10px;color:#555;font-family:monospace;">STATUS</span>
        <span style="font-size:11px;color:${order.status==='open'?'#22c55e':order.status==='locked'?'#f59e0b':'#888'};font-family:monospace;">${order.status.toUpperCase()}</span>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="font-size:10px;color:#555;font-family:monospace;">MAKER</span>
        <span style="font-size:10px;color:#555;font-family:monospace;">${order.maker}</span>
      </div>
    </div>
    ${isMine && isOpen ? `<button id="p2p-cancel-order-btn" onclick="p2pCancelOrder('${order.id}')" style="width:100%;padding:8px;border:1px solid #7f1d1d44;background:#7f1d1d11;color:#fca5a5;border-radius:4px;cursor:pointer;font-size:11px;font-family:monospace;">CANCEL ORDER</button>` : ''}
    ${!isMine && isOpen ? `
    <div>
      <div style="font-size:10px;color:#444;margin-bottom:4px;letter-spacing:0.1em;">POH AMOUNT TO TRADE</div>
      <input id="p2p-select-amount" type="number" min="0" step="any" value="${_p2pFmt(order.pohAmount)}"
             style="width:100%;background:#111;border:1px solid #252525;border-radius:4px;color:#e5e7eb;font-size:12px;font-family:monospace;padding:8px 10px;outline:none;box-sizing:border-box;" />
      <div id="p2p-select-quote" style="font-size:10px;color:#555;font-family:monospace;margin-top:3px;"></div>
    </div>
    <button onclick="p2pSelectOrder('${order.id}','${order.pricePerPOH}','${order.quoteCurrency}')"
            style="width:100%;padding:10px;border:none;background:#22c55e;color:#000;border-radius:4px;font-weight:600;cursor:pointer;font-size:12px;font-family:monospace;">BUY POH</button>
    <div id="p2p-select-result" style="font-size:11px;display:none;padding:8px;border-radius:4px;font-family:monospace;"></div>` : ''}
    ${order.status === 'locked' && order.tradeId ? `<button onclick="p2pOpenTrade('${order.tradeId}','${order.id}')" style="width:100%;padding:8px;border:1px solid #1e3a5f;background:#0a1929;color:#60a5fa;border-radius:4px;cursor:pointer;font-size:11px;font-family:monospace;">VIEW ACTIVE TRADE →</button>` : ''}
  `;

  const amtInput = document.getElementById('p2p-select-amount');
  const quoteEl  = document.getElementById('p2p-select-quote');
  if (amtInput && quoteEl) {
    const updateQuote = () => { const poh = parseFloat(amtInput.value)||0; quoteEl.textContent = `You pay ≈ ${(poh*order.pricePerPOH).toFixed(4)} ${order.quoteCurrency}`; };
    amtInput.addEventListener('input', updateQuote);
    updateQuote();
  }
}

async function p2pCancelOrder(orderId) {
  const btn = document.getElementById('p2p-cancel-order-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…'; }
  try {
    const auth = await _p2pLocalAuth('cancel-order', { orderId });
    const data = await _p2pApiFetch(`/api/p2p/orders/${orderId}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...auth }),
    });
    if (data.error) throw new Error(data.error);
    p2pShowBook(); p2pLoadOrders(true);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'CANCEL ORDER'; }
    alert('Cancel failed: ' + e.message);
  }
}

async function p2pSelectOrder(orderId, pricePerPOH, quoteCurrency) {
  const amtInput  = document.getElementById('p2p-select-amount');
  const resultEl  = document.getElementById('p2p-select-result');
  const pohAmount = Math.round(parseFloat(amtInput?.value||'0') * POH_DECIMALS_P2P);
  const quoteAmount = parseFloat(amtInput?.value||'0') * parseFloat(pricePerPOH);
  if (!pohAmount) { if (resultEl) { resultEl.style.display='block'; resultEl.style.color='#ef4444'; resultEl.textContent='Enter POH amount'; } return; }
  if (resultEl) { resultEl.style.display='block'; resultEl.style.color='#888'; resultEl.textContent='Processing…'; }
  try {
    const auth = await _p2pLocalAuth('select-order', { orderId, pohAmount, quoteAmount });
    const data = await _p2pApiFetch(`/api/p2p/orders/${orderId}/select`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...auth, pohAmount, quoteAmount }),
    });
    if (data.error) throw new Error(data.error);
    const tradeId = data.trade?.id;
    if (tradeId) p2pOpenTrade(tradeId, orderId);
    else { if (resultEl) { resultEl.style.color='#22c55e'; resultEl.textContent='Order selected!'; } p2pLoadOrders(true); }
  } catch (e) {
    if (resultEl) { resultEl.style.display='block'; resultEl.style.color='#ef4444'; resultEl.textContent=e.message; }
  }
}

async function p2pOpenTrade(tradeId, orderId) {
  document.getElementById('p2p-detail-title').textContent = `TRADE ${tradeId.slice(0,8)}`;
  const body = document.getElementById('p2p-detail-body');
  body.innerHTML = '<div style="color:#444;font-size:11px;font-family:monospace;">Loading trade…</div>';
  p2pShowDetail();
  try {
    const data = await _p2pApiFetch(`/api/p2p/trades/${tradeId}`);
    if (data.error) { body.innerHTML = `<div style="color:#ef4444;font-size:11px;font-family:monospace;">${data.error}</div>`; return; }
    p2pRenderTrade(body, data.trade, data.order);
  } catch (e) { body.innerHTML = `<div style="color:#ef4444;font-size:11px;font-family:monospace;">${e.message}</div>`; }
}

function p2pRenderTrade(body, trade, order) {
  const myAddr   = window._localWallet || '';
  const isMaker  = order?.maker === myAddr;
  const isSeller = isMaker;
  const sColor = { selected:'#f59e0b', payment_sent:'#3b82f6', completed:'#22c55e', cancelled:'#6b7280', disputed:'#ef4444' };
  const color = sColor[trade.status] || '#888';
  const deadline = trade.paymentDeadline
    ? `<div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">DEADLINE</span><span style="font-size:11px;color:#f59e0b;font-family:monospace;">${new Date(trade.paymentDeadline).toLocaleTimeString()}</span></div>`
    : '';
  body.innerHTML = `
    <div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">STATUS</span><span style="font-size:11px;color:${color};font-family:monospace;">${trade.status.replace('_',' ').toUpperCase()}</span></div>
      <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">AMOUNT</span><span style="font-size:12px;color:#fff;font-family:monospace;">${_p2pFmt(trade.pohAmount)} POH</span></div>
      <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">TOTAL</span><span style="font-size:12px;color:#22c55e;font-family:monospace;">${(trade.quoteAmount||0).toFixed(4)} ${order?.quoteCurrency||''}</span></div>
      <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">ROLE</span><span style="font-size:11px;color:#aaa;font-family:monospace;">${isMaker?'Maker':'Taker'} · ${isSeller?'Seller':'Buyer'}</span></div>
      ${deadline}
    </div>
    <div id="p2p-trade-result" style="font-size:11px;display:none;padding:8px;border-radius:4px;font-family:monospace;"></div>
    ${trade.status === 'selected' && !isSeller ? `
    <div style="background:#0c1a0c;border:1px solid #1a3a1a;border-radius:6px;padding:10px;font-size:11px;color:#86efac;font-family:monospace;">
      Send <strong>${(trade.quoteAmount||0).toFixed(4)} ${order?.quoteCurrency||''}</strong> via: ${order?.paymentMethods?.join(', ')||'—'}<br>Then click "Mark Payment Sent".
    </div>
    <button onclick="p2pMarkPaymentSent('${trade.id}')" style="width:100%;padding:10px;border:none;background:#3b82f6;color:#fff;border-radius:4px;font-weight:600;cursor:pointer;font-size:12px;font-family:monospace;">MARK PAYMENT SENT</button>` : ''}
    ${trade.status === 'payment_sent' && isSeller ? `
    <div style="background:#0c1a0c;border:1px solid #1a3a1a;border-radius:6px;padding:10px;font-size:11px;color:#86efac;font-family:monospace;">Buyer claims payment sent. Verify, then release POH.</div>
    <button onclick="p2pReleaseTrade('${trade.id}')" style="width:100%;padding:10px;border:none;background:#22c55e;color:#000;border-radius:4px;font-weight:600;cursor:pointer;font-size:12px;font-family:monospace;">RELEASE POH TO BUYER</button>` : ''}
    ${['selected','payment_sent'].includes(trade.status) ? `
    <div style="display:flex;gap:6px;">
      <button onclick="p2pCancelTrade('${trade.id}')" style="flex:1;padding:8px;border:1px solid #7f1d1d44;background:#7f1d1d11;color:#fca5a5;border-radius:4px;cursor:pointer;font-size:11px;font-family:monospace;">CANCEL</button>
      <button onclick="p2pDisputeTrade('${trade.id}')" style="flex:1;padding:8px;border:1px solid #92400e44;background:#92400e11;color:#fcd34d;border-radius:4px;cursor:pointer;font-size:11px;font-family:monospace;">DISPUTE</button>
    </div>` : ''}
  `;
}

async function _p2pTradeAction(tradeId, action, extraFields = {}) {
  const resultEl = document.getElementById('p2p-trade-result');
  if (resultEl) { resultEl.style.display='block'; resultEl.style.color='#888'; resultEl.textContent='Processing…'; }
  try {
    const auth = await _p2pLocalAuth(action, { tradeId, ...extraFields });
    const data = await _p2pApiFetch(`/api/p2p/trades/${tradeId}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...auth, ...extraFields }),
    });
    if (data.error) throw new Error(data.error);
    if (resultEl) { resultEl.style.color='#22c55e'; resultEl.textContent='Done!'; }
    const orderId = data.trade?.orderId || '';
    setTimeout(() => p2pOpenTrade(tradeId, orderId), 800);
  } catch (e) {
    if (resultEl) { resultEl.style.display='block'; resultEl.style.color='#ef4444'; resultEl.textContent=e.message; }
  }
}

function p2pMarkPaymentSent(tradeId) { _p2pTradeAction(tradeId, 'payment_sent'); }
function p2pReleaseTrade(tradeId)    { _p2pTradeAction(tradeId, 'release'); }
function p2pCancelTrade(tradeId)     { _p2pTradeAction(tradeId, 'cancel'); }
function p2pDisputeTrade(tradeId)    { const r = prompt('Dispute reason:'); if (r) _p2pTradeAction(tradeId, 'dispute', { reason: r }); }

async function p2pSubmitCreateOrder() {
  const resultEl = document.getElementById('p2p-create-result');
  const pohAmt   = parseFloat(document.getElementById('p2p-form-amount')?.value || '0');
  const currency = document.getElementById('p2p-form-currency')?.value;
  const price    = parseFloat(document.getElementById('p2p-form-price')?.value || '0');
  const minT     = parseFloat(document.getElementById('p2p-form-min')?.value || '0');
  const maxT     = parseFloat(document.getElementById('p2p-form-max')?.value || '0');
  const methods  = (document.getElementById('p2p-form-methods')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!pohAmt || !currency || !price) {
    resultEl.style.display='block'; resultEl.style.color='#ef4444'; resultEl.textContent='Fill in amount, currency, and price.'; return;
  }
  resultEl.style.display='block'; resultEl.style.color='#888'; resultEl.textContent='Posting order…';
  const pohAmountRaw = Math.round(pohAmt * POH_DECIMALS_P2P);
  try {
    const orderFields = { side: 'sell', pohAmount: pohAmountRaw, quoteCurrency: currency, pricePerPOH: price, minTrade: minT||0, maxTrade: maxT||pohAmt*price, paymentMethods: methods };
    const auth = await _p2pLocalAuth('create-order', { side: 'sell', pohAmount: pohAmountRaw });
    const data = await _p2pApiFetch('/api/p2p/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...auth, ...orderFields }),
    });
    if (data.error) throw new Error(data.error);
    resultEl.style.color='#22c55e'; resultEl.textContent='Order posted!';
    ['p2p-form-amount','p2p-form-price','p2p-form-min','p2p-form-max','p2p-form-methods'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
    setTimeout(() => { p2pShowBook(); p2pLoadOrders(true); }, 1200);
  } catch (e) { resultEl.style.display='block'; resultEl.style.color='#ef4444'; resultEl.textContent=e.message; }
}

function p2pActivityTab(tab) {
  _p2pActivityTab = tab;
  const oBtn = document.getElementById('p2p-act-tab-orders');
  const tBtn = document.getElementById('p2p-act-tab-trades');
  if (!oBtn || !tBtn) return;
  if (tab === 'orders') {
    oBtn.style.background='#166534'; oBtn.style.color='#22c55e'; oBtn.style.fontWeight='600';
    tBtn.style.background='#111';    tBtn.style.color='#888';    tBtn.style.fontWeight='normal';
  } else {
    tBtn.style.background='#1e3a5f'; tBtn.style.color='#60a5fa'; tBtn.style.fontWeight='600';
    oBtn.style.background='#111';    oBtn.style.color='#888';    oBtn.style.fontWeight='normal';
  }
  p2pLoadActivity();
}

async function p2pLoadActivity() {
  const list   = document.getElementById('p2p-activity-list');
  const myAddr = window._localWallet;
  if (!list) return;
  list.innerHTML = '<div style="color:#444;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">Loading…</div>';
  try {
    if (_p2pActivityTab === 'orders') {
      const data = await _p2pApiFetch(`/api/p2p/orders/my?address=${encodeURIComponent(myAddr||'')}`);
      const orders = data.orders || [];
      list.innerHTML = '';
      if (!orders.length) { list.innerHTML = '<div style="color:#374151;font-size:11px;text-align:center;padding:24px 0;font-family:monospace;">No orders yet</div>'; return; }
      orders.forEach(order => {
        const sc = {open:'#22c55e',locked:'#f59e0b',completed:'#6b7280',cancelled:'#4b5563',disputed:'#dc2626'}[order.status]||'#888';
        const card = document.createElement('div');
        card.style.cssText = 'background:#111;border:1px solid #1e1e1e;border-radius:6px;padding:10px;cursor:pointer;';
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:12px;color:#fff;font-family:monospace;">${_p2pFmt(order.pohAmount)} POH</span>
            <span style="font-size:9px;padding:2px 6px;border-radius:3px;background:${sc}22;color:${sc};font-family:monospace;">${order.status.toUpperCase()}</span>
          </div>
          <div style="font-size:11px;color:#22c55e;font-family:monospace;">${order.pricePerPOH} ${order.quoteCurrency}/POH</div>
          <div style="font-size:10px;color:#555;font-family:monospace;margin-top:2px;">${order.side.toUpperCase()} · ${_p2pTimeAgo(order.createdAt)}</div>
        `;
        card.onclick = () => p2pOpenOrder(order);
        list.appendChild(card);
      });
    } else {
      const data = await _p2pApiFetch(`/api/p2p/trades/my?address=${encodeURIComponent(myAddr||'')}`);
      const trades = data.trades || [];
      list.innerHTML = '';
      if (!trades.length) { list.innerHTML = '<div style="color:#374151;font-size:11px;text-align:center;padding:24px 0;font-family:monospace;">No trades yet</div>'; return; }
      trades.forEach(({ trade, order }) => {
        if (!trade) return;
        const sc = {selected:'#f59e0b',payment_sent:'#3b82f6',completed:'#22c55e',cancelled:'#6b7280',disputed:'#ef4444'}[trade.status]||'#888';
        const card = document.createElement('div');
        card.style.cssText = 'background:#111;border:1px solid #1e1e1e;border-radius:6px;padding:10px;cursor:pointer;';
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:12px;color:#fff;font-family:monospace;">${_p2pFmt(trade.pohAmount)} POH</span>
            <span style="font-size:9px;padding:2px 6px;border-radius:3px;background:${sc}22;color:${sc};font-family:monospace;">${trade.status.replace('_',' ').toUpperCase()}</span>
          </div>
          <div style="font-size:11px;color:#22c55e;font-family:monospace;">${(trade.quoteAmount||0).toFixed(4)} ${order?.quoteCurrency||''}</div>
          <div style="font-size:10px;color:#555;font-family:monospace;margin-top:2px;">${order?.side?.toUpperCase()||'—'} · ${_p2pTimeAgo(trade.createdAt)}</div>
        `;
        card.onclick = () => p2pOpenTrade(trade.id, trade.orderId);
        list.appendChild(card);
      });
    }
  } catch (e) { list.innerHTML = `<div style="color:#ef4444;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">${e.message}</div>`; }
}
