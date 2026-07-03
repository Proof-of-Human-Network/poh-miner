import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ChatHistorySearch } from '../src/search/chat-history-search.js';
import { jobToSearchDocument, extractReplyText } from '../src/chain/chain-job-index.js';

const WALLET = 'pohabc123';

describe('chat-history-search', () => {
  let tmpDir;
  let search;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poh-search-'));
    search = new ChatHistorySearch({ enabled: true, requireMeilisearch: false, dataDir: tmpDir, host: 'http://127.0.0.1:1' });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('extracts reply text from skill and compute profiles', () => {
    expect(extractReplyText({ profile: { computeOutput: 'hello world' } })).toBe('hello world');
    expect(extractReplyText({ profile: { skillOutput: { username: 'v' } } })).toContain('username');
  });

  it('indexes and suggests by prefix (local fallback)', async () => {
    const doc = jobToSearchDocument({
      jobId: 'job-1',
      jobType: 'skill',
      requesterAddress: WALLET,
      promptPreview: 'what does vitalik post',
      profile: { nlResponse: 'Vitalik posted about Ethereum upgrades' },
      mined: true,
      submittedAt: 1000,
    });
    await search.indexDocument(doc);
    const { suggestions, engine } = await search.suggest({ q: 'what does vit', wallet: WALLET });
    expect(engine).toBe('local');
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].prompt).toContain('vitalik');
  });

  it('matches repetitive prompts', async () => {
    await search.indexDocument(jobToSearchDocument({
      jobId: 'job-2',
      requesterAddress: WALLET,
      promptPreview: 'summarize ethereum gas fees',
      profile: { computeOutput: 'Gas fees vary by network congestion...' },
      mined: true,
      submittedAt: 2000,
    }));
    const match = await search.matchRepetitive({ q: 'summarize ethereum gas fees', wallet: WALLET });
    expect(match).not.toBeNull();
    expect(match.reply).toContain('Gas fees');
    expect(match.fromChainHistory).toBe(true);
  });

  it('reindexes from chain fixtures', async () => {
    const chain = [{
      height: 1,
      stateTransitions: [{
        type: 'job-submitted',
        jobId: 'job-x',
        requesterAddress: WALLET,
        promptPreview: 'read farcaster vitalik',
        timestamp: 5000,
      }],
      scanResults: [{
        requestId: 'job-x',
        verdict: 'SKILL_RESULT',
        profile: { skillOutput: { username: 'vitalik' }, nlResponse: 'Recent casts about L2' },
      }],
    }];
    const { count } = await search.reindexAll(chain, []);
    expect(count).toBe(1);
    const { suggestions } = await search.suggest({ q: 'read far', wallet: WALLET });
    expect(suggestions[0].prompt).toContain('farcaster');
  });
});