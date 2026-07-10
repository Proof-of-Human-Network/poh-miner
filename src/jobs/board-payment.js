/**
 * Board job payment hash — shared by the client that pays and the proposer that
 * verifies/settles. Board jobs are claimed by an unknown worker, so the proof
 * binds to job + submitter + amount + nonce only (NOT a specific miner address,
 * unlike the direct /job flow's computeJobPaymentHash).
 */

import crypto from 'crypto';

export function computeBoardJobPaymentHash({ jobId, requesterAddress, amount, nonce }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ board: true, jobId, requesterAddress, amount, nonce }))
    .digest('hex');
}
