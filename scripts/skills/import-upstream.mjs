#!/usr/bin/env node
/**
 * Import upstream skills into src/skills/builtin/external/<vendor>/.
 *
 * Upstream SKILL.md files are written for an agent with no context budget and
 * on-demand file reads. DAI injects one truncated block into a small local
 * model. So each import is condensed to a section boundary under the budget and
 * given a footer telling the model where the untruncated source lives -- the
 * gitmcp default MCP can already fetch it, so depth stays reachable.
 *
 * Triggers are curated here, not derived: retrieval scores purely on trigger
 * overlap, so a generated trigger list is the difference between a skill that
 * is findable and one that is dead weight.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stripBundledRefs, convertFrontmatter } from './adapt-skill.mjs';
import { SKILL_CONTEXT_MAX } from '../../src/skills/limits.js';

const OUT = fileURLToPath(new URL('../../src/skills/builtin/external', import.meta.url));

/** A skill that does nothing without a credential the node does not have. */
const INERT_WITHOUT_KEY = /\b(?:requires?|prerequisite|you\s+must\s+(?:have|set|obtain))\b[^.\n]{0,80}\bAPI[ _-]?key\b/i;

const SOURCES = [
  {
    vendor: 'ritual', repo: 'ritual-foundation/ritual-dapp-skills', prefix: 'ritual_',
    license: 'The Clear BSD License, (c) 2026 Ritual Foundation',
    skills: {
      'ritual-dapp-overview':    ['ritual', 'ritual chain', 'ritual dapp', 'async transaction lifecycle'],
      'ritual-dapp-precompiles': ['ritual precompile', 'onchain inference', 'precompile address'],
      'ritual-dapp-llm':         ['ritual llm', 'onchain llm', 'onchain inference', 'llm precompile'],
      'ritual-dapp-scheduler':   ['ritual scheduler', 'scheduled transaction', 'cron onchain'],
      'ritual-dapp-contracts':   ['ritual contract', 'ritual solidity', 'ritual consumer contract'],
      'ritual-dapp-wallet':      ['ritual wallet', 'ritual account', 'ritual signing'],
      'ritual-dapp-x402':        ['x402', 'pay per request', 'http 402'],
      'ritual-dapp-da':          ['ritual da', 'data availability', 'storageref'],
      'ritual-dapp-deploy':      ['ritual deploy', 'deploy to ritual', 'ritual testnet'],
      'ritual-dapp-block-time':  ['ritual block time', 'ritual finality'],
    },
  },
  {
    vendor: 'minimax', repo: 'MiniMax-AI/skills', prefix: 'mmx_',
    license: 'MIT, (c) MiniMax-AI',
    skills: {
      'flutter-dev':         ['flutter', 'dart', 'flutter widget', 'flutter app'],
      'ios-application-dev': ['ios app', 'swiftui', 'swift', 'xcode'],
      'react-native-dev':    ['react native', 'expo', 'rn app'],
      'shader-dev':          ['shader', 'glsl', 'webgl', 'fragment shader', 'raymarching'],
      'frontend-dev':        ['frontend', 'web ui', 'css layout', 'responsive design'],
      'android-native-dev':  ['android', 'kotlin', 'jetpack compose', 'android app'],
      'fullstack-dev':       ['fullstack', 'full stack app', 'backend and frontend'],
    },
  },
];

/** Cut at the last markdown heading that still fits, so we never end mid-sentence. */
function condense(body, budget) {
  if (body.length <= budget) return { text: body, cut: false };
  const slice = body.slice(0, budget);
  const lastHeading = slice.lastIndexOf('\n## ');
  const lastPara = slice.lastIndexOf('\n\n');
  const cutAt = lastHeading > budget * 0.5 ? lastHeading : (lastPara > budget * 0.5 ? lastPara : budget);
  let text = slice.slice(0, cutAt).trimEnd();
  // Drop a trailing lead-in ("...for any of these reasons:") whose list got cut.
  while (/[:;,]$|^#{1,6}\s|\*\*$/.test(text.split('\n').pop().trim()) && text.includes('\n')) {
    text = text.slice(0, text.lastIndexOf('\n')).trimEnd();
  }
  return { text, cut: true };
}

const fetchText = async url => {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
};

let made = 0, skipped = 0;
for (const src of SOURCES) {
  const dir = path.join(OUT, src.vendor);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, triggers] of Object.entries(src.skills)) {
    const url = `https://raw.githubusercontent.com/${src.repo}/main/skills/${name}/SKILL.md`;
    let raw;
    try { raw = await fetchText(url); }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); skipped++; continue; }

    if (INERT_WITHOUT_KEY.test(raw)) {
      console.log(`  ⊘ ${name}: inert without an operator credential — not imported`);
      skipped++; continue;
    }

    const id = src.prefix + name.replace(/^ritual-dapp-|^minimax-/, '').replace(/-/g, '_');
    const footer = [
      '',
      '---',
      `Source: \`${src.repo}\` — ${src.license}.`,
      `Condensed for the node's prompt budget. For the untruncated skill, fetch`,
      `\`skills/${name}/SKILL.md\` from \`${src.repo}\` with the \`gitmcp\` MCP.`,
      '',
    ].join('\n');

    // Budget the body so frontmatter + footer still land under the cap.
    const stripped = stripBundledRefs(raw).text;
    const bodyOnly = stripped.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    const { text, cut } = condense(bodyOnly, SKILL_CONTEXT_MAX - footer.length - 400);
    const out = convertFrontmatter(
      stripped.replace(bodyOnly, text + footer),
      { id, triggers },
    );
    fs.writeFileSync(path.join(dir, `${id}.md`), out);
    console.log(`  ✓ ${id.padEnd(24)} ${String(bodyOnly.length).padStart(7)} → ${String(text.length).padStart(6)}${cut ? ' (condensed)' : ''}`);
    made++;
  }
  fs.writeFileSync(path.join(dir, 'LICENSE'), `${src.license}\nSource: https://github.com/${src.repo}\n`);
}
console.log(`\n${made} imported, ${skipped} skipped`);
