---
id: web_search
version: 1.0.0
description: Search the web for any topic and return a summary of results using DuckDuckGo
allowedEndpoints:
  - api.duckduckgo.com
triggers:
  - search
  - search for
  - look up
  - google
  - web search
  - find out
  - find information
  - what is
  - who is
  - where is
  - how does
  - when did
  - tell me about
  - news about
  - latest on
  - information about
  - research
  - look into
  - explain
  - define
  - definition of
---

## Context

Searches the web for any topic or question using the DuckDuckGo Instant Answer API. Returns a structured summary including a direct answer (when available), an abstract, and related results.

**Input:**
```json
{ "query": "topic or question to search for", "message": "original user message (fallback)" }
```

**Output shape:**
```json
{
  "query": "search term",
  "answer": "quick direct answer if available, else null",
  "summary": "abstract or best snippet found",
  "heading": "topic heading from DDG, or null",
  "results": [
    { "title": "result title", "snippet": "brief description", "url": "link or null" }
  ],
  "source": "DuckDuckGo"
}
```

Returns `{ error: "..." }` if the query is empty or the request fails.

---

**How to use this data when answering:**

- `answer` — if set, use it as a direct factual reply (e.g. unit conversions, calculations, simple facts)
- `summary` — the main abstract; good for "what is X" or "tell me about X" questions
- `heading` — the canonical topic name as DDG identifies it
- `results` — up to 8 related subtopics or links; useful when the answer is multi-faceted
- If all fields are null/empty: the query is too obscure or too recent for DDG's index. Say so and suggest the user tries a different phrasing.

## Code

```js
exports.run = async function(input) {
  const query = (input.query || input.message || '').trim();
  if (!query) return { error: 'No search query provided' };

  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=poh-miner`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return { error: `DuckDuckGo returned HTTP ${res.status}` };
  const data = await res.json();

  const results = [];

  if (data.Answer) {
    results.push({ title: 'Answer', snippet: data.Answer, url: data.AnswerURL || null });
  }

  const summary = data.AbstractText || data.Abstract || '';
  const abstractUrl = data.AbstractURL || null;
  if (summary) {
    results.push({ title: data.Heading || query, snippet: summary, url: abstractUrl });
  }

  const addTopic = t => {
    if (t.Text && t.FirstURL) {
      const parts = t.Text.split(' - ');
      results.push({ title: parts.length > 1 ? parts[0].trim() : t.Text.slice(0, 60), snippet: t.Text, url: t.FirstURL });
    }
  };

  for (const t of (data.RelatedTopics || []).slice(0, 8)) {
    if (t.Topics) {
      for (const sub of (t.Topics || []).slice(0, 3)) addTopic(sub);
    } else {
      addTopic(t);
    }
  }

  return {
    query,
    answer: data.Answer || null,
    summary: summary || (results[0]?.snippet || null),
    heading: data.Heading || null,
    results: results.slice(0, 8),
    source: 'DuckDuckGo',
  };
};
```
