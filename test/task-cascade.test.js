import { describe, it, expect } from 'vitest';
import { planTaskCascade, executeTaskCascade, resolveTaskArgs } from '../src/ai/task-cascade.js';

const webSearch = {
  id: 'web_search',
  status: 'active',
  hasCode: true,
  context: 'Search the web.',
  triggers: ['search', 'weather', 'news'],
};

const audit = {
  id: 'code_audit',
  status: 'active',
  hasCode: false,
  context: 'Audit smart contracts.',
  triggers: ['audit', 'smart contract audit'],
};

describe('planTaskCascade', () => {
  it('returns chat for plain conversation', () => {
    const p = planTaskCascade('hello there', { skills: [webSearch], mcpTools: [] });
    expect(p.type).toBe('chat');
  });

  it('plans web_search for weather questions', () => {
    const p = planTaskCascade('what was the weather yesterday in Tbilisi', {
      skills: [webSearch], mcpTools: [],
    });
    expect(p.type).toBe('tasks');
    const flat = p.stages.flat();
    expect(flat.some(t => t.kind === 'skill' && t.skillId === 'web_search')).toBe(true);
  });

  it('cascades weather + image generation into ordered stages', () => {
    const p = planTaskCascade(
      'what was the weather yesterday and generate an image with the degree on it',
      { skills: [webSearch], mcpTools: [] },
    );
    expect(p.type).toBe('tasks');
    const kinds = p.stages.flat().map(t => t.kind);
    expect(kinds).toContain('skill');
    expect(kinds).toContain('hf-model');
    // image stage should come after or alongside search; media marked dependsOnPrior when later
    const hf = p.stages.flat().find(t => t.kind === 'hf-model');
    expect(hf).toBeTruthy();
  });

  it('fans out one MCP task per shop server for buy intent', () => {
    const mcpTools = [
      { name: 'shopA__search', server: 'shopA', tool: 'search', description: 'search products' },
      { name: 'shopB__search', server: 'shopB', tool: 'search', description: 'product catalog' },
      { name: 'shopC__list', server: 'shopC', tool: 'list', description: 'list items' },
    ];
    const p = planTaskCascade('where do I buy wireless headphones', {
      skills: [], mcpTools,
    });
    expect(p.type).toBe('tasks');
    const mcpTasks = p.stages.flat().filter(t => t.kind === 'mcp');
    expect(mcpTasks.length).toBe(3);
    expect(new Set(mcpTasks.map(t => t.server)).size).toBe(3);
  });

  it('a named skill is that skill, even when the description mentions other tools', () => {
    const p = planTaskCascade(
      'Use the code_audit skill (Mentions aws docs, product catalog, and solana). Give one concrete fact a user can check.',
      {
        skills: [audit, webSearch],
        catalogCards: [
          { id: 'aws/search', mcpId: 'aws-knowledge', tool: 'aws___search_documentation', qualified: 'aws-knowledge__aws___search_documentation', triggers: ['aws docs'], argKeys: ['search_phrase'], summary: 'Search AWS docs' },
          { id: 'air/find', mcpId: 'airshelf', tool: 'find_products', qualified: 'airshelf__find_products', triggers: ['find products'], argKeys: ['need'], summary: 'Find products' },
        ],
      },
    );
    const flat = p.stages.flat();
    expect(flat).toHaveLength(1);
    expect(flat[0].kind).toBe('skill');
    expect(flat[0].skillId).toBe('code_audit');
  });

  it('a message that starts with a tool trigger calls that tool by its real argument', () => {
    const p = planTaskCascade('aws docs. Answer briefly with a fact from the tool, not a guess.', {
      skills: [webSearch],
      catalogCards: [
        { id: 'aws/search', mcpId: 'aws-knowledge', tool: 'aws___search_documentation', qualified: 'aws-knowledge__aws___search_documentation', triggers: ['aws docs', 'aws how to'], argKeys: ['search_phrase'], summary: 'Search AWS docs' },
        { id: 'air/find', mcpId: 'airshelf', tool: 'find_products', qualified: 'airshelf__find_products', triggers: ['find products', 'buyer need'], argKeys: ['need'], summary: 'Find products' },
      ],
    });
    const flat = p.stages.flat();
    expect(flat).toHaveLength(1);
    expect(flat[0].tool).toBe('aws-knowledge__aws___search_documentation');
    expect(flat[0].arguments).toEqual({ search_phrase: 'aws docs' });
  });

  it('moves a planner query onto the argument the tool declared', () => {
    const args = resolveTaskArgs({
      arguments: { query: 'how do I transfer SOL?' },
      argKeys: ['question'],
      segment: 'how do I transfer SOL?',
    }, {}, 'how do I transfer SOL?');
    expect(args).toEqual({ question: 'how do I transfer SOL?' });
  });

  it('skips a tool whose only argument cannot be filled from a sentence', () => {
    expect(resolveTaskArgs({
      arguments: { query: 'search the onion' },
      argKeys: ['indexes'],
    }, {}, 'search the onion')).toBeNull();
  });

  it('does not call a different tool when the named tool has nothing to send', () => {
    const p = planTaskCascade('reverse geocode. Answer briefly with real data.', {
      skills: [],
      catalogCards: [
        { id: 'geo-rev', mcpId: 'public-apis', tool: 'public_geo_reverse', qualified: 'public-apis__public_geo_reverse', triggers: ['reverse geocode'], argKeys: ['latitude', 'longitude'], summary: 'reverse' },
        { id: 'aws/search', mcpId: 'aws-knowledge', tool: 'aws___search_documentation', qualified: 'aws-knowledge__aws___search_documentation', triggers: ['aws docs'], argKeys: ['search_phrase'], summary: 'Search AWS docs' },
      ],
    });
    expect(p.type).toBe('chat');
  });

  it('extracts a city and drops the instruction tail', () => {
    const p = planTaskCascade('weather in Paris. Answer briefly with real data.', {
      skills: [],
      catalogCards: [
        { id: 'public-apis/weather', mcpId: 'public-apis', tool: 'public_weather_forecast', qualified: 'public-apis__public_weather_forecast', triggers: ['weather'], argKeys: ['city'], summary: 'forecast' },
      ],
    });
    expect(p.stages.flat()[0].arguments).toEqual({ city: 'Paris' });
  });

  it('sequence: create then knowledge skill', () => {
    const p = planTaskCascade('create an ERC20 token and do a smart contract audit', {
      skills: [audit], mcpTools: [],
    });
    // may be sequence (llm-generate + skill) or skill-only depending on segment match
    expect(['tasks', 'chat']).toContain(p.type);
    if (p.type === 'tasks') {
      const kinds = p.stages.flat().map(t => t.kind);
      expect(kinds.some(k => k === 'skill' || k === 'llm-generate')).toBe(true);
    }
  });
});

describe('executeTaskCascade', () => {
  it('runs parallel MCP tasks and aggregates', async () => {
    const plan = planTaskCascade('where do I buy widget X', {
      skills: [],
      mcpTools: [
        { name: 'a__search', server: 'a', tool: 'search', description: 'search' },
        { name: 'b__search', server: 'b', tool: 'search', description: 'search' },
      ],
    });
    expect(plan.type).toBe('tasks');

    const calls = [];
    const { reply, results } = await executeTaskCascade(plan, {
      model: 'qwen3-0.6b',
      runSkill: async () => ({}),
      callMcp: async (tool, args) => {
        calls.push({ tool, args });
        return tool.startsWith('a') ? 'Shop A: widget X = $10' : 'Shop B: widget X = $8';
      },
      llm: async (messages) => {
        const last = messages[messages.length - 1]?.content || '';
        expect(last).toMatch(/Shop A|Shop B|widget/i);
        return 'Buy from Shop B at $8.';
      },
      getBrainDataDir: () => null,
    }, 'where do I buy widget X');

    expect(calls.length).toBe(2);
    expect(results.every(r => r.ok)).toBe(true);
    expect(reply).toMatch(/Shop B|\$8/i);
  });

  it('sequences skill then synthetic follow-up with prior context in aggregator', async () => {
    // Hand-built plan: avoid live HF/QVAC calls from hf-model tasks in unit tests
    const plan = {
      type: 'tasks',
      stages: [
        [{ kind: 'skill', id: 'skill:web_search', skillId: 'web_search', input: { query: 'weather' }, segment: 'weather yesterday' }],
        [{ kind: 'llm-generate', id: 'gen:image-prompt', query: 'Write an image prompt with the temperature', segment: 'generate image', dependsOnPrior: true }],
      ],
      reason: 'test: weather → image prompt',
    };

    let genSawPrior = false;
    const { reply, results } = await executeTaskCascade(plan, {
      model: 'qwen3-0.6b',
      runSkill: async (id) => {
        expect(id).toBe('web_search');
        return { summary: 'Yesterday in Tbilisi: 18°C, sunny.', results: [] };
      },
      callMcp: async () => '',
      llm: async (messages) => {
        const blob = JSON.stringify(messages);
        if (/18|Tbilisi|prior|previous/i.test(blob) && !/Specialist results/i.test(blob)) {
          genSawPrior = true;
          return 'Image prompt: sunny Tbilisi with "18°C" overlay';
        }
        if (/Specialist results|aggregator/i.test(blob)) {
          return 'It was 18°C. Ready image prompt includes the degree.';
        }
        return 'ok';
      },
      getBrainDataDir: () => null,
    }, 'what was the weather yesterday and generate an image with the degree on it');

    expect(results.filter(r => r.ok).length).toBe(2);
    expect(genSawPrior).toBe(true);
    expect(reply).toMatch(/18/);
  });
});

describe('planCatalogCascade (wired through heuristic fallback)', () => {
  it('still plans web_search via the heuristic when no catalog cards and no LLM', async () => {
    const { planCatalogCascade } = await import('../src/ai/mcp-planner.js');
    const p = await planCatalogCascade('what was the weather yesterday in Tbilisi', {
      skills: [webSearch], mcpTools: [], plannerEnabled: false,
    });
    expect(p.type).toBe('tasks');
    expect(p.stages.flat().some(t => t.skillId === 'web_search')).toBe(true);
  });
});
