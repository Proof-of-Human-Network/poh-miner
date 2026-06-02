const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pohMinerAPI', {
  onLog: (callback) => {
    ipcRenderer.on('log', (_event, message) => callback(message));
  },
  onStatus: (callback) => {
    ipcRenderer.on('status', (_event, status) => callback(status));
  },
  getLogs: () => ipcRenderer.invoke('get-logs'),
  getStatus: () => ipcRenderer.invoke('get-status'),

  // === New RPC Configuration API ===
  rpc: {
    getNetworksGrouped: () => ipcRenderer.invoke('rpc:get-networks-grouped'),
    getProvidersForNetwork: (networkId) => ipcRenderer.invoke('rpc:get-providers-for-network', networkId),
    previewUrl: (data) => ipcRenderer.invoke('rpc:preview-url', data),
    getCurrentConfig: () => ipcRenderer.invoke('rpc:get-current-config'),
    saveNetworkConfig: (data) => ipcRenderer.invoke('rpc:save-network-config', data),
    bulkApplyEvm: (data) => ipcRenderer.invoke('rpc:bulk-apply-evm', data),

    // Etherscan
    getEtherscanKey: () => ipcRenderer.invoke('rpc:get-etherscan-key'),
    saveEtherscanKey: (key) => ipcRenderer.invoke('rpc:save-etherscan-key', key),
  },

  miner: {
    start: () => ipcRenderer.invoke('miner:start'),
  },

  // Custom events from main process
  onEnterOnboardingMode: (callback) => {
    ipcRenderer.on('enter-onboarding-mode', () => callback());
  },
  onShowMainApp: (callback) => {
    ipcRenderer.on('show-main-app', () => callback());
  },

  // Onboarding API (top-level)
  onboarding: {
    getStatus: () => ipcRenderer.invoke('onboarding:get-status'),
    createPohWallet: () => ipcRenderer.invoke('onboarding:create-poh-wallet'),
    complete: (data) => ipcRenderer.invoke('onboarding:complete', data),
    reset: () => ipcRenderer.invoke('onboarding:reset'),
  },

  // Ollama / AI setup
  setup: {
    check: () => ipcRenderer.invoke('setup:check'),
    install: () => ipcRenderer.invoke('setup:install'),
    pullModel: (model) => ipcRenderer.invoke('setup:pull-model', model),
    onProgress: (cb) => ipcRenderer.on('setup:progress', (_e, msg) => cb(msg)),
  },
});
