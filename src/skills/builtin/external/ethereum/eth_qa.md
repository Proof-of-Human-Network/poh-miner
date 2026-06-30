---
id: eth_qa
version: 1.0.0
description: Pre-ship audit checklist for Ethereum dApps built with Scaffold-ETH 2. Give this to a separate reviewer agent (or fresh context) AFTER the build is complete. Use this skill whenever you are finalizing a dApp built with Scaffold-ETH 2. Distinct from eth_security/eth_audit (contract-level vulnerability review) — this is a whole-app pre-ship QA pass covering UX, metadata, RPC reliability, and branding, not contract code auditing.
triggers:
  - scaffold-eth audit
  - dapp pre-ship checklist
  - ethereum qa checklist
  - pre-ship review
  - final review dapp
  - ready to ship dapp
  - qa checklist scaffold-eth
  - finalize dapp
  - pre-launch checklist
---

## Context

# dApp QA — Pre-Ship Audit For Scaffold-ETH 2 Builds

## What You Probably Got Wrong

**"The app deployed, so we are done."** For SE2 builds, shipping includes UX correctness, metadata, RPC reliability, contract verification, and branding cleanup.

**"The flow is obvious."** If Connect, Network, Approve, and Action are not strictly one-at-a-time with proper pending states, users will make duplicate or failing transactions.

**"SE2 defaults are fine in production."** Default README/footer/title/favicon and default RPC fallbacks are template scaffolding, not production decisions.

**"Pass means no console errors."** QA pass/fail here is behavioral and user-facing: real wallet flow, mobile deep-link behavior, readable errors, and trust signals must be validated.

Give this to a fresh agent after the dApp is built. The reviewer should:

1. Read the source code (`app/`, `components/`, `contracts/`)
2. Open the app in a browser and click through every flow
3. Check every item below — report PASS/FAIL, don't fix

---

## 🚨 Critical: Wallet Flow — Button Not Text

Open the app with NO wallet connected.

- ❌ **FAIL:** Text saying "Connect your wallet to play" / "Please connect to continue" / any paragraph telling the user to connect
- ✅ **PASS:** A big, obvious Connect Wallet **button** is the primary UI element

**This is the most common AI agent mistake.** Every stock LLM writes a `<p>Please connect your wallet</p>` instead of rendering `<RainbowKitCustomConnectButton />`.

---

## 🚨 Critical: Four-State Button Flow

The app must show exactly ONE primary button at a time, progressing through:

```
1. Not connected  → Connect Wallet button
2. Wrong network  → Switch to [Chain] button
3. Needs approval → Approve button
4. Ready          → Action button (Stake/Deposit/Swap)
```

Check specifically:
- ❌ **FAIL:** Approve and Action buttons both visible simultaneously
- ❌ **FAIL:** No network check — app tries to work on wrong chain and fails silently
- ❌ **FAIL:** Main onchain CTA renders instead of a "Switch to [Chain]" button when the connected wallet is on the wrong network. SE-2's header `WrongNetworkDropdown` is **not sufficient** — the action button itself must become the switch CTA, or the user clicks Sign/Stake/Deposit on the wrong chain and eats a silent wagmi error.
- ❌ **FAIL:** User can click Approve, sign in wallet, come back, and click Approve again while tx is pending
- ✅ **PASS:** One button at a time. Approve button shows spinner, stays disabled until block confirms onchain. Then switches to the action button.
- ✅ **PASS:** Action button's render path branches on `useChainId() === targetNetwork.id` (or equivalent); mismatch renders a `useSwitchChain`-driven "Switch to [Chain]" button in the **same slot** as the primary CTA.

**In the code:** the button's `disabled` prop must be tied to `isPending` from `useScaffoldWriteContract`. Verify it uses `useScaffoldWriteContract` (waits for block confirmation), NOT raw wagmi `useWriteContract` (resolves on wallet signature):

```
grep -rn "useWriteContract" packages/nextjs/
```
Any match outside scaffold-eth internals → bug.

**Watch out: two gaps, both allow double-approve.**

`isPending` from wagmi drops to `false` when the wallet returns the tx hash — not when the tx confirms. `writeContractAsync` is still awaiting confirmation. During that window `isPending = false` AND `approveCooldown = false` → button re-enables mid-flight.

Fix requires TWO states:
- `approvalSubmitting` — set at top of handler, cleared in `finally {}` (covers click→hash gap)
- `approveCooldown` — set after `await` resolves, cleared after 4s + refetch (covers confirm→cache gap)

```tsx
const [approvalSubmitting, setApprovalSubmitting] = useState(false);
const [approveCooldown, setApproveCooldown] = useState(false);

const handleApprove = async () => {
  if (approvalSubmitting || approveCooldown) return;
  setApprovalSubmitting(true);
  try {
    await approveWrite({ functionName: "approve", args: [spender, amount] });
    setApproveCooldown(true);
    setTimeout(() => { setApproveCooldown(false); refetchAllowance(); }, 4000);
  } catch (e) {
    notifyError("Approval failed");
  } finally {
    setApprovalSubmitting(false); // must be finally — releases on rejection too
  }
};

<button disabled={isPending || approvalSubmitting || approveCooldown}>
```

- ❌ **FAIL:** Button `disabled` only reads `isPending` or only `approveCooldown`
- ❌ **FAIL:** No `approvalSubmitting` state, or it's not cleared in `finally {}`
- ✅ **PASS:** `disabled={isPending || approvalSubmitting || approveCooldown}` with both states managed correctly

---

## 🚨 Critical: SE2 Branding Removal

AI agents treat the scaffold as sacred and leave all default branding in place.

- [ ] **Footer:** Remove BuidlGuidl links, "Built with 🏗️ SE2", "Fork me" link, support links. Replace with project's own repo link or clean it out
- [ ] **Tab title:** Must be the app name, NOT "Scaffold-ETH 2" or "SE-2 App" or "App Name | Scaffold-ETH 2"
- [ ] **README:** Must describe THIS project. Not the SE2 template README. Remove "Built with Scaffold-ETH 2" sections and SE2 doc links
- [ ] **Favicon:** Must not be the SE2 default

---

## Important: Contract Address Display

- ❌ **FAIL:** The deployed contract address appears nowhere on the page
- ✅ **PASS:** Contract address displayed using `<Address/>` component (blockie, ENS, copy, explorer link)

Agents display the connected wallet address but forget to show the contract the user is interacting with.

---

## Important: Address Input — Always `<AddressInput/>`

**EVERY input that accepts an Ethereum address must use `<AddressInput/>`, not a plain `<input type="text">`.**

- ❌ **FAIL:** `<input type="text" placeholder="0x..." value={addr} onChange={e => setAddr(e.target.value)} />`
- ✅ **PASS:** `<AddressInput value={addr} onChange={setAddr} placeholder="0x... or ENS name" />`

`<AddressInput/>` gives you ENS resolution (type "vitalik.eth" → resolves to address), blockie avatar preview, validation, and paste handling. A raw text input is unacceptable for address collection.

**In SE2, it's in `@scaffold-ui/components`:**
```typescript
import { AddressInput } from "@scaffold-ui/components";
// or
import { AddressInput } from "~~/components/scaffold-eth"; // if re-exported
```

**Quick check:**
```bash
grep -rn 'type="text"' packages/nextjs/app/ | grep -i "addr\|owner\|recip\|0x"
grep -rn 'placeholder="0x' packages/nextjs/app/
```
Any match → **FAIL**. Replace with `<AddressInput/>`.

The pair: `<Address/>` for **display**, `<AddressInput/>` for **input**. Always.

---

## Important: USD Values

- ❌ **FAIL:** Token amounts shown as "1,000 TOKEN" or "0.5 ETH" with no dollar value
- ✅ **PASS:** "0.5 ETH (~$1,250)" with USD conversion

Agents never add USD values unprompted. Check every place a token or ETH amount is displayed, including inputs.

---

## Important: OG Image Must Be Absolute URL

- ❌ **FAIL:** `images: ["/thumbnail.jpg"]` — relative path, breaks unfurling everywhere
- ✅ **PASS:** `images: ["https://yourdomain.com/thumbnail.jpg"]` — absolute production URL

Quick check:
```
grep -n "og:image\|images:" packages/nextjs/app/layout.tsx
```

---

## Important: RPC & Polling Config

Open `packages/nextjs/scaffold.config.ts`:

- ❌ **FAIL:** `pollingInterval: 30000` (default — makes the UI feel broken, 30 second update lag)
- ✅ **PASS:** `pollingInterval: 3000`
- ❌ **FAIL:** Using default Alchemy API key that ships with SE2
- ❌ **FAIL:** Code references `process.env.NEXT_PUBLIC_*` but the variable isn't actually set in the deployment environment (Vercel/hosting). Falls back to public RPC like `mainnet.base.org` which is rate-limited
- ✅ **PASS:** `rpcOverrides` uses `process.env.NEXT_PUBLIC_*` variables AND the env var is confirmed set on the hosting platform
- ❌ **FAIL:** `services/web3/wagmiConfig.tsx` still includes bare `http()` fallback transport (silently hits public RPCs in parallel, causing rate limits)
- ✅ **PAS

_(reference truncated — see https://github.com/austintgriffith/ethskills/tree/main/qa for the full document)_

Source: https://github.com/austintgriffith/ethskills/tree/main/qa
