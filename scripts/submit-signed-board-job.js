#!/usr/bin/env node
/**
 * Submit a PAID (signed) compute job to the network job board on the bootnode.
 *
 * Free 'verdict' jobs need no payment; 'compute'/'skill' jobs are fee-gated and
 * must carry a signed payment proof (see test/fee-gate.test.js). This script
 * loads a real local wallet, builds that proof, and POSTs it to /jobboard/submit.
 *
 * Usage:
 *   node scripts/submit-signed-board-job.js
 *   BOARD=https://miner.poh.ge WALLET=poh4bc7... BUDGET=15000000 \
 *     node scripts/submit-signed-board-job.js
 *   node scripts/submit-signed-board-job.js --dry     # sign + verify, do NOT post
 */

import { WalletManager, Wallet } from '../src/wallet/wallet.js';
import { computeBoardJobPaymentHash } from '../src/jobs/board-payment.js';

const BOARD  = process.env.BOARD  || 'https://miner.poh.ge';
const BUDGET = parseInt(process.env.BUDGET || '15000000', 10);   // μPOH (maxBudget)
const DRY    = process.argv.includes('--dry');

// 1. Load a local wallet (unseals the on-disk key). Pick WALLET=... or the first one.
const wm = new WalletManager();
const addr = process.env.WALLET || wm.listWallets()[0];
if (!addr) { console.error('No wallet found in ~/.poh-miner/wallets'); process.exit(1); }
const wallet = wm.loadWallet(addr);
if (!wallet?.signingPrivateKey) {
  console.error(`Wallet ${addr} has no signing private key (externally registered?) — can't sign.`);
  process.exit(1);
}

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
  payload: { prompt: 'In one sentence, what is proof of human?' },
  requesterAddress: wallet.address,
  maxBudget: amount,               // must equal the signed `amount`
  paymentTx: { txHash, signature, nonce },
  createdAt: Date.now(),
};

// 3. Self-check: the proof must verify against our own key before we send it.
const ok = Wallet.verifySignature(wallet.signingPublicKey, txHash, signature);
console.log(`Wallet        : ${wallet.address}`);
console.log(`Job           : ${jobId} (type=${job.type}, budget=${amount} μPOH, nonce=${nonce})`);
console.log(`Payment proof : ${ok ? 'verifies ✓' : 'FAILED ✗'}`);
if (!ok) process.exit(1);

if (DRY) { console.log('\n--dry: signed job (not posted):\n' + JSON.stringify(job, null, 2)); process.exit(0); }

// 4. Publish to the board.
const res  = await fetch(`${BOARD.replace(/\/$/, '')}/jobboard/submit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(job),
});
const body = await res.json().catch(() => ({}));
console.log(`\nPOST ${BOARD}/jobboard/submit → ${res.status}`);
console.log(JSON.stringify(body, null, 2));
if (body.jobId) {
  console.log(`\nPoll result:\n  curl -s '${BOARD.replace(/\/$/, '')}/jobboard/status?jobId=${body.jobId}'`);
}
