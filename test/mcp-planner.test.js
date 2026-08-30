import { describe, it, expect } from 'vitest';
import {
  extractJsonObject,
  validatePlannerPlan,
  planCatalogCascade,
  buildPlannerPrompt,
} from '../src/ai/mcp-planner.js';
import { retrieveCandidates } from '../src/ai/mcp-catalog.js';
import { extractUsefulFields, resolveTaskArgs, executeTaskCascade } from '../src/ai/task-cascade.js';
import { isMcpArgumentError } from '../src/ai/mcp-client.js';
import { DEFAULT_HTTP_MCPS, defaultHttpSeedCards } from '../src/ai/default-mcp-servers.js';
import { McpManager } from '../src/ai/mcp-client.js';

const weatherCard = {
  id: 'public-apis/weather',
  mcpId: 'public-apis',
  tool: 'public_weather_forecast',
  qualified: 'public-apis__public_weather_forecast',
  summary: '7-day forecast from city name or lat/lon',
  tags: ['weather', 'forecast'],
  triggers: ['weather', 'forecast'],
  tools: ['public_weather_forecast'],
  argKeys: ['city', 'query', 'latitude', 'longitude'],
  inputSchema: { properties: { city: {}, query: {}, latitude: {}, longitude: {} } },
};

const geoCard = {
  id: 'public-apis/geo',
  mcpId: 'public-apis',
  tool: 'public_geo_lookup',
  qualified: 'public-apis__public_geo_lookup',
  summary: 'Place name → lat/lon',
  tags: ['geo', 'map', 'travel'],
  triggers: ['geocode', 'places to visit', 'best places', 'visit in'],
  tools: ['public_geo_lookup'],
  argKeys: ['query', 'city', 'q'],
};

const TRAVEL = 'what are the best places to visit in Batumi, considering the weather forecast for the next week';

function travelLlm(prompt) {
  expect(prompt).toMatch(/public-apis\/weather/);
  expect(prompt).not.toMatch(/inputSchema/);
  expect(prompt).not.toMatch(/type": "object"/);
  return JSON.stringify({
    intent: 'travel in Batumi with next-week weather',
    abstain: false,
    stages: [
      {
        goal: 'resolve location and fetch the week forecast',
        tasks: [
          { kind: 'mcp', cardId: 'public-apis/geo', mcpId: 'public-apis', tool: 'public_geo_lookup', arguments: { query: 'Batumi' }, dependsOn: [], why: 'geocode' },
          { kind: 'mcp', cardId: 'public-apis/weather', mcpId: 'public-apis', tool: 'public_weather_forecast', arguments: { city: 'Batumi' }, dependsOn: [], why: 'forecast' },
        ],
      },
    ],
    synthesis_notes: 'Rank visit ideas using the forecast facts.',
  });
}

describe('extractJsonObject', () => {
  it('strips think tags and fences', () => {
    const raw = '<think>hmm</think>\n```json\n{"abstain":true,"stages":[]}\n```';
    expect(extractJsonObject(raw)).toEqual({ abstain: true, stages: [] });
  });
});

describe('validatePlannerPlan', () => {
  it('drops invented tool names', () => {
    const v = validatePlannerPlan({
      intent: 'x',
      stages: [{ tasks: [
        { kind: 'mcp', cardId: 'nope/nope', tool: 'invented', arguments: {} },
        { kind: 'mcp', cardId: 'public-apis/weather', tool: 'public_weather_forecast', arguments: { city: 'Batumi' } },
      ] }],
    }, { cards: [weatherCard] });
    expect(v.ok).toBe(true);
    const flat = v.plan.stages.flat();
    expect(flat).toHaveLength(1);
    expect(flat[0].bareTool).toBe('public_weather_forecast');
    expect(v.plan.dropped).toHaveLength(1);
  });
});

describe('planCatalogCascade', () => {
  it('extracts city for a weather+travel query, not the full sentence', async () => {
    const p = await planCatalogCascade(TRAVEL, {
      catalogCards: [weatherCard, geoCard],
      skills: [],
      llm: travelLlm,
      plannerEnabled: true,
    });
    expect(p.type).toBe('tasks');
    expect(p.planner).toBe(true);
    const mcp = p.stages.flat().filter(t => t.kind === 'mcp');
    expect(mcp.some(t => t.bareTool === 'public_weather_forecast')).toBe(true);
    expect(mcp.some(t => t.bareTool === 'public_geo_lookup')).toBe(true);
    for (const t of mcp) {
      const blob = JSON.stringify(t.arguments);
      expect(blob).toMatch(/Batumi/);
      expect(blob).not.toMatch(/considering the weather forecast/);
    }
  });

  it('splits A-then-B into stages when B depends on A', async () => {
    const p = await planCatalogCascade('geocode Batumi and then reverse those coordinates', {
      catalogCards: [geoCard, {
        id: 'public-apis/geo-reverse',
        mcpId: 'public-apis',
        tool: 'public_geo_reverse',
        qualified: 'public-apis__public_geo_reverse',
        summary: 'lat/lon → place',
        tags: ['geo'],
        triggers: ['reverse geocode', 'coordinates'],
        tools: ['public_geo_reverse'],
      }],
      skills: [],
      llm: async () => JSON.stringify({
        intent: 'geocode then reverse',
        stages: [{
          goal: 'both',
          tasks: [
            { kind: 'mcp', cardId: 'public-apis/geo', tool: 'public_geo_lookup', arguments: { query: 'Batumi' }, dependsOn: [] },
            { kind: 'mcp', cardId: 'public-apis/geo-reverse', tool: 'public_geo_reverse', arguments: { latitude: null, longitude: null }, dependsOn: ['public-apis/geo'] },
          ],
        }],
      }),
    });
    expect(p.stages.length).toBeGreaterThanOrEqual(2);
    expect(p.stages[0][0].bareTool).toBe('public_geo_lookup');
    expect(p.stages[1][0].bareTool).toBe('public_geo_reverse');
    expect(p.stages[1][0].dependsOn).toContain('mcp:public-apis__public_geo_lookup');
  });

  it('buy-intent still fans out ≤ maxParallel shop MCPs via heuristic when planner is off', async () => {
    const mcpTools = [
      { name: 'shopA__search', server: 'shopA', tool: 'search', description: 'search products' },
      { name: 'shopB__search', server: 'shopB', tool: 'search', description: 'product catalog' },
      { name: 'shopC__list', server: 'shopC', tool: 'list', description: 'list items' },
    ];
    const p = await planCatalogCascade('where do I buy wireless headphones', {
      skills: [], mcpTools, plannerEnabled: false,
    });
    expect(p.type).toBe('tasks');
    const mcpTasks = p.stages.flat().filter(t => t.kind === 'mcp');
    expect(mcpTasks.length).toBe(3);
    expect(mcpTasks.length).toBeLessThanOrEqual(4);
  });

  it('conversational messages abstain without calling the LLM', async () => {
    let called = false;
    const p = await planCatalogCascade('hello there', {
      catalogCards: [weatherCard],
      llm: async () => { called = true; return '{}'; },
    });
    expect(p.type).toBe('chat');
    expect(called).toBe(false);
  });

  it('parse failure falls back to the heuristic plan without throwing', async () => {
    const p = await planCatalogCascade('what is the weather in Tbilisi', {
      catalogCards: [weatherCard],
      skills: [],
      llm: async () => 'not json at all, sorry',
    });
    expect(p.type).toBe('tasks');
    expect(p.planner).toBeUndefined();
    expect(p.stages.flat().some(t => t.bareTool === 'public_weather_forecast')).toBe(true);
  });
});

describe('executor arg resolution', () => {
  it('fills lat/lon from a prior geo result', async () => {
    const geoOut = JSON.stringify({ query: 'Batumi', hits: [{ name: 'Batumi, Georgia', lat: 41.65, lon: 41.64 }] });
    const extracted = extractUsefulFields(geoOut);
    expect(extracted.latitude).toBe(41.65);
    expect(extracted.city).toMatch(/Batumi/);

    const args = resolveTaskArgs({
      kind: 'mcp',
      arguments: { latitude: null, longitude: null },
      dependsOn: ['mcp:geo'],
      inputSchema: { properties: { latitude: {}, longitude: {} } },
    }, {
      'mcp:geo': { ok: true, output: geoOut, extracted },
    }, TRAVEL);
    expect(args.latitude).toBe(41.65);
    expect(args.longitude).toBe(41.64);
  });

  it('keeps planner-supplied city and does not replace it with the full sentence', () => {
    const args = resolveTaskArgs({
      arguments: { city: 'Batumi' },
      inputSchema: weatherCard.inputSchema,
      dependsOn: [],
    }, {}, TRAVEL);
    expect(args.city).toBe('Batumi');
    expect(JSON.stringify(args)).not.toMatch(/considering/);
  });

  it('runs geo then weather and synthesizes with notes', async () => {
    const plan = await planCatalogCascade(TRAVEL, {
      catalogCards: [weatherCard, geoCard],
      llm: travelLlm,
    });
    const calls = [];
    const { reply, results } = await executeTaskCascade(plan, {
      model: 'qwen3-0.6b',
      runSkill: async () => ({}),
      callMcp: async (tool, args) => {
        calls.push({ tool, args });
        if (tool.includes('geo')) return JSON.stringify({ hits: [{ name: 'Batumi', lat: 41.65, lon: 41.64 }] });
        return JSON.stringify({ place: 'Batumi', daily: { temperature_2m_max: [24, 23] } });
      },
      llm: async (messages) => {
        const blob = JSON.stringify(messages);
        expect(blob).toMatch(/forecast facts|Rank visit|Batumi/i);
        return 'Sunny week in Batumi — walk the boulevard; max 24°C.';
      },
    }, TRAVEL);
    expect(calls.some(c => c.args.city === 'Batumi' || c.args.query === 'Batumi')).toBe(true);
    expect(calls.every(c => !String(c.args.city || c.args.query || '').includes('considering'))).toBe(true);
    expect(results.every(r => r.ok)).toBe(true);
    expect(reply).toMatch(/Batumi/);
  });
});

describe('isMcpArgumentError', () => {
  it('treats indexes required as malformed, not a peer outage', () => {
    expect(isMcpArgumentError(new Error('indexes required'))).toBe(true);
    expect(isMcpArgumentError(new Error('city or latitude+longitude required'))).toBe(true);
    expect(isMcpArgumentError(new Error('peer MCP HTTP 502'))).toBe(false);
    expect(isMcpArgumentError(new Error('fetch failed'))).toBe(false);
  });
});

describe('default HTTP MCPs', () => {
  it('ships the unauthenticated servers as catalog seed cards', () => {
    expect(Object.keys(DEFAULT_HTTP_MCPS).sort()).toEqual([
      'ai-portal', 'airshelf', 'akari', 'akari-trust', 'atars', 'goji', 'inside-ads', 'tandem',
    ]);
    const cards = defaultHttpSeedCards();
    expect(cards.some(c => c.mcpId === 'tandem' && c.tool === 'search_docs')).toBe(true);
    expect(cards.some(c => c.mcpId === 'airshelf')).toBe(true);
  });

  it('listCards includes seed cards without connecting, and mute works', async () => {
    const mgr = new McpManager(() => ({ mcpBuiltin: { enabled: false } }));
    await mgr.connectAll();
    const ids = mgr.listCards().map(c => c.mcpId);
    expect(ids).toContain('tandem');
    expect(ids).toContain('goji');
    mgr.closeAll();

    const muted = new McpManager(() => ({
      mcpBuiltin: { enabled: false },
      mcpDefaultHttp: { enabled: true, disabled: ['goji'] },
    }));
    await muted.connectAll();
    expect(muted.listCards().map(c => c.mcpId)).not.toContain('goji');
    expect(muted.listCards().map(c => c.mcpId)).toContain('tandem');
    muted.closeAll();
  });

  it('retrieveCandidates still surfaces weather for a travel+forecast query', () => {
    const cards = [weatherCard, geoCard, ...defaultHttpSeedCards()];
    const r = retrieveCandidates(TRAVEL, { cards, retrieveK: 12 });
    expect(r.cards.some(c => c.tool === 'public_weather_forecast')).toBe(true);
    expect(r.cards.some(c => c.tool === 'public_geo_lookup')).toBe(true);
  });
});

describe('planner prompt stays catalog-sized', () => {
  it('lists compact card lines with arg keys, not schemas', () => {
    const prompt = buildPlannerPrompt(TRAVEL, { cards: [weatherCard, geoCard], skills: [] }, {});
    expect(prompt).toMatch(/^A\. public-apis\/weather/m);
    expect(prompt).toMatch(/\[args: city,query,latitude,longitude\]/);
    expect(prompt).not.toMatch(/"type":"object"/);
  });
});
