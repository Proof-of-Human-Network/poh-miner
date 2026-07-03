/**
 * Index public job history from on-chain stateTransitions + scanResults.
 */

export const PROMPT_PREVIEW_MAX = 500;

export function promptPreviewFromJob(job) {
  const raw = job?.payload?.prompt || job?.payload?.message || job?.payload?.question || '';
  return String(raw).slice(0, PROMPT_PREVIEW_MAX) || null;
}

export function buildJobSubmittedIndex(chain) {
  const map = new Map();
  if (!Array.isArray(chain)) return map;
  for (const block of chain) {
    if (!block?.stateTransitions?.length) continue;
    const height = block.height ?? 0;
    const blockTs = block.timestamp || Date.now();
    for (const t of block.stateTransitions) {
      if (t?.type !== 'job-submitted' || !t.jobId) continue;
      map.set(t.jobId, {
        jobId: t.jobId,
        jobType: t.jobType || null,
        skillId: t.skillId || null,
        requesterAddress: t.requesterAddress || null,
        maxBudget: t.maxBudget || 0,
        promptPreview: t.promptPreview || null,
        model: t.model || null,
        dataset: t.dataset || null,
        address: t.address || null,
        submittedAt: t.timestamp || blockTs,
        blockHeight: height,
        source: 'chain',
      });
    }
  }
  return map;
}

export function buildResultsIndex(chain) {
  const map = new Map();
  if (!Array.isArray(chain)) return map;
  for (const block of chain) {
    const results = block.scanResults || block.skillResults || [];
    if (!results.length) continue;
    const height = block.height ?? 0;
    for (const r of results) {
      const rid = r.requestId;
      if (!rid) continue;
      map.set(rid, {
        verdict: r.verdict || null,
        profile: r.profile || null,
        reasoning: r.reasoning || null,
        modelUsed: r.modelUsed || null,
        minerWallet: r.minerWallet || null,
        resultBlockHeight: height,
        mined: true,
      });
    }
  }
  return map;
}

export function mergeWithLocalJobs(chainJobs, localRecords, requesterAddress, limit = 20) {
  const byId = new Map((chainJobs || []).map(j => [j.jobId, j]));
  if (!requesterAddress || !localRecords?.length) {
    return [...byId.values()].sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)).slice(0, limit);
  }
  for (const rec of localRecords) {
    const job = rec?.job;
    if (!job?.id || job.requesterAddress !== requesterAddress) continue;
    const existing = byId.get(job.id);
    const localEntry = {
      jobId: job.id,
      jobType: job.type || null,
      skillId: job.skillId || null,
      requesterAddress: job.requesterAddress,
      promptPreview: promptPreviewFromJob(job),
      model: job.model || null,
      dataset: job.dataset || job.datasetId || null,
      submittedAt: rec.createdAt || rec.updatedAt || Date.now(),
      mined: existing?.mined || false,
      verdict: rec.result?.verdict || existing?.verdict || null,
      profile: rec.result?.profile || existing?.profile || null,
      reasoning: rec.result?.reasoning || existing?.reasoning || null,
      source: existing?.mined ? 'chain' : 'local',
    };
    if (!existing?.mined) byId.set(job.id, { ...existing, ...localEntry });
  }
  return [...byId.values()].sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)).slice(0, limit);
}

export function getWalletJobHistory(chain, requesterAddress, opts = {}) {
  const { limit = 20, localRecords = [] } = opts;
  if (!requesterAddress) return [];
  const submitted = buildJobSubmittedIndex(chain);
  const results = buildResultsIndex(chain);
  const chainJobs = [];
  for (const [jobId, meta] of submitted) {
    if (meta.requesterAddress !== requesterAddress) continue;
    const result = results.get(jobId);
    chainJobs.push({ ...meta, ...(result || { mined: false }) });
  }
  return mergeWithLocalJobs(chainJobs, localRecords, requesterAddress, limit);
}

export function extractSkillMemory(jobs) {
  if (!Array.isArray(jobs)) return null;
  for (const j of jobs) {
    const output = j.profile?.skillOutput;
    const skillId = j.profile?.skillId || j.skillId;
    if (output != null && skillId) {
      return { skillId, output, at: j.submittedAt || Date.now(), jobId: j.jobId, fromChain: j.source === 'chain' && j.mined };
    }
  }
  return null;
}

export function extractComputeMemory(jobs) {
  if (!Array.isArray(jobs)) return null;
  for (const j of jobs) {
    const reply = j.profile?.computeOutput;
    if (reply && (j.jobType === 'compute' || j.verdict === 'COMPUTE_RESULT')) {
      return {
        skillId: '__compute__',
        output: { computeOutput: reply, model: j.profile?.model || j.model, promptPreview: j.promptPreview },
        at: j.submittedAt || Date.now(),
        jobId: j.jobId,
        fromChain: j.source === 'chain' && j.mined,
        fromCompute: true,
      };
    }
  }
  return null;
}

export function extractChatTurns(jobs, { limit = 8 } = {}) {
  if (!Array.isArray(jobs) || !jobs.length) return [];
  const ordered = [...jobs].sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
  const turns = [];
  for (const j of ordered) {
    if (j.promptPreview) turns.push({ role: 'user', content: j.promptPreview, jobId: j.jobId, fromChain: j.source === 'chain' });
    const reply = j.profile?.computeOutput || j.profile?.nlResponse;
    if (reply) turns.push({ role: 'assistant', content: String(reply).slice(0, 8000), jobId: j.jobId, fromChain: j.source === 'chain' });
  }
  return turns.slice(-limit * 2);
}

export function buildWalletJobContext(chain, requesterAddress, opts = {}) {
  const jobs = getWalletJobHistory(chain, requesterAddress, opts);
  return {
    jobs,
    latestSkillMemory: extractSkillMemory(jobs) || extractComputeMemory(jobs),
    chatTurns: extractChatTurns(jobs, { limit: opts.chatTurnLimit || 8 }),
  };
}

/** Full assistant reply text from a merged job record (chain or local). */
export function extractReplyText(job) {
  if (!job) return '';
  const profile = job.profile || {};
  if (profile.computeOutput) return String(profile.computeOutput);
  if (profile.nlResponse) return String(profile.nlResponse);
  if (profile.skillOutput) {
    const out = profile.skillOutput;
    if (out.analysis?.summary) return String(out.analysis.summary);
    if (typeof out === 'string') return out;
    try { return JSON.stringify(out).slice(0, 4000); } catch { return ''; }
  }
  if (job.reasoning) return String(job.reasoning).slice(0, 4000);
  return '';
}

/** Flatten a job record into a search-index document. */
export function jobToSearchDocument(job) {
  if (!job?.jobId) return null;
  const promptPreview = job.promptPreview || '';
  const replyText = extractReplyText(job);
  if (!promptPreview && !replyText) return null;
  return {
    id: job.jobId,
    jobId: job.jobId,
    promptPreview,
    replyText: replyText.slice(0, 8000),
    replySnippet: replyText.slice(0, 240),
    skillId: job.skillId || job.profile?.skillId || null,
    jobType: job.jobType || null,
    requesterAddress: job.requesterAddress || null,
    verdict: job.verdict || null,
    blockHeight: job.resultBlockHeight ?? job.blockHeight ?? null,
    submittedAt: job.submittedAt || Date.now(),
    mined: !!job.mined,
    source: job.source || (job.mined ? 'chain' : 'local'),
  };
}

/** Build search documents from an entire chain + optional local job cache. */
export function buildAllSearchDocuments(chain, localRecords = []) {
  const submitted = buildJobSubmittedIndex(chain);
  const results = buildResultsIndex(chain);
  const docs = new Map();
  for (const [jobId, meta] of submitted) {
    const merged = { ...meta, ...(results.get(jobId) || { mined: false }) };
    const doc = jobToSearchDocument(merged);
    if (doc) docs.set(jobId, doc);
  }
  for (const rec of localRecords || []) {
    const job = rec?.job;
    if (!job?.id) continue;
    const existing = docs.get(job.id);
    const merged = {
      jobId: job.id,
      jobType: job.type,
      skillId: job.skillId,
      requesterAddress: job.requesterAddress,
      promptPreview: promptPreviewFromJob(job),
      submittedAt: rec.createdAt || rec.updatedAt || Date.now(),
      mined: existing?.mined || false,
      verdict: rec.result?.verdict || existing?.verdict || null,
      profile: rec.result?.profile || existing?.profile || null,
      reasoning: rec.result?.reasoning || existing?.reasoning || null,
      source: existing?.mined ? 'chain' : 'local',
    };
    const doc = jobToSearchDocument({ ...existing, ...merged });
    if (doc && (!existing?.mined || doc.replyText)) docs.set(job.id, doc);
  }
  return [...docs.values()];
}
