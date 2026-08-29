import { describe, it, expect } from 'vitest';
import { PairingRelay } from '../src/network/pairing-relay.js';

const T1 = 'a'.repeat(64);
const T2 = 'b'.repeat(64);

describe('PairingRelay topic validation', () => {
  it('rejects anything that is not 32 hex bytes', () => {
    const r = new PairingRelay();
    // The topic is the only thing protecting a session, so a short or
    // non-hex topic must never be accepted as a capability.
    for (const bad of ['', 'abc', 'z'.repeat(64), 'A'.repeat(64), null, 123]) {
      expect(r.publish(bad, 'browser', 'x').error).toBeTruthy();
    }
    expect(r.publish(T1, 'browser', 'x').ok).toBe(true);
  });
});

describe('PairingRelay message flow', () => {
  it('delivers a sealed payload from browser to signer and back', () => {
    const r = new PairingRelay();
    r.publish(T1, 'browser', 'sealed-request');
    const forSigner = r.poll(T1, 0, 'signer');   // signer excludes its own writes
    expect(forSigner.messages).toHaveLength(1);
    expect(forSigner.messages[0].payload).toBe('sealed-request');

    r.publish(T1, 'signer', 'sealed-signature');
    const forBrowser = r.poll(T1, 0, 'browser');
    expect(forBrowser.messages).toHaveLength(1);
    expect(forBrowser.messages[0].payload).toBe('sealed-signature');
  });

  it('only returns messages newer than the cursor', () => {
    const r = new PairingRelay();
    r.publish(T1, 'browser', 'one');
    const { seq } = r.publish(T1, 'browser', 'two');
    expect(r.poll(T1, seq).messages).toHaveLength(0);
    expect(r.poll(T1, seq - 1).messages).toHaveLength(1);
  });

  it('keeps topics isolated from each other', () => {
    const r = new PairingRelay();
    r.publish(T1, 'browser', 'secret-1');
    expect(r.poll(T2, 0).messages).toHaveLength(0);
  });

  it('forgets everything on close', () => {
    const r = new PairingRelay();
    r.publish(T1, 'browser', 'x');
    r.close(T1);
    expect(r.poll(T1, 0).messages).toHaveLength(0);
  });
});

describe('PairingRelay abuse resistance', () => {
  it('caps payload size', () => {
    const r = new PairingRelay({ MAX_PAYLOAD_BYTES: 100 });
    expect(r.publish(T1, 'browser', 'x'.repeat(101)).error).toBe('payload too large');
    expect(r.publish(T1, 'browser', 'x'.repeat(100)).ok).toBe(true);
  });

  it('caps messages per topic, dropping oldest', () => {
    const r = new PairingRelay({ MAX_MESSAGES: 3 });
    for (let i = 0; i < 10; i++) r.publish(T1, 'browser', `m${i}`);
    const { messages } = r.poll(T1, 0);
    expect(messages).toHaveLength(3);
    expect(messages.map(m => m.payload)).toEqual(['m7', 'm8', 'm9']);
  });

  it('refuses new topics at capacity instead of evicting live sessions', () => {
    // Evicting would let a flood break other people's pairings, which is worse
    // than refusing the new one.
    const r = new PairingRelay({ MAX_TOPICS: 2 });
    r.publish('1'.repeat(64), 'browser', 'a');
    r.publish('2'.repeat(64), 'browser', 'b');
    expect(r.publish('3'.repeat(64), 'browser', 'c').error).toBe('relay at capacity');
    expect(r.poll('1'.repeat(64), 0).messages).toHaveLength(1); // survivor intact
  });

  it('rejects an unknown sender side', () => {
    const r = new PairingRelay();
    expect(r.publish(T1, 'attacker', 'x').error).toBeTruthy();
  });

  it('expires idle topics', async () => {
    const r = new PairingRelay({ TTL_MS: 20 });
    r.publish(T1, 'browser', 'x');
    await new Promise(res => setTimeout(res, 40));
    expect(r.poll(T1, 0).messages).toHaveLength(0);
    expect(r.stats().topics).toBe(0);
  });
});

describe('PairingRelay long-poll', () => {
  it('returns immediately when a message is already waiting', async () => {
    const r = new PairingRelay();
    r.publish(T1, 'browser', 'ready');
    const t0 = Date.now();
    const res = await r.wait(T1, 0, 5000, 'signer');
    expect(res.messages).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('wakes as soon as the other side publishes', async () => {
    const r = new PairingRelay();
    const pending = r.wait(T1, 0, 5000, 'signer');
    setTimeout(() => r.publish(T1, 'browser', 'late'), 50);
    const res = await pending;
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0].payload).toBe('late');
  });

  it('gives up after the wait window rather than hanging', async () => {
    const r = new PairingRelay();
    const res = await r.wait(T1, 0, 60, 'signer');
    expect(res.messages).toHaveLength(0);
  });

  it('never waits longer than MAX_WAIT_MS even if asked to', async () => {
    const r = new PairingRelay({ MAX_WAIT_MS: 50 });
    const t0 = Date.now();
    await r.wait(T1, 0, 60000, 'signer');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
