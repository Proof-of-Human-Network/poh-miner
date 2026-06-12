export class FeedbackStore {
  constructor() {
    this._byJob   = new Map(); // jobId → transition
    this._byMiner = new Map(); // minerAddress → { positive, negative, total, recent[] }
  }

  apply(transition) {
    if (transition.type !== 'job-feedback') return;
    this._byJob.set(transition.jobId, transition);
    const m = this._byMiner.get(transition.minerAddress)
           || { positive: 0, negative: 0, total: 0, recent: [] };
    if (transition.rating === 'positive') m.positive++;
    else m.negative++;
    m.total++;
    m.recent.push({ jobId: transition.jobId, rating: transition.rating, ts: transition.timestamp });
    if (m.recent.length > 100) m.recent.shift();
    this._byMiner.set(transition.minerAddress, m);
  }

  getByJob(jobId) { return this._byJob.get(jobId) || null; }

  getReputation(minerAddr) {
    const m = this._byMiner.get(minerAddr);
    if (!m || !m.total) return { score: null, total: 0 };
    return { score: Math.round((m.positive / m.total) * 100), ...m };
  }
}

export const feedbackStore = new FeedbackStore();
