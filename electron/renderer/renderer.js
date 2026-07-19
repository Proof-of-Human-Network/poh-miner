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

  // No auto-scroll — user may be reviewing past logs

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
    _updateUsdBalanceDisplay();
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
    const model = status.model || 'qwen3-1.7b';
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
  walletBackupKey: null,
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

  const engineIcon   = document.getElementById('setup-ollama-icon');
  const engineStatus = document.getElementById('setup-ollama-status');
  const modelIcon    = document.getElementById('setup-model-icon');
  const modelStatus  = document.getElementById('setup-model-status');
  const progressWrap = document.getElementById('setup-progress-wrap');
  const progressBar  = document.getElementById('setup-progress-bar');
  const progressPct  = document.getElementById('setup-progress-pct');
  const logEl        = document.getElementById('setup-log');
  const continueBtn  = document.getElementById('setup-continue-btn');

  // Inference engine is QVAC, in-process — nothing to install.
  if (engineIcon) engineIcon.textContent = '✅';
  if (engineStatus) engineStatus.textContent = 'QVAC (in-process)';

  // Listen for streaming warm-up progress from the main process.
  window.pohMinerAPI.setup.onProgress((msg) => {
    if (logEl) logEl.textContent = msg.message || '';
    if (msg.status === 'pulling') {
      if (msg.pct != null) {
        if (progressWrap) progressWrap.classList.remove('hidden');
        if (progressBar) progressBar.style.width = msg.pct + '%';
        if (progressPct) progressPct.textContent = msg.pct + '%';
      }
      if (modelStatus) modelStatus.textContent = msg.pct != null ? `Downloading… ${msg.pct}%` : 'Preparing…';
    }
    if (msg.status === 'ready') {
      if (modelIcon) modelIcon.textContent = '✅';
      if (modelStatus) modelStatus.textContent = 'Ready';
      if (progressWrap) progressWrap.classList.add('hidden');
      if (continueBtn) continueBtn.disabled = false;
    }
    if (msg.status === 'error') {
      if (modelIcon) modelIcon.textContent = '⚠️';
      if (modelStatus) modelStatus.textContent = msg.message;
      if (continueBtn) continueBtn.disabled = false; // non-fatal — loads on first job
    }
  });

  // 1. Check current state (which QVAC model, and whether it's already loaded)
  const state = await window.pohMinerAPI.setup.check();

  if (state.ready) {
    if (modelIcon) modelIcon.textContent = '✅';
    if (modelStatus) modelStatus.textContent = `Ready (${state.model || 'qwen3-1.7b'})`;
    if (continueBtn) continueBtn.disabled = false;
    showOnboardingStep('welcome');
    return;
  }

  // 2. First-run picker: choose a model graded for this machine, then warm it up.
  const MODEL = await promptModelChoice(state.model || 'qwen3-1.7b');

  const picker   = document.getElementById('model-picker');
  const progress = document.getElementById('model-progress');
  if (picker)   picker.classList.add('hidden');
  if (progress) progress.classList.remove('hidden');

  if (modelStatus) modelStatus.textContent = `Preparing ${MODEL} (first run downloads it)…`;
  if (modelIcon) modelIcon.textContent = '⬇️';
  if (progressWrap) progressWrap.classList.remove('hidden');
  await window.pohMinerAPI.setup.pullModel(MODEL);
}

// Render three hardware-graded model options and resolve with the user's pick
// (also persists it via onboarding.setModel). Falls back to the default model
// if the options can't be loaded.
async function promptModelChoice(fallback) {
  const picker   = document.getElementById('model-picker');
  const progress = document.getElementById('model-progress');
  const hwEl     = document.getElementById('model-hw-summary');
  const optsEl   = document.getElementById('model-options');
  const btn      = document.getElementById('model-download-btn');
  if (!picker || !optsEl || !btn) return fallback;

  if (progress) progress.classList.add('hidden');
  picker.classList.remove('hidden');

  let data;
  try { data = await window.pohMinerAPI.onboarding.getModelOptions(); }
  catch { return fallback; }
  if (!data?.options?.length) return fallback;

  if (hwEl) hwEl.textContent = data.hardwareSummary || '';
  const tierLabel = { small: 'Small', medium: 'Medium', large: 'Large' };
  let selected = data.recommended || data.options[0].name;

  const paint = () => optsEl.querySelectorAll('label').forEach(l => {
    const on = l.getAttribute('data-model') === selected;
    l.classList.toggle('border-[#22c55e]', on);
    l.classList.toggle('bg-[#22c55e]/10', on);
    l.classList.toggle('border-white/10', !on);
  });

  optsEl.innerHTML = data.options.map(o => `
    <label data-model="${o.name}" class="flex items-start gap-3 p-3 rounded-2xl border cursor-pointer">
      <input type="radio" name="model-choice" value="${o.name}" ${o.name === selected ? 'checked' : ''} class="mt-1 accent-[#22c55e]">
      <div class="flex-1">
        <div class="text-sm font-medium">${tierLabel[o.tier] || o.tier} · ${o.label}
          <span class="text-xs text-zinc-500">~${o.approxDownloadGB} GB${o.name === data.recommended ? ' · recommended' : ''}</span></div>
        <div class="text-xs text-zinc-500">${o.blurb}</div>
      </div>
    </label>`).join('');
  paint();

  optsEl.querySelectorAll('input[name="model-choice"]').forEach(r =>
    r.addEventListener('change', () => { selected = r.value; paint(); }));

  btn.disabled = false;
  return await new Promise(resolve => {
    btn.onclick = async () => {
      btn.disabled = true;
      try { await window.pohMinerAPI.onboarding.setModel(selected); } catch { /* non-fatal */ }
      resolve(selected);
    };
  });
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

window.proceedToWalletKeyBackup = async function() {
  goToStep('wallet-key');
  const keyEl = document.getElementById('poh-wallet-key');
  if (keyEl) keyEl.textContent = 'Generating…';

  try {
    const result = await window.pohMinerAPI.onboarding.generateWalletBackupKey();
    currentOnboardingData.walletBackupKey = result.walletBackupKey;
    if (keyEl) keyEl.textContent = result.walletBackupKey;
  } catch (err) {
    console.error('Failed to generate wallet backup key:', err);
    if (keyEl) keyEl.textContent = 'Error — restart the app and try again';
    alert('Could not generate wallet encryption key. Please restart and try again.');
  }
};

window.copyWalletBackupKey = function() {
  if (!currentOnboardingData.walletBackupKey) return;
  navigator.clipboard.writeText(currentOnboardingData.walletBackupKey);
};

window.checkWalletKeyConfirmation = function() {
  const input = document.getElementById('wallet-key-confirm-input');
  const btn = document.getElementById('wallet-key-continue-btn');
  if (!input || !btn) return;

  const expected = 'I have backed up my wallet encryption key';
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
    walletBackupKeyConfirmed: !!currentOnboardingData.walletBackupKey,
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

// ── Settings subpages ────────────────────────────────────────────────────────

window.switchSettingsSubpage = function(name) {
  document.querySelectorAll('.settings-subpage').forEach(el => el.classList.toggle('active', el.id === `settings-sub-${name}`));
  document.querySelectorAll('.settings-subtab').forEach(el => el.classList.toggle('active', el.dataset.sub === name));
};

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
    } catch { miningModelSel.innerHTML = '<option value="">No models available</option>'; }
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

// ── HF dataset download-approval modal ────────────────────────────────────────

let _hfDatasetResolve = null;

function _fmtBytes(n) {
  if (n == null) return 'unknown size';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function showHfDatasetDownloadModal(info) {
  return new Promise(resolve => {
    _hfDatasetResolve = resolve;
    let modal = document.getElementById('hf-dataset-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'hf-dataset-modal';
      modal.className = 'fixed inset-0 bg-black/80 z-[200] flex items-center justify-center';
      modal.innerHTML = `
        <div class="glass w-full max-w-sm rounded-3xl p-6 border border-white/10 text-center">
          <div class="text-3xl mb-3">🤗</div>
          <h3 class="font-display text-lg mb-2">Download dataset?</h3>
          <p class="text-xs text-zinc-300 mb-1 font-mono" id="hf-dataset-id"></p>
          <p class="text-xs text-zinc-500 mb-2" id="hf-dataset-desc"></p>
          <p class="text-xs text-zinc-400 mb-5" id="hf-dataset-size"></p>
          <div class="flex gap-2">
            <button onclick="window._hfDatasetCancel()"
                    class="flex-1 py-2.5 border border-white/20 rounded-2xl text-sm">Cancel</button>
            <button onclick="window._hfDatasetApprove()"
                    class="flex-1 py-2.5 bg-white text-black rounded-2xl text-sm font-semibold">Download</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }
    document.getElementById('hf-dataset-id').textContent = info.datasetId;
    document.getElementById('hf-dataset-desc').textContent = info.description || 'No description available.';
    document.getElementById('hf-dataset-size').textContent = `Size: ${_fmtBytes(info.estimatedSizeBytes)}`;
    modal.classList.remove('hidden');
  });
}

window._hfDatasetCancel = function() {
  document.getElementById('hf-dataset-modal')?.classList.add('hidden');
  if (_hfDatasetResolve) { _hfDatasetResolve(false); _hfDatasetResolve = null; }
};

window._hfDatasetApprove = function() {
  document.getElementById('hf-dataset-modal')?.classList.add('hidden');
  if (_hfDatasetResolve) { _hfDatasetResolve(true); _hfDatasetResolve = null; }
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

// =====================================================
// External AI Providers (Claude, OpenAI, Grok)
// =====================================================

const AI_PROVIDER_DEFS = [
  { id: 'anthropic', label: 'Claude (Anthropic)', defaultModel: 'claude-sonnet-4-6' },
  { id: 'openai',    label: 'OpenAI',             defaultModel: 'gpt-4o-mini' },
  { id: 'xai',       label: 'Grok (xAI)',          defaultModel: 'grok-2-latest' },
];

async function initAiProvidersUI() {
  const list = document.getElementById('ai-providers-list');
  if (!list || !window.pohMinerAPI?.aiProviders) return;

  let saved = {};
  try { saved = await window.pohMinerAPI.aiProviders.get(); } catch {}

  list.innerHTML = '';

  for (const def of AI_PROVIDER_DEFS) {
    const cfg = saved[def.id] || {};
    const row = document.createElement('div');
    row.style.cssText = 'background:#0a0a0a;border:1px solid #1a1a1a;border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:6px;';
    row.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <label style="font-size:11px;color:#ddd;display:flex;align-items:center;gap:6px;">
          <input type="checkbox" id="ai-${def.id}-enabled" ${cfg.enabled ? 'checked' : ''}/> ${def.label}
        </label>
      </div>
      <input id="ai-${def.id}-model" placeholder="Model (default: ${def.defaultModel})" value="${cfg.model || ''}"
             style="width:100%;padding:5px;background:#111;color:#ddd;border:1px solid #2a2a2a;border-radius:4px;font-family:monospace;font-size:11px;box-sizing:border-box;">
      <input id="ai-${def.id}-key" type="password" placeholder="${cfg.apiKey ? '•••••••••••••••••••••••• (key saved)' : 'API key'}"
             style="width:100%;padding:5px;background:#111;color:#ddd;border:1px solid #2a2a2a;border-radius:4px;font-family:monospace;font-size:11px;box-sizing:border-box;">
      <div style="display:flex;gap:4px;">
        <button id="ai-${def.id}-save" style="flex:1;padding:5px;background:#166534;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;">Save</button>
        <button id="ai-${def.id}-remove" style="padding:5px 8px;background:#1a1a1a;color:#888;border:none;border-radius:4px;cursor:pointer;font-size:11px;">Remove</button>
      </div>
      <div id="ai-${def.id}-status" style="font-size:10px;color:#22c55e;min-height:12px;"></div>
    `;
    list.appendChild(row);

    document.getElementById(`ai-${def.id}-save`).addEventListener('click', async () => {
      const status  = document.getElementById(`ai-${def.id}-status`);
      const enabled = document.getElementById(`ai-${def.id}-enabled`).checked;
      const model   = document.getElementById(`ai-${def.id}-model`).value.trim();
      const keyInput = document.getElementById(`ai-${def.id}-key`);
      const apiKey  = keyInput.value.trim() || cfg.apiKey || '';

      status.textContent = 'Saving...';
      status.style.color = '#888';
      try {
        await window.pohMinerAPI.aiProviders.save({ id: def.id, apiKey, model, enabled });
        status.textContent = 'Saved';
        status.style.color = '#22c55e';
        cfg.apiKey = apiKey;
        if (keyInput.value.trim()) {
          keyInput.value = '';
          keyInput.placeholder = '•••••••••••••••••••••••• (key saved)';
        }
      } catch {
        status.textContent = 'Failed to save';
        status.style.color = '#f87171';
      }
    });

    document.getElementById(`ai-${def.id}-remove`).addEventListener('click', async () => {
      const status = document.getElementById(`ai-${def.id}-status`);
      try {
        await window.pohMinerAPI.aiProviders.delete(def.id);
        initAiProvidersUI();
      } catch {
        status.textContent = 'Failed to remove';
        status.style.color = '#f87171';
      }
    });
  }
}

initAiProvidersUI();

// =====================================================
// External MCP Servers
// =====================================================

async function initMcpServersUI() {
  const list = document.getElementById('mcp-servers-list');
  const addBtn = document.getElementById('mcp-add-btn');
  const importBtn = document.getElementById('mcp-import-btn');
  const status = document.getElementById('mcp-status');
  if (!list || !addBtn || !window.pohMinerAPI?.mcp) return;

  async function renderList() {
    let servers = [];
    try { servers = await window.pohMinerAPI.mcp.getServers(); } catch {}

    list.innerHTML = '';
    if (!servers.length) {
      list.innerHTML = '<div style="font-size:10px;color:#444;">No MCP servers configured. Add one below or paste standard mcpServers JSON.</div>';
      return;
    }

    for (const s of servers) {
      const cmdLine = [s.command, ...(s.args || [])].filter(Boolean).join(' ');
      const row = document.createElement('div');
      row.style.cssText = 'background:#0a0a0a;border:1px solid #1a1a1a;border-radius:6px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;';
      row.innerHTML = `
        <div style="min-width:0;">
          <div style="font-size:11px;color:#ddd;">${s.name || s.id || '(unnamed)'} ${s.enabled ? '' : '<span style="color:#666;">(disabled)</span>'}</div>
          <div style="font-size:10px;color:#666;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${cmdLine || s.url || ''}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button data-action="toggle" style="padding:4px 8px;background:#1a1a1a;color:#9ca3af;border:none;border-radius:4px;cursor:pointer;font-size:10px;">${s.enabled ? 'Disable' : 'Enable'}</button>
          <button data-action="remove" style="padding:4px 8px;background:rgba(185,28,28,0.15);color:#f87171;border:none;border-radius:4px;cursor:pointer;font-size:10px;">Remove</button>
        </div>
      `;
      row.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
        await window.pohMinerAPI.mcp.saveServer({ ...s, enabled: !s.enabled });
        renderList();
      });
      row.querySelector('[data-action="remove"]').addEventListener('click', async () => {
        await window.pohMinerAPI.mcp.deleteServer(s.id);
        renderList();
      });
      list.appendChild(row);
    }
  }

  addBtn.addEventListener('click', async () => {
    const name = document.getElementById('mcp-new-name').value.trim();
    const command = document.getElementById('mcp-new-command').value.trim();
    const argsRaw = document.getElementById('mcp-new-args').value.trim();
    const envRaw = document.getElementById('mcp-new-env').value.trim();

    if (!name || !command) {
      status.textContent = 'Server id and command are required';
      status.style.color = '#f87171';
      return;
    }

    let args = [];
    let env = {};
    try { if (argsRaw) args = JSON.parse(argsRaw); } catch { status.textContent = 'args must be valid JSON array'; status.style.color = '#f87171'; return; }
    try { if (envRaw) env = JSON.parse(envRaw); } catch { status.textContent = 'env must be valid JSON object'; status.style.color = '#f87171'; return; }

    status.textContent = 'Adding...';
    status.style.color = '#888';
    try {
      await window.pohMinerAPI.mcp.saveServer({ id: name, name, command, args, env, enabled: true });
      document.getElementById('mcp-new-name').value = '';
      document.getElementById('mcp-new-command').value = '';
      document.getElementById('mcp-new-args').value = '';
      document.getElementById('mcp-new-env').value = '';
      status.textContent = 'MCP server added';
      status.style.color = '#22c55e';
      renderList();
    } catch {
      status.textContent = 'Failed to add server';
      status.style.color = '#f87171';
    }
  });

  importBtn?.addEventListener('click', async () => {
    const paste = document.getElementById('mcp-json-paste')?.value?.trim();
    if (!paste) { status.textContent = 'Paste mcpServers JSON first'; status.style.color = '#f87171'; return; }
    status.textContent = 'Importing...';
    status.style.color = '#888';
    try {
      const r = await window.pohMinerAPI.mcp.importJson(paste);
      if (!r.success) throw new Error(r.error);
      status.textContent = `Imported ${r.count} server(s)`;
      status.style.color = '#22c55e';
      document.getElementById('mcp-json-paste').value = '';
      renderList();
    } catch (e) {
      status.textContent = e.message || 'Import failed';
      status.style.color = '#f87171';
    }
  });

  renderList();
}

initMcpServersUI();

// =====================================================
// Installed HF Datasets (Settings panel)
// =====================================================

async function refreshHfDatasetsSettings() {
  const list = document.getElementById('hf-datasets-list');
  if (!list) return;
  const port = window._minerApiPort || 3456;

  let datasets = [];
  try {
    const r = await fetch(`http://localhost:${port}/api/hf-dataset`);
    if (r.ok) datasets = (await r.json()).datasets || [];
  } catch { /* miner API not reachable yet */ }

  list.innerHTML = '';
  if (!datasets.length) {
    list.innerHTML = `<div style="font-size:10px;color:#444;">No datasets installed yet.</div>`;
    return;
  }

  for (const d of datasets) {
    const sizeBytes = (d.files || []).reduce((sum, f) => sum + (f.size || 0), 0);
    const row = document.createElement('div');
    row.style.cssText = 'background:#0a0a0a;border:1px solid #1a1a1a;border-radius:6px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;';
    row.innerHTML = `
      <div style="min-width:0;">
        <div style="font-size:11px;color:#ddd;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.id}</div>
        <div style="font-size:10px;color:#666;">${_fmtBytes(sizeBytes)} · ${d.source || 'huggingface'}${d.rowCount ? ` · ${d.rowCount} rows` : ''}</div>
      </div>
      <button data-action="remove" style="padding:4px 8px;background:rgba(185,28,28,0.15);color:#f87171;border:none;border-radius:4px;cursor:pointer;font-size:10px;flex-shrink:0;">Remove</button>
    `;
    row.querySelector('[data-action="remove"]').addEventListener('click', async () => {
      try {
        await fetch(`http://localhost:${port}/api/hf-dataset/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
      } catch { /* best effort */ }
      refreshHfDatasetsSettings();
    });
    list.appendChild(row);
  }
}

async function installHfDataset() {
  const input  = document.getElementById('hf-dataset-install-id');
  const status = document.getElementById('hf-dataset-install-status');
  const btn    = document.getElementById('hf-dataset-install-btn');
  if (!input || !status || !btn) return;

  const id = input.value.trim();
  if (!id) { status.style.color = '#f87171'; status.textContent = 'Enter a dataset ID'; return; }

  const port = window._minerApiPort || 3456;
  btn.disabled = true;
  status.style.color = '#facc15';
  status.textContent = 'Downloading… (this may take a few minutes)';

  try {
    const r = await fetch(`http://localhost:${port}/api/hf-dataset/${encodeURIComponent(id)}/download`, { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      status.style.color = '#f87171';
      status.textContent = `Error: ${data.error || 'download failed'}`;
    } else {
      status.style.color = '#4ade80';
      status.textContent = `Installed "${id}" successfully`;
      input.value = '';
      refreshHfDatasetsSettings();
    }
  } catch (e) {
    status.style.color = '#f87171';
    status.textContent = `Error: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

// Sidebar resizer removed — layout now uses fixed 3-column flex

// ── Tab switching ──────────────────────────────────────────────────────────────

const TAB_PANELS = { home: 'home-panel', logs: 'logs', chat: 'chat-panel', search: 'search-panel', send: 'send-panel', skills: 'skills-panel', settings: 'settings-panel', p2p: 'p2p-panel', explorer: 'explorer-panel' };
const TAB_BTNS   = { home: 'tab-home-btn', logs: 'tab-logs-btn', chat: 'tab-chat-btn', search: 'tab-search-btn', send: 'tab-send-btn', skills: 'tab-skills-btn', settings: null, p2p: 'tab-p2p-btn', explorer: 'tab-explorer-btn' };

function switchTab(name) {
  Object.entries(TAB_PANELS).forEach(([key, panelId]) => {
    const panel = document.getElementById(panelId);
    const btnId = TAB_BTNS[key];
    const btn   = btnId ? document.getElementById(btnId) : null;
    if (panel) panel.classList.toggle('active', key === name);
    if (btn)   btn.classList.toggle('active', key === name);
  });
  if (name === 'home')     { syncHomeBalance(); }
  if (name === 'chat')     { loadChatModels(true); document.getElementById('chat-input')?.focus(); }
  if (name === 'send')     { syncSendWallet(); showSendView(); }
  if (name === 'skills')   { loadSkills(); }
  if (name === 'settings') { loadSettingsPanel(); refreshHfDatasetsSettings(); }
  if (name === 'p2p')      { p2pInit(); }
  if (name === 'explorer') { explorerInit(); }
}

// ── Chat state ─────────────────────────────────────────────────────────────────

const chatHistory = []; // { role, content, _skillMemory? }
let chatStreaming = false; // private mode: blocks next send while true
let chatPublicJobs = 0;  // public mode: concurrent in-flight jobs
let chatAbortController = null;
const chatJobAbortControllers = new Map();
let _brainSystemPrompt = null; // full brain state injected as system msg on every chat send

function getLastSkillMemory() {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i]._skillMemory) return chatHistory[i]._skillMemory;
  }
  return null;
}

function pushAssistantReply(content, extras = {}) {
  chatHistory.push({ role: 'assistant', content, ...extras });
}

function _chatAskPayload(message, history, isPrivate, extra = {}) {
  const payload = {
    message,
    history,
    private: isPrivate,
    model: getActiveModel(),
    skillMemory: getLastSkillMemory(),
    ...extra,
  };
  if (!isPrivate && window._localWallet) payload.requesterAddress = window._localWallet;
  return payload;
}

const HF_DATASET_INSTALL_HINT = `**No Hugging Face datasets installed on this miner.**

To install a dataset:
1. Ask in Chat about a dataset (e.g. "search huggingface for squad")
2. Approve the download prompt when it appears
3. Or use **Settings → Datasets**, or call \`POST /api/hf-dataset/{datasetId}/download\` on your miner API (port ${window._minerApiPort || 3456})
4. Requires internet; files are stored under \`~/.poh-miner/brain-data/hf-datasets/\``;

function _updateChatQueuePill() {
  const pill = document.getElementById('chat-queue-pill');
  if (!pill) return;
  if (window._chatPrivate || chatPublicJobs <= 0) {
    pill.style.display = 'none';
  } else {
    pill.style.display = 'inline';
    pill.textContent = `${chatPublicJobs} running`;
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
  const isPrivate = window._chatPrivate !== false;
  document.getElementById('chat-send-btn').disabled = isPrivate && active;
  const stopBtn = document.getElementById('chat-stop-btn');
  if (stopBtn) stopBtn.style.display = (isPrivate && active) ? 'block' : 'none';
}

function stopChatStream() {
  if (chatAbortController) chatAbortController.abort();
  for (const ctrl of chatJobAbortControllers.values()) ctrl.abort();
}

// ── Global active model ────────────────────────────────────────────────────────
// Single source of truth for the model used by scan, chat, and skills.

window._activeModel  = 'qwen3-1.7b';
window._cachedModels = [];

function getActiveModel() {
  return window._activeModel || 'qwen3-1.7b';
}

function setActiveModel(name) {
  window._activeModel = name;
  const sel = document.getElementById('chat-model-select');
  if (sel) sel.value = name;
  const btn = document.getElementById('brain-model');
  if (btn) btn.textContent = name;
}

window.onChatModelSelect = function(name) {
  window._modelUserPicked = true;
  const entry = window._cachedModelEntries?.find(m => m.name === name);
  window._activeModelIsNetwork = !!entry && !entry.local;
  setActiveModel(name);
};

// ── Model picker modal ─────────────────────────────────────────────────────────

window.openModelPicker = async function() {
  document.getElementById('model-picker-backdrop')?.classList.remove('hidden');
  await _renderModelList();
};

window.closeModelPicker = function() {
  document.getElementById('model-picker-backdrop')?.classList.add('hidden');
};

window._cachedModelEntries = []; // [{ name, local, peerCount }]

async function _renderModelList() {
  const listEl = document.getElementById('mp-list');
  if (!listEl) return;

  // Use cache if fresh, otherwise re-fetch (local Ollama catalog + network-reported models)
  if (!window._cachedModelEntries.length) {
    listEl.innerHTML = '<div class="mp-empty">Loading…</div>';
    try {
      const port = window._minerApiPort || 3456;
      const [localRes, netRes] = await Promise.all([
        fetch(`http://localhost:${port}/api/models`).catch(() => null),
        fetch(`http://localhost:${port}/api/network-models`).catch(() => null),
      ]);

      const byName = new Map();
      if (localRes?.ok) {
        const data = await localRes.json();
        for (const m of (data.models || [])) {
          const name = m.name || m.model;
          if (name) byName.set(name, { name, local: true, peerCount: 0 });
        }
      }
      if (netRes?.ok) {
        const data = await netRes.json();
        for (const m of (data.models || [])) {
          const existing = byName.get(m.name);
          byName.set(m.name, { name: m.name, local: existing?.local || m.local, peerCount: m.peerCount || 0 });
        }
      }
      window._cachedModelEntries = [...byName.values()];
      window._cachedModels = window._cachedModelEntries.map(m => m.name);
    } catch {}
  }

  _paintModelList(window._cachedModelEntries);
}

function _paintModelList(entries) {
  const listEl = document.getElementById('mp-list');
  if (!listEl) return;

  if (!entries.length) {
    listEl.innerHTML = '<div class="mp-empty">No models found.<br>The QVAC model downloads on first use.</div>';
    return;
  }

  const icons = { qwen: '🧠', llama: '🦙', mistral: '🌪', gemma: '💎', phi: '🔬', deepseek: '🔍', default: '⚡' };
  function modelIcon(name) {
    const n = name.toLowerCase();
    for (const [k, v] of Object.entries(icons)) if (n.includes(k)) return v;
    return icons.default;
  }

  listEl.innerHTML = entries.map(m => {
    const active = m.name === window._activeModel;
    const networkBadge = !m.local
      ? `<span class="mp-item-badge" style="color:#60a5fa;background:#0a1a2f;border-color:#1a3a5a;">NETWORK${m.peerCount > 1 ? ` ·${m.peerCount}` : ''}</span>`
      : '';
    return `<div class="mp-item${active ? ' active' : ''}" onclick="pickModel('${m.name.replace(/'/g,"\\'")}')">
      <div class="mp-item-icon">${modelIcon(m.name)}</div>
      <span class="mp-item-name">${m.name}</span>
      ${active ? '<span class="mp-item-badge">ACTIVE</span>' : networkBadge}
    </div>`;
  }).join('');
}

window._filterModelList = function(query) {
  const q = (query || '').trim().toLowerCase();
  const filtered = !q
    ? window._cachedModelEntries
    : window._cachedModelEntries.filter(m => m.name.toLowerCase().includes(q));
  _paintModelList(filtered);
};

window.pickModel = function(name) {
  window._modelUserPicked = true;
  const entry = window._cachedModelEntries.find(m => m.name === name);
  window._activeModelIsNetwork = !!entry && !entry.local;
  setActiveModel(name);
  closeModelPicker();
};

// ── Model loader (for backward compat + hidden select population) ──────────────

async function loadChatModels(force = false) {
  const sel = document.getElementById('chat-model-select');
  if (!sel) return;
  if (!force && sel.dataset.loaded) return;
  try {
    const port = window._minerApiPort || 3456;
    const [localRes, netRes] = await Promise.all([
      fetch(`http://localhost:${port}/api/models`).catch(() => null),
      fetch(`http://localhost:${port}/api/network-models`).catch(() => null),
    ]);
    const byName = new Map();
    if (localRes?.ok) {
      const data = await localRes.json();
      for (const m of (data.models || [])) {
        const name = m.name || m.model;
        if (name) byName.set(name, { name, local: true, peerCount: 0 });
      }
    }
    if (netRes?.ok) {
      const data = await netRes.json();
      for (const m of (data.models || [])) {
        const existing = byName.get(m.name);
        byName.set(m.name, { name: m.name, local: existing?.local || m.local, peerCount: m.peerCount || 0 });
      }
    }
    window._cachedModelEntries = [...byName.values()];
    window._cachedModels = window._cachedModelEntries.map(m => m.name);
    sel.innerHTML = '';
    if (!window._cachedModelEntries.length) {
      sel.innerHTML = '<option value="">No models found</option>';
      return;
    }
    for (const m of window._cachedModelEntries) {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.local ? m.name : `${m.name} (network)`;
      sel.appendChild(opt);
    }
    if (!window._modelUserPicked) {
      const qwen = window._cachedModels.find(m => m.includes('qwen')) || window._cachedModels[0];
      if (qwen) setActiveModel(qwen);
    } else {
      setActiveModel(getActiveModel());
    }
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
  // No auto-scroll — user may be scrolled up reading earlier messages
  return bubble;
}

function _resolveBubble(bubbleOrToken) {
  if (bubbleOrToken && bubbleOrToken.classList?.contains('chat-bubble')) return bubbleOrToken;
  const msgs = document.getElementById('chat-messages');
  return msgs?.querySelector('.chat-msg.assistant:last-child .chat-bubble') || null;
}

function appendToBubble(bubble, token) {
  const el = bubble?.classList?.contains('chat-bubble') ? bubble : _resolveBubble(null);
  const tok = token ?? bubble;
  if (!el || typeof tok !== 'string') return;

  el._rawText = (el._rawText || '') + tok;
  el.innerHTML = _mdParse(el._rawText);

  el.querySelector('.chat-cursor')?.remove();
  const cur = document.createElement('span');
  cur.className = 'chat-cursor';
  cur.id = el.dataset.jobId ? `chat-cursor-${el.dataset.jobId}` : 'chat-cursor';
  const lastEl = el.lastElementChild;
  if (lastEl && ['P','LI','H1','H2','H3','H4','TD','BLOCKQUOTE'].includes(lastEl.tagName)) {
    lastEl.appendChild(cur);
  } else {
    el.appendChild(cur);
  }
}

function appendToLastBubble(bubble, token) {
  if (typeof bubble === 'string' && token === undefined) appendToBubble(null, bubble);
  else appendToBubble(bubble, token);
}

function finalizeBubble(bubble) {
  const el = bubble || _resolveBubble(null);
  if (!el) return;
  el.querySelector('.chat-cursor')?.remove();
  if (el._rawText) {
    el.innerHTML = _mdParse(el._rawText);
    _renderMath(el);
  }
}

function finalizeLastBubble(bubble) {
  finalizeBubble(bubble || null);
}

// ── Send + stream ──────────────────────────────────────────────────────────────

function getChatBudget() {
  // Slider min is 1 (= 0.01 POH) — 0/"no fee" is no longer a selectable value.
  const step = Math.max(1, parseInt(document.getElementById('chat-budget-slider')?.value || '1', 10));
  return Math.round(_sliderStepToPoh(step) * BUDGET_DECIMALS);
}

window.updateChatBudgetDisplay = function(val) {
  const step = Math.max(1, parseInt(val, 10) || 1);
  const el = document.getElementById('chat-budget-display');
  if (!el) return;
  el.textContent = _formatPoh(_sliderStepToPoh(step));
  const slider = document.getElementById('chat-budget-slider');
  if (slider) slider.style.setProperty('--fill', `${(step / _BLOG_STEPS) * 100}%`);
};

// ── Privacy toggle ──────────────────────────────────────────────────────────────
// Private (default): conversation never leaves this device — runs on local Ollama
// only, free, no job/fee involved. Public: every message is submitted as a paid
// network compute job (even "hello") — the budget slider only matters in this mode.

window._chatPrivate = true;

function _updateChatBudgetVisibility() {
  const row = document.getElementById('chat-budget-row');
  if (row) row.style.display = window._chatPrivate ? 'none' : '';
}
_updateChatBudgetVisibility();

window.toggleChatPrivacy = function() {
  window._chatPrivate = !window._chatPrivate;
  const btn = document.getElementById('chat-privacy-toggle');
  if (btn) {
    if (window._chatPrivate) {
      btn.textContent = '🔒 Private';
      btn.classList.remove('public');
    } else {
      btn.textContent = '🌐 Public';
      btn.classList.add('public');
    }
  }
  _updateChatBudgetVisibility();
};

// ── File upload ────────────────────────────────────────────────────────────────

window._chatAttachedFile = null;
const MAX_CHAT_FILE_BYTES = 100 * 1024;

window.handleChatFileUpload = function(event) {
  const file = event.target.files?.[0];
  event.target.value = ''; // allow re-selecting the same file later
  if (!file) return;
  if (file.size > MAX_CHAT_FILE_BYTES) {
    alert(`File too large (max 100KB). "${file.name}" is ${(file.size / 1024).toFixed(0)}KB.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    window._chatAttachedFile = { name: file.name, content: String(reader.result).slice(0, 100_000) };
    const chip = document.getElementById('chat-file-chip');
    const chipName = document.getElementById('chat-file-chip-name');
    if (chip && chipName) {
      chipName.textContent = `📎 ${file.name}`;
      chip.style.display = 'flex';
    }
  };
  reader.onerror = () => alert(`Could not read file "${file.name}".`);
  reader.readAsText(file);
};

window.removeChatFile = function() {
  window._chatAttachedFile = null;
  const chip = document.getElementById('chat-file-chip');
  if (chip) chip.style.display = 'none';
};

// ── Paid job payments ─────────────────────────────────────────────────────────
// Signs a job's fee payment using this node's own wallet (the node pays itself —
// the common case for a local desktop UI). The node holds the wallet's signing
// key locally, so it can produce the proof on our behalf without ever exposing
// the private key to the renderer.
async function _signJobPayment(jobId, amount) {
  const port = window._minerApiPort || 3456;
  const r = await fetch(`http://localhost:${port}/api/wallet/sign-job-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, amount }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `Could not sign payment (HTTP ${r.status})`);
  }
  return r.json(); // { requesterAddress, txHash, signature, signingPublicKey }
}

function _renderJobFeedbackStars(jobId) {
  const port = window._minerApiPort || 3456;
  const msgs = document.getElementById('chat-messages');
  if (!msgs || !jobId) return;
  const fb = document.createElement('div');
  fb.className = 'chat-feedback';
  fb.dataset.jobId = jobId;
  const stars = [1, 2, 3, 4, 5].map(n =>
    `<span class="chat-star" data-star="${n}" onclick="window._sendJobFeedback('${jobId}',${n},this.closest('.chat-feedback'))">★</span>`
  ).join('');
  fb.innerHTML = `<span class="chat-feedback-label">Rate this:</span><span class="chat-star-row">${stars}</span>`;
  fb.querySelectorAll('.chat-star').forEach(el => {
    el.addEventListener('mouseenter', () => {
      const n = parseInt(el.dataset.star, 10);
      fb.querySelectorAll('.chat-star').forEach(s => s.classList.toggle('hover', parseInt(s.dataset.star, 10) <= n));
    });
    el.addEventListener('mouseleave', () => {
      fb.querySelectorAll('.chat-star').forEach(s => s.classList.remove('hover'));
    });
  });
  msgs.appendChild(fb);
  if (!window._sendJobFeedback) {
    window._sendJobFeedback = async function(jId, stars2, container) {
      try {
        const r = await fetch(`http://localhost:${port}/api/jobs/${jId}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stars: stars2, requesterAddress: window._localWallet }),
        });
        if (r.ok && container) {
          container.innerHTML = `<span class="chat-feedback-label">Thanks! ${'★'.repeat(stars2)}${'☆'.repeat(5 - stars2)}</span>`;
        }
      } catch {}
    };
  }
}

// ── Public mode: every message is a paid network compute job ───────────────────
async function submitComputeJob(promptText, jobCtx = {}) {
  const port  = window._minerApiPort || 3456;
  const model = getActiveModel();
  const budget = getChatBudget();
  const input = document.getElementById('chat-input');
  const isPrivate = window._chatPrivate !== false;
  const { bubble: jobBubble, history: historyForJob, dataset } = jobCtx;
  const hist = historyForJob || chatHistory.slice(0, -1);
  const append = (t) => appendToBubble(jobBubble, t);
  const finalize = () => finalizeBubble(jobBubble);
  const showReply = (msg) => {
    if (jobBubble) {
      jobBubble._rawText = msg;
      finalize();
    } else {
      renderMessage('assistant', msg);
    }
    pushAssistantReply(msg);
  };

  if (!window._localWallet) {
    showReply('No local wallet found — cannot submit a paid job in Public mode.');
    return;
  }

  if (!jobBubble) renderMessage('assistant', 'Submitting paid compute job…', true);

  try {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { requesterAddress, txHash, signature } = await _signJobPayment(jobId, budget);

    const jobBody = {
      id: jobId,
      type: 'compute',
      model,
      payload: { prompt: promptText, history: hist },
      maxBudget: budget,
      requesterAddress,
      paymentTx: { txHash, signature },
    };
    if (dataset) jobBody.dataset = dataset;

    const jobRes = await fetch(`http://localhost:${port}/job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jobBody),
    });
    if (!jobRes.ok) {
      const err = await jobRes.json().catch(() => ({}));
      throw new Error(err.error || `Job submit failed (HTTP ${jobRes.status})`);
    }

    let attempts = 0;
    const result = await new Promise(resolve => {
      const t = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch(`http://localhost:${port}/job/${jobId}/result`);
          const data = await r.json();
          if (r.status === 202) {
            if (data.status === 'error' || data.status === 'ignored') {
              clearInterval(t);
              resolve({ _jobError: data.status, error: data.message || data.error });
              return;
            }
            if (attempts % 5 === 0) append('.');
            if (attempts > 30) { clearInterval(t); resolve(null); }
            return;
          }
          if (!r.ok || !data.verdict) return;
          clearInterval(t);
          resolve(data);
        } catch { if (attempts > 30) { clearInterval(t); resolve(null); } }
      }, 2000);
    });

    finalize();

    if (result?._jobError) {
      showReply(`Compute job failed (${result.error || result._jobError}).`);
    } else if (result) {
      const reply = result.profile?.computeOutput || 'No response generated.';
      showReply(reply);
      _renderJobFeedbackStars(jobId);
    } else {
      showReply('Compute job timed out waiting for a miner. It may still complete — check Explorer.');
    }
  } catch (e) {
    finalize();
    showReply(`Could not submit paid job: ${e.message}`);
  } finally {
    if (isPrivate) {
      chatAbortController = null;
      setChatStreaming(false);
      if (input) { input.disabled = false; input.focus(); }
    }
  }
}

async function sendChatMessage() {
  const isPrivate = window._chatPrivate !== false;
  if (isPrivate && chatStreaming) return;
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  const attachedFile = window._chatAttachedFile;
  if (!text && !attachedFile) return;

  if (isPrivate && window._activeModelIsNetwork) {
    alert(`"${getActiveModel()}" is only available on the network. Switch to Public mode or pick a local model.`);
    return;
  }

  input.value = '';
  input.style.height = '';
  if (isPrivate) {
    input.disabled = true;
    setChatStreaming(true);
  } else {
    chatPublicJobs++;
    _updateChatQueuePill();
  }

  const jobId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const jobAbort = new AbortController();
  chatJobAbortControllers.set(jobId, jobAbort);
  if (isPrivate) chatAbortController = jobAbort;

  let jobBubble = null;
  const jobAppend = (t) => appendToBubble(jobBubble, t);
  const jobFinalize = () => finalizeBubble(jobBubble);
  const jobShowAssistant = (content, streaming = false) => {
    jobBubble = renderMessage('assistant', content, streaming);
    if (jobBubble) jobBubble.dataset.jobId = jobId;
    return jobBubble;
  };

  let llmText = text;
  if (attachedFile) {
    llmText = `${text}\n\n[Attached file: ${attachedFile.name}]\n\`\`\`\n${attachedFile.content}\n\`\`\``;
  }

  chatHistory.push({ role: 'user', content: llmText });
  renderMessage('user', attachedFile ? `${text}\n\n📎 ${attachedFile.name}` : text);
  if (attachedFile) window.removeChatFile();

  const model = getActiveModel();
  const port  = window._minerApiPort || 3456;
  const historySnapshot = chatHistory.slice();

  function _endChatJob() {
    chatJobAbortControllers.delete(jobId);
    if (isPrivate) {
      chatAbortController = null;
      setChatStreaming(false);
      if (input) { input.disabled = false; input.focus(); }
    } else {
      chatPublicJobs = Math.max(0, chatPublicJobs - 1);
      _updateChatQueuePill();
    }
  }

  // ── Skill routing (both Private and Public) ────────────────────────────────
  const ADDR_RE = /0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}(?=[\s,!?"]|$)|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}|(EQ|UQ)[A-Za-z0-9+/_-]{46}|[\w-]+\.eth\b|[\w-]+\.sol\b|[\w-]+\.bnb\b/;
  const addrMatch = text.match(ADDR_RE);

  async function _submitSkillJob(skillId, payload) {
    // Paid network skill job — only used in Public mode when /chat/ask cannot run
    // the skill inline (community/non-private skills). Private mode runs skills
    // locally via /chat/ask and never reaches here.
    const body = { type: 'skill', skillId, payload };
    if (!isPrivate) {
      const budget = getChatBudget();
      const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { requesterAddress, txHash, signature } = await _signJobPayment(jobId, budget);
      body.id = jobId;
      body.maxBudget = budget;
      body.requesterAddress = requesterAddress;
      body.paymentTx = { txHash, signature };
    }
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
    const stars = [1, 2, 3, 4, 5].map(n =>
      `<span class="chat-star" data-star="${n}" onclick="window._sendJobFeedback('${jobId}',${n},this.closest('.chat-feedback'))">★</span>`
    ).join('');
    fb.innerHTML = `<span class="chat-feedback-label">Rate this:</span><span class="chat-star-row">${stars}</span>`;

    // Hover preview: fill stars up to the hovered one
    fb.querySelectorAll('.chat-star').forEach(el => {
      el.addEventListener('mouseenter', () => {
        const n = parseInt(el.dataset.star, 10);
        fb.querySelectorAll('.chat-star').forEach(s => s.classList.toggle('hover', parseInt(s.dataset.star, 10) <= n));
      });
      el.addEventListener('mouseleave', () => {
        fb.querySelectorAll('.chat-star').forEach(s => s.classList.remove('hover'));
      });
    });

    msgs.appendChild(fb);
  }

  window._sendJobFeedback = async function(jobId, stars, container) {
    try {
      const r = await fetch(`http://localhost:${port}/api/jobs/${jobId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars, requesterAddress: window._localWallet }),
      });
      if (r.ok && container) {
        container.innerHTML = `<span class="chat-feedback-label">Thanks! ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>`;
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

    if (!res.ok) throw new Error(`LLM ${res.status}`);

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
  // Tracks whether a "Fetching data via..." / "Searching..." placeholder bubble is
  // currently on screen, so the outer catch below knows to finalize it with an error
  // instead of silently falling through to plain Ollama chat (which would produce a
  // second, unrelated reply on top of the stuck placeholder bubble).
  let _bubbleShown = false;

  // Route message to a skill via backend (keyword fast path + LLM fallback)
  try {
    const routeRes = await fetch(`http://localhost:${port}/chat/route`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, budget: getChatBudget() }),
      signal: AbortSignal.timeout(8000),
    });
    if (routeRes.ok) {
      const route = await routeRes.json();
      if (route.type === 'cascade' && route.jobs?.length) {
        // Multi-skill cascade: delegate entirely to /chat/ask which runs all skills
        // inline and synthesizes the results with LLM — no paid job queue needed.
        const skillNames = route.jobs.map(j => j.skillId).join(' + ');
        jobShowAssistant(`Fetching data via \`${skillNames}\`…`, true);
        _bubbleShown = true;
        chatAbortController = jobAbort;
        try {
          const cascadeRes = await fetch(`http://localhost:${port}/chat/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_chatAskPayload(text, historySnapshot, isPrivate)),
            signal: AbortSignal.timeout(60000),
          });
          jobFinalize();
          if (cascadeRes.ok) {
            const cascadeData = await cascadeRes.json();
            const reply = cascadeData.message || route.jobs.map(j => j.skillId).join(' + ') + ' returned no data.';
            jobShowAssistant(reply);
            pushAssistantReply(reply, cascadeData.skillMemory ? { _skillMemory: cascadeData.skillMemory } : {});
          } else {
            const errData = await cascadeRes.json().catch(() => ({}));
            const msg = errData.error || `\`${skillNames}\` failed (HTTP ${cascadeRes.status}).`;
            renderMessage('assistant', msg);
            chatHistory.push({ role: 'assistant', content: msg });
          }
          _skillDone = true;
        } catch (e) {
          // A "Fetching data via..." bubble is already on screen — must finalize it with
          // a real message and mark _skillDone, otherwise execution falls through to
          // plain Ollama chat below and produces a second, unrelated reply.
          finalizeLastBubble();
          console.warn('[cascade] /chat/ask failed:', e.message);
          const msg = `\`${skillNames}\` failed: ${e.message}`;
          renderMessage('assistant', msg);
          chatHistory.push({ role: 'assistant', content: msg });
          _skillDone = true;
        }
      }

      if (!_skillDone && route.type === 'sequence') {
        // e.g. "create an ERC20 contract and audit it" — backend generates the code first,
        // then runs the matched skill's reference material against what was generated.
        jobShowAssistant(`Generating, then running \`${route.skillId}\`…`, true);
        _bubbleShown = true;
        chatAbortController = jobAbort;
        try {
          const seqRes = await fetch(`http://localhost:${port}/chat/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_chatAskPayload(text, historySnapshot, isPrivate)),
            signal: AbortSignal.timeout(120000),
          });
          jobFinalize();
          const seqData = await seqRes.json();
          const reply = seqData.message || `\`${route.skillId}\` returned no result.`;
          jobShowAssistant(reply);
          pushAssistantReply(reply, seqData.skillMemory ? { _skillMemory: seqData.skillMemory } : {});
          _skillDone = true;
        } catch (e) {
          finalizeLastBubble();
          console.warn('[sequence] /chat/ask failed:', e.message);
          const msg = `Generate-then-${route.skillId} failed: ${e.message}`;
          renderMessage('assistant', msg);
          chatHistory.push({ role: 'assistant', content: msg });
          _skillDone = true;
        }
      }

      if (!_skillDone && route.type === 'hf-model') {
        // Media-generation request — search Hugging Face models and suggest matches.
        jobShowAssistant('Searching Hugging Face models…', true);
        _bubbleShown = true;
        chatAbortController = jobAbort;
        try {
          const hfRes = await fetch(`http://localhost:${port}/chat/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_chatAskPayload(text, historySnapshot, isPrivate, { model })),
            signal: AbortSignal.timeout(60000),
          });
          jobFinalize();
          if (hfRes.ok) {
            const data = await hfRes.json();
            const reply = data.message || 'No Hugging Face models found for that request.';
            jobShowAssistant(reply);
            pushAssistantReply(reply);
          } else {
            const errData = await hfRes.json().catch(() => ({}));
            const msg = errData.error || `Hugging Face model search failed (HTTP ${hfRes.status}).`;
            renderMessage('assistant', msg);
            chatHistory.push({ role: 'assistant', content: msg });
          }
          _skillDone = true;
        } catch (e) {
          finalizeLastBubble();
          console.warn('[hf-model] /chat/ask failed:', e.message);
          const msg = 'Could not search Hugging Face models. Please try again.';
          renderMessage('assistant', msg);
          chatHistory.push({ role: 'assistant', content: msg });
          _skillDone = true;
        }
      }

      if (!_skillDone && route.type === 'dataset') {
        // No skill matched, but the message referenced a dataset — let the backend
        // search Hugging Face, disambiguate, and answer from a local/peer copy.
        // A 412 means nobody has it; show the download-approval modal.
        jobShowAssistant('Searching Hugging Face datasets…', true);
        _bubbleShown = true;
        chatAbortController = jobAbort;
        try {
          const dsRes = await fetch(`http://localhost:${port}/chat/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_chatAskPayload(text, historySnapshot, isPrivate)),
            signal: AbortSignal.timeout(60000),
          });
          jobFinalize();

          if (dsRes.status === 412) {
            const info = await dsRes.json();
            const approved = await showHfDatasetDownloadModal(info);
            if (approved) {
              renderMessage('assistant', `Downloading dataset \`${info.datasetId}\`…`, true);
              const dlRes = await fetch(`http://localhost:${port}/api/hf-dataset/${encodeURIComponent(info.datasetId)}/download`, { method: 'POST' });
              finalizeLastBubble();
              if (dlRes.ok) {
                renderMessage('assistant', '', true);
                const retryRes = await fetch(`http://localhost:${port}/chat/ask`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(_chatAskPayload(text, historySnapshot, isPrivate, { datasetId: info.datasetId })),
                  signal: AbortSignal.timeout(60000),
                });
                const retryData = await retryRes.json();
                jobFinalize();
                const reply = retryData.message || 'Could not answer using the downloaded dataset.';
                jobShowAssistant(reply);
                pushAssistantReply(reply);
                refreshHfDatasetsSettings();
              } else {
                const errData = await dlRes.json().catch(() => ({}));
                const msg = `Failed to download dataset: ${errData.error || dlRes.statusText}`;
                renderMessage('assistant', msg);
                chatHistory.push({ role: 'assistant', content: msg });
              }
            } else {
              const msg = `Download declined.\n\n${HF_DATASET_INSTALL_HINT}`;
              jobShowAssistant(msg);
              pushAssistantReply(msg);
            }
            _skillDone = true;
          } else if (dsRes.ok) {
            const data = await dsRes.json();
            const reply = data.message || 'No answer found.';
            jobShowAssistant(reply);
            pushAssistantReply(reply);
            _skillDone = true;
          }
        } catch (e) {
          // A bubble ("Searching Hugging Face datasets…") is already on screen — must
          // finalize it with a real message and mark _skillDone, otherwise execution
          // falls through to plain Ollama chat below and produces a second, unrelated reply.
          finalizeLastBubble();
          console.warn('[dataset] /chat/ask failed:', e.message);
          const msg = 'Could not search Hugging Face datasets. Please try again.';
          renderMessage('assistant', msg);
          chatHistory.push({ role: 'assistant', content: msg });
          _skillDone = true;
        }
      }

      if (!_skillDone && route.type === 'skill' && route.skillId) {
        // Check if skill is enabled locally before running
        const skillInfo = window._skillsData?.[route.skillId];
        if (skillInfo && skillInfo.enabled === false) {
          const proceed = await showSkillDisabledModal(route.skillId);
          if (!proceed) {
            setChatStreaming(false);
            document.getElementById('chat-input').disabled = false;
            return;
          }
        }

        jobShowAssistant(`Fetching data via \`${route.skillId}\`…`, true);
        _bubbleShown = true;
        chatAbortController = jobAbort;

        // Private mode: run skill locally via /chat/ask (inline sandbox + local LLM).
        // Public mode: same path for builtin/private skills; community skills fall
        // through to a paid /job submission below.
        let needsPaidJob = false;
        try {
          const askRes = await fetch(`http://localhost:${port}/chat/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_chatAskPayload(text, historySnapshot, isPrivate, { model })),
            signal: AbortSignal.timeout(120000),
          });
          jobFinalize();

          if (askRes.ok) {
            const askData = await askRes.json();
            if (askData.type === 'skill' && askData.skillId) {
              if (isPrivate) {
                const msg = `Could not run \`${askData.skillId}\` locally. Switch to Public mode for network skills.`;
                jobShowAssistant(msg);
                pushAssistantReply(msg);
                _skillDone = true;
              } else {
                needsPaidJob = true;
              }
            } else {
              const reply = askData.message || `\`${route.skillId}\` returned no data.`;
              jobShowAssistant(reply);
              pushAssistantReply(reply, askData.skillMemory ? { _skillMemory: askData.skillMemory } : {});
              _skillDone = true;
            }
          } else if (!isPrivate) {
            needsPaidJob = true;
          } else {
            const errData = await askRes.json().catch(() => ({}));
            const msg = errData.error || `\`${route.skillId}\` failed (HTTP ${askRes.status}).`;
            renderMessage('assistant', msg);
            chatHistory.push({ role: 'assistant', content: msg });
            _skillDone = true;
          }
        } catch (e) {
          finalizeLastBubble();
          if (!isPrivate) {
            needsPaidJob = true;
          } else {
            const msg = `\`${route.skillId}\` failed: ${e.message}`;
            renderMessage('assistant', msg);
            chatHistory.push({ role: 'assistant', content: msg });
            _skillDone = true;
          }
        }

        if (needsPaidJob) {
          jobShowAssistant(`Fetching data via \`${route.skillId}\`…`, true);
          _bubbleShown = true;
          chatAbortController = jobAbort;

          const jobId = await _submitSkillJob(route.skillId, { ...(route.input || {}), question: text });
          const jobResult = await _waitForSkillRawOutput(jobId);
          finalizeLastBubble();

          if (jobResult?._jobError) {
            const msg = `Skill failed (${jobResult.error || jobResult._jobError}).`;
            renderMessage('assistant', msg);
            chatHistory.push({ role: 'assistant', content: msg });
            _skillDone = true;
          } else if (jobResult && jobResult.verdict && jobResult.verdict !== 'SKILL_RESULT') {
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
              renderMessage('assistant', nlResponse);
              chatHistory.push({ role: 'assistant', content: nlResponse });
              _appendFeedbackButtons(jobId);
            } else if (skillOutput?.analysis?.summary) {
              const reply = skillOutput.analysis.summary;
              renderMessage('assistant', reply);
              chatHistory.push({ role: 'assistant', content: reply });
              _appendFeedbackButtons(jobId);
            } else {
              renderMessage('assistant', '', true);
              await _streamSkillAnalysis(route.skillContext || '', skillOutput, text);
              _appendFeedbackButtons(jobId);
            }
            _skillDone = true;
          } else {
            const msg = `\`${route.skillId}\` timed out waiting for a response. Please try again.`;
            renderMessage('assistant', msg);
            chatHistory.push({ role: 'assistant', content: msg });
            _skillDone = true;
          }
        }
      }
    }
  } catch (e) {
    // If a placeholder bubble is already on screen (e.g. job submission itself threw,
    // before any of the branches above got a chance to run), finalize it with an error
    // instead of silently falling through to plain Ollama chat — that would leave the
    // stuck placeholder bubble on screen AND show a second, unrelated reply underneath it.
    if (_bubbleShown) {
      finalizeLastBubble();
      const msg = `Something went wrong: ${e.message}`;
      renderMessage('assistant', msg);
      chatHistory.push({ role: 'assistant', content: msg });
      _skillDone = true;
    }
  }

  if (_skillDone) {
    _endChatJob();
    return;
  }
  // ── End skill routing ─────────────────────────────────────────────────────

  // Public mode with no skill match: paid network compute job (async queue)
  if (!isPrivate) {
    jobShowAssistant('Submitting paid compute job…', true);
    try {
      await submitComputeJob(llmText, { bubble: jobBubble, history: historySnapshot });
    } finally {
      _endChatJob();
    }
    return;
  }

  jobShowAssistant('', true);

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
      const errText = await res.text().catch(() => res.statusText);
      let errMsg = errText;
      try { errMsg = JSON.parse(errText)?.error || errText; } catch { /* keep raw */ }
      const isInferenceDown = errMsg.toLowerCase().includes('qvac') || errMsg.toLowerCase().includes('inference') || errMsg.toLowerCase().includes('unavailable') || errMsg.toLowerCase().includes('econnrefused');
      if (isInferenceDown) {
        // Public mode: try a peer miner or a configured cloud AI provider before
        // telling the user the local model isn't ready yet.
        if (!isPrivate) {
          try {
            const fbRes = await fetch(`http://localhost:${port}/chat/ask`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(_chatAskPayload(text, historySnapshot, false, { model })),
              signal: AbortSignal.timeout(50000),
            });
            const fbData = await fbRes.json();
            if (fbData?.message && !/local llm is unavailable/i.test(fbData.message)) {
              jobFinalize();
              jobShowAssistant(fbData.message);
              pushAssistantReply(fbData.message, fbData.skillMemory ? { _skillMemory: fbData.skillMemory } : {});
              return;
            }
          } catch { /* fall through to the message below */ }
        }
        // QVAC loads the model in-process on first use — no service to start.
        const msg = 'The AI model is still loading (it downloads on first use). Please wait a moment and resend your message.';
        appendToLastBubble(msg);
        finalizeLastBubble();
        chatHistory.push({ role: 'assistant', content: `[Model not ready — ${msg}]` });
      } else {
        appendToLastBubble(`Error: ${errMsg}`);
        finalizeLastBubble();
        chatHistory.push({ role: 'assistant', content: `[Error: ${errMsg}]` });
      }
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
            appendToLastBubble(`[Error: ${evt.error}]`);
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

    // Flush a trailing line that wasn't newline-terminated — a non-streamed single
    // JSON response (or the final chunk without a trailing "\n") lands in `buf`, not the
    // loop above, and would otherwise be dropped and look like "no response".
    if (!fullResponse && buf.trim()) {
      try {
        const evt = JSON.parse(buf);
        const token = evt.message?.content || evt.response || '';
        if (evt.error) { appendToLastBubble(`[Error: ${evt.error}]`); fullResponse += `[Error: ${evt.error}]`; }
        else if (token) { appendToLastBubble(token); fullResponse += token; }
      } catch { /* not a complete JSON object — ignore */ }
    }

    if (!fullResponse) appendToLastBubble('[No response — the model may still be loading. Try again.]');
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
    _endChatJob();
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
  if (e.key === 'Escape') { _hideChatSuggestions(); return; }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    _hideChatSuggestions();
    sendChatMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

let _chatSuggestTimer = null;
let _chatSuggestCache = null;

async function _fetchChatSuggestions(q) {
  const port = window._minerApiPort || 3456;
  const wallet = window._localWallet || '';
  const params = new URLSearchParams({ q, limit: '8' });
  if (wallet) params.set('wallet', wallet);
  const r = await fetch(`http://localhost:${port}/api/search/suggest?${params}`);
  if (!r.ok) return { suggestions: [] };
  return r.json();
}

function _hideChatSuggestions() {
  const box = document.getElementById('chat-suggest-box');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

function _renderChatSuggestions(suggestions) {
  const box = document.getElementById('chat-suggest-box');
  if (!box) return;
  if (!suggestions?.length) { _hideChatSuggestions(); return; }
  const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  box.innerHTML = suggestions.map((s, i) => `
    <div class="chat-suggest-item" data-idx="${i}">
      <div class="chat-suggest-prompt">${esc(s.prompt)}</div>
      ${s.replyPreview ? `<div class="chat-suggest-reply">${esc(s.replyPreview)}${s.replyPreview.length >= 120 ? '…' : ''}</div>` : ''}
      ${s.fromChain ? '<span class="chat-suggest-badge">on-chain</span>' : ''}
    </div>`).join('');
  box.style.display = 'block';
  box.querySelectorAll('.chat-suggest-item').forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.idx, 10);
      const item = suggestions[idx];
      if (!item) return;
      const input = document.getElementById('chat-input');
      if (input) { input.value = item.prompt || ''; autoResize(input); }
      _hideChatSuggestions();
      if (item.replyPreview) _showChatHistoryBanner(item);
      input?.focus();
    };
  });
}

function _showChatHistoryBanner(item) {
  const banner = document.getElementById('chat-history-banner');
  if (!banner || !item?.replyPreview) return;
  window._chatHistoryBannerItem = item;
  const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  banner.style.display = 'block';
  banner.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
      <div>
        <div style="font-size:10px;color:#4ade80;margin-bottom:3px;">⛓ Similar question on blockchain</div>
        <div style="color:#9ca3af;font-style:italic;line-height:1.35;">${esc(item.replyPreview)}…</div>
      </div>
      <button onclick="useChainHistoryReply()" style="flex-shrink:0;font-size:10px;padding:4px 8px;border-radius:4px;border:1px solid #22c55e;background:#166534;color:#22c55e;cursor:pointer;font-family:monospace;">Use reply</button>
    </div>`;
}

async function useChainHistoryReply(jobId) {
  const port = window._minerApiPort || 3456;
  const input = document.getElementById('chat-input');
  const q = input?.value?.trim();
  if (!q) return;
  try {
    const wallet = window._localWallet || '';
    const params = new URLSearchParams({ q });
    if (wallet) params.set('wallet', wallet);
    const r = await fetch(`http://localhost:${port}/api/search/history-match?${params}`);
    const data = await r.json();
    const reply = data.match?.reply;
    if (reply) {
      renderMessage('user', q);
      chatHistory.push({ role: 'user', content: q });
      renderMessage('assistant', reply);
      pushAssistantReply(reply, { fromChainHistory: true, jobId: data.match.jobId });
      if (input) { input.value = ''; autoResize(input); }
      const banner = document.getElementById('chat-history-banner');
      if (banner) banner.style.display = 'none';
      _hideChatSuggestions();
    }
  } catch { /* ignore */ }
}

function chatInputChanged(el) {
  autoResize(el);
  const q = el.value.trim();
  clearTimeout(_chatSuggestTimer);
  if (q.length < 2) { _hideChatSuggestions(); return; }
  _chatSuggestTimer = setTimeout(async () => {
    try {
      const data = await _fetchChatSuggestions(q);
      _chatSuggestCache = data.suggestions || [];
      _renderChatSuggestions(_chatSuggestCache);
      const top = _chatSuggestCache[0];
      if (top?.replyPreview && (top.prompt || '').toLowerCase().startsWith(q.toLowerCase().slice(0, 8))) {
        _showChatHistoryBanner(top);
      } else {
        const banner = document.getElementById('chat-history-banner');
        if (banner && q.length < 6) banner.style.display = 'none';
      }
    } catch { _hideChatSuggestions(); }
  }, 280);
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
      if (lbl) lbl.textContent = 'Inference: QVAC';
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

function _homeTxIcon(label) {
  if (label === 'Mining reward') return { icon: '⛏', cls: 'mining' };
  if (label === 'Received')      return { icon: '↓', cls: 'mining' };
  return { icon: '↑', cls: 'send' };
}

async function pollTxHistory() {
  const port = window._minerApiPort || 3456;
  const addr = window._localWallet;
  if (!addr) return;
  try {
    const res = await fetch(`http://localhost:${port}/api/wallet/history?address=${encodeURIComponent(addr)}&limit=5`);
    if (!res.ok) return;
    const { entries } = await res.json();
    const el = document.getElementById('home-txs');
    if (!el || !entries?.length) return;
    const POH = 1_000_000_000;
    el.innerHTML = entries.map(e => {
      const sign  = e.delta > 0 ? '+' : '-';
      const amt   = Math.abs(e.delta / POH).toFixed(3);
      const amtCls = e.delta > 0 ? 'pos' : 'neg';
      const ts    = e.ts ? new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const { icon, cls } = _homeTxIcon(e.label);
      return `
        <div class="home-tx-row">
          <div class="home-tx-icon ${cls}">${icon}</div>
          <div class="home-tx-body">
            <div class="home-tx-title">${e.label}</div>
            <div class="home-tx-time">${ts}</div>
          </div>
          <div class="home-tx-right">
            <div class="home-tx-amount ${amtCls}">${sign}${amt}</div>
            <div class="home-tx-unit">POH</div>
          </div>
        </div>`;
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
// Fee slider: 1 μPOH (1e-9 POH) → 1 POH, logarithmic.
const _BLOG_MIN = 0.000000001, _BLOG_MAX = 1, _BLOG_STEPS = 200;

function _sliderStepToPoh(step) {
  if (step <= 1) return _BLOG_MIN;
  return _BLOG_MIN * Math.pow(_BLOG_MAX / _BLOG_MIN, (step - 1) / (_BLOG_STEPS - 1));
}

// Slider step for a fraction [0,1] of the log range — used by the preset marks.
function _pctToSliderStep(pct) {
  return Math.round(1 + pct * (_BLOG_STEPS - 1));
}

function _formatPoh(poh) {
  if (poh <= 0)      return 'no fee';
  if (poh < 0.001)   return Math.round(poh * 1e9).toLocaleString() + ' μPOH';
  if (poh < 1)       return poh.toPrecision(2) + ' POH';
  if (poh < 10)      return poh.toFixed(2) + ' POH';
  return Math.round(poh) + ' POH';
}

// Fee preset marks: default 0%, low 25%, high 60%, max 100%.
const FEE_PRESETS = [
  { label: 'Default', pct: 0.00 },
  { label: 'Low',     pct: 0.25 },
  { label: 'High',    pct: 0.60 },
  { label: 'Max',     pct: 1.00 },
];
window.setFeePreset = function(sliderId, displayFn, pct) {
  const slider = document.getElementById(sliderId);
  if (!slider) return;
  slider.value = String(_pctToSliderStep(pct));
  if (typeof window[displayFn] === 'function') window[displayFn](slider.value);
  slider.style.setProperty('--fill', `${(parseInt(slider.value, 10) / _BLOG_STEPS) * 100}%`);
};

window.updateBudgetDisplay = function(val) {
  const step = parseInt(val, 10);
  const display = document.getElementById('budget-display');
  if (!display) return;
  display.textContent = step <= 0 ? 'no fee' : _formatPoh(_sliderStepToPoh(step));
  const slider = document.getElementById('budget-slider');
  if (slider) slider.style.setProperty('--fill', `${(step / _BLOG_STEPS) * 100}%`);
};

function getBudgetValue() {
  const slider = document.getElementById('budget-slider');
  if (!slider) return 0;
  const step = parseInt(slider.value, 10);
  if (step <= 0) return 0;
  return Math.round(_sliderStepToPoh(step) * BUDGET_DECIMALS);
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
  _updateUsdBalanceDisplay();
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
  const gradPoh = window._skillEconomics?.graduationThresholdPoh || 1000;
  const STAKE_THRESHOLD = gradPoh * 1e9;
  const staked    = s.totalStaked || 0;
  const myStake   = s.myStake || 0;
  const pct       = Math.min(100, Math.round((staked / STAKE_THRESHOLD) * 100));
  const stakedPoh = (staked / 1e9).toFixed(2);
  const myPoh     = (myStake / 1e9).toFixed(2);

  document.getElementById('skill-detail-stake-bar').style.width = `${pct}%`;
  document.getElementById('skill-detail-stake-pct').textContent = pct > 0 ? `${pct}%` : '';
  document.getElementById('skill-detail-stake-info').textContent =
    `${stakedPoh} / ${gradPoh.toLocaleString()} POH staked${myStake > 0 ? ` · yours: ${myPoh} POH` : ''}`;
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
    const { skills, stakeVault, economics } = await res.json();
    if (stakeVault) window._stakeVault = stakeVault;
    if (economics) window._skillEconomics = economics;
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

    const gradPoh = window._skillEconomics?.graduationThresholdPoh || 1000;
    const STAKE_THRESHOLD = gradPoh * 1e9;
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
      resultEl.textContent = `Auditing skill code on network${dots} (${window._skillEconomics?.proposeFeePoh || 100} POH escrowed)`;
      pollSkillAuditResult(jobId, skillId, resultEl, attempt + 1);
      return;
    }
    if (data.rejected || data.verdict === 'REJECTED') {
      showAuditRejectionModal(data.reason || 'Dangerous code detected', data.issues || []);
      resultEl.style.color = '#ef4444';
      resultEl.textContent = `Skill rejected by network audit · ${window._skillEconomics?.proposeFeePoh || 100} POH refunded`;
    } else if (data.status === 'done' || data.verdict === 'SKILL_RESULT') {
      resultEl.style.color = '#22c55e';
      resultEl.textContent = `Proposed: ${skillId} · audit passed · ${window._skillEconomics?.proposeFeePoh || 100} POH paid to auditing miner`;
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
      resultEl.textContent = `Auditing skill code on network… ${window._skillEconomics?.proposeFeePoh || 100} POH escrowed`;
      pollSkillAuditResult(data.jobId, id, resultEl);
    } else if (data.ok) {
      resultEl.style.color = '#22c55e';
      resultEl.textContent = `Proposed: ${id} · ${window._skillEconomics?.proposeFeePoh || 100} POH deducted`;
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

const QUOTE_CURRENCIES = ['USDT-ERC20','USDT-TRC20','USDT-TON','USDT-SOL','USDT-BEP20','USDC-ERC20','BTC','ETH','SOL'];
const POH_DECIMALS_P2P = 1_000_000_000;

let _p2pCurrency = '';
let _p2pOrders = [];
let _p2pActivityTab = 'orders';
let _p2pPollTimer = null;
let _p2pPaymentMethods = [];
let _p2pBestUsdRate = null;

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
  const auth = await r.json();
  if (auth.address) window._localWallet = auth.address;
  return auth;
}

async function _p2pApiFetch(path, opts = {}) {
  const port = _p2pPort();
  const r = await fetch(`http://localhost:${port}${path}`, opts);
  return r.json();
}

function _p2pFmtMethod(m) {
  if (!m) return '—';
  if (typeof m === 'string') return m;
  return m.address ? `${m.network}: ${m.address}` : m.network || '—';
}

function _updateUsdBalanceDisplay() {
  const el = document.getElementById('home-balance-usd');
  if (!el) return;
  const poh = parseFloat(document.getElementById('home-balance-num')?.textContent || '0') || 0;
  if (_p2pBestUsdRate != null && poh > 0) {
    el.textContent = `≈ $${(poh * _p2pBestUsdRate).toFixed(2)} USD`;
  } else {
    el.textContent = '≈ — USD';
  }
}

function p2pAddPaymentMethod() {
  const network = document.getElementById('p2p-pm-network')?.value;
  const address = (document.getElementById('p2p-pm-address')?.value || '').trim();
  if (!network || !address) return;
  _p2pPaymentMethods.push({ network, address });
  _p2pRenderPaymentMethodList();
  document.getElementById('p2p-pm-network').value = '';
  document.getElementById('p2p-pm-address').value = '';
}

function p2pRemovePaymentMethod(idx) {
  _p2pPaymentMethods.splice(idx, 1);
  _p2pRenderPaymentMethodList();
}

function _p2pRenderPaymentMethodList() {
  const list = document.getElementById('p2p-pm-list');
  if (!list) return;
  list.innerHTML = '';
  _p2pPaymentMethods.forEach((pm, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;background:#0a0a0a;border:1px solid #1e1e1e;border-radius:4px;padding:4px 8px;';
    row.innerHTML = `
      <span style="font-size:10px;color:#22c55e;font-family:monospace;white-space:nowrap;">${pm.network}</span>
      <span style="font-size:10px;color:#888;font-family:monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${pm.address}</span>
      <button onclick="p2pRemovePaymentMethod(${i})" style="background:none;border:none;color:#555;cursor:pointer;font-size:12px;padding:0;line-height:1;">✕</button>
    `;
    list.appendChild(row);
  });
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
  _p2pPaymentMethods = [];
  _p2pRenderPaymentMethodList();
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
  // Compute best USD rate from open USDT/USDC sell orders
  const stableOrders = _p2pOrders.filter(o =>
    o.status === 'open' && o.side === 'sell' &&
    ['USDT-ERC20','USDT-TRC20','USDT-TON','USDT-SOL','USDT-BEP20','USDC-ERC20'].includes(o.quoteCurrency)
  );
  _p2pBestUsdRate = stableOrders.length
    ? Math.max(...stableOrders.map(o => parseFloat(o.pricePerPOH) || 0))
    : null;
  _updateUsdBalanceDisplay();
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
      ${order.paymentMethods?.length ? `<div style="font-size:10px;color:#444;font-family:monospace;margin-top:2px;">${order.paymentMethods.map(m=>typeof m==='string'?m:(m.network||'?')).join(', ')}</div>` : ''}
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
      ${order.paymentMethods?.length ? `<div style="display:flex;flex-direction:column;gap:3px;"><span style="font-size:10px;color:#555;font-family:monospace;margin-bottom:1px;">PAYMENT TO</span>${order.paymentMethods.map(m=>`<div style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:3px;padding:4px 7px;"><span style="font-size:10px;color:#22c55e;font-family:monospace;">${typeof m==='string'?m:(m.network||'?')}</span>${(typeof m==='object'&&m.address)?`<span style="font-size:10px;color:#9ca3af;font-family:monospace;display:block;word-break:break-all;">${m.address}</span>`:''}</div>`).join('')}</div>` : ''}
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
      Send <strong>${(trade.quoteAmount||0).toFixed(4)} ${order?.quoteCurrency||''}</strong> to seller's payment method:<br>
      ${(order?.paymentMethods?.length ? order.paymentMethods.map(m=>`<div style="margin-top:5px;padding:5px 8px;background:#071a07;border:1px solid #1a3a1a;border-radius:3px;"><span style="color:#22c55e;">${typeof m==='string'?m:(m.network||'?')}</span>${(typeof m==='object'&&m.address)?`<br><span style="color:#d1fae5;word-break:break-all;">${m.address}</span>`:''}</div>`).join('') : '<em>—</em>')}
      <br>Then click "Mark Payment Sent".
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
  const resultEl  = document.getElementById('p2p-create-result');
  const pohAmt    = parseFloat(document.getElementById('p2p-form-amount')?.value || '0');
  const currency  = document.getElementById('p2p-form-currency')?.value;
  const price     = parseFloat(document.getElementById('p2p-form-price')?.value || '0');
  const minT      = parseFloat(document.getElementById('p2p-form-min')?.value || '0');
  const maxT      = parseFloat(document.getElementById('p2p-form-max')?.value || '0');
  const refCode   = (document.getElementById('p2p-form-referral')?.value || '').trim().toUpperCase();
  const methods   = _p2pPaymentMethods;
  if (!pohAmt || !currency || !price) {
    resultEl.style.display='block'; resultEl.style.color='#ef4444'; resultEl.textContent='Fill in amount, currency, and price.'; return;
  }
  if (!methods.length) {
    resultEl.style.display='block'; resultEl.style.color='#ef4444'; resultEl.textContent='Add at least one payment method.'; return;
  }
  resultEl.style.display='block'; resultEl.style.color='#888'; resultEl.textContent='Posting order…';
  const pohAmountRaw = Math.round(pohAmt * POH_DECIMALS_P2P);
  try {
    // Apply referral code if provided (non-blocking)
    if (refCode && window._localWallet) {
      _p2pApiFetch('/api/p2p/referral/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: window._localWallet, code: refCode }),
      }).catch(() => {});
    }
    const orderFields = { side: 'sell', pohAmount: pohAmountRaw, quoteCurrency: currency, pricePerPOH: price, minTrade: minT||0, maxTrade: maxT||pohAmt*price, paymentMethods: methods };
    const auth = await _p2pLocalAuth('create-order', { side: 'sell', pohAmount: pohAmountRaw });
    const data = await _p2pApiFetch('/api/p2p/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...auth, ...orderFields }),
    });
    if (data.error) throw new Error(data.error);
    resultEl.style.color='#22c55e'; resultEl.textContent='Order posted!';
    ['p2p-form-amount','p2p-form-price','p2p-form-min','p2p-form-max','p2p-form-referral'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
    _p2pPaymentMethods = []; _p2pRenderPaymentMethodList();
    setTimeout(() => { p2pShowBook(); p2pLoadOrders(true); }, 1200);
  } catch (e) { resultEl.style.display='block'; resultEl.style.color='#ef4444'; resultEl.textContent=e.message; }
}

function p2pActivityTab(tab) {
  _p2pActivityTab = tab;
  const oBtn = document.getElementById('p2p-act-tab-orders');
  const tBtn = document.getElementById('p2p-act-tab-trades');
  const rBtn = document.getElementById('p2p-act-tab-referral');
  if (!oBtn || !tBtn) return;
  oBtn.style.background='#111'; oBtn.style.color='#888'; oBtn.style.fontWeight='normal';
  tBtn.style.background='#111'; tBtn.style.color='#888'; tBtn.style.fontWeight='normal';
  if (rBtn) { rBtn.style.background='#111'; rBtn.style.color='#888'; rBtn.style.fontWeight='normal'; }
  if (tab === 'orders') {
    oBtn.style.background='#166534'; oBtn.style.color='#22c55e'; oBtn.style.fontWeight='600';
  } else if (tab === 'trades') {
    tBtn.style.background='#1e3a5f'; tBtn.style.color='#60a5fa'; tBtn.style.fontWeight='600';
  } else if (tab === 'referral') {
    if (rBtn) { rBtn.style.background='#2d1a52'; rBtn.style.color='#a78bfa'; rBtn.style.fontWeight='600'; }
  }
  p2pLoadActivity();
}

async function p2pLoadActivity() {
  const list   = document.getElementById('p2p-activity-list');
  const myAddr = window._localWallet;
  if (!list) return;
  list.innerHTML = '<div style="color:#444;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">Loading…</div>';
  try {
    if (_p2pActivityTab === 'referral') {
      const data = myAddr ? await _p2pApiFetch(`/api/p2p/referral?address=${encodeURIComponent(myAddr)}`) : {};
      list.innerHTML = '';
      const code = data.code || '—';
      const copyCode = () => { navigator.clipboard.writeText(code).catch(()=>{}); };
      list.innerHTML = `
        <div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:8px;">
          <div style="font-size:10px;color:#555;font-family:monospace;letter-spacing:0.1em;">YOUR REFERRAL CODE</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span id="p2p-ref-code" style="font-size:18px;color:#a78bfa;font-family:monospace;letter-spacing:4px;">${code}</span>
            <button onclick="(function(){navigator.clipboard.writeText('${code}').catch(()=>{});document.getElementById('p2p-ref-copy').textContent='Copied!';setTimeout(()=>{document.getElementById('p2p-ref-copy').textContent='Copy';},1500);})()" id="p2p-ref-copy" style="font-size:10px;padding:3px 8px;border-radius:4px;border:1px solid #a78bfa44;background:#2d1a52;color:#a78bfa;cursor:pointer;font-family:monospace;">Copy</button>
          </div>
          <div style="font-size:10px;color:#444;font-family:monospace;">Share this code — you earn 0.3% of every completed trade by a referred user.</div>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;background:#0a0a0a;border:1px solid #1e1e1e;border-radius:6px;padding:10px;text-align:center;">
            <div style="font-size:18px;color:#fff;font-family:monospace;">${data.referredCount ?? 0}</div>
            <div style="font-size:10px;color:#555;font-family:monospace;margin-top:2px;">Referred</div>
          </div>
          <div style="flex:1;background:#0a0a0a;border:1px solid #1e1e1e;border-radius:6px;padding:10px;text-align:center;">
            <div style="font-size:18px;color:#fff;font-family:monospace;">${data.tradeCount ?? 0}</div>
            <div style="font-size:10px;color:#555;font-family:monospace;margin-top:2px;">Trades</div>
          </div>
          <div style="flex:1;background:#0a0a0a;border:1px solid #1e1e1e;border-radius:6px;padding:10px;text-align:center;">
            <div style="font-size:14px;color:#22c55e;font-family:monospace;">${((data.earnedFees||0)/1e9).toFixed(4)}</div>
            <div style="font-size:10px;color:#555;font-family:monospace;margin-top:2px;">POH Earned</div>
          </div>
        </div>
        ${!data.referredBy ? `
        <div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:6px;padding:12px;">
          <div style="font-size:10px;color:#555;font-family:monospace;letter-spacing:0.1em;margin-bottom:6px;">ENTER REFERRAL CODE</div>
          <div style="display:flex;gap:6px;">
            <input id="p2p-ref-input" type="text" placeholder="e.g. A1B2C3D4" maxlength="8"
              style="flex:1;background:#111;border:1px solid #252525;border-radius:4px;color:#e5e7eb;font-size:12px;font-family:monospace;padding:7px 10px;outline:none;text-transform:uppercase;" />
            <button onclick="p2pApplyReferral()" style="padding:7px 12px;border:none;background:#a78bfa;color:#000;border-radius:4px;font-weight:600;cursor:pointer;font-size:11px;font-family:monospace;">Apply</button>
          </div>
          <div id="p2p-ref-apply-result" style="font-size:10px;margin-top:6px;font-family:monospace;display:none;"></div>
        </div>` : `<div style="font-size:10px;color:#555;font-family:monospace;">Referred by: ${data.referredBy}</div>`}
      `;
      return;
    }
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

async function p2pApplyReferral() {
  const input  = document.getElementById('p2p-ref-input');
  const result = document.getElementById('p2p-ref-apply-result');
  const code   = (input?.value || '').trim().toUpperCase();
  const myAddr = window._localWallet;
  if (!code || !myAddr) return;
  if (result) { result.style.display='block'; result.style.color='#888'; result.textContent='Applying…'; }
  try {
    const data = await _p2pApiFetch('/api/p2p/referral/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: myAddr, code }),
    });
    if (data.error) throw new Error(data.error);
    if (result) { result.style.color='#22c55e'; result.textContent=`Applied! Referred by ${data.referrer?.slice(0,12)}…`; }
    setTimeout(() => p2pLoadActivity(), 1000);
  } catch (e) {
    if (result) { result.style.color='#ef4444'; result.textContent=e.message; }
  }
}


function _explorerJobSnippet(jobOrResult) {
  const profile = jobOrResult.profile || {};
  if (profile.computeOutput) return String(profile.computeOutput).slice(0, 140);
  if (profile.nlResponse) return String(profile.nlResponse).slice(0, 140);
  if (profile.skillOutput) {
    const s = profile.skillOutput;
    if (s.analysis?.summary) return String(s.analysis.summary).slice(0, 140);
    if (s.username) return `@${s.username} · ${(s.followerCount || 0)} followers`;
    return 'Skill data returned';
  }
  if (jobOrResult.reasoning) return String(jobOrResult.reasoning).slice(0, 140);
  return '';
}

function _explorerRenderJobCard(job, { blockMode = false } = {}) {
  const jobId = job.jobId || job.requestId || '—';
  const jobType = (job.jobType || job.verdict || 'job').toString().toLowerCase();
  const verdict = job.verdict || (job.mined ? 'mined' : 'pending');
  const prompt = job.promptPreview || job.skillId || job.address || '';
  const snippet = _explorerJobSnippet(job);
  const when = job.submittedAt || job.deliveredAt;
  const timeStr = when ? new Date(when).toLocaleString() : '';
  const blockH = job.resultBlockHeight || job.blockHeight;
  const badgeColor = jobType.includes('compute') ? '#60a5fa' : jobType.includes('skill') ? '#a78bfa' : '#22c55e';
  const statusColor = verdict === 'pending' || !job.mined ? '#facc15' : '#22c55e';
  const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  return `<div style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:5px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
      <span style="font-size:9px;padding:2px 6px;border-radius:3px;background:#111;color:${badgeColor};font-family:monospace;text-transform:uppercase;">${esc(jobType)}</span>
      <span style="font-size:9px;color:${statusColor};font-family:monospace;">${esc(verdict)}</span>
    </div>
    <div style="font-size:9px;color:#60a5fa;font-family:monospace;word-break:break-all;">${esc(jobId)}</div>
    ${prompt ? `<div style="font-size:10px;color:#aaa;line-height:1.35;">${esc(prompt)}</div>` : ''}
    ${snippet ? `<div style="font-size:9px;color:#666;line-height:1.35;font-style:italic;">${esc(snippet)}${snippet.length >= 140 ? '…' : ''}</div>` : ''}
    <div style="display:flex;justify-content:space-between;font-size:9px;color:#555;font-family:monospace;">
      <span>${timeStr || '—'}</span>
      <span>${blockH != null ? '#' + blockH : (job.minerWallet ? job.minerWallet.slice(0,10)+'…' : '')}</span>
    </div>
  </div>`;
}

function _explorerRenderJobsSection(jobs, title = 'COMPLETED JOBS') {
  if (!jobs?.length) return '';
  const cards = jobs.map(j => _explorerRenderJobCard(j)).join('');
  return `<div style="font-size:10px;color:#555;font-family:monospace;letter-spacing:0.1em;padding-bottom:2px;">${title} (${jobs.length})</div>
    <div style="display:flex;flex-direction:column;gap:5px;">${cards}</div>`;
}

function _explorerNormalizeScanResult(r, blockHeight) {
  const profile = r.profile || {};
  return {
    jobId: r.requestId,
    requestId: r.requestId,
    jobType: profile.skillId ? 'skill' : (profile.computeOutput != null ? 'compute' : (r.verdict || 'job')),
    verdict: r.verdict || 'mined',
    profile,
    reasoning: r.reasoning,
    minerWallet: r.minerWallet,
    skillId: profile.skillId,
    promptPreview: profile.promptPreview || profile.prompt || null,
    resultBlockHeight: blockHeight,
    mined: true,
  };
}

function _explorerNormalizeJobSubmitted(t, blockHeight) {
  return {
    jobId: t.jobId,
    jobType: t.jobType || 'job',
    skillId: t.skillId,
    address: t.address,
    promptPreview: t.promptPreview,
    model: t.model,
    dataset: t.dataset,
    requesterAddress: t.requesterAddress,
    submittedAt: t.timestamp,
    blockHeight,
    verdict: 'submitted',
    mined: false,
  };
}

function _explorerBlockJobsHtml(data) {
  const height = data.height;
  const completed = (data.scanResults || data.skillResults || []).map(r => _explorerNormalizeScanResult(r, height));
  const completedIds = new Set(completed.map(j => j.jobId).filter(Boolean));
  const submissions = (data.stateTransitions || [])
    .filter(t => t?.type === 'job-submitted')
    .map(t => _explorerNormalizeJobSubmitted(t, height))
    .filter(t => !completedIds.has(t.jobId));
  const parts = [];
  if (completed.length) parts.push(_explorerRenderJobsSection(completed, 'COMPLETED JOBS IN BLOCK'));
  if (submissions.length) parts.push(_explorerRenderJobsSection(submissions, 'JOB SUBMISSIONS'));
  return parts.join('');
}

// ── Blockchain Explorer ─────────────────────────────────────────────────────────

let _explorerPage = 0;

function _explorerPort() { return window._minerApiPort || 3456; }

async function _explorerFetch(path) {
  const r = await fetch(`http://localhost:${_explorerPort()}${path}`);
  return r.json();
}

function explorerShowTab(tab) {
  const blocksView = document.getElementById('explorer-blocks-view');
  const resultView = document.getElementById('explorer-result-view');
  const bBtn = document.getElementById('explorer-tab-blocks');
  const rBtn = document.getElementById('explorer-tab-result');
  if (!blocksView || !resultView) return;
  if (tab === 'blocks') {
    blocksView.style.display = 'flex';
    resultView.style.display = 'none';
    if (bBtn) { bBtn.style.background='#166534'; bBtn.style.color='#22c55e'; bBtn.style.fontWeight='600'; }
    if (rBtn) { rBtn.style.background='#111'; rBtn.style.color='#555'; rBtn.style.fontWeight='normal'; }
  } else {
    blocksView.style.display = 'none';
    resultView.style.display = 'flex';
    if (rBtn) { rBtn.style.background='#1e3a5f'; rBtn.style.color='#60a5fa'; rBtn.style.fontWeight='600'; }
    if (bBtn) { bBtn.style.background='#111'; bBtn.style.color='#555'; bBtn.style.fontWeight='normal'; }
  }
}

async function explorerInit() {
  _explorerPage = 0;
  await explorerLoadBlocks();
  const input = document.getElementById('explorer-search-input');
  if (input && !input.value && window._localWallet) {
    input.placeholder = `Search or view your wallet: ${window._localWallet.slice(0, 12)}…`;
  }
}

async function explorerLoadBlocks() {
  const list = document.getElementById('explorer-blocks-view');
  if (!list) return;
  list.innerHTML = '<div style="color:#444;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">Loading…</div>';
  try {
    const data = await _explorerFetch(`/api/explorer/blocks?page=${_explorerPage}&limit=20`);
    const blocks = data.blocks || [];
    const POH = 1e9;
    list.innerHTML = '';
    if (!blocks.length) { list.innerHTML = '<div style="color:#374151;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">No blocks yet</div>'; return; }
    blocks.forEach(b => {
      const card = document.createElement('div');
      card.style.cssText = 'background:#0a0a0a;border:1px solid #1e1e1e;border-radius:5px;padding:8px 10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;';
      card.innerHTML = `
        <div>
          <div style="font-size:11px;color:#22c55e;font-family:monospace;">#${b.height}</div>
          <div style="font-size:9px;color:#555;font-family:monospace;margin-top:1px;">${b.miner?.slice(0,14)||'—'}… · ${b.txCount} tx${b.jobCount ? ` · ${b.jobCount} job${b.jobCount === 1 ? '' : 's'}` : ''}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px;color:#aaa;font-family:monospace;">${b.reward > 0 ? '+' + (b.reward/POH).toFixed(2) + ' POH' : ''}</div>
          <div style="font-size:9px;color:#374151;font-family:monospace;">${b.timestamp ? new Date(b.timestamp).toLocaleTimeString() : ''}</div>
        </div>
      `;
      card.onclick = () => explorerViewBlock(b.height);
      list.appendChild(card);
    });
    // Pagination
    const navRow = document.createElement('div');
    navRow.style.cssText = 'display:flex;justify-content:space-between;margin-top:6px;';
    navRow.innerHTML = `
      <button onclick="_explorerPage=Math.max(0,_explorerPage-1);explorerLoadBlocks()" style="font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid #333;background:#111;color:#888;cursor:pointer;font-family:monospace;"${_explorerPage===0?' disabled':''}>← Newer</button>
      <span style="font-size:10px;color:#555;font-family:monospace;">Page ${_explorerPage+1}</span>
      <button onclick="_explorerPage++;explorerLoadBlocks()" style="font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid #333;background:#111;color:#888;cursor:pointer;font-family:monospace;">Older →</button>
    `;
    list.appendChild(navRow);
  } catch (e) { list.innerHTML = `<div style="color:#ef4444;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">${e.message}</div>`; }
}

async function explorerViewBlock(height) {
  explorerShowTab('result');
  const view = document.getElementById('explorer-result-view');
  if (!view) return;
  view.innerHTML = '<div style="color:#444;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">Loading block…</div>';
  try {
    const data = await _explorerFetch(`/api/explorer/block/${height}`);
    const txs  = data.transactions || [];
    const jobsHtml = _explorerBlockJobsHtml(data);
    const POH  = 1e9;
    view.innerHTML = `
      <div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:5px;">
        <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">HEIGHT</span><span style="font-size:11px;color:#22c55e;font-family:monospace;">#${data.height}</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">HASH</span><span style="font-size:9px;color:#aaa;font-family:monospace;word-break:break-all;max-width:200px;">${data.hash||'—'}</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">MINER</span><span style="font-size:10px;color:#aaa;font-family:monospace;cursor:pointer;" onclick="explorerSearchAddr('${data.minerWallet||''}')">${data.minerWallet||'—'}</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">TIME</span><span style="font-size:10px;color:#aaa;font-family:monospace;">${data.timestamp ? new Date(data.timestamp).toLocaleString() : '—'}</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">REWARD</span><span style="font-size:10px;color:#22c55e;font-family:monospace;">${data.coinbaseReward > 0 ? (data.coinbaseReward/POH).toFixed(4)+' POH' : '—'}</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">TXS</span><span style="font-size:10px;color:#aaa;font-family:monospace;">${txs.length}</span></div>
      </div>
      ${jobsHtml}
      ${txs.length ? `<div style="font-size:10px;color:#555;font-family:monospace;padding-bottom:2px;letter-spacing:0.1em;">TRANSACTIONS</div>` + txs.map(tx => `
        <div style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:5px;padding:8px 10px;">
          <div style="font-size:9px;color:#60a5fa;font-family:monospace;word-break:break-all;margin-bottom:3px;">${tx.hash||tx.txHash||'—'}</div>
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:9px;color:#555;font-family:monospace;cursor:pointer;" onclick="explorerSearchAddr('${tx.from||''}')">${(tx.from||'').slice(0,12)}…</span>
            <span style="font-size:9px;color:#22c55e;font-family:monospace;">${tx.amount > 0 ? (tx.amount/POH).toFixed(4)+' POH' : ''}</span>
            <span style="font-size:9px;color:#555;font-family:monospace;cursor:pointer;" onclick="explorerSearchAddr('${tx.to||''}')">${(tx.to||'').slice(0,12)}…</span>
          </div>
        </div>`).join('') : ''}
    `;
  } catch (e) { view.innerHTML = `<div style="color:#ef4444;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">${e.message}</div>`; }
}

function explorerSearchAddr(addr) {
  if (!addr) return;
  const input = document.getElementById('explorer-search-input');
  if (input) input.value = addr;
  explorerSearch();
}

async function explorerSearch() {
  const q = (document.getElementById('explorer-search-input')?.value || '').trim();
  if (!q) return;
  explorerShowTab('result');
  const view = document.getElementById('explorer-result-view');
  if (!view) return;
  view.innerHTML = '<div style="color:#444;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">Searching…</div>';
  try {
    const data = await _explorerFetch(`/api/explorer/search?q=${encodeURIComponent(q)}`);
    const POH = 1e9;
    if (data.type === 'block') {
      explorerViewBlock(data.block.height);
    } else if (data.type === 'tx') {
      const { tx, block } = data;
      view.innerHTML = `
        <div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:10px;color:#555;font-family:monospace;letter-spacing:0.1em;margin-bottom:4px;">TRANSACTION</div>
          <div style="font-size:9px;color:#60a5fa;font-family:monospace;word-break:break-all;">${tx.hash||tx.txHash||'—'}</div>
          <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">BLOCK</span><span style="font-size:11px;color:#22c55e;font-family:monospace;cursor:pointer;" onclick="explorerViewBlock(${block.height})">#${block.height}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">FROM</span><span style="font-size:10px;color:#aaa;font-family:monospace;cursor:pointer;" onclick="explorerSearchAddr('${tx.from||''}')">${tx.from||'—'}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">TO</span><span style="font-size:10px;color:#aaa;font-family:monospace;cursor:pointer;" onclick="explorerSearchAddr('${tx.to||''}')">${tx.to||'—'}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">AMOUNT</span><span style="font-size:11px;color:#22c55e;font-family:monospace;">${((tx.amount||0)/POH).toFixed(4)} POH</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="font-size:10px;color:#555;font-family:monospace;">TIME</span><span style="font-size:10px;color:#aaa;font-family:monospace;">${block.timestamp ? new Date(block.timestamp).toLocaleString() : '—'}</span></div>
        </div>
      `;
    } else if (data.type === 'address') {
      const txRows = (data.entries || []).map(e => {
        const sign  = e.delta > 0 ? '+' : '';
        const color = e.delta > 0 ? '#22c55e' : '#ef4444';
        return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #111;">
          <span style="font-size:9px;color:#555;font-family:monospace;">${e.label} · Block #${e.height||'?'}</span>
          <span style="font-size:10px;color:${color};font-family:monospace;">${sign}${((e.delta||0)/POH).toFixed(4)} POH</span>
        </div>`;
      }).join('');
      const completedJobs = (data.jobs || []).filter(j => j.mined || (j.verdict && j.verdict !== 'pending' && j.verdict !== 'submitted'));
      const jobsHtml = _explorerRenderJobsSection(completedJobs);
      view.innerHTML = `
        <div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:5px;">
          <div style="font-size:10px;color:#555;font-family:monospace;letter-spacing:0.1em;margin-bottom:2px;">ADDRESS</div>
          <div style="font-size:10px;color:#aaa;font-family:monospace;word-break:break-all;">${data.address}</div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;"><span style="font-size:10px;color:#555;font-family:monospace;">BALANCE</span><span style="font-size:14px;color:#22c55e;font-family:monospace;">${((data.balance||0)/POH).toFixed(4)} POH</span></div>
        </div>
        ${jobsHtml}
        ${data.entries?.length ? `<div style="font-size:10px;color:#555;font-family:monospace;letter-spacing:0.1em;padding-bottom:2px;">RECENT TRANSACTIONS</div><div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:6px;padding:8px 10px;">${txRows}</div>` : ''}
      `;
    } else {
      view.innerHTML = `<div style="color:#555;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">No results for "${q}"</div>`;
    }
  } catch (e) { view.innerHTML = `<div style="color:#ef4444;font-size:11px;text-align:center;padding:20px 0;font-family:monospace;">${e.message}</div>`; }
}
