import { describe, it, expect } from 'vitest';
import { Wallet } from '../src/wallet/wallet.js';

describe('Wallet', () => {
  it('should generate a valid wallet with poh address', () => {
    const wallet = Wallet.generate();
    
    expect(wallet.address).toMatch(/^poh[a-f0-9]{40}$/);
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
});