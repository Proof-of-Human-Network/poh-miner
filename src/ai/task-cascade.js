/**
 * Task cascade planner + executor.
 *
 * Turns a free-text user request into ordered stages of parallel tasks
 * (skills, MCP tools, HF datasets, HF model suggestions), runs them, and
 * synthesizes a final answer (mixture-of-agents style — inspired by Sakana
 * Fugu: multiple specialist proposers, then one aggregator).
 *
 * Stages run sequentially (so "weather yesterday AND generate an image with
 * the degree on it" can feed stage-1 weather into stage-2 image intent).
 * Tasks inside a stage run in parallel (e.g. 10 ecommerce MCP shops).
 */

import { needsDatasetLookup, searchDatasets, disambiguateDataset } from '../datasets/hf-dataset-search.js';
import { needsHfModelLookup, searchModelsWithFallback, pickRelevantModels, formatModelSuggestions } from '../datasets/hf-model-search.js';
import * as hfDatasetManager from '../datasets/hf-dataset-manager.js';

const SPLIT_RE = /\s*\b(?:and also|as well as|as well|and then|then|and|also|plus|additionally|, then)\b\s*[,;]?\s*/i;
const CONVERSATIONAL_RE = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great|cool|got it|makes sense|sounds good|nice|perfect|good|bye|see you|lol|haha|awesome|interesting|are you|what is your|what's your|how are you)\b/i;
const CREATION_RE = /\b(?:create|write|generate|build|implement|draft|code up|code me)\b/i;
const BUY_RE = /\b(?:where (?:do|can) i (?:buy|get|find)|buy|purchase|price of|cheapest|compare prices?|best (?:deal|price)|shop for|order)\b/i;
const PRODUCT_RE = /\b(?:product|sku|stock|inventory|catalog|listing|shop|store|ecommerce|e-commerce)\b/i;

function segmentNeedsWebSearch(segment) {
  const s = (segment || '').toLowerCase();
  if (/\b(search|google|look up|find out|web search|look into|browse|research)\b/.test(s)) return true;
  if (/\b(today|right now|currently|this (week|month|year)|just now|breaking|live|real.?time)\b/.test(s)) return true;
  if (/\b(latest|recent|newest|just (released|announced|happened)|this morning|yesterday|last (week|night|month))\b/.test(s)) return true;
  if (/\b(news|headline|update|score|result|match|game|event|happening)\b/.test(s)) return true;
  if (/\b(price|cost|rate|exchange rate|weather|forecast|temperature|status|outage)\b/.test(s)) return true;
  if (/\b(2024|2025|2026)\b/.test(s)) return true;
  if (/https?:\/\/|www\./.test(s)) return true;
  return false;
}

function scoreSkill(skill, segLower) {
  let score = 0;
  for (const t of (skill.triggers || [])) {
    if (segLower.includes(String(t).toLowerCase())) score += String(t).trim().split(/\s+/).length;
  }
  return score;
}

/**
 * Plan a cascade from a user message.
 *
 * @param {string} message
 * @param {object} ctx
 * @param {Array}  ctx.skills - skillsManager.getAllSkills() filtered active
 * @param {Array}  ctx.mcpTools - [{name, server, tool, description}]
 * @param {string} [ctx.brainDataDir]
 * @returns {{ type: 'chat'|'tasks', stages?: Array<Array<object>>, reason?: string }}
 */
export function planTaskCascade(message, ctx = {}) {
  const skills = ctx.skills || [];
  const mcpTools = ctx.mcpTools || [];
  const full = String(message || '').trim();
  if (!full) return { type: 'chat' };

  const segments = full.split(SPLIT_RE).map(s => s.trim()).filter(Boolean);
  const segs = segments.length ? segments : [full];

  const webSearchSkill = skills.find(s => s.id === 'web_search');
  const usedSkillIds = new Set();
  const stages = []; // each stage = array of tasks run in parallel
  let creationSegment = null;

  // ── Per-segment specialist tasks ──────────────────────────────────────────
  for (const segment of segs) {
    const segLower = segment.toLowerCase();
    const stage = [];

    // Skills by trigger score
    const hits = skills
      .map(s => ({ skill: s, score: scoreSkill(s, segLower) }))
      .filter(h => h.score > 0)
      .sort((a, b) => b.score - a.score);

    if (hits.length) {
      const best = hits.find(h => !usedSkillIds.has(h.skill.id))?.skill;
      if (best) {
        usedSkillIds.add(best.id);
        stage.push({
          kind: 'skill',
          id: `skill:${best.id}`,
          skillId: best.id,
          input: { message: segment, query: segment },
          skillContext: best.context || null,
          segment,
        });
      }
    } else if (webSearchSkill && !usedSkillIds.has('web_search')
               && !CONVERSATIONAL_RE.test(segment)
               && segmentNeedsWebSearch(segment)) {
      usedSkillIds.add('web_search');
      stage.push({
        kind: 'skill',
        id: 'skill:web_search',
        skillId: 'web_search',
        input: { message: segment, query: segment },
        skillContext: webSearchSkill.context || null,
        segment,
      });
    } else if (!creationSegment && CREATION_RE.test(segment) && !needsHfModelLookup(segment)) {
      creationSegment = segment;
    }

    // Dataset intent (explicit mention, or whole message)
    if (needsDatasetLookup(segment) || (segs.length === 1 && needsDatasetLookup(full))) {
      stage.push({
        kind: 'dataset',
        id: `dataset:${segment.slice(0, 40)}`,
        query: segment,
        segment,
      });
    }

    // Media generation (image/video/audio)
    if (needsHfModelLookup(segment)) {
      stage.push({
        kind: 'hf-model',
        id: `hf-model:${segment.slice(0, 40)}`,
        query: segment,
        segment,
        // Hint: if a prior stage will produce weather/data, include it in the prompt later
        dependsOnPrior: stage.length === 0 && stages.length > 0,
      });
    }

    if (stage.length) stages.push(stage);
  }

  // ── Multi-MCP business intelligence (whole-message) ───────────────────────
  // "where do I buy X" with N shop MCPs → fan-out every connected server in one stage.
  if (mcpTools.length && (BUY_RE.test(full) || PRODUCT_RE.test(full))) {
    const byServer = new Map();
    for (const t of mcpTools) {
      if (!byServer.has(t.server)) byServer.set(t.server, []);
      byServer.get(t.server).push(t);
    }
    const mcpStage = [];
    for (const [server, tools] of byServer) {
      // Prefer a tool whose name/description smells like search/list/product/price
      const preferred = tools.find(t =>
        /search|find|list|product|item|price|catalog|query|lookup|get_/i.test(`${t.tool} ${t.description || ''}`)
      ) || tools[0];
      mcpStage.push({
        kind: 'mcp',
        id: `mcp:${server}__${preferred.tool}`,
        server,
        tool: preferred.name, // already namespaced server__tool
        bareTool: preferred.tool,
        arguments: { query: full, message: full, q: full },
        segment: full,
      });
    }
    if (mcpStage.length) {
      // MCP BI runs first so later synthesis can compare across shops
      stages.unshift(mcpStage);
    }
  } else if (mcpTools.length && stages.length === 0 && !CONVERSATIONAL_RE.test(full)) {
    // Single-turn: if nothing else matched but MCP tools exist and the question
    // looks actionable, offer one best-effort tool call stage (model can still
    // answer without them if they fail).
    // Skip — leave to _mcpChat tool loop for free-form tool use.
  }

  // Sequence: "create X and audit it" (knowledge-only skill after creation)
  if (stages.length === 1 && stages[0].length === 1 && stages[0][0].kind === 'skill' && creationSegment) {
    const skillId = stages[0][0].skillId;
    const skill = skills.find(s => s.id === skillId);
    if (skill && !skill.hasCode) {
      return {
        type: 'tasks',
        stages: [
          [{ kind: 'llm-generate', id: 'gen:create', query: creationSegment, segment: creationSegment }],
          [{ ...stages[0][0], afterGeneration: true }],
        ],
        reason: `sequence: generate then ${skillId}`,
      };
    }
  }

  if (!stages.length) {
    // Whole-message fallbacks (no segment skill match)
    if (needsHfModelLookup(full)) {
      return { type: 'tasks', stages: [[{ kind: 'hf-model', id: 'hf-model:full', query: full, segment: full }]], reason: 'hf-model' };
    }
    if (needsDatasetLookup(full)) {
      return { type: 'tasks', stages: [[{ kind: 'dataset', id: 'dataset:full', query: full, segment: full }]], reason: 'dataset' };
    }
    return { type: 'chat' };
  }

  // If we have media-gen in a later stage and web_search/data in an earlier one,
  // mark media tasks as context-dependent (executor injects prior outputs).
  for (let i = 1; i < stages.length; i++) {
    for (const t of stages[i]) {
      if (t.kind === 'hf-model' || t.kind === 'llm-generate') t.dependsOnPrior = true;
    }
  }

  const nTasks = stages.reduce((n, s) => n + s.length, 0);
  if (nTasks === 1 && stages[0][0].kind === 'skill') {
    // Preserve simple single-skill shape for back-compat callers
    const t = stages[0][0];
    return {
      type: 'tasks',
      stages,
      reason: `skill:${t.skillId}`,
      // compatibility fields used by existing /chat/route consumers
      legacy: { type: 'skill', skillId: t.skillId, input: t.input, skillContext: t.skillContext },
    };
  }

  return {
    type: 'tasks',
    stages,
    reason: `cascade: ${stages.map(s => s.map(t => t.kind + (t.skillId ? ':' + t.skillId : t.server ? ':' + t.server : '')).join('+')).join(' → ')}`,
  };
}

/**
 * Execute a planned cascade.
 *
 * @param {object} plan - from planTaskCascade
 * @param {object} runners
 * @param {Function} runners.runSkill(skillId, input) → output
 * @param {Function} runners.callMcp(toolName, args) → string
 * @param {Function} runners.llm(messages, opts) → string
 * @param {Function} [runners.getBrainDataDir] → string|null
 * @param {string} [runners.model]
 * @param {string} userMessage
 * @returns {Promise<{ reply: string, results: Array, stages: number }>}
 */
export async function executeTaskCascade(plan, runners, userMessage) {
  if (!plan || plan.type !== 'tasks' || !plan.stages?.length) {
    return { reply: null, results: [], stages: 0 };
  }

  const allResults = [];
  let priorContext = '';

  for (let si = 0; si < plan.stages.length; si++) {
    const stage = plan.stages[si];
    const stageResults = await Promise.all(stage.map(async (task) => {
      const started = Date.now();
      try {
        const out = await runOneTask(task, runners, userMessage, priorContext);
        return { ...task, ok: true, output: out, ms: Date.now() - started };
      } catch (e) {
        return { ...task, ok: false, error: e.message || String(e), ms: Date.now() - started };
      }
    }));
    allResults.push(...stageResults);

    // Build context for dependent later stages (Fugu-style intermediate state)
    const bits = stageResults.map(r => {
      if (!r.ok) return `[${r.id}] ERROR: ${r.error}`;
      const body = typeof r.output === 'string' ? r.output : JSON.stringify(r.output, null, 2);
      return `[${r.id}]\n${String(body).slice(0, 4000)}`;
    });
    priorContext = (priorContext ? priorContext + '\n\n' : '') + bits.join('\n\n');
  }

  // Aggregate (mixture-of-agents synthesizer)
  const reply = await aggregateResults(userMessage, allResults, priorContext, runners);
  return { reply, results: allResults, stages: plan.stages.length, reason: plan.reason };
}

async function runOneTask(task, runners, userMessage, priorContext) {
  switch (task.kind) {
    case 'skill': {
      const input = { ...(task.input || {}), message: task.segment || userMessage, query: task.input?.query || task.segment || userMessage };
      return runners.runSkill(task.skillId, input);
    }
    case 'mcp': {
      const args = { ...(task.arguments || {}) };
      // If prior stage produced useful text (e.g. product name refined), keep original query
      return runners.callMcp(task.tool, args);
    }
    case 'dataset': {
      const brainDataDir = runners.getBrainDataDir?.() || null;
      const model = runners.model;
      const candidates = await searchDatasets(task.query || userMessage, 8);
      const datasetId = await disambiguateDataset(task.query || userMessage, candidates, { model });
      if (!datasetId) return { datasetId: null, note: 'No matching dataset found' };
      if (brainDataDir && hfDatasetManager.isInstalled(brainDataDir, datasetId)) {
        const slice = hfDatasetManager.loadRelevantSlice(brainDataDir, datasetId, task.query || userMessage);
        return { datasetId, installed: true, slice };
      }
      return {
        datasetId,
        installed: false,
        candidates: candidates.slice(0, 5),
        note: `Dataset "${datasetId}" is not installed. User may download via POST /api/hf-dataset/${datasetId}/download`,
      };
    }
    case 'hf-model': {
      const q = task.dependsOnPrior && priorContext
        ? `${task.query || userMessage}\n\nContext from previous steps:\n${priorContext.slice(0, 2000)}`
        : (task.query || userMessage);
      const candidates = await searchModelsWithFallback(q);
      const models = await pickRelevantModels(q, candidates, { model: runners.model });
      return { models, suggestion: formatModelSuggestions(q, models) };
    }
    case 'llm-generate': {
      let prompt = task.query || userMessage;
      if (task.dependsOnPrior && priorContext) {
        prompt = `${prompt}\n\nContext from previous steps:\n${priorContext.slice(0, 3000)}`;
      }
      return runners.llm([{ role: 'user', content: prompt }], { model: runners.model, timeoutMs: 60_000 });
    }
    default:
      throw new Error(`Unknown task kind: ${task.kind}`);
  }
}

async function aggregateResults(userMessage, results, priorContext, runners) {
  // Fast path: single successful text-like result
  if (results.length === 1 && results[0].ok) {
    const r = results[0];
    if (r.kind === 'hf-model' && r.output?.suggestion) return r.output.suggestion;
    if (r.kind === 'llm-generate' && typeof r.output === 'string') return r.output;
    if (r.kind === 'mcp' && typeof r.output === 'string') {
      // Still synthesize for polish
    }
  }

  const blocks = results.map(r => {
    if (!r.ok) return `### ${r.id} (failed)\n${r.error}`;
    let body;
    if (r.kind === 'hf-model') body = r.output?.suggestion || JSON.stringify(r.output?.models || [], null, 2);
    else if (r.kind === 'dataset') {
      if (r.output?.slice) body = `Dataset ${r.output.datasetId} rows:\n${r.output.slice}`;
      else body = JSON.stringify(r.output, null, 2);
    } else if (typeof r.output === 'string') body = r.output;
    else body = JSON.stringify(r.output, null, 2);
    return `### ${r.id} (${r.kind}${r.skillId ? ':' + r.skillId : ''}${r.server ? ' @' + r.server : ''})\n${String(body).slice(0, 5000)}`;
  }).join('\n\n');

  const system = [
    'You are the aggregator in a multi-agent task cascade (mixture-of-agents style).',
    'Specialist tools/skills/MCPs already ran. Synthesize ONE clear final answer for the user.',
    'Rules:',
    '- Write clear Markdown. Be specific — names, numbers, prices, links, temperatures.',
    '- When multiple shops/MCPs returned data, compare them (price, availability, description).',
    '- When a step searched the web and another asked for an image, include the facts AND a ready-to-use image prompt that embeds the key numbers (e.g. temperature).',
    '- If a specialist failed, work with what you have and note the gap briefly.',
    '- Do not invent tool results that were not provided.',
  ].join('\n');

  const user = `User request:\n${userMessage}\n\nSpecialist results:\n${blocks}\n\nProduce the final answer now.`;

  try {
    const reply = await runners.llm(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      { model: runners.model, timeoutMs: 60_000 },
    );
    if (reply && String(reply).trim()) return String(reply).trim();
  } catch { /* fall through */ }

  // Fallback without LLM
  return results.map(r => {
    if (!r.ok) return `**${r.id}** failed: ${r.error}`;
    if (r.kind === 'hf-model') return r.output?.suggestion || '';
    if (typeof r.output === 'string') return r.output;
    return `**${r.id}**\n\`\`\`json\n${JSON.stringify(r.output, null, 2).slice(0, 3000)}\n\`\`\``;
  }).filter(Boolean).join('\n\n---\n\n') || 'No results from the task cascade.';
}

/** Convert a cascade plan into a list of fan-out job descriptors (for multi-miner). */
export function planToFanOutJobs(plan, base = {}) {
  if (!plan?.stages?.length) return [];
  const jobs = [];
  for (const stage of plan.stages) {
    for (const t of stage) {
      if (t.kind === 'skill') {
        jobs.push({ type: 'skill', skillId: t.skillId, payload: t.input, _cascadeId: base.cascadeId, _taskId: t.id });
      } else if (t.kind === 'dataset' || t.kind === 'hf-model' || t.kind === 'mcp' || t.kind === 'llm-generate') {
        jobs.push({
          type: 'compute',
          payload: {
            prompt: t.segment || t.query || base.message,
            cascadeTask: t,
            route: false,
          },
          _cascadeId: base.cascadeId,
          _taskId: t.id,
        });
      }
    }
  }
  return jobs;
}
