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

  console.log('[afterPack] Ad-hoc signing .app bundle (--deep):', appPath);

  // Ad-hoc sign the WHOLE bundle with --deep. codesign then signs every piece
  // of nested code — frameworks (and their internal dylibs), helper .apps, loose
  // Mach-O libraries, and the main executable — in the correct inside-out order.
  //
  // The previous approach signed each Mach-O individually. That corrupts a
  // framework's seal: signing "Electron Framework.framework/…/Electron Framework"
  // as a bare file (rather than the framework bundle) leaves the bundle invalid,
  // so the final whole-app sign aborted with "code object is not signed at all".
  //
  // --deep has entitlement/identifier caveats that make Apple discourage it for
  // cert-based *distribution* signing, but none of those apply to an ad-hoc
  // signature with no entitlements. We only need a valid ad-hoc signature to
  // satisfy the arm64 code-execution requirement (avoid the "malware" block).
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    console.log('[afterPack] ✓ Ad-hoc signed bundle (--deep)');
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    console.error(`[afterPack] ERROR signing .app bundle: ${stderr}`);
    throw new Error(`Ad-hoc signing failed: ${stderr}`);
  }

  // Verify the final result (deep + strict so an unsigned nested binary fails).
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    console.log('[afterPack] ✓ Signature verified');
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    console.warn(`[afterPack] Verification warning: ${stderr}`);
  }
};
