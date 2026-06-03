/**
 * BalanceJournal — append-only log of every balance mutation.
 *
 * Used by the reorg engine to roll back wallet state when the canonical
 * chain switches to a different fork. Each entry records the block height
 * and direction so rollback can undo mutations in reverse order.
 *
 * Format of each entry:
 *   { height, address, delta, nonceDelta, txHash, ts }
 *
 * delta > 0  = credit  (reward or incoming tx)
 * delta < 0  = debit   (outgoing tx — stored as negative value)
 *
 * On reorg to height H: delete all entries with height > H, then reapply
 * the inverse of each deleted entry to the wallet files.
 */

import fs from 'fs';
import path from 'path';

const JOURNAL_FILE = 'balance_journal.jsonl';
const MAX_ENTRIES  = 50_000; // trim oldest when exceeded

export class BalanceJournal {
  constructor(dataDir, walletManager) {
    this.file = path.join(dataDir, JOURNAL_FILE);
    this.walletManager = walletManager;
    this._entries = [];
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
      this._entries = lines.map(l => JSON.parse(l));
    } catch { this._entries = []; }
  }

  _flush() {
    const lines = this._entries.slice(-MAX_ENTRIES).map(e => JSON.stringify(e)).join('\n');
    fs.writeFileSync(this.file, lines + (lines ? '\n' : ''));
  }

  // Record a balance change made while applying a block
  record(height, address, delta, nonceDelta = 0, txHash = null) {
    this._entries.push({ height, address, delta, nonceDelta, txHash, ts: Date.now() });
    // Append only (no full rewrite on every entry)
    fs.appendFileSync(this.file, JSON.stringify({ height, address, delta, nonceDelta, txHash, ts: Date.now() }) + '\n');
  }

  // Roll back all changes made at height > targetHeight.
  // Applies the inverse of each journal entry in reverse order.
  rollbackTo(targetHeight) {
    const toUndo = this._entries.filter(e => e.height > targetHeight).reverse();
    if (!toUndo.length) return 0;

    for (const entry of toUndo) {
      const wallet = this.walletManager.loadWallet(entry.address);
      if (!wallet) continue;
      wallet.balance = (wallet.balance || 0) - entry.delta;   // undo delta
      if (entry.nonceDelta) wallet.nonce = Math.max(0, (wallet.nonce || 0) - entry.nonceDelta);
      this.walletManager.saveWallet(wallet);
    }

    this._entries = this._entries.filter(e => e.height <= targetHeight);
    this._flush();
    return toUndo.length;
  }

  // Highest block height recorded in the journal
  get tipHeight() {
    return this._entries.length
      ? Math.max(...this._entries.map(e => e.height))
      : 0;
  }
}
