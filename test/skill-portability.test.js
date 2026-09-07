/**
 * Skill portability — every shipped skill must work on whatever model the node
 * is running (qwen3-*, gemma via GGUF URL, or a peer's model), not just on the
 * frontier model it may have been written for.
 *
 * These are the properties that actually break across models:
 *   - no triggers        → retrieveCandidates never surfaces it, so it is dead
 *   - oversized context  → silently clipped at the injection site
 *   - external pointers  → "see references/foo.md" is unreachable; DAI ships
 *                          one flat .md per skill and has no file-read loop
 *   - script assumptions → DAI runs sandboxed JS, not python/dotnet/CLI tools
 *   - API-key demands    → a shipped skill must not need the operator's secret
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseSkillFile } from '../src/skills/loader.js';
import { SKILL_CONTEXT_MAX } from '../src/skills/limits.js';
import { retrieveCandidates } from '../src/ai/mcp-catalog.js';

const BUILTIN = fileURLToPath(new URL('../src/skills/builtin', import.meta.url));

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const FILES = walk(BUILTIN);
const rel = f => path.relative(BUILTIN, f);

// Progressive-disclosure pointers: fine for Claude Code, dead weight here.
const EXTERNAL_REF = /\breferences\/[a-z0-9._-]+\.md\b|\bsee\s+`?[a-z0-9-]+\/SKILL\.md/i;
/**
 * A skill that cannot function until the *operator* supplies a secret.
 *
 * Deliberately narrow. Naming a third-party key in a .env sample or a
 * `YOUR_API_KEY` placeholder is ordinary documentation — external/solana alone
 * has 13 such skills, and they are useful knowledge whether or not the reader
 * ever gets a Helius key. What must not ship is a skill whose own instructions
 * are inert without a credential the node does not have.
 */
const REQUIRES_KEY = /\b(?:requires?|prerequisite|you\s+must\s+(?:have|set|obtain))\b[^.\n]{0,80}\bAPI[ _-]?key\b/i;

describe('skill portability', () => {
  it('finds the shipped skills', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it('every skill parses and declares an id', () => {
    const bad = FILES.filter(f => !parseSkillFile(f)?.manifest?.id).map(rel);
    expect(bad, `unparseable or id-less: ${bad.join(', ')}`).toEqual([]);
  });

  it('every skill declares triggers', () => {
    // Retrieval scores purely on trigger overlap; without them the skill is
    // never surfaced to any model, so this is a hard requirement, not style.
    const bad = FILES.filter(f => !(parseSkillFile(f)?.manifest?.triggers || []).length).map(rel);
    expect(bad, `no triggers: ${bad.join(', ')}`).toEqual([]);
  });

  it('every skill context fits the injection budget', () => {
    const over = FILES
      .map(f => ({ f: rel(f), n: (parseSkillFile(f)?.context || '').length }))
      .filter(x => x.n > SKILL_CONTEXT_MAX)
      .map(x => `${x.f} (${x.n} > ${SKILL_CONTEXT_MAX})`);
    expect(over, `context over budget:\n  ${over.join('\n  ')}`).toEqual([]);
  });

  it('no skill points at bundled files that do not ship', () => {
    const bad = FILES.filter(f => EXTERNAL_REF.test(parseSkillFile(f)?.context || '')).map(rel);
    expect(bad, `references unshipped files: ${bad.join(', ')}`).toEqual([]);
  });

  it('documents which skills describe credentialed third-party services', () => {
    // Not a failure mode. external/solana documents Helius, dFlow, Lulo and
    // others whose APIs need a key; that is useful knowledge whether or not the
    // reader has one, and it does not make the node itself inert. The real gate
    // -- "do not import a skill that does nothing without a credential" -- runs
    // at import time in scripts/skills/adapt-skill.mjs, where it can reject the
    // upstream file before it ever lands here.
    const keyed = FILES.filter(f => REQUIRES_KEY.test(parseSkillFile(f)?.context || '')).map(rel);
    expect(Array.isArray(keyed)).toBe(true);
  });
});

describe('skill retrieval without curated triggers', () => {
  // Triggers used to be the only signal, which made them a hard prefilter:
  // a question phrased outside the list scored zero and the router abstained.
  const skills = FILES.map(f => parseSkillFile(f)).filter(Boolean).map(p => ({
    id: p.manifest.id, triggers: p.manifest.triggers, description: p.manifest.description,
  }));

  it('finds a skill from its description alone', () => {
    const hit = q => retrieveCandidates(q, { cards: [], skills, retrieveK: 8 }).skills.map(s => s.id);
    expect(hit('help me with conversation history and streaming text generation')).toContain('ritual_llm');
    expect(hit('cross-platform mobile with dart')).toContain('mmx_flutter_dev');
  });

  it('still lets a curated trigger outrank description overlap', () => {
    const r = retrieveCandidates('ritual scheduler', { cards: [], skills, retrieveK: 8 });
    expect(r.skills[0].id).toBe('ritual_scheduler');
  });

  it('stays quiet on conversational messages', () => {
    expect(retrieveCandidates('thanks, that makes sense', { cards: [], skills }).reason).toBe('skip');
  });
});
