/**
 * Address-book router: pick the right builtin / skill-like MCP card for a
 * message, without stuffing every tool schema into the prompt.
 *
 * Order: conversational skip → exact "use X MCP" → trigger hit → retrieve top-K
 * → optional A/B/C/none letter pick → abstain.
 *
 * Fast path for simple single-tool chat. Multi-step argument extraction and
 * stage planning live in planCatalogCascade (task-cascade / _routeMessage),
 * not here — dumping a JSON plan into every chat turn is the wrong default
 * for qwen3-1.7b. When several cards score close, this still letter-picks.
 */

import { retrieveCandidates, USE_MCP_RE } from './mcp-catalog.js';

function namesFor(cards, tools) {
  const out = [];
  for (const c of cards) {
    if (c.qualified) { out.push(c.qualified); continue; }
    const q = `${c.mcpId}__${c.tool}`;
    if ((tools || []).some(t => t.name === q)) out.push(q);
    else out.push(q);
  }
  return [...new Set(out)];
}

/**
 * @returns {Promise<{ toolNames: string[], cards: object[], reason: string }>}
 */
export async function pickToolsForMessage(message, {
  cards = [],
  tools = [],
  sticky = null,
  llm = null,
  retrieveK = 8,
} = {}) {
  const text = String(message || '').trim();
  const retrieved = retrieveCandidates(text, { cards, retrieveK });
  if (retrieved.reason === 'skip') {
    return { toolNames: [], cards: [], reason: 'skip' };
  }

  if (retrieved.exact.length) {
    return { toolNames: namesFor(retrieved.exact, tools), cards: retrieved.exact, reason: 'exact' };
  }
  const useM = text.match(USE_MCP_RE);
  if (useM) {
    const id = useM[1].toLowerCase();
    const matchTools = (tools || []).filter(t =>
      t.server?.toLowerCase() === id || t.name?.toLowerCase().includes(id)
    );
    if (matchTools.length) {
      return { toolNames: matchTools.map(t => t.name), cards: [], reason: 'exact-tool' };
    }
  }

  const hits = retrieved.cards;
  if (!hits.length) {
    if (sticky?.mcpId && Date.now() - (sticky.at || 0) < 10 * 60 * 1000) {
      const stickyCards = cards.filter(c => c.mcpId === sticky.mcpId);
      return { toolNames: namesFor(stickyCards, tools), cards: stickyCards, reason: 'sticky' };
    }
    return { toolNames: [], cards: [], reason: 'abstain' };
  }

  // Strong single (or 2-step) trigger: skip the letter picker.
  const top = hits[0]._score || 0;
  const second = hits[1]?._score || 0;
  if (hits.length === 1 || top >= second * 2) {
    const chosen = hits.slice(0, top >= 6 && hits[1]?._score >= 4 ? 2 : 1);
    return { toolNames: namesFor(chosen, tools), cards: chosen, reason: 'trigger' };
  }

  if (typeof llm === 'function' && hits.length > 1) {
    const letters = await letterPick(text, hits, llm);
    if (!letters.length) return { toolNames: [], cards: [], reason: 'none' };
    const chosen = letters.map(i => hits[i]).filter(Boolean);
    return { toolNames: namesFor(chosen, tools), cards: chosen, reason: 'pick' };
  }

  return { toolNames: namesFor(hits.slice(0, 2), tools), cards: hits.slice(0, 2), reason: 'retrieve' };
}

async function letterPick(question, hits, llm) {
  const list = hits.slice(0, 8).map((c, i) =>
    `${String.fromCharCode(65 + i)}. ${c.id} — ${c.summary} (tools: ${(c.tools || [c.tool]).join(', ')})`
  ).join('\n');
  const prompt = [
    'A user asked a question. Pick which catalog card(s) to call, or none.',
    `Question: "${question}"`,
    '',
    list,
    '',
    'Reply with ONLY the letter(s) (e.g. "A" or "A,C") or the word "none".',
    'No explanation.',
  ].join('\n');
  try {
    const raw = String(await llm(prompt) || '').trim().toUpperCase();
    if (!raw || /\bNONE\b/.test(raw)) return [];
    const letters = [...raw.matchAll(/\b([A-H])\b/g)].map(m => m[1].charCodeAt(0) - 65);
    return [...new Set(letters)].filter(i => i >= 0 && i < hits.length);
  } catch {
    return [0];
  }
}
