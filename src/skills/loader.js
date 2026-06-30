/**
 * Skill loader — scans directories for *.md skill files and seeds them into skillsManager.
 *
 * File format: frontmatter (---) + ## Context section + optional ## Code section.
 * Built-in skills live in src/skills/builtin/.
 * Published/user skills live in ~/.poh-miner/brain/skills/.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { skillsManager } from './manager.js';

// ── Frontmatter parser (no yaml dependency) ───────────────────────────────────

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;

  const fm  = {};
  let lastKey = null;
  for (const line of match[1].split('\n')) {
    const arrItem = line.match(/^\s{2,}-\s+(.+)$/);
    if (arrItem && lastKey) {
      if (!Array.isArray(fm[lastKey])) fm[lastKey] = [];
      fm[lastKey].push(arrItem[1].trim());
      continue;
    }
    const kv = line.match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const k = kv[1].trim();
    const v = kv[2].trim();
    fm[k]  = v || [];
    lastKey = k;
  }

  return { frontmatter: fm, body: match[2] };
}

// ── Section extractor ─────────────────────────────────────────────────────────

function extractSection(body, name) {
  // No 'm' flag — '$' must mean end-of-string, not end-of-line, so [\s\S]*? captures full section.
  // Only stop at a literal "## Context" or "## Code" heading (the two recognized section
  // markers) — NOT at any "##" heading, so a skill's own internal subheadings (common in
  // ported reference docs) don't get mistaken for the start of a new top-level section.
  const re = new RegExp(`##\\s+${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s+(?:Context|Code)\\b|$)`, 'i');
  return body.match(re)?.[1]?.trim() || null;
}

function extractCode(body) {
  const section = extractSection(body, 'Code');
  if (!section) return null;
  const m = section.match(/```(?:js|javascript)?\r?\n([\s\S]*?)```/);
  return m?.[1]?.trim() || null;
}

// ── Parse a single skill .md file ─────────────────────────────────────────────

export function parseSkillFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed  = parseFrontmatter(content);
  if (!parsed) {
    console.warn(`[SkillLoader] ${path.basename(filePath)}: missing frontmatter — skipped`);
    return null;
  }

  const { frontmatter: fm, body } = parsed;
  if (!fm.id) {
    console.warn(`[SkillLoader] ${path.basename(filePath)}: missing id — skipped`);
    return null;
  }

  const endpoints = Array.isArray(fm.allowedEndpoints) ? fm.allowedEndpoints : (fm.allowedEndpoints ? [fm.allowedEndpoints] : []);
  const triggers  = Array.isArray(fm.triggers)         ? fm.triggers         : (fm.triggers         ? [fm.triggers]         : []);

  const manifest = {
    id:               fm.id,
    version:          fm.version || '1.0.0',
    description:      fm.description || fm.id,
    allowedEndpoints: endpoints,
    triggers,
  };

  const context = extractSection(body, 'Context');
  const code    = extractCode(body);

  return { manifest, code, context };
}

// ── Load all skills from a directory ─────────────────────────────────────────

export function loadSkillsFromDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadSkillsFromDir(entryPath); // recurse — allows organizing builtins into subfolders
      continue;
    }
    if (!entry.name.endsWith('.md')) continue;
    try {
      const parsed = parseSkillFile(entryPath);
      if (!parsed) continue;
      const { manifest, code, context } = parsed;
      skillsManager.addPrivateSkill(manifest, code, context);
      skillsManager._skills.get(manifest.id).status = 'active';
      console.log(`[SkillLoader] Loaded skill: ${manifest.id} from ${entry.name}`);
    } catch (err) {
      console.warn(`[SkillLoader] Failed to load ${entry.name}:`, err.message);
    }
  }
}

// ── Write a skill back to disk (called when published via gossip) ─────────────

export function writeSkillFile(dir, manifest, code, context) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const endpoints = (manifest.allowedEndpoints || []).map(e => `  - ${e}`).join('\n');
  const triggers  = (manifest.triggers         || []).map(t => `  - ${t}`).join('\n');

  const content = `---
id: ${manifest.id}
version: ${manifest.version || '1.0.0'}
description: ${manifest.description || ''}
allowedEndpoints:
${endpoints || '  - \'*\''}
triggers:
${triggers || '  - ' + manifest.id}
---

## Context

${context || ''}

## Code

\`\`\`js
${code || '// No sandboxed code — handled natively'}
\`\`\`
`;

  fs.writeFileSync(path.join(dir, `${manifest.id}.md`), content, 'utf8');
}

// ── Convenience: seed built-ins then user skills ──────────────────────────────

export function loadAllSkills(brainDataDir) {
  // fileURLToPath handles Windows paths (no leading slash) and URL-encoded characters
  const builtinDir = fileURLToPath(new URL('./builtin', import.meta.url));
  loadSkillsFromDir(builtinDir);

  if (brainDataDir) {
    loadSkillsFromDir(path.join(brainDataDir, 'skills'));
  }
}
