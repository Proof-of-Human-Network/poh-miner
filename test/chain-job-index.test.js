import { describe, it, expect } from 'vitest';
import {
  buildJobSubmittedIndex,
  buildResultsIndex,
  getWalletJobHistory,
  extractSkillMemory,
  extractComputeMemory,
  extractChatTurns,
  mergeWithLocalJobs,
  promptPreviewFromJob,
  PROMPT_PREVIEW_MAX,
} from '../src/chain/chain-job-index.js';

const WALLET = 'pohabc123';

function makeChain() {
  return [
    {
      height: 1,
      timestamp: 1000,
      stateTransitions: [
        {
          type: 'job-submitted',
          jobId: 'job-1',
          jobType: 'skill',
          skillId: 'read_farcaster',
          requesterAddress: WALLET,
          promptPreview: 'what does vitalik post',
          timestamp: 1000,
        },
        {
          type: 'job-submitted',
          jobId: 'job-2',
          jobType: 'compute',
          requesterAddress: 'pohother',
          promptPreview: 'hello',
          timestamp: 2000,
        },
      ],
      scanResults: [
        {
          requestId: 'job-1',
          verdict: 'SKILL_RESULT',
          profile: { skillId: 'read_farcaster', skillOutput: { username: 'vitalik', casts: [{ text: 'hi' }] } },
        },
      ],
    },
    {
      height: 2,
      timestamp: 3000,
      stateTransitions: [
        {
          type: 'job-submitted',
          jobId: 'job-3',
          jobType: 'compute',
          requesterAddress: WALLET,
          promptPreview: 'follow up question',
          timestamp: 3000,
        },
      ],
      scanResults: [
        {
          requestId: 'job-3',
          verdict: 'COMPUTE_RESULT',
          profile: { computeOutput: 'Here is the answer', model: 'qwen2.5:1.5b' },
        },
      ],
    },
  ];
}

describe('chain-job-index', () => {
  it('indexes job-submitted transitions', () => {
    const idx = buildJobSubmittedIndex(makeChain());
    expect(idx.size).toBe(3);
    expect(idx.get('job-1').requesterAddress).toBe(WALLET);
  });

  it('joins wallet jobs with mined results', () => {
    const jobs = getWalletJobHistory(makeChain(), WALLET, { limit: 10 });
    expect(jobs).toHaveLength(2);
    expect(jobs[0].jobId).toBe('job-3');
    expect(jobs[0].mined).toBe(true);
    expect(jobs[0].profile.computeOutput).toBe('Here is the answer');
    expect(jobs[1].jobId).toBe('job-1');
    expect(jobs[1].profile.skillOutput.username).toBe('vitalik');
  });

  it('extracts skill and compute memory', () => {
    const jobs = getWalletJobHistory(makeChain(), WALLET);
    expect(extractSkillMemory(jobs)?.skillId).toBe('read_farcaster');
    expect(extractComputeMemory(jobs)?.output.computeOutput).toBe('Here is the answer');
  });

  it('builds chat turns oldest-first', () => {
    const jobs = getWalletJobHistory(makeChain(), WALLET);
    const turns = extractChatTurns(jobs);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toContain('vitalik');
    expect(turns[turns.length - 1].content).toBe('Here is the answer');
  });

  it('merges local jobs not yet mined', () => {
    const local = [{
      createdAt: 4000,
      job: { id: 'job-local', type: 'compute', requesterAddress: WALLET, payload: { prompt: 'local only' } },
      result: { verdict: 'COMPUTE_RESULT', profile: { computeOutput: 'local reply' } },
    }];
    const merged = mergeWithLocalJobs([], local, WALLET, 5);
    expect(merged[0].jobId).toBe('job-local');
    expect(merged[0].profile.computeOutput).toBe('local reply');
  });

  it('truncates prompt preview', () => {
    const long = 'x'.repeat(PROMPT_PREVIEW_MAX + 100);
    expect(promptPreviewFromJob({ payload: { prompt: long } }).length).toBe(PROMPT_PREVIEW_MAX);
  });
});
