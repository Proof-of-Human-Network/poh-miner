'use strict';

const fs   = require('fs');
const path = require('path');

const _pohHome     = path.join(process.env.HOME || process.env.USERPROFILE || '', '.poh-miner');
const _brainDir    = process.env.BRAIN_DATA_DIR || path.join(_pohHome, 'brain');
const HEALTH_PATH  = path.join(_brainDir, 'method_health.json');
const METHODS_PATH = path.join(_pohHome, 'methods.json');
const DELIST_DAYS   = 30;
const DELIST_MS     = DELIST_DAYS * 24 * 60 * 60 * 1000;

function getHealth() {
  if (!fs.existsSync(HEALTH_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf-8')); }
  catch { return {}; }
}

function saveHealth(h) {
  const tmp = HEALTH_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(h, null, 2));
  fs.renameSync(tmp, HEALTH_PATH);
}

/**
 * Call after each method execution.
 * failed=true → start/extend countdown. failed=false → clear record.
 */
function recordMethodResult(methodId, failed) {
  const h = getHealth();
  if (!failed) {
    if (h[methodId]) { delete h[methodId]; saveHealth(h); }
    return;
  }
  if (!h[methodId]) {
    h[methodId] = { firstFailedAt: new Date().toISOString(), lastFailedAt: new Date().toISOString(), failCount: 1 };
  } else {
    h[methodId].lastFailedAt = new Date().toISOString();
    h[methodId].failCount = (h[methodId].failCount || 0) + 1;
  }
  saveHealth(h);
}

/**
 * Run daily — delist methods that have been unresponsive for 30+ days.
 */
function delistStaleMethod() {
  const h = getHealth();
  if (!fs.existsSync(METHODS_PATH)) return;
  const methods = JSON.parse(fs.readFileSync(METHODS_PATH, 'utf-8'));
  const now     = Date.now();
  let changed   = false;

  for (const [id, record] of Object.entries(h)) {
    if (now - new Date(record.firstFailedAt).getTime() >= DELIST_MS) {
      const idx = methods.findIndex(m => m.id === id);
      if (idx !== -1) {
        console.log(`[health] Delisting "${methods[idx].description.slice(0,50)}" — no response for ${DELIST_DAYS} days`);
        methods.splice(idx, 1);
        changed = true;
      }
      delete h[id];
    }
  }

  if (changed) {
    const tmp = METHODS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(methods, null, 2));
    fs.renameSync(tmp, METHODS_PATH);
  }
  saveHealth(h);
}

module.exports = { recordMethodResult, delistStaleMethod, getHealth };
