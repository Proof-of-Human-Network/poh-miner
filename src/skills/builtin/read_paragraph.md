---
id: read_paragraph
version: 1.0.0
description: Fetch and analyze Paragraph blog posts, writing topics, sentiment, interests, and publication activity for any author handle or search query
allowedEndpoints:
  - api.paragraph.com
  - paragraph.com
triggers:
  - paragraph
  - paragraph blog
  - paragraph post
  - paragraph article
  - blog post
  - blog posts
  - newsletter
  - article
  - articles
  - writes about
  - what does * write
  - what does * blog
  - what does * publish
  - writing topics
  - author
  - publication
---

## Context

**When to run:** User asks about someone's Paragraph blog, articles, or writing. Keywords: "paragraph", "blog", "articles", "blog posts", "writings". Must have a specific author handle or username.

Fetches and analyzes Paragraph blog posts for an author handle. Returns full post content, writing topics, publication frequency, sentiment, and inferred interests. Uses the author's RSS feed (which often includes full article HTML) and falls back to fetching post pages directly for any posts where the RSS excerpt is too short.

**Input:**
```json
{ "username": "authorhandle", "query": "optional keyword to filter posts" }
```
Provide `username` (Paragraph handle, e.g. `vitalik` or `bankless`). Address is ignored — Paragraph uses handles only. ENS `.eth` suffix is stripped automatically.

**Output shape:**
```json
{
  "author": {
    "handle": "bankless",
    "displayName": "Bankless",
    "bio": "...",
    "avatar": "https://...",
    "followerCount": 85000
  },
  "posts": [
    {
      "title": "The Future of DeFi",
      "excerpt": "Why this cycle is different...",
      "content": "Full article text up to 12000 chars...",
      "publishedAt": 1234567890,
      "url": "https://paragraph.com/@bankless/future-of-defi"
    }
  ],
  "analysis": {
    "topics": [{ "word": "ethereum", "count": 34 }],
    "sentiment": { "score": 0.5, "label": "positive", "positiveSignals": 18, "negativeSignals": 4 },
    "avgContentLength": 3200,
    "publishFrequencyPerMonth": 4.2,
    "totalPosts": 12
  },
  "filteredByQuery": null
}
```
Returns `null` if author not found or has no posts.

---

**How to interpret for answering user questions:**

`posts` — actual blog posts. Each has `title`, `excerpt` (first ~400 chars), `content` (full text up to 12 000 chars), `publishedAt`, and `url`.

`analysis.topics` — most frequent meaningful words across all post titles and excerpts. Top 5 words define what this author writes about.

`analysis.sentiment.label` — tone of the writing:
- `"positive"`: optimistic, bullish, excited, constructive content
- `"negative"`: critical, bearish, warning-heavy, pessimistic
- `"neutral"`: analytical, educational, neutral reporting

`analysis.publishFrequencyPerMonth` — how prolific they are. >8/month = very active; <1/month = occasional.

---

**Answering user questions:**

"What does X write about?" → describe topics + recent post titles.

"What's their writing style?" → publishFrequency, sentiment, excerpt tone.

"What are their latest posts?" → list recent posts with title, date.

"Search for posts about X" → filteredByQuery shows which posts matched.

"Are they bullish/bearish on crypto?" → sentiment + check if topics include bearish keywords.

## Code

```js
const PARA_API = 'https://api.paragraph.com';
const PARA_WEB = 'https://paragraph.com';
// Fetch at most this many post pages to stay within the 15s worker timeout
const MAX_FULL_FETCH = 5;

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'i','you','he','she','it','we','they','me','him','her','us','them',
  'my','your','his','its','our','their','in','on','at','to','for','of',
  'with','by','from','up','and','or','but','not','if','this','that',
  'what','which','who','do','did','does','will','would','could','should',
  'have','has','had','get','got','just','so','as','about','out','can',
  'no','re','ve','ll','all','more','some','any','very','now','then',
  'also','when','where','how','than','much','such','been','into','over',
  'part','post','blog','new','one','two','why','how','its','are',
]);

const POS = ['love','great','amazing','good','bullish','win','best','exciting',
  'optimistic','opportunity','growth','future','innovate','build','launch',
  '🚀','❤️','🔥','✨','👍','💯','🎉','🙌','⚡','💪','🌟','✅'];
const NEG = ['bad','hate','terrible','bearish','crash','fail','broken','warning',
  'risk','danger','scam','collapse','wrong','problem','issue','concern',
  '💀','😡','⚠️','💔','🚫','📉','❌'];

function _stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function _parseRss(xml) {
  const items = [];
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  for (const block of itemBlocks) {
    const raw = block[1];
    const title   = raw.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]
                 || raw.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
    const descRaw = raw.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/s)?.[1]
                 || raw.match(/<description>([\s\S]*?)<\/description>/s)?.[1] || '';
    const pubDate = raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || null;
    const link    = raw.match(/<link>(https?:\/\/[^\s<]+)<\/link>/)?.[1]
                 || raw.match(/<link>([\s\S]*?)<\/link>/)?.[1] || null;
    // RSS description may be a short excerpt OR the full article HTML — keep all of it
    const content = _stripHtml(descRaw).slice(0, 12000);
    const excerpt = content.slice(0, 400);
    const publishedAt = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : null;
    items.push({ title: title.trim(), excerpt, content, publishedAt, url: link });
  }
  return items;
}

// Fetch a post page and extract the body text.
// Tries __NEXT_DATA__ JSON first (Paragraph is Next.js), then falls back to <article> HTML.
async function _fetchPostContent(url) {
  try {
    const r = await fetch(url, {
      headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    // Path 1: __NEXT_DATA__ (structured, most reliable)
    const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (ndMatch) {
      try {
        const nd = JSON.parse(ndMatch[1]);
        const pp = nd?.props?.pageProps;
        if (pp) {
          // Paragraph may store body in different shapes depending on version
          const body = pp.post?.body ?? pp.post?.content ?? pp.article?.body
                    ?? pp.initialPost?.body ?? pp.data?.post?.body ?? null;
          if (typeof body === 'string' && body.length > 50) {
            return _stripHtml(body).slice(0, 12000);
          }
          // Sometimes body is stored as Tiptap JSON — convert to plain text
          const bodyJson = pp.post?.bodyJson ?? pp.post?.content_json ?? null;
          if (bodyJson) {
            const raw = typeof bodyJson === 'string' ? bodyJson : JSON.stringify(bodyJson);
            // Extract all "text" leaf values from the Tiptap node tree
            const texts = [...raw.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map(m =>
              m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
            );
            if (texts.length) return texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
          }
        }
      } catch {}
    }

    // Path 2: parse HTML — strip boilerplate, keep <article> or <main>
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '');

    const articleMatch = stripped.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) return _stripHtml(articleMatch[1]).slice(0, 12000);

    const mainMatch = stripped.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) return _stripHtml(mainMatch[1]).slice(0, 12000);

    return null;
  } catch {
    return null;
  }
}

function _analyze(posts) {
  const freq = {};
  let pos = 0, neg = 0;
  for (const p of posts) {
    // Use full content for analysis when available
    const text = `${p.title} ${p.content || p.excerpt}`;
    for (const raw of text.split(/[\s,!?.;:'"()\[\]\-]+/)) {
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
  const username = (input.username || '').trim().replace(/^@/, '').replace(/\.eth$/, '');
  const query    = (input.query    || '').toLowerCase().trim();

  if (!username) return null;

  let author = null;
  let posts  = [];

  // 1. Fetch author profile
  try {
    const r = await fetch(`${PARA_API}/blogs/@${username}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      if (data && !data.success === false) author = data;
    }
  } catch {}

  // 2. Fetch posts via RSS (description may already contain full article HTML)
  try {
    const r = await fetch(`${PARA_API}/blogs/rss/@${username}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const xml = await r.text();
      posts = _parseRss(xml);
    }
  } catch {}

  if (!posts.length && !author) return null;

  // 3. Filter by query
  const filtered = query
    ? posts.filter(p => `${p.title} ${p.content}`.toLowerCase().includes(query))
    : posts;

  const displayPosts = (filtered.length ? filtered : posts).slice(0, 20);

  // 4. For posts where RSS only gave a short excerpt, fetch the full page in parallel
  const needsFetch = displayPosts
    .slice(0, MAX_FULL_FETCH)
    .filter(p => p.url && p.content.length < 800);

  if (needsFetch.length) {
    const results = await Promise.allSettled(
      needsFetch.map(p => _fetchPostContent(p.url))
    );
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value && r.value.length > needsFetch[i].content.length) {
        needsFetch[i].content = r.value;
        needsFetch[i].excerpt = r.value.slice(0, 400);
      }
    });
  }

  const analysis = _analyze(displayPosts);

  // Publish frequency from timestamps
  let publishFrequencyPerMonth = null;
  const timestamps = posts.map(p => p.publishedAt).filter(Boolean).sort();
  if (timestamps.length >= 2) {
    const spanMs = (timestamps[timestamps.length - 1] - timestamps[0]) * 1000;
    const spanMo = spanMs / (1000 * 60 * 60 * 24 * 30);
    publishFrequencyPerMonth = spanMo > 0 ? Math.round((timestamps.length / spanMo) * 10) / 10 : null;
  }

  const avgContentLength = displayPosts.length
    ? Math.round(displayPosts.reduce((s, p) => s + (p.content || p.excerpt || '').length, 0) / displayPosts.length)
    : null;

  // Build natural language summary for chat display
  const _authorName = author?.name || author?.url?.replace(/^@/, '') || username;
  const _topWords = analysis.topics.slice(0, 5).map(t => t.word);
  const _topicStr = _topWords.length ? _topWords.join(', ') : 'various topics';
  const _freqStr = publishFrequencyPerMonth ? `, publishing ~${publishFrequencyPerMonth}x/month` : '';
  const _recentTitles = displayPosts.slice(0, 2).map(p => `"${p.title}"`).filter(Boolean).join(', ');
  const summary = [
    `${_authorName} writes about ${_topicStr}${_freqStr}.`,
    `Tone is ${analysis.sentiment.label}.`,
    _recentTitles ? `Recent posts: ${_recentTitles}.` : '',
  ].filter(Boolean).join(' ');

  return {
    author: author ? {
      handle:        author.url?.replace(/^@/, '')  || username,
      displayName:   author.name                    || null,
      bio:           author.summary                 || null,
      avatar:        author.logo_url                || null,
      followerCount: author.user?.followerCount     || null,
    } : { handle: username },
    posts: displayPosts,
    analysis: {
      ...analysis,
      totalPosts: posts.length,
      avgContentLength,
      publishFrequencyPerMonth,
      keyTopics: _topWords,
      summary,
    },
    filteredByQuery: query || null,
  };
};
```
