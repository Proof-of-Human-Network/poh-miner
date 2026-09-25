/**
 * System prompts the paid job pipeline builds. Shared by the executors in
 * miner-node.js and the fee estimator (jobs/estimate.js): the estimator sizes
 * the same text the model receives, so the two must not each keep a copy.
 */
import { SKILL_CONTEXT_MAX } from '../skills/limits.js';

/** Persona for a plain compute job with no dataset. */
export const DIRECT_SYSTEM_PROMPT = 'You are a helpful, concise assistant. Answer in clear Markdown.';

/** System message for a compute job pinned to an installed Hugging Face dataset. */
export function datasetJobSystemPrompt(dataset, slice) {
  return `You are a helpful assistant answering using data from a Hugging Face dataset.\nUse the dataset rows below to answer the user's request. Write in clear, human-readable Markdown.\n\nDataset: ${dataset}\nRelevant rows:\n${slice || '(no matching rows found in the installed dataset)'}`;
}

/** System message for a routed knowledge-only skill (reference context, no fetch). */
export function knowledgeSkillSystemPrompt(skillId, context) {
  return [
    'You are a helpful assistant with access to specialized reference documentation.',
    'Answer using the reference material below. Be specific and practical. Write clear Markdown.',
    `\nReference documentation (${skillId}):\n${String(context || '').slice(0, SKILL_CONTEXT_MAX)}`,
  ].join('\n');
}

/** System message for a `skill` job that carries a user question. */
export function skillJobSystemPrompt(skillContext) {
  return [
    'You are an AI assistant with access to real-time data fetched by a skill.',
    'Answer the user\'s question using only the provided data. Be concise and specific.',
    skillContext ? `\n\nSkill context (how to interpret this data):\n${skillContext}` : '',
  ].join('');
}
