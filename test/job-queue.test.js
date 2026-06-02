import { describe, it, expect, beforeEach } from 'vitest';
import { JobQueue, Job } from '../src/jobs/job-queue.js';

describe('JobQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new JobQueue();
  });

  it('should add and retrieve pending jobs', () => {
    const job1 = queue.addJob({
      id: 'job-1',
      type: 'verdict',
      fee: 10,
      originCountry: 'US',
    });

    const job2 = queue.addJob({
      id: 'job-2',
      type: 'verdict',
      fee: 50,
      originCountry: 'DE',
    });

    const pending = queue.getPendingJobs();
    expect(pending.length).toBe(2);
    // Should be sorted by fee descending
    expect(pending[0].id).toBe('job-2');
    expect(pending[1].id).toBe('job-1');
  });

  it('should not add duplicate jobs', () => {
    queue.addJob({ id: 'job-1', fee: 10 });
    queue.addJob({ id: 'job-1', fee: 99 }); // duplicate

    expect(queue.getPendingJobs().length).toBe(1);
  });

  it('should mark jobs as completed', () => {
    queue.addJob({ id: 'job-1', fee: 10 });
    
    // Spy on the internal save to avoid filesystem side effects in tests
    queue._saveToDisk = () => {};
    
    queue.markCompleted('job-1');

    expect(queue.getPendingJobs().length).toBe(0);
  });

  it('should score jobs with geographic preference', () => {
    const job = new Job({
      id: 'job-geo',
      fee: 100,
      originCountry: 'DE',
    });

    // German miner should get high multiplier
    const deMiner = { country: 'DE' };
    const deScore = queue.scoreJobForMiner(job, deMiner);

    // US miner should get lower score for German job
    const usMiner = { country: 'US' };
    const usScore = queue.scoreJobForMiner(job, usMiner);

    expect(deScore).toBeGreaterThan(usScore);
    expect(deScore).toBeGreaterThan(100); // base fee boosted by geo
  });

  it('should penalize high load and low reputation', () => {
    const job = new Job({ id: 'j1', fee: 100, originCountry: 'US' });
    const miner = { country: 'US', currentLoad: 0.9, reputation: 0.5 };

    const score = queue.scoreJobForMiner(job, miner);
    
    // Should be penalized compared to a perfect miner (score would be ~100+)
    expect(score).toBeLessThan(100);
  });
});