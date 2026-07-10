import { describe, it, expect, beforeEach } from 'vitest';
import { JobBoard } from '../src/jobs/job-board.js';
import { computeBoardJobPaymentHash } from '../src/jobs/board-payment.js';
import { Wallet } from '../src/wallet/wallet.js';

/**
 * Fee gate: fee-required compute jobs (skill/compute) must carry a signed
 * payment proof. Free 'verdict' proof-of-human jobs need none. The same gate
 * runs on the miner's /job endpoint (verified live: unpaid → HTTP 402
 * FEE_REQUIRED) and on the bootnode job board (tested here).
 */
describe('fee gate — paid vs unpaid compute jobs', () => {
  let board;
  beforeEach(() => { board = new JobBoard(); });

  it('rejects an UNPAID skill/compute job', () => {
    const skill = board.submit({ type: 'skill', skillId: 'web_search', payload: { query: 'x' } });
    expect(skill.error).toMatch(/require a signed paymentTx/);
    expect(skill.code).toBe('PAYMENT_PROOF_REQUIRED');
    expect(skill.jobId).toBeUndefined();

    // a payment shape but no budget is still rejected
    const noBudget = board.submit({
      type: 'compute', model: 'qwen3', requesterAddress: 'pohreq',
      paymentTx: { txHash: 'h', signature: 's', nonce: 0 }, maxBudget: 0,
    });
    expect(noBudget.error).toMatch(/maxBudget > 0/);

    // sanity: a free verdict job needs no payment
    expect(board.submit({ type: 'verdict', payload: { address: 'bc1q' } }).jobId).toBeTruthy();
    expect(board.stats()).toMatchObject({ open: 1 }); // only the verdict job got on the board
  });

  it('accepts a PAID skill/compute job whose payment proof verifies', async () => {
    const requester = Wallet.generate();
    const jobId = 'paid-skill-1';
    const amount = 5_000_000;     // μPOH budget
    const nonce = 0;

    // Client builds the exact proof the proposer will later verify + settle.
    const txHash = computeBoardJobPaymentHash({ jobId, requesterAddress: requester.address, amount, nonce });
    const signature = requester.sign(txHash);

    const r = board.submit({
      id: jobId, type: 'skill', skillId: 'web_search', payload: { query: 'x' },
      requesterAddress: requester.address, maxBudget: amount,
      paymentTx: { txHash, signature, nonce },
    });
    expect(r.error).toBeUndefined();
    expect(r.jobId).toBe(jobId);
    expect(board.stats()).toMatchObject({ open: 1 });

    // The carried payment proof must verify against the requester's key — this is
    // exactly what the proposer's _settleBoardFeeJob checks before paying the worker.
    const expected = computeBoardJobPaymentHash({ jobId, requesterAddress: requester.address, amount, nonce });
    expect(txHash).toBe(expected);
    expect(Wallet.verifySignature(requester.signingPublicKey, expected, signature)).toBe(true);

    // A tampered amount must NOT verify (can't pay less than pledged).
    const forged = computeBoardJobPaymentHash({ jobId, requesterAddress: requester.address, amount: 1, nonce });
    expect(Wallet.verifySignature(requester.signingPublicKey, forged, signature)).toBe(false);
  });
});
