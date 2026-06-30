/**
 * SkillsRegistry — execute(skillId, input, config, sharedState)
 *
 * Built-in skill: 'poh_identity' (wraps checker + brain pipeline).
 * Third-party skills are proposed on-chain, pinned to IPFS, and loaded here
 * once they graduate the conviction curve.
 */

import { run as pohRun, POH_SKILL_MANIFEST } from './poh-skill.js';

const BUILTIN_SKILLS = {
  poh_identity: { manifest: POH_SKILL_MANIFEST, run: pohRun },
};

export class SkillsRegistry {
  constructor() {
    // Active (graduated) skills indexed by skillId.
    // Built-ins are always active; on-chain skills added via registerSkill().
    this._skills = { ...BUILTIN_SKILLS };
  }

  getActiveSkills() {
    return Object.values(this._skills).map(s => s.manifest);
  }

  hasSkill(skillId) {
    return skillId in this._skills;
  }

  // Register a skill that has graduated the conviction curve.
  // Network-delivered code must not be evaluated in the main process — delegate to SkillsManager.
  registerSkill(manifest, code) {
    const skillId = manifest.id;
    if (!skillId) throw new Error('manifest.id required');
    if (code) {
      throw new Error(`Skill ${skillId}: main-process code eval is disabled; use SkillsManager.runSkill (worker sandbox)`);
    }
    this._skills[skillId] = { manifest, run: null };
    console.log(`[SkillsRegistry] Registered skill metadata: ${skillId} v${manifest.version}`);
  }

  unregisterSkill(skillId) {
    if (skillId === 'poh_identity') return; // built-in cannot be removed
    delete this._skills[skillId];
  }

  // Execute a skill by id. Throws if skill not found.
  async execute(skillId, input, config, sharedState) {
    const skill = this._skills[skillId];
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    return skill.run(input, config, sharedState);
  }
}

// Singleton
export const skillsRegistry = new SkillsRegistry();
