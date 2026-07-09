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
});
