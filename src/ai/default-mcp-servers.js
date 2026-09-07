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

  // ── Public no-auth knowledge/docs MCPs ──────────────────────────────────────
  // Verified anonymous (initialize → tools/list → tools/call) on 2026-09-02.
  // Docs-and-lookup only: none of them write, spend, or hold state for the node.
  deepwiki: {
    url: 'https://mcp.deepwiki.com/mcp',
    homepage: 'https://deepwiki.com',
    summary: 'Ask questions about any public GitHub repo (indexed wiki + RAG)',
    tags: ['github', 'docs', 'code'],
    triggers: ['deepwiki', 'explain this repo', 'repo question', 'how this project works'],
    tools: [
      { name: 'ask_question', summary: 'Ask anything about a GitHub repo, answered from its code', triggers: ['ask about repo', 'question about repository', 'explain codebase'], argKeys: ['repoName', 'question'] },
      { name: 'read_wiki_structure', summary: 'List the documentation topics for a GitHub repo', triggers: ['repo doc topics', 'repo wiki structure'], argKeys: ['repoName'] },
      { name: 'read_wiki_contents', summary: 'Read the generated wiki for a GitHub repo', triggers: ['repo wiki', 'repository documentation'], argKeys: ['repoName'] },
    ],
  },
  context7: {
    url: 'https://mcp.context7.com/mcp',
    homepage: 'https://context7.com',
    summary: 'Up-to-date documentation and code examples for any library or framework',
    tags: ['docs', 'library', 'code'],
    triggers: ['context7', 'library docs', 'framework docs', 'up to date docs', 'latest api docs'],
    tools: [
      // Both keys are required by the server — libraryName alone is rejected.
      { name: 'resolve-library-id', summary: 'Resolve a package name to a Context7 library id (call first)', triggers: ['find library', 'library id'], argKeys: ['query', 'libraryName'] },
      { name: 'query-docs', summary: 'Query current docs and code samples for a resolved library', triggers: ['library documentation', 'how to use library', 'api reference', 'code example'], argKeys: ['libraryId', 'query'] },
    ],
  },
  gitmcp: {
    url: 'https://gitmcp.io/docs',
    homepage: 'https://gitmcp.io',
    summary: 'Fetch and search docs or source code of any GitHub repository',
    tags: ['github', 'docs', 'code', 'search'],
    triggers: ['gitmcp', 'github docs', 'search repo code', 'repo source'],
    tools: [
      { name: 'match_common_libs_owner_repo_mapping', summary: 'Map a library name to its owner/repo on GitHub', triggers: ['find github repo', 'which repo is'], argKeys: ['library'] },
      { name: 'fetch_generic_documentation', summary: 'Fetch the documentation of a GitHub repo', triggers: ['github repo docs', 'fetch repo documentation'], argKeys: ['owner', 'repo'] },
      { name: 'search_generic_documentation', summary: 'Semantic search inside a GitHub repo documentation', triggers: ['search repo docs'], argKeys: ['owner', 'repo', 'query'] },
      { name: 'search_generic_code', summary: 'Search code across a GitHub repository', triggers: ['search repo code', 'find code in repo'], argKeys: ['owner', 'repo', 'query'] },
    ],
  },
  'microsoft-learn': {
    url: 'https://learn.microsoft.com/api/mcp',
    homepage: 'https://learn.microsoft.com',
    summary: 'Official Microsoft, Azure, .NET and Windows documentation search',
    tags: ['docs', 'microsoft', 'azure', 'dotnet'],
    triggers: ['microsoft docs', 'ms learn', 'azure', 'dotnet', '.net', 'powershell'],
    tools: [
      { name: 'microsoft_docs_search', summary: 'Search official Microsoft/Azure documentation', triggers: ['azure docs', 'microsoft docs', 'azure how to'], argKeys: ['query'] },
      { name: 'microsoft_code_sample_search', summary: 'Find code samples in Microsoft Learn docs', triggers: ['azure code sample', 'dotnet example', 'c# example'], argKeys: ['query', 'language'] },
      { name: 'microsoft_docs_fetch', summary: 'Fetch a Microsoft Learn page as markdown', triggers: ['fetch microsoft page', 'learn.microsoft.com'], argKeys: ['url'] },
    ],
  },
  'aws-knowledge': {
    url: 'https://knowledge-mcp.global.api.aws',
    homepage: 'https://aws.amazon.com',
    summary: 'Official AWS documentation, regions and per-region service availability',
    tags: ['docs', 'aws', 'cloud'],
    triggers: ['aws', 'amazon web services', 'lambda', 's3', 'dynamodb', 'cloudformation'],
    tools: [
      { name: 'aws___search_documentation', summary: 'Search AWS docs, returning verbatim page chunks', triggers: ['aws docs', 'aws how to', 'lambda docs'], argKeys: ['search_phrase'] },
      { name: 'aws___read_documentation', summary: 'Fetch full AWS documentation pages as markdown', triggers: ['read aws page', 'aws documentation url'], argKeys: ['requests'] },
      { name: 'aws___list_regions', summary: 'List every AWS region', triggers: ['aws regions', 'list aws regions'], argKeys: [] },
      { name: 'aws___get_regional_availability', summary: 'Check whether an AWS service is available in a region', triggers: ['aws region availability', 'aws service availability'], argKeys: ['resource_type'] },
    ],
  },
  'cloudflare-docs': {
    url: 'https://docs.mcp.cloudflare.com/mcp',
    homepage: 'https://developers.cloudflare.com',
    summary: 'Cloudflare product documentation: Workers, KV, R2, Pages, DNS',
    tags: ['docs', 'cloudflare', 'edge'],
    triggers: ['cloudflare', 'cloudflare workers', 'wrangler', 'durable objects', 'workers kv'],
    tools: [
      { name: 'search_cloudflare_documentation', summary: 'Search the Cloudflare developer documentation', triggers: ['cloudflare docs', 'workers docs', 'wrangler'], argKeys: ['query'] },
      { name: 'migrate_pages_to_workers_guide', summary: 'Guide for migrating Cloudflare Pages to Workers', triggers: ['migrate pages to workers'], argKeys: [] },
    ],
  },
  solana: {
    url: 'https://mcp.solana.com/mcp',
    homepage: 'https://solana.com/docs',
    summary: 'Solana documentation search, expert Q&A and program security linting',
    tags: ['crypto', 'solana', 'docs'],
    triggers: ['solana', 'anchor', 'spl token', 'pda', 'solana program'],
    tools: [
      { name: 'Solana_Documentation_Search', summary: 'Semantic search over the Solana docs corpus', triggers: ['solana docs', 'solana documentation'], argKeys: ['query'] },
      { name: 'Solana_Expert__Ask_For_Help', summary: 'Ask a Solana expert for how-to and debugging help', triggers: ['solana help', 'solana how to', 'anchor error'], argKeys: ['question'] },
      { name: 'program_autofixer', summary: 'Static security linter for Solana Rust programs', triggers: ['solana program security', 'anchor audit', 'rust program lint'], argKeys: ['code'] },
    ],
  },
  huggingface: {
    url: 'https://huggingface.co/mcp',
    homepage: 'https://huggingface.co',
    summary: 'Search Hugging Face models, datasets, Spaces and papers (anonymous access)',
    tags: ['ai', 'models', 'datasets'],
    triggers: ['hugging face', 'huggingface', 'gguf', 'model card', 'find a model', 'dataset search'],
    tools: [
      { name: 'hub_repo_search', summary: 'Search models, datasets and Spaces on the Hub', triggers: ['find model', 'search models', 'gguf model', 'search datasets'], argKeys: ['query'] },
      { name: 'hub_repo_details', summary: 'Details for one or more Hub repos (model/dataset/space)', triggers: ['model card', 'model details', 'dataset details'], argKeys: ['repo_ids'] },
      { name: 'hf_fs', summary: 'Browse Hub papers, trending models and collections', triggers: ['trending models', 'daily papers', 'huggingface papers'], argKeys: ['operations'] },
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
