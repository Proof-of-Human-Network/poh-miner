#!/usr/bin/env node
'use strict';

/**
 * electron-builder afterPack hook — recursively ad-hoc signs every Mach-O
 * binary inside the packaged .app bundle.
 *
 * Why this is needed:
 * electron-builder 24.x + @electron/osx-sign 1.0.x does NOT support
 * `mac.identity: "-"` for ad-hoc signing (it interprets "-" as a keychain
 * cert name filter, finds nothing, and skips signing). On macOS ARM64, an
 * unsigned .app with embedded native binaries is rejected by Gatekeeper with
 * the hard "malware" dialog (non-bypassable).
 *
 * This hook signs inside-out: all nested Mach-O binaries first, then the .app
 * wrapper. This gives the app a valid ad-hoc signature that satisfies the ARM64
 * kernel requirement. Users still see the "unidentified developer" dialog
 * (bypassable with right-click → Open or `xattr -cr`), but NOT the
 * non-bypassable "malware" block.
 *
 * Configured in package.json: build.afterPack = "scripts/afterPack.cjs"
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function afterPack(context) {
  // Only sign when the TARGET platform is macOS (regardless of build machine)
  if (context.electronPlatformName !== 'darwin') {
    return;
  }
  // codesign is only available on macOS build machines
  if (process.platform !== 'darwin') {
    console.warn('[afterPack] Cannot ad-hoc sign: codesign unavailable (not on macOS). The resulting .app will be unsigned.');
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn('[afterPack] .app bundle not found, skipping ad-hoc signing');
    return;
  }

  console.log('[afterPack] Ad-hoc signing .app bundle:', appPath);

  // Collect all Mach-O files inside the bundle (sign inside-out)
  const machoFiles = [];
  const contentsDir = path.join(appPath, 'Contents');

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip .app bundles inside (they get signed as a unit)
        if (entry.name.endsWith('.app')) continue;
        walk(full);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (isMachO(full)) {
          machoFiles.push(full);
        }
      }
    }
  }

  function isMachO(filePath) {
    try {
      const realPath = fs.realpathSync(filePath);
      if (!fs.statSync(realPath).isFile()) return false;
      const fd = fs.openSync(realPath, 'r');
      const buf = Buffer.alloc(4);
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      // Mach-O magic numbers (little-endian and big-endian, 32 and 64 bit, fat/universal)
      const magic = buf.readUInt32BE(0);
      return [
        0xfeedface, // MH_MAGIC (32-bit)
        0xfeedfacf, // MH_MAGIC_64 (64-bit)
        0xcefaedfe, // MH_CIGAM (32-bit, reversed)
        0xcffaedfe, // MH_CIGAM_64 (64-bit, reversed)
        0xcafebabe, // FAT_MAGIC (universal)
        0xbebafeca, // FAT_CIGAM (universal, reversed)
      ].includes(magic);
    } catch {
      return false;
    }
  }

  walk(contentsDir);

  // Sign all nested binaries first (inside-out is required for valid signatures)
  let signed = 0;
  for (const file of machoFiles) {
    try {
      execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', file], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      signed++;
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString().trim() : '';
      console.warn(`[afterPack] warning: ${path.relative(appPath, file)}: ${stderr}`);
    }
  }

  // Sign any nested .app helpers (Electron Helper, GPU Helper, etc.)
  const helpers = [];
  function findApps(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name.endsWith('.app') && full !== appPath) {
        helpers.push(full);
        findApps(full); // recurse into nested .apps
      } else if (entry.isDirectory()) {
        findApps(full);
      }
    }
  }
  findApps(contentsDir);

  // Sign helpers inside-out (deepest first)
  helpers.sort((a, b) => b.length - a.length);
  for (const helper of helpers) {
    try {
      execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', helper], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      signed++;
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString().trim() : '';
      console.warn(`[afterPack] warning: helper ${path.basename(helper)}: ${stderr}`);
    }
  }

  // Finally sign the outer .app bundle
  try {
    execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', appPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    signed++;
    console.log(`[afterPack] ✓ Ad-hoc signed ${signed} items (app + nested binaries)`);
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    console.error(`[afterPack] ERROR signing .app bundle: ${stderr}`);
    throw new Error(`Ad-hoc signing failed: ${stderr}`);
  }

  // Verify the final result
  try {
    execFileSync('codesign', ['--verify', '--verbose', appPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    console.log('[afterPack] ✓ Signature verified');
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    console.warn(`[afterPack] Verification warning: ${stderr}`);
  }
};
