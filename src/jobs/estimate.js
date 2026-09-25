/**
 * Job fee estimator — the eth_estimateGas analog for DAI jobs.
 *
 * Given the same inputs a job or chat request carries (prompt, history, file
 * attachments, a skill, MCP tools, a dataset), answer: how many AI tokens will the
 * pipeline use, what is the minimum fee the node will accept, and what budget
 * should the requester escrow?
 *
 * The estimator does not run anything. It rebuilds the prompts the executors
 * would build (same builders, same slice limits, same token counter as the node's
 * own metering) and sizes them. Where the size depends on something that only
 * exists after running — what a skill fetched, what an MCP tool returned — the
 * code's own caps bound it, and the result is a {min, max} range with basis
 * 'bounded'. Where it depends on a model's choice (the planner picking tasks) the
 * plan is 'predicted' from the deterministic router. Nothing is estimated with a
 * number that is not either measured or a cap from the executing code.
 *
 * Mirrors: _computeBoardJob / computeAndSubmitJob (compute), _routeComputePrompt
 * (skill / cascade routing), the skill job path, and _runPaidCompute (chat).
 */

import { GAS, estimateTokens, estimateChatTokens, outputTokenCap } from './gas-estimator.js';
import { DIRECT_SYSTEM_PROMPT, datasetJobSystemPrompt, knowledgeSkillSystemPrompt, skillJobSystemPrompt } from './prompts.js';
import { measureAttachments, applyAttachmentsToMessages, MAX_ATTACHMENTS } from '../ai/chat-attachments.js';
import { buildAggregatorPrompt, AGGREGATOR_BLOCK_MAX_CHARS } from '../ai/task-cascade.js';
import { MAX_SLICE_CHARS } from '../datasets/hf-dataset-manager.js';
import { SKILL_TOKEN_COSTS } from '../skills/manager.js';

/** Output ceiling of every model call that does not pass its own maxTokens (qvac.chat default). */
export const DEFAULT_OUTPUT_TOKENS = 512;

/** Limits copied from the executors — each is the cap of a specific injection site. */
export const LIMITS = Object.freeze({
  HISTORY_TURN_CHARS: 8000,          // per prior turn in a compute job
  SKILL_DATA_CHARS: 6000,            // routed skill → LLM "Fetched data"
  SKILL_DATA_CHARS_SOCIAL: 12000,    // …for the social/profile skills
  SKILL_JOB_DATA_CHARS: 10000,       // skill job carrying payload.question
  CASCADE_BLOCK_CHARS: AGGREGATOR_BLOCK_MAX_CHARS,
  CASCADE_CONTEXT_CHARS: 3000,       // prior-step context folded into an llm-generate task
  MAX_PROMPT_CHARS: 400_000,
  MAX_MESSAGES: 200,
  MAX_MCP: 8,
});

// Model calls whose prompt depends on live network search results we cannot see
// (dataset disambiguation, HF model picking). Assumed, and reported as such.
const ASSUMED_LOOKUP_CALL = Object.freeze({ prompt: { min: 150, max: 1500 }, output: { min: 1, max: 256 } });
// Skills may issue several fetches per allowed endpoint; the code does not bound it.
const ASSUMED_FETCHES_PER_ENDPOINT = 3;

export class EstimateError extends Error {
  constructor(status, code, message, param = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.param = param;
  }
}

const range = (min, max = min) => ({ min, max });
const addRange = (a, b) => ({ min: a.min + b.min, max: a.max + b.max });
const ZERO = range(0);

/** Same folding _llmChat applies: learned-feedback guidance joins the system message. */
function foldGuidance(messages, guidance) {
  if (!guidance) return messages;
  const i = messages.findIndex(m => m.role === 'system');
  return i >= 0
    ? messages.map((m, k) => (k === i ? { ...m, content: `${m.content}\n\n${guidance}` } : m))
    : [{ role: 'system', content: guidance }, ...messages];
}

// ── input ───────────────────────────────────────────────────────────────────

function textOf(content, where) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content) && content.every(p => typeof p === 'string' || p?.type === 'text' || p?.type === 'input_text')) {
    return content.map(p => (typeof p === 'string' ? p : String(p.text ?? ''))).join('\n');
  }
  throw new EstimateError(400, 'invalid_content', `${where} must be a string or text parts (send images via "attachments")`, where);
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new EstimateError(400, 'invalid_body', 'Request body must be a JSON object');
  }
  const str = (v, name, max = LIMITS.MAX_PROMPT_CHARS) => {
    if (v == null) return null;
    if (typeof v !== 'string') throw new EstimateError(400, 'invalid_field', `${name} must be a string`, name);
    if (v.length > max) throw new EstimateError(413, 'too_large', `${name} is over ${max} characters`, name);
    return v;
  };

  const hasMessages = Array.isArray(input.messages) && input.messages.length > 0;
  const prompt = str(input.prompt ?? input.message ?? input.question, 'prompt');
  if (hasMessages && prompt) throw new EstimateError(400, 'ambiguous_input', 'Send either "messages" or "prompt", not both');

  let type = input.type ?? (hasMessages ? 'chat' : input.skillId && !prompt ? 'skill' : 'compute');
  if (!['compute', 'chat', 'skill'].includes(type)) {
    throw new EstimateError(400, 'invalid_type', `type must be "compute", "chat" or "skill" (got "${type}")`, 'type');
  }
  if (hasMessages && type !== 'chat') throw new EstimateError(400, 'invalid_type', '"messages" is only valid with type "chat"', 'type');

  let messages = null;
  if (hasMessages) {
    if (input.messages.length > LIMITS.MAX_MESSAGES) throw new EstimateError(413, 'too_large', `at most ${LIMITS.MAX_MESSAGES} messages`, 'messages');
    messages = input.messages.map((m, i) => {
      let role = m?.role === 'developer' ? 'system' : m?.role;
      if (!['system', 'user', 'assistant'].includes(role)) {
        throw new EstimateError(400, 'invalid_role', `messages[${i}].role must be system, user or assistant`, `messages[${i}].role`);
      }
      return { role, content: textOf(m.content, `messages[${i}].content`) };
    });
  }
  if (type === 'chat' && !messages && !prompt) throw new EstimateError(400, 'missing_prompt', 'type "chat" needs "messages" or "prompt"');
  if (type === 'compute' && !prompt && !(Array.isArray(input.attachments) && input.attachments.length)) {
    throw new EstimateError(400, 'missing_prompt', '"prompt" is required for compute jobs (or send attachments)', 'prompt');
  }
  if (type === 'skill' && !input.skillId) throw new EstimateError(400, 'missing_skill', 'type "skill" needs "skillId"', 'skillId');

  let history = [];
  if (input.history != null) {
    if (!Array.isArray(input.history)) throw new EstimateError(400, 'invalid_field', 'history must be an array', 'history');
    history = input.history;
  }
  let attachments = [];
  if (input.attachments != null) {
    if (!Array.isArray(input.attachments)) throw new EstimateError(400, 'invalid_field', 'attachments must be an array', 'attachments');
    attachments = input.attachments;
  }
  let mcp = [];
  if (input.mcp != null) {
    if (!Array.isArray(input.mcp)) throw new EstimateError(400, 'invalid_field', 'mcp must be an array of tool names', 'mcp');
    if (input.mcp.length > LIMITS.MAX_MCP) throw new EstimateError(400, 'too_many_mcp', `at most ${LIMITS.MAX_MCP} MCP tools per job`, 'mcp');
    mcp = input.mcp.map((t, i) => {
      const name = typeof t === 'string' ? t : (t?.tool || t?.name);
      if (typeof name !== 'string' || !name) throw new EstimateError(400, 'invalid_field', `mcp[${i}] must be a tool name or {tool}`, `mcp[${i}]`);
      return name;
    });
  }

  let maxOut = DEFAULT_OUTPUT_TOKENS;
  if (input.maxOutputTokens != null || input.max_tokens != null) {
    maxOut = Number(input.maxOutputTokens ?? input.max_tokens);
    if (!Number.isInteger(maxOut) || maxOut < 1 || maxOut > GAS.OUTPUT_HARD_MAX) {
      throw new EstimateError(400, 'invalid_field', `maxOutputTokens must be an integer 1..${GAS.OUTPUT_HARD_MAX}`, 'maxOutputTokens');
    }
  }

  return {
    type, prompt, messages, history, attachments, mcp, maxOut,
    outputExplicit: input.maxOutputTokens != null || input.max_tokens != null,
    model: str(input.model, 'model', 200),
    currency: str(input.currency, 'currency', 40) || 'DAI',
    requesterAddress: str(input.requesterAddress, 'requesterAddress', 200),
    address: str(input.address, 'address', 200),
    skillId: str(input.skillId, 'skillId', 200),
    dataset: str(input.dataset ?? input.datasetId, 'dataset', 300),
    route: input.route !== false,
  };
}

// ── estimator ───────────────────────────────────────────────────────────────

/**
 * @param {object} rawInput  see docs/README "Fee estimation"
 * @param {object} deps      node-supplied capabilities (kept injectable so this is testable
 *                           without a running node): qvac, config, resolveModel, normalizeCurrency,
 *                           isKnownCurrency, quoteFee, getSkill, isSkillEnabled, route,
 *                           datasetSlice, history, feedbackGuidance, skillSystemPrompt,
 *                           socialSkillIds, mcpToolExists
 */
export async function estimateJob(rawInput, deps) {
  const req = normalizeInput(rawInput);
  const { qvac, config } = deps;
  const warnings = [];
  const breakdown = [];
  const calls = [];
  const gasPrice = config.gasPrice || GAS.DEFAULT_GAS_PRICE;

  const currency = deps.normalizeCurrency(req.currency);
  if (!deps.isKnownCurrency(currency)) {
    throw new EstimateError(400, 'unknown_currency', `Unknown fee currency "${req.currency}". See /api/assets.`, 'currency');
  }
  const target = req.type === 'chat' ? 'chat' : 'job';
  const est = (messages, systemPrompt) => qvac.estimateMessagesTokens(messages, systemPrompt);

  // ── attachments (decoded and sized, never written to disk) ────────────────
  let files = [];
  if (req.attachments.length) {
    if (req.attachments.length > MAX_ATTACHMENTS) warnings.push(`only the first ${MAX_ATTACHMENTS} attachments are used`);
    const measured = measureAttachments(req.attachments, { maxBytes: deps.maxAttachmentBytes });
    if (measured.errors.length && !measured.files.length) {
      throw new EstimateError(400, 'attachment_error', measured.errors.join('; '), 'attachments');
    }
    if (measured.errors.length) warnings.push(`attachment skipped: ${measured.errors.join('; ')}`);
    files = measured.files;
  }
  const imageCount = files.filter(f => f.kind === 'image').length;
  const hasImages = imageCount > 0;
  if (hasImages) {
    warnings.push(`${imageCount} image(s): the node meters text only, so images add no billed tokens — but a vision model spends context window on them`);
  }

  const model = deps.resolveModel(req.model, { hasImages });

  // The user turn(s) exactly as the executor assembles them.
  const basePrompt = req.prompt || (files.length ? 'Please analyze the attached file(s).' : '');
  let userMessages;
  let prompt = basePrompt;
  if (req.type === 'chat' && req.messages) {
    userMessages = req.messages;
    if (files.length) userMessages = applyAttachmentsToMessages(userMessages, files).messages;
  } else if (files.length) {
    userMessages = applyAttachmentsToMessages([{ role: 'user', content: basePrompt }], files).messages;
    prompt = userMessages.find(m => m.role === 'user')?.content || basePrompt;   // attachment text is part of the routed prompt
  } else {
    userMessages = [{ role: 'user', content: basePrompt }];
  }
  for (const f of files.filter(x => x.kind === 'text')) {
    breakdown.push({ id: `attachment:${f.name}`, kind: 'attachment', ref: f.name, tokens: range(Math.ceil((f.text.length + 40) / 4)), basis: 'measured',
      note: `${f.bytes} bytes of text inlined into the prompt` });
  }
  breakdown.unshift({ id: 'prompt', kind: 'prompt', tokens: range(Math.ceil(((req.prompt || '').length + 4) / 4)), basis: 'measured',
    note: req.messages ? `${req.messages.length} message(s)` : undefined });

  // ── which pipeline runs ───────────────────────────────────────────────────
  let mode = 'direct';
  let routeInfo = { predicted: false, reason: null };
  let skill = null;          // { id, entry }
  let cascadePlan = null;
  let plannerPrompt = null;

  if (req.type === 'skill') {
    mode = 'skill-job';
  } else if (target === 'chat') {
    mode = 'direct';
  } else if (req.dataset) {
    mode = 'direct';
    routeInfo.reason = 'dataset pinned — routing skipped';
  } else if (!req.route) {
    routeInfo.reason = 'route:false — routing skipped';
  } else if (hasImages) {
    routeInfo.reason = 'image attachments — routing skipped';
  } else if (req.skillId) {
    mode = 'routed-skill';
    routeInfo.reason = `skill ${req.skillId} requested`;
  } else if (req.mcp.length) {
    mode = 'cascade';
    routeInfo.reason = 'MCP tools requested';
    cascadePlan = {
      type: 'tasks', reason: 'requested-mcp',
      stages: [req.mcp.map(t => ({ kind: 'mcp', id: `mcp:${t}`, server: t.includes('__') ? t.split('__')[0] : null, tool: t, segment: prompt }))],
    };
  } else {
    // The router the job would use, with the planner call captured instead of made.
    let routed = null;
    try { routed = await deps.route(prompt); } catch { routed = null; }
    plannerPrompt = routed?.plannerPrompt || null;
    const r = routed?.route;
    routeInfo = { predicted: true, reason: r?.reason || r?.type || 'chat' };
    if (r?.type === 'skill' && r.skillId) { mode = 'routed-skill'; req.skillId = r.skillId; }
    else if ((r?.type === 'tasks' || r?.type === 'cascade') && r.tasks?.stages?.length) { mode = 'cascade'; cascadePlan = r.tasks; }
    else if (r && !['chat'].includes(r.type)) {
      warnings.push(`the router chose "${r.type}", which compute jobs do not execute — falling back to a plain model call`);
    }
    if (mode !== 'direct' || plannerPrompt) {
      warnings.push('routing is predicted from the deterministic planner; the live model-planner may choose different tasks');
    }
  }

  // Prior turns for a compute job: client history plus (with requesterAddress) the
  // on-chain public turns the executor merges in. Loaded for every compute job
  // because routed modes can fall back to the direct call.
  let history = [];
  if (req.type === 'compute') history = deps.history ? await deps.history(req.requesterAddress, req.history) : req.history;
  else if (req.history.length) warnings.push('history is ignored for this type — put prior turns in "messages"');
  history = (history || []).filter(t => t?.role && t?.content && ['user', 'assistant', 'system'].includes(t.role))
    .map(t => ({ role: t.role, content: String(t.content).slice(0, LIMITS.HISTORY_TURN_CHARS) }));

  // ── build model calls ─────────────────────────────────────────────────────
  let finalPromptForCap = null;    // what outputTokenCap subtracts (mirrors the executor)
  let budgetCapApplies = false;
  let guidance = '';
  try { guidance = (await deps.feedbackGuidance?.()) || ''; } catch { /* best-effort, as in _llmChat */ }

  const addCall = (purpose, { min, max, systemPrompt, guided = false, out, note }) => {
    const wrap = (msgs) => est(guided ? foldGuidance(msgs, guidance) : msgs, systemPrompt);
    const c = { purpose, promptTokens: range(wrap(min), wrap(max ?? min)), outputTokens: out, ...(note ? { note } : {}) };
    calls.push(c);
    return c;
  };

  // Chat honours max_tokens; job execution never passes it, so the model default applies.
  const finalOut = target === 'chat' ? req.maxOut : Math.min(req.maxOut, DEFAULT_OUTPUT_TOKENS);
  if (target === 'job' && req.outputExplicit && req.maxOut > DEFAULT_OUTPUT_TOKENS && mode === 'direct') {
    warnings.push(`job execution does not pass max_tokens to the model, so output is capped at ${DEFAULT_OUTPUT_TOKENS} tokens regardless of budget`);
  }

  if (mode === 'direct') {
    const messages = [];
    let systemPrompt;
    if (target === 'job') {
      if (req.dataset) {
        const d = await deps.datasetSlice(req.dataset, prompt);
        if (!d.installed) {
          throw new EstimateError(422, 'dataset_not_installed', `Dataset "${req.dataset}" is not installed on this miner — the job would fail`, 'dataset');
        }
        messages.push({ role: 'system', content: datasetJobSystemPrompt(req.dataset, d.slice) });
        breakdown.push({ id: `dataset:${req.dataset}`, kind: 'dataset', ref: req.dataset,
          tokens: range(Math.ceil(((d.slice || '').length + 4) / 4)), basis: 'measured',
          note: `relevant rows selected for this prompt (cap ${MAX_SLICE_CHARS} chars)` });
      } else {
        systemPrompt = DIRECT_SYSTEM_PROMPT;
      }
      messages.push(...history);
      if (history.length) breakdown.push({ id: 'history', kind: 'history', tokens: range(est(history)), basis: 'measured', note: `${history.length} prior turn(s)` });
    }
    messages.push(...userMessages);
    if (req.skillId) warnings.push('skillId was ignored: a dataset/route:false/image job runs the model directly');
    if (req.mcp.length) warnings.push('mcp was ignored: MCP tools only run through routing');

    addCall('answer', { min: messages, systemPrompt, out: range(1, finalOut) });
    finalPromptForCap = est(messages);                 // executors size the cap without the persona
    budgetCapApplies = true;
  }

  // Shared: skill compute range (from the manifest's allowed endpoints).
  const skillCompute = (entry) => {
    const endpoints = entry?.manifest?.allowedEndpoints?.length || 1;
    return range(
      SKILL_TOKEN_COSTS.BASE,
      endpoints * SKILL_TOKEN_COSTS.PER_FETCH * ASSUMED_FETCHES_PER_ENDPOINT
        + Math.ceil(SKILL_TOKEN_COSTS.TIMEOUT_MS / 100) * SKILL_TOKEN_COSTS.PER_100MS,
    );
  };
  const checkSkill = (id) => {
    const entry = deps.getSkill(id);
    if (!entry) throw new EstimateError(404, 'skill_not_found', `Skill "${id}" is not installed on this node`, 'skillId');
    if (deps.isSkillEnabled && !deps.isSkillEnabled(id)) warnings.push(`skill ${id} is disabled on this node — the job would be ignored`);
    if (entry.executable === false || (entry.networkSourced && !entry.trusted)) {
      warnings.push(`skill ${id} is not executable on this node (network-delivered code is not run)`);
    }
    return entry;
  };

  let skillComputeTotal = ZERO;

  if (mode === 'routed-skill') {
    const entry = checkSkill(req.skillId);
    skill = { id: req.skillId, entry };
    if (entry.private === true && entry.code) {
      const dataMax = deps.socialSkillIds.has(req.skillId) ? LIMITS.SKILL_DATA_CHARS_SOCIAL : LIMITS.SKILL_DATA_CHARS;
      const system = { role: 'system', content: deps.skillSystemPrompt(req.skillId, entry.context) };
      const userAt = (n) => ({ role: 'user', content: `Fetched data:\n${'x'.repeat(n)}\n\nUser question: ${prompt}` });
      addCall('skill-answer', { min: [system, userAt(0)], max: [system, userAt(dataMax)], guided: true, out: range(1, DEFAULT_OUTPUT_TOKENS),
        note: `skill output is injected up to ${dataMax} characters` });
      skillComputeTotal = skillCompute(entry);
      breakdown.push({ id: `skill:${req.skillId}`, kind: 'skill', ref: req.skillId,
        tokens: range(0, Math.ceil(dataMax / 4)), basis: 'bounded', note: `fetched data injected into the prompt, capped at ${dataMax} characters` });
      breakdown.push({ id: `skill-compute:${req.skillId}`, kind: 'skill-compute', ref: req.skillId, tokens: skillComputeTotal, basis: 'assumed',
        note: `sandbox metering (${SKILL_TOKEN_COSTS.BASE} base + ${SKILL_TOKEN_COSTS.PER_FETCH}/fetch + ${SKILL_TOKEN_COSTS.PER_100MS}/100ms); ${ASSUMED_FETCHES_PER_ENDPOINT} fetches per allowed endpoint assumed` });
    } else if (entry.private === true && entry.context) {
      const msgs = [{ role: 'system', content: knowledgeSkillSystemPrompt(req.skillId, entry.context) }, { role: 'user', content: prompt }];
      addCall('skill-answer', { min: msgs, guided: true, out: range(1, DEFAULT_OUTPUT_TOKENS) });
      breakdown.push({ id: `skill:${req.skillId}`, kind: 'skill', ref: req.skillId,
        tokens: range(Math.ceil(Math.min(entry.context.length, 8600) / 4)), basis: 'measured', note: 'reference context injected into the system prompt' });
    } else {
      warnings.push(`skill ${req.skillId} is not a private/builtin skill, which compute routing does not run — falling back to a plain model call`);
      mode = 'direct';
      const msgs = [...history, ...userMessages];
      addCall('answer', { min: msgs, systemPrompt: DIRECT_SYSTEM_PROMPT, out: range(1, finalOut) });
      finalPromptForCap = est(msgs); budgetCapApplies = true;
    }
  }

  if (mode === 'skill-job') {
    const entry = checkSkill(req.skillId);
    skill = { id: req.skillId, entry };
    skillComputeTotal = skillCompute(entry);
    breakdown.push({ id: `skill-compute:${req.skillId}`, kind: 'skill-compute', ref: req.skillId, tokens: skillComputeTotal, basis: 'assumed',
      note: `sandbox metering (${SKILL_TOKEN_COSTS.BASE} base + ${SKILL_TOKEN_COSTS.PER_FETCH}/fetch + ${SKILL_TOKEN_COSTS.PER_100MS}/100ms); ${ASSUMED_FETCHES_PER_ENDPOINT} fetches per allowed endpoint assumed` });
    if (req.prompt) {
      const system = { role: 'system', content: skillJobSystemPrompt(entry.context || '') };
      const userAt = (n) => ({ role: 'user', content: `Fetched data:\n\`\`\`json\n${'x'.repeat(n)}\n\`\`\`\n\nUser question: ${req.prompt}` });
      addCall('skill-answer', { min: [system, userAt(0)], max: [system, userAt(LIMITS.SKILL_JOB_DATA_CHARS)], guided: true, out: range(1, DEFAULT_OUTPUT_TOKENS),
        note: `skill output is injected up to ${LIMITS.SKILL_JOB_DATA_CHARS} characters` });
      breakdown.push({ id: `skill:${req.skillId}`, kind: 'skill', ref: req.skillId, tokens: range(0, Math.ceil(LIMITS.SKILL_JOB_DATA_CHARS / 4)),
        basis: 'bounded', note: `fetched data injected into the prompt, capped at ${LIMITS.SKILL_JOB_DATA_CHARS} characters` });
    } else {
      warnings.push('no question given: a skill job without one returns raw skill output and makes no model call');
    }
  }

  if (mode === 'cascade') {
    if (plannerPrompt) {
      addCall('planner', { min: [{ role: 'user', content: plannerPrompt }], guided: true, out: range(1, DEFAULT_OUTPUT_TOKENS),
        note: 'the model-planner call (its prompt lists retrieved skills/MCP tools)' });
      breakdown.push({ id: 'planner', kind: 'planner', tokens: range(calls.at(-1).promptTokens.min), basis: 'measured', note: 'planner prompt' });
    }
    const tasks = (cascadePlan.stages || []).flat();
    const blocksAt = (which) => tasks.map(t => {
      const head = `### ${t.id} (${t.kind}${t.skillId ? ':' + t.skillId : ''}${t.server ? ' @' + t.server : ''})\n`;
      let cap = LIMITS.CASCADE_BLOCK_CHARS;
      if (t.kind === 'llm-generate') cap = Math.min(cap, DEFAULT_OUTPUT_TOKENS * 4);
      return head + (which === 'max' ? 'x'.repeat(cap) : '');
    }).join('\n\n');

    let onlyFastPath = tasks.length === 1 && ['llm-generate', 'hf-model'].includes(tasks[0].kind);
    for (const t of tasks) {
      if (t.kind === 'skill') {
        const entry = deps.getSkill(t.skillId);
        if (!entry) warnings.push(`planned skill ${t.skillId} is not installed here`);
        else if (deps.isSkillEnabled && !deps.isSkillEnabled(t.skillId)) warnings.push(`planned skill ${t.skillId} is disabled on this node`);
        // Cascades run skills through runSkill and discard its tokensUsed, but the work is real.
        const sc = skillCompute(entry);
        skillComputeTotal = addRange(skillComputeTotal, sc);
        breakdown.push({ id: t.id, kind: 'skill', ref: t.skillId, tokens: range(0, Math.ceil(LIMITS.CASCADE_BLOCK_CHARS / 4)), basis: 'bounded',
          note: `result read by the aggregator up to ${LIMITS.CASCADE_BLOCK_CHARS} characters` });
        breakdown.push({ id: `skill-compute:${t.skillId}`, kind: 'skill-compute', ref: t.skillId, tokens: sc, basis: 'assumed', note: 'sandbox metering' });
      } else if (t.kind === 'mcp') {
        if (deps.mcpToolExists && !deps.mcpToolExists(t.tool)) warnings.push(`MCP tool ${t.tool} is not connected on this node — that step would fail and the answer would note the gap`);
        breakdown.push({ id: t.id, kind: 'mcp', ref: t.tool, tokens: range(0, Math.ceil(LIMITS.CASCADE_BLOCK_CHARS / 4)), basis: 'bounded',
          note: `tool result read by the aggregator up to ${LIMITS.CASCADE_BLOCK_CHARS} characters; MCP calls themselves are not token-metered` });
      } else if (t.kind === 'dataset') {
        calls.push({ purpose: 'dataset-disambiguation', promptTokens: ASSUMED_LOOKUP_CALL.prompt, outputTokens: ASSUMED_LOOKUP_CALL.output, basis: 'assumed' });
        breakdown.push({ id: t.id, kind: 'dataset', tokens: range(0, Math.ceil(Math.min(MAX_SLICE_CHARS, LIMITS.CASCADE_BLOCK_CHARS) / 4)), basis: 'bounded',
          note: `dataset rows (cap ${MAX_SLICE_CHARS} chars); which dataset is chosen depends on a model call over search results` });
      } else if (t.kind === 'hf-model') {
        calls.push({ purpose: 'hf-model-pick', promptTokens: ASSUMED_LOOKUP_CALL.prompt, outputTokens: ASSUMED_LOOKUP_CALL.output, basis: 'assumed' });
        breakdown.push({ id: t.id, kind: 'hf-model', tokens: range(0, 400), basis: 'assumed', note: 'model suggestions' });
      } else if (t.kind === 'llm-generate') {
        const q = t.query || prompt;
        addCall('llm-generate', {
          min: [{ role: 'user', content: q }],
          max: [{ role: 'user', content: t.dependsOnPrior ? `${q}\n\nContext from previous steps:\n${'x'.repeat(LIMITS.CASCADE_CONTEXT_CHARS)}` : q }],
          out: range(1, DEFAULT_OUTPUT_TOKENS),
        });
      }
    }
    if (!onlyFastPath) {
      const minP = buildAggregatorPrompt(prompt, blocksAt('min'), cascadePlan);
      const maxP = buildAggregatorPrompt(prompt, blocksAt('max'), cascadePlan);
      addCall('aggregator', {
        min: [{ role: 'system', content: minP.system }, { role: 'user', content: minP.user }],
        max: [{ role: 'system', content: maxP.system }, { role: 'user', content: maxP.user }],
        guided: true, out: range(1, DEFAULT_OUTPUT_TOKENS),
        note: `${tasks.length} specialist result(s) synthesised into one answer`,
      });
    }
  }

  // ── totals ────────────────────────────────────────────────────────────────
  const promptTokens = calls.reduce((a, c) => addRange(a, c.promptTokens), ZERO);
  const outputTokens = calls.reduce((a, c) => addRange(a, c.outputTokens), ZERO);
  const total = addRange(addRange(promptTokens, outputTokens), skillComputeTotal);

  // ── fees ──────────────────────────────────────────────────────────────────
  // The gate is what the node rejects below. It is deliberately not the pipeline
  // cost: /job floors at a fixed heuristic, chat at the prompt alone.
  const gateTokens = target === 'chat'
    ? estimateChatTokens(est(userMessages), 0)
    : estimateTokens(0, req.address);
  const gate = { endpoint: target === 'chat' ? '/v1/chat/completions | /openai/v1/chat/completions' : '/job', tokens: gateTokens };
  const recommendedTokens = Math.max(gateTokens, total.max);

  const quote = (tokens) => {
    if (currency === 'DAI') return { raw: Math.max(1, Math.ceil(tokens * gasPrice)), currency: 'DAI', gasPrice };
    const q = deps.quoteFee(tokens, currency);
    return q?.unavailable
      ? { unavailable: true, message: q.message, currency }
      : { raw: q.raw, currency, source: q.source, ...(q.via ? { via: q.via } : {}), ...(q.display != null ? { display: q.display } : {}) };
  };

  const fees = {
    currency,
    minimum:     { tokens: gate.tokens,       ...quote(gate.tokens), gate: gate.endpoint },
    recommended: { tokens: recommendedTokens, ...quote(recommendedTokens) },
  };
  if (currency !== 'DAI') {
    const inDai = (tokens) => ({ tokens, raw: Math.max(1, Math.ceil(tokens * gasPrice)), currency: 'DAI' });
    fees.dai = { minimum: inDai(gate.tokens), recommended: inDai(recommendedTokens) };
  }

  // Output the recommended bid buys on the final call (only the direct path is budget-capped).
  const outputCap = budgetCapApplies
    ? { budgetCapApplies: true, tokens: Math.min(outputTokenCap(recommendedTokens, 1, finalPromptForCap), finalOut) }
    : { budgetCapApplies: false, note: 'routed pipelines are not capped by the budget — it must clear the minimum, and buys queue priority' };

  warnings.push('token counts use the node\'s own ~4 characters/token metering, not the model\'s tokenizer');

  return {
    ok: true,
    type: req.type,
    target,
    model,
    currency,
    gasPrice,
    route: { mode, ...routeInfo, ...(skill ? { skillId: skill.id } : {}),
      ...(cascadePlan ? { tasks: (cascadePlan.stages || []).flat().map(t => ({ id: t.id, kind: t.kind, ...(t.skillId ? { skillId: t.skillId } : {}), ...(t.tool ? { tool: t.tool } : {}) })) } : {}) },
    tokens: { prompt: promptTokens, output: outputTokens, skillCompute: skillComputeTotal, total },
    calls,
    breakdown,
    fees,
    outputCap,
    warnings,
  };
}
