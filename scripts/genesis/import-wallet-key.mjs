#!/usr/bin/env node
/**
 * Import an existing wallet private key into this node's keystore.
 *
 * The companion to make-genesis-wallet.mjs: that one MINTS a new key, this one
 * adopts a key that already exists somewhere else -- typically one generated in
 * the DAI Wallet app, whose node-side record here holds only a public key
 * because the app registered it via /api/wallet/register-key. Such a record
 * cannot sign: scripts/pair-signer.js reports
 *   "<address> has no private key on this node (externally registered key)"
 * and anything that signs as that address (place-discount-offers.mjs, the OTC
 * tooling) stops there.
 *
 * The key is read from a file or the environment, never from argv -- argv is
 * visible to every process on the box via `ps`, and shell history keeps it.
 * It is never printed, not even with an error.
 *
 *   DAI_IMPORT_KEY_HEX=<64 hex chars> \
 *     node scripts/genesis/import-wallet-key.mjs --expect dai977927…
 *
 *   node scripts/genesis/import-wallet-key.mjs --expect dai977927… \
 *     --key-file ~/treasury-key.txt
 *
 * --expect is mandatory and checked: the key is derived first, and if it does
 * not produce exactly that address nothing is written. Importing the wrong key
 * under the right filename would create a wallet that signs with an identity
 * the chain does not credit, which fails later and confusingly.
 *
 * A record that already carries a private key is never overwritten. Replacing a
 * public-key-only stub is the whole point, but it still needs --replace-stub so
 * it cannot happen by accident.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveFromPrivateKeyHex } from './make-genesis-wallet.mjs';
import { sealWalletData, unsealWalletData } from '../../src/security/wallet-crypto.js';

const arg = (k, d = null) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const has = k => process.argv.includes(k);

const expect = arg('--expect');
const keyFile = arg('--key-file');
const replaceStub = has('--replace-stub');

if (!expect) {
  console.error('--expect <daiAddress> is required (the address this key must derive).');
  process.exit(2);
}

// argv is deliberately not an option here -- see the header.
let hex = process.env.DAI_IMPORT_KEY_HEX || null;
if (keyFile) {
  const p = keyFile.replace(/^~/, os.homedir());
  if (!fs.existsSync(p)) { console.error(`key file not found: ${p}`); process.exit(2); }
  hex = fs.readFileSync(p, 'utf8');
}
if (!hex) {
  console.error('no key supplied — set DAI_IMPORT_KEY_HEX or pass --key-file <path>.');
  process.exit(2);
}

hex = hex.trim();
// A wallet-app export is JSON; accept it directly rather than making the
// operator fish the field out by hand and risk pasting the wrong one.
if (hex.startsWith('{')) {
  try {
    const j = JSON.parse(hex);
    hex = String(j.privateKey || j.privateKeyHex || '').trim();
  } catch {
    console.error('key file looks like JSON but does not parse.');
    process.exit(2);
  }
}
if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
  // Length only — never the value.
  console.error(`expected 64 hex characters, got ${hex.length} character(s) that are not valid hex.`);
  process.exit(2);
}

const w = deriveFromPrivateKeyHex(hex.toLowerCase());
if (w.address !== expect) {
  console.error('the supplied key does not derive the expected address — nothing written.');
  console.error(`  expected  ${expect}`);
  console.error(`  derived   ${w.address}`);
  process.exit(3);
}

const walletsDir = path.join(os.homedir(), '.dai-miner', 'wallets');
fs.mkdirSync(walletsDir, { recursive: true });
const walletFile = path.join(walletsDir, `${w.address}.json`);

let existing = null;
if (fs.existsSync(walletFile)) {
  try { existing = unsealWalletData(JSON.parse(fs.readFileSync(walletFile, 'utf8'))); } catch { existing = {}; }
  if (existing?.signingPrivateKey) {
    console.error(`${w.address} already has a private key in the keystore — refusing to overwrite.`);
    process.exit(4);
  }
  if (!replaceStub) {
    console.error(`${w.address} exists as a public-key-only stub (externally registered).`);
    console.error('Re-run with --replace-stub to turn it into a signing wallet.');
    process.exit(4);
  }
  fs.copyFileSync(walletFile, `${walletFile}.stub-backup`);
}

const sealed = sealWalletData({
  address: w.address,
  privateKey: hex.toLowerCase(),
  publicKey: existing?.publicKey ?? null,
  signingPublicKey: w.signingPublicKey,
  signingPrivateKey: w.signingPrivateKey,
  encryptionPublicKey: existing?.encryptionPublicKey ?? null,
  createdAt: existing?.createdAt ?? Date.now(),
  // Balances are replayed from the chain on rebuild; carry whatever the stub
  // had so nothing reads as a zeroed wallet in the meantime.
  balance: existing?.balance ?? 0,
  nonce: existing?.nonce ?? 0,
  assets: existing?.assets ?? {},
});
fs.writeFileSync(walletFile, JSON.stringify(sealed, null, 2), { mode: 0o600 });

// Same self-check make-genesis-wallet.mjs does: sealing with a .wallet-key that
// cannot reopen it is the failure mode that left stubs unusable in the first
// place, and it should surface here rather than at signing time.
const reopened = unsealWalletData(JSON.parse(fs.readFileSync(walletFile, 'utf8')));
if (!reopened.signingPrivateKey) {
  console.error('sealed the wallet but could not reopen it — check ~/.dai-miner/.wallet-key');
  process.exit(5);
}

console.log(`address        ${w.address}`);
console.log(`keystore       ${walletFile}`);
if (existing) console.log(`stub backup    ${walletFile}.stub-backup`);
console.log('node can sign  yes (sealed and reopened)');
console.log('\nThe key was not printed and is not in your shell history if you used --key-file.');
