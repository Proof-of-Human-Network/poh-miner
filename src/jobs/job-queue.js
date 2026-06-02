/**
 * PoH Miner Network - Job Queue / Mempool with Geographic Awareness
 *
 * This is the "mempool of jobs" the user asked for.
 *
 * Jobs (ScanRequests, Profile computations, etc.) enter here.
 * Miners can see pending jobs and decide to compete based on:
 *   - Fee
 *   - Their estimated latency to the requester
 *   - Job type / difficulty
 */

import { getCountryProximityMultiplier } from './geo.js';

export class Job {
  constructor({
    id,
    type = 'verdict',
    payload,
    fee,
    originCountry = null,         // ISO 3166-1 alpha-2 (e.g. "GE", "US", "SG")
    maxLatencyMs = null,
    createdAt = Date.now(),
    expiresAt = null,
    priority = 0,
  }) {
    this.id = id;
    this.type = type;
    this.payload = payload;
    this.fee = fee;
    this.originCountry = originCountry;
    this.maxLatencyMs = maxLatencyMs;
    this.createdAt = createdAt;
    this.expiresAt = expiresAt;
    this.priority = priority;
  }
}

export class JobQueue {
  constructor() {
    this.jobs = new Map(); // id -> Job
    this.completed = new Set();
  }

  addJob(jobData) {
    const job = new Job(jobData);
    if (!this.jobs.has(job.id)) {
      this.jobs.set(job.id, job);
      console.log(`[JobQueue] New job ${job.id} (${job.type}) fee=${job.fee}`);
    }
    return job;
  }

  removeJob(jobId) {
    this.jobs.delete(jobId);
  }

  getPendingJobs() {
    return Array.from(this.jobs.values())
      .filter(j => !this.completed.has(j.id))
      .sort((a, b) => b.fee - a.fee); // highest fee first
  }

  /**
   * Score a job from a miner's perspective.
   * Higher score = more attractive to compete on.
   *
   * Geographic / ping preference is the key here.
   */
  scoreJobForMiner(job, minerInfo = {}) {
    const fee = Number(job.fee) || 0;
    if (fee <= 0) return 0;

    let score = fee * (1 + (job.priority || 0) * 0.1);

    // === Real country-level geographic preference ===
    const geoMultiplier = getCountryProximityMultiplier(
      minerInfo.country,
      job.originCountry
    );

    score *= geoMultiplier;

    // Optional hard filter (if job specifies max latency)
    if (job.maxLatencyMs && minerInfo.estimatedLatencyMs > job.maxLatencyMs) {
      return 0;
    }

    const load = Number(minerInfo.currentLoad) || 0.3;
    if (load > 0.85) score *= 0.5;
    else if (load > 0.6) score *= 0.82;

    // Software protection: Low reputation miners get deprioritized on valuable jobs
    const rep = Number(minerInfo.reputation) || 1.0;
    if (rep < 0.9) {
      // Strong penalty for bad actors on high-fee jobs
      const penalty = Math.max(0.2, rep); // never go below 20% of normal score
      score *= penalty;
    }

    return Math.max(0, Math.round(score));
  }

  /**
   * Get jobs sorted by attractiveness for this specific miner.
   */
  getJobsForMiner(minerInfo, limit = 20) {
    return this.getPendingJobs()
      .map(job => ({
        job,
        score: this.scoreJobForMiner(job, minerInfo)
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => x.job);
  }

  markCompleted(jobId) {
    this.completed.add(jobId);
    this.removeJob(jobId);
    this._saveToDisk();
  }
}
