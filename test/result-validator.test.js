import { describe, it, expect, vi, beforeEach } from 'vitest';

// We will mock the methods manager since it does network calls
vi.mock('../src/signals/methods-manager.js', () => {
  return {
    getMethodsManager: vi.fn().mockResolvedValue({
      hash: 'test-hash-123',
      getActiveMethods: () => [
        { id: 'm1' },
        { id: 'm2' },
        { id: 'm3' },
        { id: 'm4' },
      ],
    }),
  };
});

import { validateResultWork } from '../src/validation/result-validator.js';

describe('Result Validator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject results with stale methodsHash', async () => {
    const result = {
      methodsHash: 'old-hash',
      signalsUsed: ['m1', 'm2', 'm3'],
      methodsCount: 3,
    };

    const validation = await validateResultWork(result);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some(e => e.includes('Stale methodsHash'))).toBe(true);
  });

  it('should accept results that evaluated enough signals', async () => {
    const result = {
      methodsHash: 'test-hash-123',
      signalsUsed: ['m1', 'm2', 'm3'], // 3 out of 4 = 75%
      methodsCount: 3,
      verdict: 'HUMAN',
      profile: { some: 'data' },
      reasoning: 'Looks human based on signals',
      computationTimeMs: 1200,
    };

    const validation = await validateResultWork(result);
    expect(validation.isValid).toBe(true);
  });

  it('should reject results with insufficient signal coverage', async () => {
    const result = {
      methodsHash: 'test-hash-123',
      signalsUsed: ['m1'], // only 1/4 = 25% < 75%
      methodsCount: 1,
    };

    const validation = await validateResultWork(result);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some(e => e.includes('Insufficient work'))).toBe(true);
  });
});