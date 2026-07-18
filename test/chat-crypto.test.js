import { describe, it, expect } from 'vitest';
import { deriveEncryptionKeypair, seal, open, sealJSON, openJSON, isEnvelope } from '../src/security/chat-crypto.js';

describe('chat-crypto (public-job encryption)', () => {
  const kp = deriveEncryptionKeypair('wallet-signing-private-key-pem');

  it('derives a deterministic 32-byte X25519 keypair from a stable secret', () => {
    const again = deriveEncryptionKeypair('wallet-signing-private-key-pem');
    expect(kp.publicKeyB64).toBe(again.publicKeyB64);
    expect(Buffer.from(kp.publicKeyB64, 'base64')).toHaveLength(32);
    expect(Buffer.from(kp.privateKeyB64, 'base64')).toHaveLength(32);
    // A different secret yields a different key.
    expect(deriveEncryptionKeypair('other').publicKeyB64).not.toBe(kp.publicKeyB64);
  });

  it('seals and opens a round-trip', () => {
    const env = seal(kp.publicKeyB64, 'what is the capital of Georgia?');
    expect(isEnvelope(env)).toBe(true);
    expect(env.alg).toBe('x25519-hkdf-sha256-aes256gcm');
    expect(open(env, kp.privateKeyB64)).toBe('what is the capital of Georgia?');
  });

  it('produces a fresh ephemeral key each time (nondeterministic ciphertext)', () => {
    const a = seal(kp.publicKeyB64, 'same message');
    const b = seal(kp.publicKeyB64, 'same message');
    expect(a.ct).not.toBe(b.ct);
    expect(a.epk).not.toBe(b.epk);
    expect(open(a, kp.privateKeyB64)).toBe(open(b, kp.privateKeyB64));
  });

  it('the wrong private key cannot open (GCM tag fails)', () => {
    const other = deriveEncryptionKeypair('someone-else');
    const env = seal(kp.publicKeyB64, 'secret');
    expect(() => open(env, other.privateKeyB64)).toThrow();
  });

  it('rejects a tampered ciphertext', () => {
    const env = seal(kp.publicKeyB64, 'secret');
    const bytes = Buffer.from(env.ct, 'base64'); bytes[0] ^= 0xff;
    expect(() => open({ ...env, ct: bytes.toString('base64') }, kp.privateKeyB64)).toThrow();
  });

  it('sealJSON/openJSON round-trips structured content', () => {
    const env = sealJSON(kp.publicKeyB64, { prompt: 'hi', reply: 'hello', model: 'qwen3-1.7b' });
    expect(openJSON(env, kp.privateKeyB64)).toEqual({ prompt: 'hi', reply: 'hello', model: 'qwen3-1.7b' });
  });

  it('rejects a malformed recipient key', () => {
    expect(() => seal(Buffer.alloc(10).toString('base64'), 'x')).toThrow(/32 bytes/);
  });
});
