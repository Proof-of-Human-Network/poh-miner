/**
 * MCP catalog — address-book cards for builtin packs + user overlay tools.
 *
 * Cards are name + one-line purpose, not full JSON schemas. Search is in-process
 * (trigger overlap + BM25-ish term match) so chat never dumps the whole phone book.
 */

import { listBuiltinCards } from './builtin-mcp/index.js';

export function overlayCardsFromTools(tools = []) {
  const byServer = new Map();
  for (const t of tools) {
    if (t.source === 'builtin') continue;
    if (!byServer.has(t.server)) {
      byServer.set(t.server, {
        id: t.server,
        mcpId: t.server,
        tool: t.tool,
        summary: t.description || t.server,
        tags: [],
        triggers: [t.server, t.tool].filter(Boolean),
        tools: [],
        source: 'user',
      });
    }
    const card = byServer.get(t.server);
    card.tools.push(t.tool);
    if (t.description && card.tools.length === 1) card.summary = t.description;
    if (t.tool) card.triggers.push(t.tool);
  }
  // One card per user tool so the picker can choose at tool grain.
  const out = [];
  for (const t of tools) {
    if (t.source === 'builtin') continue;
    out.push({
      id: `${t.server}/${t.tool}`,
      mcpId: t.server,
      tool: t.tool,
      qualified: t.name,
      summary: (t.description || t.tool).slice(0, 180),
      tags: [],
      triggers: [t.server, t.tool],
      tools: [t.tool],
      source: 'user',
    });
  }
  return out;
}

export function allCards({ disabled = [], tools = [] } = {}) {
  const builtin = listBuiltinCards({ disabled }).map(c => ({ ...c, source: 'builtin', qualified: `${c.mcpId}__${c.tool}` }));
  return [...builtin, ...overlayCardsFromTools(tools)];
}

export function searchCards(cards, query, k = 8) {
  const q = String(query || '').toLowerCase().trim();
  if (!q || !cards?.length) return [];
  const terms = q.split(/[^a-z0-9]+/i).filter(t => t.length > 1);
  const scored = [];
  for (const c of cards) {
    let score = 0;
    const triggers = (c.triggers || []).map(t => String(t).toLowerCase());
    for (const t of triggers) {
      if (!t) continue;
      if (q.includes(t)) score += t.trim().split(/\s+/).length * 3;
    }
    const blob = `${c.id} ${c.mcpId} ${c.tool} ${c.summary} ${(c.tags || []).join(' ')} ${(c.tools || []).join(' ')}`.toLowerCase();
    for (const t of terms) if (blob.includes(t)) score += 1;
    if (c.tags?.some(tag => q.includes(String(tag).toLowerCase()))) score += 2;
    if (score > 0) scored.push({ card: c, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.card.id).localeCompare(b.card.id));
  return scored.slice(0, k).map(s => ({ ...s.card, _score: s.score }));
}

export function isConversational(message) {
  return /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great|cool|got it|makes sense|sounds good|nice|perfect|good|bye|see you|lol|haha|awesome|interesting|are you|what is your|what's your|how are you)\b/i
    .test(String(message || '').trim());
}
