/**
 * Skill ID validation — prevents path traversal and disk-fill via malicious ids.
 */

const SKILL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_STORED_SKILLS = 500;

export function normalizeSkillId(id) {
  if (!id || typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!SKILL_ID_RE.test(trimmed)) return null;
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) return null;
  return trimmed;
}

export { MAX_STORED_SKILLS };