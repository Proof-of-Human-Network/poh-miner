/**
 * Managed Kubo (go-ipfs) daemon for PoH Miner — the local IPFS write backend
 * that makes chain/brain backups work out of the box.
 *
 * Behaviour mirrors search/meilisearch-server.js:
 *   - If a Kubo daemon is already healthy on the API port, reuse it.
 *   - Otherwise ensure a binary (PATH → bundled/downloaded under ~/.poh-miner/bin),
 *     init an isolated repo under ~/.poh-miner/ipfs, and spawn `ipfs daemon`.
 *
 * IPFS is best-effort: any failure here degrades to "no local pinning" and the
 * miner keeps running (IPFSStore.add() simply returns null). We never throw out
 * of ensureKubo() into the startup path.
 *
 * Ports: API defaults to 5001 (writes/pins go here), Gateway defaults to 8081
 * to avoid colliding with the PoH bootnode which uses 8080.
 */

import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import os from 'os';
import https from 'https';
import { pipeline } from 'stream/promises';

export const KUBO_VERSION = 'v0.32.1';
const DEFAULT_API_PORT     = 5001;
const DEFAULT_GATEWAY_PORT = 8081; // NOT 8080 — the PoH bootnode owns 8080
const DEFAULT_BIND         = '127.0.0.1';
const DIST_BASE            = 'https://dist.ipfs.tech/kubo';

function repoDir() {
  return path.join(os.homedir(), '.poh-miner', 'ipfs');
}

function binDir() {
  return path.join(os.homedir(), '.poh-miner', 'bin');
}

export function kuboApiUrl(cfg = {}) {
  const port = cfg.apiPort || DEFAULT_API_PORT;
  const bind = cfg.bindHost || DEFAULT_BIND;
  return `http://${bind}:${port}`;
}

export function kuboGatewayUrl(cfg = {}) {
  const port = cfg.gatewayPort || DEFAULT_GATEWAY_PORT;
  const bind = cfg.bindHost || DEFAULT_BIND;
  return `http://${bind}:${port}`;
}

// ── Binary resolution ───────────────────────────────────────────────────────

function platformAsset() {
  const { platform, arch } = process;
  const a = arch === 'arm64' ? 'arm64' : arch === 'arm' ? 'arm' : 'amd64';
  if (platform === 'linux')  return { asset: `kubo_${KUBO_VERSION}_linux-${a}.tar.gz`,  archive: 'tar.gz' };
  if (platform === 'darwin') return { asset: `kubo_${KUBO_VERSION}_darwin-${a}.tar.gz`, archive: 'tar.gz' };
  if (platform === 'win32')  return { asset: `kubo_${KUBO_VERSION}_windows-amd64.zip`,  archive: 'zip' };
  return null;
}

function binaryName() {
  return process.platform === 'win32' ? 'ipfs.exe' : 'ipfs';
}

function defaultBinaryPath() {
  return path.join(binDir(), binaryName());
}

function ipfsInPath() {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, ['ipfs'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().split('\n')[0];
    return out || null;
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
        try { fs.unlinkSync(dest); } catch { /* */ }
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch { /* */ }
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      pipeline(res, file).then(resolve).catch(reject);
    });
    req.on('error', reject);
  });
}

function extractArchive(archivePath, kind, outDir) {
  // Kubo archives contain a top-level `kubo/` folder with the `ipfs` binary.
  if (kind === 'tar.gz') {
    execFileSync('tar', ['-xzf', archivePath, '-C', outDir], { stdio: 'ignore' });
  } else if (kind === 'zip') {
    if (process.platform === 'win32') {
      execFileSync('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -Force -Path "${archivePath}" -DestinationPath "${outDir}"`,
      ], { stdio: 'ignore' });
    } else {
      execFileSync('unzip', ['-o', archivePath, '-d', outDir], { stdio: 'ignore' });
    }
  } else {
    throw new Error(`Unknown archive kind ${kind}`);
  }
}

/** Resolve a usable `ipfs` binary: PATH → cached → download+extract. */
export async function ensureKuboBinary(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  const local = defaultBinaryPath();
  if (fs.existsSync(local)) return local;
  const inPath = ipfsInPath();
  if (inPath) return inPath;

  const info = platformAsset();
  if (!info) throw new Error(`Kubo binary not supported on ${process.platform}/${process.arch}`);

  const dir = binDir();
  fs.mkdirSync(dir, { recursive: true });
  const archivePath = path.join(dir, info.asset);
  const url = `${DIST_BASE}/${KUBO_VERSION}/${info.asset}`;

  console.log(`[PoH-IPFS] Downloading Kubo ${KUBO_VERSION} (${info.asset})…`);
  await downloadFile(url, archivePath);

  const extractRoot = path.join(dir, 'kubo-extract');
  fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.mkdirSync(extractRoot, { recursive: true });
  extractArchive(archivePath, info.archive, extractRoot);

  const extractedBin = path.join(extractRoot, 'kubo', binaryName());
  if (!fs.existsSync(extractedBin)) throw new Error(`ipfs binary not found in archive at ${extractedBin}`);
  fs.copyFileSync(extractedBin, local);
  if (process.platform !== 'win32') fs.chmodSync(local, 0o755);

  fs.rmSync(extractRoot, { recursive: true, force: true });
  try { fs.unlinkSync(archivePath); } catch { /* */ }
  console.log(`[PoH-IPFS] Installed binary → ${local}`);
  return local;
}

// ── Health / port probes ────────────────────────────────────────────────────

export async function kuboHealthy(apiUrl, timeoutMs = 2000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Kubo's HTTP API only accepts POST.
    const r = await fetch(`${apiUrl}/api/v0/version`, { method: 'POST', signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForHealthy(apiUrl, maxWaitMs, intervalMs = 500) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await kuboHealthy(apiUrl, 2500)) return true;
    await sleep(intervalMs);
  }
  return false;
}

// ── Daemon ──────────────────────────────────────────────────────────────────

export class KuboDaemon {
  constructor(opts = {}) {
    this.apiPort     = opts.apiPort || DEFAULT_API_PORT;
    this.gatewayPort = opts.gatewayPort || DEFAULT_GATEWAY_PORT;
    this.bindHost    = opts.bindHost || DEFAULT_BIND;
    this.repoPath    = opts.repoPath || repoDir();
    this.binaryPath  = opts.binaryPath || null;
    this.apiUrl      = kuboApiUrl({ apiPort: this.apiPort, bindHost: this.bindHost });
    this.gatewayUrl  = kuboGatewayUrl({ gatewayPort: this.gatewayPort, bindHost: this.bindHost });
    this._proc       = null;
    this._managed    = false;
  }

  _env() {
    return { ...process.env, IPFS_PATH: this.repoPath };
  }

  _run(bin, args) {
    return execFileSync(bin, args, { env: this._env(), stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  }

  /** Init an isolated repo (idempotent) and pin ports so we never touch 8080. */
  _initRepo(bin) {
    const configFile = path.join(this.repoPath, 'config');
    if (!fs.existsSync(configFile)) {
      fs.mkdirSync(this.repoPath, { recursive: true });
      // lowpower keeps a miner's footprint small; still reprovides its own pins.
      this._run(bin, ['init', '--profile', 'lowpower']);
      console.log(`[PoH-IPFS] Initialised repo → ${this.repoPath}`);
    }
    // Force our ports every start — repo may have been created with defaults (8080 clash).
    this._run(bin, ['config', 'Addresses.API',     `/ip4/${this.bindHost}/tcp/${this.apiPort}`]);
    this._run(bin, ['config', 'Addresses.Gateway', `/ip4/${this.bindHost}/tcp/${this.gatewayPort}`]);
  }

  async ensureRunning({ maxWaitMs = 60_000 } = {}) {
    if (await kuboHealthy(this.apiUrl)) {
      console.log(`[PoH-IPFS] Using existing Kubo daemon at ${this.apiUrl}`);
      this._external = true;
      return this;
    }

    if (await isPortListening(this.bindHost, this.apiPort)) {
      // Something is on the API port but not answering as Kubo — don't fight it.
      if (await waitForHealthy(this.apiUrl, Math.min(10_000, maxWaitMs))) {
        this._external = true;
        return this;
      }
      throw new Error(`Port ${this.bindHost}:${this.apiPort} in use but not a healthy Kubo API`);
    }

    const bin = await ensureKuboBinary(this.binaryPath);
    this._initRepo(bin);

    console.log(`[PoH-IPFS] Starting Kubo daemon (${bin}) — API ${this.apiUrl}, gateway ${this.gatewayUrl}`);
    let stderr = '';
    this._proc = spawn(bin, ['daemon', '--enable-gc'], {
      env: this._env(),
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
    });
    this._managed = true;
    this._proc.stderr?.on('data', c => { stderr = (stderr + c.toString()).slice(-2000); });
    this._proc.on('error', err => console.error('[PoH-IPFS] Process error:', err.message));
    this._proc.on('exit', (code, sig) => {
      this._proc = null;
      this._managed = false;
      if (code == null || code === 0) return;
      const detail = stderr.trim().split('\n').filter(Boolean).pop() || '';
      console.warn(`[PoH-IPFS] Daemon exited code=${code} signal=${sig}${detail ? ` — ${detail}` : ''}`);
    });

    if (await waitForHealthy(this.apiUrl, maxWaitMs)) {
      console.log(`[PoH-IPFS] Ready at ${this.apiUrl}`);
      return this;
    }
    throw new Error(`Kubo daemon did not become healthy at ${this.apiUrl} within ${maxWaitMs}ms`);
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

/**
 * Entry point used by the miner. Returns a KuboDaemon on success, or null when
 * IPFS is skipped/unavailable (never throws — backups are best-effort).
 */
export async function ensureKubo(cfg = {}) {
  if (process.env.POH_SKIP_IPFS === '1' || process.env.VITEST) return null;
  if (cfg.autoStart === false) return null;
  try {
    const daemon = new KuboDaemon({
      apiPort: cfg.apiPort,
      gatewayPort: cfg.gatewayPort,
      bindHost: cfg.bindHost,
      repoPath: cfg.repoPath || undefined,
      binaryPath: cfg.binaryPath,
    });
    await daemon.ensureRunning({ maxWaitMs: cfg.startupTimeoutMs || 60_000 });
    return daemon;
  } catch (e) {
    console.warn(`[PoH-IPFS] Auto-start failed — backups disabled this run: ${e.message}`);
    return null;
  }
}
