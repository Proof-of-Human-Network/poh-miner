import { describe, it, expect, beforeEach } from 'vitest';
import { JobBoard } from '../src/jobs/job-board.js';

describe('JobBoard', () => {
  let board;
  beforeEach(() => { board = new JobBoard({ leaseMs: 50 }); });

  it('submits and lists open jobs', () => {
    const { jobId } = board.submit({ type: 'verdict', payload: { address: 'bc1qtest' } });
    expect(jobId).toBeTruthy();
    const open = board.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(jobId);
  });

  it('is idempotent on resubmit with same id', () => {
    board.submit({ id: 'j1', type: 'verdict' });
    board.submit({ id: 'j1', type: 'verdict' });
    expect(board.stats().total).toBe(1);
  });

  it('claim transitions open → claimed and removes from open list', () => {
    const { jobId } = board.submit({ id: 'j1', type: 'verdict' });
    const r = board.claim(jobId, 'pohworker1');
    expect(r.job.id).toBe(jobId);
    expect(board.listOpen()).toHaveLength(0);
    expect(board.stats()).toMatchObject({ open: 0, claimed: 1 });
  });

  it('rejects a second claim while lease is active', () => {
    board.submit({ id: 'j1' });
    board.claim('j1', 'workerA');
    const r = board.claim('j1', 'workerB');
    expect(r.error).toMatch(/already claimed/);
  });

  it('reclaims a job after the lease expires', async () => {
    board.submit({ id: 'j1' });
    board.claim('j1', 'workerA');
    await new Promise(r => setTimeout(r, 70)); // > leaseMs
    expect(board.listOpen().map(j => j.id)).toContain('j1');
    const r = board.claim('j1', 'workerB');
    expect(r.job.id).toBe('j1');
  });

  it('only the claimer can post a result', () => {
    board.submit({ id: 'j1' });
    board.claim('j1', 'workerA');
    expect(board.postResult('j1', 'workerB', { verdict: 'HUMAN' }).error).toMatch(/another worker/);
    expect(board.postResult('j1', 'workerA', { verdict: 'HUMAN' })).toEqual({ ok: true });
  });

  it('exposes result via get() and marks done', () => {
    board.submit({ id: 'j1' });
    board.claim('j1', 'workerA');
    board.postResult('j1', 'workerA', { verdict: 'HUMAN', confidence: 0.9 });
    const s = board.get('j1');
    expect(s.status).toBe('done');
    expect(s.result.verdict).toBe('HUMAN');
    expect(s.worker).toBe('workerA');
  });

  it('surfaces completed results as pending for proposers, then clears them', () => {
    board.submit({ id: 'j1' });
    board.claim('j1', 'w');
    board.postResult('j1', 'w', { verdict: 'AI' });
    let pending = board.pendingResults();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ jobId: 'j1', worker: 'w' });
    board.markResultsIncluded(['j1']);
    expect(board.pendingResults()).toHaveLength(0);
  });

  it('rejects claim/result for unknown jobs', () => {
    expect(board.claim('nope', 'w').error).toMatch(/not found/);
    expect(board.postResult('nope', 'w', {}).error).toMatch(/not found/);
  });

  it('rejects fee-required jobs without a payment proof', () => {
    expect(board.submit({ type: 'skill', skillId: 'x' }).error).toMatch(/paymentTx/);
    expect(board.submit({ type: 'compute', model: 'm' }).error).toMatch(/paymentTx/);
    // verdict (free) needs no payment
    expect(board.submit({ type: 'verdict' }).jobId).toBeTruthy();
  });

  it('accepts a fee job with payment + budget and carries it to pending-results', () => {
    const r = board.submit({ id: 'f1', type: 'skill', skillId: 'x',
      requesterAddress: 'pohreq', maxBudget: 1000, paymentTx: { txHash: 'h', signature: 's', nonce: 3 } });
    expect(r.jobId).toBe('f1');
    board.claim('f1', 'wkr');
    board.postResult('f1', 'wkr', { type: 'skill', output: 42 });
    const [p] = board.takePendingResults();
    expect(p).toMatchObject({ jobId: 'f1', worker: 'wkr', jobType: 'skill', requesterAddress: 'pohreq', maxBudget: 1000 });
    expect(p.paymentTx.nonce).toBe(3);
  });

  it('takePendingResults leases a handed-out result (not re-offered within the lease)', () => {
    board.submit({ id: 'j1' }); board.claim('j1', 'w'); board.postResult('j1', 'w', { verdict: 'HUMAN' });
    expect(board.takePendingResults()).toHaveLength(1);
    expect(board.takePendingResults()).toHaveLength(0);           // leased to the first proposer
    board.markResultsIncluded(['j1']);
    expect(board.pendingResults()).toHaveLength(0);               // confirmed included → gone
  });
});

describe('JobBoard — fairness (every node sees & gets work)', () => {
  it('region is a soft preference, never a filter — all nodes see all jobs', () => {
    const board = new JobBoard();
    board.submit({ id: 'ge', type: 'verdict', originCountry: 'GE' });
    board.submit({ id: 'hk', type: 'verdict', originCountry: 'HK' });
    board.submit({ id: 'any', type: 'verdict' }); // untagged

    // A worker in HK still sees every job (not just HK), with its region first.
    const seen = board.listOpen({ region: 'HK' }).map(j => j.id);
    expect(seen).toContain('ge');
    expect(seen).toContain('hk');
    expect(seen).toContain('any');
    expect(seen[0]).toBe('hk'); // preference: matching region sorts first

    // A worker sending no region also sees all of them.
    expect(board.listOpen().map(j => j.id).sort()).toEqual(['any', 'ge', 'hk']);
  });

  it('in-flight cap: a worker holding an unfinished job cannot claim another', () => {
    const board = new JobBoard({ claimCooldownMs: 0 }); // isolate the cap from the cooldown
    board.submit({ id: 'a' });
    board.submit({ id: 'b' });

    expect(board.claim('a', 'hog').job.id).toBe('a');
    const second = board.claim('b', 'hog');
    expect(second.error).toBeTruthy();
    expect(second.code).toBe('WORKER_BUSY');

    // 'b' is still open for a different worker to take.
    expect(board.claim('b', 'other').job.id).toBe('b');

    // Once 'hog' finishes 'a', it may claim again.
    board.postResult('a', 'hog', { verdict: 'HUMAN' });
    board.submit({ id: 'c' });
    expect(board.claim('c', 'hog').job.id).toBe('c');
  });

  it('post-claim cooldown: fast poller yields the next job to a peer', async () => {
    const board = new JobBoard({ claimCooldownMs: 60 });
    board.submit({ id: 'a' });
    board.submit({ id: 'b' });

    // hk claims 'a', finishes it immediately, then races for 'b' during cooldown.
    expect(board.claim('a', 'hk').job.id).toBe('a');
    board.postResult('a', 'hk', { verdict: 'HUMAN' });
    const racing = board.claim('b', 'hk');
    expect(racing.code).toBe('CLAIM_COOLDOWN');     // hk is held back…
    expect(board.claim('b', 'local').job.id).toBe('b'); // …so the slower node gets it

    // After the cooldown a lone worker is never starved — it can claim again.
    await new Promise(r => setTimeout(r, 80));
    board.submit({ id: 'c' });
    expect(board.claim('c', 'hk').job.id).toBe('c');
  });

  it('idempotent re-claim of a held job does not trip the cooldown or cap', () => {
    const board = new JobBoard({ claimCooldownMs: 60 });
    board.submit({ id: 'a' });
    expect(board.claim('a', 'w').job.id).toBe('a');
    // Re-claiming the same job the worker already holds just renews the lease.
    expect(board.claim('a', 'w').job.id).toBe('a');
  });
});
