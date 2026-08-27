#!/usr/bin/env node
/* Generates the regional landing pages into landing/<slug>/index.html.
 *
 *   node regions/build-pages.mjs           # write all countries
 *   node regions/build-pages.mjs kgs etb   # write just these
 *
 * Copy lives in pages/strings.mjs, country facts in pages/data.mjs and the
 * landmark drawings in pages/scenes.mjs. Re-run after editing any of them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COUNTRIES } from './pages/data.mjs';
import { L } from './pages/strings.mjs';
import { buildPage } from './pages/template.mjs';

const landing = join(dirname(fileURLToPath(import.meta.url)), '..');
const only = new Set(process.argv.slice(2));
const targets = only.size ? COUNTRIES.filter(c => only.has(c.slug)) : COUNTRIES;

if (!targets.length) {
  console.error(`No matching countries. Known: ${COUNTRIES.map(c => c.slug).join(', ')}`);
  process.exit(1);
}

let total = 0;
for (const c of targets) {
  const html = buildPage(c, L(c.lang, c));
  const dir = join(landing, c.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  total += Buffer.byteLength(html);
  console.log(`  ${c.slug.padEnd(5)} ${c.lang.padEnd(3)} ${String(Math.round(Buffer.byteLength(html) / 1024) + ' KB').padStart(7)}  ${c.country} — ${c.landmark}`);
}
console.log(`\nWrote ${targets.length} page(s), ${(total / 1024).toFixed(0)} KB total.`);
console.log('Shared assets: regions-fonts.css (412 KB, cached once) + regions-page.css.');
