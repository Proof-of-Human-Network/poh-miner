import { describe, it, expect } from 'vitest';
import { httpHeadersFromSpec, McpManager } from '../src/ai/mcp-client.js';
import { loadBuiltinPacks, listBuiltinTools } from '../src/ai/builtin-mcp/index.js';
import { searchCards, isConversational } from '../src/ai/mcp-catalog.js';
import { pickToolsForMessage } from '../src/ai/mcp-router.js';
import { assignMcpToPeers, replicasFor } from '../src/ai/mcp-disperse.js';
import { planTaskCascade } from '../src/ai/task-cascade.js';

describe('httpHeadersFromSpec', () => {
  it('sets Bearer only when Authorization is not already provided', () => {
    expect(httpHeadersFromSpec({ apiKey: 'abc' })['Authorization']).toBe('Bearer abc');
    const custom = httpHeadersFromSpec({
      apiKey: 'abc',
      headers: { Authorization: 'Api-Key xyz', 'X-User': '1' },
    });
    expect(custom['Authorization']).toBe('Api-Key xyz');
    expect(custom['X-User']).toBe('1');
  });

  it('accepts arbitrary header names', () => {
    const h = httpHeadersFromSpec({ headers: { 'X-Api-Key': 'k', Accept: 'application/json' } });
    expect(h['X-Api-Key']).toBe('k');
    expect(h['Accept']).toBe('application/json');
  });
});

describe('builtin packs', () => {
  it('ships 22 public-apis tools plus onion-search', () => {
    const packs = loadBuiltinPacks();
    expect(packs.map(p => p.id).sort()).toEqual(['onion-search', 'public-apis']);
    const tools = listBuiltinTools();
    expect(tools.filter(t => t.server === 'public-apis')).toHaveLength(22);
    expect(tools.map(t => t.name)).toEqual(expect.arrayContaining([
      'public-apis__public_weather_forecast',
      'public-apis__public_crypto_price',
      'onion-search__get_sources',
      'onion-search__fetch_pages',
      'onion-search__fetch_specific_page',
    ]));
  });

  it('honors per-tool mute', () => {
    const tools = listBuiltinTools({ disabled: ['public_qrcode_generate'] });
    expect(tools.map(t => t.tool)).not.toContain('public_qrcode_generate');
    expect(tools.filter(t => t.server === 'public-apis')).toHaveLength(21);
  });

  it('runs weather via Open-Meteo after geocoding a city', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('nominatim')) {
        return { ok: true, json: async () => [{ lat: '41.7', lon: '44.8', display_name: 'Tbilisi' }] };
      }
      if (u.includes('open-meteo')) {
        return { ok: true, json: async () => ({ current_weather: { temperature: 18, windspeed: 2 } }) };
      }
      throw new Error('unexpected ' + u);
    };
    try {
      const pack = loadBuiltinPacks().find(p => p.id === 'public-apis');
      const tool = pack.tools.find(t => t.name === 'public_weather_forecast');
      const out = JSON.parse(await tool.run({ city: 'Tbilisi' }));
      expect(out.place).toMatch(/Tbilisi/);
      expect(out.current_weather.temperature).toBe(18);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('catalog + router', () => {
  it('skips conversational messages and matches weather triggers', async () => {
    const mgr = new McpManager(() => ({}));
    await mgr.connectAll();
    const cards = mgr.listCards();
    expect(isConversational('hi')).toBe(true);
    expect(searchCards(cards, 'weather in Tbilisi', 5).some(c => c.tool === 'public_weather_forecast')).toBe(true);

    const skip = await pickToolsForMessage('thanks', { cards, tools: mgr.listTools() });
    expect(skip.reason).toBe('skip');
    expect(skip.toolNames).toEqual([]);

    const hit = await pickToolsForMessage('what is the weather in Tokyo', { cards, tools: mgr.listTools() });
    expect(hit.toolNames).toContain('public-apis__public_weather_forecast');

    const exact = await pickToolsForMessage('use onion-search MCP for this', { cards, tools: mgr.listTools() });
    expect(exact.reason).toBe('exact');
    expect(exact.toolNames.some(n => n.startsWith('onion-search__'))).toBe(true);
    mgr.closeAll();
  });
});

describe('dispersal', () => {
  it('assigns 20 mcp ids to 20 distinct peers', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `mcp-${i}`);
    const peers = Array.from({ length: 20 }, (_, i) => `http://10.0.0.${i + 1}:3456`);
    const map = assignMcpToPeers(ids, peers);
    expect(map.size).toBe(20);
    expect(new Set(map.values()).size).toBe(20);
  });

  it('falls back to local when no peers exist', () => {
    const map = assignMcpToPeers(['weather'], []);
    expect(map.get('weather')).toBe('local');
  });

  it('picks a stable replica set', () => {
    const peers = ['http://a:1', 'http://b:1', 'http://c:1', 'http://d:1'];
    expect(replicasFor('public-apis', peers, 3)).toHaveLength(3);
    expect(replicasFor('public-apis', peers, 3)).toEqual(replicasFor('public-apis', peers, 3));
  });
});

describe('task cascade + catalog', () => {
  it('plans builtin weather MCP instead of web_search when cards match', () => {
    const cards = [
      {
        id: 'public-apis/weather',
        mcpId: 'public-apis',
        tool: 'public_weather_forecast',
        qualified: 'public-apis__public_weather_forecast',
        summary: 'forecast',
        tags: ['weather'],
        triggers: ['weather', 'forecast'],
        tools: ['public_weather_forecast'],
      },
    ];
    const p = planTaskCascade('what is the weather in Tbilisi', {
      skills: [{ id: 'web_search', status: 'active', hasCode: true, context: 'search', triggers: ['weather'] }],
      mcpTools: [],
      catalogCards: cards,
    });
    expect(p.type).toBe('tasks');
    const flat = p.stages.flat();
    expect(flat.some(t => t.kind === 'mcp' && t.bareTool === 'public_weather_forecast')).toBe(true);
    expect(flat.some(t => t.skillId === 'web_search')).toBe(false);
  });

  it('caps buy-intent MCP fan-out', () => {
    const mcpTools = Array.from({ length: 30 }, (_, i) => ({
      name: `shop${i}__search`, server: `shop${i}`, tool: 'search', description: 'search products',
    }));
    const p = planTaskCascade('where do I buy widgets', { skills: [], mcpTools });
    const mcpTasks = p.stages.flat().filter(t => t.kind === 'mcp');
    expect(mcpTasks.length).toBeLessThanOrEqual(8);
    expect(mcpTasks.length).toBeGreaterThan(0);
  });
});
