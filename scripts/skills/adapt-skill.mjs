#!/usr/bin/env node
/**
 * Adapt Claude-Code-shaped skills into DAI skills.
 *
 * Upstream skill repos (anthropics/skills, MiniMax-AI/skills,
 * ritual-foundation/ritual-dapp-skills) are written for an agent that can read
 * bundled files on demand and execute scripts. A DAI node can do neither: it
 * ships one flat .md per skill and injects a single truncated Context block
 * into the prompt of whatever model the operator chose.
 *
 * Two jobs:
 *   --fix   <glob>  repair already-imported skills in place
 *   --from  <file>  convert an upstream SKILL.md to DAI format on stdout
 *
 * The transforms:
 *   1. Dangling pointers. "read `references/foo.md`" promises a file that does
 *      not ship. Rewritten so it reads as a citation, not an instruction — the
 *      model stops trying to open something that isn't there.
 *   2. Frontmatter. name/description -> id/version/description/triggers.
 *   3. Budget. Context over SKILL_CONTEXT_MAX is reported, never silently cut.
 */
import fs from 'fs';
import path from 'path';
import { SKILL_CONTEXT_MAX } from '../../src/skills/limits.js';

/** references/foo-bar.md -> "foo bar reference (not bundled)" */
function prettyRef(file) {
  return String(file).replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
}

/**
 * Neutralise progressive-disclosure pointers.
 * Order matters: markdown links first, then backticked paths, then bare paths,
 * so an inline link is not half-rewritten by the bare-path pass.
 */
export function stripBundledRefs(text) {
  let out = String(text || '');
  let n = 0;
  const mark = f => { n++; return `\`${prettyRef(f)}\` (reference not bundled)`; };

  // [anything](references/foo.md) and [references/foo.md](references/foo.md#anchor)
  out = out.replace(/\[[^\]]*\]\(\s*references\/([a-z0-9._-]+\.md)(?:#[^)]*)?\s*\)/gi, (_, f) => mark(f));
  // `references/foo.md`
  out = out.replace(/`references\/([a-z0-9._-]+\.md)`/gi, (_, f) => mark(f));
  // bare references/foo.md, optional #anchor
  out = out.replace(/\breferences\/([a-z0-9._-]+\.md)(#[a-z0-9-]+)?/gi, (_, f) => mark(f));

  // "read X", "Read: X", "see X" now read oddly once X is a citation.
  out = out.replace(/\b(?:please\s+)?read(?:\s+these\s+files)?\s*:?\s*(?=`[^`]+` \(reference not bundled\))/gi, 'See ');
  out = out.replace(/\*\*Read\*\*\s*:?\s*(?=`)/g, '**See** ');
  return { text: out, count: n };
}

/**
 * Rewrite cross-skill pointers to the id the skill actually ships under.
 *
 * Upstream writes `gas/SKILL.md`, meaning its sibling skill. DAI flattens those
 * to one prefixed file per directory (eth_gas.md), so the upstream path is dead
 * text — but unlike a bundled reference the content IS here, just renamed.
 * Resolve against the siblings and point at the real skill id.
 */
export function relinkSiblingSkills(text, siblingIds = []) {
  let out = String(text || '');
  let n = 0;
  // (^|[^/.\w]) guards against rewriting inside a URL — a github link ends in
  // ".../com/SKILL.md" and is not a cross-skill pointer.
  out = out.replace(/(^|[^/.\w])`?([a-z0-9-]+)\/SKILL\.md`?/gim, (whole, lead, name) => {
    const want = String(name).toLowerCase().replace(/-/g, '_');
    const hit = siblingIds.find(id => id === want || id.endsWith(`_${want}`));
    n++;
    // Resolved -> point at the real shipped id. Unresolved -> stop promising it.
    return hit ? `${lead}\`${hit}\` skill` : `${lead}\`${want}\` (skill not bundled)`;
  });
  return { text: out, count: n };
}

/** Upstream `name:`/`description:` frontmatter -> DAI manifest fields. */
export function convertFrontmatter(raw, { id, triggers = [], version = '1.0.0' } = {}) {
  const m = String(raw).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const fm = {}, body = m ? m[2] : String(raw);
  if (m) for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_-]+):\s*(.*)$/i);
    if (kv) fm[kv[1].trim()] = kv[2].trim();
  }
  const skillId = id || (fm.name || '').replace(/[^a-z0-9_-]/gi, '-');
  const desc = (fm.description || skillId).replace(/\s+/g, ' ').trim();
  const trig = triggers.length ? triggers : [skillId.replace(/[-_]+/g, ' ')];
  const head = [
    '---',
    `id: ${skillId}`,
    `version: ${version}`,
    `description: ${desc}`,
    'triggers:',
    ...trig.map(t => `  - ${t}`),
    '---',
    '',
    '## Context',
    '',
  ].join('\n');
  return head + body.trim() + '\n';
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const mode = args[0];

if (mode === '--fix') {
  const files = args.slice(1);
  let touched = 0, total = 0;
  for (const f of files) {
    const before = fs.readFileSync(f, 'utf8');
    // Siblings are the other skills shipped alongside this one.
    const siblings = fs.readdirSync(path.dirname(f))
      .filter(x => x.endsWith('.md') && x !== path.basename(f))
      .map(x => x.replace(/\.md$/, ''));
    const a = stripBundledRefs(before);
    const b = relinkSiblingSkills(a.text, siblings);
    const count = a.count + b.count;
    if (!count) continue;
    fs.writeFileSync(f, b.text);
    touched++; total += count;
    console.log(`  ${path.basename(f)}: ${a.count} unbundled, ${b.count} relinked`);
  }
  console.log(`\n${total} pointer(s) across ${touched} file(s)`);
} else if (mode === '--from') {
  const src = fs.readFileSync(args[1], 'utf8');
  const idIdx = args.indexOf('--id');
  const trIdx = args.indexOf('--triggers');
  const out = convertFrontmatter(stripBundledRefs(src).text, {
    id: idIdx > -1 ? args[idIdx + 1] : undefined,
    triggers: trIdx > -1 ? args[trIdx + 1].split(',').map(s => s.trim()).filter(Boolean) : [],
  });
  const ctx = out.split('## Context')[1] || '';
  if (ctx.length > SKILL_CONTEXT_MAX) {
    console.error(`[adapt] WARNING ${args[1]}: context ${ctx.length} > ${SKILL_CONTEXT_MAX} — split it`);
  }
  process.stdout.write(out);
} else {
  console.error('usage: adapt-skill.mjs --fix <files...> | --from <SKILL.md> [--id x] [--triggers a,b]');
  process.exit(1);
}
