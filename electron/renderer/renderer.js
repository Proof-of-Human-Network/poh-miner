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

  if (typeof status.pohBalance === 'number' && pohBalEl) {
    pohBalEl.textContent = status.pohBalance + ' POH';
  } else if (typeof status.balance === 'number' && pohBalEl) {
    pohBalEl.textContent = status.balance.toFixed(0) + ' POH';
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
  if (walletBalanceEl && typeof status.balance === 'number') {
    walletBalanceEl.textContent = status.balance.toFixed(2) + ' POH';
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
    window.pohMinerAPI.onEnterOnboardingMode(() => {
      console.log('[Onboarding] Received force enter onboarding from main process');
      const onboardingDiv = document.getElementById('onboarding');
      const mainAppDiv = document.getElementById('main-app');
      if (mainAppDiv) mainAppDiv.classList.add('hidden');
      if (onboardingDiv) {
        onboardingDiv.classList.remove('hidden');
        showOnboardingStep('welcome');
      }
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

    if (status.hasPohWallet) {
      // User already has a PoH wallet on disk or in config.
      // Consider the wallet creation step done.
      // For a smoother experience, go straight to main app.
      // (Solana address and RPC can still be configured later in Settings)
      if (mainAppDiv) mainAppDiv.classList.remove('hidden');

      // Make sure the miner is running
      if (window.pohMinerAPI?.miner?.start) {
        window.pohMinerAPI.miner.start().catch(() => {});
      }
      return;
    }

    // No PoH wallet yet → show the full onboarding wizard
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
  goToStep('rpc');
};

window.completeOnboarding = async function() {
  const etherscan = document.getElementById('onboard-etherscan')?.value.trim() || '';
  const solanaRpc = document.getElementById('onboard-solana-rpc')?.value.trim() || '';

  const payload = {
    pohWallet: currentOnboardingData.pohWallet,
    solanaAddress: currentOnboardingData.solanaAddress,
    etherscanApiKey: etherscan,
    // You can expand rpc config here later
  };

  await window.pohMinerAPI.onboarding.complete(payload);

  // Cleanest way to exit onboarding without double-start races:
  // Reload the window so main process re-evaluates isOnboarded with the fresh config
  // and starts the miner cleanly (protected by the new guard).
  try {
    window.location.reload();
  } catch (e) {
    // Fallback (should rarely happen)
    document.getElementById('onboarding').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    try {
      await window.pohMinerAPI.miner.start();
    } catch (_) {}
  }
};

window.openFullRpcSettings = function() {
  // Close onboarding temporarily and show main app so user can use the full RPC panel
  document.getElementById('onboarding').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  
  // Scroll to RPC section in sidebar
  const rpcSection = document.querySelector('.sidebar');
  if (rpcSection) rpcSection.scrollIntoView({ behavior: 'smooth' });
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

// Safety net: if we're still in a weird state after 3 seconds, force onboarding
setTimeout(() => {
  const onboardingDiv = document.getElementById('onboarding');
  const mainAppDiv = document.getElementById('main-app');

  if (mainAppDiv && !mainAppDiv.classList.contains('hidden') && onboardingDiv && onboardingDiv.classList.contains('hidden')) {
    // We're showing main UI but probably shouldn't be
    console.warn('[Onboarding] Safety timeout triggered - forcing onboarding wizard');
    if (mainAppDiv) mainAppDiv.classList.add('hidden');
    if (onboardingDiv) {
      onboardingDiv.classList.remove('hidden');
      showOnboardingStep('welcome');
    }
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
