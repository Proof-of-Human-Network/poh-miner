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
  console.log(`[bare-runtimes] Installed ${pkg}@${version} → node_modules/${pkg}`);
}
