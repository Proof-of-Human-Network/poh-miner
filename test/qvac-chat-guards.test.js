/**
 * Guards on the local-model chat path.
 *
 * All three of these produced one user-visible failure: a weather question that
 * ran ~90s, emitted thousands of tokens of repeating reasoning, and ended in
 * "produced no output (QVAC unavailable)".
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { supportsNoThink, stripThinking } = require('../src/checker/utils/qvac-models.js');

describe('/no_think targeting', () => {
  it('applies to the Qwen3 instruct line, where it is a control token', () => {
    for (const m of ['qwen3-0.6b', 'qwen3-600m', 'qwen3-1.7b', 'qwen3-4b', 'qwen3-8b']) {
      expect(supportsNoThink(m), m).toBe(true);
    }
  });

  it('does not apply to models that would read it as literal text', () => {
    // qwen3.5-* and qwen3vl-* share the prefix but not the behaviour. Sent
    // there, "/no_think" lands in the user turn as text and the model reasons
    // about the string instead of answering.
    for (const m of ['qwen3.5-2b-mm', 'qwen3.5-4b-mm', 'qwen3vl-2b', 'gemma-2b', '', null, undefined]) {
      expect(supportsNoThink(m), String(m)).toBe(false);
    }
  });
});

describe('chain-of-thought stripping', () => {
  it('removes a closed block', () => {
    expect(stripThinking('<think>weighing it up</think>It is 21C.')).toBe('It is 21C.');
  });

  it('removes a block that was cut off before it closed', () => {
    // The regression: generation dies mid-thought, so there is no </think>,
    // and the raw reasoning was being returned as the answer.
    expect(stripThinking('<think>Wait, I need to check if I should mention')).toBe('');
  });

  it('handles a closed block followed by a dangling one', () => {
    expect(stripThinking('<think>a</think>Hi <think>b never closes')).toBe('Hi');
  });

  it('leaves ordinary text alone', () => {
    expect(stripThinking('It is 21C in Astana.')).toBe('It is 21C in Astana.');
    expect(stripThinking('')).toBe('');
    expect(stripThinking(null)).toBe('');
  });
});
