#!/usr/bin/env node
/**
 * Create the genesis treasury wallet — locally, and only locally.
 *
 * Generates a fresh keypair on this machine, installs it into the node's
 * keystore so the node can sign with it, and writes a plain export you can type
 * into the DAI Wallet app. Nothing here is published: the private key is written
 * only under ~/.dai-miner (outside every repo) and is never committed. Only the
 * ADDRESS goes into the genesis snapshot, which is unavoidable -- an allocation
 * has to name who it credits.
 *
 * The key is derived exactly the way the mobile wallet derives it, so the same
 * privateKeyHex imported there produces the same address:
 *
 *   seed    = sha256(privateKeyHex + ':dai-ed25519-signing-v1')
 *   keypair = ed25519 from that seed
 *   address = 'dai' + sha256(base64(publicKey)).slice(0, 40)
 *
 * Unlike the wallets already in the keystore, this one is sealed with the key
 * this node currently holds, so it will actually open.
 *
 *   node scripts/genesis/make-genesis-wallet.mjs            # create
 *   node scripts/genesis/make-genesis-wallet.mjs --show     # also print the key
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { sealWalletData, unsealWalletData } from '../../src/security/wallet-crypto.js';

const nacl = createRequire(import.meta.url)('../vendor/nacl-fast.cjs');
const SHOW = process.argv.includes('--show');

/** Ed25519 PKCS8 is a fixed 16-byte prefix followed by the raw 32-byte seed. */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const pkcs8FromSeed = seed => Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]);

/** The mobile wallet's derivation, reproduced byte for byte. */
export function deriveFromPrivateKeyHex(privateKeyHex) {
  const seedHex = crypto.createHash('sha256')
    .update(privateKeyHex + ':dai-ed25519-signing-v1').digest('hex');
  const seed = Uint8Array.from(Buffer.from(seedHex, 'hex'));
  const kp = nacl.sign.keyPair.fromSeed(seed);
  const signingPublicKey = Buffer.from(kp.publicKey).toString('base64');
  const address = 'dai' + crypto.createHash('sha256').update(signingPublicKey).digest('hex').slice(0, 40);
  const signingPrivateKey = crypto.createPrivateKey({ key: pkcs8FromSeed(seed), format: 'der', type: 'pkcs8' })
    .export({ type: 'pkcs8', format: 'pem' });
  return { privateKeyHex, seedHex, signingPublicKey, signingPrivateKey, address };
}

// Creating a wallet is what this file DOES when run, but deriveFromPrivateKeyHex
// above is also the one correct implementation of the mobile wallet's key
// derivation — import-wallet-key.mjs reuses it. Guard the side effects so
// importing the derivation does not mint and write a brand-new wallet.
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const privateKeyHex = crypto.randomBytes(32).toString('hex');
  const w = deriveFromPrivateKeyHex(privateKeyHex);

  // Prove the node can sign with it before writing anything.
  const probe = crypto.sign(null, Buffer.from('genesis-wallet-selfcheck'), crypto.createPrivateKey(w.signingPrivateKey));
  const pubDer = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(w.signingPublicKey, 'base64')]),
    format: 'der', type: 'spki',
  });
  if (!crypto.verify(null, Buffer.from('genesis-wallet-selfcheck'), pubDer, probe)) {
    throw new Error('self-check failed: the derived keypair does not verify its own signature');
  }

  const walletsDir = path.join(os.homedir(), '.dai-miner', 'wallets');
  fs.mkdirSync(walletsDir, { recursive: true });
  const walletFile = path.join(walletsDir, `${w.address}.json`);
  if (fs.existsSync(walletFile)) throw new Error(`refusing to overwrite existing wallet ${walletFile}`);

  const sealed = sealWalletData({
    address: w.address,
    privateKey: privateKeyHex,
    publicKey: crypto.createHash('sha256').update(privateKeyHex).digest('hex').slice(0, 64),
    signingPublicKey: w.signingPublicKey,
    signingPrivateKey: w.signingPrivateKey,
    createdAt: Date.now(),
    balance: 0,
    nonce: 0,
    assets: {},
  });
  fs.writeFileSync(walletFile, JSON.stringify(sealed, null, 2), { mode: 0o600 });

  // Confirm this node can reopen what it just sealed — the failure the existing
  // 554 wallets hit, caught here rather than at signing time.
  const reopened = unsealWalletData(JSON.parse(fs.readFileSync(walletFile, 'utf8')));
  if (!reopened.signingPrivateKey) {
    throw new Error('sealed the wallet but cannot reopen it — check ~/.dai-miner/.wallet-key');
  }

  // Export lives outside every repo so it cannot be committed by accident.
  const exportFile = path.join(os.homedir(), '.dai-miner', `genesis-wallet-${w.address.slice(0, 12)}.json`);
  fs.writeFileSync(exportFile, JSON.stringify({
    address: w.address,
    privateKey: privateKeyHex,
    signingPublicKey: w.signingPublicKey,
    createdAt: new Date().toISOString(),
    note: 'Import privateKey into the DAI Wallet app (Import wallet). It derives this same address.',
  }, null, 2), { mode: 0o600 });

  console.log(`address        ${w.address}`);
  console.log(`keystore       ${walletFile}`);
  console.log(`export (0600)  ${exportFile}`);
  console.log(`node can sign  yes (sealed and reopened)`);
  console.log(SHOW ? `\nprivate key    ${privateKeyHex}\n` : `\nRun again with --show to print the private key, or read the export file.\n`);
  console.log('Put this address in the genesis allocation. Keep the private key off every repo.');
}
