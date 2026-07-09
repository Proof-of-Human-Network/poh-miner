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

export const CLAIM_LEASE_MS = 90_000;   // reclaim a job if no result within this
const DONE_TTL_MS           = 10 * 60_000; // keep results this long for polling
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
    const jobId = job.id || `job-${this._now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.jobs.has(jobId)) return { jobId }; // idempotent resubmit
    this._sweep();
    const openCount = [...this.jobs.values()].filter(e => e.status === 'open').length;
    if (openCount >= MAX_OPEN_JOBS) return { error: 'job board full' };
    this.jobs.set(jobId, {
      job: { ...job, id: jobId },
      status: 'open',
      claimedBy: null, claimedAt: 0,
      result: null, resultBy: null, resultAt: 0, resultIncluded: false,
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
