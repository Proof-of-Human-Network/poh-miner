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

// Fairness: keep one fast-polling worker from claiming every job so home/NAT
// nodes never get compute work (and never earn). Both guards are per-worker.
// NOTE: these guards apply to FREE work-sharing only. PAID jobs run as a fee
// auction (see below), where we deliberately want the fastest node to win.
export const CLAIM_COOLDOWN_MS   = 5_000; // after a claim, a worker yields this long so slower pollers get a turn
const MAX_INFLIGHT_PER_WORKER    = 1;     // a worker may hold at most this many un-resulted claims at once

// Fee auction for PAID jobs: a paid job is a bid. It surfaces to every node
// highest-bid-first, and up to RACE_REPLICAS distinct workers may hold it at
// once and race — the first VALID result posted wins the whole fee, the rest are
// rejected ('result already submitted'). Bounding the racers keeps the network
// from burning N× GPU on every job while preserving "higher fee ⇒ served &
// completed first". Set to a large number for an effectively unbounded race.
export const RACE_REPLICAS = 3;

export class JobBoard {
  constructor({ leaseMs = CLAIM_LEASE_MS, claimCooldownMs = CLAIM_COOLDOWN_MS, maxInflightPerWorker = MAX_INFLIGHT_PER_WORKER, raceReplicas = RACE_REPLICAS } = {}) {
    this.leaseMs = leaseMs;
    this.claimCooldownMs = claimCooldownMs;
    this.maxInflightPerWorker = maxInflightPerWorker;
    this.raceReplicas = raceReplicas;
    this.jobs = new Map(); // jobId → { job, status, claimedBy, claimedAt, racers, result, resultBy, submittedAt, resultAt, resultIncluded }
    this._lastClaimAt = new Map(); // worker → last successful claim time (fairness cooldown)
  }

  // A paid job (maxBudget > 0) runs as a fee race; a free job as cooperative
  // work-sharing with the per-worker fairness guards.
  _isRace(e) { return (e?.job?.maxBudget || 0) > 0; }

  // Live racers holding a paid job (lease-bounded, like a claim). Used to bound
  // the auction to raceReplicas concurrent workers.
  _liveRacers(e, now = this._now()) {
    if (!e.racers) return 0;
    let n = 0;
    for (const at of e.racers.values()) if (now - at <= this.leaseMs) n++;
    return n;
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
      racers: new Map(),          // worker → claim time (paid fee-race holders)
      result: null, resultBy: null, resultAt: 0,
      resultIncluded: false, handedOutAt: 0,
      submittedAt: this._now(),
    });
    return { jobId };
  }

  /**
   * Jobs available to claim (open, or claimed with an expired lease). Every node
   * sees every job — `region` is only a soft preference that sorts jobs matching
   * the caller's region first, never a filter that hides work from a node.
   */
  listOpen({ limit = 10, region = null } = {}) {
    this._sweep();
    const now = this._now();
    const out = [];
    for (const e of this.jobs.values()) {
      if (e.status === 'done') continue;
      let claimable;
      if (this._isRace(e)) {
        // Paid fee-race: claimable while the bounded racer slots aren't full.
        claimable = this._liveRacers(e, now) < this.raceReplicas;
      } else {
        // Free work-sharing: exclusive claim with lease reclaim.
        claimable = e.status === 'open'
          || (e.status === 'claimed' && now - e.claimedAt > this.leaseMs);
      }
      if (!claimable) continue;
      out.push(e.job);
    }
    // Fee auction: highest bid first (maxBudget is the bid; fee breaks ties).
    out.sort((a, b) => ((b.maxBudget || 0) - (a.maxBudget || 0)) || ((b.fee || 0) - (a.fee || 0)));
    if (region) {
      // Stable partition: region-matching jobs first, fee order preserved within each group.
      out.sort((a, b) => (b.originCountry === region ? 1 : 0) - (a.originCountry === region ? 1 : 0));
    }
    return out.slice(0, limit);
  }

  /** Number of un-resulted jobs `worker` currently holds a live claim on. */
  _inflightFor(worker, now = this._now()) {
    let n = 0;
    for (const e of this.jobs.values()) {
      if (e.status === 'claimed' && e.claimedBy === worker && now - e.claimedAt <= this.leaseMs) n++;
    }
    return n;
  }

  /** Claim a job for `worker`. Returns { job } or { error }. */
  claim(jobId, worker) {
    const e = this.jobs.get(jobId);
    if (!e) return { error: 'job not found' };
    const now = this._now();
    if (e.status === 'done') return { error: 'job already completed' };

    // Paid fee-race: no exclusivity and no fairness guards — up to raceReplicas
    // distinct workers may hold the job at once and race. The winner is decided
    // at postResult (first valid result wins the whole fee).
    if (this._isRace(e)) {
      const alreadyRacing = e.racers.has(worker) && now - e.racers.get(worker) <= this.leaseMs;
      if (!alreadyRacing && this._liveRacers(e, now) >= this.raceReplicas) {
        return { error: 'race slots full — try a higher-fee job', code: 'RACE_FULL' };
      }
      e.racers.set(worker, now);
      if (e.status === 'open') { e.status = 'claimed'; e.claimedBy = worker; e.claimedAt = now; }
      return { job: e.job };
    }

    // Re-claiming a job this worker already holds is idempotent (retried request):
    // renew the lease, don't count it against the cap or trip the cooldown.
    if (e.status === 'claimed' && e.claimedBy === worker && now - e.claimedAt <= this.leaseMs) {
      e.claimedAt = now;
      return { job: e.job };
    }

    const claimable = e.status === 'open'
      || (e.status === 'claimed' && now - e.claimedAt > this.leaseMs);
    if (!claimable) {
      if (e.status === 'done') return { error: 'job already completed' };
      return { error: 'job already claimed' };
    }

    // Fairness guard 1 — in-flight cap: a worker sitting on an unfinished claim
    // can't grab more, so it can't sweep the whole board while others wait.
    if (this._inflightFor(worker, now) >= this.maxInflightPerWorker) {
      return { error: 'worker already holds an unfinished job', code: 'WORKER_BUSY' };
    }
    // Fairness guard 2 — post-claim cooldown: after claiming, a worker yields for
    // a short window so a slower-polling peer can take the next job. The job stays
    // open meanwhile; if no peer claims it, this worker gets it on a later poll —
    // so a lone worker is never starved, it just paces at one job per cooldown.
    const sinceLast = now - (this._lastClaimAt.get(worker) || 0);
    if (sinceLast < this.claimCooldownMs) {
      return { error: 'claim cooldown — yielding to peers', code: 'CLAIM_COOLDOWN', retryAfterMs: this.claimCooldownMs - sinceLast };
    }

    e.status = 'claimed';
    e.claimedBy = worker;
    e.claimedAt = now;
    this._lastClaimAt.set(worker, now);
    return { job: e.job };
  }

  /**
   * Post a result. First valid result wins:
   *  - Paid fee-race: any worker that holds (or held) a live racer slot may submit;
   *    the first to arrive flips the job to `done` and wins the fee, the rest get
   *    'result already submitted'.
   *  - Free work-sharing: only the current exclusive claimer may submit.
   */
  postResult(jobId, worker, result) {
    const e = this.jobs.get(jobId);
    if (!e) return { error: 'job not found' };
    if (e.status === 'done') return { error: 'result already submitted' };
    if (this._isRace(e)) {
      if (!e.racers.has(worker)) return { error: 'worker did not claim this job', code: 'NOT_RACING' };
    } else if (e.claimedBy && e.claimedBy !== worker) {
      return { error: 'job claimed by another worker' };
    }
    e.status = 'done';
    e.result = result;
    e.resultBy = worker;      // the winner — settlement pays this address
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
    // Expired cooldowns carry no meaning — drop them so the map tracks only
    // recently-active workers.
    for (const [w, t] of this._lastClaimAt) {
      if (now - t > this.claimCooldownMs * 4) this._lastClaimAt.delete(w);
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
