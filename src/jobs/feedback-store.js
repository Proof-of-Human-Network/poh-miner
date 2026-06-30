export class FeedbackStore {
  constructor() {
    this._byJob   = new Map(); // jobId → transition
    this._byMiner = new Map(); // minerAddress → { positive, negative, total, recent[] }
  }

  apply(transition) {
    if (transition.type !== 'job-feedback') return;
    this._byJob.set(transition.jobId, transition);
    const m = this._byMiner.get(transition.minerAddress)
           || { positive: 0, negative: 0, total: 0, starSum: 0, starCount: 0, recent: [] };
    // 4-5 stars = positive, 1-2 = negative, 3 = neutral (counts toward total/avg only).
    // Legacy 'positive'/'negative' string ratings are still accepted for backward compat.
    if (transition.stars != null) {
      m.starSum   = (m.starSum || 0) + transition.stars;
      m.starCount = (m.starCount || 0) + 1;
      if (transition.stars >= 4) m.positive++;
      else if (transition.stars <= 2) m.negative++;
    } else if (transition.rating === 'positive') {
      m.positive++;
    } else {
      m.negative++;
    }
    m.total++;
    m.recent.push({ jobId: transition.jobId, rating: transition.rating, stars: transition.stars ?? null, ts: transition.timestamp });
    if (m.recent.length > 100) m.recent.shift();
    this._byMiner.set(transition.minerAddress, m);
  }

  getByJob(jobId) { return this._byJob.get(jobId) || null; }

  getReputation(minerAddr) {
    const m = this._byMiner.get(minerAddr);
    if (!m || !m.total) return { score: null, total: 0, avgStars: null };
    const avgStars = m.starCount ? Math.round((m.starSum / m.starCount) * 10) / 10 : null;
    return { score: Math.round((m.positive / m.total) * 100), avgStars, ...m };
  }
}

export const feedbackStore = new FeedbackStore();
