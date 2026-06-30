/**
 * HfDatasetPeerServe — serve and fetch installed HF datasets between peers.
 *
 * Mirrors src/storage/dataset-sync.js (manifest + per-file sha256 pull), just
 * generalized from one fixed brain-state manifest to per-dataset manifests
 * under hf-datasets/<id>/. Used as a fallback when a fresh Hugging Face
 * download fails (e.g. HF unreachable) and a peer already has the dataset.
 *
 * Serves: GET /api/hf-dataset/:id/manifest
 *         GET /api/hf-dataset/:id/file/:name
 * Fetches: pullHfDatasetFromPeer(peers, brainDataDir, datasetId)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getManifest, installFromPeerFiles } from './hf-dataset-manager.js';

function safeDirName(datasetId) {
  return datasetId.replace(/[^a-zA-Z0-9._-]/g, '__');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Handle /api/hf-dataset/:id/manifest and /api/hf-dataset/:id/file/:name.
 * Returns true if the request was handled, false otherwise.
 */
export function serveHfDataset(req, res, brainDataDir) {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/api\/hf-dataset\/([^/]+)\/(manifest|file\/([^/]+))$/);
  if (!m || req.method !== 'GET') return false;

  const datasetId = decodeURIComponent(m[1]);
  const manifest = getManifest(brainDataDir, datasetId);
  if (!manifest) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'dataset not installed on this node' }));
    return true;
  }

  if (m[2] === 'manifest') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(manifest));
    return true;
  }

  const fileName = m[3];
  const entry = manifest.files.find(f => f.name === fileName);
  if (!entry) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'unknown dataset file' }));
    return true;
  }

  const abs = path.join(brainDataDir, 'hf-datasets', safeDirName(datasetId), fileName);
  if (!fs.existsSync(abs)) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
    return true;
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.end(fs.readFileSync(abs));
  return true;
}

/**
 * Pull a dataset from the first reachable peer that reports having it.
 * `peers` is an array of base URLs (e.g. ['http://1.2.3.4:3456']) already
 * filtered (by the caller) to ones whose /status reports this datasetId in
 * installedHfDatasets. Returns the installed manifest, or null if no peer
 * could serve a verified copy.
 */
export async function pullHfDatasetFromPeer(peers, brainDataDir, datasetId) {
  for (const base of (peers || [])) {
    try {
      const manifestRes = await fetch(`${base}/api/hf-dataset/${encodeURIComponent(datasetId)}/manifest`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!manifestRes.ok) continue;
      const manifest = await manifestRes.json();
      if (!manifest?.files?.length) continue;

      const files = [];
      let ok = true;
      for (const entry of manifest.files) {
        const fileRes = await fetch(`${base}/api/hf-dataset/${encodeURIComponent(datasetId)}/file/${encodeURIComponent(entry.name)}`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!fileRes.ok) { ok = false; break; }
        const buf = Buffer.from(await fileRes.arrayBuffer());
        if (sha256(buf) !== entry.sha256) { ok = false; break; } // integrity check against peer's own manifest
        files.push({ name: entry.name, buf });
      }
      if (!ok || !files.length) continue;

      return installFromPeerFiles(brainDataDir, datasetId, files);
    } catch { /* try next peer */ }
  }
  return null;
}
