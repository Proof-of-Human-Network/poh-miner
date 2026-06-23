---
id: web_search
version: 1.1.0
description: Search the web for any topic and return real results using DuckDuckGo
allowedEndpoints:
  - html.duckduckgo.com
  - api.duckduckgo.com
triggers:
  - search
  - search for
  - look up
  - look up
  - google
  - web search
  - find out
  - find information
  - news about
  - latest on
  - information about
  - research
  - look into
  - what happened
  - current events
  - recent news
---

## Context

Searches the web for any topic using DuckDuckGo and returns real search results with titles and snippets. Use this for current events, sports results, news, facts, or anything that needs up-to-date web data.

**Input:**
```json
{ "query": "specific search query", "message": "fallback: original user message" }
```

**Output shape:**
```json
{
  "query": "search term used",
  "summary": "best snippet or abstract found",
  "results": [
    { "title": "Result title", "snippet": "Brief description", "url": "https://..." }
  ],
  "source": "DuckDuckGo"
}
```

**How to use this data:**
- `results[0..3]` — the most relevant web hits; summarize them to answer the user
- `summary` — quick lead answer; use it as the first sentence of your response
- If `results` is empty: the search returned nothing — say so and suggest rephrasing
- Always mention 2-3 specific results by title/source when answering; don't be vague
- For sports scores: look for the score in the snippet text and state it clearly
- For news: name the source (BBC, ESPN, etc.) when summarizing

## Code

```js
exports.run = async function(input) {
  const query = (input.query || input.message || '').trim();
  if (!query) return { error: 'No search query provided' };

  const results = [];
  let summary = null;

  // ── Real web search via DDG HTML endpoint ─────────────────────────────────
  try {
    const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const htmlRes = await fetch(htmlUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (htmlRes.ok) {
      const html = await htmlRes.text();

      // Extract title+URL pairs
      const titleRe = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      // Extract snippets
      const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      const titles = [...html.matchAll(titleRe)];
      const snippets = [...html.matchAll(snippetRe)];

      for (let i = 0; i < Math.min(titles.length, 8); i++) {
        let url = titles[i][1] || '';
        // Decode redirect URL (//duckduckgo.com/l/?uddg=ENCODED)
        const uddg = url.match(/[?&]uddg=([^&]+)/);
        if (uddg) url = decodeURIComponent(uddg[1]);
        else if (url.startsWith('//')) url = 'https:' + url;

        const title = (titles[i][2] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const snippet = snippets[i]
          ? snippets[i][1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
          : '';

        if (title && (snippet || url)) {
          results.push({ title, snippet, url });
        }
      }

      if (results.length > 0) {
        summary = results[0].snippet || results[0].title;
      }
    }
  } catch (_) {}

  // ── Fallback: DDG Instant Answer API (great for facts, definitions, conversions) ─
  if (!summary) {
    try {
      const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=poh-miner`;
      const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
      if (apiRes.ok) {
        const data = await apiRes.json();
        if (data.AbstractText) {
          summary = data.AbstractText;
          results.unshift({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL || null });
        }
        for (const t of (data.RelatedTopics || []).slice(0, 5)) {
          if (t.Text && t.FirstURL) {
            results.push({ title: t.Text.split(' - ')[0].trim(), snippet: t.Text, url: t.FirstURL });
          }
        }
        if (results.length > 0 && !summary) summary = results[0].snippet;
      }
    } catch (_) {}
  }

  return {
    query,
    summary: summary || null,
    results: results.slice(0, 8),
    source: 'DuckDuckGo',
  };
};
```
