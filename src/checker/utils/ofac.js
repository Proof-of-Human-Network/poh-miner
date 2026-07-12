'use strict';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const DATA_DIR = process.env.OFAC_DATA_DIR
  || (process.env.POH_DATA_DIR)
  || path.join(os.homedir(), '.poh-miner', 'data');
const CACHE_PATH = path.join(DATA_DIR, 'ofac_cache.json');
const SDN_URL    = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory: normalizedAddress → { name, program, chainCode }
let ofacMap     = new Map();
let lastUpdated = 0;

// ── CSV parser ────────────────────────────────────────────────────────────────
// SDN CSV format: entNum,"Name",type,"Program",...,Remarks
// Digital currency addresses appear in the Remarks column as:
//   Digital Currency Address - ETH 0xabc...;
//   alt. Digital Currency Address - XBT 1abc...;

function parseSdnCsv(csvText) {
  const map = new Map();

  for (const line of csvText.split('\n')) {
    if (!line.includes('Digital Currency Address')) continue;

    // Entity name: second field, always double-quoted
    const nameMatch = line.match(/^\d+,"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : 'Unknown';

    // Program codes appear as [PROG] brackets or as a plain code in the 4th column
    const bracketProgs = [...line.matchAll(/\[([A-Z][A-Z0-9_-]+)\]/g)].map(m => m[1]);
    const plainProg    = line.match(/^\d+,"[^"]+",(?:[^,]+)?,\s*"([A-Z][A-Z0-9_-]+)"/)?.[1];
    const program      = bracketProgs[0] || plainProg || 'SDN';

    // Extract every "Digital Currency Address - CHAIN addr" occurrence
    const addrRe = /(?:alt\.\s+)?Digital Currency Address\s+-\s+([A-Z0-9]+)\s+([A-Za-z0-9]+)/g;
    let m;
    while ((m = addrRe.exec(line)) !== null) {
      const chainCode = m[1];
      const rawAddr   = m[2];
      // Normalise EVM addresses to lowercase (covers all EVM chains)
      const addr = (chainCode === 'ETH' || chainCode === 'ETC') ? rawAddr.toLowerCase() : rawAddr;
      map.set(addr, { name, program, chainCode });
    }
  }

  return map;
}

// ── Download + parse + persist ────────────────────────────────────────────────

async function refresh() {
  try {
    console.log('[ofac] Downloading SDN list…');
    const res = await axios.get(SDN_URL, {
      maxRedirects: 5,
      timeout:      45_000,
      responseType: 'text',
    });
    const map   = parseSdnCsv(res.data);
    ofacMap     = map;
    lastUpdated = Date.now();

    const payload = {
      updatedAt: new Date(lastUpdated).toISOString(),
      count:     map.size,
      addresses: Object.fromEntries(map),
    };
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    const tmp = CACHE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, CACHE_PATH);
    console.log(`[ofac] SDN list loaded — ${map.size} sanctioned crypto addresses`);
  } catch (err) {
    console.error('[ofac] Failed to refresh SDN list:', err.message);
    // Fail open — keep whatever we already have in memory
  }
}

function loadFromCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return false;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    const age = Date.now() - new Date(raw.updatedAt).getTime();
    if (age > REFRESH_MS) return false; // stale — fetch fresh
    ofacMap     = new Map(Object.entries(raw.addresses || {}));
    lastUpdated = new Date(raw.updatedAt).getTime();
    console.log(`[ofac] Cache loaded — ${ofacMap.size} addresses (${Math.round(age / 3_600_000)}h old)`);
    return true;
  } catch {
    return false;
  }
}

// ── Startup: load cache or fetch, then refresh every 24 h ────────────────────

(async () => {
  const cacheOk = loadFromCache();
  if (!cacheOk) await refresh();
  setInterval(refresh, REFRESH_MS);
})();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether `address` (or any address matching its normalised form) is on
 * the OFAC SDN list.
 *
 * @param {string} address
 * @returns {{ sanctioned: false } | { sanctioned: true, name: string, program: string, chainCode: string }}
 */
function isOfacSanctioned(address) {
  if (!address) return { sanctioned: false };
  // EVM: compare lowercase; other chains (Solana, BTC, TRX): exact match
  const key = /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : address;
  const hit  = ofacMap.get(key);
  return hit ? { sanctioned: true, ...hit } : { sanctioned: false };
}

/** Diagnostic: how many sanctioned addresses are loaded and when they were last refreshed. */
function getOfacStats() {
  return {
    count:     ofacMap.size,
    updatedAt: lastUpdated ? new Date(lastUpdated).toISOString() : null,
  };
}

// ── Task 4: Additional sanctions lists (UK FCDO, EU) ──────────────────────────
// UK: https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv (auto-fetched)
// EU: https://data.europa.eu/apps/eusanctionstracker/individuals/
//     Built on official EU Consolidated Financial Sanctions List (FSD)
//     Best source: https://webgate.ec.europa.eu/fsd/fsf (login may be required for bulk export)
//     Recommended: Periodically download the latest "Consolidated list" (CSV or XML v1.1)
//     and place it as data/eu_consolidated.csv (or .xml) in this project.
//
// Current implementation: name-based fuzzy matching (EU lists rarely contain crypto addresses).
// Crypto address screening is still best covered by the OFAC SDN list.

const UK_SANCTIONS_URL = 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv';
let ukNames = new Set(); // lowercased names for substring / exact match

async function refreshUk() {
  try {
    const res = await axios.get(UK_SANCTIONS_URL, { timeout: 45000, responseType: 'text' });
    const lines = res.data.split('\n').slice(1); // skip header
    ukNames = new Set();
    for (const line of lines) {
      // Name is usually first or "Name" column; simple split
      const name = (line.split(',')[0] || '').replace(/^"|"$/g, '').toLowerCase().trim();
      if (name && name.length > 3) ukNames.add(name);
    }
    console.log(`[sanctions] UK list loaded — ${ukNames.size} names`);
  } catch (e) {
    // Retry once on abort/timeout (common during startup or net hiccups)
    if (e.code === 'ECONNABORTED' || /aborted|timeout/i.test(e.message || '')) {
      try {
        await new Promise(r => setTimeout(r, 1500));
        const res2 = await axios.get(UK_SANCTIONS_URL, { timeout: 45000, responseType: 'text' });
        const lines = res2.data.split('\n').slice(1);
        ukNames = new Set();
        for (const line of lines) {
          const name = (line.split(',')[0] || '').replace(/^"|"$/g, '').toLowerCase().trim();
          if (name && name.length > 3) ukNames.add(name);
        }
        console.log(`[sanctions] UK list loaded (retry) — ${ukNames.size} names`);
        return;
      } catch (e2) {}
    }
    console.warn('[sanctions] UK list refresh failed (using empty):', e.message);
  }
}

// Note: the initial UK load is kicked off by the unified block near the bottom
// of this module (alongside OFAC + EU). A standalone kickoff here would fetch the
// list twice on startup (duplicate "[sanctions] UK list loaded" logs).

function isUkSanctioned(addressOrName) {
  if (!addressOrName) return { sanctioned: false };
  const q = String(addressOrName).toLowerCase();
  for (const name of ukNames) {
    if (q.includes(name) || name.includes(q)) return { sanctioned: true, name, list: 'UK-FCDO' };
  }
  return { sanctioned: false };
}

function getAdditionalSanctionsStats() {
  return { ukCount: ukNames.size, euCount: euNames.size };
}

// ── EU Sanctions (name-based) - Automatic via OpenSanctions (recommended) ─────
// Primary automatic source: OpenSanctions eu_fsf (daily updated, sources the same
// official EU Consolidated list that powers https://data.europa.eu/apps/eusanctionstracker/)
// Fallback: Local file at data/eu_consolidated.csv (or .xml)

const EU_LOCAL_CSV_PATH = path.join(__dirname, '../../data/eu_consolidated.csv');
const EU_LOCAL_XML_PATH = path.join(__dirname, '../../data/eu_consolidated.xml');

// OpenSanctions provides clean, automatically refreshed data for the EU list
const EU_OPENSANCTIONS_CSV = 'https://data.opensanctions.org/datasets/latest/eu_fsf/targets.simple.csv';
const EU_OPENSANCTIONS_NAMES = 'https://data.opensanctions.org/datasets/latest/eu_fsf/names.txt';

let euNames = new Set();

function addEuName(rawName) {
  if (!rawName) return;
  const cleaned = String(rawName).replace(/^"|"$/g, '').trim().toLowerCase();
  if (cleaned.length > 3 && /[a-z]/.test(cleaned)) {
    euNames.add(cleaned);
  }
}

function parseEuSimpleCsv(csvText) {
  euNames = new Set();
  const lines = csvText.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // targets.simple.csv from OpenSanctions has "name" as a main column
    const parts = line.split(',');
    // Usually first column or a "name" column contains the primary name
    for (const p of parts.slice(0, 4)) {
      addEuName(p);
    }
  }
}

async function refreshEuFromOpenSanctions() {
  // Try the clean names.txt first (lightweight)
  try {
    const namesRes = await axios.get(EU_OPENSANCTIONS_NAMES, { timeout: 45000, responseType: 'text' });
    if (namesRes.status === 200 && namesRes.data) {
      euNames = new Set();
      namesRes.data.split('\n').forEach(line => addEuName(line));
      console.log(`[sanctions] EU list loaded via OpenSanctions (names.txt) — ${euNames.size} names`);
      return true;
    }
  } catch (e) { /* fall through */ }

  // Fallback to targets.simple.csv
  try {
    const csvRes = await axios.get(EU_OPENSANCTIONS_CSV, { timeout: 45000, responseType: 'text' });
    if (csvRes.status === 200 && csvRes.data && csvRes.data.length > 5000) {
      parseEuSimpleCsv(csvRes.data);
      console.log(`[sanctions] EU list loaded via OpenSanctions (targets.simple.csv) — ${euNames.size} names`);
      return true;
    }
  } catch (e) {
    console.warn('[sanctions] OpenSanctions EU fetch failed:', e.message);
  }
  return false;
}

function loadEuFromLocalFile() {
  try {
    if (fs.existsSync(EU_LOCAL_CSV_PATH)) {
      const csv = fs.readFileSync(EU_LOCAL_CSV_PATH, 'utf8');
      parseEuSimpleCsv(csv); // tolerant enough
      console.log(`[sanctions] EU list loaded from local CSV — ${euNames.size} names`);
      return true;
    }
    if (fs.existsSync(EU_LOCAL_XML_PATH)) {
      const xml = fs.readFileSync(EU_LOCAL_XML_PATH, 'utf8');
      const matches = xml.match(/<name[^>]*>([^<]+)<\/name>|<wholeName[^>]*>([^<]+)<\/wholeName>/gi) || [];
      euNames = new Set();
      matches.forEach(m => addEuName(m.replace(/<[^>]+>/g, '')));
      console.log(`[sanctions] EU list loaded from local XML — ${euNames.size} names`);
      return true;
    }
  } catch (e) {
    console.warn('[sanctions] Failed loading local EU file:', e.message);
  }
  return false;
}

async function refreshEu() {
  // Prefer OpenSanctions for fully automatic daily updates (best for "that list")
  const loaded = await refreshEuFromOpenSanctions();
  if (loaded) return;

  // Fallback to local file the user can drop
  const local = loadEuFromLocalFile();
  if (!local) {
    console.warn('[sanctions] EU list not loaded automatically. OpenSanctions fetch failed and no local data/eu_consolidated.csv found.');
    console.warn('         The EU Sanctions Tracker UI you linked sources the same official data that OpenSanctions mirrors.');
  }
}

// Note: the initial EU load is kicked off by the unified block near the bottom
// of this module (alongside OFAC + UK) — no standalone kickoff here (would fetch twice).

function isEuSanctioned(query) {
  if (!query) return { sanctioned: false };
  const q = String(query).toLowerCase().trim();
  for (const name of euNames) {
    if (q.includes(name) || name.includes(q)) {
      return { sanctioned: true, name, list: 'EU' };
    }
  }
  return { sanctioned: false };
}

/** Combined sanctions check (OFAC crypto + UK/EU name matching) */
function isSanctioned(addressOrName) {
  const ofac = isOfacSanctioned(addressOrName);
  if (ofac.sanctioned) return { ...ofac, list: 'OFAC' };

  const uk = isUkSanctioned(addressOrName);
  if (uk.sanctioned) return uk;

  const eu = isEuSanctioned(addressOrName);
  if (eu.sanctioned) return eu;

  return { sanctioned: false };
}

// ── Unified Automatic Refresh for ALL sanctions lists ─────────────────────────
const SANCTIONS_REFRESH_MS = 12 * 60 * 60 * 1000; // every 12 hours

async function refreshAllSanctions() {
  console.log('[sanctions] Starting automatic refresh of all lists...');
  await Promise.allSettled([
    refresh().catch(e => console.warn('[sanctions] OFAC refresh error:', e.message)),
    refreshUk().catch(e => console.warn('[sanctions] UK refresh error:', e.message)),
    refreshEu().catch(e => console.warn('[sanctions] EU refresh error:', e.message)),
  ]);
  console.log('[sanctions] Automatic refresh complete. Stats:', getAdditionalSanctionsStats());
}

// Kick off all lists automatically on module load
Promise.allSettled([
  refresh().catch(() => {}),
  refreshUk().catch(() => {}),
  refreshEu().catch(() => {}),
]).then(() => {
  console.log('[sanctions] Initial load complete for OFAC + UK + EU lists');
});

// Periodic automatic refresh for everything
setInterval(refreshAllSanctions, SANCTIONS_REFRESH_MS);

function getAllSanctionsStats() {
  return {
    ofac: getOfacStats(),
    uk: { count: ukNames.size },
    eu: { count: euNames.size },
    lastRefreshAttempt: new Date().toISOString(),
  };
}

module.exports = {
  isOfacSanctioned,
  getOfacStats,
  isUkSanctioned,
  isEuSanctioned,
  isSanctioned,
  getAdditionalSanctionsStats,
  getAllSanctionsStats,
  refreshAllSanctions, // can be called manually if needed (e.g. from an admin route)
  refreshEu,
};
