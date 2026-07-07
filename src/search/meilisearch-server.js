/**
 * Managed Meilisearch process for PoH Miner — mandatory chat history backend.
 * Uses an existing instance on the configured port (e.g. Docker) or spawns a
 * bundled/downloaded binary under ~/.poh-miner/bin/.
 */

import { spawn, execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import os from 'os';
import https from 'https';
import { pipeline } from 'stream/promises';

export const MEILI_VERSION = 'v1.12.8';
const DEFAULT_PORT = 7700;
const DEFAULT_BIND = '127.0.0.1';
const MASTER_KEY_MIN_LEN = 16;
const MASTER_KEY_FILE = 'meilisearch-master-key';

export function meilisearchMasterKeyPath() {
  return path.join(os.homedir(), '.poh-miner', MASTER_KEY_FILE);
}

/** Read configured master key (config, env, or persisted file). Does not generate. */
export function getMeilisearchMasterKey(cfg = {}) {
  const fromCfg = String(cfg.apiKey || cfg.masterKey || '').trim();
  if (fromCfg.length >= MASTER_KEY_MIN_LEN) return fromCfg;
  const fromEnv = String(process.env.MEILI_MASTER_KEY || '').trim();
  if (fromEnv.length >= MASTER_KEY_MIN_LEN) return fromEnv;
  const keyPath = meilisearchMasterKeyPath();
  try {
    if (fs.existsSync(keyPath)) {
      const stored = fs.readFileSync(keyPath, 'utf8').trim();
      if (stored.length >= MASTER_KEY_MIN_LEN) return stored;
    }
  } catch { /* */ }
  return null;
}

/** Create and persist a master key when spawning a managed Meilisearch instance. */
export function ensureMeilisearchMasterKey(cfg = {}) {
  const existing = getMeilisearchMasterKey(cfg);
  if (existing) return existing;
  const key = crypto.randomBytes(32).toString('base64url');
  const keyPath = meilisearchMasterKeyPath();
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, `${key}\n`, { mode: 0o600 });
  console.log(`[PoH-Meili] Generated master key → ${keyPath}`);
  return key;
}

function platformAsset() {
  const { platform, arch } = process;
  if (platform === 'linux') return arch === 'arm64' ? 'meilisearch-linux-aarch64' : 'meilisearch-linux-amd64';
  if (platform === 'darwin') return arch === 'arm64' ? 'meilisearch-macos-aarch64' : 'meilisearch-macos-amd64';
  if (platform === 'win32') return 'meilisearch-windows-amd64.exe';
  return null;
}

function binDir() {
  return path.join(os.homedir(), '.poh-miner', 'bin');
}

function defaultBinaryPath() {
  const asset = platformAsset();
  if (!asset) return null;
  const name = process.platform === 'win32' ? 'meilisearch.exe' : 'meilisearch';
  return path.join(binDir(), name);
}

export function resolveMeilisearchUrl(cfg = {}) {
  const port = cfg.port || DEFAULT_PORT;
  const bind = cfg.bindHost || DEFAULT_BIND;
  if (cfg.host) return cfg.host.replace(/\/$/, '');
  return `http://${bind}:${port}`;
}

export async function meilisearchHealthy(hostUrl, timeoutMs = 2000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${hostUrl}/health`, { signal: ctrl.signal });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return j.status === 'available';
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** True when something is already bound on host:port (e.g. Docker Meilisearch). */
export function isPortListening(host, port, timeoutMs = 1000) {
  return new Promise(resolve => {
    const sock = net.createConnection({ host, port });
    const done = ok => {
      sock.removeAllListeners();
      try { sock.destroy(); } catch { /* */ }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

async function waitForHealthy(hostUrl, maxWaitMs, intervalMs = 400) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await meilisearchHealthy(hostUrl, 3000)) return true;
    await sleep(intervalMs);
  }
  return false;
}

function meilisearchInPath() {
  try {
    execSync(process.platform === 'win32' ? 'where meilisearch' : 'which meilisearch', { stdio: 'ignore' });
    return 'meilisearch';
  } catch {
    return null;
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      pipeline(res, file).then(resolve).catch(reject);
    });
    req.on('error', reject);
  });
}

export async function ensureMeilisearchBinary(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  const local = defaultBinaryPath();
  if (local && fs.existsSync(local)) return local;
  const inPath = meilisearchInPath();
  if (inPath) return inPath;

  const asset = platformAsset();
  if (!asset) throw new Error(`Meilisearch binary not supported on ${process.platform}/${process.arch}`);

  const dir = binDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = local;
  const tmp = `${dest}.download`;
  const url = `https://github.com/meilisearch/meilisearch/releases/download/${MEILI_VERSION}/${asset}`;

  console.log(`[PoH-Meili] Downloading Meilisearch ${MEILI_VERSION} (${asset})…`);
  await downloadFile(url, tmp);
  fs.renameSync(tmp, dest);
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  console.log(`[PoH-Meili] Installed binary → ${dest}`);
  return dest;
}

export class MeilisearchServer {
  constructor(opts = {}) {
    this.port = opts.port || DEFAULT_PORT;
    this.bindHost = opts.bindHost || DEFAULT_BIND;
    this.dataDir = opts.dataDir || path.join(os.homedir(), '.poh-miner', 'meilisearch-data');
    this.binaryPath = opts.binaryPath || null;
    this.masterKey = opts.masterKey || null;
    this.hostUrl = resolveMeilisearchUrl({ host: opts.host, port: this.port, bindHost: this.bindHost });
    this._proc = null;
    this._managed = false;
  }

  async ensureRunning({ maxWaitMs = 60_000 } = {}) {
    if (await meilisearchHealthy(this.hostUrl)) {
      console.log(`[PoH-Meili] Using existing Meilisearch at ${this.hostUrl}`);
      return this;
    }

    // Existing instance (Docker, prior run) may still be starting — wait before spawning.
    const warmUpMs = Math.min(15_000, maxWaitMs);
    if (await waitForHealthy(this.hostUrl, warmUpMs)) {
      console.log(`[PoH-Meili] Using existing Meilisearch at ${this.hostUrl}`);
      return this;
    }

    if (await isPortListening(this.bindHost, this.port)) {
      const remaining = Math.max(5_000, maxWaitMs - warmUpMs);
      if (await waitForHealthy(this.hostUrl, remaining)) {
        console.log(`[PoH-Meili] Using existing Meilisearch at ${this.hostUrl} (port ${this.port} in use)`);
        return this;
      }
      throw new Error(
        `Port ${this.bindHost}:${this.port} is in use but Meilisearch is not healthy at ${this.hostUrl}`,
      );
    }

    const bin = await ensureMeilisearchBinary(this.binaryPath);
    fs.mkdirSync(this.dataDir, { recursive: true });

    if (!this.masterKey) {
      this.masterKey = ensureMeilisearchMasterKey();
    }

    const args = ['--db-path', this.dataDir, '--http-addr', `${this.bindHost}:${this.port}`];
    if (this.masterKey) args.push('--master-key', this.masterKey);
    console.log(`[PoH-Meili] Starting Meilisearch (${bin}) on ${this.hostUrl}`);

    let stderr = '';
    this._proc = spawn(bin, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
      env: {
        ...process.env,
        MEILI_ENV: process.env.MEILI_ENV || 'production',
        ...(this.masterKey ? { MEILI_MASTER_KEY: this.masterKey } : {}),
      },
    });
    this._managed = true;
    this._proc.stderr?.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    this._proc.on('error', err => console.error('[PoH-Meili] Process error:', err.message));
    this._proc.on('exit', (code, sig) => {
      this._proc = null;
      this._managed = false;
      if (code == null || code === 0) return;
      meilisearchHealthy(this.hostUrl, 1500).then(ok => {
        if (ok) {
          console.log(`[PoH-Meili] Using existing Meilisearch at ${this.hostUrl} (managed process exited code=${code})`);
          return;
        }
        const detail = stderr.trim().split('\n').filter(Boolean).pop() || '';
        console.warn(
          `[PoH-Meili] Exited code=${code} signal=${sig}${detail ? ` — ${detail}` : ''}`,
        );
        // 0xC0000135 = STATUS_DLL_NOT_FOUND: meilisearch.exe needs the MSVC runtime.
        if (process.platform === 'win32' && (code === 3221225781 || code === 0xC0000135)) {
          console.warn(
            '[PoH-Meili] Windows is missing the Microsoft Visual C++ Redistributable required by meilisearch.exe. ' +
            'Install it from https://aka.ms/vs/17/release/vc_redist.x64.exe and restart the miner. ' +
            'Mining continues without chat-history search until then.',
          );
        }
      });
    });

    const remaining = Math.max(5_000, maxWaitMs - warmUpMs);
    if (await waitForHealthy(this.hostUrl, remaining)) {
      if (this._managed && this._proc) {
        console.log(`[PoH-Meili] Ready at ${this.hostUrl}`);
      }
      return this;
    }
    throw new Error(`Meilisearch did not become healthy at ${this.hostUrl} within ${maxWaitMs}ms`);
  }

  stop() {
    if (this._proc && !this._proc.killed) {
      try { this._proc.kill('SIGTERM'); } catch { /* */ }
      this._proc = null;
      this._managed = false;
    }
  }

  get managed() { return this._managed; }
}

export async function ensureMeilisearch(cfg = {}) {
  if (process.env.POH_SKIP_MEILI === '1' || process.env.VITEST) {
    return null;
  }
  const server = new MeilisearchServer({
    port: cfg.port,
    bindHost: cfg.bindHost,
    host: cfg.host,
    dataDir: cfg.dataDir,
    binaryPath: cfg.binaryPath,
    masterKey: getMeilisearchMasterKey(cfg),
  });
  await server.ensureRunning({ maxWaitMs: cfg.startupTimeoutMs || 90_000 });
  return server;
}