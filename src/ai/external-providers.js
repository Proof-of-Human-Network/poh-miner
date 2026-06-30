/**
 * External AI provider clients (Anthropic / OpenAI / xAI Grok / custom OpenAI-compatible).
 * Used as an optional fallback when local Ollama and peer miners are unavailable,
 * and as a target for explicit "public/cloud" chat requests once a user configures a key.
 */

const PROVIDER_DEFAULTS = {
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6' },
  openai:    { baseUrl: 'https://api.openai.com',    model: 'gpt-4o-mini' },
  xai:       { baseUrl: 'https://api.x.ai',           model: 'grok-2-latest' },
};

export function getConfiguredProviders(config) {
  const providers = config?.aiProviders || {};
  return Object.entries(providers)
    .filter(([, p]) => p && p.enabled && p.apiKey)
    .map(([id, p]) => ({ id, ...p }));
}

async function callAnthropic(provider, messages) {
  const baseUrl = provider.baseUrl || PROVIDER_DEFAULTS.anthropic.baseUrl;
  const model   = provider.model   || PROVIDER_DEFAULTS.anthropic.model;
  const system  = messages.find(m => m.role === 'system')?.content;
  const turns   = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));

  const r = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, system, messages: turns, max_tokens: 2048 }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) throw new Error(`Anthropic API error ${r.status}`);
  const data = await r.json();
  return data.content?.map(c => c.text).filter(Boolean).join('') || '';
}

async function callOpenAiCompatible(provider, messages, defaults) {
  const baseUrl = provider.baseUrl || defaults.baseUrl;
  const model   = provider.model   || defaults.model;

  const r = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) throw new Error(`${defaults === PROVIDER_DEFAULTS.xai ? 'xAI' : 'OpenAI'} API error ${r.status}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Call a single configured provider by id. Throws on failure.
 */
export async function callExternalProvider(providerId, provider, messages) {
  if (providerId === 'anthropic') return callAnthropic(provider, messages);
  if (providerId === 'openai')    return callOpenAiCompatible(provider, messages, PROVIDER_DEFAULTS.openai);
  if (providerId === 'xai')       return callOpenAiCompatible(provider, messages, PROVIDER_DEFAULTS.xai);
  if (providerId === 'custom')    return callOpenAiCompatible(provider, messages, { baseUrl: provider.baseUrl, model: provider.model });
  throw new Error(`Unknown AI provider: ${providerId}`);
}

/**
 * Try every enabled+keyed provider in order until one responds successfully.
 * Returns { reply, providerId } or null if none configured/available.
 */
export async function tryExternalProviders(config, messages) {
  const providers = getConfiguredProviders(config);
  for (const provider of providers) {
    try {
      const reply = await callExternalProvider(provider.id, provider, messages);
      if (reply) return { reply, providerId: provider.id };
    } catch { /* try next provider */ }
  }
  return null;
}
