#!/usr/bin/env node
/**
 * Reference remote signer.
 *
 * Pairs with a browser session on aist.exchange and signs P2P actions after the
 * human approves them at this terminal. This is the desktop counterpart to the
 * mobile wallet's Pair screen, and the reference for what that screen must do.
 *
 *   node scripts/pair-signer.js 'aist://pair?v=1&relay=...&topic=...&k=...'
 *
 * The private key never leaves this process. Only signatures cross the relay,
 * and every request is shown in human terms before anything is signed.
 *
 * SECURITY: `--yes` auto-approves and exists only for automated tests. Never
 * use it against a session you did not create yourself.
 */
import crypto from 'node:crypto';
import readline from 'node:readline';
import { createRequire } from 'node:module';
// Vendored (public domain) so this script runs without adding a dependency, and
// so the browser, the phone and this signer all use the same nacl.box. It is a
// UMD bundle. This repo is "type": "module", so it carries a .cjs extension to
// be loaded as CommonJS rather than parsed as ESM.
const nacl = createRequire(import.meta.url)('./vendor/nacl-fast.cjs');

const ACTION_ALLOWLIST = new Set([
  'select-order', 'payment-sent', 'release', 'cancel', 'dispute',
  'create-order', 'cancel-order', 'apply-referral',
]);
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;   // must match the node's window

const b64 = {
  enc: (u8) => Buffer.from(u8).toString('base64'),
  dec: (s) => new Uint8Array(Buffer.from(s, 'base64')),
};

/* ── identity ────────────────────────────────────────────────────────────── */

/**
 * Load a wallet this node actually owns and turn it into a signing identity.
 *
 * Wallets are encrypted at rest (signingPrivateKeyEnc, sealed with
 * ~/.dai-miner/.wallet-key), so this unseals through the node's own crypto
 * rather than reading the file directly. An ed25519 PKCS8 key carries its
 * 32-byte seed as the tail of the DER, which is exactly what nacl wants.
 *
 * Note the node also stores a record for every address that has ever called
 * /api/wallet/register-key — those hold only a public key by design and cannot
 * sign here, which is reported rather than failing obscurely.
 */
export async function identityFromWallet(address) {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { unsealWalletData } = await import('../src/security/wallet-crypto.js');

  const file = path.join(os.homedir(), '.dai-miner', 'wallets', `${address}.json`);
  if (!fs.existsSync(file)) throw new Error(`no wallet file for ${address}`);
  const data = unsealWalletData(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!data.signingPrivateKey) {
    throw new Error(`${address} has no private key on this node (externally registered key)`);
  }
  const der = crypto.createPrivateKey(data.signingPrivateKey).export({ type: 'pkcs8', format: 'der' });
  const id = identityFromSeed(Buffer.from(der.subarray(-32)).toString('hex'));
  if (id.address !== address) {
    throw new Error(`derived ${id.address} from ${address} — refusing to sign with a mismatched key`);
  }
  return id;
}

/** An ed25519 identity whose dai address is derived from its own public key. */
export function identityFromSeed(seedHex) {
  const seed = seedHex
    ? Uint8Array.from(Buffer.from(seedHex, 'hex').subarray(0, 32))
    : new Uint8Array(crypto.randomBytes(32));
  const kp = nacl.sign.keyPair.fromSeed(seed);
  const signingPublicKey = b64.enc(kp.publicKey);
  const address = 'dai' + crypto.createHash('sha256').update(signingPublicKey).digest('hex').slice(0, 40);
  return { address, signingPublicKey, secretKey: kp.secretKey, seedHex: Buffer.from(seed).toString('hex') };
}

const signString = (str, secretKey) =>
  b64.enc(nacl.sign.detached(new TextEncoder().encode(str), secretKey));

/** Idempotent; also creates the wallet record so verifyP2PAuth can resolve it. */
export async function registerKey(nodeUrl, id) {
  const res = await fetch(`${nodeUrl}/api/wallet/register-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: id.address,
      signingPublicKey: id.signingPublicKey,
      proof: signString(id.address, id.secretKey),
    }),
  });
  return res.json();
}

/* ── session ─────────────────────────────────────────────────────────────── */

export function parseUri(uri) {
  const q = new URL(uri.replace(/^aist:\/\//, 'https://')).searchParams;
  const topic = q.get('topic');
  const k = q.get('k');
  const relay = q.get('relay');
  if (!/^[0-9a-f]{64}$/.test(topic || '')) throw new Error('bad topic');
  if (!relay || !k) throw new Error('bad pairing link');
  return { v: Number(q.get('v') || 1), relay: relay.replace(/\/$/, ''), topic, browserKey: b64.dec(k) };
}

export class SignerSession {
  constructor({ uri, identity, onRequest }) {
    this.s = parseUri(uri);
    this.id = identity;
    this.kp = nacl.box.keyPair();
    this.cursor = 0;
    this.onRequest = onRequest;
    this.revoked = false;
  }

  /* The sender's box public key travels in the clear on every frame — the peer
     cannot open the first message without it, and it cannot be hidden inside
     the body it is needed to open. See the same note in AIST's js/pairing.js. */
  _seal(obj) {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const box = nacl.box(new TextEncoder().encode(JSON.stringify(obj)), nonce,
      this.s.browserKey, this.kp.secretKey);
    return JSON.stringify({ k: b64.enc(this.kp.publicKey), n: b64.enc(nonce), b: b64.enc(box) });
  }

  _open(payload) {
    try {
      const { n, b } = JSON.parse(payload);
      const opened = nacl.box.open(b64.dec(b), b64.dec(n), this.s.browserKey, this.kp.secretKey);
      return opened ? JSON.parse(new TextDecoder().decode(opened)) : null;
    } catch { return null; }
  }

  async _publish(obj) {
    const res = await fetch(`${this.s.relay}/api/pair/${this.s.topic}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'signer', payload: this._seal(obj) }),
    });
    return res.json();
  }

  /** Announce which address this session will sign for. */
  async hello(label) {
    return this._publish({
      t: 'hello', k: b64.enc(this.kp.publicKey), address: this.id.address, label: label || 'desktop',
    });
  }

  /** Tell the browser the session is over, then stop serving it. */
  async revoke() {
    this.revoked = true;
    try { await this._publish({ t: 'revoked' }); } catch { /* best effort */ }
  }

  /**
   * Serve sign requests until revoked. Each one is passed to `onRequest`, which
   * must return true to approve. Nothing is signed without that.
   */
  async serve({ pollWaitMs = 20000 } = {}) {
    while (!this.revoked) {
      let body;
      try {
        const url = `${this.s.relay}/api/pair/${this.s.topic}`
          + `?since=${this.cursor}&wait=${pollWaitMs}&as=signer`;
        body = await (await fetch(url)).json();
      } catch { await new Promise((r) => setTimeout(r, 1000)); continue; }
      if (body.error) throw new Error(body.error);

      for (const m of body.messages || []) {
        this.cursor = Math.max(this.cursor, m.seq);
        const req = this._open(m.payload);
        if (!req || req.t !== 'sign') continue;
        await this._handle(req);
        if (this.revoked) return;
      }
    }
  }

  async _handle(req) {
    const { id, action, fields, human } = req;

    // Only ever sign shapes the node actually accepts.
    if (!ACTION_ALLOWLIST.has(action)) {
      return this._publish({ t: 'rejected', id, reason: 'unknown action' });
    }

    const approved = await this.onRequest({ action, fields, human, address: this.id.address });
    if (!approved) return this._publish({ t: 'rejected', id, reason: 'declined' });

    // The SIGNER stamps the time, so a stale page cannot get an old payload
    // signed, and the node's 5-minute window is measured from approval.
    const timestamp = Date.now();
    if (Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS) {
      return this._publish({ t: 'rejected', id, reason: 'clock skew' });
    }

    // Key order is the contract: address, timestamp, action, then the fields.
    const payload = JSON.stringify({ address: this.id.address, timestamp, action, ...fields });
    return this._publish({
      t: 'signed', id,
      address: this.id.address,
      signingPublicKey: this.id.signingPublicKey,
      signature: signString(payload, this.id.secretKey),
      timestamp,
    });
  }
}

/* ── cli ─────────────────────────────────────────────────────────────────── */

function describe({ action, fields, human, address }) {
  const lines = [];
  lines.push('');
  lines.push('  ┌─ approve this action? ' + '─'.repeat(38));
  if (human && human.title) lines.push('  │ ' + human.title);
  if (human && human.detail) lines.push('  │ ' + human.detail);
  if (human && human.warning) lines.push('  │ ! ' + human.warning);
  lines.push('  │');
  lines.push('  │ action  ' + action);
  for (const [k, v] of Object.entries(fields || {})) lines.push(`  │ ${k.padEnd(7)} ${v}`);
  lines.push('  │ signing ' + address);
  lines.push('  └' + '─'.repeat(60));
  return lines.join('\n');
}

async function main() {
  const uri = process.argv[2];
  const auto = process.argv.includes('--yes');
  const seed = (process.argv.find((a) => a.startsWith('--seed=')) || '').split('=')[1];
  const wallet = (process.argv.find((a) => a.startsWith('--wallet=')) || '').split('=')[1];
  if (!uri) {
    console.error('usage: pair-signer.js "aist://pair?..." [--wallet=daiADDR | --seed=hex] [--yes]');
    console.error('  --wallet  sign as a wallet this node owns (keeps your balance)');
    console.error('  --seed    sign as a specific throwaway identity');
    console.error('  neither   mints a fresh identity, which has no balance');
    process.exit(1);
  }
  if (wallet && seed) {
    console.error('use --wallet or --seed, not both');
    process.exit(1);
  }

  let id;
  try {
    id = wallet ? await identityFromWallet(wallet) : identityFromSeed(seed);
  } catch (e) {
    console.error('could not load signing identity:', e.message);
    process.exit(1);
  }
  const { relay } = parseUri(uri);
  console.log('signer address :', id.address, wallet ? '(from your wallet)' : '');
  console.log('relay          :', relay);
  // Only worth saving for an identity that would otherwise be unrecoverable.
  if (!seed && !wallet) console.log('seed (save it) :', id.seedHex);

  const reg = await registerKey(relay, id);
  console.log('register-key   :', JSON.stringify(reg));

  const rl = auto ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, (a) => r(/^y(es)?$/i.test(a.trim()))));

  const session = new SignerSession({
    uri, identity: id,
    onRequest: async (req) => {
      console.log(describe(req));
      if (auto) { console.log('  auto-approved (--yes)\n'); return true; }
      return ask('  approve? [y/N] ');
    },
  });

  await session.hello();
  console.log('paired — waiting for requests. ctrl-c to revoke.\n');
  process.on('SIGINT', async () => { await session.revoke(); process.exit(0); });
  await session.serve();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error('signer failed:', e.message);
  process.exit(1);
});
