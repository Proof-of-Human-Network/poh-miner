import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isLocalRequest, rejectNonLocalStateChange, isPublicPostPath } from '../src/security/api-security.js';
import { normalizeSkillId } from '../src/security/skill-id.js';
import { skillsManager } from '../src/skills/manager.js';
import { validateCoinbase } from '../src/consensus/coinbase-validator.js';
import { BLOCK_REWARD_UPOH } from '../src/rewards/reward.js';
import { verifyBrainEvent, verifyIpfsUpdate } from '../src/security/bootnode-auth.js';
import { Wallet } from '../src/wallet/wallet.js';
import { sealWalletData, unsealWalletData } from '../src/security/wallet-crypto.js';
import { validateBlockChain } from '../src/consensus/block-validator.js';
import { PohBlock } from '../src/core/block.js';

describe('API security', () => {
  it('treats loopback addresses as local', () => {
    expect(isLocalRequest({ socket: { remoteAddress: '127.0.0.1' } })).toBe(true);
    expect(isLocalRequest({ socket: { remoteAddress: '10.0.0.5' } })).toBe(false);
  });

  it('allows /gossip from remote but blocks wallet mutations', () => {
    expect(isPublicPostPath('/gossip')).toBe(true);
    const res = { statusCode: 200, end: () => {} };
    const remotePost = { method: 'POST', socket: { remoteAddress: '8.8.8.8' } };
    const blocked = rejectNonLocalStateChange(remotePost, res, '/api/tx/submit');
    expect(blocked).toBe(true);
    expect(res.statusCode).toBe(403);
    res.statusCode = 200;
    const gossipAllowed = rejectNonLocalStateChange(remotePost, res, '/gossip');
    expect(gossipAllowed).toBe(false);
  });
});

describe('Skill ID validation', () => {
  it('accepts safe ids and rejects traversal attempts', () => {
    expect(normalizeSkillId('web_search')).toBe('web_search');
    expect(normalizeSkillId('../evil')).toBeNull();
    expect(normalizeSkillId('a/b')).toBeNull();
  });
});

describe('Network skill execution guard', () => {
  it('refuses to run network-sourced skill code', async () => {
    skillsManager.processTransition({
      type: 'skill-proposed',
      manifest: { id: 'evil_skill_test', version: '1.0.0' },
      code: 'exports.run = async () => ({ hacked: true })',
      networkSourced: true,
      trusted: false,
    });
    await expect(
      skillsManager.runSkill('evil_skill_test', {}, {})
    ).rejects.toThrow(/network-delivered code/i);
    skillsManager._skills.delete('evil_skill_test');
  });
});

describe('Coinbase validation', () => {
  it('rejects inflated proposer reward', () => {
    const block = new PohBlock({
      height: 1,
      previousHash: '0'.repeat(64),
      timestamp: Date.now(),
      minerWallet: 'pohabc',
      coinbaseReward: {
        totalNewSupply: BLOCK_REWARD_UPOH,
        proposerReward: BLOCK_REWARD_UPOH * 2,
        workerRewards: [],
      },
    });
    const check = validateCoinbase(block);
    expect(check.valid).toBe(false);
  });

  it('accepts valid empty-block coinbase', () => {
    const block = new PohBlock({
      height: 1,
      previousHash: '0'.repeat(64),
      timestamp: Date.now(),
      minerWallet: 'pohabc',
      coinbaseReward: {
        totalNewSupply: BLOCK_REWARD_UPOH,
        proposerReward: BLOCK_REWARD_UPOH,
        workerRewards: [],
      },
    });
    expect(validateCoinbase(block).valid).toBe(true);
  });
});

describe('Bootnode auth', () => {
  it('rejects unsigned IPFS update', () => {
    const result = verifyIpfsUpdate({ minerWallet: 'pohabc', chain: 'QmTest', ts: Date.now() });
    expect(result.ok).toBe(false);
  });

  it('accepts signed IPFS update with valid miner signature', () => {
    const wallet = Wallet.generate();
    const ts = Date.now();
    const payload = { chain: 'QmTest', minerWallet: wallet.address, ts };
    const signature = wallet.sign(JSON.stringify(payload));
    const result = verifyIpfsUpdate({
      ...payload,
      signature,
      signingPublicKey: wallet.signingPublicKey,
    });
    expect(result.ok).toBe(true);
  });
});

describe('Wallet encryption', () => {
  it('auto-creates a machine-local key file', async () => {
    const { default: fs } = await import('fs');
    const { default: os } = await import('os');
    const { default: path } = await import('path');
    const keyPath = path.join(os.homedir(), '.poh-miner', '.wallet-key');
    const wallet = Wallet.generate();
    const { sealWalletData } = await import('../src/security/wallet-crypto.js');
    sealWalletData(wallet.toJSON());
    expect(fs.existsSync(keyPath)).toBe(true);
  });

  it('round-trips sealed wallet secrets', () => {
    const wallet = Wallet.generate();
    const sealed = sealWalletData(wallet.toJSON());
    expect(sealed.encrypted).toBe(true);
    expect(sealed.privateKey).toBeUndefined();
    const restored = unsealWalletData(sealed);
    expect(restored.privateKey).toBe(wallet.privateKey);
    expect(restored.signingPrivateKey).toBe(wallet.signingPrivateKey);
  });

  it('loads legacy plaintext wallet files', () => {
    const wallet = Wallet.generate();
    const plain = wallet.toJSON();
    const restored = unsealWalletData(plain);
    expect(restored.privateKey).toBe(wallet.privateKey);
  });
});

describe('IPFS chain validation', () => {
  it('rejects chain segment without valid PoW', () => {
    const genesis = new PohBlock({
      height: 0,
      previousHash: '0'.repeat(64),
      timestamp: Date.now(),
      minerWallet: 'genesis',
      difficulty: 5,
      chainWork: '20',
    });
    genesis.blockHash = genesis.getHashSync();
    const fake = new PohBlock({
      height: 1,
      previousHash: genesis.blockHash,
      timestamp: Date.now() + 1000,
      minerWallet: 'attacker',
      difficulty: 5,
      nonce: 0,
      coinbaseReward: {
        totalNewSupply: BLOCK_REWARD_UPOH,
        proposerReward: BLOCK_REWARD_UPOH,
        workerRewards: [],
      },
    });
    fake.meetsDifficultySync = () => true;
    const check = validateBlockChain([fake], [genesis]);
    expect(check.valid).toBe(false);
  });
});