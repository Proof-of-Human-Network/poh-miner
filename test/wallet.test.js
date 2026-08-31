import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Wallet, WalletManager } from '../src/wallet/wallet.js';
import { EscrowManager, ESCROW_ADDRESS } from '../src/p2p/escrow.js';

describe('Wallet', () => {
  it('should generate a valid wallet with dai address', () => {
    const wallet = Wallet.generate();
    
    expect(wallet.address).toMatch(/^dai[a-f0-9]{40}$/);
    expect(wallet.privateKey).toHaveLength(64);
    expect(wallet.publicKey).toHaveLength(64);
    expect(wallet.balance).toBe(0);
  });

  it('should serialize and deserialize correctly', () => {
    const original = Wallet.generate();
    const json = original.toJSON();
    const restored = Wallet.fromJSON(json);

    expect(restored.address).toBe(original.address);
    expect(restored.privateKey).toBe(original.privateKey);
    expect(restored.publicKey).toBe(original.publicKey);
  });

  it('derives a canonical address from a signing public key', () => {
    const wallet = Wallet.generate();
    const derived = Wallet.deriveAddressFromSigningKey(wallet.signingPublicKey);
    expect(derived).toMatch(/^dai[a-f0-9]{40}$/);
    expect(wallet.address).toBe(derived);
    expect(Wallet.isAddressBoundToSigningKey(wallet.address, wallet.signingPublicKey)).toBe(true);
  });
});

describe('balance-only stubs stay on their address', () => {
  it('does not migrate dai_p2p_escrow when the file is loaded', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escrow-stub-'));
    const wm = new WalletManager(dir);
    await wm.credit(ESCROW_ADDRESS, 20_000_000);
    await wm.credit(ESCROW_ADDRESS, 100, 'KGST');

    expect(wm.getBalance(ESCROW_ADDRESS)).toBe(20_000_000);
    expect(wm.getAssetBalance(ESCROW_ADDRESS, 'KGST')).toBe(100);
    expect(fs.existsSync(path.join(dir, `${ESCROW_ADDRESS}.json`))).toBe(true);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, `${ESCROW_ADDRESS}.json`), 'utf8'));
    expect(raw.address).toBe(ESCROW_ADDRESS);
    expect(raw.signingPublicKey).toBeFalsy();
  });

  it('releases a sell lock from the escrow stub to the taker', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escrow-rel-'));
    const wm = new WalletManager(dir);
    const maker = Wallet.generate();
    const taker = Wallet.generate();
    maker.balance = 50_000_000;
    wm.saveWallet(maker); wm.saveWallet(taker);
    const escrow = new EscrowManager();
    expect(escrow.lock(wm, maker.address, 10_000_000)).toBe(true);
    await wm._locks.get(ESCROW_ADDRESS);
    await wm._locks.get(maker.address);
    expect(wm.rawBalanceNonce(ESCROW_ADDRESS).balance).toBe(10_000_000);

    expect(escrow.release(wm, taker.address, 10_000_000)).toBe(true);
    await wm._locks.get(ESCROW_ADDRESS);
    await wm._locks.get(taker.address);
    expect(wm.getBalance(ESCROW_ADDRESS)).toBe(0);
    expect(wm.getBalance(taker.address)).toBe(10_000_000);
    expect(fs.existsSync(path.join(dir, `${ESCROW_ADDRESS}.json`))).toBe(true);
  });
});