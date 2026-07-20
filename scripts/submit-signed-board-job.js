#!/usr/bin/env node
/**
 * Submit a PAID (signed) + ENCRYPTED compute job to the network job board.
 *
 * Free 'verdict' jobs need no payment; 'compute'/'skill' jobs are fee-gated and
 * must carry a signed payment proof (see test/fee-gate.test.js). This script
 * loads a real local wallet, builds that proof, and POSTs it to /jobboard/submit.
 *
 * Encryption (public-job chat):
 *   A public board job is raced by miners you don't control, so its prompt must
 *   reach them in cleartext to be computed — but the ON-CHAIN record and the reply
 *   are sealed to your wallet's X25519 key. We enable that by putting
 *   `requesterEncryptionPublicKey` in the payload; the winning miner seals the
 *   reply (profile.replyCipher) to it, and only this wallet can open it. This
 *   script then decrypts the reply and prints the plaintext.
 *
 * Usage:
 *   node scripts/submit-signed-board-job.js
 *   BOARD=https://miner.poh.ge WALLET=poh4bc7... BUDGET=15000000 PROMPT='hi' \
 *     node scripts/submit-signed-board-job.js
 *   node scripts/submit-signed-board-job.js --dry     # sign + verify, do NOT post
 *   node scripts/submit-signed-board-job.js --plain   # unencrypted (cleartext reply)
 */

import { WalletManager, Wallet } from '../src/wallet/wallet.js';
import { computeBoardJobPaymentHash } from '../src/jobs/board-payment.js';
import { seal, open, isEnvelope } from '../src/security/chat-crypto.js';

const BOARD   = process.env.BOARD  || 'https://miner.poh.ge';
const BUDGET  = parseInt(process.env.BUDGET || '10', 10);   // μPOH (maxBudget)
const PROMPT  = process.env.PROMPT;
const DRY     = process.argv.includes('--dry');
const PLAIN   = process.argv.includes('--plain');   // opt out of encryption
const POLL_MS = parseInt(process.env.POLL_MS || '2000', 10);
const POLL_MAX = parseInt(process.env.POLL_MAX || '60', 10);      // ~2 min at 2s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Load a local wallet (unseals the on-disk key). Pick WALLET=... or the first one.
const wm = new WalletManager();
const addr = process.env.WALLET || wm.listWallets()[0];
if (!addr) { console.error('No wallet found in ~/.poh-miner/wallets'); process.exit(1); }
const wallet = wm.loadWallet(addr);
if (!wallet?.signingPrivateKey) {
  console.error(`Wallet ${addr} has no signing private key (externally registered?) — can't sign.`);
  process.exit(1);
}

// 1b. Derive this wallet's X25519 encryption keypair (public → miners seal to it;
//     private scalar → we decrypt the sealed reply). Deterministic from the wallet.
wallet.ensureEncryptionKeys();
const encPub  = wallet.encryptionPublicKey;
const encPriv = wallet.getEncryptionPrivateKey();

// 2. Build the job + its signed payment proof.
const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const nonce = wallet.nonce || 0;
const amount = BUDGET;

const txHash    = computeBoardJobPaymentHash({ jobId, requesterAddress: wallet.address, amount, nonce });
const signature = wallet.sign(txHash);

const job = {
  id: jobId,
  type: 'compute',                 // fee-gated type
  model: 'qwen3-1.7b',
  payload: {
    prompt: PROMPT,
    // Enabling encryption: the miner seals the reply (and on-chain prompt) to this key.
    // Omit (or --plain) to get a cleartext reply.
    ...(PLAIN ? {} : { requesterEncryptionPublicKey: encPub }),
  },
  requesterAddress: wallet.address,
  maxBudget: amount,               // must equal the signed `amount`
  paymentTx: { txHash, signature, nonce },
  createdAt: Date.now(),
};

// 3. Self-check: the proof must verify against our own key before we send it.
const ok = Wallet.verifySignature(wallet.signingPublicKey, txHash, signature);
console.log(`Wallet        : ${wallet.address}`);
console.log(`Job           : ${jobId} (type=${job.type}, budget=${amount} μPOH, nonce=${nonce})`);
console.log(`Encryption    : ${PLAIN ? 'OFF (--plain)' : 'ON'}${PLAIN ? '' : `  encPubKey=${encPub}`}`);
console.log(`Prompt        : ${PROMPT}`);
console.log(`Payment proof : ${ok ? 'verifies ✓' : 'FAILED ✗'}`);
if (!ok) process.exit(1);

// 3b. Demonstrate the seal/open round-trip locally before sending — this is exactly
//     the envelope the chain will store for the prompt (and the reply comes back the
//     same shape). Proves "encrypt before send" is real and reversible with our key.
if (!PLAIN) {
  const demo = seal(encPub, PROMPT);
  console.log(`\nSealed form (what lands on-chain), e.g. for the prompt:`);
  console.log(`  ${JSON.stringify({ v: demo.v, alg: demo.alg, epk: demo.epk.slice(0, 16) + '…', iv: demo.iv, ct: demo.ct.slice(0, 24) + '…' })}`);
  console.log(`  local unseal check → "${open(demo, encPriv)}"`);
}

if (DRY) { console.log('\n--dry: signed job (not posted):\n' + JSON.stringify(job, null, 2)); process.exit(0); }

// 4. Publish to the board.
const base = BOARD.replace(/\/$/, '');
const res  = await fetch(`${base}/jobboard/submit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(job),
});
const body = await res.json().catch(() => ({}));
console.log(`\nPOST ${base}/jobboard/submit → ${res.status}`);
console.log(JSON.stringify(body, null, 2));
if (!body.jobId) process.exit(res.ok ? 0 : 1);

// 5. Poll for the result, then decrypt it.
console.log(`\nPolling ${base}/jobboard/status?jobId=${body.jobId} (every ${POLL_MS}ms)…`);
let result = null;
for (let i = 0; i < POLL_MAX; i++) {
  await sleep(POLL_MS);
  const sres = await fetch(`${base}/jobboard/status?jobId=${encodeURIComponent(body.jobId)}`).catch(() => null);
  const sbody = sres ? await sres.json().catch(() => ({})) : {};
  process.stdout.write(`\r  [${i + 1}/${POLL_MAX}] status=${sbody.status || 'pending'}   `);
  if (sbody.status === 'done' && sbody.result) { result = sbody.result; break; }
}
console.log('');

if (!result) { console.log('No result within the poll window — try increasing POLL_MAX.'); process.exit(0); }

// 6. Show what's there — decrypt the sealed reply (or print cleartext).
const profile = result.profile || {};
console.log(`\n─────────── RESULT (worker=${result.minerWallet || 'n/a'}, model=${profile.model || result.modelUsed || '?'}) ───────────`);
if (isEnvelope(profile.replyCipher)) {
  console.log(`Reply was ENCRYPTED (profile.replyCipher). Decrypting with wallet X25519 key…\n`);
  try {
    console.log(open(profile.replyCipher, encPriv));
  } catch (e) {
    console.error(`Decryption failed: ${e.message}`);
    console.error(`(raw envelope: ${JSON.stringify(profile.replyCipher)})`);
  }
} else if (profile.computeOutput != null) {
  console.log(`Reply was CLEARTEXT (profile.computeOutput):\n`);
  console.log(profile.computeOutput);
} else {
  console.log('No compute output in result:\n' + JSON.stringify(result, null, 2));
}
console.log(`──────────────────────────────────────────────────────────────`);
