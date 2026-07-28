// Per-currency price per AI token, in RAW units of that currency. POH: 1 μPOH
// per token (unchanged, μPOH is the floor unit). Stablecoin defaults are derived
// from their fx rate under a placeholder 1 POH ≈ $1 assumption — they come out
// fractional, so fees floor at 1 raw unit (0.01) via feeFor(). Node operators
// can override any entry with config.gasPrices = { aiGEL: <number>, ... }.
// NOT consensus: the accepting miner enforces its own floor; settlement pays
// whatever was escrowed in exactly the currency paid.
export const GAS_PRICES = {
  POH:   1,          // μPOH / token
  aiGEL: 2.7e-7,     // raw (0.01 GEL) units / token
  aiKGS: 8.7e-6,
  aiAMD: 3.85e-5,
  aiETB: 1.28e-5,
  aiBTN: 8.4e-6,
};

/** Effective per-token gas price for a currency, honouring config.gasPrices overrides. */
export function gasPriceFor(currency = 'POH', config = {}) {
  const cur = (!currency || currency === 'POH') ? 'POH' : currency;
  const o = config && config.gasPrices;
  if (o && typeof o[cur] === 'number' && o[cur] > 0) return o[cur];
  return GAS_PRICES[cur] ?? GAS_PRICES.POH;
}

/** Minimum acceptable fee for a token count in a currency (floors at 1 raw unit). */
export function feeFor(tokens, currency = 'POH', config = {}) {
  return Math.max(1, Math.ceil(Math.max(0, tokens) * gasPriceFor(currency, config)));
}

export const GAS = {
  BASE_TOKENS:         400,
  TOKENS_PER_SIGNAL:    60,
  TOKENS_PER_CHAIN:    120,
  OUTPUT_TOKENS:       350,
  OUTPUT_CAP:         2048,       // default ceiling on reserved output tokens for a chat estimate
  DEFAULT_GAS_PRICE:   1,          // μPOH per AI compute token (1 POH = 1e9 tokens).
                                   // μPOH is the smallest unit, so this is the price floor.
  TIMEOUT_RESERVE_PCT: 0.05,      // 5% of maxBudget kept on timeout

  // Hard ceilings on how far a big budget can stretch the OUTPUT length. Spare
  // uPOH buys more output tokens (see outputTokenCap) — but only up to here.
  // Two reasons it must be bounded, not "budget ÷ price" unbounded:
  //   1. Context window: total tokens (prompt + output) can't exceed the model's
  //      ctx (QVAC_CTX_SIZE, default 8192). Overshooting truncates or corrupts.
  //   2. Quality: small instruct models (qwen3-0.6b..8b) stay coherent for a
  //      bounded reply and then degrade into repetition/rambling if pushed to
  //      keep generating. Past OUTPUT_HARD_MAX a longer cap buys worse output,
  //      not more value — so extra budget becomes queue priority only.
  CONTEXT_TOKENS:     8192,       // must match QVAC_CTX_SIZE in qvac-models.js
  CONTEXT_MARGIN:      256,       // headroom so we never brush the ctx limit
  OUTPUT_HARD_MAX:    4096,       // quality ceiling on generated output tokens
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
//
// Spare uPOH stretches this cap, but it is bounded by the context window and a
// quality ceiling (GAS.OUTPUT_HARD_MAX): beyond that a longer cap only degrades
// the reply, so extra budget buys queue priority, not more tokens. The requester
// still pays the full bid (no refund) — this only bounds generation length.
export function outputTokenCap(maxBudget, gasPrice = GAS.DEFAULT_GAS_PRICE, promptTokens = 0) {
  const prompt = Math.max(0, Math.round(promptTokens));
  // gasPrice may be fractional (stablecoin raw units per token) — guard against
  // zero/negative only; flooring fractional prices to 1 would understate the cap.
  const price = (typeof gasPrice === 'number' && gasPrice > 0) ? gasPrice : GAS.DEFAULT_GAS_PRICE;
  const budgetTokens = Math.floor(maxBudget / price) - prompt;
  const contextTokens = GAS.CONTEXT_TOKENS - GAS.CONTEXT_MARGIN - prompt;
  return Math.max(0, Math.min(budgetTokens, contextTokens, GAS.OUTPUT_HARD_MAX));
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
