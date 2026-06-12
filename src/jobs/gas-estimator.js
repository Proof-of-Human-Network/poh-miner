export const GAS = {
  BASE_TOKENS:         400,
  TOKENS_PER_SIGNAL:    60,
  TOKENS_PER_CHAIN:    120,
  OUTPUT_TOKENS:       350,
  DEFAULT_GAS_PRICE:   0.000001,  // POH per token
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

export function settleFee(actualTokens, gasPrice, maxBudget) {
  const fee    = Math.min(actualTokens * gasPrice, maxBudget);
  const refund = maxBudget - fee;
  return { fee, refund };
}

export function timeoutFee(maxBudget, pct = GAS.TIMEOUT_RESERVE_PCT) {
  const reservation = maxBudget * pct;
  return { reservation, refund: maxBudget - reservation };
}
