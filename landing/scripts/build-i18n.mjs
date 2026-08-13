#!/usr/bin/env node
/* Build step for the shared landing i18n.
 *
 * Reads every per-page translation table in ../i18n-src/*.json and injects the
 * merged result into ../i18n.js between the PAGE_TABLES markers. English is the
 * source of truth; keys are namespaced per page (mnr.* miner · wal.* wallet ·
 * doc.* docs). Run after editing any i18n-src/*.json:
 *
 *   node scripts/build-i18n.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'i18n-src');
const target = join(here, '..', 'i18n.js');

const LANGS = ["en", "ru", "ky", "ka", "cn", "hk", "es", "de", "arab", "farsi", "it", "fr"];

// Deep-merge every source table into { lang: { key: value } }.
const merged = {};
const files = readdirSync(srcDir).filter(f => f.endsWith('.json')).sort();
let totalKeys = 0;
for (const file of files) {
  const table = JSON.parse(readFileSync(join(srcDir, file), 'utf8'));
  const enKeys = Object.keys(table.en || {});
  totalKeys += enKeys.length;
  // Fill any language missing keys from English so every language is complete.
  for (const lang of LANGS) {
    merged[lang] ||= {};
    const src = table[lang] || {};
    for (const k of enKeys) merged[lang][k] = src[k] != null ? src[k] : table.en[k];
  }
  console.log(`  ${file}: ${enKeys.length} keys`);
}

// Two-space indent to sit tidily inside the IIFE.
const json = JSON.stringify(merged, null, 2).replace(/\n/g, '\n  ');

const START = '/*__PAGE_TABLES_START__*/';
const END = '/*__PAGE_TABLES_END__*/';
const js = readFileSync(target, 'utf8');
const a = js.indexOf(START);
const b = js.indexOf(END);
if (a === -1 || b === -1) {
  console.error('markers not found in i18n.js');
  process.exit(1);
}
const out = js.slice(0, a + START.length) + json + js.slice(b);
writeFileSync(target, out);
console.log(`Injected ${totalKeys} keys/lang from ${files.length} table(s) into i18n.js`);
