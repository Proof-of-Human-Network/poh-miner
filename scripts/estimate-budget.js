#!/usr/bin/env node
/**
 * Estimate the μPOH budget (bid) for a compute / chat job.
 *
 * Pricing model (see src/jobs/gas-estimator.js):
 *   cost   = tokens × gasPrice        gasPrice = 1 μPOH per AI token (1 POH = 1e9 tokens)
 *   promptTokens ≈ ceil((chars + 4·messages) / 4)   ← the node's tokenizer-free estimate
 *   estTokens    = promptTokens + min(maxOutputTokens, OUTPUT_CAP=2048)
 *   budget (bid) = estTokens × gasPrice
 *
 * No-refund: the WHOLE bid is charged, and generation is capped at
 *   outputTokens ≤ floor(budget / gasPrice) − promptTokens
 * so if your bid only covers the prompt you get ~0 output tokens back.
 *
 * Usage:
 *   node scripts/estimate-budget.js "your prompt here" [maxOutputTokens] [gasPrice]
 *   PROMPT='…' OUT=512 GASPRICE=1 node scripts/estimate-budget.js
 *   BUDGET=10000 node scripts/estimate-budget.js "…"   # reverse: tokens a bid buys
 */
import { GAS, estimateChatTokens, outputTokenCap } from '../src/jobs/gas-estimator.js';

const prompt   = process.argv[2] || process.env.PROMPT || 'In one sentence, what is proof of human?';
const maxOut   = parseInt(process.argv[3] || process.env.OUT || '512', 10);
const gasPrice = parseInt(process.argv[4] || process.env.GASPRICE || String(GAS.DEFAULT_GAS_PRICE), 10);

// Same estimate the node uses (qvac estimatePromptTokens): ~4 chars/token + 4 chars/message.
const promptTokens = Math.ceil((prompt.length + 4) / 4);
const estTokens    = estimateChatTokens(promptTokens, maxOut);   // prompt + min(out, 2048)
const budget       = estTokens * gasPrice;
const floor        = promptTokens * gasPrice;                     // min accepted (0 output)
const poh = (u) => (u / 1e9).toFixed(9) + ' POH';

console.log(`Prompt chars       : ${prompt.length}`);
console.log(`Prompt tokens (~)  : ${promptTokens}`);
console.log(`gasPrice           : ${gasPrice} μPOH/token`);
console.log(`Reserved output    : ${Math.min(maxOut, GAS.OUTPUT_CAP)} tokens (cap ${GAS.OUTPUT_CAP})`);
console.log('──────────────────────────────────────────────');
console.log(`Floor (min bid)    : ${floor} μPOH  (${poh(floor)})  → 0 output tokens`);
console.log(`Recommended bid    : ${budget} μPOH  (${poh(budget)})`);
console.log(`  buys up to       : ${outputTokenCap(budget, gasPrice, promptTokens)} output tokens`);
console.log('──────────────────────────────────────────────');

if (process.env.BUDGET) {
  const b = parseInt(process.env.BUDGET, 10);
  const out = outputTokenCap(b, gasPrice, promptTokens);
  console.log(`Reverse: BUDGET=${b} μPOH (${poh(b)}) → up to ${out} output tokens` +
    (out === 0 ? '  ⚠ below prompt cost — reply will be empty' : ''));
}
