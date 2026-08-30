/**
 * Catalog-first two-phase planner.
 *
 * Phase A retrieves a short candidate list (cards + matching skills) without an
 * LLM. Phase B asks a small model to emit a JSON plan using ONLY those compact
 * catalog lines — never full tool schemas. Invalid tools are dropped; parse
 * failure falls back to the heuristic cascade.
 */

import { isConversational, retrieveCandidates } from './mcp-catalog.js';
import { planTaskCascade } from './task-cascade.js';

export const PLANNER_DEFAULTS = {
  retrieveK: 12,
  maxTasks: 6,
  maxStages: 3,
  maxParallelPerStage: 4,
  plannerTimeoutMs: 20_000,
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function extractJsonObject(raw) {
  let s = String(raw || '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1];
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = s.slice(start, i + 1);
        try { return JSON.parse(slice); } catch { /* trailing commas */ }
        try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
      }
    }
  }
  return null;
}

function argKeysFor(card, mcpTools) {
  if (Array.isArray(card.argKeys) && card.argKeys.length) return card.argKeys;
  const qualified = card.qualified || `${card.mcpId}__${card.tool}`;
  const meta = (mcpTools || []).find(t => t.name === qualified || (t.server === card.mcpId && t.tool === card.tool));
  const props = meta?.inputSchema?.properties;
  if (props && typeof props === 'object') return Object.keys(props).slice(0, 8);
  return [];
}

export function formatCandidateLines(retrieved, mcpTools = []) {
  const lines = [];
  (retrieved.cards || []).forEach((c, i) => {
    const letter = LETTERS[i] || String(i);
    const keys = argKeysFor(c, mcpTools);
    const argBit = keys.length ? ` [args: ${keys.join(',')}]` : '';
    lines.push(`${letter}. ${c.id} — ${c.tool} — ${(c.summary || '').slice(0, 90)}${argBit}`);
  });
  (retrieved.skills || []).forEach((s, i) => {
    lines.push(`S${i + 1}. skill:${s.id} — ${(s.context || s.id).slice(0, 90)}`);
  });
  return lines.join('\n');
}

export function buildPlannerPrompt(message, retrieved, opts = {}) {
  const maxTasks = opts.maxTasks || PLANNER_DEFAULTS.maxTasks;
  const maxStages = opts.maxStages || PLANNER_DEFAULTS.maxStages;
  const maxPar = opts.maxParallelPerStage || PLANNER_DEFAULTS.maxParallelPerStage;
  const lines = formatCandidateLines(retrieved, opts.mcpTools || []);
  return [
    'Plan tool use for this user request. Reply with JSON only, no prose.',
    `User: ${message}`,
    '',
    'Candidate tools (you may only use these):',
    lines || '(none)',
    '',
    'JSON shape:',
    '{"intent":"...","abstain":false,"stages":[{"goal":"...","tasks":[{"kind":"mcp|skill|llm","cardId":"...","mcpId":"...","tool":"...","skillId":null,"arguments":{},"dependsOn":[],"why":"..."}]}],"synthesis_notes":"..."}',
    '',
    `Rules: 1-${maxTasks} tasks total, ≤${maxStages} stages, ≤${maxPar} parallel tasks per stage.`,
    'Extract concrete argument values (city, dates, product name, coordinates) from the user message; never pass the full multi-clause sentence if a specific field exists.',
    'Prefer MCP over generic web_search when a card clearly fits.',
    'If a later task needs an earlier output (e.g. lat/lon from geo), set dependsOn to that task\'s cardId and leave those args null.',
    'If no tool is needed: {"intent":"...","abstain":true,"stages":[],"synthesis_notes":""}',
    'Shop/price comparison: at most 2 alternatives in parallel unless comparison clearly needs more; never more than the parallel cap.',
    'Do not invent tools that are not in the candidate list.',
  ].join('\n');
}

function asIdList(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.map(x => String(x)).filter(Boolean);
  return [String(v)];
}

function convertOne(t, ctx) {
  const kind = String(t?.kind || 'mcp').toLowerCase();
  if (kind === 'llm' || kind === 'llm-generate') {
    return {
      kind: 'llm-generate',
      id: t.id || `gen:${ctx.index}`,
      query: t.query || t.arguments?.prompt || t.goal || '',
      segment: t.goal || t.query || '',
      dependsOn: asIdList(t.dependsOn),
      why: t.why,
    };
  }
  if (kind === 'skill') {
    const sid = t.skillId || String(t.cardId || '').replace(/^skill:/, '');
    const skill = ctx.skillById.get(sid);
    if (!skill) return null;
    const q = t.arguments?.query || t.arguments?.message || t.query || '';
    return {
      kind: 'skill',
      id: `skill:${sid}`,
      skillId: sid,
      input: { ...(t.arguments || {}), message: q, query: q },
      skillContext: skill.context || null,
      segment: q,
      dependsOn: asIdList(t.dependsOn),
      why: t.why,
    };
  }
  if (kind !== 'mcp') return null;
  const card = ctx.cardById.get(t.cardId)
    || ctx.cardByTool.get(t.qualified)
    || ctx.cardByTool.get(`${t.mcpId}__${t.tool}`)
    || ctx.cardByTool.get(t.tool);
  if (!card) return null;
  const qualified = card.qualified || `${card.mcpId}__${card.tool}`;
  const meta = ctx.toolByName.get(qualified);
  const args = (t.arguments && typeof t.arguments === 'object' && !Array.isArray(t.arguments))
    ? { ...t.arguments }
    : {};
  return {
    kind: 'mcp',
    id: `mcp:${qualified}`,
    server: card.mcpId,
    tool: qualified,
    bareTool: card.tool,
    cardId: card.id,
    arguments: args,
    inputSchema: meta?.inputSchema || card.inputSchema,
    segment: '',
    dependsOn: asIdList(t.dependsOn),
    why: t.why,
  };
}

function remapDependsOn(stages) {
  const all = stages.flat();
  const aliases = new Map();
  all.forEach((t, i) => {
    aliases.set(t.id, t.id);
    aliases.set(String(i), t.id);
    if (t.cardId) aliases.set(t.cardId, t.id);
    if (t.bareTool) aliases.set(t.bareTool, t.id);
    if (t.skillId) aliases.set(t.skillId, t.id);
    if (t.tool) aliases.set(t.tool, t.id);
  });
  for (const t of all) {
    t.dependsOn = (t.dependsOn || [])
      .map(d => aliases.get(String(d)) || d)
      .filter(d => d && d !== t.id);
  }
}

function splitOneStage(stage) {
  if (stage.length <= 1) return [stage];
  const ids = new Set(stage.map(t => t.id));
  const depOf = t => (t.dependsOn || []).filter(d => ids.has(d));
  const independent = stage.filter(t => !depOf(t).length);
  const dependent = stage.filter(t => depOf(t).length);
  if (!dependent.length || !independent.length) return [stage];
  return [independent, ...splitOneStage(dependent)];
}

function splitStagesByDeps(stages) {
  return stages.flatMap(s => splitOneStage(s)).filter(s => s.length);
}

/**
 * Validate LLM plan JSON against the candidate list. Drops unknown tools.
 * @returns {{ ok: boolean, plan?: object, reason?: string, dropped?: Array }}
 */
export function validatePlannerPlan(parsed, {
  cards = [],
  skills = [],
  mcpTools = [],
  maxTasks = PLANNER_DEFAULTS.maxTasks,
  maxStages = PLANNER_DEFAULTS.maxStages,
  maxParallelPerStage = PLANNER_DEFAULTS.maxParallelPerStage,
} = {}) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'not-object' };
  if (parsed.abstain) {
    return { ok: true, plan: { type: 'chat', reason: 'planner-abstain', intent: parsed.intent || '' } };
  }

  const cardById = new Map();
  const cardByTool = new Map();
  for (const c of cards) {
    cardById.set(c.id, c);
    if (c.qualified) cardByTool.set(c.qualified, c);
    cardByTool.set(`${c.mcpId}__${c.tool}`, c);
    if (c.tool) cardByTool.set(c.tool, c);
  }
  const skillById = new Map((skills || []).map(s => [s.id, s]));
  const toolByName = new Map((mcpTools || []).map(t => [t.name, t]));

  const rawStages = Array.isArray(parsed.stages) ? parsed.stages.slice(0, maxStages) : [];
  let nTasks = 0;
  const converted = [];
  const dropped = [];
  const ctx = { cardById, cardByTool, skillById, toolByName, index: 0 };

  for (const st of rawStages) {
    const tasks = [];
    for (const t of (st.tasks || []).slice(0, maxParallelPerStage)) {
      if (nTasks >= maxTasks) break;
      ctx.index = nTasks;
      const one = convertOne(t, ctx);
      if (!one) { dropped.push(t); continue; }
      tasks.push(one);
      nTasks++;
    }
    if (tasks.length) converted.push(tasks);
  }

  remapDependsOn(converted);
  const stages = splitStagesByDeps(converted);
  if (!stages.length) return { ok: false, reason: 'no-valid-tasks', dropped };
  return {
    ok: true,
    plan: {
      type: 'tasks',
      stages,
      reason: `planner: ${parsed.intent || 'catalog'}`,
      synthesisNotes: parsed.synthesis_notes || parsed.synthesisNotes || '',
      intent: parsed.intent || '',
      planner: true,
      dropped,
    },
  };
}

/**
 * Two-phase catalog planner. Falls back to the heuristic `planTaskCascade`
 * when the planner is off, candidates are empty, or JSON parse/validation fails.
 * `planTaskCascade` itself is unchanged (sync heuristic).
 */
export async function planCatalogCascade(message, ctx = {}) {
  const full = String(message || '').trim();
  if (!full) return { type: 'chat' };
  if (isConversational(full)) return { type: 'chat' };

  const plannerOn = ctx.plannerEnabled !== false && typeof ctx.llm === 'function';
  if (!plannerOn) return planTaskCascade(message, ctx);

  const retrieveK = ctx.retrieveK || PLANNER_DEFAULTS.retrieveK;
  const retrieved = retrieveCandidates(full, {
    cards: ctx.catalogCards || [],
    skills: ctx.skills || [],
    retrieveK,
  });
  if (retrieved.reason === 'skip') return { type: 'chat' };
  if (!retrieved.cards.length && !retrieved.skills.length) {
    return planTaskCascade(message, ctx);
  }

  const limits = {
    maxTasks: ctx.maxTasks || PLANNER_DEFAULTS.maxTasks,
    maxStages: ctx.maxStages || PLANNER_DEFAULTS.maxStages,
    maxParallelPerStage: ctx.maxParallelPerStage || PLANNER_DEFAULTS.maxParallelPerStage,
  };

  try {
    const prompt = buildPlannerPrompt(full, retrieved, { ...limits, mcpTools: ctx.mcpTools || [] });
    const timeoutMs = ctx.plannerTimeoutMs || PLANNER_DEFAULTS.plannerTimeoutMs;
    const raw = await Promise.race([
      ctx.llm(prompt),
      new Promise((_, reject) => setTimeout(() => reject(new Error('planner-timeout')), timeoutMs)),
    ]);
    const parsed = extractJsonObject(raw);
    if (!parsed) return planTaskCascade(message, ctx);
    const validated = validatePlannerPlan(parsed, {
      cards: retrieved.cards,
      // Skills listed as candidates, plus the full set so a listed skillId still resolves.
      skills: [...(retrieved.skills || []), ...(ctx.skills || [])],
      mcpTools: ctx.mcpTools || [],
      ...limits,
    });
    if (!validated.ok) return planTaskCascade(message, ctx);
    return validated.plan;
  } catch {
    return planTaskCascade(message, ctx);
  }
}
