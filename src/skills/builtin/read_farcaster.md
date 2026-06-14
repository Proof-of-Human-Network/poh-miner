---
id: read_farcaster
version: 2.0.0
description: Fetch, analyze and search Farcaster profile, casts, sentiment, topics, channels, and engagement for any wallet address
allowedEndpoints:
  - api.farcaster.xyz
  - api.warpcast.com
  - hub.pinata.cloud
triggers:
  - farcaster
  - warpcast
  - cast
  - casts
  - fid
  - posts
  - social profile
  - social activity
  - what does * post
  - what does * think
  - what is * interested in
  - topic
  - sentiment
  - channels
  - following on farcaster
  - opinions
---

## Context

Fetches and analyzes Farcaster social data for an EVM wallet address. Returns a fully analyzed profile: cast history, sentiment, topics, active channels, engagement metrics, and optionally filtered results for a search query.

**Input:**
```json
{ "address": "0x...", "username": "icetoad", "query": "optional keyword" }
```
Provide `address` (EVM `0x...`) **or** `username` (Farcaster handle or ENS name without `.eth`). The routing layer auto-extracts both from user messages. `query` is optional — when set, only casts containing that keyword are returned.

**Output shape:**
```json
{
  "fid": 12345,
  "username": "vitalik.eth",
  "displayName": "Vitalik Buterin",
  "bio": "...",
  "url": "https://vitalik.ca",
  "followerCount": 123000,
  "followingCount": 450,
  "filteredByQuery": null,
  "casts": [
    { "text": "...", "ts": 1234567890, "isReply": false, "channel": "ethereum", "likes": 52, "recasts": 12, "replies": 8 }
  ],
  "analysis": {
    "topics": [{ "word": "ethereum", "count": 7 }, ...],
    "sentiment": { "score": 0.4, "label": "positive", "positiveSignals": 14, "negativeSignals": 3 },
    "channels": ["ethereum", "base", "crypto"],
    "replyRatio": 0.35,
    "originalPosts": 13,
    "replies": 7,
    "avgLikes": 18.4,
    "avgRecasts": 4.2,
    "totalCastsFetched": 50
  }
}
```
Returns `null` if no Farcaster account is linked to the address.

---

**How to interpret analysis for answering user questions:**

`topics` — the most frequently used meaningful words across all casts. Tells you what this person actually talks about. The top 3-5 words define their main interests.

`sentiment.label` — overall emotional tone derived from positive/negative language and emoji patterns:
- `"positive"`: bullish, optimistic, excited, lots of praise and enthusiasm
- `"negative"`: critical, complaining, fearful, bearish language
- `"neutral"`: informational, technical, or mixed

`sentiment.score` — range -1 (very negative) to +1 (very positive). Values between -0.2 and +0.2 are effectively neutral.

`channels` — Farcaster channels (communities) this person actively posts in. Reveals their actual social graph and interests beyond their bio. Examples: "ethereum", "base", "dao", "nft", "devs", "zk", "books".

`replyRatio` — fraction of casts that are replies to others (0 = only posts original content, 1 = only replies). High ratio (>0.6) means conversational/social; low ratio (<0.2) means mostly broadcasting.

`avgLikes` / `avgRecasts` — engagement per cast. Above 10 avg likes = notable influence; above 50 = high influence.

---

**Human signals (from Farcaster data):**
- Irregular, opinionated cast text with typos, humor, or personal anecdotes
- Bio that matches the topics in casts (consistent identity)
- followerCount > 100 with replyRatio > 0.2 (actually engages with others)
- Low FID (< 50,000) = early Farcaster adopter
- Active in niche channels (dao, devs, books, fitness) not just "crypto"
- avgLikes > 5 with > 20 total casts fetched

**Bot / Sybil signals:**
- Zero casts or only 1-word/link-only casts
- No bio + followerCount < 10
- followingCount = 0 (wallet linked but account never used)
- topics array is empty or contains only generic words
- replyRatio = 0 with very low avgLikes (broadcasting without engagement)
- FID > 900,000 + zero engagement

**Null result** is neutral — most wallets are not on Farcaster.

---

**Answering user questions from this data:**

"What does this person think about X?" → search topics for X, read matching casts, describe their stance using sentiment + cast content.

"What are their interests?" → describe top 5 topics + active channels.

"Are they influential?" → use followerCount + avgLikes + avgRecasts.

"Do they engage with others?" → use replyRatio + replies count.

"What have they posted about X?" → use `query: "X"` in the input to filter casts, then summarize the filtered casts.

"Are they human?" → use human/bot signals above, cross-reference with poh_identity for a formal verdict.

## Code

```js
const FARCASTER_API = 'https://api.farcaster.xyz';
const WARPCAST_API  = 'https://api.warpcast.com/v2';
const HUB_API       = 'https://hub.pinata.cloud/v1';

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'i','you','he','she','it','we','they','me','him','her','us','them',
  'my','your','his','its','our','their','in','on','at','to','for','of',
  'with','by','from','up','and','or','but','not','if','this','that',
  'what','which','who','do','did','does','will','would','could','should',
  'have','has','had','get','got','just','so','as','about','out','can',
  'no','re','ve','ll','all','more','some','any','very','now','then',
  'also','when','where','how','than','much','such','been','into','over',
]);

const POS = ['great','love','amazing','good','happy','excited','awesome','best',
  'bullish','win','cool','yes','wow','congrats','excellent','wonderful','perfect',
  '🚀','❤️','🔥','✨','👍','💯','🎉','🙌','⚡','💪','😍','🤩','🫡'];
const NEG = ['bad','hate','terrible','awful','sad','angry','worst','bearish',
  'down','scam','rug','dump','wrong','fail','broken','disappointed','ugh',
  '💀','😡','🤮','💔','🚫','😤','🫠','💩'];

async function _get(url, params) {
  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const r = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${u.pathname}`);
  return r.json();
}

function _channel(parentUrl) {
  if (!parentUrl) return null;
  const m = String(parentUrl).match(/\/channel\/([^/?#]+)/);
  return m ? m[1] : null;
}

function _analyze(casts) {
  const freq = {};
  let pos = 0, neg = 0, totalW = 0;
  const channels = new Set();

  for (const c of casts) {
    const text = c.text || '';

    // Word frequency
    for (const raw of text.split(/[\s,!?.;:'"()\[\]]+/)) {
      const w = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (w.length < 3 || STOP_WORDS.has(w)) continue;
      freq[w] = (freq[w] || 0) + 1;
      totalW++;
    }

    // Sentiment — words and emoji in original text
    const lower = text.toLowerCase();
    for (const t of POS) { if (lower.includes(t)) pos++; }
    for (const t of NEG) { if (lower.includes(t)) neg++; }

    if (c.channel) channels.add(c.channel);
  }

  const total = pos + neg;
  const score = total > 0 ? Math.round(((pos - neg) / total) * 100) / 100 : 0;

  return {
    topics: Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([word, count]) => ({ word, count })),
    sentiment: {
      score,
      label: score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral',
      positiveSignals: pos,
      negativeSignals: neg,
    },
    channels: [...channels],
  };
}

exports.run = async function(input) {
  const address  = (input.address  || '').toLowerCase().trim();
  const username = (input.username || '').toLowerCase().trim().replace(/\.eth$/, '');
  const query    = (input.query    || '').toLowerCase().trim();

  if (!address && !username) return null;

  // 1. Resolve user — by EVM address first, then by username/ENS
  let user = null;
  if (address && /^0x[0-9a-f]{40}$/.test(address)) {
    try {
      const r = await _get(FARCASTER_API + '/v2/user-by-verification', { address });
      user = r?.result?.user || null;
    } catch {}
  }
  if (!user && username) {
    try {
      const r = await _get(WARPCAST_API + '/user-by-username', { username });
      user = r?.result?.user || null;
    } catch {}
  }
  if (!user?.fid) return null;

  const fid = user.fid;

  // 2. Fetch casts (Warpcast — includes reactions, channel, reply info)
  //    and hub userdata in parallel
  const [warpCastsRes, hubUdRes] = await Promise.allSettled([
    _get(WARPCAST_API + '/casts', { fid, limit: 50 }),
    _get(HUB_API + '/userDataByFid', { fid }),
  ]);

  // Parse hub user metadata (bio, pfp, url, username)
  const ud = {};
  for (const m of (hubUdRes.value?.messages || [])) {
    const b = m.data?.userDataBody;
    if (b?.type) ud[b.type] = b.value;
  }

  // Parse casts from Warpcast response
  const rawWarp = warpCastsRes.value?.result?.casts || [];
  let casts = rawWarp.map(c => ({
    text:     c.text     || '',
    ts:       c.timestamp ? new Date(c.timestamp).getTime() / 1000 : null,
    isReply:  !!c.parentHash,
    channel:  _channel(c.parentUrl || c.rootParentUrl),
    likes:    c.reactions?.likes   || c.reactions?.count || 0,
    recasts:  c.recasts?.count     || 0,
    replies:  c.replies?.count     || 0,
  })).filter(c => c.text.length > 1);

  // Fallback: if Warpcast gave nothing, try Hub
  if (!casts.length) {
    try {
      const hubCasts = await _get(HUB_API + '/castsByFid', { fid, pageSize: 50, reverse: 1 });
      casts = (hubCasts.messages || []).map(c => {
        const body = c.data?.castAddBody || {};
        return {
          text:    body.text || '',
          ts:      c.data?.timestamp || null,
          isReply: !!body.parentCastId,
          channel: _channel(body.parentUrl),
          likes: 0, recasts: 0, replies: 0,
        };
      }).filter(c => c.text.length > 1);
    } catch {}
  }

  const totalFetched = casts.length;

  // Filter by query if provided
  if (query) {
    casts = casts.filter(c => c.text.toLowerCase().includes(query));
  }

  // Analyze full (or filtered) cast set
  const analysis = _analyze(casts);

  // Engagement averages
  const avgLikes   = casts.length ? Math.round((casts.reduce((s, c) => s + c.likes,   0) / casts.length) * 10) / 10 : 0;
  const avgRecasts = casts.length ? Math.round((casts.reduce((s, c) => s + c.recasts, 0) / casts.length) * 10) / 10 : 0;
  const replies    = casts.filter(c => c.isReply).length;
  const originals  = casts.length - replies;

  // Build natural language summary for chat display
  const _name = ud['USER_DATA_TYPE_DISPLAY'] || user.displayName || user.username || username;
  const _follStr = (user.followerCount || 0) > 0 ? ` with ${user.followerCount.toLocaleString()} followers` : '';
  const _topWords = analysis.topics.slice(0, 5).map(t => t.word);
  const _topicStr = _topWords.length ? `Posts about: ${_topWords.join(', ')}.` : '';
  const _sentStr = `Tone is ${analysis.sentiment.label}.`;
  const _chanStr = analysis.channels.length ? `Active in ${analysis.channels.slice(0, 3).join(', ')}.` : '';
  const _engStr = analysis.replyRatio > 0.6 ? 'Highly conversational.' : analysis.replyRatio < 0.2 ? 'Mostly original posts.' : '';
  const _sample = casts[0]?.text?.trim();
  const _castStr = _sample ? `Recent: "${_sample.slice(0, 100)}${_sample.length > 100 ? '…' : ''}"` : '';
  const summary = [
    `${_name}${_follStr}.`, _topicStr, _sentStr, _chanStr, _engStr, _castStr,
  ].filter(Boolean).join(' ');

  return {
    fid,
    username:      ud['USER_DATA_TYPE_USERNAME'] || user.username    || '',
    displayName:   ud['USER_DATA_TYPE_DISPLAY']  || user.displayName || user.username || '',
    bio:           ud['USER_DATA_TYPE_BIO']       || user.profile?.bio?.text || '',
    pfp:           ud['USER_DATA_TYPE_PFP']       || null,
    url:           ud['USER_DATA_TYPE_URL']        || null,
    followerCount:  user.followerCount  || 0,
    followingCount: user.followingCount || 0,
    filteredByQuery: query || null,
    casts: casts.slice(0, 25),
    analysis: {
      topics:          analysis.topics,
      sentiment:       analysis.sentiment,
      channels:        analysis.channels,
      replyRatio:      casts.length ? Math.round((replies / casts.length) * 100) / 100 : 0,
      originalPosts:   originals,
      replies,
      avgLikes,
      avgRecasts,
      totalCastsFetched: totalFetched,
      keyTopics: _topWords,
      summary,
    },
  };
};
```
