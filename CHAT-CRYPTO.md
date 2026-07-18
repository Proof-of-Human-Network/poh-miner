# Public-job chat encryption — wire format

Public compute jobs are raced by miners the requester doesn't control, so the
**on-chain** record of the prompt and reply must be unreadable to everyone except the
requester. This document specifies the byte format so the **node, SDK, Electron app and
mobile wallet** all interoperate.

Reference implementation: [`src/security/chat-crypto.js`](src/security/chat-crypto.js).

## Model (recap)

| Job mode | On-chain | Who can read |
|----------|----------|--------------|
| `local` / `private` (own node) | cleartext | owner (searchable) |
| `public` (raced by the network) | **sealed** | owner only; racing miners see the prompt transiently in-flight |

Metadata (requester, miner, timing, tokens, fee, model) is public by design.

## Keys

Each wallet has an **X25519 encryption subkey** alongside its Ed25519 signing key.

- **Derivation (deterministic):** `scalar = HKDF-SHA256(ikm = <wallet signing secret>, salt = "", info = "poh-x25519-v1", len = 32)`. The node derives `ikm` from the wallet's Ed25519 signing private key; a mnemonic-based wallet may derive it from its seed instead — interop depends only on the *published public key*, not on how it was derived.
- **Public key:** the raw 32-byte X25519 point, base64. Published via `POST /api/wallet/register-key` as `encryptionPublicKey`.

## Envelope (ECIES: X25519 → HKDF-SHA256 → AES-256-GCM)

`seal(recipientPubB64, plaintext) → envelope`:

1. Generate an ephemeral X25519 keypair `(esk, epk)`.
2. `shared = X25519(esk, recipientPub)` (32 bytes).
3. `key = HKDF-SHA256(ikm = shared, salt = recipientPub ‖ epk, info = "poh-chat-seal-v1", len = 32)`.
4. `iv = random(12)`.
5. `ct ‖ tag = AES-256-GCM(key, iv, plaintext)` (tag is the trailing 16 bytes).
6. Output:

```json
{
  "v": 1,
  "alg": "x25519-hkdf-sha256-aes256gcm",
  "epk": "<base64 raw 32-byte ephemeral public key>",
  "iv":  "<base64 12-byte IV>",
  "ct":  "<base64 (ciphertext ‖ 16-byte GCM tag)>"
}
```

`open(envelope, privateScalarB64) → plaintext` reverses it: recompute `shared = X25519(scalar, epk)`, the same HKDF, then AES-GCM decrypt (authentication via the tag).

All salts/info strings are ASCII. Base64 is standard (`+/=`).

## Where ciphers appear on-chain

- **`job-submitted` transition:** `{ promptPreview: null, promptCipher: <envelope>, encrypted: true }`.
- **Result `profile`:** `{ computeOutput: null, replyCipher: <envelope>, encrypted: true }`.

A public index that lacks the key skips these entirely (no plaintext leaks); the owner's
own node passes its X25519 private scalar to decrypt its history for local search/context.

## Client responsibilities

| Client | Must do |
|--------|---------|
| **Node** | done — derives key, registers it, seals on-chain, decrypts owner history |
| **SDK** | register `encryptionPublicKey`; set `visibility:'public'`; `open()` sealed replies from a remote node |
| **Electron** | uses local node (server-side decrypt); `window.pohMinerAPI.crypto.{seal,open}` for remote nodes |
| **Mobile wallet** | derive X25519 from seed, register key, `open()` sealed replies |

Recommended libs for the raw-key form (skip the RFC 8410 DER wrapping the node uses):
`@noble/curves/ed25519` (x25519) + `@noble/hashes/hkdf` + WebCrypto/`@noble/ciphers` AES-GCM.
