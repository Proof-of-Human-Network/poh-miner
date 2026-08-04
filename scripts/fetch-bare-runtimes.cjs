#!/usr/bin/env node
/**
 * fetch-bare-runtimes.js — ensure platform-specific `bare-runtime-*` packages
 * exist in node_modules before an Electron cross-build.
 *
 * The QVAC SDK spawns its inference worker with the `bare` runtime, which is
 * shipped as per-platform npm packages (bare-runtime-win32-x64, …) declared as
 * optionalDependencies of `bare-runtime`. Package managers only install the
 * package matching the build machine's platform, so an installer built on
 * Linux would ship without the Windows/mac runtime and QVAC would fail with
 * "RPC initialization timed out — the worker process may have failed to start".
 *
 * Usage:  node scripts/fetch-bare-runtimes.js win32-x64 [linux-arm64 …]
 * The version is pinned to the installed `bare-runtime` package's own version.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/fetch-bare-runtimes.js <platform-arch> [...]  e.g. win32-x64 linux-arm64 darwin-arm64');
  process.exit(1);
}

const runtimeMeta = JSON.parse(fs.readFileSync(path.join(NM, 'bare-runtime', 'package.json'), 'utf8'));
const version = runtimeMeta.version;

// npm registry tarballs ship files as 0644; `npm install` normally restores the
// exec bit on `bin` entries, but we extract manually, so do it here. Without
// this the packaged app fails with `spawn …/bin/bare EACCES` (and AppImage
// mounts are read-only, so it can't be repaired at runtime).
function fixBinPermissions(dest, pkg) {
  const destMeta = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'));
  const binEntries = typeof destMeta.bin === 'string' ? [destMeta.bin] : Object.values(destMeta.bin || {});
  const binDir = path.join(dest, 'bin');
  if (fs.existsSync(binDir)) {
    for (const f of fs.readdirSync(binDir)) binEntries.push(path.join('bin', f));
  }
  for (const rel of new Set(binEntries)) {
    const file = path.join(dest, rel);
    if (fs.existsSync(file) && fs.statSync(file).isFile() && !(fs.statSync(file).mode & 0o111)) {
      fs.chmodSync(file, 0o755);
      console.log(`[bare-runtimes] chmod 755 ${pkg}/${rel}`);
    }
  }
}

for (const target of targets) {
  const pkg = `bare-runtime-${target}`;
  if (!runtimeMeta.optionalDependencies?.[pkg]) {
    console.error(`[bare-runtimes] Unknown target "${target}" — not in bare-runtime optionalDependencies`);
    process.exit(1);
  }
  const dest = path.join(NM, pkg);
  if (fs.existsSync(path.join(dest, 'package.json'))) {
    const have = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).version;
    if (have === version) {
      console.log(`[bare-runtimes] ${pkg}@${version} already present`);
      fixBinPermissions(dest, pkg); // repair 0644 bins left by earlier fetches
      continue;
    }
  }

  // `npm pack` ignores the package's os/cpu constraints, unlike `npm install`.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-rt-'));
  console.log(`[bare-runtimes] Fetching ${pkg}@${version}…`);
  execSync(`npm pack ${pkg}@${version} --pack-destination "${tmp}"`, { stdio: ['ignore', 'ignore', 'inherit'] });
  const tarball = fs.readdirSync(tmp).find(f => f.endsWith('.tgz'));
  if (!tarball) {
    console.error(`[bare-runtimes] npm pack produced no tarball for ${pkg}`);
    process.exit(1);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  execSync(`tar -xzf "${path.join(tmp, tarball)}" -C "${dest}" --strip-components=1`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fixBinPermissions(dest, pkg);
  console.log(`[bare-runtimes] Installed ${pkg}@${version} → node_modules/${pkg}`);
}
