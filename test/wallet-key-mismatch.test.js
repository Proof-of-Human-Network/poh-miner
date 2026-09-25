import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A wallets dir routinely holds wallets sealed under two secrets: the auto-generated
// ~/.dai-miner/.wallet-key (CLI, genesis tools, older builds) and DAI_WALLET_KEY
// (Electron onboarding's backup key). Whichever process runs next must open both —
// otherwise a keyed wallet reads as a stub and the miner mints a new identity.
describe('wallets sealed under a different key than the one in use', () => {
  const realHome = process.env.HOME;
  const realKey = process.env.DAI_WALLET_KEY;
  let home, WalletManager, Wallet, crypto;

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'walkey-'));
    process.env.HOME = home;
    delete process.env.DAI_WALLET_KEY;
    vi.resetModules();
    ({ WalletManager, Wallet } = await import('../src/wallet/wallet.js'));
    crypto = await import('../src/security/wallet-crypto.js');
  });

  afterAll(() => {
    process.env.HOME = realHome;
    if (realKey === undefined) delete process.env.DAI_WALLET_KEY; else process.env.DAI_WALLET_KEY = realKey;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('opens both .wallet-key and DAI_WALLET_KEY wallets when the backup key is set', () => {
    const wm = new WalletManager(path.join(home, 'wallets'));

    const a = Wallet.generate();               // sealed under .wallet-key
    wm.saveWallet(a);

    process.env.DAI_WALLET_KEY = 'backup-key-from-onboarding';
    crypto.resetKeyCache();
    const b = Wallet.generate();               // sealed under the backup key
    wm.saveWallet(b);

    expect(wm.loadWallet(a.address).signingPrivateKey).toBe(a.signingPrivateKey);
    expect(wm.loadWallet(b.address).signingPrivateKey).toBe(b.signingPrivateKey);

    delete process.env.DAI_WALLET_KEY;
    crypto.resetKeyCache();
    // Env key gone: the file-key wallet still opens. The backup-key wallet cannot —
    // that secret lives nowhere on disk — but its ciphertext must stay intact.
    expect(wm.loadWallet(a.address).signingPrivateKey).toBe(a.signingPrivateKey);
    expect(wm.loadWallet(b.address).signingPrivateKey).toBeNull();
    expect(wm.hasSealedKey(b.address)).toBe(true);
  });

  it('never drops sealed key blobs when a wallet that cannot be opened is saved', () => {
    const wm = new WalletManager(path.join(home, 'wallets2'));
    const w = Wallet.generate();
    process.env.DAI_WALLET_KEY = 'some-other-secret-entirely';
    crypto.resetKeyCache();
    wm.saveWallet(w);
    const file = path.join(home, 'wallets2', `${w.address}.json`);
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));

    // Simulate a process holding neither the sealing key nor the file key.
    const stub = new Wallet({ ...w.toJSON(), privateKey: null, signingPrivateKey: null });
    stub.balance = 5;
    wm.saveWallet(stub);

    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(after.signingPrivateKeyEnc).toEqual(before.signingPrivateKeyEnc);
    expect(after.privateKeyEnc).toEqual(before.privateKeyEnc);
    expect(after.balance).toBe(5);
    expect(wm.hasSealedKey(w.address)).toBe(true);
    delete process.env.DAI_WALLET_KEY;
    crypto.resetKeyCache();
  });
});
