// System wallet address that holds escrowed POH during active P2P trades.
// Funds flow: maker/taker → ESCROW_ADDRESS on lock, ESCROW_ADDRESS → recipient on release.
export const ESCROW_ADDRESS = 'poh_p2p_escrow';

export class EscrowManager {
  // Lock `amount` μPOH from `fromAddress` into escrow.
  // Returns true on success, or { error } string on failure.
  lock(walletManager, fromAddress, amount) {
    const balance = walletManager.getBalance(fromAddress);
    if (balance < amount) {
      return { error: `insufficient balance: have ${balance} μPOH, need ${amount} μPOH` };
    }
    walletManager.debit(fromAddress, amount);
    walletManager.credit(ESCROW_ADDRESS, amount);
    return true;
  }

  // Release `amount` μPOH from escrow to `toAddress`.
  release(walletManager, toAddress, amount) {
    const escrowBal = walletManager.getBalance(ESCROW_ADDRESS);
    if (escrowBal < amount) {
      return { error: `escrow insufficient: have ${escrowBal} μPOH, need ${amount} μPOH` };
    }
    walletManager.debit(ESCROW_ADDRESS, amount);
    walletManager.credit(toAddress, amount);
    return true;
  }
}
