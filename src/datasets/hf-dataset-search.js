/**
 * HfDatasetSearch — search Hugging Face's dataset catalog and let the local
 * LLM pick the best match (or none) for a user's question.
 *
 * Pure lookup: nothing is downloaded or stored here. See hf-dataset-manager.js
 * for install/local-storage and hf-dataset-peer-serve.js for P2P distribution.
 */

const HF_API_BASE = 'https://huggingface.co/api/datasets';

// Conservative trigger: only escalate to a dataset search when the message
// explicitly references a dataset, rather than trying to classify every
// message (which would require an extra LLM call per message).
const DATASET_MENTION_RE = /\b(?:dataset|datasets|huggingface|hugging face)\b/i;

export function needsDatasetLookup(message) {
  return DATASET_MENTION_RE.test(message || '');
}

/**
 * Search the HF dataset catalog for candidates matching a free-text query.
 * Returns [] on any network/parse failure — callers should fall through to
 * plain chat rather than fail the whole request.
 */
export async function searchDatasets(query, limit = 10) {
  const q = (query || '').trim();
  if (!q) return [];

  try {
    const url = `${HF_API_BASE}?search=${encodeURIComponent(q)}&limit=${limit}&full=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map(d => ({
      id: d.id,
      description: (d.cardData?.summary || d.description || '').slice(0, 500),
      tags: Array.isArray(d.tags) ? d.tags.slice(0, 8) : [],
      downloads: d.downloads || 0,
      sizeBytes: Array.isArray(d.siblings)
        ? d.siblings.reduce((sum, s) => sum + (s.size || 0), 0) || null
        : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Ask the local LLM which (if any) of the candidate datasets helps answer
 * the question. Returns a dataset id string, or null if none apply.
 */
export async function disambiguateDataset(question, candidates, { model } = {}) {
  if (!candidates?.length) return null;

  const list = candidates.map((c, i) =>
    `${i + 1}. ${c.id} — ${c.description || 'no description'} (tags: ${c.tags.join(', ') || 'none'})`
  ).join('\n');

  const prompt = [
    'A user asked a question that might be answerable using a public dataset.',
    `Question: "${question}"`,
    '',
    'Candidate datasets found on Hugging Face:',
    list,
    '',
    'Reply with ONLY the exact dataset id of the single best match (e.g. "squad"),',
    'or the word "none" if none of these would actually help answer the question.',
    'No explanation, just the id or "none".',
  ].join('\n');

  try {
    const { getQvacModels } = await import('../compute/adapters/real-poh.js');
    const qvac = await getQvacModels();
    if (!qvac || !qvac.ENABLED) return null;
    const raw = await qvac.complete(prompt, { model, timeLimit: 20_000 });
    const reply = (raw || '').trim().replace(/["'.]/g, '').toLowerCase();
    if (!reply || reply === 'none') return null;

    const match = candidates.find(c =>
      c.id.toLowerCase() === reply || c.id.toLowerCase().endsWith(`/${reply}`)
    );
    return match ? match.id : null;
  } catch {
    return null;
  }
}
