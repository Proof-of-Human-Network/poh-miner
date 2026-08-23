#!/usr/bin/env node
/**
 * patch-qvac-electron.cjs — patch node_modules so QVAC's bare worker can start
 * inside a packaged Electron app instead of crashing the main process.
 *
 * Two upstream defects (as of bare-runtime 1.x / @qvac/sdk 0.16):
 *
 * 1. `bare-runtime/lib/spawn.js` resolves the bare binary relative to the
 *    platform package's __filename. In a packaged app that is the VIRTUAL
 *    `app.asar` path. Electron's fs shim redirects *reads* to the
 *    `app.asar.unpacked` copy (which asarUnpack ships), so the pre-flight
 *    `fs.accessSync` passes — but `child_process.spawn` is not asar-aware,
 *    so the spawn always fails with an async ENOENT:
 *      "Error: spawn …\app.asar\node_modules\…\bare.exe ENOENT"
 *    Fix: rewrite `app.asar` → `app.asar.unpacked` in the binary path
 *    before spawning.
 *
 * 2. `@qvac/sdk` never attaches an "error" listener to the spawned worker
 *    process. `spawn` reports ENOENT asynchronously via that event; with no
 *    listener Node re-throws it as an uncaught exception, which in Electron
 *    is the fatal "A JavaScript error occurred in the main process" dialog.
 *    Fix: add an "error" handler that rejects the init promise like the
 *    existing "close" handler does.
 *
 * Idempotent. Run with --strict (the build:electron:* scripts do) to fail the
 * build when an anchor can't be found — e.g. after an SDK upgrade changed the
 * file — so we never ship an installer that crashes on start. Without
 * --strict (postinstall) missing anchors only warn.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NM = path.join(__dirname, '..', 'node_modules');
const strict = process.argv.includes('--strict');

let failed = false;

function fail(msg) {
  failed = true;
  const tag = strict ? 'ERROR' : 'warning';
  console[strict ? 'error' : 'warn'](`[patch-qvac-electron] ${tag}: ${msg}`);
}

function patchFile(relPath, { applied, anchor, replacement }) {
  const file = path.join(NM, relPath);
  if (!fs.existsSync(file)) {
    fail(`${relPath} not found — is the package installed?`);
    return;
  }
  const src = fs.readFileSync(file, 'utf8');
  if (applied(src)) {
    console.log(`[patch-qvac-electron] ${relPath} already patched`);
    return;
  }
  if (!src.includes(anchor)) {
    fail(`anchor not found in ${relPath} — upstream changed, re-check the patch`);
    return;
  }
  fs.writeFileSync(file, src.replace(anchor, replacement));
  console.log(`[patch-qvac-electron] patched ${relPath}`);
}

// 1. bare-runtime: spawn the real unpacked binary, not the app.asar virtual path.
patchFile('bare-runtime/lib/spawn.js', {
  applied: (src) => src.includes('app.asar.unpacked'),
  anchor: '  const bin = runtime(referrer, opts)',
  replacement:
    '  // DAI patch: Electron cannot spawn a binary at an app.asar virtual path\n' +
    "  // (only execFile is asar-aware); asarUnpack ships the real file under\n" +
    '  // app.asar.unpacked, so point the spawn there.\n' +
    "  const bin = runtime(referrer, opts).replace(/\\bapp\\.asar(?=[\\\\/])/, 'app.asar.unpacked')",
});

// 2. @qvac/sdk: reject on spawn "error" instead of crashing the host process.
patchFile('@qvac/sdk/dist/client/rpc/node-rpc-client.js', {
  applied: (src) => src.includes('bareWorkerProc.on("error"'),
  anchor: '            if (bareWorkerProc) {\n',
  replacement:
    '            if (bareWorkerProc) {\n' +
    '                // DAI patch: a failed spawn (e.g. ENOENT) is reported via the\n' +
    '                // async "error" event; without a listener it becomes an\n' +
    '                // uncaught exception that kills the Electron main process.\n' +
    '                bareWorkerProc.on("error", (error) => {\n' +
    '                    if (settled)\n' +
    '                        return;\n' +
    '                    settled = true;\n' +
    '                    clearTimeout(timer);\n' +
    '                    teardownFailedInit();\n' +
    '                    reject(mapBareSpawnError(error));\n' +
    '                });\n',
});

if (failed && strict) {
  console.error('[patch-qvac-electron] aborting build: shipping unpatched would crash packaged apps on QVAC start');
  process.exit(1);
}
