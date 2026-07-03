/**
 * HfModelSearch — search Hugging Face's model catalog for generation tasks
 * (text-to-video, text-to-image, text-to-audio, etc.) and suggest matches.
 */

const HF_MODELS_API = 'https://huggingface.co/api/models';

// Code-generation requests should stay on the normal LLM path.
const CODE_CREATION_RE = /\b(?:generate|create|write|build|implement|draft|code)\b.{0,40}\b(?:contract|token|solidity|rust|python|javascript|typescript|function|class|api|erc\d+|smart[\s-]?contract|program|script|dapp|component|module)\b/i;

const MEDIA_GENERATION_PATTERNS = [
  /\b(?:generate|create|make|produce|render|draw|animate|synthesize)\b.{0,50}\b(?:video|image|picture|photo|audio|music|sound|animation|gif|clip|movie|voice|speech|song)\b/i,
  /\b(?:text-to-video|text-to-image|text-to-speech|text-to-audio|image-to-video|img2vid|txt2img|txt2vid|stable[\s-]?diffusion)\b/i,
  /\b(?:video|image|picture|photo|audio|music|animation|clip|movie)\b.{0,50}\b(?:of|with|showing|featuring|about)\b/i,
];

export function needsHfModelLookup(message) {
  const m = message || '';
  if (CODE_CREATION_RE.test(m)) return false;
  return MEDIA_GENERATION_PATTERNS.some(re => re.test(m));
}

/** Build a focused HF search query from a free-text generation request. */
export function buildModelSearchQuery(message) {
  const lower = (message || '').toLowerCase();
  let task = '';
  if (/\b(?:video|clip|movie|animation|animate)\b/.test(lower)) task = 'text-to-video';
  else if (/\b(?:image|picture|photo|draw|illustration)\b/.test(lower)) task = 'text-to-image';
  else if (/\b(?:audio|music|sound|speech|voice|song)\b/.test(lower)) task = 'text-to-audio';

  const subject = (message || '')
    .replace(/\b(?:generate|create|make|produce|render|draw|animate|synthesize|please|can you|could you|a|an|the)\b/gi, ' ')
    .replace(/\b(?:video|image|picture|photo|audio|music|clip|movie|animation|of|with|showing|featuring|about)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return [task, subject].filter(Boolean).join(' ').trim() || message;
}

/**
 * Search the HF model catalog. Returns [] on network/parse failure.
 */
export async function searchModels(query, limit = 12) {
  const q = (query || '').trim();
  if (!q) return [];

  try {
    const url = `${HF_MODELS_API}?search=${encodeURIComponent(q)}&limit=${limit}&full=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map(m => ({
      id: m.id || m.modelId,
      description: (m.cardData?.summary || m.description || '').slice(0, 400),
      tags: Array.isArray(m.tags) ? m.tags.slice(0, 10) : [],
      pipelineTag: m.pipeline_tag || null,
      downloads: m.downloads || 0,
      likes: m.likes || 0,
    })).filter(m => m.id);
  } catch {
    return [];
  }
}

/** Search with progressively broader queries so niche subjects still return useful models. */
export async function searchModelsWithFallback(message, limit = 12) {
  const full = buildModelSearchQuery(message);
  let results = await searchModels(full, limit);
  if (results.length) return results;

  const lower = (message || '').toLowerCase();
  let task = '';
  if (/\b(?:video|clip|movie|animation|animate)\b/.test(lower)) task = 'text-to-video';
  else if (/\b(?:image|picture|photo|draw|illustration)\b/.test(lower)) task = 'text-to-image';
  else if (/\b(?:audio|music|sound|speech|voice|song)\b/.test(lower)) task = 'text-to-audio';

  if (task) {
    results = await searchModels(task, limit);
    if (results.length) return results;
  }

  return searchModels((message || '').slice(0, 80), limit);
}

/**
 * Ask the local LLM to pick up to `max` relevant models from candidates.
 * Falls back to top models by downloads when the LLM call fails.
 */
export async function pickRelevantModels(question, candidates, { ollamaUrl, model }, max = 3) {
  if (!candidates?.length) return [];

  const sorted = [...candidates].sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  const pool = sorted.slice(0, 10);

  const list = pool.map((c, i) =>
    `${i + 1}. ${c.id} — ${c.description || 'no description'} (pipeline: ${c.pipelineTag || 'unknown'}, tags: ${c.tags.slice(0, 5).join(', ') || 'none'}, downloads: ${c.downloads})`
  ).join('\n');

  const prompt = [
    'A user wants to generate media (video, image, or audio) using a Hugging Face model.',
    `Request: "${question}"`,
    '',
    'Candidate models found on Hugging Face:',
    list,
    '',
    `Reply with up to ${max} exact model ids (one per line) that best match the request.`,
    'Prefer models whose pipeline tag matches the task (e.g. text-to-video for video requests).',
    'If none are relevant, reply with exactly "none". No explanation.',
  ].join('\n');

  try {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return pool.slice(0, max);
    const data = await res.json();
    const lines = (data.message?.content || '').trim().split('\n').map(l => l.replace(/^[\d.\s-]+/, '').trim().replace(/["'.]/g, ''));
    const picked = [];
    for (const line of lines) {
      if (!line || line.toLowerCase() === 'none') continue;
      const match = pool.find(c => c.id.toLowerCase() === line.toLowerCase() || c.id.toLowerCase().endsWith(`/${line}`));
      if (match && !picked.some(p => p.id === match.id)) picked.push(match);
      if (picked.length >= max) break;
    }
    return picked.length ? picked : pool.slice(0, max);
  } catch {
    return pool.slice(0, max);
  }
}

/** Format model suggestions as a Markdown reply for chat. */
export function formatModelSuggestions(question, models) {
  if (!models?.length) {
    return `I couldn't find Hugging Face models for "${question}". Try browsing [huggingface.co/models](https://huggingface.co/models) and search for text-to-video, text-to-image, or text-to-audio.`;
  }

  const lines = models.map(m => {
    const tags = m.tags?.slice(0, 4).join(', ') || 'none';
    const pipe = m.pipelineTag ? ` · ${m.pipelineTag}` : '';
    const desc = m.description ? ` — ${m.description.slice(0, 120)}` : '';
    return `- **[${m.id}](https://huggingface.co/${m.id})**${pipe}${desc}\n  Tags: ${tags}`;
  });

  return [
    "I can't generate media directly in chat, but these Hugging Face models look like a good fit:",
    '',
    ...lines,
    '',
    'Pick a model, install its dependencies (often `diffusers` / `transformers`), and run inference locally or via a Hugging Face Space.',
    'In **Public mode** you can also submit a paid compute job once a miner has the model available.',
  ].join('\n');
}