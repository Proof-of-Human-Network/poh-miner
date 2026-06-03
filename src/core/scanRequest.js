/**
 * Scan Request & Result types for the PoH Miner Network
 *
 * When a user (via the App Layer) wants a verdict, they submit a ScanRequest.
 * Miners race to compute it using the existing POH checker + brain logic.
 * First valid result wins.
 */
import crypto from 'crypto';

export class ScanRequest {
  constructor({
    id,
    address,           // The wallet/address being scanned
    chains = [],       // ['evm', 'solana', 'bitcoin', ...] or auto-detect
    options = {},      // depth, includeBrain, etc.
    requesterWallet,   // Who pays the fee
    fee,               // Amount in POH (raw units)
    timestamp,
    signature,         // Signature proving the requester controls the wallet (optional for now)
  }) {
    this.id = id || `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.address = address;
    this.chains = chains;
    this.options = options;
    this.requesterWallet = requesterWallet;
    this.fee = fee;
    this.timestamp = timestamp || Date.now();
    this.signature = signature;
  }
}

export class ScanResult {
  constructor({
    requestId,
    address,
    verdict,           // 'HUMAN' | 'AI' | 'UNCERTAIN'
    confidence,
    reasoning,
    signalsUsed = [],  // Which methods/signals were evaluated (array of objects or ids)
    modelUsed,
    computationTimeMs,
    minerWallet,       // The miner who delivered this result first
    signature,         // Miner's signature over the result
    blockHeight,       // Which block this result was included in
    methodsHash,       // Hash of the verified signals set used for this computation (for consensus)
    methodsCount,
    realPohUsed = false,
    profile = null,    // Full POH profile returned by enrichProfile (required for valid work)
  }) {
    this.requestId = requestId;
    this.address = address;
    this.verdict = verdict;
    this.confidence = confidence;
    this.reasoning = reasoning;
    // Normalize: never store count as signalsUsed (validator/getResultHash expect array)
    let su = signalsUsed;
    if (typeof su === 'number' || su == null) su = [];
    else if (!Array.isArray(su)) su = [];
    this.signalsUsed = su;
    this.modelUsed = modelUsed;
    this.computationTimeMs = computationTimeMs;
    this.minerWallet = minerWallet;
    this.signature = signature;
    this.blockHeight = blockHeight;
    this.deliveredAt = Date.now();
    this.methodsHash = methodsHash;     // ← Used for network-wide signals consensus
    this.methodsCount = methodsCount;
    this.realPohUsed = realPohUsed;     // ← Indicates whether real POH checker/brain was used
    this.profile = profile || null;     // ← Required by validateResultWork for full POH output

    // Work quality flags (set by validator before block inclusion)
    this.isValidWork = false;
    this.validationErrors = [];
  }

  // Sign this result with the miner's identity wallet.
  // Called before the result is added to pendingValidResults.
  sign(identityWallet) {
    const { Wallet } = require('../wallet/wallet.js'); // CJS-safe dynamic require
    const hash = this.getResultHash();
    this.signature = identityWallet.sign(hash);
    this.signingPublicKey = identityWallet.signingPublicKey;
    return this;
  }

  // Verify the miner's signature. Returns true even if no signature is
  // present (backwards-compatible) unless strict=true.
  verify(strict = false) {
    if (!this.signature || !this.signingPublicKey) return !strict;
    try {
      const { Wallet } = require('../wallet/wallet.js');
      return Wallet.verifySignature(this.signingPublicKey, this.getResultHash(), this.signature);
    } catch { return false; }
  }

  /**
   * For verification: hash the deterministic parts of the result
   */
  getResultHash() {
    const su = Array.isArray(this.signalsUsed) ? this.signalsUsed : [];
    const data = JSON.stringify({
      requestId: this.requestId,
      address: this.address,
      verdict: this.verdict,
      confidence: this.confidence,
      reasoning: this.reasoning?.slice(0, 500),
      signalsUsed: su.map(s => s.methodId || s.id || s),
      methodsHash: this.methodsHash,
      isValidWork: this.isValidWork,
      realPohUsed: this.realPohUsed,
      profileFp: this.profile ? crypto.createHash('sha256').update(JSON.stringify(this.profile)).digest('hex').slice(0, 12) : null,
    });
    return 'sha256:' + Buffer.from(data).toString('base64').slice(0, 32);
  }
}
