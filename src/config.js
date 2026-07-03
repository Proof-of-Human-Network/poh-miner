/**
 * PoH Miner Network - Config Loader
 *
 * Supports multiple config locations with clear precedence.
 * This makes the developer experience much better after `git clone`.
 *
 * Resolution order (first match wins):
 *   1. POH_CONFIG env var (full path)
 *   2. ./ .poh-miner/config.json   (local dot directory)
 *   3. ./config.json               (project root - very convenient after clone)
 *   4. <script-dir>/.poh-miner/config.json
 *   5. ~/.poh-miner/config.json    (global user config)
 *
 * When no config exists, we intelligently decide where to create the default:
 * - Inside the source tree → prefer local .poh-miner/config.json
 * - Normal installed usage → global ~/.poh-miner/config.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.poh-miner', 'config.json');

/**
 * Detect whether we appear to be running inside the poh-miner-network source tree.
 */
function isRunningInSourceTree(cwd, scriptDir) {
  return (
    fs.existsSync(path.join(scriptDir, 'src', 'miner-node.js')) ||
    fs.existsSync(path.join(cwd, 'src', 'miner-node.js')) ||
    fs.existsSync(path.join(scriptDir, 'package.json'))
  );
}

/**
 * Resolve which config file to use.
 * Returns { path, source, willCreate? }
 */
export function resolveConfigPath({ allowCreate = true } = {}) {
  // 1. Explicit full path override (highest priority)
  if (process.env.POH_CONFIG) {
    return {
      path: process.env.POH_CONFIG,
      source: 'env-override',
    };
  }

  const cwd = process.cwd();
  const scriptDir = __dirname;

  const candidates = [
    // Root config.json is the most convenient after "git clone + cp config.example.json config.json"
    {
      path: path.join(cwd, 'config.json'),
      source: 'local-root',
    },
    {
      path: path.join(cwd, '.poh-miner', 'config.json'),
      source: 'local-dotdir',
    },
    {
      path: path.join(scriptDir, '.poh-miner', 'config.json'),
      source: 'script-local',
    },
    {
      path: GLOBAL_CONFIG_PATH,
      source: 'global',
    },
  ];

  // Return the first existing file
  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path)) {
      return {
        path: candidate.path,
        source: candidate.source,
      };
    }
  }

  // No config exists yet — decide smart default creation location
  if (!allowCreate) {
    return {
      path: GLOBAL_CONFIG_PATH,
      source: 'global',
    };
  }

  const inSourceTree = isRunningInSourceTree(cwd, scriptDir);

  if (inSourceTree) {
    // Developer / "just cloned" experience: create local config
    const localPath = path.join(cwd, '.poh-miner', 'config.json');
    return {
      path: localPath,
      source: 'local-dotdir',
      willCreate: true,
    };
  }

  // Normal user / installed binary flow
  return {
    path: GLOBAL_CONFIG_PATH,
    source: 'global',
    willCreate: true,
  };
}

/**
 * Load config. Creates a default if none exists.
 * Returns { config, path, source }
 */
export function loadConfig() {
  const resolved = resolveConfigPath({ allowCreate: true });

  let config;

  if (fs.existsSync(resolved.path)) {
    config = JSON.parse(fs.readFileSync(resolved.path, 'utf8'));
  } else {
    // Create default config at the resolved location
    const dir = path.dirname(resolved.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    config = getDefaultConfig();
    fs.writeFileSync(resolved.path, JSON.stringify(config, null, 2));

    const locationDesc = resolved.source === 'local-dotdir' || resolved.source === 'local-root'
      ? 'local project config'
      : 'global user config';

    console.log(`✅ Created default config at: ${resolved.path} (${locationDesc})`);
  }

  return {
    config,
    path: resolved.path,
    source: resolved.source,
  };
}

/**
 * The default config written for first-time users.
 * Note: bootnodes is intentionally left empty here. Users (especially after clone)
 * are expected to add their own via config.example.json or manually.
 */
export function getDefaultConfig() {
  return {
    wallet: 'YOUR_SOLANA_ADDRESS_HERE',
    ollamaUrl: 'http://localhost:11434',
    model: 'qwen2.5:1.5b',
    inferenceMode: 'auto', // "auto" | "gpu" | "cpu"
    autoStart: true,

    // === Bootnodes (critical for real network participation) ===
    // Add one or more stable bootnodes here so you can sync the chain.
    // Example:
    // "bootnodes": [
    //   "http://your-bootnode-ip:8080"
    // ],
    bootnodes: [],

    // === New recommended RPC format (provider + key) ===
    // This is much cleaner than manually pasting full URLs.
    rpc: {
      solana: { provider: "helius", apiKey: "" },
      "1": { provider: "alchemy", apiKey: "" },
      "8453": { provider: "alchemy", apiKey: "" },
      "42161": { provider: "alchemy", apiKey: "" }
    },

    // Use overrides for chains where your main provider is weak (BTC, TRON, TON, XLM, etc.)
    rpcOverrides: {
      btc: "https://mempool.space/api",
      tron: "",
      ton: "",
      xlm: "https://horizon.stellar.org"
    },

    // Etherscan (and Etherscan-family) API key — required for many Ethereum signals
    // (Etherscan, Basescan, Arbiscan, Polygonscan, BscScan, etc. usually accept the same key)
    etherscanApiKey: "",

    // === External AI providers (cloud fallback when local Ollama + peers are unavailable) ===
    // Keyed by provider id: "anthropic" | "openai" | "xai" | "custom"
    aiProviders: {},

    // === External MCP servers (standard MCP format) ===
    // { "serverId": { "command": "npx", "args": ["-y", "pkg"], "env": {} } }
    mcpServers: {},

    // Blockchain chat history search (Meilisearch + local fallback)
    meilisearch: {
      enabled: true,
      host: "http://127.0.0.1:7700",
      apiKey: "",
      indexJobs: "poh-chat-history",
    },

    // Populated by the GUI onboarding flow
    pohWallet: "",
    solanaAddress: "",
    onboarded: false,
  };
}

/**
 * Save (overwrite) a config object to a specific path.
 */
export function saveConfig(config, targetPath) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(targetPath, JSON.stringify(config, null, 2));
}

/**
 * Small helper used by CLI "poh-miner config" and status commands.
 */
export function getConfigLocationInfo() {
  const resolved = resolveConfigPath({ allowCreate: false });
  const exists = fs.existsSync(resolved.path);

  return {
    path: resolved.path,
    source: resolved.source,
    exists,
  };
}
