/**
 * SkillsManager — tracks on-chain skill lifecycle:
 *   proposed → staking → graduated (active) → deprecated
 *
 * Mirrors how MethodsManager tracks the signals list.
 * Processes 'skill-proposed' and 'skill-deprecated' state transitions from blocks.
 */

import crypto from 'crypto';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_RUNNER = path.join(__dirname, 'sandbox', 'skill-runner.js');
const SKILL_TIMEOUT_MS = 15_000;

export class SkillsManager {
  constructor() {
    // skillId → { manifest, code, context, status, proposedAt, txHash }
    this._skills = new Map();
  }

  // ── Block processing ──────────────────────────────────────────────────────

  // Called from processStateTransition for skill-related transitions
  processTransition(transition) {
    if (transition.type === 'skill-proposed') {
      const { manifest, code, context, authorSignature, txHash } = transition;
      if (!manifest?.id) return;
      const codeHash    = code    ? crypto.createHash('sha256').update(code).digest('hex')    : null;
      const contextHash = context ? crypto.createHash('sha256').update(context).digest('hex') : null;
      this._skills.set(manifest.id, {
        manifest: { ...manifest, codeHash, contextHash },
        code: code || null,
        context: context || null,
        status: 'proposed',
        private: false,
        proposedAt: Date.now(),
        txHash,
        authorSignature,
      });
      console.log(`[SkillsManager] Skill proposed: ${manifest.id} v${manifest.version}`);
    } else if (transition.type === 'skill-graduated') {
      const skill = this._skills.get(transition.skillId);
      if (skill) { skill.status = 'active'; console.log(`[SkillsManager] Skill graduated: ${transition.skillId}`); }
    } else if (transition.type === 'skill-deprecated') {
      const skill = this._skills.get(transition.skillId);
      if (skill) { skill.status = 'deprecated'; console.log(`[SkillsManager] Skill deprecated: ${transition.skillId}`); }
    }
  }

  // ── Private skill helpers ─────────────────────────────────────────────────

  addPrivateSkill(manifest, code, context) {
    if (!manifest?.id) return;
    const codeHash    = code    ? crypto.createHash('sha256').update(code).digest('hex')    : null;
    const contextHash = context ? crypto.createHash('sha256').update(context).digest('hex') : null;
    this._skills.set(manifest.id, {
      manifest: { ...manifest, codeHash, contextHash },
      code: code || null,
      context: context || null,
      status: 'proposed',
      private: true,
      proposedAt: Date.now(),
      txHash: null,
      authorSignature: null,
    });
    console.log(`[SkillsManager] Private skill stored: ${manifest.id}`);
  }

  // Marks a private skill as public and returns the transition to broadcast.
  publishSkill(skillId) {
    const skill = this._skills.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} not found`);
    if (!skill.private) throw new Error(`Skill ${skillId} is already public`);
    const txHash = `skill-${skillId}-${Date.now()}`;
    skill.private = false;
    skill.txHash = txHash;
    return {
      type: 'skill-proposed',
      manifest: skill.manifest,
      code: skill.code,
      context: skill.context,
      authorSignature: skill.authorSignature,
      txHash,
    };
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getActiveSkills() {
    return [...this._skills.values()].filter(s => s.status === 'active').map(s => s.manifest);
  }

  getProposedSkills() {
    return [...this._skills.values()].filter(s => s.status === 'proposed').map(s => s.manifest);
  }

  getAllSkills() {
    return [...this._skills.values()].map(s => ({ ...s.manifest, status: s.status, private: s.private || false }));
  }

  getSkill(skillId) {
    return this._skills.get(skillId) || null;
  }

  // ── Sandboxed execution ───────────────────────────────────────────────────

  async runSkill(skillId, input, config) {
    const skill = this._skills.get(skillId);
    if (!skill || !skill.code) throw new Error(`Skill ${skillId} not found or has no run.js`);
    return new Promise((resolve, reject) => {
      const worker = new Worker(SKILL_RUNNER, {
        workerData: {
          code: skill.code,
          input,
          config,
          allowedEndpoints: skill.manifest.allowedEndpoints || [],
        },
      });
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Skill ${skillId} timed out after ${SKILL_TIMEOUT_MS}ms`));
      }, SKILL_TIMEOUT_MS);
      worker.on('message', result => {
        clearTimeout(timer);
        if (result?.__error) reject(new Error(result.__error));
        else resolve(result);
      });
      worker.on('error', err => { clearTimeout(timer); reject(err); });
    });
  }
}

// Singleton
export const skillsManager = new SkillsManager();
