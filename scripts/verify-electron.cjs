#!/usr/bin/env node
'use strict';

/**
 * Post-install guard for the Electron binary.
 *
 * `electron`'s own install step (@electron/get) downloads the ~100 MB binary in
 * a single request with no resume. On a slow or unstable connection it can drop
 * silently — `npm install` still reports success, but `node_modules/electron`
 * has no actual binary, so `npm start` later dies with the cryptic
 * "Electron failed to install correctly".
 *
 * This script runs after install, detects that situation early, and prints
 * clear, copy-pasteable recovery steps. It never throws and always exits 0 so
 * it can't break an otherwise-fine install.
 */

try {
  const fs = require('fs');
  const path = require('path');

  // Skip when Electron isn't installed here (e.g. production install — it's a
  // devDependency) or the binary download was intentionally skipped.
  let electronDir;
  try {
    electronDir = path.dirname(require.resolve('electron/package.json'));
  } catch {
    process.exit(0); // electron not present — nothing to verify
  }
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === '1' ||
      process.env.npm_config_electron_skip_binary_download === '1') {
    process.exit(0);
  }

  const pathTxt = path.join(electronDir, 'path.txt');
  let binaryOk = false;
  if (fs.existsSync(pathTxt)) {
    const exe = fs.readFileSync(pathTxt, 'utf8').trim();
    binaryOk = exe && fs.existsSync(path.join(electronDir, 'dist', exe));
  }

  if (binaryOk) process.exit(0);

  const mirror = 'https://npmmirror.com/mirrors/electron/';
  console.warn(`
┌─────────────────────────────────────────────────────────────────────────┐
│  ⚠  Electron binary is missing — the download was interrupted.            │
│  npm install finished, but \`npm start\` will fail until this is fixed.     │
└─────────────────────────────────────────────────────────────────────────┘

This is almost always a slow/unstable connection dropping the ~100 MB download.
Re-run ONE of the following, then \`npm start\`:

  # 1) Re-run the official downloader (it does not resume — may need a few tries)
  node node_modules/electron/install.js

  # 2) Use a faster mirror if the official host is slow/blocked
  #    macOS/Linux:
  ELECTRON_MIRROR=${mirror} node node_modules/electron/install.js
  #    Windows (PowerShell):
  $env:ELECTRON_MIRROR='${mirror}'; node node_modules/electron/install.js
`);
} catch {
  // Never let the guard itself break the install.
}
process.exit(0);
