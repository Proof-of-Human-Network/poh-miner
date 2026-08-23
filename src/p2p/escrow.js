// System wallet address that holds escrowed assets during active P2P trades.
// Funds flow: maker/taker → ESCROW_ADDRESS on lock, ESCROW_ADDRESS → recipient on release.
// The pooled pseudo-address holds per-asset balances (DAI + stablecoins) — the
// multi-asset WalletManager routes each currency independently.
export const ESCROW_ADDRESS = 'dai_p2p_escrow';

export class EscrowManager {
  // Lock `amount` raw units of `currency` from `fromAddress` into escrow.
  // Returns true on success, or { error } string on failure.
  lock(walletManager, fromAddress, amount, currency = 'DAI') {
    const balance = currency === 'DAI'
      ? walletManager.getBalance(fromAddress)
      : walletManager.getAssetBalance(fromAddress, currency);
    if (balance < amount) {
      return { error: `insufficient balance: have ${balance} ${currency}, need ${amount} ${currency}` };
    }
    walletManager.debit(fromAddress, amount, currency);
    walletManager.credit(ESCROW_ADDRESS, amount, currency);
    return true;
  }

  // Release `amount` raw units of `currency` from escrow to `toAddress`.
  release(walletManager, toAddress, amount, currency = 'DAI') {
    const escrowBal = currency === 'DAI'
      ? walletManager.getBalance(ESCROW_ADDRESS)
      : walletManager.getAssetBalance(ESCROW_ADDRESS, currency);
    if (escrowBal < amount) {
      return { error: `escrow insufficient: have ${escrowBal} ${currency}, need ${amount} ${currency}` };
    }
    walletManager.debit(ESCROW_ADDRESS, amount, currency);
    walletManager.credit(toAddress, amount, currency);
    return true;
  }
}
