import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createOpenAIHandler } from '../src/api/openai-compat.js';
import { isTrulyLocalRequest } from '../src/security/api-security.js';

// Fake QVAC: streams the configured tokens one by one, like the real tokenStream.
let nextTokens = ['Hel', 'lo', ' wor', 'ld'];
const calls = [];
const qvac = {
  ENABLED: true,
  listModels: async () => [{ name: 'qwen3-1.7b', label: 'Qwen3 1.7B', loaded: true, installed: true }],
  isInstalled: async () => true,
  chat: async (messages, opts) => {
    calls.push({ messages, opts });
    let text = '';
    let n = 0;
    for (const t of nextTokens) {
      text += t; n++;
      opts.onToken?.(t);
      if (opts.shouldStop?.()) break;
      if (opts.maxTokens && n >= opts.maxTokens) break;
    }
    const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return opts.withUsage ? { text: clean, promptTokens: 7, completionTokens: n, totalTokens: 7 + n } : clean;
  },
};

const paidCalls = [];
const node = {
  config: { llmApiKey: 'sekret-key' },
  _resolveRequestModel: (m) => m || 'qwen3-1.7b',
  _runPaidCompute: async (args) => {
    paidCalls.push(args);
    if (!args.requesterAddress) return { status: 402, code: 'REQUESTER_REQUIRED', error: 'requesterAddress is required for paid compute' };
    args.onToken?.('paid'); args.onToken?.('!');
    return { text: 'paid!', usage: { text: 'paid!', promptTokens: 3, completionTokens: 2, totalTokens: 5 }, fee: 5000, model: args.model };
  },
};

let server, base;
beforeAll(async () => {
  const handler = createOpenAIHandler(node, {
    getQvacModels: async () => qvac,
    isTrulyLocalRequest,
    materializeAttachments: () => ({ files: [], errors: [] }),
    maxAttachmentBytes: 1024,
  });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await handler(req, res, url))) { res.statusCode = 418; res.end('legacy'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/openai/v1`;
});
afterAll(() => new Promise(r => server.close(r)));

const post = (path, body, headers = {}) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const remote = { 'x-forwarded-for': '203.0.113.9' };   // what nginx stamps on external traffic

async function sseEvents(res) {
  const raw = await res.text();
  return raw.split('\n\n').filter(Boolean).map(b => {
    expect(b.startsWith('data: ')).toBe(true);
    const d = b.slice(6);
    return d === '[DONE]' ? d : JSON.parse(d);
  });
}

describe('routing', () => {
  it('leaves non-/openai paths to the caller', async () => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, { method: 'POST' });
    expect(r.status).toBe(418);
  });
  it('404s unknown /openai routes in the OpenAI error envelope', async () => {
    const r = await fetch(base + '/nope');
    expect(r.status).toBe(404);
    expect((await r.json()).error).toMatchObject({ type: 'invalid_request_error', code: 'unknown_route' });
  });
  it('405s a wrong method with Allow', async () => {
    const r = await fetch(base + '/chat/completions');
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('POST');
  });
  it('answers embeddings with a 501 envelope', async () => {
    const r = await post('/embeddings', { input: 'x' });
    expect(r.status).toBe(501);
    expect((await r.json()).error.code).toBe('not_implemented');
  });
});

describe('models', () => {
  it('lists in OpenAI shape', async () => {
    const j = await (await fetch(base + '/models')).json();
    expect(j.object).toBe('list');
    expect(j.data[0]).toMatchObject({ id: 'qwen3-1.7b', object: 'model', owned_by: 'dai' });
  });
  it('retrieves one, and 404s an unknown id', async () => {
    expect((await fetch(base + '/models/qwen3-1.7b')).status).toBe(200);
    const r = await fetch(base + '/models/gpt-4o');
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe('model_not_found');
  });
});

describe('POST /chat/completions', () => {
  it('returns a chat.completion with usage', async () => {
    nextTokens = ['Hel', 'lo', ' wor', 'ld'];
    const r = await post('/chat/completions', { model: 'qwen3-1.7b', messages: [{ role: 'user', content: 'hi' }] });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-dai-fee')).toBe('0');
    const j = await r.json();
    expect(j).toMatchObject({ object: 'chat.completion', model: 'qwen3-1.7b' });
    expect(j.id).toMatch(/^chatcmpl-/);
    expect(j.choices[0]).toMatchObject({ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Hello world' } });
    expect(j.usage).toEqual({ prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 });
  });

  it('maps developer→system and flattens text parts', async () => {
    calls.length = 0;
    await post('/chat/completions', { messages: [
      { role: 'developer', content: 'be brief' },
      { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    ] });
    expect(calls[0].messages).toEqual([{ role: 'system', content: 'be brief' }, { role: 'user', content: 'a\nb' }]);
  });

  it('reports finish_reason=length when max_tokens is hit', async () => {
    calls.length = 0;
    const j = await (await post('/chat/completions', { messages: [{ role: 'user', content: 'hi' }], max_tokens: 2 })).json();
    expect(calls[0].opts.maxTokens).toBe(2);
    expect(j.choices[0].finish_reason).toBe('length');
  });

  it('applies stop sequences, including one split across tokens', async () => {
    nextTokens = ['one ', 'two E', 'ND three'];
    const j = await (await post('/chat/completions', { messages: [{ role: 'user', content: 'x' }], stop: ['END'] })).json();
    expect(j.choices[0].message.content).toBe('one two ');
    expect(j.choices[0].finish_reason).toBe('stop');
  });

  it('streams SSE chunks that reassemble to the full text, then [DONE]', async () => {
    nextTokens = ['Hel', 'lo', ' wor', 'ld'];
    const r = await post('/chat/completions', { messages: [{ role: 'user', content: 'hi' }], stream: true, stream_options: { include_usage: true } });
    expect(r.headers.get('content-type')).toMatch(/text\/event-stream/);
    const ev = await sseEvents(r);
    expect(ev.at(-1)).toBe('[DONE]');
    const chunks = ev.filter(e => e !== '[DONE]');
    expect(chunks.every(c => c.object === 'chat.completion.chunk')).toBe(true);
    expect(new Set(chunks.map(c => c.id)).size).toBe(1);
    expect(chunks[0].choices[0].delta).toEqual({ role: 'assistant', content: '' });
    const text = chunks.map(c => c.choices[0]?.delta?.content || '').join('');
    expect(text).toBe('Hello world');
    const finish = chunks.find(c => c.choices[0]?.finish_reason);
    expect(finish.choices[0].finish_reason).toBe('stop');
    expect(chunks.at(-1)).toMatchObject({ choices: [], usage: { total_tokens: 11 } });
  });

  it('never leaks <think> blocks into streamed content, even split across tokens', async () => {
    nextTokens = ['<th', 'ink>plan', 'ning</thi', 'nk>\n', 'Answer', ' 42'];
    const ev = await sseEvents(await post('/chat/completions', { messages: [{ role: 'user', content: 'q' }], stream: true }));
    const text = ev.filter(e => e !== '[DONE]').map(c => c.choices[0]?.delta?.content || '').join('');
    expect(text).toBe('Answer 42');
  });

  it('stops a stream at a stop sequence without emitting it', async () => {
    nextTokens = ['keep ', 'this ST', 'OP drop'];
    const ev = await sseEvents(await post('/chat/completions', { messages: [{ role: 'user', content: 'q' }], stream: true, stop: 'STOP' }));
    expect(ev.filter(e => e !== '[DONE]').map(c => c.choices[0]?.delta?.content || '').join('')).toBe('keep this ');
  });

  it.each([
    ['tools', { tools: [{ type: 'function', function: { name: 'f' } }] }, 'tools'],
    ['n>1', { n: 2 }, 'n'],
    ['logprobs', { logprobs: true }, 'logprobs'],
    ['tool_choice', { tool_choice: { type: 'function' } }, 'tool_choice'],
  ])('refuses unsupported %s with a 400 naming the param', async (_l, extra, param) => {
    const r = await post('/chat/completions', { messages: [{ role: 'user', content: 'x' }], ...extra });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatchObject({ code: 'unsupported_parameter', param });
  });

  it('accepts an empty tools array (some clients always send it)', async () => {
    const r = await post('/chat/completions', { messages: [{ role: 'user', content: 'x' }], tools: [], tool_choice: 'none' });
    expect(r.status).toBe(200);
  });

  it('validates messages, roles and JSON', async () => {
    expect((await post('/chat/completions', {})).status).toBe(400);
    expect((await post('/chat/completions', { messages: [{ role: 'tool', content: 'x' }] })).status).toBe(400);
    expect((await post('/chat/completions', { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }] }] })).status).toBe(400);
    const bad = await fetch(base + '/chat/completions', { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('invalid_json');
  });

  it('404s an unknown model with the id-listing hint', async () => {
    const r = await post('/chat/completions', { model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toMatchObject({ code: 'model_not_found', param: 'model' });
  });
});

describe('access control', () => {
  it('bills a remote caller with no credentials → 402 in the envelope', async () => {
    const r = await post('/chat/completions', { messages: [{ role: 'user', content: 'x' }] }, remote);
    expect(r.status).toBe(402);
    expect((await r.json()).error).toMatchObject({ type: 'payment_required', code: 'requester_required' });
  });
  it('lets a remote caller in free with the configured Bearer llmApiKey', async () => {
    const r = await post('/chat/completions', { messages: [{ role: 'user', content: 'x' }] }, { ...remote, authorization: 'Bearer sekret-key' });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-dai-fee')).toBe('0');
  });
  it('rejects a wrong Bearer key', async () => {
    const r = await post('/chat/completions', { messages: [{ role: 'user', content: 'x' }] }, { ...remote, authorization: 'Bearer wrong-key!' });
    expect(r.status).toBe(402);
  });
  it('routes an explicit DAI bid through paid compute, even from localhost', async () => {
    paidCalls.length = 0;
    const r = await post('/chat/completions', {
      messages: [{ role: 'user', content: 'x' }], max_tokens: 9,
      dai: { jobId: 'j1', requesterAddress: 'dai' + 'a'.repeat(40), maxBudget: 100000, paymentTx: { txHash: 't', signature: 's' } },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-dai-fee')).toBe('5000');
    expect((await r.json()).choices[0].message.content).toBe('paid!');
    expect(paidCalls[0]).toMatchObject({ jobId: 'j1', maxBudget: 100000, maxTokens: 9 });
  });
  it('streams a paid run', async () => {
    const ev = await sseEvents(await post('/chat/completions', {
      messages: [{ role: 'user', content: 'x' }], stream: true,
      dai: { jobId: 'j2', requesterAddress: 'dai' + 'a'.repeat(40), maxBudget: 100000, paymentTx: { signature: 's' } },
    }));
    expect(ev.filter(e => e !== '[DONE]').map(c => c.choices[0]?.delta?.content || '').join('')).toBe('paid!');
  });
  it('keeps image decoding away from unauthenticated remote callers', async () => {
    const r = await post('/chat/completions', {
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }],
    }, remote);
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('images_not_available_for_paid');
  });
});

describe('POST /completions', () => {
  it('returns a text_completion', async () => {
    nextTokens = ['Hel', 'lo'];
    const j = await (await post('/completions', { prompt: 'say hi' })).json();
    expect(j).toMatchObject({ object: 'text_completion', choices: [{ text: 'Hello', finish_reason: 'stop' }] });
    expect(j.id).toMatch(/^cmpl-/);
  });
  it('refuses batched prompts and streaming', async () => {
    expect((await post('/completions', { prompt: ['a', 'b'] })).status).toBe(400);
    expect((await post('/completions', { prompt: 'a', stream: true })).status).toBe(400);
  });
});
