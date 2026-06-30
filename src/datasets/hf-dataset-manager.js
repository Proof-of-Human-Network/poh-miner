/**
 * HfDatasetManager — install, store, query, and remove Hugging Face datasets
 * in the local brain data directory.
 *
 * Layout: <brainDataDir>/hf-datasets/<safeId>/
 *   manifest.json   { id, source, installedAt, files: [{name,size,sha256}] }
 *   rows.jsonl       normalized row data (one JSON object per line), regardless
 *                     of the dataset's original format on Hugging Face.
 *
 * Normalizing every format (parquet/csv/json) down to rows.jsonl keeps
 * loadRelevantSlice() and the peer-serving code (hf-dataset-peer-serve.js)
 * format-agnostic — they only ever deal with one file.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const HF_API_BASE = 'https://huggingface.co/api/datasets';
const HF_RESOLVE_BASE = 'https://huggingface.co/datasets';

// Keep installs small — this runs on miner hardware with limited disk, and the
// downstream use is "inject a relevant slice into a ~1.5B model's prompt", not
// full dataset training. These are intentionally conservative v1 defaults.
const MAX_ROWS = 5000;
const MAX_SIBLING_FILE_BYTES = 50 * 1024 * 1024;
const MAX_SLICE_CHARS = 6000;

function safeDirName(datasetId) {
  return datasetId.replace(/[^a-zA-Z0-9._-]/g, '__');
}

function datasetDir(brainDataDir, datasetId) {
  return path.join(brainDataDir, 'hf-datasets', safeDirName(datasetId));
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function isInstalled(brainDataDir, datasetId) {
  return fs.existsSync(path.join(datasetDir(brainDataDir, datasetId), 'manifest.json'));
}

export function getManifest(brainDataDir, datasetId) {
  try {
    const p = path.join(datasetDir(brainDataDir, datasetId), 'manifest.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function listInstalled(brainDataDir) {
  const root = path.join(brainDataDir, 'hf-datasets');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, entry, 'manifest.json'), 'utf8'));
      out.push(manifest);
    } catch { /* skip malformed/partial install dirs */ }
  }
  return out;
}

export function deleteDataset(brainDataDir, datasetId) {
  const dir = datasetDir(brainDataDir, datasetId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function writeManifest(brainDataDir, datasetId, manifest) {
  const dir = datasetDir(brainDataDir, datasetId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

// ── Row-source readers ─────────────────────────────────────────────────────

// HF auto-converts almost every dataset to parquet, so this covers the vast
// majority of datasets uniformly without needing format-specific download logic.
async function tryReadViaParquetExport(datasetId) {
  const res = await fetch(`${HF_API_BASE}/${datasetId}/parquet`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const byConfig = await res.json();
  const firstConfig = Object.values(byConfig || {})[0];
  const firstSplit  = Object.values(firstConfig || {})[0];
  const url = Array.isArray(firstSplit) ? firstSplit[0] : null;
  if (!url) return null;

  // Lazy import: only pull in the parquet reader when actually needed.
  const { asyncBufferFromUrl, parquetReadObjects } = await import('hyparquet');
  const file = await asyncBufferFromUrl({ url });
  const rows = await parquetReadObjects({ file, rowEnd: MAX_ROWS });
  return rows;
}

// Fallback for the rare dataset with no parquet auto-conversion: pull raw
// json/jsonl/csv sibling files directly and parse them.
async function tryReadViaRawSiblings(datasetId) {
  const metaRes = await fetch(`${HF_API_BASE}/${datasetId}`, { signal: AbortSignal.timeout(10_000) });
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();
  const siblings = (meta.siblings || []).filter(s =>
    /\.(json|jsonl|csv)$/i.test(s.rfilename) && (s.size == null || s.size <= MAX_SIBLING_FILE_BYTES)
  );
  if (!siblings.length) return null;

  const rows = [];
  for (const sib of siblings) {
    if (rows.length >= MAX_ROWS) break;
    try {
      const fileRes = await fetch(`${HF_RESOLVE_BASE}/${datasetId}/resolve/main/${sib.rfilename}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!fileRes.ok) continue;
      const text = await fileRes.text();

      if (/\.jsonl$/i.test(sib.rfilename)) {
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try { rows.push(JSON.parse(line)); } catch { /* skip malformed line */ }
          if (rows.length >= MAX_ROWS) break;
        }
      } else if (/\.json$/i.test(sib.rfilename)) {
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : [parsed]);
        rows.push(...arr.slice(0, MAX_ROWS - rows.length));
      } else if (/\.csv$/i.test(sib.rfilename)) {
        const lines = text.split('\n').filter(Boolean);
        const headers = lines[0]?.split(',').map(h => h.trim()) || [];
        for (const line of lines.slice(1, 1 + (MAX_ROWS - rows.length))) {
          const cells = line.split(',');
          rows.push(Object.fromEntries(headers.map((h, i) => [h, cells[i]])));
        }
      }
    } catch { /* skip this sibling, try the next */ }
  }
  return rows.length ? rows : null;
}

/**
 * Download a dataset from Hugging Face and install it locally.
 * Throws if no readable rows could be obtained.
 */
export async function installFromHuggingFace(brainDataDir, datasetId) {
  let rows = null;
  try { rows = await tryReadViaParquetExport(datasetId); } catch { /* fall back below */ }
  if (!rows?.length) {
    try { rows = await tryReadViaRawSiblings(datasetId); } catch { /* fall through to error */ }
  }
  if (!rows?.length) {
    throw new Error(`Could not read any rows for dataset "${datasetId}" from Hugging Face`);
  }

  const dir = datasetDir(brainDataDir, datasetId);
  fs.mkdirSync(dir, { recursive: true });
  const jsonl = rows.map(r => JSON.stringify(r)).join('\n');
  const buf = Buffer.from(jsonl, 'utf8');
  fs.writeFileSync(path.join(dir, 'rows.jsonl'), buf);

  const manifest = {
    id: datasetId,
    source: 'huggingface',
    installedAt: Date.now(),
    rowCount: rows.length,
    files: [{ name: 'rows.jsonl', size: buf.length, sha256: sha256(buf) }],
  };
  writeManifest(brainDataDir, datasetId, manifest);
  return manifest;
}

/**
 * Install a dataset already fetched as a manifest+files pair from a peer
 * (see hf-dataset-peer-serve.js: pullHfDatasetFromPeer). Caller has already
 * verified each file's sha256 against the peer's manifest.
 */
export function installFromPeerFiles(brainDataDir, datasetId, files /* [{name, buf}] */) {
  const dir = datasetDir(brainDataDir, datasetId);
  fs.mkdirSync(dir, { recursive: true });
  const manifestFiles = [];
  for (const { name, buf } of files) {
    fs.writeFileSync(path.join(dir, name), buf);
    manifestFiles.push({ name, size: buf.length, sha256: sha256(buf) });
  }
  const manifest = {
    id: datasetId,
    source: 'peer',
    installedAt: Date.now(),
    files: manifestFiles,
  };
  writeManifest(brainDataDir, datasetId, manifest);
  return manifest;
}

/**
 * Load a small, query-relevant slice of an installed dataset's rows, formatted
 * for direct injection into an LLM prompt (same role as `skillContext` data
 * elsewhere in the codebase). Not semantic search — a simple keyword-overlap
 * ranking over rows, capped to keep prompts small.
 */
export function loadRelevantSlice(brainDataDir, datasetId, query, maxRows = 20) {
  const rowsPath = path.join(datasetDir(brainDataDir, datasetId), 'rows.jsonl');
  if (!fs.existsSync(rowsPath)) return null;

  const terms = (query || '').toLowerCase().split(/\W+/).filter(w => w.length >= 3);
  const lines = fs.readFileSync(rowsPath, 'utf8').split('\n').filter(Boolean);

  const scored = lines.map(line => {
    const lower = line.toLowerCase();
    const score = terms.reduce((s, t) => s + (lower.includes(t) ? 1 : 0), 0);
    return { line, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = (scored.some(s => s.score > 0) ? scored.filter(s => s.score > 0) : scored).slice(0, maxRows);

  const slice = top.map(s => {
    try { return JSON.parse(s.line); } catch { return null; }
  }).filter(Boolean);

  return JSON.stringify(slice, null, 2).slice(0, MAX_SLICE_CHARS);
}
