/**
 * Signal: identity_hub_social_linked
 *
 * Queries IdentityHub public agent directory for profiles that declare this
 * wallet as their ownerAddress. A confirmed social-identity link (GitHub,
 * Twitter/X, Telegram) is a strong human indicator — bots rarely maintain
 * public social presence tied to a specific wallet.
 *
 * Configuration:
 *   config.identityHubApiKey — API key for authenticated queries (optional)
 *
 * Returns: { methodId, result: boolean, details: { socialAccounts, agentNames } }
 */

const IH_BASE = 'https://api.identityhub.app';

export async function runIdentityHubSignal(address, { apiKey } = {}) {
  const headers = {
    'Accept': 'application/json',
    ...(apiKey ? { 'X-Agent-Key': apiKey } : {}),
  };

  const res = await fetch(
    `${IH_BASE}/agents?q=${encodeURIComponent(address)}`,
    { headers, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`IdentityHub ${res.status}: ${await res.text().catch(() => '')}`);

  const data = await res.json();
  const agents = (data.agents || data.items || []).filter(
    a => a.ownerAddress === address || a.walletAddress === address
  );
  const socialAccounts = agents.flatMap(a => a.socialAccounts || a.social || []);

  return {
    methodId: 'identity_hub_social_linked',
    chain: 'universal',
    result: socialAccounts.length > 0,
    details: {
      agentNames: agents.map(a => a.name || a.username).filter(Boolean),
      socialAccounts: socialAccounts.map(s => ({
        platform: s.platform || s.type,
        handle: s.handle || s.username,
      })),
    },
  };
}
