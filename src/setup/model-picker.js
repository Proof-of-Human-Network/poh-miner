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

// Text + vision LLM ladder, smallest → largest. `minBudgetGB` is the usable-
// memory headroom we want before offering a model as a comfortable pick.
// Vision models (VL / multimodal) can read chat image attachments via QVAC.
// Keep minBudgetGB and approxDownloadGB strictly monotonic (tests + grading).
export const MODEL_LADDER = [
  { name: 'smollm2-360m',  label: 'SmolLM2 360M',           constant: 'SMOLLM2_360M_INST_Q8',              approxDownloadGB: 0.35, minBudgetGB: 1,  blurb: 'Ultra-tiny text model. Emergency mode on very low-RAM hosts.' },
  { name: 'qwen3-0.6b',    label: 'Qwen3 0.6B',             constant: 'QWEN3_600M_INST_Q4',                approxDownloadGB: 0.45, minBudgetGB: 1.5, blurb: 'Fastest Qwen, tiny footprint. Good on low-RAM / CPU-only hosts.' },
  { name: 'llama3.2-1b',   label: 'Llama 3.2 1B',           constant: 'LLAMA_3_2_1B_INST_Q4_0',            approxDownloadGB: 0.8,  minBudgetGB: 2,  blurb: 'Meta small instruct model. Snappy chat on modest machines.' },
  { name: 'llama-tool-1b', label: 'Llama Tool-Calling 1B',  constant: 'LLAMA_TOOL_CALLING_1B_INST_Q4_K',   approxDownloadGB: 0.95, minBudgetGB: 2.5, blurb: 'Tuned for tool/MCP calling. Good with skills and MCP servers.' },
  { name: 'smolvlm2-500m', label: 'SmolVLM2 500M (vision)', constant: 'SMOLVLM2_500M_MULTIMODAL_Q8_0',     approxDownloadGB: 1.05, minBudgetGB: 3,  blurb: 'Tiny vision-language model — reads images in chat.' },
  { name: 'qwen3-1.7b',    label: 'Qwen3 1.7B',             constant: 'QWEN3_1_7B_INST_Q4',                approxDownloadGB: 1.2,  minBudgetGB: 3.5, blurb: 'Balanced quality and speed. Solid all-round default.' },
  { name: 'qwen3vl-2b',    label: 'Qwen3-VL 2B (vision)',   constant: 'QWEN3VL_2B_MULTIMODAL_Q4_K',        approxDownloadGB: 1.6,  minBudgetGB: 4.5, blurb: 'Vision + text. Best pick when you attach screenshots or photos.' },
  { name: 'qwen3.5-2b-mm', label: 'Qwen3.5 2B Multimodal',  constant: 'QWEN3_5_2B_MULTIMODAL_Q4_K_M',      approxDownloadGB: 1.9,  minBudgetGB: 5.5, blurb: 'Newer Qwen multimodal — image understanding + chat.' },
  { name: 'gemma4-2b-mm',  label: 'Gemma4 2B Multimodal',   constant: 'GEMMA4_2B_MULTIMODAL_Q4_K_M',       approxDownloadGB: 2.1,  minBudgetGB: 6.5, blurb: 'Google Gemma4 vision-language model.' },
  { name: 'qwen3-4b',      label: 'Qwen3 4B',               constant: 'QWEN3_4B_INST_Q4_K_M',              approxDownloadGB: 2.5,  minBudgetGB: 7.5, blurb: 'Noticeably stronger reasoning and structured output.' },
  { name: 'qwen3.5-4b-mm', label: 'Qwen3.5 4B Multimodal',  constant: 'QWEN3_5_4B_MULTIMODAL_Q4_K_M',      approxDownloadGB: 3.2,  minBudgetGB: 9,  blurb: 'Strong multimodal reasoning for docs and screenshots.' },
  { name: 'qwen3-8b',      label: 'Qwen3 8B',               constant: 'QWEN3_8B_INST_Q4_K_M',              approxDownloadGB: 5.0,  minBudgetGB: 12, blurb: 'Great quality on a capable GPU or 16 GB+ RAM.' },
  { name: 'gpt-oss-20b',   label: 'GPT-OSS 20B',            constant: 'GPT_OSS_20B_INST_Q4_K_M',           approxDownloadGB: 11.6, minBudgetGB: 18, blurb: 'Frontier-lab open model. Wants 24 GB VRAM or 32 GB RAM.' },
  { name: 'qwen3-27b',     label: 'Qwen3.6 27B',            constant: 'QWEN3_6_27B_MULTIMODAL_Q4_K_XL',    approxDownloadGB: 17.6, minBudgetGB: 26, blurb: 'Large dense model, strong reasoning. 32 GB+ machines.' },
  { name: 'qwen3-35b',     label: 'Qwen3.6 35B-A3B (MoE)',  constant: 'QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M', approxDownloadGB: 22.1, minBudgetGB: 34, blurb: 'Mixture-of-experts: 35B quality at ~3B active speed. 48 GB+ machines.' },
  { name: 'gpt-oss-120b',  label: 'GPT-OSS 120B',           constant: 'GPT_OSS_120B_INST_Q4_K_M_SHARD',    approxDownloadGB: 62.8, minBudgetGB: 80, blurb: 'Flagship-class. Workstations with 96 GB+ unified/VRAM only.' },
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

    // Windows fallback: AMD/Intel discrete GPUs have no nvidia-smi — query WMI.
    // (QVAC runs llama.cpp with Vulkan on Windows, so any Vulkan-capable GPU counts.)
    if (gpu.type === 'none' && platform === 'win32') {
      try {
        const out = execSync(
          'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json"',
          { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
        const info = JSON.parse(out);
        const name = (info.Name || '').trim();
        // AdapterRAM is uint32 — caps at 4 GB and lies for shared memory; treat it
        // as a floor and only trust it for discrete AMD/NVIDIA names.
        const vram = Math.max(0, Math.round((info.AdapterRAM || 0) / 1e9));
        const discrete = /radeon rx|radeon pro|arc a|geforce|quadro/i.test(name);
        if (name && discrete) {
          gpu = { type: 'gpu', vramGB: Math.max(vram, 4), label: name };
        } else if (name) {
          gpu = { type: 'igpu', vramGB: 0, label: `${name} (integrated)` };
        }
      } catch { /* PowerShell/WMI unavailable — stay CPU-only */ }
    }
  }

  // Usable memory budget for the model.
  let usableGB;
  if (gpu.type === 'apple')       usableGB = Math.round(totalRamGB * 0.6);   // unified memory, leave headroom
  else if (gpu.type === 'nvidia' || gpu.type === 'gpu') usableGB = Math.max(gpu.vramGB, Math.round(totalRamGB * 0.5));
  else                            usableGB = Math.round(totalRamGB * 0.5);   // CPU only / iGPU

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
