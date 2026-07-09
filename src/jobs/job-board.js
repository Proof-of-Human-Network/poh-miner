/**
 * JobBoard — NAT-friendly pull-based job distribution on the bootnode.
 *
 * The existing gossip path pushes jobs to reachable peers only, so a miner
 * behind a home router never receives compute work. The board lets ANY miner
 * (reachable or not) poll for open jobs over its own outbound connection, claim
 * one, compute it, and post the result back — the same way a worker pulls from
 * a task queue.
 *
 * Lifecycle:  open ──claim──▶ claimed ──result──▶ done
 * A claim carries a lease; if the worker dies without posting a result the job
 * returns to `open` after CLAIM_LEASE_MS so another miner can take it.
 *
 * In-memory only: jobs are ephemeral compute requests, not consensus state. A
 * bootnode restart drops the board; clients resubmit. Completed results are the
 * canonical record and are also pulled by block proposers to reward the worker.
 */

// Job types whose compute must be paid for (parity with the miner's /job fee gate).
// Free 'verdict' (proof-of-human) jobs are rewarded from coinbase instead.
export const FEE_REQUIRED_BOARD_TYPES = new Set(['skill', 'compute']);

export const CLAIM_LEASE_MS = 90_000;   // reclaim a job if no result within this
const DONE_TTL_MS           = 10 * 60_000; // keep results this long for polling
const HANDOUT_LEASE_MS      = 120_000;  // re-offer a result to a proposer if not confirmed included
const MAX_OPEN_JOBS         = 5_000;    // backpressure cap

export class JobBoard {
  constructor({ leaseMs = CLAIM_LEASE_MS } = {}) {
    this.leaseMs = leaseMs;
    this.jobs = new Map(); // jobId → { job, status, claimedBy, claimedAt, result, resultBy, submittedAt, resultAt, resultIncluded }
  }

  _now() { return Date.now(); }

  /** Add a compute job to the board. Returns { jobId } or { error }. */
  submit(job) {
    if (!job || typeof job !== 'object') return { error: 'invalid job' };
    // Fee-required jobs must carry a signed payment proof + budget so a worker
    // isn't asked to compute paid work for free. Full verification (signature vs
    // the requester's registered key, nonce, balance) happens on the proposer at
    // settlement; the board just enforces the proof is present.
    if (FEE_REQUIRED_BOARD_TYPES.has(job.type)) {
      if (!job.paymentTx?.signature || !job.paymentTx?.txHash) {
        return { error: `${job.type} jobs require a signed paymentTx`, code: 'PAYMENT_PROOF_REQUIRED' };
      }
      if (!job.requesterAddress || !(job.maxBudget > 0)) {
        return { error: `${job.type} jobs require requesterAddress and maxBudget > 0`, code: 'FEE_REQUIRED' };
      }
    }
    const jobId = job.id || `job-${this._now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.jobs.has(jobId)) return { jobId }; // idempotent resubmit
    this._sweep();
    const openCount = [...this.jobs.values()].filter(e => e.status === 'open').length;
    if (openCount >= MAX_OPEN_JOBS) return { error: 'job board full' };
    this.jobs.set(jobId, {
      job: { ...job, id: jobId },
      status: 'open',
      claimedBy: null, claimedAt: 0,
      result: null, resultBy: null, resultAt: 0,
      resultIncluded: false, handedOutAt: 0,
      submittedAt: this._now(),
    });
    return { jobId };
  }

  /** Jobs available to claim (open, or claimed with an expired lease). */
  listOpen({ limit = 10, region = null } = {}) {
    this._sweep();
    const now = this._now();
    const out = [];
    for (const e of this.jobs.values()) {
      const claimable = e.status === 'open'
        || (e.status === 'claimed' && now - e.claimedAt > this.leaseMs);
      if (!claimable) continue;
      if (region && e.job.originCountry && e.job.originCountry !== region) continue;
      out.push(e.job);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Claim a job for `worker`. Returns { job } or { error }. */
  claim(jobId, worker) {
    const e = this.jobs.get(jobId);
    if (!e) return { error: 'job not found' };
    const now = this._now();
    const claimable = e.status === 'open'
      || (e.status === 'claimed' && now - e.claimedAt > this.leaseMs);
    if (!claimable) {
      if (e.status === 'done') return { error: 'job already completed' };
      return { error: 'job already claimed' };
    }
    e.status = 'claimed';
    e.claimedBy = worker;
    e.claimedAt = now;
    return { job: e.job };
  }

  /** Post a result for a claimed job. Only the current claimer may submit. */
  postResult(jobId, worker, result) {
    const e = this.jobs.get(jobId);
    if (!e) return { error: 'job not found' };
    if (e.status === 'done') return { error: 'result already submitted' };
    if (e.claimedBy && e.claimedBy !== worker) return { error: 'job claimed by another worker' };
    e.status = 'done';
    e.result = result;
    e.resultBy = worker;
    e.resultAt = this._now();
    return { ok: true };
  }

  /** Poll status/result for the original submitter. */
  get(jobId) {
    const e = this.jobs.get(jobId);
    if (!e) return null;
    return {
      jobId,
      status: e.status,
      result: e.status === 'done' ? e.result : null,
      worker: e.resultBy || null,
      claimedBy: e.claimedBy || null,
    };
  }

  /** Completed results a block proposer has not yet been handed (for worker rewards). */
  pendingResults(limit = 50) {
    const out = [];
    for (const e of this.jobs.values()) {
      if (e.status === 'done' && !e.resultIncluded && e.result) {
        out.push({ jobId: e.job.id, worker: e.resultBy, result: e.result });
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /**
   * Hand completed results to a block proposer and lease them so a concurrent
   * proposer doesn't grab the same ones. Re-offered after HANDOUT_LEASE_MS if the
   * proposer never confirms inclusion (crashed / lost the block to a fork).
   */
  takePendingResults(limit = 50) {
    const now = this._now();
    const out = [];
    for (const e of this.jobs.values()) {
      if (e.status !== 'done' || e.resultIncluded || !e.result) continue;
      if (e.handedOutAt && now - e.handedOutAt < HANDOUT_LEASE_MS) continue;
      e.handedOutAt = now;
      out.push({
        jobId: e.job.id, worker: e.resultBy, result: e.result,
        jobType: e.job.type || 'verdict',
        requesterAddress: e.job.requesterAddress || null,
        maxBudget: e.job.maxBudget || 0,
        paymentTx: e.job.paymentTx || null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  markResultsIncluded(jobIds) {
    for (const id of jobIds || []) {
      const e = this.jobs.get(id);
      if (e) e.resultIncluded = true;
    }
  }

  _sweep() {
    const now = this._now();
    for (const [id, e] of this.jobs) {
      if (e.status === 'done' && now - e.resultAt > DONE_TTL_MS) this.jobs.delete(id);
    }
  }

  stats() {
    let open = 0, claimed = 0, done = 0;
    for (const e of this.jobs.values()) {
      if (e.status === 'open') open++;
      else if (e.status === 'claimed') claimed++;
      else if (e.status === 'done') done++;
    }
    return { open, claimed, done, total: this.jobs.size };
  }
}
