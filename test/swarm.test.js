import { describe, it, expect, afterAll } from 'vitest';
import createTestnet from 'hyperdht/testnet.js';
import { DAISwarm, deriveSwarmSeed, deriveTopic } from '../src/network/swarm.js';

/**
 * These run against an in-process DHT, so they exercise the real hole-punching
 * stack without touching the public network.
 */
describe('DAISwarm key derivation', () => {
  it('derives a stable seed from the signing key and never returns the key itself', () => {
    const key = 'SOME-ED25519-PRIVATE-KEY-PEM';
    const a = deriveSwarmSeed(key);
    const b = deriveSwarmSeed(key);
    expect(a).toEqual(b);                       // same node → same swarm identity across restarts
    expect(a.length).toBe(32);
    expect(a.toString('utf8')).not.toContain('ED25519');  // domain-separated, not the raw key
  });

  it('gives different nodes different identities', () => {
    expect(deriveSwarmSeed('node-a')).not.toEqual(deriveSwarmSeed('node-b'));
  });

  it('returns null without a signing key rather than a predictable seed', () => {
    expect(deriveSwarmSeed(null)).toBeNull();
  });

  it('separates networks by topic so testnets cannot meet mainnet', () => {
    expect(deriveTopic('dai-mainnet')).not.toEqual(deriveTopic('dai-testnet'));
    expect(deriveTopic('dai-mainnet').length).toBe(32);
  });
});

describe('DAISwarm transport', () => {
  let testnet, a, b;

  afterAll(async () => {
    await a?.destroy();
    await b?.destroy();
    await testnet?.destroy();
  });

  it('connects two nodes and delivers gossip with no bootnode in the path', async () => {
    testnet = await createTestnet(3);
    const received = [];

    a = new DAISwarm({ signingPrivateKey: 'KEY-A', networkId: 'test-net', bootstrap: testnet.bootstrap });
    b = new DAISwarm({
      signingPrivateKey: 'KEY-B', networkId: 'test-net', bootstrap: testnet.bootstrap,
      onEnvelope: (env) => received.push(env),
    });

    await a.start();
    await b.start();

    const deadline = Date.now() + 30000;
    while (a.peerCount === 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
    expect(a.peerCount).toBeGreaterThan(0);

    const envelope = { id: 'env-1', topic: 'p2p-trade', message: { hello: 'world' }, from: 'daiAAA' };
    expect(a.broadcast(envelope)).toBeGreaterThan(0);

    const d2 = Date.now() + 10000;
    while (received.length === 0 && Date.now() < d2) {
      await new Promise(r => setTimeout(r, 50));
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(envelope);
  }, 60000);

  it('reassembles a message larger than one stream chunk', async () => {
    const received = [];
    b.onEnvelope = (env) => received.push(env);

    // Comfortably past a single TCP/UDX read, so this only passes if the
    // length-prefixed reader is reassembling frames rather than assuming
    // one read == one message.
    const big = { id: 'env-big', topic: 'chain', message: { blob: 'x'.repeat(500_000) }, from: 'daiAAA' };
    a.broadcast(big);

    const deadline = Date.now() + 15000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
    }
    expect(received).toHaveLength(1);
    expect(received[0].message.blob.length).toBe(500_000);
  }, 30000);
});
