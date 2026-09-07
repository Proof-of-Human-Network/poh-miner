/**
 * Skill context budget — one number, shared by the loader-side guard and every
 * prompt-injection site.
 *
 * Why this exists: the injection sites in miner-node.js each hardcoded
 * `slice(0, 8000)`. Nothing checked skill files against that, so 52 of the 72
 * shipped skills drifted just past it (max 8,211) and had their tails silently
 * dropped — ~9,700 characters of shipped documentation that never reached a
 * model. A skill author had no way to notice: no warning, no test, no error.
 *
 * 8,600 covers the whole current corpus with headroom. It is a deliberate
 * ceiling, not a target — roughly 2k tokens, which is already a large slice of
 * the window on the small local models a node may run (qwen3-0.6b, gemma-2b).
 * Skills that need more should be split, the way external/ethereum/* is.
 */
export const SKILL_CONTEXT_MAX = 8600;

/** Job-path budget — reference material only, deliberately tighter. */
export const SKILL_JOB_CONTEXT_MAX = 3000;

/**
 * Clamp a skill context for prompt injection.
 * Truncation is a bug to be fixed in the skill, not a normal path, so callers
 * that care can pass an onClip hook to surface it.
 */
export function fitSkillContext(context, { max = SKILL_CONTEXT_MAX, onClip = null } = {}) {
  const text = String(context || '');
  if (text.length <= max) return text;
  if (typeof onClip === 'function') onClip(text.length, max);
  return text.slice(0, max);
}
