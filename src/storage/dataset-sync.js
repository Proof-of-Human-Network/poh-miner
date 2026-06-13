/**
 * DatasetSync — serve and fetch brain datasets between peers.
 *
 * Serves: GET /api/dataset          → manifest (file list + sha256 + size)
 *         GET /api/dataset/:name    → raw file content
 *         GET /api/dataset/labeled/:name
 *
 * Fetches: pull(peers, brainDir) → downloads any file that is missing or
 *          has a different hash than what the best peer serves.
 */

import fs   from 'fs';
import path from 'path';
import crypto from 'crypto';

// Files to sync, relative to brainDir
const BRAIN_FILES = [
  'weights.json',
  'feedback.json',
  'method_health.json',
  'profiles.json',
  'dataset.json',
  'brain_state.md',
];
const LABELED_FILES = [
  'labeled/cex.json',
  'labeled/offramp5k.json',
  'labeled/offramp15k.json',
];
const ALL_FILES = [...BRAIN_FILES, ...LABELED_FILES];

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readFileSafe(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  } catch { return null; }
}

export function buildManifest(brainDir) {
  const files = [];
  for (const rel of ALL_FILES) {
    const abs = path.join(brainDir, rel);
    const buf = readFileSafe(abs);
    if (!buf) continue;
    files.push({ name: rel, size: buf.length, sha256: sha256(buf) });
  }
  return { files, version: 1, ts: Date.now() };
}

/**
 * Handle /api/dataset and /api/dataset/* requests.
 * Returns true if the request was handled, false otherwise.
 */
export function serveDataset(req, res, brainDir) {
  const url  = new URL(req.url, 'http://localhost');
  const pth  = url.pathname;

  if (!pth.startsWith('/api/dataset')) return false;

  if (pth === '/api/dataset') {
    // Manifest
    const manifest = buildManifest(brainDir);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(manifest));
    return true;
  }

  // Individual file: /api/dataset/weights.json  or  /api/dataset/labeled/cex.json
  const rel = pth.replace(/^\/api\/dataset\//, '');

  // Safety: only serve known files, no path traversal
  const canonical = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  if (!ALL_FILES.includes(canonical)) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'unknown dataset file' }));
    return true;
  }

  const abs = path.join(brainDir, canonical);
  const buf = readFileSafe(abs);
  if (!buf) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
    return true;
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.end(buf);
  return true;
}

/**
 * Pull dataset files from the best available peer.
 *
 * peers: array of { host, walletApiPort } (from bootnode /peers)
 * brainDir: local brain data directory
 */
export async function pullDataset(peers, brainDir) {
  if (!peers?.length) return;

  fs.mkdirSync(path.join(brainDir, 'labeled'), { recursive: true });

  // Find a peer that responds and has a manifest
  let bestManifest = null;
  let bestBase     = null;

  for (const peer of peers) {
    if (!peer.host || peer.host === 'localhost' || peer.host === '127.0.0.1') continue;
    const base = `http://${peer.host}:${peer.walletApiPort}`;
    try {
      const res = await fetch(`${base}/api/dataset`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const manifest = await res.json();
      if (!manifest?.files?.length) continue;
      bestManifest = manifest;
      bestBase     = base;
      break;
    } catch { /* try next */ }
  }

  if (!bestManifest) {
    console.log('[DatasetSync] No peer with dataset available');
    return;
  }

  console.log(`[DatasetSync] Syncing ${bestManifest.files.length} dataset files from ${bestBase}`);

  let downloaded = 0;
  for (const entry of bestManifest.files) {
    const localPath = path.join(brainDir, entry.name);
    const localBuf  = readFileSafe(localPath);

    // Skip if local copy is identical
    if (localBuf && sha256(localBuf) === entry.sha256) continue;

    try {
      const res = await fetch(`${bestBase}/api/dataset/${entry.name}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());

      // Integrity check
      if (sha256(buf) !== entry.sha256) {
        console.warn(`[DatasetSync] Hash mismatch for ${entry.name} — skipping`);
        continue;
      }

      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, buf);
      downloaded++;
      console.log(`[DatasetSync] Downloaded ${entry.name} (${entry.size} bytes)`);
    } catch (e) {
      console.warn(`[DatasetSync] Failed to fetch ${entry.name}: ${e.message}`);
    }
  }

  console.log(`[DatasetSync] Done — ${downloaded} files updated`);
}
