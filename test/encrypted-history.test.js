import { describe, it, expect } from 'vitest';
import { deriveEncryptionKeypair, seal } from '../src/security/chat-crypto.js';
import {
  buildWalletJobContext, jobToSearchDocument, buildAllSearchDocuments,
} from '../src/chain/chain-job-index.js';

// Simulate an encrypted public job as it would sit on-chain: the job-submitted
// transition carries promptCipher (no cleartext), the result carries replyCipher.
const REQ = 'pohreq1111111111111111111111111111111111';
const kp = deriveEncryptionKeypair('requester-signing-key');

function encryptedChain() {
  return [{
    height: 5,
    timestamp: 1000,
    stateTransitions: [{
      type: 'job-submitted', jobId: 'j1', jobType: 'compute', requesterAddress: REQ,
      maxBudget: 5000, promptPreview: null,
      promptCipher: seal(kp.publicKeyB64, 'what is my private question?'), encrypted: true,
      model: 'qwen3-1.7b', timestamp: 1000,
    }],
    scanResults: [{
      requestId: 'j1', verdict: 'COMPUTE_RESULT', minerWallet: 'pohminer',
      profile: { computeOutput: null, encrypted: true, replyCipher: seal(kp.publicKeyB64, 'the secret answer'), model: 'qwen3-1.7b' },
    }],
  }];
}

describe('encrypted public-job history', () => {
  it('the chain holds NO cleartext — public view (no key) sees only ciphertext', () => {
    const ctx = buildWalletJobContext(encryptedChain(), REQ, {});
    // No decryptKey → sealed turns are skipped, not leaked.
    expect(ctx.chatTurns).toHaveLength(0);
    const doc = jobToSearchDocument({ jobId: 'j1', requesterAddress: REQ,
      promptCipher: seal(kp.publicKeyB64, 'q'), profile: { replyCipher: seal(kp.publicKeyB64, 'a'), encrypted: true } });
    expect(doc).toBeNull(); // nothing indexable without the key
  });

  it('the owner (with key) decrypts their own history for context', () => {
    const ctx = buildWalletJobContext(encryptedChain(), REQ, { decryptKey: kp.privateKeyB64, chatTurnLimit: 8 });
    expect(ctx.chatTurns).toEqual([
      { role: 'user', content: 'what is my private question?', jobId: 'j1', fromChain: true },
      { role: 'assistant', content: 'the secret answer', jobId: 'j1', fromChain: true },
    ]);
    expect(ctx.latestSkillMemory?.output?.computeOutput).toBe('the secret answer');
  });

  it('owner-local search indexes decrypted content; public index does not', () => {
    const withKey = buildAllSearchDocuments(encryptedChain(), [], kp.privateKeyB64);
    expect(withKey).toHaveLength(1);
    expect(withKey[0].promptPreview).toBe('what is my private question?');
    expect(withKey[0].replyText).toBe('the secret answer');

    const publicIndex = buildAllSearchDocuments(encryptedChain(), []);
    expect(publicIndex).toHaveLength(0); // public node cannot index sealed content
  });

  it('a different wallet key cannot decrypt', () => {
    const other = deriveEncryptionKeypair('someone-else');
    const ctx = buildWalletJobContext(encryptedChain(), REQ, { decryptKey: other.privateKeyB64 });
    expect(ctx.chatTurns).toHaveLength(0); // wrong key → treated as unreadable, never throws
  });

  it('local (unencrypted) jobs still index in cleartext', () => {
    const chain = [{
      height: 1, timestamp: 1, stateTransitions: [{ type: 'job-submitted', jobId: 'loc', jobType: 'compute',
        requesterAddress: REQ, promptPreview: 'plain question', encrypted: false, timestamp: 1 }],
      scanResults: [{ requestId: 'loc', verdict: 'COMPUTE_RESULT', profile: { computeOutput: 'plain answer' } }],
    }];
    const docs = buildAllSearchDocuments(chain, []); // no key needed
    expect(docs[0].promptPreview).toBe('plain question');
    expect(docs[0].replyText).toBe('plain answer');
  });
});
