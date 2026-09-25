import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { estimateJob, EstimateError, DEFAULT_OUTPUT_TOKENS, LIMITS } from '../src/jobs/estimate.js';
import { estimateTokens, estimateChatTokens } from '../src/jobs/gas-estimator.js';
import { DIRECT_SYSTEM_PROMPT, datasetJobSystemPrompt, knowledgeSkillSystemPrompt } from '../src/jobs/prompts.js';
import { buildAggregatorPrompt } from '../src/ai/task-cascade.js';
import { SKILL_TOKEN_COSTS } from '../src/skills/manager.js';

// The node's metering, re-derived here on purpose: if the estimator drifts from it, these fail.
const est = (messages, sys) => {
  const rows = [...messages]; if (sys) rows.push({ content: sys });
  let c = 0; for (const m of rows) c += (m.content?.length || 0) + 4;
  return Math.ceil(c / 4);
};

const SKILLS = {
  web_search: { id: 'web_search', private: true, code: 'x', context: 'search ctx', manifest: { allowedEndpoints: ['a', 'b'] } },
  read_farcaster: { id: 'read_farcaster', private: true, code: 'x', context: 'fc ctx', manifest: { allowedEndpoints: ['a'] } },
  eth_docs: { id: 'eth_docs', private: true, context: 'R'.repeat(4000), manifest: {} },
  netskill: { id: 'netskill', private: false, code: 'x', context: 'n', networkSourced: true, trusted: false, manifest: {} },
};

function makeDeps(over = {}) {
  return {
    qvac: { estimateMessagesTokens: est },
    config: {},
    maxAttachmentBytes: 1024 * 1024,
    resolveModel: (m, { hasImages }) => (hasImages ? 'qwen3vl-2b' : m || 'qwen3-1.7b'),
    normalizeCurrency: (c) => String(c).toUpperCase() === 'DAI' ? 'DAI' : c,
    isKnownCurrency: (c) => ['DAI', 'aiETB'].includes(c),
    quoteFee: (tokens, cur) => ({ raw: Math.ceil(tokens * 0.0064), source: 'p2p-direct', display: 0.0064 }),
    getSkill: (id) => SKILLS[id] || null,
    isSkillEnabled: () => true,
    route: vi.fn(async () => ({ route: { type: 'chat' }, plannerPrompt: null })),
    datasetSlice: async (id) => id === 'ds/ok' ? { installed: true, slice: 'row '.repeat(500) } : { installed: false, slice: null },
    history: async (_addr, h) => h || [],
    feedbackGuidance: async () => '',
    skillSystemPrompt: (id, ctx) => `SKILLSYS:${id}:${ctx || ''}`,
    socialSkillIds: new Set(['read_farcaster']),
    mcpToolExists: (t) => t === 'shop__search',
    ...over,
  };
}

const run = (input, over) => estimateJob(input, makeDeps(over));
const fail = async (input, over) => { try { await run(input, over); } catch (e) { return e; } throw new Error('expected EstimateError'); };

describe('direct compute job', () => {
  it('sizes system + prompt exactly and floors at the /job gate', async () => {
    const r = await run({ prompt: 'Hello there' });
    expect(r.route.mode).toBe('direct');
    const prompt = est([{ role: 'user', content: 'Hello there' }], DIRECT_SYSTEM_PROMPT);
    expect(r.tokens.prompt).toEqual({ min: prompt, max: prompt });
    expect(r.tokens.output).toEqual({ min: 1, max: DEFAULT_OUTPUT_TOKENS });
    expect(r.fees.minimum).toMatchObject({ tokens: estimateTokens(0, undefined), raw: estimateTokens(0, undefined), gate: '/job' });
    expect(r.fees.recommended.tokens).toBe(Math.max(estimateTokens(0, undefined), prompt + DEFAULT_OUTPUT_TOKENS));
  });

  it('caps job output at the model default and says so when more is asked for', async () => {
    const r = await run({ prompt: 'hi', maxOutputTokens: 3000 });
    expect(r.tokens.output.max).toBe(DEFAULT_OUTPUT_TOKENS);
    expect(r.warnings.join(' ')).toMatch(/capped at 512/);
  });

  it('reports how much output the recommended bid actually buys', async () => {
    const r = await run({ prompt: 'hi' });
    expect(r.outputCap).toMatchObject({ budgetCapApplies: true });
    expect(r.outputCap.tokens).toBe(DEFAULT_OUTPUT_TOKENS);
  });

  it('includes client history and per-turn truncation', async () => {
    const long = 'z'.repeat(LIMITS.HISTORY_TURN_CHARS + 500);
    const r = await run({ prompt: 'q', history: [{ role: 'user', content: long }, { role: 'assistant', content: 'a' }, { role: 'tool', content: 'ignored' }] });
    const hist = [{ role: 'user', content: 'z'.repeat(LIMITS.HISTORY_TURN_CHARS) }, { role: 'assistant', content: 'a' }];
    const expected = est([...hist, { role: 'user', content: 'q' }], DIRECT_SYSTEM_PROMPT);
    expect(r.tokens.prompt.max).toBe(expected);
    expect(r.breakdown.find(b => b.kind === 'history').tokens.min).toBe(est(hist));
  });
});

describe('attachments', () => {
  it('inlines text attachments into the prompt, measured', async () => {
    const body = 'line of a file\n'.repeat(200);
    const r = await run({ prompt: 'summarise', attachments: [{ name: 'notes.txt', text: body }] });
    const content = `summarise\n\n[Attached file: notes.txt]\n\`\`\`\n${body}\n\`\`\``;
    expect(r.tokens.prompt.max).toBe(est([{ role: 'user', content }], DIRECT_SYSTEM_PROMPT));
    expect(r.breakdown.find(b => b.kind === 'attachment')).toMatchObject({ ref: 'notes.txt', basis: 'measured' });
  });

  it('does not write image files, skips routing, and flags that images are not metered', async () => {
    const spy = vi.spyOn(fs, 'writeFileSync');
    const deps = makeDeps();
    const png = 'data:image/png;base64,' + Buffer.from('not really a png').toString('base64');
    const r = await estimateJob({ prompt: 'what is this', attachments: [{ name: 'a.png', dataUrl: png }] }, deps);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(deps.route).not.toHaveBeenCalled();
    expect(r.model).toBe('qwen3vl-2b');
    expect(r.route.reason).toMatch(/image/);
    expect(r.warnings.join(' ')).toMatch(/meters text only/);
  });

  it('rejects unusable attachments', async () => {
    const e = await fail({ prompt: 'x', attachments: [{ name: 'a.exe', contentBase64: 'AAAA' }] });
    expect(e).toMatchObject({ status: 400, code: 'attachment_error' });
  });

  it('routes on the prompt as it stands after attachment text is folded in', async () => {
    const deps = makeDeps();
    await estimateJob({ prompt: 'check this', attachments: [{ name: 'n.md', text: 'hello' }] }, deps);
    expect(deps.route.mock.calls[0][0]).toContain('[Attached file: n.md]');
  });
});

describe('dataset', () => {
  it('measures the slice the executor would inject', async () => {
    const r = await run({ prompt: 'top rows?', dataset: 'ds/ok' });
    const system = datasetJobSystemPrompt('ds/ok', 'row '.repeat(500));
    expect(r.tokens.prompt.max).toBe(est([{ role: 'system', content: system }, { role: 'user', content: 'top rows?' }]));
    expect(r.route.mode).toBe('direct');
    expect(r.route.reason).toMatch(/dataset pinned/);
  });
  it('fails like the job would when the dataset is not installed', async () => {
    expect(await fail({ prompt: 'x', dataset: 'ds/missing' })).toMatchObject({ status: 422, code: 'dataset_not_installed' });
  });
});

describe('skills', () => {
  it('bounds an executable skill: fetched data is capped, compute follows the manifest', async () => {
    const r = await run({ prompt: 'latest posts of dwr', skillId: 'web_search' });
    expect(r.route).toMatchObject({ mode: 'routed-skill', skillId: 'web_search' });
    const sys = { role: 'system', content: 'SKILLSYS:web_search:search ctx' };
    const userAt = (n) => ({ role: 'user', content: `Fetched data:\n${'x'.repeat(n)}\n\nUser question: latest posts of dwr` });
    expect(r.tokens.prompt).toEqual({ min: est([sys, userAt(0)]), max: est([sys, userAt(LIMITS.SKILL_DATA_CHARS)]) });
    // two allowed endpoints → 2 × 50 × 3 fetches + 15s of compute
    const maxCompute = 2 * SKILL_TOKEN_COSTS.PER_FETCH * 3 + Math.ceil(SKILL_TOKEN_COSTS.TIMEOUT_MS / 100) * SKILL_TOKEN_COSTS.PER_100MS;
    expect(r.tokens.skillCompute).toEqual({ min: SKILL_TOKEN_COSTS.BASE, max: maxCompute });
    expect(r.outputCap.budgetCapApplies).toBe(false);
    expect(r.tokens.total.max).toBe(r.tokens.prompt.max + r.tokens.output.max + maxCompute);
  });

  it('gives social skills the larger data window', async () => {
    const r = await run({ prompt: 'who is dwr', skillId: 'read_farcaster' });
    expect(r.breakdown.find(b => b.id === 'skill:read_farcaster').tokens.max).toBe(Math.ceil(LIMITS.SKILL_DATA_CHARS_SOCIAL / 4));
  });

  it('measures a knowledge-only skill exactly (no fetch, no range)', async () => {
    const r = await run({ prompt: 'how do L2s work', skillId: 'eth_docs' });
    const msgs = [{ role: 'system', content: knowledgeSkillSystemPrompt('eth_docs', SKILLS.eth_docs.context) }, { role: 'user', content: 'how do L2s work' }];
    expect(r.tokens.prompt).toEqual({ min: est(msgs), max: est(msgs) });
    expect(r.tokens.skillCompute).toEqual({ min: 0, max: 0 });
  });

  it('adds feedback guidance to model calls made through _llmChat', async () => {
    const plain = await run({ prompt: 'how do L2s work', skillId: 'eth_docs' });
    const guided = await run({ prompt: 'how do L2s work', skillId: 'eth_docs' }, { feedbackGuidance: async () => 'G'.repeat(400) });
    expect(guided.tokens.prompt.max).toBeGreaterThan(plain.tokens.prompt.max);
  });

  it('warns about a skill this node will not execute, and 404s an unknown one', async () => {
    expect((await run({ prompt: 'x', skillId: 'netskill' })).warnings.join(' ')).toMatch(/not executable/);
    expect(await fail({ prompt: 'x', skillId: 'nope' })).toMatchObject({ status: 404, code: 'skill_not_found' });
  });

  it('a skill job with a question sizes the answer call; without one it makes no model call', async () => {
    const withQ = await run({ type: 'skill', skillId: 'web_search', prompt: 'summarise' });
    expect(withQ.route.mode).toBe('skill-job');
    expect(withQ.calls).toHaveLength(1);
    const bare = await run({ type: 'skill', skillId: 'web_search' });
    expect(bare.calls).toHaveLength(0);
    expect(bare.tokens.skillCompute.min).toBe(SKILL_TOKEN_COSTS.BASE);
    expect(bare.warnings.join(' ')).toMatch(/no model call/);
  });
});

describe('MCP and cascades', () => {
  it('a requested MCP tool becomes a cascade: bounded result read by an aggregator call', async () => {
    const r = await run({ prompt: 'find red shoes', mcp: ['shop__search'] });
    expect(r.route).toMatchObject({ mode: 'cascade', tasks: [{ id: 'mcp:shop__search', kind: 'mcp' }] });
    expect(r.calls.map(c => c.purpose)).toEqual(['aggregator']);
    const head = '### mcp:shop__search (mcp @shop)\n';
    const plan = { type: 'tasks', reason: 'requested-mcp' };
    const min = buildAggregatorPrompt('find red shoes', head, plan);
    const max = buildAggregatorPrompt('find red shoes', head + 'x'.repeat(LIMITS.CASCADE_BLOCK_CHARS), plan);
    expect(r.calls[0].promptTokens).toEqual({
      min: est([{ role: 'system', content: min.system }, { role: 'user', content: min.user }]),
      max: est([{ role: 'system', content: max.system }, { role: 'user', content: max.user }]),
    });
    expect(r.warnings.join(' ')).not.toMatch(/not connected/);
  });

  it('warns when a requested MCP tool is not connected', async () => {
    const r = await run({ prompt: 'x', mcp: ['ghost__tool'] });
    expect(r.warnings.join(' ')).toMatch(/ghost__tool is not connected/);
  });

  it('predicts a routed cascade, counting the planner prompt and each specialist', async () => {
    const plan = {
      type: 'tasks', reason: 'test', stages: [[
        { kind: 'skill', id: 'skill:web_search', skillId: 'web_search' },
        { kind: 'mcp', id: 'mcp:shop__search', server: 'shop', tool: 'shop__search' },
      ]],
    };
    const r = await run({ prompt: 'weather in astana and shoes' }, {
      route: async () => ({ route: { type: 'tasks', tasks: plan, reason: 'test' }, plannerPrompt: 'P'.repeat(2000) }),
    });
    expect(r.route).toMatchObject({ mode: 'cascade', predicted: true });
    expect(r.calls.map(c => c.purpose)).toEqual(['planner', 'aggregator']);
    expect(r.calls[0].promptTokens.min).toBe(est([{ role: 'user', content: 'P'.repeat(2000) }]));
    expect(r.tokens.skillCompute.max).toBeGreaterThan(0);
    expect(r.tokens.total.max).toBeGreaterThan(r.tokens.total.min);
    expect(r.warnings.join(' ')).toMatch(/predicted/);
  });

  it('falls back to a plain call when routing throws', async () => {
    const r = await run({ prompt: 'x' }, { route: async () => { throw new Error('boom'); } });
    expect(r.route.mode).toBe('direct');
  });

  it('route:false and image jobs never consult the router', async () => {
    const deps = makeDeps();
    await estimateJob({ prompt: 'x', route: false }, deps);
    expect(deps.route).not.toHaveBeenCalled();
  });
});

describe('chat target', () => {
  it('floors at the prompt alone and honours max_tokens (no persona, no history merge)', async () => {
    const messages = [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }];
    const r = await run({ messages, max_tokens: 900 });
    expect(r.target).toBe('chat');
    expect(r.tokens.prompt.max).toBe(est(messages));
    expect(r.tokens.output.max).toBe(900);
    expect(r.fees.minimum.tokens).toBe(estimateChatTokens(est(messages), 0));
    expect(r.fees.minimum.gate).toMatch(/openai\/v1/);
    expect(r.outputCap.tokens).toBe(900);
  });
});

describe('fees in other currencies', () => {
  it('quotes through the live converter and keeps a DAI figure alongside', async () => {
    const r = await run({ prompt: 'hi', currency: 'aiETB' });
    expect(r.fees.currency).toBe('aiETB');
    expect(r.fees.recommended).toMatchObject({ currency: 'aiETB', source: 'p2p-direct' });
    expect(r.fees.dai.recommended.raw).toBe(r.fees.recommended.tokens);
  });
  it('reports a pair nobody quotes instead of inventing a price', async () => {
    const r = await run({ prompt: 'hi', currency: 'aiETB' }, { quoteFee: () => ({ unavailable: true, message: 'no market' }) });
    expect(r.fees.recommended).toMatchObject({ unavailable: true, message: 'no market' });
    expect(r.fees.dai.minimum.raw).toBeGreaterThan(0);
  });
  it('honours config.gasPrice', async () => {
    const r = await run({ prompt: 'hi' }, { config: { gasPrice: 3 } });
    expect(r.fees.minimum.raw).toBe(estimateTokens(0, undefined) * 3);
  });
});

describe('validation', () => {
  it.each([
    [{}, 'missing_prompt'],
    [{ prompt: 'x', messages: [{ role: 'user', content: 'y' }] }, 'ambiguous_input'],
    [{ prompt: 'x', type: 'bogus' }, 'invalid_type'],
    [{ type: 'skill' }, 'missing_skill'],
    [{ prompt: 'x', currency: 'NOPE' }, 'unknown_currency'],
    [{ prompt: 'x', maxOutputTokens: 99999 }, 'invalid_field'],
    [{ messages: [{ role: 'tool', content: 'y' }] }, 'invalid_role'],
    [{ prompt: 'x', mcp: 'shop__search' }, 'invalid_field'],
  ])('rejects %j with %s', async (input, code) => {
    const e = await fail(input);
    expect(e).toBeInstanceOf(EstimateError);
    expect(e.code).toBe(code);
    expect(e.status).toBeGreaterThanOrEqual(400);
  });
});
