/**
 * Shipped no-auth HTTP MCP servers. Overlay — never written into config.mcpServers,
 * so upgrades can refresh the list. Operator can mute with mcpDefaultHttp.enabled=false
 * or mcpDefaultHttp.disabled: ["goji", ...]. User mcpServers wins on id collision.
 *
 * Seed cards are catalog-only (id + one-line purpose + triggers). Live tool schemas
 * arrive after a lazy connect; the planner never needs them in the prompt.
 */

export const DEFAULT_HTTP_MCPS = {
  tandem: {
    url: 'https://tandem.ac/mcp',
    homepage: 'https://tandem.ac/docs-mcp',
    summary: 'Tandem documentation: search, how-to, SDKs, install guides',
    tags: ['docs', 'tandem'],
    triggers: ['tandem', 'tandem docs'],
    tools: [
      { name: 'search_docs', summary: 'Search published Tandem docs', triggers: ['tandem docs', 'search docs'], argKeys: ['query'] },
      { name: 'answer_how_to', summary: 'How to install or use Tandem / SDKs', triggers: ['how to tandem', 'tandem install'], argKeys: ['question'] },
      { name: 'get_doc', summary: 'Fetch a Tandem docs page by path or URL', triggers: ['tandem page'], argKeys: ['path', 'url'] },
    ],
  },
  'inside-ads': {
    url: 'https://app.inside.ad/api/mcp',
    homepage: 'https://inside.ad',
    summary: 'Telegram ads: estimate reach/cost and draft a campaign (no account)',
    tags: ['ads', 'telegram'],
    triggers: ['telegram ads', 'ad campaign', 'inside ads'],
    tools: [
      { name: 'estimate_campaign', summary: 'Estimate Telegram ad reach, clicks and cost', triggers: ['ad estimate', 'campaign cost', 'telegram reach'], argKeys: ['product'] },
      { name: 'create_campaign_draft', summary: 'Draft a Telegram ad campaign without an account', triggers: ['create campaign', 'ad draft'], argKeys: ['product'] },
    ],
  },
  goji: {
    url: 'https://mcp.goji.agency/mcp',
    homepage: 'https://goji.agency',
    summary: 'GOJI Melbourne: SEO/AEO glossary, AI-visibility guide, services, FAQ',
    tags: ['seo', 'aeo', 'marketing'],
    triggers: ['goji', 'aeo', 'ai visibility'],
    tools: [
      { name: 'goji_search', summary: 'Search GOJI glossary and AI-visibility material', triggers: ['goji search', 'aeo guide'], argKeys: ['query'] },
      { name: 'goji_explain_term', summary: 'Explain a marketing/SEO/AEO term the GOJI way', triggers: ['explain seo', 'what is aeo'], argKeys: ['term'] },
      { name: 'goji_answer_faq', summary: 'GOJI FAQ: pricing, timelines, engagement', triggers: ['goji pricing', 'goji faq'], argKeys: ['question'] },
    ],
  },
  atars: {
    url: 'https://mcp.aarna.ai/mcp',
    homepage: 'https://mcp.aarna.ai/mcp',
    summary: 'Crypto technical indicators and buy/sell signals (aTars / Aarna)',
    tags: ['crypto', 'indicators'],
    triggers: ['atars', 'technical indicator', 'rsi', 'crypto signal'],
    tools: [
      { name: 'get_available_symbols', summary: 'List tokens with local indicator data', triggers: ['atars symbols'], argKeys: [] },
      { name: 'get_latest_features', summary: 'Latest 40+ technical indicators for a token', triggers: ['latest indicators', 'token rsi'], argKeys: ['symbol'] },
      { name: 'get_signal_summary', summary: 'Buy/sell signal verdict and market sentiment', triggers: ['buy signal', 'sell signal', 'crypto sentiment'], argKeys: ['symbol'] },
    ],
  },
  'akari-trust': {
    url: 'https://ai-akari.ai/mcp-trust',
    homepage: 'https://ai-akari.ai/.well-known/agent-trust.json',
    summary: 'Free AI-Akari agent trust receipt (paid x402 audit is separate)',
    tags: ['trust', 'audit'],
    triggers: ['agent trust', 'trust receipt', 'akari trust'],
    tools: [
      { name: 'get_agent_trust_receipt', summary: 'Free trust and distribution-validation check', triggers: ['trust receipt', 'agent trust'], argKeys: [] },
    ],
  },
  akari: {
    url: 'https://ai-akari.ai/mcp',
    homepage: 'https://ai-akari.ai',
    summary: 'AI-Akari one-minute next action / 60-second reset',
    tags: ['akari', 'support'],
    triggers: ['akari', 'one minute', '60-second reset'],
    tools: [
      { name: 'one_minute_akari', summary: 'One tiny next action or a free 60-second reset', triggers: ['one minute akari', 'one-minute'], argKeys: [] },
    ],
  },
  'ai-portal': {
    url: 'https://www.ai-portal.ai/mcp',
    homepage: 'https://www.ai-portal.ai/developers',
    summary: 'AI model releases, regulations, GenAI glossary and daily news',
    tags: ['ai', 'news', 'regulation'],
    triggers: ['ai-portal', 'ai portal', 'model release', 'eu ai act', 'genai news'],
    tools: [
      { name: 'list_releases', summary: 'AI model and product releases, newest first', triggers: ['model release', 'gpt release', 'new model'], argKeys: ['category'] },
      { name: 'list_regulations', summary: 'AI regulations and compliance status', triggers: ['ai regulation', 'eu ai act', 'iso 42001'], argKeys: [] },
      { name: 'search_glossary', summary: 'GenAI glossary lookup', triggers: ['genai term', 'ai glossary'], argKeys: ['query'] },
      { name: 'get_latest_news', summary: 'Curated weekday GenAI news', triggers: ['genai news', 'ai news'], argKeys: [] },
    ],
  },
  airshelf: {
    url: 'https://mcp.airshelf.ai/mcp',
    homepage: 'https://mcp.airshelf.ai/mcp',
    summary: 'AirShelf B2B product catalog: search, compare, datasheets, quotes',
    tags: ['catalog', 'b2b', 'products'],
    triggers: ['airshelf', 'product catalog', 'datasheet', 'b2b product'],
    tools: [
      { name: 'search_catalog', summary: 'Search the cross-vendor product catalog', triggers: ['search catalog', 'product search'], argKeys: ['query'] },
      { name: 'find_products', summary: 'Discover products for a buyer need', triggers: ['find products', 'buyer need'], argKeys: ['need'] },
      { name: 'compare_products', summary: 'Side-by-side datasheet comparison', triggers: ['compare products'], argKeys: ['slugs'] },
      { name: 'get_product', summary: 'Golden record and latest price for one product', triggers: ['product record'], argKeys: ['slug'] },
    ],
  },
};

export function defaultHttpSpecs({ disabled = [] } = {}) {
  const mute = new Set(disabled.map(String));
  const out = {};
  for (const [id, s] of Object.entries(DEFAULT_HTTP_MCPS)) {
    if (mute.has(id)) continue;
    out[id] = { url: s.url };
  }
  return out;
}

export function defaultHttpSeedCards({ disabled = [] } = {}) {
  const mute = new Set(disabled.map(String));
  const out = [];
  for (const [id, s] of Object.entries(DEFAULT_HTTP_MCPS)) {
    if (mute.has(id)) continue;
    for (const t of s.tools || []) {
      out.push({
        id: `${id}/${t.name}`,
        mcpId: id,
        tool: t.name,
        qualified: `${id}__${t.name}`,
        summary: t.summary || s.summary,
        tags: [...(s.tags || []), ...(t.tags || [])],
        triggers: [...new Set([...(s.triggers || []), ...(t.triggers || []), t.name, id])],
        tools: [t.name],
        source: 'default-http',
        argKeys: t.argKeys || [],
      });
    }
  }
  return out;
}
