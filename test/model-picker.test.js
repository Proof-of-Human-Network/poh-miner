/**
 * Hardware-aware model ladder — bigger machines must be offered bigger models,
 * small machines never get something that can't fit.
 */
import { describe, it, expect } from 'vitest';
import { MODEL_LADDER, getModelOptions } from '../src/setup/model-picker.js';

const hw = (usableGB, gpuType = 'none', vramGB = 0) =>
  ({ totalRamGB: usableGB * 2, platform: 'linux', arch: 'x64', gpu: { type: gpuType, vramGB, label: 't' }, usableGB });

describe('model ladder', () => {
  it('is sorted smallest → largest with monotonic budgets', () => {
    for (let i = 1; i < MODEL_LADDER.length; i++) {
      expect(MODEL_LADDER[i].minBudgetGB).toBeGreaterThan(MODEL_LADDER[i - 1].minBudgetGB);
      expect(MODEL_LADDER[i].approxDownloadGB).toBeGreaterThan(MODEL_LADDER[i - 1].approxDownloadGB);
    }
    // Spans tiny → flagship
    expect(MODEL_LADDER[0].name).toBe('qwen3-0.6b');
    expect(MODEL_LADDER[MODEL_LADDER.length - 1].name).toBe('gpt-oss-120b');
  });

  it('grades monotonically: more usable memory never suggests a smaller large-tier', () => {
    let prevIdx = -1;
    for (const gb of [2, 4, 8, 16, 24, 32, 48, 64, 96, 128]) {
      const { large } = getModelOptions(hw(gb));
      const idx = MODEL_LADDER.findIndex(m => m.name === large.name);
      expect(idx).toBeGreaterThanOrEqual(prevIdx);
      prevIdx = idx;
    }
  });

  it('never offers a model above the usable budget', () => {
    for (const gb of [1, 3, 7, 12, 18, 26, 34, 80]) {
      const { large } = getModelOptions(hw(gb));
      expect(large.minBudgetGB).toBeLessThanOrEqual(Math.max(gb, MODEL_LADDER[0].minBudgetGB));
    }
  });

  it('small machine collapses to the tiny model; workstation reaches the flagship', () => {
    const laptop = getModelOptions(hw(4));
    expect(laptop.small.name).toBe('qwen3-0.6b');
    expect(laptop.recommended).toBe('qwen3-0.6b');

    const ws = getModelOptions(hw(96, 'nvidia', 48));
    expect(ws.large.name).toBe('gpt-oss-120b');
    expect(['qwen3-35b', 'qwen3-27b']).toContain(ws.recommended);
  });

  it('discrete AMD/Intel GPUs (type "gpu") grade like NVIDIA', () => {
    const amd = getModelOptions(hw(32, 'gpu', 20));
    const nv  = getModelOptions(hw(32, 'nvidia', 20));
    expect(amd.large.name).toBe(nv.large.name);
  });
});
