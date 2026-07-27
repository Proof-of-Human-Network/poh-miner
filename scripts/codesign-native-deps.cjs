#!/usr/bin/env node
'use strict';

/**
 * Ad-hoc sign all native Mach-O binaries in node_modules for macOS ARM64.
 *
 * npm-downloaded native modules arrive with only a linker-generated ad-hoc
 * signature (flags=adhoc,linker-signed). On macOS ARM64, those binaries also
 * carry com.apple.provenance which makes Gatekeeper evaluate them. A
 * linker-signed binary fails that evaluation → "malware" block.
 *
 * Re-signing with `codesign --force --sign -` replaces the linker-signed
 * signature with a proper ad-hoc signature (flags=adhoc only), which satisfies
 * the ARM64 code-execution requirement and avoids the malware dialog in
 * development (npm run start).
 *
 * Runs as part of `postinstall`; safe no-op on non-macOS platforms.
 */

if (process.platform !== 'darwin') process.exit(0);

// Verify codesign is available (it always is on macOS, but guard against edge cases)
try {
  require('child_process').execFileSync('which', ['codesign'], { stdio: 'ignore' });
} catch {
  process.exit(0);
}

const { execSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');

if (!fs.existsSync(NM)) process.exit(0);

// Find all Mach-O binaries (executables + shared libraries) for darwin arm64/x64
// under node_modules. We look for: .node files, known binary locations, and the
// bare-runtime executable.
const targets = [];

// 1. All prebuilt .node shared libraries for darwin
try {
  const out = execSync(
    `find "${NM}" -name "*.node" -path "*darwin*" -type f 2>/dev/null`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  ).trim();
  if (out) targets.push(...out.split('\n'));
} catch {}

// 2. The bare-runtime executables
for (const arch of ['darwin-arm64', 'darwin-x64']) {
  const bare = path.join(NM, `bare-runtime-${arch}`, 'bin', 'bare');
  if (fs.existsSync(bare)) targets.push(bare);
}

// 3. Any other .node files that live directly in build/Release (e.g. bigint-buffer)
try {
  const out = execSync(
    `find "${NM}" -path "*/build/Release/*.node" -type f 2>/dev/null`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  ).trim();
  if (out) {
    for (const f of out.split('\n')) {
      if (!targets.includes(f)) targets.push(f);
    }
  }
} catch {}

// 4. Electron.app is handled separately below (signed as a bundle unit, not piecemeal)
const electronApp = path.join(NM, 'electron', 'dist', 'Electron.app');

if (targets.length === 0) {
  process.exit(0);
}

// Filter to only Mach-O files (skip ELF/PE that share the same directory tree)
const machoTargets = targets.filter(f => {
  try {
    const info = execFileSync('file', ['-b', f], { encoding: 'utf8' }).trim();
    return info.includes('Mach-O');
  } catch {
    return false;
  }
});

let signed = 0;
let failed = 0;

for (const target of machoTargets) {
  try {
    execFileSync('codesign', ['--force', '--sign', '-', target], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    signed++;
  } catch (e) {
    // Non-fatal: log but don't block install
    const stderr = e.stderr ? e.stderr.toString().trim() : e.message;
    console.warn(`[codesign] warning: failed to sign ${path.relative(ROOT, target)}: ${stderr}`);
    failed++;
  }
}

// Sign Electron.app as a complete bundle (--deep signs all nested code).
// This is the only safe way to re-sign Electron in development — individual
// binary signing breaks the framework sealed-resource chains.
if (fs.existsSync(electronApp)) {
  try {
    execFileSync('codesign', [
      '--force', '--deep', '--sign', '-', '--timestamp=none', electronApp
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    signed++;
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : e.message;
    console.warn(`[codesign] warning: Electron.app: ${stderr}`);
    failed++;
  }
}

if (signed > 0) {
  console.log(`[codesign] ✓ Ad-hoc signed ${signed} native binar${signed === 1 ? 'y' : 'ies'} for macOS`);
}
if (failed > 0) {
  console.warn(`[codesign] ⚠ ${failed} binar${failed === 1 ? 'y' : 'ies'} could not be signed (non-fatal)`);
}
