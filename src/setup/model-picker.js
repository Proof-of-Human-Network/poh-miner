/**
 * Hardware-aware LLM picker.
 *
 * QVAC downloads and runs the inference model in-process. The right model size
 * depends on the machine: a "large" model on an 8 GB laptop is not the same as
 * a "large" model on a 128 GB workstation with a big GPU. This module detects
 * the host's usable memory (unified RAM on Apple Silicon, VRAM on a discrete
 * GPU, otherwise system RAM) and returns three **relatively graded** choices —
 * small / medium / large — plus a recommended default, so first-run setup (CLI
 * or Electron) can ask the user which model to download.
 */

import os from 'os';
import { execSync } from 'child_process';

// Text LLM ladder, smallest → largest. `minBudgetGB` is the usable-memory
// headroom we want before offering a model as a comfortable pick. Extend this
// array with bigger constants (e.g. 14B/32B) as they become available.
export const MODEL_LADDER = [
  { name: 'qwen3-0.6b', label: 'Qwen3 0.6B', constant: 'QWEN3_600M_INST_Q4',  approxDownloadGB: 0.4, minBudgetGB: 1,  blurb: 'Fastest, tiny footprint. Good on low-RAM / CPU-only hosts.' },
  { name: 'qwen3-1.7b', label: 'Qwen3 1.7B', constant: 'QWEN3_1_7B_INST_Q4',  approxDownloadGB: 1.1, minBudgetGB: 3,  blurb: 'Balanced quality and speed. Solid all-round default.' },
  { name: 'qwen3-4b',   label: 'Qwen3 4B',   constant: 'QWEN3_4B_INST_Q4_K_M', approxDownloadGB: 2.5, minBudgetGB: 7,  blurb: 'Noticeably stronger reasoning and structured output.' },
  { name: 'qwen3-8b',   label: 'Qwen3 8B',   constant: 'QWEN3_8B_INST_Q4_K_M', approxDownloadGB: 5.0, minBudgetGB: 12, blurb: 'Best quality. Wants a capable GPU or lots of RAM.' },
];

/** Detect RAM, platform, and any GPU (Apple unified memory, or NVIDIA VRAM). */
export function detectHardware() {
  const totalRamGB = Math.max(1, Math.round(os.totalmem() / 1e9));
  const platform = process.platform;
  const arch = process.arch;
  let gpu = { type: 'none', vramGB: 0, label: 'CPU only (no dedicated GPU detected)' };

  if (platform === 'darwin' && arch === 'arm64') {
    // Apple Silicon: GPU shares unified memory with the CPU.
    gpu = { type: 'apple', vramGB: totalRamGB, label: 'Apple Silicon (unified memory)' };
  } else {
    // NVIDIA discrete GPU (Linux/Windows).
    try {
      const out = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
      const line = out.split('\n').filter(Boolean)[0];
      if (line) {
        const [name, memMiB] = line.split(',');
        gpu = { type: 'nvidia', vramGB: Math.max(1, Math.round(parseInt(memMiB, 10) / 1024)), label: name.trim() };
      }
    } catch { /* no nvidia-smi / no NVIDIA GPU */ }
  }

  // Usable memory budget for the model.
  let usableGB;
  if (gpu.type === 'apple')       usableGB = Math.round(totalRamGB * 0.6);   // unified memory, leave headroom
  else if (gpu.type === 'nvidia') usableGB = Math.max(gpu.vramGB, Math.round(totalRamGB * 0.5));
  else                            usableGB = Math.round(totalRamGB * 0.5);   // CPU only

  return { totalRamGB, platform, arch, gpu, usableGB };
}

/**
 * Return three relatively-graded model options for this machine.
 * `large` is the biggest ladder model that comfortably fits the usable budget;
 * `medium` and `small` step down from there. On very small machines they may
 * collapse toward the tiny model. The recommended pick is `medium` (balanced).
 */
export function getModelOptions(hw = detectHardware()) {
  // Largest ladder index whose budget requirement fits; at least index 0.
  let largeIdx = 0;
  for (let i = 0; i < MODEL_LADDER.length; i++) {
    if (hw.usableGB >= MODEL_LADDER[i].minBudgetGB) largeIdx = i;
  }
  const smallIdx  = Math.max(0, largeIdx - 2);
  const mediumIdx = Math.max(0, largeIdx - 1);

  const grade = (idx, tier) => ({ tier, ...MODEL_LADDER[idx] });
  const small  = grade(smallIdx, 'small');
  const medium = grade(mediumIdx, 'medium');
  const large  = grade(largeIdx, 'large');

  // De-dup collapsed tiers (tiny machines) while keeping three labelled slots.
  const recommended = medium.name;
  return { hardware: hw, small, medium, large, recommended };
}

/** One-line human summary of detected hardware. */
export function describeHardware(hw = detectHardware()) {
  const gpu = hw.gpu.type === 'none' ? 'no dedicated GPU' : hw.gpu.label + (hw.gpu.vramGB ? ` (~${hw.gpu.vramGB} GB)` : '');
  return `${hw.totalRamGB} GB RAM · ${gpu} · ~${hw.usableGB} GB usable for the model`;
}
