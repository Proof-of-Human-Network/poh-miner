export const GAS = {
  BASE_TOKENS:         400,
  TOKENS_PER_SIGNAL:    60,
  TOKENS_PER_CHAIN:    120,
  OUTPUT_TOKENS:       350,
  OUTPUT_CAP:         2048,       // default ceiling on reserved output tokens for a chat estimate
  DEFAULT_GAS_PRICE:   1,          // μPOH per AI compute token (1 POH = 1e9 tokens).
                                   // μPOH is the smallest unit, so this is the price floor.
  TIMEOUT_RESERVE_PCT: 0.05,      // 5% of maxBudget kept on timeout
};

export function detectChainCount(address) {
  if (!address) return 2;
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return 1;
  if (/^(1|3)[a-km-zA-HJ-NP-Z1-9]{24,33}$|^bc1[a-z0-9]{6,87}$/.test(address)) return 1;
  if (/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(address)) return 1;
  if (/^(EQ|UQ)[A-Za-z0-9+/=_-]{46}$/.test(address)) return 1;
  return 2; // unknown — assume EVM + Solana
}

export function estimateTokens(activeSignalCount, address) {
  const chains = detectChainCount(address);
  return GAS.BASE_TOKENS
    + activeSignalCount * GAS.TOKENS_PER_SIGNAL
    + chains            * GAS.TOKENS_PER_CHAIN
    + GAS.OUTPUT_TOKENS;
}

export function estimateFee(activeSignalCount, address, gasPrice = GAS.DEFAULT_GAS_PRICE) {
  return estimateTokens(activeSignalCount, address) * gasPrice;
}

// Freeform-chat / public-compute estimate. Unlike estimateTokens() (a heuristic
// tuned for verdict/scan jobs), this is the eth_estimateGas analog for chat: the
// prompt tokens actually measured, plus the output the caller reserved (capped).
// The result × gasPrice is the minimum budget a requester must escrow up front.
export function estimateChatTokens(promptTokens, maxOutputTokens, cap = GAS.OUTPUT_CAP) {
  const prompt = Math.max(0, Math.round(promptTokens || 0));
  const out    = Math.min(Math.max(0, Math.round(maxOutputTokens || 0)), cap);
  return prompt + out;
}

// No-refund policy: the escrowed bid IS the fee, so maxBudget doubles as the hard
// compute allowance. Given the tokens already spent on the prompt, this is how many
// OUTPUT tokens the job is still allowed to generate before it hits its budget.
// Generation must stop at this count (see qvac hardTokenCap) — there is no refund
// path and no over-charge path, so a job can never consume more than it paid for.
export function outputTokenCap(maxBudget, gasPrice = GAS.DEFAULT_GAS_PRICE, promptTokens = 0) {
  const totalTokens = Math.floor(maxBudget / Math.max(1, gasPrice));
  return Math.max(0, totalTokens - Math.max(0, Math.round(promptTokens)));
}

// No-refund settlement. maxBudget is the requester's signed bid, and the whole bid
// is taken as the fee — overpaying buys queue priority (see the fee-race in
// job-board.js), never a rebate. The floor still holds two ways: the accept-time
// gate rejects any bid below the job's token cost, and generation is capped at
// outputTokenCap(maxBudget), so `cost` can never exceed maxBudget in practice
// (`underfunded` is surfaced only as a diagnostic).
export function settleFee(actualTokens, gasPrice, maxBudget) {
  const cost = Math.max(0, Math.round(actualTokens * gasPrice)); // tokens actually consumed
  return { fee: maxBudget, refund: 0, cost, underfunded: cost > maxBudget };
}

export function timeoutFee(maxBudget, pct = GAS.TIMEOUT_RESERVE_PCT) {
  const reservation = maxBudget * pct;
  return { reservation, refund: maxBudget - reservation };
}
