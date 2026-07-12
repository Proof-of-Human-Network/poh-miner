import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isLocalRequest, rejectNonLocalStateChange, isPublicPostPath } from '../src/security/api-security.js';
import { normalizeSkillId } from '../src/security/skill-id.js';
import { skillsManager } from '../src/skills/manager.js';
import { validateCoinbase } from '../src/consensus/coinbase-validator.js';
import { BLOCK_REWARD_UPOH } from '../src/rewards/reward.js';
import {
  verifyBrainEvent,
  verifyIpfsUpdate,
  verifyPeerRegistration,
  buildPeerRegistrationMessage,
  isPublicPeerHost,
} from '../src/security/bootnode-auth.js';
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

  it('rejects IPFS update when wallet does not match signing key', () => {
    const wallet = Wallet.generate();
    const ts = Date.now();
    const payload = { chain: 'QmTest', minerWallet: 'pohdeadbeef', ts };
    const signature = wallet.sign(JSON.stringify(payload));
    const result = verifyIpfsUpdate({
      ...payload,
      signature,
      signingPublicKey: wallet.signingPublicKey,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects peer registration with mismatched wallet', () => {
    const wallet = Wallet.generate();
    const ts = Date.now();
    const peerInfo = {
      wallet: 'pohnotreal',
      host: 'miner.example.com',
      timestamp: ts,
      walletApiPort: 3456,
      p2pPort: null,
      methodsHash: 'abc',
      signingPublicKey: wallet.signingPublicKey,
      signature: wallet.sign(buildPeerRegistrationMessage({
        wallet: 'pohnotreal',
        host: 'miner.example.com',
        timestamp: ts,
        walletApiPort: 3456,
        p2pPort: null,
        methodsHash: 'abc',
      })),
    };
    expect(verifyPeerRegistration(peerInfo).ok).toBe(false);
  });

  it('rejects peer registration when ports are tampered after signing', () => {
    const wallet = Wallet.generate();
    const ts = Date.now();
    const signed = {
      wallet: wallet.address,
      host: 'miner.example.com',
      timestamp: ts,
      walletApiPort: 3456,
      p2pPort: null,
      methodsHash: 'abc',
    };
    const peerInfo = {
      ...signed,
      walletApiPort: 9999,
      signingPublicKey: wallet.signingPublicKey,
      signature: wallet.sign(buildPeerRegistrationMessage(signed)),
    };
    expect(verifyPeerRegistration(peerInfo).ok).toBe(false);
  });

  it('accepts valid peer registration with bound wallet and signed ports', () => {
    const wallet = Wallet.generate();
    const ts = Date.now();
    const peerInfo = {
      wallet: wallet.address,
      host: 'miner.example.com',
      timestamp: ts,
      walletApiPort: 3456,
      p2pPort: 4001,
      methodsHash: 'abc',
      signingPublicKey: wallet.signingPublicKey,
      signature: wallet.sign(buildPeerRegistrationMessage({
        wallet: wallet.address,
        host: 'miner.example.com',
        timestamp: ts,
        walletApiPort: 3456,
        p2pPort: 4001,
        methodsHash: 'abc',
      })),
    };
    expect(verifyPeerRegistration(peerInfo).ok).toBe(true);
  });

  it('rejects private hosts unless explicitly allowed', () => {
    expect(isPublicPeerHost('192.168.1.5')).toBe(false);
    expect(isPublicPeerHost('192.168.1.5', { allowLocal: true })).toBe(true);
    expect(isPublicPeerHost('miner.proofofhuman.ge')).toBe(true);
  });

  it('accepts a NAT follower registration (reachable:false) without a public host', () => {
    const wallet = Wallet.generate();
    const ts = Date.now();
    const signed = {
      wallet: wallet.address,
      host: 'localhost',        // not publicly reachable — allowed for a follower
      timestamp: ts,
      walletApiPort: 3456,
      p2pPort: null,
      methodsHash: 'abc',
      reachable: false,
    };
    const peerInfo = {
      ...signed,
      signingPublicKey: wallet.signingPublicKey,
      signature: wallet.sign(buildPeerRegistrationMessage(signed)),
    };
    const res = verifyPeerRegistration(peerInfo);
    expect(res.ok).toBe(true);
    expect(res.reachable).toBe(false);
  });

  it('still rejects a non-public host when the node claims to be reachable', () => {
    const wallet = Wallet.generate();
    const ts = Date.now();
    const signed = {
      wallet: wallet.address,
      host: 'localhost',
      timestamp: ts,
      walletApiPort: 3456,
      p2pPort: null,
      methodsHash: 'abc',
      // reachable omitted → defaults to true (legacy public-peer path)
    };
    const peerInfo = {
      ...signed,
      signingPublicKey: wallet.signingPublicKey,
      signature: wallet.sign(buildPeerRegistrationMessage(signed)),
    };
    const res = verifyPeerRegistration(peerInfo);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/publicly reachable/);
  });

  it('cannot forge reachable:false — signature is bound to the flag', () => {
    const wallet = Wallet.generate();
    const ts = Date.now();
    // Sign as a PUBLIC peer (legacy message, no reachable field)...
    const signedPublic = {
      wallet: wallet.address,
      host: 'localhost',
      timestamp: ts,
      walletApiPort: 3456,
      p2pPort: null,
      methodsHash: 'abc',
    };
    // ...then tamper the payload to claim follower status. The bootnode rebuilds
    // the message WITH reachable:false, so the signature no longer verifies.
    const peerInfo = {
      ...signedPublic,
      reachable: false,
      signingPublicKey: wallet.signingPublicKey,
      signature: wallet.sign(buildPeerRegistrationMessage(signedPublic)),
    };
    expect(verifyPeerRegistration(peerInfo).ok).toBe(false);
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