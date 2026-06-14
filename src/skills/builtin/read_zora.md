---
id: read_zora
version: 1.0.0
description: Fetch and analyze Zora creator profile, coins created, coins collected, trading activity, sentiment, and interests for any wallet address or username
allowedEndpoints:
  - api-sdk.zora.engineering
triggers:
  - zora
  - zora coin
  - zora coins
  - zora creator
  - zora activity
  - zora profile
  - created on zora
  - minted on zora
  - what does * create
  - what does * mint
  - creator coins
  - onchain creator
  - nft creator
  - coin creator
---

## Context

Fetches and analyzes Zora creator data for a wallet address or username. Returns profile info, coins they've created, coins they've collected, trading activity, sentiment, and inferred interests/topics.

**Input:**
```json
{ "address": "0x...", "username": "handle", "query": "optional keyword" }
```
Provide `address` (EVM `0x...`) **or** `username` (Zora handle). `query` is optional — filters coins/activity by keyword.

**Output shape:**
```json
{
  "address": "0x...",
  "profile": {
    "handle": "artist",
    "displayName": "Artist Name",
    "bio": "...",
    "avatar": "https://...",
    "twitterFollowers": 1200,
    "farcasterFollowers": 340
  },
  "createdCoins": [
    { "name": "My Coin", "symbol": "MC", "description": "...", "coinType": "CONTENT", "marketCap": "12500", "volume24h": "800", "uniqueHolders": 45, "createdAt": "2024-01-01T..." }
  ],
  "collectedCoins": [
    { "name": "Other Coin", "symbol": "OC", "coinType": "CREATOR", "creatorAddress": "0x...", "balance": "5000" }
  ],
  "analysis": {
    "topics": [{ "word": "art", "count": 8 }],
    "sentiment": { "score": 0.6, "label": "positive", "positiveSignals": 12, "negativeSignals": 2 },
    "totalCoinsCreated": 7,
    "totalCoinsCollected": 23,
    "totalMarketCap": 85000,
    "avgHoldersPerCoin": 38,
    "creatorScore": 72
  },
  "filteredByQuery": null
}
```
Returns `null` if the address has no Zora activity.

---

**How to interpret for answering user questions:**

`createdCoins` — coins this person launched. Each coin's name, description, market cap, and holders tells you what they create and how popular it is.

`collectedCoins` — coins they've bought/collected from others. Reveals their taste and what they value in the ecosystem.

`analysis.topics` — most frequent meaningful words across coin names and descriptions. Top 3–5 words define their creative focus (art, music, meme, defi, etc.).

`analysis.sentiment.label` — overall vibe of their coin descriptions:
- `"positive"`: enthusiastic, optimistic, hype-driven language
- `"negative"`: critical, dark, ironic, bearish tone
- `"neutral"`: informational, straightforward

`analysis.totalMarketCap` — rough measure of their influence as a creator.

`analysis.avgHoldersPerCoin` — how many unique wallets hold each coin on average. Higher = more community reach.

`analysis.creatorScore` — composite 0–100 score: combines coins created × holders × market cap.

---

**Answering user questions:**

"What does this person create?" → describe top coins, themes from topics, creative style from descriptions.

"Are they influential?" → use totalMarketCap, avgHoldersPerCoin, twitterFollowers/farcasterFollowers.

"What are their interests?" → describe topics + collectedCoins (what they buy reveals taste).

"What's their vibe?" → sentiment + coin names + bio.

"Do they trade a lot?" → compare createdCoins vs collectedCoins count, check volume24h.

## Code

```js
const ZORA_API = 'https://api-sdk.zora.engineering';
const ZORA_KEY = 'zora_api_6770e5a970bb4febd95deee8cda143e469a25f4b35d61cb0355646e9af83d3c1';

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'i','you','he','she','it','we','they','me','him','her','us','them',
  'my','your','his','its','our','their','in','on','at','to','for','of',
  'with','by','from','up','and','or','but','not','if','this','that',
  'what','which','who','do','did','does','will','would','could','should',
  'have','has','had','get','got','just','so','as','about','out','can',
  'no','re','ve','ll','all','more','some','any','very','now','then',
  'also','when','where','how','than','much','such','been','into','over',
  'coin','token','nft','zora','create','mint','new','buy','sell',
]);

const POS = ['love','amazing','good','happy','excited','awesome','best','bullish',
  'win','cool','wow','congrats','excellent','wonderful','perfect','incredible',
  '🚀','❤️','🔥','✨','👍','💯','🎉','🙌','⚡','💪','😍','🤩','🫡','🌟'];
const NEG = ['bad','hate','terrible','awful','sad','angry','worst','bearish',
  'down','scam','rug','dump','wrong','fail','broken','disappointed',
  '💀','😡','🤮','💔','🚫','😤','🫠','💩'];

function hdrs() {
  return { 'X-API-Key': ZORA_KEY, 'Accept': 'application/json' };
}

async function _get(path, params) {
  const u = new URL(ZORA_API + path);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const r = await fetch(u.toString(), { headers: hdrs(), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.json();
}

function _analyze(texts) {
  const freq = {};
  let pos = 0, neg = 0;
  for (const text of texts) {
    if (!text) continue;
    for (const raw of text.split(/[\s,!?.;:'"()\[\]]+/)) {
      const w = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (w.length < 3 || STOP_WORDS.has(w)) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
    const lower = text.toLowerCase();
    for (const t of POS) { if (lower.includes(t)) pos++; }
    for (const t of NEG) { if (lower.includes(t)) neg++; }
  }
  const total = pos + neg;
  const score = total > 0 ? Math.round(((pos - neg) / total) * 100) / 100 : 0;
  return {
    topics: Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([word, count]) => ({ word, count })),
    sentiment: { score, label: score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral', positiveSignals: pos, negativeSignals: neg },
  };
}

exports.run = async function(input) {
  const address  = (input.address  || '').toLowerCase().trim();
  const username = (input.username || '').toLowerCase().trim().replace(/\.eth$/, '');
  const query    = (input.query    || '').toLowerCase().trim();

  if (!address && !username) return null;

  const identifier = address || username;

  // 1. Resolve profile
  let profile = null;
  try {
    const r = await _get('/profile', { identifier });
    profile = r?.profile || null;
  } catch {}

  // 2. Fetch coins created
  let createdCoins = [];
  try {
    const r = await _get('/profileCoins', { identifier, count: 50 });
    const edges = r?.profile?.createdCoins?.edges || [];
    createdCoins = edges.map(e => e.node).filter(Boolean);
  } catch {}

  // 3. Fetch coins collected/held
  let collectedCoins = [];
  try {
    const r = await _get('/profileBalances', { identifier, count: 30 });
    const edges = r?.profile?.coinBalances?.edges || [];
    collectedCoins = edges.map(e => e?.node?.coin).filter(Boolean);
  } catch {}

  if (!profile && !createdCoins.length && !collectedCoins.length) return null;

  // 4. Filter by query
  const filteredCreated = query
    ? createdCoins.filter(c => (c.name || '').toLowerCase().includes(query) || (c.description || '').toLowerCase().includes(query))
    : createdCoins;

  // 5. Analyze texts from coin names + descriptions + bio
  const texts = [
    ...(filteredCreated.length ? filteredCreated : createdCoins).map(c => `${c.name || ''} ${c.description || ''}`),
    profile?.bio || '',
  ];
  const analysis = _analyze(texts);

  // 6. Aggregate metrics
  const totalMarketCap = createdCoins.reduce((s, c) => s + parseFloat(c.marketCap || 0), 0);
  const totalHolders   = createdCoins.reduce((s, c) => s + (c.uniqueHolders || 0), 0);
  const avgHolders     = createdCoins.length ? Math.round(totalHolders / createdCoins.length) : 0;
  const creatorScore   = Math.min(100, Math.round(
    (createdCoins.length * 5) + (avgHolders * 0.5) + (Math.log10(totalMarketCap + 1) * 5)
  ));

  const mapCoin = c => ({
    name:          c.name        || '',
    symbol:        c.symbol      || '',
    description:   c.description || null,
    coinType:      c.coinType    || null,
    marketCap:     c.marketCap   || '0',
    volume24h:     c.volume24h   || '0',
    uniqueHolders: c.uniqueHolders || 0,
    createdAt:     c.createdAt   || null,
  });

  const mapCollected = c => ({
    name:           c.name          || '',
    symbol:         c.symbol        || '',
    coinType:       c.coinType      || null,
    creatorAddress: c.creatorAddress || null,
    balance:        c.balance        || null,
  });

  // Social follower counts from profile
  const social = profile?.socialAccounts || {};
  const twitterFollowers  = social?.twitter?.followerCount  || null;
  const farcasterFollowers = social?.farcaster?.followerCount || null;

  // Build natural language summary for chat display
  const _authorName = profile?.displayName || profile?.handle || address || username;
  const _topWords = analysis.topics.slice(0, 5).map(t => t.word);
  const _topicStr = _topWords.length ? _topWords.join(', ') : 'various topics';
  const _displayCoins = (filteredCreated.length ? filteredCreated : createdCoins).slice(0, 20);
  const _createdStr = createdCoins.length ? `Created ${createdCoins.length} coin${createdCoins.length !== 1 ? 's' : ''} on Zora.` : '';
  const _topCoin = _displayCoins[0];
  const _topCoinStr = _topCoin ? `Top coin: "${_topCoin.name}" with ${_topCoin.uniqueHolders || 0} holders.` : '';
  const _scoreStr = creatorScore > 0 ? `Creator score: ${creatorScore}/100.` : '';
  const summary = [
    `${_authorName} creates ${_topicStr}.`,
    `Tone is ${analysis.sentiment.label}.`,
    _createdStr,
    _topCoinStr,
    _scoreStr,
  ].filter(Boolean).join(' ');

  return {
    address: address || profile?.publicWallet?.walletAddress || null,
    profile: profile ? {
      handle:            profile.handle      || username || null,
      displayName:       profile.displayName || null,
      bio:               profile.bio         || null,
      avatar:            profile.avatar?.previewImage?.medium || profile.avatar?.small || null,
      twitterFollowers,
      farcasterFollowers,
      creatorCoinMarketCap: profile.creatorCoin?.marketCap || null,
    } : null,
    createdCoins:   _displayCoins.map(mapCoin),
    collectedCoins: collectedCoins.slice(0, 15).map(mapCollected),
    analysis: {
      ...analysis,
      totalCoinsCreated:   createdCoins.length,
      totalCoinsCollected: collectedCoins.length,
      totalMarketCap:      Math.round(totalMarketCap),
      avgHoldersPerCoin:   avgHolders,
      creatorScore,
      keyTopics: _topWords,
      summary,
    },
    filteredByQuery: query || null,
  };
};
```
