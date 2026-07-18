import { describe, it, expect } from 'vitest';
import { JobBoard } from '../src/jobs/job-board.js';
import { settleFee, estimateChatTokens, outputTokenCap, GAS } from '../src/jobs/gas-estimator.js';

// A signed paymentTx is required for paid board jobs.
const PT = { txHash: 'h', signature: 's' };
const paidJob = (id, maxBudget) => ({ id, type: 'compute', model: 'm', requesterAddress: 'pohreq', maxBudget, paymentTx: PT });

describe('no-refund settlement (change 1)', () => {
  it('takes the whole bid as the fee regardless of tokens used', () => {
    // Used far fewer tokens than budgeted — still no refund.
    const { fee, refund, cost } = settleFee(300, 1, 5000);
    expect(fee).toBe(5000);
    expect(refund).toBe(0);
    expect(cost).toBe(300); // diagnostic: tokens actually consumed
  });

  it('flags underfunded when consumed cost exceeds the bid (should not happen post-cap)', () => {
    const { fee, refund, underfunded } = settleFee(6000, 1, 5000);
    expect(fee).toBe(5000);   // capped — never over-charges
    expect(refund).toBe(0);
    expect(underfunded).toBe(true);
  });
});

describe('chat estimate + budget hard cap', () => {
  it('estimateChatTokens = prompt + reserved output (capped)', () => {
    expect(estimateChatTokens(100, 200)).toBe(300);
    expect(estimateChatTokens(100, 999999)).toBe(100 + GAS.OUTPUT_CAP); // output clamped
  });

  it('outputTokenCap = floor(budget/price) - prompt tokens', () => {
    expect(outputTokenCap(1000, 1, 400)).toBe(600);
    expect(outputTokenCap(300, 1, 400)).toBe(0);   // prompt alone exhausts the bid
  });
});

describe('fee-race board (change 2)', () => {
  it('surfaces higher-bid jobs first', () => {
    const board = new JobBoard();
    board.submit(paidJob('low', 100));
    board.submit(paidJob('high', 9000));
    board.submit(paidJob('mid', 3000));
    expect(board.listOpen().map(j => j.id)).toEqual(['high', 'mid', 'low']);
  });

  it('lets up to raceReplicas workers hold a paid job at once', () => {
    const board = new JobBoard({ raceReplicas: 2 });
    board.submit(paidJob('r1', 1000));
    expect(board.claim('r1', 'A').job.id).toBe('r1');
    expect(board.claim('r1', 'B').job.id).toBe('r1');   // second racer allowed
    expect(board.claim('r1', 'C').code).toBe('RACE_FULL'); // bounded
  });

  it('first valid result wins the whole fee; the rest are rejected', () => {
    const board = new JobBoard({ raceReplicas: 3 });
    board.submit(paidJob('r1', 1000));
    board.claim('r1', 'A');
    board.claim('r1', 'B');
    expect(board.postResult('r1', 'A', { out: 1 })).toEqual({ ok: true });
    expect(board.postResult('r1', 'B', { out: 2 }).error).toMatch(/already submitted/);
    expect(board.get('r1').worker).toBe('A'); // winner recorded for settlement
  });

  it('a non-racer cannot post a result to a paid job', () => {
    const board = new JobBoard();
    board.submit(paidJob('r1', 1000));
    board.claim('r1', 'A');
    expect(board.postResult('r1', 'stranger', {}).code).toBe('NOT_RACING');
  });

  it('free jobs keep exclusive-claim work-sharing (not a race)', () => {
    const board = new JobBoard({ claimCooldownMs: 0 });
    board.submit({ id: 'free', type: 'verdict' }); // no maxBudget
    expect(board.claim('free', 'A').job.id).toBe('free');
    expect(board.claim('free', 'B').error).toMatch(/already claimed/);
  });
});
