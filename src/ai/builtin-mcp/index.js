/**
 * Builtin MCP packs shipped with every node.
 * User-installed servers in config.mcpServers overlay these; they never replace them.
 */

import { PUBLIC_APIS_PACK } from './public-apis.js';
import { ONION_SEARCH_PACK } from './onion-search.js';

export const BUILTIN_PACKS = [PUBLIC_APIS_PACK, ONION_SEARCH_PACK];

export function loadBuiltinPacks({ disabled = [] } = {}) {
  const mute = new Set(disabled.map(String));
  return BUILTIN_PACKS
    .filter(p => !mute.has(p.id))
    .map(p => ({
      ...p,
      tools: p.tools.filter(t => !mute.has(t.name) && !mute.has(`${p.id}__${t.name}`)),
      cards: (p.cards || []).filter(c => !mute.has(c.tool) && !mute.has(c.id) && !mute.has(c.mcpId)),
    }))
    .filter(p => p.tools.length);
}

export function listBuiltinCards(opts) {
  return loadBuiltinPacks(opts).flatMap(p => p.cards || []);
}

export function listBuiltinTools(opts) {
  const out = [];
  for (const p of loadBuiltinPacks(opts)) {
    for (const t of p.tools) {
      out.push({
        name: `${p.id}__${t.name}`,
        server: p.id,
        tool: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        source: 'builtin',
      });
    }
  }
  return out;
}
